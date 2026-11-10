import {useMemo} from 'react';
import {Link} from 'react-router';
import {ChevronRight, Settings as SettingsIcon} from 'lucide-react';
import {useStore} from '../data/store';
import {Empty, PageHeader, useOverlay} from '../components/ui';
import {FlightStrip} from '../components/SessionRow';
import {MinuteMeter, Panel, Rotor, RotorMark, SegmentBar, Stamp, Tape} from '../components/instruments';
import {SessionForm} from '../components/forms/SessionForm';
import {VisitorBanner} from '../components/VisitorBanner';
import {AirtimeChart} from '../components/charts/AirtimeChart';
import {SkillLadder} from '../components/charts/SkillLadder';
import {useSeriesColor} from '../components/colors';
import {ago, formatAirtime, formatDay, formatRate, plural, today} from '../model/format';
import {daysSinceCrash, groupBy, monthly, packsSinceCrash, sortSessions, streaks, totals} from '../model/stats';
import {spareStock} from '../model/parts';
import {HeliPhoto} from '../components/HeliPhoto';

/** The cockpit: the instruments a pilot glances at before going out to fly. */
export function Home() {
  const {doc} = useStore();
  const {open} = useOverlay();
  const color = useSeriesColor();
  const sessions = useMemo(() => sortSessions(doc.sessions), [doc.sessions]);
  const all = useMemo(() => totals(sessions), [sessions]);
  const recent = useMemo(() => totals(sessions.slice(-20)), [sessions]);
  const runs = useMemo(() => streaks(sessions), [sessions]);
  const months = useMemo(() => monthly(sessions, today().slice(0, 7)).slice(-24), [sessions]);
  const tallies = useMemo(
    () => new Map(groupBy(sessions, session => session.heliId).map(group => [group.key, group])),
    [sessions],
  );
  const flightLine = doc.helis.filter(heli => heli.status === 'active' || heli.status === 'grounded');
  const last = sessions[sessions.length - 1];
  const best = runs.longestCrashFree?.packs ?? 0;
  const newest = [...sessions].reverse();
  const lastThree = newest.slice(0, 3);
  const latest = newest.slice(3, 8);
  const logSession = () => open(<SessionForm />);
  const ppc = all.packsPerCrash;
  const sinceCrash = daysSinceCrash(sessions);
  const tone = ppc === null ? 'good' : ppc < 2 ? 'warning' : ppc < 5 ? 'caution' : 'good';

  return (
    <div className="page">
      <PageHeader
        title="Flightdown"
        sub={sessions.length ? `Flying since ${formatDay(sessions[0].date, {weekday: false, year: true})}` : undefined}
        icon={<RotorMark size={20} className="accent-mark" />}
        actions={
          <Link to="/settings" className="icon-button phone-only" aria-label="Settings">
            <SettingsIcon size={18} />
          </Link>
        }
      />
      <VisitorBanner />

      <div className="bento">
        <Panel label="Airtime" note="Every minute in the air" className="span-5 hobbs-panel">
          <div className="hobbs-row">
            <Rotor />
            <span className="meter-stack">
              <MinuteMeter seconds={all.airtime} />
              <span className="meter-hours">{formatAirtime(all.airtime, true)}</span>
            </span>
          </div>
          <div className="figures">
            <div>
              <div className="figure-label">Sessions</div>
              <div className="figure-value">{all.sessions}</div>
            </div>
            <div>
              <div className="figure-label">Packs</div>
              <div className="figure-value">{all.packs}</div>
            </div>
            <div>
              <div className="figure-label">Flying days</div>
              <div className="figure-value">{all.flyingDays}</div>
            </div>
            <div>
              <div className="figure-label">Helis</div>
              <div className="figure-value">{tallies.size}</div>
            </div>
          </div>
        </Panel>

        <Panel label="Packs per crash" note="Higher is better" className="span-4">
          <div className={`readout ${tone}`}>{formatRate(ppc)}</div>
          <Tape
            value={ppc}
            max={10}
            bug={recent.packsPerCrash}
            label={`${formatRate(ppc)} packs per crash, ${formatRate(recent.packsPerCrash)} over the last 20 sessions`}
          />
          <div className="gauge-legend">
            <span>
              <i className="tape-key caret" /> all time
            </span>
            <span>
              <i className="tape-key bug" /> last 20 sessions · {formatRate(recent.packsPerCrash)}
            </span>
          </div>
        </Panel>

        <Panel label="Crash-free run" note="Since the last crash" className="span-3">
          <div className="run-readouts">
            <div className={`readout ${runs.crashFreePacks >= best && best > 0 ? 'good' : ''}`}>
              {runs.crashFreePacks}
              <small>{runs.crashFreePacks === 1 ? 'pack' : 'packs'}</small>
            </div>
            {sinceCrash !== null && (
              <div className="readout">
                {sinceCrash}
                <small>{sinceCrash === 1 ? 'day' : 'days'}</small>
              </div>
            )}
          </div>
          <div style={{margin: '16px 0 10px'}}>
            <SegmentBar value={runs.crashFreePacks} best={best} />
          </div>
          <div className="caption">
            Best run {plural(best, 'pack')}
            {runs.longestCrashFree && `, to ${formatDay(runs.longestCrashFree.to, {weekday: false, year: true})}`}
          </div>
        </Panel>

        <Panel
          label="Last sorties"
          note={last ? `The latest ${ago(last.date)}` : undefined}
          className="span-7"
          action={
            <button className="button small solid" onClick={logSession}>
              Log the next
            </button>
          }
        >
          {last ? (
            <div className="strip-board">
              {lastThree.map(session => (
                <FlightStrip key={session.id} session={session} large />
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
                const own = sessions.filter(session => session.heliId === heli.id);
                const low = doc.spares.filter(
                  spare => (spare.heliId === heli.id || !spare.heliId) && spareStock(spare, doc.sessions) < spare.min,
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
                          <span className="figure-value">{formatAirtime(tally?.airtime ?? 0)}</span>
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
                      {low > 0 && <span className="pill caution">{plural(low, 'spare')} to buy</span>}
                    </span>
                  </Link>
                );
              })}
            </div>
          ) : (
            <Empty>No heli on the flight line. Set one to flying in the hangar.</Empty>
          )}
        </Panel>

        <Panel label="Airtime" note="The last two years, month by month" className="span-8">
          <AirtimeChart months={months} short />
        </Panel>

        <Panel
          label="Skill ladder"
          className="span-4"
          action={
            <Link to="/stats" className="button small ghost">
              All <ChevronRight size={14} />
            </Link>
          }
        >
          <SkillLadder sessions={sessions} compact />
        </Panel>

        {latest.length > 0 && (
          <Panel
            label="Earlier sorties"
            className="span-12"
            action={
              <Link to="/sessions" className="button small ghost">
                Logbook <ChevronRight size={14} />
              </Link>
            }
          >
            <div className="strip-board">
              {latest.map(session => (
                <FlightStrip key={session.id} session={session} />
              ))}
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}
