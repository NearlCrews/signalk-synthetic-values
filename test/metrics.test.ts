// test/metrics.test.ts
import { describe, expect, it } from 'vitest';
import {
  angularDistance,
  attitudeDistance,
  distance,
  geoDistance,
  type LatLon,
  maxPairwiseDistance,
  scalarDistance,
  signedAngularDelta,
  wrapLongitude,
  wrapRadians,
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

describe('attitudeDistance (radians)', () => {
  it('is the largest of the per-component angular separations', () => {
    const a = { roll: 0, pitch: 0, yaw: 0 };
    const b = { roll: 0.1, pitch: 0.2, yaw: 0.05 };
    expect(attitudeDistance(a, b)).toBeCloseTo(0.2, 10);
  });
  it('uses circular distance per axis (wrap-safe)', () => {
    const a = { roll: 0, pitch: 0, yaw: 0.05 };
    const b = { roll: 0, pitch: 0, yaw: 2 * Math.PI - 0.05 };
    expect(attitudeDistance(a, b)).toBeCloseTo(0.1, 10);
  });
  it('distance() dispatches attitude to attitudeDistance', () => {
    const a = { roll: 0, pitch: 0, yaw: 0 };
    const b = { roll: 0.3, pitch: 0, yaw: 0 };
    expect(distance('attitude', a, b)).toBeCloseTo(0.3, 10);
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

describe('angle wrapping', () => {
  it('signedAngularDelta takes the short way round, with its sign', () => {
    expect(signedAngularDelta(0.1, 0.3)).toBeCloseTo(0.2, 12);
    expect(signedAngularDelta(0.3, 0.1)).toBeCloseTo(-0.2, 12);
    expect(signedAngularDelta(2 * Math.PI - 0.1, 0.1)).toBeCloseTo(0.2, 12);
    expect(signedAngularDelta(0.1, 2 * Math.PI - 0.1)).toBeCloseTo(-0.2, 12);
  });
  it('angularDistance is exact for a small difference', () => {
    expect(angularDistance(0.25, 0.75)).toBe(0.5);
  });
  it('wrapRadians keeps an in-range angle exactly and wraps the rest into [0, 2pi)', () => {
    expect(wrapRadians(0.1)).toBe(0.1);
    expect(wrapRadians(-0.1)).toBeCloseTo(2 * Math.PI - 0.1, 12);
    expect(wrapRadians(2 * Math.PI)).toBe(0);
    // A tiny negative remainder must not round back up to a full turn.
    expect(wrapRadians(-1e-17)).toBeLessThan(2 * Math.PI);
  });
  it('wrapLongitude lands in [-180, 180)', () => {
    expect(wrapLongitude(190)).toBe(-170);
    expect(wrapLongitude(-190)).toBe(170);
    expect(wrapLongitude(180)).toBe(-180);
    expect(wrapLongitude(45)).toBe(45);
  });
});

describe('attitudeDistance over partial attitudes', () => {
  it('compares only the components both carry', () => {
    expect(
      attitudeDistance({ roll: 0, pitch: 0.1 }, { roll: 0.3, pitch: 0.1, yaw: 2 })
    ).toBeCloseTo(0.3, 12);
    expect(attitudeDistance({ roll: 0 }, { yaw: 2 })).toBe(0);
  });
});
