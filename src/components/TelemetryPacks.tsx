import {useEffect, useMemo, useRef, useState} from 'react';
import {Minus, Plus, Trash} from 'lucide-react';
import type {TelemetryLog, TelemetrySeries} from '../types';
import {useStore} from '../data/store';
import {useSeries} from '../data/useSeries';
import {
  buttonBattery,
  crashesIn,
  groupPacks,
  joinSeries,
  packName,
  packRecords,
  packUsed,
  radioSeconds,
  radioTime,
} from '../model/packs';
import {formatTimer, plural} from '../model/format';
import {chargeFromCell} from '../model/battery';
import {TelemetryCharts} from './charts/TelemetryCharts';
import {topBarHeight} from './topBar';

/** Below this the radio lost the voltage for a sample: left out of the lines. */
const NO_VOLTAGE = 0.5;

/** Volts typed in as 3.91 or 3,91; null when empty, undefined when not a voltage. */
const readVolts = (text: string) => {
  const trimmed = text.trim().replace(',', '.');
  if (!trimmed) return null;
  const volts = Number(trimmed);
  return Number.isFinite(volts) && volts > 0 && volts < 60 ? Math.round(volts * 100) / 100 : undefined;
};

/** A tap on the minus or plus: a hundredth of a volt. */
const VOLT_STEP = 0.01;
/** Taps on the minus or plus are saved once they stop for this long (ms), not one write a tap. */
const STEP_SAVE = 500;

/**
 * A pack's landed volts, typed in or stepped a hundredth at a time: saved when the field is left or Enter is pressed
 * (Enter moves to the next one), or once the taps stop. An empty field steps from its usual 3.85 V a cell.
 */
