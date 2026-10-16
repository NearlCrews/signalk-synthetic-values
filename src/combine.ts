import { BOUNDS, inBounds } from './bounds';
import type { Attitude, Kind, LatLon, SampleValue } from './metrics';
import {
  ATTITUDE_COMPONENTS,
  angularDistance,
  componentValues,
  distance,
  mapAttitudeComponents,
  maxPairwiseDistance,
  onBranchOf,
  toDegrees,
  toRadians,
  wrapLongitude,
  wrapRadians,
} from './metrics';

// Single source of truth for the combine methods: the schema enum and the
// config validator both derive from this tuple.
export const COMBINE_METHODS = ['median', 'trimmedMean', 'mean'] as const;
export type CombineMethod = (typeof COMBINE_METHODS)[number];
// What combining one set of readings can conclude. Only these are reachable
// from combine(); the damping stage adds its own outcome downstream, so an
// exhaustive switch over a combine() result is not asked to handle a case the
// combiner cannot produce.
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
  /** Max pairwise distance across the used readings, in the kind's units. */
  spread?: number;
  /**
   * Fresh sources dropped by outlier rejection, so the caller can announce a
   * failing sensor. Always present, empty when nothing was rejected, so a
   * reader counts rather than reasoning about an absent array.
   */
  rejectedSources: string[];
  /**
   * Set when the published value sits in the gap between two groups of readings
   * rather than inside one of them, so no source is anywhere near it.
   */
  unsupported?: true;
}

// Callers must pass non-empty arrays. Both mean and median answer NaN on an
// empty one so the two agree on the illegal input rather than one returning a
// plausible-looking zero.
export function mean(xs: ArrayLike<number>): number {
  const n = xs.length;
  if (n === 0) return Number.NaN;
  // Scale before summing so finite same-sign inputs cannot overflow. Neumaier
  // compensation reduces cancellation error without another allocation.
  let sum = 0;
  let correction = 0;
  for (let i = 0; i < n; i++) {
    const scaled = (xs[i] as number) / n;
    const next = sum + scaled;
    correction += Math.abs(sum) >= Math.abs(scaled) ? sum - next + scaled : scaled - next + sum;
    sum = next;
  }
  return sum + correction;
}

// A typed copy sorts numerically by default, so there is no comparator to call
// back into for every comparison. Callers pass finite values.
function sortedCopy(xs: number[]): Float64Array {
  return Float64Array.from(xs).sort();
}

