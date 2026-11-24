import {useMemo, useRef} from 'react';
import {Link, useParams} from 'react-router';
import {ChevronRight, ExternalLink, FileUp, MapPin, Pencil, Wrench} from 'lucide-react';
import type {TurnWay} from '../types';
import {useStore} from '../data/store';
import {Card, Empty, HeliName, PageHeader, spotLabel, useOverlay} from '../components/ui';
import {FlightStrip} from '../components/SortieRow';
import {SortieQuickFacts} from '../components/SortieQuickFacts';
import {MinuteMeter, Panel} from '../components/instruments';
import {SortieForm} from '../components/forms/SortieForm';
import {SpotForm} from '../components/forms/SpotForm';
import {MiniMap} from '../components/MiniMap';
import {SortiePhotos} from '../components/SortiePhotos';
import {TelemetryPacks} from '../components/TelemetryPacks';
import {InvertedRing, PackBars, packTimes} from '../components/PackTimes';
import {daysBetween, formatAirtime, formatDay, formatTimer, plural, today} from '../model/format';
import {airtime, loggedTimes, sortSorties} from '../model/stats';
import {readTelemetry} from '../model/telemetry';
import {addFlips, describeFlips, packOf} from '../model/insights';
import {packDebrief} from '../model/cockpit';
import {packRecords, sortiePacks} from '../model/packs';
import {parseCsv} from '../model/csv';
import {hasLocation} from '../model/geo';
import {weatherEmoji, weatherNote} from '../model/pastWeather';

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
  const {doc, heli, spot, patch, saveSeries} = useStore();
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
  // Today's and yesterday's sorties say so, as their strip does, the date under it.
  const days = daysBetween(sortie.date, today());
  const near = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : null;
  const place = spot(sortie.spotId);
  const pack = packOf(one, doc.batteries);
  const logged = sortie ? loggedTimes(sortie) !== null : false;
  // Its whole flips and rolls, every log's added up, how often they came, and each pack's.
  const flipCounts = sortie.telemetry.reduce<Partial<Record<TurnWay, number>>>(
    (sum, log) => addFlips(sum, log.flips),
    {},
  );
  const flips = describeFlips(flipCounts);
  const flipTotal = Object.values(flipCounts).reduce((sum: number, count) => sum + (count ?? 0), 0);
  const flown = packTimes(sortie, doc.batteries);
  const packFlips = sortiePacks(sortie).map((one, index) => ({
    name: flown[index]?.name ?? `Pack ${index + 1}`,
    flips: describeFlips(one.files.reduce((sum, log) => addFlips(sum, log.flips), {})),
  }));
  // Every size of pack this heli flies, to pick from in a replay.
  const packs = [
    ...new Set(
      doc.batteries.filter(battery => battery.heliIds.includes(sortie.heliId)).map(battery => battery.capacity),
    ),
  ];

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
    if (added) patch('sorties', sortie.id, {telemetry: logs});
    toast(added ? `${plural(added, 'log')} added` : 'No EdgeTX log found in that file');
  };

  const removeLog = (logId: string) => {
    if (!window.confirm('Remove this log from the sortie?')) return;
    patch('sorties', sortie.id, {telemetry: sortie.telemetry.filter(log => log.id !== logId)});
  };

  return (
    <div className="page">
      <PageHeader
        title={near ?? formatDay(sortie.date, {year: true})}
        sub={near ? formatDay(sortie.date, {year: true}) : undefined}
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
                {/* From its logs, to the second; else its packs times its timer. On an hour meter, then in words. */}
                <div className="figure-meter">
                  <MinuteMeter seconds={airtime(sortie)} small />
                  <span className="figure-value">
                    {logged ? formatTimer(airtime(sortie)) : formatAirtime(airtime(sortie), true)}
                  </span>
                </div>
              </div>
              <div>
                <div className="figure-label">Packs</div>
                <div className="figure-value">
                  {logged ? sortie.packs : `${sortie.packs} × ${formatTimer(sortie.timer)}`}
                </div>
              </div>
              {sortie.weather && !sortie.indoor && (
                <div title={`At the spot from ${sortie.weather.from}:00 to ${sortie.weather.to + 1}:00, by Open-Meteo`}>
                  <div className="figure-label">Wind</div>
                  <div className="figure-value">
                    <span aria-hidden>{weatherEmoji(sortie.weather)}</span> {Math.round(sortie.weather.wind)} km/h
                  </div>
                  <div className="figure-note">{weatherNote(sortie.weather)}</div>
                </div>
              )}
            </div>
            {/* The crashes, the spot and indoors, one tap each, saved at once. */}
            <SortieQuickFacts sortie={sortie} />
            {/* Its packs as their logs flew them, and the share upside down. */}
            {logged && (
              <div className="debrief-packs">
                <PackBars packs={flown} />
                {sortie.telemetry.some(log => log.inverted !== undefined) && (
                  <InvertedRing
                    inverted={sortie.telemetry.reduce((sum, log) => sum + (log.inverted ?? 0), 0)}
                    air={airtime(sortie)}
                  />
                )}
                {flips && (
                  <div className="debrief-flips">
                    <p>
                      <span aria-hidden>🔄</span> {flips}
                      <span className="muted">
                        {' '}
                        · {flipTotal} in {formatTimer(airtime(sortie))} of flight, one every{' '}
                        {Math.round(airtime(sortie) / flipTotal)} s
                      </span>
                    </p>
                    {packFlips.length > 1 && (
                      <ul className="debrief-flip-packs">
                        {packFlips.map(one => (
                          <li key={one.name}>
                            <span>{one.name}</span> {one.flips ?? 'no flips'}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                <div className="pack-debrief">
                  {packDebrief(sortie, doc.batteries, packRecords(doc.sorties, doc.batteries)).map(pack => (
                    <div key={pack.name} className="pack-debrief-row">
                      <span className="pack-debrief-name">{pack.name}</span>
                      <span className="pack-debrief-notes">
                        {pack.notes.map(note => (
                          <span key={note.text} className={`pill ${note.tone === 'warning' ? 'critical' : note.tone}`}>
                            {note.text}
                          </span>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
          <TelemetryPacks
            logs={sortie.telemetry}
            packCount={sortie.packs}
            heliId={sortie.heliId}
            crashTimes={sortie.crashTimes ?? []}
            onCrashTimes={times =>
              patch('sorties', sortie.id, {crashTimes: times, crashes: Math.max(sortie.crashes ?? 0, times.length)})
            }
            pack={pack}
            packs={packs}
            onRemove={removeLog}
          />
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
