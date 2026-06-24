import type { DeltaInputHandler, Plugin, ServerAPI } from '@signalk/server-api';
import { systemClock } from './clock';
import {
  isMeaningfulToCombine,
  NON_MEANINGFUL_ADVISORY,
  NON_NUMERIC_ADVISORY,
} from './combinability';
import type { CombineOptions, Outcome, Sample } from './combine';
import { combine } from './combine';
import type { PathConfig, PluginOptions } from './config';
import { DEFAULT_MAX_SOURCES_PER_PATH, validateConfig } from './config';
import type { JumpState, SlewState } from './damping';
import { applyJump, applySlew } from './damping';
import type { DetectedPath } from './discovery';
import { Discovery } from './discovery';
import { Emitter } from './emitter';
import type { Kind, SampleValue } from './metrics';
import type { MetadataLookup, ValueCategory } from './pathClassifier';
import { classify, valueCategory } from './pathClassifier';
import { Registry } from './registry';
import { buildSchema } from './schema';
import { aggregateStatus, pathStatus } from './status';

const PLUGIN_ID = 'signalk-synthetic-values';
// Built once: isOwnSource runs for every source on every delta, so the prefix
// must not be re-templated per call.
const OWN_SOURCE_PREFIX = `${PLUGIN_ID}.`;

// A delta as observed off the wire. The Signal K Delta type uses branded path
// and source strings; the combiner works on plain values, so this loose shape
// captures only the fields the plugin reads.
interface ObservedDelta {
  context?: string;
  updates?: {
    $source?: string;
    values?: { path: string; value: unknown }[];
  }[];
}

// The published @signalk/server-api types declare registerDeltaInputHandler as
// returning void, but signalk-server returns an unregister function at runtime
// (relied on in stop() to detach the handler on plugin stop). Narrow the return
// type locally to the real contract; this is the house pattern for gaps in the
// published server types.
interface ServerAPIWithUnregister extends ServerAPI {
  registerDeltaInputHandler(handler: DeltaInputHandler): () => void;
}

// Minimal Express response shape for the one route this plugin serves. The
// server injects a full Express router; @types/express is not a dependency, so
// only the members used here are declared.
interface RouterResponse {
  json(body: unknown): void;
}

