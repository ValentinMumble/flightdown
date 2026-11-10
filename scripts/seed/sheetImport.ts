import {emptyDoc, type Doc, type Heli, type Sortie, type Spot, type TelemetrySeries, type Tip} from '../../src/types';
import {newId, now} from '../../src/model/ids';
import {EMOJI_SLOTS} from '../../src/model/palette';
import {parseBrokenParts, WHOLE_HELI} from '../../src/model/parts';
import {inferSkills} from '../../src/model/skills';
import {airtime, sortSorties} from '../../src/model/stats';
import {isTelemetryHeader, matchSortie, readDay, readTelemetry} from '../../src/model/telemetry';
import {cellKey, type Cell, type Sheet} from './xlsx';

/** The log's columns, and the header words that name each (the first match wins, left to right). */
const FIELDS = {
  date: /date|day|jour/i,
  heli: /machine|heli|model|aircraft|craft/i,
  spot: /location|spot|field|place|where|lieu/i,
  packs: /pack|batter|flights/i,
  timer: /timer|flight time|per pack/i,
  duration: /duration|total|airtime/i,
  crashes: /crash/i,
  broken: /broken|parts|damage|repair/i,
  notes: /comm|note|remark|description/i,
  photos: /photo|video|media|link/i,
};

type Field = keyof typeof FIELDS;

/** Well-known small helis, to fill in the maker of a heli named after its model. */
const KNOWN_MODELS: [RegExp, string, string][] = [
  [/^k1[0-9]{2}\b/i, 'WLtoys XK', ''],
  [/^e1[0-9]{2}\b/i, 'Eachine', ''],
  [/^align\s+(t\S+)/i, 'Align', '$1'],
  [/^t-?rex\s*(\d+)/i, 'Align', 'T-Rex $1'],
  [/^m(1|2|4|7)\b(.*)$/i, 'OMPHobby', 'M$1$2'],
  [/^goosky\s*(\S+)/i, 'Goosky', '$1'],
  [/^(fusion|nano|mcpx|blade)\b/i, 'Blade', ''],
];

export interface ImportReport {
  sheet: string;
  sorties: number;
  helis: number;
  spots: number;
  tips: number;
  telemetry: number;
  skipped: string[];
}

export interface Imported {
  doc: Doc;
  series: TelemetrySeries[];
  report: ImportReport;
}

const text = (value: Cell | undefined) => (value === null || value === undefined ? '' : String(value).trim());

const EMOJI = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*/gu;

/** "Port Barbe 🐎" → name "Port Barbe", emoji 🐎; "🏠" alone → "Home". */
export function splitEmoji(value: string) {
  const emoji = value.match(EMOJI)?.join('') || undefined;
  let name = value.replace(EMOJI, '').replace(/\s+/g, ' ').trim();
  if (!name) name = emoji === '🏠' || emoji === '🏡' ? 'Home' : (emoji ?? 'Somewhere');
  return {name, emoji};
}

/** Seconds from "04:30 m" (minutes and seconds) or a fraction of a day, as a workbook keeps times. */
function readTimer(value: Cell | undefined): number | null {
  if (typeof value === 'number')
    return value > 0 && value < 1 ? Math.round(value * 86_400) : value > 0 ? value * 60 : null;
  const match = /(\d{1,3}):(\d{2})/.exec(text(value));
  if (match) return Number(match[1]) * 60 + Number(match[2]);
  const minutes = Number(
    text(value)
      .replace(',', '.')
      .replace(/[^\d.]/g, ''),
  );
  return minutes > 0 ? Math.round(minutes * 60) : null;
}

/** Seconds from "00:18 h" (hours and minutes) or a fraction of a day. */
function readDuration(value: Cell | undefined): number | null {
  if (typeof value === 'number') return value > 0 && value < 2 ? Math.round(value * 86_400) : null;
  const match = /(\d{1,3}):(\d{2})/.exec(text(value));
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 : null;
}

