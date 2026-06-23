import { CombineMethod, CombineResult } from './combine'

export function pathStatus(
  path: string,
  result: CombineResult,
  sourceLabel: string,
  effectiveMin: number,
  prioritySet: boolean,
  method: CombineMethod,
): string {
  switch (result.outcome) {
    case 'singleSource':
      return `${path}: running on 1 source, redundancy lost.`
    case 'belowMin':
    case 'allStale':
      return `${path}: waiting for ${effectiveMin} sources (have ${result.freshCount}).`
    case 'diverged':
      return `${path}: sources diverge, synthetic value suppressed.`
    case 'disagree': {
      const spreadStr = result.spread !== undefined ? result.spread.toPrecision(4) : '?'
      return `${path}: sources disagree (max spread ${spreadStr}), emitting ${method}.`
    }
    default:
      if (!prioritySet) {
        return `Combining ${result.usedSources.length} sources on ${path}. Set this path's source priority to prefer ${sourceLabel} in Server, Data, Sources.`
      }
      return `Combining ${result.usedSources.length} sources on ${path}.`
  }
}

export function summaryStatus(
  activePaths: number,
  detectedCount: number,
  skipped: { path: string; reason: string }[],
): string {
  const parts: string[] = []
  if (detectedCount === 0) {
    parts.push('No multi-source paths detected yet (need 2+ sources on a path).')
  } else {
    parts.push(`Combining on ${activePaths} of ${detectedCount} detected paths.`)
  }
  if (skipped.length) {
    parts.push(skipped.map((s) => `skipped: ${s.path} (${s.reason})`).join(', '))
  }
  return parts.join(' ')
}
