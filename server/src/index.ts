import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, one, all, type PairRow, type UserRow } from './db.js';

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
import { registerRoutes } from './routes.js';
import { initPush, startScheduler } from './push.js';
import { initMail } from './mail.js';

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

initPush(DATA_DIR, app.log);
initMail(DATA_DIR, app.log);
startScheduler();
await registerRoutes(app, { dataDir: DATA_DIR });

/**
 * Адрес, с которого стартует установленное приложение. На iOS у приложения на экране
 * «Домой» своё хранилище, поэтому ссылка-приглашение (/j/…), вызов (/c/…) или
 * одноразовый код входа (/?h=…) должны попасть в него через start_url.
 */
function startUrlFor(path: string, query: URLSearchParams): string {
  const m = path.match(/^\/(j|c)\/([a-z0-9]{4,16})$/);
  if (m) return `/${m[1]}/${m[2]}`;
  const h = query.get('h');
  if (path === '/install' && h && /^[A-Z0-9]{16}$/.test(h)) return `/?h=${h}`;
  return '/';
}

app.get('/api/manifest.webmanifest', async (req, reply) => {
  const raw = String((req.query as { start?: string }).start ?? '/');
  const [p, q] = raw.split('?');
  const start = startUrlFor(p === '/' && q ? '/install' : p, new URLSearchParams(q ?? ''));
  reply.header('Cache-Control', 'no-cache').type('application/manifest+json; charset=utf-8');
  return {
    id: '/',
    name: 'Половинка — один вопрос в день на двоих',
    short_name: 'Половинка',
    description: 'Один вопрос в день на двоих. 20 секунд утром, маленькое открытие вечером.',
    lang: 'ru',
    start_url: start,
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#17111f',
    theme_color: '#17111f',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
});

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
    title: 'Половинка — один вопрос в день на двоих',
    description: 'Один вопрос в день на двоих. 20 секунд утром, маленькое открытие вечером.',
    image: `${base}/og-default.png`,
  };
  const c = path.match(/^\/c\/([a-z0-9]+)/);
  if (c) {
    const ch = one<{ from_pair_id: string }>('SELECT from_pair_id FROM challenges WHERE code = ?', c[1]);
    if (ch) {
      const names = all<UserRow>('SELECT * FROM users WHERE pair_id = ? ORDER BY created_at', ch.from_pair_id).map((u) => u.name);
      const title = names.length > 1 ? `${names[0]} и ${names[1]}` : names[0] ?? 'Пара';
      return {
        title: `${title} бросают вам вызов: 5 вопросов`,
        description: 'Пройдите те же вопросы со своей половинкой, а потом сравним, где совпали. Без победителей.',
        image: def.image,
      };
    }
  }
  const w = path.match(/^\/w\/([a-z0-9]+)/);
  if (w) {
    const card = one<{ pair_id: string; stats: string; png_path: string | null }>('SELECT pair_id, stats, png_path FROM weekly_cards WHERE code = ?', w[1]);
    if (card) {
      const names = all<UserRow>('SELECT * FROM users WHERE pair_id = ? ORDER BY created_at', card.pair_id).map((u) => u.name);
      const st = JSON.parse(card.stats) as { discoveries: number; matchPercent: number | null };
      const title = names.length > 1 ? `${names[0]} и ${names[1]}` : names[0] ?? 'Пара';
      const pct = st.matchPercent === null ? '' : `, знают друг друга на ${st.matchPercent}%`;
      return {
        title: `${title}: ${st.discoveries} ${plural(st.discoveries, 'открытие', 'открытия', 'открытий')} за неделю${pct}`,
        description: 'Один вопрос в день на двоих. Попробуйте свой ритуал в Половинке.',
        image: card.png_path && existsSync(card.png_path) ? `${base}/api/week/${w[1]}/image.png` : def.image,
      };
    }
  }
  const m = path.match(/^\/j\/([a-z0-9]+)/);
  if (m) {
    const pair = one<PairRow>('SELECT * FROM pairs WHERE invite_code = ?', m[1]);
    const inviter = pair ? one<UserRow>('SELECT * FROM users WHERE pair_id = ? ORDER BY created_at LIMIT 1', pair.id) : undefined;
    if (inviter) {
      return {
        title: `${inviter.name} зовёт тебя в Половинку`,
        description: 'Один вопрос в день на двоих. Ответь — и узнаем, насколько хорошо вы знаете друг друга.',
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
    const [pathOnly, queryOnly] = req.url.split('?');
    const start = startUrlFor(pathOnly, new URLSearchParams(queryOnly ?? ''));
    const html = indexHtml
      .replace('<!--og-->', tags)
      .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(og.title)}</title>`)
      .replace('href="/api/manifest.webmanifest"', `href="/api/manifest.webmanifest?start=${encodeURIComponent(start)}"`);
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
