import { describe, it, expect } from 'vitest'
import { systemClock } from '../src/clock'

describe('systemClock', () => {
  it('returns a number close to Date.now()', () => {
    const before = Date.now()
    const t = systemClock.now()
    expect(t).toBeGreaterThanOrEqual(before)
  })
})
