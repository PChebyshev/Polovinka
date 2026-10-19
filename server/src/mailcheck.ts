import { connect } from 'node:net';
import { createSmtp, explainSmtpError, smtpConfig } from './mail.js';

/**
 * Проверка почты на сервере, по шагам: настройки → сеть → логин → тестовое письмо.
 *   docker compose exec app node server/dist/server/src/mailcheck.js адрес@для.теста
 * Пароль не печатается — только длина и подозрительные символы.
 */

const ok = (s: string) => console.log(`  ✅ ${s}`);
const bad = (s: string) => console.log(`  ❌ ${s}`);
const warn = (s: string) => console.log(`  ⚠️  ${s}`);

function tcp(host: string, port: number): Promise<string | null> {
  return new Promise((resolve) => {
    const s = connect({ host, port, timeout: 7000 });
    s.once('connect', () => {
      s.destroy();
      resolve(null);
    });
    s.once('timeout', () => {
      s.destroy();
      resolve('нет ответа за 7 с');
    });
    s.once('error', (e: NodeJS.ErrnoException) => resolve(e.code ?? e.message));
  });
}

async function main() {
  const to = process.argv[2];
  console.log('\n1. Настройки');
  const rawPass = process.env.SMTP_PASS ?? '';
  for (const k of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_FROM']) {
    const v = process.env[k] ?? '';
    console.log(`  ${k} = ${v ? JSON.stringify(v) : '(пусто)'}`);
  }
  console.log(`  SMTP_PASS = ${rawPass ? `задан, ${rawPass.length} символов` : '(пусто)'}`);
  if (/^\s|\s$/.test(rawPass)) warn('в пароле пробелы по краям — уберу их сам, но лучше поправить .env');
  if (/["'‘’“”«»]/.test(rawPass)) warn('в пароле кавычки — скорее всего, телефон заменил прямые кавычки на «умные». Уберите их в .env');
  const c = smtpConfig();
  if (!c) {
    bad('не хватает SMTP_HOST, SMTP_USER или SMTP_PASS. Проверьте /opt/polovinka/.env и перезапустите install.sh');
    process.exit(1);
  }
  if (c.from !== c.user) warn(`SMTP_FROM (${c.from}) не совпадает с SMTP_USER (${c.user}) — Mail.ru и Яндекс такое отклоняют`);
  if (!c.user.includes('@')) warn('SMTP_USER должен быть полным адресом ящика, с @');

  console.log('\n2. Сеть: открыты ли почтовые порты');
  const open: number[] = [];
  for (const port of [465, 587]) {
    const e = await tcp(c.host, port);
    if (e === 'ENOTFOUND' || e === 'EAI_AGAIN') {
      bad(`сервер ${c.host} не найден (${e}): проверьте SMTP_HOST — для Mail.ru это smtp.mail.ru`);
      process.exit(1);
    }
    if (e) bad(`${c.host}:${port} — ${e}`);
    else {
      ok(`${c.host}:${port} открыт`);
      open.push(port);
    }
  }
  if (open.length === 0) {
    bad(
      'оба порта закрыты: хостинг блокирует исходящую почту. Напишите в поддержку Timeweb: «Прошу открыть исходящие порты 465 и 587 для отправки писем с кодами подтверждения через smtp.mail.ru»',
    );
    process.exit(1);
  }

  console.log('\n3. Вход в ящик');
  const ports = open.includes(c.port) ? [c.port, ...open.filter((p) => p !== c.port)] : open;
  let working: number | null = null;
  for (const port of ports) {
    try {
      await createSmtp(c, port).verify();
      ok(`порт ${port}: логин и пароль приняты`);
      working = port;
      break;
    } catch (e) {
      bad(`порт ${port}: ${explainSmtpError(e)}`);
    }
  }
  if (working === null) process.exit(1);
  if (working !== c.port) warn(`в .env указан порт ${c.port}, а работает ${working}. Приложение переключится само, но лучше записать SMTP_PORT=${working}`);

  if (!to) {
    console.log('\nВсё готово. Чтобы отправить тестовое письмо, добавьте адрес в конце команды.\n');
    return;
  }
  console.log(`\n4. Тестовое письмо на ${to}`);
  try {
    const info = await createSmtp(c, working).sendMail({
      from: { name: 'Половинка', address: c.from },
      to,
      subject: 'Проверка почты · Половинка',
      text: 'Если вы видите это письмо, отправка кодов работает.\n\n— Половинка, polovinka.online',
    });
    ok(`отправлено (${info.response}). Если письма нет во «Входящих» — загляните в «Спам»`);
  } catch (e) {
    bad(explainSmtpError(e));
    process.exit(1);
  }
  console.log('');
}

void main();