export function median(xs: number[]): number {
  if (xs.length === 0) return Number.NaN;
  const s = sortedCopy(xs);
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

// validateConfig keeps trimFraction in range for the runtime; a direct caller
// passing anything else gets the plain mean.
export function trimmedMean(xs: number[], trimFraction: number): number {
  if (!inBounds(trimFraction, BOUNDS.trimFraction)) return mean(xs);
  const s = sortedCopy(xs);
  const k = Math.floor(s.length * trimFraction);
  return mean(s.subarray(k, s.length - k));
}

export function circularMeanRad(angles: number[]): { mean: number; R: number } {
  const first = angles[0];
  // Identical readings are the common case, and the sin/cos/atan2 round trip
  // loses the exact value: a set of exact 0.1s comes back as
  // 0.09999999999999964. Answering here rather than at one call site means
  // every caller, including the 'mean' method and the longitude path, gets the
  // exact reading back.
  if (first !== undefined && angles.every((a) => a === first)) {
    return { mean: wrapRadians(first), R: 1 };
  }
  let sumSin = 0;
  let sumCos = 0;
  for (const a of angles) {
    sumSin += Math.sin(a);
    sumCos += Math.cos(a);
  }
  const R = Math.hypot(sumSin, sumCos) / angles.length;
  return { mean: wrapRadians(Math.atan2(sumSin, sumCos)), R };
}

export function maxCircularSpread(angles: number[]): number {
  return maxPairwiseDistance('angular', angles);
}

// Relative slack on the medoid cost comparison. Tied candidates rarely score
// bit-for-bit identically once the angles have been through sin and cos, so the
// tie test needs a little room or a two-source set falls back to positional
// order again.
const MEDOID_TIE_EPSILON = 1e-12;

/**
 * One walk of the pairwise matrix answers both questions an angular combine
 * asks: the widest separation, which gates the output, and each angle's total
 * distance to the others, which picks the medoid. Each pair is visited once.
 */
function pairwiseAngular(angles: number[]): { costs: number[]; spread: number } {
  const costs = new Array<number>(angles.length).fill(0);
  let spread = 0;
  for (let i = 0; i < angles.length; i++) {
    for (let j = i + 1; j < angles.length; j++) {
      const separation = angularDistance(angles[i] as number, angles[j] as number);
      costs[i] = (costs[i] as number) + separation;
      costs[j] = (costs[j] as number) + separation;
      if (separation > spread) spread = separation;
    }
  }
  return { costs, spread };
}

// The medoid given the total angular distance from each angle to all the
// others, so a caller that already walked the pairwise matrix does not walk it
// a second time.
function medoidFromCosts(angles: number[], costs: number[]): number {
  let bestCost = Number.POSITIVE_INFINITY;
  for (const cost of costs) {
    if (cost < bestCost) bestCost = cost;
  }
  const slack = bestCost * MEDOID_TIE_EPSILON;
  const tied: number[] = [];
  for (const [i, cost] of costs.entries()) {
    if (cost <= bestCost + slack) tied.push(angles[i] as number);
  }
  // One reading, or one value read several times, is returned as it was read,
  // so the caller can place it on its branch exactly rather than after a
  // round trip through [0, 2pi).
  const first = tied[0] as number;
  return tied.every((a) => a === first) ? first : circularMeanRad(tied).mean;
}

/**
 * Circular medoid: the observed angle with the least total angular distance to
 * the others. It is the circular analogue of the median and returns an actual
 * reading, so a single off sensor cannot drag it the way the circular mean is
 * dragged. Ties resolve to the circular mean of the tied candidates, taken the
 * short way around, rather than to whichever source happened to register
 * first: with two sources that makes the result the bisector, so the second
 * sensor contributes instead of being discarded, and the output no longer moves
 * when delta arrival order changes.
 */
export function circularMedoid(angles: number[]): number {
  return medoidFromCosts(angles, pairwiseAngular(angles).costs);
}

function radiansToLonDegrees(rad: number): number {
  return wrapLongitude(toDegrees(rad));
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

// Longitude is combined circularly and is safe across the antimeridian.
// Latitude uses a plain linear median and has no equivalent handling across a
// pole: two fixes straddling the pole median to a latitude just short of it
// rather than to the pole itself. Left as a known limit rather than fixed,
// because reaching it needs two receivers on opposite sides of a pole and
// three-dimensional averaging would change position combining everywhere for a
// case a vessel cannot reach.
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
    return mapAttitudeComponents((c) => {
      const angles = componentValues(atts, c);
      return angles.length > 0 ? circularMedoid(angles) : undefined;
    });
  }
  return median(values as number[]);
}

/**
 * Which readings survive rejection. `madThreshold` of `undefined` disables the
 * statistical half, which is what `outlierRejection: false` means: the absolute
 * `rejectThreshold` is a hard limit rather than a statistical one, so it keeps
 * working on its own. It is also the only guard that operates below four
 * sources, where scaled MAD is not meaningful.
 */
export function rejectMask(
  kind: Kind,
  values: SampleValue[],
  madThreshold: number | undefined,
  rejectThreshold?: number
): boolean[] {
  return rejection(kind, values, madThreshold, rejectThreshold).mask;
}

// The rejection mask together with the robust center it measured from, so a
// median combine that rejected nothing can publish that center rather than
// computing the same median again.
function rejection(
  kind: Kind,
  values: SampleValue[],
  madThreshold: number | undefined,
  rejectThreshold: number | undefined
): { mask: boolean[]; center?: SampleValue | undefined } {
  const n = values.length;
  if (n < 2) return { mask: new Array(n).fill(true) };

  const center = robustCenter(kind, values);
  const distances = values.map((v) => distance(kind, v, center));

  let threshold = Number.POSITIVE_INFINITY;
  if (madThreshold !== undefined) {
    let scale = 1.4826 * median(distances);
    if (scale === 0) {
      const meanAbs = mean(distances);
      // Four points minimum for scaled-MAD to be meaningful.
      scale = meanAbs > 0 && n >= 4 ? 1.2533 * meanAbs : 0;
    }
    if (n >= 4 && scale > 0) threshold = madThreshold * scale;
  }
  if (rejectThreshold !== undefined) threshold = Math.min(threshold, rejectThreshold);
  const mask = Number.isFinite(threshold)
    ? distances.map((d) => d <= threshold)
    : new Array(n).fill(true);
  return { mask, center };
}

// Mean resultant length below this means angles are too scattered to trust.
const R_MIN = 0.2;

