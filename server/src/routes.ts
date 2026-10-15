import type { FastifyInstance } from 'fastify';
import type { MeResponse, TodayResponse, GestureType } from '../../shared/src/types.js';
import { GESTURE_LABELS } from '../../shared/src/types.js';
import { all, one, run, transaction, logEvent, type AnswerRow, type GestureRow, type PairRow, type RoundRow, type UserRow } from './db.js';
import { hashToken, newCode, newId, newToken, nowIso } from './ids.js';
import { requireUser, userByToken, readToken } from './auth.js';
import { dateInTz, isValidTz } from './time.js';
import { pickQuestion, ensureDaily } from './selection.js';
import { counters, gesturePublic, pairPublic, partnerOf, roundPublic, userPublic } from './serialize.js';
import { addClient, sendTo } from './sse.js';
import { checkMilestones, checkCapsules, badgesCount, levelFor, unseenCelebrations } from './levels.js';
import { registerStage5Routes, capsuleState, repeatAvailable } from './routes5.js';
import { streakFor } from './progress.js';
import { LEVEL_HUG } from '../../shared/src/progress.js';
import { registerStage2Routes, gestureTemplatesOf } from './routes2.js';
import { registerStage3Routes, joinChallenge, challengeOfRound, notifyChallenge, myChallenges } from './routes3.js';
import { registerStage4Routes } from './routes4.js';
import { pushReveal, pushPartnerAnswered } from './push.js';
import { guessHit } from './score.js';

const MAX_BONUS_PER_DAY = 3;
const NAME_MAX = 24;
const TEXT_MAX = 200;

function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/\s+/g, ' ').trim();
  if (s.length < 1 || s.length > NAME_MAX) return null;
  return s;
}

function cleanText(raw: unknown, max = TEXT_MAX): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/\s+/g, ' ').trim();
  if (s.length === 0) return null;
  return s.slice(0, max);
}

function pairOf(user: UserRow): PairRow {
  return one<PairRow>('SELECT * FROM pairs WHERE id = ?', user.pair_id)!;
}

function publicBase(req: { headers: Record<string, string | string[] | undefined>; protocol: string }): string {
  const env = process.env.PUBLIC_URL;
  if (env) return env.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? req.protocol;
  const host = (req.headers['x-forwarded-host'] as string | undefined) ?? (req.headers.host as string | undefined) ?? 'localhost';
  return `${proto}://${host}`;
}

function createSoloPair(tz: string, guest = false): PairRow {
  const id = newId();
  const ts = nowIso();
  run('INSERT INTO pairs (id, invite_code, tz, is_guest, created_at) VALUES (?, ?, ?, ?, ?)', id, newCode(), tz, guest ? 1 : 0, ts);
  return one<PairRow>('SELECT * FROM pairs WHERE id = ?', id)!;
}

function challengeByCodeRow(code: string) {
  return one<{ id: string; code: string; from_pair_id: string; question_ids: string; created_at: string; opened_count: number }>('SELECT * FROM challenges WHERE code = ?', code.trim().toLowerCase());
}

function meResponse(user: UserRow): MeResponse {
  const pair = pairOf(user);
  const partner = partnerOf(user);
  const unseen = all<GestureRow>('SELECT * FROM gestures WHERE to_user_id = ? AND seen_at IS NULL ORDER BY created_at DESC LIMIT 10', user.id);
  const c = counters(pair.id);
  checkCapsules(pair.id);
  return {
    user: userPublic(user),
    pair: pairPublic(pair),
    partner: partner ? userPublic(partner) : null,
    counters: c,
    inviteCode: pair.invite_code,
    unseenGestures: unseen.map(gesturePublic),
    celebrations: unseenCelebrations(pair.id, user.id),
    weekTheme: pair.week_theme,
    gestureTemplates: gestureTemplatesOf(pair.id),
    challenges: myChallenges(user),
    streak: streakFor(pair),
    badges: badgesCount(pair.id),
    capsule: capsuleState(user, levelFor(c.discoveries).level),
  };
}

