import type * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Banner,
  Button,
  Cluster,
  PanelRoot,
  Stack,
  supportsNativeCssScope,
  ThemeToggle,
  UnsupportedBrowserNotice,
} from 'signalk-nearlcrews-ui';
import type { PluginOptions, RawPathConfig, RawPathConfigPatch } from '../config.js';
import { jsonEqual, PLUGIN_SOURCE_LABEL } from './api-base.js';
import { DetectedPathList } from './components/DetectedPathList.js';
import { PriorityBanner } from './components/PriorityBanner.js';
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
import styles from './PluginConfigurationPanel.module.css';

interface Props {
  // The Signal K admin UI passes whatever is saved, which on a fresh install is
  // undefined or an empty object. Treat it as an open record so a panel save
  // can preserve fields introduced by newer plugin versions.
  configuration?: unknown;
  save: (config: PluginOptions) => void;
}

const SAVE_COALESCE_MS = 300;

/**
 * Composition root for the synthetic-values config panel.
 *
 * Mounts inside the Signal K admin UI. PanelRoot owns shared theme and
 * component styling, while this component wires the form-state hook
 * (usePanelConfig) to the live-detection hook (useDetected).
 *
 * Write actions update locally at once, then send the latest complete snapshot
 * after a short coalescing window. Signal K Admin's save callback is
 * fire-and-forget, so the panel reports a request instead of claiming that an
 * asynchronous server write completed.
 */
const PluginConfigurationPanel: React.FC<Props> = (props) => {
  if (typeof window === 'undefined' || !supportsNativeCssScope(window)) {
    return <UnsupportedBrowserNotice />;
  }

  return <SupportedPluginConfigurationPanel {...props} />;
};

