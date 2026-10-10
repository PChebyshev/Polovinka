import { randomBytes, createHash } from 'node:crypto';

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function newId(size = 16): string {
  const bytes = randomBytes(size);
  let out = '';
  for (let i = 0; i < size; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** Короткий код для ссылок: 8 символов без похожих букв. */
export function newCode(size = 8): string {
  return newId(size);
}

export function newToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function nowIso(): string {
  return new Date().toISOString();
}
