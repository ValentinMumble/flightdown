import {useEffect, useMemo, useRef, useState} from 'react';
import {Pause, Play, RotateCcw} from 'lucide-react';
import type {TelemetrySeries} from '../../types';
import {sampleAt} from '../../model/telemetry';
import {batteryAt, usedMah} from '../../model/battery';
import {formatNumber, formatTimer} from '../../model/format';

const SIZE = 150;
/** The trail behind each stick: this many seconds, a point every tenth of one. */
const TRAIL = 1.5;
const SPEEDS = [1, 2, 4];
/** The charts' cursor follows ten times a second: enough to read, light enough for the charts. */
const CURSOR_EVERY_MS = 100;

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

/**
 * A vertical gauge the height of a gimbal: ticks every quarter, filled from the bottom to the value, the value above.
 * Throttle in white and current in amber, as their traces.
 */
function Gauge({
  value,
  max,
  unit,
  color,
  label,
  detail,
}: {
  value: number;
  max: number;
  unit: string;
  color: string;
  label: string;
  detail?: string;
}) {
  const height = SIZE;
  const share = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  return (
    <figure className="stick gauge-bar">
      <svg viewBox={`-2 -2 48 ${height + 4}`} role="img" aria-label={`${label}: ${formatNumber(value)} ${unit}`}>
        <rect x={0} y={0} width={44} height={height} rx={10} className="stick-gate" />
        {[0.25, 0.5, 0.75].map(tick => (
          <line
            key={tick}
            x1={6}
            x2={14}
            y1={height - tick * height}
            y2={height - tick * height}
            className="stick-cross"
          />
        ))}
        <rect x={18} y={6} width={14} height={height - 12} rx={4} className="gauge-bar-track" />
        <rect
          x={18}
          y={6 + (height - 12) * (1 - share)}
          width={14}
          height={(height - 12) * share}
          rx={4}
          fill={color}
          opacity={0.9}
        />
      </svg>
      <figcaption>
        <b>{label}</b>
        <span className="gauge-bar-value">
          {formatNumber(value, unit === 'A' ? 1 : 0)} {unit}
        </span>
        {detail && <span className="gauge-bar-detail">{detail}</span>}
      </figcaption>
    </figure>
  );
}

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
  const end = time[time.length - 1] ?? 0;
  const [second, setSecond] = useState(0);
  // The current gauge reaches its top at the flight's highest draw.
  const peakCurrent = useMemo(() => Math.max(1, ...(series.channels.current ?? [0])), [series]);
  const used = useMemo(() => usedMah(series), [series]);
  const [capacity, setCapacity] = useState(pack.capacity);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2);
  const reported = useRef(0);
  const report = useRef(onTime);
  report.current = onTime;
  // The moment as the animation loop reads it, between renders.
  const moment = useRef(0);

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
      if (now - reported.current >= CURSOR_EVERY_MS || next >= end) {
        reported.current = now;
        report.current(next);
      }
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
    for (let past = Math.max(0, second - TRAIL); past <= second + 0.001; past += 0.1) {
      points.push({x: at(x, past), y: throttle ? at(y, past) * 2 - 100 : at(y, past)});
    }
    return points;
  };
  const hasLeft = Boolean(channels.rudder?.length && channels.throttle?.length);
  const battery = batteryAt(series, used, second, {...pack, capacity});
  const spent = used ? sampleAt(time, used, second) : null;
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
        {channels.throttle?.length ? (
          <Gauge value={at('throttle', second)} max={100} unit="%" color="#e8eef5" label="Throttle" />
        ) : null}
        {channels.current?.length ? (
          <Gauge value={at('current', second)} max={peakCurrent} unit="A" color="#ffb020" label="Current" />
        ) : null}
        {battery && (
          <Gauge
            value={battery.left}
            max={100}
            unit="%"
            color={battery.left < 20 ? '#ff6b6b' : battery.left < 40 ? '#ffb35c' : '#7cffb2'}
            label="Battery"
            detail={battery.source === 'capacity' ? `${formatNumber(battery.mahLeft ?? 0)} mAh left` : 'from voltage'}
          />
        )}
      </div>
      <div className="replay-controls">
        <button
          type="button"
          className="icon-button"
          aria-label={playing ? 'Pause' : second >= end ? 'Play again' : 'Play'}
          onClick={() => {
            if (!playing && second >= end) seek(0);
            setPlaying(!playing);
          }}
        >
          {playing ? <Pause size={17} /> : second >= end ? <RotateCcw size={17} /> : <Play size={17} />}
        </button>
        <input
          type="range"
          className="replay-scrub"
          min={0}
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
