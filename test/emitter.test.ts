import { describe, it, expect, vi } from 'vitest'
import { Emitter, EmitApp } from '../src/emitter'
import { Clock } from '../src/clock'

function fakeClock(start = 0): Clock & { set: (t: number) => void } {
  let t = start
  return { now: () => t, set: (n: number) => (t = n) }
}

describe('Emitter', () => {
  it('emits a scalar delta with $source set as a bare string', () => {
    const app: EmitApp = { handleMessage: vi.fn() }
    const e = new Emitter(app, 'signalk-synthetic-values', fakeClock(0))
    const ok = e.maybeEmit('environment.depth.belowTransducer', 4.2, 'signalk-synthetic-values', 1000)
    expect(ok).toBe(true)
    const delta: any = (app.handleMessage as any).mock.calls[0][1]
    expect(delta.updates[0].$source).toBe('signalk-synthetic-values')
    expect(delta.updates[0].timestamp).toBeUndefined()
    expect(delta.context).toBeUndefined()
    expect(delta.updates[0].values[0]).toEqual({ path: 'environment.depth.belowTransducer', value: 4.2 })
  })
  it('rate-limits within the interval', () => {
    const app: EmitApp = { handleMessage: vi.fn() }
    const c = fakeClock(0)
    const e = new Emitter(app, 'sv', c)
    expect(e.maybeEmit('p', 1, 'sv', 1000)).toBe(true)
    c.set(500)
    expect(e.maybeEmit('p', 2, 'sv', 1000)).toBe(false)
    c.set(1000)
    expect(e.maybeEmit('p', 3, 'sv', 1000)).toBe(true)
    const calls = (app.handleMessage as any).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[1][1].updates[0].values[0].value).toBe(3)
  })
  it('emits a position value object', () => {
    const app: EmitApp = { handleMessage: vi.fn() }
    const e = new Emitter(app, 'sv', fakeClock(0))
    e.maybeEmit('navigation.position', { latitude: 1, longitude: 2 }, 'sv', 1000)
    const delta: any = (app.handleMessage as any).mock.calls[0][1]
    expect(delta.updates[0].values[0].value).toEqual({ latitude: 1, longitude: 2 })
    expect(delta.updates[0].$source).toBe('sv')
    expect(delta.updates[0].timestamp).toBeUndefined()
    expect(delta.context).toBeUndefined()
  })
})
