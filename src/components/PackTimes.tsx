import type {Battery, Sortie} from '../types';
import {formatTimer} from '../model/format';
import {groupPacks, packName} from '../model/packs';

/** The time upside down, in the chart palette's violet (as the recorder's bands), apart from the air time's green. */
export const INVERTED = '#9085e9';

/** A sortie's packs as its logs flew them: each one's name (from its button), its air time, the part inverted. */
export function packTimes(sortie: Sortie, batteries: Battery[]) {
  return groupPacks(sortie.telemetry).map((pack, index) => ({
    name: packName(pack, batteries) ?? `Pack ${index + 1}`,
    flying: pack.files.reduce((sum, file) => sum + (file.flying ?? 0), 0),
    inverted: pack.files.reduce((sum, file) => sum + (file.inverted ?? 0), 0),
  }));
}

const describe = (pack: ReturnType<typeof packTimes>[number]) =>
  `${pack.name}: ${formatTimer(pack.flying)} in the air` +
  (pack.inverted ? `, ${formatTimer(pack.inverted)} inverted` : '');

/** A bar a pack, its length its time in the air against the longest, the inverted part violet at its end. */
export function PackBars({packs}: {packs: ReturnType<typeof packTimes>}) {
  const longest = Math.max(1, ...packs.map(pack => pack.flying));
  return (
    <div className="pack-bars">
      {packs.map((pack, index) => (
        <div key={index} className="pack-bar-row" aria-label={describe(pack)}>
          <span className="pack-bar-name">{pack.name}</span>
          <span className="pack-bar-track" aria-hidden>
            <span className="pack-bar-fill" style={{width: `${(pack.flying / longest) * 100}%`}}>
              {pack.inverted > 0 && (
                <span
                  className="pack-bar-inverted"
                  style={{
                    width: `${Math.min(100, (pack.inverted / Math.max(1, pack.flying)) * 100)}%`,
                    background: INVERTED,
                  }}
                />
              )}
            </span>
          </span>
          <span className="pack-bar-time tabular">{formatTimer(pack.flying)}</span>
        </div>
      ))}
    </div>
  );
}

/** The share of the time in the air spent upside down, as a ring: the % in its middle, the time under it. */
export function InvertedRing({inverted, air}: {inverted: number; air: number}) {
  const share = air > 0 ? Math.min(1, inverted / air) : 0;
  const radius = 30;
  const around = 2 * Math.PI * radius;
  return (
    <figure className="inverted-ring" aria-label={`${Math.round(share * 100)} % of the time in the air inverted`}>
      <svg viewBox="0 0 76 76" width="76" height="76" aria-hidden>
        <circle cx="38" cy="38" r={radius} fill="none" stroke="var(--accent-soft)" strokeWidth="8" />
        {share > 0 && (
          <circle
            cx="38"
            cy="38"
            r={radius}
            fill="none"
            stroke={INVERTED}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${Math.max(share * around - 4, 1)} ${around}`}
            transform="rotate(-90 38 38)"
          />
        )}
        <text x="38" y="38" textAnchor="middle" dominantBaseline="central" className="inverted-ring-share">
          {Math.round(share * 100)} %
        </text>
      </svg>
      <figcaption>
        <span className="figure-label">Inverted</span>
        <b className="tabular">{formatTimer(inverted)}</b>
      </figcaption>
    </figure>
  );
}
