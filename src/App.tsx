import {useEffect, useMemo} from 'react';
import {Link, Navigate, Route, Routes, useLocation, useNavigate, useNavigationType} from 'react-router';
import {BookOpen, CloudOff, Gauge, MapPin, Plus, Radar, Settings as SettingsIcon, Warehouse} from 'lucide-react';
import {useStore, type Mode} from './data/store';
import {OverlayProvider, useOverlay} from './components/ui';
import {MinuteMeter, RotorMark} from './components/instruments';
import {SortieForm} from './components/forms/SortieForm';
import {airtime} from './model/stats';
import {Home} from './pages/Home';
import {Sorties} from './pages/Sorties';
import {SortiePage} from './pages/SortiePage';
import {Stats} from './pages/Stats';
import {Hangar} from './pages/Hangar';
import {HeliPage} from './pages/HeliPage';
import {Settings} from './pages/Settings';
import {Spots} from './pages/Spots';
import {useTabSwipe} from './components/useTabSwipe';

const TABS = [
  {to: '/', label: 'Cockpit', icon: Gauge},
  {to: '/sorties', label: 'Sorties', icon: BookOpen},
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

function useLogSortie() {
  const {open} = useOverlay();
  return () => open(<SortieForm />);
}

/** Wide screens: one bar along the top, the soft keys in the middle, the minute counter and the log button at the end. */
function CockpitBar() {
  const {pathname} = useLocation();
  const {mode, waiting, doc} = useStore();
  const logSortie = useLogSortie();
  const total = useMemo(() => doc.sorties.reduce((sum, sortie) => sum + airtime(sortie), 0), [doc.sorties]);
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
        <button className="button solid" onClick={logSortie}>
          <Plus size={16} strokeWidth={2.6} /> Log
        </button>
      </div>
    </header>
  );
}

/** The phone dock: liquid glass, a lens under the open tab, and the round log button beside it. */
function Dock() {
  const {pathname} = useLocation();
  const logSortie = useLogSortie();
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
      <button className="dock-plus glass" aria-label="Log a sortie" onClick={logSortie}>
        <Plus size={26} strokeWidth={2.2} />
      </button>
    </div>
  );
}

/** On a phone, a sideways swipe on a tab's own page moves to the next or previous tab (see useTabSwipe). */
function useSwipeTabs() {
  const {pathname} = useLocation();
  const navigate = useNavigate();
  const index = TABS.findIndex(({to}) => to === pathname);
  useTabSwipe(TABS.length, index, next => {
    navigate(TABS[next].to);
    window.scrollTo({top: 0});
  });
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
  useSwipeTabs();
  useScrollReset();
  return (
    <div className="app">
      <CockpitBar />
      <main className="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/sorties" element={<Sorties />} />
          <Route path="/sorties/:id" element={<SortiePage />} />
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
