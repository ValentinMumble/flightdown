/** Thrown when Flightdown's server (or another the app asks) cannot be reached. */
export class NoConnectionError extends Error {}

export const NO_CONNECTION = 'No connection to Flightdown';

/** fetch, with a plain message when there is no network rather than the browser's own. */
export async function call(input: string, init?: RequestInit, what = NO_CONNECTION): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    throw new NoConnectionError(what);
  }
}

/** An answer's JSON. A page instead (a café's or a hotel's Wi-Fi login) is an error, never empty data shown or kept. */
export async function readAnswer<Value>(response: Response): Promise<Value> {
  try {
    return (await response.json()) as Value;
  } catch {
    throw new Error('No answer from Flightdown: check the connection');
  }
}

/** Whether an error means the network is down, to say so plainly. */
export const isOffline = (error: unknown) =>
  error instanceof NoConnectionError || error instanceof TypeError || !navigator.onLine;
