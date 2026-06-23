import { describe, it, expect } from 'vitest'
import { Discovery } from '../src/discovery'

describe('Discovery', () => {
  it('reports a path only once it has two or more sources', () => {
    const d = new Discovery()
    d.observe('p', 'a')
    expect(d.detected()).toEqual([])
    d.observe('p', 'b')
    d.observe('p', 'b')
    expect(d.detected()).toEqual([{ path: 'p', sources: ['a', 'b'] }])
  })
  it('reset clears state', () => {
    const d = new Discovery()
    d.observe('p', 'a')
    d.observe('p', 'b')
    d.reset()
    expect(d.detected()).toEqual([])
  })
})
