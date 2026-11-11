/**
 * Fills the Radio tab: the widgets built in edge-tx (`npm run build` there) into public/widgets, and from the radio's
 * SD card (mounted as "NO NAME", or else edge-tx's latest backup of it, or the folder given) every model's screens,
 * the Lua widgets they use and the model pictures, into public/radio. `npm run dev` reads edge-tx's widgets live
 * instead (see local-api.ts); the card is read when this runs.
 *
 * Only the models named in KEEP go in.
 *
 *   npm run radio                  the card if mounted, else the latest backup
 *   npm run radio -- <sd folder>   another copy of the card (CARD_FROM names it in the tab)
 */
import {existsSync} from 'node:fs';
import {copyFile, mkdir, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {parse} from 'yaml';
import {EDGETX_WIDGETS, readModel, registeredName, type Card, type CardWidget} from '../src/radio/card';
import {widgetName, type WidgetFile} from '../src/radio/widgets';

const root = resolve(import.meta.dirname, '..');
const edgeTx = resolve(root, process.env.EDGETX_DIR ?? '../edge-tx');
const MOUNTED = '/Volumes/NO NAME';
/** The models the Radio tab shows: those still flown or worth a look, not the card's old ones. */
const KEEP = ['M2 EVO', 'M4'];

async function builtWidgets() {
  const built = join(edgeTx, 'output');
  const target = join(root, 'public/widgets');
  const files = (await readdir(built)).filter(file => file.endsWith('.lua')).sort();
  if (!files.length) throw new Error(`No widget in ${built}: run npm run build in edge-tx first`);
  await rm(target, {recursive: true, force: true});
  await mkdir(target, {recursive: true});
  const list: (WidgetFile & {code: string})[] = [];
  for (const file of files) {
    const code = await readFile(join(built, file), 'utf8');
    await copyFile(join(built, file), join(target, file));
    list.push({file, name: widgetName(code, file), changed: 0, code});
  }
  await writeFile(
    join(target, 'widgets.json'),
    `${JSON.stringify(
      list.map(({code: _code, ...widget}) => widget),
      null,
      2,
    )}\n`,
  );
  console.log(`Built widgets: ${list.map(widget => widget.name).join(', ')}`);
  return list;
}

/** The card: given, mounted, or the newest backup in edge-tx/backups. */
async function cardFolder() {
  if (process.argv[2]) return resolve(process.argv[2]);
  if (existsSync(join(MOUNTED, 'MODELS'))) return MOUNTED;
  const backups = (await readdir(join(edgeTx, 'backups'))).filter(name => /^\d{4}-\d{2}-\d{2}$/.test(name)).sort();
  for (const name of backups.reverse()) {
    const folder = join(edgeTx, 'backups', name, 'sdcard');
    if (existsSync(join(folder, 'MODELS'))) return folder;
  }
  throw new Error('No radio card: plug the radio in as USB storage, or give a folder');
}

/** A file in a folder whatever its case (a model asks for "XK_K123.Png"). */
async function findFile(folder: string, name: string) {
  if (!existsSync(folder)) return null;
  const found = (await readdir(folder)).find(file => file.toLowerCase() === name.toLowerCase());
  return found ? join(folder, found) : null;
}

const built = await builtWidgets();
const card = await cardFolder();
const target = join(root, 'public/radio');
await rm(target, {recursive: true, force: true});
await mkdir(join(target, 'images'), {recursive: true});

const modelFiles = (await readdir(join(card, 'MODELS')))
  .filter(file => /^model\d+\.yml$/.test(file))
  .sort((left, right) => Number(left.match(/\d+/)?.[0]) - Number(right.match(/\d+/)?.[0]));
const models = [];
for (const file of modelFiles) {
  try {
    const model = readModel(file.replace(/\.yml$/, ''), parse(await readFile(join(card, 'MODELS', file), 'utf8')));
    if (KEEP.includes(model.name)) models.push(model);
  } catch (error) {
    console.warn(`${file}: not read (${(error as Error).message})`);
  }
}

// The Lua widgets the screens use, from the card; one built in edge-tx under the same name takes its place.
const used = new Set(models.flatMap(model => [...model.screens.flatMap(screen => screen.zones), ...model.topbar]));
const usedNames = new Set([...used].map(zone => zone.widget));
const widgets: CardWidget[] = [];
const folders = existsSync(join(card, 'WIDGETS')) ? await readdir(join(card, 'WIDGETS')) : [];
for (const folder of folders) {
  const main = join(card, 'WIDGETS', folder, 'main.lua');
  if (!existsSync(main)) continue;
  const name = registeredName(await readFile(main, 'utf8'));
  if (!name || !usedNames.has(name)) continue;
  const files = (await readdir(join(card, 'WIDGETS', folder))).filter(file => /\.(lua|png|bmp|jpe?g)$/i.test(file));
  await mkdir(join(target, 'widgets', folder), {recursive: true});
  for (const file of files) await copyFile(join(card, 'WIDGETS', folder, file), join(target, 'widgets', folder, file));
  const ours = built.find(widget => widget.name === name);
  if (ours) await writeFile(join(target, 'widgets', folder, 'main.lua'), ours.code);
  widgets.push({name, folder, files, ...(ours ? {fromEdgeTx: true} : {})});
}

// Widgets a kept screen uses that are not on the card yet but are built in edge-tx: they go on the radio next. Not one
// of EdgeTX's own: a Lua widget of that name is not on the radio, its built-in one is.
for (const name of usedNames) {
  if (EDGETX_WIDGETS.includes(name) || widgets.some(widget => widget.name === name)) continue;
  const ours = built.find(widget => widget.name === name);
  if (!ours) continue;
  await mkdir(join(target, 'widgets', name), {recursive: true});
  await writeFile(join(target, 'widgets', name, 'main.lua'), ours.code);
  widgets.push({name, folder: name, files: ['main.lua'], fromEdgeTx: true});
}

let pictures = 0;
for (const bitmap of new Set(models.map(model => model.bitmap).filter(Boolean))) {
  const found = await findFile(join(card, 'IMAGES'), bitmap);
  if (!found) continue;
  await copyFile(found, join(target, 'images', bitmap));
  pictures += 1;
}

// In the order of KEEP: the heli flown now first.
models.sort((left, right) => KEEP.indexOf(left.name) - KEEP.indexOf(right.name));
const result: Card = {from: process.env.CARD_FROM ?? card.replace(`${edgeTx}/`, 'edge-tx/'), models, widgets};
await writeFile(join(target, 'card.json'), `${JSON.stringify(result)}\n`);
console.log(
  `Card ${result.from}: ${models.length} models, Lua widgets ${widgets.map(widget => widget.name).join(', ')}, ` +
    `${pictures} pictures`,
);
