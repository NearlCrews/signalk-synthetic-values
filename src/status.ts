import type { CombineMethod, CombineResult, Outcome } from './combine';
import type { Kind } from './metrics';
import { oxfordJoin, plural } from './textFormat';

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
function sourceCount(result: CombineResult): string {
  const used = result.usedSources.length;
  if (result.freshCount > used) return `${used} of ${result.freshCount} sources`;
  return `${used} source${plural(used)}`;
}

export function pathStatus(
  path: string,
  result: CombineResult,
  sourceLabel: string,
  effectiveMin: number,
  method: CombineMethod,
  kind: Kind = 'scalar'
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

/** What the aggregate status needs to know about one configured path. */
export interface PathState {
  outcome: Outcome;
  /** Fresh sources dropped by outlier rejection on the last combine. */
  rejectedCount: number;
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
