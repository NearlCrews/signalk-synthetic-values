import { useState } from 'react';
import type { PluginOptions, RawPathConfig, RawPathConfigPatch } from '../../config.js';
import { resolveTopLevel } from '../../config.js';
import { isRecord } from '../../guards.js';
import { jsonEqual } from '../api-base.js';
import type { DetectedRow } from './useDetected.js';

function isRawPathConfig(value: unknown): value is RawPathConfig {
  return isRecord(value) && typeof value.path === 'string' && value.path.trim().length > 0;
}

/**
 * Normalize the host-supplied configuration into a complete PluginOptions.
 * The Signal K admin UI passes whatever is currently saved, which on a fresh
 * install is undefined or an empty object with no `paths`. Each top-level
 * setting resolves exactly as the runtime resolves it, so a value the runtime
 * would refuse is neither shown as a default nor written back.
 */
export function normalizeOptions(configuration?: unknown): PluginOptions {
  const source = isRecord(configuration) ? configuration : {};
  return {
    // Preserve fields added by a newer plugin or hand-maintained config. The
    // panel owns only the fields below and must not erase unknown settings when
    // it writes an edited path list back through Signal K Admin.
    ...source,
    ...resolveTopLevel(source),
    paths: Array.isArray(source.paths) ? source.paths.filter(isRawPathConfig) : [],
  };
}

// Every key whose value is not undefined, in the original order, so a merged
// entry compares equal to the one it came from when nothing changed.
function definedOnly<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

// -- Pure state transitions ---------------------------------------------------
// Exported so tests can drive them directly without a DOM renderer.

/**
 * Append a minimal `{ path }` entry to `options.paths` if it is not already
 * present. Returns the same object reference when the path already exists.
 * Never mutates the input.
 */
export function applyAddPath(options: PluginOptions, path: string): PluginOptions {
  if (options.paths.some((p) => p.path === path)) return options;
  return { ...options, paths: [...options.paths, { path }] };
}

/**
 * Append a minimal `{ path }` entry for every recommended row whose path is
 * not already present. Rows the server flags as not recommended (text values,
 * per-source metadata, and unplaced angles) are skipped, so "Combine all" never
 * opts in a path that is not meaningful to average. Returns the same object
 * reference when there is nothing to add.
 */
export function applyAddAllCombinable(
  options: PluginOptions,
  rows: ReadonlyArray<DetectedRow>
): PluginOptions {
  const existing = new Set(options.paths.map((p) => p.path));
  const added: RawPathConfig[] = [];
  for (const row of rows) {
    if (!row.recommended || existing.has(row.path)) continue;
    existing.add(row.path);
    added.push({ path: row.path });
  }
  if (added.length === 0) return options;
  return { ...options, paths: [...options.paths, ...added] };
}

/**
 * Remove the entry matching `path`. Returns the same object reference when
 * the path is not present.
 */
export function applyRemovePath(options: PluginOptions, path: string): PluginOptions {
  if (!options.paths.some((p) => p.path === path)) return options;
  return { ...options, paths: options.paths.filter((p) => p.path !== path) };
}

/**
 * Merge `patch` into the entry matching `path`. A patch value of `undefined`
 * removes that key from the entry (so the plugin default re-applies). A patch
 * value of any defined type merges as before. Returns the same object
 * reference when the path is not present or the patch changes nothing, which
 * is every keystroke that leaves a number field on the value it already holds.
 */
export function applyUpdatePath(
  options: PluginOptions,
  path: string,
  patch: RawPathConfigPatch
): PluginOptions {
  const index = options.paths.findIndex((p) => p.path === path);
  const current = options.paths[index];
  if (current === undefined) return options;
  // Merge the patch over the existing entry, then drop any key the patch set to
  // `undefined` so the plugin default re-applies. RawPathConfigPatch excludes
  // `path`, so the merged entry keeps it.
  const next = definedOnly({ ...current, ...patch }) as RawPathConfig;
  if (jsonEqual(next, current)) return options;
  const paths = [...options.paths];
  paths[index] = next;
  return { ...options, paths };
}

// -- Hook API -----------------------------------------------------------------

export interface UsePanelConfigResult {
  /** Current form state: the full PluginOptions being edited. */
  options: PluginOptions;
  /**
   * Replace the form state. Every edit computes its next snapshot with a pure
   * transition above, because the save queue needs that snapshot synchronously,
   * so the hook takes the result rather than computing it a second time.
   */
  replaceOptions: (next: PluginOptions) => void;
}

/**
 * Form state for the config panel.
 *
 * Holds the full `PluginOptions` (not just `paths`) so top-level defaults are
 * preserved on every save. The pure transitions (`applyAddPath`, etc.) are
 * exported separately for unit testing without a DOM renderer.
 *
 * `lastRequestedRef` is the panel's last-requested baseline. The admin host
 * immediately echoes a panel save request back as a fresh `configuration`
 * object; comparing the incoming prop against the baseline tells a self-save
 * echo (skip, keep local edits) apart from a genuine external change (resync).
 */
export function usePanelConfig(
  configuration: unknown,
  lastRequestedRef: { current: PluginOptions }
): UsePanelConfigResult {
  const [options, setOptions] = useState<PluginOptions>(() => normalizeOptions(configuration));

  // Resync when the host supplies a genuinely new configuration (a restart or
  // an edit made outside this panel), never on a self-save echo.
  const [prevConfiguration, setPrevConfiguration] = useState(configuration);
  if (prevConfiguration !== configuration) {
    setPrevConfiguration(configuration);
    const normalized = normalizeOptions(configuration);
    if (!jsonEqual(normalized, lastRequestedRef.current)) {
      lastRequestedRef.current = normalized;
      setOptions(normalized);
    }
  }

  // A state setter is stable for the life of the component, so it is handed out as is.
  return { options, replaceOptions: setOptions };
}
