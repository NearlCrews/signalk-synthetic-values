// test/metrics.test.ts
import { describe, expect, it } from 'vitest';
import {
  angularDistance,
  distance,
  geoDistance,
  type LatLon,
  maxPairwiseDistance,
  scalarDistance,
} from '../src/metrics';

describe('scalarDistance', () => {
  it('is the absolute difference', () => {
    expect(scalarDistance(3, 7)).toBe(4);
    expect(scalarDistance(7, 3)).toBe(4);
  });
});

describe('angularDistance (radians)', () => {
  it('wraps across 0', () => {
    const d = angularDistance(0.1, 2 * Math.PI - 0.1);
    expect(d).toBeCloseTo(0.2, 9);
  });
  it('is pi for opposite directions', () => {
    expect(angularDistance(0, Math.PI)).toBeCloseTo(Math.PI, 9);
  });
});

describe('geoDistance (meters)', () => {
  it('is near zero for the same point', () => {
    const p: LatLon = { latitude: 10, longitude: 20 };
    expect(geoDistance(p, p)).toBeCloseTo(0, 6);
  });
  it('is small across the antimeridian for nearby points', () => {
    const a: LatLon = { latitude: 0, longitude: 179.99995 };
    const b: LatLon = { latitude: 0, longitude: -179.99995 };
    expect(geoDistance(a, b)).toBeLessThan(20);
  });
  it('matches a known one-degree-latitude distance', () => {
    const a: LatLon = { latitude: 0, longitude: 0 };
    const b: LatLon = { latitude: 1, longitude: 0 };
    expect(geoDistance(a, b)).toBeGreaterThan(111000);
    expect(geoDistance(a, b)).toBeLessThan(111400);
  });
});

describe('distance dispatch and maxPairwiseDistance', () => {
  it('dispatches by kind', () => {
    expect(distance('scalar', 1, 4)).toBe(3);
    expect(distance('angular', 0, Math.PI)).toBeCloseTo(Math.PI, 9);
  });
  it('finds the max pairwise scalar distance', () => {
    expect(maxPairwiseDistance('scalar', [1, 2, 10])).toBe(9);
  });
  it('maxPairwiseDistance works for angular kind', () => {
    // Three angles clustered near 0: largest separation is 0.3 rad
    const d = maxPairwiseDistance('angular', [0.0, 0.1, 0.3]);
    expect(d).toBeCloseTo(0.3, 9);
  });
  it('maxPairwiseDistance works for position kind', () => {
    const a: LatLon = { latitude: 0, longitude: 0 };
    const b: LatLon = { latitude: 1, longitude: 0 };
    const c: LatLon = { latitude: 0, longitude: 0.5 };
    const d = maxPairwiseDistance('position', [a, b, c]);
    // Distance from a to b is ~111 km; result must be greater than a-to-c
    expect(d).toBeGreaterThan(100000);
  });
  it('distance("position", ...) dispatches to geodesic and returns nonzero meters', () => {
    const a: LatLon = { latitude: 0, longitude: 0 };
    const b: LatLon = { latitude: 1, longitude: 0 };
    const d = distance('position', a, b);
    // One degree of latitude is approximately 111 km
    expect(d).toBeGreaterThan(111000);
    expect(d).toBeLessThan(111400);
  });
});
