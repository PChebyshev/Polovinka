import { useState } from 'react';
import type { PairStage } from '@polovinka/shared';
import { STAGES } from '@polovinka/shared';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { Button, Card, Chip, Label } from './ui';

const KEY = 'polovinka.stageCard.later';
const LATER_DAYS = 3;

function postponed(): boolean {
  try {
    const at = Number(localStorage.getItem(KEY) ?? 0);
    return at > 0 && Date.now() - at < LATER_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

/**
 * «Сколько вы вместе?» — первым делом после входа. Если отложили, спросим снова через три дня.
 * От ответа зависят темы вопросов: долгим парам — больше о жизни сейчас, меньше лёгких.
 */
export function StageCard() {
  const { me, setMe } = useStore();
  const [hidden, setHidden] = useState(postponed);
  const [stage, setStage] = useState<PairStage | null>(null);
  const [kids, setKids] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  if (!me || me.pair.isGuest || me.pair.stage || hidden) return null;

  const save = async () => {
    if (!stage) return;
    setBusy(true);
    try {
      setMe(await api.setProfile({ stage, hasKids: kids }));
    } finally {
      setBusy(false);
    }
  };
  const later = () => {
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {
      /* приватный режим */
    }
    setHidden(true);
  };

  return (
    <Card tone="accent" className="rise">
      <Label>Чтобы вопросы подходили именно вам</Label>
      <h2 className="mt-2 text-lg font-semibold">Сколько вы вместе?</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {STAGES.map((s) => (
          <Chip key={s.key} active={stage === s.key} onClick={() => setStage(s.key)}>
            {s.label}
          </Chip>
        ))}
      </div>
      <p className="mt-4 text-sm text-muted">Есть дети? Необязательно</p>
      <div className="mt-2 flex gap-2">
        <Chip active={kids === true} onClick={() => setKids(kids === true ? null : true)}>
          Да
        </Chip>
        <Chip active={kids === false} onClick={() => setKids(kids === false ? null : false)}>
          Пока нет
        </Chip>
      </div>
      <Button className="mt-4 w-full" onClick={save} disabled={!stage || busy}>
        Готово
      </Button>
      <button className="mt-2 w-full py-1 text-center text-sm text-muted" onClick={later}>
        Позже
      </button>
    </Card>
  );
}
