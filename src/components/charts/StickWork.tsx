import {useEffect, useMemo, useState} from 'react';
import {Link} from 'react-router';
import type {Battery, Sortie} from '../../types';
import {useStore} from '../../data/store';
import {flyingStats, type FlyingStats} from '../../model/flying';
import {buttonBattery, groupPacks, kindName} from '../../model/packs';
import {formatAirtime, formatDay, formatNumber, formatTimer, plural} from '../../model/format';
import {RAMP_DARK} from '../../model/palette';

/** A logged sortie, its logs' flying added up. */
export interface FlownSortie {
  sortie: Sortie;
  packs: number;
  stats: FlyingStats;
  /** Each log's stats with the kind of pack its button names, for the current a pack draws. */
  logs: {stats: FlyingStats; battery?: Battery}[];
}

/** Adds one log's stats to a sortie's. */
function addStats(sum: FlyingStats, one: FlyingStats): FlyingStats {
  const travelled = (stats: FlyingStats) => (stats.travel === null ? 0 : stats.flying);
  const weight = travelled(sum) + travelled(one);
  return {
    flying: sum.flying + one.flying,
    rescues: sum.rescues + one.rescues,
    level: sum.level + one.level,
    practice: sum.practice === null && one.practice === null ? null : (sum.practice ?? 0) + (one.practice ?? 0),
    idleUps: sum.idleUps.map((seconds, index) => seconds + one.idleUps[index]) as FlyingStats['idleUps'],
    amps: [null, null, null],
    travel: weight ? ((sum.travel ?? 0) * travelled(sum) + (one.travel ?? 0) * travelled(one)) / weight : null,
  };
}

const none = (): FlyingStats => ({
  flying: 0,
  rescues: 0,
  level: 0,
  practice: null,
  idleUps: [0, 0, 0],
  amps: [null, null, null],
  travel: null,
});

/** The logged sorties of those given, each with what its logs say of how it was flown; null while reading them. */
export function useFlyingStats(sorties: Sortie[]): FlownSortie[] | null {
  const {doc, loadSeries} = useStore();
  const logged = useMemo(() => sorties.filter(sortie => sortie.telemetry.length > 0), [sorties]);
  const [flown, setFlown] = useState<FlownSortie[] | null>(null);
  useEffect(() => {
    let current = true;
    setFlown(null);
    const load = async () => {
      const found: FlownSortie[] = [];
      for (const sortie of logged) {
        const logs: FlownSortie['logs'] = [];
        for (const log of sortie.telemetry) {
          const series = await loadSeries(log.id).catch(() => null);
          const day = log.start?.slice(0, 10) ?? sortie.date;
          const stats = series && flyingStats(series, day);
          if (!stats) continue;
          const battery = log.packButton ? buttonBattery(log.packButton, doc.batteries, day)?.battery : undefined;
          logs.push({stats, battery});
        }
        if (!logs.length) continue;
        const packs = groupPacks(sortie.telemetry).length;
        found.push({sortie, packs, logs, stats: logs.reduce((sum, log) => addStats(sum, log.stats), none())});
      }
      if (current) setFlown(found);
    };
    void load();
    return () => {
      current = false;
    };
  }, [logged, loadSeries, doc.batteries]);
  return flown;
}

/** The idle ups, IU1 to IU3, darker to lighter as the head speed climbs. */
const IDLE_UPS = [
  {label: 'IU1', color: RAMP_DARK[1]},
  {label: 'IU2', color: RAMP_DARK[3]},
  {label: 'IU3', color: RAMP_DARK[4]},
];

/** Seconds as "1:05" under an hour, else as airtime. */
const duration = (seconds: number) => (seconds < 3600 ? formatTimer(Math.round(seconds)) : formatAirtime(seconds));

/** A sortie's time in each idle up as one bar, split three ways. */
function IdleUpBar({idleUps}: {idleUps: FlyingStats['idleUps']}) {
  const total = idleUps.reduce((sum, seconds) => sum + seconds, 0);
  return (
    <div
      className="split-bar"
      role="img"
      aria-label={IDLE_UPS.map(
        (one, index) => `${one.label} ${Math.round((idleUps[index] / (total || 1)) * 100)} %`,
      ).join(', ')}
    >
      {IDLE_UPS.map((one, index) =>
        idleUps[index] > 0 ? (
          <span
            key={one.label}
            style={{flexGrow: idleUps[index], background: one.color}}
            title={`${one.label}: ${duration(idleUps[index])}`}
          />
        ) : null,
      )}
    </div>
  );
}

