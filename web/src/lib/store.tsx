import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { GesturePublic, MeResponse, ServerEvent, TodayResponse } from '@polovinka/shared';
import { api, ApiError, getToken, setToken, lastFromCache } from './api';
import { onFlushed } from './sw';
import { saveTokenForSw } from './queue';

interface Store {
  ready: boolean;
  me: MeResponse | null;
  today: TodayResponse | null;
  error: string | null;
  offline: boolean;
  toast: GesturePublic | null;
  refresh: () => Promise<void>;
  setMe: (me: MeResponse) => void;
  setToday: (t: TodayResponse | ((prev: TodayResponse | null) => TodayResponse | null)) => void;
  login: (token: string, me: MeResponse) => void;
  logout: () => void;
  dismissToast: () => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [me, setMeState] = useState<MeResponse | null>(null);
  const [today, setTodayState] = useState<TodayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [toast, setToast] = useState<GesturePublic | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setMeState(null);
      setTodayState(null);
      setReady(true);
      return;
    }
    try {
      const m = await api.me();
      const meCached = lastFromCache;
      setMeState((prev) => (meCached && prev ? prev : m));
      try {
        const t = await api.today();
        const todayCached = lastFromCache;
        // Снимок из кэша не должен затирать оптимистичное состояние.
        setTodayState((prev) => (todayCached && prev ? prev : t));
        setOffline(todayCached);
      } catch (e) {
        if (e instanceof ApiError && e.code === 'no_questions_left') setError('no_questions_left');
      }
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setToken(null);
        setMeState(null);
        setTodayState(null);
      } else if (e instanceof TypeError) {
        setOffline(true);
      } else {
        setError((e as Error).message);
      }
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return onFlushed(() => void refresh());
  }, [refresh]);

  // Обновление при возврате на вкладку и восстановлении сети.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const onOnline = () => {
      setOffline(false);
      void refresh();
    };
    const onOffline = () => setOffline(true);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.clearInterval(timer);
    };
  }, [refresh]);

  // SSE: партнёр ответил, раскрытие, жест.
  useEffect(() => {
    const token = getToken();
    if (!me || !token) return;
    const es = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
    esRef.current = es;
    const handle = (ev: MessageEvent) => {
      let data: ServerEvent | null = null;
      try {
        data = JSON.parse(ev.data as string) as ServerEvent;
      } catch {
        return;
      }
      if (!data) return;
      if (data.type === 'gesture') setToast(data.gesture);
      if (data.type !== 'ping') void refresh();
    };
    for (const t of ['pair_joined', 'partner_answered', 'revealed', 'why_added', 'bonus_added', 'gesture', 'history_deleted', 'round_replaced', 'pair_updated', 'challenge_update']) {
      es.addEventListener(t, handle as EventListener);
    }
    return () => {
      es.close();
      esRef.current = null;
    };
  }, [me?.user.id, refresh]);

  const value = useMemo<Store>(
    () => ({
      ready,
      me,
      today,
      error,
      offline,
      toast,
      refresh,
      setMe: setMeState,
      setToday: (t) => setTodayState((prev) => (typeof t === 'function' ? t(prev) : t)),
      login: (token, m) => {
        setToken(token);
        void saveTokenForSw(token);
        setMeState(m);
        void refresh();
      },
      logout: () => {
        setToken(null);
        void saveTokenForSw(null);
        setMeState(null);
        setTodayState(null);
      },
      dismissToast: () => setToast(null),
    }),
    [ready, me, today, error, offline, toast, refresh],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider отсутствует');
  return s;
}
