import type { FastifyInstance } from 'fastify';
import { all, one, run, logEvent, type UserRow } from './db.js';
import { nowIso } from './ids.js';
import { addDays, daysBetween } from './time.js';
import { requireUser } from './auth.js';
import { scoreFor } from './score.js';

/**
 * Продуктовая статистика: недельная активность, функции, удержание по когортам,
 * активация и опрос «Как бы вы расстроились, если бы Половинка исчезла?» (тест Шона Эллиса).
 * Пары из stats_exclude (свои, тестовые) не учитываются нигде.
 */

// --- Исключённые пары ---------------------------------------------------------------

/** SQL-условие «пара не исключена» для колонки с pair_id. */
export function notExcluded(col: string): string {
  return `(${col} IS NULL OR ${col} NOT IN (SELECT pair_id FROM stats_exclude))`;
}

function namesOf(pairId: string): string[] {
  return all<{ name: string }>('SELECT name FROM users WHERE pair_id = ? ORDER BY created_at', pairId).map((u) => u.name);
}

// --- Опрос ----------------------------------------------------------------------------

const SURVEY_MIN_DAYS = 10;
const SURVEY_MIN_DISCOVERIES = 7;
const DISAPPOINT = ['very', 'somewhat', 'not'] as const;

/** Пора ли показать опрос: пара полная не меньше 10 дней, 7+ открытий, ещё не отвечал. */
export function surveyDue(user: UserRow): boolean {
  if (one('SELECT 1 FROM survey_responses WHERE user_id = ?', user.id)) return false;
  const joined = one<{ n: number; at: string }>('SELECT COUNT(*) AS n, MAX(created_at) AS at FROM users WHERE pair_id = ?', user.pair_id);
  if (Number(joined?.n ?? 0) < 2 || !joined?.at) return false;
  if (Date.now() - new Date(joined.at).getTime() < SURVEY_MIN_DAYS * 86_400_000) return false;
  return scoreFor(user.pair_id).discoveries >= SURVEY_MIN_DISCOVERIES;
}

// --- Функции ----------------------------------------------------------------------------

interface Feature {
  key: string;
  label: string;
  /** События из таблицы events; screen:* — просмотр экрана. */
  events: string[];
}

const FEATURES: Feature[] = [
  { key: 'answer', label: 'Ответ на вопрос', events: ['answer'] },
  { key: 'bonus', label: 'Бонусные вопросы', events: ['bonus_started'] },
  { key: 'why', label: '«Почему?»', events: ['why_added'] },
  { key: 'topic', label: 'Тема на вечер', events: ['topic_opened'] },
  { key: 'gesture', label: 'Тёплые жесты', events: ['gesture_sent'] },
  { key: 'ideas', label: 'Идеи → «Хотим вместе»', events: ['idea_saved'] },
  { key: 'ideas_done', label: 'Идеи: «Сделали»', events: ['idea_done'] },
  { key: 'plan', label: 'Запланировали на дату', events: ['idea_planned'] },
  { key: 'personal', label: 'Вопрос по ответам (ИИ)', events: ['personal_question'] },
  { key: 'care', label: 'Подсказка заботы', events: ['care_hint'] },
  { key: 'repeat', label: '«Повтор»', events: ['repeat_started'] },
  { key: 'capsule', label: 'Капсула времени', events: ['capsule_created', 'capsule_letter'] },
  { key: 'custom', label: 'Свои вопросы', events: ['custom_question_added'] },
  { key: 'theme', label: 'Тема недели', events: ['theme_set'] },
  { key: 'favorite', label: 'Избранное', events: ['favorite_added'] },
  { key: 'digest', label: 'Итоги недели: открыли', events: ['digest_opened'] },
  { key: 'week', label: 'Итог недели: поделились', events: ['weekly_shared'] },
  { key: 'challenge', label: 'Вызов паре', events: ['challenge_sent'] },
  { key: 'recommend', label: 'Совет друзьям', events: ['ref_shared'] },
  { key: 'v_history', label: 'Экран «История»', events: ['screen:history'] },
  { key: 'v_topics', label: 'Экран «Темы»', events: ['screen:topics'] },
  { key: 'v_together', label: 'Вкладка «Вместе»', events: ['screen:together', 'screen:ideas', 'screen:gesture'] },
  { key: 'v_book', label: 'Экран «Книга пары»', events: ['screen:book'] },
  { key: 'v_levels', label: 'Экран «Уровни»', events: ['screen:levels'] },
];

