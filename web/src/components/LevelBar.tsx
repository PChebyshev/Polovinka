import { Link } from 'react-router-dom';
import type { Counters } from '@polovinka/shared';
import { LEVEL_INFO, levelName } from '@polovinka/shared';
import { plural } from '../lib/format';

export function LevelBar({ counters: c }: { counters: Counters }) {
  const span = c.nextLevelAt === null ? 1 : c.nextLevelAt - c.levelStartAt;
  const done = c.nextLevelAt === null ? 1 : Math.min(1, (c.discoveries - c.levelStartAt) / span);
  const left = c.nextLevelAt === null ? 0 : c.nextLevelAt - c.discoveries;
  const next = LEVEL_INFO[c.level];
  return (
    <Link to="/levels" className="mb-4 block rounded-2xl border border-line bg-surface px-4 py-3">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-text">
          Уровень {c.level} · {levelName(c.level)}
        </span>
        <span className="text-muted">все уровни →</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent to-sand transition-all duration-700"
          style={{ width: `${Math.max(4, done * 100)}%` }}
        />
      </div>
      <div className="mt-2 text-xs text-muted">
        {next
          ? `Ещё ${left} ${plural(left, 'открытие', 'открытия', 'открытий')} — ${next.soon ? 'скоро: ' : 'откроется '}${next.unlock}`
          : 'Высший уровень. Вы — легенда.'}
      </div>
    </Link>
  );
}