function LandedInput({
  label,
  volts,
  cells,
  onSave,
}: {
  label: string;
  volts?: number;
  cells?: number;
  onSave: (volts: number | undefined) => void;
}) {
  const [text, setText] = useState(volts?.toFixed(2) ?? '');
  useEffect(() => setText(volts?.toFixed(2) ?? ''), [volts]);
  const pending = useRef(0);
  useEffect(() => () => window.clearTimeout(pending.current), []);
  const usual = 3.85 * (cells ?? 1);
  const save = (typed = text) => {
    window.clearTimeout(pending.current);
    const read = readVolts(typed);
    if (read === undefined) return setText(volts?.toFixed(2) ?? '');
    if ((read ?? undefined) !== volts) onSave(read ?? undefined);
  };
  const step = (way: 1 | -1) => {
    const from = readVolts(text);
    const next = (from ? from + way * VOLT_STEP : usual).toFixed(2);
    setText(next);
    window.clearTimeout(pending.current);
    pending.current = window.setTimeout(() => save(next), STEP_SAVE);
  };
  const charge = volts !== undefined && cells ? Math.round(chargeFromCell(volts / cells)) : undefined;
  return (
    <label className="landed-pack">
      <span className="landed-label">{label}</span>
      <span className="stepper landed-stepper">
        <button type="button" aria-label={`${label}: a hundredth of a volt less`} onClick={() => step(-1)}>
          <Minus size={14} />
        </button>
        <input
          className="stepper-input landed-input"
          inputMode="decimal"
          enterKeyHint="next"
          placeholder={usual.toFixed(2)}
          value={text}
          onChange={event => setText(event.target.value)}
          onBlur={() => save()}
          onKeyDown={event => {
            if (event.key !== 'Enter') return;
            const inputs = [...document.querySelectorAll<HTMLInputElement>('.landed-input')];
            const next = inputs[inputs.indexOf(event.currentTarget) + 1];
            if (next) next.focus();
            else event.currentTarget.blur();
          }}
        />
        <button type="button" aria-label={`${label}: a hundredth of a volt more`} onClick={() => step(1)}>
          <Plus size={14} />
        </button>
      </span>
      <span className="landed-unit">V</span>
      {charge !== undefined && <span className="landed-charge">{charge}%</span>}
    </label>
  );
}

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
  packCount,
  heliId,
  crashTimes = [],
  onCrashTimes,
  pack,
  packs,
  onRemove,
  onLanded,
}: {
  logs: TelemetryLog[];
  /** How many packs the sortie says were flown: logs close in time join to make that many. */
  packCount: number;
  /** The heli flown: a button names one of its own kinds of pack. */
  heliId: string;
  /** When the sortie's crashes happened (local times), and how to change them: marked on each pack's timeline. */
  crashTimes?: string[];
  onCrashTimes?: (times: string[]) => void;
  pack?: {cells?: number; capacity?: number};
  packs: number[];
  onRemove: (logId: string) => void;
  /** Saves a pack's landed volts (on its last file), or clears them. */
  onLanded?: (logId: string, volts: number | undefined) => void;
}) {
  const {doc} = useStore();
  const flights = useMemo(() => groupPacks(logs, packCount), [logs, packCount]);
  const records = useMemo(() => packRecords(doc.sorties, doc.batteries), [doc.sorties, doc.batteries]);
  // Each file's samples once loaded, null when they could not be read; none while they are read.
  const ids = useMemo(() => logs.map(log => log.id), [logs]);
  const read = useSeries(ids);
  const loaded = useMemo<Record<string, TelemetrySeries | null>>(
    () => (read ? Object.fromEntries(ids.map(id => [id, read.get(id) ?? null])) : {}),
    [read, ids],
  );
  const [chosen, setChosen] = useState(0);
  // The packs' row stays pinned under the top bar, so another pack is one tap away from anywhere in the charts: it sits
  // as far down as that bar is tall.
  const row = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  useEffect(() => {
    const measure = () => setTop(topBarHeight());
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  // When the row is wider than the screen: keep the chosen pack in sight.
  useEffect(() => {
    const card = row.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!row.current || !card || row.current.scrollWidth <= row.current.clientWidth) return;
    row.current.scrollTo({
      left: card.offsetLeft - (row.current.clientWidth - card.offsetWidth) / 2,
      behavior: 'smooth',
    });
  }, [chosen]);

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
  // The pack's crashes as seconds of its log (whose 0 is the pack's start), and back to times when marked or unmarked.
  const crashes = crashesIn(flight, crashTimes);
  const startedAt = flight.start ? radioSeconds(flight.start) : null;
  const markCrashes =
    onCrashTimes && startedAt !== null
      ? (seconds: number[]) =>
          onCrashTimes(
            [
              ...crashTimes.filter(time => !crashesIn(flight, [time]).length),
              ...seconds.map(second => radioTime(startedAt + second)),
            ].sort(),
          )
      : undefined;
  const series = joined[selected];
  const used = usedBy[selected];
  // The pack its button names, its size and cells; else the heli's usual one.
  const named = buttonBattery(flight.packButton ?? 0, doc.batteries, flight.start?.slice(0, 10), heliId);
  const flightPack = named ? {cells: named.battery.cells, capacity: named.battery.capacity} : pack;
  // The pack's resistance from this log (the whole pack, Ω), for the power margin, and how worn that is against its
  // first reading and the freshest pack's (a cell's share each), for the caution panel.
  const readings = flight.files.flatMap(file => (file.resistance === undefined ? [] : [file.resistance]));
  const ohms = readings.length
    ? readings.sort((left, right) => left - right)[Math.floor(readings.length / 2)] / 1000
    : undefined;
  const record =
    named && records.find(one => one.battery.id === named.battery.id && one.pack.number === named.pack.number);
  const freshest = Math.min(...records.filter(one => !one.pack.dead && one.latest).map(one => one.latest!));
  const cellMilliohms = ohms !== undefined && named ? (ohms * 1000) / named.battery.cells : undefined;
  const wear =
    cellMilliohms === undefined
      ? undefined
      : Math.max(
          record?.first ? cellMilliohms / record.first : 1,
          Number.isFinite(freshest) ? cellMilliohms / freshest : 1,
        );
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
        <div ref={row} className="pack-cards" style={{top}} role="group" aria-label="Packs">
          {flights.map((one, index) => (
            <button
              key={one.files[0].id}
              type="button"
              className="pack-card"
              aria-pressed={index === selected}
              onClick={() => setChosen(index)}
            >
              <span className="pack-card-label">
                {packName(one, doc.batteries, heliId) ?? `pack ${index + 1}`}
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

      {onLanded && (
        <div className="landed" role="group" aria-label="Volts at rest once landed">
          <span className="landed-title">Landed at, resting</span>
          {flights.map((one, index) => {
            const last = one.files[one.files.length - 1];
            const kind = buttonBattery(one.packButton ?? 0, doc.batteries, one.start?.slice(0, 10), heliId);
            return (
              <LandedInput
                key={last.id}
                label={packName(one, doc.batteries, heliId) ?? `Pack ${index + 1}`}
                volts={one.files.find(file => file.landedVoltage !== undefined)?.landedVoltage}
                cells={kind?.battery.cells ?? pack?.cells}
                onSave={volts => onLanded(last.id, volts)}
              />
            );
          })}
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
            ohms={ohms}
            wear={wear}
            crashes={crashes}
            onCrashes={markCrashes}
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
