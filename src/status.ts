import type { CombineMethod, CombineResult, Outcome } from './combine';

export function pathStatus(
  path: string,
  result: CombineResult,
  sourceLabel: string,
  effectiveMin: number,
  method: CombineMethod
): string {
  switch (result.outcome) {
    case 'singleSource':
      return `${path}: running on 1 source, redundancy lost.`;
    case 'belowMin':
    case 'allStale':
      return `${path}: waiting for ${effectiveMin} sources (have ${result.freshCount}).`;
    case 'diverged':
      return `${path}: sources diverge, synthetic value suppressed.`;
    case 'disagree': {
      const spreadStr = result.spread !== undefined ? result.spread.toPrecision(4) : '?';
      return `${path}: sources disagree (max spread ${spreadStr}), emitting ${method}.`;
    }
    default:
      return `Combining ${result.usedSources.length} sources on ${path}. Set this path's source priority to prefer ${sourceLabel} in Server, Data, Sources.`;
  }
}

/**
 * A single, stable status line summarizing the whole plugin run. Replaces the
 * old per-path status that was rewritten on every emit, which made the admin
 * status bar flash through one message per combined path on each cycle. This
 * aggregate changes only when the overall picture changes (a path starts or
 * stops combining, a divergence or disagreement appears or clears), so the
 * caller can dedupe and the bar stays readable. Per-path detail still goes to
 * the debug log via pathStatus.
 */
export function aggregateStatus(
  configuredCount: number,
  outcomes: Map<string, Outcome>,
  detectedCount: number,
  skipped: { path: string; reason: string }[]
): string {
  if (configuredCount === 0) return appendSkipped(detectionMessage(detectedCount), skipped);

  const t = tallyOutcomes(outcomes);
  const plural = configuredCount === 1 ? '' : 's';
  const notes: string[] = [];
  if (t.waiting > 0) notes.push(`${t.waiting} waiting for sources`);
  if (t.diverging > 0) notes.push(`${t.diverging} diverging`);
  if (t.disagreeing > 0) notes.push(`${t.disagreeing} disagreeing`);
  if (t.singleSource > 0) notes.push(`${t.singleSource} on a single source`);
  let body = `Combining ${t.emitting} of ${configuredCount} path${plural}.`;
  if (notes.length > 0) body += ` ${joinOxford(notes)}.`;
  return appendSkipped(body, skipped);
}

function detectionMessage(detectedCount: number): string {
  if (detectedCount === 0) return 'No multi-source paths detected yet (need 2+ sources on a path).';
  const plural = detectedCount === 1 ? '' : 's';
  return `${detectedCount} multi-source path${plural} detected. Add paths in the config panel to combine them.`;
}

interface OutcomeTally {
  emitting: number;
  waiting: number;
  diverging: number;
  disagreeing: number;
  singleSource: number;
}

// Bucket each path's last outcome. A path that emitted a value (ok, disagree,
// or singleSource) counts toward `emitting`; disagree and singleSource also
// raise their own caution count so the summary can flag them.
function tallyOutcomes(outcomes: Map<string, Outcome>): OutcomeTally {
  const t: OutcomeTally = {
    emitting: 0,
    waiting: 0,
    diverging: 0,
    disagreeing: 0,
    singleSource: 0,
  };
  for (const outcome of outcomes.values()) {
    switch (outcome) {
      case 'ok':
        t.emitting++;
        break;
      case 'disagree':
        t.emitting++;
        t.disagreeing++;
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
    }
  }
  return t;
}

// Join a list with the serial (Oxford) comma: "a", "a and b", "a, b, and c".
function joinOxford(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function appendSkipped(base: string, skipped: { path: string; reason: string }[]): string {
  if (skipped.length === 0) return base;
  return `${base} ${skipped.map((s) => `skipped: ${s.path} (${s.reason})`).join(', ')}`;
}
