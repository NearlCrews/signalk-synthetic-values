// Panel-shared utilities: the API base path plus the small helpers every
// panel hook and component would otherwise re-implement. Deliberately free of
// runtime-plugin imports so the browser bundle does not drag Node-side
// constants along.

export const apiBase = '/plugins/signalk-synthetic-values/api';

/**
 * Fetch a panel API endpoint and parse the JSON body. Throws on a non-ok
 * HTTP status so callers can catch and surface the error. Network failures
 * also throw and are handled by callers.
 */
export async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${apiBase}${path}`, { credentials: 'same-origin' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** Fold an unknown thrown value into a display string. */
export function toErrorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
