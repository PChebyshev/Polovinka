import { useState } from 'react';
import type { PairStage } from '@polovinka/shared';
import { STAGES } from '@polovinka/shared';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { Card, Chip, Label } from './ui';

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition ${on ? 'bg-accent' : 'bg-surface-2 ring-1 ring-line'}`}
    >
      <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-text transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}

/** «О нас»: сколько вместе, дети, «Близость» и подсказки заботы. */
export function AboutUs() {
  const { me, setMe } = useStore();
  const [busy, setBusy] = useState(false);
  if (!me) return null;
  const partnerName = me.partner?.name ?? 'половинка';
  const profile = async (patch: { stage?: PairStage | null; hasKids?: boolean | null }) => {
    setBusy(true);
    try {
      setMe(await api.setProfile(patch));
    } finally {
      setBusy(false);
    }
  };
  const prefs = async (patch: { intimacy?: boolean; careHints?: boolean }) => {
    setBusy(true);
    try {
      setMe(await api.setPrefs(patch));
    } finally {
      setBusy(false);
    }
  };
  const p = me.prefs;
  const intimacyOn = p.intimacy && p.partnerIntimacy;

  return (
    <Card className="mt-4">
      <Label>О нас</Label>
      <p className="mt-2 text-sm text-muted">От этого зависят вопросы: долгим парам — больше о жизни сейчас, меньше лёгких.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {STAGES.map((s) => (
          <Chip key={s.key} active={me.pair.stage === s.key} onClick={() => !busy && profile({ stage: s.key })}>
            {s.label}
          </Chip>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-sm text-muted">Дети:</span>
        <Chip active={me.pair.hasKids === true} onClick={() => !busy && profile({ hasKids: me.pair.hasKids === true ? null : true })}>
          Есть
        </Chip>
        <Chip active={me.pair.hasKids === false} onClick={() => !busy && profile({ hasKids: me.pair.hasKids === false ? null : false })}>
          Пока нет
        </Chip>
      </div>
      {me.pair.hasKids && <p className="mt-2 text-xs text-muted">Открыт набор «Мы родители».</p>}

      <div className="mt-5 flex items-start justify-between gap-4">
        <div>
          <div className="font-semibold">Набор «Близость»</div>
          <div className="mt-0.5 text-sm text-muted">
            Нежные вопросы о романтике и близости, без откровенностей. Не чаще раза в неделю. Включится, только когда согласятся оба.
          </div>
          <div className="mt-1 text-xs">
            {intimacyOn ? (
              <span className="text-sage">✓ Включён у вас обоих</span>
            ) : p.intimacy ? (
              <span className="text-muted">Ждём, когда {partnerName} тоже включит</span>
            ) : p.partnerIntimacy ? (
              <span className="text-accent">{partnerName} уже за — решать вам</span>
            ) : null}
          </div>
        </div>
        <Toggle label="Набор «Близость»" on={p.intimacy} onChange={(v) => !busy && prefs({ intimacy: v })} />
      </div>

      <div className="mt-5 flex items-start justify-between gap-4">
        <div>
          <div className="font-semibold">Подсказки заботы</div>
          <div className="mt-0.5 text-sm text-muted">Иногда подсказывать половинке, что меня радует, — по моим ответам. Не чаще раза в неделю, видит только она.</div>
        </div>
        <Toggle label="Подсказки заботы" on={p.careHints} onChange={(v) => !busy && prefs({ careHints: v })} />
      </div>
    </Card>
  );
}
