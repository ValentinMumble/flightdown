/**
 * Lifts every heli photo out of its background with Apple's Vision framework, on this Mac: `npm run cutouts`.
 *
 * Product photos on white are cut out in the page too, but a white canopy that meets the white paper with no edge goes
 * with it. Vision sees the heli itself. For each heli photo not lifted yet, this downloads it, runs
 * scripts/cutout/lift.swift and keeps the PNG in the Upstash Redis store of .env.local (flightdown:cutouts, by photo
 * URL), where /api/photo serves it. Cutouts of photos no heli uses any more are removed. --force lifts them all again.
 */
import {execFile} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {loadEnv} from 'vite';
import type {Heli} from '../src/types';

const run = promisify(execFile);
const force = process.argv.includes('--force');
Object.assign(process.env, {...loadEnv('development', process.cwd(), ''), ...process.env});
const {CUTOUTS, kindKey, redis} = await import('../api/_lib/store');

const store = redis();
const helis = (await store.hvals(kindKey('helis'))) as Heli[];
const photos = new Map(helis.filter(heli => heli.photo).map(heli => [heli.photo!, heli.name]));
const lifted = new Set(await store.hkeys(CUTOUTS));

const unused = [...lifted].filter(photo => !photos.has(photo));
if (unused.length) {
  await store.hdel(CUTOUTS, ...unused);
  console.log(`Removed ${unused.length} cutouts no heli uses any more`);
}

// Each download in a folder of its own: it is only ever read as an image.
const folder = await mkdtemp(join(tmpdir(), 'flightdown-cutouts-'));
try {
  for (const [photo, name] of photos) {
    if (lifted.has(photo) && !force) {
      console.log(`  · ${name}: already lifted`);
      continue;
    }
    const answer = await fetch(photo, {headers: {'User-Agent': 'Mozilla/5.0 (Flightdown)'}});
    if (!answer.ok || !(answer.headers.get('content-type') ?? '').startsWith('image/')) {
      console.log(`  ? ${name}: the photo could not be downloaded (${answer.status})`);
      continue;
    }
    const source = join(folder, `${lifted.size}-${Date.now()}`);
    const target = `${source}.png`;
    await writeFile(source, Buffer.from(await answer.arrayBuffer()));
    try {
      const {stdout} = await run('swift', [join(import.meta.dirname, 'cutout', 'lift.swift'), source, target]);
      const png = await readFile(target);
      await store.hset(CUTOUTS, {[photo]: png.toString('base64')});
      console.log(`  + ${name}: ${stdout.trim()}, ${Math.round(png.length / 1000)} KB`);
    } catch (failure) {
      console.log(`  ? ${name}: Vision found no heli in the photo (${(failure as Error).message.split('\n')[0]})`);
    }
  }
} finally {
  await rm(folder, {recursive: true, force: true});
}
console.log('Reload Flightdown to see them.');
