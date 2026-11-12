/**
 * Brings the EdgeTX logs from the radio into Flightdown: plug the radio in (USB storage), then `npm run logs`.
 *
 * Finds the radio's SD card (a volume under /Volumes with a LOGS folder, or the folder given as an argument), copies
 * the CSV files not yet backed up to SEED_LOGS_DIR, and adds each log Flightdown does not have yet to the sortie of
 * its day flown on the heli named like the radio's model, samples included, in the Upstash Redis store of .env.local.
 * Bench checks and logs of a few seconds are left out. A log with no sortie that day is listed; with --create, the
 * logs of one heli on one day become a sortie of their own, on the heli of that name still flying, its time per pack
 * the logs' time in the air. A sortie counts at least the packs its logs show (files a few seconds apart are one pack);
 * --recount checks every sortie for both, logs new or not. --clean then removes from
 * the radio the logs whose backup is the same file, to free its small SD card. --dry-run only prints what it would do.
 */
import {constants} from 'node:fs';
import {copyFile, readdir, readFile, stat, unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {loadEnv} from 'vite';
import type {Sortie, TelemetryLog, TelemetrySeries} from '../src/types';
import {formatAirtime, formatDay, formatNumber, formatTimer} from '../src/model/format';
import {matchSortie, modelFromFileName, readTelemetry, simple} from '../src/model/telemetry';
import {parseCsv} from '../src/model/csv';
import {newId, now} from '../src/model/ids';
import {groupPacks} from '../src/model/packs';

const flags = new Set(process.argv.slice(2).filter(argument => argument.startsWith('--')));
const folderArgument = process.argv.slice(2).find(argument => !argument.startsWith('--'));
const dryRun = flags.has('--dry-run');
const env = {...loadEnv('development', process.cwd(), ''), ...process.env};
Object.assign(process.env, env);
// The store helpers read the Redis keys from process.env, so they load once it is filled.
const {putItem, putSeries, readDoc} = await import('../api/_lib/store');

const isFolder = async (path: string) => (await stat(path).catch(() => null))?.isDirectory() ?? false;

/** The radio's LOGS folder: the one given, or the SD card of an EdgeTX radio plugged in as USB storage. */
async function logsFolder() {
  if (folderArgument) return folderArgument;
  const found: string[] = [];
  for (const volume of await readdir('/Volumes')) {
    const root = join('/Volumes', volume);
    if (
      (await isFolder(join(root, 'LOGS'))) &&
      ((await isFolder(join(root, 'MODELS'))) || (await isFolder(join(root, 'RADIO'))))
    ) {
      found.push(join(root, 'LOGS'));
    }
  }
  if (!found.length) {
    throw new Error('No radio found: plug it in, pick "USB Storage (SD)" on its screen, or pass the LOGS folder');
  }
  if (found.length > 1) console.log(`Several radios plugged in, reading ${found[0]}`);
  return found[0];
}

const folder = await logsFolder().catch((failure: Error) => {
  console.error(failure.message);
  process.exit(1);
});
const files = (await readdir(folder)).filter(name => name.toLowerCase().endsWith('.csv')).sort();
console.log(`${files.length} logs on ${folder}`);

// A backup of the raw files: Flightdown keeps the samples, not the CSVs.
const backup = env.SEED_LOGS_DIR?.replace(/^~(?=\/)/, process.env.HOME ?? '~');
if (backup && !dryRun) {
  let copied = 0;
  for (const name of files) {
    const done = await copyFile(join(folder, name), join(backup, name), constants.COPYFILE_EXCL).then(
      () => true,
      () => false,
    );
    if (done) copied += 1;
  }
  console.log(copied ? `Backed up ${copied} new files to ${backup}` : `All files already backed up in ${backup}`);
}

/** Frees the radio's small SD card: removes the logs whose copy in the backup folder is the same, byte for byte. */
async function cleanRadio() {
  if (!backup) throw new Error('Set SEED_LOGS_DIR in .env.local: --clean only removes logs that are backed up');
  let removed = 0;
  let freed = 0;
  for (const name of files) {
    const original = await readFile(join(folder, name));
    const copy = await readFile(join(backup, name)).catch(() => null);
    if (!copy || !copy.equals(original)) continue;
    await unlink(join(folder, name));
    removed += 1;
    freed += original.length;
  }
  console.log(`Removed ${removed} backed-up logs from the radio (${formatNumber(freed / 1_000_000, 1)} MB freed)`);
}

const doc = await readDoc();
const known = new Set(doc.sorties.flatMap(sortie => sortie.telemetry.map(log => log.name)));
const heliName = (id: string) => doc.helis.find(heli => heli.id === id)?.name ?? '';
const lines: string[] = [];
const orphans: {log: TelemetryLog; series: TelemetrySeries; model: string | null}[] = [];
const touched = new Map<string, Sortie>();
const series: TelemetrySeries[] = [];

const describe = (log: TelemetryLog) =>
  [
    formatTimer(log.duration),
    log.mAh !== undefined && `${formatNumber(log.mAh)} mAh`,
    log.minVoltage !== undefined && `${formatNumber(log.minVoltage, 2)} V lowest`,
  ]
    .filter(Boolean)
    .join(', ');

for (const name of files) {
  if (known.has(name)) continue;
  const read = readTelemetry(parseCsv(await readFile(join(folder, name), 'utf8')), name);
  if (!read) {
    lines.push(`  · ${name}: no telemetry in it`);
    continue;
  }
  if (read.log.duration < 20) {
    lines.push(`  · ${name}: ${read.log.duration} s, the radio switched on and off`);
    continue;
  }
  if ((read.log.maxCurrent ?? 0) < 4) {
    lines.push(`  · ${name}: never above 4 A, a check on the bench`);
    continue;
  }
  const model = modelFromFileName(name);
  const sorties = [...doc.sorties.filter(sortie => !touched.has(sortie.id)), ...touched.values()];
  const found = matchSortie(read.log, model, sorties, heliName);
  if (!found) {
    orphans.push({...read, model});
    continue;
  }
  const sortie = touched.get(found.id) ?? {...found, telemetry: [...found.telemetry]};
  sortie.telemetry.push(read.log);
  touched.set(sortie.id, sortie);
  series.push(read.series);
  lines.push(
    `  + ${name} → ${formatDay(sortie.date, {year: true})} on ${heliName(sortie.heliId)} (${describe(read.log)})`,
  );
}

// Logs of a day nobody logged: one sortie per heli and day when asked, the packs counted from the logs.
const FROM_LOGS = 'From the radio logs';
const created: Sortie[] = [];
for (const orphan of orphans) {
  const day = orphan.log.start?.slice(0, 10);
  // Of the helis named like the radio's model, one still flying first: a lost one may share its name.
  const named = orphan.model ? doc.helis.filter(one => simple(one.name).startsWith(simple(orphan.model ?? ''))) : [];
  const heli = named.find(one => one.status === 'active') ?? named[0];
  if (!flags.has('--create') || !day || !heli) {
    const why = !heli ? `no heli named like "${orphan.model}"` : `no sortie on ${heli.name} that day`;
    lines.push(`  ? ${orphan.log.name}: ${why} (${describe(orphan.log)})`);
    continue;
  }
  let sortie = created.find(one => one.date === day && one.heliId === heli.id);
  if (!sortie) {
    sortie = {
      id: newId(),
      date: day,
      heliId: heli.id,
      packs: 0,
      timer: heli.timer ?? null,
      crashes: null,
      broken: [],
      skills: [],
      notes: FROM_LOGS,
      links: [],
      telemetry: [],
      loggedAt: now(),
    };
    created.push(sortie);
  }
  sortie.telemetry.push(orphan.log);
  series.push(orphan.series);
  lines.push(
    `  + ${orphan.log.name} → new sortie, ${formatDay(day, {year: true})} on ${heli.name} (${describe(orphan.log)})`,
  );
}

console.log(lines.length ? lines.join('\n') : '  Nothing new: Flightdown has every log.');

// A sortie counts at least the packs its logs show: one logged by hand may have had more packs than logs, never fewer.
const counted = (sortie: Sortie) => groupPacks(sortie.telemetry).length;
// A sortie made from logs flew what its logs say: their time in the air over its packs (one logged by hand keeps its
// own timer).
const timed = (sortie: Sortie) =>
  sortie.notes === FROM_LOGS && sortie.telemetry.length && sortie.telemetry.every(log => log.flying !== undefined)
    ? Math.round(sortie.telemetry.reduce((sum, log) => sum + (log.flying ?? 0), 0) / Math.max(1, sortie.packs))
    : sortie.timer;
const settle = (sortie: Sortie) => {
  const packs = Math.max(sortie.packs, counted(sortie));
  return {...sortie, packs, timer: timed({...sortie, packs})};
};
for (const sortie of created) Object.assign(sortie, settle(sortie));
for (const [id, sortie] of touched) touched.set(id, settle(sortie));
if (flags.has('--recount')) {
  for (const sortie of doc.sorties) {
    const current = touched.get(sortie.id) ?? sortie;
    const settled = settle(current);
    if (settled.packs === current.packs && settled.timer === current.timer) continue;
    const day = `${formatDay(current.date, {year: true})} on ${heliName(current.heliId)}`;
    const timer = (seconds: number | null) => (seconds === null ? '-' : formatTimer(seconds));
    console.log(`  # ${day}: ${current.packs} × ${timer(current.timer)} → ${settled.packs} × ${timer(settled.timer)}`);
    touched.set(current.id, settled);
  }
}
const sortiesToWrite = [...touched.values(), ...created];
if (dryRun) {
  if (sortiesToWrite.length)
    console.log(`Dry run: would add ${series.length} logs and write ${sortiesToWrite.length} sorties.`);
  process.exit(0);
}
for (const sortie of sortiesToWrite) await putItem('sorties', sortie);
if (series.length) {
  for (const one of series) await putSeries(one);
  const added = created.reduce((sum, sortie) => sum + sortie.packs * (sortie.timer ?? 0), 0);
  console.log(
    `Added ${series.length} logs to ${sortiesToWrite.length} sorties` +
      (created.length ? `, ${created.length} of them new (${formatAirtime(added)} in the air)` : '') +
      '. Reload Flightdown to see them.',
  );
}
if (orphans.length && !flags.has('--create')) {
  console.log('Logs marked ? have no sortie: log the sortie in Flightdown first, or run again with --create.');
}
if (flags.has('--clean')) await cleanRadio();
