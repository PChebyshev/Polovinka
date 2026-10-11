import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { all, one, run, logEvent } from './db.js';
import { newId, nowIso } from './ids.js';
import { requireUser } from './auth.js';
import { pushEnabled, pushPublicKey } from './push.js';
import { computeStats } from './stats.js';

function keyOk(given: unknown): boolean {
  const expected = process.env.STATS_KEY ?? '';
  if (!expected || typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function registerStage4Routes(app: FastifyInstance) {
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
    const body = (req.body ?? {}) as { type?: unknown };
    const allowed = new Set(['install_prompt_shown', 'install_accepted', 'install_dismissed', 'offline_queued', 'offline_flushed']);
    if (typeof body.type !== 'string' || !allowed.has(body.type)) return reply.code(400).send({ error: 'type' });
    logEvent(body.type, { pairId: user.pair_id, userId: user.id });
    return { ok: true };
  });

  app.get('/api/stats', async (req, reply) => {
    const q = req.query as { key?: string; days?: string };
    const key = q.key ?? (req.headers['x-stats-key'] as string | undefined);
    if (!keyOk(key)) return reply.code(401).send({ error: 'stats_key' });
    const days = Math.min(365, Math.max(7, Number(q.days ?? 30) || 30));
    return computeStats(days);
  });
}
