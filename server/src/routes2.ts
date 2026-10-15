import type { FastifyInstance } from 'fastify';
import type { CustomQuestion, GestureTemplate, HistoryItem, HistoryResponse, MeResponse } from '../../shared/src/types.js';
import { CATEGORY_LABELS, GESTURE_LABELS } from '../../shared/src/types.js';
import { all, one, run, logEvent, type GestureRow, type PairRow, type QuestionRow, type RoundRow, type UserRow } from './db.js';
import { newId, nowIso } from './ids.js';
import { requireUser } from './auth.js';
import { pickQuestion } from './selection.js';
import { gesturePublic, partnerOf, roundPublic } from './serialize.js';
import { sendTo } from './sse.js';
import { markCelebrationSeen, levelFor } from './levels.js';
import { scoreFor } from './score.js';
import { isCategoryUnlocked } from '../../shared/src/progress.js';

const TEXT_MAX = 200;

function cleanText(raw: unknown, max = TEXT_MAX): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/\s+/g, ' ').trim();
  return s.length ? s.slice(0, max) : null;
}

export function gestureTemplatesOf(pairId: string): GestureTemplate[] {
  return all<{ id: string; type: string; text: string; created_at: string }>('SELECT * FROM gesture_templates WHERE pair_id = ? ORDER BY created_at', pairId).map((t) => ({
    id: t.id,
    type: t.type as GestureTemplate['type'],
    text: t.text,
    createdAt: t.created_at,
  }));
}

function customQuestionPublic(q: QuestionRow, used: Set<string>): CustomQuestion {
  return {
    id: q.id,
    text: q.text,
    a: q.a,
    b: q.b,
    layer: q.layer as CustomQuestion['layer'],
    topic: q.topic,
    authorId: q.author_id ?? '',
    createdAt: q.created_at,
    used: used.has(q.id),
  };
}

interface Deps {
  meResponse: (u: UserRow) => MeResponse;
}

