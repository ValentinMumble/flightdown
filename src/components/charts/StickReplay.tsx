import {useEffect, useMemo, useRef, useState} from 'react';
import {Pause, Play, RotateCcw} from 'lucide-react';
import type {TelemetrySeries} from '../../types';
import {sampleAt} from '../../model/telemetry';
import {invertedStretches} from '../../model/insights';
import {INVERTED} from '../PackTimes';
import {batteryAt, usedMah} from '../../model/battery';
import {formatNumber, formatTimer} from '../../model/format';
import {Dial, type DialBand} from '../instruments';

const SIZE = 150;
/** The trail behind each stick: this many seconds, a point every tenth of one. */
const TRAIL = 1.5;
const SPEEDS = [1, 2, 4];
/** Degrees the small heli rolls, tilts and turns a percent of stick: 35° rolled at full aileron. */
const ROLL = 0.35;
const TILT = 0.3;
const TURN = 0.35;

/**
 * A small heli seen from behind, in thin lines like a vector screen's: the rotor's disc, its blades tapering out from
 * their grips and the head, the mast, swashplate and its links, the canopy with a glint, the tail boom's end with the
 * tail rotor beside it and the fin under it, the skids' struts and cross tube, the skids seen end on.
 */
function RearView() {
  return (
    <svg viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx={50} cy={30.4} rx={45} ry={3.4} strokeWidth={0.6} strokeOpacity={0.35} />
      <path d="M45 29.2 L8 30 Q6 30.5 8 31.1 L45 31.7 Z" fill="currentColor" stroke="none" />
      <path d="M55 29.2 L92 30 Q94 30.5 92 31.1 L55 31.7 Z" fill="currentColor" stroke="none" />
      <rect
        x={40.5}
        y={28.6}
        width={5.5}
        height={3.6}
        rx={0.9}
        fill="currentColor"
        fillOpacity={0.35}
        strokeWidth={1}
      />
      <rect x={54} y={28.6} width={5.5} height={3.6} rx={0.9} fill="currentColor" fillOpacity={0.35} strokeWidth={1} />
      <rect x={46.5} y={27.8} width={7} height={5} rx={1.3} fill="currentColor" stroke="none" />
      <line x1={50} y1={32.8} x2={50} y2={39.5} strokeWidth={1.6} />
      <ellipse cx={50} cy={39.6} rx={6.2} ry={1.4} strokeWidth={1.2} />
      <line x1={44.5} y1={40} x2={43.5} y2={44.5} strokeWidth={0.9} />
      <line x1={55.5} y1={40} x2={56.5} y2={44.5} strokeWidth={0.9} />
      <path d="M34 71 Q50 67 66 71" strokeWidth={0.9} strokeOpacity={0.7} />
      <path
        d="M40 44 C44 40.5 56 40.5 60 44 C64.5 48.5 65 56 61.5 61 C57.5 65.5 42.5 65.5 38.5 61 C35 56 35.5 48.5 40 44 Z"
        fill="currentColor"
        fillOpacity={0.12}
        strokeWidth={1.6}
      />
      <path d="M42.5 47.5 C44.5 45 47.5 44 50.5 43.8" strokeWidth={1} strokeOpacity={0.6} />
      <line x1={50} y1={58} x2={50} y2={67.5} strokeWidth={1.4} />
      <circle cx={50} cy={55.5} r={2.6} fill="currentColor" fillOpacity={0.35} strokeWidth={1.2} />
      <ellipse cx={57} cy={55.5} rx={1} ry={6.5} strokeWidth={0.9} strokeOpacity={0.85} />
      <line x1={52.6} y1={55.5} x2={56} y2={55.5} strokeWidth={1} />
      <path d="M41.5 61.8 C37.5 63.5 35 66.5 34 70.5" strokeWidth={1.7} />
      <path d="M58.5 61.8 C62.5 63.5 65 66.5 66 70.5" strokeWidth={1.7} />
      <rect x={29.5} y={70.4} width={9} height={3.2} rx={1.6} fill="currentColor" stroke="none" />
      <rect x={61.5} y={70.4} width={9} height={3.2} rx={1.6} fill="currentColor" stroke="none" />
    </svg>
  );
}

const scale = (value: number) => ((Math.max(-100, Math.min(100, value)) + 100) / 200) * SIZE;

