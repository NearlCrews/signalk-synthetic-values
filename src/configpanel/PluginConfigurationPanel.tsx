import type * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Banner, PanelShell, useUnsavedChangesGuard } from 'signalk-nearlcrews-ui';
import { SaveActionBar } from 'signalk-nearlcrews-ui/composites';
import type { PluginOptions, RawPathConfig, RawPathConfigPatch } from '../config.js';
import { jsonEqual } from './api-base.js';
import { DetectedPathList } from './components/DetectedPathList.js';
import { PriorityBanner } from './components/PriorityBanner.js';
import { PanelDefaultsContext, panelDefaultsOf } from './defaultsContext.js';
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

/** The one host request waiting out the coalescing window. */
interface QueuedRequest {
  /** The latest snapshot, which is what gets sent. */
  options: PluginOptions;
  /** The last accepted request when coalescing began, to tell a host echo from an external edit. */
  base: PluginOptions;
  /** Whether detection should refresh once the request is sent. */
  refresh: boolean;
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
  <PanelShell title="Synthetic Values" themeToggle="end">
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
  const { options, replaceOptions } = usePanelConfig(configuration, requestedOptionsRef);

  // Live detection: polls /api/detected every 10 s.
  const { paths: detected, lastChecked, pollingSince, loading, error, refresh } = useDetected();

  const [bannerDismissed, setBannerDismissed] = useState(false);

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
  // Read at send time, so a host that passes a new save callback on every
  // render does not give every edit handler, and every memoized row, a new
  // identity.
  const saveRef = useRef(save);
  saveRef.current = save;
  const queuedRef = useRef<QueuedRequest | null>(null);

  const [saveReport, setSaveReport] = useState<SaveReport>(INITIAL_SAVE_REPORT);

  // A plugin with no saved configuration is "Unconfigured" and disabled. Since
  // this custom configurator replaces the Signal K admin form (including its
  // enable and submit chrome), the only way to enable the plugin is to save a
  // configuration from here, which the save bar keeps enabled while the plugin
  // is unconfigured. `enabledHere` hides the prompt immediately after the
  // request, before the host re-supplies the configuration prop.
  const [enabledHere, setEnabledHere] = useState(false);
  const unconfigured = configuration === undefined && !enabledHere;

  // The form differs from the last accepted request while edits wait in the
  // coalescing window and after a failed request rolled the baseline back. Held
  // as state rather than derived by serializing the whole configuration on every
  // render: the panel body re-renders on every keystroke in a number field, and
  // each such comparison grows with the number of combined paths.
  const [dirty, setDirty] = useState(false);
  useUnsavedChangesGuard(dirty);

