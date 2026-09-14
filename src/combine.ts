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

// Callers must pass non-empty arrays. Both mean and median answer NaN on an
// empty one so the two agree on the illegal input rather than one returning a
// plausible-looking zero.
export function mean(xs: number[]): number {
  if (xs.length === 0) return Number.NaN;
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
  if (xs.length === 0) return Number.NaN;
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

// Adding TWO_PI to a tiny negative remainder rounds back to exactly TWO_PI,
// which is outside the [0, 2pi) range this promises and publishes a heading of
// 360.000 degrees. The double modulo lands on 0 instead. An angle already in
// range skips the modulo entirely, because the round trip is not exact: 0.1
// comes back as 0.09999999999999964.
function normalize2pi(a: number): number {
  if (a >= 0 && a < TWO_PI) return a;
  return ((a % TWO_PI) + TWO_PI) % TWO_PI;
}

export function circularMeanRad(angles: number[]): { mean: number; R: number } {
  const first = angles[0];
  // Identical readings are the common case, and the sin/cos/atan2 round trip
  // loses the exact value: a set of exact 0.1s comes back as
  // 0.09999999999999964. Answering here rather than at one call site means
  // every caller, including the 'mean' method and the longitude path, gets the
  // exact reading back.
  if (first !== undefined && angles.every((a) => a === first)) {
    return { mean: normalize2pi(first), R: 1 };
  }
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

// Relative slack on the medoid cost comparison. Tied candidates rarely score
// bit-for-bit identically once the angles have been through sin and cos, so the
// tie test needs a little room or a two-source set falls back to positional
// order again.
const MEDOID_TIE_EPSILON = 1e-12;

// Circular medoid: the observed angle with the least total angular distance to
// the others. It is the circular analogue of the median and returns an actual
// reading, so a single off sensor cannot drag it the way the circular mean is
// dragged. Ties resolve to the circular mean of the tied candidates, taken the
// short way around, rather than to whichever source happened to register first:
// with two sources that makes the result the bisector, so the second sensor
// contributes instead of being discarded, and the output no longer moves when
// delta arrival order changes.
// The medoid given the total angular distance from each angle to all the
// others. Split out so a caller that already walked the pairwise matrix, as the
// angular combine does for its spread, does not walk it a second time.
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
  return circularMeanRad(tied).mean;
}

export function circularMedoid(angles: number[]): number {
  const costs = angles.map((a) => {
    let cost = 0;
    for (const b of angles) cost += angularDistance(a, b);
    return cost;
  });
  return medoidFromCosts(angles, costs);
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
    return mapAttitudeComponents((c) => circularMedoid(atts.map((attitude) => attitude[c])));
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
  const n = values.length;
  if (n < 2) return new Array(n).fill(true);

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
  if (rejectThreshold != null) threshold = Math.min(threshold, rejectThreshold);
  return Number.isFinite(threshold)
    ? distances.map((d) => d <= threshold)
    : new Array(n).fill(true);
}

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
  /** Receipt time of the source observation, when supplied by the runtime registry. */
  receiptTs?: number;
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
  const { mean: cm, R } = circularMeanRad(angles);
  // Skip the O(n^2) spread loop when R already gates the output.
  if (R < R_MIN) return {};
  // One walk of the pairwise matrix answers both questions: the widest
  // separation gates the output, and the per-angle totals pick the medoid.
  // Every separation is an atan2 over a sin and a cos, so walking it once
  // rather than once per question is the bulk of the trig on an angular emit.
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
  if (spread > opts.angularSpreadThreshold) return { spread };
  // 'mean' averages (splits the difference); the robust methods both use the
  // circular medoid so a lone off reading does not drag the result. There is
  // no wrap-correct trimming, so 'median' and 'trimmedMean' are identical on
  // angular paths and trimFraction has no effect here.
  return { value: opts.method === 'mean' ? cm : medoidFromCosts(angles, costs), spread };
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

/**
 * Split the fresh samples into the ones that survive rejection and the source
 * refs of the ones that do not. An absolute `rejectThreshold` is a hard limit
 * rather than a statistical one, so it applies whether or not the statistical
 * rejection is switched on.
 */
function applyRejection(
  samples: Sample[],
  opts: CombineOptions
): { used: Sample[]; rejectedSources: string[] } {
  if (!opts.outlierRejection && opts.rejectThreshold == null) {
    return { used: samples, rejectedSources: NOTHING_REJECTED };
  }
  // Only the rejection path needs the bare value array; build it here so a run
  // with no rejection at all allocates nothing.
  const mask = rejectMask(
    opts.kind,
    samples.map((s) => s.value),
    opts.outlierRejection ? opts.madThreshold : undefined,
    opts.rejectThreshold
  );
  const used = samples.filter((_, i) => mask[i]);
  if (used.length === samples.length) return { used, rejectedSources: NOTHING_REJECTED };
  return { used, rejectedSources: samples.filter((_, i) => !mask[i]).map((s) => s.sourceRef) };
}

export function combine(samples: Sample[], opts: CombineOptions): CombineResult {
  const freshCount = samples.length;
  if (freshCount === 0) {
    return { usedSources: [], freshCount, outcome: 'allStale', rejectedSources: NOTHING_REJECTED };
  }
  const only = samples[0];
  if (freshCount === 1 && only && opts.minSources <= 1) {
    return {
      value: only.value,
      usedSources: [only.sourceRef],
      freshCount,
      outcome: 'singleSource',
      rejectedSources: NOTHING_REJECTED,
    };
  }
  if (freshCount < opts.minSources) {
    return {
      usedSources: samples.map((s) => s.sourceRef),
      freshCount,
      outcome: 'belowMin',
      rejectedSources: NOTHING_REJECTED,
    };
  }

  const { used, rejectedSources } = applyRejection(samples, opts);
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
      value: (used[0] as Sample).value,
      usedSources,
      freshCount,
      outcome: 'singleSource',
      rejectedSources,
    };
  }

  // One values array, reused by computeValue, the spread, and the support test.
  const usedValues = used.map((s) => s.value);
  const computed = computeValue(usedValues, opts);
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
  if (opts.disagreeThreshold != null) {
    return { outcome: spread > opts.disagreeThreshold ? 'disagree' : outcome };
  }
  if (isUnsupported(value, values, spread, opts.kind)) {
    return { outcome: 'disagree', unsupported: true };
  }
  return { outcome };
}
