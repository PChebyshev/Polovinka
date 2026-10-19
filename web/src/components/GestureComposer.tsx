import { useState } from 'react';
import type { GestureType } from '@polovinka/shared';
import { GESTURE_CHIPS, GESTURE_LABELS, LEVEL_HUG } from '@polovinka/shared';
import { api, clientId, QueuedError } from '../lib/api';
import { useStore } from '../lib/store';
import { Button, Chip } from './ui';
import { buzz } from '../lib/share';

const BASE_TYPES: GestureType[] = ['thanks', 'thinking', 'proud'];

/** Тёплый жест: выбрать вид, готовый вариант или свои слова — и отправить. Раскрывается по тапу на вид. */
export function GestureComposer() {
  const { me, refresh } = useStore();
  const [type, setType] = useState<GestureType | null>(null);
  const [chip, setChip] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<'ok' | 'queued' | null>(null);
  const [saved, setSaved] = useState(false);
  if (!me?.partner) return null;
  const TYPES: GestureType[] = me.counters.level >= LEVEL_HUG ? [...BASE_TYPES, 'hug'] : BASE_TYPES;

  const compose = (t: GestureType) => {
    const base = GESTURE_LABELS[t];
    const extra = text.trim();
    if (t === 'thanks') {
      const what = chip ?? (extra ? `…${extra}` : '');
      return `${base.replace('…', '')}${what.replace(/^…/, '')}`.trim() + (chip && extra ? `. ${extra}` : '');
    }
    const parts = [chip, extra].filter(Boolean);
    return parts.length ? parts.join('. ') : base;
  };

  const reset = () => {
    setType(null);
    setChip(null);
    setText('');
    setSaved(false);
  };

  const send = async () => {
    if (!type) return;
    setBusy(true);
    buzz([10, 30, 10]);
    try {
      await api.sendGesture(type, compose(type), clientId());
      setSent('ok');
      void refresh();
    } catch (e) {
      if (e instanceof QueuedError) setSent('queued');
    } finally {
      setBusy(false);
      reset();
      window.setTimeout(() => setSent(null), 2500);
    }
  };

  const saveTemplate = async () => {
    if (!type) return;
    await api.addTemplate(type, text.trim());
    setSaved(true);
    void refresh();
  };

  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        {TYPES.map((t) => (
          <button
            key={t}
            onClick={() => {
              setType(type === t ? null : t);
              setChip(null);
            }}
            className={`rounded-2xl border px-2 py-2.5 text-sm font-semibold leading-tight transition active:scale-95 ${type === t ? 'border-accent bg-accent/15 text-text' : 'border-line bg-surface-2 text-muted'}`}
          >
            {GESTURE_LABELS[t]}
          </button>
        ))}
      </div>
      {sent && <p className="mt-2 text-center text-sm text-sage">{sent === 'ok' ? 'Отправлено ♥' : 'Отправится, когда появится сеть'}</p>}
      {type && (
        <div className="mt-3">
          <div className="flex flex-wrap gap-2">
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
          <div className="mt-2 rounded-2xl bg-surface-2/60 px-4 py-2 text-sm">
            <span className="text-muted">Увидит {me.partner.name}: </span>
            {compose(type)}
          </div>
          <Button className="mt-3 w-full" onClick={send} disabled={busy}>
            Отправить
          </Button>
          {text.trim() && !saved && (
            <button className="mt-2 w-full text-center text-xs text-muted underline decoration-dotted" onClick={saveTemplate}>
              Сохранить «{text.trim()}» как свой шаблон
            </button>
          )}
        </div>
      )}
    </div>
  );
}
