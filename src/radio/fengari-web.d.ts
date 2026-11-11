/** The little of fengari-web the radio preview uses: Lua source in, a callable function out. */
declare module 'fengari-web' {
  export function load(source: string, chunkname?: string): (...args: unknown[]) => unknown;
}
