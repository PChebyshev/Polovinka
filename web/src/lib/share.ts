import { APP_NAME } from '@polovinka/shared';

export type ShareResult = 'shared' | 'copied' | 'manual' | 'cancelled';

/** Web Share → буфер обмена → ручное копирование. */
export async function shareText(text: string, title = APP_NAME): Promise<ShareResult> {
  if (typeof navigator !== 'undefined' && 'share' in navigator && window.isSecureContext) {
    try {
      await navigator.share({ title, text });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
    }
  }
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return 'copied';
    } catch {
      /* ниже */
    }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) return 'copied';
  } catch {
    /* ниже */
  }
  return 'manual';
}

export function buzz(pattern: number | number[] = 12) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* не поддерживается */
  }
}
