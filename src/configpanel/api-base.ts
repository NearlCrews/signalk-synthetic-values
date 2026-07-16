// Panel-shared utilities: the API base path plus the small helpers every
// panel hook and component would otherwise re-implement. Deliberately free of
// runtime-plugin imports so the browser bundle does not drag Node-side
// constants along.

const apiBase = '/plugins/signalk-synthetic-values/api';

// The source name the plugin publishes combined values under. Shared by the
// priority banner and the per-row priority instruction so the two cannot drift.
export const PLUGIN_SOURCE_LABEL = 'signalk-synthetic-values';

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

/** Structural equality by JSON serialization, for change-gating panel state. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
