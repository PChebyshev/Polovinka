import { useEffect, useState } from 'react';
import type { RoundPublic } from '@polovinka/shared';
import { Button, Card, Chip, Confetti, Label } from './ui';
import { api } from '../lib/api';
import { buzz } from '../lib/share';
import { guessHit } from '../lib/format';

type Stage = 'flip' | 'result' | 'why' | 'topic' | 'done';

const STAGE_KEY = (id: string) => `polovinka.reveal.${id}`;

function loadStage(id: string): Stage {
  try {
    const v = localStorage.getItem(STAGE_KEY(id));
    if (v === 'done') return 'done';
    if (v === 'seen') return 'result';
  } catch {
    /* пусто */
  }
  return 'flip';
}

function remember(id: string, v: 'seen' | 'done') {
  try {
    localStorage.setItem(STAGE_KEY(id), v);
  } catch {
    /* пусто */
  }
}

export function RevealFlow({
  round,
  myName,
  partnerName,
  onUpdated,
  onBonus,
  onRepeat,
  bonusLeft,
}: {
  round: RoundPublic;
  myName: string;
  partnerName: string;
  onUpdated: (r: RoundPublic) => void;
  onBonus?: () => void;
  onRepeat?: () => void;
  bonusLeft?: number;
}) {
  const [stage, setStage] = useState<Stage>(() => loadStage(round.id));
  const [flipped, setFlipped] = useState(stage !== 'flip');
  const [whyText, setWhyText] = useState('');
  const [chip, setChip] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const q = round.question;
  const mine = round.mine!;
  const theirs = round.partner!;
  const isScale = q.format === 'scale';
  const diff = (x: string | null, y: string | null) => (x === null || y === null ? 99 : Math.abs(Number(x) - Number(y)));
  const same = mine.choice === theirs.choice;
  const close = isScale && !same && diff(mine.choice, theirs.choice) === 1;
  const iGuessed = guessHit(q.format, mine.guess, theirs.choice);
  const theyGuessed = guessHit(q.format, theirs.guess, mine.choice);
  const bothGuessed = iGuessed && theyGuessed;
  const oneGuessed = iGuessed !== theyGuessed;
  // Праздник — когда угадали друг друга. Одинаковые ответы — приятная деталь, не результат.
  const celebrate = bothGuessed;
  const headline = bothGuessed ? 'Вы знаете друг друга!' : iGuessed ? 'Твоя догадка в точку' : theyGuessed ? `${partnerName} знает тебя` : 'Новое открытие';
  const sameNote = same ? ' И выбрали одно и то же.' : close ? ' На шкале вы рядом.' : '';
  const sub =
    (bothGuessed
      ? 'Оба угадали, что выберет другой.'
      : iGuessed
        ? `Ты знаешь, что выберет ${partnerName}. А вот твой ответ оказался сюрпризом.`
        : theyGuessed
          ? `${partnerName} угадывает тебя. Теперь и ты знаешь ответ.`
          : 'Вы узнали друг о друге новое. Это и есть открытие.') + sameNote;
  const label = (c: string) => (isScale ? `${c} из 5` : c === 'a' ? q.a : q.b);

  useEffect(() => {
    if (stage !== 'flip') return;
    const t1 = window.setTimeout(() => setFlipped(true), 400);
    const t2 = window.setTimeout(() => {
      buzz(celebrate ? [20, 60, 20, 60, 40] : [20, 60, 20]);
      remember(round.id, 'seen');
      setStage('result');
    }, 1300);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [stage, celebrate, round.id]);

  const finish = () => {
    remember(round.id, 'done');
    setStage('done');
  };

  const saveWhy = async () => {
    if (!whyText.trim() && !chip) {
      setStage('topic');
      return;
    }
    setBusy(true);
    try {
      const r = await api.why(round.id, { whyText: whyText.trim() || undefined, whyChip: chip ?? undefined });
      onUpdated(r);
      setStage('topic');
    } finally {
      setBusy(false);
    }
  };

  const openTopic = () => {
    void api.topicOpened(round.id).catch(() => undefined);
    setStage('topic');
  };

  const whyOf = (a: RoundPublic['mine']) => (a ? a.whyText || a.whyChip || null : null);

  return (
    <div className="space-y-4">
      {stage === 'result' && celebrate && <Confetti />}

      <Card className="rise">
        <div className="flex items-center justify-between">
          <Label>{(round.kind === 'bonus' ? 'Бонусный вопрос' : round.kind === 'repeat' ? 'Повтор: вопрос из прошлого' : 'Вопрос дня')}</Label>
          {q.isCustom && <Label>{q.authorName ? `Вопрос от: ${q.authorName}` : 'Ваш вопрос'}</Label>}
        </div>
        <h2 className="mt-2 text-xl font-semibold leading-tight">{q.text}</h2>

        <div className="mt-5 grid grid-cols-2 gap-3 flip-scene">
          {[
            { name: myName, answer: mine },
            { name: partnerName, answer: theirs },
          ].map(({ name, answer }, i) => (
            <div key={i} className={`flip-card min-h-28 ${flipped ? 'flipped' : ''}`} style={{ transitionDelay: `${i * 0.15}s` }}>
              <div className="flip-face flex h-full min-h-28 flex-col items-center justify-center rounded-2xl border border-line bg-surface-2 p-3 text-center">
                <div className="text-xs text-muted">{name}</div>
                <div className="mt-2 text-3xl">?</div>
              </div>
              <div className={`flip-face flip-back flex h-full min-h-28 flex-col items-center justify-center rounded-2xl border p-3 text-center ${celebrate ? 'border-sage/50 bg-sage/10' : 'border-accent/50 bg-accent/10'}`}>
                <div className="text-xs text-muted">{name}</div>
                <div className="mt-2 font-semibold leading-snug">{label(answer.choice)}</div>
              </div>
            </div>
          ))}
        </div>

        {stage !== 'flip' && (
          <div className="mt-5 rise">
            <div className={`text-2xl font-semibold ${celebrate || oneGuessed ? 'text-sage' : 'text-sand'}`}>{headline}</div>
            <p className="mt-1 text-muted">{sub}</p>
            {isScale && (
              <div className="mt-2 text-xs text-muted">
                1 — {q.a} · 5 — {q.b}
              </div>
            )}
            <div className="mt-3 space-y-1 text-sm">
              <div>
                {iGuessed ? '✓' : '○'} Я думаю, {partnerName} выберет: {mine.guess ? label(mine.guess) : '—'}
                {mine.guess && <span className="text-muted"> — {iGuessed ? 'в точку' : 'мимо, зато теперь знаю'}</span>}
              </div>
              <div>
                {theyGuessed ? '✓' : '○'} {partnerName} думает, я выберу: {theirs.guess ? label(theirs.guess) : '—'}
                {theirs.guess && <span className="text-muted"> — {theyGuessed ? 'в точку' : 'мимо'}</span>}
              </div>
            </div>
            {round.origin && (
              <div className="mt-3 rounded-2xl border border-line px-4 py-3 text-sm">
                <div className="text-xs text-muted">
                  В прошлый раз, {new Date(`${round.origin.date}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
                </div>
                <div className="mt-1">
                  {myName}: {round.origin.mine ? label(round.origin.mine.choice) : '—'}
                  {round.origin.mine && (round.origin.mine.choice === mine.choice ? <span className="text-muted"> · не изменилось</span> : <span className="text-sand"> · теперь иначе</span>)}
                </div>
                <div>
                  {partnerName}: {round.origin.partner ? label(round.origin.partner.choice) : '—'}
                  {round.origin.partner &&
                    (round.origin.partner.choice === theirs.choice ? <span className="text-muted"> · не изменилось</span> : <span className="text-sand"> · теперь иначе</span>)}
                </div>
              </div>
            )}
            {(whyOf(mine) || whyOf(theirs)) && (
              <div className="mt-3 space-y-1 rounded-2xl bg-surface-2 px-4 py-3 text-sm">
                {whyOf(mine) && (
                  <div>
                    <span className="text-muted">Я — почему:</span> {whyOf(mine)}
                  </div>
                )}
                {whyOf(theirs) && (
                  <div>
                    <span className="text-muted">{partnerName} — почему:</span> {whyOf(theirs)}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Card>

      {stage === 'result' && (
        <div className="flex gap-3 rise-2">
          {!whyOf(mine) ? (
            <Button className="flex-1" big onClick={() => setStage('why')}>
              Почему?
            </Button>
          ) : null}
          <Button variant="secondary" className="flex-1" big onClick={openTopic}>
            Тема на вечер
          </Button>
        </div>
      )}

      {stage === 'why' && (
        <Card className="rise">
          <Label>Почему? Необязательно</Label>
          <div className="mt-3 flex flex-wrap gap-2">
            {q.whyChips.map((c) => (
              <Chip key={c} active={chip === c} onClick={() => setChip(chip === c ? null : c)}>
                {c}
              </Chip>
            ))}
          </div>
          <input
            className="mt-3 w-full rounded-2xl border border-line bg-surface-2 px-4 py-3 outline-none focus:border-accent/60"
            placeholder="Или одной строкой…"
            maxLength={200}
            value={whyText}
            onChange={(e) => setWhyText(e.target.value)}
            enterKeyHint="done"
            onKeyDown={(e) => e.key === 'Enter' && void saveWhy()}
          />
          <div className="mt-3 flex gap-3">
            <Button variant="ghost" onClick={() => setStage('topic')} disabled={busy}>
              Пропустить
            </Button>
            <Button className="flex-1" onClick={saveWhy} disabled={busy}>
              Сохранить
            </Button>
          </div>
        </Card>
      )}

      {stage === 'topic' && (
        <Card tone="accent" className="rise">
          <Label>Тема на вечер</Label>
          <p className="mt-2 text-lg leading-snug">{q.topic ?? 'Расскажите друг другу, почему выбрали именно так.'}</p>
          <Button className="mt-4 w-full" onClick={finish}>
            На сегодня всё
          </Button>
        </Card>
      )}

      {stage === 'done' && (
        <div className="space-y-3 rise">
          {q.topic && (
            <div className="rounded-2xl bg-surface-2 px-4 py-3 text-sm">
              <span className="text-muted">Тема на вечер: </span>
              {q.topic}
            </div>
          )}
          {onBonus && (bonusLeft ?? 0) > 0 && (
            <Button variant="secondary" className="w-full" onClick={onBonus}>
              Ещё один вопрос? Осталось {bonusLeft}
            </Button>
          )}
          {onRepeat && (
            <Button variant="secondary" className="w-full" onClick={onRepeat}>
              Повтор: изменились ли ваши ответы?
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
