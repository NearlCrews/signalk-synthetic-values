// Resolved top-level defaults, provided by the panel root and consumed by the
// per-path editors so placeholders show the value that actually applies
// (options.default*, not a hardcoded guess). A context instead of prop
// drilling: the values would otherwise thread through DetectedPathList,
// DetectedPathRow, and TuneSection just to reach PerPathSettings.

import { createContext, useContext } from 'react';
import {
  DEFAULT_EMIT_INTERVAL_MS,
  DEFAULT_MAX_SOURCES_PER_PATH,
  DEFAULT_MIN_SOURCES,
  DEFAULT_STALENESS_MS,
} from '../config.js';

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

export const PanelDefaultsContext = createContext<PanelDefaults>({
  minSources: DEFAULT_MIN_SOURCES,
  stalenessTimeoutMs: DEFAULT_STALENESS_MS,
  emitMinIntervalMs: DEFAULT_EMIT_INTERVAL_MS,
  maxSourcesPerPath: DEFAULT_MAX_SOURCES_PER_PATH,
});

export function usePanelDefaults(): PanelDefaults {
  return useContext(PanelDefaultsContext);
}
