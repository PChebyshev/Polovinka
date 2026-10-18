import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Ширина контейнера: графики рисуются в реальных пикселях, без растяжения текста. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(320);
  useEffect(() => {
    if (!ref.current) return;
    // скрытый контейнер даёт ширину 0 — оставляем прошлую, чтобы не рисовать отрицательные размеры
    const ro = new ResizeObserver((e) => {
      const next = Math.round(e[0].contentRect.width);
      if (next >= 120) setW(next);
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const C = {
  accent: 'var(--color-accent)',
  track: 'var(--color-heat-1)',
  grid: 'var(--color-line)',
  surface: 'var(--color-surface)',
  muted: 'var(--color-muted)',
  text: 'var(--color-text)',
};

function shortDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '');
}

/** Кольцевой индикатор: одна доля против целого. Дорожка — нижняя ступень того же оттенка. */
export function RingMeter({ value, size = 132 }: { value: number | null; size?: number }) {
  const r = size / 2 - 9;
  const len = 2 * Math.PI * r;
  const v = value ?? 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={value === null ? 'Пока нет догадок' : `${value} процентов`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.track} strokeWidth={10} opacity={0.6} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={C.accent}
        strokeWidth={10}
        strokeLinecap="round"
        strokeDasharray={`${(len * v) / 100} ${len}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dasharray 0.9s ease-out' }}
      />
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        fill={C.text}
        fontSize={value === null ? 28 : value >= 100 ? 32 : 38}
        fontWeight={700}
      >
        {value === null ? (
          '—'
        ) : (
          <>
            {value}
            <tspan fontSize="0.55em" fontWeight={600} fill={C.muted}>
              %
            </tspan>
          </>
        )}
      </text>
    </svg>
  );
}

/** Обёртка карточки графика: заголовок, подзаголовок, подсказка по касанию и вид таблицей. */
export function ChartCard({
  title,
  subtitle,
  caption,
  table,
  children,
}: {
  title: string;
  subtitle?: string;
  caption?: string | null;
  table: { head: string[]; rows: Array<Array<string | number>> };
  children: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <div className="rounded-3xl border border-line bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">{title}</div>
          {subtitle && <div className="mt-0.5 text-xs text-muted">{subtitle}</div>}
        </div>
        <button className="shrink-0 text-xs text-muted underline decoration-dotted" onClick={() => setAsTable((v) => !v)}>
          {asTable ? 'график' : 'таблицей'}
        </button>
      </div>
      <div className="mt-1 h-5 text-xs text-text">{!asTable && caption}</div>
      {asTable ? (
        <table className="mt-1 w-full text-xs tabular-nums">
          <thead className="text-muted">
            <tr>
              {table.head.map((h, i) => (
                <th key={h} className={`font-normal ${i ? 'text-right' : 'text-left'}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr key={i} className="border-t border-line/60">
                {r.map((c, j) => (
                  <td key={j} className={`py-1 ${j ? 'text-right' : ''}`}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        children
      )}
    </div>
  );
}

export interface WeekPoint {
  weekStart: string;
  discoveries: number;
  right: number;
  total: number;
}

/** Линия: доля угаданных выборов по неделям. Недели без догадок — разрыв линии. */
export function UnderstandingLine({ weeks, onPick }: { weeks: WeekPoint[]; onPick: (i: number | null) => void }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 150;
  const pad = { l: 34, r: 12, t: 22, b: 22 };
  const iw = w - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const x = (i: number) => pad.l + (weeks.length === 1 ? iw / 2 : (i * iw) / (weeks.length - 1));
  const y = (pct: number) => pad.t + ih - (pct / 100) * ih;
  const pts = weeks.map((wk, i) => (wk.total > 0 ? { i, pct: Math.round((wk.right / wk.total) * 100) } : null));

  // Отрезки линии между соседними неделями с данными
  const segs: Array<Array<{ i: number; pct: number }>> = [];
  let cur: Array<{ i: number; pct: number }> = [];
  for (const p of pts) {
    if (p) cur.push(p);
    else if (cur.length) {
      segs.push(cur);
      cur = [];
    }
  }
  if (cur.length) segs.push(cur);
  const last = [...pts].reverse().find(Boolean) ?? null;

  const pick = (i: number | null) => {
    setHover(i);
    onPick(i);
  };

  return (
    <div ref={ref} className="select-none">
      <svg width={w} height={H} onMouseLeave={() => pick(null)}>
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} stroke={C.grid} strokeWidth={1} />
            <text x={pad.l - 6} y={y(v)} textAnchor="end" dominantBaseline="central" fontSize={10} fill={C.muted}>
              {v}%
            </text>
          </g>
        ))}
        {segs.map((s, k) => (
          <g key={k}>
            {s.length > 1 && (
              <path
                d={`M ${x(s[0].i)} ${y(0)} ` + s.map((p) => `L ${x(p.i)} ${y(p.pct)}`).join(' ') + ` L ${x(s[s.length - 1].i)} ${y(0)} Z`}
                fill={C.accent}
                opacity={0.1}
              />
            )}
            <polyline
              points={s.map((p) => `${x(p.i)},${y(p.pct)}`).join(' ')}
              fill="none"
              stroke={C.accent}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </g>
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke={C.muted} strokeWidth={1} />}
        {pts.map(
          (p) => p && <circle key={p.i} cx={x(p.i)} cy={y(p.pct)} r={hover === p.i || p === last ? 5 : 4} fill={C.accent} stroke={C.surface} strokeWidth={2} />,
        )}
        {last && hover === null && (
          <text x={x(last.i) + 4} y={y(last.pct) - 12} textAnchor="end" fontSize={11} fontWeight={600} fill={C.text}>
            {last.pct}%
          </text>
        )}
        {[0, Math.floor((weeks.length - 1) / 2), weeks.length - 1].map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === weeks.length - 1 ? 'end' : 'middle'} fontSize={10} fill={C.muted}>
            {shortDate(weeks[i].weekStart)}
          </text>
        ))}
        {/* Зоны касания шире точек */}
        {weeks.map((_, i) => (
          <rect
            key={i}
            x={x(i) - iw / weeks.length / 2}
            y={0}
            width={iw / weeks.length}
            height={H}
            fill="transparent"
            onMouseEnter={() => pick(i)}
            onClick={() => pick(hover === i ? null : i)}
          />
        ))}
      </svg>
    </div>
  );
}

