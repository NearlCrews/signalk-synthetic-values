import type * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PluginOptions, RawPathConfig, RawPathConfigPatch } from '../config.js';
import { jsonEqual, PLUGIN_SOURCE_LABEL } from './api-base.js';
import { DetectedPathList } from './components/DetectedPathList.js';
import { PriorityBanner } from './components/PriorityBanner.js';
import ThemeToggle from './components/ThemeToggle.js';
import { PanelDefaultsContext } from './defaultsContext.js';
import type { DetectedRow } from './hooks/useDetected.js';
import { useDetected } from './hooks/useDetected.js';
import {
  applyAddAllCombinable,
  applyAddPath,
  applyRemovePath,
  applyUpdatePath,
  normalizeOptions,
  usePanelConfig,
} from './hooks/usePanelConfig.js';
import { injectStyles, S } from './styles.js';

interface Props {
  // The Signal K admin UI passes whatever is saved, which on a fresh install is
  // undefined or an empty object, so this is treated as a partial.
  configuration?: Partial<PluginOptions> | null;
  save: (config: PluginOptions) => unknown;
}

/**
 * Composition root for the synthetic-values config panel.
 *
 * Mounts inside the Signal K admin UI. Injects CSS tokens once, wraps
 * everything in `.skn-panel` so the token cascade applies, and wires the
 * form-state hook (usePanelConfig) together with the live-detection hook
 * (useDetected) and the UI components (DetectedPathList, PriorityBanner,
 * ThemeToggle).
 *
 * Every write action (add, add-all, remove) immediately commits so the panel
 * matches the spec: "clicking Combine writes config immediately; the row flips
 * to Combined in place."
 */
