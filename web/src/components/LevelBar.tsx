import { Link } from 'react-router-dom';
import type { Counters } from '@polovinka/shared';

export function LevelBar({ counters: c }: { counters: Counters }) {
  const span = c.nextLevelAt === null ? 1 : c.nextLevelAt - c.levelStartAt;
  const done = c.nextLevelAt === null ? 1 : Math.min(1, (c.discoveries - c.levelStartAt) / span);
  const left = c.nextLevelAt === null ? null : c.nextLevelAt - c.discoveries;
  return (
    <Link to="/history" className="mb-4 block rounded-2xl border border-line bg-surface px-4 py-3">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-text">Уровень {c.level}</span>
        <span className="text-muted">{left === null ? 'Максимум' : `ещё ${left} до уровня ${c.level + 1}`}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-gradient-to-r from-accent to-sand transition-all duration-700" style={{ width: `${Math.max(4, done * 100)}%` }} />
      </div>
    </Link>
  );
}
