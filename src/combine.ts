import type { Attitude, Kind, LatLon, SampleValue } from './metrics';
import {
  ATTITUDE_COMPONENTS,
  angularDistance,
  distance,
  mapAttitudeComponents,
  maxPairwiseDistance,
  toDegrees,
  toRadians,
} from './metrics';

const TWO_PI = 2 * Math.PI;

// Callers must pass non-empty arrays.
export function mean(xs: number[]): number {
  // Scale before summing so finite same-sign inputs cannot overflow. Neumaier
  // compensation reduces cancellation error without another allocation.
  let sum = 0;
  let correction = 0;
  for (const x of xs) {
    const scaled = x / xs.length;
    const next = sum + scaled;
    correction += Math.abs(sum) >= Math.abs(scaled) ? sum - next + scaled : scaled - next + sum;
    sum = next;
  }
  return sum + correction;
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  // Callers pass non-empty arrays, so m and m - 1 are always in range.
  if (s.length % 2) return s[m] as number;
  const lower = s[m - 1] as number;
  const upper = s[m] as number;
  // Same-sign subtraction cannot overflow and preserves tiny equal values.
  // Opposite-sign halving avoids overflowing upper - lower.
  return Math.sign(lower) === Math.sign(upper)
    ? lower + (upper - lower) / 2
    : lower / 2 + upper / 2;
}

export function trimmedMean(xs: number[], trimFraction: number): number {
  const s = [...xs].sort((a, b) => a - b);
  if (!Number.isFinite(trimFraction) || trimFraction < 0 || trimFraction >= 0.5) return mean(s);
  const k = Math.floor(s.length * trimFraction);
  const kept = s.slice(k, s.length - k);
  return mean(kept);
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
  const deg = toDegrees(rad);
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
    const r = toRadians(d);
    sumSin += Math.sin(r);
    sumCos += Math.cos(r);
  }
  return radiansToLonDegrees(Math.atan2(sumSin, sumCos));
}

function lonCircularMedoid(lons: number[]): number {
  return radiansToLonDegrees(circularMedoid(lons.map(toRadians)));
}