/** Проверка и нормализация ответа по формату вопроса. Для «кто из нас» храним id человека. */
function normalizeChoice(raw: unknown, format: string, me: UserRow, partner: UserRow | undefined): string | null {
  if (typeof raw !== 'string') return null;
  if (format === 'scale') return /^[1-5]$/.test(raw) ? raw : null;
  if (raw !== 'a' && raw !== 'b') return null;
  if (format === 'who') return raw === 'a' ? me.id : partner?.id ?? null;
  return raw;
}

export async function registerRoutes(app: FastifyInstance, opts: { dataDir: string }) {
  app.get('/api/health', async () => ({ ok: true }));

  // --- Аккаунт -------------------------------------------------------------

  app.post('/api/users', async (req, reply) => {
    const body = (req.body ?? {}) as { name?: unknown; tz?: unknown; joinCode?: unknown; challengeCode?: unknown };
    const name = cleanName(body.name);
    if (!name) return reply.code(400).send({ error: 'name' });
    const tz = isValidTz(body.tz) ? body.tz : 'Europe/Moscow';
    const token = newToken();
    const id = newId();
    const ts = nowIso();

    let pair: PairRow | undefined;
    let joined = false;
    if (typeof body.joinCode === 'string' && body.joinCode) {
      const target = one<PairRow>('SELECT * FROM pairs WHERE invite_code = ? AND deleted_at IS NULL', body.joinCode.trim().toLowerCase());
      if (!target) return reply.code(404).send({ error: 'invite_not_found' });
      const members = one<{ n: number }>('SELECT COUNT(*) AS n FROM users WHERE pair_id = ?', target.id);
      if (Number(members?.n ?? 0) >= 2) return reply.code(409).send({ error: 'pair_full' });
      pair = target;
      joined = true;
    }
    let challenge: ReturnType<typeof challengeByCodeRow> | undefined;
    if (!pair && typeof body.challengeCode === 'string' && body.challengeCode) {
      challenge = challengeByCodeRow(body.challengeCode);
      if (!challenge) return reply.code(404).send({ error: 'not_found' });
      pair = createSoloPair(tz, true);
    }
    if (!pair) pair = createSoloPair(tz);

    run(
      'INSERT INTO users (id, name, token_hash, pair_id, tz, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      name,
      hashToken(token),
      pair.id,
      tz,
      ts,
    );
    logEvent('user_created', { pairId: pair.id, userId: id, meta: { joined } });
    const user = one<UserRow>('SELECT * FROM users WHERE id = ?', id)!;
    if (challenge) {
      joinChallenge(challenge, pair);
      notifyChallenge(challenge);
    }
    if (joined) {
      logEvent('invite_accepted', { pairId: pair.id, userId: id });
      const partner = partnerOf(user);
      sendTo(partner?.id, { type: 'pair_joined', partnerName: name });
    }
    return { token, me: meResponse(user) };
  });

  app.get('/api/me', { preHandler: requireUser }, async (req) => meResponse(req.user!));

  await registerStage2Routes(app, { meResponse });
  await registerStage3Routes(app, { meResponse, dataDir: opts.dataDir });
  await registerStage4Routes(app, { meResponse });
  await registerStage5Routes(app);

  app.put('/api/me', { preHandler: requireUser }, async (req, reply) => {
    const body = (req.body ?? {}) as { name?: unknown; tz?: unknown; notifMorning?: unknown; notifEvening?: unknown; notifEnabled?: unknown };
    const user = req.user!;
    if (body.name !== undefined) {
      const name = cleanName(body.name);
      if (!name) return reply.code(400).send({ error: 'name' });
      run('UPDATE users SET name = ? WHERE id = ?', name, user.id);
    }
    if (isValidTz(body.tz)) run('UPDATE users SET tz = ? WHERE id = ?', body.tz, user.id);
    const time = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (typeof body.notifMorning === 'string' && time.test(body.notifMorning)) run('UPDATE users SET notif_morning = ? WHERE id = ?', body.notifMorning, user.id);
    if (typeof body.notifEvening === 'string' && time.test(body.notifEvening)) run('UPDATE users SET notif_evening = ? WHERE id = ?', body.notifEvening, user.id);
    if (typeof body.notifEnabled === 'boolean') run('UPDATE users SET notif_enabled = ? WHERE id = ?', body.notifEnabled ? 1 : 0, user.id);
    return meResponse(one<UserRow>('SELECT * FROM users WHERE id = ?', user.id)!);
  });

  // --- Пара ------------------------------------------------------------------

  app.get('/api/invite', { preHandler: requireUser }, async (req) => {
    const user = req.user!;
    const pair = pairOf(user);
    const url = `${publicBase(req)}/j/${pair.invite_code}`;
    const text = `${user.name} зовёт тебя в Половинку — один вопрос в день на двоих, 20 секунд. Открой: ${url}`;
    return { code: pair.invite_code, url, text };
  });

  app.post('/api/invite/sent', { preHandler: requireUser }, async (req) => {
    const user = req.user!;
    const body = (req.body ?? {}) as { via?: unknown };
    logEvent('invite_sent', { pairId: user.pair_id, userId: user.id, meta: { via: typeof body.via === 'string' ? body.via : 'unknown' } });
    return { ok: true };
  });

  /** Информация по коду приглашения — для экрана /j/:code. */
  app.get('/api/invite/:code', async (req, reply) => {
    const code = String((req.params as { code: string }).code).toLowerCase();
    const pair = one<PairRow>('SELECT * FROM pairs WHERE invite_code = ? AND deleted_at IS NULL', code);
    if (!pair) return reply.code(404).send({ error: 'invite_not_found' });
    const members = all<UserRow>('SELECT * FROM users WHERE pair_id = ?', pair.id);
    const viewer = userByToken(readToken(req));
    if (!viewer || viewer.pair_id !== pair.id) logEvent('invite_opened', { pairId: pair.id, userId: viewer?.id ?? null });
    const inviter = members.find((m) => m.id !== viewer?.id) ?? members[0];
    return {
      inviterName: inviter?.name ?? null,
      full: members.length >= 2,
      alreadyMember: !!viewer && members.some((m) => m.id === viewer.id),
    };
  });

  /** Присоединиться к паре существующим аккаунтом. */
  app.post('/api/pair/join', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const body = (req.body ?? {}) as { code?: unknown };
    const code = typeof body.code === 'string' ? body.code.trim().toLowerCase() : '';
    const target = one<PairRow>('SELECT * FROM pairs WHERE invite_code = ? AND deleted_at IS NULL', code);
    if (!target) return reply.code(404).send({ error: 'invite_not_found' });
    if (target.id === user.pair_id) return meResponse(user);
    if (partnerOf(user)) return reply.code(409).send({ error: 'already_paired' });
    const members = all<UserRow>('SELECT * FROM users WHERE pair_id = ?', target.id);
    if (members.length >= 2) return reply.code(409).send({ error: 'pair_full' });

    const oldPairId = user.pair_id;
    transaction(() => {
      run('UPDATE users SET pair_id = ? WHERE id = ?', target.id, user.id);
      // Одиночная пара присоединившегося больше не нужна.
      run('DELETE FROM answers WHERE round_id IN (SELECT id FROM rounds WHERE pair_id = ?)', oldPairId);
      run('DELETE FROM rounds WHERE pair_id = ?', oldPairId);
      run('UPDATE questions SET pair_id = ? WHERE pair_id = ?', target.id, oldPairId);
      run('DELETE FROM pairs WHERE id = ?', oldPairId);
    });
    logEvent('invite_accepted', { pairId: target.id, userId: user.id });
    const fresh = one<UserRow>('SELECT * FROM users WHERE id = ?', user.id)!;
    sendTo(members[0]?.id, { type: 'pair_joined', partnerName: fresh.name });
    return meResponse(fresh);
  });

  // --- Вопрос дня -----------------------------------------------------------

  app.get('/api/today', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const pair = pairOf(user);
    const partner = partnerOf(user);
    const date = dateInTz(pair.tz);
    const daily = pair.is_guest ? null : ensureDaily(pair, date);
    if (!daily && !pair.is_guest) return reply.code(503).send({ error: 'no_questions_left' });
    const bonus = all<RoundRow>(`SELECT * FROM rounds WHERE pair_id = ? AND date = ? AND kind IN ('bonus', 'repeat') ORDER BY created_at`, pair.id, date);
    const pending = all<RoundRow>(
      `SELECT r.* FROM rounds r
        WHERE r.pair_id = ? AND r.date < ? AND r.status = 'open' AND r.kind != 'challenge'
          AND NOT EXISTS (SELECT 1 FROM answers a WHERE a.round_id = r.id AND a.user_id = ?)
        ORDER BY r.date DESC LIMIT 3`,
      pair.id,
      date,
      user.id,
    );
    const res: TodayResponse = {
      date,
      daily: daily ? roundPublic(daily, user, partner) : null,
      bonus: bonus.map((r) => roundPublic(r, user, partner)),
      bonusLeft: Math.max(0, MAX_BONUS_PER_DAY - bonus.filter((r) => r.kind === 'bonus').length),
      repeatAvailable: !pair.is_guest && repeatAvailable(pair),
      pending: pending.map((r) => roundPublic(r, user, partner)),
    };
    return res;
  });

  app.post('/api/rounds/bonus', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const pair = pairOf(user);
    const partner = partnerOf(user);
    const date = dateInTz(pair.tz);
    const count = one<{ n: number }>(`SELECT COUNT(*) AS n FROM rounds WHERE pair_id = ? AND date = ? AND kind = 'bonus'`, pair.id, date);
    if (Number(count?.n ?? 0) >= MAX_BONUS_PER_DAY) return reply.code(409).send({ error: 'bonus_limit' });
    const q = pickQuestion({ pairId: pair.id, pairCreatedAt: pair.created_at, tz: pair.tz, date, kind: 'bonus', seedSalt: String(count?.n ?? 0), solo: !partner, theme: pair.week_theme });
    if (!q) return reply.code(503).send({ error: 'no_questions_left' });
    const id = newId();
    run(`INSERT INTO rounds (id, pair_id, question_id, date, kind, status, created_at) VALUES (?, ?, ?, ?, 'bonus', 'open', ?)`, id, pair.id, q.id, date, nowIso());
    logEvent('bonus_started', { pairId: pair.id, userId: user.id });
    const round = one<RoundRow>('SELECT * FROM rounds WHERE id = ?', id)!;
    sendTo(partner?.id, { type: 'bonus_added', roundId: id });
    return roundPublic(round, user, partner);
  });

  app.get('/api/rounds/:id', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const round = one<RoundRow>('SELECT * FROM rounds WHERE id = ? AND pair_id = ?', (req.params as { id: string }).id, user.pair_id);
    if (!round) return reply.code(404).send({ error: 'round_not_found' });
    return roundPublic(round, user, partnerOf(user));
  });

  app.post('/api/rounds/:id/answer', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const body = (req.body ?? {}) as { choice?: unknown; guess?: unknown; clientId?: unknown };
    const round = one<RoundRow>('SELECT * FROM rounds WHERE id = ? AND pair_id = ?', (req.params as { id: string }).id, user.pair_id);
    if (!round) return reply.code(404).send({ error: 'round_not_found' });
    const partner = partnerOf(user);
    const format = one<{ format: string }>('SELECT format FROM questions WHERE id = ?', round.question_id)?.format ?? 'ab';
    const choice = normalizeChoice(body.choice, format, user, partner);
    const guess = body.guess == null ? null : normalizeChoice(body.guess, format, user, partner);
    if (!choice) return reply.code(400).send({ error: 'choice' });
    const clientId = typeof body.clientId === 'string' && body.clientId.length <= 64 ? body.clientId : null;

    const existing = one<AnswerRow>('SELECT * FROM answers WHERE round_id = ? AND user_id = ?', round.id, user.id);
    if (existing) {
      // Идемпотентность: повтор того же ответа из офлайн-очереди.
      return roundPublic(round, user, partner);
    }

    let revealed = false;
    transaction(() => {
      run(
        'INSERT INTO answers (id, round_id, user_id, client_id, choice, guess, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        newId(),
        round.id,
        user.id,
        clientId,
        choice,
        guess,
        nowIso(),
      );
      const n = one<{ n: number }>('SELECT COUNT(*) AS n FROM answers WHERE round_id = ?', round.id);
      if (partner && Number(n?.n ?? 0) >= 2 && round.status === 'open') {
        run(`UPDATE rounds SET status = 'revealed', revealed_at = ? WHERE id = ?`, nowIso(), round.id);
        revealed = true;
      }
    });
    logEvent('answer', { pairId: user.pair_id, userId: user.id, meta: { kind: round.kind } });
    const c = counters(user.pair_id);
    const fresh_milestones = checkMilestones(pairOf(user), c.discoveries);
    if (fresh_milestones.length) logEvent('milestone', { pairId: user.pair_id, meta: { keys: fresh_milestones } });
    if (revealed) {
      logEvent('reveal', { pairId: user.pair_id, meta: { kind: round.kind } });
      sendTo(partner?.id, { type: 'revealed', roundId: round.id });
      const ch = challengeOfRound(round);
      if (ch) notifyChallenge(ch);
      if (partner && round.kind === 'daily') {
        const theirs = one<AnswerRow>('SELECT * FROM answers WHERE round_id = ? AND user_id = ?', round.id, partner.id);
        // С точки зрения получателя (партнёра): угадал ли он меня, угадал ли я его.
        void pushReveal(partner, user.name, {
          iGuessed: !!theirs && guessHit(format, theirs.guess, choice),
          theyGuessed: !!theirs && guessHit(format, guess, theirs.choice),
        });
      }
    } else {
      sendTo(partner?.id, { type: 'partner_answered', roundId: round.id });
      if (partner && round.kind === 'daily') {
        const q = roundPublic(round, partner, user).question;
        void pushPartnerAnswered(partner, user.name, q.text);
      }
    }
    const fresh = one<RoundRow>('SELECT * FROM rounds WHERE id = ?', round.id)!;
    return roundPublic(fresh, user, partner);
  });

  app.post('/api/rounds/:id/why', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const body = (req.body ?? {}) as { whyText?: unknown; whyChip?: unknown };
    const round = one<RoundRow>('SELECT * FROM rounds WHERE id = ? AND pair_id = ?', (req.params as { id: string }).id, user.pair_id);
    if (!round) return reply.code(404).send({ error: 'round_not_found' });
    const mine = one<AnswerRow>('SELECT * FROM answers WHERE round_id = ? AND user_id = ?', round.id, user.id);
    if (!mine) return reply.code(409).send({ error: 'not_answered' });
    const whyText = cleanText(body.whyText);
    const whyChip = cleanText(body.whyChip, 80);
    if (!whyText && !whyChip) return reply.code(400).send({ error: 'why' });
    const first = !mine.why_text && !mine.why_chip;
    run('UPDATE answers SET why_text = ?, why_chip = ? WHERE id = ?', whyText, whyChip, mine.id);
    if (first) logEvent('why_added', { pairId: user.pair_id, userId: user.id });
    const partner = partnerOf(user);
    sendTo(partner?.id, { type: 'why_added', roundId: round.id });
    return roundPublic(round, user, partner);
  });

  app.post('/api/rounds/:id/topic-opened', { preHandler: requireUser }, async (req) => {
    const user = req.user!;
    logEvent('topic_opened', { pairId: user.pair_id, userId: user.id });
    return { ok: true };
  });

  app.post('/api/questions/:id/mark', { preHandler: requireUser }, async (req) => {
    const user = req.user!;
    const qid = (req.params as { id: string }).id;
    run('INSERT OR IGNORE INTO question_marks (pair_id, user_id, question_id, created_at) VALUES (?, ?, ?, ?)', user.pair_id, user.id, qid, nowIso());
    logEvent('question_marked', { pairId: user.pair_id, userId: user.id });
    return { ok: true };
  });

  // --- «Позвать» -------------------------------------------------------------

  app.post('/api/nudge', { preHandler: requireUser }, async (req) => {
    const user = req.user!;
    const pair = pairOf(user);
    const partner = partnerOf(user);
    const date = dateInTz(pair.tz);
    const base = publicBase(req);
    const daily = ensureDaily(pair, date);
    const q = daily ? roundPublic(daily, user, partner).question : null;
    const qText = q ? q.text.replace(/[:：]\s*$/, '') : '';

    const already = one('SELECT 1 FROM notification_log WHERE user_id = ? AND date = ? AND kind = ?', user.id, date, 'nudge');
    const url = partner ? `${base}/` : `${base}/j/${pair.invite_code}`;
    const name = partner?.name ?? 'половинка';
    const text = partner
      ? `${name}, я уже ответил(а) на наш вопрос дня${qText ? ` — «${qText}»` : ''}. Твоя очередь, это 20 секунд: ${url}`
      : `${user.name} зовёт тебя в Половинку. Я уже ответил(а) на первый вопрос${qText ? ` — «${qText}»` : ''}, посмотрим, совпадём ли: ${url}`;

    if (!already) {
      run('INSERT INTO notification_log (user_id, date, kind, created_at) VALUES (?, ?, ?, ?)', user.id, date, 'nudge', nowIso());
      logEvent(partner ? 'nudge_sent' : 'invite_sent', { pairId: pair.id, userId: user.id, meta: { via: 'nudge' } });
    }
    return { text, url, firstToday: !already };
  });

  // --- Тёплые жесты ----------------------------------------------------------

  app.post('/api/gestures', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const partner = partnerOf(user);
    if (!partner) return reply.code(409).send({ error: 'no_partner' });
    const body = (req.body ?? {}) as { type?: unknown; text?: unknown; clientId?: unknown };
    const type = body.type as GestureType;
    if (!(type in GESTURE_LABELS)) return reply.code(400).send({ error: 'type' });
    if (type === 'hug' && levelFor(counters(user.pair_id).discoveries).level < LEVEL_HUG) return reply.code(403).send({ error: 'level' });
    const text = cleanText(body.text) ?? GESTURE_LABELS[type].replace('…', '');
    const clientId = typeof body.clientId === 'string' && body.clientId.length <= 64 ? body.clientId : null;
    if (clientId) {
      const dup = one<GestureRow>('SELECT * FROM gestures WHERE client_id = ?', clientId);
      if (dup) return gesturePublic(dup);
    }
    const id = newId();
    run(
      'INSERT INTO gestures (id, pair_id, from_user_id, to_user_id, type, text, client_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id,
      user.pair_id,
      user.id,
      partner.id,
      type,
      text,
      clientId,
      nowIso(),
    );
    logEvent('gesture_sent', { pairId: user.pair_id, userId: user.id, meta: { type } });
    const g = gesturePublic(one<GestureRow>('SELECT * FROM gestures WHERE id = ?', id)!);
    sendTo(partner.id, { type: 'gesture', gesture: g });
    return g;
  });

  app.get('/api/gestures', { preHandler: requireUser }, async (req) => {
    const user = req.user!;
    const rows = all<GestureRow>('SELECT * FROM gestures WHERE pair_id = ? ORDER BY created_at DESC LIMIT 50', user.pair_id);
    return { gestures: rows.map(gesturePublic) };
  });

  app.post('/api/gestures/:id/seen', { preHandler: requireUser }, async (req) => {
    const user = req.user!;
    run('UPDATE gestures SET seen_at = ? WHERE id = ? AND to_user_id = ? AND seen_at IS NULL', nowIso(), (req.params as { id: string }).id, user.id);
    return { ok: true };
  });

  // --- Приватность -----------------------------------------------------------

  app.delete('/api/pair/history', { preHandler: requireUser }, async (req) => {
    const user = req.user!;
    const pid = user.pair_id;
    transaction(() => {
      run('DELETE FROM answers WHERE round_id IN (SELECT id FROM rounds WHERE pair_id = ?)', pid);
      run('DELETE FROM rounds WHERE pair_id = ?', pid);
      run('DELETE FROM gestures WHERE pair_id = ?', pid);
      run('DELETE FROM favorites WHERE pair_id = ?', pid);
      run('DELETE FROM milestones WHERE pair_id = ?', pid);
      run('DELETE FROM weekly_cards WHERE pair_id = ?', pid);
      run('DELETE FROM question_marks WHERE pair_id = ?', pid);
      run('DELETE FROM questions WHERE pair_id = ?', pid);
    });
    logEvent('history_deleted', { pairId: pid, userId: user.id });
    const partner = partnerOf(user);
    sendTo(partner?.id, { type: 'history_deleted' });
    return { ok: true };
  });

  // --- События в реальном времени (SSE) --------------------------------------

  app.get('/api/events', { preHandler: requireUser }, async (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(`event: ping\ndata: {"type":"ping"}\n\n`);
    addClient(req.user!.id, reply);
    // Ответ остаётся открытым; Fastify не должен его завершать.
    await new Promise<void>((resolve) => reply.raw.on('close', () => resolve()));
    return reply;
  });
}