/** Экраны, которые клиент может отметить событием screen. */
export const TRACKED_SCREENS = ['together', 'history', 'topics', 'ideas', 'book', 'levels', 'capsule', 'week', 'recommend', 'settings', 'gesture'];

/** Пары, которые пользовались функцией в интервале. */
function featurePairs(f: Feature, from: string, to: string): { pairs: Set<string>; events: number } {
  const plain = f.events.filter((e) => !e.startsWith('screen:'));
  const screens = f.events.filter((e) => e.startsWith('screen:')).map((e) => e.slice(7));
  const rows: Array<{ pair_id: string | null }> = [];
  if (plain.length)
    rows.push(
      ...all<{ pair_id: string | null }>(
        `SELECT pair_id FROM events WHERE type IN (${plain.map(() => '?').join(',')}) AND created_at >= ? AND created_at < ? AND ${notExcluded('pair_id')}`,
        ...plain,
        from,
        to,
      ),
    );
  if (screens.length)
    rows.push(
      ...all<{ pair_id: string | null }>(
        `SELECT pair_id FROM events WHERE type = 'screen' AND json_extract(meta, '$.name') IN (${screens.map(() => '?').join(',')}) AND created_at >= ? AND created_at < ? AND ${notExcluded('pair_id')}`,
        ...screens,
        from,
        to,
      ),
    );
  return { pairs: new Set(rows.map((r) => r.pair_id).filter((x): x is string => !!x)), events: rows.length };
}

// --- Расчёт ---------------------------------------------------------------------------

export interface PmfResponse {
  excluded: Array<{ pairId: string; names: string[] }>;
  week: {
    activePairs: number;
    completePairs: number;
    medianDaysActive: number | null;
    medianSessions: number | null;
    activeUsers: number;
    daysHistogram: number[];
    sessionsHistogram: Array<{ label: string; n: number }>;
  };
  weekly: Array<{ weekStart: string; activePairs: number; completePairs: number; sessions: number }>;
  features: Array<{
    key: string;
    label: string;
    pairs: number;
    share: number | null;
    events: number;
    liftUsers: number;
    liftUsed: number | null;
    liftOthers: number | null;
  }>;
  cohorts: Array<{ weekStart: string; size: number; weeks: Array<number | null> }>;
  activation: Array<[string, number]>;
  access: Array<[string, number]>;
  stages: Array<{ stage: string; pairs: number; activeShare: number | null; avgDays: number | null }>;
  survey: {
    responses: number;
    shown: number;
    very: number;
    somewhat: number;
    not: number;
    veryShare: number | null;
    byStage: Array<{ stage: string; responses: number; veryShare: number | null }>;
    texts: Array<{ at: string; disappoint: string; stage: string; benefit: string | null; missing: string | null }>;
  };
  pairs: Array<{
    pairId: string;
    names: string[];
    joinedAt: string;
    stage: string | null;
    hasKids: boolean | null;
    daysActive7: number;
    sessions7: number;
    discoveries: number;
    lastActive: string | null;
    features: number;
  }>;
}

const STAGE_LABEL: Record<string, string> = { lt1: '< года', '1to3': '1–3 года', '3to10': '3–10 лет', '10plus': '10+ лет', none: 'не указано' };

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function share(n: number, d: number): number | null {
  return d ? Math.round((n / d) * 1000) / 1000 : null;
}

/** Понедельник недели для даты YYYY-MM-DD (UTC). */
function mondayOf(date: string): string {
  const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addDays(date, -((wd + 6) % 7));
}

const iso = (date: string) => `${date}T00:00:00.000Z`;

