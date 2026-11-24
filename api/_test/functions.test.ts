import {readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

// Vercel's Hobby plan refuses a deployment with more than 12 functions, after a build that passed.
const MAX_FUNCTIONS = 12;

/** Every function Vercel makes of api/: its .ts files, outside the folders starting with an underscore. */
const functionsIn = (folder: string): string[] =>
  readdirSync(folder, {withFileTypes: true}).flatMap(entry =>
    entry.name.startsWith('_')
      ? []
      : entry.isDirectory()
        ? functionsIn(join(folder, entry.name))
        : entry.name.endsWith('.ts')
          ? [join(folder, entry.name)]
          : [],
  );

describe('functions', () => {
  it(`stay within the ${MAX_FUNCTIONS} a Hobby deployment takes`, () => {
    const functions = functionsIn(fileURLToPath(new URL('..', import.meta.url)));
    expect(functions.length).toBeGreaterThan(0);
    expect(functions.length).toBeLessThanOrEqual(MAX_FUNCTIONS);
  });
});
