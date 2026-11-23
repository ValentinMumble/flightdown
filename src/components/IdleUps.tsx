import {useMemo, useState, type PointerEvent} from 'react';
import type {CardModel} from '../radio/card';
import {idleUpCurves, pitchRange, STICKS, valueAt} from '../radio/idleUps';
import {switchRole} from '../radio/roles';
import {useChartInk, useSeriesColor} from './colors';
import {Panel} from './instruments';

/** Where the radio is now: the collective stick (%), the idle up on SE (1 to 3) and the practice rates (SG down). */
export interface IdleUpsNow {
  stick: number;
  idleUp: number;
  practice: boolean;
}

interface Series {
  name: string;
  color: string;
  values: number[];
  dashed?: boolean;
}

const WIDTH = 320;
const HEIGHT = 200;
const PLOT = {left: 36, right: 10, top: 10, bottom: 26};
const across = (stick: number) => PLOT.left + ((stick + 100) / 200) * (WIDTH - PLOT.left - PLOT.right);
const signed = (value: number) => `${value > 0 ? '+' : ''}${Math.round(value)}`;

/**
 * One chart: what the channel gives (up) across the collective stick (bottom to top), a line an idle up, the practice
 * rates dashed; a line and dots where the stick is (`probe`). Pointing at it moves the probe (`onProbe`).
 */
function Chart({
  title,
  low,
  high,
  ticks,
  series,
  probe,
  onProbe,
}: {
  title: string;
  low: number;
  high: number;
  ticks: number[];
  series: Series[];
  probe: number;
  onProbe: (stick: number | null) => void;
}) {
  const ink = useChartInk();
  const up = (value: number) =>
    HEIGHT - PLOT.bottom - ((value - low) / (high - low)) * (HEIGHT - PLOT.top - PLOT.bottom);
  const point = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * WIDTH;
    const stick = ((x - PLOT.left) / (WIDTH - PLOT.left - PLOT.right)) * 200 - 100;
    onProbe(Math.round(Math.max(-100, Math.min(100, stick))));
  };
  return (
    <figure className="idle-chart">
      <figcaption>{title}</figcaption>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`${title} across the collective stick, an idle up a line`}
        onPointerMove={point}
        onPointerDown={point}
        onPointerLeave={() => onProbe(null)}
      >
        {ticks.map(tick => (
          <g key={tick}>
            <line
              x1={PLOT.left}
              x2={WIDTH - PLOT.right}
              y1={up(tick)}
              y2={up(tick)}
              stroke={tick === 0 ? ink.axis : ink.grid}
            />
            <text x={PLOT.left - 6} y={up(tick) + 3.5} textAnchor="end" className="idle-tick" fill={ink.muted}>
              {tick}
            </text>
          </g>
        ))}
        {[-100, -50, 0, 50, 100].map(stick => (
          <g key={stick}>
            <line x1={across(stick)} x2={across(stick)} y1={PLOT.top} y2={HEIGHT - PLOT.bottom} stroke={ink.grid} />
            <text
              x={across(stick)}
              y={HEIGHT - PLOT.bottom + 14}
              textAnchor="middle"
              className="idle-tick"
              fill={ink.muted}
            >
              {stick === -100 ? 'bottom' : stick === 100 ? 'top' : stick === 0 ? 'mid' : stick}
            </text>
          </g>
        ))}
        {series.map(line => (
          <polyline
            key={line.name + (line.dashed ? ' practice' : '')}
            points={STICKS.map((stick, index) => `${across(stick)},${up(line.values[index])}`).join(' ')}
            fill="none"
            stroke={line.color}
            strokeWidth={2}
            strokeDasharray={line.dashed ? '5 4' : undefined}
            strokeLinejoin="round"
          />
        ))}
        <line x1={across(probe)} x2={across(probe)} y1={PLOT.top} y2={HEIGHT - PLOT.bottom} stroke={ink.axis} />
        {series.map(line => (
          <circle
            key={line.name + (line.dashed ? ' practice' : '') + ' dot'}
            cx={across(probe)}
            cy={up(valueAt(line.values, probe))}
            r={3.5}
            fill={line.color}
            stroke={ink.surface}
            strokeWidth={2}
          />
        ))}
      </svg>
    </figure>
  );
}

/**
 * The model's idle ups side by side, as its own mixer makes them from the card: the throttle and the pitch across the
 * collective stick in each, the practice rates (SG down) dashed where they change the pitch, and the values that tell
 * them apart. Pointing at a chart reads every curve at that stick; otherwise it reads them where the radio's stick is.
 */
