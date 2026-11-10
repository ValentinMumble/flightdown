import {useMemo, useRef} from 'react';
import {Link, useParams} from 'react-router';
import {ChevronRight, ExternalLink, FileUp, MapPin, Pencil, Trash, Wrench} from 'lucide-react';
import type {Session} from '../types';
import {useStore} from '../data/store';
import {Card, Empty, HeliName, PageHeader, spotLabel, useOverlay} from '../components/ui';
import {CrashPill, FlightStrip} from '../components/SessionRow';
import {Panel} from '../components/instruments';
import {SessionForm} from '../components/forms/SessionForm';
import {SpotForm} from '../components/forms/HangarForms';
import {MiniMap} from '../components/MiniMap';
import {TelemetryCharts} from '../components/charts/TelemetryCharts';
import {formatAirtime, formatDay, formatTimer, plural} from '../model/format';
import {airtime, sortSessions} from '../model/stats';
import {readTelemetry} from '../model/telemetry';
import {packOf} from '../model/insights';
import {parseCsv} from '../model/csv';
import {hasLocation} from '../model/geo';

/** "Photo", "Video", "Map" or the site's name, for a link. */
function linkLabel(url: string) {
  if (/youtu\.?be|vimeo/.test(url)) return 'Video';
  if (/photos\.google|photos\.app\.goo|icloud\.com\/photos|flickr/.test(url)) return 'Photo';
  if (/maps|goo\.gl\/maps/.test(url)) return 'Map';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Link';
  }
}

