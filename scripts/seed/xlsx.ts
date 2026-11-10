import {readZip} from './zip';
import type {Cell} from '../../src/model/telemetry';

export type {Cell};

/** A tab of a workbook: its rows of raw values, and the links put on its cells. */
export interface Sheet {
  name: string;
  rows: Cell[][];
  /** Links put on cells, by "row,column" (both from 0). */
  links: Map<string, string>;
}

export const cellKey = (row: number, column: number) => `${row},${column}`;

function columnIndex(ref: string) {
  let index = 0;
  for (const letter of ref.replace(/\d+$/, '')) index = index * 26 + letter.charCodeAt(0) - 64;
  return index - 1;
}

const rowIndex = (ref: string) => Number(/\d+$/.exec(ref)?.[0] ?? 1) - 1;

const ENTITIES: Record<string, string> = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"};

function decode(text: string) {
  return text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (whole, name: string) => {
    if (name[0] !== '#') return ENTITIES[name] ?? whole;
    return String.fromCodePoint(
      name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1)),
    );
  });
}

/** The attributes of one tag, by name ("r:id" included). */
function attributes(tag: string) {
  const found: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:]+)="([^"]*)"/g)) found[match[1]] = decode(match[2]);
  return found;
}

/** The text of a string item: plain or rich text runs, phonetic hints left out. */
function itemText(xml: string) {
  const runs = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  return [...runs.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(match => decode(match[1])).join('');
}

function relations(xml: string | undefined) {
  const targets = new Map<string, string>();
  for (const match of (xml ?? '').matchAll(/<Relationship\b[^>]*>/g)) {
    const {Id, Target} = attributes(match[0]);
    if (Id) targets.set(Id, Target ?? '');
  }
  return targets;
}

/**
 * Reads every tab of an .xlsx workbook (as Google Sheets exports it) in Node, which has no DOMParser: the few tags
 * needed are found with patterns, enough for the plain XML these files hold.
 */
export async function readXlsx(file: Blob): Promise<Sheet[]> {
  const files = await readZip(file, name => name.startsWith('xl/') && /\.(xml|rels)$/.test(name));
  const workbook = files.get('xl/workbook.xml');
  if (!workbook) throw new Error('This file is not an Excel workbook');
  const shared = [...(files.get('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(match =>
    itemText(match[1]),
  );
  const workbookTargets = relations(files.get('xl/_rels/workbook.xml.rels'));
  const sheets: Sheet[] = [];

  for (const match of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const entry = attributes(match[0]);
    const target = workbookTargets.get(entry['r:id'] ?? '') ?? '';
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    const xml = files.get(path);
    if (!xml) continue;

    const rows: Cell[][] = [];
    for (const cell of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const {r: ref = '', t: type} = attributes(cell[1]);
      const inner = cell[2] ?? '';
      const rawMatch = /<v>([\s\S]*?)<\/v>/.exec(inner);
      const raw = rawMatch ? decode(rawMatch[1]) : null;
      let value: Cell = null;
      if (type === 's') value = raw === null ? null : (shared[Number(raw)] ?? null);
      else if (type === 'inlineStr') value = itemText(inner);
      else if (type === 'str' || type === 'e') value = raw;
      else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
      else if (raw !== null && raw !== '') value = Number(raw);
      if (value === null || value === '') continue;
      const row = rowIndex(ref);
      rows[row] ??= [];
      rows[row][columnIndex(ref)] = value;
    }
    for (let index = 0; index < rows.length; index += 1) {
      rows[index] = Array.from(rows[index] ?? [], value => value ?? null);
    }

    const name = path.split('/').pop() ?? '';
    const sheetTargets = relations(files.get(path.replace(name, `_rels/${name}.rels`)));
    const links = new Map<string, string>();
    for (const link of xml.matchAll(/<hyperlink\b[^>]*>/g)) {
      const {ref = '', 'r:id': id = ''} = attributes(link[0]);
      const url = sheetTargets.get(id);
      const first = ref.split(':')[0];
      if (url && first) links.set(cellKey(rowIndex(first), columnIndex(first)), url);
    }
    sheets.push({name: entry.name ?? `Sheet ${sheets.length + 1}`, rows, links});
  }
  return sheets;
}
