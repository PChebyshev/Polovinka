import { useEffect, useState } from 'react';
import type { MemoryCard as M } from '@polovinka/shared';
import { api } from '../lib/api';

const KEY = 'polovinka.memory.hidden';
const LABEL: Record<number, string> = { 30: 'Месяц назад', 182: 'Полгода назад', 365: 'Год назад' };

/** «В этот день»: вопрос, на который пара ответила месяц, полгода или год назад. */
export function MemoryCardBox({ myName, partnerName }: { myName: string; partnerName: string }) {
  const [m, setM] = useState<M | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    api
      .memory()
      .then((r) => {
        if (!r.memory) return;
        try {
          if (localStorage.getItem(KEY) === r.memory.round.id) return setHidden(true);
        } catch {
          /* приватный режим */
        }
        setM(r.memory);
      })
      .catch(() => undefined);
  }, []);

  if (!m || hidden) return null;
  const q = m.round.question;
  const label = (c: string | undefined) => (c === undefined ? '—' : q.format === 'scale' ? `${c} из 5` : c === 'a' ? q.a : q.b);
  const hide = () => {
    try {
      localStorage.setItem(KEY, m.round.id);
    } catch {
      /* приватный режим */
    }
    setHidden(true);
  };
  return (
    <div className="rounded-3xl border border-sand/40 bg-gradient-to-br from-sand/10 to-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-sand">В этот день · {LABEL[m.daysAgo] ?? `${m.daysAgo} дней назад`}</div>
        <button className="text-xs text-muted" onClick={hide} aria-label="Скрыть">
          ✕
        </button>
      </div>
      <div className="mt-1 font-semibold leading-snug">{q.text}</div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-surface-2 px-3 py-2">
          <div className="text-[11px] text-muted">{myName}</div>
          {label(m.round.mine?.choice)}
        </div>
        <div className="rounded-xl bg-surface-2 px-3 py-2">
          <div className="text-[11px] text-muted">{partnerName}</div>
          {label(m.round.partner?.choice)}
        </div>
      </div>
      <div className="mt-2 text-xs text-muted">А сейчас ответили бы так же?</div>
    </div>
  );
}
