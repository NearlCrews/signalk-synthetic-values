// Resolved top-level defaults, provided by the panel root and consumed by the
// per-path editors so placeholders show the value that actually applies
// (options.default*, not a hardcoded guess). A context instead of prop
// drilling: the values would otherwise thread through DetectedPathList,
// DetectedPathRow, and TuneSection just to reach PerPathSettings.

import { createContext, useContext } from 'react';
import { resolveTopLevel } from '../config.js';

export interface PanelDefaults {
  minSources: number;
  stalenessTimeoutMs: number;
  emitMinIntervalMs: number;
  /**
   * The runtime drops a path whose minSources exceeds this, so the Minimum
   * sources field needs it as a max rather than letting the value reach the
   * plugin and silently delete the entry.
   */
  maxSourcesPerPath: number;
}

/** The defaults a configuration's top-level settings resolve to. */
export function panelDefaultsOf(options: {
  defaultMinSources: number;
  defaultStalenessTimeoutMs: number;
  defaultEmitMinIntervalMs: number;
  maxSourcesPerPath: number;
}): PanelDefaults {
  return {
    minSources: options.defaultMinSources,
    stalenessTimeoutMs: options.defaultStalenessTimeoutMs,
    emitMinIntervalMs: options.defaultEmitMinIntervalMs,
    maxSourcesPerPath: options.maxSourcesPerPath,
  };
}

export const PanelDefaultsContext = createContext<PanelDefaults>(
  panelDefaultsOf(resolveTopLevel({}))
);

export function usePanelDefaults(): PanelDefaults {
  return useContext(PanelDefaultsContext);
}
