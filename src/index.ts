import type { Plugin, ServerAPI } from '@signalk/server-api';
import { systemClock } from './clock';
import { detectedAdvisory, isMeaningfulToCombine } from './combinability';
import { type CombineOptions, combine, type Sample } from './combine';
import {
  DEFAULT_ANGULAR_MODE,
  DEFAULT_MAX_SOURCES_PER_PATH,
  type PathConfig,
  PLUGIN_ID,
  SLEW_MAX_LAG_SECONDS,
  sourceFilterFor,
  validateConfig,
} from './config';
import {
  applyJump,
  applySlew,
  type JumpConfig,
  type JumpState,
  jumpStateLastSeen,
  type SlewState,
} from './damping';
import type { DetectedRow } from './detected';
import { type DetectedPath, Discovery } from './discovery';
import { Emitter } from './emitter';
import { isRecord } from './guards';
import { distance, type Kind, type SampleValue } from './metrics';
import {
  type Classification,
  classify,
  isCombinableCategory,
  type MetadataLookup,
  normalizeAttitude,
  UNRECOGNIZED_ANGLE_ADVISORY,
  type ValueCategory,
  valueCategory,
} from './pathClassifier';
import { Registry } from './registry';
import { buildSchema } from './schema';
import {
  aggregateStatus,
  outcomeReport,
  type PathResult,
  type PathState,
  type SkippedPath,
} from './status';

// Built once: isOwnSource runs for every source on every delta, so the prefix
// must not be re-templated per call.
const OWN_SOURCE_PREFIX = `${PLUGIN_ID}.`;
// Reason recorded in `skipped` when a configured path carries a value that
// cannot be averaged (text, object, or other non-combinable shape).
const NON_COMBINABLE_REASON = 'non-combinable value';
const AVAILABILITY_SWEEP_MS = 1000;

// How many staleness windows a source may go quiet before its jump-rejection
// history is discarded. Pruning on age rather than on absence from one emit
// cycle keeps a source that reports more slowly than the staleness window from
// losing its history, and losing it re-arms the limiter so the next spike is
// accepted unconditionally.
const JUMP_STATE_RETENTION_WINDOWS = 10;

// Shared empty list for the availability outcomes, which reject nothing because
// they never reached the combiner.
const NO_REJECTED_SOURCES: string[] = [];

// The value category each settled kind accepts. A reading of any other shape on
// a configured path is dropped rather than averaged into the wrong kind.
const CATEGORY_OF_KIND: Record<Kind, ValueCategory | undefined> = {
  scalar: 'number',
  angular: 'number',
  position: 'latlon',
  attitude: 'attitude',
  other: undefined,
};

// Minimal Express response shape for the one route this plugin serves. The
// server injects a full Express router; @types/express is not a dependency, so
// only the members used here are declared.
interface RouterResponse {
  json(body: unknown): void;
}

/** How a configured path combines, settled by its first combinable reading. */
interface Combining {
  classified: Classification;
  /** Fixed for the run once the kind is known, so an emit reads one object. */
  options: CombineOptions;
}

/**
 * Everything the runtime holds for one configured path. One record rather than
 * a map per fact, so a new fact is one field, and the run's reset clears it
 * with the map that holds the record. Its PathState fields are the last
 * recorded outcome, which the aggregate status line reads directly.
 */
interface PathRuntime extends PathState {
  readonly cfg: PathConfig;
  /** Which sources the saved include and exclude lists let through, compiled once. */
  readonly accepts: (sourceRef: string) => boolean;
  combining?: Combining | undefined;
  /** Jump-rejection history per source. */
  readonly jump: Map<string, JumpState>;
  slew?: SlewState | undefined;
  /**
   * Median report interval, set while the sources report less often than the
   * staleness window, which is why the path never reaches its minimum count.
   */
  slowIntervalMs?: number | undefined;
  /**
   * Whether the path has published a value in this run. A path that never
   * started is not worth a notification; one that started and stopped is.
   */
  hasEmitted: boolean;
}

function newPathRuntime(cfg: PathConfig): PathRuntime {
  return {
    cfg,
    accepts: sourceFilterFor(cfg),
    jump: new Map(),
    hasEmitted: false,
    outcome: 'allStale',
    rejectedCount: 0,
    freshCount: 0,
    usedCount: 0,
  };
}

