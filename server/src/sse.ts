import type { FastifyReply } from 'fastify';
import type { ServerEvent } from '../../shared/src/types.js';

const clients = new Map<string, Set<FastifyReply>>();

export function addClient(userId: string, reply: FastifyReply) {
  let set = clients.get(userId);
  if (!set) {
    set = new Set();
    clients.set(userId, set);
  }
  set.add(reply);
  reply.raw.on('close', () => {
    set?.delete(reply);
    if (set && set.size === 0) clients.delete(userId);
  });
}

export function sendTo(userId: string | null | undefined, event: ServerEvent) {
  if (!userId) return;
  const set = clients.get(userId);
  if (!set) return;
  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const reply of set) {
    try {
      reply.raw.write(payload);
    } catch {
      set.delete(reply);
    }
  }
}

export function isOnline(userId: string): boolean {
  return (clients.get(userId)?.size ?? 0) > 0;
}

setInterval(() => {
  for (const [, set] of clients) {
    for (const reply of set) {
      try {
        reply.raw.write(`: ping\n\n`);
      } catch {
        set.delete(reply);
      }
    }
  }
}, 25_000).unref();
