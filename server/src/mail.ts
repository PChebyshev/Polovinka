import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import nodemailer, { type Transporter } from 'nodemailer';

/**
 * Письма: только коды для привязки почты и входа.
 * SMTP задаётся переменными SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.
 * Без них почта выключена и в интерфейсе не показывается.
 * MAIL_TRANSPORT=file пишет письма в DATA_DIR/outbox.jsonl — для тестов.
 */

let transporter: Transporter | null = null;
let fileOutbox: string | null = null;
let from = '';

export function initMail(dataDir: string, log: { info: (s: string) => void; warn: (s: string) => void }) {
  if (process.env.MAIL_TRANSPORT === 'file') {
    fileOutbox = join(dataDir, 'outbox.jsonl');
    from = 'test@localhost';
    log.info(`почта: файловый транспорт ${fileOutbox}`);
    return;
  }
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    log.info('почта: SMTP не настроен, вход по почте выключен');
    return;
  }
  const port = Number(process.env.SMTP_PORT ?? 465);
  from = process.env.SMTP_FROM?.trim() || user;
  transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  transporter.verify().then(
    () => log.info(`почта: SMTP ${host}:${port} готов`),
    (e: unknown) => log.warn(`почта: SMTP ${host}:${port} не отвечает: ${e instanceof Error ? e.message : String(e)}`),
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
  await transporter.sendMail({ from: { name: 'Половинка', address: from }, to, subject, text });
}
