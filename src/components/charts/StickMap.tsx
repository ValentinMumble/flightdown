import type {TelemetrySeries} from '../../types';
import {formatNumber} from '../../model/format';

const SIZE = 150;

/** Mean deflection from centre, and the share of the time past three quarters of the travel. */
function activity(values: number[]) {
  if (!values.length) return {mean: 0, hard: 0};
  const mean = values.reduce((sum, value) => sum + Math.abs(value), 0) / values.length;
  const hard = values.filter(value => Math.abs(value) > 75).length / values.length;
  return {mean, hard};
}

function Square({
  x,
  y,
  color,
  label,
  xLabel,
  yLabel,
}: {
  x: number[];
  y: number[];
  color: string;
  label: string;
  xLabel: string;
  yLabel: string;
}) {
  const scale = (value: number) => ((Math.max(-100, Math.min(100, value)) + 100) / 200) * SIZE;
  return (
    <figure className="stick">
      <svg viewBox={`-2 -2 ${SIZE + 4} ${SIZE + 4}`} role="img" aria-label={label}>
        <rect x={0} y={0} width={SIZE} height={SIZE} rx={14} className="stick-gate" />
        <circle cx={SIZE / 2} cy={SIZE / 2} r={SIZE * 0.375} className="stick-ring" />
        <line x1={SIZE / 2} x2={SIZE / 2} y1={6} y2={SIZE - 6} className="stick-cross" />
        <line y1={SIZE / 2} y2={SIZE / 2} x1={6} x2={SIZE - 6} className="stick-cross" />
        {x.map((value, index) => (
          <circle key={index} cx={scale(value)} cy={SIZE - scale(y[index])} r={3} fill={color} opacity={0.22} />
        ))}
      </svg>
      <figcaption>
        <b>{label}</b>
        <span>
          {xLabel} across, {yLabel} up
        </span>
      </figcaption>
    </figure>
  );
}

/**
 * Where the sticks spent the flight, a dot a sample, as seen from above the radio (mode 2: throttle and rudder on the
 * left stick, elevator and aileron on the right). Only the samples in flight count.
 */
export function StickMap({series}: {series: TelemetrySeries}) {
  const {aileron, elevator, rudder, throttle, current} = series.channels;
  if (!aileron?.length || !elevator?.length) return null;
  const flying = (index: number) => !current || current[index] >= 2;
  const pick = (values: number[] | undefined) => (values ?? []).filter((_, index) => flying(index));
  const ail = pick(aileron);
  const ele = pick(elevator);
  const rud = pick(rudder);
  // Throttle runs 0 to 100: centred like the other sticks for the drawing.
  const thr = pick(throttle).map(value => value * 2 - 100);
  const cyclic = activity([...ail, ...ele]);
  const tail = activity(rud);

  return (
    <div className="stick-map">
      <div className="stick-pair">
        {rud.length > 0 && thr.length > 0 && (
          <Square x={rud} y={thr} color="#ffb020" label="Left stick" xLabel="rudder" yLabel="throttle" />
        )}
        <Square x={ail} y={ele} color="#49cfe6" label="Right stick" xLabel="aileron" yLabel="elevator" />
      </div>
      <div className="figures">
        <div>
          <div className="figure-label">Cyclic, average</div>
          <div className="figure-value">{formatNumber(cyclic.mean)} %</div>
        </div>
        <div>
          <div className="figure-label">Cyclic past 75 %</div>
          <div className="figure-value">{formatNumber(cyclic.hard * 100)} % of the time</div>
        </div>
        {rud.length > 0 && (
          <div>
            <div className="figure-label">Rudder, average</div>
            <div className="figure-value">{formatNumber(tail.mean)} %</div>
          </div>
        )}
      </div>
    </div>
  );
}
