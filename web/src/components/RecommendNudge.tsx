import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';

const KEY = 'polovinka.recommendNudge.dismissedAt';

/** Один раз, после недели игры: предложить посоветовать друзьям. Не показывается вместе с напоминанием о доступе. */
export function RecommendNudge() {
  const { me } = useStore();
  const [hidden, setHidden] = useState(() => {
    try {
      return !!localStorage.getItem(KEY);
    } catch {
      return false;
    }
  });
  if (!me || hidden || !me.partner || me.counters.discoveries < 7) return null;
  if (!me.access.hasRecovery && !me.access.email) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {
      /* приватный режим */
    }
    setHidden(true);
  };
  return (
    <div className="rounded-2xl border border-accent/30 bg-accent/10 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">Нравится вам Половинка?</div>
          <div className="mt-1 text-sm text-muted">Если есть пара, которой это тоже подойдёт, — у нас есть готовое сообщение со ссылкой.</div>
          <Link to="/recommend" onClick={dismiss} className="mt-2 inline-block text-sm text-accent">
            Посоветовать друзьям →
          </Link>
        </div>
        <button className="shrink-0 text-xs text-muted" onClick={dismiss} aria-label="Скрыть">
          ✕
        </button>
      </div>
    </div>
  );
}
