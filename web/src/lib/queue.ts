/** Офлайн-очередь запросов в IndexedDB. Читается и страницей, и service worker'ом. */

export interface QueueItem {
  id: string;
  method: 'POST' | 'PUT' | 'DELETE';
  path: string;
  body: string | null;
  createdAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('no idb'));
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

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function enqueue(item: Omit<QueueItem, 'id' | 'createdAt'>): Promise<void> {
  try {
    const db = await openDb();
    const full: QueueItem = { ...item, id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, createdAt: Date.now() };
    await req(db.transaction('queue', 'readwrite').objectStore('queue').put(full));
    const reg = await navigator.serviceWorker?.ready;
    const sync = (reg as unknown as { sync?: { register: (t: string) => Promise<void> } } | undefined)?.sync;
    await sync?.register('polovinka-flush').catch(() => undefined);
  } catch {
    /* без IndexedDB очередь не работает; ответ просто не сохранится офлайн */
  }
}

export async function queueSize(): Promise<number> {
  try {
    const db = await openDb();
    return await req(db.transaction('queue', 'readonly').objectStore('queue').count());
  } catch {
    return 0;
  }
}

export async function saveTokenForSw(token: string | null): Promise<void> {
  try {
    const db = await openDb();
    const store = db.transaction('meta', 'readwrite').objectStore('meta');
    if (token) await req(store.put({ key: 'token', value: token }));
    else await req(store.delete('token'));
  } catch {
    /* пусто */
  }
}

/** Отправляет очередь по порядку. Возвращает число отправленных. */
export async function flushQueue(token: string | null): Promise<number> {
  let sent = 0;
  try {
    const db = await openDb();
    const items = (await req(db.transaction('queue', 'readonly').objectStore('queue').getAll())) as QueueItem[];
    items.sort((a, b) => a.createdAt - b.createdAt);
    for (const it of items) {
      let res: Response;
      try {
        res = await fetch(it.path, {
          method: it.method,
          headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: it.body,
        });
      } catch {
        break;
      }
      if (res.ok || (res.status >= 400 && res.status < 500)) {
        await req(db.transaction('queue', 'readwrite').objectStore('queue').delete(it.id));
        if (res.ok) sent++;
      } else break;
    }
  } catch {
    /* пусто */
  }
  return sent;
}