export function computePmf(periodDays: number): PmfResponse {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = addDays(today, 1);
  const weekAgo = addDays(today, -6);
  const periodFrom = addDays(today, -periodDays + 1);

  // Полные пары (двое), не гостевые, не удалённые, не исключённые; когда присоединился второй
  const complete = all<{ pair_id: string; joined_at: string; stage: string | null; has_kids: number | null; created_at: string }>(
    `SELECT u.pair_id, MAX(u.created_at) AS joined_at, p.stage, p.has_kids, p.created_at
       FROM users u JOIN pairs p ON p.id = u.pair_id
      WHERE p.is_guest = 0 AND p.deleted_at IS NULL AND ${notExcluded('u.pair_id')}
      GROUP BY u.pair_id HAVING COUNT(*) >= 2`,
  );
  const completeIds = new Set(complete.map((p) => p.pair_id));

  /** Дни с ответами каждой пары в интервале [from, to). */
  const activeDays = (from: string, to: string) => {
    const m = new Map<string, number>();
    for (const r of all<{ pair_id: string; days: number }>(
      `SELECT r.pair_id, COUNT(DISTINCT substr(a.created_at, 1, 10)) AS days
         FROM answers a JOIN rounds r ON r.id = a.round_id
        WHERE r.kind != 'challenge' AND a.created_at >= ? AND a.created_at < ?
        GROUP BY r.pair_id`,
      iso(from),
      iso(to),
    ))
      if (completeIds.has(r.pair_id)) m.set(r.pair_id, Number(r.days));
    return m;
  };
  /** Открытия приложения по пользователям в интервале. */
  const sessionsBy = (from: string, to: string) => {
    const m = new Map<string, { pair: string; n: number }>();
    for (const r of all<{ user_id: string; pair_id: string; n: number }>(
      `SELECT user_id, pair_id, COUNT(*) AS n FROM events WHERE type = 'app_open' AND created_at >= ? AND created_at < ? AND ${notExcluded('pair_id')} GROUP BY user_id`,
      iso(from),
      iso(to),
    ))
      if (completeIds.has(r.pair_id)) m.set(r.user_id, { pair: r.pair_id, n: Number(r.n) });
    return m;
  };

  // --- Неделя ---
  const days7 = activeDays(weekAgo, tomorrow);
  const sess7 = sessionsBy(weekAgo, tomorrow);
  const usersInComplete = all<{ id: string; pair_id: string }>(
    `SELECT id, pair_id FROM users WHERE pair_id IN (${[...completeIds].map(() => '?').join(',') || "''"})`,
    ...completeIds,
  );
  const sessCounts = usersInComplete.map((u) => sess7.get(u.id)?.n ?? 0);
  const daysHistogram = Array.from({ length: 8 }, () => 0);
  for (const p of complete) daysHistogram[Math.min(7, days7.get(p.pair_id) ?? 0)]++;
  const buckets: Array<[string, (n: number) => boolean]> = [
    ['0', (n) => n === 0],
    ['1', (n) => n === 1],
    ['2–3', (n) => n >= 2 && n <= 3],
    ['4–7', (n) => n >= 4 && n <= 7],
    ['8–14', (n) => n >= 8 && n <= 14],
    ['15+', (n) => n >= 15],
  ];
  const week = {
    activePairs: days7.size,
    completePairs: complete.length,
    medianDaysActive: median([...days7.values()]),
    medianSessions: median(sessCounts.filter((n) => n > 0)),
    activeUsers: sessCounts.filter((n) => n > 0).length,
    daysHistogram,
    sessionsHistogram: buckets.map(([label, test]) => ({ label, n: sessCounts.filter(test).length })),
  };

  // --- По неделям: 8 последних ---
  const thisMonday = mondayOf(today);
  const weekly: PmfResponse['weekly'] = [];
  for (let k = 7; k >= 0; k--) {
    const ws = addDays(thisMonday, -7 * k);
    const we = addDays(ws, 7);
    const act = activeDays(ws, we);
    weekly.push({
      weekStart: ws,
      activePairs: act.size,
      completePairs: complete.filter((p) => p.joined_at < iso(we)).length,
      sessions: [...sessionsBy(ws, we).values()].reduce((s, x) => s + x.n, 0),
    });
  }

  // --- Функции: доля активных пар за период и «связь с удержанием» ---
  const periodActive = activeDays(periodFrom, tomorrow);
  const mature = complete.filter((p) => daysBetween(p.joined_at.slice(0, 10), today) >= 14);
  const features = FEATURES.map((f) => {
    const used = featurePairs(f, iso(periodFrom), iso(tomorrow));
    const usedPairs = [...used.pairs].filter((p) => completeIds.has(p));
    // Удержание: пары старше 14 дней, активные за последние 7 дней — среди пользовавшихся функцией когда-либо и остальных
    const ever = featurePairs(f, '0000', iso(tomorrow)).pairs;
    const u = mature.filter((p) => ever.has(p.pair_id));
    const o = mature.filter((p) => !ever.has(p.pair_id));
    return {
      key: f.key,
      label: f.label,
      pairs: usedPairs.length,
      share: share(usedPairs.length, periodActive.size),
      events: used.events,
      liftUsers: u.length,
      liftUsed: u.length >= 3 ? share(u.filter((p) => days7.has(p.pair_id)).length, u.length) : null,
      liftOthers: o.length >= 3 ? share(o.filter((p) => days7.has(p.pair_id)).length, o.length) : null,
    };
  });

  // --- Когорты: неделя, когда пара стала полной → доля активных на неделе 0..7 ---
  const cohorts: PmfResponse['cohorts'] = [];
  for (let k = 7; k >= 0; k--) {
    const ws = addDays(thisMonday, -7 * k);
    const members = complete.filter((p) => mondayOf(p.joined_at.slice(0, 10)) === ws);
    if (!members.length) continue;
    const row: Array<number | null> = [];
    for (let w = 0; w < 8; w++) {
      const from = addDays(ws, 7 * w);
      if (from > today) {
        row.push(null);
        continue;
      }
      const act = activeDays(from, addDays(from, 7));
      row.push(share(members.filter((p) => act.has(p.pair_id)).length, members.length));
    }
    cohorts.push({ weekStart: ws, size: members.length, weeks: row });
  }

  // --- Активация: пары, созданные за период ---
  const created = all<{ id: string; created_at: string }>(
    `SELECT id, created_at FROM pairs WHERE is_guest = 0 AND deleted_at IS NULL AND created_at >= ? AND ${notExcluded('id')}`,
    iso(periodFrom),
  );
  const createdIds = created.map((p) => p.id);
  const joined = complete.filter((p) => createdIds.includes(p.pair_id));
  const revealsIn = (pairId: string, from: string, to: string) =>
    Number(
      one<{ n: number }>(
        `SELECT COUNT(*) AS n FROM rounds WHERE pair_id = ? AND status = 'revealed' AND revealed_at >= ? AND revealed_at < ?`,
        pairId,
        from,
        to,
      )?.n ?? 0,
    );
  const firstReveal = joined.filter((p) => revealsIn(p.pair_id, '0000', '9999') > 0);
  const week1 = joined.filter((p) => revealsIn(p.pair_id, p.joined_at, new Date(new Date(p.joined_at).getTime() + 7 * 86_400_000).toISOString()) >= 3);
  // Вторая неделя возможна только у пар, присоединившихся 14+ дней назад
  const old14 = joined.filter((p) => Date.now() - new Date(p.joined_at).getTime() >= 14 * 86_400_000);
  const week2 = old14.filter((p) => {
    const start = new Date(new Date(p.joined_at).getTime() + 7 * 86_400_000).toISOString();
    const end = new Date(new Date(p.joined_at).getTime() + 14 * 86_400_000).toISOString();
    return revealsIn(p.pair_id, start, end) > 0;
  });
  const activation: Array<[string, number]> = [
    ['Создали аккаунт', created.length],
    ['Партнёр присоединился', joined.length],
    ['Первое раскрытие', firstReveal.length],
    ['3+ раскрытия за первую неделю', week1.length],
    [`Вернулись на 2-й неделе (из ${old14.length} старше 14 дн.)`, week2.length],
  ];

  // --- Сегменты по стадии ---
  const stageKeys = ['lt1', '1to3', '3to10', '10plus', 'none'];
  const olderThanWeek = complete.filter((p) => daysBetween(p.joined_at.slice(0, 10), today) >= 7);
  const stages = stageKeys
    .map((s) => {
      const list = complete.filter((p) => (p.stage ?? 'none') === s);
      const older = olderThanWeek.filter((p) => (p.stage ?? 'none') === s);
      const d = list.map((p) => days7.get(p.pair_id) ?? 0);
      return {
        stage: STAGE_LABEL[s],
        pairs: list.length,
        activeShare: share(older.filter((p) => days7.has(p.pair_id)).length, older.length),
        avgDays: list.length ? Math.round((d.reduce((x, y) => x + y, 0) / list.length) * 10) / 10 : null,
      };
    })
    .filter((s) => s.pairs > 0);

  // --- Опрос ---
  const resp = all<{ disappoint: string; benefit: string | null; missing: string | null; created_at: string; stage: string | null }>(
    `SELECT s.disappoint, s.benefit, s.missing, s.created_at, p.stage FROM survey_responses s JOIN pairs p ON p.id = s.pair_id WHERE ${notExcluded('s.pair_id')} ORDER BY s.created_at DESC`,
  );
  const cnt = (v: string, list = resp) => list.filter((r) => r.disappoint === v).length;
  const shown = Number(one<{ n: number }>(`SELECT COUNT(DISTINCT user_id) AS n FROM events WHERE type = 'survey_shown' AND ${notExcluded('pair_id')}`)?.n ?? 0);
  const survey = {
    responses: resp.length,
    shown,
    very: cnt('very'),
    somewhat: cnt('somewhat'),
    not: cnt('not'),
    veryShare: share(cnt('very'), resp.length),
    byStage: stageKeys
      .map((s) => {
        const list = resp.filter((r) => (r.stage ?? 'none') === s);
        return { stage: STAGE_LABEL[s], responses: list.length, veryShare: share(cnt('very', list), list.length) };
      })
      .filter((s) => s.responses > 0),
    texts: resp
      .filter((r) => r.benefit || r.missing)
      .slice(0, 40)
      .map((r) => ({ at: r.created_at, disappoint: r.disappoint, stage: STAGE_LABEL[r.stage ?? 'none'], benefit: r.benefit, missing: r.missing })),
  };

  // --- Пары ---
  const featureTypes = FEATURES.flatMap((f) => f.events.filter((e) => !e.startsWith('screen:')));
  const pairs = complete
    .map((p) => {
      const last = one<{ at: string | null }>(
        `SELECT MAX(a.created_at) AS at FROM answers a JOIN rounds r ON r.id = a.round_id WHERE r.pair_id = ?`,
        p.pair_id,
      )?.at;
      const used = Number(
        one<{ n: number }>(
          `SELECT COUNT(DISTINCT type) AS n FROM events WHERE pair_id = ? AND type IN (${featureTypes.map(() => '?').join(',')})`,
          p.pair_id,
          ...featureTypes,
        )?.n ?? 0,
      );
      return {
        pairId: p.pair_id,
        names: namesOf(p.pair_id),
        joinedAt: p.joined_at,
        stage: p.stage,
        hasKids: p.has_kids === null ? null : !!p.has_kids,
        daysActive7: days7.get(p.pair_id) ?? 0,
        sessions7: usersInComplete.filter((u) => u.pair_id === p.pair_id).reduce((s, u) => s + (sess7.get(u.id)?.n ?? 0), 0),
        discoveries: scoreFor(p.pair_id).discoveries,
        lastActive: last ?? null,
        features: used,
      };
    })
    .sort((a, b) => (b.lastActive ?? '').localeCompare(a.lastActive ?? ''))
    .slice(0, 200);

  const excluded = all<{ pair_id: string }>('SELECT pair_id FROM stats_exclude ORDER BY created_at').map((r) => ({
    pairId: r.pair_id,
    names: namesOf(r.pair_id),
  }));

  // --- Сохранность аккаунтов: есть ли способ вернуться при смене телефона ---
  const acc = one<{ total: number; email: number; recovery: number; due: number }>(
    `SELECT COUNT(*) AS total,
            SUM(u.email IS NOT NULL) AS email,
            SUM(u.email IS NULL AND u.recovery_hash IS NOT NULL) AS recovery,
            SUM(u.email IS NULL AND EXISTS (SELECT 1 FROM answers a WHERE a.user_id = u.id)) AS due
       FROM users u JOIN pairs p ON p.id = u.pair_id
      WHERE p.is_guest = 0 AND p.deleted_at IS NULL AND ${notExcluded('u.pair_id')}`,
  );
  const access: Array<[string, number]> = [
    ['Всего людей', Number(acc?.total ?? 0)],
    ['Привязали почту', Number(acc?.email ?? 0)],
    ['Только код восстановления', Number(acc?.recovery ?? 0)],
    ['Без почты, уже отвечали (видят экран почты)', Number(acc?.due ?? 0)],
  ];

  return { excluded, week, weekly, features, cohorts, activation, stages, survey, pairs, access };
}

