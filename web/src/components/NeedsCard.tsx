import { useEffect, useMemo, useState } from 'react';
import { NEEDS, NEEDS_PICK } from '@polovinka/shared';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { Button, Card, Label } from './ui';

const KEY = 'polovinka.needs.later';
const LATER_DAYS = 3;

/** Порядок пунктов перемешан — одинаково для одного человека, чтобы первые строки не выигрывали за счёт места. */
function shuffled(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822519) ^ (h >>> 13)) >>> 0) / 4294967296;
  return [...NEEDS].sort(() => rnd() - 0.5);
}

/**
 * «Чего вам хочется от отношений?» — три самых важных по порядку. Один раз, после первого открытия
 * (или через два дня). Ответы — для понимания, какие потребности приводят людей; на подбор вопросов не влияют.
 */
export function NeedsCard() {
  const { me, setMe } = useStore();
  const [hidden, setHidden] = useState(() => {
    try {
      return Date.now() - Number(localStorage.getItem(KEY) ?? 0) < LATER_DAYS * 86_400_000;
    } catch {
      return false;
    }
  });
  const [picked, setPicked] = useState<string[]>([]);
  const [other, setOther] = useState('');
  const [gender, setGender] = useState<'m' | 'f' | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const items = useMemo(() => shuffled(me?.user.id ?? ''), [me?.user.id]);
  const show = !!me?.needsDue && !hidden;

  useEffect(() => {
    if (show) void api.track('needs_shown');
  }, [show]);

  if (done)
    return (
      <Card tone="sage">
        <p className="text-sm">Спасибо! Так мы лучше поймём, какие вопросы и идеи вам нужнее.</p>
      </Card>
    );
  if (!show || !me) return null;

  const toggle = (key: string) => {
    setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : p.length < NEEDS_PICK ? [...p, key] : p));
  };
  const later = () => {
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {
      /* приватный режим */
    }
    void api.track('needs_dismissed');
    setHidden(true);
  };
  const send = async () => {
    if (picked.length !== NEEDS_PICK) return;
    setBusy(true);
    try {
      const m = await api.needs(picked, other.trim() || undefined, gender ?? undefined);
      setDone(true);
      window.setTimeout(() => setMe(m), 2500);
    } finally {
      setBusy(false);
    }
  };
  const left = NEEDS_PICK - picked.length;

  return (
    <Card tone="accent">
      <Label>Один вопрос о вас</Label>
      <h2 className="mt-2 font-semibold leading-snug">Чего вам сейчас хочется от отношений?</h2>
      <p className="mt-1 text-sm text-muted">Выберите три самых важных по порядку: первое — самое важное. Ответ видите только вы.</p>
      <div className="mt-3 space-y-2">
        {items.map((n) => {
          const idx = picked.indexOf(n.key);
          const on = idx >= 0;
          return (
            <button
              key={n.key}
              onClick={() => toggle(n.key)}
              disabled={!on && left === 0}
              aria-pressed={on}
              className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left text-sm transition ${
                on ? 'border-accent bg-accent/15' : 'border-line bg-surface-2 disabled:opacity-40'
              }`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${on ? 'bg-accent text-bg' : 'border border-line text-muted'}`}
              >
                {on ? idx + 1 : ''}
              </span>
              {n.label}
            </button>
          );
        })}
      </div>
      {left === 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-muted">
          <span>Вы:</span>
          {(
            [
              ['m', 'мужчина'],
              ['f', 'женщина'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setGender(gender === k ? null : k)}
              aria-pressed={gender === k}
              className={`rounded-full border px-3 py-1.5 ${gender === k ? 'border-accent bg-accent/15 text-text' : 'border-line bg-surface-2'}`}
            >
              {label}
            </button>
          ))}
          <span className="text-xs">необязательно</span>
        </div>
      )}
      {left === 0 && (
        <label className="mt-3 block text-sm text-muted">
          Своими словами: чего не хватает сейчас? Необязательно
          <input
            className="mt-1 w-full rounded-2xl border border-line bg-surface-2 px-4 py-3 text-sm outline-none focus:border-accent/60"
            maxLength={500}
            value={other}
            onChange={(e) => setOther(e.target.value)}
            placeholder="Например: вечеров без телефонов"
          />
        </label>
      )}
      <Button className="mt-4 w-full" onClick={send} disabled={left > 0 || busy}>
        {left > 0 ? `Ещё ${left === 3 ? 'три' : left === 2 ? 'два' : 'один'}` : 'Отправить'}
      </Button>
      <button className="mt-2 w-full py-1 text-center text-sm text-muted" onClick={later}>
        Не сейчас
      </button>
    </Card>
  );
}