function readCount(value: Cell | undefined): number | null {
  if (typeof value === 'number') return Math.max(0, Math.round(value));
  const number = Number(text(value).replace(',', '.'));
  return text(value) && Number.isFinite(number) ? Math.max(0, Math.round(number)) : null;
}

const URL_PATTERN = /https?:\/\/[^\s,;]+/g;

function findHeader(rows: Cell[][]) {
  for (let index = 0; index < Math.min(rows.length, 30); index += 1) {
    const row = rows[index] ?? [];
    const columns: Partial<Record<Field, number>> = {};
    row.forEach((cell, column) => {
      const label = text(cell);
      if (!label || label.length > 40) return;
      const field = (Object.keys(FIELDS) as Field[]).find(key => columns[key] === undefined && FIELDS[key].test(label));
      if (field) columns[field] = column;
    });
    if (columns.date !== undefined && columns.heli !== undefined) return {index, columns};
  }
  return null;
}

/** The text of a notes tab: one line a row, its cells joined, whole numbers without their ".0". */
function sheetText(sheet: Sheet) {
  return sheet.rows
    .map(row =>
      (row ?? [])
        .map(cell => (typeof cell === 'number' ? String(Math.round(cell * 1000) / 1000) : text(cell)))
        .filter(Boolean)
        .join('  ·  '),
    )
    .filter(Boolean)
    .join('\n');
}

/**
 * Turns a spreadsheet flight log into Flightdown's: the tab with a Date and a Machine (or Heli, Model) column gives
 * the sorties, their helis and spots; a tab holding an EdgeTX log gives telemetry for the sortie on its day; any
 * other tab becomes a note in the hangar. Written for a log kept in Google Sheets, one sortie a row.
 */
