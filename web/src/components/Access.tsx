import { useEffect, useState } from 'react';
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

/** Привязка почты: отправить код и подтвердить. Общая логика для настроек и экрана «Сохраните аккаунт». */
function useEmailBind(onDone?: () => void) {
  const { setMe } = useStore();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'idle' | 'code'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  const send = async () => {
    const e = email.trim();
    if (!e) return;
    setBusy(true);
    setError(null);
    try {
      await api.emailBind(e);
      setStep('code');
      setCode('');
      setSentAt(Date.now());
    } catch (err) {
      if (err instanceof ApiError && err.code === 'email_taken')
        setError('Эта почта уже привязана к другому аккаунту. Если это ваш старый аккаунт — выйдите и войдите по почте.');
      else if (err instanceof ApiError && err.code === 'too_many_attempts') setError('Слишком часто. Подождите 10 минут.');
      else if (err instanceof ApiError && err.status === 400) setError('Проверьте адрес.');
      else {
        setError('Письмо не ушло. Попробуйте ещё раз чуть позже.');
        setFailed(true);
      }
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
      onDone?.();
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.code === 'code_expired') setError('Код устарел. Отправьте новый.');
      else if (err instanceof ApiError && err.code === 'too_many_attempts') setError('Слишком много попыток. Отправьте новый код.');
      else if (err instanceof ApiError && err.status === 404) setError('Код не подошёл.');
      else setError('Не получилось. Проверьте связь.');
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { email, setEmail, code, setCode, step, setStep, busy, error, send, confirm, sentAt, failed };
}

const inputCls = 'w-full rounded-2xl border border-line bg-surface-2 px-4 py-3 outline-none focus:border-accent/60';

function EmailInput({ b, label, big }: { b: ReturnType<typeof useEmailBind>; label: string; big?: boolean }) {
  return (
    <div className={`mt-3 flex gap-2 ${big ? 'flex-col' : ''}`}>
      <input
        className={`min-w-0 flex-1 ${inputCls}`}
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="off"
        placeholder="вы@почта.ру"
        value={b.email}
        onChange={(e) => b.setEmail(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void b.send()}
      />
      <Button variant={big ? 'primary' : 'secondary'} big={big} onClick={b.send} disabled={b.busy || !b.email.includes('@')}>
        {b.busy && big ? 'Отправляем…' : label}
      </Button>
    </div>
  );
}

function CodeInput({ b, big }: { b: ReturnType<typeof useEmailBind>; big?: boolean }) {
  return (
    <>
      <p className="mt-1 text-sm text-muted">
        Отправили код на <b className="text-text">{b.email.trim()}</b>. Он действует 15 минут. Если письма нет — загляните в «Спам».
      </p>
      <div className={`mt-3 flex gap-2 ${big ? 'flex-col' : ''}`}>
        <input
          className={`min-w-0 flex-1 text-center font-mono text-xl tracking-[0.3em] ${inputCls}`}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          maxLength={6}
          value={b.code}
          onChange={(e) => b.setCode(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && void b.confirm()}
        />
        <Button big={big} onClick={b.confirm} disabled={b.busy || b.code.length !== 6}>
          Готово
        </Button>
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted">
        <button onClick={() => b.setStep('idle')}>Другая почта</button>
        <button onClick={b.send} disabled={b.busy}>
          Отправить ещё раз
        </button>
      </div>
    </>
  );
}

export function EmailBox() {
  const { me, setMe } = useStore();
  const [changing, setChanging] = useState(false);
  const b = useEmailBind(() => setChanging(false));
  const [confirmUnbind, setConfirmUnbind] = useState(false);
  if (!me || !me.access.emailEnabled) return null;
  const required = me.access.emailRequired;

  const unbind = async () => {
    setConfirmUnbind(false);
    setMe(await api.emailRemove());
  };

  return (
    <div>
      <div className="font-semibold">Почта</div>
      {me.access.email && !changing ? (
        <>
          <p className="mt-1 text-sm text-muted">По ней можно войти на любом устройстве: пришлём код в письме. Пароля по-прежнему нет.</p>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="truncate text-sm">✓ {me.access.email}</span>
            {required ? (
              <button className="shrink-0 text-sm text-muted" onClick={() => setChanging(true)}>
                Сменить
              </button>
            ) : (
              <button className="shrink-0 text-sm text-muted" onClick={() => setConfirmUnbind(true)}>
                Отвязать
              </button>
            )}
          </div>
        </>
      ) : b.step === 'idle' ? (
        <>
          <p className="mt-1 text-sm text-muted">
            {changing
              ? 'Пришлём код на новый адрес. Старая почта перестанет работать для входа.'
              : required
                ? 'Нужна, чтобы не потерять аккаунт при смене телефона: пришлём код в письме. Никаких рассылок.'
                : 'Необязательно. Нужна только чтобы вернуть доступ: пришлём код в письме. Никаких рассылок.'}
          </p>
          <EmailInput b={b} label={changing ? 'Сменить' : 'Привязать'} />
          {changing && (
            <button className="mt-2 text-xs text-muted" onClick={() => setChanging(false)}>
              Отмена
            </button>
          )}
        </>
      ) : (
        <CodeInput b={b} />
      )}
      {b.error && <p className="mt-2 text-sm text-rose">{b.error}</p>}
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

const LATER_KEY = 'polovinka.emailGate.laterUntil';
const LATER_AFTER_MS = 45_000;

/** Отложен ли экран почты на этом устройстве (только если письмо не дошло). */
export function emailGateDeferred(): boolean {
  try {
    return Number(localStorage.getItem(LATER_KEY) ?? 0) > Date.now();
  } catch {
    return false;
  }
}

/**
 * «Сохраните ваш аккаунт»: обязательная привязка почты после первого ответа.
 * Отложить можно только если письмо не уходит или не приходит — чтобы человек не застрял.
 */
export function EmailGate({ onDeferred }: { onDeferred: () => void }) {
  const { me } = useStore();
  const b = useEmailBind();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    void api.track('email_gate_shown');
  }, []);
  useEffect(() => {
    if (!b.sentAt) return;
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, [b.sentAt]);
  if (!me) return null;
  const canDefer = b.failed || (b.sentAt !== null && now - b.sentAt > LATER_AFTER_MS);
  const defer = () => {
    try {
      localStorage.setItem(LATER_KEY, String(Date.now() + 24 * 3_600_000));
    } catch {
      /* приватный режим */
    }
    void api.track('email_gate_deferred');
    onDeferred();
  };
  const days = me.counters.daysTogether;
  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col px-6 pb-10 pt-12">
      <div className="text-5xl">🔐</div>
      <h1 className="mt-4 text-2xl font-bold">Сохраните ваш аккаунт</h1>
      <p className="mt-3 text-muted">
        В Половинке нет пароля, поэтому вход хранится только в этом телефоне. Если удалить приложение, сменить телефон или очистить браузер, ваши ответы
        {me.partner ? ' и вся история вашей пары' : ''} пропадут.
      </p>
      <p className="mt-3 text-muted">Привяжите почту — по ней вы вернётесь на любом устройстве: пришлём код в письме.</p>
      <div className="mt-6">
        {b.step === 'idle' ? <EmailInput b={b} label="Получить код" big /> : <CodeInput b={b} big />}
        {b.error && <p className="mt-2 text-sm text-rose">{b.error}</p>}
      </div>
      <p className="mt-6 text-xs text-muted">
        Почта нужна только для входа: никаких рассылок, никому её не передаём.{days > 1 ? ` У вас уже ${days} дн. истории.` : ''}
      </p>
      {canDefer && (
        <button className="mt-4 self-start text-sm text-muted underline decoration-dotted" onClick={defer}>
          Письмо не приходит — напомнить завтра
        </button>
      )}
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
