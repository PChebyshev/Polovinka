import type { FastifyReply, FastifyRequest } from 'fastify';
import { one, run, type UserRow } from './db.js';
import { hashToken, nowIso } from './ids.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: UserRow;
  }
}

export function readToken(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) return h.slice(7).trim();
  const q = (req.query as Record<string, string | undefined>)?.token;
  return q ?? null;
}

export function userByToken(token: string | null): UserRow | undefined {
  if (!token || token.length < 32) return undefined;
  const h = hashToken(token);
  return (
    one<UserRow>('SELECT * FROM users WHERE token_hash = ?', h) ??
    one<UserRow>('SELECT u.* FROM user_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?', h)
  );
}

export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const user = userByToken(readToken(req));
  if (!user) {
    reply.code(401).send({ error: 'unauthorized' });
    return reply;
  }
  req.user = user;
  const now = nowIso();
  if (!user.last_seen_at || now.slice(0, 13) !== user.last_seen_at.slice(0, 13)) {
    run('UPDATE users SET last_seen_at = ? WHERE id = ?', now, user.id);
  }
}
