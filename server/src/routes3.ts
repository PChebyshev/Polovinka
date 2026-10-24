import type { FastifyInstance } from 'fastify';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ChallengeCompare,
  ChallengeInfo,
  ChallengeQuestionCompare,
  MeResponse,
  MyChallenge,
  WeekPublic,
  WeekResponse,
  WeekStats,
} from '../../shared/src/types.js';
import { all, one, run, transaction, logEvent, type AnswerRow, type PairRow, type QuestionRow, type RoundRow, type UserRow } from './db.js';
import { newCode, newId, nowIso } from './ids.js';
import { requireUser, userByToken, readToken } from './auth.js';
import { publicBase } from './hosts.js';
import { addDays, dateInTz, weekdayInTz } from './time.js';
import { pickQuestion } from './selection.js';
import { partnerOf, roundPublic } from './serialize.js';
import { sendTo } from './sse.js';
import { scoreFor, percent } from './score.js';

const CHALLENGE_SIZE = 5;

interface Deps {
  meResponse: (u: UserRow) => MeResponse;
  dataDir: string;
}

function pairNames(pairId: string): [string, string | null] {
  const m = all<UserRow>('SELECT * FROM users WHERE pair_id = ? ORDER BY created_at', pairId);
  return [m[0]?.name ?? 'Пара', m[1]?.name ?? null];
}

export function weekBounds(tz: string, offset = 0): { start: string; end: string } {
  const today = dateInTz(tz);
  const wd = weekdayInTz(tz);
  const monday = addDays(today, -((wd + 6) % 7) - offset * 7);
  return { start: monday, end: addDays(monday, 6) };
}

export function weekStats(pairId: string, start: string, end: string): WeekStats {
  const score = scoreFor(pairId, start, end);
  const both = one<{ n: number }>(
    `SELECT COUNT(DISTINCT r.date) AS n FROM rounds r
      WHERE r.pair_id = ? AND r.kind != 'challenge' AND r.date BETWEEN ? AND ?
        AND (SELECT COUNT(*) FROM answers a WHERE a.round_id = r.id) >= 2`,
    pairId,
    start,
    end,
  );
  const gestures = one<{ n: number }>(`SELECT COUNT(*) AS n FROM gestures WHERE pair_id = ? AND substr(created_at, 1, 10) BETWEEN ? AND ?`, pairId, start, end);
  return {
    weekStart: start,
    weekEnd: end,
    discoveries: score.discoveries,
    matches: score.matches,
    matchPercent: percent(score.guessesRight, score.guessesTotal),
    guessesRight: score.guessesRight,
    guessesTotal: score.guessesTotal,
    daysBoth: Number(both?.n ?? 0),
    gestures: Number(gestures?.n ?? 0),
  };
}

function cardPath(dataDir: string, code: string): string {
  return join(dataDir, 'cards', `${code}.png`);
}

/** Создаёт раунды вызова для пары, если их ещё нет. */
function ensureChallengeRounds(pairId: string, challengeId: string, questionIds: string[], tz: string) {
  const date = dateInTz(tz);
  for (const qid of questionIds) {
    const exists = one('SELECT 1 FROM rounds WHERE pair_id = ? AND challenge_id = ? AND question_id = ?', pairId, challengeId, qid);
    if (exists) continue;
    run(
      `INSERT INTO rounds (id, pair_id, question_id, date, kind, challenge_id, status, created_at) VALUES (?, ?, ?, ?, 'challenge', ?, 'open', ?)`,
      newId(),
      pairId,
      qid,
      date,
      challengeId,
      nowIso(),
    );
  }
}

/** Ответы пары на вопрос: из любого раскрытого раунда с этим вопросом. */
function pairChoices(pairId: string, questionId: string): [string, string] | null {
  const r = one<RoundRow>(
    `SELECT r.* FROM rounds r WHERE r.pair_id = ? AND r.question_id = ? AND r.status = 'revealed' ORDER BY r.revealed_at LIMIT 1`,
    pairId,
    questionId,
  );
  if (!r) return null;
  const a = all<AnswerRow>('SELECT a.* FROM answers a JOIN users u ON u.id = a.user_id WHERE a.round_id = ? ORDER BY u.created_at', r.id);
  if (a.length < 2) return null;
  return [a[0].choice, a[1].choice];
}