/** Столбцы: открытия по неделям. Подписи только у последней недели и максимума. */
export function WeeklyColumns({ weeks, onPick }: { weeks: WeekPoint[]; onPick: (i: number | null) => void }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 130;
  const pad = { l: 8, r: 8, t: 18, b: 22 };
  const iw = w - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const slot = iw / weeks.length;
  const bw = Math.min(24, slot - 2);
  const max = Math.max(1, ...weeks.map((x) => x.discoveries));
  const maxIdx = weeks.findIndex((x) => x.discoveries === max);
  const pick = (i: number | null) => {
    setHover(i);
    onPick(i);
  };
  const r = 4;
  return (
    <div ref={ref} className="select-none">
      <svg width={w} height={H} onMouseLeave={() => pick(null)}>
        <line x1={pad.l} x2={w - pad.r} y1={pad.t + ih + 0.5} y2={pad.t + ih + 0.5} stroke={C.grid} strokeWidth={1} />
        {weeks.map((wk, i) => {
          const h = (wk.discoveries / max) * ih;
          const cx = pad.l + slot * i + slot / 2;
          const x0 = cx - bw / 2;
          const y0 = pad.t + ih - h;
          const rr = Math.min(r, h, bw / 2);
          const d =
            h <= 0
              ? ''
              : `M ${x0} ${pad.t + ih} L ${x0} ${y0 + rr} Q ${x0} ${y0} ${x0 + rr} ${y0} L ${x0 + bw - rr} ${y0} Q ${x0 + bw} ${y0} ${x0 + bw} ${y0 + rr} L ${x0 + bw} ${pad.t + ih} Z`;
          const labelled = wk.discoveries > 0 && (i === weeks.length - 1 || i === maxIdx) && hover === null;
          return (
            <g key={wk.weekStart}>
              {d && <path d={d} fill={C.accent} opacity={hover === null || hover === i ? 1 : 0.45} />}
              {labelled && (
                <text x={cx} y={y0 - 5} textAnchor="middle" fontSize={10} fontWeight={600} fill={C.text}>
                  {wk.discoveries}
                </text>
              )}
              <rect
                x={cx - slot / 2}
                y={0}
                width={slot}
                height={H}
                fill="transparent"
                onMouseEnter={() => pick(i)}
                onClick={() => pick(hover === i ? null : i)}
              />
            </g>
          );
        })}
        {[0, weeks.length - 1].map((i) => (
          <text key={i} x={pad.l + slot * i + slot / 2} y={H - 6} textAnchor="middle" fontSize={10} fill={C.muted}>
            {shortDate(weeks[i].weekStart)}
          </text>
        ))}
      </svg>
    </div>
  );
}

