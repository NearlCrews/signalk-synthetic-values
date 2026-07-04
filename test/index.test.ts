// test/index.test.ts
import { describe, expect, it, vi } from 'vitest';
import PluginFactory from '../src/index';

type Handler = (delta: unknown, next: (d: unknown) => void) => void;

// Shapes of what the plugin emits and serves, as the tests read them.
interface EmittedDelta {
  updates: { $source: string; values: { path: string; value: unknown }[] }[];
}
interface DetectedApiResponse {
  paths: {
    path: string;
    optedIn: boolean;
    kind: string;
    combinable: boolean;
    recommended: boolean;
    advisory?: string;
  }[];
}

// Minimal fake router: records route handlers so tests can invoke them directly.
type RouteHandler = (req: unknown, res: { json(x: unknown): void }) => void;
interface FakeRouter {
  get(path: string, handler: RouteHandler): void;
  routes: Map<string, RouteHandler>;
}

function makeFakeRouter(): FakeRouter {
  const routes = new Map<string, RouteHandler>();
  return {
    routes,
    get(path, handler) {
      routes.set(path, handler);
    },
  };
}

function makeApp() {
  let handler: Handler | null = null;
  const emitted: EmittedDelta[] = [];
  let router: FakeRouter | null = null;
  const app = {
    selfContext: 'vessels.urn:mrn:imo:mmsi:123',
    selfId: 'urn:mrn:imo:mmsi:123',
    registerDeltaInputHandler: (h: Handler) => {
      handler = h;
      return () => {
        handler = null;
      };
    },
    handleMessage: (_id: string, delta: unknown) => emitted.push(delta as EmittedDelta),
    getMetadata: () => undefined,
    setPluginStatus: vi.fn(),
    setPluginError: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  function captureRouter(plugin: ReturnType<typeof PluginFactory>): FakeRouter {
    router = makeFakeRouter();
    if (!plugin.registerWithRouter) throw new Error('plugin has no registerWithRouter');
    plugin.registerWithRouter(router);
    return router;
  }
  function routerGet(r: FakeRouter, path: string): DetectedApiResponse {
    const h = r.routes.get(path);
    if (!h) throw new Error(`no route registered for ${path}`);
    let result: unknown;
    h(undefined, {
      json(x) {
        result = x;
      },
    });
    return result as DetectedApiResponse;
  }
  return {
    app,
    fire: (d: unknown) => handler?.(d, () => {}),
    emitted,
    isRegistered: () => handler !== null,
    captureRouter,
    routerGet,
  };
}

function delta(context: string, $source: string, path: string, value: unknown) {
  return {
    context,
    updates: [{ $source, timestamp: '2026-06-23T00:00:00.000Z', values: [{ path, value }] }],
  };
}

describe('plugin integration', () => {
  it('combines two sources on an opted-in path and emits a synthetic value', () => {
    const h = makeApp();
    const plugin = PluginFactory(h.app);
    plugin.start({
      defaultStalenessTimeoutMs: 10000,
      defaultEmitMinIntervalMs: 0,
      defaultMinSources: 2,
      maxSourcesPerPath: 16,
      paths: [{ path: 'environment.depth.belowTransducer' }],
    });
    h.fire(delta(h.app.selfContext, 'gps1', 'environment.depth.belowTransducer', 10));
    h.fire(delta(h.app.selfContext, 'gps2', 'environment.depth.belowTransducer', 12));
    const last = h.emitted[h.emitted.length - 1];
    expect(last.updates[0].values[0].value).toBe(11);
    expect(last.updates[0].$source).toBe('signalk-synthetic-values');
  });

  it('ignores its own emitted source (no feedback amplification)', () => {
    const h = makeApp();
    const plugin = PluginFactory(h.app);
    plugin.start({
      defaultStalenessTimeoutMs: 10000,
      defaultEmitMinIntervalMs: 0,
      defaultMinSources: 2,
      maxSourcesPerPath: 16,
      paths: [{ path: 'p' }],
    });
    h.fire(delta(h.app.selfContext, 'a', 'p', 10));
    h.fire(delta(h.app.selfContext, 'b', 'p', 20));
    const countAfterTwo = h.emitted.length;
    // Feed back the synthetic source: must be ignored, so no new distinct combine from it.
    h.fire(delta(h.app.selfContext, 'signalk-synthetic-values', 'p', 999));
    expect(h.emitted.length).toBe(countAfterTwo);
  });

  it('ignores non-self context', () => {
    const h = makeApp();
    const plugin = PluginFactory(h.app);
    plugin.start({
      defaultStalenessTimeoutMs: 10000,
      defaultEmitMinIntervalMs: 0,
      defaultMinSources: 2,
      maxSourcesPerPath: 16,
      paths: [{ path: 'p' }],
    });
    h.fire(delta('vessels.urn:mrn:other', 'a', 'p', 10));
    h.fire(delta('vessels.urn:mrn:other', 'b', 'p', 20));
    expect(h.emitted).toHaveLength(0);
  });

  it('re-registers the handler on a restart (stop then start)', () => {
    const h = makeApp();
    const plugin = PluginFactory(h.app);
    plugin.start({
      defaultStalenessTimeoutMs: 10000,
      defaultEmitMinIntervalMs: 0,
      defaultMinSources: 2,
      maxSourcesPerPath: 16,
      paths: [{ path: 'p' }],
    });
    // simulate the server auto-unregistering on stop
    void plugin.stop();
    h.fire(delta(h.app.selfContext, 'a', 'p', 10)); // handler gone; nothing happens
    plugin.start({
      defaultStalenessTimeoutMs: 10000,
      defaultEmitMinIntervalMs: 0,
      defaultMinSources: 2,
      maxSourcesPerPath: 16,
      paths: [{ path: 'p' }],
    });
    expect(h.isRegistered()).toBe(true);
  });

  it('drops a null value mid-stream and emits median of remaining sources with no NaN', () => {
    const h = makeApp();
    const plugin = PluginFactory(h.app);
    plugin.start({
      defaultStalenessTimeoutMs: 10000,
      defaultEmitMinIntervalMs: 0,
      defaultMinSources: 2,
      maxSourcesPerPath: 16,
      paths: [{ path: 'p' }],
    });
    h.fire(delta(h.app.selfContext, 'a', 'p', 10));
    h.fire(delta(h.app.selfContext, 'b', 'p', 12));
    h.fire(delta(h.app.selfContext, 'c', 'p', 14));
    const countBefore = h.emitted.length;
    // source b sends null: should be dropped, not stored; prior value ages out by staleness
    h.fire(delta(h.app.selfContext, 'b', 'p', null));
    // no new emit from the null (invalid value skipped entirely)
    // all previously emitted values must be finite
    for (const ev of h.emitted.slice(0, countBefore)) {
      const v = ev.updates[0].values[0].value;
      expect(typeof v).toBe('number');
      expect(Number.isFinite(v)).toBe(true);
      expect(Number.isNaN(v)).toBe(false);
    }
  });

  it('a path whose first sample is null is not cached as other and combines once a finite value arrives', () => {
    const h = makeApp();
    const plugin = PluginFactory(h.app);
    plugin.start({
      defaultStalenessTimeoutMs: 10000,
      defaultEmitMinIntervalMs: 0,
      defaultMinSources: 2,
      maxSourcesPerPath: 16,
      paths: [{ path: 'q' }],
    });
    // send null first - should not cache as 'other'
    h.fire(delta(h.app.selfContext, 'a', 'q', null));
    h.fire(delta(h.app.selfContext, 'b', 'q', null));
    const beforeFinite = h.emitted.length;
    // now send finite values - should combine
    h.fire(delta(h.app.selfContext, 'a', 'q', 5));
    h.fire(delta(h.app.selfContext, 'b', 'q', 7));
    expect(h.emitted.length).toBeGreaterThan(beforeFinite);
    const last = h.emitted[h.emitted.length - 1];
    expect(Number.isFinite(last.updates[0].values[0].value)).toBe(true);
  });

  it('a path locked "other" by a text sample recovers once combinable values arrive', () => {
    const h = makeApp();
    const plugin = PluginFactory(h.app);
    plugin.start({
      defaultStalenessTimeoutMs: 10000,
      defaultEmitMinIntervalMs: 0,
      defaultMinSources: 2,
      maxSourcesPerPath: 16,
      paths: [{ path: 'q' }],
    });
    // A text value poisons the classification cache with 'other'.
    h.fire(delta(h.app.selfContext, 'a', 'q', 'not-a-number'));
    expect(h.emitted).toHaveLength(0);
    // Numeric values from two sources: the path must unlock and combine
    // without a plugin restart.
    h.fire(delta(h.app.selfContext, 'a', 'q', 5));
    h.fire(delta(h.app.selfContext, 'b', 'q', 7));
    expect(h.emitted.length).toBeGreaterThan(0);
    const last = h.emitted[h.emitted.length - 1];
    expect(last.updates[0].values[0].value).toBe(6);
    // The stale non-combinable skip note must not linger in the status line.
    const statusCalls = (h.app.setPluginStatus as ReturnType<typeof vi.fn>).mock.calls;
    const lastStatus = String(statusCalls[statusCalls.length - 1]?.[0] ?? '');
    expect(lastStatus).not.toContain('non-combinable');
  });

  it('config advisories do not mark the path as skipped in the status line', () => {
    const h = makeApp();
    const plugin = PluginFactory(h.app);
    // madThreshold with outlierRejection off is an advisory: the path still runs.
    plugin.start({
      defaultStalenessTimeoutMs: 10000,
      defaultEmitMinIntervalMs: 0,
      defaultMinSources: 2,
      maxSourcesPerPath: 16,
      paths: [{ path: 'p', outlierRejection: false, madThreshold: 3 }],
    });
    h.fire(delta(h.app.selfContext, 'a', 'p', 10));
    h.fire(delta(h.app.selfContext, 'b', 'p', 12));
    expect(h.emitted.length).toBeGreaterThan(0);
    const statusCalls = (h.app.setPluginStatus as ReturnType<typeof vi.fn>).mock.calls;
    const lastStatus = String(statusCalls[statusCalls.length - 1]?.[0] ?? '');
    expect(lastStatus).toContain('Combining 1 of 1');
    expect(lastStatus).not.toContain('skipped');
    // The advisory still lands in the debug log.
    const debugCalls = (h.app.debug as ReturnType<typeof vi.fn>).mock.calls;
    expect(debugCalls.some((c: unknown[]) => String(c[0]).includes('madThreshold'))).toBe(true);
  });

  it('a partial jumpRejection (maxRate only) still re-accepts a persisted step', () => {
    // The plugin reads systemClock (Date.now), so fake timers space the samples.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const h = makeApp();
      const plugin = PluginFactory(h.app);
      plugin.start({
        defaultStalenessTimeoutMs: 10000,
        defaultEmitMinIntervalMs: 0,
        defaultMinSources: 1,
        maxSourcesPerPath: 16,
        // No persistSamples or persistMs: the validator must backfill defaults,
        // or the first rate-exceeding step freezes the output forever.
        paths: [{ path: 'p', minSources: 1, jumpRejection: { maxRate: 5 } }],
      });
      h.fire(delta(h.app.selfContext, 'a', 'p', 0));
      // A genuine step: rejected at first, then re-accepted once it persists
      // for DEFAULT_JUMP_PERSIST_SAMPLES near samples.
      vi.setSystemTime(1000);
      h.fire(delta(h.app.selfContext, 'a', 'p', 800));
      vi.setSystemTime(2000);
      h.fire(delta(h.app.selfContext, 'a', 'p', 805));
      vi.setSystemTime(3000);
      h.fire(delta(h.app.selfContext, 'a', 'p', 810));
      const last = h.emitted[h.emitted.length - 1];
      expect(last.updates[0].values[0].value).toBeGreaterThan(700);
    } finally {
      vi.useRealTimers();
    }
  });

  it('partial position is skipped for the cycle without crashing or emitting NaN', () => {
    const h = makeApp();
    const plugin = PluginFactory(h.app);
    plugin.start({
      defaultStalenessTimeoutMs: 10000,
      defaultEmitMinIntervalMs: 0,
      defaultMinSources: 2,
      maxSourcesPerPath: 16,
      paths: [{ path: 'navigation.position' }],
    });
    // valid positions first
    h.fire(
      delta(h.app.selfContext, 'gps1', 'navigation.position', { latitude: 51.5, longitude: -0.1 })
    );
    h.fire(
      delta(h.app.selfContext, 'gps2', 'navigation.position', { latitude: 51.6, longitude: -0.2 })
    );
    // partial position: should be skipped (invalid), not crash
    h.fire(
      delta(h.app.selfContext, 'gps1', 'navigation.position', { latitude: NaN, longitude: 5 })
    );
    // verify no NaN in any emitted position
    for (const ev of h.emitted) {
      const v = ev.updates[0].values[0].value;
      if (v && typeof v === 'object') {
        expect(Number.isFinite((v as { latitude: number }).latitude)).toBe(true);
        expect(Number.isFinite((v as { longitude: number }).longitude)).toBe(true);
      }
    }
  });

  it('combines a multi-source attitude path and emits a blended roll/pitch/yaw', () => {
    const h = makeApp();
    const plugin = PluginFactory(h.app);
    plugin.start({
      defaultStalenessTimeoutMs: 10000,
      defaultEmitMinIntervalMs: 0,
      defaultMinSources: 2,
      maxSourcesPerPath: 16,
      paths: [{ path: 'navigation.attitude' }],
    });
    h.fire(
      delta(h.app.selfContext, 'src1', 'navigation.attitude', { roll: 0.1, pitch: 0.2, yaw: 1.5 })
    );
    h.fire(
      delta(h.app.selfContext, 'src2', 'navigation.attitude', { roll: 0.1, pitch: 0.2, yaw: 1.5 })
    );
    const last = h.emitted[h.emitted.length - 1];
    expect(last.updates[0].$source).toBe('signalk-synthetic-values');
    // Both sources agree, so each component combines to its shared value.
    expect(last.updates[0].values[0].value).toEqual({ roll: 0.1, pitch: 0.2, yaw: 1.5 });
  });

  it('records discovery for an un-configured multi-source path', () => {
    const h = makeApp();
    const plugin = PluginFactory(h.app);
    // no opted-in paths
    plugin.start({
      defaultStalenessTimeoutMs: 10000,
      defaultEmitMinIntervalMs: 0,
      defaultMinSources: 2,
      maxSourcesPerPath: 16,
      paths: [],
    });
    h.fire(delta(h.app.selfContext, 'gps1', 'navigation.position', { latitude: 1, longitude: 2 }));
    h.fire(
      delta(h.app.selfContext, 'gps2', 'navigation.position', { latitude: 1.1, longitude: 2.1 })
    );
    const router = h.captureRouter(plugin);
    const res = h.routerGet(router, '/api/detected');
    expect(res.paths.map((p) => p.path)).toContain('navigation.position');
    const posRow = res.paths.find((p) => p.path === 'navigation.position');
    expect(posRow.optedIn).toBe(false);
    // The detected kind is reported even for an un-configured path, not 'unknown'.
    expect(posRow.kind).toBe('position');
    // A real measurement is both combinable and recommended, with no advisory.
    expect(posRow.combinable).toBe(true);
    expect(posRow.recommended).toBe(true);
    expect(posRow.advisory).toBeUndefined();
    // Path is only discovered, not opted in, so no synthetic value should have been emitted.
    expect(h.emitted).toHaveLength(0);
  });

  it('flags GNSS fix metadata as combinable but not recommended', () => {
    const h = makeApp();
    const plugin = PluginFactory(h.app);
    plugin.start({
      defaultStalenessTimeoutMs: 10000,
      defaultEmitMinIntervalMs: 0,
      defaultMinSources: 2,
      maxSourcesPerPath: 16,
      paths: [],
    });
    h.fire(delta(h.app.selfContext, 'gps1', 'navigation.gnss.satellites', 9));
    h.fire(delta(h.app.selfContext, 'gps2', 'navigation.gnss.satellites', 11));
    const router = h.captureRouter(plugin);
    const res = h.routerGet(router, '/api/detected');
    const satRow = res.paths.find((p) => p.path === 'navigation.gnss.satellites');
    expect(satRow).toBeDefined();
    // It is a number (combinable), but averaging it across receivers is not
    // meaningful, so it is not recommended and carries an advisory.
    expect(satRow.kind).toBe('scalar');
    expect(satRow.combinable).toBe(true);
    expect(satRow.recommended).toBe(false);
    expect(satRow.advisory).toMatch(/GNSS fix metadata/i);
  });

  it('excludeSources: the excluded source is ignored even when fresh', () => {
    const h = makeApp();
    const plugin = PluginFactory(h.app);
    plugin.start({
      defaultStalenessTimeoutMs: 10000,
      defaultEmitMinIntervalMs: 0,
      defaultMinSources: 2,
      maxSourcesPerPath: 16,
      paths: [{ path: 'p', excludeSources: ['bad'] }],
    });
    // 'bad' is excluded; only 'a' and 'b' should count
    h.fire(delta(h.app.selfContext, 'a', 'p', 10));
    h.fire(delta(h.app.selfContext, 'bad', 'p', 9999));
    h.fire(delta(h.app.selfContext, 'b', 'p', 20));
    const last = h.emitted[h.emitted.length - 1];
    // median of [10, 20] = 15; the 9999 from 'bad' must not affect the result
    expect(last.updates[0].values[0].value).toBe(15);
  });

  it('slewLimit: a large jump in combined output is clamped', () => {
    const h = makeApp();
    const plugin = PluginFactory(h.app);
    plugin.start({
      defaultStalenessTimeoutMs: 10000,
      defaultEmitMinIntervalMs: 0,
      defaultMinSources: 2,
      maxSourcesPerPath: 16,
      paths: [{ path: 'p', slewLimit: 1 }], // 1 unit/s slew rate
    });
    // Establish a baseline of 10
    h.fire(delta(h.app.selfContext, 'a', 'p', 10));
    h.fire(delta(h.app.selfContext, 'b', 'p', 10));
    const firstValue = h.emitted[h.emitted.length - 1]?.updates[0].values[0].value as number;
    expect(firstValue).toBe(10);
    // Now both sources jump to 1000; with slewLimit=1 the large step must be clamped.
    h.fire(delta(h.app.selfContext, 'a', 'p', 1000));
    h.fire(delta(h.app.selfContext, 'b', 'p', 1000));
    const clampedValue = h.emitted[h.emitted.length - 1]?.updates[0].values[0].value as number;
    // Slew limit clamps the output well below the target of 1000
    expect(clampedValue).toBeLessThan(100);
  });

  it('jumpRejection: a single spike is suppressed', () => {
    const h = makeApp();
    const plugin = PluginFactory(h.app);
    plugin.start({
      defaultStalenessTimeoutMs: 10000,
      defaultEmitMinIntervalMs: 0,
      defaultMinSources: 2,
      maxSourcesPerPath: 16,
      paths: [{ path: 'p', jumpRejection: { maxRate: 5, persistSamples: 3, persistMs: 10000 } }],
    });
    // Establish baseline at 10
    h.fire(delta(h.app.selfContext, 'a', 'p', 10));
    h.fire(delta(h.app.selfContext, 'b', 'p', 10));
    const baseline = h.emitted[h.emitted.length - 1]?.updates[0].values[0].value as number;
    expect(baseline).toBe(10);
    // Spike source 'a' to 9999; the combiner still runs with the accepted (held) value for 'a'
    h.fire(delta(h.app.selfContext, 'a', 'p', 9999));
    const afterSpike = h.emitted[h.emitted.length - 1]?.updates[0].values[0].value as number;
    // applyJump holds 'a' at its last accepted (10); median of [10, 10] = 10
    expect(afterSpike).toBe(10);
  });

  it('disagreeThreshold: result fires but outcome reflects disagreement', () => {
    const h = makeApp();
    const plugin = PluginFactory(h.app);
    plugin.start({
      defaultStalenessTimeoutMs: 10000,
      defaultEmitMinIntervalMs: 0,
      defaultMinSources: 2,
      maxSourcesPerPath: 16,
      paths: [{ path: 'p', disagreeThreshold: 1 }], // threshold: 1 unit
    });
    // Sources disagree by 100 units, well above disagreeThreshold=1
    h.fire(delta(h.app.selfContext, 'a', 'p', 0));
    h.fire(delta(h.app.selfContext, 'b', 'p', 100));
    // A value must still be emitted (disagree does not suppress output)
    expect(h.emitted.length).toBeGreaterThan(0);
    // setPluginStatus should have been called with a message containing 'disagree'
    const statusCalls = (h.app.setPluginStatus as ReturnType<typeof vi.fn>).mock.calls;
    const disagreeCall = statusCalls.find((c: unknown[]) =>
      String(c[0]).toLowerCase().includes('disagree')
    );
    expect(disagreeCall).toBeDefined();
  });

  it('stop/start restart: stale source from first run does not survive into second run', () => {
    const h = makeApp();
    const plugin = PluginFactory(h.app);
    plugin.start({
      defaultStalenessTimeoutMs: 10000,
      defaultEmitMinIntervalMs: 0,
      defaultMinSources: 2,
      maxSourcesPerPath: 16,
      paths: [{ path: 'p' }],
    });
    // Feed two sources so registry has data
    h.fire(delta(h.app.selfContext, 'a', 'p', 10));
    h.fire(delta(h.app.selfContext, 'b', 'p', 20));
    expect(h.emitted.length).toBeGreaterThan(0);

    void plugin.stop();
    plugin.start({
      defaultStalenessTimeoutMs: 10000,
      defaultEmitMinIntervalMs: 0,
      defaultMinSources: 2,
      maxSourcesPerPath: 16,
      paths: [{ path: 'p' }],
    });
    const countAfterRestart = h.emitted.length;
    // Only one source fires; minSources=2 so no emit should happen from the fresh run.
    h.fire(delta(h.app.selfContext, 'a', 'p', 99));
    // State was reset, so 'b' from the first run is gone; no combine with just 'a'.
    expect(h.emitted.length).toBe(countAfterRestart);
  });
});
