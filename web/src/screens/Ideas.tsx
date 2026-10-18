import { useCallback, useEffect, useState } from 'react';
import type { Idea } from '@polovinka/shared';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { Button, Card, Spinner } from '../components/ui';

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

/** «Хотим вместе»: общий список идей. Сделанные попадают в историю и «Книгу пары». */
export function Ideas() {
  const { me, refresh } = useStore();
  const [list, setList] = useState<Idea[] | null>(null);
  const [tab, setTab] = useState<'want' | 'done'>('want');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await api.ideas();
    setList(r.ideas);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (!me) return null;
  const partnerName = me.partner?.name ?? 'половинка';
  const want = (list ?? []).filter((i) => !i.doneAt);
  const done = (list ?? []).filter((i) => i.doneAt).sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''));
  const shown = tab === 'want' ? want : done;

  const add = async () => {
    if (text.trim().length < 3) return;
    setBusy(true);
    try {
      await api.addIdea(text.trim());
      setText('');
      await load();
      void refresh();
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (i: Idea) => {
    await api.doneIdea(i.id, !i.doneAt);
    await load();
    void refresh();
  };
  const remove = async (i: Idea) => {
    await api.removeIdea(i.id);
    await load();
    void refresh();
  };

  return (
    <div className="mx-auto max-w-md px-4 pb-28 pt-4">
      <h1 className="text-2xl font-bold">Хотим вместе</h1>
      <p className="mt-1 text-sm text-muted">Идеи из ваших ответов и ваши собственные. Сделали — отметьте, и это останется в вашей истории.</p>

      <div className="mt-4 flex gap-2">
        <input
          className="min-w-0 flex-1 rounded-2xl border border-line bg-surface-2 px-4 py-3 outline-none focus:border-accent/60"
          placeholder="Например: съездить на море в сентябре"
          maxLength={240}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
        />
        <Button variant="secondary" onClick={add} disabled={busy || text.trim().length < 3}>
          +
        </Button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-1 rounded-2xl bg-surface p-1">
        {(
          [
            ['want', `Хотим · ${want.length}`],
            ['done', `Сделали · ${done.length}`],
          ] as const
        ).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-xl py-2 text-sm font-semibold ${tab === k ? 'bg-accent text-bg' : 'text-muted'}`}>
            {label}
          </button>
        ))}
      </div>

      {list === null ? (
        <Spinner />
      ) : shown.length === 0 ? (
        <Card className="mt-4 text-center text-sm text-muted">
          {tab === 'want'
            ? 'Пока пусто. После раскрытия вопроса нажмите «Хотим попробовать» у идеи — или добавьте свою.'
            : 'Здесь появится то, что вы уже сделали вместе.'}
        </Card>
      ) : (
        <div className="mt-4 space-y-2">
          {shown.map((i) => (
            <div key={i.id} className="flex items-start gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
              <button
                onClick={() => toggle(i)}
                aria-label={i.doneAt ? 'Вернуть в «Хотим»' : 'Отметить «сделали»'}
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs ${i.doneAt ? 'border-sage bg-sage text-bg' : 'border-muted/60'}`}
              >
                {i.doneAt ? '✓' : ''}
              </button>
              <div className="flex-1">
                <div className={`text-sm leading-snug ${i.doneAt ? 'text-muted' : ''}`}>{i.text}</div>
                <div className="mt-1 text-[11px] text-muted">
                  {i.doneAt ? `сделали ${fmt(i.doneAt)}` : `${i.createdBy === me.user.id ? 'добавил(а) я' : `добавил(а) ${partnerName}`} · ${fmt(i.createdAt)}`}
                  {i.source === 'ai' ? ' · идея по вашим ответам' : i.source === 'round' ? ' · из вопроса' : ''}
                </div>
              </div>
              <button className="text-xs text-muted" onClick={() => remove(i)} aria-label="Убрать">
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
