/**
 * Replays every logged pack through the sim as the Sim page's "Watch it" does (the log's sticks through the model's
 * outputs, the flip guide, the stand-in pilot, letting go before a marked crash), and scores how close it comes to what
 * really happened: how long each pack flies before a crash, how many of its flips and rolls it makes, and whether the
 * sim crashes where a real crash is marked. Run it after reading new logs, then tune the sim (physics.ts) or the
 * stand-in (standIn.ts) until the score is as good or better. `npm run replay`, or `npm run replay -- K110S` for one
 * heli, `-- --since 2026-11-20` for the newer packs only, `-- --quiet` for the totals, `-- --wind 0.7` to fly each pack in
 * that share of its sortie's recorded wind (Open-Meteo's at 10 m; read now for a sortie that has none yet).
 */
import {Vector3} from 'three';
import {loadEnv} from 'vite';
import {sortiePacks, joinSeries} from '../src/model/packs';
import {heliParams, restingState, step} from '../src/sim/physics';
import {loggedControls, replayStart, replayEnd} from '../src/sim/replay';
import {modelMapping} from '../src/sim/modelMixer';
import {windAt} from '../src/sim/wind';
import {fetchSortieWeather, weatherSpotFor} from '../src/model/pastWeather';
import {
  FlipGuide,
  LET_CRASH,
  motorCuts,
  standIn,
  stickManoeuvres,
  STAND_IN,
  untilCut,
  untilManoeuvre,
} from '../src/sim/standIn';

const env = {...loadEnv('development', process.cwd(), ''), ...process.env};
Object.assign(process.env, env);
const {readDoc, readSeries} = await import('../api/_lib/store');
const {edgeTx, readCard} = await import('../api/_lib/edgetx');

const args = process.argv.slice(2);
const quiet = args.includes('--quiet');
const since = args.includes('--since') ? args[args.indexOf('--since') + 1] : '2026';
const windShare = args.includes('--wind') ? Number(args[args.indexOf('--wind') + 1]) : 0;
const only = args.find(arg => !arg.startsWith('--') && arg !== since && arg !== String(windShare));
const DT = 1 / 240;

const card = await readCard(edgeTx());
const doc = await readDoc();
type Total = {lived: number; total: number; ends: number; packs: number; made: number; want: number; matched: string[]};
const totals: Record<string, Total> = {};

for (const sortie of [...doc.sorties].sort((left, right) => left.date.localeCompare(right.date))) {
  if (sortie.date < since || !sortie.telemetry.length) continue;
  const heli = doc.helis.find(one => one.id === sortie.heliId);
  const model = heli && card.models.find(one => heli.name.startsWith(one.name));
  if (!heli || !model || (only && !heli.name.startsWith(only))) continue;
  const params = heliParams(heli);
  const mapping = modelMapping(model);
  let weather = sortie.indoor ? null : (sortie.weather ?? null);
  const spot = doc.spots.find(one => one.id === sortie.spotId);
  const located = weatherSpotFor(sortie, spot, new Date('2100-01-01'));
  if (windShare && !weather && !sortie.indoor && located) weather = await fetchSortieWeather(sortie, located);
  const wind = (weather?.wind ?? 0) * windShare;
  const gusts = (weather?.gusts ?? 0) * windShare;
  const air = new Vector3();
  for (const pack of sortiePacks(sortie)) {
    const parts = await Promise.all(pack.files.map(file => readSeries(file.id)));
    if (parts.some(part => !part)) continue;
    const series = joinSeries(pack, parts as never);
    const controlsAt = (second: number) => loggedControls(series, second, mapping);
    const found = stickManoeuvres(series, controlsAt, params);
    const cuts = motorCuts(series, second => controlsAt(second).throttle);
    const crashes = (sortie.crashTimes ?? [])
      .map(time => (Date.parse(time) - Date.parse(pack.start ?? '')) / 1000)
      .filter(second => second >= 0 && second <= pack.duration + 5);
    const guide = new FlipGuide(params);
    const state = restingState(new Vector3(0, 0, -5));
    const from = replayStart(series);
    const to = replayEnd(series);
    const turned = found.map(() => 0);
    let crash = '';
    let at = to;
    for (let second = from; second < to; second += DT) {
      const logged = controlsAt(second);
      const steered = guide.steer(logged, state, second, DT, found);
      const crashing = crashes.some(real => second >= real - LET_CRASH && second <= real + 1);
      const controls = crashing
        ? logged
        : standIn(
            steered.controls,
            state,
            params,
            steered.manoeuvre,
            STAND_IN,
            untilCut(cuts, second),
            untilManoeuvre(found, second),
          );
      const events = step(state, controls, params, windAt(second, wind, gusts, air), DT, 1);
      // Each manoeuvre's turn, counted until the next one starts.
      const index = found.findIndex(
        (one, number) =>
          second >= one.from - 0.2 && second <= Math.min(one.to + 1.5, (found[number + 1]?.from ?? Infinity) - 0.2),
      );
      if (index >= 0) turned[index] += (found[index].axis === 'pitch' ? state.rates.x : state.rates.z) * DT;
      if (events.crashed) {
        crash = events.crashed;
        at = second;
        break;
      }
    }
    const made = found.reduce(
      (sum, one, index) => sum + (Math.abs(turned[index]) / (2 * Math.PI) >= one.turns - 0.2 ? one.turns : 0),
      0,
    );
    const want = found.reduce((sum, one) => sum + one.turns, 0);
    const total = (totals[heli.name] ??= {lived: 0, total: 0, ends: 0, packs: 0, made: 0, want: 0, matched: []});
    total.lived += at - from;
    total.total += to - from;
    total.packs++;
    total.made += made;
    total.want += want;
    if (!crash) total.ends++;
    const real = crashes.map(second => `${(second - from).toFixed(0)} s`).join(', ');
    if (real)
      total.matched.push(
        `${pack.start?.slice(0, 16)}: real ${real}, sim ${crash ? `${(at - from).toFixed(0)} s` : 'none'}`,
      );
    if (!quiet)
      console.log(
        `${heli.name.padEnd(10)} ${pack.start?.slice(0, 16)} ${(to - from).toFixed(0).padStart(4)} s  ` +
          `${crash ? `${crash} at ${(at - from).toFixed(0)} s` : 'flew it all'}; turns ${made}/${want}` +
          (real ? `; real crash at ${real}` : ''),
      );
  }
}
console.log('');
for (const [name, total] of Object.entries(totals)) {
  console.log(
    `${name}: ${((total.lived / total.total) * 100).toFixed(0)} % flown, ${total.ends}/${total.packs} packs to the end, ` +
      `turns ${total.made}/${total.want}`,
  );
  for (const line of total.matched) console.log(`   ${line}`);
}
