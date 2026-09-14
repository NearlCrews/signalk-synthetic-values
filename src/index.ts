import type { Plugin, ServerAPI } from '@signalk/server-api';
import { systemClock } from './clock';
import {
  isMeaningfulToCombine,
  NON_MEANINGFUL_ADVISORY,
  NON_NUMERIC_ADVISORY,
} from './combinability';
import type { CombineOptions, CombineResult, Sample } from './combine';
import { combine } from './combine';
import type { PathConfig } from './config';
import { DEFAULT_MAX_SOURCES_PER_PATH, validateConfig } from './config';
import type { JumpConfig, SlewState } from './damping';
import { applyJump, applySlew, type JumpState, jumpStateLastSeen } from './damping';
import type { DetectedPath } from './discovery';
import { Discovery } from './discovery';
import type { NotificationState } from './emitter';
import { Emitter } from './emitter';
import type { Kind, SampleValue } from './metrics';
import { distance } from './metrics';
import type { Classification, MetadataLookup, ValueCategory } from './pathClassifier';
import { classify, isCombinableCategory, valueCategory } from './pathClassifier';
import { Registry } from './registry';
import { buildSchema } from './schema';
import type { PathState } from './status';
import { aggregateStatus, pathStatus } from './status';

const PLUGIN_ID = 'signalk-synthetic-values';
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

// The furthest the slew limiter may fall behind the combined value, measured in
// seconds of catch-up at the configured rate. Beyond it the limiter is bypassed:
// smoothing exists to suppress noise, and no amount of smoothing is worth
// misreporting a real change indefinitely.
const SLEW_MAX_LAG_SECONDS = 10;

// Depth paths where a smaller number means less water under the vessel. A rise
// toward shallower water is never smoothed: the limiter is there to damp noise,
// and there is no safe reason to report more water than the sounders see.
const SHOALING_DEPTH_PATHS: ReadonlySet<string> = new Set([
  'environment.depth.belowKeel',
  'environment.depth.belowTransducer',
  'environment.depth.belowSurface',
]);

