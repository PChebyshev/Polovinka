import { lazy, Suspense, useEffect, useRef, useState, type ComponentType, type ReactElement } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useStore } from './lib/store';
import { Onboarding } from './screens/Onboarding';
import { Home } from './screens/Home';
import { Join } from './screens/Join';
import { isStandalone, platform, syncManifest } from './lib/install';
import { getToken, trackScreen } from './lib/api';
import { adoptVisitor, captureAttribution } from './lib/attr';
import { EmailGate, emailGateDeferred } from './components/Access';
import { Spinner } from './components/ui';
import { GestureCard } from './components/GestureToast';
import { api } from './lib/api';

// Главная, онбординг и настройки — в основном куске; остальное подгружается при заходе, чтобы на слабой сети приложение открывалось быстрее.
// Если кусок не нашёлся (приложение обновилось, пока вкладка была открыта) — один раз перезагружаемся.
function screen<T>(load: () => Promise<T>, pick: (m: T) => ComponentType<any>) {
  return lazy(() =>
    load().then(
      (m) => ({ default: pick(m) }),
      (e: unknown) => {
        const k = 'polovinka.chunkReload';
        if (!sessionStorage.getItem(k)) {
          sessionStorage.setItem(k, '1');
          location.reload();
        }
        throw e;
      },
    ),
  );
}
const Together = screen(
  () => import('./screens/Together'),
  (m) => m.Together,
);
const Settings = screen(
  () => import('./screens/Settings'),
  (m) => m.Settings,
);
const CelebrationOverlay = screen(
  () => import('./components/Celebration'),
  (m) => m.CelebrationOverlay,
);
const Friend = screen(
  () => import('./screens/Friend'),
  (m) => m.Friend,
);
const Recommend = screen(
  () => import('./screens/Recommend'),
  (m) => m.Recommend,
);
const Book = screen(
  () => import('./screens/Book'),
  (m) => m.Book,
);
const Privacy = screen(
  () => import('./screens/Privacy'),
  (m) => m.Privacy,
);
const History = screen(
  () => import('./screens/History'),
  (m) => m.History,
);
const Week = screen(
  () => import('./screens/Week'),
  (m) => m.Week,
);
const WeekPublicScreen = screen(
  () => import('./screens/WeekPublic'),
  (m) => m.WeekPublicScreen,
);
const Challenge = screen(
  () => import('./screens/Challenge'),
  (m) => m.Challenge,
);
const NewChallenge = screen(
  () => import('./screens/NewChallenge'),
  (m) => m.NewChallenge,
);
const Stats = screen(
  () => import('./screens/Stats'),
  (m) => m.Stats,
);
const Install = screen(
  () => import('./screens/Install'),
  (m) => m.Install,
);
const Levels = screen(
  () => import('./screens/Levels'),
  (m) => m.Levels,
);
const Topics = screen(
  () => import('./screens/Topics'),
  (m) => m.Topics,
);
const Capsule = screen(
  () => import('./screens/Capsule'),
  (m) => m.Capsule,
);
const DesktopQr = screen(
  () => import('./screens/DesktopQr'),
  (m) => m.DesktopQr,
);

function Nav() {
  const { me } = useStore();
  const loc = useLocation();
  if (!me || loc.pathname.startsWith('/j/') || loc.pathname.startsWith('/f/') || loc.pathname.startsWith('/w/') || loc.pathname === '/stats') return null;
  const item = (to: string, label: string, icon: ReactElement) => (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) => `flex flex-1 flex-col items-center gap-1 py-2 text-xs ${isActive ? 'text-accent' : 'text-muted'}`}
    >
      {icon}
      {label}
    </NavLink>
  );
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/90 backdrop-blur pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-md">
        {item(
          '/',
          'Сегодня',
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </svg>,
        )}
        {item(
          '/together',
          'Вместе',
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4.5" width="18" height="16.5" rx="3" />
            <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
            <path d="M12 18.2l-2.6-2.5a1.6 1.6 0 0 1 2.6-1.9 1.6 1.6 0 0 1 2.6 1.9Z" fill="currentColor" stroke="none" />
          </svg>,
        )}
        {item(
          '/history',
          'История',
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>,
        )}
        {item(
          '/settings',
          'Настройки',
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>,
        )}
      </div>
    </nav>
  );
}

function Toast() {
  const { toast, me, dismissToast, refresh } = useStore();
  const loc = useLocation();
  // На главной жест и так показывается карточкой в ленте.
  if (!toast || !me || loc.pathname === '/') return null;
  const seen = async () => {
    await api.gestureSeen(toast.id).catch(() => undefined);
    dismissToast();
    void refresh();
  };
  return (
    <div className="fixed inset-x-0 top-0 z-40 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))]">
      <div className="mx-auto max-w-md">
        <GestureCard gesture={toast} fromName={me.partner?.name ?? 'половинка'} onSeen={seen} />
      </div>
    </div>
  );
}

function Celebrations() {
  const { me, refresh } = useStore();
  const loc = useLocation();
  // На служебных и публичных страницах поздравления не показываем
  if (!me || me.celebrations.length === 0 || ['/stats', '/privacy', '/w/', '/f/', '/j/'].some((p) => loc.pathname.startsWith(p))) return null;
  const c = me.celebrations[0];
  const close = async () => {
    await api.milestoneSeen(c.key).catch(() => undefined);
    void refresh();
  };
  return (
    <Suspense fallback={null}>
      <CelebrationOverlay c={c} pairTitle={me.partner ? `${me.user.name} и ${me.partner.name}` : me.user.name} onClose={close} />
    </Suspense>
  );
}