export function robustCenter(kind: Kind, values: SampleValue[]): SampleValue {
  if (kind === 'position') {
    const lats = (values as LatLon[]).map((v) => v.latitude);
    const lons = (values as LatLon[]).map((v) => v.longitude);
    return { latitude: median(lats), longitude: lonCircularMedoid(lons) };
  }
  if (kind === 'angular') {
    return circularMedoid(values as number[]);
  }
  if (kind === 'attitude') {
    const atts = values as Attitude[];
    return mapAttitudeComponents((c) => circularMedoid(atts.map((attitude) => attitude[c])));
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

  let threshold = Number.POSITIVE_INFINITY;
  if (n >= 4 && scale > 0) threshold = madThreshold * scale;
  if (rejectThreshold != null) threshold = Math.min(threshold, rejectThreshold);
  return Number.isFinite(threshold)
    ? distances.map((d) => d <= threshold)
    : new Array(n).fill(true);
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
  /** Receipt time of the source observation, when supplied by the runtime registry. */
  receiptTs?: number;
  /** Monotonic registry identity, used to distinguish observations received in the same millisecond. */
  observationId?: number;
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

// Combine one set of angles, honoring the method. `value` is undefined when
// the set is too scattered to trust (mean resultant length below R_MIN, or
// spread beyond the threshold). The already-computed pairwise spread rides
// along so the disagree check in combine() does not redo the O(n^2) loop.
// Shared by the angular and attitude paths.
function combineAngular(
  angles: number[],
  opts: CombineOptions
): { value?: number; spread?: number } {
  const { mean: cm, R } = circularMeanRad(angles);
  // Skip the O(n^2) spread loop when R already gates the output.
  if (R < R_MIN) return {};
  const spread = maxCircularSpread(angles);
  if (spread > opts.angularSpreadThreshold) return { spread };
  // 'mean' averages (splits the difference); the robust methods both use the
  // circular medoid so a lone off reading does not drag the result. There is
  // no wrap-correct trimming, so 'median' and 'trimmedMean' are identical on
  // angular paths and trimFraction has no effect here.
  return { value: opts.method === 'mean' ? cm : circularMedoid(angles), spread };
}

function combineAttitude(
  values: SampleValue[],
  opts: CombineOptions
): { value?: Attitude; outcome: Outcome; spread?: number } {
  const attitudes = values as Attitude[];
  const value = {} as Attitude;
  // The attitude pairwise distance is the max per-component angular distance,
  // so the max over the per-axis spreads is the pairwise spread.
  let spread = 0;
  for (const component of ATTITUDE_COMPONENTS) {
    const result = combineAngular(
      attitudes.map((attitude) => attitude[component]),
      opts
    );
    if (result.value === undefined) return { outcome: 'diverged' };
    value[component] = result.value;
    if (result.spread !== undefined && result.spread > spread) spread = result.spread;
  }
  return { value, outcome: 'ok', spread };
}

function combinePosition(values: SampleValue[], opts: CombineOptions): LatLon {
  const positions = values as LatLon[];
  const latitudes = positions.map((position) => position.latitude);
  const longitudes = positions.map((position) => position.longitude);
  return {
    latitude: linear(opts.method, latitudes, opts.trimFraction),
    // The circular medoid gives median and trimmedMean the same robust,
    // wrap-safe behavior used for angular paths. Mean still splits the
    // difference between sources.
    longitude: opts.method === 'mean' ? lonCircularMean(longitudes) : lonCircularMedoid(longitudes),
  };
}

// Returns { value, outcome, spread } where value is undefined when the output
// diverged. The union is intentional: angular, attitude, and position paths
// may decline to produce a value. `spread` is the max pairwise distance when
// a kind already computed it (angular, attitude); the caller reuses it for
// the disagree check instead of recomputing. The caller owns usedSources and
// freshCount.
function computeValue(
  values: SampleValue[],
  opts: CombineOptions
): { value?: SampleValue; outcome: Outcome; spread?: number | undefined } {
  if (opts.kind === 'angular') {
    const r = combineAngular(values as number[], opts);
    return r.value === undefined
      ? { outcome: 'diverged' }
      : { value: r.value, outcome: 'ok', spread: r.spread };
  }
  if (opts.kind === 'attitude') {
    return combineAttitude(values, opts);
  }
  if (opts.kind === 'position') {
    return { value: combinePosition(values, opts), outcome: 'ok' };
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

  let used = samples;
  if (opts.outlierRejection) {
    // Only the rejection path needs the bare value array; build it here so a
    // run with rejection disabled allocates nothing.
    const sampleValues = samples.map((s) => s.value);
    const mask = rejectMask(opts.kind, sampleValues, opts.madThreshold, opts.rejectThreshold);
    used = samples.filter((_, i) => mask[i]);
  }
  const usedSources = used.map((s) => s.sourceRef);

  // Rejection can whittle the used set below the configured minimum. Emitting
  // then would present a thin consensus as fully corroborated, so suppress the
  // value as a divergence.
  if (used.length === 0 || used.length < opts.minSources) {
    return { usedSources, freshCount, outcome: 'diverged' };
  }
  if (used.length === 1) {
    return {
      value: (used[0] as Sample).value,
      usedSources,
      freshCount,
      outcome: 'singleSource',
    };
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
    // Angular and attitude kinds already computed the pairwise spread inside
    // computeValue; only scalar and position pay for it here.
    spread = computed.spread ?? maxPairwiseDistance(opts.kind, usedValues);
    if (spread > opts.disagreeThreshold) outcome = 'disagree';
  }
  const result: CombineResult = { value: computed.value, usedSources, freshCount, outcome };
  if (outcome === 'disagree' && spread !== undefined) result.spread = spread;
  return result;
}
