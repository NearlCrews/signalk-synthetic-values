// test/registry.test.ts
import { describe, it, expect } from 'vitest'
import { Registry } from '../src/registry'
import { Clock } from '../src/clock'

function fakeClock(start = 0): Clock & { set: (t: number) => void } {
  let t = start
  return { now: () => t, set: (n: number) => (t = n) }
}

describe('Registry', () => {
  it('returns fresh samples within the staleness window', () => {
    const c = fakeClock(0)
    const r = new Registry(c, 16)
    r.update('p', 'a', 1, 0)
    r.update('p', 'b', 2, 0)
    c.set(500)
    expect(r.fresh('p', 1000).map((s) => s.sourceRef).sort()).toEqual(['a', 'b'])
  })
  it('drops a stale source', () => {
    const c = fakeClock(0)
    const r = new Registry(c, 16)
    r.update('p', 'a', 1, 0)
    r.update('p', 'b', 2, 900)
    c.set(1000)
    expect(r.fresh('p', 1000).map((s) => s.sourceRef)).toEqual(['b'])
  })
  it('caps tracked sources, evicting the oldest', () => {
    const c = fakeClock(0)
    const r = new Registry(c, 2)
    r.update('p', 'a', 1, 0)
    r.update('p', 'b', 2, 1)
    r.update('p', 'c', 3, 2)
    c.set(2)
    const refs = r.fresh('p', 1000).map((s) => s.sourceRef).sort()
    expect(refs).toEqual(['b', 'c'])
  })
  it('reset clears everything', () => {
    const c = fakeClock(0)
    const r = new Registry(c, 16)
    r.update('p', 'a', 1, 0)
    r.reset()
    expect(r.fresh('p', 1000)).toEqual([])
  })
  it('updating an existing sourceRef at capacity does not evict any source', () => {
    const c = fakeClock(0)
    const r = new Registry(c, 2)
    r.update('p', 'a', 1, 0)
    r.update('p', 'b', 2, 1)
    // Update 'a' again while at cap=2: the !has(sourceRef) guard prevents eviction
    r.update('p', 'a', 99, 2)
    c.set(2)
    const refs = r.fresh('p', 1000).map((s) => s.sourceRef).sort()
    expect(refs).toEqual(['a', 'b'])
  })
  it('setMaxSourcesPerPath takes effect on subsequent updates', () => {
    const c = fakeClock(0)
    const r = new Registry(c, 16)
    r.setMaxSourcesPerPath(2)
    r.update('p', 'a', 1, 10)
    r.update('p', 'b', 2, 20)
    r.update('p', 'c', 3, 30)
    c.set(30)
    const refs = r.fresh('p', 1000).map((s) => s.sourceRef).sort()
    expect(refs).toEqual(['b', 'c'])
  })
})
