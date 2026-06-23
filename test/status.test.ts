import { describe, it, expect } from 'vitest'
import { pathStatus, summaryStatus } from '../src/status'
import { CombineResult } from '../src/combine'

const res = (outcome: any, n = 3): CombineResult => ({ outcome, usedSources: [], freshCount: n, value: 0 })

describe('pathStatus', () => {
  it('asks for priority when not yet set', () => {
    const s = pathStatus('navigation.position', res('ok'), 'signalk-synthetic-values', 2, false)
    expect(s).toContain('Set this path')
    expect(s).toContain('signalk-synthetic-values')
  })
  it('reports single source', () => {
    expect(pathStatus('p', res('singleSource', 1), 'sv', 2, true)).toContain('running on 1 source')
  })
  it('reports divergence', () => {
    expect(pathStatus('p', res('diverged'), 'sv', 2, true)).toContain('sources diverge')
  })
  it('reports disagreement', () => {
    expect(pathStatus('p', res('disagree'), 'sv', 2, true)).toContain('sources disagree')
  })
  it('reports waiting below min', () => {
    expect(pathStatus('p', res('belowMin', 1), 'sv', 2, true)).toContain('waiting for 2 sources')
  })
  it('contains no em dash or ampersand', () => {
    const s = pathStatus('p', res('ok'), 'sv', 2, true)
    expect(s).not.toMatch(/[—&]/)
  })
})

describe('summaryStatus', () => {
  it('reports nothing detected', () => {
    expect(summaryStatus(0, 0, [])).toContain('No multi-source paths detected')
  })
  it('lists skipped paths', () => {
    expect(summaryStatus(1, 2, [{ path: 'x', reason: 'non-numeric' }])).toContain('skipped: x (non-numeric)')
  })
})