function Gimbal({points, color, label}: {points: {x: number; y: number}[]; color: string; label: string}) {
  const now = points[points.length - 1];
  return (
    <figure className="stick">
      <svg viewBox={`-2 -2 ${SIZE + 4} ${SIZE + 4}`} role="img" aria-label={label}>
        <rect x={0} y={0} width={SIZE} height={SIZE} rx={14} className="stick-gate" />
        <circle cx={SIZE / 2} cy={SIZE / 2} r={SIZE * 0.375} className="stick-ring" />
        <line x1={SIZE / 2} x2={SIZE / 2} y1={6} y2={SIZE - 6} className="stick-cross" />
        <line y1={SIZE / 2} y2={SIZE / 2} x1={6} x2={SIZE - 6} className="stick-cross" />
        {points.slice(1).map((point, index) => (
          <line
            key={index}
            x1={scale(points[index].x)}
            y1={SIZE - scale(points[index].y)}
            x2={scale(point.x)}
            y2={SIZE - scale(point.y)}
            stroke={color}
            strokeWidth={3}
            strokeLinecap="round"
            opacity={((index + 1) / points.length) * 0.7}
          />
        ))}
        {now && (
          <>
            <line x1={SIZE / 2} y1={SIZE / 2} x2={scale(now.x)} y2={SIZE - scale(now.y)} className="stick-shaft" />
            <circle cx={scale(now.x)} cy={SIZE - scale(now.y)} r={8} fill={color} className="stick-knob" />
          </>
        )}
      </svg>
      <figcaption>
        <b>{label}</b>
      </figcaption>
    </figure>
  );
}

/** A round top for the current dial just above the flight's peak, in at most six steps of 1, 2, 5, 10, 20 or 50 A. */
function currentScale(peak: number) {
  const step = [1, 2, 5, 10, 20, 50].find(size => Math.ceil(peak / size) <= 6) ?? 100;
  return {step, max: Math.max(1, Math.ceil(peak / step)) * step};
}

/** The battery dial reads like a fuel gauge: empty, half, full. */
const FUEL: Record<number, string> = {0: 'E', 50: '½', 100: 'F'};
const BATTERY_BANDS: DialBand[] = [
  {to: 20, tone: 'warning'},
  {to: 40, tone: 'caution'},
  {to: 100, tone: 'good'},
];

/**
 * The flight played back: the two sticks moving as they did, from the radio's log (mode 2: throttle and rudder on the
 * left, elevator and aileron on the right), with a short trail. Between samples the sticks move in a straight line, so
 * a log taken once a second still plays smoothly. The time is shared with the charts, which show it as a cursor.
 */
