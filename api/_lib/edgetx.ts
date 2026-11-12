/**
 * edge-tx (github.com/ValentinMumble/edge-tx, public), where the radio's card lives: its sd-card/ is the card as it
 * should be, and widgets.json pairs each widget built from its src/ with its folder on the card. Read from the
 * checkout beside this one when there is one (`npm run dev`: a widget saved there shows at once, fresh from its
 * build), else from GitHub.
 */
import {existsSync} from 'node:fs';
import {readdir, readFile, stat} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {parse} from 'yaml';
import {
  EDGETX_WIDGETS,
  readModel,
  readRadio,
  registeredName,
  type Card,
  type CardWidget,
} from '../../src/radio/card.js';

const REPO = 'ValentinMumble/edge-tx';
const RAW = `https://raw.githubusercontent.com/${REPO}/main/`;
/** The models the Radio tab shows: those still flown or worth a look, in this order. */
const KEEP = ['M2 EVO', 'M4'];
/** The files of a widget the page fetches: its Lua, and the pictures it opens. */
const WIDGET_FILE = /\.(lua|png|bmp|jpe?g)$/i;

interface Source {
  /** Where it reads from, in words. */
  from: string;
  local: boolean;
  /** A file of the repo by its path, or null. */
  read(path: string): Promise<Buffer | null>;
  /** What is right in a folder of the repo (files and folders), by name; null when it cannot be listed. */
  list(folder: string): Promise<string[] | null>;
  /** When a file last changed (ms since 1970), 0 when not known: the page reloads a widget that changed. */
  changed(path: string): Promise<number>;
}

/** The widgets built in edge-tx, by the folder they go in on the card: { ArmedModel: "armed-model" }. */
async function builtFolders(source: Source): Promise<Record<string, string>> {
  const pairs = JSON.parse((await source.read('widgets.json'))?.toString('utf8') ?? '{}') as Record<string, string>;
  return Object.fromEntries(Object.entries(pairs).map(([file, folder]) => [folder, file]));
}

function localSource(root: string): Source {
  // A built widget's main.lua comes from edge-tx's output/, rebuilt on every save by `npm run dev` there.
  const fresh = async (path: string) => {
    const widget = /^sd-card\/WIDGETS\/([^/]+)\/main\.lua$/.exec(path);
    if (!widget) return path;
    const built = (await builtFolders(source))[widget[1]];
    return built && existsSync(join(root, 'output', `${built}.lua`)) ? `output/${built}.lua` : path;
  };
  const source: Source = {
    from: 'edge-tx beside this checkout',
    local: true,
    read: async path => {
      const file = join(root, await fresh(path));
      return existsSync(file) ? readFile(file) : null;
    },
    list: async folder => {
      const directory = join(root, folder);
      if (!existsSync(directory)) return null;
      return readdir(directory);
    },
    changed: async path => {
      const file = join(root, await fresh(path));
      return existsSync(file) ? (await stat(file)).mtimeMs : 0;
    },
  };
  return source;
}

// The repo's file list on GitHub, one call for the whole tree (its API allows few calls without a token), kept a
// minute while the function stays warm.
let tree: {paths: string[]; at: number} | null = null;

function githubSource(): Source {
  const paths = async () => {
    if (tree && Date.now() - tree.at < 60_000) return tree.paths;
    const answer = await fetch(`https://api.github.com/repos/${REPO}/git/trees/main?recursive=1`, {
      headers: {Accept: 'application/vnd.github+json', 'User-Agent': 'flightdown'},
    });
    if (!answer.ok) return null;
    const body = (await answer.json()) as {tree: {path: string; type: string}[]};
    tree = {paths: body.tree.filter(item => item.type === 'blob').map(item => item.path), at: Date.now()};
    return tree.paths;
  };
  return {
    from: `github.com/${REPO}`,
    local: false,
    read: async path => {
      const answer = await fetch(RAW + path.split('/').map(encodeURIComponent).join('/'));
      return answer.ok ? Buffer.from(await answer.arrayBuffer()) : null;
    },
    list: async folder => {
      const all = await paths();
      if (!all) return null;
      const prefix = `${folder}/`;
      // The first part of each path under it, once: its files and its folders.
      return [
        ...new Set(all.filter(path => path.startsWith(prefix)).map(path => path.slice(prefix.length).split('/')[0])),
      ];
    },
    changed: async () => 0,
  };
}

