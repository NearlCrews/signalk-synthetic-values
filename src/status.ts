import type { CombineMethod, CombineResult, Outcome } from './combine';
import type { NotificationState } from './emitter';
import type { Kind } from './metrics';
import { oxfordJoin, plural } from './textFormat';

/**
 * Everything a configured path can conclude in one cycle: what the combiner
 * produced, plus the outcome the damping stage adds once a combined value has
 * been through the slew limiter. Keeping the wider vocabulary here rather than
 * in the combiner means an exhaustive switch over a `combine()` result is never
 * asked to handle a case the combiner cannot return.
 */
export type PathOutcome = Outcome | 'slewLimited';

/** A combine result carried through the damping stage, which may widen the outcome. */
export interface PathResult extends Omit<CombineResult, 'outcome'> {
  outcome: PathOutcome;
}

// Unit of the spread the combiner reports, by kind. Without it a spread of 28
// on an angular path reads as degrees when it is radians.
function spreadUnit(kind: Kind): string {
  if (kind === 'position') return ' m';
  if (kind === 'angular' || kind === 'attitude') return ' rad';
  return ' in the path units';
}

function spreadText(spread: number | undefined, kind: Kind): string {
  return spread !== undefined ? `${spread.toPrecision(4)}${spreadUnit(kind)}` : 'unknown';
}

// "3 of 4 sources" when rejection dropped one, "3 sources" when it did not, so
// a newly rejected sensor changes the line the operator reads.
function sourceCount(result: PathResult): string {
  const used = result.usedSources.length;
  if (result.freshCount > used) return `${used} of ${result.freshCount} sources`;
  return `${used} source${plural(used)}`;
}

export function pathStatus(
  path: string,
  result: PathResult,
  sourceLabel: string,
  effectiveMin: number,
  method: CombineMethod,
  kind: Kind
): string {
  switch (result.outcome) {
    case 'singleSource':
      return `${path}: running on 1 source, redundancy lost.`;
    case 'belowMin':
      return `${path}: waiting for ${effectiveMin} sources (have ${result.freshCount}).`;
    case 'allStale':
      return `${path}: all sources stale, waiting for fresh data.`;
    case 'diverged':
      return `${path}: sources diverge, synthetic value suppressed.`;
    case 'disagree': {
      const spreadStr = spreadText(result.spread, kind);
      if (result.unsupported) {
        return `${path}: sources split into groups and none is near the ${method} (max spread ${spreadStr}), emitting anyway. Set a disagreement distance to say how far apart is acceptable, or an absolute reject distance to drop the outlying group.`;
      }
      return `${path}: sources disagree (max spread ${spreadStr}), emitting ${method}.`;
    }
    case 'slewLimited':
      return `${path}: slew limit is holding the output behind the sources, emitting a value that lags.`;
    case 'skipped':
      return `${path}: skipped, value is not combinable.`;
    case 'ok':
      // Combining normally. The priority reminder lives here because this is the
      // only outcome where the synthetic value is actually being emitted.
      return `Combining ${sourceCount(result)} on ${path}. Set this path's source priority to prefer ${sourceLabel} in Data, Priorities.`;
    default: {
      // Exhaustiveness guard: a new Outcome member surfaces here as a compile
      // error rather than silently inheriting the 'ok' message.
      const unreachable: never = result.outcome;
      return unreachable;
    }
  }
}

/**
 * The last outcome recorded for one configured path. The aggregate status
 * buckets `outcome` and `rejectedCount`; the counts are what decide whether
 * this cycle tells an operator anything the last one did not, so a path that
 * keeps reporting the same picture costs no message building at all.
 */
export interface PathState {
  outcome: PathOutcome;
  /** Fresh sources dropped by outlier rejection on the last combine. */
  rejectedCount: number;
  /** Sources fresh enough to take part in the last combine. */
  freshCount: number;
  /** Sources that survived rejection and produced the last value. */
  usedCount: number;
}

/**
 * How much confidence the last cycle leaves in the published value. `alert`
 * means the value should not be trusted as published, `warn` means the plugin
 * is running degraded, and `normal` clears a previous notification. Undefined
 * means there is nothing worth saying on this channel.
 *
 * `hasEmitted` is whether the path has published a value in this run: a path
 * that never started is a configuration matter, one that stopped is an event.
 */
function confidence(
  result: PathResult,
  hasEmitted: boolean
): { state: NotificationState; message: string } | undefined {
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
            message: `Sources split into groups and the published value matches none of them (${sourceCount(result)}). Set a disagreement distance for this path to say how far apart is acceptable.`,
          }
        : {
            state: 'alert',
            message: `Sources disagree by more than the configured distance, and the combined value is being published anyway (${sourceCount(result)}).`,
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
      return hasEmitted
        ? {
            state: 'warn',
            message: `Not enough fresh sources to combine (${result.freshCount} fresh), so the value has stopped updating.`,
          }
        : undefined;
    case 'ok':
      return result.rejectedSources.length > 0
        ? {
            state: 'warn',
            message: `${result.rejectedSources.length} of ${result.freshCount} sources rejected as outliers; combining the remaining ${result.usedSources.length}.`,
          }
        : { state: 'normal', message: 'Combining normally.' };
    case 'skipped':
      return undefined;
  }
}

