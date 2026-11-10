import {useMemo} from 'react';
import {Link, useParams} from 'react-router';
import {ChevronRight, Pencil, Plus} from 'lucide-react';
import {useStore} from '../data/store';
import {Empty, PageHeader, useOverlay} from '../components/ui';
import {FlightStrip} from '../components/SessionRow';
import {Panel, Stamp} from '../components/instruments';
import {HeliForm, SpareForm} from '../components/forms/HangarForms';
import {AirtimeChart} from '../components/charts/AirtimeChart';
import {DamageMap} from '../components/charts/DamageMap';
import {useSeriesColor} from '../components/colors';
import {formatAirtime, formatDay, formatRate, formatTimer, plural} from '../model/format';
import {daysSinceCrash, monthly, packsSinceCrash, sortSessions, totals} from '../model/stats';
import {spareStock} from '../model/parts';
import {HeliPhoto} from '../components/HeliPhoto';

/** One heli: its data plate, its months, where it breaks, its spares, its setup and its sorties. */
export function HeliPage() {
  const {id} = useParams();
  const {doc, heli: findHeli} = useStore();
  const {open} = useOverlay();
  const color = useSeriesColor();
  const heli = findHeli(id);
  const sessions = useMemo(
    () => sortSessions(doc.sessions.filter(session => session.heliId === id)),
    [doc.sessions, id],
  );
  const all = useMemo(() => totals(sessions), [sessions]);
  const months = useMemo(() => monthly(sessions), [sessions]);
  const spares = doc.spares.filter(spare => spare.heliId === id || !spare.heliId);
  const tips = doc.tips.filter(tip => tip.heliId === id);

  if (!heli) {
    return (
      <div className="page">
        <PageHeader title="Heli" back="/hangar" />
        <div className="panel">
          <Empty emoji="🤷">This heli is not in the hangar.</Empty>
        </div>
      </div>
    );
  }

  const first = sessions[0];
  const last = sessions[sessions.length - 1];

  return (
    <div className="page">
      <PageHeader
        title={heli.name}
        back="/hangar"
        actions={
          <button className="button" onClick={() => open(<HeliForm heli={heli} />)}>
            <Pencil size={15} /> Edit
          </button>
        }
      />

      <section className="panel data-plate" style={{['--hue' as string]: color(heli.color)}}>
        <div className="data-plate-photo">{heli.photo ? <HeliPhoto url={heli.photo} alt={heli.name} /> : '🚁'}</div>
        <div className="data-plate-info">
          <div>
            <div className="panel-label">Data plate</div>
            <div className="heli-name" style={{fontSize: 30, marginTop: 6}}>
              {heli.name}
            </div>
            <div className="heli-model">
              {[heli.maker, heli.model].filter(Boolean).join(' ') || 'Maker and model not set'}
            </div>
          </div>
          <Stamp status={heli.status} />
          <div className="readout accent">
            {formatAirtime(all.airtime)}
            <small>in the air</small>
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
              <div className="figure-label">Crashes</div>
              <div className="figure-value">{all.crashes}</div>
            </div>
            <div>
              <div className="figure-label">Packs / crash</div>
              <div className="figure-value">{formatRate(all.packsPerCrash)}</div>
            </div>
            <div>
              <div className="figure-label">Clean packs</div>
              <div className="figure-value">{packsSinceCrash(sessions)}</div>
            </div>
            <div>
              <div className="figure-label">Days since a crash</div>
              <div className="figure-value">{daysSinceCrash(sessions) ?? '–'}</div>
            </div>
            <div>
              <div className="figure-label">Pack time</div>
              <div className="figure-value">{heli.timer ? formatTimer(heli.timer) : '–'}</div>
            </div>
          </div>
          <div className="caption">
            {first
              ? `Flown from ${formatDay(first.date, {weekday: false, year: true})} to ${formatDay(last.date, {weekday: false, year: true})}`
              : 'Not flown yet'}
            {heli.battery ? ` · ${heli.battery} packs` : ''}
          </div>
        </div>
      </section>

      <div className="bento">
        <Panel label="Where it breaks" note="Parts replaced on this heli" className="span-7">
          <DamageMap sessions={sessions} />
        </Panel>

        <Panel
          label="Spares"
          className="span-5"
          action={
            <button className="button small" onClick={() => open(<SpareForm heliId={heli.id} />)}>
              <Plus size={14} /> Add
            </button>
          }
        >
          {spares.length ? (
            <div className="bar-list">
              {spares.map(spare => {
                const stock = spareStock(spare, doc.sessions);
                return (
                  <button
                    key={spare.id}
                    className="bar-line plain-button"
                    onClick={() => open(<SpareForm spare={spare} />)}
                  >
                    <span className="name">
                      {spare.name}
                      {!spare.heliId && <span className="muted">· any heli</span>}
                    </span>
                    <span className={`pill ${stock <= 0 ? 'critical' : stock < spare.min ? 'caution' : 'good'}`}>
                      {Math.max(0, stock)} in stock
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <Empty emoji="🧰">No spares for it.</Empty>
          )}
        </Panel>

        {months.length > 0 && (
          <Panel label="Airtime" note="Month by month" className="span-12">
            <AirtimeChart months={months} short />
          </Panel>
        )}

        <Panel label="Setup" className={tips.length ? 'span-6' : 'span-12'}>
          {heli.setup ? <p className="prose">{heli.setup}</p> : <p className="muted">No setup written yet.</p>}
        </Panel>

        {tips.length > 0 && (
          <Panel
            label="Notes"
            className="span-6"
            action={
              <Link to="/hangar/notes" className="button small ghost">
                All <ChevronRight size={14} />
              </Link>
            }
          >
            {tips.map(tip => (
              <div key={tip.id} style={{marginBottom: 10}}>
                <b>{tip.title}</b>
                <p className="prose muted">{tip.body}</p>
              </div>
            ))}
          </Panel>
        )}

        <Panel
          label="Sorties"
          className="span-12"
          action={
            <Link to={`/sessions?heli=${heli.id}`} className="button small ghost">
              All {sessions.length} <ChevronRight size={14} />
            </Link>
          }
        >
          {sessions.length ? (
            <div className="strip-board">
              {[...sessions]
                .reverse()
                .slice(0, 8)
                .map(session => (
                  <FlightStrip key={session.id} session={session} />
                ))}
            </div>
          ) : (
            <Empty>No session on it yet.</Empty>
          )}
        </Panel>
      </div>
      <p className="muted" style={{fontSize: 12}}>
        {plural(all.flyingDays, 'flying day')} on {heli.name}.
      </p>
    </div>
  );
}
