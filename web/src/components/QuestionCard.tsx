import { useState } from 'react';
import type { RoundPublic } from '@polovinka/shared';
import { Button, Card, Label } from './ui';
import { buzz } from '../lib/share';

const LAYER_LABEL: Record<string, string> = { light: 'Лёгкий вопрос', us: 'Про нас', deep: 'Поглубже' };

export function QuestionCard({
  round,
  partnerName,
  onAnswer,
  busy,
  title,
}: {
  round: RoundPublic;
  partnerName: string | null;
  onAnswer: (choice: 'a' | 'b', guess: 'a' | 'b' | null) => void;
  busy: boolean;
  title?: string;
}) {
  const [choice, setChoice] = useState<'a' | 'b' | null>(null);
  const q = round.question;
  const them = partnerName ?? 'половинка';

  const pick = (c: 'a' | 'b') => {
    buzz(10);
    setChoice(c);
  };
  const guess = (g: 'a' | 'b') => {
    buzz([10, 40, 16]);
    onAnswer(choice!, g);
  };

  return (
    <Card className="rise">
      <div className="flex items-center justify-between">
        <Label>{title ?? (round.kind === 'bonus' ? 'Бонусный вопрос' : 'Вопрос дня')}</Label>
        <Label>{q.isCustom ? 'Ваш вопрос' : LAYER_LABEL[q.layer]}</Label>
      </div>
      <h2 className="mt-3 text-2xl font-semibold leading-tight">{q.text}</h2>

      {choice === null ? (
        <div className="mt-5 space-y-3">
          <Label className="mb-1">Что выберу я</Label>
          <Button variant="choice" className="w-full" onClick={() => pick('a')} disabled={busy}>
            <span className="mr-3 text-muted">A</span>
            {q.a}
          </Button>
          <Button variant="choice" className="w-full" onClick={() => pick('b')} disabled={busy}>
            <span className="mr-3 text-muted">B</span>
            {q.b}
          </Button>
        </div>
      ) : (
        <div className="mt-5 space-y-3 rise">
          <div className="rounded-2xl bg-surface-2 px-4 py-3 text-sm text-muted">
            Я: <span className="text-text">{choice === 'a' ? q.a : q.b}</span>
            <button className="ml-3 underline decoration-dotted" onClick={() => setChoice(null)} disabled={busy}>
              изменить
            </button>
          </div>
          <Label className="mb-1">Что выберет {them}</Label>
          <Button variant="choice" className="w-full" onClick={() => guess('a')} disabled={busy}>
            <span className="mr-3 text-muted">A</span>
            {q.a}
          </Button>
          <Button variant="choice" className="w-full" onClick={() => guess('b')} disabled={busy}>
            <span className="mr-3 text-muted">B</span>
            {q.b}
          </Button>
        </div>
      )}
    </Card>
  );
}
