import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import nodemailer, { type Transporter } from 'nodemailer';

/**
 * Письма: только коды для привязки почты и входа.
 * SMTP задаётся переменными SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.
 * Без них почта выключена и в интерфейсе не показывается.
 * MAIL_TRANSPORT=file пишет письма в DATA_DIR/outbox.jsonl — для тестов.
 * Проверка настроек на сервере: node server/dist/server/src/mailcheck.js адрес@для.теста
 */

let transporter: Transporter | null = null;
let fileOutbox: string | null = null;
let from = '';

/** Убирает то, что часто прилипает при копировании с телефона: пробелы, кавычки (в т. ч. «ёлочки» и ‘’). */
function clean(v: string | undefined, { inner = false } = {}): string {
  let s = (v ?? '').trim().replace(/^["'‘’“”«»]+|["'‘’“”«»]+$/g, '');
  // Пароли приложений показывают группами через пробел — сервер ждёт их слитно
  if (inner) s = s.replace(/\s+/g, '');
  return s.trim();
}

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

export function smtpConfig(): SmtpConfig | null {
  const host = clean(process.env.SMTP_HOST);
  const user = clean(process.env.SMTP_USER, { inner: true });
  const pass = clean(process.env.SMTP_PASS, { inner: true });
  if (!host || !user || !pass) return null;
  const port = Number(clean(process.env.SMTP_PORT) || 465);
  return { host, port, user, pass, from: clean(process.env.SMTP_FROM, { inner: true }) || user };
}

export function createSmtp(c: SmtpConfig, port = c.port): Transporter {
  return nodemailer.createTransport({
    host: c.host,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user: c.user, pass: c.pass },
    // По умолчанию nodemailer ждёт до двух минут — человек столько не просидит на экране
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

/** Сетевая ли ошибка (порт закрыт или недоступен), а не отказ сервера. */
export function isNetworkError(e: unknown): boolean {
  const code = (e as { code?: string })?.code ?? '';
  return ['ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'ESOCKET', 'ECONNECTION', 'EDNS'].includes(code);
}

/** Понятное объяснение ошибки SMTP. */
export function explainSmtpError(e: unknown): string {
  const err = e as { code?: string; responseCode?: number; response?: string; message?: string };
  const raw = err.response || err.message || String(e);
  if (err.code === 'EAUTH' || err.responseCode === 535)
    return `сервер не принял логин или пароль (${raw}). Нужен пароль для внешних приложений, а не обычный; SMTP_USER — полный адрес ящика`;
  if (err.code === 'EDNS') return `не найден сервер ${raw}: проверьте SMTP_HOST`;
  if (isNetworkError(e)) return `нет соединения (${err.code}): похоже, хостинг закрывает исходящие почтовые порты`;
  if (err.responseCode === 550 || err.responseCode === 553 || err.responseCode === 554)
    return `сервер отклонил письмо (${raw}). Проверьте, что SMTP_FROM совпадает с SMTP_USER, и что ящик не заблокирован`;
  return raw;
}

export function initMail(dataDir: string, log: { info: (s: string) => void; warn: (s: string) => void }) {
  if (process.env.MAIL_TRANSPORT === 'file') {
    fileOutbox = join(dataDir, 'outbox.jsonl');
    from = 'test@localhost';
    log.info(`почта: файловый транспорт ${fileOutbox}`);
    return;
  }
  const c = smtpConfig();
  if (!c) {
    log.info('почта: SMTP не настроен, вход по почте выключен');
    return;
  }
  from = c.from;
  transporter = createSmtp(c);
  transporter.verify().then(
    () => log.info(`почта: SMTP ${c.host}:${c.port} готов`),
    async (e: unknown) => {
      log.warn(`почта: SMTP ${c.host}:${c.port} — ${explainSmtpError(e)}`);
      // Порт закрыт — пробуем второй стандартный (465 ↔ 587)
      if (!isNetworkError(e)) return;
      const alt = c.port === 465 ? 587 : 465;
      const t = createSmtp(c, alt);
      try {
        await t.verify();
        transporter = t;
        log.info(`почта: SMTP ${c.host}:${alt} готов (порт ${c.port} недоступен, переключились)`);
      } catch (e2) {
        log.warn(`почта: SMTP ${c.host}:${alt} тоже не работает — ${explainSmtpError(e2)}`);
      }
    },
  );
}

export function mailEnabled(): boolean {
  return transporter !== null || fileOutbox !== null;
}

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  if (fileOutbox) {
    appendFileSync(fileOutbox, JSON.stringify({ to, subject, text, at: new Date().toISOString() }) + '\n');
    return;
  }
  if (!transporter) throw new Error('mail_disabled');
  try {
    await transporter.sendMail({ from: { name: 'Половинка', address: from }, to, subject, text });
  } catch (e) {
    throw new Error(explainSmtpError(e));
  }
}