/** Одноразовый код из адреса запуска (/?h=…): вход в установленное приложение без ввода. */
function useHandoff(): { pending: boolean; failed: boolean } {
  const { login } = useStore();
  const [state, setState] = useState(() => {
    const h = new URLSearchParams(location.search).get('h');
    return { pending: !!h && /^[A-Z0-9]{16}$/.test(h) && !getToken(), failed: false };
  });
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const h = params.get('h');
    if (!h) return;
    const clean = () => history.replaceState(null, '', location.pathname === '/install' ? '/' : location.pathname);
    if (getToken() || !/^[A-Z0-9]{16}$/.test(h)) {
      clean();
      return;
    }
    api
      .redeemLoginCode(h)
      .then((r) => {
        login(r.token, r.me);
        clean();
        setState({ pending: false, failed: false });
      })
      .catch(() => {
        clean();
        setState({ pending: false, failed: true });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return state;
}

/** Компьютер без входа: только QR на телефон. `?desktop=1` — служебный выключатель (тесты, владелец). */
function desktopGate(): boolean {
  if (platform() !== 'desktop' || isStandalone()) return false;
  try {
    if (new URLSearchParams(location.search).get('desktop') === '1') localStorage.setItem('polovinka.allowDesktop', '1');
    return !localStorage.getItem('polovinka.allowDesktop');
  } catch {
    return true;
  }
}

/** Открыли по QR с компьютера: отмечаем и убираем служебные метки из адреса. */
function useQrArrival() {
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (q.get('src') !== 'qr') return;
    adoptVisitor(location.search);
    void fetch('/api/events/anon', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'qr_open' }),
    }).catch(() => undefined);
    q.delete('src');
    q.delete('v');
    const rest = q.toString();
    history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : ''));
  }, []);
}

function Shell() {
  const { ready, me } = useStore();
  const loc = useLocation();
  const nav = useNavigate();
  useQrArrival();
  const handoff = useHandoff();
  const [gate] = useState(desktopGate);
  const launched = useRef(false);
  const [gateDeferred, setGateDeferred] = useState(emailGateDeferred);

  useEffect(() => {
    syncManifest(loc.pathname, loc.search);
  }, [loc.pathname, loc.search]);

  // Рекламный переход: /a/<код> или utm-метки. utm-ссылку переводим в /a/<код>, чтобы метка пережила установку на экран
  useEffect(() => {
    void captureAttribution(loc.pathname, loc.search).then((code) => {
      if (code && !me && loc.pathname === '/') nav(`/a/${code}`, { replace: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.pathname, loc.search]);

  // Какие экраны открывают — для статистики функций
  useEffect(() => {
    if (!me) return;
    const tab = new URLSearchParams(loc.search).get('tab');
    const p = loc.pathname;
    const name = p === '/history' ? (tab === 'topics' ? 'topics' : 'history') : p === '/topics' ? 'topics' : p.slice(1);
    if (['together', 'history', 'topics', 'book', 'levels', 'capsule', 'week', 'recommend', 'settings'].includes(name)) trackScreen(name);
  }, [loc.pathname, loc.search, me]);

  // Запуск с иконки: приложение могло стартовать со ссылки-приглашения, после входа — на главную.
  useEffect(() => {
    if (!me || launched.current) return;
    launched.current = true;
    if (!isStandalone()) return;
    try {
      if (!localStorage.getItem('polovinka.standaloneLogged')) {
        localStorage.setItem('polovinka.standaloneLogged', '1');
        void api.track('standalone_launch');
      }
    } catch {
      /* пусто */
    }
    if ((loc.pathname.startsWith('/j/') && me.partner) || (loc.pathname.startsWith('/c/') && !me.pair.isGuest)) nav('/', { replace: true });
  }, [me, loc.pathname, nav]);

  if (!ready || handoff.pending) return <Spinner />;
  if (!me && handoff.failed) return <Onboarding handoffFailed />;
  const publicPath = ['/j/', '/f/', '/w/', '/c/', '/stats', '/privacy'].some((p) => loc.pathname.startsWith(p));
  // На компьютере новый человек видит только QR; служебные и публичные страницы открываются как есть
  const desktopFree = ['/stats', '/privacy', '/w/'].some((p) => loc.pathname.startsWith(p));
  if (!me && gate && !desktopFree)
    return new URLSearchParams(loc.search).get('login') === '1' ? (
      <Onboarding loginOnly />
    ) : (
      <Suspense fallback={<Spinner />}>
        <DesktopQr />
      </Suspense>
    );
  if (!me && !publicPath) return <Onboarding />;
  // Почта обязательна: после первого ответа просим привязать, чтобы аккаунт не потерялся
  if (me?.access.emailDue && !gateDeferred && !publicPath) return <EmailGate onDeferred={() => setGateDeferred(true)} />;
  return (
    <>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/together" element={<Together />} />
          <Route path="/gesture" element={<Navigate to="/together" replace />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/history" element={<History />} />
          <Route path="/week" element={<Week />} />
          <Route path="/w/:code" element={<WeekPublicScreen />} />
          <Route path="/c/:code" element={<Challenge />} />
          <Route path="/challenge" element={<NewChallenge />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/install" element={<Install />} />
          <Route path="/levels" element={<Levels />} />
          <Route path="/topics" element={<Topics />} />
          <Route path="/capsule" element={<Capsule />} />
          <Route path="/j/:code" element={<Join />} />
          <Route path="/f/:code" element={<Friend />} />
          <Route path="/a/:code" element={<Navigate to="/" replace />} />
          <Route path="/recommend" element={<Recommend />} />
          <Route path="/book" element={<Book />} />
          <Route path="/ideas" element={<Navigate to="/together" replace />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </Suspense>
      <Nav />
      <Toast />
      <Celebrations />
    </>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  );
}
