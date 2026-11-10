import {useMemo, useRef} from 'react';
import {Link, useParams} from 'react-router';
import {ChevronRight, ExternalLink, FileUp, MapPin, Pencil, Trash, Wrench} from 'lucide-react';
import type {Sortie} from '../types';
import {useStore} from '../data/store';
import {Card, Empty, HeliName, PageHeader, spotLabel, useOverlay} from '../components/ui';
import {CrashPill, FlightStrip} from '../components/SortieRow';
import {Panel} from '../components/instruments';
import {SortieForm} from '../components/forms/SortieForm';
import {SpotForm} from '../components/forms/HangarForms';
import {MiniMap} from '../components/MiniMap';
import {SortiePhotos} from '../components/SortiePhotos';
import {TelemetryCharts} from '../components/charts/TelemetryCharts';
import {formatAirtime, formatDay, formatTimer, plural} from '../model/format';
import {airtime, sortSorties} from '../model/stats';
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

export function SortiePage() {
  const {id} = useParams();
  const {doc, heli, spot, put, saveSeries} = useStore();
  const {open, toast} = useOverlay();
  const fileInput = useRef<HTMLInputElement>(null);
  const sortie = doc.sorties.find(one => one.id === id);
  const neighbours = useMemo(() => {
    const sorted = sortSorties(doc.sorties);
    const index = sorted.findIndex(one => one.id === id);
    const sameHeli = sorted.filter(one => one.heliId === sortie?.heliId);
    return {
      previous: index > 0 ? sorted[index - 1] : undefined,
      next: index >= 0 && index < sorted.length - 1 ? sorted[index + 1] : undefined,
      number: sameHeli.findIndex(one => one.id === id) + 1,
      ofHeli: sameHeli.length,
    };
  }, [doc.sorties, id, sortie?.heliId]);

  if (!sortie) {
    return (
      <div className="page">
        <PageHeader title="Sortie" back="/sorties" />
        <div className="panel">
          <Empty emoji="🤷">This sortie is not in the log.</Empty>
        </div>
      </div>
    );
  }

  const one = heli(sortie.heliId);
  const place = spot(sortie.spotId);
  const pack = packOf(one, doc.batteries);

  const addLogs = async (files: FileList | null) => {
    if (!files?.length) return;
    let added = 0;
    const logs = [...sortie.telemetry];
    for (const file of Array.from(files)) {
      const read = readTelemetry(parseCsv(await file.text()), file.name);
      if (!read) continue;
      saveSeries(read.series);
      logs.push(read.log);
      added += 1;
    }
    if (added) put('sorties', {...sortie, telemetry: logs} satisfies Sortie);
    toast(added ? `${plural(added, 'log')} added` : 'No EdgeTX log found in that file');
  };

  const removeLog = (logId: string) => {
    if (!window.confirm('Remove this log from the sortie?')) return;
    put('sorties', {...sortie, telemetry: sortie.telemetry.filter(log => log.id !== logId)});
  };

  return (
    <div className="page">
      <PageHeader
        title={formatDay(sortie.date, {year: true})}
        back="/sorties"
        actions={
          <button className="button" onClick={() => open(<SortieForm sortie={sortie} />)}>
            <Pencil size={15} /> Edit
          </button>
        }
      />

      <div className="bento">
        <div className="span-12">
          <FlightStrip sortie={sortie} large />
        </div>

        <Panel
          label="Debrief"
          note={
            neighbours.ofHeli > 0
              ? `Sortie ${neighbours.number} of ${neighbours.ofHeli} on ${one?.name ?? 'this heli'}`
              : undefined
          }
          className="span-7"
        >
          <div className="stack" style={{gap: 12}}>
            <div className="figures">
              <div>
                <div className="figure-label">Air</div>
                <div className="figure-value">{formatAirtime(airtime(sortie), true)}</div>
              </div>
              <div>
                <div className="figure-label">Packs</div>
                <div className="figure-value">
                  {sortie.packs} × {formatTimer(sortie.timer)}
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
                  <CrashPill crashes={sortie.crashes} />
                </div>
              </div>
            </div>
            {sortie.skills.length > 0 && (
              <div className="chips">
                {sortie.skills.map(skill => (
                  <span key={skill} className="pill label">
                    {skill}
                  </span>
                ))}
              </div>
            )}
            {sortie.notes ? <p className="prose sortie-notes">{sortie.notes}</p> : <p className="muted">No notes.</p>}
            <Link to={`/helis/${sortie.heliId}`} className="button small ghost" style={{alignSelf: 'flex-start'}}>
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
          <Card title="Broken parts" sub={sortie.broken.length ? undefined : 'Nothing broke'}>
            {sortie.broken.length > 0 && (
              <div className="bar-list">
                {sortie.broken.map((part, index) => (
                  <Link
                    key={`${part.part}-${index}`}
                    to={`/sorties?part=${encodeURIComponent(part.part)}`}
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
          {sortie.links.length > 0 && (
            <Card title="Videos and links">
              <div className="chips">
                {sortie.links.map(link => (
                  <a key={link} className="chip" href={link} target="_blank" rel="noreferrer">
                    <ExternalLink size={13} /> {linkLabel(link)}
                  </a>
                ))}
              </div>
            </Card>
          )}
        </div>

        <SortiePhotos sortie={sortie} />

        <Card
          className="span-12"
          title="Telemetry"
          sub={sortie.telemetry.length ? undefined : 'Add the EdgeTX logs from your radio (LOGS folder on its SD card)'}
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
          {sortie.telemetry.map(log => (
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
          <Link to={`/sorties/${neighbours.previous.id}`} className="button ghost">
            ← {formatDay(neighbours.previous.date, {weekday: false})}
          </Link>
        ) : (
          <span />
        )}
        {neighbours.next && (
          <Link to={`/sorties/${neighbours.next.id}`} className="button ghost">
            {formatDay(neighbours.next.date, {weekday: false})} <ChevronRight size={14} />
          </Link>
        )}
      </div>
    </div>
  );
}
