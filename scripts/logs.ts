/**
 * Brings the EdgeTX logs from the radio into Flightdown: plug the radio in (USB storage), then `npm run logs`.
 *
 * Finds the radio's SD card (a volume under /Volumes with a LOGS folder, or the folder given as an argument), copies
 * the CSV files not yet backed up to SEED_LOGS_DIR, and adds each log Flightdown does not have yet to the sortie of
 * its day flown on the heli named like the radio's model, samples included, in the Upstash Redis store of .env.local.
 * Bench checks and logs of a few seconds are left out. A log with no sortie that day is listed; with --create, the
 * logs of one heli on one day become a sortie of their own. --clean then removes from the radio the logs whose backup is
 * the same file, to free its small SD card. --dry-run only prints what it would do.
 */
import {constants} from 'node:fs';
import {copyFile, readdir, readFile, stat, unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {loadEnv} from 'vite';
import type {Session, TelemetryLog, TelemetrySeries} from '../src/types';
import {formatAirtime, formatDay, formatNumber, formatTimer} from '../src/model/format';
import {matchSession, modelFromFileName, readTelemetry, simple} from '../src/model/telemetry';
import {parseCsv} from '../src/model/csv';
import {newId, now} from '../src/model/ids';

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
const known = new Set(doc.sessions.flatMap(session => session.telemetry.map(log => log.name)));
const heliName = (id: string) => doc.helis.find(heli => heli.id === id)?.name ?? '';
const lines: string[] = [];
const orphans: {log: TelemetryLog; series: TelemetrySeries; model: string | null}[] = [];
const touched = new Map<string, Session>();
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
  const sessions = [...doc.sessions.filter(session => !touched.has(session.id)), ...touched.values()];
  const found = matchSession(read.log, model, sessions, heliName);
  if (!found) {
    orphans.push({...read, model});
    continue;
  }
  const session = touched.get(found.id) ?? {...found, telemetry: [...found.telemetry]};
  session.telemetry.push(read.log);
  touched.set(session.id, session);
  series.push(read.series);
  lines.push(
    `  + ${name} → ${formatDay(session.date, {year: true})} on ${heliName(session.heliId)} (${describe(read.log)})`,
  );
}

// Logs of a day nobody logged: one sortie per heli and day when asked, the packs counted from the logs.
const created: Session[] = [];
for (const orphan of orphans) {
  const day = orphan.log.start?.slice(0, 10);
  const heli = orphan.model
    ? doc.helis.find(one => simple(one.name).startsWith(simple(orphan.model ?? '')))
    : undefined;
  if (!flags.has('--create') || !day || !heli) {
    const why = !heli ? `no heli named like "${orphan.model}"` : `no sortie on ${heli.name} that day`;
    lines.push(`  ? ${orphan.log.name}: ${why} (${describe(orphan.log)})`);
    continue;
  }
  let session = created.find(one => one.date === day && one.heliId === heli.id);
  if (!session) {
    session = {
      id: newId(),
      date: day,
      heliId: heli.id,
      packs: 0,
      timer: heli.timer ?? null,
      crashes: null,
      broken: [],
      skills: [],
      notes: 'From the radio logs',
      links: [],
      telemetry: [],
      loggedAt: now(),
    };
    created.push(session);
  }
  session.packs += 1;
  session.telemetry.push(orphan.log);
  series.push(orphan.series);
  lines.push(
    `  + ${orphan.log.name} → new sortie, ${formatDay(day, {year: true})} on ${heli.name} (${describe(orphan.log)})`,
  );
}

console.log(lines.length ? lines.join('\n') : '  Nothing new: Flightdown has every log.');
const sessionsToWrite = [...touched.values(), ...created];
if (dryRun) {
  if (series.length) console.log(`Dry run: would add ${series.length} logs to ${sessionsToWrite.length} sorties.`);
  process.exit(0);
}
if (series.length) {
  for (const one of series) await putSeries(one);
  for (const session of sessionsToWrite) await putItem('sessions', session);
  const added = created.reduce((sum, session) => sum + session.packs * (session.timer ?? 0), 0);
  console.log(
    `Added ${series.length} logs to ${sessionsToWrite.length} sorties` +
      (created.length ? `, ${created.length} of them new (${formatAirtime(added)} in the air)` : '') +
      '. Reload Flightdown to see them.',
  );
}
if (orphans.length && !flags.has('--create')) {
  console.log('Logs marked ? have no sortie: log the sortie in Flightdown first, or run again with --create.');
}
if (flags.has('--clean')) await cleanRadio();
