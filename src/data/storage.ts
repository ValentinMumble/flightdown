// This browser's storage, for what the app keeps on the device. Any of these can fail (private browsing, storage full or
// turned off): a read then finds nothing, a write says it was not kept, and the app carries on.

/** The value kept under this key, or null when there is none or it cannot be read. */
export function readJson<Value>(key: string): Value | null {
  try {
    const text = localStorage.getItem(key);
    return text ? (JSON.parse(text) as Value) : null;
  } catch {
    return null;
  }
}

/** Keeps a value under this key: whether it was kept. */
export function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** The text kept under this key, or null. */
export function readText(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Keeps a text under this key, or drops the key for null: whether it was done. */
export function writeText(key: string, text: string | null): boolean {
  try {
    if (text === null) localStorage.removeItem(key);
    else localStorage.setItem(key, text);
    return true;
  } catch {
    return false;
  }
}

export function forget(key: string) {
  writeText(key, null);
}
