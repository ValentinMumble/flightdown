/**
 * Seeds the server's log from a flight log kept in Google Sheets, once: `npm run seed`.
 *
 * Reads SEED_SHEET_ID (a sheet shared by link) or the .xlsx file given as an argument, turns it into Flightdown's log
 * (see seed/sheetImport.ts), adds the EdgeTX logs of SEED_LOGS_DIR (the radio's LOGS folder) to the sessions of
 * their day and model, and writes it all to the Upstash Redis store of .env.local, under the flightdown: keys. It
 * refuses to write over a log already there unless run with --force. --dry-run only prints what it read.
 */
import {readdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {loadEnv} from 'vite';
import {Redis} from '@upstash/redis';
import {KINDS} from '../src/types';
import {formatAirtime} from '../src/model/format';
import {airtime} from '../src/model/stats';
import {matchSession, modelFromFileName, readTelemetry} from '../src/model/telemetry';
import {parseCsv} from '../src/model/csv';
import {importSheets} from './seed/sheetImport';
import {readXlsx} from './seed/xlsx';

const flags = process.argv.slice(2).filter(argument => argument.startsWith('--'));
const file = process.argv.slice(2).find(argument => !argument.startsWith('--'));
const env = {...loadEnv('development', process.cwd(), ''), ...process.env};

async function workbook() {
  if (file) return {blob: new Blob([await readFile(file)]), name: file};
  const id = env.SEED_SHEET_ID;
  if (!id) throw new Error('Set SEED_SHEET_ID in .env.local, or pass an .xlsx file');
  const answer = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`);
  if (!answer.ok || !(answer.headers.get('content-type') ?? '').includes('spreadsheetml')) {
    throw new Error('Google did not share this sheet: set it to "Anyone with the link can view"');
  }
  return {blob: await answer.blob(), name: 'Google Sheet'};
}

const {blob, name} = await workbook();
const {doc, series, report} = importSheets(await readXlsx(blob), name);

// EdgeTX logs from the radio's SD card, each to the session of its day on the heli named like its model.
if (env.SEED_LOGS_DIR) {
  const names = (await readdir(env.SEED_LOGS_DIR)).filter(fileName => fileName.toLowerCase().endsWith('.csv')).sort();
  const heliName = (id: string) => doc.helis.find(heli => heli.id === id)?.name ?? '';
  for (const fileName of names) {
    const read = readTelemetry(parseCsv(await readFile(join(env.SEED_LOGS_DIR, fileName), 'utf8')), fileName);
    // A few seconds of a radio switched on at home is not a flight.
    if (!read || read.log.duration < 20) {
      report.skipped.push(`${fileName}: too short`);
      continue;
    }
    const session = matchSession(read.log, modelFromFileName(fileName), doc.sessions, heliName);
    if (!session) {
      report.skipped.push(`${fileName}: no session of its model that day`);
      continue;
    }
    session.telemetry.push(read.log);
    series.push(read.series);
    report.telemetry += 1;
  }
}

console.log(`Read ${report.sheet}`);
console.log(
  `  ${report.sessions} sessions, ${report.helis} helis, ${report.spots} spots, ${report.tips} notes, ${report.telemetry} telemetry logs`,
);
console.log(
  `  ${formatAirtime(
    doc.sessions.reduce((sum, session) => sum + airtime(session), 0),
    true,
  )} in the air`,
);
for (const heli of doc.helis) {
  console.log(`  ${heli.name}: ${heli.maker ?? '?'} ${heli.model ?? ''}, ${heli.status}, colour ${heli.color}`);
}
console.log(`  Spots: ${doc.spots.map(spot => `${spot.emoji ?? ''}${spot.name}`).join(', ')}`);
for (const line of report.skipped) console.log(`  Skipped ${line}`);

if (flags.includes('--dry-run')) process.exit(0);

const url = env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL;
const token = env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN;
if (!url || !token) throw new Error('Set KV_REST_API_URL and KV_REST_API_TOKEN in .env.local');
const redis = new Redis({url, token});

const existing = await redis.hlen('flightdown:sessions');
if (existing && !flags.includes('--force')) {
  throw new Error(`The store already holds ${existing} sessions: run with --force to replace them`);
}
await redis.del(...KINDS.map(kind => `flightdown:${kind}`), 'flightdown:telemetry');
for (const kind of KINDS) {
  const items = doc[kind] as {id: string}[];
  for (let start = 0; start < items.length; start += 200) {
    const chunk = items.slice(start, start + 200);
    await redis.hset(`flightdown:${kind}`, Object.fromEntries(chunk.map(item => [item.id, item])));
  }
}
for (const one of series) await redis.hset('flightdown:telemetry', {[one.id]: one});
console.log(`Wrote the log to ${new URL(url).hostname} under flightdown:*`);
