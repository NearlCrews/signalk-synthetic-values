// Panel-shared utilities: the API base path plus the small helpers every panel
// hook and component would otherwise re-implement. The plugin id comes from the
// config module, which is browser-safe and already part of the panel bundle.

import { PLUGIN_ID } from '../config.js';

const apiBase = `/plugins/${PLUGIN_ID}/api`;

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
