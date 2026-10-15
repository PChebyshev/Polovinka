import type { FastifyInstance } from 'fastify';
import type { CapsulePublic, MeResponse, RoundPublic } from '../../shared/src/types.js';
import { LEVEL_CAPSULE, LEVEL_REPEAT } from '../../shared/src/progress.js';
import { all, one, run, logEvent, type PairRow, type RoundRow, type UserRow } from './db.js';
import { newId, nowIso } from './ids.js';
import { requireUser } from './auth.js';
import { addDays, dateInTz } from './time.js';
import { levelFor } from './levels.js';
import { scoreFor } from './score.js';
import { topicsFor } from './progress.js';
import { partnerOf, roundPublic } from './serialize.js';
import { sendTo } from './sse.js';

const CAPSULE_DAYS = 30;
const LETTER_MAX = 600;

export const CAPSULE_PROMPTS = [
  'Что я хочу сказать тебе через месяц',
  'Предсказание: что изменится у нас за месяц',
  'За что я благодарен(а) тебе прямо сейчас',
  'Что мы обязательно сделаем вместе до открытия капсулы',
];

function pairLevel(pairId: string): number {
  return levelFor(scoreFor(pairId).discoveries).level;
}

function capsulePublic(row: { id: string; prompt: string; created_at: string; opens_at: string }): CapsulePublic {
  const opened = row.opens_at <= nowIso();
  const letters = all<{ user_id: string; text: string; created_at: string }>('SELECT * FROM capsule_letters WHERE capsule_id = ? ORDER BY created_at', row.id);
  return {
    id: row.id,
    prompt: row.prompt,
    createdAt: row.created_at,
    opensAt: row.opens_at,
    opened,
    wroteIds: letters.map((l) => l.user_id),
    letters: letters.map((l) => ({ userId: l.user_id, text: opened ? l.text : null, createdAt: l.created_at })),
  };
}

interface CapsuleRow {
  id: string;
  pair_id: string;
  prompt: string;
  created_by: string;
  created_at: string;
  opens_at: string;
  read_by: string;
}

/** Состояние капсул для главной: активная, непрочитанная открытая, можно ли создать новую. */
export function capsuleState(user: UserRow, level: number): MeResponse['capsule'] {
  const now = nowIso();
  const active = one<CapsuleRow>('SELECT * FROM capsules WHERE pair_id = ? AND opens_at > ? ORDER BY created_at DESC LIMIT 1', user.pair_id, now);
  const unread = all<CapsuleRow>('SELECT * FROM capsules WHERE pair_id = ? AND opens_at <= ? ORDER BY opens_at DESC', user.pair_id, now).find(
    (c) => !(JSON.parse(c.read_by) as string[]).includes(user.id),
  );
  return {
    active: active ? capsulePublic(active) : null,
    unreadOpened: unread ? capsulePublic(unread) : null,
    canCreate: level >= LEVEL_CAPSULE && !active,
  };
}

/** Старые вопросы для «Повтора»: раскрыты не меньше 30 дней назад и ещё не повторялись. */
function repeatCandidate(pairId: string, today: string): RoundRow | undefined {
  return one<RoundRow>(
    `SELECT r.* FROM rounds r JOIN questions q ON q.id = r.question_id
      WHERE r.pair_id = ? AND r.status = 'revealed' AND r.kind IN ('daily', 'bonus') AND r.date <= ?
        AND q.format IN ('ab', 'scale', 'who')
        AND NOT EXISTS (SELECT 1 FROM rounds x WHERE x.origin_round_id = r.id)
      ORDER BY r.date ASC LIMIT 1`,
    pairId,
    addDays(today, -30),
  );
}

export function repeatAvailable(pair: PairRow): boolean {
  if (pairLevel(pair.id) < LEVEL_REPEAT) return false;
  const today = dateInTz(pair.tz);
  if (one(`SELECT 1 FROM rounds WHERE pair_id = ? AND date = ? AND kind = 'repeat'`, pair.id, today)) return false;
  return !!repeatCandidate(pair.id, today);
}

