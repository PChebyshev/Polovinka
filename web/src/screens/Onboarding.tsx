import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { useStore } from '../lib/store';
import { Button, Heart } from '../components/ui';

export function Onboarding({ joinCode, challengeCode, inviterName, intro, onDone }: { joinCode?: string; challengeCode?: string; inviterName?: string | null; intro?: string; onDone?: () => void }) {
  const { login } = useStore();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.createUser(n, joinCode, challengeCode);
      login(r.token, r.me);
      onDone?.();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'pair_full') setError('В этой паре уже двое. Попроси новую ссылку.');
      else if (err instanceof ApiError && err.code === 'invite_not_found') setError('Ссылка устарела или неверная.');
      else setError('Не получилось. Проверь связь и попробуй ещё раз.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <div className="rise text-accent">
        <Heart className="h-14 w-14" />
      </div>
      <h1 className="rise mt-5 text-4xl font-bold leading-tight">Мы на %</h1>
      <p className="rise-2 mt-3 text-lg text-muted">
        {intro ? (
          intro
        ) : inviterName ? (
          <>
            <span className="text-text">{inviterName}</span> зовёт тебя. Один вопрос в день на двоих, 20 секунд, и маленькое открытие вечером.
          </>
        ) : (
          'Один вопрос в день на двоих. 20 секунд утром, маленькое открытие вечером.'
        )}
      </p>
      <form onSubmit={submit} className="rise-3 mt-8 space-y-4">
        <label className="block">
          <span className="text-sm text-muted">Как тебя зовут?</span>
          <input
            className="mt-2 w-full rounded-2xl border border-line bg-surface px-5 py-4 text-xl outline-none focus:border-accent/60"
            placeholder="Имя"
            autoFocus
            autoComplete="given-name"
            maxLength={24}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {error && <p className="text-sm text-rose">{error}</p>}
        <Button type="submit" big className="w-full" disabled={busy || !name.trim()}>
          {challengeCode ? 'Принять вызов' : inviterName ? 'Присоединиться' : 'Поехали'}
        </Button>
        <p className="text-center text-xs text-muted">Без регистрации, почты и SMS. Ответы видны только вам двоим.</p>
      </form>
    </div>
  );
}
