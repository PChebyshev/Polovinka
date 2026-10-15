import type { FastifyInstance, FastifyReply } from 'fastify';
import { randomInt } from 'node:crypto';
import { all, one, run, logEvent, type UserRow } from './db.js';
import { hashToken, newId, newToken, nowIso } from './ids.js';
import { requireUser } from './auth.js';
import { mailEnabled, sendMail } from './mail.js';
import type { AccessState } from '../../shared/src/types.js';

/**
 * Доступ к аккаунту без пароля:
 *  - код восстановления: три слова и четыре цифры, хранится только хеш;
 *  - почта: привязка и вход по шестизначному коду из письма;
 *  - выход со всех устройств.
 */

// 256 коротких слов без «ё» и похожих написаний. Порядок менять нельзя: от него не зависит хеш,
// но зависит то, что старые коды остаются валидными при нормализации.
const WORDS = (
  'арбуз берег ветер волна гора дождь дуб ежик жираф закат звезда зима ива иней кино кит клен кот лес лето лимон липа луна мак малина мед море мята небо ночь облако огонь озеро орех осень пальма парк песок пирог поле радуга река роза рябина сад свет снег сосна тополь трава туман утро фонарь хлеб цветок чай чайка шар юг яблоко якорь' +
  ' ананас банан вишня груша дыня инжир какао кефир кокос кофе манго мандарин мята олива персик слива тыква фундук финик хурма черешня чеснок шалфей щавель' +
  ' аист бобр волк выдра гусь дятел енот зебра заяц зубр кабан коала кролик лама лев лиса лось мышь олень орел панда пони рысь сова сокол тигр тюлень улитка утка филин хомяк цапля чиж ящерица' +
  ' автобус багаж вагон веер гитара дверь диван жемчуг зонт карта кисть ключ книга ковер компас кувшин лампа лента лодка марка молоток мост мяч нитка окно очки палатка перо письмо плед подушка ракета ручка свеча скрипка стол сумка тарелка труба фартук флаг часы чашка шапка шкаф шляпа щетка якорь' +
  ' агат бирюза гранат жемчуг изумруд кварц коралл лазурь малахит нефрит оникс опал рубин сапфир топаз турмалин хрусталь янтарь яшма' +
  ' бархат бусы вальс венок гамак дудка искра калина кедр кленок колос комета крыло лаванда ландыш лотос мандола метель мираж нарцисс обруч пион полынь прибой пряник ромашка роща сирень сказка смола сугроб тайга туча фиалка хвоя шелк шиповник эхо юла' +
  ' абрикос аллея атлас балкон бамбук барсук беседка бисер бриз булка бухта ваза валун вафля вереск вишня газон гвоздика гейзер глобус голубь горох град гроздь гром дельфин долина дорога дудочка желудь жаворонок жук заводь залив зефир ирис камин канат капля каштан кисель клубника кольцо корица крыльцо кубик ландыш ласточка лист луг лужайка мандолина маяк мельница мозаика морошка муравей невод облепиха овраг огород омлет опушка остров пекарня пеликан перрон пихта плотина поляна порог пруд пчела ракушка рассвет ручей рюкзак сверчок север сироп скамейка снегирь солома стрекоза сундук тюльпан фазан фонтан хворост цикада черника шмель шторм щегол эклер юрта ягода'
)
  .split(/\s+/)
  .filter((w, i, a) => w && a.indexOf(w) === i);

const WORD_COUNT = 256;
if (WORDS.length < WORD_COUNT) throw new Error(`access: нужно ${WORD_COUNT} слов, есть ${WORDS.length}`);
const DICT = WORDS.slice(0, WORD_COUNT);

export function newRecoveryPhrase(): string {
  const words = [0, 1, 2].map(() => DICT[randomInt(WORD_COUNT)]);
  const digits = String(randomInt(10_000)).padStart(4, '0');
  return [...words, digits].join('-');
}

/** Нормализация ввода: регистр, ё, пробелы и любые разделители. */
export function normalizePhrase(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const parts = raw
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/[^a-zа-я0-9]+/)
    .filter(Boolean);
  if (parts.length !== 4) return null;
  if (!parts.slice(0, 3).every((w) => /^[а-я]+$/.test(w)) || !/^\d{4}$/.test(parts[3])) return null;
  return parts.join('-');
}

export function looksLikePhrase(raw: unknown): boolean {
  return normalizePhrase(raw) !== null;
}

const RECOVERY_HASH_PREFIX = 'r1:';
function hashPhrase(phrase: string): string {
  return RECOVERY_HASH_PREFIX + hashToken('recovery:' + phrase);
}

// --- Почта --------------------------------------------------------------------

const EMAIL_CODE_TTL_MIN = 15;
const EMAIL_CODE_MAX_ATTEMPTS = 5;

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const e = raw.trim().toLowerCase();
  if (e.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return null;
  return e;
}

function newDigits(): string {
  return String(randomInt(1_000_000)).padStart(6, '0');
}

function maskEmail(e: string): string {
  const [u, d] = e.split('@');
  return `${u.slice(0, 2)}${'•'.repeat(Math.max(1, u.length - 2))}@${d}`;
}

