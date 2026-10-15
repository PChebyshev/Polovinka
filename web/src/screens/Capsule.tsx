import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CapsulePublic } from '@polovinka/shared';
import { LEVEL_CAPSULE } from '@polovinka/shared';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { Button, Card, Chip, Label, Spinner } from '../components/ui';

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

export function Capsule() {
  const { me, refresh } = useStore();
  const [data, setData] = useState<{ prompts: string[]; capsules: CapsulePublic[]; level: number; days: number } | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [text, setText] = useState('');
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
          <p className="text-muted">Откроется на уровне {LEVEL_CAPSULE}. Вы напишете друг другу письма, которые можно будет прочитать только через месяц.</p>
          <Link to="/levels" className="mt-3 inline-block text-sm text-accent">
            Посмотреть уровни →
          </Link>
        </Card>
      </div>
    );
  }

  const active = data.capsules.find((c) => !c.opened) ?? null;
  const opened = data.capsules.filter((c) => c.opened);
  const iWrote = active?.wroteIds.includes(me.user.id) ?? false;
  const partnerWrote = active ? active.wroteIds.some((id) => id !== me.user.id) : false;

  const create = async () => {
    if (!prompt) return;
    setBusy(true);
    try {
      await api.createCapsule(prompt);
      await load();
      void refresh();
    } finally {
      setBusy(false);
    }
  };
  const write = async () => {
    if (!active || !text.trim()) return;
    setBusy(true);
    try {
      await api.writeCapsule(active.id, text.trim());
      setText('');
      await load();
      void refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 pb-28 pt-4">
      <h1 className="text-2xl font-bold">Капсула времени</h1>
      <p className="mt-1 text-sm text-muted">Письма друг другу, которые откроются через {data.days} дней. До этого их не видит никто, даже вы сами.</p>

      {!active && (
        <Card tone="accent" className="mt-4">
          <Label>Новая капсула</Label>
          <p className="mt-2 text-sm text-muted">О чём напишете?</p>
          <div className="mt-3 flex flex-wrap gap-2">
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

      {active && (
        <Card tone="accent" className="mt-4">
          <Label>Откроется {fmt(active.opensAt)}</Label>
          <div className="mt-2 text-lg font-semibold">{active.prompt}</div>
          <div className="mt-2 text-sm text-muted">
            {iWrote ? 'Ваше письмо в капсуле. Можно переписать до открытия.' : 'Ваше письмо ещё не в капсуле.'} {partnerWrote ? `${partnerName} уже написал(а).` : `${partnerName} ещё не написал(а).`}
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
      )}

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
