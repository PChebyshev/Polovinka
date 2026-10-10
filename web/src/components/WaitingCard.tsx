import { useState } from 'react';
import type { RoundPublic } from '@polovinka/shared';
import { Button, Card, Heart, Label } from './ui';
import { api } from '../lib/api';
import { shareText, type ShareResult } from '../lib/share';

export function WaitingCard({ round, partnerName }: { round: RoundPublic; partnerName: string | null }) {
  const [state, setState] = useState<ShareResult | 'busy' | null>(null);
  const [manual, setManual] = useState<string | null>(null);
  const q = round.question;
  const myChoice = round.mine?.choice === 'a' ? q.a : q.b;
  const myGuess = round.mine?.guess ? (round.mine.guess === 'a' ? q.a : q.b) : null;

  const call = async () => {
    setState('busy');
    try {
      const n = await api.nudge();
      const r = await shareText(n.text);
      if (r === 'manual') setManual(n.text);
      setState(r);
      if (r === 'shared' || r === 'copied') void api.inviteSent(r);
    } catch {
      setState(null);
    }
  };

  return (
    <Card className="rise">
      <Label>{round.kind === 'bonus' ? 'Бонусный вопрос' : 'Вопрос дня'}</Label>
      <h2 className="mt-2 text-xl font-semibold leading-tight">{q.text}</h2>
      <div className="mt-4 rounded-2xl bg-surface-2 px-4 py-3 text-sm">
        <div>
          <span className="text-muted">Я:</span> {myChoice}
        </div>
        {myGuess && (
          <div>
            <span className="text-muted">Я думаю, {partnerName ?? 'половинка'} выберет:</span> {myGuess}
          </div>
        )}
      </div>

      <div className="mt-6 flex flex-col items-center text-center">
        <div className="breathe text-accent">
          <Heart className="h-10 w-10" />
        </div>
        <p className="mt-3 text-muted">
          {partnerName ? `${partnerName} ещё не ответил(а). Раскроем, как только ответите оба.` : 'Ответ ждёт половинку. Как только она ответит, раскроем обоим.'}
        </p>
      </div>

      <Button className="mt-5 w-full" big onClick={call} disabled={state === 'busy'}>
        Позвать половинку
      </Button>
      {state === 'copied' && <p className="mt-2 text-center text-sm text-sage">Сообщение скопировано, осталось отправить</p>}
      {state === 'shared' && <p className="mt-2 text-center text-sm text-sage">Отправлено</p>}
      {manual && (
        <textarea readOnly className="mt-3 w-full rounded-2xl bg-surface-2 p-3 text-sm" rows={4} value={manual} onFocus={(e) => e.currentTarget.select()} />
      )}
    </Card>
  );
}
