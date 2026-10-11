import { useEffect, useState } from 'react';
import { api, ApiError, type StatsResponse } from '../lib/api';
import { Button, Card, Label } from '../components/ui';

const KEY = 'polovinka.statsKey';

function pct(x: number | null): string {
  return x === null ? '—' : `${Math.round(x * 100)}%`;
}

function Tile({ n, label, hint }: { n: string; label: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-4 py-3">
      <div className="text-2xl font-bold tabular-nums">{n}</div>
      <div className="text-xs text-muted">{label}</div>
      {hint && <div className="mt-1 text-[11px] text-muted/70">{hint}</div>}
    </div>
  );
}

/** Воронка: горизонтальные полосы одним цветом, длина от первого шага. */
function Funnel({ steps }: { steps: Array<[string, number]> }) {
  const max = Math.max(1, ...steps.map((s) => s[1]));
  return (
    <div className="space-y-2">
      {steps.map(([label, n], i) => {
        const prev = i > 0 ? steps[i - 1][1] : null;
        const conv = prev ? ` · ${Math.round((n / prev) * 100)}%` : '';
        return (
          <div key={label} title={`${label}: ${n}${conv}`}>
            <div className="flex justify-between text-xs">
              <span className="text-text">{label}</span>
              <span className="tabular-nums text-muted">
                {n}
                {conv}
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-r-[4px] bg-accent" style={{ width: `${Math.max(2, (n / max) * 100)}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Столбики по дням, одна серия, подпись только у максимума и последнего дня. */
function Daily({ rows, field, label }: { rows: StatsResponse['daily']; field: 'answers' | 'reveals' | 'gestures' | 'users'; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...rows.map((r) => r[field]));
  const maxIdx = rows.findIndex((r) => r[field] === max);
  const W = 100;
  const H = 40;
  const bw = W / rows.length;
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span>{label}</span>
        <span className="tabular-nums text-muted">{hover !== null ? `${rows[hover].date.slice(5)}: ${rows[hover][field]}` : `за период ${rows.reduce((s, r) => s + r[field], 0)}`}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 h-16 w-full" preserveAspectRatio="none" onMouseLeave={() => setHover(null)}>
        <line x1="0" y1={H - 0.5} x2={W} y2={H - 0.5} stroke="currentColor" className="text-line" strokeWidth="0.5" />
        {rows.map((r, i) => {
          const h = (r[field] / max) * (H - 6);
          return (
            <g key={r.date} onMouseEnter={() => setHover(i)}>
              <rect x={i * bw} y={0} width={bw} height={H} fill="transparent" />
              <rect x={i * bw + bw * 0.2} y={H - 1 - h} width={bw * 0.6} height={h} rx={Math.min(1, bw * 0.3)} className={hover === i ? 'fill-sand' : 'fill-accent'} />
              {(i === maxIdx || i === rows.length - 1) && r[field] > 0 && (
                <text x={i * bw + bw / 2} y={Math.max(4, H - 3 - h)} fontSize="3.5" textAnchor="middle" className="fill-muted">
                  {r[field]}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function Stats() {
  const [key, setKey] = useState(() => sessionStorage.getItem(KEY) ?? '');
  const [days, setDays] = useState(30);
  const [data, setData] = useState<StatsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);

  const load = async () => {
    if (!key) return;
    setErr(null);
    try {
      setData(await api.stats(key, days));
      sessionStorage.setItem(KEY, key);
    } catch (e) {
      setData(null);
      setErr(e instanceof ApiError && e.status === 401 ? 'Неверный ключ.' : 'Не удалось загрузить.');
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  if (!data) {
    return (
      <div className="mx-auto max-w-md px-4 py-10">
        <h1 className="text-2xl font-bold">Статистика</h1>
        <p className="mt-1 text-sm text-muted">Нужен ключ STATS_KEY из настроек сервера.</p>
        <div className="mt-4 flex gap-2">
          <input className="min-w-0 flex-1 rounded-2xl border border-line bg-surface-2 px-4 py-3 outline-none focus:border-accent/60" type="password" placeholder="Ключ" value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void load()} />
          <Button onClick={load}>Открыть</Button>
        </div>
        {err && <p className="mt-2 text-sm text-rose">{err}</p>}
      </div>
    );
  }

  const f = data.funnel;
  const t = data.totals;
  const c = data.closeness;
  const k = data.kFactor;

  return (
    <div className="mx-auto max-w-md px-4 pb-16 pt-4">
      <div className="flex items-end justify-between">
        <h1 className="text-2xl font-bold">Статистика</h1>
        <div className="flex gap-1">
          {[7, 30, 90].map((d) => (
            <button key={d} className={`rounded-full px-3 py-1 text-xs ${days === d ? 'bg-accent text-bg' : 'bg-surface-2 text-muted'}`} onClick={() => setDays(d)}>
              {d} дн.
            </button>
          ))}
        </div>
      </div>

      <Label className="mt-5">Всего</Label>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Tile n={String(t.users)} label="пользователей" />
        <Tile n={String(t.pairsComplete)} label="полных пар" hint={`одиночных ${t.pairsSolo}, гостевых ${t.pairsGuest}`} />
        <Tile n={String(t.pushSubscribed)} label="с push-подпиской" />
        <Tile n={String(c.activePairs)} label="активных пар за период" />
      </div>

      <Label className="mt-6">Близость за {data.periodDays} дн.</Label>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <Tile n={pct(c.daysBothShare)} label="дней с ответами обоих" />
        <Tile n={pct(c.revealsWithWhyShare)} label="раскрытий с «почему»" />
        <Tile n={c.gesturesPerPairWeek === null ? '—' : String(c.gesturesPerPairWeek)} label="жестов на пару в неделю" />
      </div>

      <Label className="mt-6">K-фактор за период</Label>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <Tile n={String(k.sharesPerUser)} label="ссылок на пользователя" />
        <Tile n={pct(k.conversion)} label="конверсия ссылки" />
        <Tile n={String(k.k)} label="K" hint="ссылки × конверсия" />
      </div>

      <Card className="mt-6">
        <Label>Приглашение партнёра</Label>
        <div className="mt-3">
          <Funnel
            steps={[
              ['Отправлено', f.invitesSent],
              ['Открыто', f.invitesOpened],
              ['Принято', f.invitesAccepted],
            ]}
          />
        </div>
      </Card>

      <Card className="mt-3">
        <Label>Вызов паре</Label>
        <div className="mt-3">
          <Funnel
            steps={[
              ['Отправлено', f.challengesSent],
              ['Открыто', f.challengesOpened],
              ['Пара создана', f.challengePairsCreated],
              ['Стала постоянной', f.challengesConverted],
            ]}
          />
        </div>
      </Card>

      <Card className="mt-3">
        <Label>Установка на экран</Label>
        <div className="mt-3">
          <Funnel
            steps={[
              ['Увидели инструкцию', f.landingInstallShown],
              ['Запустили с иконки', f.standaloneLaunch],
            ]}
          />
        </div>
        <p className="mt-3 text-xs text-muted">
          Продолжили в браузере: {f.landingBrowser}. Перенесли вход в приложение кодом: {f.handoffRedeemed}.
        </p>
      </Card>

      <Card className="mt-3">
        <Label>Итог недели</Label>
        <div className="mt-3">
          <Funnel
            steps={[
              ['Поделились', f.weeklyShared],
              ['Открыли карточку', f.weeklyOpened],
            ]}
          />
        </div>
      </Card>

      <Card className="mt-3 space-y-4">
        <Label>По дням</Label>
        <Daily rows={data.daily} field="answers" label="Ответы" />
        <Daily rows={data.daily} field="reveals" label="Раскрытия" />
        <Daily rows={data.daily} field="gestures" label="Жесты" />
        <Daily rows={data.daily} field="users" label="Активные пользователи" />
        <button className="text-xs text-muted underline decoration-dotted" onClick={() => setShowTable((v) => !v)}>
          {showTable ? 'Скрыть таблицу' : 'Показать таблицей'}
        </button>
        {showTable && (
          <table className="w-full text-xs tabular-nums">
            <thead className="text-muted">
              <tr>
                <th className="text-left font-normal">Дата</th>
                <th className="text-right font-normal">Ответы</th>
                <th className="text-right font-normal">Раскрытия</th>
                <th className="text-right font-normal">Жесты</th>
                <th className="text-right font-normal">Люди</th>
              </tr>
            </thead>
            <tbody>
              {data.daily.map((r) => (
                <tr key={r.date}>
                  <td>{r.date.slice(5)}</td>
                  <td className="text-right">{r.answers}</td>
                  <td className="text-right">{r.reveals}</td>
                  <td className="text-right">{r.gestures}</td>
                  <td className="text-right">{r.users}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <p className="mt-4 text-xs text-muted">Обновлено {new Date(data.generatedAt).toLocaleString('ru-RU')}. В событиях нет текстов ответов, только типы и даты.</p>
    </div>
  );
}
