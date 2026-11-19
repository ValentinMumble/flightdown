import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import react from '@vitejs/plugin-react';
import {defineConfig, type Plugin} from 'vite';
import {localApi} from './local-api.ts';

/**
 * Writes the service worker (sw/sw.js) into the build, with an id that changes with the build and the files it keeps
 * on the device: all of them, but for fonts only the Latin ones (the others come when a page needs them).
 */
const serviceWorker = (): Plugin => ({
  name: 'flightdown-service-worker',
  apply: 'build',
  enforce: 'post',
  generateBundle(_options, bundle) {
    const files = Object.keys(bundle)
      .filter(fileName => fileName.startsWith('assets/') && !fileName.endsWith('.woff'))
      .filter(fileName => !fileName.endsWith('.woff2') || /-latin(-ext)?-/.test(fileName))
      .map(fileName => `/${fileName}`)
      .sort();
    const page = bundle['index.html'];
    const pageSource = page && 'asset' === page.type ? String(page.source) : String(Date.now());
    const build = createHash('sha256').update(files.join('\n')).update(pageSource).digest('hex').slice(0, 12);
    const source = readFileSync('sw/sw.js', 'utf8')
      .replace('__BUILD__', build)
      .replace(/\[\s*\/\* FILES \*\/\s*\]/, JSON.stringify(files));
    this.emitFile({type: 'asset', fileName: 'sw.js', source});
  },
});

// https://vite.dev/config/
export default defineConfig(({mode}) => ({
  // `npm run dev` also answers /api/* from api/, with the variables of .env.local (see local-api.ts).
  plugins: [react(), localApi(mode), serviceWorker()],
  // Retrospin, Retroreel and Tillroll use 5190 to 5192: they can all run side by side.
  server: {host: '127.0.0.1', port: 5194, strictPort: true},
}));