export function importSheets(sheets: Sheet[], fileName = 'sheet'): Imported {
  const doc = emptyDoc();
  const series: TelemetrySeries[] = [];
  const skipped: string[] = [];
  const logSheet = sheets.find(sheet => findHeader(sheet.rows));
  if (!logSheet) {
    throw new Error(
      'No flight log found: Flightdown looks for a tab with a Date column and a Machine (or Heli) column',
    );
  }
  const header = findHeader(logSheet.rows)!;
  const column = header.columns;
  const helis = new Map<string, Heli>();
  const spots = new Map<string, Spot>();
  const created = now();

  for (let index = header.index + 1; index < logSheet.rows.length; index += 1) {
    const row = logSheet.rows[index] ?? [];
    const cell = (field: Field) => (column[field] === undefined ? null : (row[column[field]!] ?? null));
    const heliName = text(cell('heli'));
    const date = readDay(cell('date'));
    if (!heliName && !date) continue;
    if (!heliName || !date) {
      // A year written alone on a row heads the sorties under it: nothing to skip.
      if (!/^\d{4}(\.0)?$/.test(text(cell('date')))) skipped.push(`Row ${index + 1}: no ${date ? 'heli' : 'day'}`);
      continue;
    }

    let heli = helis.get(heliName);
    if (!heli) {
      heli = {id: newId(), name: heliName, color: -1, status: 'active', createdAt: created};
      helis.set(heliName, heli);
    }

    const spotText = text(cell('spot'));
    let spot: Spot | undefined;
    if (spotText) {
      const {name, emoji} = splitEmoji(spotText);
      const key = name.toLowerCase();
      spot = spots.get(key);
      if (!spot) {
        spot = {id: newId(), name, ...(emoji && {emoji})};
        spots.set(key, spot);
      } else if (emoji && !spot.emoji) {
        spot.emoji = emoji;
      }
    }

    const packs = readCount(cell('packs')) ?? 1;
    let timer = readTimer(cell('timer'));
    if (timer === null) {
      const duration = readDuration(cell('duration'));
      if (duration && packs) timer = Math.round(duration / packs);
    }
    const notes = text(cell('notes'));
    const links = new Set<string>();
    for (const field of ['notes', 'photos'] as Field[]) {
      if (column[field] === undefined) continue;
      const link = logSheet.links.get(cellKey(index, column[field]!));
      if (link) links.add(link);
      for (const url of text(cell(field)).match(URL_PATTERN) ?? []) links.add(url);
    }

    const sortie: Sortie = {
      id: newId(),
      date,
      heliId: heli.id,
      ...(spot && {spotId: spot.id}),
      packs,
      timer,
      crashes: readCount(cell('crashes')),
      broken: parseBrokenParts(text(cell('broken'))),
      skills: inferSkills(notes),
      notes: notes.replace(URL_PATTERN, '').trim(),
      links: [...links],
      telemetry: [],
      loggedAt: `${date}T23:59:00`,
    };
    doc.sorties.push(sortie);
  }

  const sorties = sortSorties(doc.sorties);
  doc.helis = [...helis.values()];
  doc.spots = [...spots.values()];

  // Each heli: its maker when the name says it, the timer of its latest sortie, and lost or sold when the log says so.
  for (const heli of doc.helis) {
    const own = sorties.filter(sortie => sortie.heliId === heli.id);
    const latest = own[own.length - 1];
    if (latest?.timer) heli.timer = latest.timer;
    heli.acquired = own[0]?.date;
    const plain = splitEmoji(heli.name).name;
    for (const [pattern, maker, model] of KNOWN_MODELS) {
      const match = pattern.exec(plain);
      if (!match) continue;
      heli.maker = maker;
      heli.model = model ? plain.replace(pattern, model).trim() : plain;
      break;
    }
    if (own.some(sortie => sortie.broken.some(broken => broken.part === WHOLE_HELI))) heli.status = 'lost';
    else if (latest && /\b(sell|sold|selling)\b/i.test(latest.notes)) heli.status = 'sold';
  }

  // Colours: one hinted by a colour emoji in the name first, then the others by airtime, most flown first.
  const airtimeOf = (heli: Heli) =>
    sorties.filter(sortie => sortie.heliId === heli.id).reduce((sum, sortie) => sum + airtime(sortie), 0);
  const taken = new Set<number>();
  for (const heli of doc.helis) {
    const hint = Object.keys(EMOJI_SLOTS).find(emoji => heli.name.includes(emoji));
    if (hint !== undefined && !taken.has(EMOJI_SLOTS[hint])) {
      heli.color = EMOJI_SLOTS[hint];
      taken.add(heli.color);
    }
  }
  let next = 0;
  for (const heli of [...doc.helis].sort((left, right) => airtimeOf(right) - airtimeOf(left))) {
    if (heli.color >= 0) continue;
    while (taken.has(next % 8) && taken.size < 8) next += 1;
    heli.color = next % 8;
    taken.add(heli.color);
    next += 1;
  }

  // The other tabs: an EdgeTX log goes to the sortie of its day, anything else becomes a note.
  let telemetry = 0;
  for (const sheet of sheets) {
    if (sheet === logSheet) continue;
    const headerRow = sheet.rows.find(row => row?.length);
    if (headerRow && isTelemetryHeader(headerRow)) {
      const read = readTelemetry(sheet.rows, sheet.name);
      if (!read) continue;
      const sortie = matchSortie(read.log, null, doc.sorties, () => '');
      if (!sortie) {
        skipped.push(`${sheet.name}: no sortie on ${read.log.start?.slice(0, 10) ?? 'its day'}`);
        continue;
      }
      sortie.telemetry.push(read.log);
      series.push(read.series);
      telemetry += 1;
      continue;
    }
    const body = sheetText(sheet);
    if (body) doc.tips.push({id: newId(), title: sheet.name, body} satisfies Tip);
  }

  return {
    doc,
    series,
    report: {
      sheet: `${fileName} (${logSheet.name})`,
      sorties: doc.sorties.length,
      helis: doc.helis.length,
      spots: doc.spots.length,
      tips: doc.tips.length,
      telemetry,
      skipped,
    },
  };
}