// Shared empty rejection list, so a run that rejects nothing allocates nothing.
// Never mutated: applyRejection builds a fresh array when it has names to add.
const NOTHING_REJECTED: string[] = [];

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
  // Identical readings are the common case, and they come back exactly, on the
  // branch they arrived on.
  const first = angles[0];
  if (first !== undefined && angles.every((a) => a === first)) {
    return { value: onBranchOf(first, angles), spread: 0 };
  }
  const { mean: cm, R } = circularMeanRad(angles);
  // Skip the O(n^2) spread loop when R already gates the output.
  if (R < R_MIN) return {};
  const { costs, spread } = pairwiseAngular(angles);
  if (spread > opts.angularSpreadThreshold) return { spread };
  // 'mean' averages (splits the difference); the robust methods both use the
  // circular medoid so a lone off reading does not drag the result. There is
  // no wrap-correct trimming, so 'median' and 'trimmedMean' are identical on
  // angular paths and trimFraction has no effect here.
  const value = opts.method === 'mean' ? cm : medoidFromCosts(angles, costs);
  return { value: onBranchOf(value, angles), spread };
}

/**
 * Combine each attitude component over the sources that report it, so a heel
 * sensor's roll and pitch combine with a full motion sensor's. At least one
 * component must be reported by `minSources` sources, or nothing here is
 * corroborated and nothing is published. Beside one that is, a component fewer
 * sources report passes through from them: Signal K ranks sources for the
 * whole `navigation.attitude` object, so leaving it out would take the motion
 * sensor's yaw away from every consumer once the synthetic source is preferred.
 * One scattered component suppresses the whole value.
 */
function combineAttitude(
  values: SampleValue[],
  opts: CombineOptions
): { value?: Attitude; outcome: Outcome; spread?: number } {
  const attitudes = values as Attitude[];
  const value: Attitude = {};
  // The attitude pairwise distance is the max per-component angular distance,
  // so the max over the per-axis spreads is the pairwise spread.
  let spread = 0;
  let corroborated = false;
  for (const component of ATTITUDE_COMPONENTS) {
    const angles = componentValues(attitudes, component);
    if (angles.length === 0) continue;
    if (angles.length >= opts.minSources) corroborated = true;
    const result = combineAngular(angles, opts);
    if (result.value === undefined) return { outcome: 'diverged' };
    value[component] = result.value;
    if (result.spread !== undefined && result.spread > spread) spread = result.spread;
  }
  if (!corroborated) return { outcome: 'belowMin' };
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
// diverged. The union is intentional: angular and attitude paths may decline to
// produce a value. `spread` is the max pairwise distance when a kind already
// computed it (angular, attitude); the caller reuses it for the disagree check
// instead of recomputing. `center` is a median the rejection stage already
// computed over these same values, which a scalar or position median publishes
// as is. The caller owns usedSources and freshCount.
function computeValue(
  values: SampleValue[],
  opts: CombineOptions,
  center: SampleValue | undefined
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
    return { value: center ?? combinePosition(values, opts), outcome: 'ok' };
  }
  return {
    value: center ?? linear(opts.method, values as number[], opts.trimFraction),
    outcome: 'ok',
  };
}

// A combined value counts as unsupported when its nearest reading is further
// away than this fraction of the whole spread: no source is near what is being
// published, because the output landed in the gap between two groups. Two even
// groups put the output at exactly half the spread from either, and an evenly
// scattered set puts it well under a quarter, so a quarter separates the two
// cleanly without a unit.
const SUPPORT_GAP_RATIO = 0.25;

// Fewer than three readings carry no information about grouping: two sources a
// long way apart look exactly like two sources a short way apart once the units
// are unknown, so the gap test cannot run and only an operator-set
// rejectThreshold or disagreeThreshold can catch a two-source split.
const SUPPORT_MIN_SAMPLES = 3;

/**
 * True when `value` sits in the gap between groups of readings rather than
 * inside one of them. Position is deliberately excluded: receivers mounted at
 * the bow and the stern of one vessel are a legitimate pair of groups whose
 * midpoint is the answer wanted, so a spread in meters is the operator's call
 * through `rejectThreshold` or `disagreeThreshold`.
 */
function isUnsupported(
  value: SampleValue,
  values: SampleValue[],
  spread: number,
  kind: Kind
): boolean {
  if (kind === 'position') return false;
  if (values.length < SUPPORT_MIN_SAMPLES || spread <= 0) return false;
  let nearest = Number.POSITIVE_INFINITY;
  for (const v of values) {
    const d = distance(kind, value, v);
    if (d < nearest) nearest = d;
  }
  return nearest > SUPPORT_GAP_RATIO * spread;
}

