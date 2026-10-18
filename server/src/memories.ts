import type { FastifyInstance } from 'fastify';
import type { BookEntry, BookResponse, MemoryCard } from '../../shared/src/types.js';
import { LEVEL_BOOK } from '../../shared/src/progress.js';
import { all, one, type GestureRow, type PairRow, type RoundRow, type UserRow } from './db.js';
import { requireUser } from './auth.js';
import { addDays, dateInTz } from './time.js';
import { counters, gesturePublic, partnerOf, roundPublic } from './serialize.js';
import { celebrationFor } from './levels.js';
import { capsulePublic } from './routes5.js';
import { doneIdeas } from './ideas.js';

/**
 * Накопленная история пары: «В этот день», «Книга пары» и выгрузка.
 * Выгрузка доступна всем: держим ценностью, а не заложниками.
 */

const MEMORY_STEPS = [365, 182, 30];

function pairOfUser(user: UserRow): PairRow {
  return one<PairRow>('SELECT * FROM pairs WHERE id = ?', user.pair_id)!;
}

/** Вопрос, на который пара ответила ровно год, полгода или месяц назад. */
export function memoryFor(user: UserRow): MemoryCard | null {
  const pair = pairOfUser(user);
  const today = dateInTz(pair.tz);
  const partner = partnerOf(user);
  if (!partner) return null;
  for (const days of MEMORY_STEPS) {
    const r = one<RoundRow>(
      `SELECT * FROM rounds WHERE pair_id = ? AND date = ? AND status = 'revealed' AND kind = 'daily' ORDER BY created_at LIMIT 1`,
      pair.id,
      addDays(today, -days),
    );
    if (r) return { daysAgo: days, round: roundPublic(r, user, partner) };
  }
  return null;
}

interface CapsuleRow {
  id: string;
  prompt: string;
  created_at: string;
  opens_at: string;
}

function collectHistory(user: UserRow): BookEntry[] {
  const partner = partnerOf(user);
  const rounds = all<RoundRow>(`SELECT * FROM rounds WHERE pair_id = ? AND status = 'revealed' ORDER BY revealed_at`, user.pair_id);
  const gestures = all<GestureRow>('SELECT * FROM gestures WHERE pair_id = ? ORDER BY created_at', user.pair_id);
  const capsules = all<CapsuleRow>('SELECT * FROM capsules WHERE pair_id = ? AND opens_at <= ? ORDER BY opens_at', user.pair_id, new Date().toISOString());
  const milestones = all<{ key: string; reached_at: string }>('SELECT key, reached_at FROM milestones WHERE pair_id = ? ORDER BY reached_at', user.pair_id);
  const entries: BookEntry[] = [
    ...rounds.map((r) => ({ type: 'round' as const, at: r.revealed_at ?? r.created_at, round: roundPublic(r, user, partner) })),
    ...gestures.map((g) => ({ type: 'gesture' as const, at: g.created_at, gesture: gesturePublic(g) })),
    ...capsules.map((c) => ({ type: 'capsule' as const, at: c.opens_at, capsule: capsulePublic(c) })),
    ...milestones
      .filter((m) => /^(l\d+|s\d+|b:)/.test(m.key))
      .map((m) => ({ type: 'milestone' as const, at: m.reached_at, key: m.key, title: celebrationFor(m.key).title })),
    ...doneIdeas(user.pair_id).map((i) => ({ type: 'idea' as const, at: i.doneAt!, idea: i })),
  ];
  // Ответы «других пар» в книге и выгрузке не нужны
  for (const e of entries) if (e.type === 'round') e.round.crowd = null;
  return entries.sort((a, b) => a.at.localeCompare(b.at));
}

function namesOf(pairId: string): string[] {
  return all<UserRow>('SELECT * FROM users WHERE pair_id = ? ORDER BY created_at', pairId).map((u) => u.name);
}

export async function registerMemoryRoutes(app: FastifyInstance) {
  app.get('/api/memory', { preHandler: requireUser }, async (req) => ({ memory: memoryFor(req.user!) }));

  app.get('/api/book', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const c = counters(user.pair_id);
    if (c.level < LEVEL_BOOK) return reply.code(403).send({ error: 'level', need: LEVEL_BOOK });
    const pair = pairOfUser(user);
    const res: BookResponse = { names: namesOf(pair.id), since: pair.created_at, counters: c, entries: collectHistory(user) };
    return res;
  });

  /** Выгрузка всей истории пары одним файлом. Только то, что пара и так видит в приложении. */
  app.get('/api/export', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const pair = pairOfUser(user);
    const body = {
      app: 'Половинка',
      exportedAt: new Date().toISOString(),
      me: { name: user.name, email: user.email ?? null },
      pair: { names: namesOf(pair.id), since: pair.created_at },
      counters: counters(pair.id),
      history: collectHistory(user),
    };
    const date = dateInTz(pair.tz);
    reply.header('Content-Disposition', `attachment; filename="polovinka-${date}.json"`);
    reply.type('application/json; charset=utf-8');
    return JSON.stringify(body, null, 2);
  });
}