export default function createPlugin(appBase: ServerAPI): Plugin {
  const app = appBase as ServerAPIWithUnregister;
  let unregister: (() => void) | null = null;
  let selfContext = 'vessels.self';
  let byPath = new Map<string, PathConfig>();
  const registry = new Registry(systemClock, DEFAULT_MAX_SOURCES_PER_PATH);
  const discovery = new Discovery(systemClock);
  const emitter = new Emitter(app, PLUGIN_ID, systemClock);
  const jumpState = new Map<string, Map<string, JumpState>>();
  const slewState = new Map<string, SlewState>();
  const classification = new Map<string, Kind>();
  // Display kind for detected (possibly un-configured) paths, classified with
  // the default 'auto' mode. Kept separate from `classification`, which is the
  // combine kind for configured paths and honors a per-path angular override.
  const detectedKind = new Map<string, Kind>();
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

  function isOwnSource(src: string): boolean {
    return src === PLUGIN_ID || src.startsWith(OWN_SOURCE_PREFIX);
  }

  function classifyPath(path: string, value: SampleValue, cfg: PathConfig): Kind {
    const cached = classification.get(path);
    if (cached) return cached;
    // First-sample-wins: the kind is determined from the first observed value and
    // cached for the lifetime of the plugin run. Well-typed paths carry stable value
    // categories, so this is correct in practice. A path that legitimately carries
    // both a number and a position object would lock to whichever sample arrived
    // first; that is an unusual case and does not require redesign here.
    const kind = classify(path, value, cfg.angular, getUnits, selfContext);
    classification.set(path, kind);
    if (kind === 'other') skipped.push({ path, reason: 'non-combinable value' });
    return kind;
  }

  function damped(
    path: string,
    cfg: PathConfig,
    kind: Kind,
    samples: Sample[],
    now: number
  ): Sample[] {
    const jumpConfig = cfg.jumpRejection;
    if (!jumpConfig) return samples;
    let perSource = jumpState.get(path);
    if (!perSource) {
      perSource = new Map();
      jumpState.set(path, perSource);
    }
    const state = perSource;
    // samples come fresh from registry.fresh() on every call, so mutating each
    // value in place is safe and avoids allocating a new array of new objects.
    for (const s of samples) {
      const r = applyJump(kind, state.get(s.sourceRef), s.value, now, jumpConfig);
      state.set(s.sourceRef, r.state);
      s.value = r.accepted;
    }
    return samples;
  }

  // Apply the per-path include/exclude source filters. Returns the input
  // unchanged when neither list is set.
  function selectSources(samples: Sample[], cfg: PathConfig): Sample[] {
    let result = samples;
    const include = cfg.includeSources;
    if (include?.length) result = result.filter((s) => include.includes(s.sourceRef));
    const exclude = cfg.excludeSources;
    if (exclude?.length) result = result.filter((s) => !exclude.includes(s.sourceRef));
    return result;
  }

  function maybeEmit(path: string, cfg: PathConfig): void {
    if (!emitter.due(path, cfg.emitMinIntervalMs)) return;

    let samples = registry.fresh(path, cfg.stalenessTimeoutMs);
    const value0 = samples[0]?.value;
    if (value0 === undefined) return;
    const kind = classifyPath(path, value0, cfg);
    if (kind === 'other') return;

    const now = systemClock.now();
    samples = selectSources(samples, cfg);
    samples = damped(path, cfg, kind, samples, now);

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
    const prevOutcome = pathOutcome.get(path);
    pathOutcome.set(path, result.outcome);
    // Per-path detail goes to the debug log, not the status bar, so the bar
    // shows a single stable summary instead of flashing one line per path. Log
    // only outcome transitions worth attention, so a steady stream of healthy
    // 'ok' emits allocates no detail string on the hot path.
    if (result.outcome !== prevOutcome && result.outcome !== 'ok') {
      app.debug(pathStatus(path, result, PLUGIN_ID, cfg.minSources, cfg.method));
    }
    refreshStatus();
    if (result.value === undefined) return;

    let value = result.value;
    if (cfg.slewLimit != null) {
      const r = applySlew(kind, slewState.get(path), value, now, cfg.slewLimit);
      slewState.set(path, r.state);
      value = r.value;
    }
    emitter.emit(path, value, PLUGIN_ID);
  }

  // Record discovery for every fresh combinable value seen from any self-context
  // source, regardless of whether this path is configured. The isOwnSource guard
  // in observe() ensures the synthetic source is never recorded here.
  function recordDiscovery(
    pv: { path: string; value: unknown },
    src: string,
    cat: ValueCategory
  ): void {
    if (cat !== 'number' && cat !== 'latlon' && cat !== 'attitude') return;
    discovery.observe(pv.path, src, pv.value as SampleValue);
    if (detectedKind.has(pv.path)) return;
    detectedKind.set(
      pv.path,
      classify(pv.path, pv.value as SampleValue, 'auto', getUnits, selfContext)
    );
    // A newly discovered path changes the "N detected" count shown while no
    // paths are configured; refresh (deduped) so that message stays current.
    if (byPath.size === 0) refreshStatus();
  }

  function observeValue(pv: { path: string; value: unknown }, src: string): void {
    const cat = valueCategory(pv.value);
    recordDiscovery(pv, src, cat);
    const cfg = byPath.get(pv.path);
    if (!cfg) return;
    if (cat === 'invalid') return;
    if (cat === 'nonCombinable') {
      if (!classification.has(pv.path)) {
        classification.set(pv.path, 'other');
        skipped.push({ path: pv.path, reason: 'non-combinable value' });
      }
      return;
    }
    registry.update(pv.path, src, pv.value as SampleValue, systemClock.now());
    maybeEmit(pv.path, cfg);
  }

  function observe(delta: ObservedDelta | undefined): void {
    if (!delta || !isSelf(delta.context)) return;
    for (const update of delta.updates ?? []) {
      const src = update.$source;
      if (!src || isOwnSource(src) || !Array.isArray(update.values)) continue;
      for (const pv of update.values) {
        observeValue(pv, src);
      }
    }
  }

  // Build the /api/detected row for a path. `combinable` is whether the value
  // can be averaged at all (false for text and objects); `recommended` is
  // whether averaging is meaningful (false for GNSS fix metadata). `advisory`
  // explains either negative case for the panel. `duplicateGroups` flags sources
  // that look like the same feed re-broadcast.
  function detectedRow(d: DetectedPath): {
    path: string;
    sources: string[];
    kind: string;
    optedIn: boolean;
    combinable: boolean;
    recommended: boolean;
    duplicateGroups: string[][];
    advisory?: string;
  } {
    const kind = detectedKind.get(d.path) ?? classification.get(d.path) ?? 'unknown';
    const combinable = kind !== 'other';
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
      // Detach a prior handler if start() is ever called without an intervening
      // stop() (error-recovery reboot), so the old handler cannot run in parallel.
      if (unregister) {
        unregister();
        unregister = null;
      }
      const { config, errors, advisories } = validateConfig(options as PluginOptions);
      registry.setMaxSourcesPerPath(config.maxSourcesPerPath);
      byPath = new Map(config.paths.map((p) => [p.path, p]));
      selfContext = app.selfContext ?? 'vessels.self';
      registry.reset();
      emitter.reset();
      discovery.reset();
      jumpState.clear();
      slewState.clear();
      classification.clear();
      detectedKind.clear();
      pathOutcome.clear();
      lastStatus = '';
      skipped.length = 0;
      for (const e of errors) {
        skipped.push({ path: e.path, reason: e.message });
        app.debug(`config ${e.path}: ${e.message}`);
      }
      for (const e of advisories) {
        skipped.push({ path: e.path, reason: e.message });
        app.debug(`config ${e.path}: ${e.message}`);
      }
      unregister = app.registerDeltaInputHandler((delta, next) => {
        try {
          observe(delta as unknown as ObservedDelta);
        } catch (err) {
          // Per-delta errors are transient: log but do not promote to a sticky
          // plugin fault via setPluginError, which would flap the status bar on
          // every misbehaving source delta.
          const msg = err instanceof Error ? err.message : String(err);
          app.error(msg);
          app.debug?.(`observe error: ${msg}`);
        }
        next(delta);
      });
      refreshStatus();
    },

    stop() {
      if (unregister) {
        unregister();
        unregister = null;
      }
      registry.reset();
      emitter.reset();
      discovery.reset();
      jumpState.clear();
      slewState.clear();
      classification.clear();
      detectedKind.clear();
      pathOutcome.clear();
      lastStatus = '';
    },

    registerWithRouter(router) {
      router.get('/api/detected', (_req: unknown, res: RouterResponse) => {
        res.json({ paths: discovery.detected().map((d) => detectedRow(d)) });
      });
    },
  };
}