// --- Маршруты ---------------------------------------------------------------------------

/** Открытие приложения: не чаще раза в 30 минут на человека. */
const lastOpen = new Map<string, number>();
export function trackAppOpen(user: UserRow) {
  const now = Date.now();
  if (now - (lastOpen.get(user.id) ?? 0) < 30 * 60_000) return;
  lastOpen.set(user.id, now);
  if (lastOpen.size > 20_000) lastOpen.clear();
  logEvent('app_open', { pairId: user.pair_id, userId: user.id });
}

export async function registerPmfRoutes(app: FastifyInstance, deps: { keyOk: (k: unknown) => boolean; meResponse: (u: UserRow) => unknown }) {
  const keyOf = (req: { query: unknown; headers: Record<string, unknown> }) =>
    (req.query as { key?: string }).key ?? (req.headers['x-stats-key'] as string | undefined);

  /** «Это мы — не учитывать»: исключить пару того, кто открыл статистику в приложении. */
  app.post('/api/stats/exclude-me', { preHandler: requireUser }, async (req, reply) => {
    if (!deps.keyOk(keyOf(req))) return reply.code(401).send({ error: 'stats_key' });
    run('INSERT OR IGNORE INTO stats_exclude (pair_id, created_at) VALUES (?, ?)', req.user!.pair_id, nowIso());
    return { ok: true };
  });

  app.post('/api/stats/exclude/:pairId', async (req, reply) => {
    if (!deps.keyOk(keyOf(req))) return reply.code(401).send({ error: 'stats_key' });
    const pairId = (req.params as { pairId: string }).pairId;
    if (!one('SELECT 1 FROM pairs WHERE id = ?', pairId)) return reply.code(404).send({ error: 'not_found' });
    run('INSERT OR IGNORE INTO stats_exclude (pair_id, created_at) VALUES (?, ?)', pairId, nowIso());
    return { ok: true };
  });

  app.delete('/api/stats/exclude/:pairId', async (req, reply) => {
    if (!deps.keyOk(keyOf(req))) return reply.code(401).send({ error: 'stats_key' });
    run('DELETE FROM stats_exclude WHERE pair_id = ?', (req.params as { pairId: string }).pairId);
    return { ok: true };
  });

  app.post('/api/survey', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const body = (req.body ?? {}) as { disappoint?: unknown; benefit?: unknown; missing?: unknown };
    if (typeof body.disappoint !== 'string' || !(DISAPPOINT as readonly string[]).includes(body.disappoint))
      return reply.code(400).send({ error: 'disappoint' });
    const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, 500) : null);
    run(
      `INSERT INTO survey_responses (user_id, pair_id, disappoint, benefit, missing, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET disappoint = excluded.disappoint, benefit = excluded.benefit, missing = excluded.missing, created_at = excluded.created_at`,
      user.id,
      user.pair_id,
      body.disappoint,
      clean(body.benefit),
      clean(body.missing),
      nowIso(),
    );
    logEvent('survey_answered', { pairId: user.pair_id, userId: user.id, meta: { disappoint: body.disappoint } });
    return deps.meResponse(one<UserRow>('SELECT * FROM users WHERE id = ?', user.id)!);
  });
}