/** What one recorded outcome says to each audience, built from one switch each. */
export interface OutcomeReport {
  /** Per-path detail for the debug log. */
  line: string;
  /** The confidence notification, or undefined when there is nothing to publish. */
  notification: { state: NotificationState; message: string } | undefined;
}

export interface OutcomeContext {
  path: string;
  result: PathResult;
  sourceLabel: string;
  minSources: number;
  method: CombineMethod;
  kind: Kind;
  hasEmitted: boolean;
}

/**
 * Everything the runtime says about one recorded outcome, so the log line and
 * the notification are built from the same module and cannot drift into two
 * descriptions of one condition.
 */
export function outcomeReport(context: OutcomeContext): OutcomeReport {
  return {
    line: pathStatus(
      context.path,
      context.result,
      context.sourceLabel,
      context.minSources,
      context.method,
      context.kind
    ),
    notification: confidence(context.result, context.hasEmitted),
  };
}

/**
 * A single, stable status line summarizing the whole plugin run. Replaces the
 * old per-path status that was rewritten on every emit, which made the admin
 * status bar flash through one message per combined path on each cycle. This
 * aggregate changes only when the overall picture changes (a path starts or
 * stops combining, a divergence or disagreement appears or clears, a sensor is
 * rejected or comes back), so the caller can dedupe and the bar stays readable.
 * Per-path detail still goes to the debug log via pathStatus.
 */
export function aggregateStatus(
  configuredCount: number,
  states: Map<string, PathState>,
  detectedCount: number,
  skipped: { path: string; reason: string }[],
  unrecognizedAngles: string[] = []
): string {
  const suffix = (base: string): string =>
    appendAngleReview(appendSkipped(base, skipped), unrecognizedAngles);
  if (configuredCount === 0) return suffix(detectionMessage(detectedCount));

  const t = tallyOutcomes(states);
  const notes: string[] = [];
  if (t.waiting > 0) notes.push(`${t.waiting} waiting for sources`);
  if (t.diverging > 0) notes.push(`${t.diverging} diverging`);
  if (t.disagreeing > 0) notes.push(`${t.disagreeing} disagreeing`);
  if (t.lagging > 0) notes.push(`${t.lagging} held back by the slew limit`);
  if (t.singleSource > 0) notes.push(`${t.singleSource} on a single source`);
  if (t.rejecting > 0) notes.push(`${t.rejecting} with a rejected source`);
  let body = `Combining ${t.emitting} of ${configuredCount} path${plural(configuredCount)}.`;
  if (notes.length > 0) body += ` ${oxfordJoin(notes)}.`;
  return suffix(body);
}

function detectionMessage(detectedCount: number): string {
  if (detectedCount === 0) return 'No multi-source paths detected yet (need 2+ sources on a path).';
  return `${detectedCount} multi-source path${plural(detectedCount)} detected. Add paths in the config panel to combine them.`;
}

interface OutcomeTally {
  emitting: number;
  waiting: number;
  diverging: number;
  disagreeing: number;
  lagging: number;
  singleSource: number;
  rejecting: number;
}

// Bucket each path's last outcome. A path that emitted a value (ok, disagree,
// slewLimited, or singleSource) counts toward `emitting`; the rest also raise
// their own caution count so the summary can flag them.
function tallyOutcomes(states: Map<string, PathState>): OutcomeTally {
  const t: OutcomeTally = {
    emitting: 0,
    waiting: 0,
    diverging: 0,
    disagreeing: 0,
    lagging: 0,
    singleSource: 0,
    rejecting: 0,
  };
  for (const state of states.values()) {
    if (state.rejectedCount > 0) t.rejecting++;
    switch (state.outcome) {
      case 'ok':
        t.emitting++;
        break;
      case 'disagree':
        t.emitting++;
        t.disagreeing++;
        break;
      case 'slewLimited':
        t.emitting++;
        t.lagging++;
        break;
      case 'singleSource':
        t.emitting++;
        t.singleSource++;
        break;
      case 'belowMin':
      case 'allStale':
        t.waiting++;
        break;
      case 'diverged':
        t.diverging++;
        break;
      case 'skipped':
        // Not combinable: not counted in any bucket, but listed in `skipped`.
        break;
    }
  }
  return t;
}

function appendSkipped(base: string, skipped: { path: string; reason: string }[]): string {
  if (skipped.length === 0) return base;
  return `${base} ${skipped.map((s) => `skipped: ${s.path} (${s.reason})`).join(', ')}.`;
}

// Names the paths reporting radians that the plugin could not confirm as
// full-circle quantities, because those are the ones a linear average turns
// into a reciprocal bearing. Naming them makes the status line the shortest
// route from "something is off" to the setting that fixes it.
function appendAngleReview(base: string, paths: string[]): string {
  if (paths.length === 0) return base;
  return `${base} Set angular wrapping on: ${paths.join(', ')}.`;
}
