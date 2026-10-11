/* Service worker «Половинки». Генерируется при сборке: список ассетов подставляется из dist. */
const VERSION = '__VERSION__';
const SHELL = '__ASSETS__';
const SHELL_CACHE = `shell-${VERSION}`;
const API_CACHE = 'api-v1';
const API_SNAPSHOT = ['/api/me', '/api/today'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function withCacheHeader(res) {
  const h = new Headers(res.headers);
  h.set('x-sw-cache', '1');
  return res.blob().then((b) => new Response(b, { status: res.status, statusText: res.statusText, headers: h }));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    if (req.method !== 'GET') return;
    if (url.pathname === '/api/events') return;
    const snapshot = API_SNAPSHOT.includes(url.pathname);
    if (!snapshot) return;
    // Снимок последнего состояния: сеть, при её отсутствии — кэш с пометкой.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(API_CACHE).then((c) => c.put(stripToken(req), copy));
          }
          return res;
        })
        .catch(() => caches.match(stripToken(req)).then((hit) => (hit ? withCacheHeader(hit) : Response.error()))),
    );
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/index.html')));
    return;
  }

  if (req.method === 'GET') {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok && url.pathname.startsWith('/assets/')) {
              const copy = res.clone();
              caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});

/** Ключ кэша без токена в query. */
function stripToken(req) {
  const u = new URL(req.url);
  u.searchParams.delete('token');
  return new Request(u.toString(), { method: 'GET' });
}

// --- Офлайн-очередь: IndexedDB «polovinka», хранилище «queue» ---------------

function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('polovinka', 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
  });
}

async function flushQueue() {
  const db = await openDb();
  const token = await new Promise((res) => {
    const t = db.transaction('meta', 'readonly').objectStore('meta').get('token');
    t.onsuccess = () => res(t.result ? t.result.value : null);
    t.onerror = () => res(null);
  });
  const items = await new Promise((res) => {
    const t = db.transaction('queue', 'readonly').objectStore('queue').getAll();
    t.onsuccess = () => res(t.result || []);
    t.onerror = () => res([]);
  });
  items.sort((a, b) => a.createdAt - b.createdAt);
  let sent = 0;
  for (const it of items) {
    try {
      const res = await fetch(it.path, {
        method: it.method,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: it.body,
      });
      if (res.ok || (res.status >= 400 && res.status < 500)) {
        await tx(db, 'queue', 'readwrite', (s) => s.delete(it.id));
        if (res.ok) sent++;
      } else break;
    } catch {
      break;
    }
  }
  if (sent > 0) {
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const c of clients) c.postMessage({ type: 'flushed', sent });
  }
}

self.addEventListener('sync', (event) => {
  if (event.tag === 'polovinka-flush') event.waitUntil(flushQueue());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'flush') event.waitUntil(flushQueue());
});

// --- Push ---------------------------------------------------------------------

self.addEventListener('push', (event) => {
  let data = { title: 'Половинка', body: 'Загляните в приложение.', url: '/', tag: 'polovinka' };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    /* пусто */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url },
      renotify: false,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          c.navigate(url);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
