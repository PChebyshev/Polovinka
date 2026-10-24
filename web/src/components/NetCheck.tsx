import { useState } from 'react';
import { api, getToken } from '../lib/api';
import { isStandalone } from '../lib/install';
import { Button, Card, Label } from './ui';

interface Result {
  rtt: number;
  ttfb: number;
  kbps: number;
  nav: number | null;
  sw: boolean;
  snapshot: boolean;
  standalone: boolean;
  conn: string | null;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** Пять коротких запросов, один файл в 200 КБ и время прошлой загрузки страницы. */
async function measure(): Promise<Result> {
  const rtts: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    await fetch(`/api/net/ping?i=${i}`, { cache: 'no-store' });
    rtts.push(performance.now() - t0);
  }
  const t1 = performance.now();
  const res = await fetch('/api/net/blob', { cache: 'no-store' });
  const ttfb = performance.now() - t1;
  const bytes = (await res.arrayBuffer()).byteLength;
  const total = performance.now() - t1;
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  const c = (navigator as unknown as { connection?: { effectiveType?: string } }).connection;
  let snapshot = false;
  try {
    snapshot = !!localStorage.getItem('polovinka.snapshot') && !!getToken();
  } catch {
    /* пусто */
  }
  return {
    rtt: Math.round(median(rtts)),
    ttfb: Math.round(ttfb),
    kbps: Math.round((bytes * 8) / 1024 / (Math.max(1, total - ttfb) / 1000)),
    nav: nav ? Math.round(nav.responseEnd - nav.startTime) : null,
    sw: !!navigator.serviceWorker?.controller,
    snapshot,
    standalone: isStandalone(),
    conn: c?.effectiveType ?? null,
  };
}

function verdict(r: Result): string {
  if (r.rtt > 1500)
    return 'Очень большая задержка: каждый запрос идёт больше полутора секунд. Так бывает, когда VPN выводит трафик за границу, а сервер в России, или когда оператор режет VPN.';
  if (r.rtt > 500) return 'Большая задержка на каждый запрос. Приложение открывается с кэша, но свежие данные идут долго.';
  if (r.kbps < 300) return 'Канал очень узкий: даже небольшие файлы грузятся долго. Похоже на перегруженный VPN.';
  return 'Связь в порядке. Если приложение всё равно долго открывается — напишите нам, отчёт поможет разобраться.';
}

/** «Проверка связи» в настройках: измеряет задержку и скорость до сервера, отчёт можно отправить нам. */
export function NetCheck() {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'sent' | 'error'>('idle');
  const [r, setR] = useState<Result | null>(null);

  const run = async () => {
    setState('busy');
    try {
      setR(await measure());
      setState('done');
    } catch {
      setState('error');
    }
  };
  const send = async () => {
    if (!r) return;
    await api.netReport({ ...r }).catch(() => undefined);
    setState('sent');
  };

  return (
    <Card>
      <Label>Проверка связи</Label>
      <p className="mt-2 text-sm text-muted">Если приложение открывается долго: измерим задержку до сервера и скорость. Займёт несколько секунд.</p>
      {r && (
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          {[
            ['задержка', `${r.rtt} мс`],
            ['первый байт', `${r.ttfb} мс`],
            ['скорость', r.kbps >= 1024 ? `${(r.kbps / 1024).toFixed(1)} Мбит/с` : `${r.kbps} кбит/с`],
          ].map(([k, v]) => (
            <div key={k} className="rounded-2xl bg-surface-2 px-2 py-2">
              <div className="text-base font-semibold tabular-nums">{v}</div>
              <div className="text-[11px] text-muted">{k}</div>
            </div>
          ))}
        </div>
      )}
      {r && (
        <p className="mt-3 text-sm">
          {verdict(r)}
          <span className="block mt-1 text-xs text-muted">
            {r.nav !== null ? `Прошлая загрузка страницы: ${r.nav} мс · ` : ''}
            {r.sw ? 'кэш приложения работает' : 'кэш приложения не активен'} · {r.snapshot ? 'снимок данных есть' : 'снимка данных нет'}
            {r.conn ? ` · сеть ${r.conn}` : ''}
          </span>
        </p>
      )}
      {state === 'error' && <p className="mt-3 text-sm text-rose">Не удалось дойти до сервера. Это и есть ответ: связи сейчас почти нет.</p>}
      <div className="mt-3 flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={run} disabled={state === 'busy'}>
          {state === 'busy' ? 'Измеряем…' : r ? 'Ещё раз' : 'Проверить'}
        </Button>
        {r && state !== 'sent' && (
          <Button className="flex-1" onClick={send}>
            Отправить отчёт
          </Button>
        )}
        {state === 'sent' && <span className="flex flex-1 items-center justify-center text-sm text-sage">Отчёт отправлен, спасибо</span>}
      </div>
    </Card>
  );
}