function combineOptions(cfg: PathConfig, kind: Kind): CombineOptions {
  return {
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
}

// A path waiting for sources, which is when a slow reporting period is the
// likely reason.
function isWaiting(state: PathState): boolean {
  return state.outcome === 'belowMin' || state.outcome === 'allStale';
}

function isOwnSource(src: string): boolean {
  return src === PLUGIN_ID || src.startsWith(OWN_SOURCE_PREFIX);
}

// One sentence for two audiences: the server log prefixes the path, the panel
// row reads it on a row that already names one.
function slowReportingMessage(interval: number, stalenessTimeoutMs: number): string {
  return `Sources report about every ${Math.round(interval)} ms but the staleness timeout is ${stalenessTimeoutMs} ms, so they are rarely fresh together. Raise the staleness timeout for this path.`;
}

/**
 * Whether the slew limiter must stand aside for this step. Two cases: the
 * emitted value has fallen further behind than the limiter could plausibly be
 * intended to hold it, or the quantity is moving in the direction the
 * classifier marked unsafe to smooth, which today means a depth shoaling
 * toward less water under the vessel.
 */
function slewBypassed(
  classified: Classification,
  previous: SlewState,
  combined: SampleValue,
  slewLimit: number
): boolean {
  if (
    classified.safeDirection === 'decreasing' &&
    // A safe direction is only ever set on a scalar path, but SampleValue is
    // a union, so the narrowing is what lets the comparison read the numbers.
    typeof previous.value === 'number' &&
    typeof combined === 'number' &&
    combined < previous.value
  ) {
    return true;
  }
  return distance(classified.kind, previous.value, combined) > slewLimit * SLEW_MAX_LAG_SECONDS;
}

export default function createPlugin(app: ServerAPI): Plugin {
  let generation = 0;
  let selfContext = 'vessels.self';
  let paths = new Map<string, PathRuntime>();
  const registry = new Registry(systemClock, DEFAULT_MAX_SOURCES_PER_PATH);
  const discovery = new Discovery(systemClock);
  const emitter = new Emitter(app, PLUGIN_ID, systemClock);
  // Messages already written once for a path, keyed by `<topic>:<path>`. One
  // set rather than one per topic, so adding a once-only message is a call site
  // and not a declaration, a reset, and a guard.
  const loggedOnce = new Set<string>();
  // Paths reporting radians that the classifier could not confirm as
  // full-circle, configured or not. They combine linearly, which is a guess, so
  // they are named in the status line, logged once, and marked in the panel
  // rather than left to publish a reciprocal bearing in silence.
  const unrecognizedAngles = new Set<string>();
  let notificationsEnabled = true;
  // Last status string pushed to the admin UI. The aggregate is recomputed
  // only when something it reads changes, and published only when the text
  // changes, so the status bar does not flash through per-path messages.
  let lastStatus = '';
  let availabilitySweep: ReturnType<typeof setInterval> | undefined;
  const skipped: SkippedPath[] = [];

  function refreshStatus(): void {
    // detectedCount only feeds the no-configured-paths message; skip the count
    // entirely once any path is configured.
    const detectedCount = paths.size === 0 ? discovery.count() : 0;
    // Only a configured path is named: telling an operator to set angular
    // wrapping on a path they have not opted in to is advice about nothing. The
    // panel row still explains it, and marks it not recommended so "Combine all"
    // leaves it alone.
    const review = [...unrecognizedAngles].filter((path) => paths.has(path));
    const next = aggregateStatus(paths.values(), detectedCount, skipped, review);
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

  function isObservedContext(context: unknown): boolean {
    return context === undefined || context === selfContext;
  }

  /** Remove a skip reason. True when there was one to remove. */
  function clearSkip(path: string, reason: string): boolean {
    const index = skipped.findIndex((entry) => entry.path === path && entry.reason === reason);
    if (index === -1) return false;
    skipped.splice(index, 1);
    return true;
  }

  /** Record a skip reason once. True when it was not already recorded. */
  function addSkip(path: string, reason: string): boolean {
    if (skipped.some((entry) => entry.path === path && entry.reason === reason)) return false;
    skipped.push({ path, reason });
    return true;
  }

  // Reset every per-run container to its empty state. Shared by start() (which
  // then repopulates it from the configuration) and stop(), so the two cannot
  // drift on which state they clear.
  function resetRuntimeState(): void {
    if (availabilitySweep !== undefined) {
      clearInterval(availabilitySweep);
      availabilitySweep = undefined;
    }
    registry.reset();
    emitter.reset();
    discovery.reset();
    paths = new Map();
    loggedOnce.clear();
    unrecognizedAngles.clear();
    skipped.length = 0;
    lastStatus = '';
  }

  /**
   * Write a message the first time a path raises it, so a condition that
   * persists for a whole voyage costs one line rather than one per emit. `key`
   * namespaces the topic so two topics on one path do not silence each other.
   * The debug log is the default sink.
   */
  function logOnce(
    key: string,
    message: string,
    sink: (message: string) => void = (line) => app.debug(line)
  ): void {
    if (loggedOnce.has(key)) return;
    loggedOnce.add(key);
    sink(message);
  }

  /** Re-arm a once-only message, so a condition that lifts and returns is said again. */
  function clearLogged(key: string): void {
    loggedOnce.delete(key);
  }

  /**
   * Apply jump rejection to one observation as it arrives, so `persistSamples`
   * counts sensor samples, which is what its label promises. Running it at emit
   * time instead would only ever see one sample per emit interval, so a burst of
   * confirming samples inside one interval could not satisfy the persist count
   * and a genuine step was held for `persistSamples * emitMinIntervalMs`.
   */
  function dampObservation(
    rt: PathRuntime,
    jumpConfig: JumpConfig,
    kind: Kind,
    sourceRef: string,
    value: SampleValue,
    ts: number
  ): SampleValue {
    const result = applyJump(kind, rt.jump.get(sourceRef), value, ts, jumpConfig);
    rt.jump.set(sourceRef, result.state);
    return result.accepted;
  }

  // Discard jump history only once a source has been quiet for several staleness
  // windows. Dropping it because a source missed one emit cycle re-arms the
  // limiter, and an unarmed limiter accepts the next spike unconditionally.
  function pruneJumpState(rt: PathRuntime, now: number): void {
    const maxAge = rt.cfg.stalenessTimeoutMs * JUMP_STATE_RETENTION_WINDOWS;
    for (const [sourceRef, state] of rt.jump) {
      if (now - jumpStateLastSeen(state) > maxAge) rt.jump.delete(sourceRef);
    }
  }

  /**
   * Drop every reading but one from each detected duplicate group, so a single
   * feed re-broadcast by two gateways cannot outvote an independent sensor or
   * satisfy `minSources` on its own. The kept reading is the first by source
   * reference, which is stable across restarts.
   */
  function collapseDuplicates(path: string, samples: Sample[]): Sample[] {
    const groups = discovery.duplicateGroupsFor(path);
    if (groups.length === 0) {
      clearLogged(`duplicates:${path}`);
      return samples;
    }
    // One pass over the samples answers membership for every group member,
    // rather than rescanning the sample list per source reference per group.
    const present = new Set(samples.map((sample) => sample.sourceRef));
    const dropped = new Set<string>();
    for (const group of groups) {
      const live = group.filter((ref) => present.has(ref)).sort();
      for (const ref of live.slice(1)) dropped.add(ref);
    }
    if (dropped.size === 0) return samples;
    logOnce(
      `duplicates:${path}`,
      `${path}: ${[...dropped].join(', ')} report the same feed as another source, so they are counted once.`
    );
    return samples.filter((s) => !dropped.has(s.sourceRef));
  }

  function dropSource(rt: PathRuntime, sourceRef: string): void {
    registry.remove(rt.cfg.path, sourceRef);
    rt.jump.delete(sourceRef);
  }

  function recordAvailability(rt: PathRuntime, now: number): void {
    const { path, stalenessTimeoutMs, minSources } = rt.cfg;
    // Most sweeps find enough fresh sources, and counting them allocates nothing.
    if (registry.freshCount(path, stalenessTimeoutMs, now) >= minSources) return;
    const samples = registry.fresh(path, stalenessTimeoutMs, now);
    recordOutcome(rt, {
      usedSources: samples.map((sample) => sample.sourceRef),
      freshCount: samples.length,
      outcome: samples.length === 0 ? 'allStale' : 'belowMin',
      rejectedSources: NO_REJECTED_SOURCES,
    });
  }

  // A path whose sources report less often than the staleness window rarely has
  // two fresh readings at the same instant, so it waits for sources forever. The
  // status line says it is waiting; this says why.
  function noteSlowReporting(rt: PathRuntime): void {
    const { path, stalenessTimeoutMs } = rt.cfg;
    const interval = registry.medianReportIntervalMs(path);
    if (interval === undefined || interval <= stalenessTimeoutMs) {
      rt.slowIntervalMs = undefined;
      return;
    }
    rt.slowIntervalMs = interval;
    logOnce(
      `slowReporting:${path}`,
      `${path}: ${slowReportingMessage(interval, stalenessTimeoutMs)}`
    );
  }

  function recordOutcome(rt: PathRuntime, result: PathResult, kind?: Kind): void {
    const rejectedCount = result.rejectedSources.length;
    const usedCount = result.usedSources.length;
    // The status line reads only the outcome and the rejected count. Every
    // sentence either audience reads is built from all four facts, so an
    // unchanged picture is not described twice: it costs no message building,
    // and the notification channel would drop the repeat anyway.
    const statusChanged = rt.outcome !== result.outcome || rt.rejectedCount !== rejectedCount;
    const changed =
      statusChanged || rt.freshCount !== result.freshCount || rt.usedCount !== usedCount;
    rt.outcome = result.outcome;
    rt.rejectedCount = rejectedCount;
    rt.freshCount = result.freshCount;
    rt.usedCount = usedCount;
    if (changed) {
      // A path that never reaches its minimum source count may simply have a
      // staleness window shorter than the reporting period. Asked when the
      // picture changes and again on every availability sweep, not on every
      // delta from the source that is still reporting.
      if (isWaiting(rt)) noteSlowReporting(rt);
      else rt.slowIntervalMs = undefined;
      const { path, minSources, method } = rt.cfg;
      // Per-path detail goes to the debug log, not the status bar, so the bar
      // shows one stable summary.
      const report = outcomeReport({
        path,
        result,
        sourceLabel: PLUGIN_ID,
        minSources,
        method,
        kind: kind ?? rt.combining?.classified.kind ?? 'scalar',
        hasEmitted: rt.hasEmitted,
      });
      app.debug(report.line);
      if (notificationsEnabled && report.notification) {
        emitter.notify(path, report.notification.state, report.notification.message);
      }
    }
    if (statusChanged) refreshStatus();
  }

  function limitSlew(
    rt: PathRuntime,
    classified: Classification,
    combined: SampleValue,
    now: number
  ): { value: SampleValue; state?: SlewState; clamped: boolean } {
    const { slewLimit } = rt.cfg;
    if (slewLimit === undefined) return { value: combined, clamped: false };
    const previous = rt.slew;
    if (previous && slewBypassed(classified, previous, combined, slewLimit)) {
      return { value: combined, state: { value: combined, ts: now }, clamped: false };
    }
    return applySlew(classified.kind, previous, combined, now, slewLimit);
  }

  function maybeEmit(rt: PathRuntime, { classified, options }: Combining, now: number): void {
    const { path, emitMinIntervalMs, stalenessTimeoutMs } = rt.cfg;
    if (classified.kind === 'other' || !emitter.due(path, emitMinIntervalMs, now)) return;

    const samples = collapseDuplicates(path, registry.fresh(path, stalenessTimeoutMs, now));
    const result = combine(samples, options);
    if (result.value === undefined) {
      recordOutcome(rt, result, classified.kind);
      return;
    }

    const { value, state, clamped } = limitSlew(rt, classified, result.value, now);
    emitter.emit(path, value, now);
    rt.hasEmitted = true;
    if (state) rt.slew = state;
    // The limiter clamped the step, so the published value is behind what the
    // sources report. Reporting `ok` here would present a lagging value as a
    // current one, which on a depth or a heading is exactly the wrong thing to
    // hide.
    recordOutcome(rt, clamped ? { ...result, outcome: 'slewLimited' } : result, classified.kind);
  }

  /**
   * Record and announce a path the classifier could not confirm. The override is
   * per path, so a path whose `angular` mode has been set is already answered
   * and is never named again.
   */
  function noteClassification(path: string, classified: Classification): void {
    const rt = paths.get(path);
    const mode = rt?.cfg.angular ?? DEFAULT_ANGULAR_MODE;
    const logKey = `unrecognizedAngle:${path}`;
    if (!classified.unrecognizedAngle || mode !== 'auto') {
      clearLogged(logKey);
      if (unrecognizedAngles.delete(path)) refreshStatus();
      return;
    }
    const known = unrecognizedAngles.has(path);
    unrecognizedAngles.add(path);
    // Reaches the server log rather than only the debug log, but only once the
    // path is actually being combined: a bearing averaged linearly publishes the
    // reciprocal, and debug is off by default. The explanation is the one the
    // panel row carries, so the two cannot describe the condition differently.
    if (rt) logOnce(logKey, `${path}: ${UNRECOGNIZED_ANGLE_ADVISORY}`, (line) => app.error(line));
    if (!known) refreshStatus();
  }

  /**
   * The kind to record for a discovered value, or undefined to leave the one
   * discovery already holds. A non-combinable value is always 'other'; a
   * combinable one is classified only while discovery has nothing better, and
   * classifying is also what announces an unrecognized angle.
   */
  function discoveryKind(
    path: string,
    value: unknown,
    combinable: boolean,
    knownKind: Kind | undefined
  ): Kind | undefined {
    if (!combinable) return 'other';
    if (knownKind !== undefined && knownKind !== 'other') return undefined;
    const classified = classify(path, value as SampleValue, 'auto', getUnits, selfContext);
    noteClassification(path, classified);
    return classified.kind;
  }

  // Record discovery for every valid value seen from any self-context source,
  // whether or not this path is configured. The isOwnSource guard in
  // observeUpdate ensures the synthetic source is never recorded here.
  function recordDiscovery(
    path: string,
    value: unknown,
    src: string,
    cat: ValueCategory,
    now: number
  ): void {
    if (cat === 'invalid') return;
    const combinable = isCombinableCategory(cat);
    const kind = discoveryKind(path, value, combinable, discovery.kind(path));
    const detectedChanged = discovery.observe(
      path,
      src,
      combinable ? (value as SampleValue) : undefined,
      kind,
      now
    );
    // The detected set feeds the "N detected" count shown while no paths are
    // configured; refresh (deduped) so that message stays current.
    if (paths.size === 0 && detectedChanged) refreshStatus();
  }

  function unavailableConfiguredValue(
    rt: PathRuntime,
    src: string,
    cat: ValueCategory,
    now: number
  ): boolean {
    if (cat === 'invalid') {
      dropSource(rt, src);
      recordAvailability(rt, now);
      return true;
    }
    if (cat !== 'nonCombinable') return false;
    dropSource(rt, src);
    if (rt.combining === undefined) {
      if (addSkip(rt.cfg.path, NON_COMBINABLE_REASON)) refreshStatus();
      recordOutcome(rt, {
        usedSources: [],
        freshCount: 0,
        outcome: 'skipped',
        rejectedSources: NO_REJECTED_SOURCES,
      });
    } else {
      recordAvailability(rt, now);
    }
    return true;
  }

  /**
   * How the path combines, or undefined when this reading's shape does not
   * match the kind already settled and the source was dropped. The first
   * combinable reading settles the kind for the run.
   */
  function acceptConfiguredKind(
    rt: PathRuntime,
    src: string,
    value: SampleValue,
    cat: ValueCategory,
    now: number
  ): Combining | undefined {
    const { path } = rt.cfg;
    if (rt.combining === undefined) {
      const classified = classify(path, value, rt.cfg.angular, getUnits, selfContext);
      noteClassification(path, classified);
      rt.combining = { classified, options: combineOptions(rt.cfg, classified.kind) };
      return rt.combining;
    }
    const settled = rt.combining.classified.kind;
    if (CATEGORY_OF_KIND[settled] === cat) return rt.combining;
    dropSource(rt, src);
    recordAvailability(rt, now);
    logOnce(
      `kindMismatch:${path}`,
      `${path}: ignored ${JSON.stringify(src)} because its value shape does not match the ${settled} path`
    );
    return undefined;
  }

  function observeValue(path: string, raw: unknown, src: string): void {
    const now = systemClock.now();
    const cat = valueCategory(raw);
    recordDiscovery(path, raw, src, cat, now);
    const rt = paths.get(path);
    if (!rt?.accepts(src)) return;
    if (unavailableConfiguredValue(rt, src, cat, now)) return;

    const value = cat === 'attitude' ? normalizeAttitude(raw as object) : (raw as SampleValue);
    const combining = acceptConfiguredKind(rt, src, value, cat, now);
    if (!combining) return;
    if (clearSkip(path, NON_COMBINABLE_REASON)) refreshStatus();
    const jumpConfig = rt.cfg.jumpRejection;
    const stored = jumpConfig
      ? dampObservation(rt, jumpConfig, combining.classified.kind, src, value, now)
      : value;
    registry.update(path, src, stored, now);
    maybeEmit(rt, combining, now);
  }

  function logObserveError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    app.error(message);
    app.debug(`observe error: ${message}`);
  }

  function observePathValue(pv: unknown, src: string): void {
    if (!isRecord(pv)) return;
    const path = pv.path;
    if (typeof path !== 'string' || !path || path !== path.trim()) return;
    try {
      observeValue(path, pv.value, src);
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
    for (const pv of update.values) observePathValue(pv, src);
  }

  function observe(delta: unknown): void {
    if (!isRecord(delta)) return;
    if (!isObservedContext(delta.context)) return;
    if (!Array.isArray(delta.updates)) return;
    for (const update of delta.updates) observeUpdate(update);
  }

  // Once a second: catch paths whose sources all went quiet, which no delta
  // will report, and age out jump history for sources that stopped.
  function sweepAvailability(now: number): void {
    for (const rt of paths.values()) {
      if (rt.outcome === 'skipped') continue;
      pruneJumpState(rt, now);
      recordAvailability(rt, now);
      if (isWaiting(rt)) noteSlowReporting(rt);
    }
  }

  function slowReportingAdvisory(rt: PathRuntime): string | undefined {
    return rt.slowIntervalMs === undefined
      ? undefined
      : slowReportingMessage(rt.slowIntervalMs, rt.cfg.stalenessTimeoutMs);
  }

  // Build the /api/detected row for a path. `combinable` is whether the value
  // can be averaged at all (false for text and objects); `recommended` is
  // whether averaging is meaningful (false for GNSS fix metadata). `advisory`
  // explains either negative case for the panel. `freshSources` is empty on a
  // path that is not configured, where nothing is being combined and `optedIn`
  // is what says freshness carries no meaning.
  function detectedRow(d: DetectedPath): DetectedRow {
    const rt = paths.get(d.path);
    // The runtime classification is the one actually in force, so it wins over
    // discovery's automatic guess. Discovery always classifies with `auto`, so
    // without this a path forced to angular still reads as scalar in the panel,
    // which is the row an operator consults to decide whether to force it.
    const kind = rt?.combining?.classified.kind ?? d.kind ?? 'unknown';
    const combinable = kind !== 'other' && kind !== 'unknown';
    const unrecognizedAngle = unrecognizedAngles.has(d.path);
    const advisory = detectedAdvisory({
      path: d.path,
      // The sources the filter lets through, so advice the operator has acted
      // on by excluding a source goes away.
      sources: rt ? d.sources.filter(rt.accepts) : d.sources,
      combinable,
      unrecognizedAngle,
      slowReporting: rt ? slowReportingAdvisory(rt) : undefined,
    });
    return {
      path: d.path,
      sources: d.sources,
      freshSources: rt
        ? registry.fresh(d.path, rt.cfg.stalenessTimeoutMs).map((sample) => sample.sourceRef)
        : [],
      kind,
      optedIn: rt !== undefined,
      combinable,
      recommended: combinable && isMeaningfulToCombine(d.path) && !unrecognizedAngle,
      duplicateGroups: d.duplicateGroups,
      ...(advisory ? { advisory } : {}),
    };
  }

  return {
    id: PLUGIN_ID,
    name: 'Synthetic Values',
    schema: () => buildSchema(() => discovery.detectedPaths()),

    start(options) {
      generation++;
      const activeGeneration = generation;
      resetRuntimeState();
      const { config, errors, advisories } = validateConfig(options);
      notificationsEnabled = config.notifications;
      registry.setMaxSourcesPerPath(config.maxSourcesPerPath);
      discovery.setMaxSourcesPerPath(config.maxSourcesPerPath);
      paths = new Map(config.paths.map((cfg) => [cfg.path, newPathRuntime(cfg)]));
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
      // A configuration with no paths has nothing to sweep, and saving a new
      // one restarts the plugin.
      if (paths.size > 0) {
        availabilitySweep = setInterval(() => {
          if (activeGeneration === generation) sweepAvailability(systemClock.now());
        }, AVAILABILITY_SWEEP_MS);
        availabilitySweep.unref();
      }
      refreshStatus();
    },

    stop() {
      generation++;
      resetRuntimeState();
    },

    registerWithRouter(router) {
      router.get('/api/detected', (_req: unknown, res: RouterResponse) => {
        res.json({ paths: discovery.detected().map((d) => detectedRow(d)) });
      });
    },
  };
}