export function IdleUps({model, now}: {model: CardModel; now?: IdleUpsNow}) {
  const color = useSeriesColor();
  const curves = useMemo(() => idleUpCurves(model), [model]);
  const range = useMemo(() => pitchRange(model), [model]);
  const [pointed, setPointed] = useState<number | null>(null);
  const probe = pointed ?? now?.stick ?? 0;

  const role = switchRole(model.name, 'SE');
  const names = [role?.up?.[0], role?.middle?.[0], role?.down?.[0]].map(
    (name, index) => name ?? `Idle up ${index + 1}`,
  );
  // Practice rates drawn only where they change the pitch (Low RPM keeps its own curve).
  const differs = (left: number[], right: number[]) =>
    left.some((value, index) => Math.abs(value - right[index]) > 0.5);
  const throttle: Series[] = curves.map(curve => ({
    name: names[curve.idleUp - 1],
    color: color(curve.idleUp - 1),
    values: curve.throttle,
  }));
  const pitch: Series[] = curves.flatMap(curve => {
    const line = {name: names[curve.idleUp - 1], color: color(curve.idleUp - 1), values: curve.pitch};
    return differs(curve.pitch, curve.practice) ? [line, {...line, values: curve.practice, dashed: true}] : [line];
  });

  const ends = (values: number[]) => [values[0], valueAt(values, 0), values[values.length - 1]];
  const pitchText = (values: number[]) => `${ends(values).map(signed).join(' · ')} %`;
  const degrees = (values: number[]) =>
    range === null
      ? ''
      : `${signed((values[0] * range) / 100)}° to ${signed((values[values.length - 1] * range) / 100)}°`;
  const throttleText = (values: number[]) => {
    const middle = Math.round(valueAt(values, 0));
    const edge = Math.round(Math.max(values[0], values[values.length - 1]));
    return edge === middle ? `${middle} %` : `${middle} %, ${edge} at the ends`;
  };

  return (
    <Panel
      label="Idle ups"
      note="Throttle and pitch across the collective stick, as the model's own mixer makes them from the card"
      className="idle-ups"
    >
      <div className="idle-legend" aria-label="Legend">
        {curves.map(curve => (
          <span key={curve.idleUp} className={now?.idleUp === curve.idleUp ? 'idle-legend-now' : undefined}>
            <i style={{background: color(curve.idleUp - 1)}} /> {names[curve.idleUp - 1]}
          </span>
        ))}
        {pitch.some(line => line.dashed) && (
          <span>
            <i className="idle-dashed" /> Practice rates (SG down)
          </span>
        )}
      </div>
      <div className="idle-charts">
        <Chart
          title="Throttle (CH3), %"
          low={0}
          high={100}
          ticks={[0, 25, 50, 75, 100]}
          series={throttle}
          probe={probe}
          onProbe={setPointed}
        />
        <Chart
          title={`Pitch (CH6), %${range === null ? '' : ` (100 % = ${range}°)`}`}
          low={-100}
          high={100}
          ticks={[-100, -50, 0, 50, 100]}
          series={pitch}
          probe={probe}
          onProbe={setPointed}
        />
      </div>
      <div className="idle-table" role="table" aria-label="Each idle up's values">
        <div className="idle-row idle-head" role="row">
          <span role="columnheader">Idle up</span>
          <span role="columnheader">Throttle</span>
          <span role="columnheader">Pitch: bottom · mid · top</span>
          <span role="columnheader">Practice pitch (SG down)</span>
          <span role="columnheader">At {signed(probe)} % stick</span>
        </div>
        {curves.map(curve => {
          const practice = differs(curve.pitch, curve.practice);
          const flown = now?.practice && practice ? curve.practice : curve.pitch;
          return (
            <div key={curve.idleUp} className={`idle-row${now?.idleUp === curve.idleUp ? ' idle-now' : ''}`} role="row">
              <span role="cell" className="idle-name">
                <i style={{background: color(curve.idleUp - 1)}} />
                {names[curve.idleUp - 1]}
              </span>
              <span role="cell" className="tabular" data-label="Throttle">
                {throttleText(curve.throttle)}
              </span>
              <span role="cell" className="tabular" data-label="Pitch">
                {pitchText(curve.pitch)}
                {range !== null && <span className="muted"> ({degrees(curve.pitch)})</span>}
              </span>
              <span role="cell" className="tabular" data-label="Practice">
                {practice ? pitchText(curve.practice) : <span className="muted">its own curve, unchanged</span>}
              </span>
              <span role="cell" className="tabular" data-label={`At ${signed(probe)} %`}>
                {Math.round(valueAt(curve.throttle, probe))} % · {signed(valueAt(flown, probe))} % pitch
              </span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
