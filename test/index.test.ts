// test/index.test.ts
import { describe, it, expect, vi } from 'vitest'
import PluginFactory from '../src/index'

type Handler = (delta: any, next: (d: any) => void) => void

// Minimal fake router: records route handlers so tests can invoke them directly.
type RouteHandler = (req: unknown, res: { json(x: unknown): void }) => void
interface FakeRouter {
  get(path: string, handler: RouteHandler): void
  routes: Map<string, RouteHandler>
}

function makeFakeRouter(): FakeRouter {
  const routes = new Map<string, RouteHandler>()
  return { routes, get(path, handler) { routes.set(path, handler) } }
}

function makeApp() {
  let handler: Handler | null = null
  const emitted: any[] = []
  let router: FakeRouter | null = null
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
  function captureRouter(plugin: ReturnType<typeof PluginFactory>): FakeRouter {
    router = makeFakeRouter()
    plugin.registerWithRouter!(router)
    return router
  }
  function routerGet(r: FakeRouter, path: string): any {
    const h = r.routes.get(path)
    if (!h) throw new Error(`no route registered for ${path}`)
    let result: any
    h(undefined, { json(x) { result = x } })
    return result
  }
  return { app, fire: (d: any) => handler && handler(d, () => {}), emitted, isRegistered: () => handler !== null, captureRouter, routerGet }
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

  it('drops a null value mid-stream and emits median of remaining sources with no NaN', () => {
    const h = makeApp()
    const plugin = PluginFactory(h.app)
    plugin.start({
      defaultStalenessTimeoutMs: 10000, defaultEmitMinIntervalMs: 0, defaultMinSources: 2,
      maxSourcesPerPath: 16, paths: [{ path: 'p' }],
    })
    h.fire(delta(h.app.selfContext, 'a', 'p', 10))
    h.fire(delta(h.app.selfContext, 'b', 'p', 12))
    h.fire(delta(h.app.selfContext, 'c', 'p', 14))
    const countBefore = h.emitted.length
    // source b sends null: should be dropped, not stored; prior value ages out by staleness
    h.fire(delta(h.app.selfContext, 'b', 'p', null))
    // no new emit from the null (invalid value skipped entirely)
    // all previously emitted values must be finite
    for (const ev of h.emitted.slice(0, countBefore)) {
      const v = ev.updates[0].values[0].value
      expect(typeof v).toBe('number')
      expect(Number.isFinite(v)).toBe(true)
      expect(Number.isNaN(v)).toBe(false)
    }
  })

  it('a path whose first sample is null is not cached as other and combines once a finite value arrives', () => {
    const h = makeApp()
    const plugin = PluginFactory(h.app)
    plugin.start({
      defaultStalenessTimeoutMs: 10000, defaultEmitMinIntervalMs: 0, defaultMinSources: 2,
      maxSourcesPerPath: 16, paths: [{ path: 'q' }],
    })
    // send null first - should not cache as 'other'
    h.fire(delta(h.app.selfContext, 'a', 'q', null))
    h.fire(delta(h.app.selfContext, 'b', 'q', null))
    const beforeFinite = h.emitted.length
    // now send finite values - should combine
    h.fire(delta(h.app.selfContext, 'a', 'q', 5))
    h.fire(delta(h.app.selfContext, 'b', 'q', 7))
    expect(h.emitted.length).toBeGreaterThan(beforeFinite)
    const last = h.emitted[h.emitted.length - 1]
    expect(Number.isFinite(last.updates[0].values[0].value)).toBe(true)
  })

  it('partial position is skipped for the cycle without crashing or emitting NaN', () => {
    const h = makeApp()
    const plugin = PluginFactory(h.app)
    plugin.start({
      defaultStalenessTimeoutMs: 10000, defaultEmitMinIntervalMs: 0, defaultMinSources: 2,
      maxSourcesPerPath: 16, paths: [{ path: 'navigation.position' }],
    })
    // valid positions first
    h.fire(delta(h.app.selfContext, 'gps1', 'navigation.position', { latitude: 51.5, longitude: -0.1 }))
    h.fire(delta(h.app.selfContext, 'gps2', 'navigation.position', { latitude: 51.6, longitude: -0.2 }))
    // partial position: should be skipped (invalid), not crash
    h.fire(delta(h.app.selfContext, 'gps1', 'navigation.position', { latitude: NaN, longitude: 5 }))
    // verify no NaN in any emitted position
    for (const ev of h.emitted) {
      const v = ev.updates[0].values[0].value
      if (v && typeof v === 'object') {
        expect(Number.isFinite((v as any).latitude)).toBe(true)
        expect(Number.isFinite((v as any).longitude)).toBe(true)
      }
    }
  })

  it('attitude-like object path classifies as other and is skipped without emitting', () => {
    const h = makeApp()
    const plugin = PluginFactory(h.app)
    plugin.start({
      defaultStalenessTimeoutMs: 10000, defaultEmitMinIntervalMs: 0, defaultMinSources: 2,
      maxSourcesPerPath: 16, paths: [{ path: 'navigation.attitude' }],
    })
    h.fire(delta(h.app.selfContext, 'src1', 'navigation.attitude', { roll: 0.1, pitch: 0.2, yaw: 1.5 }))
    h.fire(delta(h.app.selfContext, 'src2', 'navigation.attitude', { roll: 0.1, pitch: 0.2, yaw: 1.5 }))
    // should not emit anything (non-combinable)
    expect(h.emitted).toHaveLength(0)
  })

  it('records discovery for an un-configured multi-source path', () => {
    const h = makeApp()
    const plugin = PluginFactory(h.app)
    // no opted-in paths
    plugin.start({ defaultStalenessTimeoutMs: 10000, defaultEmitMinIntervalMs: 0, defaultMinSources: 2, maxSourcesPerPath: 16, paths: [] })
    h.fire(delta(h.app.selfContext, 'gps1', 'navigation.position', { latitude: 1, longitude: 2 }))
    h.fire(delta(h.app.selfContext, 'gps2', 'navigation.position', { latitude: 1.1, longitude: 2.1 }))
    const router = h.captureRouter(plugin)
    const res = h.routerGet(router, '/api/detected')
    expect(res.paths.map((p: any) => p.path)).toContain('navigation.position')
    expect(res.paths.find((p: any) => p.path === 'navigation.position').optedIn).toBe(false)
  })
})
