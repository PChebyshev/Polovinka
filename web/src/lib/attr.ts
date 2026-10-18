import { isStandalone } from './install';

/**
 * Откуда пришёл человек: рекламная ссылка /a/<код> или utm-метки.
 * Запоминаем первый переход на 30 дней и передаём его при регистрации.
 */

const KEY = 'polovinka.attr';
const VKEY = 'polovinka.visitor';
const DAYS = 30;

function visitorId(): string {
  try {
    let v = localStorage.getItem(VKEY);
    if (!v) {
      v = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
      localStorage.setItem(VKEY, v);
    }
    return v;
  } catch {
    return Math.random().toString(36).slice(2, 14).padEnd(12, 'x');
  }
}

export function storedAttr(): { code: string; at: number } | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const a = JSON.parse(raw) as { code: string; at: number };
    return Date.now() - a.at < DAYS * 86_400_000 ? a : null;
  } catch {
    return null;
  }
}

/** Отмечает переход. Возвращает код кампании, если он есть, — чтобы перевести utm-ссылку в /a/<код>. */
export async function captureAttribution(pathname: string, search: string): Promise<string | null> {
  const m = pathname.match(/^\/a\/([a-z0-9]{4,16})$/);
  const q = new URLSearchParams(search);
  const utm = q.get('utm_source') ? { source: q.get('utm_source'), campaign: q.get('utm_campaign'), content: q.get('utm_content') } : null;
  if (!m && !utm) return null;
  const once = `polovinka.attr.sent.${m?.[1] ?? q.toString()}`;
  try {
    if (sessionStorage.getItem(once)) return m?.[1] ?? null;
    sessionStorage.setItem(once, '1');
  } catch {
    /* приватный режим */
  }
  try {
    const res = await fetch('/api/attr/visit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: m?.[1], utm, visitor: visitorId(), standalone: isStandalone() }),
    });
    const { code } = (await res.json()) as { code: string | null };
    if (code && !storedAttr()) localStorage.setItem(KEY, JSON.stringify({ code, at: Date.now() }));
    return code;
  } catch {
    return null;
  }
}
