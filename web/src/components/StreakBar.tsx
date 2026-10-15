import type { Streak } from '@polovinka/shared';
import { plural } from '../lib/format';

function Flame({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={`h-5 w-5 ${on ? 'text-accent' : 'text-muted/60'}`} fill="currentColor" aria-hidden>
      <path d="M12 2c1 3.5-1.5 5.3-1.5 8 0 1.4 1 2.5 2.3 2.5 1.6 0 2.4-1.3 2.2-3.3 2.4 1.7 4 4.3 4 7.1C19 20.4 15.9 23 12 23s-7-2.6-7-6.7C5 10.6 10.4 7.6 12 2z" />
    </svg>
  );
}

const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

/** Серия дней подряд: мягкая — пропуск раз в неделю прощается, вчерашний вопрос можно добрать. */
export function StreakBar({ streak }: { streak: Streak }) {
  const n = streak.current;
  const label =
    n > 0
      ? `${n} ${plural(n, 'день', 'дня', 'дней')} подряд вместе`
      : streak.best > 0
        ? `Новая серия · лучшая ${streak.best} ${plural(streak.best, 'день', 'дня', 'дней')}`
        : 'Начните серию: ответьте сегодня оба';
  return (
    <div className="mb-3 flex items-center justify-between rounded-2xl border border-line bg-surface px-4 py-2.5">
      <div className="flex items-center gap-2">
        <Flame on={n > 0} />
        <div>
          <div className="text-sm font-semibold">{label}</div>
          {n > 0 && !streak.todayDone && <div className="text-[11px] text-muted">Сегодняшний вопрос продлит серию</div>}
        </div>
      </div>
      <div className="flex gap-1.5" aria-label="Последние 7 дней">
        {streak.week.map((d) => (
          <div key={d.date} className="flex flex-col items-center gap-1">
            <span
              title={d.state === 'grace' ? 'Выходной: серия не прервалась' : undefined}
              className={`h-2.5 w-2.5 rounded-full ${
                d.state === 'done'
                  ? 'bg-accent'
                  : d.state === 'grace'
                    ? 'border border-accent/70'
                    : d.state === 'today'
                      ? 'border border-dashed border-muted'
                      : d.state === 'before'
                        ? 'bg-transparent'
                        : 'bg-surface-2'
              }`}
            />
            <span className="text-[9px] text-muted">{WD[new Date(`${d.date}T12:00:00`).getDay()]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
