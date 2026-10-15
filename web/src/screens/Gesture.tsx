import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GestureType } from '@polovinka/shared';
import { GESTURE_CHIPS, GESTURE_LABELS, LEVEL_HUG } from '@polovinka/shared';
import { api, clientId, QueuedError } from '../lib/api';
import { useStore } from '../lib/store';
import { Button, Card, Chip, Label } from '../components/ui';
import { InviteCard } from '../components/InviteCard';
import { buzz } from '../lib/share';

const BASE_TYPES: GestureType[] = ['thanks', 'thinking', 'proud'];

export function Gesture() {
  const { me, refresh } = useStore();
  const nav = useNavigate();
  const [type, setType] = useState<GestureType>('thanks');
  const [chip, setChip] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [saved, setSaved] = useState(false);
  const [queued, setQueued] = useState(false);

  if (!me) return null;
  const TYPES: GestureType[] = me.counters.level >= LEVEL_HUG ? [...BASE_TYPES, 'hug'] : BASE_TYPES;
  if (!me.partner) {
    return (
      <div className="mx-auto max-w-md px-4 pb-28 pt-4">
        <h1 className="mb-4 text-2xl font-bold">Тёплый жест</h1>
        <p className="mb-4 text-muted">Жесты приходят половинке карточкой. Сначала позови её.</p>
        <InviteCard />
      </div>
    );
  }

  const compose = () => {
    const base = GESTURE_LABELS[type];
    const extra = text.trim();
    if (type === 'thanks') {
      const what = chip ?? (extra ? `…${extra}` : '');
      return `${base.replace('…', '')}${what.replace(/^…/, '')}`.trim() + (chip && extra ? `. ${extra}` : '');
    }
    const parts = [chip, extra].filter(Boolean);
    return parts.length ? parts.join('. ') : base;
  };

  const saveTemplate = async () => {
    await api.addTemplate(type, text.trim());
    setSaved(true);
    void refresh();
  };

  const send = async () => {
    setBusy(true);
    buzz([10, 30, 10]);
    try {
      await api.sendGesture(type, compose(), clientId());
      setSent(true);
      void refresh();
      window.setTimeout(() => nav('/'), 900);
    } catch (e) {
      if (e instanceof QueuedError) {
        setSent(true);
        setQueued(true);
        window.setTimeout(() => nav('/'), 1500);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 pb-28 pt-4">
      <h1 className="text-2xl font-bold">Тёплый жест</h1>
      <p className="mt-1 text-sm text-muted">{me.partner.name} получит карточку. Один тап, и дома теплее.</p>

      <div className={`mt-4 grid gap-2 ${TYPES.length === 4 ? 'grid-cols-2' : 'grid-cols-3'}`}>
        {TYPES.map((t) => (
          <button
            key={t}
            onClick={() => {
              setType(t);
              setChip(null);
            }}
            className={`rounded-2xl border px-2 py-4 text-sm font-semibold transition active:scale-95 ${type === t ? 'border-accent bg-accent/15 text-text' : 'border-line bg-surface text-muted'}`}
          >
            {GESTURE_LABELS[t]}
          </button>
        ))}
      </div>

      <Card className="mt-4">
        <Label>Готовые варианты</Label>
        <div className="mt-3 flex flex-wrap gap-2">
          {[...me.gestureTemplates.filter((t) => t.type === type).map((t) => t.text), ...GESTURE_CHIPS[type]].map((c) => (
            <Chip key={c} active={chip === c} onClick={() => setChip(chip === c ? null : c)}>
              {c}
            </Chip>
          ))}
        </div>
        <input
          className="mt-3 w-full rounded-2xl border border-line bg-surface-2 px-4 py-3 outline-none focus:border-accent/60"
          placeholder="Дописать своими словами…"
          maxLength={200}
          value={text}
          onChange={(e) => setText(e.target.value)}
          enterKeyHint="send"
          onKeyDown={(e) => e.key === 'Enter' && void send()}
        />
      </Card>

      <div className="mt-4 rounded-2xl bg-surface-2 px-4 py-3 text-sm">
        <span className="text-muted">Увидит {me.partner.name}: </span>
        {compose()}
      </div>

      <Button className="mt-4 w-full" big onClick={send} disabled={busy || sent}>
        {sent ? (queued ? 'Отправится, когда появится сеть' : 'Отправлено ♥') : 'Отправить'}
      </Button>
      {text.trim() && !saved && (
        <button className="mt-3 w-full text-center text-xs text-muted underline decoration-dotted" onClick={saveTemplate}>
          Сохранить «{text.trim()}» как свой шаблон
        </button>
      )}
      {saved && <p className="mt-3 text-center text-xs text-sage">Шаблон сохранён</p>}
    </div>
  );
}
