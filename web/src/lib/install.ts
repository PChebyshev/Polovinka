/** Установка на экран «Домой»: beforeinstallprompt на Android, инструкция на iOS. */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const subs = new Set<() => void>();

export function initInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    for (const s of subs) s();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    try {
      localStorage.setItem('polovinka.installed', '1');
    } catch {
      /* пусто */
    }
    for (const s of subs) s();
  });
}

export function onInstallChange(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function isStandalone(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS 13+ представляется Mac'ом, но с тачем.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function isAndroid(): boolean {
  return /Android/.test(navigator.userAgent);
}

export type Platform = 'ios' | 'android' | 'desktop';
export function platform(): Platform {
  if (isIos()) return 'ios';
  if (isAndroid()) return 'android';
  return 'desktop';
}

/** Встроенные браузеры мессенджеров не умеют «На экран „Домой“». */
export function inAppBrowser(): string | null {
  const ua = navigator.userAgent;
  if (/Telegram/i.test(ua)) return 'Telegram';
  if (/WhatsApp/i.test(ua)) return 'WhatsApp';
  if (/Instagram/i.test(ua)) return 'Instagram';
  if (/FBAN|FBAV/i.test(ua)) return 'Facebook';
  if (/VKClient|vkontakte/i.test(ua)) return 'VK';
  if (/YaBrowser|YaApp|YandexSearch/i.test(ua) && isIos()) return null;
  return null;
}

/** Нужна ли вообще инструкция по установке на этом устройстве. */
export function shouldOfferInstall(): boolean {
  return !isStandalone() && platform() !== 'desktop';
}

export function canPrompt(): boolean {
  return deferred !== null;
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable';
  const e = deferred;
  deferred = null;
  await e.prompt();
  const r = await e.userChoice;
  return r.outcome;
}

export function installDismissed(): boolean {
  try {
    if (localStorage.getItem('polovinka.installed') === '1') return true;
    const t = Number(localStorage.getItem('polovinka.install.dismissedAt') ?? 0);
    // Отказ помним три дня, потом мягко предлагаем ещё раз.
    return Date.now() - t < 3 * 86_400_000;
  } catch {
    return false;
  }
}

export function dismissInstall() {
  try {
    localStorage.setItem('polovinka.install.dismissedAt', String(Date.now()));
  } catch {
    /* пусто */
  }
}

/** Адрес запуска установленного приложения — как на сервере (startUrlFor). */
export function startUrlFor(pathname: string, search: string): string {
  const m = pathname.match(/^\/(j|c|f)\/([a-z0-9]{4,16})$/);
  if (m) return `/${m[1]}/${m[2]}`;
  const h = new URLSearchParams(search).get('h');
  if (pathname === '/install' && h && /^[A-Z0-9]{16}$/.test(h)) return `/?h=${h}`;
  return '/';
}

/** При переходах внутри SPA держим ссылку на манифест в соответствии с текущей страницей. */
export function syncManifest(pathname: string, search: string) {
  if (isStandalone()) return;
  const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!link) return;
  const href = `/api/manifest.webmanifest?start=${encodeURIComponent(startUrlFor(pathname, search))}`;
  if (link.getAttribute('href') !== href) link.setAttribute('href', href);
}
