import type { Plugin, ServerAPI } from '@signalk/server-api';
import { systemClock } from './clock';
import {
  isMeaningfulToCombine,
  NON_MEANINGFUL_ADVISORY,
  NON_NUMERIC_ADVISORY,
} from './combinability';
import type { CombineOptions, CombineResult, Outcome, Sample } from './combine';
import { combine } from './combine';
import type { PathConfig } from './config';
import { DEFAULT_MAX_SOURCES_PER_PATH, validateConfig } from './config';
import type { JumpConfig, JumpState, SlewState } from './damping';
import { applyJump, applySlew } from './damping';
import type { DetectedPath } from './discovery';
import { Discovery } from './discovery';
import { Emitter } from './emitter';
import type { Kind, SampleValue } from './metrics';
import type { MetadataLookup, ValueCategory } from './pathClassifier';
import { classify, isCombinableCategory, valueCategory } from './pathClassifier';
import { Registry } from './registry';
import { buildSchema } from './schema';
import { aggregateStatus, pathStatus } from './status';

const PLUGIN_ID = 'signalk-synthetic-values';
// Built once: isOwnSource runs for every source on every delta, so the prefix
// must not be re-templated per call.
const OWN_SOURCE_PREFIX = `${PLUGIN_ID}.`;
// Reason recorded in `skipped` when a configured path carries a value that
// cannot be averaged (text, object, or other non-combinable shape).
const NON_COMBINABLE_REASON = 'non-combinable value';

// Minimal Express response shape for the one route this plugin serves. The
// server injects a full Express router; @types/express is not a dependency, so
// only the members used here are declared.
interface RouterResponse {
  json(body: unknown): void;
}

// One row of the /api/detected response. The panel's DetectedRow mirrors this
// shape; naming it here documents the contract the route serves.
interface DetectedApiRow {
  path: string;
  sources: string[];
  kind: Kind | 'unknown';
  optedIn: boolean;
  combinable: boolean;
  recommended: boolean;
  duplicateGroups: string[][];
  advisory?: string;
}