/** Where edge-tx is read from: the checkout beside this one, unless EDGETX_SOURCE=github or there is none. */
export function edgeTx(): Source {
  const root = resolve(process.cwd(), process.env.EDGETX_DIR ?? '../edge-tx');
  return process.env.EDGETX_SOURCE !== 'github' && existsSync(join(root, 'sd-card'))
    ? localSource(root)
    : githubSource();
}

const text = async (source: Source, path: string) => {
  const file = await source.read(path);
  if (!file) throw new Error(`edge-tx has no ${path}`);
  return file.toString('utf8');
};

/**
 * The card as the Radio tab reads it: the kept models (screens, logic), the radio's own settings, and the Lua widgets
 * the screens use (a built one marked as such).
 */
export async function readCard(source: Source): Promise<Card> {
  const labels = parse(await text(source, 'sd-card/MODELS/labels.yml')) as {Models?: Record<string, {name?: string}>};
  const files = Object.entries(labels.Models ?? {})
    .filter(([, model]) => KEEP.includes(String(model.name ?? '')))
    .map(([file]) => file);
  const models = await Promise.all(
    files.map(async file => readModel(file.replace(/\.yml$/, ''), parse(await text(source, `sd-card/MODELS/${file}`)))),
  );
  models.sort((left, right) => KEEP.indexOf(left.name) - KEEP.indexOf(right.name));

  const radioFile = await source.read('sd-card/RADIO/radio.yml');
  const radio = radioFile ? readRadio(parse(radioFile.toString('utf8'))) : undefined;

  // The Lua widgets the screens use, each found in its folder by the name it registers (FMStatus is in FlightStatus):
  // a folder of that name first, then those of the built widgets, then any.
  const used = new Set(
    models.flatMap(model =>
      [...model.screens.flatMap(screen => screen.zones), ...model.topbar].map(zone => zone.widget),
    ),
  );
  const built = await builtFolders(source);
  const folders = (await source.list('sd-card/WIDGETS')) ?? Object.keys(built);
  const names = new Map<string, string>();
  const nameOf = async (folder: string) => {
    if (!names.has(folder)) {
      const code = await source.read(`sd-card/WIDGETS/${folder}/main.lua`);
      names.set(folder, code ? (registeredName(code.toString('utf8')) ?? folder) : '');
    }
    return names.get(folder);
  };
  const widgets: CardWidget[] = [];
  for (const name of used) {
    if (!name || EDGETX_WIDGETS.includes(name)) continue;
    const candidates = [
      ...folders.filter(folder => folder.toLowerCase() === name.toLowerCase()),
      ...Object.keys(built),
      ...folders,
    ];
    let found: string | undefined;
    for (const folder of candidates) {
      if ((await nameOf(folder)) === name) {
        found = folder;
        break;
      }
    }
    if (!found) continue;
    const files = ((await source.list(`sd-card/WIDGETS/${found}`)) ?? ['main.lua']).filter(file =>
      WIDGET_FILE.test(file),
    );
    widgets.push({name, folder: found, files, ...(built[found] ? {fromEdgeTx: true} : {})});
  }
  return {from: source.from, models, widgets, ...(radio ? {radio} : {})};
}

/** The widgets built in edge-tx, as the Radio tab lists them for "One widget": their card path, name, last change. */
export async function builtWidgets(source: Source) {
  const built = await builtFolders(source);
  return Promise.all(
    Object.entries(built).map(async ([folder, file]) => {
      const path = `WIDGETS/${folder}/main.lua`;
      const code = (await source.read(`sd-card/${path}`))?.toString('utf8') ?? '';
      return {file: path, name: registeredName(code) ?? file, changed: await source.changed(`sd-card/${path}`)};
    }),
  );
}
