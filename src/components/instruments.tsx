import {useEffect, useId, useState, type ReactNode} from 'react';
import type {GearGone, HeliStatus} from '../types';
import {formatAirtime} from '../model/format';

/** An instrument on the panel: a bezel with its name along the top. */
export function Panel({
  label,
  note,
  action,
  children,
  className = '',
  id,
}: {
  label?: ReactNode;
  note?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`panel ${className}`}>
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

/** Rolling up from zero, unless motion is to be reduced. */
const firstPhase = (): RollPhase => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'still' : 'ready');
/** Full turns a reel makes at most before it settles: enough to read as rolling, short enough to wait for. */
const MAX_TURNS = 3;

/** Waiting: the log is not loaded yet (zero minutes), so the roll waits for the real number. */
type RollPhase = 'waiting' | 'ready' | 'rolling' | 'still';

/** A drum's ten faces make a decagon, each face one digit high (em): this far from its axle. */
const FACE = 1.1;
const AXLE = FACE / (2 * Math.tan(Math.PI / 10));

/**
 * Where each drum stands, left to right, in digits turned. The last one creeps on with the seconds, and a drum moves
 * the one on its left only while it turns from 9 to 0, as the gears of a real counter carry.
 */
function drumPositions(seconds: number, places: number) {
  const exact = seconds / 60;
  let lower = exact % 10;
  const positions = [lower];
  for (let place = 1; place < places; place++) {
    lower = (Math.floor(exact / 10 ** place) % 10) + Math.max(0, lower - 9);
    positions.unshift(lower);
  }
  return positions;
}

/**
 * One digit as a drum seen through its window: the digits round a cylinder, the one before and the one after curving
 * away above and below. On the first load it rolls up from zero, after as many full turns as a counter counting up from
 * zero would make (capped).
 */
function Drum({position, turns, phase}: {position: number; turns: number; phase: RollPhase}) {
  const turned = phase === 'rolling' ? turns * 10 + position : phase === 'still' ? position : 0;
  return (
    <span
      className="hobbs-drum"
      style={{
        transform: `translateZ(-${AXLE.toFixed(4)}em) rotateX(${(turned * 36).toFixed(2)}deg)`,
        transitionDuration: phase === 'rolling' ? `${900 + turns * 300}ms` : '0ms',
      }}
    >
      {Array.from({length: 10}, (_, digit) => (
        <span key={digit} style={{transform: `rotateX(${-digit * 36}deg) translateZ(${AXLE.toFixed(4)}em)`}}>
          {digit}
        </span>
      ))}
    </span>
  );
}

/**
 * The airtime counter: drums of minutes in the air, the last one white and creeping on with the seconds, like the hour
 * meter of a real aircraft but counting minutes. Each time it appears (a change of tab) the drums roll up from zero.
 */
