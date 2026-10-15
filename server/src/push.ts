import webpush from 'web-push';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { all, one, run, type PairRow, type UserRow } from './db.js';
import { ensureDaily } from './selection.js';
import { dateInTz } from './time.js';
import { isOnline } from './sse.js';
import { nowIso } from './ids.js';

interface SubRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  failed_at: string | null;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

let publicKey = '';
let enabled = false;
let logger: { info: (s: string) => void; warn: (s: string) => void } = console;

/** Сервис доставки по адресу подписки — без самого адреса. */
function serviceOf(endpoint: string): string {
  try {
    const h = new URL(endpoint).hostname;
    if (h.endsWith('push.apple.com')) return 'apple';
    if (h.endsWith('googleapis.com')) return 'google';
    if (h.includes('mozilla')) return 'mozilla';
    if (h.includes('windows') || h.includes('microsoft')) return 'microsoft';
    return h;
  } catch {
    return 'unknown';
  }
}

function logPush(userId: string, kind: string, endpoint: string, status: number, ok: boolean, reason: string | null) {
  run(
    'INSERT INTO push_log (user_id, kind, service, status, ok, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    userId,
    kind,
    serviceOf(endpoint),
    status,
    ok ? 1 : 0,
    reason ? reason.slice(0, 200) : null,
    nowIso(),
  );
  // Журнал не растёт бесконечно.
  run("DELETE FROM push_log WHERE created_at < datetime('now', '-30 days')");
  if (!ok) logger.warn(`push ${kind} → ${serviceOf(endpoint)}: ${status} ${reason ?? ''}`);
}

function errInfo(e: unknown): { status: number; reason: string } {
  const err = e as { statusCode?: number; body?: string; message?: string };
  return { status: err.statusCode ?? 0, reason: (err.body || err.message || 'ошибка сети').toString().trim() };
}

/**
 * Тема (subject) для VAPID. Apple отвергает адреса без настоящего домена,
 * поэтому example.com, localhost и .local заменяем на адрес сайта.
 */
function vapidSubject(): string {
  const site = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
  const raw = (process.env.VAPID_SUBJECT ?? '').trim();
  const m = raw.match(/^mailto:([^\s<>@]+)@([^\s<>@]+\.[a-z]{2,})$/i);
  const badDomain = m && /(^|\.)(example\.(com|org|net)|localhost|local)$/i.test(m[2]);
  if (m && !badDomain) return `mailto:${m[1]}@${m[2]}`;
  if (/^https:\/\/[^\s]+$/.test(raw)) return raw;
  if (/^https:\/\/[^\s/]+\.[a-z]{2,}/i.test(site) && !/localhost/.test(site)) return site;
  return 'https://polovinka.online';
}

/** Ключи VAPID: из окружения или из файла в каталоге данных (создаются один раз). */
export function initPush(dataDir: string, log: { info: (s: string) => void; warn: (s: string) => void }) {
  let pub = process.env.VAPID_PUBLIC_KEY;
  let priv = process.env.VAPID_PRIVATE_KEY;
  const file = join(dataDir, 'vapid.json');
  if (!pub || !priv) {
    if (existsSync(file)) {
      const j = JSON.parse(readFileSync(file, 'utf8')) as { publicKey: string; privateKey: string };
      pub = j.publicKey;
      priv = j.privateKey;
    } else {
      const k = webpush.generateVAPIDKeys();
      writeFileSync(file, JSON.stringify({ publicKey: k.publicKey, privateKey: k.privateKey }), { mode: 0o600 });
      pub = k.publicKey;
      priv = k.privateKey;
      log.info('Сгенерированы VAPID-ключи для push: ' + file);
    }
  }
  logger = log;
  const subject = vapidSubject();
  try {
    webpush.setVapidDetails(subject, pub, priv);
    publicKey = pub;
    enabled = true;
    log.info(`Push включён, отправитель: ${subject}`);
  } catch (e) {
    log.warn('Push выключен: ' + (e as Error).message);
  }
}

export function pushPublicKey(): string {
  return publicKey;
}

