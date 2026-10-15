import { useEffect, useState } from 'react';
import type { TopicProgress } from '@polovinka/shared';
import { EXPLORE_AT, KNOW_MIN_GUESSES, TOPICS } from '@polovinka/shared';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { Card, Label, Spinner } from '../components/ui';

function Badge({ on, title }: { on: boolean; title: string }) {
  return (
    <div className={`flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-xs ${on ? 'bg-sage/15 text-text' : 'bg-surface-2 text-muted'}`}>
      <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${on ? 'bg-sage text-bg' : 'border border-line'}`}>{on ? '✓' : ''}</span>
      {title}
    </div>
  );
}

export function TopicsContent() {
  const { me, setMe } = useStore();
  const [data, setData] = useState<{ level: number; topics: TopicProgress[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api.topics().then(setData).catch(() => setData({ level: 1, topics: [] }));
  }, []);

  if (!me) return null;
  if (!data) return <Spinner />;

  const earned = data.topics.reduce((s, t) => s + (t.badgeExplored ? 1 : 0) + (t.badgeKnow ? 1 : 0), 0);
  const possible = data.topics.filter((t) => t.unlocked).length * 2;

  const makeTheme = async (key: string) => {
    setBusy(key);
    try {
      setMe(await api.setTheme(key));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <p className="text-sm text-muted">
        В каждой теме два значка: «исследовали» — {EXPLORE_AT} раскрытых вопросов, и «знаем друг друга» — угадываете друг друга в трёх случаях из четырёх.
      </p>
      <Card tone="accent" className="mt-4">
        <Label>Наши значки</Label>
        <div className="mt-1 text-3xl font-bold">
          {earned} <span className="text-lg font-normal text-muted">из {possible}</span>
        </div>
      </Card>

      <div className="mt-4 space-y-3">
        {data.topics.map((t) => {
          const def = TOPICS.find((x) => x.key === t.key)!;
          if (!t.unlocked) {
            return (
              <Card key={t.key} className="opacity-60">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{t.label}</div>
                  <span className="text-xs text-muted">🔒 уровень {t.unlockLevel}</span>
                </div>
                <div className="mt-1 text-xs text-muted">Новый набор вопросов откроется на уровне {t.unlockLevel}.</div>
              </Card>
            );
          }
          const acc = t.total > 0 ? Math.round((t.right / t.total) * 100) : null;
          const discoveryZone = t.total >= 4 && t.right / t.total < 0.5;
          const isTheme = me.weekTheme === t.key;
          return (
            <Card key={t.key}>
              <div className="flex items-center justify-between">
                <div className="font-semibold">{t.label}</div>
                <span className="text-xs text-muted">{acc === null ? 'ещё не играли' : `угадываете ${t.right} из ${t.total}`}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (t.explored / EXPLORE_AT) * 100)}%` }} />
              </div>
              <div className="mt-1 text-xs text-muted">
                Раскрыто {Math.min(t.explored, EXPLORE_AT)} из {EXPLORE_AT}
                {t.explored > EXPLORE_AT ? ` (всего ${t.explored})` : ''}
                {!t.badgeKnow && t.total < KNOW_MIN_GUESSES && t.explored > 0 ? ` · для второго значка нужно ещё ${KNOW_MIN_GUESSES - t.total} догадок` : ''}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge on={t.badgeExplored} title={def.explored} />
                <Badge on={t.badgeKnow} title={def.know} />
              </div>
              {discoveryZone && <div className="mt-3 text-sm text-sand">Здесь больше всего открытий: вы ещё узнаёте друг друга.</div>}
              {t.remaining > 0 && (!t.badgeKnow || discoveryZone) && (
                <button
                  className={`mt-3 text-sm ${isTheme ? 'text-sage' : 'text-accent'}`}
                  disabled={isTheme || busy === t.key}
                  onClick={() => makeTheme(t.key)}
                >
                  {isTheme ? '✓ Тема недели' : 'Сделать темой недели →'}
                </button>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export function Topics() {
  return (
    <div className="mx-auto max-w-md px-4 pb-28 pt-4">
      <h1 className="mb-2 text-2xl font-bold">Карта тем</h1>
      <TopicsContent />
    </div>
  );
}
