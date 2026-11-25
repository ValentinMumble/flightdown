import {useMemo} from 'react';
import type {Sortie} from '../types';
import {Link} from 'react-router';
import {ChevronRight} from 'lucide-react';
import {useStore} from '../data/store';
import {Empty, Figure, PageHeader, useOverlay} from '../components/ui';
import {FlightStrip} from '../components/SortieRow';
import {MinuteMeter, Panel, Rotor, RotorMark, SegmentBar, Stamp, Tape} from '../components/instruments';
import {SortieForm} from '../components/forms/SortieForm';
import {VisitorBanner} from '../components/VisitorBanner';
import {FlyingWeather} from '../components/FlyingWeather';
import {LastSession} from '../components/LastSession';
import {RadioChanges} from '../components/RadioChanges';
import {useSeriesColor} from '../components/colors';
import {ago, formatAirtime, formatDay, formatMonth, formatNumber, formatRate, plural} from '../model/format';
import {daysSinceCrash, groupBy, monthOf, packsSinceCrash, sortSorties, streaks, totals} from '../model/stats';
import {SHOW_SPARES, spareStock} from '../model/parts';
import {nextPacks, packRecords, packWear, STORAGE_DAYS} from '../model/packs';
import {HeliPhoto} from '../components/HeliPhoto';

/**
 * The cockpit: the instruments a pilot glances at before going out to fly: the airtime and the crash gauges, the last
 * sorties beside the helis ready to fly, the last session at a glance beside the flying weather, then the packs beside
 * what changed on the radio (Debrief keeps the skills and the months).
 */