// Shown in the panel for a path that reports radians but is neither a known
// full-circle quantity nor a known bounded angle, so scalar combining is a
// guess that publishes the reciprocal bearing if the path in fact wraps.
const UNRECOGNIZED_ANGLE_ADVISORY =
  'This path reports radians but is not a Signal K angle this plugin recognizes, so it is being averaged linearly. If it wraps at 360 degrees, such as a heading or a bearing, set Angular wrapping to Yes. If it does not, such as a rudder angle, set it to No.';

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
  /**
   * Sources fresh in the combiner right now, or null when the path is not
   * configured and no freshness is being tracked. Discovery keeps a source
   * listed for a minute; the combiner drops it after the staleness timeout, so
   * without this the panel shows a dead sensor as a contributing one.
   */
  freshSources: string[] | null;
  /** Sources the include or exclude lists keep out of the combination. */
  excludedSources: string[];
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
  // Paths reporting radians that the classifier could not confirm as
  // full-circle. They combine linearly, which is a guess, so they are named in
  // the status line, logged once, and marked in the panel rather than left to
  // publish a reciprocal bearing in silence.
  const unrecognizedAngles = new Set<string>();
  const angleWarningLogged = new Set<string>();
  // Paths whose sources report less often than the staleness window, which is
  // why they never reach their minimum source count.
  const slowReporting = new Map<string, number>();
  const slowReportingLogged = new Set<string>();
  // Paths that have published at least one value in this run. A path that never
  // started is not worth a notification; one that started and stopped is.
  const hasEmitted = new Set<string>();
  const duplicatesLogged = new Set<string>();
  // Last combine outcome per configured path, used to build the aggregate
  // status line. Updated on each emit; never read on a hot non-emit path.
  const pathState = new Map<string, PathState>();
  let notificationsEnabled = true;
  // Last status string pushed to the admin UI. The aggregate is recomputed
  // often but only published when it actually changes, so the status bar does
  // not flash through per-path messages on every emit cycle.
  let lastStatus = '';
  let availabilitySweep: ReturnType<typeof setInterval> | undefined;
  const skipped: { path: string; reason: string }[] = [];

  function refreshStatus(): void {
    // detectedCount only feeds the no-configured-paths message; skip the count
    // entirely once any path is configured.
    const detectedCount = byPath.size === 0 ? discovery.count() : 0;
    // Only a configured path is named: telling an operator to set angular
    // wrapping on a path they have not opted in to is advice about nothing. The
    // panel row still explains it, and marks it not recommended so "Combine all"
    // leaves it alone.
    const next = aggregateStatus(
      byPath.size,
      pathState,
      detectedCount,
      skipped,
      [...unrecognizedAngles].filter((path) => byPath.has(path))
    );
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
    if (availabilitySweep !== undefined) {
      clearInterval(availabilitySweep);
      availabilitySweep = undefined;
    }
    registry.reset();
    emitter.reset();
    discovery.reset();
    jumpState.clear();
    slewState.clear();
    classification.clear();
    kindWarnings.clear();
    unrecognizedAngles.clear();
    angleWarningLogged.clear();
    slowReporting.clear();
    slowReportingLogged.clear();
    hasEmitted.clear();
    duplicatesLogged.clear();
    pathState.clear();
    skipped.length = 0;
    lastStatus = '';
  }

  /**
   * Apply jump rejection to one observation as it arrives, so `persistSamples`
   * counts sensor samples, which is what its label promises. Running it at emit
   * time instead would only ever see one sample per emit interval, so a burst of
   * confirming samples inside one interval could not satisfy the persist count
   * and a genuine step was held for `persistSamples * emitMinIntervalMs`.
   */
  function dampObservation(
    path: string,
    jumpConfig: JumpConfig,
    kind: Kind,
    sourceRef: string,
    value: SampleValue,
    ts: number
  ): SampleValue {
    let perSource = jumpState.get(path);
    if (!perSource) {
      perSource = new Map();
      jumpState.set(path, perSource);
    }
    const result = applyJump(kind, perSource.get(sourceRef), value, ts, jumpConfig);
    perSource.set(sourceRef, result.state);
    return result.accepted;
  }

  // Discard jump history only once a source has been quiet for several staleness
  // windows. Dropping it because a source missed one emit cycle re-arms the
  // limiter, and an unarmed limiter accepts the next spike unconditionally.
  function pruneJumpState(path: string, cfg: PathConfig, now: number): void {
    const perSource = jumpState.get(path);
    if (!perSource) return;
    const maxAge = cfg.stalenessTimeoutMs * JUMP_STATE_RETENTION_WINDOWS;
    for (const [sourceRef, state] of perSource) {
      if (now - jumpStateLastSeen(state) > maxAge) perSource.delete(sourceRef);
    }
    if (perSource.size === 0) jumpState.delete(path);
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
      duplicatesLogged.delete(path);
      return samples;
    }
    const dropped = new Set<string>();
    for (const group of groups) {
      const present = group.filter((ref) => samples.some((s) => s.sourceRef === ref)).sort();
      for (const ref of present.slice(1)) dropped.add(ref);
    }
    if (dropped.size === 0) return samples;
    if (!duplicatesLogged.has(path)) {
      duplicatesLogged.add(path);
      app.debug(
        `${path}: ${[...dropped].join(', ')} report the same feed as another source, so they are counted once.`
      );
    }
    return samples.filter((s) => !dropped.has(s.sourceRef));
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

  // A path whose sources report less often than the staleness window rarely has
  // two fresh readings at the same instant, so it waits for sources forever. The
  // status line says it is waiting; this says why.
  function noteSlowReporting(path: string, cfg: PathConfig): void {
    const interval = registry.medianReportIntervalMs(path);
    if (interval === undefined || interval <= cfg.stalenessTimeoutMs) {
      slowReporting.delete(path);
      return;
    }
    slowReporting.set(path, interval);
    if (slowReportingLogged.has(path)) return;
    slowReportingLogged.add(path);
    app.debug(
      `${path}: sources report about every ${Math.round(interval)} ms but the staleness timeout is ${cfg.stalenessTimeoutMs} ms, so they are rarely fresh together. Raise the staleness timeout for this path.`
    );
  }

  function slowReportingAdvisory(path: string): string | undefined {
    const interval = slowReporting.get(path);
    if (interval === undefined) return undefined;
    const cfg = byPath.get(path);
    if (!cfg) return undefined;
    return `Sources report about every ${Math.round(interval)} ms but the staleness timeout is ${cfg.stalenessTimeoutMs} ms, so they are rarely fresh at the same moment. Raise the staleness timeout for this path.`;
  }

  // How much confidence the last combine leaves in the published value. `alert`
  // means the value should not be trusted as published, `warn` means the plugin
  // is running degraded, and `normal` clears a previous notification.
  function confidence(
    path: string,
    result: CombineResult
  ): { state: NotificationState; message: string } | undefined {
    const rejected = result.rejectedSources?.length ?? 0;
    switch (result.outcome) {
      case 'diverged':
        return {
          state: 'alert',
          message: `Sources diverge, so no combined value is being published (${result.freshCount} fresh sources).`,
        };
      case 'disagree':
        // An operator-set disagreement distance is a deliberate alarm, so a
        // breach of it alerts. The unit-free split test is a heuristic that
        // cannot tell two sounders mounted a boat length apart from two that
        // have failed, so it advises rather than alerts. Alerting on it would
        // leave a permanent warning on a correctly configured vessel, which
        // teaches an operator to ignore the channel.
        return result.unsupported
          ? {
              state: 'warn',
              message: `Sources split into groups and the published value matches none of them (${result.usedSources.length} of ${result.freshCount} sources). Set a disagreement distance for this path to say how far apart is acceptable.`,
            }
          : {
              state: 'alert',
              message: `Sources disagree by more than the configured distance, and the combined value is being published anyway (${result.usedSources.length} of ${result.freshCount} sources).`,
            };
      case 'slewLimited':
        return {
          state: 'warn',
          message: 'The slew limit is holding the published value behind what the sources report.',
        };
      case 'singleSource':
        return result.freshCount > 1
          ? {
              state: 'warn',
              message: `Only 1 of ${result.freshCount} sources is being used, so there is no redundancy.`,
            }
          : { state: 'normal', message: 'Combining normally.' };
      case 'belowMin':
      case 'allStale':
        // Silent until the path has produced something: a path that never
        // started is a configuration matter, one that stopped is an event.
        return hasEmitted.has(path)
          ? {
              state: 'warn',
              message: `Not enough fresh sources to combine (${result.freshCount} fresh), so the value has stopped updating.`,
            }
          : undefined;
      case 'ok':
        return rejected > 0
          ? {
              state: 'warn',
              message: `${rejected} of ${result.freshCount} sources rejected as outliers; combining the remaining ${result.usedSources.length}.`,
            }
          : { state: 'normal', message: 'Combining normally.' };
      case 'skipped':
        return undefined;
    }
  }

  function recordOutcome(path: string, cfg: PathConfig, result: CombineResult): void {
    const previous = pathState.get(path);
    const rejectedCount = result.rejectedSources?.length ?? 0;
    pathState.set(path, { outcome: result.outcome, rejectedCount });
    // A path that never reaches its minimum source count may simply have a
    // staleness window shorter than the reporting period, so check that here
    // rather than only on the availability sweep.
    if (result.outcome === 'belowMin' || result.outcome === 'allStale') {
      noteSlowReporting(path, cfg);
    } else {
      slowReporting.delete(path);
    }
    // Per-path detail goes to the debug log, not the status bar, so the bar
    // shows one stable summary. Logging only changes avoids hot-path noise, and
    // the used and fresh counts are part of the change so a newly rejected
    // sensor is announced rather than hidden behind an unchanged outcome.
    const changed =
      previous === undefined ||
      previous.outcome !== result.outcome ||
      previous.rejectedCount !== rejectedCount;
    if (changed) {
      app.debug(
        pathStatus(path, result, PLUGIN_ID, cfg.minSources, cfg.method, classification.get(path))
      );
    }
    if (notificationsEnabled) {
      const state = confidence(path, result);
      if (state) emitter.notify(path, state.state, state.message);
    }
    refreshStatus();
  }

  /**
   * Whether the slew limiter must stand aside for this step. Two cases: the
   * emitted value has fallen further behind than the limiter could plausibly be
   * intended to hold it, or a depth path is moving toward shallower water,
   * where under-reporting the change is a grounding hazard and smoothing has no
   * safe purpose.
   */
  function slewBypassed(
    path: string,
    kind: Kind,
    previous: SlewState,
    combined: SampleValue,
    slewLimit: number
  ): boolean {
    if (
      SHOALING_DEPTH_PATHS.has(path) &&
      typeof previous.value === 'number' &&
      typeof combined === 'number' &&
      combined < previous.value
    ) {
      return true;
    }
    return distance(kind, previous.value, combined) > slewLimit * SLEW_MAX_LAG_SECONDS;
  }

  function limitSlew(
    path: string,
    cfg: PathConfig,
    kind: Kind,
    combined: SampleValue,
    now: number
  ): { value: SampleValue; state?: SlewState } {
    if (cfg.slewLimit == null) return { value: combined };
    const previous = slewState.get(path);
    if (previous && slewBypassed(path, kind, previous, combined, cfg.slewLimit)) {
      return { value: combined, state: { value: combined, ts: now } };
    }
    const limited = applySlew(kind, previous, combined, now, cfg.slewLimit);
    return { value: limited.value, state: limited.state };
  }

  function maybeEmit(path: string, cfg: PathConfig): void {
    if (!emitter.due(path, cfg.emitMinIntervalMs)) return;

    const kind = classification.get(path);
    if (!kind || kind === 'other') return;

    const now = systemClock.now();
    pruneJumpState(path, cfg, now);
    const samples = collapseDuplicates(path, registry.fresh(path, cfg.stalenessTimeoutMs));

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

    const combined = result.value;
    const { value, state } = limitSlew(path, cfg, kind, combined, now);
    emitter.emit(path, value);
    hasEmitted.add(path);
    if (state) slewState.set(path, state);
    // The limiter clamped the step, so the published value is behind what the
    // sources report. Reporting `ok` here would present a lagging value as a
    // current one, which on a depth or a heading is exactly the wrong thing to
    // hide.
    const lagging = value !== combined && distance(kind, value, combined) > 0;
    recordOutcome(path, cfg, lagging ? { ...result, outcome: 'slewLimited' } : result);
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
    let kind: Kind | undefined = 'other';
    if (combinable) {
      kind = undefined;
      if (knownKind === undefined || knownKind === 'other') {
        const classified = classify(
          pv.path,
          pv.value as SampleValue,
          'auto',
          getUnits,
          selfContext
        );
        noteClassification(pv.path, classified);
        kind = classified.kind;
      }
    }
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

  /**
   * Record and announce a path the classifier could not confirm. The override is
   * per path, so a path whose `angular` mode has been set is already answered
   * and is never named again.
   */
  function noteClassification(path: string, classified: Classification): void {
    const mode = byPath.get(path)?.angular ?? 'auto';
    if (!classified.unrecognizedAngle || mode !== 'auto') {
      angleWarningLogged.delete(path);
      if (unrecognizedAngles.delete(path)) refreshStatus();
      return;
    }
    const known = unrecognizedAngles.has(path);
    unrecognizedAngles.add(path);
    // Reaches the server log rather than only the debug log, but only once the
    // path is actually being combined: a bearing averaged linearly publishes the
    // reciprocal, and debug is off by default.
    if (byPath.has(path) && !angleWarningLogged.has(path)) {
      angleWarningLogged.add(path);
      app.error(
        `${path} reports radians but is not a Signal K angle this plugin recognizes, so it is being averaged linearly. If it wraps at 360 degrees, set this path's angular wrapping to "yes"; if it does not, set it to "no" to silence this.`
      );
    }
    if (!known) refreshStatus();
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
      const classified = classify(path, value, cfg.angular, getUnits, selfContext);
      noteClassification(path, classified);
      classification.set(path, classified.kind);
      return true;
    }
    if (kindMatchesCategory(configuredKind, cat)) return true;
    dropSource(path, src);
    recordAvailability(path, cfg);
    if (!kindWarnings.has(path)) {
      kindWarnings.add(path);
      app.debug(
        `${path}: ignored ${JSON.stringify(src)} because its value shape does not match the ${configuredKind} path`
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
    const now = systemClock.now();
    const kind = classification.get(pv.path);
    const stored =
      cfg.jumpRejection && kind && kind !== 'other'
        ? dampObservation(pv.path, cfg.jumpRejection, kind, src, value, now)
        : value;
    registry.update(pv.path, src, stored, now);
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
  // Everything the panel should say about a row, joined into the single string
  // the row renders. Several can apply at once: a slow-reporting path can also
  // be one whose angular wrapping is unconfirmed.
  function rowAdvisory(
    path: string,
    combinable: boolean,
    meaningful: boolean,
    unrecognizedAngle: boolean
  ): string {
    const advisories: string[] = [];
    if (!combinable) advisories.push(NON_NUMERIC_ADVISORY);
    else if (!meaningful) advisories.push(NON_MEANINGFUL_ADVISORY);
    if (unrecognizedAngle) advisories.push(UNRECOGNIZED_ANGLE_ADVISORY);
    const slow = slowReportingAdvisory(path);
    if (slow) advisories.push(slow);
    return advisories.join(' ');
  }

  function detectedRow(d: DetectedPath): DetectedApiRow {
    const cfg = byPath.get(d.path);
    // The runtime classification is the one actually in force, so it wins over
    // discovery's automatic guess. Discovery always classifies with `auto`, so
    // without this a path forced to angular still reads as scalar in the panel,
    // which is the row an operator consults to decide whether to force it.
    const kind = classification.get(d.path) ?? d.kind ?? 'unknown';
    const combinable = kind !== 'other' && kind !== 'unknown';
    const meaningful = isMeaningfulToCombine(d.path);
    const unrecognizedAngle = unrecognizedAngles.has(d.path);
    const advisory = rowAdvisory(d.path, combinable, meaningful, unrecognizedAngle);
    const freshSources = cfg
      ? registry.fresh(d.path, cfg.stalenessTimeoutMs).map((sample) => sample.sourceRef)
      : null;
    return {
      path: d.path,
      sources: d.sources,
      freshSources,
      excludedSources: cfg ? d.sources.filter((src) => !sourceAllowed(src, cfg)) : [],
      kind,
      optedIn: cfg !== undefined,
      combinable,
      recommended: combinable && meaningful && !unrecognizedAngle,
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
      notificationsEnabled = config.notifications;
      registry.setMaxSourcesPerPath(config.maxSourcesPerPath);
      discovery.setMaxSourcesPerPath(config.maxSourcesPerPath);
      byPath = new Map(config.paths.map((p) => [p.path, p]));
      for (const path of byPath.keys()) {
        pathState.set(path, { outcome: 'allStale', rejectedCount: 0 });
      }
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
      availabilitySweep = setInterval(() => {
        if (activeGeneration !== generation) return;
        for (const [path, cfg] of byPath) {
          if (pathState.get(path)?.outcome === 'skipped') continue;
          pruneJumpState(path, cfg, systemClock.now());
          recordAvailability(path, cfg);
        }
      }, AVAILABILITY_SWEEP_MS);
      availabilitySweep.unref();
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