/** What the logs say of the hands on the sticks: rescues, self-level, practice rates, idle ups, cyclic work. */
export function StickWork({flown}: {flown: FlownSortie[] | null}) {
  if (!flown) return <div className="muted">Reading the logs…</div>;
  if (!flown.length) return <div className="muted">No radio log in this period: this is read from the logs.</div>;
  const all = flown.reduce((sum, one) => addStats(sum, one.stats), none());
  const packs = flown.reduce((sum, one) => sum + one.packs, 0);
  const rows = [...flown].reverse().slice(0, 8);
  return (
    <>
      <div className="figures">
        <div>
          <div className="figure-label">Rescues</div>
          <div className="figure-value">{all.rescues}</div>
          <div className="figure-note">
            {all.rescues
              ? `once every ${formatTimer(Math.round(all.flying / all.rescues))} in the air`
              : `in ${plural(packs, 'pack')}`}
          </div>
        </div>
        <div>
          <div className="figure-label">Self-level</div>
          <div className="figure-value">{duration(all.level)}</div>
          <div className="figure-note">{Math.round((all.level / (all.flying || 1)) * 100)} % of the time</div>
        </div>
        {all.practice !== null && (
          <div>
            <div className="figure-label">Practice rates</div>
            <div className="figure-value">{duration(all.practice)}</div>
            <div className="figure-note">{Math.round((all.practice / (all.flying || 1)) * 100)} % of the time</div>
          </div>
        )}
        {all.travel !== null && (
          <div>
            <div className="figure-label">Cyclic work</div>
            <div className="figure-value">{Math.round(all.travel)} %/s</div>
            <div className="figure-note">stick moved a second</div>
          </div>
        )}
      </div>
      <div className="split-legend" aria-hidden>
        {IDLE_UPS.map(one => (
          <span key={one.label}>
            <i style={{background: one.color}} /> {one.label}
          </span>
        ))}
      </div>
      <div className="stick-rows">
        <div className="stick-row head">
          <span>Sortie</span>
          <span>Air</span>
          <span>Rescues</span>
          <span>Idle ups</span>
          <span>Cyclic</span>
        </div>
        {rows.map(({sortie, packs: count, stats}) => (
          <Link key={sortie.id} to={`/sorties/${sortie.id}`} className="stick-row">
            <span className="name">
              {formatDay(sortie.date, {weekday: false, year: true})}{' '}
              <small className="muted">{plural(count, 'pack')}</small>
            </span>
            <span className="tabular">{duration(stats.flying)}</span>
            <span className="tabular">{stats.rescues || <span className="muted">0</span>}</span>
            <IdleUpBar idleUps={stats.idleUps} />
            <span className="tabular">
              {stats.travel === null ? <span className="muted">?</span> : `${Math.round(stats.travel)} %/s`}
            </span>
          </Link>
        ))}
      </div>
      <p className="caption">
        Rescue: SH pulled with the motor on. Cyclic work: how far the aileron and elevator sticks moved a second, from
        logs at 5 samples a second; calmer hands read lower, flips and rolls read higher.
      </p>
    </>
  );
}

/** Minutes a full pack gives before 80 % of it is used, at a current. */
const minutesAt = (capacity: number, amps: number) => (capacity * 0.8 * 60) / (amps * 1000);

/** The current each idle up draws, over every log, and how long a pack of each kind flown lasts at it. */
export function IdleUpDraw({flown}: {flown: FlownSortie[] | null}) {
  if (!flown) return <div className="muted">Reading the logs…</div>;
  const logs = flown.flatMap(one => one.logs);
  const draw = IDLE_UPS.map((one, index) => {
    const timed = logs.filter(log => log.stats.amps[index] !== null && log.stats.idleUps[index] > 0);
    const seconds = timed.reduce((sum, log) => sum + log.stats.idleUps[index], 0);
    const amps = seconds
      ? timed.reduce((sum, log) => sum + (log.stats.amps[index] ?? 0) * log.stats.idleUps[index], 0) / seconds
      : null;
    const share = logs.reduce((sum, log) => sum + log.stats.idleUps[index], 0);
    return {...one, amps, share};
  });
  const flying = draw.reduce((sum, one) => sum + one.share, 0);
  const kinds = [...new Map(logs.flatMap(log => (log.battery ? [[log.battery.id, log.battery]] : []))).values()];
  if (!draw.some(one => one.amps !== null)) {
    return <div className="muted">No log with the current in this period.</div>;
  }
  const columns = {['--columns' as string]: `minmax(0, 1fr) auto auto ${kinds.map(() => 'auto').join(' ')}`};
  return (
    <>
      <div className="heli-table" style={columns}>
        <div className="heli-table-row head">
          <span>Idle up</span>
          <span>Time</span>
          <span>Draw</span>
          {kinds.map(kind => (
            <span key={kind.id} title={kind.name}>
              {kindName(kind.name)} {formatNumber(kind.capacity)}
            </span>
          ))}
        </div>
        {draw.map(one => (
          <div key={one.label} className="heli-table-row">
            <span className="name">
              <i className="swatch" style={{background: one.color}} aria-hidden /> {one.label}
            </span>
            <span className="muted tabular">{Math.round((one.share / (flying || 1)) * 100)} %</span>
            <span className="tabular">{one.amps === null ? '?' : `${formatNumber(one.amps, 1)} A`}</span>
            {kinds.map(kind => (
              <span key={kind.id} className="tabular">
                {one.amps === null ? '?' : formatTimer(Math.round(minutesAt(kind.capacity, one.amps) * 60))}
              </span>
            ))}
          </div>
        ))}
      </div>
      <p className="caption">
        The mean current in each idle up, the share of the time flown in it, and how long a full pack of each kind lasts
        at that current before 80 % of it is used (landing with 20 % left).
      </p>
    </>
  );
}
