import type { Kind, LatLon, SampleValue } from './metrics';
import { angularDistance, distance, maxPairwiseDistance } from './metrics';

const TWO_PI = 2 * Math.PI;

export function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  // Callers pass non-empty arrays, so m and m - 1 are always in range.
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

export function trimmedMean(xs: number[], trimFraction: number): number {
  const s = [...xs].sort((a, b) => a - b);
  const k = Math.floor(s.length * trimFraction);
  const kept = s.slice(k, s.length - k);
  return mean(kept.length ? kept : s);
}

function normalize2pi(a: number): number {
  const t = a % TWO_PI;
  return t < 0 ? t + TWO_PI : t;
}

export function circularMeanRad(angles: number[]): { mean: number; R: number } {
  let sumSin = 0;
  let sumCos = 0;
  for (const a of angles) {
    sumSin += Math.sin(a);
    sumCos += Math.cos(a);
  }
  const R = Math.hypot(sumSin, sumCos) / angles.length;
  return { mean: normalize2pi(Math.atan2(sumSin, sumCos)), R };
}

export function maxCircularSpread(angles: number[]): number {
  let max = 0;
  for (let i = 0; i < angles.length; i++) {
    for (let j = i + 1; j < angles.length; j++) {
      max = Math.max(max, angularDistance(angles[i] as number, angles[j] as number));
    }
  }
  return max;
}

function lonsToRadians(lons: number[]): number[] {
  return lons.map((d) => (d * Math.PI) / 180);
}

function radiansToLonDegrees(rad: number): number {
  const deg = (rad * 180) / Math.PI;
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

export function robustCenter(kind: Kind, values: SampleValue[]): SampleValue {
  if (kind === 'position') {
    const lats = (values as LatLon[]).map((v) => v.latitude);
    const lons = (values as LatLon[]).map((v) => v.longitude);
    const lonMeanRad = circularMeanRad(lonsToRadians(lons)).mean;
    return { latitude: median(lats), longitude: radiansToLonDegrees(lonMeanRad) };
  }
  if (kind === 'angular') {
    return circularMeanRad(values as number[]).mean;
  }
  return median(values as number[]);
}

export function rejectMask(
  kind: Kind,
  values: SampleValue[],
  madThreshold: number,
  rejectThreshold?: number
): boolean[] {
  const n = values.length;
  if (n < 2) return values.map(() => true);

  const center = robustCenter(kind, values);
  const distances = values.map((v) => distance(kind, v, center));

  let scale = 1.4826 * median(distances);
  if (scale === 0) {
    const meanAbs = mean(distances);
    scale = meanAbs > 0 && n >= 4 ? 1.2533 * meanAbs : 0;
  }

  if (n >= 4 && scale > 0) {
    const t = madThreshold * scale;
    return distances.map((d) => d <= t);
  }
  if (rejectThreshold != null) {
    return distances.map((d) => d <= rejectThreshold);
  }
  return values.map(() => true);
}

export type CombineMethod = 'median' | 'trimmedMean' | 'mean';
export type Outcome =
  | 'ok'
  | 'singleSource'
  | 'belowMin'
  | 'allStale'
  | 'diverged'
  | 'disagree'
  | 'skipped';

export interface Sample {
  sourceRef: string;
  value: SampleValue;
}

export interface CombineOptions {
  kind: Kind;
  method: CombineMethod;
  minSources: number;
  outlierRejection: boolean;
  madThreshold: number;
  rejectThreshold?: number | undefined;
  disagreeThreshold?: number | undefined;
  angularSpreadThreshold: number;
  trimFraction: number;
}

export interface CombineResult {
  value?: SampleValue;
  usedSources: string[];
  freshCount: number;
  outcome: Outcome;
  spread?: number;
}

const R_MIN = 0.2;

function linear(method: CombineMethod, xs: number[], trimFraction: number): number {
  if (method === 'mean') return mean(xs);
  if (method === 'trimmedMean') return trimmedMean(xs, trimFraction);
  return median(xs);
}

function computeValue(
  used: Sample[],
  opts: CombineOptions,
  usedSources: string[],
  freshCount: number
): { value: SampleValue; outcome: Outcome } | CombineResult {
  if (opts.kind === 'angular') {
    const angles = used.map((s) => s.value as number);
    const { mean: cm, R } = circularMeanRad(angles);
    if (R < R_MIN || maxCircularSpread(angles) > opts.angularSpreadThreshold) {
      return { usedSources, freshCount, outcome: 'diverged' };
    }
    return { value: cm, outcome: 'ok' };
  }
  if (opts.kind === 'position') {
    const lats = used.map((s) => (s.value as LatLon).latitude);
    const lons = used.map((s) => (s.value as LatLon).longitude);
    const lonMeanRad = circularMeanRad(lonsToRadians(lons)).mean;
    return {
      value: {
        latitude: linear(opts.method, lats, opts.trimFraction),
        longitude: radiansToLonDegrees(lonMeanRad),
      },
      outcome: 'ok',
    };
  }
  return {
    value: linear(
      opts.method,
      used.map((s) => s.value as number),
      opts.trimFraction
    ),
    outcome: 'ok',
  };
}

export function combine(samples: Sample[], opts: CombineOptions): CombineResult {
  const freshCount = samples.length;
  if (freshCount === 0) {
    return { usedSources: [], freshCount, outcome: 'allStale' };
  }
  const only = samples[0];
  if (freshCount === 1 && only && opts.minSources <= 1) {
    return {
      value: only.value,
      usedSources: [only.sourceRef],
      freshCount,
      outcome: 'singleSource',
    };
  }
  if (freshCount < opts.minSources) {
    return { usedSources: samples.map((s) => s.sourceRef), freshCount, outcome: 'belowMin' };
  }

  let used = samples;
  if (opts.outlierRejection) {
    const mask = rejectMask(
      opts.kind,
      samples.map((s) => s.value),
      opts.madThreshold,
      opts.rejectThreshold
    );
    used = samples.filter((_, i) => mask[i]);
  }
  const usedSources = used.map((s) => s.sourceRef);

  if (used.length === 0) {
    return { usedSources, freshCount, outcome: 'diverged' };
  }

  const computed = computeValue(used, opts, usedSources, freshCount);
  if (!('value' in computed) || computed.value === undefined) return computed as CombineResult;

  let outcome: Outcome = computed.outcome;
  let spread: number | undefined;
  if (opts.disagreeThreshold != null) {
    spread = maxPairwiseDistance(
      opts.kind,
      used.map((s) => s.value)
    );
    if (spread > opts.disagreeThreshold) outcome = 'disagree';
  }
  const result: CombineResult = { value: computed.value, usedSources, freshCount, outcome };
  if (outcome === 'disagree' && spread !== undefined) result.spread = spread;
  return result;
}