export function MinuteMeter({seconds}: {seconds: number}) {
  const minutes = Math.floor(seconds / 60);
  const digits = String(minutes).padStart(5, '0').split('');
  const positions = drumPositions(seconds, digits.length);
  const [phase, setPhase] = useState<RollPhase>(() => (minutes === 0 ? 'waiting' : firstPhase()));

  useEffect(() => {
    if (phase === 'waiting') {
      if (minutes > 0) setPhase(firstPhase());
      return;
    }
    if (phase === 'ready') {
      let frame = requestAnimationFrame(() => {
        // A frame at zero first, so the move to the number is a transition.
        frame = requestAnimationFrame(() => setPhase('rolling'));
      });
      return () => cancelAnimationFrame(frame);
    }
    if (phase === 'rolling') {
      // Once the drums have settled, they stand still on the same faces without the extra turns.
      const done = window.setTimeout(() => setPhase('still'), 900 + MAX_TURNS * 300 + 100);
      return () => window.clearTimeout(done);
    }
  }, [phase, minutes]);

  return (
    <span
      className="hobbs"
      role="img"
      aria-label={`${minutes.toLocaleString('en-GB')} minutes in the air`}
      title={formatAirtime(seconds, true)}
    >
      {digits.map((_, index) => {
        const place = digits.length - 1 - index;
        const turns = Math.min(MAX_TURNS, Math.floor(minutes / 10 ** (place + 1)));
        return (
          <span key={index} className={`hobbs-digit ${index === digits.length - 1 ? 'tenth' : ''}`}>
            <Drum position={positions[index]} turns={turns} phase={phase} />
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

const STAMP_LABEL: Record<HeliStatus | GearGone, string> = {
  active: 'Flying',
  grounded: 'Grounded',
  retired: 'Retired',
  sold: 'Sold',
  lost: 'Lost',
  stolen: 'Stolen',
};

/** A heli's status, or how a piece of gear left the hangar: a small light and a word. */
export function Stamp({status}: {status: HeliStatus | GearGone}) {
  return <span className={`stamp ${status}`}>{STAMP_LABEL[status]}</span>;
}

/** A point on a circle around (centre, centre), the angle in degrees clockwise from twelve o'clock. */
function around(centre: number, radius: number, angle: number) {
  const radians = (angle * Math.PI) / 180;
  return {x: centre + radius * Math.sin(radians), y: centre - radius * Math.cos(radians)};
}

/** An arc of that circle, clockwise from one angle to the other. */
function sweep(centre: number, radius: number, from: number, to: number) {
  const start = around(centre, radius, from);
  const end = around(centre, radius, to);
  const large = to - from > 180 ? 1 : 0;
  return `M${start.x.toFixed(2)},${start.y.toFixed(2)} A${radius},${radius} 0 ${large} 1 ${end.x.toFixed(2)},${end.y.toFixed(2)}`;
}

/** A dial's scale runs clockwise from half past seven (empty) to half past four (full), as on an aircraft's gauges. */
const DIAL_FROM = -135;
const DIAL_SWEEP = 270;

export type DialBand = {to: number; tone: 'good' | 'caution' | 'warning'};

/**
 * A round engine instrument, as on a helicopter's panel: a 270° scale with ticks and numbers, coloured range arcs where
 * the scale has them (green, amber, red), a needle, and the exact value in a box under the hub. A bug on the rim marks
 * a second value, such as the highest the needle went. The scale ends on a whole number of steps.
 */
export function Dial({
  value,
  max,
  step,
  minor = 2,
  color,
  readout,
  label,
  number = String,
  bands = [],
  bug,
}: {
  value: number;
  max: number;
  /** The gap between numbered ticks, with `minor` ticks to each. */
  step: number;
  minor?: number;
  color: string;
  readout: string;
  label: string;
  /** The number printed by a major tick, or null to leave it bare. */
  number?: (at: number) => string | null;
  bands?: DialBand[];
  bug?: number;
}) {
  const angle = (at: number) => DIAL_FROM + (Math.max(0, Math.min(max, at)) / max) * DIAL_SWEEP;
  const count = Math.round(max / step) * minor;
  const ticks = Array.from({length: count + 1}, (_, index) => ({
    at: (index * step) / minor,
    major: index % minor === 0,
  }));
  const edge = (at: number, radius: number) => around(50, radius, angle(at));
  return (
    <svg viewBox="0 0 100 100" className="dial-face" role="img" aria-label={`${label}: ${readout}`}>
      <circle cx={50} cy={50} r={48} className="stick-gate" />
      <circle cx={50} cy={50} r={45.5} className="dial-lip" />
      <path d={sweep(50, 41, DIAL_FROM, DIAL_FROM + DIAL_SWEEP)} className="dial-track" />
      {bands.map((band, index) => (
        <path
          key={band.to}
          d={sweep(50, 43.4, angle(bands[index - 1]?.to ?? 0), angle(band.to))}
          className={`dial-band ${band.tone}`}
        />
      ))}
      {ticks.map(({at, major}) => {
        const outer = edge(at, 41);
        const inner = edge(at, major ? 34 : 37.5);
        const text = major ? number(at) : null;
        const spot = edge(at, 27);
        return (
          <g key={at}>
            <line
              x1={outer.x}
              y1={outer.y}
              x2={inner.x}
              y2={inner.y}
              className={major ? 'dial-tick major' : 'dial-tick'}
            />
            {text && (
              <text
                x={spot.x}
                y={spot.y}
                className={at === 0 || at === max || Math.abs(at - max / 2) < 1e-6 ? 'dial-number key' : 'dial-number'}
              >
                {text}
              </text>
            )}
          </g>
        );
      })}
      {bug !== undefined && (
        <polygon
          points={[edge(bug, 41.5), around(50, 47, angle(bug) - 4), around(50, 47, angle(bug) + 4)]
            .map(point => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
            .join(' ')}
          fill={color}
          className="dial-bug"
        />
      )}
      <rect x={32} y={75.5} width={36} height={13} rx={2.5} className="dial-window" />
      <text x={50} y={82.3} className="dial-readout">
        {readout}
      </text>
      <path
        d="M50 11 L51.5 50 L51 59 L49 59 L48.5 50 Z"
        fill={color}
        transform={`rotate(${angle(value)} 50 50)`}
        className="dial-needle"
      />
      <circle cx={50} cy={50} r={4.4} className="dial-hub" />
      <circle cx={50} cy={50} r={1.5} className="dial-pin" />
    </svg>
  );
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
