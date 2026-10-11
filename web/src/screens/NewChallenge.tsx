import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { shareText } from '../lib/share';
import { Button, Card, Label } from '../components/ui';

/** Создаёт вызов и сразу предлагает отправить ссылку. */
export function NewChallenge() {
  const nav = useNavigate();
  const { me, refresh } = useStore();
  const [data, setData] = useState<{ code: string; text: string; url: string } | null>(null);
  const [state, setState] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .createChallenge()
      .then((r) => {
        setData(r);
        void refresh();
      })
      .catch(() => setErr('Не получилось создать вызов. Попробуйте позже.'));
  }, [refresh]);

  if (!me) return null;

  const share = async () => {
    if (!data) return;
    const r = await shareText(data.text);
    setState(r);
  };

  return (
    <div className="mx-auto max-w-md px-4 pb-28 pt-4">
      <h1 className="text-2xl font-bold">Вызов другой паре</h1>
      <p className="mt-1 text-sm text-muted">Пять ваших вопросов. Друзья отвечают без регистрации, потом обе пары видят, где совпали. Победителей нет.</p>
      {err && (
        <Card className="mt-4">
          <p>{err}</p>
        </Card>
      )}
      {data && (
        <Card tone="accent" className="mt-4">
          <Label>Ссылка готова</Label>
          <p className="mt-2 break-all text-sm text-muted">{data.url}</p>
          <Button className="mt-3 w-full" big onClick={share}>
            Отправить вызов
          </Button>
          {state === 'copied' && <p className="mt-2 text-center text-sm text-sage">Сообщение скопировано, осталось отправить</p>}
          {state === 'shared' && <p className="mt-2 text-center text-sm text-sage">Отправлено</p>}
          {state === 'manual' && <textarea readOnly className="mt-3 w-full rounded-2xl bg-surface-2 p-3 text-sm" rows={4} value={data.text} onFocus={(e) => e.currentTarget.select()} />}
          <Button variant="ghost" className="mt-2 w-full" onClick={() => nav(`/c/${data.code}`)}>
            Открыть вызов
          </Button>
        </Card>
      )}
      <p className="mt-4 text-xs text-muted">Если среди пяти вопросов есть новые для вас, они появятся на странице вызова, и вы ответите на них вместе с половинкой.</p>
    </div>
  );
}
