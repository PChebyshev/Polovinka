import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useStore } from '../lib/store';
import { Button, Sheet } from './ui';
import { subscribePush } from '../lib/sw';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

/** Код восстановления: показывается один раз после создания, хранится только хеш. */
export function RecoveryBox() {
  const { me, refresh } = useStore();
  const [phrase, setPhrase] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState(false);
  if (!me) return null;
  const has = me.access.hasRecovery;

  const make = async () => {
    setBusy(true);
    setConfirm(false);
    setCopied(false);
    try {
      const r = await api.createRecovery();
      setPhrase(r.phrase);
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    if (!phrase) return;
    try {
      await navigator.clipboard.writeText(phrase);
      setCopied(true);
    } catch {
      /* перепишут вручную */
    }
  };
  const share = async () => {
    if (!phrase) return;
    try {
      if (navigator.share) await navigator.share({ title: 'Код восстановления · Половинка', text: `Код восстановления Половинки: ${phrase}` });
      else await copy();
    } catch {
      /* отменили */
    }
  };

  return (
    <div>
      <div className="font-semibold">Код восстановления</div>
      <p className="mt-1 text-sm text-muted">
        Три слова и четыре цифры. По ним вы вернёте историю, если переустановите приложение или смените телефон. Сохраните в «Заметки» — мы показываем код один
        раз.
      </p>
      {phrase ? (
        <div className="mt-3">
          <div className="select-all rounded-2xl border border-accent/40 bg-accent/10 px-3 py-4 text-center text-lg font-semibold leading-snug tracking-wide">
            {phrase}
          </div>
          <div className="mt-2 flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={copy}>
              {copied ? 'Скопирован' : 'Скопировать'}
            </Button>
            <Button variant="secondary" className="flex-1" onClick={share}>
              Сохранить в…
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted">Старый код больше не работает. Если потеряете этот — создайте новый здесь же.</p>
        </div>
      ) : has ? (
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-sm">✓ Создан {me.access.recoveryCreatedAt ? fmtDate(me.access.recoveryCreatedAt) : ''}</span>
          <button className="text-sm text-accent" onClick={() => setConfirm(true)} disabled={busy}>
            Создать новый
          </button>
        </div>
      ) : (
        <Button variant="secondary" className="mt-3 w-full" onClick={make} disabled={busy}>
          Создать код восстановления
        </Button>
      )}
      <Sheet open={confirm} onClose={() => setConfirm(false)} title="Создать новый код?">
        <p className="text-sm text-muted">Прежний код перестанет работать. Новый нужно будет сохранить заново.</p>
        <div className="mt-4 flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setConfirm(false)}>
            Отмена
          </Button>
          <Button className="flex-1" onClick={make}>
            Создать
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

/** Привязка почты: адрес → код из письма → готово. */
export function EmailBox() {
  const { me, setMe } = useStore();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'idle' | 'code'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmUnbind, setConfirmUnbind] = useState(false);
  if (!me || !me.access.emailEnabled) return null;

  const send = async () => {
    const e = email.trim();
    if (!e) return;
    setBusy(true);
    setError(null);
    try {
      await api.emailBind(e);
      setStep('code');
      setCode('');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'email_taken') setError('Эта почта уже привязана к другому аккаунту.');
      else if (err instanceof ApiError && err.code === 'too_many_attempts') setError('Слишком часто. Подождите 10 минут.');
      else if (err instanceof ApiError && err.status === 400) setError('Проверьте адрес.');
      else setError('Письмо не ушло. Попробуйте позже.');
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      setMe(await api.emailConfirm(email.trim(), code));
      setStep('idle');
      setEmail('');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'code_expired') setError('Код устарел. Отправьте новый.');
      else if (err instanceof ApiError && err.code === 'too_many_attempts') setError('Слишком много попыток. Отправьте новый код.');
      else if (err instanceof ApiError && err.status === 404) setError('Код не подошёл.');
      else setError('Не получилось. Проверьте связь.');
    } finally {
      setBusy(false);
    }
  };
  const unbind = async () => {
    setConfirmUnbind(false);
    setMe(await api.emailRemove());
  };

  const input = 'w-full rounded-2xl border border-line bg-surface-2 px-4 py-3 outline-none focus:border-accent/60';

  return (
    <div>
      <div className="font-semibold">Почта</div>
      {me.access.email ? (
        <>
          <p className="mt-1 text-sm text-muted">По ней можно войти на любом устройстве: пришлём код в письме. Пароля по-прежнему нет.</p>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="truncate text-sm">✓ {me.access.email}</span>
            <button className="shrink-0 text-sm text-muted" onClick={() => setConfirmUnbind(true)}>
              Отвязать
            </button>
          </div>
        </>
      ) : step === 'idle' ? (
        <>
          <p className="mt-1 text-sm text-muted">Необязательно. Нужна только чтобы вернуть доступ: пришлём код в письме. Никаких рассылок.</p>
          <div className="mt-3 flex gap-2">
            <input
              className={`min-w-0 flex-1 ${input}`}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="off"
              placeholder="вы@почта.ру"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void send()}
            />
            <Button variant="secondary" onClick={send} disabled={busy || !email.includes('@')}>
              Привязать
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted">
            Отправили код на <b className="text-text">{email.trim()}</b>. Он действует 15 минут.
          </p>
          <div className="mt-3 flex gap-2">
            <input
              className={`min-w-0 flex-1 text-center font-mono text-xl tracking-[0.3em] ${input}`}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && void confirm()}
            />
            <Button onClick={confirm} disabled={busy || code.length !== 6}>
              Готово
            </Button>
          </div>
          <div className="mt-2 flex justify-between text-xs text-muted">
            <button onClick={() => setStep('idle')}>Другая почта</button>
            <button onClick={send} disabled={busy}>
              Отправить ещё раз
            </button>
          </div>
        </>
      )}
      {error && <p className="mt-2 text-sm text-rose">{error}</p>}
      <Sheet open={confirmUnbind} onClose={() => setConfirmUnbind(false)} title="Отвязать почту?">
        <p className="text-sm text-muted">Войти по ней будет нельзя. Код восстановления, если есть, продолжит работать.</p>
        <div className="mt-4 flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setConfirmUnbind(false)}>
            Оставить
          </Button>
          <Button className="flex-1" onClick={unbind}>
            Отвязать
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

/** Выход со всех устройств: остальные телефоны выходят, этот получает новый токен. */
export function RevokeBox() {
  const { login } = useStore();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const revoke = async () => {
    setBusy(true);
    try {
      const r = await api.revokeSessions();
      login(r.token, r.me);
      setConfirm(false);
      setDone(true);
      // подписка на push на сервере удалена — вернём её для этого телефона
      void subscribePush().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <div className="font-semibold">Другие устройства</div>
      <p className="mt-1 text-sm text-muted">Если телефон потерян или код входа попал не к тому человеку: все устройства, кроме этого, выйдут.</p>
      <Button variant="secondary" className="mt-3 w-full" onClick={() => setConfirm(true)} disabled={busy}>
        {done ? '✓ Остальные устройства вышли' : 'Выйти на всех других устройствах'}
      </Button>
      <Sheet open={confirm} onClose={() => setConfirm(false)} title="Выйти на других устройствах?">
        <p className="text-sm text-muted">Этот телефон останется. На остальных понадобится войти заново: по коду, почте или коду восстановления.</p>
        <div className="mt-4 flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setConfirm(false)}>
            Отмена
          </Button>
          <Button className="flex-1" onClick={revoke} disabled={busy}>
            Выйти там
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