  const cancelTimer = useCallback((): void => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  const clearQueued = useCallback((): void => {
    cancelTimer();
    queuedRef.current = null;
  }, [cancelTimer]);

  // Reset the save-issue flags without allocating when they are already clear,
  // so a render is not scheduled for a state that did not change.
  const clearSaveIssues = useCallback((): void => {
    setSaveReport((prev) =>
      prev.failure === null && !prev.canceledByHost
        ? prev
        : { ...prev, failure: null, canceledByHost: false }
    );
  }, []);

  const flushSaveRequest = useCallback((): void => {
    saveTimerRef.current = null;
    const queued = queuedRef.current;
    queuedRef.current = null;
    if (queued === null) return;

    const previousRequested = requestedOptionsRef.current;
    // Advance before invoking the host because Admin synchronously echoes the
    // requested object as a fresh configuration prop.
    requestedOptionsRef.current = queued.options;
    try {
      saveRef.current(queued.options);
      setSaveReport({ requestedAt: Date.now(), failure: null, canceledByHost: false });
      setDirty(false);
      if (queued.refresh) void refresh();
    } catch {
      requestedOptionsRef.current = previousRequested;
      // The request never reached the host, so the plugin is still not enabled
      // and the save bar must keep offering the enabling save. The baseline
      // rolled back, so the form is dirty again.
      setEnabledHere(false);
      setDirty(true);
      setSaveReport((prev) => ({ ...prev, failure: REQUEST_FAILURE, canceledByHost: false }));
    }
  }, [refresh]);

  const scheduleSaveRequest = useCallback(
    (next: PluginOptions, refreshAfterRequest: boolean): void => {
      // An edit that lands back on the last accepted request leaves nothing to
      // send, so the queue empties and the form is clean again.
      if (jsonEqual(next, requestedOptionsRef.current)) {
        clearQueued();
        setDirty(false);
        clearSaveIssues();
        return;
      }

      const queued = queuedRef.current;
      queuedRef.current = {
        options: next,
        base: queued?.base ?? requestedOptionsRef.current,
        refresh: (queued?.refresh ?? false) || refreshAfterRequest,
      };
      cancelTimer();
      setDirty(true);
      clearSaveIssues();
      saveTimerRef.current = setTimeout(flushSaveRequest, SAVE_COALESCE_MS);
    },
    [cancelTimer, clearQueued, clearSaveIssues, flushSaveRequest]
  );

  useEffect(
    () => () => {
      cancelTimer();
      // An explicit edit must not disappear when Admin unmounts the panel
      // during the coalescing window. Send the latest snapshot without
      // scheduling post-unmount UI work or a detection refresh.
      const queued = queuedRef.current;
      queuedRef.current = null;
      if (queued !== null) {
        try {
          saveRef.current(queued.options);
        } catch {
          // The panel is gone, so there is no safe status surface to update.
        }
      }
    },
    [cancelTimer]
  );

  // A genuine external edit wins over a queued local snapshot. A normal host
  // echo matches the baseline captured when coalescing began, so newer local
  // edits remain queued through that echo.
  const previousConfigurationRef = useRef(configuration);
  useEffect(() => {
    if (previousConfigurationRef.current === configuration) return;
    previousConfigurationRef.current = configuration;
    const queued = queuedRef.current;
    if (queued === null) {
      // Nothing queued, so the form state hook has already resynced the form to
      // whatever the host supplied and there is nothing left unsent.
      setDirty(false);
      return;
    }
    if (jsonEqual(normalizeOptions(configuration), queued.base)) return;
    clearQueued();
    setDirty(false);
    setSaveReport((prev) => ({ ...prev, failure: null, canceledByHost: true }));
  }, [clearQueued, configuration]);

  // Sends the queued snapshot now, or the current form state when nothing is
  // queued: the enabling save of an unconfigured plugin and the retry after a
  // failed request both start from a form that matches the baseline.
  const handleSave = useCallback((): void => {
    if (unconfigured) setEnabledHere(true);
    cancelTimer();
    queuedRef.current ??= {
      options: optionsRef.current,
      base: requestedOptionsRef.current,
      refresh: true,
    };
    flushSaveRequest();
  }, [cancelTimer, flushSaveRequest, unconfigured]);

  const handleDiscard = useCallback((): void => {
    clearQueued();
    optionsRef.current = requestedOptionsRef.current;
    replaceOptions(requestedOptionsRef.current);
    setDirty(false);
    setSaveReport((prev) => ({ ...prev, failure: null, canceledByHost: false }));
  }, [clearQueued, replaceOptions]);

  // Every edit computes its next snapshot synchronously and advances the ref at
  // once, so a second action dispatched before React re-renders builds on this
  // one. All of them share the same latest-snapshot coalescer, so rapid tuning
  // and nearby row actions produce one deterministic request after 300 ms. A
  // transition that changed nothing hands back the same object, and stops here.
  const commit = useCallback(
    (next: PluginOptions, refreshAfterRequest = false): void => {
      if (next === optionsRef.current) return;
      optionsRef.current = next;
      replaceOptions(next);
      scheduleSaveRequest(next, refreshAfterRequest);
    },
    [replaceOptions, scheduleSaveRequest]
  );

  // Opting a path in or out changes what detection reports, so those refresh it.
  const handleAdd = useCallback(
    (path: string): void => commit(applyAddPath(optionsRef.current, path), true),
    [commit]
  );
  const handleAddAll = useCallback(
    (rows: DetectedRow[]): void => commit(applyAddAllCombinable(optionsRef.current, rows), true),
    [commit]
  );
  const handleRemove = useCallback(
    (path: string): void => commit(applyRemovePath(optionsRef.current, path), true),
    [commit]
  );
  const handleUpdate = useCallback(
    (path: string, patch: RawPathConfigPatch): void =>
      commit(applyUpdatePath(optionsRef.current, path, patch)),
    [commit]
  );

  const showBanner = options.paths.length > 0 && !bannerDismissed;

  // Resolved top-level defaults for the per-path editors' placeholders.
  const { defaultMinSources, defaultStalenessTimeoutMs, defaultEmitMinIntervalMs } = options;
  const { maxSourcesPerPath } = options;
  const panelDefaults = useMemo(
    () =>
      panelDefaultsOf({
        defaultMinSources,
        defaultStalenessTimeoutMs,
        defaultEmitMinIntervalMs,
        maxSourcesPerPath,
      }),
    [defaultMinSources, defaultStalenessTimeoutMs, defaultEmitMinIntervalMs, maxSourcesPerPath]
  );
  const detectedHeadingRef = useRef<HTMLSpanElement>(null);

  return (
    <PanelDefaultsContext.Provider value={panelDefaults}>
      {/* Both live regions stay mounted so a message that arrives later is
          announced; with nothing to say they render empty and take no space. */}
      {/* Request failure: baseline already rolled back, Save re-sends the form state. */}
      <Banner
        tone="danger"
        live="assertive"
        title={saveReport.failure !== null ? 'Configuration request failed' : undefined}
      >
        {saveReport.failure !== null ? <>{saveReport.failure} Save to try again.</> : null}
      </Banner>

      <Banner tone="info" live="polite">
        {saveReport.canceledByHost
          ? 'Queued changes were canceled because the configuration changed elsewhere.'
          : null}
      </Banner>

      {/* Enable prompt: the save bar's Save is the only save trigger while unconfigured */}
      {unconfigured ? (
        <Banner tone="info" title="This plugin is not enabled yet">
          Save requests a default configuration, which enables the plugin and starts watching your
          data for paths reported by two or more sources. Nothing is combined until you opt a path
          in.
        </Banner>
      ) : null}

      {/* Priority banner: shown once any path is combined, dismissible */}
      {showBanner ? (
        <PriorityBanner
          dismissFocusRef={detectedHeadingRef}
          onDismiss={() => setBannerDismissed(true)}
        />
      ) : null}

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
        pollingSince={pollingSince}
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
