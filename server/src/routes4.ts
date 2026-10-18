import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { all, one, run, logEvent, type UserRow } from './db.js';
import { hashToken, newId, newToken, nowIso } from './ids.js';
import { randomInt } from 'node:crypto';
import { requireUser } from './auth.js';
import { pushEnabled, pushPublicKey, sendTestPush } from './push.js';
import { computeStats } from './stats.js';
import { computePmf, registerPmfRoutes, TRACKED_SCREENS } from './pmf.js';
import { campaignBase, computeCampaigns, registerCampaignRoutes } from './campaigns.js';

function keyOk(given: unknown): boolean {
  const expected = process.env.STATS_KEY ?? '';
  if (!expected || typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Без похожих символов (0/O, 1/I/L), чтобы код легко переписать с экрана.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LEN = 6;
const CODE_TTL_MIN = 30;
const HANDOFF_LEN = 16;
const HANDOFF_TTL_DAYS = 7;

function newLoginCode(len = CODE_LEN): string {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

/** Ограничение попыток ввода кода: 10 за 10 минут с одного IP. */
const attempts = new Map<string, number[]>();
function tooManyAttempts(ip: string): boolean {
  const now = Date.now();
  const list = (attempts.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
  list.push(now);
  attempts.set(ip, list);
  return list.length > 10;
}

export async function registerStage4Routes(app: FastifyInstance, deps: { meResponse: (u: UserRow) => unknown }) {
  // --- Перенос входа на другое устройство ---------------------------------------

  /** Длинный код для автоматического входа в приложение на экране «Домой» (через start_url). */
  app.post('/api/login-codes/handoff', { preHandler: requireUser }, async (req) => {
    const user = req.user!;
    const ts = nowIso();
    run('DELETE FROM login_codes WHERE expires_at < ?', ts);
    run('DELETE FROM login_codes WHERE user_id = ? AND length(code) = ? AND used_at IS NULL', user.id, HANDOFF_LEN);
    const code = newLoginCode(HANDOFF_LEN);
    const expires = new Date(Date.now() + HANDOFF_TTL_DAYS * 86_400_000).toISOString();
    run('INSERT INTO login_codes (code, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)', code, user.id, expires, ts);
    return { code, expiresAt: expires };
  });

  app.post('/api/login-codes', { preHandler: requireUser }, async (req) => {
    const user = req.user!;
    const ts = nowIso();
    run('DELETE FROM login_codes WHERE expires_at < ?', ts);
    run('DELETE FROM login_codes WHERE user_id = ? AND length(code) = ?', user.id, CODE_LEN);
    let code = newLoginCode();
    while (one('SELECT 1 FROM login_codes WHERE code = ?', code)) code = newLoginCode();
    const expires = new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString();
    run('INSERT INTO login_codes (code, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)', code, user.id, expires, ts);
    logEvent('login_code_created', { pairId: user.pair_id, userId: user.id });
    return { code, expiresAt: expires };
  });

  app.post('/api/login-codes/redeem', async (req, reply) => {
    if (tooManyAttempts(req.ip)) return reply.code(429).send({ error: 'too_many_attempts' });
    const raw = ((req.body ?? {}) as { code?: unknown }).code;
    const code = typeof raw === 'string' ? raw.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
    if (code.length !== CODE_LEN && code.length !== HANDOFF_LEN) return reply.code(400).send({ error: 'code' });
    const row = one<{ user_id: string; expires_at: string; used_at: string | null }>('SELECT * FROM login_codes WHERE code = ?', code);
    if (!row || row.used_at || row.expires_at < nowIso()) return reply.code(404).send({ error: 'code_invalid' });
    const user = one<UserRow>('SELECT * FROM users WHERE id = ?', row.user_id);
    if (!user) return reply.code(404).send({ error: 'code_invalid' });
    const token = newToken();
    run('UPDATE login_codes SET used_at = ? WHERE code = ?', nowIso(), code);
    run('INSERT INTO user_tokens (token_hash, user_id, created_at) VALUES (?, ?, ?)', hashToken(token), user.id, nowIso());
    logEvent(code.length === HANDOFF_LEN ? 'handoff_redeemed' : 'login_code_redeemed', { pairId: user.pair_id, userId: user.id });
    return { token, me: deps.meResponse(user) };
  });

  app.post('/api/push/test', { preHandler: requireUser }, async (req) => {
    if (!pushEnabled()) return { sent: 0, failed: 0, statuses: [], disabled: true };
    return sendTestPush(req.user!);
  });

  app.get('/api/push/key', async () => ({ enabled: pushEnabled(), key: pushPublicKey() }));

  app.post('/api/push/subscribe', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const body = (req.body ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
    const endpoint = typeof body.endpoint === 'string' ? body.endpoint : '';
    const p256dh = typeof body.keys?.p256dh === 'string' ? body.keys.p256dh : '';
    const auth = typeof body.keys?.auth === 'string' ? body.keys.auth : '';
    if (!endpoint.startsWith('https://') || !p256dh || !auth) return reply.code(400).send({ error: 'subscription' });
    run(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at, failed_at) VALUES (?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, failed_at = NULL`,
      newId(),
      user.id,
      endpoint,
      p256dh,
      auth,
      nowIso(),
    );
    run('UPDATE users SET notif_enabled = 1 WHERE id = ?', user.id);
    logEvent('push_subscribed', { pairId: user.pair_id, userId: user.id });
    return { ok: true };
  });

  app.delete('/api/push/subscribe', { preHandler: requireUser }, async (req) => {
    const user = req.user!;
    const body = (req.body ?? {}) as { endpoint?: unknown };
    if (typeof body.endpoint === 'string') run('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?', body.endpoint, user.id);
    else run('DELETE FROM push_subscriptions WHERE user_id = ?', user.id);
    const left = one<{ n: number }>('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?', user.id);
    if (Number(left?.n ?? 0) === 0) run('UPDATE users SET notif_enabled = 0 WHERE id = ?', user.id);
    return { ok: true };
  });

  app.get('/api/push/status', { preHandler: requireUser }, async (req) => {
    const subs = all<{ endpoint: string }>('SELECT endpoint FROM push_subscriptions WHERE user_id = ?', req.user!.id);
    return { subscribed: subs.length > 0, endpoints: subs.map((s) => s.endpoint) };
  });

  /** События с клиента: подсказка «на экран», установка. */
  app.post('/api/events', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const body = (req.body ?? {}) as { type?: unknown; name?: unknown };
    // Просмотр экрана: только из списка, имя — в meta
    if (body.type === 'screen') {
      if (typeof body.name !== 'string' || !TRACKED_SCREENS.includes(body.name)) return reply.code(400).send({ error: 'name' });
      logEvent('screen', { pairId: user.pair_id, userId: user.id, meta: { name: body.name } });
      return { ok: true };
    }
    const allowed = new Set([
      'survey_shown',
      'survey_dismissed',
      'install_prompt_shown',
      'install_accepted',
      'install_dismissed',
      'offline_queued',
      'offline_flushed',
      'landing_browser',
      'standalone_launch',
    ]);
    if (typeof body.type !== 'string' || !allowed.has(body.type)) return reply.code(400).send({ error: 'type' });
    logEvent(body.type, { pairId: user.pair_id, userId: user.id });
    return { ok: true };
  });

  /** Анонимные события лендинга: пользователя ещё нет. */
  app.post('/api/events/anon', async (req, reply) => {
    const type = ((req.body ?? {}) as { type?: unknown }).type;
    const allowed = new Set(['landing_install_shown', 'landing_browser']);
    if (typeof type !== 'string' || !allowed.has(type)) return reply.code(400).send({ error: 'type' });
    logEvent(type, {});
    return { ok: true };
  });

  app.get('/api/stats', async (req, reply) => {
    const q = req.query as { key?: string; days?: string };
    const key = q.key ?? (req.headers['x-stats-key'] as string | undefined);
    if (!keyOk(key)) return reply.code(401).send({ error: 'stats_key' });
    const days = Math.min(365, Math.max(7, Number(q.days ?? 30) || 30));
    return { ...computeStats(days), pmf: computePmf(days), ads: computeCampaigns(campaignBase(req), days) };
  });

  await registerPmfRoutes(app, { keyOk, meResponse: deps.meResponse });
  await registerCampaignRoutes(app, { keyOk });
}