export async function registerStage5Routes(app: FastifyInstance) {
  // --- Карта тем ---------------------------------------------------------------
  app.get('/api/topics', { preHandler: requireUser }, async (req) => {
    const user = req.user!;
    const level = pairLevel(user.pair_id);
    return { level, topics: topicsFor(user.pair_id, level) };
  });

  // --- «Повтор» ------------------------------------------------------------------
  app.post('/api/rounds/repeat', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const pair = one<PairRow>('SELECT * FROM pairs WHERE id = ?', user.pair_id)!;
    if (pairLevel(pair.id) < LEVEL_REPEAT) return reply.code(403).send({ error: 'level' });
    const today = dateInTz(pair.tz);
    const existing = one<RoundRow>(`SELECT * FROM rounds WHERE pair_id = ? AND date = ? AND kind = 'repeat'`, pair.id, today);
    const partner = partnerOf(user);
    if (existing) return roundPublic(existing, user, partner);
    const origin = repeatCandidate(pair.id, today);
    if (!origin) return reply.code(404).send({ error: 'nothing_to_repeat' });
    const id = newId();
    run(
      `INSERT INTO rounds (id, pair_id, question_id, date, kind, status, origin_round_id, created_at) VALUES (?, ?, ?, ?, 'repeat', 'open', ?, ?)`,
      id,
      pair.id,
      origin.question_id,
      today,
      origin.id,
      nowIso(),
    );
    logEvent('repeat_started', { pairId: pair.id, userId: user.id });
    sendTo(partner?.id, { type: 'bonus_added', roundId: id });
    const r: RoundPublic = roundPublic(one<RoundRow>('SELECT * FROM rounds WHERE id = ?', id)!, user, partner);
    return r;
  });

  // --- Капсула времени ---------------------------------------------------------------
  app.get('/api/capsules', { preHandler: requireUser }, async (req) => {
    const user = req.user!;
    const rows = all<CapsuleRow>('SELECT * FROM capsules WHERE pair_id = ? ORDER BY created_at DESC', user.pair_id);
    return { prompts: CAPSULE_PROMPTS, capsules: rows.map(capsulePublic), level: pairLevel(user.pair_id), days: CAPSULE_DAYS };
  });

  app.post('/api/capsules', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    if (pairLevel(user.pair_id) < LEVEL_CAPSULE) return reply.code(403).send({ error: 'level' });
    if (one('SELECT 1 FROM capsules WHERE pair_id = ? AND opens_at > ?', user.pair_id, nowIso())) return reply.code(409).send({ error: 'active_exists' });
    const raw = ((req.body ?? {}) as { prompt?: unknown }).prompt;
    const prompt = typeof raw === 'string' && raw.trim() ? raw.replace(/\s+/g, ' ').trim().slice(0, 120) : CAPSULE_PROMPTS[0];
    const id = newId();
    const opens = new Date(Date.now() + CAPSULE_DAYS * 86_400_000).toISOString();
    run('INSERT INTO capsules (id, pair_id, prompt, created_by, created_at, opens_at) VALUES (?, ?, ?, ?, ?, ?)', id, user.pair_id, prompt, user.id, nowIso(), opens);
    logEvent('capsule_created', { pairId: user.pair_id, userId: user.id });
    sendTo(partnerOf(user)?.id, { type: 'pair_updated' });
    return capsulePublic(one<CapsuleRow>('SELECT * FROM capsules WHERE id = ?', id)!);
  });

  app.post('/api/capsules/:id/letter', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const c = one<CapsuleRow>('SELECT * FROM capsules WHERE id = ? AND pair_id = ?', (req.params as { id: string }).id, user.pair_id);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    if (c.opens_at <= nowIso()) return reply.code(409).send({ error: 'already_opened' });
    const raw = ((req.body ?? {}) as { text?: unknown }).text;
    const text = typeof raw === 'string' ? raw.trim().slice(0, LETTER_MAX) : '';
    if (!text) return reply.code(400).send({ error: 'text' });
    run(
      `INSERT INTO capsule_letters (capsule_id, user_id, text, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(capsule_id, user_id) DO UPDATE SET text = excluded.text, created_at = excluded.created_at`,
      c.id,
      user.id,
      text,
      nowIso(),
    );
    logEvent('capsule_letter', { pairId: user.pair_id, userId: user.id });
    sendTo(partnerOf(user)?.id, { type: 'pair_updated' });
    return capsulePublic(c);
  });

  app.post('/api/capsules/:id/read', { preHandler: requireUser }, async (req) => {
    const user = req.user!;
    const c = one<CapsuleRow>('SELECT * FROM capsules WHERE id = ? AND pair_id = ?', (req.params as { id: string }).id, user.pair_id);
    if (c && c.opens_at <= nowIso()) {
      const read = JSON.parse(c.read_by) as string[];
      if (!read.includes(user.id)) run('UPDATE capsules SET read_by = ? WHERE id = ?', JSON.stringify([...read, user.id]), c.id);
    }
    return { ok: true };
  });
}
