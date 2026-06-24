import type { Attitude, Kind, LatLon, SampleValue } from './metrics';
import {
  ATTITUDE_COMPONENTS,
  angularDistance,
  distance,
  mapAttitudeComponents,
  maxPairwiseDistance,
} from './metrics';

const TWO_PI = 2 * Math.PI;

// Callers must pass non-empty arrays.
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
  return maxPairwiseDistance('angular', angles);
}

// Circular medoid: the observed angle with the least total angular distance to
// the others. It is the circular analogue of the median and returns an actual
// reading, so a single off sensor cannot drag it the way the circular mean is
// dragged. With a tie (for example two clustered readings) the first wins.
export function circularMedoid(angles: number[]): number {
  let best = angles[0] as number;
  let bestCost = Number.POSITIVE_INFINITY;
  for (const a of angles) {
    let cost = 0;
    for (const b of angles) cost += angularDistance(a, b);
    if (cost < bestCost) {
      bestCost = cost;
      best = a;
    }
  }
  return best;
}

function radiansToLonDegrees(rad: number): number {
  const deg = (rad * 180) / Math.PI;
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

// Circular mean of longitudes (antimeridian-safe). Single pass: convert each
// degree to radians inside the sin/cos accumulation instead of allocating an
// intermediate radians array, and skip the mean resultant length, which the
// longitude path does not use.
function lonCircularMean(lons: number[]): number {
  let sumSin = 0;
  let sumCos = 0;
  for (const d of lons) {
    const r = (d * Math.PI) / 180;
    sumSin += Math.sin(r);
    sumCos += Math.cos(r);
  }
  return radiansToLonDegrees(Math.atan2(sumSin, sumCos));
}

export function robustCenter(kind: Kind, values: SampleValue[]): SampleValue {
  if (kind === 'position') {
    const lats = (values as LatLon[]).map((v) => v.latitude);
    const lons = (values as LatLon[]).map((v) => v.longitude);
    return { latitude: median(lats), longitude: lonCircularMean(lons) };
  }
  if (kind === 'angular') {
    return circularMeanRad(values as number[]).mean;
  }
  if (kind === 'attitude') {
    const atts = values as Attitude[];
    // The rejection center uses the circular mean per axis (method-independent),
    // mirroring how position uses the median latitude for its center.
    return mapAttitudeComponents((c) => circularMeanRad(atts.map((a) => a[c])).mean);
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
  if (n < 2) return new Array(n).fill(true);

  const center = robustCenter(kind, values);
  const distances = values.map((v) => distance(kind, v, center));

  let scale = 1.4826 * median(distances);
  if (scale === 0) {
    const meanAbs = mean(distances);
    // Four points minimum for scaled-MAD to be meaningful.
    scale = meanAbs > 0 && n >= 4 ? 1.2533 * meanAbs : 0;
  }

  if (n >= 4 && scale > 0) {
    const t = madThreshold * scale;
    return distances.map((d) => d <= t);
  }
  if (rejectThreshold != null) {
    return distances.map((d) => d <= rejectThreshold);
  }
  return new Array(n).fill(true);
}

// Single source of truth for the combine methods: the schema enum and the
// config validator both derive from this tuple.
export const COMBINE_METHODS = ['median', 'trimmedMean', 'mean'] as const;
export type CombineMethod = (typeof COMBINE_METHODS)[number];
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

// Mean resultant length below this means angles are too scattered to trust.
const R_MIN = 0.2;

function linear(method: CombineMethod, xs: number[], trimFraction: number): number {
  if (method === 'mean') return mean(xs);
  if (method === 'trimmedMean') return trimmedMean(xs, trimFraction);
  return median(xs);
}

// Combine one set of angles, honoring the method, or return undefined when the
// set is too scattered to trust (mean resultant length below R_MIN, or spread
// beyond the threshold). Shared by the angular and attitude paths.
function combineAngular(angles: number[], opts: CombineOptions): number | undefined {
  const { mean: cm, R } = circularMeanRad(angles);
  // Skip the O(n^2) spread loop when R already gates the output.
  if (R < R_MIN || maxCircularSpread(angles) > opts.angularSpreadThreshold) return undefined;
  // 'mean' averages (splits the difference); the robust methods use the circular
  // medoid so a lone off reading does not drag the result.
  return opts.method === 'mean' ? cm : circularMedoid(angles);
}

// Returns { value, outcome } where value is undefined when the output diverged.
// The union is intentional: angular, attitude, and position paths may decline to
// produce a value. The caller owns usedSources and freshCount.
function computeValue(
  values: SampleValue[],
  opts: CombineOptions
): { value?: SampleValue; outcome: Outcome } {
  if (opts.kind === 'angular') {
    const value = combineAngular(values as number[], opts);
    return value === undefined ? { outcome: 'diverged' } : { value, outcome: 'ok' };
  }
  if (opts.kind === 'attitude') {
    const atts = values as Attitude[];
    const out = {} as Attitude;
    for (const c of ATTITUDE_COMPONENTS) {
      const combined = combineAngular(
        atts.map((a) => a[c]),
        opts
      );
      // Suppress the whole attitude if any single axis is too scattered.
      if (combined === undefined) return { outcome: 'diverged' };
      out[c] = combined;
    }
    return { value: out, outcome: 'ok' };
  }
  if (opts.kind === 'position') {
    const lats = (values as LatLon[]).map((v) => v.latitude);
    const lons = (values as LatLon[]).map((v) => v.longitude);
    return {
      value: {
        latitude: linear(opts.method, lats, opts.trimFraction),
        // Longitude always uses the circular mean: it is antimeridian-safe and
        // has no wrap-correct median/trimmedMean analogue, so `method` applies
        // only to latitude. Whole-source outlier rejection already ran upstream.
        longitude: lonCircularMean(lons),
      },
      outcome: 'ok',
    };
  }
  return { value: linear(opts.method, values as number[], opts.trimFraction), outcome: 'ok' };
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

  const sampleValues = samples.map((s) => s.value);
  let used = samples;
  if (opts.outlierRejection) {
    const mask = rejectMask(opts.kind, sampleValues, opts.madThreshold, opts.rejectThreshold);
    used = samples.filter((_, i) => mask[i]);
  }
  const usedSources = used.map((s) => s.sourceRef);

  if (used.length === 0) {
    return { usedSources, freshCount, outcome: 'diverged' };
  }

  // One values array, reused by computeValue and the disagree-spread check.
  const usedValues = used.map((s) => s.value);
  const computed = computeValue(usedValues, opts);
  if (computed.value === undefined) {
    return { usedSources, freshCount, outcome: computed.outcome };
  }

  let outcome: Outcome = computed.outcome;
  let spread: number | undefined;
  if (opts.disagreeThreshold != null) {
    spread = maxPairwiseDistance(opts.kind, usedValues);
    if (spread > opts.disagreeThreshold) outcome = 'disagree';
  }
  const result: CombineResult = { value: computed.value, usedSources, freshCount, outcome };
  if (outcome === 'disagree' && spread !== undefined) result.spread = spread;
  return result;
}
