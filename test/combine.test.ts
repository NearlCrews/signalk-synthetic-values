// test/combine.test.ts
import { describe, it, expect } from 'vitest'
import { combine, CombineOptions, Sample } from '../src/combine'
import { LatLon } from '../src/metrics'

const base: Omit<CombineOptions, 'kind'> = {
  method: 'median',
  minSources: 2,
  outlierRejection: true,
  madThreshold: 3,
  angularSpreadThreshold: Math.PI / 2,
  trimFraction: 0.25,
}

const s = (sourceRef: string, value: any): Sample => ({ sourceRef, value })

describe('combine source-count outcomes', () => {
  it('no samples is allStale', () => {
    const r = combine([], { ...base, kind: 'scalar' })
    expect(r.outcome).toBe('allStale')
    expect(r.value).toBeUndefined()
  })
  it('below minSources is belowMin', () => {
    const r = combine([s('a', 5)], { ...base, kind: 'scalar' })
    expect(r.outcome).toBe('belowMin')
    expect(r.value).toBeUndefined()
  })
  it('single source passes through when minSources is 1', () => {
    const r = combine([s('a', 5)], { ...base, kind: 'scalar', minSources: 1 })
    expect(r.outcome).toBe('singleSource')
    expect(r.value).toBe(5)
  })
})

describe('combine outlier rejection empties the source set', () => {
  it('returns diverged with no value when all sources are rejected', () => {
    // Two sources 100 units apart with rejectThreshold: 10 and minSources: 2.
    // Both sources are far from the center (50), so both get rejected.
    const r = combine([s('a', 0), s('b', 100)], {
      ...base,
      kind: 'scalar',
      minSources: 2,
      outlierRejection: true,
      rejectThreshold: 10,
    })
    expect(r.outcome).toBe('diverged')
    expect(r.value).toBeUndefined()
  })
})

describe('combine scalar', () => {
  it('medians three sources', () => {
    const r = combine([s('a', 10), s('b', 11), s('c', 30)], { ...base, kind: 'scalar' })
    expect(r.outcome).toBe('ok')
    expect(r.value).toBe(11)
  })
  it('flags disagreement but still emits', () => {
    const r = combine([s('a', 10), s('b', 11), s('c', 30)], {
      ...base, kind: 'scalar', disagreeThreshold: 5,
    })
    expect(r.outcome).toBe('disagree')
    expect(r.value).toBe(11)
  })
})

describe('combine angular', () => {
  it('uses the circular mean and ignores method', () => {
    const d = (x: number) => (x * Math.PI) / 180
    const r = combine([s('a', d(0)), s('b', d(10)), s('c', d(350))], {
      ...base, kind: 'angular', method: 'mean',
    })
    const deg = ((r.value as number) * 180) / Math.PI
    expect(Math.min(deg, 360 - deg)).toBeLessThan(1)
    expect(r.outcome).toBe('ok')
  })
  it('suppresses an antipodal pair', () => {
    const r = combine([s('a', 0), s('b', Math.PI)], { ...base, kind: 'angular' })
    expect(r.outcome).toBe('diverged')
    expect(r.value).toBeUndefined()
  })
  it('suppresses a wide fan (north, east, south)', () => {
    const r = combine([s('a', 0), s('b', Math.PI / 2), s('c', Math.PI)], {
      ...base, kind: 'angular',
    })
    expect(r.outcome).toBe('diverged')
  })
})

describe('combine position', () => {
  it('is antimeridian safe', () => {
    const r = combine(
      [s('a', { latitude: 0, longitude: 179.99995 }), s('b', { latitude: 0, longitude: -179.99995 })],
      { ...base, kind: 'position' },
    )
    const v = r.value as LatLon
    expect(Math.abs(v.longitude)).toBeGreaterThan(179)
  })
  it('rejects a far position whole-source and lands on the cluster', () => {
    const r = combine(
      [
        s('a', { latitude: 10, longitude: 20 }),
        s('b', { latitude: 10.00001, longitude: 20.00001 }),
        s('c', { latitude: 9.99999, longitude: 19.99999 }),
        s('d', { latitude: 11, longitude: 21 }),
      ],
      { ...base, kind: 'position' },
    )
    const v = r.value as LatLon
    expect(v.latitude).toBeCloseTo(10, 3)
    expect(v.longitude).toBeCloseTo(20, 3)
  })
})