const SupportedPluginConfigurationPanel: React.FC<Props> = ({ configuration, save }) => {
  // Ref that always holds the last configuration requested from the host, used
  // by the no-op gate and by the hook's self-save echo detection. Normalized so
  // a fresh install (undefined or empty configuration) starts from a complete
  // options object.
  const requestedOptionsRef = useRef<PluginOptions>(normalizeOptions(configuration));

  // Form state: holds the full PluginOptions being edited.
  const { options, addPath, addAllCombinable, removePath, updatePath } = usePanelConfig(
    configuration,
    requestedOptionsRef
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

  // Always-current ref to options, so the coalesced save callback reads the
  // latest state rather than a stale closure.
  const optionsRef = useRef<PluginOptions>(options);
  optionsRef.current = options;

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;
  const pendingOptionsRef = useRef<PluginOptions | null>(null);
  const pendingBaseOptionsRef = useRef<PluginOptions | null>(null);
  const pendingRefreshRef = useRef(false);

  // Save-request surfaces. Signal K Admin returns before its network write
  // settles, so neither state claims that configuration persistence completed.
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  // Write actions update form state immediately, then queue one host request.
  // React state updates are asynchronous, so next-state is computed
  // synchronously before it enters the coalescing window.

  const flushSaveRequest = useCallback((): void => {
    saveTimerRef.current = null;
    const next = pendingOptionsRef.current;
    const refreshAfterRequest = pendingRefreshRef.current;
    pendingOptionsRef.current = null;
    pendingBaseOptionsRef.current = null;
    pendingRefreshRef.current = false;
    if (next === null) return;

    const previousRequested = requestedOptionsRef.current;
    // Advance before invoking the host because Admin synchronously echoes the
    // requested object as a fresh configuration prop.
    requestedOptionsRef.current = next;
    try {
      save(next);
      setSaveError(null);
      setSaveNotice('Configuration update requested from Signal K Admin.');
      if (refreshAfterRequest) void refresh();
    } catch {
      requestedOptionsRef.current = previousRequested;
      setSaveNotice(null);
      setSaveError('Could not request the configuration update.');
    }
  }, [refresh, save]);

  const scheduleSaveRequest = useCallback(
    (next: PluginOptions, refreshAfterRequest = false, force = false): void => {
      if (!force && jsonEqual(next, requestedOptionsRef.current)) {
        pendingOptionsRef.current = null;
        pendingBaseOptionsRef.current = null;
        pendingRefreshRef.current = false;
        if (saveTimerRef.current !== null) {
          clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
        }
        setSaveNotice(null);
        return;
      }

      pendingOptionsRef.current = next;
      pendingBaseOptionsRef.current ??= requestedOptionsRef.current;
      pendingRefreshRef.current ||= refreshAfterRequest;
      if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
      setSaveError(null);
      setSaveNotice('Configuration changes queued.');
      saveTimerRef.current = setTimeout(flushSaveRequest, SAVE_COALESCE_MS);
    },
    [flushSaveRequest]
  );

  useEffect(
    () => () => {
      if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
      // An explicit edit must not disappear when Admin unmounts the panel
      // during the coalescing window. Send the latest snapshot without
      // scheduling post-unmount UI work or a detection refresh.
      const pending = pendingOptionsRef.current;
      pendingOptionsRef.current = null;
      pendingBaseOptionsRef.current = null;
      pendingRefreshRef.current = false;
      if (pending !== null) {
        try {
          saveRef.current(pending);
        } catch {
          // The panel is gone, so there is no safe status surface to update.
        }
      }
    },
    []
  );

  // A genuine external edit wins over a queued local snapshot. A normal host
  // echo matches the baseline captured when coalescing began, so newer local
  // edits remain queued through that echo.
  const previousConfigurationRef = useRef(configuration);
  useEffect(() => {
    if (previousConfigurationRef.current === configuration) return;
    previousConfigurationRef.current = configuration;
    const pendingBase = pendingBaseOptionsRef.current;
    if (pendingBase === null || jsonEqual(normalizeOptions(configuration), pendingBase)) return;
    if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    pendingOptionsRef.current = null;
    pendingBaseOptionsRef.current = null;
    pendingRefreshRef.current = false;
    setSaveNotice('Queued changes were canceled because the configuration changed elsewhere.');
  }, [configuration]);

  const handleRetrySave = useCallback((): void => {
    scheduleSaveRequest(optionsRef.current, true, true);
  }, [scheduleSaveRequest]);

  const handleAdd = useCallback(
    (path: string): void => {
      const next = applyAddPath(optionsRef.current, path);
      // Advance the ref immediately so a second write action dispatched before
      // React re-renders reads this change instead of the stale snapshot.
      optionsRef.current = next;
      addPath(path);
      scheduleSaveRequest(next, true);
    },
    [scheduleSaveRequest, addPath]
  );

  const handleAddAll = useCallback(
    (rows: DetectedRow[]): void => {
      const next = applyAddAllCombinable(optionsRef.current, rows);
      optionsRef.current = next;
      addAllCombinable(rows);
      scheduleSaveRequest(next, true);
    },
    [scheduleSaveRequest, addAllCombinable]
  );

  const handleRemove = useCallback(
    (path: string): void => {
      const next = applyRemovePath(optionsRef.current, path);
      optionsRef.current = next;
      removePath(path);
      scheduleSaveRequest(next, true);
    },
    [scheduleSaveRequest, removePath]
  );

  // Every edit shares the same latest-snapshot coalescer, so rapid tuning and
  // nearby row actions produce one deterministic request after 300 ms.
  const handleUpdate = useCallback(
    (path: string, patch: RawPathConfigPatch): void => {
      const next = applyUpdatePath(optionsRef.current, path, patch);
      if (jsonEqual(next, optionsRef.current)) return;
      optionsRef.current = next;
      updatePath(path, patch);
      scheduleSaveRequest(next);
    },
    [scheduleSaveRequest, updatePath]
  );

  // A plugin with no saved configuration is "Unconfigured" and disabled. Since
  // this custom configurator replaces the Signal K admin form (including its
  // enable and submit chrome), the only way to enable the plugin is to save a
  // configuration from here. With no detected paths to opt in, there would be
  // nothing to click, so an explicit "Enable plugin" action requests a default
  // empty config, which enables the plugin and starts detection. `enabledHere`
  // hides the prompt immediately after the click, before the host re-supplies
  // the configuration prop.
  const [enabledHere, setEnabledHere] = useState(false);
  const handleEnable = useCallback((): void => {
    setEnabledHere(true);
    scheduleSaveRequest(optionsRef.current, true, true);
  }, [scheduleSaveRequest]);
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
  const detectedHeadingRef = useRef<HTMLSpanElement>(null);

  return (
    <PanelDefaultsContext.Provider value={panelDefaults}>
      <PanelRoot>
        <Stack gap={4}>
          <Cluster justify="between">
            <h1 className={styles.title}>Synthetic Values</h1>
            <ThemeToggle />
          </Cluster>

          {/* Request failure: baseline already rolled back, retry re-sends the form state. */}
          {saveError !== null && (
            <Banner
              tone="danger"
              live="assertive"
              title="Configuration request failed"
              actions={<Button onClick={handleRetrySave}>Retry</Button>}
            >
              {saveError}
            </Banner>
          )}

          {saveError === null && saveNotice !== null && (
            <Banner tone="info" live="polite" title="Configuration update">
              {saveNotice}
            </Banner>
          )}

          {/* Enable prompt: the only save trigger when the plugin is unconfigured */}
          {unconfigured && (
            <Banner
              tone="info"
              title="This plugin is not enabled yet"
              actions={
                <Button variant="primary" onClick={handleEnable}>
                  Enable plugin
                </Button>
              }
            >
              Enabling it requests a default configuration and starts watching your data for paths
              reported by two or more sources. Nothing is combined until you opt a path in.
            </Banner>
          )}

          {/* Priority banner: shown once any path is combined, dismissible */}
          <PriorityBanner
            show={showBanner}
            sourceLabel={PLUGIN_SOURCE_LABEL}
            dismissFocusRef={detectedHeadingRef}
            onDismiss={handleDismiss}
          />

          {/* Detected paths list */}
          <DetectedPathList
            detected={detected}
            configByPath={configByPath}
            headingRef={detectedHeadingRef}
            onAdd={handleAdd}
            onAddAll={handleAddAll}
            onRemove={handleRemove}
            onUpdate={handleUpdate}
            lastChecked={lastChecked}
            loading={loading}
            error={error}
            onRefresh={refresh}
          />
        </Stack>
      </PanelRoot>
    </PanelDefaultsContext.Provider>
  );
};

export default PluginConfigurationPanel;
