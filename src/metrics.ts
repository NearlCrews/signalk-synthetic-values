export type Kind = 'scalar' | 'angular' | 'position' | 'attitude' | 'other';

export interface LatLon {
  latitude: number;
  longitude: number;
}

// navigation.attitude: three angles in radians, each combined as an angular
// component (roll and pitch near zero, yaw a full-circle heading).
export interface Attitude {
  roll: number;
  pitch: number;
  yaw: number;
}

export const ATTITUDE_COMPONENTS = ['roll', 'pitch', 'yaw'] as const;

export type SampleValue = number | LatLon | Attitude;

// Mean radius of the Earth in meters; sufficient for haversine at navigation scales.
export const EARTH_RADIUS_M = 6371000;

// Degree/radian conversions, in one place so the inline `* Math.PI / 180`
// spelling does not get repeated across the distance and combine paths.
export function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function scalarDistance(a: number, b: number): number {
  return Math.abs(a - b);
}

// Smallest circular separation in radians, range 0..pi.
export function angularDistance(a: number, b: number): number {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
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
export function mapAttitudeComponents(fn: (component: keyof Attitude) => number): Attitude {
  const out = {} as Attitude;
  for (const c of ATTITUDE_COMPONENTS) out[c] = fn(c);
  return out;
}

// Distance between two attitudes: the largest of the per-component angular
// separations, so a source that is off on any axis is rejected. A running max
// avoids the intermediate array a `Math.max(...map())` would allocate per call.
export function attitudeDistance(a: Attitude, b: Attitude): number {
  let max = 0;
  for (const c of ATTITUDE_COMPONENTS) {
    const d = angularDistance(a[c], b[c]);
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