export function SessionPage() {
  const {id} = useParams();
  const {doc, heli, spot, put, saveSeries} = useStore();
  const {open, toast} = useOverlay();
  const fileInput = useRef<HTMLInputElement>(null);
  const session = doc.sessions.find(one => one.id === id);
  const neighbours = useMemo(() => {
    const sorted = sortSessions(doc.sessions);
    const index = sorted.findIndex(one => one.id === id);
    const sameHeli = sorted.filter(one => one.heliId === session?.heliId);
    return {
      previous: index > 0 ? sorted[index - 1] : undefined,
      next: index >= 0 && index < sorted.length - 1 ? sorted[index + 1] : undefined,
      number: sameHeli.findIndex(one => one.id === id) + 1,
      ofHeli: sameHeli.length,
    };
  }, [doc.sessions, id, session?.heliId]);

  if (!session) {
    return (
      <div className="page">
        <PageHeader title="Session" back="/sessions" />
        <div className="panel">
          <Empty emoji="🤷">This session is not in the log.</Empty>
        </div>
      </div>
    );
  }

  const one = heli(session.heliId);
  const place = spot(session.spotId);
  const pack = packOf(one, doc.batteries);

  const addLogs = async (files: FileList | null) => {
    if (!files?.length) return;
    let added = 0;
    const logs = [...session.telemetry];
    for (const file of Array.from(files)) {
      const read = readTelemetry(parseCsv(await file.text()), file.name);
      if (!read) continue;
      saveSeries(read.series);
      logs.push(read.log);
      added += 1;
    }
    if (added) put('sessions', {...session, telemetry: logs} satisfies Session);
    toast(added ? `${plural(added, 'log')} added` : 'No EdgeTX log found in that file');
  };

  const removeLog = (logId: string) => {
    if (!window.confirm('Remove this log from the session?')) return;
    put('sessions', {...session, telemetry: session.telemetry.filter(log => log.id !== logId)});
  };

  return (
    <div className="page">
      <PageHeader
        title={formatDay(session.date, {year: true})}
        back="/sessions"
        actions={
          <button className="button" onClick={() => open(<SessionForm session={session} />)}>
            <Pencil size={15} /> Edit
          </button>
        }
      />

      <div className="bento">
        <div className="span-12">
          <FlightStrip session={session} large />
        </div>

        <Panel
          label="Debrief"
          note={
            neighbours.ofHeli > 0
              ? `Session ${neighbours.number} of ${neighbours.ofHeli} on ${one?.name ?? 'this heli'}`
              : undefined
          }
          className="span-7"
        >
          <div className="stack" style={{gap: 12}}>
            <div className="figures">
              <div>
                <div className="figure-label">Air</div>
                <div className="figure-value">{formatAirtime(airtime(session), true)}</div>
              </div>
              <div>
                <div className="figure-label">Packs</div>
                <div className="figure-value">
                  {session.packs} × {formatTimer(session.timer)}
                </div>
              </div>
              <div>
                <div className="figure-label">Spot</div>
                <div className="figure-value" style={{fontSize: 15}}>
                  {place ? spotLabel(place) : '–'}
                </div>
              </div>
              <div>
                <div className="figure-label">Crashes</div>
                <div className="figure-value">
                  <CrashPill crashes={session.crashes} />
                </div>
              </div>
            </div>
            {session.skills.length > 0 && (
              <div className="chips">
                {session.skills.map(skill => (
                  <span key={skill} className="pill label">
                    {skill}
                  </span>
                ))}
              </div>
            )}
            {session.notes ? (
              <p className="prose session-notes">{session.notes}</p>
            ) : (
              <p className="muted">No notes.</p>
            )}
            <Link to={`/helis/${session.heliId}`} className="button small ghost" style={{alignSelf: 'flex-start'}}>
              <HeliName heli={one} /> <ChevronRight size={14} />
            </Link>
          </div>
        </Panel>

        <div className="span-5 stack">
          {place &&
            (hasLocation(place) ? (
              <MiniMap spot={place} />
            ) : (
              <Card title={spotLabel(place)} sub="This spot has no location yet">
                <button className="button" onClick={() => open(<SpotForm spot={place} />)}>
                  <MapPin size={15} /> Place it on the map
                </button>
              </Card>
            ))}
          <Card title="Broken parts" sub={session.broken.length ? undefined : 'Nothing broke'}>
            {session.broken.length > 0 && (
              <div className="bar-list">
                {session.broken.map((part, index) => (
                  <Link
                    key={`${part.part}-${index}`}
                    to={`/sessions?part=${encodeURIComponent(part.part)}`}
                    className="bar-line"
                  >
                    <span className="name">
                      <Wrench size={14} className="muted" /> {part.part}
                      {part.note && <span className="muted">· {part.note}</span>}
                    </span>
                    <span className="value">× {part.qty}</span>
                  </Link>
                ))}
              </div>
            )}
          </Card>
          {session.links.length > 0 && (
            <Card title="Photos and videos">
              <div className="chips">
                {session.links.map(link => (
                  <a key={link} className="chip" href={link} target="_blank" rel="noreferrer">
                    <ExternalLink size={13} /> {linkLabel(link)}
                  </a>
                ))}
              </div>
            </Card>
          )}
        </div>

        <Card
          className="span-12"
          title="Telemetry"
          sub={
            session.telemetry.length ? undefined : 'Add the EdgeTX logs from your radio (LOGS folder on its SD card)'
          }
          action={
            <>
              <input
                ref={fileInput}
                type="file"
                accept=".csv,text/csv"
                multiple
                hidden
                onChange={event => {
                  void addLogs(event.target.files);
                  event.target.value = '';
                }}
              />
              <button className="button small" onClick={() => fileInput.current?.click()}>
                <FileUp size={14} /> Add a log
              </button>
            </>
          }
        >
          {session.telemetry.map(log => (
            <div key={log.id} className="telemetry-log">
              <div className="telemetry-head">
                <div>
                  <div className="row-title">{log.name}</div>
                  <div className="row-sub">
                    {log.start ? `Started ${log.start.slice(11, 16)} · ` : ''}
                    {formatTimer(log.duration)} recorded · {plural(log.samples, 'sample')}
                  </div>
                </div>
                <button className="icon-button" aria-label="Remove this log" onClick={() => removeLog(log.id)}>
                  <Trash size={15} />
                </button>
              </div>
              <div className="telemetry-figures">
                {log.mAh !== undefined && (
                  <div>
                    <div className="figure-label">Used</div>
                    <div className="figure-value">{log.mAh} mAh</div>
                  </div>
                )}
                {log.minVoltage !== undefined && (
                  <div>
                    <div className="figure-label">Lowest voltage</div>
                    <div className="figure-value">{log.minVoltage} V</div>
                  </div>
                )}
                {log.maxCurrent !== undefined && (
                  <div>
                    <div className="figure-label">Peak current</div>
                    <div className="figure-value">{log.maxCurrent} A</div>
                  </div>
                )}
                {log.avgCurrent !== undefined && (
                  <div>
                    <div className="figure-label">Average current</div>
                    <div className="figure-value">{log.avgCurrent} A</div>
                  </div>
                )}
                {log.minRssi !== undefined && (
                  <div>
                    <div className="figure-label">Weakest signal</div>
                    <div className="figure-value">{log.minRssi} dB</div>
                  </div>
                )}
              </div>
              <TelemetryCharts log={log} pack={pack} />
            </div>
          ))}
        </Card>
      </div>

      <div className="pager">
        {neighbours.previous ? (
          <Link to={`/sessions/${neighbours.previous.id}`} className="button ghost">
            ← {formatDay(neighbours.previous.date, {weekday: false})}
          </Link>
        ) : (
          <span />
        )}
        {neighbours.next && (
          <Link to={`/sessions/${neighbours.next.id}`} className="button ghost">
            {formatDay(neighbours.next.date, {weekday: false})} <ChevronRight size={14} />
          </Link>
        )}
      </div>
    </div>
  );
}