interface EmailCodeRow {
  id: string;
  user_id: string | null;
  email: string;
  code_hash: string;
  purpose: string;
  attempts: number;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

async function issueEmailCode(email: string, purpose: 'bind' | 'login', userId: string | null, name: string | null) {
  run('DELETE FROM email_codes WHERE expires_at < ?', nowIso());
  run('DELETE FROM email_codes WHERE email = ? AND purpose = ? AND used_at IS NULL', email, purpose);
  const code = newDigits();
  const expires = new Date(Date.now() + EMAIL_CODE_TTL_MIN * 60_000).toISOString();
  run(
    'INSERT INTO email_codes (id, user_id, email, code_hash, purpose, attempts, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, NULL, ?)',
    newId(),
    userId,
    email,
    hashToken('email:' + code),
    purpose,
    expires,
    nowIso(),
  );
  const greeting = name ? `${name}, ` : '';
  const what = purpose === 'bind' ? 'чтобы привязать почту к Половинке' : 'для входа в Половинку';
  await sendMail(
    email,
    `${code} — код ${purpose === 'bind' ? 'для привязки почты' : 'для входа'} · Половинка`,
    `${greeting}ваш код ${what}:\n\n${code}\n\nОн действует ${EMAIL_CODE_TTL_MIN} минут. Если вы ничего не запрашивали, просто не обращайте внимания на это письмо.\n\n— Половинка, polovinka.online`,
  );
}

/** Проверяет код: верный — помечает использованным, неверный — считает попытки. */
function checkEmailCode(email: string, purpose: 'bind' | 'login', raw: unknown): { ok: true; row: EmailCodeRow } | { ok: false; reason: 'code_invalid' | 'code_expired' | 'too_many_attempts' } {
  const code = typeof raw === 'string' ? raw.replace(/\D/g, '') : '';
  const row = one<EmailCodeRow>('SELECT * FROM email_codes WHERE email = ? AND purpose = ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1', email, purpose);
  if (!row) return { ok: false, reason: 'code_expired' };
  if (row.expires_at < nowIso()) return { ok: false, reason: 'code_expired' };
  if (row.attempts >= EMAIL_CODE_MAX_ATTEMPTS) return { ok: false, reason: 'too_many_attempts' };
  if (code.length !== 6 || hashToken('email:' + code) !== row.code_hash) {
    run('UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?', row.id);
    return { ok: false, reason: row.attempts + 1 >= EMAIL_CODE_MAX_ATTEMPTS ? 'too_many_attempts' : 'code_invalid' };
  }
  run('UPDATE email_codes SET used_at = ? WHERE id = ?', nowIso(), row.id);
  return { ok: true, row };
}

// --- Ограничение попыток ------------------------------------------------------

const buckets = new Map<string, number[]>();
function limited(key: string, max: number, windowMin: number): boolean {
  const now = Date.now();
  const list = (buckets.get(key) ?? []).filter((t) => now - t < windowMin * 60_000);
  list.push(now);
  buckets.set(key, list);
  if (buckets.size > 10_000) buckets.clear();
  return list.length > max;
}

function tooMany(reply: FastifyReply) {
  return reply.code(429).send({ error: 'too_many_attempts' });
}

/** Новый токен для текущего устройства. */
function issueToken(user: UserRow): string {
  const token = newToken();
  run('INSERT INTO user_tokens (token_hash, user_id, created_at) VALUES (?, ?, ?)', hashToken(token), user.id, nowIso());
  return token;
}


export function accessState(user: UserRow): AccessState {
  return {
    email: user.email ?? null,
    emailEnabled: mailEnabled(),
    hasRecovery: !!user.recovery_hash,
    recoveryCreatedAt: user.recovery_created_at ?? null,
  };
}

export async function registerAccessRoutes(app: FastifyInstance, deps: { meResponse: (u: UserRow) => unknown }) {
  /** Публичные настройки для экрана входа. */
  app.get('/api/config', async () => ({ emailLogin: mailEnabled() }));

  // --- Код восстановления -------------------------------------------------------

  app.post('/api/recovery', { preHandler: requireUser }, async (req) => {
    const user = req.user!;
    const phrase = newRecoveryPhrase();
    const ts = nowIso();
    run('UPDATE users SET recovery_hash = ?, recovery_created_at = ? WHERE id = ?', hashPhrase(phrase), ts, user.id);
    logEvent('recovery_created', { pairId: user.pair_id, userId: user.id });
    return { phrase, createdAt: ts };
  });

  app.post('/api/recovery/redeem', async (req, reply) => {
    if (limited('rec:' + req.ip, 8, 10)) return tooMany(reply);
    const phrase = normalizePhrase(((req.body ?? {}) as { phrase?: unknown }).phrase);
    if (!phrase) return reply.code(400).send({ error: 'phrase' });
    const user = one<UserRow>('SELECT * FROM users WHERE recovery_hash = ?', hashPhrase(phrase));
    if (!user) return reply.code(404).send({ error: 'phrase_invalid' });
    const token = issueToken(user);
    logEvent('recovery_redeemed', { pairId: user.pair_id, userId: user.id });
    return { token, me: deps.meResponse(user) };
  });

  // --- Выход со всех устройств ----------------------------------------------------

  app.post('/api/sessions/revoke', { preHandler: requireUser }, async (req) => {
    const user = req.user!;
    const token = newToken();
    run('DELETE FROM user_tokens WHERE user_id = ?', user.id);
    run('DELETE FROM login_codes WHERE user_id = ?', user.id);
    run('DELETE FROM push_subscriptions WHERE user_id = ?', user.id);
    run('UPDATE users SET token_hash = ? WHERE id = ?', hashToken(token), user.id);
    logEvent('sessions_revoked', { pairId: user.pair_id, userId: user.id });
    const fresh = one<UserRow>('SELECT * FROM users WHERE id = ?', user.id)!;
    return { token, me: deps.meResponse(fresh) };
  });

  // --- Почта ----------------------------------------------------------------------

  app.post('/api/email/bind', { preHandler: requireUser }, async (req, reply) => {
    if (!mailEnabled()) return reply.code(404).send({ error: 'mail_disabled' });
    const user = req.user!;
    const email = normalizeEmail(((req.body ?? {}) as { email?: unknown }).email);
    if (!email) return reply.code(400).send({ error: 'email' });
    if (limited('bind:' + user.id, 3, 10) || limited('mail:' + req.ip, 10, 10)) return tooMany(reply);
    const taken = one<{ id: string }>('SELECT id FROM users WHERE email = ? AND id <> ?', email, user.id);
    if (taken) return reply.code(409).send({ error: 'email_taken' });
    await issueEmailCode(email, 'bind', user.id, user.name);
    return { ok: true, email, masked: maskEmail(email) };
  });

  app.post('/api/email/bind/confirm', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const body = (req.body ?? {}) as { email?: unknown; code?: unknown };
    const email = normalizeEmail(body.email);
    if (!email) return reply.code(400).send({ error: 'email' });
    const r = checkEmailCode(email, 'bind', body.code);
    if (!r.ok) return reply.code(r.reason === 'too_many_attempts' ? 429 : 404).send({ error: r.reason });
    if (r.row.user_id !== user.id) return reply.code(404).send({ error: 'code_invalid' });
    const taken = one<{ id: string }>('SELECT id FROM users WHERE email = ? AND id <> ?', email, user.id);
    if (taken) return reply.code(409).send({ error: 'email_taken' });
    run('UPDATE users SET email = ?, email_verified_at = ? WHERE id = ?', email, nowIso(), user.id);
    logEvent('email_bound', { pairId: user.pair_id, userId: user.id });
    return deps.meResponse(one<UserRow>('SELECT * FROM users WHERE id = ?', user.id)!);
  });

