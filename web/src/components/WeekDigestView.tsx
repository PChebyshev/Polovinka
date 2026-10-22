import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { DigestDay, DigestMoment, WeekDigest } from '@polovinka/shared';
import { api } from '../lib/api';
import { RingMeter } from './charts';
import { Card, Label } from './ui';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export function weekRange(start: string, end: string): string {
  const d = (s: string) => Number(s.slice(8, 10));
  const m = (s: string) => MONTHS[Number(s.slice(5, 7)) - 1];
  return m(start) === m(end) ? `${d(start)}–${d(end)} ${m(end)}` : `${d(start)} ${m(start)} — ${d(end)} ${m(end)}`;
}

const plural = (n: number, one: string, few: string, many: string) =>
  n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many;

/** Семь дней: ответили оба — полный круг, один — половина, никто — пустой. Сердечко — выбрали одно и то же. */
function WeekStrip({ days }: { days: DigestDay[] }) {
  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {days.map((d, i) => (
          <div key={d.date} className="flex flex-col items-center gap-1.5">
            <span className="text-[11px] text-muted">{WEEKDAYS[i]}</span>
            <svg
              width="34"
              height="34"
              viewBox="0 0 34 34"
              role="img"
              aria-label={d.state === 'both' ? 'ответили оба' : d.state === 'one' ? 'ответил один' : 'без ответов'}
            >
              <circle cx="17" cy="17" r="15" fill="none" stroke="var(--color-line)" strokeWidth="2" />
              {d.state === 'both' && <circle cx="17" cy="17" r="15" fill="var(--color-accent)" />}
              {d.state === 'one' && <path d="M17 2 A15 15 0 0 1 17 32 Z" fill="var(--color-accent)" opacity="0.75" />}
              {d.match && <path d="M17 24.5 L11.2 18.8 A3.4 3.4 0 0 1 17 13.6 A3.4 3.4 0 0 1 22.8 18.8 Z" fill="var(--color-bg)" />}
            </svg>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-muted">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-accent" />
          оба ответили
        </span>
        <span className="flex items-center gap-1">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full border border-line"
            style={{ background: 'linear-gradient(90deg, transparent 50%, var(--color-accent) 50%)' }}
          />
          один
        </span>
        <span className="flex items-center gap-1">
          <span className="text-accent">♥</span>
          выбрали одно и то же
        </span>
      </div>
    </div>
  );
}

function Moment({ label, m, names, tone }: { label: string; m: DigestMoment; names: [string, string]; tone: 'sage' | 'rose' }) {
  return (
    <Card tone={tone}>
      <Label>{label}</Label>
      <div className="mt-2 font-semibold leading-snug">{m.question}</div>
      <div className="mt-3 space-y-2">
        {names.map((n, i) => (
          <div key={n} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-muted">{n}</span>
            <span className="text-right">
              «{m.answers[i]}»
              <span className={`ml-2 text-[11px] ${m.guessed[1 - i] ? 'text-sage' : 'text-muted'}`}>
                {m.guessed[1 - i] ? `${names[1 - i]} угадал(а)` : `${names[1 - i]} не угадал(а)`}
              </span>
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Tip({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'saved'>('idle');
  const save = async () => {
    setState('busy');
    try {
      await api.addIdea(text);
      setState('saved');
    } catch {
      setState('idle');
    }
  };
  return (
    <div className="rounded-2xl border border-line bg-surface px-4 py-3">
      <div className="text-sm leading-snug">{text}</div>
      {state === 'saved' ? (
        <Link to="/together" className="mt-2 inline-block text-xs text-sage">
          ✓ Во вкладке «Вместе» — можно запланировать
        </Link>
      ) : (
        <button className="mt-2 text-xs text-accent" onClick={save} disabled={state === 'busy'}>
          + Хотим попробовать
        </button>
      )}
    </div>
  );
}

/** «Ваша неделя»: история от ИИ, дни, совпадение и сюрприз, выводы и идеи на неделю. */
export function WeekDigestView({ d }: { d: WeekDigest }) {
  const s = d.story;
  const pct = d.guessesTotal ? Math.round((d.guessesRight / d.guessesTotal) * 100) : null;
  const both = d.days.filter((x) => x.state === 'both').length;

  return (
    <div className="space-y-4">
      <Card className="rise">
        <div className="flex items-center justify-between">
          <Label>Ваша неделя · {weekRange(d.weekStart, d.weekEnd)}</Label>
          {d.source === 'ai' && <span className="text-xs text-lilac">✦</span>}
        </div>
        <h2 className="mt-3 text-2xl font-bold leading-tight">{s.title}</h2>
        <p className="mt-3 leading-relaxed text-text/90">{s.story}</p>
      </Card>

      {d.source !== 'quiet' && (
        <>
          <Card>
            <WeekStrip days={d.days} />
            <div className="mt-5 flex items-center gap-4">
              <RingMeter value={pct} size={112} />
              <div className="space-y-1.5 text-sm">
                <div className="text-muted">угадали друг друга</div>
                <div>
                  <b>{d.matches}</b> {plural(d.matches, 'раз', 'раза', 'раз')} выбрали одно и то же
                </div>
                <div>
                  <b>{both}</b> {plural(both, 'день', 'дня', 'дней')} ответили вдвоём
                </div>
                {d.gestures > 0 && (
                  <div>
                    <b>{d.gestures}</b> {plural(d.gestures, 'тёплый жест', 'тёплых жеста', 'тёплых жестов')}
                  </div>
                )}
              </div>
            </div>
            {d.topics.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {d.topics.map((t) => (
                  <span key={t} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs text-muted">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </Card>

          {d.matchMoment && <Moment label="Совпадение недели" m={d.matchMoment} names={d.names} tone="sage" />}
          {d.surpriseMoment && (
            <Moment
              label={
                d.surpriseMoment.same
                  ? 'Ещё одно совпадение'
                  : d.surpriseMoment.guessed[0] && d.surpriseMoment.guessed[1]
                    ? 'Разные — и знаете это'
                    : 'Сюрприз недели'
              }
              m={d.surpriseMoment}
              names={d.names}
              tone="rose"
            />
          )}

          {s.discoveries.length > 0 && (
            <Card>
              <Label>Что вы узнали друг о друге</Label>
              <ul className="mt-3 space-y-2.5">
                {s.discoveries.map((t) => (
                  <li key={t} className="flex gap-2.5 text-sm leading-snug">
                    <span className="text-accent">•</span>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {s.insight && (
            <div className="rounded-3xl border border-lilac/40 bg-lilac/10 p-5">
              <div className="text-xs font-semibold uppercase tracking-wider text-lilac">Наблюдение ✦</div>
              <p className="mt-2 leading-relaxed">{s.insight}</p>
            </div>
          )}

          {d.ideasDone.length > 0 && (
            <Card>
              <Label>Сделали вместе</Label>
              <ul className="mt-2 space-y-1 text-sm">
                {d.ideasDone.map((t) => (
                  <li key={t}>
                    <span className="text-sage">✓</span> {t}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {s.tips.length > 0 && (
            <div>
              <Label className="mb-2 px-1">На эту неделю</Label>
              <div className="space-y-2">
                {s.tips.map((t) => (
                  <Tip key={t} text={t} />
                ))}
              </div>
            </div>
          )}

          {s.question && (
            <Card tone="accent">
              <Label>Вопрос для разговора</Label>
              <p className="mt-2 text-lg font-semibold leading-snug">{s.question}</p>
            </Card>
          )}
        </>
      )}

      <Link to="/" className="block text-center text-sm text-accent">
        К вопросу дня →
      </Link>
    </div>
  );
}
