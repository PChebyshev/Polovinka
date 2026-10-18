import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { BookEntry, BookResponse, RoundPublic } from '@polovinka/shared';
import { GESTURE_LABELS, LEVEL_BOOK, LEVEL_INFO } from '@polovinka/shared';
import { api, ApiError } from '../lib/api';
import { useStore } from '../lib/store';
import { guessHit, plural } from '../lib/format';
import { Button, Card, Spinner } from '../components/ui';
import { LevelEmblem } from '../components/badges';

function monthOf(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(/\s*г\.$/, '');
}
function dayOf(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function RoundEntry({ r, myName, partnerName }: { r: RoundPublic; myName: string; partnerName: string }) {
  const q = r.question;
  const label = (c: string | undefined) => (c === undefined ? '—' : q.format === 'scale' ? `${c} из 5` : c === 'a' ? q.a : q.b);
  const why = (a: RoundPublic['mine']) => (a ? a.whyText || a.whyChip : null);
  const both = r.mine && r.partner && guessHit(q.format, r.mine.guess, r.partner.choice) && guessHit(q.format, r.partner.guess, r.mine.choice);
  return (
    <div className="book-entry py-3">
      <div className="text-[11px] text-muted">
        {dayOf(r.revealedAt ?? r.date)}
        {both ? ' · угадали друг друга' : ''}
        {r.kind === 'repeat' ? ' · повтор' : ''}
      </div>
      <div className="mt-0.5 font-semibold leading-snug">{q.text}</div>
      <div className="mt-1.5 grid grid-cols-2 gap-x-4 text-sm">
        <div>
          <span className="text-muted">{myName}: </span>
          {label(r.mine?.choice)}
          {why(r.mine) && <div className="mt-0.5 text-xs italic text-muted">«{why(r.mine)}»</div>}
        </div>
        <div>
          <span className="text-muted">{partnerName}: </span>
          {label(r.partner?.choice)}
          {why(r.partner) && <div className="mt-0.5 text-xs italic text-muted">«{why(r.partner)}»</div>}
        </div>
      </div>
    </div>
  );
}

function Entry({ e, myId, myName, partnerName }: { e: BookEntry; myId: string; myName: string; partnerName: string }) {
  const nameOf = (id: string) => (id === myId ? myName : partnerName);
  if (e.type === 'round') return <RoundEntry r={e.round} myName={myName} partnerName={partnerName} />;
  if (e.type === 'gesture') {
    const g = e.gesture;
    return (
      <div className="book-entry py-2 text-sm">
        <span className="text-muted">
          {dayOf(g.createdAt)} · {nameOf(g.fromUserId)} → {nameOf(g.toUserId)}, {GESTURE_LABELS[g.type].toLowerCase()}:
        </span>{' '}
        {g.text}
      </div>
    );
  }
  if (e.type === 'capsule') {
    const c = e.capsule;
    return (
      <div className="book-entry my-2 rounded-2xl border border-sand/40 p-3">
        <div className="text-[11px] text-sand">
          Капсула времени · написана {dayOf(c.createdAt)}, открыта {dayOf(c.opensAt)}
        </div>
        <div className="mt-0.5 font-semibold">{c.prompt}</div>
        {c.letters.map((l) => (
          <div key={l.userId} className="mt-2 text-sm">
            <span className="text-muted">{nameOf(l.userId)}: </span>
            <span className="whitespace-pre-wrap">{l.text}</span>
          </div>
        ))}
      </div>
    );
  }
  if (e.type === 'idea') {
    return (
      <div className="book-entry py-2 text-sm">
        <span className="text-sage">✓ Сделали вместе · {dayOf(e.at)}:</span> {e.idea.text}
      </div>
    );
  }
  return (
    <div className="book-entry py-2 text-center text-xs text-accent">
      ✦ {e.title} · {dayOf(e.at)} ✦
    </div>
  );
}

/** «Книга пары»: вся история одной лентой, готовая к печати и сохранению в PDF. */
export function Book() {
  const { me } = useStore();
  const [data, setData] = useState<BookResponse | null>(null);
  const [locked, setLocked] = useState(false);
  const [err, setErr] = useState(false);

  useEffect(() => {
    api
      .book()
      .then(setData)
      .catch((e) => (e instanceof ApiError && e.status === 403 ? setLocked(true) : setErr(true)));
  }, []);

  if (!me) return null;
  const myName = me.user.name;
  const partnerName = me.partner?.name ?? 'Половинка';

  if (locked) {
    const need = LEVEL_INFO[LEVEL_BOOK - 1].at;
    const left = Math.max(0, need - me.counters.discoveries);
    return (
      <div className="mx-auto max-w-md px-4 pb-28 pt-4">
        <h1 className="text-2xl font-bold">Книга пары</h1>
        <Card className="mt-4">
          <div className="flex items-center gap-4">
            <LevelEmblem level={LEVEL_BOOK} reached={false} size={64} />
            <p className="text-sm text-muted">
              Вся ваша история одной книгой: вопросы, ответы и «почему», жесты, письма из капсул. Откроется на уровне {LEVEL_BOOK} — ещё {left}{' '}
              {plural(left, 'открытие', 'открытия', 'открытий')}.
            </p>
          </div>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (me.counters.discoveries / need) * 100)}%` }} />
          </div>
          <p className="mt-4 text-xs text-muted">Скачать историю файлом можно уже сейчас: Настройки → Приватность.</p>
        </Card>
      </div>
    );
  }
  if (err)
    return (
      <div className="mx-auto max-w-md px-4 pb-28 pt-4">
        <Card>Не получилось собрать книгу. Проверьте связь.</Card>
      </div>
    );
  if (!data) return <Spinner />;

  const months: Array<{ month: string; entries: BookEntry[] }> = [];
  for (const e of data.entries) {
    const m = monthOf(e.at);
    if (months[months.length - 1]?.month !== m) months.push({ month: m, entries: [] });
    months[months.length - 1].entries.push(e);
  }
  const c = data.counters;
  const title = data.names.length > 1 ? `${data.names[0]} и ${data.names[1]}` : data.names[0];

  return (
    <div className="book mx-auto max-w-md px-4 pb-28 pt-4">
      <div className="no-print mb-4 flex items-center justify-between gap-3">
        <Link to="/history" className="text-sm text-muted">
          ← История
        </Link>
        <Button variant="secondary" onClick={() => window.print()}>
          Сохранить PDF
        </Button>
      </div>
      <p className="no-print -mt-2 mb-4 text-xs text-muted">
        Если кнопка не сработала: откройте сайт в Safari → «Поделиться» → «Напечатать», затем «Поделиться» → «Сохранить в Файлы».
      </p>

      <section className="book-cover rounded-3xl border border-accent/30 bg-gradient-to-br from-accent/15 via-surface to-lilac/10 px-6 py-10 text-center">
        <div className="flex justify-center">
          <LevelEmblem level={c.level} reached size={72} />
        </div>
        <div className="mt-4 text-xs uppercase tracking-[0.2em] text-muted">Книга пары</div>
        <h1 className="mt-2 text-3xl font-bold">{title}</h1>
        <div className="mt-2 text-sm text-muted">с {new Date(data.since).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
        <div className="mt-6 grid grid-cols-3 gap-2 text-sm">
          <div>
            <div className="text-2xl font-bold">{c.discoveries}</div>
            <div className="text-xs text-muted">{plural(c.discoveries, 'открытие', 'открытия', 'открытий')}</div>
          </div>
          <div>
            <div className="text-2xl font-bold">{c.daysTogether}</div>
            <div className="text-xs text-muted">{plural(c.daysTogether, 'день', 'дня', 'дней')} вместе</div>
          </div>
          <div>
            <div className="text-2xl font-bold">{c.guessesTotal ? Math.round((c.guessesRight / c.guessesTotal) * 100) : '—'}%</div>
            <div className="text-xs text-muted">знаем друг друга</div>
          </div>
        </div>
      </section>

      {months.map((m) => (
        <section key={m.month} className="book-month mt-8">
          <h2 className="border-b border-line pb-1 text-lg font-bold capitalize">{m.month}</h2>
          <div className="divide-y divide-line/60">
            {m.entries.map((e, i) => (
              <Entry key={i} e={e} myId={me.user.id} myName={myName} partnerName={partnerName} />
            ))}
          </div>
        </section>
      ))}

      <p className="mt-10 text-center text-xs text-muted">Половинка · polovinka.online</p>
    </div>
  );
}