export function pushEnabled(): boolean {
  return enabled;
}

const MAX_PER_DAY = 2;

/** Сколько уведомлений уже ушло пользователю сегодня (утро + вечер). */
function sentToday(userId: string, date: string): number {
  const r = one<{ n: number }>(`SELECT COUNT(*) AS n FROM notification_log WHERE user_id = ? AND date = ? AND kind IN ('morning', 'evening')`, userId, date);
  return Number(r?.n ?? 0);
}

/** Отправляет push пользователю, уважая лимит два в день. kind пишется в журнал. */
export async function sendPush(user: UserRow, kind: 'morning' | 'evening', payload: PushPayload): Promise<boolean> {
  if (!enabled || !user.notif_enabled) return false;
  const date = dateInTz(user.tz);
  const already = one('SELECT 1 FROM notification_log WHERE user_id = ? AND date = ? AND kind = ?', user.id, date, kind);
  if (already || sentToday(user.id, date) >= MAX_PER_DAY) return false;
  const subs = all<SubRow>('SELECT * FROM push_subscriptions WHERE user_id = ?', user.id);
  if (subs.length === 0) return false;
  run('INSERT OR IGNORE INTO notification_log (user_id, date, kind, created_at) VALUES (?, ?, ?, ?)', user.id, date, kind, nowIso());
  let ok = false;
  for (const s of subs) {
    try {
      const res = await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 6 * 3600, urgency: 'normal' });
      if (s.failed_at) run('UPDATE push_subscriptions SET failed_at = NULL WHERE id = ?', s.id);
      logPush(user.id, kind, s.endpoint, res.statusCode, true, null);
      ok = true;
    } catch (e) {
      const { status, reason } = errInfo(e);
      logPush(user.id, kind, s.endpoint, status, false, reason);
      if (status === 404 || status === 410) run('DELETE FROM push_subscriptions WHERE id = ?', s.id);
      else run('UPDATE push_subscriptions SET failed_at = ? WHERE id = ?', nowIso(), s.id);
    }
  }
  return ok;
}

/** Пробное уведомление по кнопке в настройках: без дневного лимита, но не чаще раза в 30 секунд. */
const lastTest = new Map<string, number>();
export async function sendTestPush(user: UserRow): Promise<{ sent: number; failed: number; statuses: number[]; reasons: string[]; tooSoon?: boolean }> {
  const now = Date.now();
  if (now - (lastTest.get(user.id) ?? 0) < 30_000) return { sent: 0, failed: 0, statuses: [], reasons: [], tooSoon: true };
  lastTest.set(user.id, now);
  const subs = all<SubRow>('SELECT * FROM push_subscriptions WHERE user_id = ?', user.id);
  let sent = 0;
  let failed = 0;
  const statuses: number[] = [];
  const reasons: string[] = [];
  for (const s of subs) {
    try {
      const res = await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title: 'Половинка', body: 'Уведомления работают. Утром — вопрос, вечером — раскрытие.', url: '/settings', tag: 'test' }),
        { TTL: 600, urgency: 'high' },
      );
      if (s.failed_at) run('UPDATE push_subscriptions SET failed_at = NULL WHERE id = ?', s.id);
      logPush(user.id, 'test', s.endpoint, res.statusCode, true, null);
      sent++;
    } catch (e) {
      failed++;
      const { status, reason } = errInfo(e);
      statuses.push(status);
      reasons.push(reason.slice(0, 120));
      logPush(user.id, 'test', s.endpoint, status, false, reason);
      if (status === 404 || status === 410) run('DELETE FROM push_subscriptions WHERE id = ?', s.id);
    }
  }
  return { sent, failed, statuses, reasons };
}

function hhmm(tz: string): string {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
  return f.format(new Date()).replace('24', '00');
}

function minutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function stripColon(s: string): string {
  return s.replace(/[:：]\s*$/, '');
}

