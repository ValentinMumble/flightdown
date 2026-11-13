import type {GroupTally} from '../../model/stats';
import type {Heli} from '../../types';
import {formatAirtime} from '../../model/format';
import {useSeriesColor} from '../colors';

/** The helis with a slice of their own, the most flown; the others share one grey slice. */
const SLICES = 5;
const RADIUS = 52;
const WIDTH = 16;
/** The panel's black between two slices, along the ring. */
const GAP = 2;

/**
 * Airtime by heli as a ring: a slice a heli, in its chart colour, the most flown first from the top and round
 * clockwise, the total in the middle. The table under it is its legend.
 */
export function AirtimeDonut({groups, heli}: {groups: GroupTally[]; heli: (id: string) => Heli | undefined}) {
  const color = useSeriesColor();
  const ranked = groups.filter(group => group.airtime > 0).sort((left, right) => right.airtime - left.airtime);
  const total = ranked.reduce((sum, group) => sum + group.airtime, 0);
  if (!total) return null;
  const rest = ranked.slice(SLICES);
  const slices = [
    ...ranked.slice(0, SLICES).map(group => ({
      key: group.key,
      name: heli(group.key)?.name ?? 'Unknown heli',
      airtime: group.airtime,
      fill: color(heli(group.key)?.color ?? -1),
    })),
    ...(rest.length
      ? [
          {
            key: 'more',
            name: `${rest.length} more ${rest.length === 1 ? 'heli' : 'helis'}`,
            airtime: rest.reduce((sum, group) => sum + group.airtime, 0),
            fill: color(-1),
          },
        ]
      : []),
  ];
  const around = 2 * Math.PI * RADIUS;
  let start = 0;

  return (
    <svg viewBox="0 0 140 140" className="donut" role="img" aria-label="Share of airtime by heli">
      {slices.map(slice => {
        const length = (slice.airtime / total) * around;
        const offset = start;
        start += length;
        const share = Math.round((slice.airtime / total) * 100);
        const summary = `${slice.name}: ${formatAirtime(slice.airtime)} (${share} %)`;
        return (
          <circle
            key={slice.key}
            className="donut-slice"
            cx={70}
            cy={70}
            r={RADIUS}
            fill="none"
            stroke={slice.fill}
            strokeWidth={WIDTH}
            strokeDasharray={`${Math.max(length - GAP, 0.5)} ${around}`}
            strokeDashoffset={-offset}
            transform="rotate(-90 70 70)"
            tabIndex={0}
            aria-label={summary}
          >
            <title>{summary}</title>
          </circle>
        );
      })}
      <text x={70} y={70} textAnchor="middle" className="donut-total">
        {formatAirtime(total)}
      </text>
      <text x={70} y={86} textAnchor="middle" className="donut-caption">
        in the air
      </text>
    </svg>
  );
}
