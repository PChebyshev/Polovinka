import type { FastifyInstance, FastifyRequest } from 'fastify';
import { all, one, run, logEvent } from './db.js';
import { newCode, newId, nowIso } from './ids.js';
import { notExcluded } from './pmf.js';
import { edgeHost, publicBase } from './hosts.js';

/**
 * Рекламные кампании: уникальная ссылка /a/<код> и/или utm-метки из рекламного кабинета.
 *  - переход: событие ad_visit с анонимным visitor-id (в браузере и после установки на экран — отдельно);
 *  - регистрация первого человека пары по такой ссылке привязывает пару к кампании;
 *  - метрики считаются по парам кампании: пара собралась, раскрытие, удержание, опрос, стоимость.
 */

interface CampaignRow {
  id: string;
  code: string;
  name: string;
  source: string | null;
  budget: number | null;
  utm_key: string | null;
  created_at: string;
  archived_at: string | null;
}

const ATTR_DAYS = 30;

const clean = (v: unknown, max = 60) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

function byCode(code: unknown): CampaignRow | undefined {
  if (typeof code !== 'string' || !/^[a-z0-9]{4,16}$/.test(code)) return undefined;
  return one<CampaignRow>('SELECT * FROM campaigns WHERE code = ?', code);
}

/** Кампания по utm-меткам: создаётся автоматически, если такой ещё нет. */
function byUtm(utm: unknown): CampaignRow | undefined {
  if (!utm || typeof utm !== 'object') return undefined;
  const u = utm as Record<string, unknown>;
  const source = clean(u.source, 40).toLowerCase();
  if (!source) return undefined;
  const campaign = clean(u.campaign, 60).toLowerCase();
  const content = clean(u.content, 60).toLowerCase();
  const key = [source, campaign, content].join('|');
  const existing = one<CampaignRow>('SELECT * FROM campaigns WHERE utm_key = ?', key);
  if (existing) return existing;
  // Не даём засорить список: не больше 300 автокампаний
  if (Number(one<{ n: number }>('SELECT COUNT(*) AS n FROM campaigns WHERE utm_key IS NOT NULL')?.n ?? 0) >= 300) return undefined;
  let code = newCode(8);
  while (one('SELECT 1 FROM campaigns WHERE code = ?', code)) code = newCode(8);
  const name = [campaign || 'без названия', content].filter(Boolean).join(' · ');
  run(
    'INSERT INTO campaigns (id, code, name, source, budget, utm_key, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?)',
    newId(),
    code,
    name,
    source,
    key,
    nowIso(),
  );
  return one<CampaignRow>('SELECT * FROM campaigns WHERE utm_key = ?', key);
}

/** Код кампании для новой пары: только если переход был не раньше 30 дней назад. */
export function campaignForSignup(attr: unknown): string | null {
  if (!attr || typeof attr !== 'object') return null;
  const a = attr as { code?: unknown; at?: unknown };
  const c = byCode(a.code);
  if (!c) return null;
  const at = typeof a.at === 'number' ? a.at : Date.now();
  if (Date.now() - at > ATTR_DAYS * 86_400_000) return null;
  return c.id;
}

export interface CampaignStats {
  id: string;
  code: string;
  name: string;
  source: string | null;
  url: string;
  /** Та же ссылка через зарубежный вход — для Telegram (работает с VPN). */
  edgeUrl: string | null;
  budget: number | null;
  auto: boolean;
  archived: boolean;
  createdAt: string;
  visits: number;
  /** Из них пришли через зарубежный вход (с VPN). */
  edgeVisits: number;
  installs: number;
  signups: number;
  pairs: number;
  revealed: number;
  week2: number;
  week2Base: number;
  active7: number;
  surveyVery: number;
  surveyResponses: number;
}

/** Первый домен из EDGE_HOSTS — им подписываем рекламные ссылки для Telegram. */
const edgeBase = () => {
  const h = (process.env.EDGE_HOSTS ?? '').split(',')[0]?.trim();
  return h ? `https://${h}` : null;
};

const iso = (ms: number) => new Date(ms).toISOString();

/** Метрики по парам: собралась, раскрытие, вторая неделя, активны за 7 дней, опрос. */
function pairMetrics(pairIds: string[]) {
  let pairs = 0;
  let revealed = 0;
  let week2 = 0;
  let week2Base = 0;
  let active7 = 0;
  let surveyVery = 0;
  let surveyResponses = 0;
  const weekAgo = iso(Date.now() - 7 * 86_400_000);
  for (const pid of pairIds) {
    const m = one<{ n: number; at: string }>('SELECT COUNT(*) AS n, MAX(created_at) AS at FROM users WHERE pair_id = ?', pid);
    if (Number(m?.n ?? 0) < 2 || !m?.at) continue;
    pairs++;
    if (one(`SELECT 1 FROM rounds WHERE pair_id = ? AND status = 'revealed'`, pid)) revealed++;
    const joined = new Date(m.at).getTime();
    if (Date.now() - joined >= 14 * 86_400_000) {
      week2Base++;
      if (
        one(
          `SELECT 1 FROM answers a JOIN rounds r ON r.id = a.round_id WHERE r.pair_id = ? AND a.created_at >= ? AND a.created_at < ?`,
          pid,
          iso(joined + 7 * 86_400_000),
          iso(joined + 14 * 86_400_000),
        )
      )
        week2++;
    }
    if (one(`SELECT 1 FROM answers a JOIN rounds r ON r.id = a.round_id WHERE r.pair_id = ? AND a.created_at >= ?`, pid, weekAgo)) active7++;
    const s = all<{ disappoint: string }>('SELECT disappoint FROM survey_responses WHERE pair_id = ?', pid);
    surveyResponses += s.length;
    surveyVery += s.filter((x) => x.disappoint === 'very').length;
  }
  return { pairs, revealed, week2, week2Base, active7, surveyVery, surveyResponses };
}

