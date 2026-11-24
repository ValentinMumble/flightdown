import {KINDS, type Doc, type TelemetrySeries} from '../src/types.js';
import {handle, HttpError, json, readJson} from './_lib/http.js';
import {requireOwner} from './_lib/owner.js';
import {deleteItem, isKind, putItem, readDoc, readItem, replaceDoc} from './_lib/store.js';
import {patchItem} from '../src/model/patch.js';

/** No item comes near this: a bigger one is a mistake, not a sortie. */
const MAX_ITEM = 200_000;

/** GET /api/data: the owner's whole log (helis, spots, sorties, spares, batteries, notes, gear). */
export function GET(request: Request) {
  return handle(async () => {
    requireOwner(request);
    return json(await readDoc());
  });
}

/**
 * POST /api/data { kind, item }: adds an item or replaces the one with its id.
 * POST /api/data { type: 'patch', kind, id, fields, drop }: sets some fields of an item and takes others out.
 */
export function POST(request: Request) {
  return handle(async () => {
    requireOwner(request);
    const {type, kind, item, id, fields, drop} = await readJson(request);
    if (!isKind(kind)) throw new HttpError(400, 'Unknown kind of item');
    if (type === 'patch') {
      if (typeof id !== 'string' || !fields || typeof fields !== 'object')
        throw new HttpError(400, 'Say what to change');
      const keys = Array.isArray(drop) ? drop.filter((key): key is string => typeof key === 'string') : [];
      const current = await readItem(kind, id);
      if (!current) throw new HttpError(404, 'This item is no longer in the log');
      const next = patchItem(current, fields as Record<string, unknown>, keys);
      if (JSON.stringify(next).length > MAX_ITEM) throw new HttpError(413, 'This item is too big');
      await putItem(kind, next);
      return json({ok: true});
    }
    if (!item || typeof item !== 'object' || typeof (item as {id?: unknown}).id !== 'string') {
      throw new HttpError(400, 'An item needs an id');
    }
    if (JSON.stringify(item).length > MAX_ITEM) throw new HttpError(413, 'This item is too big');
    await putItem(kind, item as {id: string});
    return json({ok: true});
  });
}

/** DELETE /api/data?kind=sorties&id=...: removes one item. */
export function DELETE(request: Request) {
  return handle(async () => {
    requireOwner(request);
    const url = new URL(request.url);
    const kind = url.searchParams.get('kind');
    const id = url.searchParams.get('id');
    if (!isKind(kind) || !id) throw new HttpError(400, 'Say which item to delete');
    await deleteItem(kind, id);
    return json({ok: true});
  });
}

/** PUT /api/data { doc, series }: replaces the whole log, as an import does. */
export function PUT(request: Request) {
  return handle(async () => {
    requireOwner(request);
    const {doc, series} = await readJson(request);
    if (!doc || typeof doc !== 'object') throw new HttpError(400, 'Expected a log');
    const log = doc as Doc;
    for (const kind of KINDS) {
      if (!Array.isArray(log[kind])) throw new HttpError(400, `The log has no ${kind} list`);
    }
    await replaceDoc(log, Array.isArray(series) ? (series as TelemetrySeries[]) : []);
    return json({ok: true});
  });
}
