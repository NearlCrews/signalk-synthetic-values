import { angularDistance, distance, Kind, SampleValue, LatLon } from './metrics'

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
