import type { ReactElement } from 'react';
import { BrowserRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useStore } from './lib/store';
import { Onboarding } from './screens/Onboarding';
import { Home } from './screens/Home';
import { Join } from './screens/Join';
import { Gesture } from './screens/Gesture';
import { Settings } from './screens/Settings';
import { Spinner, Heart } from './components/ui';
import { GestureCard } from './components/GestureToast';
import { api } from './lib/api';

function Nav() {
  const { me } = useStore();
  const loc = useLocation();
  if (!me || loc.pathname.startsWith('/j/')) return null;
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

function Shell() {
  const { ready, me } = useStore();
  const loc = useLocation();
  if (!ready) return <Spinner />;
  if (!me && !loc.pathname.startsWith('/j/')) return <Onboarding />;
  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/gesture" element={<Gesture />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/j/:code" element={<Join />} />
        <Route path="*" element={<Home />} />
      </Routes>
      <Nav />
      <Toast />
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
