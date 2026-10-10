import { useState } from 'react';
import type { RoundPublic } from '@polovinka/shared';
import { LAYER_LABELS } from '@polovinka/shared';
import { Button, Card, Label } from './ui';
import { buzz } from '../lib/share';

export function QuestionCard({
  round,
  partnerName,
  onAnswer,
  onSkip,
  busy,
  title,
}: {
  round: RoundPublic;
  partnerName: string | null;
  onAnswer: (choice: string, guess: string | null) => void;
  onSkip?: () => void;
  busy: boolean;
  title?: string;
}) {
  const [choice, setChoice] = useState<string | null>(null);
  const [skipAsk, setSkipAsk] = useState(false);
  const q = round.question;
  const them = partnerName ?? 'половинка';
  const isScale = q.format === 'scale';

  const pick = (c: string) => {
    buzz(10);
    setChoice(c);
  };
  const guess = (g: string) => {
    buzz([10, 40, 16]);
    onAnswer(choice!, g);
  };

  const layerLabel = q.isCustom ? (q.authorName ? `Вопрос от: ${q.authorName}` : 'Ваш вопрос') : q.format === 'who' ? 'Кто из нас' : isScale ? 'Шкала' : LAYER_LABELS[q.layer];
  const chosenLabel = choice === null ? '' : isScale ? `${choice} из 5` : choice === 'a' ? q.a : q.b;

  const options = (onPick: (v: string) => void) =>
    isScale ? (
      <div>
        <div className="grid grid-cols-5 gap-2">
          {['1', '2', '3', '4', '5'].map((v) => (
            <button
              key={v}
              disabled={busy}
              onClick={() => onPick(v)}
              className="min-h-16 rounded-2xl border-2 border-line bg-surface text-xl font-semibold transition hover:border-accent/60 active:scale-95 disabled:opacity-50"
            >
              {v}
            </button>
          ))}
        </div>
        <div className="mt-2 flex justify-between text-xs text-muted">
          <span>{q.a}</span>
          <span>{q.b}</span>
        </div>
      </div>
    ) : (
      <>
        <Button variant="choice" className="w-full" onClick={() => onPick('a')} disabled={busy}>
          <span className="mr-3 text-muted">A</span>
          {q.a}
        </Button>
        <Button variant="choice" className="w-full" onClick={() => onPick('b')} disabled={busy}>
          <span className="mr-3 text-muted">B</span>
          {q.b}
        </Button>
      </>
    );

  return (
    <Card className="rise">
      <div className="flex items-center justify-between">
        <Label>{title ?? (round.kind === 'bonus' ? 'Бонусный вопрос' : 'Вопрос дня')}</Label>
        <Label>{layerLabel}</Label>
      </div>
      <h2 className="mt-3 text-2xl font-semibold leading-tight">{q.text}</h2>

      {choice === null ? (
        <div className="mt-5 space-y-3">
          <Label className="mb-1">{isScale ? 'Где я на шкале' : 'Что выберу я'}</Label>
          {options(pick)}
        </div>
      ) : (
        <div className="mt-5 space-y-3 rise">
          <div className="rounded-2xl bg-surface-2 px-4 py-3 text-sm text-muted">
            Я: <span className="text-text">{chosenLabel}</span>
            <button className="ml-3 underline decoration-dotted" onClick={() => setChoice(null)} disabled={busy}>
              изменить
            </button>
          </div>
          <Label className="mb-1">{isScale ? `Где ${them} на шкале` : `Что выберет ${them}`}</Label>
          {options(guess)}
        </div>
      )}

      {onSkip && choice === null && !q.isCustom && (
        <div className="mt-4 text-center">
          {skipAsk ? (
            <div className="flex items-center justify-center gap-3 text-sm">
              <span className="text-muted">Убрать такие вопросы?</span>
              <button className="text-accent" onClick={onSkip} disabled={busy}>
                Да, не про нас
              </button>
              <button className="text-muted" onClick={() => setSkipAsk(false)}>
                Нет
              </button>
            </div>
          ) : (
            <button className="text-xs text-muted underline decoration-dotted" onClick={() => setSkipAsk(true)}>
              Это не про нас
            </button>
          )}
        </div>
      )}
    </Card>
  );
}
