import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { APP_NAME, APP_NAME_ACC } from '@polovinka/shared';
import { api } from '../lib/api';
import { knownVisitor, storedAttr } from '../lib/attr';
import { QrCode } from '../components/Qr';

let shownLogged = false;

/** Адрес для телефона: та же страница (приглашение, совет друга, реклама) + метка QR и тот же посетитель. */
function phoneUrl(pathname: string, search: string): string {
  const q = new URLSearchParams(search);
  q.delete('login');
  q.set('src', 'qr');
  const v = knownVisitor();
  if (v) q.set('v', v);
  // Рекламная ссылка /a/<код> после захода сворачивается в «/» — возвращаем её, чтобы переход засчитался кампании
  const attr = storedAttr();
  const path = (pathname === '/' || pathname.startsWith('/a/')) && attr ? `/a/${attr.code}` : pathname;
  return `${window.location.origin}${path}?${q.toString()}`;
}

/**
 * На компьютере новый человек видит только QR: вопрос приходит утром уведомлением,
 * и Половинка живёт в телефоне. Приглашение, совет друга и рекламная метка переезжают вместе со ссылкой.
 */
export function DesktopQr() {
  const loc = useLocation();
  const [title, setTitle] = useState(`${APP_NAME} живёт в телефоне`);
  const [copied, setCopied] = useState(false);
  const url = phoneUrl(loc.pathname, loc.search);

  useEffect(() => {
    if (shownLogged) return;
    shownLogged = true;
    void fetch('/api/events/anon', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'desktop_qr_shown' }),
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const [, kind, code] = loc.pathname.split('/');
    if (!code) return;
    if (kind === 'j')
      api
        .inviteInfo(code, true)
        .then((r) => r.inviterName && setTitle(`${r.inviterName} зовёт вас в ${APP_NAME_ACC}`))
        .catch(() => undefined);
    if (kind === 'f')
      api
        .recommendInfo(code, true)
        .then((r) => r.names.length && setTitle(`${r.names.join(' и ')} ${r.names.length > 1 ? 'советуют' : 'советует'} вам ${APP_NAME_ACC}`))
        .catch(() => undefined);
    if (kind === 'c')
      api
        .challengeInfo(code, true)
        .then((r) => setTitle(`${r.fromNames.filter(Boolean).join(' и ')} бросают вам вызов: ${r.questionsCount} вопросов`))
        .catch(() => undefined);
  }, [loc.pathname]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      /* без доступа к буферу — ссылка всё равно видна в QR */
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-3xl">
        <div className="text-sm font-semibold tracking-wide text-accent">{APP_NAME}</div>
        <div className="mt-6 grid items-center gap-10 md:grid-cols-[1fr_auto]">
          <div>
            <h1 className="text-3xl font-bold leading-tight md:text-4xl">{title}</h1>
            <p className="mt-4 text-lg text-muted">
              Каждое утро — один вопрос на двоих: каждый отвечает за себя и угадывает ответ другого. Вечером ответы открываются.
            </p>
            <p className="mt-3 text-muted">Вопрос приходит уведомлением на телефон, поэтому {APP_NAME_ACC} открывают с телефона — так ничего не потеряется.</p>
            <ol className="mt-6 space-y-2 text-sm">
              {['Откройте камеру на телефоне', 'Наведите её на код', 'Нажмите на появившуюся ссылку'].map((t, i) => (
                <li key={t} className="flex items-center gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent">{i + 1}</span>
                  {t}
                </li>
              ))}
            </ol>
          </div>
          <div className="flex flex-col items-center">
            <div className="rounded-3xl bg-white p-3 shadow-[0_20px_60px_-20px_rgba(255,127,156,0.45)]">
              <QrCode text={url} size={232} label="QR-код: открыть Половинку на телефоне" />
            </div>
            <button className="mt-4 text-sm text-muted underline decoration-dotted" onClick={copy}>
              {copied ? 'Ссылка скопирована — отправьте её себе' : 'Скопировать ссылку'}
            </button>
          </div>
        </div>
        <div className="mt-12 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted">
          <Link to={`${loc.pathname}?login=1`} className="underline decoration-dotted">
            Уже пользуетесь? Войти на компьютере
          </Link>
          <Link to="/privacy" className="underline decoration-dotted">
            Что мы храним
          </Link>
        </div>
      </div>
    </div>
  );
}