export default function createPlugin(appBase: ServerAPI): Plugin {
  const app = appBase;
  let generation = 0;
  let selfContext = 'vessels.self';
  let byPath = new Map<string, PathConfig>();
  const registry = new Registry(systemClock, DEFAULT_MAX_SOURCES_PER_PATH);
  const discovery = new Discovery(systemClock, 200, DEFAULT_MAX_SOURCES_PER_PATH);
  const emitter = new Emitter(app, PLUGIN_ID, systemClock);
  const jumpState = new Map<string, Map<string, JumpState>>();
  const slewState = new Map<string, SlewState>();
  const classification = new Map<string, Kind>();
  const kindWarnings = new Set<string>();
  // Last combine outcome per configured path, used to build the aggregate
  // status line. Updated on each emit; never read on a hot non-emit path.
  const pathOutcome = new Map<string, Outcome>();
  // Last status string pushed to the admin UI. The aggregate is recomputed
  // often but only published when it actually changes, so the status bar does
  // not flash through per-path messages on every emit cycle.
  let lastStatus = '';
  const skipped: { path: string; reason: string }[] = [];

  function refreshStatus(): void {
    // detectedCount only feeds the no-configured-paths message; skip the count
    // entirely once any path is configured.
    const detectedCount = byPath.size === 0 ? discovery.count() : 0;
    const next = aggregateStatus(byPath.size, pathOutcome, detectedCount, skipped);
    if (next !== lastStatus) {
      lastStatus = next;
      app.setPluginStatus(next);
    }
  }

  const getUnits: MetadataLookup = (p) => {
    try {
      return app.getMetadata ? app.getMetadata(p) : undefined;
    } catch {
      return undefined;
    }
  };

  function isSelf(context: string | undefined): boolean {
    return context === undefined || context === selfContext;
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function isOwnSource(src: string): boolean {
    return src === PLUGIN_ID || src.startsWith(OWN_SOURCE_PREFIX);
  }

  function clearSkip(path: string, reason: string): void {
    for (let i = skipped.length - 1; i >= 0; i--) {
      const s = skipped[i];
      if (s && s.path === path && s.reason === reason) skipped.splice(i, 1);
    }
  }

  function addSkip(path: string, reason: string): void {
    if (!skipped.some((entry) => entry.path === path && entry.reason === reason)) {
      skipped.push({ path, reason });
    }
  }

  // Reset every per-run map and counter to its empty state. Shared by start()
  // (which then repopulates `skipped` from config issues) and stop(), so the
  // two cannot drift on which state they clear.
  function resetRuntimeState(): void {
    registry.reset();
    emitter.reset();
    discovery.reset();
    jumpState.clear();
    slewState.clear();
    classification.clear();
    kindWarnings.clear();
    pathOutcome.clear();
    skipped.length = 0;
    lastStatus = '';
  }

  function dampSample(
    kind: Kind,
    state: Map<string, JumpState>,
    sample: Sample,
    jumpConfig: JumpConfig
  ): void {
    const receiptTs = sample.receiptTs;
    const observationId = sample.observationId;
    const previous = state.get(sample.sourceRef);
    if (observationId !== undefined && previous?.lastProcessedObservationId === observationId) {
      sample.value = previous.lastAccepted.value;
      return;
    }
    const result = applyJump(
      kind,
      previous,
      sample.value,
      receiptTs ?? systemClock.now(),
      jumpConfig
    );
    if (observationId !== undefined) result.state.lastProcessedObservationId = observationId;
    state.set(sample.sourceRef, result.state);
    sample.value = result.accepted;
  }

  function damped(path: string, cfg: PathConfig, kind: Kind, samples: Sample[]): Sample[] {
    const jumpConfig = cfg.jumpRejection;
    if (!jumpConfig) return samples;
    let perSource = jumpState.get(path);
    if (!perSource) {
      perSource = new Map();
      jumpState.set(path, perSource);
    }
    const state = perSource;
    const currentSources = new Set(samples.map((sample) => sample.sourceRef));
    for (const sourceRef of state.keys()) {
      if (!currentSources.has(sourceRef)) state.delete(sourceRef);
    }
    // samples come fresh from registry.fresh() on every call, so mutating each
    // value in place is safe and avoids allocating a new array of new objects.
    for (const sample of samples) dampSample(kind, state, sample, jumpConfig);
    return samples;
  }

  function sourceAllowed(sourceRef: string, cfg: PathConfig): boolean {
    if (cfg.includeSources?.length && !cfg.includeSources.includes(sourceRef)) return false;
    if (cfg.excludeSources?.includes(sourceRef)) return false;
    return true;
  }

  function dropSource(path: string, sourceRef: string): void {
    registry.remove(path, sourceRef);
    jumpState.get(path)?.delete(sourceRef);
  }

  function recordAvailability(path: string, cfg: PathConfig): void {
    const samples = registry.fresh(path, cfg.stalenessTimeoutMs);
    if (samples.length >= cfg.minSources) return;
    recordOutcome(path, cfg, {
      usedSources: samples.map((sample) => sample.sourceRef),
      freshCount: samples.length,
      outcome: samples.length === 0 ? 'allStale' : 'belowMin',
    });
  }

  function recordOutcome(path: string, cfg: PathConfig, result: CombineResult): void {
    const prevOutcome = pathOutcome.get(path);
    pathOutcome.set(path, result.outcome);
    // Per-path detail goes to the debug log, not the status bar, so the bar
    // shows one stable summary. Logging only transitions avoids hot-path noise.
    if (result.outcome !== prevOutcome) {
      app.debug(pathStatus(path, result, PLUGIN_ID, cfg.minSources, cfg.method));
    }
    refreshStatus();
  }

  function maybeEmit(path: string, cfg: PathConfig): void {
    if (!emitter.due(path, cfg.emitMinIntervalMs)) return;

    let samples = registry.fresh(path, cfg.stalenessTimeoutMs);
    const kind = classification.get(path);
    if (!kind || kind === 'other') return;

    const now = systemClock.now();
    samples = damped(path, cfg, kind, samples);

    const opts: CombineOptions = {
      kind,
      method: cfg.method,
      minSources: cfg.minSources,
      outlierRejection: cfg.outlierRejection,
      madThreshold: cfg.madThreshold,
      rejectThreshold: cfg.rejectThreshold,
      disagreeThreshold: cfg.disagreeThreshold,
      angularSpreadThreshold: cfg.angularSpreadThreshold,
      trimFraction: cfg.trimFraction,
    };
    const result = combine(samples, opts);
    if (result.value === undefined) {
      recordOutcome(path, cfg, result);
      return;
    }

    let value = result.value;
    let nextSlewState: SlewState | undefined;
    if (cfg.slewLimit != null) {
      const r = applySlew(kind, slewState.get(path), value, now, cfg.slewLimit);
      nextSlewState = r.state;
      value = r.value;
    }
    emitter.emit(path, value);
    if (nextSlewState) slewState.set(path, nextSlewState);
    recordOutcome(path, cfg, result);
  }

  // Record discovery for every fresh combinable value seen from any self-context
  // source, regardless of whether this path is configured. The isOwnSource guard
  // in observe() ensures the synthetic source is never recorded here.
  function recordDiscovery(
    pv: { path: string; value: unknown },
    src: string,
    cat: ValueCategory
  ): void {
    if (cat === 'invalid') return;
    const combinable = isCombinableCategory(cat);
    const knownKind = discovery.kind(pv.path);
    const kind = combinable
      ? knownKind === undefined || knownKind === 'other'
        ? classify(pv.path, pv.value as SampleValue, 'auto', getUnits, selfContext)
        : undefined
      : 'other';
    const discoveryChanged = discovery.observe(
      pv.path,
      src,
      combinable ? (pv.value as SampleValue) : undefined,
      kind
    );
    // Source membership can change the "N detected" count shown while no paths
    // are configured; refresh (deduped) so that message stays current.
    if (byPath.size === 0 && discoveryChanged) refreshStatus();
  }

  function unavailableConfiguredValue(
    path: string,
    src: string,
    cat: ValueCategory,
    cfg: PathConfig
  ): boolean {
    if (cat === 'invalid') {
      dropSource(path, src);
      recordAvailability(path, cfg);
      return true;
    }
    if (cat !== 'nonCombinable') return false;
    dropSource(path, src);
    if (!classification.has(path)) {
      addSkip(path, NON_COMBINABLE_REASON);
      recordOutcome(path, cfg, {
        usedSources: [],
        freshCount: 0,
        outcome: 'skipped',
      });
    } else {
      recordAvailability(path, cfg);
    }
    return true;
  }

  function kindMatchesCategory(kind: Kind, cat: ValueCategory): boolean {
    if (kind === 'position') return cat === 'latlon';
    if (kind === 'attitude') return cat === 'attitude';
    return (kind === 'scalar' || kind === 'angular') && cat === 'number';
  }

  function acceptConfiguredKind(
    path: string,
    src: string,
    value: SampleValue,
    cfg: PathConfig,
    cat: ValueCategory
  ): boolean {
    const configuredKind = classification.get(path);
    if (!configuredKind) {
      classification.set(path, classify(path, value, cfg.angular, getUnits, selfContext));
      return true;
    }
    if (kindMatchesCategory(configuredKind, cat)) return true;
    dropSource(path, src);
    recordAvailability(path, cfg);
    if (!kindWarnings.has(path)) {
      kindWarnings.add(path);
      app.debug(
        `${path}: ignored ${src} because its value shape does not match the ${configuredKind} path`
      );
    }
    return false;
  }

  function observeValue(pv: { path: string; value: unknown }, src: string): void {
    const cat = valueCategory(pv.value);
    recordDiscovery(pv, src, cat);
    const cfg = byPath.get(pv.path);
    if (!cfg) return;
    if (!sourceAllowed(src, cfg)) return;
    if (unavailableConfiguredValue(pv.path, src, cat, cfg)) return;

    const value = pv.value as SampleValue;
    if (!acceptConfiguredKind(pv.path, src, value, cfg, cat)) return;
    clearSkip(pv.path, NON_COMBINABLE_REASON);
    registry.update(pv.path, src, value, systemClock.now());
    maybeEmit(pv.path, cfg);
  }

  function logObserveError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    app.error(message);
    app.debug(`observe error: ${message}`);
  }

  function observePathValue(value: unknown, src: string): void {
    if (!isRecord(value)) return;
    const path = value.path;
    if (typeof path !== 'string' || !path || path !== path.trim()) return;
    try {
      observeValue({ path, value: value.value }, src);
    } catch (error) {
      logObserveError(error);
    }
  }

  function observeUpdate(update: unknown): void {
    if (!isRecord(update)) return;
    const src = update.$source;
    if (typeof src !== 'string' || !src || isOwnSource(src) || !Array.isArray(update.values)) {
      return;
    }
    for (const value of update.values) observePathValue(value, src);
  }

  function isObservedContext(context: unknown): boolean {
    return context === undefined || (typeof context === 'string' && isSelf(context));
  }

  function observe(delta: unknown): void {
    if (!isRecord(delta)) return;
    if (!isObservedContext(delta.context)) return;
    if (!Array.isArray(delta.updates)) return;
    for (const update of delta.updates) observeUpdate(update);
  }

  // Build the /api/detected row for a path. `combinable` is whether the value
  // can be averaged at all (false for text and objects); `recommended` is
  // whether averaging is meaningful (false for GNSS fix metadata). `advisory`
  // explains either negative case for the panel. `duplicateGroups` flags sources
  // that look like the same feed re-broadcast.
  function detectedRow(d: DetectedPath): DetectedApiRow {
    const kind = d.kind ?? classification.get(d.path) ?? 'unknown';
    const combinable = kind !== 'other' && kind !== 'unknown';
    const meaningful = isMeaningfulToCombine(d.path);
    let advisory: string | undefined;
    if (!combinable) advisory = NON_NUMERIC_ADVISORY;
    else if (!meaningful) advisory = NON_MEANINGFUL_ADVISORY;
    return {
      path: d.path,
      sources: d.sources,
      kind,
      optedIn: byPath.has(d.path),
      combinable,
      recommended: combinable && meaningful,
      duplicateGroups: d.duplicateGroups,
      ...(advisory ? { advisory } : {}),
    };
  }

  return {
    id: PLUGIN_ID,
    name: 'Synthetic Values',
    schema: () => buildSchema(() => discovery.detected()),

    start(options) {
      generation++;
      const activeGeneration = generation;
      resetRuntimeState();
      const { config, errors, advisories } = validateConfig(options);
      registry.setMaxSourcesPerPath(config.maxSourcesPerPath);
      discovery.setMaxSourcesPerPath(config.maxSourcesPerPath);
      byPath = new Map(config.paths.map((p) => [p.path, p]));
      for (const path of byPath.keys()) pathOutcome.set(path, 'allStale');
      selfContext = app.selfContext ?? 'vessels.self';
      // Errors drop the path entry, so they surface in the status bar as
      // skipped. Advisories describe a path that still combines normally, so
      // they go to the debug log only; listing them as skipped would call a
      // working path dead.
      for (const e of errors) {
        addSkip(e.path, e.message);
        app.debug(`config ${e.path}: ${e.message}`);
      }
      for (const a of advisories) {
        app.debug(`config ${a.path}: ${a.message}`);
      }
      app.registerDeltaInputHandler((delta, next) => {
        try {
          // The server owns handler unregistration. The generation check also
          // makes an old callback inert if a host calls start twice directly.
          if (activeGeneration === generation) observe(delta);
        } catch (error) {
          // Per-delta errors are transient: log but do not promote to a sticky
          // plugin fault via setPluginError, which would flap the status bar on
          // every misbehaving source delta.
          logObserveError(error);
        } finally {
          next(delta);
        }
      });
      refreshStatus();
    },

    stop() {
      generation++;
      byPath = new Map();
      resetRuntimeState();
    },

    registerWithRouter(router) {
      router.get('/api/detected', (_req: unknown, res: RouterResponse) => {
        res.json({ paths: discovery.detected().map((d) => detectedRow(d)) });
      });
    },
  };
}
