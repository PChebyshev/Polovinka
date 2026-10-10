import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, one, type PairRow, type UserRow } from './db.js';
import { registerRoutes } from './routes.js';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';
const DATA_DIR = resolve(process.env.DATA_DIR ?? join(here, '..', '..', 'data'));
const WEB_DIST = [
  process.env.WEB_DIST,
  join(here, '..', '..', 'web', 'dist'),
  join(here, '..', '..', '..', '..', 'web', 'dist'),
].filter((p): p is string => !!p).find((p) => existsSync(join(p, 'index.html')));

openDb(DATA_DIR);

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, trustProxy: true });

await registerRoutes(app);

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

interface Og {
  title: string;
  description: string;
  image?: string;
}

function ogFor(path: string, base: string): Og {
  const def: Og = {
    title: 'Мы на % — ежедневный ритуал для пары',
    description: 'Один вопрос в день на двоих. 20 секунд утром, маленькое открытие вечером.',
    image: `${base}/og-default.png`,
  };
  const m = path.match(/^\/j\/([a-z0-9]+)/);
  if (m) {
    const pair = one<PairRow>('SELECT * FROM pairs WHERE invite_code = ?', m[1]);
    const inviter = pair ? one<UserRow>('SELECT * FROM users WHERE pair_id = ? ORDER BY created_at LIMIT 1', pair.id) : undefined;
    if (inviter) {
      return {
        title: `${inviter.name} зовёт тебя в «Мы на %»`,
        description: 'Один вопрос в день на двоих. Ответь, и узнаем, совпадёте ли вы.',
        image: def.image,
      };
    }
  }
  return def;
}

if (WEB_DIST) {
  const indexHtml = readFileSync(join(WEB_DIST, 'index.html'), 'utf8');

  await app.register(fastifyStatic, {
    root: WEB_DIST,
    prefix: '/',
    wildcard: false,
    index: false,
    cacheControl: true,
    maxAge: '1h',
    immutable: false,
    setHeaders(res, filePath) {
      if (filePath.includes(`${join(WEB_DIST, 'assets')}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else if (filePath.endsWith('sw.js') || filePath.endsWith('manifest.webmanifest')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  });

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not_found' });
    const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? req.protocol;
    const host = (req.headers['x-forwarded-host'] as string | undefined) ?? req.headers.host ?? 'localhost';
    const base = process.env.PUBLIC_URL?.replace(/\/$/, '') ?? `${proto}://${host}`;
    const og = ogFor(req.url.split('?')[0], base);
    const tags = [
      `<meta property="og:type" content="website">`,
      `<meta property="og:title" content="${escapeHtml(og.title)}">`,
      `<meta property="og:description" content="${escapeHtml(og.description)}">`,
      `<meta property="og:url" content="${escapeHtml(base + req.url.split('?')[0])}">`,
      og.image ? `<meta property="og:image" content="${escapeHtml(og.image)}">` : '',
      `<meta name="twitter:card" content="summary_large_image">`,
      `<meta name="description" content="${escapeHtml(og.description)}">`,
    ].join('\n    ');
    const html = indexHtml.replace('<!--og-->', tags).replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(og.title)}</title>`);
    reply.header('Cache-Control', 'no-cache').type('text/html; charset=utf-8').send(html);
  });
} else {
  app.log.warn('web/dist не найден: раздаю только API (режим разработки)');
}

try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`Данные: ${DATA_DIR}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
