import type * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Banner, PanelShell, useUnsavedChangesGuard } from 'signalk-nearlcrews-ui';
import { SaveActionBar } from 'signalk-nearlcrews-ui/composites';
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

interface Props {
  // The Signal K admin UI passes whatever is saved, which on a fresh install is
  // undefined or an empty object. Treat it as an open record so a panel save
  // can preserve fields introduced by newer plugin versions.
  configuration?: unknown;
  save: (config: PluginOptions) => void;
}

const SAVE_COALESCE_MS = 300;

const REQUEST_FAILURE = 'Could not request the configuration update.';

interface SaveReport {
  /** When the host last accepted a request, or null before the first. */
  requestedAt: number | null;
  /** Why the last request failed; cleared by the next request or a discard. */
  failure: string | null;
  /** Queued edits were dropped because the host supplied a different configuration. */
  canceledByHost: boolean;
}

const INITIAL_SAVE_REPORT: SaveReport = { requestedAt: null, failure: null, canceledByHost: false };

function reloadPage(): void {
  window.location.reload();
}

/**
 * Composition root for the synthetic-values config panel.
 *
 * Mounts inside the Signal K admin UI. PanelShell owns the browser preflight,
 * shared theme and component styling, the title, and the error boundary. The
 * body wires the form-state hook (usePanelConfig) to the live-detection hook
 * (useDetected), and it mounts only on a supported browser so an unsupported
 * one shows the notice without starting the detection poll.
 */
const PluginConfigurationPanel: React.FC<Props> = (props) => (
  <PanelShell title="Synthetic Values" themeToggle="end" onReload={reloadPage}>
    <PanelBody {...props} />
  </PanelShell>
);

/**
 * Write actions update locally at once, then send the latest complete snapshot
 * after a short coalescing window. Signal K Admin's save callback is
 * fire-and-forget, so the save bar reports a request instead of claiming that
 * an asynchronous server write completed. Save sends a queued snapshot without
 * waiting out the window and retries a failed request; Discard drops the queue
 * and returns the form to the last requested snapshot.
 */