export async function registerStage2Routes(app: FastifyInstance, deps: Deps) {
  // --- «Наша история» --------------------------------------------------------

  app.get('/api/history', { preHandler: requireUser }, async (req) => {
    const user = req.user!;
    const partner = partnerOf(user);
    const q = req.query as { before?: string; limit?: string; favorites?: string; only?: string };
    const only = q.only === 'rounds' || q.only === 'gestures' ? q.only : null;
    const before = typeof q.before === 'string' && q.before ? q.before : '9999';
    const limit = Math.min(60, Math.max(5, Number(q.limit ?? 30) || 30));
    const onlyFav = q.favorites === '1';

    const rows = all<{ kind: string; id: string; at: string }>(
      `SELECT * FROM (
         SELECT 'round' AS kind, r.id AS id, COALESCE(r.revealed_at, (SELECT MIN(created_at) FROM answers WHERE round_id = r.id)) AS at
           FROM rounds r
          WHERE r.pair_id = ? AND r.kind != 'challenge' AND EXISTS (SELECT 1 FROM answers a WHERE a.round_id = r.id)
         UNION ALL
         SELECT 'gesture' AS kind, g.id AS id, g.created_at AS at FROM gestures g WHERE g.pair_id = ?
       ) WHERE at < ? ${onlyFav ? 'AND EXISTS (SELECT 1 FROM favorites f WHERE f.pair_id = ? AND f.ref_id = id)' : ''}
         ${only === 'rounds' ? "AND kind = 'round'" : only === 'gestures' ? "AND kind = 'gesture'" : ''}
       ORDER BY at DESC LIMIT ?`,
      ...(onlyFav ? [user.pair_id, user.pair_id, before, user.pair_id, limit + 1] : [user.pair_id, user.pair_id, before, limit + 1]),
    );
    const favs = all<{ user_id: string; ref_id: string }>('SELECT user_id, ref_id FROM favorites WHERE pair_id = ?', user.pair_id);
    const favMine = new Set(favs.filter((f) => f.user_id === user.id).map((f) => f.ref_id));
    const favPartner = new Set(favs.filter((f) => f.user_id !== user.id).map((f) => f.ref_id));

    const page = rows.slice(0, limit);
    const items: HistoryItem[] = [];
    for (const r of page) {
      if (r.kind === 'round') {
        const round = one<RoundRow>('SELECT * FROM rounds WHERE id = ?', r.id);
        if (!round) continue;
        items.push({ type: 'round', at: r.at, round: roundPublic(round, user, partner), favoriteMine: favMine.has(r.id), favoritePartner: favPartner.has(r.id) });
      } else {
        const g = one<GestureRow>('SELECT * FROM gestures WHERE id = ?', r.id);
        if (!g) continue;
        items.push({ type: 'gesture', at: r.at, gesture: gesturePublic(g), favoriteMine: favMine.has(r.id), favoritePartner: favPartner.has(r.id) });
      }
    }
    const res: HistoryResponse = { items, nextBefore: rows.length > limit ? page[page.length - 1].at : null };
    return res;
  });

  app.post('/api/favorites/toggle', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const body = (req.body ?? {}) as { kind?: unknown; refId?: unknown };
    const kind = body.kind === 'round' || body.kind === 'gesture' ? body.kind : null;
    const refId = typeof body.refId === 'string' ? body.refId : null;
    if (!kind || !refId) return reply.code(400).send({ error: 'ref' });
    const owned =
      kind === 'round'
        ? one('SELECT 1 FROM rounds WHERE id = ? AND pair_id = ?', refId, user.pair_id)
        : one('SELECT 1 FROM gestures WHERE id = ? AND pair_id = ?', refId, user.pair_id);
    if (!owned) return reply.code(404).send({ error: 'not_found' });
    const exists = one('SELECT 1 FROM favorites WHERE pair_id = ? AND user_id = ? AND kind = ? AND ref_id = ?', user.pair_id, user.id, kind, refId);
    if (exists) {
      run('DELETE FROM favorites WHERE pair_id = ? AND user_id = ? AND kind = ? AND ref_id = ?', user.pair_id, user.id, kind, refId);
    } else {
      run('INSERT INTO favorites (pair_id, user_id, kind, ref_id, created_at) VALUES (?, ?, ?, ?, ?)', user.pair_id, user.id, kind, refId, nowIso());
      logEvent('favorite_added', { pairId: user.pair_id, userId: user.id, meta: { kind } });
    }
    return { favorite: !exists };
  });

  // --- Вехи ---------------------------------------------------------------------

  app.post('/api/milestones/:key/seen', { preHandler: requireUser }, async (req) => {
    const user = req.user!;
    markCelebrationSeen(user.pair_id, user.id, (req.params as { key: string }).key);
    return { ok: true };
  });

  // --- «Не про нас» -------------------------------------------------------------

  /** Помечает вопрос раунда «не про нас». Если никто ещё не ответил — подменяет вопрос. */
  app.post('/api/rounds/:id/skip', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const partner = partnerOf(user);
    const pair = one<PairRow>('SELECT * FROM pairs WHERE id = ?', user.pair_id)!;
    const round = one<RoundRow>('SELECT * FROM rounds WHERE id = ? AND pair_id = ?', (req.params as { id: string }).id, user.pair_id);
    if (!round) return reply.code(404).send({ error: 'round_not_found' });
    run('INSERT OR IGNORE INTO question_marks (pair_id, user_id, question_id, created_at) VALUES (?, ?, ?, ?)', user.pair_id, user.id, round.question_id, nowIso());
    logEvent('question_marked', { pairId: user.pair_id, userId: user.id });
    const answered = one<{ n: number }>('SELECT COUNT(*) AS n FROM answers WHERE round_id = ?', round.id);
    if (Number(answered?.n ?? 0) > 0 || round.kind === 'challenge') {
      return { replaced: false, round: roundPublic(round, user, partner) };
    }
    const skips = one<{ n: number }>('SELECT COUNT(*) AS n FROM question_marks WHERE pair_id = ?', user.pair_id);
    const q = pickQuestion({
      pairId: pair.id,
      pairCreatedAt: pair.created_at,
      tz: pair.tz,
      date: round.date,
      kind: round.kind as 'daily' | 'bonus',
      seedSalt: `skip${skips?.n ?? 0}`,
      solo: !partner,
      theme: pair.week_theme,
      exclude: [round.question_id],
    });
    if (!q) return { replaced: false, round: roundPublic(round, user, partner) };
    run('UPDATE rounds SET question_id = ?, created_at = ? WHERE id = ?', q.id, nowIso(), round.id);
    const fresh = one<RoundRow>('SELECT * FROM rounds WHERE id = ?', round.id)!;
    sendTo(partner?.id, { type: 'round_replaced', roundId: round.id });
    return { replaced: true, round: roundPublic(fresh, user, partner) };
  });

  // --- Свои вопросы --------------------------------------------------------------

  app.get('/api/questions/custom', { preHandler: requireUser }, async (req) => {
    const user = req.user!;
    const rows = all<QuestionRow>('SELECT * FROM questions WHERE pair_id = ? ORDER BY created_at DESC', user.pair_id);
    const used = new Set(all<{ question_id: string }>('SELECT question_id FROM rounds WHERE pair_id = ?', user.pair_id).map((r) => r.question_id));
    return { questions: rows.map((q) => customQuestionPublic(q, used)) };
  });

  app.post('/api/questions', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const body = (req.body ?? {}) as { text?: unknown; a?: unknown; b?: unknown; layer?: unknown; topic?: unknown };
    const text = cleanText(body.text, 160);
    const a = cleanText(body.a, 60);
    const b = cleanText(body.b, 60);
    if (!text || !a || !b) return reply.code(400).send({ error: 'fields' });
    const layer = body.layer === 'us' || body.layer === 'deep' ? body.layer : 'light';
    const category = layer === 'light' ? 'whatif' : layer === 'us' ? 'joy' : 'values';
    const count = one<{ n: number }>('SELECT COUNT(*) AS n FROM questions WHERE pair_id = ?', user.pair_id);
    if (Number(count?.n ?? 0) >= 200) return reply.code(409).send({ error: 'limit' });
    const id = `c-${newId(10)}`;
    run(
      `INSERT INTO questions (id, pair_id, author_id, layer, category, format, text, a, b, why_chips, topic, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, 'ab', ?, ?, ?, NULL, ?, 1, ?)`,
      id,
      user.pair_id,
      user.id,
      layer,
      category,
      text,
      a,
      b,
      cleanText(body.topic, 200),
      nowIso(),
    );
    logEvent('custom_question_added', { pairId: user.pair_id, userId: user.id });
    const q = one<QuestionRow>('SELECT * FROM questions WHERE id = ?', id)!;
    sendTo(partnerOf(user)?.id, { type: 'pair_updated' });
    return customQuestionPublic(q, new Set());
  });

  app.delete('/api/questions/:id', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const id = (req.params as { id: string }).id;
    const q = one<QuestionRow>('SELECT * FROM questions WHERE id = ? AND pair_id = ?', id, user.pair_id);
    if (!q) return reply.code(404).send({ error: 'not_found' });
    const used = one('SELECT 1 FROM rounds WHERE question_id = ?', id);
    if (used) run('UPDATE questions SET is_active = 0 WHERE id = ?', id);
    else run('DELETE FROM questions WHERE id = ?', id);
    return { ok: true };
  });

  // --- Свои шаблоны жестов -----------------------------------------------------------

  app.post('/api/gesture-templates', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const body = (req.body ?? {}) as { type?: unknown; text?: unknown };
    const type = body.type as string;
    const text = cleanText(body.text, 120);
    if (!(type in GESTURE_LABELS) || !text) return reply.code(400).send({ error: 'fields' });
    const count = one<{ n: number }>('SELECT COUNT(*) AS n FROM gesture_templates WHERE pair_id = ?', user.pair_id);
    if (Number(count?.n ?? 0) >= 60) return reply.code(409).send({ error: 'limit' });
    const id = newId(10);
    run('INSERT INTO gesture_templates (id, pair_id, type, text, created_at) VALUES (?, ?, ?, ?, ?)', id, user.pair_id, type, text, nowIso());
    sendTo(partnerOf(user)?.id, { type: 'pair_updated' });
    return { templates: gestureTemplatesOf(user.pair_id) };
  });

  app.delete('/api/gesture-templates/:id', { preHandler: requireUser }, async (req) => {
    const user = req.user!;
    run('DELETE FROM gesture_templates WHERE id = ? AND pair_id = ?', (req.params as { id: string }).id, user.pair_id);
    sendTo(partnerOf(user)?.id, { type: 'pair_updated' });
    return { templates: gestureTemplatesOf(user.pair_id) };
  });

  // --- Тема недели -------------------------------------------------------------------

  app.put('/api/pair/theme', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const body = (req.body ?? {}) as { theme?: unknown };
    const theme = body.theme === null || body.theme === '' ? null : typeof body.theme === 'string' && body.theme in CATEGORY_LABELS ? body.theme : undefined;
    if (theme === undefined) return reply.code(400).send({ error: 'theme' });
    if (theme && !isCategoryUnlocked(theme, levelFor(scoreFor(user.pair_id).discoveries).level)) return reply.code(403).send({ error: 'level' });
    run('UPDATE pairs SET week_theme = ? WHERE id = ?', theme, user.pair_id);
    logEvent('theme_set', { pairId: user.pair_id, userId: user.id, meta: { theme } });
    sendTo(partnerOf(user)?.id, { type: 'pair_updated' });
    return deps.meResponse(user);
  });
}
