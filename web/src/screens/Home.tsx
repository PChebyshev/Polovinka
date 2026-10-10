import { useState } from 'react';
import type { RoundPublic } from '@polovinka/shared';
import { api, ApiError, clientId } from '../lib/api';
import { useStore } from '../lib/store';
import { formatDate, matchPercent, nDays, nDiscoveries } from '../lib/format';
import { Button, Card, Label, Spinner } from '../components/ui';
import { QuestionCard } from '../components/QuestionCard';
import { WaitingCard } from '../components/WaitingCard';
import { InviteCard } from '../components/InviteCard';
import { RevealFlow } from '../components/RevealFlow';
import { GestureCard } from '../components/GestureToast';
import { LevelBar } from '../components/LevelBar';

export function Home() {
  const { me, today, setToday, refresh, error, offline } = useStore();
  const [busy, setBusy] = useState(false);
  const [bonusBusy, setBonusBusy] = useState(false);

  if (!me) return null;
  const partner = me.partner;
  const myName = me.user.name;

  const patchRound = (r: RoundPublic) =>
    setToday((prev) => {
      if (!prev) return prev;
      const swap = (x: RoundPublic) => (x.id === r.id ? r : x);
      return { ...prev, daily: swap(prev.daily), bonus: prev.bonus.map(swap), pending: prev.pending.map(swap) };
    });

  const answer = async (round: RoundPublic, choice: string, guess: string | null) => {
    setBusy(true);
    // Оптимистично: ответ сохраняется сразу, экран не ждёт сеть.
    patchRound({ ...round, mine: { userId: me.user.id, choice, guess, whyText: null, whyChip: null, createdAt: new Date().toISOString() } });
    try {
      const r = await api.answer(round.id, choice, guess, clientId());
      patchRound(r);
      void refresh();
    } catch (e) {
      if (!(e instanceof TypeError)) await refresh();
    } finally {
      setBusy(false);
    }
  };

  const bonus = async () => {
    setBonusBusy(true);
    try {
      const r = await api.bonus();
      setToday((prev) => (prev ? { ...prev, bonus: [...prev.bonus, r], bonusLeft: Math.max(0, prev.bonusLeft - 1) } : prev));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'bonus_limit') await refresh();
    } finally {
      setBonusBusy(false);
    }
  };

  const skip = async (round: RoundPublic) => {
    setBusy(true);
    try {
      const r = await api.skipRound(round.id);
      patchRound(r.round);
    } finally {
      setBusy(false);
    }
  };

  const seenGesture = async (id: string) => {
    await api.gestureSeen(id).catch(() => undefined);
    void refresh();
  };

  const renderRound = (round: RoundPublic, title?: string) => {
    if (!round.mine)
      return (
        <QuestionCard
          key={`${round.id}:${round.question.id}`}
          round={round}
          partnerName={partner?.name ?? null}
          onAnswer={(c, g) => answer(round, c, g)}
          onSkip={() => skip(round)}
          busy={busy}
          title={title}
        />
      );
    if (round.status === 'revealed' && round.partner && partner) {
      return (
        <RevealFlow
          key={round.id}
          round={round}
          myName={myName}
          partnerName={partner.name}
          onUpdated={patchRound}
          onBonus={round.kind === 'daily' ? bonus : undefined}
          bonusLeft={today?.bonusLeft}
        />
      );
    }
    return <WaitingCard key={round.id} round={round} partnerName={partner?.name ?? null} />;
  };

  const c = me.counters;
  const pct = matchPercent(c.matches, c.discoveries);

  return (
    <div className="mx-auto max-w-md px-4 pb-28 pt-4">
      <header className="mb-4 flex items-end justify-between">
        <div>
          <div className="text-sm text-muted">{partner ? `${myName} и ${partner.name}` : myName}</div>
          <h1 className="text-2xl font-bold">
            {pct === null ? 'Мы на %' : `Мы на ${pct}%`}
          </h1>
        </div>
        <div className="text-right text-xs text-muted">
          <div>{nDiscoveries(c.discoveries)}</div>
          <div>{nDays(c.daysTogether)} вместе в игре</div>
        </div>
      </header>
      {partner && <LevelBar counters={c} />}

      {offline && <div className="mb-3 rounded-2xl bg-surface-2 px-4 py-2 text-center text-xs text-muted">Нет сети. Ответы сохранятся и отправятся, когда она появится.</div>}

      <div className="space-y-4">
        {me.unseenGestures.map((g) => (
          <GestureCard key={g.id} gesture={g} fromName={partner?.name ?? 'половинка'} onSeen={() => seenGesture(g.id)} />
        ))}

        {!partner && !today?.daily.mine && <InviteCard />}

        {today?.pending.map((r) => renderRound(r, `${partner?.name ?? 'Половинка'} ждёт ответ за ${formatDate(r.date)}`))}

        {error === 'no_questions_left' && (
          <Card>
            <Label>Вопросы кончились</Label>
            <p className="mt-2 text-muted">Вы прошли весь банк. Добавьте свои вопросы в настройках, и они появятся здесь.</p>
          </Card>
        )}

        {!today && !error ? <Spinner /> : null}
        {today && renderRound(today.daily)}

        {today?.bonus.map((r) => renderRound(r))}

        {today && today.daily.mine && today.daily.status !== 'revealed' && today.bonusLeft > 0 && partner && (
          <Button variant="ghost" className="w-full" onClick={bonus} disabled={bonusBusy}>
            Пока ждём, ещё один вопрос? Осталось {today.bonusLeft}
          </Button>
        )}
      </div>
    </div>
  );
}
