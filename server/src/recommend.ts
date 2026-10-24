import type { FastifyInstance, FastifyRequest } from 'fastify';
import { all, one, run, logEvent, type PairRow, type UserRow } from './db.js';
import { newCode } from './ids.js';
import { readToken, requireUser, userByToken } from './auth.js';
import { publicBase } from './hosts.js';
import { counters } from './serialize.js';

/**
 * «Посоветовать друзьям»: у пары есть своя ссылка /f/<код>. Это не приглашение в пару —
 * по ней друзья открывают страницу «Стас и Ира советуют Половинку» и начинают свою пару.
 */

export function ensureRefCode(pairId: string): string {
  const row = one<{ ref_code: string | null }>('SELECT ref_code FROM pairs WHERE id = ?', pairId);
  if (row?.ref_code) return row.ref_code;
  let code = newCode(8);
  while (one('SELECT 1 FROM pairs WHERE ref_code = ?', code)) code = newCode(8);
  run('UPDATE pairs SET ref_code = ? WHERE id = ?', code, pairId);
  return code;
}

export function refPair(code: string): { pair: PairRow; names: string[]; days: number } | null {
  if (!/^[a-z0-9]{4,16}$/.test(code)) return null;
  const pair = one<PairRow>('SELECT * FROM pairs WHERE ref_code = ? AND deleted_at IS NULL', code);
  if (!pair) return null;
  const names = all<UserRow>('SELECT * FROM users WHERE pair_id = ? ORDER BY created_at', pair.id).map((u) => u.name);
  return { pair, names, days: counters(pair.id).daysTogether };
}

/** Имена пары для заголовка: «Стас и Ира», «Стас». */
export function pairTitle(names: string[]): string {
  return names.length > 1 ? `${names[0]} и ${names[1]}` : (names[0] ?? 'Друзья');
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** Заголовок и описание превью ссылки в мессенджере — одни и те же в OG и в предпросмотре. */
export function refPreview(r: { names: string[]; days: number }): { title: string; description: string } {
  const who = pairTitle(r.names);
  const verb = r.names.length > 1 ? 'советуют' : 'советует';
  const plays = r.names.length > 1 ? 'играют' : 'играет';
  const together = r.days >= 3 ? ` ${who} ${plays} уже ${r.days} ${plural(r.days, 'день', 'дня', 'дней')}.` : '';
  return {
    title: `${who} ${verb} вам Половинку`,
    description: `Один вопрос в день на двоих: утром 20 секунд, вечером — маленькое открытие о человеке рядом.${together}`,
  };
}

export async function registerRecommendRoutes(app: FastifyInstance) {
  app.get('/api/recommend', { preHandler: requireUser }, async (req) => {
    const user = req.user!;
    const code = ensureRefCode(user.pair_id);
    const r = refPair(code)!;
    const base = publicBase(req);
    return { code, url: `${base}/f/${code}`, host: base.replace(/^https?:\/\//, ''), image: `${base}/og-default.png`, ...refPreview(r) };
  });

  app.post('/api/recommend/sent', { preHandler: requireUser }, async (req) => {
    const user = req.user!;
    const body = (req.body ?? {}) as { via?: unknown; variant?: unknown };
    logEvent('ref_shared', {
      pairId: user.pair_id,
      userId: user.id,
      meta: {
        via: typeof body.via === 'string' ? body.via.slice(0, 20) : 'unknown',
        variant: typeof body.variant === 'string' ? body.variant.slice(0, 20) : null,
      },
    });
    return { ok: true };
  });

  /** Публичная информация для страницы /f/:code — только имена и дни, без ответов. */
  app.get('/api/recommend/:code', async (req, reply) => {
    const code = String((req.params as { code: string }).code).toLowerCase();
    const r = refPair(code);
    if (!r) return reply.code(404).send({ error: 'not_found' });
    const viewer = userByToken(readToken(req));
    const peek = (req.query as { peek?: string }).peek === '1';
    if (!peek && (!viewer || viewer.pair_id !== r.pair.id)) logEvent('ref_opened', { pairId: r.pair.id, userId: viewer?.id ?? null });
    return { names: r.names, days: r.days };
  });
}
