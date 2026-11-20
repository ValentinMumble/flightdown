import type {CardCurve} from '../radio/card';
import {curveAt, curveXs} from '../radio/mixer';

/**
 * A mix line's curve as the radio's Curves page draws it: across what goes in, up what comes out (-100 to 100 % both
 * ways), its points joined straight, and a dot where the input is now (`at`, %), when the line is in use.
 */
export function CurveGraph({name, shape, at}: {name: string; shape: CardCurve; at?: number}) {
  const xs = curveXs(shape);
  const across = at === undefined ? null : Math.max(-100, Math.min(100, at));
  const up = across === null ? null : curveAt(shape, across);
  const reading = across === null || up === null ? '' : `: ${Math.round(up)}% out at ${Math.round(across)}% in`;
  return (
    <svg className="logic-curve" viewBox="-108 -108 216 216" role="img" aria-label={`Curve ${name}${reading}`}>
      <rect x={-100} y={-100} width={200} height={200} className="logic-curve-frame" />
      <line x1={-100} y1={0} x2={100} y2={0} className="logic-curve-axis" />
      <line x1={0} y1={-100} x2={0} y2={100} className="logic-curve-axis" />
      <polyline points={xs.map((x, index) => `${x},${-shape.y[index]}`).join(' ')} className="logic-curve-line" />
      {across !== null && up !== null && <circle cx={across} cy={-up} r={9} className="logic-curve-dot" />}
    </svg>
  );
}
