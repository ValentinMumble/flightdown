/** A short random id: twelve letters and digits. */
export function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, byte => 'abcdefghijklmnopqrstuvwxyz0123456789'[byte % 36]).join('');
}

export const now = () => new Date().toISOString();