export function Home() {
  const {doc} = useStore();
  const {open} = useOverlay();
  const color = useSeriesColor();
  const sorties = useMemo(() => sortSorties(doc.sorties), [doc.sorties]);
  const all = useMemo(() => totals(sorties), [sorties]);
  const recent = useMemo(() => totals(sorties.slice(-20)), [sorties]);
  const runs = useMemo(() => streaks(sorties), [sorties]);
  const tallies = useMemo(
    () => new Map(groupBy(sorties, sortie => sortie.heliId).map(group => [group.key, group])),
    [sorties],
  );
  const flightLine = doc.helis.filter(heli => heli.status === 'active' || heli.status === 'grounded');
  const last = sorties[sorties.length - 1];
  const best = runs.longestCrashFree?.packs ?? 0;
  const newest = [...sorties].reverse().slice(0, 5);
  // The newest sorties by month, the latest month first.
  const newestByMonth: {month: string; sorties: Sortie[]}[] = [];
  for (const sortie of newest) {
    const month = monthOf(sortie.date);
    const latest = newestByMonth[newestByMonth.length - 1];
    if (latest?.month === month) latest.sorties.push(sortie);
    else newestByMonth.push({month, sorties: [sortie]});
  }
  // The packs that fly the flight line, the live ones by their buttons: how often, how lately, how worn.
  const lineIds = new Set(flightLine.map(heli => heli.id));
  const lineBatteries = doc.batteries.filter(battery => battery.heliIds.some(id => lineIds.has(id)));
  const records = packRecords(sorties, lineBatteries);
  const rack = records
    .filter(record => !record.pack.dead)
    .sort((left, right) => (left.pack.button ?? 7) - (right.pack.button ?? 7) || left.label.localeCompare(right.label));
  const deadPacks = records.length - rack.length;
  // The packs to take on the next sortie (as many as the last sorties flew), and those to put at storage charge.
  const picks = nextPacks(records);
  const usual = Math.max(
    1,
    Math.round(
      sorties.slice(-5).reduce((sum, sortie) => sum + sortie.packs, 0) / Math.max(1, Math.min(5, sorties.length)),
    ),
  );
  const takeNext = picks.next.slice(0, usual);
  const toStore = new Set(picks.storage.map(({record}) => record));
  // The freshest pack flown: the lowest latest resistance, what the others compare to.
  const freshest = Math.min(...rack.flatMap(record => (record.latest === undefined ? [] : [record.latest])));
  const logSortie = () => open(<SortieForm />);
  const ppc = all.packsPerCrash;
  const sinceCrash = daysSinceCrash(sorties);
  const lastCrash = [...sorties].reverse().find(sortie => sortie.crashes);
  const heliName = (id: string) => doc.helis.find(heli => heli.id === id)?.name ?? 'a heli';
  const tone = ppc === null ? 'good' : ppc < 2 ? 'warning' : ppc < 5 ? 'caution' : 'good';

  return (
    <div className="page">
      <PageHeader
        title="Cockpit"
        menuNamed
        phone={{title: 'Flightdown', icon: <RotorMark size={20} className="accent-mark" />}}
      />
      <VisitorBanner />

      <div className="bento">
        <Panel
          label="Airtime"
          note={
            sorties.length
              ? `Every minute in the air since ${formatDay(sorties[0].date, {weekday: false, year: true})}`
              : 'Every minute in the air'
          }
          className="span-5 hobbs-panel"
        >
          <div className="hobbs-row">
            <Rotor />
            <span className="meter-stack">
              <MinuteMeter seconds={all.airtime} />
              <span className="meter-hours">{formatAirtime(all.airtime, true)}</span>
            </span>
          </div>
          <div className="figures">
            <Figure label="Sorties">{all.sorties}</Figure>
            <Figure label="Packs">{all.packs}</Figure>
            <Figure label="Flying days">{all.flyingDays}</Figure>
            <Figure label="Helis">{tallies.size}</Figure>
          </div>
        </Panel>

        <Panel label="Packs per crash" note="Higher is better" className="span-4">
          <div className={`readout ${tone}`}>{formatRate(ppc)}</div>
          <Tape
            value={ppc}
            max={10}
            bug={recent.packsPerCrash}
            label={`${formatRate(ppc)} packs per crash, ${formatRate(recent.packsPerCrash)} over the last 20 sorties`}
          />
          <div className="gauge-legend">
            <span>
              <i className="tape-key caret" /> all time
            </span>
            <span>
              <i className="tape-key bug" /> last 20 sorties · {formatRate(recent.packsPerCrash)}
            </span>
          </div>
          {/* The same in time: how long in the air between crashes. */}
          <div className="figures">
            <Figure label="Time / crash">{all.timePerCrash === null ? '–' : formatAirtime(all.timePerCrash)}</Figure>
            <div>
              <div className="figure-label">Last 20 sorties</div>
              <div className="figure-value">
                {recent.timePerCrash === null ? 'no crash' : formatAirtime(recent.timePerCrash)}
              </div>
            </div>
          </div>
        </Panel>

        <Panel
          label="Since the last crash"
          note={
            lastCrash
              ? `${formatDay(lastCrash.date, {weekday: false, year: true})}, on ${heliName(lastCrash.heliId)}`
              : 'No crash yet'
          }
          className="span-3"
        >
          <div className="run-readouts">
            <div>
              <div className="figure-label">packs flown</div>
              <div className={`readout ${runs.crashFreePacks >= best && best > 0 ? 'good' : ''}`}>
                {runs.crashFreePacks}
              </div>
            </div>
            {sinceCrash !== null && (
              <div>
                <div className="figure-label">days</div>
                <div className="readout">{sinceCrash}</div>
              </div>
            )}
          </div>
          <div style={{margin: '16px 0 10px'}}>
            <SegmentBar value={runs.crashFreePacks} best={best} />
          </div>
          <div className="caption">
            Your best: {plural(best, 'pack')} in a row
            {runs.longestCrashFree && `, until ${formatDay(runs.longestCrashFree.to, {weekday: false, year: true})}`}
          </div>
        </Panel>

        {/* The last sorties beside the helis ready to fly, then the last session beside the weather. */}
        <Panel
          label="Last sorties"
          note={last ? `The latest ${ago(last.date)}` : undefined}
          className="span-7"
          action={
            <span className="panel-actions">
              <button className="button small solid" onClick={logSortie}>
                Log a sortie
              </button>
              <Link to="/sorties" className="button small ghost">
                All <ChevronRight size={14} />
              </Link>
            </span>
          }
        >
          {last ? (
            // By month, as on the Sorties page: each month's heading, its strips under it with their weekday and day.
            <div className="strip-board">
              {newestByMonth.map(group => (
                <section key={group.month} className="log-month">
                  <div className="month-head">
                    <h3>{formatMonth(group.month, true)}</h3>
                  </div>
                  <div className="strip-board">
                    {group.sorties.map(sortie => (
                      <FlightStrip key={sortie.id} sortie={sortie} large inMonth />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <Empty>Nothing logged yet.</Empty>
          )}
        </Panel>

        <Panel label="Flight line" note="Helis ready to fly" className="span-5">
          {flightLine.length ? (
            <div className="stack">
              {flightLine.map(heli => {
                const tally = tallies.get(heli.id);
                const own = sorties.filter(sortie => sortie.heliId === heli.id);
                const low = doc.spares.filter(
                  spare => (spare.heliId === heli.id || !spare.heliId) && spareStock(spare, doc.sorties) < spare.min,
                ).length;
                return (
                  <Link
                    key={heli.id}
                    to={`/helis/${heli.id}`}
                    className="flight-line"
                    style={{['--hue' as string]: color(heli.color)}}
                  >
                    <span className="flight-line-photo">{heli.photo ? <HeliPhoto url={heli.photo} /> : '🚁'}</span>
                    <span className="flight-line-info">
                      <span className="heli-name">{heli.name}</span>
                      <Stamp status={heli.status} />
                      <span className="figures">
                        <span>
                          <span className="figure-label">Hours</span>
                          <span className="figure-meter">
                            <MinuteMeter seconds={tally?.airtime ?? 0} small />
                            <span className="figure-value">{formatAirtime(tally?.airtime ?? 0)}</span>
                          </span>
                        </span>
                        <span>
                          <span className="figure-label">Clean packs</span>
                          <span className="figure-value">{packsSinceCrash(own)}</span>
                        </span>
                        <span>
                          <span className="figure-label">Last flown</span>
                          <span className="figure-value">{tally ? ago(tally.last) : '–'}</span>
                        </span>
                      </span>
                      {SHOW_SPARES && low > 0 && <span className="pill caution">{plural(low, 'spare')} to buy</span>}
                    </span>
                  </Link>
                );
              })}
            </div>
          ) : (
            <Empty>No heli on the flight line. Set one to flying in the hangar.</Empty>
          )}
        </Panel>

        <LastSession className="span-7" />

        <FlyingWeather className="span-5" />

        {/* The packs beside what changed on the radio since the last flight. */}
        <Panel
          label="Packs"
          note={`The live ones by their buttons, their resistance a cell's share against their first reading and the freshest pack's; the next to take, most rested first, and those unflown ${STORAGE_DAYS} days to put at storage charge${deadPacks ? `; ${plural(deadPacks, 'dead pack')} left out` : ''}`}
          className="span-7"
          action={
            <Link to="/hangar/batteries" className="button small ghost">
              Hangar <ChevronRight size={14} />
            </Link>
          }
        >
          {rack.length ? (
            <div className="spot-table">
              <div className="spot-row head">
                <span>Pack</span>
                <span>Flights</span>
                <span>Last flown</span>
                <span>Resistance</span>
              </div>
              {rack.map(record => {
                // Twice its own first reading, or twice the freshest pack's, is worn; half again is tiring.
                const change = packWear(record, freshest);
                const nextAt = takeNext.indexOf(record);
                const worn = change !== null && change >= 2;
                const tiring = change !== null && change >= 1.5;
                return (
                  <div key={`${record.battery.id}#${record.pack.number}`} className="spot-row">
                    <span className="name">
                      <span className="name-main">{record.label}</span>
                      <small className="name-note">
                        {record.pack.button ? `button ${record.pack.button}` : 'no button'}
                        {nextAt >= 0 && <span className="pill good rack-next">next {nextAt + 1}</span>}
                        {toStore.has(record) && <span className="pill caution rack-next">storage charge</span>}
                      </small>
                    </span>
                    <span>{record.flights || '–'}</span>
                    <span>{record.last ? ago(record.last) : 'not yet'}</span>
                    <span className="rack-resistance">
                      {record.latest !== undefined ? `${formatNumber(record.latest, 0)} mΩ` : '–'}
                      {tiring && (
                        <span className={`pill ${worn ? 'critical' : 'caution'}`}>{worn ? 'worn' : 'tiring'}</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty>No packs for the flight line yet: add them in the Hangar, a button each.</Empty>
          )}
        </Panel>

        <RadioChanges className="span-5" />
      </div>
    </div>
  );
}
