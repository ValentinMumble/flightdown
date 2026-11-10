import {useEffect, useMemo, useRef, type TouchEvent} from 'react';
import {Link, Navigate, Route, Routes, useLocation, useNavigate, useNavigationType} from 'react-router';
import {BookOpen, CloudOff, Gauge, MapPin, Plus, Radar, Settings as SettingsIcon, Warehouse} from 'lucide-react';
import {useStore, type Mode} from './data/store';
import {OverlayProvider, useOverlay} from './components/ui';
import {MinuteMeter, RotorMark} from './components/instruments';
import {SessionForm} from './components/forms/SessionForm';
import {airtime} from './model/stats';
import {Home} from './pages/Home';
import {Sessions} from './pages/Sessions';
import {SessionPage} from './pages/SessionPage';
import {Stats} from './pages/Stats';
import {Hangar} from './pages/Hangar';
import {HeliPage} from './pages/HeliPage';
import {Settings} from './pages/Settings';
import {Spots} from './pages/Spots';

const TABS = [
  {to: '/', label: 'Cockpit', icon: Gauge},
  {to: '/sessions', label: 'Logbook', icon: BookOpen},
  {to: '/stats', label: 'Debrief', icon: Radar},
  {to: '/hangar', label: 'Hangar', icon: Warehouse},
  {to: '/spots', label: 'Spots', icon: MapPin},
];

function isActive(to: string, pathname: string) {
  if (to === '/') return pathname === '/';
  if (to === '/hangar') return pathname.startsWith('/hangar') || pathname.startsWith('/helis');
  return pathname.startsWith(to);
}

const MODE_LABEL: Record<Mode, string> = {
  loading: 'Loading…',
  owner: 'Synced',
  local: 'In this browser',
  sample: 'Made-up log',
};

function useLogSession() {
  const {open} = useOverlay();
  return () => open(<SessionForm />);
}

/** Wide screens: one bar along the top, the soft keys in the middle, the minute counter and the log button at the end. */
function CockpitBar() {
  const {pathname} = useLocation();
  const {mode, waiting, doc} = useStore();
  const logSession = useLogSession();
  const total = useMemo(() => doc.sessions.reduce((sum, session) => sum + airtime(session), 0), [doc.sessions]);
  return (
    <header className="cockpit-bar">
      <Link to="/" className="logotype">
        <RotorMark />
        Flightdown
      </Link>
      <nav className="soft-keys" aria-label="Flightdown">
        {TABS.map(({to, label, icon: Icon}) => (
          <Link key={to} to={to} className="soft-key" aria-current={isActive(to, pathname) ? 'page' : undefined}>
            <Icon size={16} strokeWidth={1.9} />
            {label}
          </Link>
        ))}
      </nav>
      <div className="bar-end">
        <span className="sync" title={waiting ? `${waiting} changes waiting for a connection` : MODE_LABEL[mode]}>
          {waiting > 0 && <CloudOff size={14} />}
          {waiting > 0 ? `${waiting} waiting` : MODE_LABEL[mode]}
        </span>
        <MinuteMeter seconds={total} size="small" />
        <Link
          to="/settings"
          className="icon-button"
          aria-label="Settings"
          aria-current={pathname.startsWith('/settings') ? 'page' : undefined}
        >
          <SettingsIcon size={17} />
        </Link>
        <button className="button solid" onClick={logSession}>
          <Plus size={16} strokeWidth={2.6} /> Log
        </button>
      </div>
    </header>
  );
}

/** The phone dock: liquid glass, a lens under the open tab, and the round log button beside it. */
function Dock() {
  const {pathname} = useLocation();
  const logSession = useLogSession();
  const current = TABS.findIndex(({to}) => isActive(to, pathname));
  return (
    <div className="dock-row phone-only">
      <nav className="dock glass" aria-label="Flightdown" style={{['--count' as string]: TABS.length}}>
        {current >= 0 && <div className="dock-lens" aria-hidden style={{['--index' as string]: current}} />}
        {TABS.map(({to, label, icon: Icon}, index) => (
          <Link
            key={to}
            to={to}
            className="dock-tab"
            aria-current={index === current ? 'page' : undefined}
            onClick={() => window.scrollTo({top: 0, behavior: pathname === to ? 'smooth' : 'auto'})}
          >
            <Icon size={22} strokeWidth={1.8} />
            {label}
          </Link>
        ))}
      </nav>
      <button className="dock-plus glass" aria-label="Log a session" onClick={logSession}>
        <Plus size={26} strokeWidth={2.2} />
      </button>
    </div>
  );
}

/** Where a sideways swipe may not change tab: fields, charts, rows that scroll sideways. */
const NO_SWIPE =
  'input, textarea, select, .chips.scroll, .timeline-scroll, .recharts-wrapper, .segmented, .sheet, .damage-map, .leaflet-container';

/** On phones a sideways swipe on a tab's page moves to the next or previous tab, as in Tillroll. */
function useSwipeTabs() {
  const {pathname} = useLocation();
  const navigate = useNavigate();
  const start = useRef<{x: number; y: number} | null>(null);
  const index = TABS.findIndex(({to}) => to === pathname);
  return {
    onTouchStart: (event: TouchEvent) => {
      const touch = event.touches[0];
      const edge = touch.clientX < 24 || touch.clientX > window.innerWidth - 24;
      start.current =
        index < 0 || edge || (event.target as Element).closest(NO_SWIPE) ? null : {x: touch.clientX, y: touch.clientY};
    },
    onTouchEnd: (event: TouchEvent) => {
      if (!start.current) return;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - start.current.x;
      const dy = touch.clientY - start.current.y;
      start.current = null;
      if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2) return;
      const next = TABS[index + (dx < 0 ? 1 : -1)];
      if (next) {
        navigate(next.to);
        window.scrollTo({top: 0});
      }
    },
  };
}

/** A page opened from a link starts at its top; back and forward keep where the browser had it. */
function useScrollReset() {
  const {pathname} = useLocation();
  const navigationType = useNavigationType();
  useEffect(() => {
    if (navigationType !== 'POP') window.scrollTo({top: 0});
  }, [pathname, navigationType]);
}

function Shell() {
  const swipe = useSwipeTabs();
  useScrollReset();
  return (
    <div className="app">
      <CockpitBar />
      <main className="main" {...swipe}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/sessions" element={<Sessions />} />
          <Route path="/sessions/:id" element={<SessionPage />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/hangar" element={<Hangar />} />
          <Route path="/hangar/:view" element={<Hangar />} />
          <Route path="/helis/:id" element={<HeliPage />} />
          <Route path="/spots" element={<Spots />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <Dock />
    </div>
  );
}

export function App() {
  return (
    <OverlayProvider>
      <Shell />
    </OverlayProvider>
  );
}