export type DayState = 'both' | 'one' | 'none' | 'before' | 'future';

const HEAT: Record<DayState, string> = {
  both: 'var(--color-heat-2)',
  one: 'var(--color-heat-1)',
  none: 'var(--color-surface-2)',
  before: 'transparent',
  future: 'transparent',
};

export const DAY_LABEL: Record<DayState, string> = {
  both: 'ответили оба',
  one: 'ответил один',
  none: 'без ответов',
  before: 'ещё не начали',
  future: '',
};

/** Календарь ритуала: недели столбцами, дни строками (пн…вс). Одна шкала оттенка. */
export function RitualCalendar({ days, onPick }: { days: Array<{ date: string; state: DayState }>; onPick: (i: number | null) => void }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const weeks = Math.ceil(days.length / 7);
  const labelW = 22;
  const gap = 3;
  const cell = Math.min(22, Math.floor((w - labelW - gap * (weeks - 1)) / weeks));
  const H = cell * 7 + gap * 6;
  const pick = (i: number | null) => {
    setHover(i);
    onPick(i);
  };
  return (
    <div ref={ref} className="select-none">
      <svg width={w} height={H} onMouseLeave={() => pick(null)}>
        {['пн', 'ср', 'пт', 'вс'].map((d, k) => (
          <text key={d} x={0} y={[0, 2, 4, 6][k] * (cell + gap) + cell / 2} dominantBaseline="central" fontSize={9} fill={C.muted}>
            {d}
          </text>
        ))}
        {days.map((d, i) => {
          const col = Math.floor(i / 7);
          const row = i % 7;
          const x = labelW + col * (cell + gap);
          const y = row * (cell + gap);
          const empty = d.state === 'before' || d.state === 'future';
          return (
            <rect
              key={d.date}
              x={x}
              y={y}
              width={cell}
              height={cell}
              rx={4}
              fill={HEAT[d.state]}
              stroke={hover === i ? C.text : empty ? C.grid : 'none'}
              strokeWidth={hover === i ? 1.5 : 1}
              strokeDasharray={empty && hover !== i ? '2 3' : undefined}
              onMouseEnter={() => pick(i)}
              onClick={() => pick(hover === i ? null : i)}
            />
          );
        })}
      </svg>
      <div className="mt-3 flex items-center gap-4 text-[11px] text-muted">
        {(['none', 'one', 'both'] as const).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-[3px]" style={{ background: HEAT[s] }} />
            {DAY_LABEL[s]}
          </span>
        ))}
      </div>
    </div>
  );
}
