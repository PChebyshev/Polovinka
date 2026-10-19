import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { db, openDb } from './db.js';

/**
 * Резервные копии базы в S3-совместимое хранилище (Yandex Object Storage, Timeweb S3).
 * Раз в сутки ночью: снимок базы (VACUUM INTO) → gzip → AES-256-GCM паролем BACKUP_PASSWORD → PUT в бакет.
 * Без пароля копия не читается — ни хранилищем, ни тем, кто получит ключи.
 *
 * Переменные: BACKUP_S3_BUCKET, BACKUP_S3_KEY_ID, BACKUP_S3_SECRET, BACKUP_PASSWORD,
 * BACKUP_S3_ENDPOINT (по умолчанию https://storage.yandexcloud.net), BACKUP_S3_REGION (ru-central1).
 *
 * Вручную (в контейнере):
 *   node server/dist/server/src/backup.js now                 — сделать копию сейчас
 *   node server/dist/server/src/backup.js list                — последние копии в хранилище
 *   node server/dist/server/src/backup.js restore <имя> [файл] — скачать и расшифровать копию в файл базы
 */

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  keyId: string;
  secret: string;
  password: string;
}

const clean = (v: string | undefined) => (v ?? '').trim().replace(/^["'‘’“”«»]+|["'‘’“”«»]+$/g, '');

export function backupConfig(): S3Config | null {
  // Имена бакетов — только строчные; телефон любит ставить заглавную первую букву.
  // Принимаем и вставленную ссылку: s3://имя, https://storage.yandexcloud.net/имя, имя.storage.yandexcloud.net
  const bucket = clean(process.env.BACKUP_S3_BUCKET)
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/^s3:\/\//, '')
    .replace(/^https?:\/\/[^/]*storage[^/]*\//, '')
    .replace(/\.storage\.yandexcloud\.net.*$/, '')
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  const keyId = clean(process.env.BACKUP_S3_KEY_ID);
  const secret = clean(process.env.BACKUP_S3_SECRET);
  const password = clean(process.env.BACKUP_PASSWORD);
  if (!bucket || !keyId || !secret || !password) return null;
  return {
    endpoint: (clean(process.env.BACKUP_S3_ENDPOINT) || 'https://storage.yandexcloud.net').replace(/\/+$/, ''),
    region: clean(process.env.BACKUP_S3_REGION) || 'ru-central1',
    bucket,
    keyId,
    secret,
    password,
  };
}

// --- Подпись запросов S3 (AWS Signature V4) -----------------------------------------------

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest();
/** Кодирование пути по правилам S3: всё, кроме A-Z a-z 0-9 - _ . ~ и «/». */
const encodePath = (p: string) =>
  p
    .split('/')
    .map((s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()))
    .join('/');

export function signV4(opts: {
  method: string;
  path: string;
  query?: string;
  headers: Record<string, string>;
  payloadHash: string;
  region: string;
  keyId: string;
  secret: string;
  amzDate: string;
}): string {
  const date = opts.amzDate.slice(0, 8);
  const names = Object.keys(opts.headers)
    .map((h) => h.toLowerCase())
    .sort();
  const lower = Object.fromEntries(Object.entries(opts.headers).map(([k, v]) => [k.toLowerCase(), v.trim()]));
  const signed = names.join(';');
  const canonical = [opts.method, encodePath(opts.path), opts.query ?? '', names.map((n) => `${n}:${lower[n]}\n`).join(''), signed, opts.payloadHash].join(
    '\n',
  );
  const scope = `${date}/${opts.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', opts.amzDate, scope, sha256(canonical)].join('\n');
  const kDate = hmac('AWS4' + opts.secret, date);
  const kSigning = hmac(hmac(hmac(kDate, opts.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(toSign).digest('hex');
  return `AWS4-HMAC-SHA256 Credential=${opts.keyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`;
}

async function s3(c: S3Config, method: 'PUT' | 'GET', key: string, body?: Buffer, query = ''): Promise<Response> {
  const url = new URL(c.endpoint);
  const path = `/${c.bucket}${key ? '/' + key : '/'}`;
  const payloadHash = sha256(body ?? '');
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const headers: Record<string, string> = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const authorization = signV4({ method, path, query, headers, payloadHash, region: c.region, keyId: c.keyId, secret: c.secret, amzDate });
  return fetch(`${url.origin}${encodePath(path)}${query ? '?' + query : ''}`, {
    method,
    headers: { ...headers, authorization, ...(body ? { 'content-type': 'application/octet-stream' } : {}) },
    body: body ? new Uint8Array(body) : undefined,
    signal: AbortSignal.timeout(120_000),
  });
}

/** Понятная причина ошибки хранилища. */
async function explain(r: Response, c: S3Config): Promise<string> {
  const text = await r.text().catch(() => '');
  const code = text.match(/<Code>([^<]+)<\/Code>/)?.[1] ?? '';
  if (code === 'NoSuchBucket')
    return `бакет «${c.bucket}» не найден в ${c.endpoint}. Сравните с именем в консоли (Object Storage → Бакеты) — должно совпадать буква в букву`;
  if (code === 'InvalidAccessKeyId') return 'ключ не найден: проверьте BACKUP_S3_KEY_ID';
  if (code === 'SignatureDoesNotMatch') return 'неверный секретный ключ: проверьте BACKUP_S3_SECRET';
  if (code === 'AccessDenied' || r.status === 403) return 'нет прав: дайте сервисному аккаунту роль storage.uploader (для restore/list — storage.viewer)';
  return `хранилище ответило ${r.status} ${code}`.trim();
}

// --- Шифрование -----------------------------------------------------------------------------

const MAGIC = Buffer.from('PLVB1');

export function encrypt(data: Buffer, password: string): Buffer {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(password, salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);
}

export function decrypt(file: Buffer, password: string): Buffer {
  if (!file.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('это не файл копии Половинки');
  let o = MAGIC.length;
  const salt = file.subarray(o, (o += 16));
  const iv = file.subarray(o, (o += 12));
  const tag = file.subarray(o, (o += 16));
  const decipher = createDecipheriv('aes-256-gcm', scryptSync(password, salt, 32), iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(file.subarray(o)), decipher.final()]);
  } catch {
    throw new Error('не расшифровалось: неверный BACKUP_PASSWORD или файл повреждён');
  }
}

// --- Снимок и отправка ------------------------------------------------------------------------

const meta = (key: string) => (db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
const setMeta = (key: string, value: string | null) =>
  value === null ? db.prepare('DELETE FROM meta WHERE key = ?').run(key) : db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);

export interface BackupStatus {
  enabled: boolean;
  lastAt: string | null;
  lastKey: string | null;
  lastSize: number | null;
  error: string | null;
  errorAt: string | null;
}

export function backupStatus(): BackupStatus {
  const size = meta('backup_last_size');
  return {
    enabled: !!backupConfig(),
    lastAt: meta('backup_last_at'),
    lastKey: meta('backup_last_key'),
    lastSize: size ? Number(size) : null,
    error: meta('backup_error'),
    errorAt: meta('backup_error_at'),
  };
}

export async function makeBackup(dataDir: string): Promise<{ key: string; size: number }> {
  const c = backupConfig();
  if (!c) throw new Error('резервные копии не настроены: нужны BACKUP_S3_BUCKET, BACKUP_S3_KEY_ID, BACKUP_S3_SECRET, BACKUP_PASSWORD');
  const tmp = join(dataDir, `backup-${process.pid}-${Date.now()}.db`);
  try {
    // Согласованный снимок без остановки приложения
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    const file = encrypt(gzipSync(readFileSync(tmp)), c.password);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
    const key = `backups/polovinka-${stamp}.db.gz.enc`;
    const r = await s3(c, 'PUT', key, file);
    if (!r.ok) throw new Error(await explain(r, c));
    setMeta('backup_last_at', new Date().toISOString());
    setMeta('backup_last_key', key);
    setMeta('backup_last_size', String(file.length));
    setMeta('backup_error', null);
    setMeta('backup_error_at', null);
    return { key, size: file.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setMeta('backup_error', msg);
    setMeta('backup_error_at', new Date().toISOString());
    throw e;
  } finally {
    if (existsSync(tmp)) unlinkSync(tmp);
  }
}

/** Раз в сутки около 4 утра по Москве; если копии нет больше 30 часов — в любое время. Ошибка — повтор через час. */
export function startBackups(dataDir: string, log: { info: (s: string) => void; warn: (s: string) => void }) {
  if (!backupConfig()) {
    log.info('бэкап: не настроен (BACKUP_S3_*), копии не отправляются');
    return;
  }
  log.info('бэкап: включён, копия раз в сутки около 04:00 МСК');
  let running = false;
  const tick = async () => {
    if (running) return;
    const last = Date.parse(meta('backup_last_at') ?? '') || 0;
    const lastTry = Date.parse(meta('backup_error_at') ?? '') || 0;
    const age = Date.now() - last;
    const mskHour = (new Date().getUTCHours() + 3) % 24;
    const due = (age > 20 * 3_600_000 && mskHour >= 3 && mskHour < 7) || age > 30 * 3_600_000;
    if (!due || Date.now() - lastTry < 3_600_000) return;
    running = true;
    try {
      const r = await makeBackup(dataDir);
      log.info(`бэкап: ${r.key} (${Math.round(r.size / 1024)} КБ) отправлен`);
    } catch (e) {
      log.warn(`бэкап: не получилось — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      running = false;
    }
  };
  setTimeout(() => void tick(), 60_000);
  setInterval(() => void tick(), 15 * 60_000);
}

// --- Запуск вручную ---------------------------------------------------------------------------

async function cli() {
  const [cmd, arg, out] = process.argv.slice(2);
  const here = dirname(fileURLToPath(import.meta.url));
  const dataDir = resolve(process.env.DATA_DIR ?? join(here, '..', '..', 'data'));
  const c = backupConfig();
  if (!c) {
    console.log('❌ Не настроено: в .env нужны BACKUP_S3_BUCKET, BACKUP_S3_KEY_ID, BACKUP_S3_SECRET, BACKUP_PASSWORD');
    process.exit(1);
  }
  if (cmd === 'now') {
    openDb(dataDir);
    const r = await makeBackup(dataDir);
    console.log(`✅ Копия отправлена: ${c.bucket}/${r.key}, ${Math.round(r.size / 1024)} КБ`);
  } else if (cmd === 'list') {
    const r = await s3(c, 'GET', '', undefined, 'list-type=2&prefix=backups%2F');
    if (!r.ok) throw new Error(await explain(r, c));
    const xml = await r.text();
    const items = [...xml.matchAll(/<Key>([^<]+)<\/Key>[\s\S]*?<Size>(\d+)<\/Size>/g)].map((m) => [m[1], Number(m[2])] as const);
    for (const [k, size] of items.slice(-15)) console.log(`  ${k}  ${Math.round(size / 1024)} КБ`);
    console.log(items.length ? `Всего копий: ${items.length}` : 'Копий пока нет');
  } else if (cmd === 'restore' && arg) {
    const key = arg.startsWith('backups/') ? arg : `backups/${arg}`;
    const r = await s3(c, 'GET', key);
    if (!r.ok) throw new Error(await explain(r, c));
    const db = gunzipSync(decrypt(Buffer.from(await r.arrayBuffer()), c.password));
    const target = out ?? join(dataDir, 'polovinka-restored.db');
    writeFileSync(target, db);
    console.log(`✅ Расшифровано в ${target}. Чтобы вернуть: остановите приложение и замените им polovinka.db (см. docs/DEPLOY.md).`);
  } else {
    console.log('Команды: now | list | restore <имя копии> [файл]');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  cli().catch((e: unknown) => {
    console.log(`❌ ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
