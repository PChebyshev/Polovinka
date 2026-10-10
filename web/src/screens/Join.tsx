import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useStore } from '../lib/store';
import { Onboarding } from './Onboarding';
import { Button, Card, Spinner } from '../components/ui';

export function Join() {
  const { code = '' } = useParams();
  const nav = useNavigate();
  const { ready, me, setMe, refresh } = useStore();
  const [info, setInfo] = useState<{ inviterName: string | null; full: boolean; alreadyMember: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .inviteInfo(code)
      .then(setInfo)
      .catch((e) => setErr(e instanceof ApiError && e.code === 'invite_not_found' ? 'Ссылка устарела или неверная.' : 'Не удалось открыть приглашение.'));
  }, [code]);

  useEffect(() => {
    if (ready && me && info?.alreadyMember) nav('/', { replace: true });
  }, [ready, me, info, nav]);

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

  // Новый пользователь: ввод имени сразу присоединяет к паре.
  if (!me) return <Onboarding joinCode={code} inviterName={info!.inviterName} onDone={() => nav('/', { replace: true })} />;

  if (info!.alreadyMember) return null;

  const join = async () => {
    setBusy(true);
    try {
      const m = await api.join(code);
      setMe(m);
      await refresh();
      nav('/', { replace: true });
    } catch (e) {
      const c = e instanceof ApiError ? e.code : '';
      setErr(c === 'already_paired' ? 'У тебя уже есть пара на этом телефоне. Чтобы присоединиться к другой, сначала выйди в настройках.' : c === 'pair_full' ? 'В этой паре уже двое.' : 'Не получилось присоединиться.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <Card tone="accent">
        <h1 className="text-2xl font-bold">{info!.inviterName ?? 'Половинка'} зовёт тебя</h1>
        <p className="mt-2 text-muted">Ты уже {me.user.name} на этом телефоне. Присоединиться к паре с этим именем?</p>
        {info!.full ? (
          <p className="mt-3 text-rose">В этой паре уже двое.</p>
        ) : (
          <Button className="mt-4 w-full" big onClick={join} disabled={busy}>
            Присоединиться
          </Button>
        )}
        <Button variant="ghost" className="mt-2 w-full" onClick={() => nav('/')}>
          Не сейчас
        </Button>
      </Card>
    </div>
  );
}