const PluginConfigurationPanel: React.FC<Props> = ({ configuration, save }) => {
  // Inject CSS tokens once on mount. Safe to call multiple times.
  useEffect(() => {
    injectStyles();
  }, []);

  // Ref that always holds the last successfully saved options, used by the
  // no-op save gate and by the hook's self-save echo detection. Normalized so
  // a fresh install (undefined or empty configuration) starts from a complete
  // options object.
  const savedOptionsRef = useRef<PluginOptions>(normalizeOptions(configuration));

  // Form state: holds the full PluginOptions being edited.
  const { options, addPath, addAllCombinable, removePath, updatePath } = usePanelConfig(
    configuration,
    savedOptionsRef
  );

  // Live detection: polls /api/detected every 10 s.
  const { paths: detected, lastChecked, loading, error, refresh } = useDetected();

  // Priority banner dismiss state.
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const handleDismiss = useCallback(() => {
    setBannerDismissed(true);
  }, []);

  // Build a Map<path, RawPathConfig> from the current form state so
  // DetectedPathList can reconcile local edits against the server optedIn field.
  // Memoized so the reference is stable when options.paths hasn't changed,
  // avoiding spurious re-renders of DetectedPathList.
  const configByPath = useMemo(
    () => new Map<string, RawPathConfig>(options.paths.map((p) => [p.path, p])),
    [options.paths]
  );

  // Always-current ref to options, so the debounced save callback reads the
  // latest state rather than a stale closure.
  const optionsRef = useRef<PluginOptions>(options);
  optionsRef.current = options;

  // Debounce timer ref for tuning saves (handleUpdate).
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the debounce timer on unmount so no stale save fires.
  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, []);

  // Save failure surface: null while saves succeed, a message after a failure.
  const [saveError, setSaveError] = useState<string | null>(null);
  // Serialize writes so an older request can never finish after a newer one and
  // overwrite its configuration or saved-state baseline.
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  // Write actions: mutate form state then immediately persist.
  // React state updates are asynchronous, so next-state is computed
  // synchronously via the pure transitions to call save immediately.

  // Record `next` as the saved baseline and save it. On failure, roll the
  // baseline back so the change is not masked as already saved (the no-op
  // gate would otherwise swallow the retry), and surface the error.
  const saveWithBaseline = useCallback(
    (next: PluginOptions, onSaved?: () => void): void => {
      const run = async (): Promise<void> => {
        const prevSaved = savedOptionsRef.current;
        // Advance optimistically so a host echo delivered before save() settles
        // is recognized as our own write and does not wipe newer local edits.
        savedOptionsRef.current = next;
        try {
          await save(next);
          setSaveError(null);
          onSaved?.();
        } catch {
          savedOptionsRef.current = prevSaved;
          setSaveError('Could not save the configuration.');
        }
      };
      saveQueueRef.current = saveQueueRef.current.then(run, run);
    },
    [save]
  );

  // Commit a new options object: save it, then refresh detection once the save
  // settles. Shared by every immediate-write action so the save-then-refresh
  // sequence lives in one place.
  const persist = useCallback(
    (next: PluginOptions): void => {
      saveWithBaseline(next, refresh);
    },
    [saveWithBaseline, refresh]
  );

  const handleRetrySave = useCallback((): void => {
    persist(optionsRef.current);
  }, [persist]);

  const handleAdd = useCallback(
    (path: string): void => {
      const next = applyAddPath(optionsRef.current, path);
      // Advance the ref immediately so a second write action dispatched before
      // React re-renders reads this change instead of the stale snapshot.
      optionsRef.current = next;
      addPath(path);
      persist(next);
    },
    [persist, addPath]
  );

  const handleAddAll = useCallback(
    (rows: DetectedRow[]): void => {
      const next = applyAddAllCombinable(optionsRef.current, rows);
      optionsRef.current = next;
      addAllCombinable(rows);
      persist(next);
    },
    [persist, addAllCombinable]
  );

  const handleRemove = useCallback(
    (path: string): void => {
      const next = applyRemovePath(optionsRef.current, path);
      optionsRef.current = next;
      removePath(path);
      persist(next);
    },
    [persist, removePath]
  );

  // handleUpdate updates local state immediately so the input feels responsive,
  // then coalesces rapid edits (e.g. typing a number digit by digit) into a
  // single save call after the user pauses. This avoids restarting the plugin
  // on every keystroke, which would disrupt live data collection.
  const handleUpdate = useCallback(
    (path: string, patch: RawPathConfigPatch): void => {
      // Update local state immediately for responsive UI.
      updatePath(path, patch);
      // Debounce the persist call so rapid number-input keystrokes do not
      // trigger a plugin restart on every character.
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        // optionsRef.current is always the latest React state, avoiding a
        // stale closure. Apply the patch and persist the full PluginOptions.
        const next = applyUpdatePath(optionsRef.current, path, patch);
        // Skip saving when nothing actually changed to avoid a pointless
        // plugin restart.
        if (jsonEqual(next, savedOptionsRef.current)) return;
        optionsRef.current = next;
        saveWithBaseline(next);
      }, 500);
    },
    [saveWithBaseline, updatePath]
  );

  // A plugin with no saved configuration is "Unconfigured" and disabled. Since
  // this custom configurator replaces the Signal K admin form (including its
  // enable and submit chrome), the only way to enable the plugin is to save a
  // configuration from here. With no detected paths to opt in, there would be
  // nothing to click, so an explicit "Enable plugin" action saves a default
  // empty config, which enables the plugin and starts detection. `enabledHere`
  // hides the prompt immediately after the click, before the host re-supplies
  // the configuration prop.
  const [enabledHere, setEnabledHere] = useState(false);
  const handleEnable = useCallback((): void => {
    setEnabledHere(true);
    persist(optionsRef.current);
  }, [persist]);
  const unconfigured = configuration == null && !enabledHere;

  const showBanner = options.paths.length > 0 && !bannerDismissed;

  // Resolved top-level defaults for the per-path editors' placeholders.
  const panelDefaults = useMemo(
    () => ({
      minSources: options.defaultMinSources,
      stalenessTimeoutMs: options.defaultStalenessTimeoutMs,
      emitMinIntervalMs: options.defaultEmitMinIntervalMs,
    }),
    [options.defaultMinSources, options.defaultStalenessTimeoutMs, options.defaultEmitMinIntervalMs]
  );

  return (
    <PanelDefaultsContext.Provider value={panelDefaults}>
      <div className="skn-panel" style={{ padding: 'var(--skn-space-3)' }}>
        {/* Panel header: title and theme toggle */}
        <div style={S.panelHeader}>
          <h1 style={S.panelTitle}>Synthetic Values</h1>
          <ThemeToggle />
        </div>

        {/* Save failure: baseline already rolled back, retry re-sends the form state. */}
        {saveError !== null && (
          <div style={{ ...S.errorBanner, marginBottom: 'var(--skn-space-2)' }} role="alert">
            <span style={{ flex: 1 }}>{saveError}</span>
            <button type="button" style={S.btnRetry} onClick={handleRetrySave}>
              Retry
            </button>
          </div>
        )}

        {/* Enable prompt: the only save trigger when the plugin is unconfigured */}
        {unconfigured && (
          <section
            aria-label="Enable plugin"
            style={{ ...S.infoBanner, marginBottom: 'var(--skn-space-3)' }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong>This plugin is not enabled yet.</strong> Enabling it saves a default
              configuration and starts watching your data for paths reported by two or more sources.
              Nothing is combined until you opt a path in.
            </div>
            <button type="button" style={S.btnPrimary} onClick={handleEnable}>
              Enable plugin
            </button>
          </section>
        )}

        {/* Priority banner: shown once any path is combined, dismissible */}
        <PriorityBanner
          show={showBanner}
          sourceLabel={PLUGIN_SOURCE_LABEL}
          onDismiss={handleDismiss}
        />

        {/* Detected paths list */}
        <DetectedPathList
          detected={detected}
          configByPath={configByPath}
          onAdd={handleAdd}
          onAddAll={handleAddAll}
          onRemove={handleRemove}
          onUpdate={handleUpdate}
          lastChecked={lastChecked}
          loading={loading}
          error={error}
          onRefresh={refresh}
        />
      </div>
    </PanelDefaultsContext.Provider>
  );
};

export default PluginConfigurationPanel;
