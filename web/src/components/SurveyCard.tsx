import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { Button, Card, Label } from './ui';

const KEY = 'polovinka.survey.later';
const LATER_DAYS = 7;

const OPTIONS: Array<['very' | 'somewhat' | 'not', string]> = [
  ['very', 'Очень расстроюсь'],
  ['somewhat', 'Немного расстроюсь'],
  ['not', 'Не расстроюсь'],
];

/**
 * Короткий опрос (тест Шона Эллиса): после 10 дней и 7 открытий, один раз.
 * Доля «очень расстроюсь» от 40% — признак, что продукт нашёл свою аудиторию.
 */
export function SurveyCard() {
  const { me, setMe } = useStore();
  const [hidden, setHidden] = useState(() => {
    try {
      return Date.now() - Number(localStorage.getItem(KEY) ?? 0) < LATER_DAYS * 86_400_000;
    } catch {
      return false;
    }
  });
  const [choice, setChoice] = useState<'very' | 'somewhat' | 'not' | null>(null);
  const [benefit, setBenefit] = useState('');
  const [missing, setMissing] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const show = !!me?.surveyDue && !hidden;

  useEffect(() => {
    if (show) void api.track('survey_shown');
  }, [show]);

  if (done)
    return (
      <Card tone="sage">
        <p className="text-sm">Спасибо! Это правда помогает понять, куда развивать Половинку.</p>
      </Card>
    );
  if (!show || !me) return null;

  const later = () => {
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {
      /* приватный режим */
    }
    void api.track('survey_dismissed');
    setHidden(true);
  };
  const send = async () => {
    if (!choice) return;
    setBusy(true);
    try {
      const m = await api.survey({ disappoint: choice, benefit: benefit.trim() || undefined, missing: missing.trim() || undefined });
      setDone(true);
      window.setTimeout(() => setMe(m), 2500);
    } finally {
      setBusy(false);
    }
  };
  const input = 'mt-1 w-full rounded-2xl border border-line bg-surface-2 px-4 py-3 text-sm outline-none focus:border-accent/60';

  return (
    <Card tone="accent">
      <Label>Один вопрос о Половинке</Label>
      <h2 className="mt-2 font-semibold leading-snug">Как бы вы себя почувствовали, если бы Половинка завтра исчезла?</h2>
      <div className="mt-3 space-y-2">
        {OPTIONS.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setChoice(k)}
            className={`w-full rounded-2xl border px-4 py-3 text-left text-sm ${choice === k ? 'border-accent bg-accent/15' : 'border-line bg-surface-2'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {choice && (
        <div className="mt-4 space-y-3">
          <label className="block text-sm text-muted">
            Что для вас главное в Половинке? Необязательно
            <input
              className={input}
              maxLength={500}
              value={benefit}
              onChange={(e) => setBenefit(e.target.value)}
              placeholder="Например: стали больше разговаривать"
            />
          </label>
          <label className="block text-sm text-muted">
            Чего не хватает? Необязательно
            <input className={input} maxLength={500} value={missing} onChange={(e) => setMissing(e.target.value)} />
          </label>
        </div>
      )}
      <Button className="mt-4 w-full" onClick={send} disabled={!choice || busy}>
        Отправить
      </Button>
      <button className="mt-2 w-full py-1 text-center text-sm text-muted" onClick={later}>
        Не сейчас
      </button>
    </Card>
  );
}
