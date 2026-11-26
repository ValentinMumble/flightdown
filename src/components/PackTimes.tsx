import {Link} from 'react-router';
import type {Battery, Sortie} from '../types';
import {formatTimer} from '../model/format';
import {buttonBattery, packName, sortiePacks} from '../model/packs';
import {addFlips, describeFlips} from '../model/insights';
import {chargeFromCell} from '../model/battery';
import type {PackNote} from '../model/cockpit';

/** The time upside down, in the chart palette's violet (as the recorder's bands), apart from the air time's green. */
export const INVERTED = '#9085e9';

/**
 * A sortie's packs as their logs flew them: each one's name (from its button) and battery, its air time, the part
 * inverted, its flips and rolls, and its volts at rest once landed with the charge they mean.
 */
export function packTimes(sortie: Sortie, batteries: Battery[]) {
  return sortiePacks(sortie).map((pack, index) => {
    const found = buttonBattery(
      pack.packButton ?? 0,
      batteries,
      pack.start?.slice(0, 10) ?? sortie.date,
      sortie.heliId,
    );
    const landed = pack.files.find(file => file.landedVoltage !== undefined)?.landedVoltage;
    const cells = found?.battery.cells;
    return {
      name: packName(pack, batteries, sortie.heliId) ?? `Pack ${index + 1}`,
      batteryId: found?.battery.id,
      flying: pack.files.reduce((sum, file) => sum + (file.flying ?? 0), 0),
      inverted: pack.files.reduce((sum, file) => sum + (file.inverted ?? 0), 0),
      flips: describeFlips(pack.files.reduce((sum, file) => addFlips(sum, file.flips), {})),
      landed: landed === undefined ? null : {volts: landed, charge: cells ? chargeFromCell(landed / cells) : null},
    };
  });
}

type PackTime = ReturnType<typeof packTimes>[number];

const describe = (pack: PackTime) =>
  `${pack.name}: ${formatTimer(pack.flying)} in the air` +
  (pack.inverted ? `, ${formatTimer(pack.inverted)} inverted` : '');

/** A pack's name, a link to its battery's details in the Hangar when it has one. */
export function PackLink({name, batteryId, className}: {name: string; batteryId?: string; className: string}) {
  return batteryId ? (
    <Link to={`/hangar/batteries?battery=${batteryId}`} className={`${className} pack-link`}>
      {name}
    </Link>
  ) : (
    <span className={className}>{name}</span>
  );
}

/**
 * A row a pack: its name, a bar as long as its time in the air against the longest (the inverted part violet at its
 * end) and that time; under it, its flips (when the sortie flew more than one pack), its volts at rest once landed
 * and what its log says of it (`notes`, as pills).
 */
export function PackRows({packs, notes}: {packs: PackTime[]; notes: (PackNote[] | undefined)[]}) {
  const longest = Math.max(1, ...packs.map(pack => pack.flying));
  return (
    <div className="pack-bars">
      {packs.map((pack, index) => {
        const said = notes[index] ?? [];
        const flips = packs.length > 1 ? pack.flips : null;
        return (
          <div key={index} className="pack-row">
            <div className="pack-bar-row" aria-label={describe(pack)}>
              <PackLink className="pack-bar-name" name={pack.name} batteryId={pack.batteryId} />
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
            {(flips || pack.landed || said.length > 0) && (
              <div className="pack-row-notes">
                {flips && <span className="pack-row-flips">{flips}</span>}
                {pack.landed && (
                  <span className="pill label" title="Its volts at rest once landed">
                    landed {pack.landed.volts.toFixed(2)} V
                    {pack.landed.charge !== null && `, ${Math.round(pack.landed.charge)} %`}
                  </span>
                )}
                {said.map(note => (
                  <span key={note.text} className={`pill ${note.tone === 'warning' ? 'critical' : note.tone}`}>
                    {note.text}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
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
