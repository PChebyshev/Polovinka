import { useCallback, useEffect, useState } from 'react';
import type { Idea } from '@polovinka/shared';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { addDaysLocal, nextSaturday, relDay, todayLocal } from '../lib/format';
import { Button, Card, Chip, Label, Spinner } from '../components/ui';
import { GestureComposer } from '../components/GestureComposer';
import { InviteCard } from '../components/InviteCard';

const STARTERS = ['Ужин без телефонов', 'Прогулка в новом месте', 'Кино под пледом', 'Приготовить что-то новое вместе', 'Встретить рассвет'];

/** Выбор даты: быстрые варианты и календарь. */
function DatePicker({ onPick, onCancel, initial }: { onPick: (date: string, time: string | null) => void; onCancel: () => void; initial?: string | null }) {
  const today = todayLocal();
  const [date, setDate] = useState(initial ?? '');
  const [time, setTime] = useState('');
  const quick: Array<[string, string]> = [
    ['Сегодня', today],
    ['Завтра', addDaysLocal(today, 1)],
    ['В субботу', nextSaturday(today) === today ? addDaysLocal(today, 7) : nextSaturday(today)],
    ['Через неделю', addDaysLocal(today, 7)],
  ];
  const input = 'rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent/60';
  return (
    <div className="mt-2 rounded-2xl bg-bg/40 p-3">
      <div className="flex flex-wrap gap-2">
        {quick.map(([label, d]) => (
          <Chip key={label} active={date === d} onClick={() => setDate(d)}>
            {label}
          </Chip>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input type="date" className={`min-w-0 flex-1 ${input}`} min={today} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Дата" />
        <input type="time" className={`w-28 ${input}`} value={time} onChange={(e) => setTime(e.target.value)} aria-label="Время, необязательно" />
      </div>
      <div className="mt-2 flex gap-2">
        <Button className="flex-1" onClick={() => date && onPick(date, time || null)} disabled={!date}>
          {date ? `Запланировать на ${relDay(date, today)}` : 'Выберите день'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </div>
  );
}

function PlanRow({ i, onChanged, partnerName, myId }: { i: Idea; onChanged: () => Promise<void>; partnerName: string; myId: string }) {
  const [picking, setPicking] = useState(false);
  const today = todayLocal();
  const isToday = i.plannedFor === today;
  const overdue = !!i.plannedFor && i.plannedFor < today;
  const act = async (fn: () => Promise<unknown>) => {
    await fn();
    setPicking(false);
    await onChanged();
  };
  return (
    <div className={`rounded-2xl border px-4 py-3 ${isToday ? 'border-accent/50 bg-accent/10' : 'border-line bg-surface'}`}>
      <div className="flex items-start gap-3">
        <div className={`w-16 shrink-0 text-xs font-semibold ${isToday ? 'text-accent' : overdue ? 'text-sand' : 'text-lilac'}`}>
          {relDay(i.plannedFor!, today)}
          {i.plannedTime && <div className="font-normal text-muted">{i.plannedTime}</div>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm leading-snug">{i.text}</div>
          <div className="mt-1 text-[11px] text-muted">{i.createdBy === myId ? 'добавил(а) я' : `добавил(а) ${partnerName}`}</div>
          <div className="mt-2 flex gap-4 text-xs">
            <button className="text-sage" onClick={() => act(() => api.doneIdea(i.id, true))}>
              ✓ Сделали
            </button>
            <button className="text-muted" onClick={() => setPicking(!picking)}>
              Перенести
            </button>
            <button className="text-muted" onClick={() => act(() => api.planIdea(i.id, null))}>
              Без даты
            </button>
          </div>
        </div>
      </div>
      {picking && <DatePicker initial={i.plannedFor} onCancel={() => setPicking(false)} onPick={(d, t) => act(() => api.planIdea(i.id, d, t))} />}
    </div>
  );
}

function WishRow({ i, onChanged, partnerName, myId }: { i: Idea; onChanged: () => Promise<void>; partnerName: string; myId: string }) {
  const [picking, setPicking] = useState(false);
  const act = async (fn: () => Promise<unknown>) => {
    await fn();
    setPicking(false);
    await onChanged();
  };
  return (
    <div className="rounded-2xl border border-line bg-surface px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm leading-snug">{i.text}</div>
          <div className="mt-1 text-[11px] text-muted">
            {i.createdBy === myId ? 'добавил(а) я' : `добавил(а) ${partnerName}`}
            {i.source === 'ai' ? ' · идея по вашим ответам' : i.source === 'round' ? ' · из вопроса' : ''}
          </div>
        </div>
        <button className="text-xs text-muted" onClick={() => act(() => api.removeIdea(i.id))} aria-label="Убрать">
          ✕
        </button>
      </div>
      <div className="mt-2 flex gap-4 text-xs">
        <button className="text-accent" onClick={() => setPicking(!picking)}>
          📅 Запланировать
        </button>
        <button className="text-sage" onClick={() => act(() => api.doneIdea(i.id, true))}>
          ✓ Уже сделали
        </button>
      </div>
      {picking && <DatePicker onCancel={() => setPicking(false)} onPick={(d, t) => act(() => api.planIdea(i.id, d, t))} />}
    </div>
  );
}

/**
 * «Вместе»: планы на ближайшие дни, список «Хотим вместе», тёплый жест и то, что уже сделали.
 * Было «Жест» — жест остался, но теперь это место про совместную жизнь, а не только про сообщения.
 */
export function Together() {
  const { me, refresh } = useStore();
  const [list, setList] = useState<Idea[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(async () => {
    const r = await api.ideas();
    setList(r.ideas);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (!me) return null;
  if (!me.partner) {
    return (
      <div className="mx-auto max-w-md px-4 pb-28 pt-4">
        <h1 className="mb-2 text-2xl font-bold">Вместе</h1>
        <p className="mb-4 text-muted">Здесь будут ваши общие планы и тёплые жесты. Сначала позовите половинку.</p>
        <InviteCard />
      </div>
    );
  }

  const changed = async () => {
    await load();
    void refresh();
  };
  const partnerName = me.partner.name;
  const all = list ?? [];
  const plans = all
    .filter((i) => !i.doneAt && i.plannedFor)
    .sort((a, b) => `${a.plannedFor}${a.plannedTime ?? '99'}`.localeCompare(`${b.plannedFor}${b.plannedTime ?? '99'}`));
  const wishes = all.filter((i) => !i.doneAt && !i.plannedFor);
  const done = all.filter((i) => i.doneAt).sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''));

  const add = async (t = text) => {
    if (t.trim().length < 3) return;
    setBusy(true);
    try {
      await api.addIdea(t.trim());
      setText('');
      await changed();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 pb-28 pt-4">
      <h1 className="text-2xl font-bold">Вместе</h1>
      <p className="mt-1 text-sm text-muted">Ваши планы, общие желания и маленькие знаки внимания.</p>

      <Card className="mt-4">
        <Label>Тёплый жест</Label>
        <p className="mt-1 text-sm text-muted">{partnerName} получит карточку. Один тап, и дома теплее.</p>
        <div className="mt-3">
          <GestureComposer />
        </div>
      </Card>

      {list === null ? (
        <Spinner />
      ) : (
        <>
          <div className="mt-6 flex items-baseline justify-between">
            <Label>Планы</Label>
            {plans.length > 0 && <span className="text-xs text-muted">{plans.length}</span>}
          </div>
          {plans.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Пока ничего не запланировано. Выберите идею ниже и нажмите «Запланировать».</p>
          ) : (
            <div className="mt-2 space-y-2">
              {plans.map((i) => (
                <PlanRow key={i.id} i={i} onChanged={changed} partnerName={partnerName} myId={me.user.id} />
              ))}
            </div>
          )}

          <div className="mt-6 flex items-baseline justify-between">
            <Label>Хотим вместе</Label>
            {wishes.length > 0 && <span className="text-xs text-muted">{wishes.length}</span>}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              className="min-w-0 flex-1 rounded-2xl border border-line bg-surface-2 px-4 py-3 outline-none focus:border-accent/60"
              placeholder="Чего хочется вместе?"
              maxLength={240}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void add()}
            />
            <Button variant="secondary" onClick={() => add()} disabled={busy || text.trim().length < 3}>
              +
            </Button>
          </div>
          {wishes.length === 0 ? (
            <div className="mt-3">
              <p className="text-sm text-muted">Идеи появляются после ответов на вопросы — кнопка «Хотим попробовать». Или начните с простого:</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {STARTERS.map((s) => (
                  <Chip key={s} onClick={() => add(s)}>
                    + {s}
                  </Chip>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              {wishes.map((i) => (
                <WishRow key={i.id} i={i} onChanged={changed} partnerName={partnerName} myId={me.user.id} />
              ))}
            </div>
          )}

          {done.length > 0 && (
            <div className="mt-6">
              <div className="flex items-baseline justify-between">
                <Label>Сделали вместе</Label>
                <span className="text-xs text-muted">{done.length}</span>
              </div>
              <div className="mt-2 space-y-1.5">
                {(showDone ? done : done.slice(0, 3)).map((i) => (
                  <div key={i.id} className="flex items-start gap-2 text-sm">
                    <span className="text-sage">✓</span>
                    <span className="flex-1 text-muted">{i.text}</span>
                    <button className="text-[11px] text-muted underline decoration-dotted" onClick={async () => (await api.doneIdea(i.id, false), changed())}>
                      вернуть
                    </button>
                  </div>
                ))}
              </div>
              {done.length > 3 && (
                <button className="mt-2 text-xs text-muted" onClick={() => setShowDone(!showDone)}>
                  {showDone ? 'Свернуть' : `Ещё ${done.length - 3}`}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
