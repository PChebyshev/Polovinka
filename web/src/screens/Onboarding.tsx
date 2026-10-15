import { useEffect, useState, type FormEvent } from 'react';
import { APP_NAME, APP_NAME_ACC } from '@polovinka/shared';
import { api, ApiError } from '../lib/api';
import { useStore } from '../lib/store';
import { Button, Card, Heart, Label } from '../components/ui';
import { InstallGuide } from '../components/InstallGuide';
import { isStandalone, shouldOfferInstall } from '../lib/install';

type Mode = 'install' | 'name' | 'code' | 'recovery' | 'email';

let landingLogged = false;

/**
 * Первый экран (лендинг). На телефоне в браузере первым шагом — установка на экран «Домой»:
 * так у iPhone не появляется второй аккаунт, а уведомления вообще возможны.
 * В установленном приложении и на компьютере — сразу имя.
 */
export function Onboarding({
  joinCode,
  challengeCode,
  inviterName,
  intro,
  onDone,
  handoffFailed = false,
}: {
  joinCode?: string;
  challengeCode?: string;
  inviterName?: string | null;
  intro?: string;
  onDone?: () => void;
  handoffFailed?: boolean;
}) {
  const { login } = useStore();
  const [mode, setMode] = useState<Mode>(handoffFailed ? 'code' : shouldOfferInstall() ? 'install' : 'name');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [phrase, setPhrase] = useState('');
  const [email, setEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [emailLogin, setEmailLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    handoffFailed ? 'Автоматический вход не сработал. Введите код из Safari: Настройки → «Вход на другом устройстве».' : null,
  );

  useEffect(() => {
    api
      .config()
      .then((c) => setEmailLogin(c.emailLogin))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (mode === 'install' && !landingLogged) {
      landingLogged = true;
      void fetch('/api/events/anon', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'landing_install_shown' }),
      }).catch(() => undefined);
    }
  }, [mode]);

  const submitName = async (e: FormEvent) => {
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
      else if (err instanceof ApiError && (err.code === 'invite_not_found' || err.code === 'not_found')) setError('Ссылка устарела или неверная.');
      else setError('Не получилось. Проверь связь и попробуй ещё раз.');
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    const c = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.redeemLoginCode(c);
      login(r.token, r.me);
      onDone?.();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'too_many_attempts') setError('Слишком много попыток. Подождите 10 минут.');
      else if (err instanceof ApiError && err.status === 404) setError('Код не подошёл или устарел. Возьмите новый.');
      else setError('Не получилось. Проверьте связь и попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  };

  const failMsg = (err: unknown, notFound: string) => {
    if (err instanceof ApiError && err.code === 'too_many_attempts') setError('Слишком много попыток. Подождите 10 минут.');
    else if (err instanceof ApiError && err.code === 'code_expired') setError('Код устарел. Запросите новый.');
    else if (err instanceof ApiError && (err.status === 404 || err.status === 400)) setError(notFound);
    else setError('Не получилось. Проверьте связь и попробуйте ещё раз.');
  };

  const submitPhrase = async (e: FormEvent) => {
    e.preventDefault();
    if (!phrase.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.redeemRecovery(phrase);
      login(r.token, r.me);
      onDone?.();
    } catch (err) {
      failMsg(err, 'Код не подошёл. Проверьте слова и цифры — порядок важен.');
    } finally {
      setBusy(false);
    }
  };

  const submitEmail = async (e: FormEvent) => {
    e.preventDefault();
    const em = email.trim();
    if (!em.includes('@')) return;
    setBusy(true);
    setError(null);
    try {
      if (!emailSent) {
        await api.emailLogin(em);
        setEmailSent(true);
        setCode('');
      } else {
        const r = await api.emailLoginConfirm(em, code);
        login(r.token, r.me);
        onDone?.();
      }
    } catch (err) {
      failMsg(err, emailSent ? 'Код не подошёл.' : 'Проверьте адрес.');
    } finally {
      setBusy(false);
    }
  };

  const lead = intro ? (
    intro
  ) : inviterName ? (
    <>
      <span className="text-text">{inviterName}</span> зовёт тебя. Один вопрос в день на двоих: 20 секунд утром и маленькое открытие вечером.
    </>
  ) : (
    'Один вопрос в день на двоих. 20 секунд утром, маленькое открытие вечером — и вы узнаёте друг друга чуть лучше.'
  );

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <div className="rise text-accent">
        <Heart className="h-14 w-14" />
      </div>
      <h1 className="rise mt-5 text-4xl font-bold leading-tight">{APP_NAME}</h1>
      <p className="rise-2 mt-3 text-lg text-muted">{lead}</p>

      {mode === 'install' && (
        <div className="rise-3 mt-8">
          <Card tone="accent">
            <Label>Шаг 1 из 2 · 10 секунд</Label>
            <h2 className="mt-2 text-xl font-semibold">Добавьте {APP_NAME_ACC} на экран «Домой»</h2>
            <p className="mt-1 text-sm text-muted">Одна иконка, без App Store. Только так придут уведомления: утром — вопрос, вечером — раскрытие.</p>
            <div className="mt-4">
              <InstallGuide finalStep={`Откройте ${APP_NAME_ACC} с иконки — там введёте имя${inviterName ? ' и окажетесь в паре' : ''}.`} />
            </div>
          </Card>
          <button
            className="mt-5 w-full py-2 text-center text-sm text-muted underline decoration-dotted"
            onClick={() => {
              void fetch('/api/events/anon', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ type: 'landing_browser' }),
              }).catch(() => undefined);
              setMode('name');
            }}
          >
            Продолжить в браузере
          </button>
        </div>
      )}

      {mode === 'name' && (
        <form onSubmit={submitName} className="rise-3 mt-8 space-y-4">
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
            {challengeCode ? 'Принять вызов' : inviterName ? 'Присоединиться' : 'Начать'}
          </Button>
          <p className="text-center text-xs text-muted">Без регистрации, почты и SMS. Ответы видны только вам двоим.</p>
          {!joinCode && !challengeCode && (
            <button type="button" className="w-full text-center text-sm text-muted underline decoration-dotted" onClick={() => setMode('code')}>
              {isStandalone() ? 'Я уже начал(а) в Safari или на другом телефоне' : 'У меня уже есть аккаунт'}
            </button>
          )}
          {shouldOfferInstall() && (
            <button type="button" className="w-full text-center text-sm text-muted underline decoration-dotted" onClick={() => setMode('install')}>
              Как установить на экран
            </button>
          )}
        </form>
      )}

      {mode === 'code' && (
        <form onSubmit={submitCode} className="rise-3 mt-8 space-y-4">
          <p className="text-sm text-muted">Там, где вы уже вошли: Настройки → «Вход на другом устройстве» → «Показать код». Введите его здесь.</p>
          <input
            className="w-full rounded-2xl border border-line bg-surface px-5 py-4 text-center font-mono text-2xl uppercase tracking-[0.3em] outline-none focus:border-accent/60"
            placeholder="КОД"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="one-time-code"
            autoCorrect="off"
            spellCheck={false}
            maxLength={8}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          {error && <p className="text-sm text-rose">{error}</p>}
          <Button type="submit" big className="w-full" disabled={busy || code.replace(/[^A-Za-z0-9]/g, '').length !== 6}>
            Войти
          </Button>
          <div className="flex flex-col gap-3 text-center text-sm text-muted">
            <button
              type="button"
              className="underline decoration-dotted"
              onClick={() => {
                setError(null);
                setMode('recovery');
              }}
            >
              У меня есть код восстановления
            </button>
            {emailLogin && (
              <button
                type="button"
                className="underline decoration-dotted"
                onClick={() => {
                  setError(null);
                  setMode('email');
                }}
              >
                Войти по почте
              </button>
            )}
            <button type="button" className="underline decoration-dotted" onClick={() => setMode('name')}>
              Я здесь впервые
            </button>
          </div>
        </form>
      )}

      {mode === 'recovery' && (
        <form onSubmit={submitPhrase} className="rise-3 mt-8 space-y-4">
          <p className="text-sm text-muted">Три слова и четыре цифры из «Настройки → Доступ и восстановление». Регистр и дефисы не важны.</p>
          <input
            className="w-full rounded-2xl border border-line bg-surface px-5 py-4 text-center text-lg outline-none focus:border-accent/60"
            placeholder="слово-слово-слово-1234"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
          />
          {error && <p className="text-sm text-rose">{error}</p>}
          <Button
            type="submit"
            big
            className="w-full"
            disabled={
              busy ||
              phrase
                .trim()
                .split(/[^a-zA-Zа-яА-ЯёЁ0-9]+/)
                .filter(Boolean).length < 4
            }
          >
            Вернуть историю
          </Button>
          <button
            type="button"
            className="w-full text-center text-sm text-muted underline decoration-dotted"
            onClick={() => {
              setError(null);
              setMode('code');
            }}
          >
            Назад
          </button>
        </form>
      )}

      {mode === 'email' && (
        <form onSubmit={submitEmail} className="rise-3 mt-8 space-y-4">
          {!emailSent ? (
            <>
              <p className="text-sm text-muted">Почта, которую вы привязали в настройках. Пришлём шестизначный код.</p>
              <input
                className="w-full rounded-2xl border border-line bg-surface px-5 py-4 text-lg outline-none focus:border-accent/60"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="off"
                placeholder="вы@почта.ру"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </>
          ) : (
            <>
              <p className="text-sm text-muted">
                Если эта почта привязана, письмо с кодом уже в пути на <span className="text-text">{email.trim()}</span>. Код действует 15 минут.
              </p>
              <input
                className="w-full rounded-2xl border border-line bg-surface px-5 py-4 text-center font-mono text-2xl tracking-[0.3em] outline-none focus:border-accent/60"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                maxLength={6}
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </>
          )}
          {error && <p className="text-sm text-rose">{error}</p>}
          <Button type="submit" big className="w-full" disabled={busy || (!emailSent ? !email.includes('@') : code.length !== 6)}>
            {emailSent ? 'Войти' : 'Получить код'}
          </Button>
          <div className="flex flex-col gap-3 text-center text-sm text-muted">
            {emailSent && (
              <button
                type="button"
                className="underline decoration-dotted"
                onClick={() => {
                  setEmailSent(false);
                  setError(null);
                }}
              >
                Другая почта или отправить ещё раз
              </button>
            )}
            <button
              type="button"
              className="underline decoration-dotted"
              onClick={() => {
                setError(null);
                setMode('code');
              }}
            >
              Назад
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