export function computeCampaigns(
  base: string,
  periodDays: number,
): {
  campaigns: CampaignStats[];
  organic: Omit<CampaignStats, 'id' | 'code' | 'url' | 'edgeUrl' | 'budget' | 'auto' | 'archived' | 'createdAt' | 'source' | 'name'>;
} {
  const rows = all<CampaignRow>('SELECT * FROM campaigns ORDER BY archived_at IS NOT NULL, created_at DESC');
  const visitors = (cid: string, standalone: 0 | 1) =>
    Number(
      one<{ n: number }>(
        `SELECT COUNT(DISTINCT json_extract(meta, '$.visitor')) AS n FROM events WHERE type = 'ad_visit' AND json_extract(meta, '$.campaign') = ? AND json_extract(meta, '$.standalone') = ?`,
        cid,
        standalone,
      )?.n ?? 0,
    );
  const campaigns = rows.map((c) => {
    const pairIds = all<{ id: string }>(`SELECT id FROM pairs WHERE campaign_id = ? AND is_guest = 0 AND ${notExcluded('id')}`, c.id).map((r) => r.id);
    return {
      id: c.id,
      code: c.code,
      name: c.name,
      source: c.source,
      url: `${base}/a/${c.code}`,
      edgeUrl: edgeBase() ? `${edgeBase()}/a/${c.code}` : null,
      budget: c.budget,
      auto: !!c.utm_key,
      archived: !!c.archived_at,
      createdAt: c.created_at,
      visits: visitors(c.id, 0),
      edgeVisits: Number(
        one<{ n: number }>(
          `SELECT COUNT(DISTINCT json_extract(meta, '$.visitor')) AS n FROM events WHERE type = 'ad_visit' AND json_extract(meta, '$.campaign') = ? AND json_extract(meta, '$.edge') = 1`,
          c.id,
        )?.n ?? 0,
      ),
      installs: visitors(c.id, 1),
      signups: pairIds.length,
      ...pairMetrics(pairIds),
    };
  });
  // Для сравнения: пары без рекламы, созданные за тот же период
  const since = iso(Date.now() - periodDays * 86_400_000);
  const organicIds = all<{ id: string }>(
    `SELECT id FROM pairs WHERE campaign_id IS NULL AND is_guest = 0 AND created_at >= ? AND ${notExcluded('id')}`,
    since,
  ).map((r) => r.id);
  return { campaigns, organic: { visits: 0, edgeVisits: 0, installs: 0, signups: organicIds.length, ...pairMetrics(organicIds) } };
}

export async function registerCampaignRoutes(app: FastifyInstance, deps: { keyOk: (k: unknown) => boolean }) {
  const keyOf = (req: FastifyRequest) => (req.query as { key?: string }).key ?? (req.headers['x-stats-key'] as string | undefined);

  /** Переход по рекламной ссылке или с utm-метками. Анонимно: случайный id посетителя. */
  app.post('/api/attr/visit', async (req) => {
    const body = (req.body ?? {}) as { code?: unknown; utm?: unknown; visitor?: unknown; standalone?: unknown };
    const visitor = typeof body.visitor === 'string' && /^[a-z0-9]{8,32}$/.test(body.visitor) ? body.visitor : null;
    const c = byCode(body.code) ?? byUtm(body.utm);
    if (!c || !visitor || c.archived_at) return { code: c && !c.archived_at ? c.code : null };
    logEvent('ad_visit', { meta: { campaign: c.id, visitor, standalone: body.standalone ? 1 : 0, edge: edgeHost(req) ? 1 : 0 } });
    return { code: c.code };
  });

  app.post('/api/campaigns', async (req, reply) => {
    if (!deps.keyOk(keyOf(req))) return reply.code(401).send({ error: 'stats_key' });
    const body = (req.body ?? {}) as { name?: unknown; source?: unknown; budget?: unknown };
    const name = clean(body.name, 80);
    if (!name) return reply.code(400).send({ error: 'name' });
    const budget = Number(body.budget);
    let code = newCode(6);
    while (one('SELECT 1 FROM campaigns WHERE code = ?', code)) code = newCode(6);
    run(
      'INSERT INTO campaigns (id, code, name, source, budget, utm_key, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)',
      newId(),
      code,
      name,
      clean(body.source, 40) || null,
      Number.isFinite(budget) && budget > 0 ? Math.round(budget) : null,
      nowIso(),
    );
    return { code, url: `${publicBase(req)}/a/${code}` };
  });

  app.put('/api/campaigns/:id', async (req, reply) => {
    if (!deps.keyOk(keyOf(req))) return reply.code(401).send({ error: 'stats_key' });
    const id = (req.params as { id: string }).id;
    if (!one('SELECT 1 FROM campaigns WHERE id = ?', id)) return reply.code(404).send({ error: 'not_found' });
    const body = (req.body ?? {}) as { name?: unknown; budget?: unknown; archived?: unknown };
    if (typeof body.name === 'string' && clean(body.name, 80)) run('UPDATE campaigns SET name = ? WHERE id = ?', clean(body.name, 80), id);
    if (body.budget !== undefined) {
      const b = Number(body.budget);
      run('UPDATE campaigns SET budget = ? WHERE id = ?', Number.isFinite(b) && b > 0 ? Math.round(b) : null, id);
    }
    if (typeof body.archived === 'boolean') run('UPDATE campaigns SET archived_at = ? WHERE id = ?', body.archived ? nowIso() : null, id);
    return { ok: true };
  });
}

export { publicBase as campaignBase };
