import {useEffect, useMemo, useState} from 'react';
import {Trash} from 'lucide-react';
import type {TelemetryLog, TelemetrySeries} from '../types';
import {useStore} from '../data/store';
import {buttonBattery, groupPacks, joinSeries, packName, packUsed} from '../model/packs';
import {formatTimer, plural} from '../model/format';
import {TelemetryCharts} from './charts/TelemetryCharts';

/** Below this the radio lost the voltage for a sample: left out of the lines. */
const NO_VOLTAGE = 0.5;

/** A pack's voltage as a small line, on a scale shared by every pack of the sortie so their sag compares. */
function Sparkline({series, low, high}: {series?: TelemetrySeries | null; low: number; high: number}) {
  const voltage = series?.channels.voltage;
  const end = series?.time[series.time.length - 1] ?? 0;
  const points: string[] = [];
  if (series && voltage?.length && high > low && end > 0) {
    // About a hundred points: enough for a line this small.
    const step = Math.max(1, Math.floor(voltage.length / 100));
    for (let index = 0; index < voltage.length; index += step) {
      if (voltage[index] < NO_VOLTAGE) continue;
      const x = (series.time[index] / end) * 100;
      const y = 22 - ((voltage[index] - low) / (high - low)) * 20;
      points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
  }
  return (
    <svg className="pack-spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden>
      {points.length > 1 && <polyline points={points.join(' ')} />}
    </svg>
  );
}

/**
 * A sortie's telemetry, a pack at a time: a card for each pack flown (files a few seconds apart joined into one), and
 * under them the chosen pack's recorder, figures, notes, stick map and replay, and its file.
 */
export function TelemetryPacks({
  logs,
  pack,
  packs,
  onRemove,
}: {
  logs: TelemetryLog[];
  pack?: {cells?: number; capacity?: number};
  packs: number[];
  onRemove: (logId: string) => void;
}) {
  const {doc, loadSeries} = useStore();
  const flights = useMemo(() => groupPacks(logs), [logs]);
  // Each file's samples once loaded, null when they could not be read.
  const [loaded, setLoaded] = useState<Record<string, TelemetrySeries | null>>({});
  const [chosen, setChosen] = useState(0);

  useEffect(() => {
    let current = true;
    const load = async () => {
      const entries = await Promise.all(
        logs.map(async log => [log.id, await loadSeries(log.id).catch(() => null)] as const),
      );
      if (current) setLoaded(Object.fromEntries(entries));
    };
    void load();
    return () => {
      current = false;
    };
  }, [logs, loadSeries]);

  const joined = useMemo(
    () =>
      flights.map(flight => {
        const parts = flight.files.map(file => loaded[file.id]);
        if (parts.some(part => part === undefined)) return undefined;
        if (parts.some(part => part === null)) return null;
        return joinSeries(flight, parts as TelemetrySeries[]);
      }),
    [flights, loaded],
  );

  // One voltage scale for every card's line.
  const volts = joined.flatMap(series => (series?.channels.voltage ?? []).filter(value => value >= NO_VOLTAGE));
  const low = volts.length ? Math.min(...volts) : 0;
  const high = volts.length ? Math.max(...volts) : 0;
  // A single file keeps the mAh read from it whole; joined files are added up again from their samples.
  const usedBy = flights.map((flight, index) => {
    const series = joined[index];
    return flight.files.length > 1 && series ? (packUsed(series) ?? flight.mAh) : flight.mAh;
  });

  if (!flights.length) return null;
  const selected = Math.min(chosen, flights.length - 1);
  const flight = flights[selected];
  const series = joined[selected];
  const used = usedBy[selected];
  // The pack its button names, its size and cells; else the heli's usual one.
  const named = buttonBattery(flight.packButton ?? 0, doc.batteries, flight.start?.slice(0, 10));
  const flightPack = named ? {cells: named.battery.cells, capacity: named.battery.capacity} : pack;
  // A pack its button names has its size: the replay offers no other to pick.
  const figures = [
    {label: 'Used', value: used !== undefined ? `${used} mAh` : undefined},
    {label: 'Lowest voltage', value: flight.minVoltage !== undefined ? `${flight.minVoltage} V` : undefined},
    {label: 'Peak current', value: flight.maxCurrent !== undefined ? `${flight.maxCurrent} A` : undefined},
    {label: 'Average current', value: flight.avgCurrent !== undefined ? `${flight.avgCurrent} A` : undefined},
    {label: 'Weakest signal', value: flight.minRssi !== undefined ? `${flight.minRssi} dB` : undefined},
  ].filter(figure => figure.value);

  const summary = (
    <div className="figures telemetry-figures">
      {figures.map(figure => (
        <div key={figure.label}>
          <div className="figure-label">{figure.label}</div>
          <div className="figure-value">{figure.value}</div>
        </div>
      ))}
    </div>
  );
  const details = (
    <div className="telemetry-file">
      <div className="telemetry-head">
        <div>
          <div className="row-title">
            {flight.files.length > 1 ? `One pack in ${flight.files.length} files` : flight.files[0].name}
          </div>
          <div className="row-sub">
            {flight.start ? `Started ${flight.start.slice(11, 16)} · ` : ''}
            {formatTimer(flight.duration)} recorded · {plural(flight.samples, 'sample')}
          </div>
        </div>
        {flight.files.length === 1 && (
          <button className="icon-button" aria-label="Remove this log" onClick={() => onRemove(flight.files[0].id)}>
            <Trash size={15} />
          </button>
        )}
      </div>
      {flight.files.length > 1 && (
        <div className="pack-files">
          {flight.files.map(file => (
            <div key={file.id} className="pack-file">
              <span className="pack-file-name">{file.name}</span>
              <span className="muted tabular">
                {file.start?.slice(11, 19)} · {formatTimer(file.duration)}
              </span>
              <button className="icon-button" aria-label={`Remove ${file.name}`} onClick={() => onRemove(file.id)}>
                <Trash size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <>
      {flights.length > 1 && (
        <div className="pack-cards" role="group" aria-label="Packs">
          {flights.map((one, index) => (
            <button
              key={one.files[0].id}
              type="button"
              className="pack-card"
              aria-pressed={index === selected}
              onClick={() => setChosen(index)}
            >
              <span className="pack-card-label">
                {packName(one, doc.batteries) ?? `pack ${index + 1}`}
                {one.start && ` · ${one.start.slice(11, 16)}`}
              </span>
              <span className="pack-card-value">
                {formatTimer(one.duration)}
                {usedBy[index] !== undefined && <small> · {usedBy[index]} mAh</small>}
              </span>
              <Sparkline series={joined[index]} low={low} high={high} />
              {one.minVoltage !== undefined && <span className="pack-card-note">low {one.minVoltage} V</span>}
              {one.files.length > 1 && <span className="pack-card-note">{one.files.length} files</span>}
            </button>
          ))}
        </div>
      )}

      <div className="telemetry-log">
        {series === undefined ? (
          <div className="muted">Loading the samples…</div>
        ) : series === null ? (
          <div className="muted">The samples of this pack could not be read.</div>
        ) : (
          <TelemetryCharts
            key={series.id}
            series={series}
            mAh={used}
            pack={flightPack}
            packs={named ? [] : packs}
            summary={summary}
            details={details}
          />
        )}
        {!series && (
          <>
            {summary}
            {details}
          </>
        )}
      </div>
    </>
  );
}
