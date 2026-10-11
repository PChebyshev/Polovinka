import webpush from 'web-push';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { all, one, run, type RoundRow, type UserRow } from './db.js';
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
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:hello@polovinka.local';
  try {
    webpush.setVapidDetails(subject, pub, priv);
    publicKey = pub;
    enabled = true;
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
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 6 * 3600, urgency: 'normal' });
      if (s.failed_at) run('UPDATE push_subscriptions SET failed_at = NULL WHERE id = ?', s.id);
      ok = true;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) run('DELETE FROM push_subscriptions WHERE id = ?', s.id);
      else run('UPDATE push_subscriptions SET failed_at = ? WHERE id = ?', nowIso(), s.id);
    }
  }
  return ok;
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
    const partner = one<UserRow>('SELECT * FROM users WHERE pair_id = ? AND id != ?', u.pair_id, u.id);
    const daily = one<RoundRow>(`SELECT * FROM rounds WHERE pair_id = ? AND date = ? AND kind = 'daily'`, u.pair_id, date);
    const inWindow = (t: string) => now >= minutes(t) && now < minutes(t) + 15;

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
export async function pushReveal(user: UserRow, partnerName: string, same: boolean) {
  if (isOnline(user.id)) return;
  await sendPush(user, 'evening', {
    title: same ? 'Совпали!' : 'Новое открытие',
    body: same ? `Вы с ${partnerName} выбрали одно и то же.` : `Вы с ${partnerName} узнали друг о друге новое.`,
    url: '/',
    tag: 'evening',
  });
}

export function startScheduler() {
  const timer = setInterval(() => {
    tickSchedule().catch(() => undefined);
  }, 60_000);
  timer.unref();
}
