import { describe, it, expect } from 'vitest'
import { Discovery } from '../src/discovery'
import { fakeClock } from './helpers'

describe('Discovery', () => {
  it('reports a path only once it has two or more sources', () => {
    const d = new Discovery(fakeClock())
    d.observe('p', 'a')
    expect(d.detected()).toEqual([])
    d.observe('p', 'b')
    d.observe('p', 'b')
    expect(d.detected()).toEqual([{ path: 'p', sources: ['a', 'b'] }])
  })
  it('reset clears state', () => {
    const d = new Discovery(fakeClock())
    d.observe('p', 'a')
    d.observe('p', 'b')
    d.reset()
    expect(d.detected()).toEqual([])
  })
})

describe('Discovery bounded store', () => {
  it('evicts the least-recently-seen path when over the cap', () => {
    const c = fakeClock(0)
    const d = new Discovery(c, 2)
    d.observe('a', 's1'); d.observe('a', 's2')   // a detected, seen at 0
    c.set(10); d.observe('b', 's1'); d.observe('b', 's2') // b detected, seen at 10
    c.set(20); d.observe('c', 's1'); d.observe('c', 's2') // c added, a is oldest, evicted
    const paths = d.detected().map((p) => p.path).sort()
    expect(paths).toEqual(['b', 'c'])
  })
  it('updates last-seen so a refreshed path is not the eviction target', () => {
    const c = fakeClock(0)
    const d = new Discovery(c, 2)
    d.observe('a', 's1'); d.observe('a', 's2')
    c.set(10); d.observe('b', 's1'); d.observe('b', 's2')
    c.set(20); d.observe('a', 's3') // a refreshed, now newer than b
    c.set(30); d.observe('c', 's1'); d.observe('c', 's2') // b is oldest, evicted
    const paths = d.detected().map((p) => p.path).sort()
    expect(paths).toEqual(['a', 'c'])
  })
})
