// Every combine kind, as a tuple so the panel can validate a wire value against
// the same list the type is derived from.
export const KINDS = ['scalar', 'angular', 'position', 'attitude', 'other'] as const;
export type Kind = (typeof KINDS)[number];

// What the detected route reports: a combine kind, or 'unknown' for a configured
// path that has not reported a value yet.
export type DetectedKind = Kind | 'unknown';

export interface LatLon {
  latitude: number;
  longitude: number;
}

export const ATTITUDE_COMPONENTS = ['roll', 'pitch', 'yaw'] as const;
export type AttitudeComponent = (typeof ATTITUDE_COMPONENTS)[number];

// navigation.attitude: up to three angles in radians, each combined as an
// angular component (roll and pitch near zero, yaw a full-circle heading). A
// heel sensor reports roll and pitch with no yaw, so any component may be
// absent; one that is present is always finite.
export type Attitude = { [C in AttitudeComponent]?: number };

export type SampleValue = number | LatLon | Attitude;

// Mean radius of the Earth in meters; sufficient for haversine at navigation scales.
export const EARTH_RADIUS_M = 6371000;

const TWO_PI = 2 * Math.PI;

// Degree/radian conversions, in one place so the inline `* Math.PI / 180`
// spelling does not get repeated across the distance and combine paths.
export function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

/**
 * Wrap an angle into [0, 2pi). Adding TWO_PI to a tiny negative remainder
 * rounds back to exactly TWO_PI, which would publish a heading of 360.000
 * degrees, so the double modulo lands on 0 instead. An angle already in range
 * skips the modulo entirely, because the round trip is not exact: 0.1 comes
 * back as 0.09999999999999964.
 */
export function wrapRadians(a: number): number {
  if (a >= 0 && a < TWO_PI) return a;
  return ((a % TWO_PI) + TWO_PI) % TWO_PI;
}

/** Wrap an angle into [-pi, pi). An angle already in range comes back exactly. */
function wrapSigned(a: number): number {
  if (a >= -Math.PI && a < Math.PI) return a;
  return wrapRadians(a + Math.PI) - Math.PI;
}

/**
 * Put a combined angle on the branch its readings use. Signal K publishes a
 * heading in [0, 2pi) but a roll, a pitch, and the wind angles on -pi..pi.
 * Publishing a port heel of -0.1 rad as 6.18 would read as 354 degrees. A
 * reading of pi or more can only be on the full-circle branch, so it settles
 * the question even beside a source that sends signed values; otherwise a
 * reading below zero marks the signed branch.
 */
export function onBranchOf(angle: number, readings: readonly number[]): number {
  if (readings.some((reading) => reading >= Math.PI)) return wrapRadians(angle);
  return readings.some((reading) => reading < 0) ? wrapSigned(angle) : wrapRadians(angle);
}

/** Wrap a longitude in degrees into [-180, 180). */
export function wrapLongitude(degrees: number): number {
  return ((((degrees + 180) % 360) + 360) % 360) - 180;
}

/**
 * The shortest signed turn from `a` to `b` in radians, range -pi..pi. A modulo
 * rather than an atan2 over a sine and a cosine: it is exact for a small
 * difference and needs no trigonometry, and every angular pairwise loop calls
 * it once per pair.
 */
export function signedAngularDelta(a: number, b: number): number {
  const d = (b - a) % TWO_PI;
  if (d > Math.PI) return d - TWO_PI;
  if (d < -Math.PI) return d + TWO_PI;
  return d;
}

export function scalarDistance(a: number, b: number): number {
  return Math.abs(a - b);
}

// Smallest circular separation in radians, range 0..pi.
export function angularDistance(a: number, b: number): number {
  return Math.abs(signedAngularDelta(a, b));
}

export function geoDistance(a: LatLon, b: LatLon): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Build an Attitude by computing each component, so the component list lives in
// one place (ATTITUDE_COMPONENTS) rather than being spelled out at every site.
// A component the function answers undefined for is left out.
export function mapAttitudeComponents(
  fn: (component: AttitudeComponent) => number | undefined
): Attitude {
  const out: Attitude = {};
  for (const c of ATTITUDE_COMPONENTS) {
    const value = fn(c);
    if (value !== undefined) out[c] = value;
  }
  return out;
}

/** The readings of one attitude component, from the attitudes that carry it. */
export function componentValues(attitudes: readonly Attitude[], c: AttitudeComponent): number[] {
  const out: number[] = [];
  for (const attitude of attitudes) {
    const value = attitude[c];
    if (value !== undefined) out.push(value);
  }
  return out;
}

// Distance between two attitudes: the largest of the per-component angular
// separations over the components both carry, so a source that is off on any
// shared axis is rejected. A running max avoids the intermediate array a
// `Math.max(...map())` would allocate per call.
export function attitudeDistance(a: Attitude, b: Attitude): number {
  let max = 0;
  for (const c of ATTITUDE_COMPONENTS) {
    const x = a[c];
    const y = b[c];
    if (x === undefined || y === undefined) continue;
    const d = angularDistance(x, y);
    if (d > max) max = d;
  }
  return max;
}

export function distance(kind: Kind, a: SampleValue, b: SampleValue): number {
  if (kind === 'position') return geoDistance(a as LatLon, b as LatLon);
  if (kind === 'angular') return angularDistance(a as number, b as number);
  if (kind === 'attitude') return attitudeDistance(a as Attitude, b as Attitude);
  // Intentional fallthrough: both 'scalar' and 'other' use scalar (absolute) distance.
  return scalarDistance(a as number, b as number);
}

export function maxPairwiseDistance(kind: Kind, values: SampleValue[]): number {
  let max = 0;
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      // Loop bounds guarantee values[i] and values[j] are defined; the casts
      // satisfy noUncheckedIndexedAccess without a per-pair runtime guard.
      const d = distance(kind, values[i] as SampleValue, values[j] as SampleValue);
      if (d > max) max = d;
    }
  }
  return max;
}
