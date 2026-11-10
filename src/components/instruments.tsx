import {useEffect, useId, useState, type ReactNode} from 'react';
import type {HeliStatus} from '../types';
import {formatAirtime} from '../model/format';

/** An instrument on the panel: a bezel with its name along the top. */
export function Panel({
  label,
  note,
  action,
  children,
  className = '',
}: {
  label?: ReactNode;
  note?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {(label || action) && (
        <div className="panel-head">
          <div>
            {label && <h2 className="panel-label">{label}</h2>}
            {note && <div className="panel-note">{note}</div>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * A head-up display's tape: a ruler from 0 to max, a white caret on the value and a green one on a second value (the
 * recent one, against all time). Values past the end sit on it.
 */
export function Tape({
  value,
  max,
  bug,
  label,
}: {
  value: number | null;
  max: number;
  bug?: number | null;
  label: string;
}) {
  const at = (number: number) => `${(Math.min(max, Math.max(0, number)) / max) * 100}%`;
  return (
    <div className="tape" role="img" aria-label={label}>
      <div className="tape-track">
        {Array.from({length: max + 1}, (_, tick) => (
          <i key={tick} className={tick % 5 === 0 ? 'major' : ''} style={{left: at(tick)}} />
        ))}
        {bug !== undefined && bug !== null && <b className="tape-bug" style={{left: at(bug)}} />}
        {value !== null && <b className="tape-caret" style={{left: at(value)}} />}
      </div>
      <div className="tape-scale">
        <span>0</span>
        <span>{max / 2}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

/** The counters roll up once, when the app first opens; later they just show their number. */
let rolledOnce = false;
/** Full turns a reel makes at most before it settles: enough to read as rolling, short enough to wait for. */
const MAX_TURNS = 3;

type RollPhase = 'ready' | 'rolling' | 'still';

/**
 * One digit as a reel: the digits from 0 up to its own, after as many full turns as an odometer counting up from zero
 * would make (capped), scrolled from the first to the last.
 */
function Reel({digit, turns, phase}: {digit: number; turns: number; phase: RollPhase}) {
  const strip = Array.from({length: turns * 10 + digit + 1}, (_, index) => index % 10);
  return (
    <span
      className="hobbs-reel"
      style={{
        transform: `translateY(${phase === 'rolling' ? -(strip.length - 1) * 1.25 : 0}em)`,
        transitionDuration: `${900 + turns * 300}ms`,
      }}
    >
      {strip.map((value, index) => (
        <span key={index}>{value}</span>
      ))}
    </span>
  );
}

/**
 * The airtime counter: rolling digits of whole minutes in the air, the last one lit as it turns, like the hour meter
 * of a real aircraft but counting minutes. On the app's first load the digits roll up from zero.
 */
export function MinuteMeter({seconds, size = 'large'}: {seconds: number; size?: 'large' | 'small'}) {
  const minutes = Math.floor(seconds / 60);
  const digits = String(minutes)
    .padStart(size === 'large' ? 5 : 4, '0')
    .split('');
  const [phase, setPhase] = useState<RollPhase>(() =>
    rolledOnce || minutes === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'still' : 'ready',
  );

  useEffect(() => {
    rolledOnce = true;
    if (phase !== 'ready') return;
    let frame = requestAnimationFrame(() => {
      // A frame at zero first, so the move to the number is a transition.
      frame = requestAnimationFrame(() => setPhase('rolling'));
    });
    const done = window.setTimeout(() => setPhase('still'), 900 + MAX_TURNS * 300 + 100);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(done);
    };
  }, [phase]);

  return (
    <span
      className={`hobbs ${size}`}
      role="img"
      aria-label={`${minutes.toLocaleString('en-GB')} minutes in the air`}
      title={formatAirtime(seconds, true)}
    >
      {digits.map((digit, index) => {
        const place = digits.length - 1 - index;
        const turns = Math.min(MAX_TURNS, Math.floor(minutes / 10 ** (place + 1)));
        return (
          <span key={index} className={`hobbs-digit ${index === digits.length - 1 ? 'tenth' : ''}`}>
            {phase === 'still' ? digit : <Reel digit={Number(digit)} turns={turns} phase={phase} />}
          </span>
        );
      })}
      <span className="hobbs-unit">min</span>
    </span>
  );
}

/** A row of LED segments: one a pack, lit up to the value, with the best run marked. */
export function SegmentBar({value, best, segments = 24}: {value: number; best: number; segments?: number}) {
  const scale = Math.max(best, value, segments);
  const lit = Math.round((value / scale) * segments);
  const mark = Math.round((best / scale) * segments);
  return (
    <div className="segments" role="img" aria-label={`${value} of a best ${best}`}>
      {Array.from({length: segments}, (_, index) => (
        <i
          key={index}
          className={`${index < lit ? (lit / segments > 0.66 ? 'good' : lit / segments > 0.33 ? 'caution' : 'warning') : ''} ${index === mark - 1 ? 'best' : ''}`}
        />
      ))}
    </div>
  );
}

const STAMP_LABEL: Record<HeliStatus, string> = {
  active: 'Flying',
  grounded: 'Grounded',
  retired: 'Retired',
  sold: 'Sold',
  lost: 'Lost',
};

export function Stamp({status}: {status: HeliStatus}) {
  return <span className={`stamp ${status}`}>{STAMP_LABEL[status]}</span>;
}

/** A point on a circle around (centre, centre), the angle in degrees clockwise from twelve o'clock. */
function around(centre: number, radius: number, angle: number) {
  const radians = (angle * Math.PI) / 180;
  return {x: centre + radius * Math.sin(radians), y: centre - radius * Math.cos(radians)};
}

function sweep(centre: number, radius: number, from: number, to: number) {
  const start = around(centre, radius, from);
  const end = around(centre, radius, to);
  return `M${start.x.toFixed(2)},${start.y.toFixed(2)} A${radius},${radius} 0 0 1 ${end.x.toFixed(2)},${end.y.toFixed(2)}`;
}

const MARK_ANGLE = 40;

/**
 * The app's mark: a two-blade rotor seen from above, turning clockwise as RC helis do, each tip trailing a swoosh of
 * its path. Drawn bold enough to read at 20px.
 */
export function RotorMark({size = 22, className}: {size?: number; className?: string}) {
  const hole = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <mask id={hole}>
        <rect width={24} height={24} fill="#fff" />
        <circle cx={12} cy={12} r={1.1} fill="#000" />
      </mask>
      <g fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" opacity={0.5}>
        <path d={sweep(12, 10.6, MARK_ANGLE - 78, MARK_ANGLE - 14)} />
        <path d={sweep(12, 10.6, MARK_ANGLE + 102, MARK_ANGLE + 166)} />
      </g>
      <g fill="currentColor" transform={`rotate(${MARK_ANGLE} 12 12)`} mask={`url(#${hole})`}>
        <path d="M10.9 12 L10.6 3.2 Q10.6 1.4 12 1.4 Q13.4 1.4 13.4 3.2 L13.1 12 Z" />
        <path d="M10.9 12 L10.6 3.2 Q10.6 1.4 12 1.4 Q13.4 1.4 13.4 3.2 L13.1 12 Z" transform="rotate(180 12 12)" />
        <circle cx={12} cy={12} r={3.2} />
      </g>
    </svg>
  );
}

/** One blade pointing up from the hub of a 100 × 100 drawing: straight leading edge on the right, the side it moves to. */
const BLADE = 'M48.2 41 L53.4 41 L53.4 6.6 Q53.4 3.4 50.6 3.5 L48.4 3.8 Q46.6 4.1 46.6 6.6 L46.6 26 Q46.6 31 47.6 36 Z';

function RotorBlade({turn}: {turn: number}) {
  return (
    <g transform={`rotate(${turn} 50 50)`}>
      <path d={BLADE} className="rotor-blade" />
      <rect x={52.2} y={7} width={1.2} height={30} rx={0.6} className="rotor-edge" />
      <rect x={46.6} y={8.2} width={6.8} height={2.4} className="rotor-stripe" />
      <rect x={45} y={29} width={10} height={14} rx={2.6} className="rotor-metal" />
      <rect x={55} y={35} width={6} height={3.2} rx={1.6} className="rotor-metal" />
      <circle cx={61} cy={36.6} r={2} className="rotor-ball" />
      <circle cx={50} cy={33.5} r={1.7} className="rotor-bolt" />
    </g>
  );
}

/**
 * The rotor on the airtime panel: blades, grips, pitch links and the head, seen from above. It spools up when the page
 * opens, like a heli on its governor, and the blades blur into a disc as it reaches speed.
 */
export function Rotor() {
  return (
    <span className="rotor" aria-hidden>
      <svg viewBox="0 0 100 100" className="rotor-disc">
        <circle cx={50} cy={50} r={47} className="rotor-disc-fill" />
        <circle cx={50} cy={50} r={47} className="rotor-disc-ring" />
      </svg>
      <span className="rotor-spin">
        <span className="rotor-blur" />
        <svg viewBox="0 0 100 100" className="rotor-parts">
          <RotorBlade turn={0} />
          <RotorBlade turn={180} />
          <rect x={43} y={40} width={14} height={20} rx={4} className="rotor-metal-dark" />
          <circle cx={50} cy={50} r={6.2} className="rotor-metal" />
          <path d="M50 47.3 L52.35 48.65 L52.35 51.35 L50 52.7 L47.65 51.35 L47.65 48.65 Z" className="rotor-bolt" />
        </svg>
      </span>
    </span>
  );
}