interface ChallengeRow {
  id: string;
  code: string;
  from_pair_id: string;
  question_ids: string;
  created_at: string;
  opened_count: number;
}

function challengeByCode(code: string): ChallengeRow | undefined {
  return one<ChallengeRow>('SELECT * FROM challenges WHERE code = ?', code.toLowerCase());
}

function otherPairOf(ch: ChallengeRow, myPairId: string): string | null {
  if (ch.from_pair_id === myPairId) {
    return one<{ pair_id: string }>('SELECT pair_id FROM challenge_pairs WHERE challenge_id = ? ORDER BY created_at LIMIT 1', ch.id)?.pair_id ?? null;
  }
  return ch.from_pair_id;
}

function isParticipant(ch: ChallengeRow, pairId: string): boolean {
  return ch.from_pair_id === pairId || !!one('SELECT 1 FROM challenge_pairs WHERE challenge_id = ? AND pair_id = ?', ch.id, pairId);
}

export function compareChallenge(ch: ChallengeRow, user: UserRow): ChallengeCompare {
  const partner = partnerOf(user);
  const qids = JSON.parse(ch.question_ids) as string[];
  const otherPair = otherPairOf(ch, user.pair_id);
  const myRounds = all<RoundRow>('SELECT * FROM rounds WHERE pair_id = ? AND challenge_id = ? ORDER BY created_at', user.pair_id, ch.id);
  const questions: ChallengeQuestionCompare[] = qids.map((qid) => {
    const q = one<QuestionRow>('SELECT * FROM questions WHERE id = ?', qid)!;
    const mine = pairChoices(user.pair_id, qid);
    const theirs = otherPair ? pairChoices(otherPair, qid) : null;
    const mineMatch = mine ? mine[0] === mine[1] : null;
    const theirsMatch = theirs ? theirs[0] === theirs[1] : null;
    const allSame = mine && theirs ? mine[0] === mine[1] && theirs[0] === theirs[1] && mine[0] === theirs[0] : null;
    return { questionId: qid, text: q.text, a: q.a, b: q.b, mine, theirs, mineMatch, theirsMatch, allSame };
  });
  const myDone = questions.every((q) => q.mine !== null);
  const theirsDone = !!otherPair && questions.every((q) => q.theirs !== null);
  return {
    code: ch.code,
    myPairNames: pairNames(user.pair_id),
    otherPairNames: otherPair ? pairNames(otherPair) : null,
    isSender: ch.from_pair_id === user.pair_id,
    rounds: myRounds.filter((r) => r.status !== 'revealed').map((r) => roundPublic(r, user, partner)),
    questions,
    myDone,
    theirsDone,
    bothSame: questions.filter((q) => q.allSame).length,
  };
}

export function notifyChallenge(ch: ChallengeRow) {
  const pairs = [ch.from_pair_id, ...all<{ pair_id: string }>('SELECT pair_id FROM challenge_pairs WHERE challenge_id = ?', ch.id).map((r) => r.pair_id)];
  for (const pid of pairs) {
    for (const u of all<UserRow>('SELECT * FROM users WHERE pair_id = ?', pid)) sendTo(u.id, { type: 'challenge_update', code: ch.code });
  }
}

export function challengeOfRound(round: RoundRow): ChallengeRow | undefined {
  return round.challenge_id ? one<ChallengeRow>('SELECT * FROM challenges WHERE id = ?', round.challenge_id) : undefined;
}

