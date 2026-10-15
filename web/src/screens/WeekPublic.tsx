import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { WeekPublic as W } from '@polovinka/shared';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { nDiscoveries, plural } from '../lib/format';
import { Button, Card, Heart, Spinner } from '../components/ui';

export function WeekPublicScreen() {
  const { code = '' } = useParams();
  const nav = useNavigate();
  const { me } = useStore();
  const [w, setW] = useState<W | null | 'missing'>(null);

  useEffect(() => {
    api.weekPublic(code).then(setW).catch(() => setW('missing'));
  }, [code]);

  if (w === null) return <Spinner />;
  const title = w === 'missing' ? null : w.names[1] ? `${w.names[0]} и ${w.names[1]}` : w.names[0];

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      {w === 'missing' ? (
        <Card>
          <p>Карточка не найдена.</p>
        </Card>
      ) : (
        <Card tone="accent">
          <div className="text-accent">
            <Heart className="h-10 w-10" />
          </div>
          <div className="mt-3 text-sm uppercase tracking-wider text-muted">Итог недели</div>
          <h1 className="mt-1 text-3xl font-bold">{title}</h1>
          {w.stats.matchPercent !== null && w.stats.matchPercent > 0 && w.stats.guessesTotal >= 4 ? (
            <>
              <div className="mt-4 text-5xl font-extrabold text-accent">{w.stats.matchPercent}%</div>
              <div className="text-muted">знаем друг друга</div>
            </>
          ) : (
            <>
              <div className="mt-4 text-5xl font-extrabold text-accent">{w.stats.discoveries}</div>
              <div className="text-muted">{plural(w.stats.discoveries, 'открытие', 'открытия', 'открытий')} друг о друге за неделю</div>
            </>
          )}
          <div className="mt-3 text-lg">
            {nDiscoveries(w.stats.discoveries)} · {w.stats.gestures} {plural(w.stats.gestures, 'тёплый жест', 'тёплых жеста', 'тёплых жестов')}
          </div>
          {w.hasImage && <img className="mt-4 w-full rounded-2xl" src={`/api/week/${code}/image.png`} alt="" />}
        </Card>
      )}
      <p className="mt-6 text-center text-muted">Один вопрос в день на двоих. 20 секунд утром, маленькое открытие вечером.</p>
      <Button className="mt-4 w-full" big onClick={() => nav('/')}>
        {me ? 'К нашему вопросу дня' : 'Начать свой ритуал'}
      </Button>
    </div>
  );
}
