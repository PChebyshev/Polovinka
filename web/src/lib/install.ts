/** Подсказка «Добавить на экран»: ловим beforeinstallprompt, на iOS показываем инструкцию. */

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
  return /iPhone|iPad|iPod/.test(navigator.userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream;
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
    return localStorage.getItem('polovinka.install.dismissed') === '1' || localStorage.getItem('polovinka.installed') === '1';
  } catch {
    return false;
  }
}

export function dismissInstall() {
  try {
    localStorage.setItem('polovinka.install.dismissed', '1');
  } catch {
    /* пусто */
  }
}
