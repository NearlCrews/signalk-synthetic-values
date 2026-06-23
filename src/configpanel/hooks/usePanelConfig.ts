import { useCallback, useState } from 'react';
import type { PluginOptions, RawPathConfig } from '../../config.js';
import { COMBINABLE_KINDS } from '../constants.js';
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
  const toAdd = rows.filter((r) => COMBINABLE_KINDS.has(r.kind) && !existing.has(r.path));
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
 * Merge `patch` into the entry matching `path`. Returns the same object
 * reference when the path is not present.
 */
export function applyUpdatePath(
  options: PluginOptions,
  path: string,
  patch: Partial<RawPathConfig>
): PluginOptions {
  if (!options.paths.some((p) => p.path === path)) return options;
  return {
    ...options,
    paths: options.paths.map((p) => (p.path === path ? { ...p, ...patch } : p)),
  };
}

// -- Hook API -----------------------------------------------------------------

export interface UsePanelConfigResult {
  /** Current form state: the full PluginOptions being edited. */
  options: PluginOptions;
  saving: boolean;
  /** True for a moment after a successful save, to show a confirmation. */
  saved: boolean;
  addPath: (path: string) => void;
  addAllCombinable: (rows: DetectedRow[]) => void;
  removePath: (path: string) => void;
  updatePath: (path: string, patch: Partial<RawPathConfig>) => void;
  /** Persist the current options via the host save callback. */
  commit: () => Promise<void>;
}

/**
 * Form state and save flow for the config panel.
 *
 * Holds the full `PluginOptions` (not just `paths`) so top-level defaults are
 * preserved on every save. The pure transitions (`applyAddPath`, etc.) are
 * exported separately for unit testing without a DOM renderer.
 */
export function usePanelConfig(
  configuration: PluginOptions,
  save: (config: PluginOptions) => unknown
): UsePanelConfigResult {
  const [options, setOptions] = useState<PluginOptions>(configuration);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Resync when the host supplies a new configuration object after a restart.
  const [prevConfiguration, setPrevConfiguration] = useState(configuration);
  if (prevConfiguration !== configuration) {
    setPrevConfiguration(configuration);
    setOptions(configuration);
  }

  const addPath = useCallback((path: string): void => {
    setOptions((prev) => applyAddPath(prev, path));
  }, []);

  const addAllCombinable = useCallback((rows: DetectedRow[]): void => {
    setOptions((prev) => applyAddAllCombinable(prev, rows));
  }, []);

  const removePath = useCallback((path: string): void => {
    setOptions((prev) => applyRemovePath(prev, path));
  }, []);

  const updatePath = useCallback((path: string, patch: Partial<RawPathConfig>): void => {
    setOptions((prev) => applyUpdatePath(prev, path, patch));
  }, []);

  const commit = useCallback(async (): Promise<void> => {
    setSaving(true);
    setSaved(false);
    try {
      await Promise.resolve(save(options));
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }, [options, save]);

  return { options, saving, saved, addPath, addAllCombinable, removePath, updatePath, commit };
}
