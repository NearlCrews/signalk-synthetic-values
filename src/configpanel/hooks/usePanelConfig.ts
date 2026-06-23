import { useCallback, useState } from 'react';
import type { PluginOptions, RawPathConfig, RawPathConfigPatch } from '../../config.js';
import { isCombinableKind } from '../constants.js';
import type { DetectedRow } from './useDetected.js';

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
 * Append a minimal `{ path }` entry for every row whose `kind` is combinable
 * and whose path is not already present. Returns the same object reference
 * when there is nothing to add.
 */
export function applyAddAllCombinable(
  options: PluginOptions,
  rows: ReadonlyArray<DetectedRow>
): PluginOptions {
  const existing = new Set(options.paths.map((p) => p.path));
  const toAdd = rows.filter((r) => isCombinableKind(r.kind) && !existing.has(r.path));
  if (toAdd.length === 0) return options;
  const added: RawPathConfig[] = toAdd.map((r) => ({ path: r.path }));
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
      // Build a new entry starting from the existing one, then apply the patch.
      // Keys in the patch that are explicitly `undefined` are omitted from the
      // result so the plugin default re-applies (satisfies exactOptionalPropertyTypes).
      const next: RawPathConfig = { path: p.path };
      const merged = { ...p, ...patch };
      for (const k of Object.keys(merged) as Array<keyof typeof merged>) {
        if (k === 'path') continue;
        const v = merged[k];
        if (v !== undefined) {
          // The value is defined; assign it. Cast is safe because `k` and `v`
          // come from the same object so the types align.
          // biome-ignore lint/suspicious/noExplicitAny: safe cast; k and v come from the same object
          (next as any)[k] = v;
        }
      }
      return next;
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
 */
export function usePanelConfig(configuration: PluginOptions): UsePanelConfigResult {
  const [options, setOptions] = useState<PluginOptions>(configuration);

  // Resync when the host supplies a new configuration object after a restart.
  const [prevConfiguration, setPrevConfiguration] = useState(configuration);
  if (prevConfiguration !== configuration) {
    setPrevConfiguration(configuration);
    setOptions(configuration);
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
