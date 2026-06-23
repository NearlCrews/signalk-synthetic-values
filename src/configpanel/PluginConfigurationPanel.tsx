import type * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import type { PluginOptions, RawPathConfig } from '../config.js';
import { DetectedPathList } from './components/DetectedPathList.js';
import { PriorityBanner } from './components/PriorityBanner.js';
import ThemeToggle from './components/ThemeToggle.js';
import type { DetectedRow } from './hooks/useDetected.js';
import { useDetected } from './hooks/useDetected.js';
import { usePanelConfig } from './hooks/usePanelConfig.js';
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

  // Write actions: mutate form state then immediately persist.

  const handleAdd = useCallback(
    (path: string): void => {
      addPath(path);
      // commit reads the updated state via the hook's internal closure, but
      // since addPath is synchronous React state, we need the updated options.
      // usePanelConfig exposes commit which always reads the latest options via
      // its own useCallback closure over options. We call commit() which will
      // pick up the freshly added path in the next micro-task render cycle.
      // To be safe, we construct the next options directly and call save.
      const next: PluginOptions = {
        ...options,
        paths: options.paths.some((p) => p.path === path)
          ? options.paths
          : [...options.paths, { path }],
      };
      void Promise.resolve(save(next)).then(() => {
        refresh();
      });
    },
    [options, save, addPath, refresh]
  );

  const handleAddAll = useCallback(
    (rows: DetectedRow[]): void => {
      addAllCombinable(rows);
      const existing = new Set(options.paths.map((p) => p.path));
      const toAdd = rows
        .filter((r) => !existing.has(r.path))
        .map((r): RawPathConfig => ({ path: r.path }));
      const next: PluginOptions = {
        ...options,
        paths: [...options.paths, ...toAdd],
      };
      void Promise.resolve(save(next)).then(() => {
        refresh();
      });
    },
    [options, save, addAllCombinable, refresh]
  );

  const handleRemove = useCallback(
    (path: string): void => {
      removePath(path);
      const next: PluginOptions = {
        ...options,
        paths: options.paths.filter((p) => p.path !== path),
      };
      void Promise.resolve(save(next)).then(() => {
        refresh();
      });
    },
    [options, save, removePath, refresh]
  );

  const handleUpdate = useCallback(
    (path: string, patch: Partial<RawPathConfig>): void => {
      updatePath(path, patch);
    },
    [updatePath]
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
