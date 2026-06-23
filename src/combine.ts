import { angularDistance } from './metrics'

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