const PanelBody: React.FC<Props> = ({ configuration, save }) => {
  // Ref that always holds the last configuration requested from the host, used
  // by the no-op gate and by the hook's self-save echo detection. Normalized so
  // a fresh install (undefined or empty configuration) starts from a complete
  // options object.
  const requestedOptionsRef = useRef<PluginOptions>(normalizeOptions(configuration));

  // Form state: holds the full PluginOptions being edited.
  const { options, addPath, addAllCombinable, removePath, replaceOptions, updatePath } =
    usePanelConfig(configuration, requestedOptionsRef);

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

  const [saveReport, setSaveReport] = useState<SaveReport>(INITIAL_SAVE_REPORT);

  // A plugin with no saved configuration is "Unconfigured" and disabled. Since
  // this custom configurator replaces the Signal K admin form (including its
  // enable and submit chrome), the only way to enable the plugin is to save a
  // configuration from here, which the save bar keeps enabled while the plugin
  // is unconfigured. `enabledHere` hides the prompt immediately after the
  // request, before the host re-supplies the configuration prop.
  const [enabledHere, setEnabledHere] = useState(false);
  const unconfigured = configuration == null && !enabledHere;

  const clearQueued = useCallback((): void => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    pendingOptionsRef.current = null;
    pendingBaseOptionsRef.current = null;
    pendingRefreshRef.current = false;
  }, []);

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
      setSaveReport({ requestedAt: Date.now(), failure: null, canceledByHost: false });
      if (refreshAfterRequest) void refresh();
    } catch {
      requestedOptionsRef.current = previousRequested;
      // The request never reached the host, so the plugin is still not enabled
      // and the save bar must keep offering the enabling save.
      setEnabledHere(false);
      setSaveReport((prev) => ({ ...prev, failure: REQUEST_FAILURE, canceledByHost: false }));
    }
  }, [refresh, save]);

  const scheduleSaveRequest = useCallback(
    (next: PluginOptions, refreshAfterRequest = false): void => {
      if (jsonEqual(next, requestedOptionsRef.current)) {
        clearQueued();
        setSaveReport((prev) =>
          prev.failure === null && !prev.canceledByHost
            ? prev
            : { ...prev, failure: null, canceledByHost: false }
        );
        return;
      }

      pendingOptionsRef.current = next;
      pendingBaseOptionsRef.current ??= requestedOptionsRef.current;
      pendingRefreshRef.current ||= refreshAfterRequest;
      if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
      setSaveReport((prev) =>
        prev.failure === null && !prev.canceledByHost
          ? prev
          : { ...prev, failure: null, canceledByHost: false }
      );
      saveTimerRef.current = setTimeout(flushSaveRequest, SAVE_COALESCE_MS);
    },
    [clearQueued, flushSaveRequest]
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
    clearQueued();
    setSaveReport((prev) => ({ ...prev, failure: null, canceledByHost: true }));
  }, [clearQueued, configuration]);

  // Sends the queued snapshot now, or the current form state when nothing is
  // queued: the enabling save of an unconfigured plugin and the retry after a
  // failed request both start from a form that matches the baseline.
  const handleSave = useCallback((): void => {
    if (unconfigured) setEnabledHere(true);
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (pendingOptionsRef.current === null) {
      pendingOptionsRef.current = optionsRef.current;
      pendingBaseOptionsRef.current = requestedOptionsRef.current;
      pendingRefreshRef.current = true;
    }
    flushSaveRequest();
  }, [flushSaveRequest, unconfigured]);

  const handleDiscard = useCallback((): void => {
    clearQueued();
    optionsRef.current = requestedOptionsRef.current;
    replaceOptions(requestedOptionsRef.current);
    setSaveReport((prev) => ({ ...prev, failure: null, canceledByHost: false }));
  }, [clearQueued, replaceOptions]);

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

  // The form differs from the last accepted request while edits wait in the
  // coalescing window and after a failed request rolled the baseline back.
  const dirty = !jsonEqual(options, requestedOptionsRef.current);
  useUnsavedChangesGuard(dirty);

  const showBanner = options.paths.length > 0 && !bannerDismissed;

  // Resolved top-level defaults for the per-path editors' placeholders.
  const panelDefaults = useMemo(
    () => ({
      minSources: options.defaultMinSources,
      stalenessTimeoutMs: options.defaultStalenessTimeoutMs,
      emitMinIntervalMs: options.defaultEmitMinIntervalMs,
      maxSourcesPerPath: options.maxSourcesPerPath,
    }),
    [
      options.defaultMinSources,
      options.defaultStalenessTimeoutMs,
      options.defaultEmitMinIntervalMs,
      options.maxSourcesPerPath,
    ]
  );
  const detectedHeadingRef = useRef<HTMLSpanElement>(null);

  return (
    <PanelDefaultsContext.Provider value={panelDefaults}>
      {/* Request failure: baseline already rolled back, Save re-sends the form state. */}
      {saveReport.failure !== null ? (
        <Banner tone="danger" live="assertive" title="Configuration request failed">
          {saveReport.failure} Save to try again.
        </Banner>
      ) : null}

      {saveReport.canceledByHost ? (
        <Banner tone="info" live="polite">
          Queued changes were canceled because the configuration changed elsewhere.
        </Banner>
      ) : null}

      {/* Enable prompt: the save bar's Save is the only save trigger while unconfigured */}
      {unconfigured ? (
        <Banner tone="info" title="This plugin is not enabled yet">
          Save requests a default configuration, which enables the plugin and starts watching your
          data for paths reported by two or more sources. Nothing is combined until you opt a path
          in.
        </Banner>
      ) : null}

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

      <SaveActionBar
        dirty={dirty}
        unconfigured={unconfigured}
        saveRequestedAt={saveReport.requestedAt}
        onSave={handleSave}
        onDiscard={handleDiscard}
      />
    </PanelDefaultsContext.Provider>
  );
};

export default PluginConfigurationPanel;
