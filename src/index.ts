import type { DeltaInputHandler, Plugin, ServerAPI } from '@signalk/server-api';
import { systemClock } from './clock';
import type { CombineOptions, Sample } from './combine';
import { combine } from './combine';
import type { PathConfig, PluginOptions } from './config';
import { DEFAULT_MAX_SOURCES_PER_PATH, validateConfig } from './config';
import type { JumpState, SlewState } from './damping';
import { applyJump, applySlew } from './damping';
import { Discovery } from './discovery';
import { Emitter } from './emitter';
import type { Kind, SampleValue } from './metrics';
import type { MetadataLookup } from './pathClassifier';
import { classify, valueCategory } from './pathClassifier';
import { Registry } from './registry';
import { buildSchema } from './schema';
import { pathStatus, summaryStatus } from './status';

const PLUGIN_ID = 'signalk-synthetic-values';

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
  const skipped: { path: string; reason: string }[] = [];

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
    return src === PLUGIN_ID || src.startsWith(`${PLUGIN_ID}.`);
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
    return samples.map((s) => {
      const r = applyJump(kind, state.get(s.sourceRef), s.value, now, jumpConfig);
      state.set(s.sourceRef, r.state);
      return { sourceRef: s.sourceRef, value: r.accepted };
    });
  }

  function maybeEmit(path: string, cfg: PathConfig): void {
    if (!emitter.due(path, cfg.emitMinIntervalMs)) return;

    let samples = registry.fresh(path, cfg.stalenessTimeoutMs);
    const value0 = samples[0]?.value;
    if (value0 === undefined) return;
    const kind = classifyPath(path, value0, cfg);
    if (kind === 'other') return;

    const now = systemClock.now();
    const include = cfg.includeSources;
    if (include?.length) samples = samples.filter((s) => include.includes(s.sourceRef));
    const exclude = cfg.excludeSources;
    if (exclude?.length) samples = samples.filter((s) => !exclude.includes(s.sourceRef));
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
    app.setPluginStatus(pathStatus(path, result, PLUGIN_ID, cfg.minSources, cfg.method));
    if (result.value === undefined) return;

    let value = result.value;
    if (cfg.slewLimit != null) {
      const r = applySlew(kind, slewState.get(path), value, now, cfg.slewLimit);
      slewState.set(path, r.state);
      value = r.value;
    }
    emitter.emit(path, value, PLUGIN_ID);
  }

  function observeValue(pv: { path: string; value: unknown }, src: string): void {
    const cat = valueCategory(pv.value);
    // Record discovery for every fresh combinable value seen from any self-context
    // source, regardless of whether this path is configured. The isOwnSource guard
    // in observe() ensures the synthetic source is never recorded here.
    if (cat === 'number' || cat === 'latlon') {
      discovery.observe(pv.path, src);
      if (!detectedKind.has(pv.path)) {
        detectedKind.set(
          pv.path,
          classify(pv.path, pv.value as SampleValue, 'auto', getUnits, selfContext)
        );
      }
    }
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

  return {
    id: PLUGIN_ID,
    name: 'Synthetic Values',
    schema: () => buildSchema(() => discovery.detected()),

    start(options) {
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
      skipped.length = 0;
      for (const e of [...errors, ...advisories]) {
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
      app.setPluginStatus(summaryStatus(byPath.size, discovery.detected().length, skipped));
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
    },

    registerWithRouter(router) {
      router.get('/api/detected', (_req: unknown, res: RouterResponse) => {
        const detected = discovery.detected();
        res.json({
          paths: detected.map((d) => ({
            path: d.path,
            sources: d.sources,
            kind: detectedKind.get(d.path) ?? classification.get(d.path) ?? 'unknown',
            optedIn: byPath.has(d.path),
          })),
        });
      });
    },
  };
}
