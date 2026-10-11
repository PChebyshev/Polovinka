import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { ChallengeCompare, ChallengeInfo, RoundPublic } from '@polovinka/shared';
import { api, ApiError, clientId } from '../lib/api';
import { useStore } from '../lib/store';
import { shareText } from '../lib/share';
import { Onboarding } from './Onboarding';
import { Button, Card, Label, Spinner } from '../components/ui';
import { QuestionCard } from '../components/QuestionCard';
import { WaitingCard } from '../components/WaitingCard';
import { InviteCard } from '../components/InviteCard';

function names(n: [string, string | null]): string {
  return n[1] ? `${n[0]} и ${n[1]}` : n[0];
}

export function Challenge() {
  const { code = '' } = useParams();
  const nav = useNavigate();
  const { ready, me, refresh } = useStore();
  const [info, setInfo] = useState<ChallengeInfo | null>(null);
  const [cmp, setCmp] = useState<ChallengeCompare | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shareState, setShareState] = useState<string | null>(null);

  const loadCompare = useCallback(async () => {
    try {
      setCmp(await api.challengeCompare(code));
    } catch {
      /* не участник */
    }
  }, [code]);

  useEffect(() => {
    api
      .challengeInfo(code)
      .then((i) => {
        setInfo(i);
        if (i.participant) void loadCompare();
      })
      .catch(() => setErr('Ссылка на вызов устарела или неверная.'));
  }, [code, loadCompare, me?.user.id]);

  // Обновление сравнения по событиям (store.refresh вызывается по SSE; подхватываем через me).
  useEffect(() => {
    if (info?.participant) void loadCompare();
  }, [me, info?.participant, loadCompare]);

  if (!ready || (!info && !err)) return <Spinner />;
  if (err) {
    return (
      <div className="mx-auto max-w-md px-5 py-10">
        <Card>
          <p>{err}</p>
          <Button className="mt-4 w-full" onClick={() => nav('/')}>
            На главную
          </Button>
        </Card>
      </div>
    );
  }
  const from = names(info!.fromNames);

  // Новый человек: имя → гостевая пара с раундами вызова.
  if (!me) {
    return (
      <Onboarding
        challengeCode={code}
        inviterName={from}
        intro={`${from} бросают вам вызов: ${info!.questionsCount} вопросов. Ответьте, позовите половинку, и сравним, где совпали. Без победителей.`}
        onDone={() => nav(`/c/${code}`, { replace: true })}
      />
    );
  }

  if (!info!.participant) {
    const join = async () => {
      setBusy(true);
      try {
        setCmp(await api.joinChallenge(code));
        setInfo({ ...info!, participant: true });
        await refresh();
      } catch (e) {
        setErr(e instanceof ApiError && e.code === 'challenge_taken' ? 'Этот вызов уже приняла другая пара. Попросите друзей прислать новый.' : 'Не получилось принять вызов.');
      } finally {
        setBusy(false);
      }
    };
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
        <Card tone="accent">
          <Label>Вызов</Label>
          <h1 className="mt-2 text-2xl font-bold">{from} бросают вам вызов</h1>
          <p className="mt-2 text-muted">Те же {info!.questionsCount} вопросов для вас с {me.partner?.name ?? 'половинкой'}. Потом сравним, где совпали. Без победителей.</p>
          <Button className="mt-4 w-full" big onClick={join} disabled={busy}>
            Принять вызов
          </Button>
          <Button variant="ghost" className="mt-2 w-full" onClick={() => nav('/')}>
            Не сейчас
          </Button>
        </Card>
      </div>
    );
  }

  if (!cmp) return <Spinner />;

  const answer = async (round: RoundPublic, choice: string, guess: string | null) => {
    setBusy(true);
    try {
      await api.answer(round.id, choice, guess, clientId());
      await loadCompare();
      void refresh();
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    const text = `${names(cmp.myPairNames)} бросают вам вызов в Половинке: пройдите те же 5 вопросов, а потом сравним, где совпали. Без победителей, только открытия: ${location.origin}/c/${code}`;
    const r = await shareText(text);
    setShareState(r);
  };

  const pending = cmp.rounds.filter((r) => !r.mine);
  const waiting = cmp.rounds.filter((r) => r.mine);
  const other = cmp.otherPairNames ? names(cmp.otherPairNames) : null;
  const total = cmp.questions.length;

  return (
    <div className="mx-auto max-w-md px-4 pb-28 pt-4">
      <Label>Вызов паре</Label>
      <h1 className="mt-1 text-2xl font-bold">
        {names(cmp.myPairNames)}
        {other && <span className="text-muted"> · {other}</span>}
      </h1>
      <p className="mt-1 text-sm text-muted">
        {cmp.isSender ? (other ? `${other} приняли вызов.` : 'Ждём, пока друзья примут вызов.') : `Вызов от ${names(info!.fromNames)}.`} {total} вопросов, без победителей.
      </p>

      {cmp.isSender && !other && (
        <Card tone="accent" className="mt-4">
          <p className="text-sm text-muted">Отправьте ссылку друзьям. Они откроют её без регистрации, ответят и позовут свою половинку.</p>
          <Button className="mt-3 w-full" onClick={share}>
            Отправить вызов
          </Button>
          {shareState === 'copied' && <p className="mt-2 text-center text-sm text-sage">Ссылка скопирована</p>}
          {shareState === 'shared' && <p className="mt-2 text-center text-sm text-sage">Отправлено</p>}
        </Card>
      )}

      {!me.partner && (
        <div className="mt-4">
          <InviteCard />
        </div>
      )}

      {pending.length > 0 && (
        <div className="mt-4 space-y-4">
          <Label>Осталось ответить: {pending.length}</Label>
          <QuestionCard key={pending[0].id} round={pending[0]} partnerName={me.partner?.name ?? null} onAnswer={(c, g) => answer(pending[0], c, g)} busy={busy} title={`Вопрос ${total - pending.length + 1} из ${total}`} />
        </div>
      )}
      {pending.length === 0 && waiting.length > 0 && (
        <div className="mt-4">
          <WaitingCard round={waiting[0]} partnerName={me.partner?.name ?? null} />
          {waiting.length > 1 && <p className="mt-2 text-center text-xs text-muted">И ещё {waiting.length - 1} ждут ответа половинки.</p>}
        </div>
      )}

      {cmp.myDone && (
        <Card className="mt-4">
          <div className="flex items-center justify-between">
            <Label>Сравнение</Label>
            {cmp.theirsDone && (
              <Label>
                Обе пары совпали: {cmp.bothSame} из {total}
              </Label>
            )}
          </div>
          {!other && <p className="mt-2 text-sm text-muted">Как только друзья пройдут вопросы, здесь появится сравнение.</p>}
          {other && !cmp.theirsDone && <p className="mt-2 text-sm text-muted">{other} ещё проходят вопросы.</p>}
          <ul className="mt-3 space-y-3">
            {cmp.questions.map((q) => (
              <li key={q.questionId} className="rounded-2xl bg-surface-2 p-3 text-sm">
                <div className="font-semibold">{q.text}</div>
                <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <div className="text-muted">{names(cmp.myPairNames)}</div>
                    <div>{q.mine ? `${q.mine[0] === 'a' ? q.a : q.b} · ${q.mine[1] === 'a' ? q.a : q.b}` : '…'}</div>
                  </div>
                  <div>
                    <div className="text-muted">{other ?? 'Друзья'}</div>
                    <div>{q.theirs ? `${q.theirs[0] === 'a' ? q.a : q.b} · ${q.theirs[1] === 'a' ? q.a : q.b}` : '…'}</div>
                  </div>
                </div>
                {q.allSame !== null && (
                  <div className={`mt-2 text-xs ${q.allSame ? 'text-sage' : 'text-sand'}`}>{q.allSame ? 'Все четверо выбрали одно' : 'Разошлись, и это интересно'}</div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {me.pair.isGuest && (
        <Card tone="accent" className="mt-4">
          <Label>Продолжить вместе</Label>
          <p className="mt-2 text-sm text-muted">Понравилось? Один вопрос в день для вас двоих, без регистрации. Один тап.</p>
          <Button
            className="mt-3 w-full"
            onClick={async () => {
              await api.convertPair();
              await refresh();
              nav('/');
            }}
          >
            Начать свой ритуал
          </Button>
        </Card>
      )}
    </div>
  );
}
