import { describe, it, expect } from 'vitest'
import { applyJump, applySlew, JumpConfig } from '../src/damping'

const cfg: JumpConfig = { maxRate: 5, persistSamples: 2, persistMs: 3000 }

describe('applyJump', () => {
  it('accepts the first sample', () => {
    const r = applyJump('scalar', undefined, 100, 0, cfg)
    expect(r.accepted).toBe(100)
    expect(r.state.lastAccepted.value).toBe(100)
  })
  it('accepts steady motion within maxRate', () => {
    let st = applyJump('scalar', undefined, 100, 0, cfg).state
    const r = applyJump('scalar', st, 103, 1000, cfg) // 3 per second < 5
    expect(r.accepted).toBe(103)
  })
  it('rejects a lone spike, holding the last accepted value', () => {
    let st = applyJump('scalar', undefined, 100, 0, cfg).state
    const r = applyJump('scalar', st, 900, 1000, cfg) // 800 per second
    expect(r.accepted).toBe(100)
  })
  it('re-accepts a genuine step after it persists', () => {
    let st = applyJump('scalar', undefined, 0, 0, cfg).state // RPM at 0
    let r = applyJump('scalar', st, 800, 1000, cfg) // engine starts, rejected once
    expect(r.accepted).toBe(0)
    r = applyJump('scalar', r.state, 805, 2000, cfg) // persists near 800
    expect(r.accepted).toBeGreaterThan(700) // re-accepted at the new level
  })
})

describe('applySlew', () => {
  it('passes the first value through', () => {
    const r = applySlew('scalar', undefined, 50, 0, 1)
    expect(r.value).toBe(50)
  })
  it('clamps a large step to maxRate per second', () => {
    const st = applySlew('scalar', undefined, 0, 0, 1).state
    const r = applySlew('scalar', st, 10, 1000, 1) // 1 unit/s, dt 1s
    expect(r.value).toBeCloseTo(1, 6)
  })
})