  app.delete('/api/email', { preHandler: requireUser }, async (req) => {
    const user = req.user!;
    run('UPDATE users SET email = NULL, email_verified_at = NULL WHERE id = ?', user.id);
    return deps.meResponse(one<UserRow>('SELECT * FROM users WHERE id = ?', user.id)!);
  });

  /** Вход по почте: ответ одинаковый, есть такая почта или нет. */
  app.post('/api/email/login', async (req, reply) => {
    if (!mailEnabled()) return reply.code(404).send({ error: 'mail_disabled' });
    const email = normalizeEmail(((req.body ?? {}) as { email?: unknown }).email);
    if (!email) return reply.code(400).send({ error: 'email' });
    if (limited('login:' + email, 3, 10) || limited('mail:' + req.ip, 10, 10)) return tooMany(reply);
    const user = one<UserRow>('SELECT * FROM users WHERE email = ?', email);
    if (user) await issueEmailCode(email, 'login', user.id, user.name);
    return { ok: true };
  });

  app.post('/api/email/login/confirm', async (req, reply) => {
    if (limited('conf:' + req.ip, 15, 10)) return tooMany(reply);
    const body = (req.body ?? {}) as { email?: unknown; code?: unknown };
    const email = normalizeEmail(body.email);
    if (!email) return reply.code(400).send({ error: 'email' });
    const r = checkEmailCode(email, 'login', body.code);
    if (!r.ok) return reply.code(r.reason === 'too_many_attempts' ? 429 : 404).send({ error: r.reason });
    const user = r.row.user_id ? one<UserRow>('SELECT * FROM users WHERE id = ? AND email = ?', r.row.user_id, email) : undefined;
    if (!user) return reply.code(404).send({ error: 'code_invalid' });
    const token = issueToken(user);
    logEvent('email_login', { pairId: user.pair_id, userId: user.id });
    return { token, me: deps.meResponse(user) };
  });

  /** Сколько устройств вошли (для текста в настройках). */
  app.get('/api/sessions', { preHandler: requireUser }, async (req) => {
    const n = all<{ n: number }>('SELECT COUNT(*) AS n FROM user_tokens WHERE user_id = ?', req.user!.id)[0]?.n ?? 0;
    return { devices: Number(n) + 1 };
  });
}
