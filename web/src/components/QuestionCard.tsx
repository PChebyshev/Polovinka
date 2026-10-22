import { useState } from 'react';
import type { RoundPublic } from '@polovinka/shared';
import { BAD_QUESTION_REASONS, LAYER_LABELS } from '@polovinka/shared';
import { Button, Card, Chip, Label, Sheet } from './ui';
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
  /** «Плохой вопрос» с причинами. Возвращает, заменился ли вопрос. */
  onSkip?: (reasons: string[], comment: string) => Promise<boolean>;
  busy: boolean;
  title?: string;
}) {
  const [choice, setChoice] = useState<string | null>(null);
  const [badOpen, setBadOpen] = useState(false);
  const [reasons, setReasons] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [badNote, setBadNote] = useState<string | null>(null);
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

  const layerLabel =
    q.source === 'ai'
      ? 'По вашим ответам ✦'
      : q.isCustom
        ? q.authorName
          ? `Вопрос от: ${q.authorName}`
          : 'Ваш вопрос'
        : q.format === 'who'
          ? 'Кто из нас'
          : isScale
            ? 'Шкала'
            : LAYER_LABELS[q.layer];
  // Причины про тему приглушают похожие вопросы; остальные — сигнал поправить сам вопрос
  const topicHit = reasons.some((k) => BAD_QUESTION_REASONS.find((r) => r.key === k)?.topic);
  const afterBad = topicHit ? 'больше не придёт, и похожих станет меньше' : 'больше не придёт — мы его поправим';
  const toggleReason = (k: string) => setReasons((r) => (r.includes(k) ? r.filter((x) => x !== k) : [...r, k]));
  const sendBad = async () => {
    if (!onSkip) return;
    const replaced = await onSkip(reasons, comment.trim());
    setBadOpen(false);
    // Заменённый вопрос перерисует карточку целиком; иначе — короткая заметка здесь
    if (!replaced) setBadNote(`Спасибо, учли: вопрос ${afterBad}. Сегодня можно просто ответить.`);
  };

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
        <Label>{title ?? (round.kind === 'bonus' ? 'Бонусный вопрос' : round.kind === 'repeat' ? 'Повтор: вопрос из прошлого' : 'Вопрос дня')}</Label>
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
          {badNote ? (
            <p className="text-xs text-muted">{badNote}</p>
          ) : (
            <button className="text-xs text-muted underline decoration-dotted" onClick={() => setBadOpen(true)}>
              Плохой вопрос
            </button>
          )}
        </div>
      )}

      <Sheet open={badOpen} onClose={() => setBadOpen(false)} title="Что не так с вопросом?">
        <p className="text-sm text-muted">Можно выбрать несколько — так мы поймём, что исправить.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {BAD_QUESTION_REASONS.map((r) => (
            <Chip key={r.key} active={reasons.includes(r.key)} onClick={() => toggleReason(r.key)} aria-pressed={reasons.includes(r.key)}>
              {r.label}
            </Chip>
          ))}
        </div>
        <input
          className="mt-3 w-full rounded-2xl border border-line bg-surface-2 px-4 py-3 text-sm outline-none focus:border-accent/60"
          placeholder="Свой вариант или как было бы лучше"
          maxLength={300}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        <p className="mt-3 text-xs text-muted">
          {round.partnerAnswered
            ? `${them} уже ответил(а), поэтому сегодня вопрос останется. Потом он ${afterBad}.`
            : `Вопрос сразу заменится новым у вас обоих, а этот ${afterBad}.`}
        </p>
        <div className="mt-4 flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setBadOpen(false)}>
            Отмена
          </Button>
          <Button className="flex-1" onClick={sendBad} disabled={busy || (reasons.length === 0 && comment.trim().length < 3)}>
            {round.partnerAnswered ? 'Отправить' : 'Заменить'}
          </Button>
        </div>
      </Sheet>
    </Card>
  );
}
