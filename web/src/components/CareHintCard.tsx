import { useEffect, useState } from 'react';
import type { CareHint } from '@polovinka/shared';
import { api } from '../lib/api';

/** Подсказка заботы: что радует половинку, по её ответам. Не чаще раза в неделю. */
export function CareHintCard() {
  const [hint, setHint] = useState<CareHint | null>(null);
  useEffect(() => {
    api
      .careHint()
      .then((r) => setHint(r.hint))
      .catch(() => undefined);
  }, []);
  if (!hint) return null;
  const close = () => {
    void api.careSeen(hint.id).catch(() => undefined);
    setHint(null);
  };
  return (
    <div className="rounded-3xl border border-sage/40 bg-sage/10 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-sage">Подсказка заботы</div>
        <button className="text-xs text-muted" onClick={close} aria-label="Скрыть">
          ✕
        </button>
      </div>
      <p className="mt-1.5 text-sm leading-snug">{hint.text}</p>
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-[11px] text-muted">Видите только вы</span>
        <button className="text-sm text-sage" onClick={close}>
          Спасибо, сделаю
        </button>
      </div>
    </div>
  );
}
