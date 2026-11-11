import {createReadStream, existsSync} from 'node:fs';
import {readdir, readFile, stat} from 'node:fs/promises';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {basename, join, resolve} from 'node:path';
import {loadEnv, type Plugin, type ViteDevServer} from 'vite';

/**
 * `npm run dev` serves the API routes of api/ itself, with the variables of .env.local, so the site runs without
 * `vercel dev`. Visitors (sample or local log) never need them: only owner mode does.
 */

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function route(server: ViteDevServer, request: IncomingMessage, url: URL): Promise<Response> {
  const name = url.pathname.slice('/api/'.length).replace(/\/$/, '');
  const root = server.config.root;
  if (!/^[a-z-]+$/.test(name) || !existsSync(`${root}/api/${name}.ts`)) {
    return Response.json({error: 'No such route'}, {status: 404});
  }
  const module = (await server.ssrLoadModule(`/api/${name}.ts`)) as Record<
    string,
    (request: Request) => Promise<Response>
  >;
  const handler = module[request.method ?? 'GET'];
  if (!handler) return Response.json({error: 'Method not allowed'}, {status: 405});
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) if (typeof value === 'string') headers.set(key, value);
  return handler(
    new Request(url, {method: request.method, headers, body: hasBody ? await readBody(request) : undefined}),
  );
}

/**
 * The variables of the .env files, put into process.env for the API routes. loadEnv lets process.env win over the
 * files, so the keys written on the last start are cleared first: a restart after an .env.local edit sees it.
 */
function applyEnv(mode: string, root: string) {
  for (const key of (process.env.FLIGHTDOWN_ENV_KEYS ?? '').split(',').filter(Boolean)) delete process.env[key];
  const fromFiles = Object.entries(loadEnv(mode, root, '')).filter(([key]) => !(key in process.env));
  Object.assign(process.env, Object.fromEntries(fromFiles), {
    FLIGHTDOWN_ENV_KEYS: fromFiles.map(([key]) => key).join(','),
  });
}

/**
 * The radio widgets, live from edge-tx's build (its `output/`, rebuilt by `npm run dev` there), so the Radio tab picks
 * up each save. Without an edge-tx checkout beside this one, the copies in public/widgets are served instead.
 */
async function serveWidgets(root: string, url: URL, response: ServerResponse) {
  const built = join(resolve(root, process.env.EDGETX_DIR ?? '../edge-tx'), 'output');
  if (!existsSync(built)) return false;
  const file = basename(url.pathname);
  if (file === 'widgets.json') {
    const files = (await readdir(built)).filter(name => name.endsWith('.lua')).sort();
    const list = await Promise.all(
      files.map(async name => {
        const path = join(built, name);
        const code = await readFile(path, 'utf8');
        // As widgetName in src/radio/widgets.ts.
        const title = /^local (?:name|NAME) = "([^"]+)"/m.exec(code)?.[1] ?? name.replace(/\.lua$/, '');
        return {file: name, name: title, changed: (await stat(path)).mtimeMs};
      }),
    );
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(list));
    return true;
  }
  const path = join(built, file);
  if (!file.endsWith('.lua') || !existsSync(path)) return false;
  response.setHeader('content-type', 'text/plain; charset=utf-8');
  createReadStream(path).pipe(response);
  return true;
}

export function localApi(mode: string): Plugin {
  return {
    name: 'flightdown-local-api',
    apply: 'serve',
    configureServer(server) {
      applyEnv(mode, server.config.root);
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
        if (url.pathname.startsWith('/widgets/')) {
          serveWidgets(server.config.root, url, response).then(served => served || next(), next);
          return;
        }
        if (!url.pathname.startsWith('/api/')) return next();
        const answer = async () => {
          const result = await route(server, request, url);
          response.statusCode = result.status;
          result.headers.forEach((value, key) => {
            if (key !== 'set-cookie') response.setHeader(key, value);
          });
          // Each cookie is its own header: setHeader with one value per cookie would keep only the last.
          const cookies = result.headers.getSetCookie();
          if (cookies.length) response.setHeader('Set-Cookie', cookies);
          response.end(Buffer.from(await result.arrayBuffer()));
        };
        answer().catch(next);
      });
    },
  };
}
