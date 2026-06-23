// test/metrics.test.ts
import { describe, it, expect } from 'vitest'
import {
  scalarDistance, angularDistance, geoDistance, distance, maxPairwiseDistance, LatLon,
} from '../src/metrics'

describe('scalarDistance', () => {
  it('is the absolute difference', () => {
    expect(scalarDistance(3, 7)).toBe(4)
    expect(scalarDistance(7, 3)).toBe(4)
  })
})

describe('angularDistance (radians)', () => {
  it('wraps across 0', () => {
    const d = angularDistance(0.1, 2 * Math.PI - 0.1)
    expect(d).toBeCloseTo(0.2, 9)
  })
  it('is pi for opposite directions', () => {
    expect(angularDistance(0, Math.PI)).toBeCloseTo(Math.PI, 9)
  })
})

describe('geoDistance (meters)', () => {
  it('is near zero for the same point', () => {
    const p: LatLon = { latitude: 10, longitude: 20 }
    expect(geoDistance(p, p)).toBeCloseTo(0, 6)
  })
  it('is small across the antimeridian for nearby points', () => {
    const a: LatLon = { latitude: 0, longitude: 179.99995 }
    const b: LatLon = { latitude: 0, longitude: -179.99995 }
    expect(geoDistance(a, b)).toBeLessThan(20)
  })
  it('matches a known one-degree-latitude distance', () => {
    const a: LatLon = { latitude: 0, longitude: 0 }
    const b: LatLon = { latitude: 1, longitude: 0 }
    expect(geoDistance(a, b)).toBeGreaterThan(111000)
    expect(geoDistance(a, b)).toBeLessThan(111400)
  })
})

describe('distance dispatch and maxPairwiseDistance', () => {
  it('dispatches by kind', () => {
    expect(distance('scalar', 1, 4)).toBe(3)
    expect(distance('angular', 0, Math.PI)).toBeCloseTo(Math.PI, 9)
  })
  it('finds the max pairwise scalar distance', () => {
    expect(maxPairwiseDistance('scalar', [1, 2, 10])).toBe(9)
  })
})