/** Принять вызов существующей парой (или гостевой при создании аккаунта). */
export function joinChallenge(ch: ChallengeRow, pair: PairRow) {
  if (ch.from_pair_id === pair.id) return;
  const already = one('SELECT 1 FROM challenge_pairs WHERE challenge_id = ? AND pair_id = ?', ch.id, pair.id);
  if (!already) {
    run('INSERT INTO challenge_pairs (challenge_id, pair_id, created_at) VALUES (?, ?, ?)', ch.id, pair.id, nowIso());
    logEvent('challenge_pair_created', { pairId: pair.id, meta: { code: ch.code, fromPair: ch.from_pair_id } });
  }
  ensureChallengeRounds(pair.id, ch.id, JSON.parse(ch.question_ids) as string[], pair.tz);
}

const CHALLENGE_SHOW_DAYS = 14;

export function myChallenges(user: UserRow): MyChallenge[] {
  // На главной — только за последние 14 дней и не скрытые парой
  const since = new Date(Date.now() - CHALLENGE_SHOW_DAYS * 86_400_000).toISOString();
  const notHidden = 'NOT EXISTS (SELECT 1 FROM challenge_hidden h WHERE h.pair_id = ? AND h.challenge_id = c.id)';
  const sent = all<ChallengeRow>(
    `SELECT c.* FROM challenges c WHERE c.from_pair_id = ? AND c.created_at >= ? AND ${notHidden} ORDER BY c.created_at DESC LIMIT 5`,
    user.pair_id,
    since,
    user.pair_id,
  );
  const received = all<ChallengeRow>(
    `SELECT c.* FROM challenges c JOIN challenge_pairs p ON p.challenge_id = c.id WHERE p.pair_id = ? AND p.created_at >= ? AND ${notHidden} ORDER BY p.created_at DESC LIMIT 5`,
    user.pair_id,
    since,
    user.pair_id,
  );
  const out: MyChallenge[] = [];
  for (const ch of [...received, ...sent]) {
    const qids = JSON.parse(ch.question_ids) as string[];
    const answered = qids.filter((q) => pairChoices(user.pair_id, q) !== null).length;
    const other = otherPairOf(ch, user.pair_id);
    out.push({
      code: ch.code,
      isSender: ch.from_pair_id === user.pair_id,
      fromNames: pairNames(ch.from_pair_id),
      answered,
      total: qids.length,
      otherJoined: !!other,
    });
  }
  return out;
}

