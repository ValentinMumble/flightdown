import {useMemo} from 'react';
import {CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis} from 'recharts';
import type {Sortie} from '../../types';
import type {PackLog} from '../../model/packs';
import {useStore} from '../../data/store';
import {buttonBattery, packLabel, sortiePacks} from '../../model/packs';
import {formatDay, formatNumber, fromDay, pad} from '../../model/format';
import {useChartInk, useSeriesColor} from '../colors';

/** Packs flown before they were given buttons: one grey series, the packs when younger. */
const BEFORE = 'Before buttons';

/** A day back from its time on the axis (local midnight, as fromDay makes it). */
const dayOf = (time: number) => {
  const date = new Date(time);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

interface Reading {
  day: string;
  time: number;
  /** The measure's value: mΩ a cell, mAh, or volts a cell. */
  value: number;
}

export type PackMeasure = 'resistance' | 'mah' | 'low';

/** Each measure: read from a pack flown (null when its log has none), and shown. */
const MEASURES: Record<
  PackMeasure,
  {
    read: (pack: PackLog, cells: number) => number | null;
    axis: (value: number) => string;
    shown: (value: number) => string;
    domain: [number | string, number | string];
    empty: string;
  }
> = {
  resistance: {
    read: (pack, cells) => {
      const values = pack.files.flatMap(file => (file.resistance === undefined ? [] : [file.resistance]));
      return values.length ? values.sort((left, right) => left - right)[Math.floor(values.length / 2)] / cells : null;
    },
    axis: value => `${Math.round(value)} mΩ`,
    shown: value => `${formatNumber(value, 0)} mΩ`,
    domain: [0, 'auto'],
    empty: "No log yet with the volts and current a pack's resistance is read from.",
  },
  mah: {
    read: pack => pack.mAh ?? null,
    axis: value => String(Math.round(value)),
    shown: value => `${formatNumber(value)} mAh`,
    domain: [0, 'auto'],
    empty: 'No pack flown with its mAh in the log yet.',
  },
  low: {
    read: (pack, cells) => (pack.minVoltage !== undefined && pack.minVoltage > 0.5 ? pack.minVoltage / cells : null),
    axis: value => `${formatNumber(value, 2)} V`,
    shown: value => `${formatNumber(value, 2)} V`,
    domain: ['auto', 'auto'],
    empty: 'No pack flown with its volts in the log yet.',
  },
};

/**
 * Each pack's resistance over time, a cell's share in mΩ, named by its 6-position button: read in every log from the
 * volts' fall an amp over the whole flight (the wires and plugs count too, so it reads above a charger's test). It climbs
 * as a pack ages: one at twice its first readings is worn. A dead pack keeps its line, faded.
 */
export function PackResistance({sorties}: {sorties: Sortie[]}) {
  return <PackOverTime sorties={sorties} measure="resistance" />;
}

/**
 * A measure of each pack over time, a line a pack named by its 6-position button (the packs before buttons grey, a dead
 * one faded), and its first and latest under the chart: its resistance (a cell's share), the mAh a flight took, or its
 * lowest cell under load.
 */
export function PackOverTime({sorties, measure}: {sorties: Sortie[]; measure: PackMeasure}) {
  const shown = MEASURES[measure];
  const {doc} = useStore();
  const ink = useChartInk();
  const color = useSeriesColor();

  const packs = useMemo(() => {
    const byName = new Map<string, Reading[]>();
    const deadOn = new Map<string, string>();
    for (const sortie of sorties) {
      for (const pack of sortiePacks(sortie)) {
        const day = pack.start?.slice(0, 10) ?? sortie.date;
        const found = buttonBattery(pack.packButton ?? 0, doc.batteries, day, sortie.heliId);
        const name = found ? packLabel(found.battery, found.pack) : BEFORE;
        const cells = found?.battery.cells ?? 3;
        if (found?.pack.dead) deadOn.set(name, found.pack.dead);
        const value = shown.read(pack, cells);
        if (value === null) continue;
        const readings = byName.get(name) ?? [];
        readings.push({day, time: fromDay(day).getTime(), value});
        byName.set(name, readings);
      }
    }
    return [...byName]
      .map(([name, readings]) => ({
        name,
        dead: deadOn.get(name),
        readings: readings.sort((left, right) => left.time - right.time),
      }))
      .sort((left, right) =>
        left.name === BEFORE ? 1 : right.name === BEFORE ? -1 : left.name.localeCompare(right.name),
      );
  }, [sorties, doc.batteries, shown]);

  if (!packs.length) return <div className="muted">{shown.empty}</div>;
  // A colour a named pack, in a fixed order; the packs before buttons grey.
  const colorOf = (name: string) => (name === BEFORE ? color(-1) : color(packs.findIndex(pack => pack.name === name)));
  const first = (readings: Reading[]) => readings[0].value;
  const latest = (readings: Reading[]) => readings[readings.length - 1].value;

  return (
    <>
      <div className="chart">
        <ResponsiveContainer>
          <LineChart margin={{top: 10, right: 16, bottom: 0, left: -10}}>
            <CartesianGrid vertical={false} stroke={ink.grid} />
            <XAxis
              dataKey="time"
              type="number"
              domain={['dataMin', 'dataMax']}
              scale="time"
              tickFormatter={(time: number) => formatDay(dayOf(time), {weekday: false})}
              tickLine={false}
              axisLine={{stroke: ink.axis}}
              minTickGap={40}
              allowDuplicatedCategory={false}
            />
            <YAxis
              dataKey="value"
              domain={shown.domain}
              tickFormatter={shown.axis}
              tickLine={false}
              axisLine={false}
              width={58}
            />
            <Tooltip
              cursor={{stroke: ink.axis}}
              content={({active, payload}) => {
                const entry = payload?.[0];
                const reading = entry?.payload as Reading | undefined;
                if (!active || !entry || !reading) return null;
                return (
                  <div className="tooltip">
                    <div className="tooltip-title">{formatDay(reading.day, {year: true})}</div>
                    <div className="tooltip-row">
                      <span>
                        <i style={{background: String(entry.color)}} />
                        {entry.name}
                      </span>
                      <b>{shown.shown(reading.value)}</b>
                    </div>
                  </div>
                );
              }}
            />
            {packs.map(pack => (
              <Line
                key={pack.name}
                name={pack.name}
                data={pack.readings}
                dataKey="value"
                stroke={colorOf(pack.name)}
                strokeOpacity={pack.dead ? 0.4 : 1}
                strokeWidth={2}
                dot={{
                  r: 4,
                  fill: colorOf(pack.name),
                  fillOpacity: pack.dead ? 0.4 : 1,
                  stroke: ink.surface,
                  strokeWidth: 2,
                }}
                activeDot={{r: 5}}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="spot-table" style={{marginTop: 12}}>
        <div className="spot-row head">
          <span>Pack</span>
          <span>First</span>
          <span>Latest</span>
          <span>Change</span>
        </div>
        {packs.map(pack => (
          <div key={pack.name} className="spot-row">
            <span className="name with-dot">
              <i className="dot" style={{background: colorOf(pack.name)}} />
              <span className="name-main">{pack.name}</span>
              <small className="name-note">
                {pack.readings.length} {pack.readings.length === 1 ? 'flight' : 'flights'}
                {pack.dead && ` · dead ${formatDay(pack.dead, {weekday: false})}`}
              </small>
            </span>
            <span>{shown.shown(first(pack.readings))}</span>
            <span>{shown.shown(latest(pack.readings))}</span>
            <span>
              {pack.readings.length > 1 ? `×${formatNumber(latest(pack.readings) / first(pack.readings), 1)}` : '–'}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