/** Раз в минуту: утренний вопрос и вечернее раскрытие по времени каждого пользователя. */
export async function tickSchedule() {
  if (!enabled) return;
  const users = all<UserRow>(`SELECT u.* FROM users u WHERE u.notif_enabled = 1 AND EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = u.id)`);
  for (const u of users) {
    const now = minutes(hhmm(u.tz));
    const date = dateInTz(u.tz);
    const inWindow = (t: string) => now >= minutes(t) && now < minutes(t) + 15;
    if (!inWindow(u.notif_morning) && !inWindow(u.notif_evening)) continue;
    const pair = one<PairRow>('SELECT * FROM pairs WHERE id = ?', u.pair_id);
    if (!pair || pair.is_guest) continue;
    const partner = one<UserRow>('SELECT * FROM users WHERE pair_id = ? AND id != ?', u.pair_id, u.id);
    // Вопрос дня создаётся при первом открытии приложения. Утром его может ещё не быть — создаём сами.
    const daily = ensureDaily(pair, dateInTz(pair.tz));

    if (inWindow(u.notif_morning)) {
      const answered = daily ? one('SELECT 1 FROM answers WHERE round_id = ? AND user_id = ?', daily.id, u.id) : null;
      if (daily && !answered && !isOnline(u.id)) {
        const q = one<{ text: string }>('SELECT text FROM questions WHERE id = ?', daily.question_id);
        await sendPush(u, 'morning', {
          title: 'Вопрос дня ждёт',
          body: q ? `«${stripColon(q.text.replaceAll('{me}', u.name).replaceAll('{partner}', partner?.name ?? 'половинка'))}» — это 20 секунд.` : 'Два тапа, и вы на шаг ближе.',
          url: '/',
          tag: 'morning',
        });
      }
    }

    if (inWindow(u.notif_evening) && daily) {
      const mine = one('SELECT 1 FROM answers WHERE round_id = ? AND user_id = ?', daily.id, u.id);
      if (daily.status === 'revealed') {
        await sendPush(u, 'evening', {
          title: 'Раскрытие готово',
          body: partner ? `Посмотрите, совпали ли вы с ${partner.name} сегодня.` : 'Посмотрите, совпали ли вы сегодня.',
          url: '/',
          tag: 'evening',
        });
      } else if (!mine && !isOnline(u.id)) {
        await sendPush(u, 'evening', {
          title: 'Вопрос дня ещё ждёт',
          body: partner ? `${partner.name} уже ответил(а). Ваш ответ — и будет раскрытие.` : 'Ответьте, когда будет минутка. Вопрос никуда не денется.',
          url: '/',
          tag: 'evening',
        });
      }
    }
  }
}

/** Мгновенный push о раскрытии тому, кто не в приложении. Занимает вечерний слот. */
export async function pushReveal(user: UserRow, partnerName: string, hits: { iGuessed: boolean; theyGuessed: boolean }) {
  if (isOnline(user.id)) return;
  const body =
    hits.iGuessed && hits.theyGuessed
      ? `Вы с ${partnerName} угадали друг друга. Посмотрите.`
      : hits.iGuessed
        ? `Ваша догадка про ${partnerName} — в точку. А что выбрали вы — сюрприз.`
        : hits.theyGuessed
          ? `${partnerName} знает ваш ответ. Посмотрите, что выбрали вы оба.`
          : `Вы узнали друг о друге новое. Посмотрите.`;
  await sendPush(user, 'evening', { title: 'Раскрытие готово', body, url: '/', tag: 'evening' });
}

/**
 * Партнёр ответил первым: зовём второго. Занимает утренний слот, чтобы в сумме
 * оставалось не больше двух уведомлений в день; если утреннее уже ушло — молчим.
 */
export async function pushPartnerAnswered(user: UserRow, partnerName: string, questionText: string) {
  if (isOnline(user.id)) return;
  await sendPush(user, 'morning', {
    title: `${partnerName} уже ответил(а)`,
    body: `«${stripColon(questionText)}» — ваш ответ, и будет раскрытие. Это 20 секунд.`,
    url: '/',
    tag: 'morning',
  });
}

export function startScheduler() {
  const timer = setInterval(() => {
    tickSchedule().catch(() => undefined);
  }, 60_000);
  timer.unref();
}
