import { useCallback, useEffect, useState } from 'react';
import type { HistoryItem } from '@polovinka/shared';
import { GESTURE_LABELS } from '@polovinka/shared';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { choiceLabel, formatDate, formatDateTime, guessHit, matchPercent, nDays, nDiscoveries } from '../lib/format';
import { Button, Card, Heart, Label, Spinner } from '../components/ui';
import { LevelBar } from '../components/LevelBar';
import { Link } from 'react-router-dom';

const MILESTONES = [10, 50, 100, 365];

export function History() {
  const { me } = useStore();
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [onlyFav, setOnlyFav] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (before: string | null, replace: boolean) => {
      setLoading(true);
      try {
        const r = await api.history(before, onlyFav);
        setItems((prev) => (replace || !prev ? r.items : [...prev, ...r.items]));
        setNext(r.nextBefore);
      } finally {
        setLoading(false);
      }
    },
    [onlyFav],
  );

  useEffect(() => {
    setItems(null);
    void load(null, true);
  }, [load]);

  if (!me) return null;
  const c = me.counters;
  const partnerName = me.partner?.name ?? 'половинка';
  const pct = matchPercent(c.guessesRight, c.guessesTotal);
  const nextMilestone = MILESTONES.find((m) => m > c.discoveries);

  const toggleFav = async (it: HistoryItem) => {
    const refId = it.type === 'round' ? it.round.id : it.gesture.id;
    const r = await api.toggleFavorite(it.type, refId);
    setItems((prev) => prev?.map((x) => (x === it ? { ...x, favoriteMine: r.favorite } : x)) ?? prev);
  };

  let lastDay = '';

  return (
    <div className="mx-auto max-w-md px-4 pb-28 pt-4">
      <h1 className="text-2xl font-bold">Наша история</h1>
      <p className="mt-1 text-sm text-muted">{me.partner ? `${me.user.name} и ${me.partner.name}` : me.user.name}</p>

      <div className="mt-4 grid grid-cols-3 gap-2">
        {[
          [nDiscoveries(c.discoveries).split(' ')[0], nDiscoveries(c.discoveries).split(' ')[1]],
          [pct === null ? '—' : `${pct}%`, 'знаем друг друга'],
          [String(c.daysTogether), nDays(c.daysTogether).split(' ')[1] + ' в игре'],
        ].map(([n, l]) => (
          <div key={l} className="rounded-2xl border border-line bg-surface px-3 py-3 text-center">
            <div className="text-2xl font-bold">{n}</div>
            <div className="text-xs text-muted">{l}</div>
          </div>
        ))}
      </div>
      <div className="mt-3">
        <LevelBar counters={c} />
      </div>
      {nextMilestone && <p className="-mt-2 mb-3 text-xs text-muted">Следующая веха: {nextMilestone} открытий, осталось {nextMilestone - c.discoveries}.</p>}

      {me.partner && (
        <div className="mb-4 grid grid-cols-2 gap-2">
          <Link to="/week" className="rounded-2xl border border-line bg-surface px-4 py-3 text-center text-sm">
            Итог недели
          </Link>
          <Link to="/challenge" className="rounded-2xl border border-line bg-surface px-4 py-3 text-center text-sm">
            Вызвать пару
          </Link>
        </div>
      )}

      <div className="mb-3 flex gap-2">
        <button className={`rounded-full px-4 py-2 text-sm ${!onlyFav ? 'bg-accent text-bg' : 'bg-surface-2 text-muted'}`} onClick={() => setOnlyFav(false)}>
          Всё
        </button>
        <button className={`rounded-full px-4 py-2 text-sm ${onlyFav ? 'bg-accent text-bg' : 'bg-surface-2 text-muted'}`} onClick={() => setOnlyFav(true)}>
          ♥ Любимые
        </button>
      </div>

      {items === null ? (
        <Spinner />
      ) : items.length === 0 ? (
        <Card>
          <p className="text-muted">{onlyFav ? 'Любимых моментов пока нет. Нажмите сердечко у любого момента.' : 'История начнётся с первого ответа.'}</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((it) => {
            const day = it.at.slice(0, 10);
            const header = day !== lastDay ? <Label className="pt-2">{formatDate(day)}</Label> : null;
            lastDay = day;
            const heart = (
              <button onClick={() => toggleFav(it)} className={`rounded-full p-2 ${it.favoriteMine ? 'text-rose' : 'text-muted/60'}`} aria-label="Любимый момент">
                <Heart className="h-5 w-5" filled={it.favoriteMine || it.favoritePartner} />
              </button>
            );
            if (it.type === 'gesture') {
              const g = it.gesture;
              const fromMe = g.fromUserId === me.user.id;
              return (
                <div key={g.id}>
                  {header}
                  <Card tone="rose" className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs text-muted">
                        {fromMe ? `Я → ${partnerName}` : `${partnerName} → мне`} · {GESTURE_LABELS[g.type]}
                      </div>
                      <div className="mt-1 font-semibold">{g.text}</div>
                      <div className="mt-1 text-xs text-muted">{formatDateTime(g.createdAt)}</div>
                    </div>
                    {heart}
                  </Card>
                </div>
              );
            }
            const r = it.round;
            const q = r.question;
            const revealed = r.status === 'revealed' && r.partner;
            const same = revealed && r.mine && r.partner && r.mine.choice === r.partner.choice;
            const hitMine = !!(revealed && r.mine && r.partner && guessHit(q.format, r.mine.guess, r.partner.choice));
            const hitTheirs = !!(revealed && r.mine && r.partner && guessHit(q.format, r.partner.guess, r.mine.choice));
            const bothGuessed = hitMine && hitTheirs;
            return (
              <div key={r.id}>
                {header}
                <Card className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-muted">
                      {r.kind === 'bonus' ? 'Бонус' : 'Вопрос дня'}
                      {revealed ? (bothGuessed ? ' · угадали друг друга' : hitMine ? ' · я угадал(а)' : hitTheirs ? ` · ${partnerName} угадал(а)` : ' · открытие') + (same ? ', выбрали одно' : '') : ' · ждём ответа'}
                    </div>
                    <div className="mt-1 font-semibold leading-snug">{q.text}</div>
                    <div className="mt-2 space-y-1 text-sm">
                      <div>
                        <span className="text-muted">{me.user.name}:</span> {r.mine ? choiceLabel(q, r.mine.choice) : '—'}
                        {r.mine?.whyText || r.mine?.whyChip ? <span className="text-muted"> — {r.mine.whyText || r.mine.whyChip}</span> : null}
                      </div>
                      <div>
                        <span className="text-muted">{partnerName}:</span> {revealed && r.partner ? choiceLabel(q, r.partner.choice) : r.partnerAnswered ? 'ответ скрыт до раскрытия' : '—'}
                        {revealed && (r.partner?.whyText || r.partner?.whyChip) ? <span className="text-muted"> — {r.partner.whyText || r.partner.whyChip}</span> : null}
                      </div>
                    </div>
                  </div>
                  {heart}
                </Card>
              </div>
            );
          })}
          {next && (
            <Button variant="secondary" className="w-full" onClick={() => load(next, false)} disabled={loading}>
              Показать ещё
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
