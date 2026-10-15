import { Link } from 'react-router-dom';
import { LEVEL_INFO, STREAK_MILESTONES } from '@polovinka/shared';
import { useStore } from '../lib/store';
import { Card, Label } from '../components/ui';
import { LevelBar } from '../components/LevelBar';
import { LevelEmblem, StreakMedal } from '../components/badges';

export function Levels() {
  const { me } = useStore();
  if (!me) return null;
  const c = me.counters;
  return (
    <div className="mx-auto max-w-md px-4 pb-28 pt-4">
      <h1 className="text-2xl font-bold">Уровни пары</h1>
      <p className="mt-1 text-sm text-muted">Уровень растёт с каждым открытием — вопросом, на который ответили оба. Каждый уровень что-то открывает.</p>
      <div className="mt-4">
        <LevelBar counters={c} />
      </div>
      <div className="space-y-2">
        {LEVEL_INFO.map((l) => {
          const reached = c.level >= l.level;
          const current = c.level === l.level;
          return (
            <Card key={l.level} tone={current ? 'accent' : 'surface'} className={reached ? '' : 'opacity-70'}>
              <div className="flex gap-3">
                <LevelEmblem level={l.level} reached={reached} size={52} className="shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <Label>
                      Уровень {l.level} · {l.at} открытий
                    </Label>
                    <span className="text-xs text-muted">{current ? 'сейчас' : reached ? 'пройден' : l.soon ? 'скоро' : `ещё ${l.at - c.discoveries}`}</span>
                  </div>
                  <div className="mt-0.5 text-lg font-semibold">{l.name}</div>
                  <div className="mt-0.5 text-sm text-muted">
                    {l.level === 1 ? 'Начало: лёгкие и смешные вопросы.' : `${reached ? 'Открыто' : l.soon ? 'Готовим' : 'Откроет'}: ${l.unlock}.`}
                  </div>
                  {reached && l.level === 3 && (
                    <Link to="/capsule" className="mt-2 inline-block text-sm text-accent">
                      Открыть капсулу времени →
                    </Link>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      <Card className="mt-4">
        <Label>Медали серии</Label>
        <div className="mt-1 text-sm text-muted">Дни подряд, когда ответили оба. Лучшая серия — {me.streak.best}.</div>
        <div className="mt-3 flex justify-around">
          {STREAK_MILESTONES.map((d) => (
            <div key={d} className="flex flex-col items-center gap-1">
              <StreakMedal days={d} reached={me.streak.best >= d} size={56} />
              <span className="text-xs text-muted">{d} дней</span>
            </div>
          ))}
        </div>
      </Card>
      <Link to="/topics" className="mt-4 block rounded-2xl border border-line bg-surface px-4 py-3 text-center text-sm">
        Карта тем и значки →
      </Link>
    </div>
  );
}
