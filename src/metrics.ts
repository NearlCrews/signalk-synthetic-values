export type Kind = 'scalar' | 'angular' | 'position' | 'other';

export interface LatLon {
  latitude: number;
  longitude: number;
}

export type SampleValue = number | LatLon;

// Mean radius of the Earth in meters; sufficient for haversine at navigation scales.
const EARTH_RADIUS_M = 6371000;

export function scalarDistance(a: number, b: number): number {
  return Math.abs(a - b);
}

// Smallest circular separation in radians, range 0..pi.
export function angularDistance(a: number, b: number): number {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

export function geoDistance(a: LatLon, b: LatLon): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function distance(kind: Kind, a: SampleValue, b: SampleValue): number {
  if (kind === 'position') return geoDistance(a as LatLon, b as LatLon);
  if (kind === 'angular') return angularDistance(a as number, b as number);
  // Intentional fallthrough: both 'scalar' and 'other' use scalar (absolute) distance.
  return scalarDistance(a as number, b as number);
}

export function maxPairwiseDistance(kind: Kind, values: SampleValue[]): number {
  let max = 0;
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      // Loop bounds guarantee values[i] and values[j] are defined; we guard defensively.
      const vi = values[i];
      const vj = values[j];
      if (vi !== undefined && vj !== undefined) {
        max = Math.max(max, distance(kind, vi, vj));
      }
    }
  }
  return max;
}
