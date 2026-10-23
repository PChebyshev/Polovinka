import { useState } from 'react';
import type { Idea, RoundPublic } from '@polovinka/shared';
import { api, ApiError, clientId, QueuedError } from '../lib/api';
import { InstallCard } from '../components/InstallCard';
import { DesktopHandoffCard } from '../components/DesktopHandoff';
import { NotificationPrompt } from '../components/NotificationPrompt';
import { AccessNudge } from '../components/AccessNudge';
import { RecommendNudge } from '../components/RecommendNudge';
import { MemoryCardBox } from '../components/MemoryCard';
import { StageCard } from '../components/StageCard';
import { CareHintCard } from '../components/CareHintCard';
import { PersonalQuestion } from '../components/PersonalQuestion';
import { SurveyCard } from '../components/SurveyCard';
import { NeedsCard } from '../components/NeedsCard';
import { useStore } from '../lib/store';
import { formatDate, matchPercent, nDays, nDiscoveries, relDay, todayLocal } from '../lib/format';
import { Button, Card, Label, Spinner } from '../components/ui';
import { QuestionCard } from '../components/QuestionCard';
import { WaitingCard } from '../components/WaitingCard';
import { InviteCard } from '../components/InviteCard';
import { RevealFlow } from '../components/RevealFlow';
import { GestureCard } from '../components/GestureToast';
import { LevelBar } from '../components/LevelBar';
import { StreakBar } from '../components/StreakBar';
import { Link } from 'react-router-dom';

