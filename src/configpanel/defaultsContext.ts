// Resolved top-level defaults, provided by the panel root and consumed by the
// per-path editors so placeholders show the value that actually applies
// (options.default*, not a hardcoded guess). A context instead of prop
// drilling: the values would otherwise thread through DetectedPathList,
// DetectedPathRow, and TuneSection just to reach PerPathSettings.

import { createContext, useContext } from 'react';
import { DEFAULT_EMIT_INTERVAL_MS, DEFAULT_MIN_SOURCES, DEFAULT_STALENESS_MS } from '../config.js';

export interface PanelDefaults {
  minSources: number;
  stalenessTimeoutMs: number;
  emitMinIntervalMs: number;
}

export const PanelDefaultsContext = createContext<PanelDefaults>({
  minSources: DEFAULT_MIN_SOURCES,
  stalenessTimeoutMs: DEFAULT_STALENESS_MS,
  emitMinIntervalMs: DEFAULT_EMIT_INTERVAL_MS,
});

export function usePanelDefaults(): PanelDefaults {
  return useContext(PanelDefaultsContext);
}
