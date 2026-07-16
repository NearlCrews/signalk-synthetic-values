import { useCallback, useState } from 'react';
import type { PluginOptions, RawPathConfig, RawPathConfigPatch } from '../../config.js';
import {
  DEFAULT_EMIT_INTERVAL_MS,
  DEFAULT_MAX_SOURCES_PER_PATH,
  DEFAULT_MIN_SOURCES,
  DEFAULT_STALENESS_MS,
} from '../../config.js';
import { jsonEqual } from '../api-base.js';
import { type DetectedRow, isRecommendedCombinable } from './useDetected.js';

/**
 * Normalize the host-supplied configuration into a complete PluginOptions.
 * The Signal K admin UI passes whatever is currently saved, which on a fresh
 * install is undefined or an empty object with no `paths`. Every field is
 * defaulted here to the same values the schema and validateConfig use, so the
 * panel never reads `paths` off undefined.
 */
export function normalizeOptions(configuration?: Partial<PluginOptions> | null): PluginOptions {
  return {
    defaultStalenessTimeoutMs: configuration?.defaultStalenessTimeoutMs ?? DEFAULT_STALENESS_MS,
    defaultEmitMinIntervalMs: configuration?.defaultEmitMinIntervalMs ?? DEFAULT_EMIT_INTERVAL_MS,
    defaultMinSources: configuration?.defaultMinSources ?? DEFAULT_MIN_SOURCES,
    maxSourcesPerPath: configuration?.maxSourcesPerPath ?? DEFAULT_MAX_SOURCES_PER_PATH,
    paths: configuration?.paths ?? [],
  };
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
 * not already present. Rows the server flags as not recommended (text values
 * and GNSS fix metadata) are skipped, so "Combine all" never opts in a path
 * that is not meaningful to average. Returns the same object reference when
 * there is nothing to add.
 */
export function applyAddAllCombinable(
  options: PluginOptions,
  rows: ReadonlyArray<DetectedRow>
): PluginOptions {
  const existing = new Set(options.paths.map((p) => p.path));
  const added: RawPathConfig[] = [];
  for (const row of rows) {
    if (!isRecommendedCombinable(row) || existing.has(row.path)) continue;
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
 * reference when the path is not present.
 */
export function applyUpdatePath(
  options: PluginOptions,
  path: string,
  patch: RawPathConfigPatch
): PluginOptions {
  if (!options.paths.some((p) => p.path === path)) return options;
  return {
    ...options,
    paths: options.paths.map((p) => {
      if (p.path !== path) return p;
      // Merge the patch over the existing entry, then drop any key the patch set
      // to `undefined` so the plugin default re-applies (satisfies
      // exactOptionalPropertyTypes). RawPathConfigPatch excludes `path`.
      const next = { ...p, ...patch } as Record<string, unknown>;
      for (const k of Object.keys(next)) {
        if (next[k] === undefined) delete next[k];
      }
      return next as unknown as RawPathConfig;
    }),
  };
}

// -- Hook API -----------------------------------------------------------------

export interface UsePanelConfigResult {
  /** Current form state: the full PluginOptions being edited. */
  options: PluginOptions;
  addPath: (path: string) => void;
  addAllCombinable: (rows: ReadonlyArray<DetectedRow>) => void;
  removePath: (path: string) => void;
  updatePath: (path: string, patch: RawPathConfigPatch) => void;
}

/**
 * Form state and save flow for the config panel.
 *
 * Holds the full `PluginOptions` (not just `paths`) so top-level defaults are
 * preserved on every save. The pure transitions (`applyAddPath`, etc.) are
 * exported separately for unit testing without a DOM renderer.
 *
 * `lastSavedRef` is the panel's last-saved baseline. The admin host echoes a
 * panel save back as a fresh `configuration` object; comparing the incoming
 * prop against the baseline tells a self-save echo (skip, keep local edits)
 * apart from a genuine external change (resync).
 */
export function usePanelConfig(
  configuration: Partial<PluginOptions> | null | undefined,
  lastSavedRef: { current: PluginOptions }
): UsePanelConfigResult {
  const [options, setOptions] = useState<PluginOptions>(() => normalizeOptions(configuration));

  // Resync when the host supplies a genuinely new configuration (a restart or
  // an edit made outside this panel), never on a self-save echo.
  const [prevConfiguration, setPrevConfiguration] = useState(configuration);
  if (prevConfiguration !== configuration) {
    setPrevConfiguration(configuration);
    const normalized = normalizeOptions(configuration);
    if (!jsonEqual(normalized, lastSavedRef.current)) {
      lastSavedRef.current = normalized;
      setOptions(normalized);
    }
  }

  const addPath = useCallback((path: string): void => {
    setOptions((prev) => applyAddPath(prev, path));
  }, []);

  const addAllCombinable = useCallback((rows: ReadonlyArray<DetectedRow>): void => {
    setOptions((prev) => applyAddAllCombinable(prev, rows));
  }, []);

  const removePath = useCallback((path: string): void => {
    setOptions((prev) => applyRemovePath(prev, path));
  }, []);

  const updatePath = useCallback((path: string, patch: RawPathConfigPatch): void => {
    setOptions((prev) => applyUpdatePath(prev, path, patch));
  }, []);

  return { options, addPath, addAllCombinable, removePath, updatePath };
}