export function StickReplay({
  series,
  pack = {},
  packs = [],
  onTime,
}: {
  series: TelemetrySeries;
  pack?: {cells?: number; capacity?: number};
  /** The pack sizes the heli flies (mAh): the log does not say which one this flight used, so it can be picked. */
  packs?: number[];
  onTime: (second: number | null) => void;
}) {
  const {time, channels} = series;
  // The log's own times: a log cut to its flight starts after 0.
  const start = time[0] ?? 0;
  const end = time[time.length - 1] ?? 0;
  const [second, setSecond] = useState(start);
  // Upside down: a badge while the replay is inside one of these.
  const upsideDown = useMemo(() => invertedStretches(series), [series]);
  // The current dial ends just past the flight's highest draw, which a bug marks.
  const peakCurrent = useMemo(() => Math.max(0, ...(series.channels.current ?? [0])), [series]);
  const amps = currentScale(peakCurrent);
  const used = useMemo(() => usedMah(series), [series]);
  const [capacity, setCapacity] = useState(pack.capacity);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2);
  const report = useRef(onTime);
  report.current = onTime;
  // The moment as the animation loop reads it, between renders.
  const moment = useRef(start);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let before = performance.now();
    const step = (now: number) => {
      const elapsed = (now - before) / 1000;
      before = now;
      const next = Math.min(end, moment.current + elapsed * speed);
      moment.current = next;
      setSecond(next);
      // Every frame: the charts move their cursor in CSS, without drawing again.
      report.current(next);
      if (next >= end) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, end]);

  if (!channels.aileron?.length || !channels.elevator?.length || end <= 0) return null;

  const at = (channel: keyof typeof channels, when: number) => sampleAt(time, channels[channel], when) ?? 0;
  const trail = (x: keyof typeof channels, y: keyof typeof channels, throttle = false) => {
    const points = [];
    for (let past = Math.max(start, second - TRAIL); past <= second + 0.001; past += 0.1) {
      points.push({x: at(x, past), y: throttle ? at(y, past) * 2 - 100 : at(y, past)});
    }
    return points;
  };
  const hasLeft = Boolean(channels.rudder?.length && channels.throttle?.length);
  const battery = batteryAt(series, used, second, {...pack, capacity});
  const spent = used ? sampleAt(time, used, second) : null;
  const inverted = upsideDown.some(stretch => second >= stretch.start && second <= stretch.start + stretch.seconds);
  // The heli seen from behind: rolled by the aileron, tilted by the elevator, turned by the rudder, on its back when
  // inverted (a perspective, so a tilt shows).
  const roll = at('aileron', second) * ROLL;
  const tilt = at('elevator', second) * TILT;
  const turn = channels.rudder?.length ? at('rudder', second) * TURN : 0;
  const attitude = `perspective(360px) rotateZ(${(inverted ? 180 : 0) + roll}deg) rotateX(${tilt}deg) rotateY(${turn}deg)`;
  const readout = [
    channels.voltage?.length && `${formatNumber(at('voltage', second), 2)} V`,
    spent !== null && `${formatNumber(spent)} mAh used`,
  ].filter(Boolean);

  const seek = (to: number) => {
    moment.current = to;
    setSecond(to);
    onTime(to);
  };

  return (
    <div className="stick-replay">
      <div className="stick-pair">
        {hasLeft && <Gimbal points={trail('rudder', 'throttle', true)} color="#ffb020" label="Left stick" />}
        <Gimbal points={trail('aileron', 'elevator')} color="#49cfe6" label="Right stick" />
        <div className="dial-row">
          {channels.throttle?.length ? (
            <figure className="stick dial">
              <Dial
                value={at('throttle', second)}
                max={100}
                step={20}
                color="#e8eef5"
                readout={`${formatNumber(at('throttle', second))} %`}
                label="Throttle"
              />
              <figcaption>
                <b>Throttle</b>
              </figcaption>
            </figure>
          ) : null}
          {channels.current?.length ? (
            <figure className="stick dial">
              <Dial
                value={at('current', second)}
                max={amps.max}
                step={amps.step}
                color="#ffb020"
                readout={`${formatNumber(at('current', second), 1)} A`}
                label="Current"
                bug={peakCurrent}
              />
              <figcaption>
                <b>Current</b>
                <span>peak {formatNumber(peakCurrent, 1)} A</span>
              </figcaption>
            </figure>
          ) : null}
          {battery && (
            <figure className="stick dial">
              <Dial
                value={battery.left}
                max={100}
                step={25}
                color={battery.left < 20 ? '#ff6b6b' : battery.left < 40 ? '#ffb35c' : '#7cffb2'}
                readout={`${formatNumber(battery.left)} %`}
                label="Battery"
                number={at => FUEL[at] ?? null}
                bands={BATTERY_BANDS}
              />
              <figcaption>
                <b>Battery</b>
                <span>
                  {battery.source === 'capacity' ? `${formatNumber(battery.mahLeft ?? 0)} mAh left` : 'from voltage'}
                </span>
              </figcaption>
            </figure>
          )}
          <figure className="stick attitude">
            <div className="attitude-frame" aria-hidden>
              <div className="attitude-heli" style={{transform: attitude, color: inverted ? INVERTED : undefined}}>
                <RearView />
              </div>
            </div>
            <figcaption>
              <b>Attitude</b>
              <span style={inverted ? {color: INVERTED} : undefined}>{inverted ? 'inverted' : 'upright'}</span>
            </figcaption>
          </figure>
        </div>
      </div>
      <div className="replay-controls">
        <button
          type="button"
          className="icon-button"
          aria-label={playing ? 'Pause' : second >= end ? 'Play again' : 'Play'}
          onClick={() => {
            if (!playing && second >= end) seek(start);
            setPlaying(!playing);
          }}
        >
          {playing ? <Pause size={17} /> : second >= end ? <RotateCcw size={17} /> : <Play size={17} />}
        </button>
        <input
          type="range"
          className="replay-scrub"
          min={start}
          max={end}
          step={0.1}
          value={second}
          aria-label="Moment of the flight"
          onChange={event => seek(Number(event.target.value))}
        />
        <span className="replay-time">
          {formatTimer(second)} / {formatTimer(end)}
        </span>
        <div className="segmented" aria-label="Speed">
          {SPEEDS.map(option => (
            <button key={option} type="button" aria-pressed={option === speed} onClick={() => setSpeed(option)}>
              {option}×
            </button>
          ))}
        </div>
      </div>
      <div className="replay-footer">
        {readout.length > 0 && <div className="replay-readout">{readout.join(' · ')}</div>}
        {packs.length > 1 && (
          <div className="segmented keep-case" aria-label="Pack flown">
            {[...packs]
              .sort((left, right) => left - right)
              .map(size => (
                <button key={size} type="button" aria-pressed={size === capacity} onClick={() => setCapacity(size)}>
                  {size} mAh
                </button>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
