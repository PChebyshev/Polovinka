import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CapsulePublic } from '@polovinka/shared';
import { LEVEL_CAPSULE } from '@polovinka/shared';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { Button, Card, Chip, Label, Spinner } from '../components/ui';

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

const TERM_LABEL: Record<number, string> = { 30: 'Через месяц', 182: 'Через полгода', 365: 'Через год' };

/** Одна запечатанная капсула: у каждой своё письмо. */
function ActiveCapsule({ c, myId, partnerName, onChanged }: { c: CapsulePublic; myId: string; partnerName: string; onChanged: () => Promise<void> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const iWrote = c.wroteIds.includes(myId);
  const partnerWrote = c.wroteIds.some((id) => id !== myId);
  const write = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api.writeCapsule(c.id, text.trim());
      setText('');
      await onChanged();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card tone="accent" className="mt-4">
      <Label>Откроется {fmt(c.opensAt)}</Label>
      <div className="mt-2 text-lg font-semibold">{c.prompt}</div>
      <div className="mt-2 text-sm text-muted">
        {iWrote ? 'Ваше письмо в капсуле. Можно переписать до открытия.' : 'Ваше письмо ещё не в капсуле.'}{' '}
        {partnerWrote ? `${partnerName} уже написал(а).` : `${partnerName} ещё не написал(а).`}
      </div>
      <textarea
        className="mt-3 w-full rounded-2xl border border-line bg-surface-2 p-3 outline-none focus:border-accent/60"
        rows={5}
        maxLength={600}
        placeholder={iWrote ? 'Новый текст заменит прежний' : `Напишите ${partnerName}…`}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <Button className="mt-2 w-full" onClick={write} disabled={busy || !text.trim()}>
        {iWrote ? 'Переписать письмо' : 'Запечатать письмо'}
      </Button>
    </Card>
  );
}

export function Capsule() {
  const { me, refresh } = useStore();
  const [data, setData] = useState<{ prompts: string[]; capsules: CapsulePublic[]; level: number; terms: number[]; canCreate: boolean } | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [days, setDays] = useState(365);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const d = await api.capsules();
    setData(d);
    setPrompt((p) => p ?? d.prompts[0]);
    for (const c of d.capsules) if (c.opened) void api.readCapsule(c.id);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!me) return null;
  if (!data) return <Spinner />;
  const partnerName = me.partner?.name ?? 'половинка';
  const nameOf = (id: string) => (id === me.user.id ? 'Я' : partnerName);

  if (data.level < LEVEL_CAPSULE) {
    return (
      <div className="mx-auto max-w-md px-4 pb-28 pt-4">
        <h1 className="text-2xl font-bold">Капсула времени</h1>
        <Card className="mt-4">
          <p className="text-muted">
            Откроется на уровне {LEVEL_CAPSULE}. Вы напишете друг другу письма, которые можно будет прочитать только через месяц, полгода или год.
          </p>
          <Link to="/levels" className="mt-3 inline-block text-sm text-accent">
            Посмотреть уровни →
          </Link>
        </Card>
      </div>
    );
  }

  const actives = data.capsules.filter((c) => !c.opened).sort((a, b) => a.opensAt.localeCompare(b.opensAt));
  const opened = data.capsules.filter((c) => c.opened);
  const changed = async () => {
    await load();
    void refresh();
  };

  const create = async () => {
    if (!prompt) return;
    setBusy(true);
    try {
      await api.createCapsule(prompt, days);
      await changed();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 pb-28 pt-4">
      <h1 className="text-2xl font-bold">Капсула времени</h1>
      <p className="mt-1 text-sm text-muted">Письма друг другу, которые откроются в выбранный день. До этого их не видит никто, даже вы сами.</p>

      {actives.map((c) => (
        <ActiveCapsule key={c.id} c={c} myId={me.user.id} partnerName={partnerName} onChanged={changed} />
      ))}

      {data.canCreate && (
        <Card className={actives.length ? 'mt-4' : 'mt-4 border-accent/30'}>
          <Label>{actives.length ? 'Ещё одна капсула' : 'Новая капсула'}</Label>
          <p className="mt-2 text-sm text-muted">Когда откроем?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {data.terms.map((t) => (
              <Chip key={t} active={days === t} onClick={() => setDays(t)}>
                {TERM_LABEL[t] ?? `Через ${t} дней`}
              </Chip>
            ))}
          </div>
          {days >= 365 && <p className="mt-2 text-xs text-muted">Через год будет особенно интересно прочитать, какими вы были сегодня.</p>}
          <p className="mt-4 text-sm text-muted">О чём напишете?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {data.prompts.map((p) => (
              <Chip key={p} active={prompt === p} onClick={() => setPrompt(p)}>
                {p}
              </Chip>
            ))}
          </div>
          <Button className="mt-4 w-full" onClick={create} disabled={busy}>
            Создать капсулу
          </Button>
        </Card>
      )}
      {!data.canCreate && actives.length > 0 && <p className="mt-3 text-center text-xs text-muted">Одновременно можно держать до трёх запечатанных капсул.</p>}

      {opened.map((c) => (
        <Card key={c.id} className="mt-4">
          <Label>
            Открыта {fmt(c.opensAt)} · написана {fmt(c.createdAt)}
          </Label>
          <div className="mt-2 font-semibold">{c.prompt}</div>
          <div className="mt-3 space-y-3">
            {c.letters.length === 0 && <p className="text-sm text-muted">Писем не оказалось. Ничего, следующая капсула ваша.</p>}
            {c.letters.map((l) => (
              <div key={l.userId} className="rounded-2xl bg-surface-2 p-3 text-sm">
                <div className="text-xs text-muted">{nameOf(l.userId)}</div>
                <div className="mt-1 whitespace-pre-wrap">{l.text}</div>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