export function Home() {
  const { me, today, setToday, setMe, refresh, error, offline } = useStore();
  const [busy, setBusy] = useState(false);
  const [bonusBusy, setBonusBusy] = useState(false);
  const [queuedNote, setQueuedNote] = useState(false);

  if (!me) return null;
  const partner = me.partner;
  const myName = me.user.name;

  const patchRound = (r: RoundPublic) =>
    setToday((prev) => {
      if (!prev) return prev;
      const swap = (x: RoundPublic) => (x.id === r.id ? r : x);
      return { ...prev, daily: prev.daily ? swap(prev.daily) : null, bonus: prev.bonus.map(swap), pending: prev.pending.map(swap) };
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
      if (e instanceof QueuedError) setQueuedNote(true);
      else if (!(e instanceof TypeError)) await refresh();
    } finally {
      setBusy(false);
    }
  };

  const repeat = async () => {
    setBonusBusy(true);
    try {
      const r = await api.repeat();
      setToday((prev) => (prev ? { ...prev, bonus: [...prev.bonus.filter((x) => x.id !== r.id), r], repeatAvailable: false } : prev));
    } finally {
      setBonusBusy(false);
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

  const skip = async (round: RoundPublic, reasons: string[], comment: string) => {
    setBusy(true);
    try {
      const r = await api.skipRound(round.id, reasons, comment || undefined);
      patchRound(r.round);
      return r.replaced;
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
          onSkip={(reasons, comment) => skip(round, reasons, comment)}
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
          onRepeat={round.kind === 'daily' && today?.repeatAvailable ? repeat : undefined}
          bonusLeft={today?.bonusLeft}
        />
      );
    }
    return <WaitingCard key={round.id} round={round} partnerName={partner?.name ?? null} />;
  };

  const c = me.counters;
  const pct = matchPercent(c.guessesRight, c.guessesTotal);
  const isSunday = new Date().getDay() === 0;

  return (
    <div className="mx-auto max-w-md px-4 pb-28 pt-4">
      <header className="mb-4">
        <div className="text-sm text-muted">{partner ? `${myName} и ${partner.name}` : myName}</div>
        <h1 className="text-2xl font-bold">{pct === null ? 'Половинка' : `Знаем друг друга на ${pct}%`}</h1>
        <div className="mt-1 text-xs text-muted">
          {c.guessesTotal > 0 ? `угадали друг друга ${c.guessesRight} из ${c.guessesTotal}` : 'угадывайте выбор друг друга'} · {nDiscoveries(c.discoveries)} ·{' '}
          {nDays(c.daysTogether)} в игре
        </div>
      </header>
      {partner && <StreakBar streak={me.streak} />}
      {partner && <LevelBar counters={c} />}

      {(offline || queuedNote) && (
        <div className="mb-3 rounded-2xl bg-surface-2 px-4 py-2 text-center text-xs text-muted">
          Нет сети. Ответ сохранён на телефоне и отправится, когда она появится.
        </div>
      )}

      <div className="space-y-4">
        {partner && <StageCard />}
        <InstallCard />
        <DesktopHandoffCard />
        {partner && <NotificationPrompt />}
        {partner && <AccessNudge />}
        {partner && <RecommendNudge />}
        {partner && (me.needsDue ? <NeedsCard /> : <SurveyCard />)}
        {partner && <CareHintCard />}
        {partner && <MemoryCardBox myName={myName} partnerName={partner.name} />}

        {me.capsule.unreadOpened && (
          <Link to="/capsule" className="block rounded-2xl border border-sand/50 bg-sand/10 px-4 py-3">
            <div className="text-xs uppercase tracking-wider text-muted">Капсула времени открылась</div>
            <div className="mt-1 text-sm">Письма, написанные месяц назад, можно прочитать →</div>
          </Link>
        )}
        {me.capsule.active && !me.capsule.active.wroteIds.includes(me.user.id) && (
          <Link to="/capsule" className="block rounded-2xl border border-accent/40 bg-accent/10 px-4 py-3">
            <div className="text-xs uppercase tracking-wider text-muted">Капсула времени</div>
            <div className="mt-1 text-sm">
              {me.capsule.active.wroteIds.length > 0
                ? `${partner?.name ?? 'Половинка'} уже запечатал(а) письмо. Ваша очередь →`
                : 'Напишите письмо в капсулу →'}
            </div>
          </Link>
        )}
        {me.capsule.canCreate && !me.capsule.unreadOpened && <CapsuleInvite />}

        {me.unseenGestures.map((g) => (
          <GestureCard key={g.id} gesture={g} fromName={partner?.name ?? 'половинка'} onSeen={() => seenGesture(g.id)} />
        ))}

        {me.challenges.map((ch) => (
          <div key={ch.code} className="flex items-start gap-2 rounded-2xl border border-accent/40 bg-accent/10 py-3 pl-4 pr-2">
            <Link to={`/c/${ch.code}`} className="min-w-0 flex-1">
              <div className="text-xs uppercase tracking-wider text-muted">
                {ch.isSender ? 'Ваш вызов' : `Вызов от ${ch.fromNames[1] ? `${ch.fromNames[0]} и ${ch.fromNames[1]}` : ch.fromNames[0]}`}
              </div>
              <div className="mt-1 text-sm">
                {ch.answered < ch.total ? `Пройдено ${ch.answered} из ${ch.total}` : ch.otherJoined ? 'Сравнение готово' : 'Ждём вторую пару'} →
              </div>
            </Link>
            <button
              className="shrink-0 px-2 py-1 text-sm text-muted"
              aria-label="Скрыть вызов"
              onClick={async () => {
                setMe(await api.hideChallenge(ch.code));
              }}
            >
              ✕
            </button>
          </div>
        ))}

        {me.pair.isGuest && (
          <Card tone="accent">
            <Label>Продолжить вместе</Label>
            <p className="mt-2 text-sm text-muted">Пока вы гости по вызову друзей. Один тап, и у вас будет свой вопрос каждый день.</p>
            <Button
              className="mt-3 w-full"
              onClick={async () => {
                await api.convertPair();
                await refresh();
              }}
            >
              Начать свой ритуал
            </Button>
          </Card>
        )}

        {me.digestReady && (
          <Link to="/week" className="block rounded-3xl border border-lilac/40 bg-lilac/10 px-5 py-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-lilac">Ваша неделя ✦</div>
            <div className="mt-1 font-semibold leading-snug">{me.digestReady.title ?? 'Итоги прошлой недели готовы'}</div>
            <div className="mt-1 text-sm text-muted">Что вы узнали друг о друге и идеи на эту неделю →</div>
          </Link>
        )}

        {isSunday && partner && !me.digestReady && (
          <Link to="/week?tab=card" className="block rounded-2xl border border-sand/40 bg-sand/10 px-4 py-3">
            <div className="text-xs uppercase tracking-wider text-muted">Воскресенье</div>
            <div className="mt-1 text-sm">Карточка недели для сторис готова — поделиться →</div>
          </Link>
        )}

        {!partner && !today?.daily?.mine && <InviteCard />}

        {today?.pending.map((r) => renderRound(r, `${partner?.name ?? 'Половинка'} ждёт ответ за ${formatDate(r.date)}`))}

        {error === 'no_questions_left' && (
          <Card>
            <Label>Вопросы кончились</Label>
            <p className="mt-2 text-muted">Вы прошли весь банк. Добавьте свои вопросы в настройках, и они появятся здесь.</p>
          </Card>
        )}

        {!today && !error && !me.pair.isGuest ? <Spinner /> : null}
        {today?.daily && renderRound(today.daily)}

        {today?.bonus.map((r) => renderRound(r))}

        {today?.daily?.status === 'revealed' && partner && <PersonalQuestion />}

        {partner && me.upcoming.length > 0 ? (
          <UpcomingCard plan={me.upcoming[0]} more={me.upcoming.length - 1} partnerName={partner.name} myId={me.user.id} />
        ) : (
          partner &&
          me.ideasOpen > 0 && (
            <Link to="/together" className="block rounded-2xl border border-line bg-surface px-4 py-3">
              <div className="text-xs uppercase tracking-wider text-muted">Хотим вместе</div>
              <div className="mt-1 text-sm">
                {me.ideasOpen} {me.ideasOpen % 10 === 1 && me.ideasOpen % 100 !== 11 ? 'идея ждёт' : 'идеи ждут'} — выберите день для одной →
              </div>
            </Link>
          )
        )}

        {today?.daily && today.daily.mine && today.daily.status !== 'revealed' && today.bonusLeft > 0 && partner && (
          <Button variant="ghost" className="w-full" onClick={bonus} disabled={bonusBusy}>
            Пока ждём, ещё один вопрос? Осталось {today.bonusLeft}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Ближайший план пары: сегодня — ярко, скоро — спокойно. */
function UpcomingCard({ plan, more, partnerName, myId }: { plan: Idea; more: number; partnerName: string; myId: string }) {
  const today = todayLocal();
  const isToday = plan.plannedFor === today;
  return (
    <Link to="/together" className={`block rounded-2xl border px-4 py-3 ${isToday ? 'border-accent/50 bg-accent/10' : 'border-lilac/40 bg-lilac/10'}`}>
      <div className={`text-xs uppercase tracking-wider ${isToday ? 'text-accent' : 'text-lilac'}`}>
        {isToday ? 'Сегодня у вас' : `Скоро · ${relDay(plan.plannedFor!, today)}`}
        {plan.plannedTime ? ` · ${plan.plannedTime}` : ''}
      </div>
      <div className="mt-1 text-sm">{plan.text}</div>
      <div className="mt-1 text-[11px] text-muted">
        {plan.createdBy === myId ? 'вы добавили' : `добавил(а) ${partnerName}`}
        {more > 0 ? ` · и ещё ${more} на неделе` : ''} →
      </div>
    </Link>
  );
}

/** Приглашение создать первую капсулу: показываем, пока не создали или не скрыли. */
function CapsuleInvite() {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem('polovinka.capsuleInvite') === '1';
    } catch {
      return false;
    }
  });
  if (hidden) return null;
  return (
    <Card tone="sage">
      <Label>Открыто на уровне 3</Label>
      <p className="mt-2 text-sm">Капсула времени: напишите друг другу письма, которые откроются через месяц.</p>
      <div className="mt-3 flex gap-2">
        <Link to="/capsule" className="flex-1 rounded-2xl bg-accent px-4 py-3 text-center font-semibold text-bg">
          Написать
        </Link>
        <button
          className="px-3 text-sm text-muted"
          onClick={() => {
            try {
              localStorage.setItem('polovinka.capsuleInvite', '1');
            } catch {
              /* пусто */
            }
            setHidden(true);
          }}
        >
          Потом
        </button>
      </div>
    </Card>
  );
}
