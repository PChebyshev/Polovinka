import { useEffect, useRef, useState, type ReactElement } from 'react';
import { BrowserRouter, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useStore } from './lib/store';
import { Onboarding } from './screens/Onboarding';
import { Home } from './screens/Home';
import { Join } from './screens/Join';
import { Friend } from './screens/Friend';
import { Recommend } from './screens/Recommend';
import { Gesture } from './screens/Gesture';
import { Settings } from './screens/Settings';
import { History } from './screens/History';
import { Week } from './screens/Week';
import { WeekPublicScreen } from './screens/WeekPublic';
import { Challenge } from './screens/Challenge';
import { NewChallenge } from './screens/NewChallenge';
import { Stats } from './screens/Stats';
import { Install } from './screens/Install';
import { Levels } from './screens/Levels';
import { Topics } from './screens/Topics';
import { Capsule } from './screens/Capsule';
import { isStandalone, syncManifest } from './lib/install';
import { getToken } from './lib/api';
import { CelebrationOverlay } from './components/Celebration';
import { Spinner, Heart } from './components/ui';
import { GestureCard } from './components/GestureToast';
import { api } from './lib/api';

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
        {item('/gesture', 'Жест', <Heart className="h-6 w-6" filled={false} />)}
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
  if (!me || me.celebrations.length === 0) return null;
  const c = me.celebrations[0];
  const close = async () => {
    await api.milestoneSeen(c.key).catch(() => undefined);
    void refresh();
  };
  return <CelebrationOverlay c={c} pairTitle={me.partner ? `${me.user.name} и ${me.partner.name}` : me.user.name} onClose={close} />;
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

function Shell() {
  const { ready, me } = useStore();
  const loc = useLocation();
  const nav = useNavigate();
  const handoff = useHandoff();
  const launched = useRef(false);

  useEffect(() => {
    syncManifest(loc.pathname, loc.search);
  }, [loc.pathname, loc.search]);

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
  const publicPath = ['/j/', '/f/', '/w/', '/c/', '/stats'].some((p) => loc.pathname.startsWith(p));
  if (!me && !publicPath) return <Onboarding />;
  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/gesture" element={<Gesture />} />
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
        <Route path="/recommend" element={<Recommend />} />
        <Route path="*" element={<Home />} />
      </Routes>
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
