import type { FastifyRequest } from 'fastify';

/**
 * Адрес сайта для ссылок (приглашения, карточки, OG). Обычно это PUBLIC_URL.
 * Зарубежный вход (go.polovinka.online — отдельный сервер-прокси для людей с VPN) присылает
 * заголовок X-Polovinka-Host: такие пользователи должны получать ссылки со своим доменом,
 * иначе партнёр упрётся в тот же VPN. Разрешённые домены входов — EDGE_HOSTS через запятую.
 */

type Req = Pick<FastifyRequest, 'headers' | 'protocol'>;

function edgeHosts(): Set<string> {
  return new Set(
    (process.env.EDGE_HOSTS ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Домен зарубежного входа, через который пришёл запрос, или null. */
export function edgeHost(req: Req): string | null {
  const h = (req.headers['x-polovinka-host'] as string | undefined)?.trim().toLowerCase();
  return h && edgeHosts().has(h) ? h : null;
}

export function publicBase(req: Req): string {
  const edge = edgeHost(req);
  if (edge) return `https://${edge}`;
  const env = process.env.PUBLIC_URL?.replace(/\/$/, '');
  if (env) return env;
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0] ?? req.protocol;
  const host = (req.headers['x-forwarded-host'] as string | undefined) ?? (req.headers.host as string | undefined) ?? 'localhost';
  return `${proto}://${host}`;
}
