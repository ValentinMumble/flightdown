import {useMemo, useState} from 'react';
import {Link} from 'react-router';
import {useStore} from '../data/store';
import {Empty, HeliName, PageHeader, Segmented, spotLabel} from '../components/ui';
import {Panel} from '../components/instruments';
import {CrashTrend} from '../components/charts/CrashTrend';
import {PackCurves} from '../components/charts/PackCurves';
import {BarList} from '../components/charts/BarList';
import {DamageMap} from '../components/charts/DamageMap';
import {FleetTimeline} from '../components/charts/FleetTimeline';
import {SeasonRose} from '../components/charts/SeasonRose';
import {SkillLadder} from '../components/charts/SkillLadder';
import {useSeriesColor} from '../components/colors';
import {VisitorBanner} from '../components/VisitorBanner';
import {ago, formatAirtime, formatDay, formatRate, plural} from '../model/format';
import {crashTrend, groupBy, sortSessions, totals} from '../model/stats';
import {CAUSES, crashCauses, milestones, packsPerSession} from '../model/debrief';

/** The debrief: what the log says about the flying, in the terms a heli pilot counts in. */
export function Stats() {
  const {doc, heli, spot} = useStore();
  const color = useSeriesColor();
  const years = useMemo(
    () => [...new Set(doc.sessions.map(session => session.date.slice(0, 4)))].sort().reverse(),
    [doc.sessions],
  );
  const [period, setPeriod] = useState('all');
  const [heliId, setHeliId] = useState('');

  const sessions = useMemo(
    () =>
      sortSessions(doc.sessions).filter(
        session => (period === 'all' || session.date.startsWith(period)) && (!heliId || session.heliId === heliId),
      ),
    [doc.sessions, period, heliId],
  );
  const all = useMemo(() => totals(sessions), [sessions]);
  const trend = useMemo(() => crashTrend(sessions), [sessions]);
  const causes = useMemo(() => crashCauses(sessions), [sessions]);
  const marks = useMemo(() => milestones(sessions), [sessions]);
  const byHeli = useMemo(() => groupBy(sessions, session => session.heliId), [sessions]);
  const bySpot = useMemo(() => groupBy(sessions, session => session.spotId), [sessions]);
  const packs = useMemo(() => packsPerSession(sessions), [sessions]);
  const packsMax = Math.max(...packs.map(count => count.sessions), 1);
  const fleet = heliId ? doc.helis.filter(one => one.id === heliId) : doc.helis;

  return (
    <div className="page">
      <PageHeader title="Debrief" sub="What the log says about your flying" />
      <VisitorBanner />

      <div className="toolbar" style={{justifyContent: 'space-between'}}>
        <Segmented
          label="Period"
          value={period}
          onChange={setPeriod}
          options={[{value: 'all', label: 'All time'}, ...years.map(year => ({value: year, label: year}))]}
        />
        <select className="input" value={heliId} onChange={event => setHeliId(event.target.value)} aria-label="Heli">
          <option value="">Every heli</option>
          {doc.helis.map(one => (
            <option key={one.id} value={one.id}>
              {one.name}
            </option>
          ))}
        </select>
      </div>

      {!sessions.length ? (
        <div className="panel">
          <Empty emoji="📭">No session in this period.</Empty>
        </div>
      ) : (
        <div className="bento">
          <Panel
            label="Learning curve"
            note="Crashes every 10 packs, over the last ten sessions: lower is better"
            className="span-8"
          >
            <CrashTrend points={trend} />
          </Panel>

          <Panel label="Milestones" className="span-4">
            <div className="milestones">
              {marks.next.map(mark => (
                <div key={mark.label} className="milestone-next">
                  <div className="milestone">
                    <b>Next: {mark.label}</b>
                    <span className="when">{mark.toGo}</span>
                  </div>
                  <div className="bar-track">
                    <div className="bar-fill" style={{width: `${(mark.progress ?? 0) * 100}%`}} />
                  </div>
                </div>
              ))}
              {marks.reached.slice(0, 7).map(mark => (
                <div key={mark.label} className="milestone">
                  <span>{mark.label}</span>
                  <span className="when">{mark.date ? formatDay(mark.date, {weekday: false, year: true}) : ''}</span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel
            label="Where it breaks"
            note="Parts replaced, by part of the heli: hover one for the detail"
            className="span-7"
          >
            <DamageMap sessions={sessions} />
          </Panel>

          <Panel
            label="What brings it down"
            note={`From the notes of ${plural(all.crashes, 'crash', 'crashes')}`}
            className="span-5"
          >
            <BarList
              color="var(--warning)"
              items={CAUSES.map(cause => ({cause, tally: causes.causes.get(cause.key)!}))
                .filter(({tally}) => tally.crashes > 0)
                .sort((left, right) => right.tally.crashes - left.tally.crashes)
                .map(({cause, tally}) => ({
                  key: cause.key,
                  label: (
                    <>
                      <span aria-hidden>{cause.icon}</span> {cause.label}
                    </>
                  ),
                  value: tally.crashes,
                  display: plural(tally.crashes, 'crash', 'crashes'),
                }))}
            />
            {causes.silent > 0 && (
              <p className="caption">
                {plural(causes.silent, 'crash', 'crashes')} with no cause in the notes: write one down next time.
              </p>
            )}
          </Panel>

          <Panel
            label="Fleet history"
            note="Each heli from its first session to its last: a dot a session, a red tick a crash"
            className="span-12"
          >
            <FleetTimeline helis={fleet} sessions={doc.sessions} />
          </Panel>

          <Panel
            label="Packs under load"
            note="Every telemetry log: volts a cell through the flight. Packs flown harder sag sooner"
            className="span-12"
          >
            <PackCurves sessions={sessions} />
          </Panel>

          <Panel label="Skill ladder" note="Manoeuvres in the order they are learnt" className="span-4">
            <SkillLadder sessions={sessions} />
          </Panel>

          <Panel label="Flying season" note="Airtime by month of the year" className="span-4">
            <SeasonRose sessions={sessions} />
          </Panel>

          <Panel label="Packs a sortie" note="How many packs a session flies" className="span-4">
            <div className="columns" role="img" aria-label="Sessions by number of packs">
              {packs.map(count => (
                <div
                  key={count.packs}
                  className="column"
                  title={`${plural(count.sessions, 'session')} of ${count.packs}`}
                >
                  <span className="column-value">{count.sessions || ''}</span>
                  <div className="column-bar" style={{height: `${(count.sessions / packsMax) * 100}%`}} />
                  <span className="column-label">{count.packs === 6 ? '6+' : count.packs}</span>
                </div>
              ))}
            </div>
            <p className="caption">
              {formatRate(all.packs / all.sessions)} packs a session on average,{' '}
              {formatAirtime(all.airtime / all.sessions)} in the air.
            </p>
          </Panel>

          <Panel label="Spots" note="Where you fly, and how it goes there" className="span-7">
            <div className="spot-table">
              <div className="spot-row head">
                <span>Spot</span>
                <span>Sessions</span>
                <span>Air</span>
                <span>💥 / 10 packs</span>
              </div>
              {bySpot.map(group => {
                const per10 = group.packs ? (group.crashes / group.packs) * 10 : 0;
                return (
                  <Link
                    key={group.key || 'none'}
                    to={group.key ? `/sessions?spot=${group.key}` : '/sessions'}
                    className="spot-row"
                  >
                    <span className="name">
                      {spotLabel(spot(group.key)) || 'Nowhere written'}
                      <span className="muted" style={{fontWeight: 400}}>
                        {' '}
                        · {ago(group.last)}
                      </span>
                    </span>
                    <span>{group.sessions}</span>
                    <span>{formatAirtime(group.airtime)}</span>
                    <span
                      style={{color: per10 >= 4 ? 'var(--warning)' : per10 >= 2 ? 'var(--caution)' : 'var(--good)'}}
                    >
                      {formatRate(per10)}
                    </span>
                  </Link>
                );
              })}
            </div>
          </Panel>

          <Panel label="Hours by heli" className="span-5">
            <div className="split" role="img" aria-label="Share of airtime by heli">
              {byHeli
                .filter(group => group.airtime > 0)
                .map(group => {
                  const share = group.airtime / all.airtime;
                  return (
                    <div
                      key={group.key}
                      title={`${heli(group.key)?.name}: ${formatAirtime(group.airtime)} (${Math.round(share * 100)} %)`}
                      style={{flex: group.airtime, background: color(heli(group.key)?.color ?? -1)}}
                    >
                      {share > 0.12 ? `${Math.round(share * 100)}%` : ''}
                    </div>
                  );
                })}
            </div>
            <div className="heli-table">
              {byHeli.map(group => (
                <Link key={group.key} to={`/helis/${group.key}`} className="heli-table-row">
                  <span className="name">
                    <HeliName heli={heli(group.key)} />
                  </span>
                  <span className="tabular">{formatAirtime(group.airtime)}</span>
                  <span className="muted tabular">{plural(group.packs, 'pack')}</span>
                  <span className="muted tabular">💥 {group.crashes}</span>
                </Link>
              ))}
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
