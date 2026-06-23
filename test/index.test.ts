// test/index.test.ts
import { describe, it, expect, vi } from 'vitest'
import PluginFactory from '../src/index'

type Handler = (delta: any, next: (d: any) => void) => void

function makeApp() {
  let handler: Handler | null = null
  const emitted: any[] = []
  const app: any = {
    selfContext: 'vessels.urn:mrn:imo:mmsi:123',
    selfId: 'urn:mrn:imo:mmsi:123',
    registerDeltaInputHandler: (h: Handler) => {
      handler = h
      return () => { handler = null }
    },
    handleMessage: (_id: string, delta: any) => emitted.push(delta),
    getMetadata: () => undefined,
    setPluginStatus: vi.fn(),
    setPluginError: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }
  return { app, fire: (d: any) => handler && handler(d, () => {}), emitted, isRegistered: () => handler !== null }
}

function delta(context: string, $source: string, path: string, value: any) {
  return { context, updates: [{ $source, timestamp: '2026-06-23T00:00:00.000Z', values: [{ path, value }] }] }
}

describe('plugin integration', () => {
  it('combines two sources on an opted-in path and emits a synthetic value', () => {
    const h = makeApp()
    const plugin = PluginFactory(h.app)
    plugin.start({
      defaultStalenessTimeoutMs: 10000, defaultEmitMinIntervalMs: 0, defaultMinSources: 2,
      maxSourcesPerPath: 16, paths: [{ path: 'environment.depth.belowTransducer' }],
    })
    h.fire(delta(h.app.selfContext, 'gps1', 'environment.depth.belowTransducer', 10))
    h.fire(delta(h.app.selfContext, 'gps2', 'environment.depth.belowTransducer', 12))
    const last = h.emitted[h.emitted.length - 1]
    expect(last.updates[0].values[0].value).toBe(11)
    expect(last.updates[0].$source).toBe('signalk-synthetic-values')
  })

  it('ignores its own emitted source (no feedback amplification)', () => {
    const h = makeApp()
    const plugin = PluginFactory(h.app)
    plugin.start({
      defaultStalenessTimeoutMs: 10000, defaultEmitMinIntervalMs: 0, defaultMinSources: 2,
      maxSourcesPerPath: 16, paths: [{ path: 'p' }],
    })
    h.fire(delta(h.app.selfContext, 'a', 'p', 10))
    h.fire(delta(h.app.selfContext, 'b', 'p', 20))
    const countAfterTwo = h.emitted.length
    // Feed back the synthetic source: must be ignored, so no new distinct combine from it.
    h.fire(delta(h.app.selfContext, 'signalk-synthetic-values', 'p', 999))
    expect(h.emitted.length).toBe(countAfterTwo)
  })

  it('ignores non-self context', () => {
    const h = makeApp()
    const plugin = PluginFactory(h.app)
    plugin.start({
      defaultStalenessTimeoutMs: 10000, defaultEmitMinIntervalMs: 0, defaultMinSources: 2,
      maxSourcesPerPath: 16, paths: [{ path: 'p' }],
    })
    h.fire(delta('vessels.urn:mrn:other', 'a', 'p', 10))
    h.fire(delta('vessels.urn:mrn:other', 'b', 'p', 20))
    expect(h.emitted).toHaveLength(0)
  })

  it('re-registers the handler on a restart (stop then start)', () => {
    const h = makeApp()
    const plugin = PluginFactory(h.app)
    plugin.start({ defaultStalenessTimeoutMs: 10000, defaultEmitMinIntervalMs: 0, defaultMinSources: 2, maxSourcesPerPath: 16, paths: [{ path: 'p' }] })
    // simulate the server auto-unregistering on stop
    plugin.stop()
    h.fire(delta(h.app.selfContext, 'a', 'p', 10)) // handler gone; nothing happens
    plugin.start({ defaultStalenessTimeoutMs: 10000, defaultEmitMinIntervalMs: 0, defaultMinSources: 2, maxSourcesPerPath: 16, paths: [{ path: 'p' }] })
    expect(h.isRegistered()).toBe(true)
  })
})
