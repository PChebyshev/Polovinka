import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';

const KEY = 'polovinka.accessNudge.dismissedAt';

/** Одно спокойное напоминание: после трёх открытий, если нет ни кода восстановления, ни почты. */
export function AccessNudge() {
  const { me } = useStore();
  const [hidden, setHidden] = useState(() => {
    try {
      return !!localStorage.getItem(KEY);
    } catch {
      return false;
    }
  });
  if (!me || hidden || me.access.emailRequired || me.access.hasRecovery || me.access.email || me.counters.discoveries < 3) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {
      /* приватный режим */
    }
    setHidden(true);
  };
  return (
    <div className="rounded-2xl border border-lilac/40 bg-lilac/10 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">Сохраните доступ к истории</div>
          <div className="mt-1 text-sm text-muted">
            У вас уже {me.counters.discoveries} открытий. Вход хранится только в этом телефоне: создайте код восстановления на случай переустановки.
          </div>
          <Link to="/settings" className="mt-2 inline-block text-sm text-accent">
            Создать код →
          </Link>
        </div>
        <button className="shrink-0 text-xs text-muted" onClick={dismiss} aria-label="Скрыть">
          ✕
        </button>
      </div>
    </div>
  );
}