interface Rejection {
  used: Sample[];
  usedValues: SampleValue[];
  rejectedSources: string[];
  /** The robust center, set only when nothing was rejected, so it describes `usedValues`. */
  center?: SampleValue | undefined;
}

/**
 * Split the fresh samples into the ones that survive rejection and the source
 * refs of the ones that do not. An absolute `rejectThreshold` is a hard limit
 * rather than a statistical one, so it applies whether or not the statistical
 * rejection is switched on. A run that rejects nothing hands back the arrays it
 * was given rather than copies of them.
 */
function applyRejection(samples: Sample[], values: SampleValue[], opts: CombineOptions): Rejection {
  if (!opts.outlierRejection && opts.rejectThreshold === undefined) {
    return { used: samples, usedValues: values, rejectedSources: NOTHING_REJECTED };
  }
  const { mask, center } = rejection(
    opts.kind,
    values,
    opts.outlierRejection ? opts.madThreshold : undefined,
    opts.rejectThreshold
  );
  if (mask.every(Boolean)) {
    return { used: samples, usedValues: values, rejectedSources: NOTHING_REJECTED, center };
  }
  const used: Sample[] = [];
  const usedValues: SampleValue[] = [];
  const rejectedSources: string[] = [];
  for (const [i, sample] of samples.entries()) {
    if (mask[i]) {
      used.push(sample);
      usedValues.push(sample.value);
    } else {
      rejectedSources.push(sample.sourceRef);
    }
  }
  return { used, usedValues, rejectedSources };
}

export function combine(samples: Sample[], opts: CombineOptions): CombineResult {
  const freshCount = samples.length;
  if (freshCount === 0) {
    return { usedSources: [], freshCount, outcome: 'allStale', rejectedSources: NOTHING_REJECTED };
  }
  if (freshCount < opts.minSources) {
    return {
      usedSources: samples.map((s) => s.sourceRef),
      freshCount,
      outcome: 'belowMin',
      rejectedSources: NOTHING_REJECTED,
    };
  }

  const { used, usedValues, rejectedSources, center } = applyRejection(
    samples,
    samples.map((s) => s.value),
    opts
  );
  const usedSources = used.map((s) => s.sourceRef);

  // Rejection can whittle the used set below the configured minimum. Emitting
  // then would present a thin consensus as fully corroborated, so suppress the
  // value as a divergence. `minSources` is a positive integer, so this covers
  // an empty used set too.
  if (used.length < opts.minSources) {
    return { usedSources, freshCount, outcome: 'diverged', rejectedSources };
  }
  if (used.length === 1) {
    return {
      value: usedValues[0] as SampleValue,
      usedSources,
      freshCount,
      outcome: 'singleSource',
      rejectedSources,
    };
  }

  // A median that rejected nothing is the center rejection measured from.
  const computed = computeValue(usedValues, opts, opts.method === 'median' ? center : undefined);
  if (computed.value === undefined) {
    const divergedSpread = computed.spread !== undefined ? { spread: computed.spread } : {};
    return {
      usedSources,
      freshCount,
      outcome: computed.outcome,
      ...divergedSpread,
      rejectedSources,
    };
  }

  // Angular and attitude kinds already computed the pairwise spread inside
  // computeValue; only scalar and position pay for it here.
  const spread = computed.spread ?? maxPairwiseDistance(opts.kind, usedValues);
  return {
    value: computed.value,
    usedSources,
    freshCount,
    spread,
    ...disagreement(computed.value, usedValues, spread, computed.outcome, opts),
    rejectedSources,
  };
}

/**
 * Whether the emitted value counts as disagreeing, and why. An operator-set
 * `disagreeThreshold` governs when there is one. Without it there is no
 * absolute notion of "too far apart", so the unit-free gap test is the only
 * thing standing between a split sensor set and a confident midpoint no sensor
 * reported. It flags rather than suppresses: suppression needs a threshold in
 * the path's own units, which only the operator can supply.
 */
function disagreement(
  value: SampleValue,
  values: SampleValue[],
  spread: number,
  outcome: Outcome,
  opts: CombineOptions
): { outcome: Outcome; unsupported?: true } {
  if (opts.disagreeThreshold !== undefined) {
    return { outcome: spread > opts.disagreeThreshold ? 'disagree' : outcome };
  }
  if (isUnsupported(value, values, spread, opts.kind)) {
    return { outcome: 'disagree', unsupported: true };
  }
  return { outcome };
}
