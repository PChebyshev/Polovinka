import { useState, type ReactNode } from 'react';
import { api, getToken, type PmfResponse } from '../lib/api';
import { Card, Label } from './ui';
import { useStore } from '../lib/store';

function pct(x: number | null): string {
  return x === null ? '—' : `${Math.round(x * 100)}%`;
}
function shortDate(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '');
}
function ago(iso: string | null): string {
  if (!iso) return '—';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d <= 0 ? 'сегодня' : d === 1 ? 'вчера' : `${d} дн. назад`;
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

/** Горизонтальные полосы одним цветом; число — текстом справа. */
function BarList({ rows, suffix = '', wide = false }: { rows: Array<[string, number]>; suffix?: string; wide?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <div className="space-y-1.5">
      {rows.map(([label, n]) => (
        <div key={label} className={`grid items-center gap-2 text-xs ${wide ? 'grid-cols-[9.5rem_1fr_2rem]' : 'grid-cols-[4.5rem_1fr_2.5rem]'}`}>
          <span className="text-muted">{label}</span>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-r-[4px] bg-accent" style={{ width: `${n ? Math.max(3, (n / max) * 100) : 0}%` }} />
          </div>
          <span className="text-right tabular-nums">
            {n}
            {suffix}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Столбики по неделям: активные пары; подпись у последнего и максимального, касание — подробности. */
function WeeklyBars({ weeks }: { weeks: PmfResponse['weekly'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...weeks.map((w) => w.activePairs));
  const maxIdx = weeks.findIndex((w) => w.activePairs === max);
  const W = 100;
  const H = 44;
  const slot = W / weeks.length;
  const bw = Math.min(8, slot * 0.6);
  const sel = hover ?? weeks.length - 1;
  return (
    <div>
      <div className="text-xs text-muted">
        неделя с {shortDate(weeks[sel].weekStart)}: <span className="text-text">{weeks[sel].activePairs}</span> из {weeks[sel].completePairs} пар отвечали ·
        открытий приложения {weeks[sel].sessions}
      </div>
      <svg viewBox={`0 0 ${W} ${H + 6}`} className="mt-2 h-24 w-full" preserveAspectRatio="none" onMouseLeave={() => setHover(null)}>
        <line x1="0" y1={H - 0.25} x2={W} y2={H - 0.25} className="stroke-line" strokeWidth="0.5" />
        {weeks.map((w, i) => {
          const h = (w.activePairs / max) * (H - 8);
          const x = i * slot + (slot - bw) / 2;
          return (
            <g key={w.weekStart} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
              <rect x={i * slot} y={0} width={slot} height={H + 6} fill="transparent" />
              {h > 0 && <rect x={x} y={H - h} width={bw} height={h} rx={1} className={i === sel ? 'fill-accent' : 'fill-accent/60'} />}
              {(i === maxIdx || i === weeks.length - 1) && w.activePairs > 0 && (
                <text x={x + bw / 2} y={H - h - 1.5} fontSize="3.6" textAnchor="middle" className="fill-muted">
                  {w.activePairs}
                </text>
              )}
              {(i === 0 || i === weeks.length - 1) && (
                <text x={i === 0 ? 0 : W} y={H + 5} fontSize="3.2" textAnchor={i === 0 ? 'start' : 'end'} className="fill-muted">
                  {shortDate(w.weekStart)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Когорты удержания: одна шкала (прозрачность акцента), значения — текстом в ячейке. */
function CohortTable({ cohorts }: { cohorts: PmfResponse['cohorts'] }) {
  if (!cohorts.length) return <p className="text-sm text-muted">Появится, когда будут пары, присоединившиеся за последние 8 недель.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] tabular-nums">
        <thead>
          <tr className="text-muted">
            <th className="py-1 pr-2 text-left font-normal">неделя</th>
            <th className="px-1 font-normal">пар</th>
            {Array.from({ length: 8 }, (_, w) => (
              <th key={w} className="px-0.5 font-normal">
                {w === 0 ? 'нед. 0' : w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((c) => (
            <tr key={c.weekStart}>
              <td className="py-0.5 pr-2 text-muted">{shortDate(c.weekStart)}</td>
              <td className="px-1 text-center">{c.size}</td>
              {c.weeks.map((v, w) => (
                <td key={w} className="px-0.5 py-0.5">
                  {v === null ? (
                    <div className="h-6 rounded-md border border-dashed border-line" />
                  ) : (
                    <div
                      className="flex h-6 items-center justify-center rounded-md"
                      style={{ background: `color-mix(in srgb, var(--color-accent) ${Math.round(12 + v * 75)}%, var(--color-surface-2))` }}
                    >
                      <span className={v >= 0.55 ? 'text-bg' : 'text-text'}>{Math.round(v * 100)}</span>
                    </div>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-muted">
        % пар когорты, которые отвечали хотя бы раз на этой неделе после присоединения партнёра. Пунктир — неделя ещё не наступила.
      </p>
    </div>
  );
}

function Section({ title, hint, children, id }: { title: string; hint?: string; children: ReactNode; id?: string }) {
  return (
    <Card className="mt-3 scroll-mt-4" id={id}>
      <Label>{title}</Label>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
      <div className="mt-3">{children}</div>
    </Card>
  );
}

const DISAPPOINT_LABEL: Record<string, string> = { very: 'очень', somewhat: 'немного', not: 'не расстроится' };

export function PmfStats({ pmf, statsKey, periodDays, onChanged }: { pmf: PmfResponse; statsKey: string; periodDays: number; onChanged: () => void }) {
  const { me } = useStore();
  const meExcluded = !!me && pmf.excluded.some((e) => e.pairId === me.pair.id);
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  const w = pmf.week;
  const s = pmf.survey;
  const features = [...pmf.features].sort((a, b) => b.pairs - a.pairs || b.events - a.events);

  return (
    <div>
      {/* Исключённые пары */}
      <div className="mt-4 rounded-2xl border border-line bg-surface px-4 py-3 text-sm">
        {pmf.excluded.length ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted">Не учитываются:</span>
            {pmf.excluded.map((e) => (
              <span key={e.pairId} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-3 py-1 text-xs">
                {e.names.join(' и ') || 'пара'}
                <button
                  className="text-muted"
                  disabled={busy}
                  onClick={() => act(() => api.statsInclude(statsKey, e.pairId))}
                  aria-label="Вернуть в статистику"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        ) : (
          <span className="text-muted">Учитываются все пары.</span>
        )}
        {getToken() && !meExcluded && (
          <button className="mt-2 block text-xs text-accent" disabled={busy} onClick={() => act(() => api.statsExcludeMe(statsKey))}>
            Не учитывать нашу пару
          </button>
        )}
      </div>

      <Label className="mt-6 scroll-mt-4" id="week">
        Последние 7 дней
      </Label>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Tile n={`${w.activePairs} из ${w.completePairs}`} label="пар отвечали" />
        <Tile n={w.medianDaysActive === null ? '—' : String(w.medianDaysActive)} label="дней с ответами у пары" hint="медиана среди активных" />
        <Tile n={w.medianSessions === null ? '—' : String(w.medianSessions)} label="открытий на человека" hint="медиана, не чаще 1 раза в 30 мин" />
        <Tile n={String(w.activeUsers)} label="людей открывали" />
      </div>

      <Section title="Сколько дней за неделю пара отвечала" hint="Ритуал работает, если у заметной доли пар 4+ дней.">
        <BarList rows={w.daysHistogram.map((n, d) => [d === 0 ? 'ни разу' : `${d} ${d === 1 ? 'день' : d < 5 ? 'дня' : 'дней'}`, n] as [string, number])} />
      </Section>

      <Section title="Сколько раз человек открывал приложение">
        <BarList rows={w.sessionsHistogram.map((b) => [b.label === '0' ? 'ни разу' : `${b.label} раз`, b.n] as [string, number])} />
      </Section>

      <Section title="Активные пары по неделям" hint="Пара активна, если хотя бы раз ответила на неделе. Касание — подробности.">
        <WeeklyBars weeks={pmf.weekly} />
      </Section>

      <Section
        id="features"
        title={`Функции за ${periodDays} дн.`}
        hint="Сколько пар пользовались и какая это доля активных. «Удержание» — доля пар старше 14 дней, активных на этой неделе: среди пользовавшихся функцией и остальных."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-1 font-normal">функция</th>
                <th className="px-1 text-right font-normal">пар</th>
                <th className="px-1 text-right font-normal">доля</th>
                <th className="pl-1 text-right font-normal">удержание</th>
              </tr>
            </thead>
            <tbody>
              {features.map((f) => (
                <tr key={f.key} className={`border-t border-line/60 ${f.pairs === 0 ? 'text-muted/60' : ''}`}>
                  <td className="py-1.5 pr-1">{f.label}</td>
                  <td className="px-1 text-right">{f.pairs}</td>
                  <td className="px-1 text-right">{pct(f.share)}</td>
                  <td className="pl-1 text-right text-muted">
                    {f.liftUsed === null || f.liftOthers === null ? '—' : `${pct(f.liftUsed)} / ${pct(f.liftOthers)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Label className="mt-6 scroll-mt-4" id="pmf">
        Product–market fit
      </Label>

      <Section
        title="Чего хотят от отношений"
        hint="Три выбора по порядку важности: 3 балла за первое место, 2 — за второе, 1 — за третье. Показывается после первого открытия."
      >
        {pmf.needs.responses === 0 ? (
          <p className="text-sm text-muted">Пока нет ответов{pmf.needs.shown ? ` (увидели ${pmf.needs.shown})` : ''}.</p>
        ) : (
          <>
            <p className="mb-3 text-xs text-muted">
              Ответов {pmf.needs.responses}
              {pmf.needs.shown ? ` из ${pmf.needs.shown} увидевших` : ''}
            </p>
            <BarList rows={pmf.needs.items.map((i) => [i.label, i.score])} wide />
            <table className="mt-3 w-full text-xs tabular-nums">
              <thead>
                <tr className="text-left text-muted">
                  <th className="font-normal">Потребность</th>
                  <th className="text-right font-normal">на 1-м месте</th>
                  <th className="text-right font-normal">в тройке</th>
                </tr>
              </thead>
              <tbody>
                {pmf.needs.items.map((i) => (
                  <tr key={i.key} className="border-t border-line">
                    <td className="py-1 pr-2">{i.label}</td>
                    <td className="py-1 text-right">{pct(i.first / pmf.needs.responses)}</td>
                    <td className="py-1 text-right">{pct(i.top3 / pmf.needs.responses)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pmf.needs.byStage.length > 1 && (
              <div className="mt-3 space-y-1 text-xs text-muted">
                {pmf.needs.byStage.map((b) => (
                  <div key={b.stage}>
                    <span className="text-text">{b.stage}</span> ({b.responses}): {b.top.join(' · ') || '—'}
                  </div>
                ))}
              </div>
            )}
            {pmf.needs.texts.length > 0 && (
              <div className="mt-4 space-y-2">
                {pmf.needs.texts.map((t, i) => (
                  <div key={i} className="rounded-2xl bg-surface-2 px-3 py-2 text-xs">
                    <div className="text-muted">
                      {shortDate(t.at)} · {t.stage} · главное: {pmf.needs.items.find((x) => x.key === t.first)?.label.toLowerCase() ?? t.first}
                    </div>
                    <div className="mt-1">«{t.text}»</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Section>

      <Section title="Опрос: «Если бы Половинка исчезла…»" hint="Тест Шона Эллиса. Цель — 40% и больше отвечают «очень расстроюсь».">
        {s.responses === 0 ? (
          <p className="text-sm text-muted">Пока нет ответов. Опрос появляется у пары через 10 дней после присоединения партнёра и 7 открытий.</p>
        ) : (
          <>
            <div className="flex items-end gap-3">
              <div className={`text-4xl font-bold tabular-nums ${s.veryShare !== null && s.veryShare >= 0.4 ? 'text-sage' : ''}`}>{pct(s.veryShare)}</div>
              <div className="pb-1 text-xs text-muted">
                «очень расстроюсь» · ответов {s.responses}
                {s.shown ? ` из ${s.shown} увидевших` : ''}
              </div>
            </div>
            <div className="mt-3">
              <BarList
                rows={[
                  ['очень', s.very],
                  ['немного', s.somewhat],
                  ['не расстр.', s.not],
                ]}
              />
            </div>
            {s.byStage.length > 1 && (
              <div className="mt-3 text-xs text-muted">По стадиям: {s.byStage.map((b) => `${b.stage} — ${pct(b.veryShare)} (${b.responses})`).join(' · ')}</div>
            )}
            {s.texts.length > 0 && (
              <div className="mt-4 space-y-2">
                {s.texts.map((t, i) => (
                  <div key={i} className="rounded-2xl bg-surface-2 px-3 py-2 text-xs">
                    <div className="text-muted">
                      {shortDate(t.at)} · {t.stage} · {DISAPPOINT_LABEL[t.disappoint] ?? t.disappoint}
                    </div>
                    {t.benefit && <div className="mt-1">Главное: {t.benefit}</div>}
                    {t.missing && <div className="mt-1">Не хватает: {t.missing}</div>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Section>

      <Section title="Удержание по когортам" hint="Если строки выходят на «полку» и не падают к нулю — у продукта есть ядро аудитории.">
        <CohortTable cohorts={pmf.cohorts} />
      </Section>

      <Section title={`Активация: пары, созданные за ${periodDays} дн.`}>
        <BarList rows={pmf.activation} wide />
      </Section>

      <Section title="Сохранность аккаунтов" hint="Без почты вход живёт только в одном телефоне: смена телефона или очистка браузера — и история потеряна.">
        <BarList rows={pmf.access} wide />
      </Section>

      {pmf.stages.length > 0 && (
        <Section title="По стадии отношений" hint="Где Половинка заходит лучше: в эту сторону и развивать.">
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-1 font-normal">вместе</th>
                <th className="px-1 text-right font-normal">пар</th>
                <th className="px-1 text-right font-normal">активны</th>
                <th className="pl-1 text-right font-normal">дней/нед.</th>
              </tr>
            </thead>
            <tbody>
              {pmf.stages.map((st) => (
                <tr key={st.stage} className="border-t border-line/60">
                  <td className="py-1.5">{st.stage}</td>
                  <td className="px-1 text-right">{st.pairs}</td>
                  <td className="px-1 text-right">{pct(st.activeShare)}</td>
                  <td className="pl-1 text-right">{st.avgDays ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <Section id="pairs" title={`Пары · ${pmf.pairs.length}`} hint="За последние 7 дней. «Функций» — сколько разных функций пара пробовала за всё время.">
        <div className="space-y-2">
          {pmf.pairs.map((p) => (
            <div key={p.pairId} className="rounded-2xl bg-surface-2 px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{p.names.join(' и ')}</span>
                <button className="text-muted" disabled={busy} onClick={() => act(() => api.statsExclude(statsKey, p.pairId))}>
                  не учитывать
                </button>
              </div>
              <div className="mt-1 text-muted">
                с {shortDate(p.joinedAt)}
                {p.stage ? ` · ${{ lt1: '< года', '1to3': '1–3 г.', '3to10': '3–10 л.', '10plus': '10+ л.' }[p.stage] ?? p.stage}` : ''}
                {p.hasKids ? ' · дети' : ''} · отвечали {p.daysActive7}/7 дн. · открывали {p.sessions7} · открытий {p.discoveries} · функций {p.features} ·
                последний ответ {ago(p.lastActive)}
              </div>
            </div>
          ))}
          {pmf.pairs.length === 0 && <p className="text-sm text-muted">Пока нет полных пар, кроме исключённых.</p>}
        </div>
      </Section>
    </div>
  );
}
