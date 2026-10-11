import { api, getToken } from './api';
import { flushQueue, saveTokenForSw } from './queue';

type Listener = (sent: number) => void;
const listeners = new Set<Listener>();

export function onFlushed(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let flushing = false;
export async function flushNow(): Promise<void> {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  try {
    const sent = await flushQueue(getToken());
    if (sent > 0) {
      void api.track('offline_flushed');
      for (const l of listeners) l(sent);
    }
  } finally {
    flushing = false;
  }
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  void saveTokenForSw(getToken());
  navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  navigator.serviceWorker.addEventListener('message', (e) => {
    const d = e.data as { type?: string; sent?: number };
    if (d?.type === 'flushed') for (const l of listeners) l(d.sent ?? 0);
  });
  window.addEventListener('online', () => void flushNow());
  void flushNow();
}

// --- Push ----------------------------------------------------------------------

export type PushSupport = 'ok' | 'unsupported' | 'needs_install' | 'denied' | 'insecure';

export function pushSupport(): PushSupport {
  if (!window.isSecureContext) return 'insecure';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    // iOS Safari даёт push только установленному на экран PWA.
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const standalone = (navigator as unknown as { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches;
    return ios && !standalone ? 'needs_install' : 'unsupported';
  }
  if (Notification.permission === 'denied') return 'denied';
  return 'ok';
}

function b64ToBytes(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function subscribePush(): Promise<'ok' | 'denied' | 'error'> {
  try {
    const { key, enabled } = await api.pushKey();
    if (!enabled || !key) return 'error';
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return 'denied';
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) as BufferSource }));
    const j = sub.toJSON();
    await api.pushSubscribe({ endpoint: sub.endpoint, keys: { p256dh: j.keys?.p256dh ?? '', auth: j.keys?.auth ?? '' } });
    return 'ok';
  } catch {
    return 'error';
  }
}

export async function unsubscribePush(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api.pushUnsubscribe(sub.endpoint);
      await sub.unsubscribe();
    } else {
      await api.pushUnsubscribe();
    }
  } catch {
    /* пусто */
  }
}

export async function hasPushSubscription(): Promise<boolean> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    const reg = await navigator.serviceWorker.ready;
    return !!(await reg.pushManager.getSubscription());
  } catch {
    return false;
  }
}
