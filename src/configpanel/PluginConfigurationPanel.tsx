import type * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PluginOptions, RawPathConfig } from '../config.js';
import { DetectedPathList } from './components/DetectedPathList.js';
import { PriorityBanner } from './components/PriorityBanner.js';
import ThemeToggle from './components/ThemeToggle.js';
import type { DetectedRow } from './hooks/useDetected.js';
import { useDetected } from './hooks/useDetected.js';
import {
  applyAddAllCombinable,
  applyAddPath,
  applyRemovePath,
  applyUpdatePath,
  usePanelConfig,
} from './hooks/usePanelConfig.js';
import { injectStyles } from './styles.js';

interface Props {
  configuration: PluginOptions;
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

  // Form state: holds the full PluginOptions being edited.
  const { options, addPath, addAllCombinable, removePath, updatePath } = usePanelConfig(
    configuration,
    save
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
  const configByPath = new Map<string, RawPathConfig>(options.paths.map((p) => [p.path, p]));

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

  // Write actions: mutate form state then immediately persist.
  // React state updates are asynchronous, so next-state is computed
  // synchronously via the pure transitions to call save immediately.

  const handleAdd = useCallback(
    (path: string): void => {
      const next = applyAddPath(options, path);
      addPath(path);
      void Promise.resolve(save(next)).then(() => {
        refresh();
      });
    },
    [options, save, addPath, refresh]
  );

  const handleAddAll = useCallback(
    (rows: DetectedRow[]): void => {
      const next = applyAddAllCombinable(options, rows);
      addAllCombinable(rows);
      void Promise.resolve(save(next)).then(() => {
        refresh();
      });
    },
    [options, save, addAllCombinable, refresh]
  );

  const handleRemove = useCallback(
    (path: string): void => {
      const next = applyRemovePath(options, path);
      removePath(path);
      void Promise.resolve(save(next)).then(() => {
        refresh();
      });
    },
    [options, save, removePath, refresh]
  );

  const handleUpdate = useCallback(
    (path: string, patch: Partial<RawPathConfig>): void => {
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
        void Promise.resolve(save(next));
      }, 500);
    },
    [save, updatePath]
  );

  const showBanner = options.paths.length > 0 && !bannerDismissed;

  return (
    <div className="skn-panel" style={{ padding: 'var(--skn-space-3)' }}>
      {/* Panel header: title and theme toggle */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 'var(--skn-space-2)',
          marginBottom: 'var(--skn-space-3)',
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: 'var(--skn-font-display)',
            fontWeight: 700,
            color: 'var(--skn-text)',
          }}
        >
          Synthetic Values
        </h1>
        <ThemeToggle />
      </div>

      {/* Priority banner: shown once any path is combined, dismissible */}
      <PriorityBanner
        show={showBanner}
        sourceLabel="signalk-synthetic-values"
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
  );
};

export default PluginConfigurationPanel;
