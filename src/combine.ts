import { angularDistance, distance, Kind, SampleValue, LatLon, maxPairwiseDistance } from './metrics'

const TWO_PI = 2 * Math.PI

export function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function trimmedMean(xs: number[], trimFraction: number): number {
  const s = [...xs].sort((a, b) => a - b)
  const k = Math.floor(s.length * trimFraction)
  const kept = s.slice(k, s.length - k)
  return mean(kept.length ? kept : s)
}

function normalize2pi(a: number): number {
  const t = a % TWO_PI
  return t < 0 ? t + TWO_PI : t
}

export function circularMeanRad(angles: number[]): { mean: number; R: number } {
  let sumSin = 0
  let sumCos = 0
  for (const a of angles) {
    sumSin += Math.sin(a)
    sumCos += Math.cos(a)
  }
  const R = Math.hypot(sumSin, sumCos) / angles.length
  return { mean: normalize2pi(Math.atan2(sumSin, sumCos)), R }
}

export function maxCircularSpread(angles: number[]): number {
  let max = 0
  for (let i = 0; i < angles.length; i++) {
    for (let j = i + 1; j < angles.length; j++) {
      max = Math.max(max, angularDistance(angles[i], angles[j]))
    }
  }
  return max
}

function lonsToRadians(lons: number[]): number[] {
  return lons.map((d) => (d * Math.PI) / 180)
}

function radiansToLonDegrees(rad: number): number {
  const deg = (rad * 180) / Math.PI
  return (((deg + 180) % 360) + 360) % 360 - 180
}

export function robustCenter(kind: Kind, values: SampleValue[]): SampleValue {
  if (kind === 'position') {
    const lats = (values as LatLon[]).map((v) => v.latitude)
    const lons = (values as LatLon[]).map((v) => v.longitude)
    const lonMeanRad = circularMeanRad(lonsToRadians(lons)).mean
    return { latitude: median(lats), longitude: radiansToLonDegrees(lonMeanRad) }
  }
  if (kind === 'angular') {
    return circularMeanRad(values as number[]).mean
  }
  return median(values as number[])
}

export function rejectMask(
  kind: Kind,
  values: SampleValue[],
  madThreshold: number,
  rejectThreshold?: number,
): boolean[] {
  const n = values.length
  if (n < 2) return values.map(() => true)

  const center = robustCenter(kind, values)
  const distances = values.map((v) => distance(kind, v, center))

  let scale = 1.4826 * median(distances)
  if (scale === 0) {
    const meanAbs = mean(distances)
    scale = meanAbs > 0 && n >= 4 ? 1.2533 * meanAbs : 0
  }

  if (n >= 4 && scale > 0) {
    const t = madThreshold * scale
    return distances.map((d) => d <= t)
  }
  if (rejectThreshold != null) {
    return distances.map((d) => d <= rejectThreshold)
  }
  return values.map(() => true)
}

export type CombineMethod = 'median' | 'trimmedMean' | 'mean'
export type Outcome =
  | 'ok' | 'singleSource' | 'belowMin' | 'allStale' | 'diverged' | 'disagree' | 'skipped'

export interface Sample {
  sourceRef: string
  value: SampleValue
}

export interface CombineOptions {
  kind: Kind
  method: CombineMethod
  minSources: number
  outlierRejection: boolean
  madThreshold: number
  rejectThreshold?: number
  disagreeThreshold?: number
  angularSpreadThreshold: number
  trimFraction: number
}

export interface CombineResult {
  value?: SampleValue
  usedSources: string[]
  freshCount: number
  outcome: Outcome
}

const R_MIN = 0.2

function linear(method: CombineMethod, xs: number[], trimFraction: number): number {
  if (method === 'mean') return mean(xs)
  if (method === 'trimmedMean') return trimmedMean(xs, trimFraction)
  return median(xs)
}

export function combine(samples: Sample[], opts: CombineOptions): CombineResult {
  const freshCount = samples.length
  if (freshCount === 0) {
    return { usedSources: [], freshCount, outcome: 'allStale' }
  }
  if (freshCount === 1 && opts.minSources <= 1) {
    return { value: samples[0].value, usedSources: [samples[0].sourceRef], freshCount, outcome: 'singleSource' }
  }
  if (freshCount < opts.minSources) {
    return { usedSources: samples.map((s) => s.sourceRef), freshCount, outcome: 'belowMin' }
  }

  let used = samples
  if (opts.outlierRejection) {
    const mask = rejectMask(opts.kind, samples.map((s) => s.value), opts.madThreshold, opts.rejectThreshold)
    used = samples.filter((_, i) => mask[i])
  }
  const usedSources = used.map((s) => s.sourceRef)

  if (used.length === 0) {
    return { usedSources, freshCount, outcome: 'diverged' }
  }

  let value: SampleValue
  if (opts.kind === 'angular') {
    const angles = used.map((s) => s.value as number)
    const { mean: cm, R } = circularMeanRad(angles)
    if (R < R_MIN || maxCircularSpread(angles) > opts.angularSpreadThreshold) {
      return { usedSources, freshCount, outcome: 'diverged' }
    }
    value = cm
  } else if (opts.kind === 'position') {
    const lats = used.map((s) => (s.value as LatLon).latitude)
    const lons = used.map((s) => (s.value as LatLon).longitude)
    const lonMeanRad = circularMeanRad(lonsToRadians(lons)).mean
    value = { latitude: linear(opts.method, lats, opts.trimFraction), longitude: radiansToLonDegrees(lonMeanRad) }
  } else {
    value = linear(opts.method, used.map((s) => s.value as number), opts.trimFraction)
  }

  let outcome: Outcome = 'ok'
  if (opts.disagreeThreshold != null) {
    const spread = maxPairwiseDistance(opts.kind, used.map((s) => s.value))
    if (spread > opts.disagreeThreshold) outcome = 'disagree'
  }
  return { value, usedSources, freshCount, outcome }
}