export async function registerStage3Routes(app: FastifyInstance, deps: Deps) {
  mkdirSync(join(deps.dataDir, 'cards'), { recursive: true });
  app.addContentTypeParser('image/png', { parseAs: 'buffer', bodyLimit: 3 * 1024 * 1024 }, (_req, body, done) => done(null, body));

  /** Скрыть вызов с главной — для обоих в паре. Страница вызова по ссылке остаётся. */
  app.post('/api/challenges/:code/hide', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const ch = one<ChallengeRow>('SELECT * FROM challenges WHERE code = ?', String((req.params as { code: string }).code).toLowerCase());
    if (!ch) return reply.code(404).send({ error: 'not_found' });
    run('INSERT OR IGNORE INTO challenge_hidden (pair_id, challenge_id, created_at) VALUES (?, ?, ?)', user.pair_id, ch.id, nowIso());
    sendTo(partnerOf(user)?.id, { type: 'pair_updated' });
    return deps.meResponse(one<UserRow>('SELECT * FROM users WHERE id = ?', user.id)!);
  });

  // --- Итог недели --------------------------------------------------------------

  app.get('/api/week', { preHandler: requireUser }, async (req) => {
    const user = req.user!;
    const pair = one<PairRow>('SELECT * FROM pairs WHERE id = ?', user.pair_id)!;
    const offset = (req.query as { offset?: string }).offset === '1' ? 1 : 0;
    const { start, end } = weekBounds(pair.tz, offset);
    const stats = weekStats(pair.id, start, end);
    let row = one<{ code: string; png_path: string | null }>('SELECT code, png_path FROM weekly_cards WHERE pair_id = ? AND week_start = ?', pair.id, start);
    if (!row) {
      run(
        'INSERT INTO weekly_cards (id, code, pair_id, week_start, stats, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        newId(),
        newCode(),
        pair.id,
        start,
        JSON.stringify(stats),
        nowIso(),
      );
      row = one<{ code: string; png_path: string | null }>('SELECT code, png_path FROM weekly_cards WHERE pair_id = ? AND week_start = ?', pair.id, start)!;
    } else {
      run('UPDATE weekly_cards SET stats = ? WHERE pair_id = ? AND week_start = ?', JSON.stringify(stats), pair.id, start);
    }
    const res: WeekResponse = {
      code: row.code,
      names: pairNames(pair.id),
      stats,
      isCurrent: offset === 0,
      hasImage: !!row.png_path && existsSync(row.png_path),
    };
    return res;
  });

  app.post('/api/week/:code/image', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const code = (req.params as { code: string }).code;
    const row = one<{ id: string }>('SELECT id FROM weekly_cards WHERE code = ? AND pair_id = ?', code, user.pair_id);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length < 100) return reply.code(400).send({ error: 'png' });
    const path = cardPath(deps.dataDir, code);
    writeFileSync(path, body);
    run('UPDATE weekly_cards SET png_path = ? WHERE id = ?', path, row.id);
    return { ok: true };
  });

  app.post('/api/week/:code/shared', { preHandler: requireUser }, async (req) => {
    const user = req.user!;
    logEvent('weekly_shared', { pairId: user.pair_id, userId: user.id, meta: { via: ((req.body ?? {}) as { via?: string }).via ?? 'unknown' } });
    return { ok: true };
  });

  app.get('/api/week/:code/image.png', async (req, reply) => {
    const path = cardPath(deps.dataDir, (req.params as { code: string }).code.replace(/[^a-z0-9]/g, ''));
    if (!existsSync(path)) return reply.code(404).send({ error: 'not_found' });
    return reply.type('image/png').header('Cache-Control', 'public, max-age=3600').send(readFileSync(path));
  });

  /** Публичная карточка недели: только цифры, без ответов. */
  app.get('/api/week/public/:code', async (req, reply) => {
    const row = one<{ pair_id: string; stats: string; png_path: string | null }>(
      'SELECT pair_id, stats, png_path FROM weekly_cards WHERE code = ?',
      (req.params as { code: string }).code,
    );
    if (!row) return reply.code(404).send({ error: 'not_found' });
    logEvent('weekly_opened', { pairId: row.pair_id });
    const res: WeekPublic = { names: pairNames(row.pair_id), stats: JSON.parse(row.stats) as WeekStats, hasImage: !!row.png_path && existsSync(row.png_path) };
    return res;
  });

  // --- Вызов паре -----------------------------------------------------------------

  app.post('/api/challenges', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const pair = one<PairRow>('SELECT * FROM pairs WHERE id = ?', user.pair_id)!;
    if (pair.is_guest) return reply.code(409).send({ error: 'guest_pair' });
    // Сначала уже раскрытые вопросы пары, затем новые — для них создаём раунды вызова.
    const revealed = all<{ question_id: string }>(
      `SELECT r.question_id FROM rounds r JOIN questions q ON q.id = r.question_id
        WHERE r.pair_id = ? AND r.status = 'revealed' AND q.format = 'ab' AND q.pair_id IS NULL AND q.layer != 'deep'
        ORDER BY r.revealed_at DESC LIMIT ?`,
      pair.id,
      CHALLENGE_SIZE,
    ).map((r) => r.question_id);
    const qids = [...revealed];
    let salt = 0;
    while (qids.length < CHALLENGE_SIZE && salt < 20) {
      const q = pickQuestion({
        pairId: pair.id,
        pairCreatedAt: pair.created_at,
        tz: pair.tz,
        date: dateInTz(pair.tz),
        kind: 'bonus',
        seedSalt: `challenge${salt++}`,
        allowFormats: ['ab'],
        exclude: qids,
      });
      if (!q) break;
      if (q.layer === 'deep' || q.pair_id) continue;
      qids.push(q.id);
    }
    if (qids.length < CHALLENGE_SIZE) return reply.code(503).send({ error: 'no_questions_left' });
    const id = newId();
    const code = newCode();
    transaction(() => {
      run(
        'INSERT INTO challenges (id, code, from_pair_id, question_ids, created_at) VALUES (?, ?, ?, ?, ?)',
        id,
        code,
        pair.id,
        JSON.stringify(qids),
        nowIso(),
      );
      ensureChallengeRounds(
        pair.id,
        id,
        qids.filter((q) => !revealed.includes(q)),
        pair.tz,
      );
    });
    logEvent('challenge_sent', { pairId: pair.id, userId: user.id, meta: { code } });
    const base = publicBase(req);
    const names = pairNames(pair.id);
    const title = names[1] ? `${names[0]} и ${names[1]}` : names[0];
    return {
      code,
      url: `${base}/c/${code}`,
      text: `${title} бросают вам вызов в Половинке: пройдите те же 5 вопросов, а потом сравним, где совпали. Без победителей, только открытия: ${base}/c/${code}`,
      compare: compareChallenge(challengeByCode(code)!, user),
    };
  });

  app.get('/api/challenges/mine', { preHandler: requireUser }, async (req) => ({ challenges: myChallenges(req.user!) }));

  app.get('/api/challenges/:code', async (req, reply) => {
    const ch = challengeByCode((req.params as { code: string }).code);
    if (!ch) return reply.code(404).send({ error: 'not_found' });
    const viewer = userByToken(readToken(req));
    const participant = !!viewer && isParticipant(ch, viewer.pair_id);
    const peek = (req.query as { peek?: string }).peek === '1';
    if (!participant && !peek) {
      run('UPDATE challenges SET opened_count = opened_count + 1 WHERE id = ?', ch.id);
      logEvent('challenge_opened', { pairId: viewer?.pair_id ?? null, userId: viewer?.id ?? null, meta: { code: ch.code } });
    }
    const res: ChallengeInfo = {
      code: ch.code,
      fromNames: pairNames(ch.from_pair_id),
      questionsCount: (JSON.parse(ch.question_ids) as string[]).length,
      participant,
      isSender: !!viewer && ch.from_pair_id === viewer.pair_id,
    };
    return res;
  });

  app.post('/api/challenges/:code/join', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const ch = challengeByCode((req.params as { code: string }).code);
    if (!ch) return reply.code(404).send({ error: 'not_found' });
    const pair = one<PairRow>('SELECT * FROM pairs WHERE id = ?', user.pair_id)!;
    if (ch.from_pair_id === pair.id) return compareChallenge(ch, user);
    const taken = one<{ n: number }>('SELECT COUNT(*) AS n FROM challenge_pairs WHERE challenge_id = ?', ch.id);
    const mine = one('SELECT 1 FROM challenge_pairs WHERE challenge_id = ? AND pair_id = ?', ch.id, pair.id);
    if (!mine && Number(taken?.n ?? 0) >= 1) return reply.code(409).send({ error: 'challenge_taken' });
    joinChallenge(ch, pair);
    notifyChallenge(ch);
    return compareChallenge(ch, user);
  });

  app.get('/api/challenges/:code/compare', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const ch = challengeByCode((req.params as { code: string }).code);
    if (!ch) return reply.code(404).send({ error: 'not_found' });
    if (!isParticipant(ch, user.pair_id)) return reply.code(403).send({ error: 'not_participant' });
    return compareChallenge(ch, user);
  });

  /** Гостевая пара становится постоянной: включается вопрос дня. */
  app.post('/api/pair/convert', { preHandler: requireUser }, async (req) => {
    const user = req.user!;
    const pair = one<PairRow>('SELECT * FROM pairs WHERE id = ?', user.pair_id)!;
    if (pair.is_guest) {
      run('UPDATE pairs SET is_guest = 0, created_at = ? WHERE id = ?', nowIso(), pair.id);
      logEvent('challenge_converted', { pairId: pair.id, userId: user.id });
      sendTo(partnerOf(user)?.id, { type: 'pair_updated' });
    }
    return deps.meResponse(one<UserRow>('SELECT * FROM users WHERE id = ?', user.id)!);
  });
}
