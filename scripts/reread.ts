/**
 * Reads again every log Flightdown has from its backed-up CSV (SEED_LOGS_DIR), so what Flightdown learned to read since
 * it was added reaches it: the switches and the 6-position button, today. Each log keeps its id, its sortie and its
 * place; its samples and figures are replaced, in the Upstash Redis store of .env.local. `npm run reread`, or
 * `npm run reread -- --dry-run` to only print what it would change.
 */
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {loadEnv} from 'vite';
import type {Sortie} from '../src/types';
import {readTelemetry} from '../src/model/telemetry';
import {parseCsv} from '../src/model/csv';

const dryRun = process.argv.includes('--dry-run');
const env = {...loadEnv('development', process.cwd(), ''), ...process.env};
Object.assign(process.env, env);
const {putItem, putSeries, readDoc} = await import('../api/_lib/store');

const backup = env.SEED_LOGS_DIR?.replace(/^~(?=\/)/, process.env.HOME ?? '~');
if (!backup) throw new Error('Set SEED_LOGS_DIR in .env.local: the backed-up logs are read from there');

const doc = await readDoc();
let read = 0;
let missing = 0;
for (const sortie of doc.sorties) {
  if (!sortie.telemetry.length) continue;
  const telemetry = [];
  for (const log of sortie.telemetry) {
    const text = await readFile(join(backup, log.name), 'utf8').catch(() => null);
    const fresh = text ? readTelemetry(parseCsv(text), log.name) : null;
    if (!fresh) {
      missing += 1;
      console.log(`  ? ${log.name}: not in ${backup}, kept as it was`);
      telemetry.push(log);
      continue;
    }
    const channels = Object.keys(fresh.series.channels).length;
    console.log(
      `  ~ ${log.name}: ${channels} sensors${fresh.log.packButton ? `, button ${fresh.log.packButton}` : ''}`,
    );
    telemetry.push({...fresh.log, id: log.id});
    if (!dryRun) await putSeries({...fresh.series, id: log.id});
    read += 1;
  }
  const updated: Sortie = {...sortie, telemetry};
  if (!dryRun) await putItem('sorties', updated);
}
console.log(`${dryRun ? 'Would read' : 'Read'} ${read} logs again${missing ? `, ${missing} not backed up` : ''}.`);
