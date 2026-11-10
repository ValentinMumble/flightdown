import {createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode} from 'react';
import {Link, useNavigate} from 'react-router';
import {ArrowLeft, Minus, Plus, X} from 'lucide-react';
import type {Heli, Spot} from '../types';
import {useSeriesColor} from './colors';

/** A sheet over the page (thick glass), and a toast: one of each at a time. */
interface Overlay {
  open: (content: ReactNode) => void;
  close: () => void;
  toast: (message: string) => void;
}

const OverlayContext = createContext<Overlay | null>(null);

export function useOverlay() {
  const overlay = useContext(OverlayContext);
  if (!overlay) throw new Error('useOverlay outside OverlayProvider');
  return overlay;
}

export function OverlayProvider({children}: {children: ReactNode}) {
  const [content, setContent] = useState<ReactNode>(null);
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number>(0);
  const close = useCallback(() => setContent(null), []);
  const toast = useCallback((text: string) => {
    window.clearTimeout(timer.current);
    setMessage(text);
    timer.current = window.setTimeout(() => setMessage(null), 2600);
  }, []);

  useEffect(() => {
    if (!content) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [content, close]);

  return (
    <OverlayContext.Provider value={{open: setContent, close, toast}}>
      {children}
      {content && (
        <div className="sheet-backdrop" onMouseDown={event => event.target === event.currentTarget && close()}>
          <div className="sheet" role="dialog" aria-modal="true">
            <button className="sheet-close" aria-label="Close" onClick={close}>
              <X size={17} strokeWidth={2.2} />
            </button>
            {content}
          </div>
        </div>
      )}
      {message && (
        <div className="toast glass" role="status">
          {message}
        </div>
      )}
    </OverlayContext.Provider>
  );
}

export function SheetHead({title, children}: {title: string; children?: ReactNode}) {
  return (
    <div className="sheet-head">
      <h2 className="sheet-title">{title}</h2>
      {children}
    </div>
  );
}

/** A view's title: display type on wide screens, in the glass top bar on phones, with a way back on inner pages. */
export function PageHeader({
  title,
  sub,
  icon,
  back,
  actions,
}: {
  title: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  back?: string;
  actions?: ReactNode;
}) {
  const navigate = useNavigate();
  const goBack = () => (window.history.length > 1 ? navigate(-1) : navigate(back ?? '/'));
  return (
    <>
      <header className="topbar phone-only">
        <div className="topbar-title">
          {back && (
            <button className="icon-button" aria-label="Back" onClick={goBack}>
              <ArrowLeft size={18} />
            </button>
          )}
          {icon}
          <span>{title}</span>
        </div>
        <div className="toolbar">{actions}</div>
      </header>
      <div className="page-head desktop-only">
        <div>
          {back && (
            <Link to={back} onClick={event => (event.preventDefault(), goBack())} className="back-link">
              <ArrowLeft size={14} /> Back
            </Link>
          )}
          <h1 className="page-title">
            {icon}
            {title}
          </h1>
          {sub && <div className="page-sub">{sub}</div>}
        </div>
        <div className="toolbar">{actions}</div>
      </div>
    </>
  );
}

export function Card({
  title,
  sub,
  action,
  children,
  className = '',
}: {
  title?: ReactNode;
  sub?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <div className="card-head">
          <div>
            {title && <h2 className="card-title">{title}</h2>}
            {sub && <div className="card-sub">{sub}</div>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function HeliDot({heli}: {heli: Heli | undefined}) {
  const color = useSeriesColor();
  return <i className="dot" style={{background: heli ? color(heli.color) : 'var(--muted)'}} aria-hidden />;
}

export function HeliName({heli}: {heli: Heli | undefined}) {
  return (
    <span style={{display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0}}>
      <HeliDot heli={heli} />
      <span className="name">{heli?.name ?? 'Unknown heli'}</span>
    </span>
  );
}

export const spotLabel = (spot: Spot | undefined) => (spot ? `${spot.emoji ? `${spot.emoji} ` : ''}${spot.name}` : '');

export function Stepper({
  value,
  onChange,
  min = 0,
  max = 99,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  label: string;
}) {
  return (
    <div className="stepper">
      <button type="button" aria-label={`One less ${label}`} onClick={() => onChange(Math.max(min, value - 1))}>
        <Minus size={16} />
      </button>
      <output aria-label={label} className="tabular">
        {value}
      </output>
      <button type="button" aria-label={`One more ${label}`} onClick={() => onChange(Math.min(max, value + 1))}>
        <Plus size={16} />
      </button>
    </div>
  );
}

export function Empty({emoji = '🚁', children}: {emoji?: string; children: ReactNode}) {
  return (
    <div className="empty">
      <div className="empty-emoji">{emoji}</div>
      {children}
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: {value: T; label: string}[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
