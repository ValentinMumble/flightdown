import {builtWidgets, edgeTx, readCard} from './_lib/edgetx.js';
import {handle, HttpError} from './_lib/http.js';

/** A widget's file or a model picture on the card: under WIDGETS/ or IMAGES/, never above. */
const CARD_FILE = /^(WIDGETS|IMAGES)\/[\w .-]+(\/[\w .-]+)*$/;
const TYPES: Record<string, string> = {
  lua: 'text/plain; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  bmp: 'image/bmp',
};

/**
 * GET /api/radio: the radio's card, read from edge-tx (see _lib/edgetx.ts) for the Radio tab. With ?part=widgets, the
 * widgets built in edge-tx; with ?file=WIDGETS/Pack/main.lua (or IMAGES/...), that file of the card. From GitHub, the
 * answers are kept five minutes (edge-tx changes when pushed); from the checkout beside, not at all.
 */
export function GET(request: Request) {
  return handle(async () => {
    const search = new URL(request.url).searchParams;
    const source = edgeTx();
    const cache = source.local ? 'no-store' : 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400';
    const file = search.get('file');
    if (file !== null) {
      if (!CARD_FILE.test(file) || file.includes('..')) throw new HttpError(400, 'Not a file of the card');
      const content = await source.read(`sd-card/${file}`);
      if (!content) throw new HttpError(404, `The card has no ${file}`);
      const type = TYPES[file.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
      return new Response(new Uint8Array(content), {headers: {'Content-Type': type, 'Cache-Control': cache}});
    }
    const body = search.get('part') === 'widgets' ? await builtWidgets(source) : await readCard(source);
    return Response.json(body, {headers: {'Cache-Control': cache}});
  });
}
