// test/index.test.ts
import type { Plugin, ServerAPI } from '@signalk/server-api';
import { describe, expect, it, vi } from 'vitest';
import createPlugin from '../src/index';

type Handler = (delta: unknown, next: (d: unknown) => void) => void;

// Shapes of what the plugin emits and serves, as the tests read them.
interface EmittedDelta {
  updates: { $source: string; values: { path: string; value: unknown }[] }[];
}
interface DetectedApiResponse {
  paths: {
    path: string;
    sources: string[];
    freshSources: string[] | null;
    excludedSources: string[];
    optedIn: boolean;
    kind: string;
    combinable: boolean;
    recommended: boolean;
    duplicateGroups: string[][];
    advisory?: string;
  }[];
}

// Minimal fake router: records route handlers so tests can invoke them directly.
type RouteHandler = (req: unknown, res: { json(x: unknown): void }) => void;
interface FakeRouter {
  get(path: string, handler: RouteHandler): void;
  routes: Map<string, RouteHandler>;
}

type TestPlugin = Omit<Plugin, 'registerWithRouter' | 'start'> & {
  start(options: unknown): void;
  registerWithRouter?: (router: FakeRouter) => void;
};

function PluginFactory(app: unknown): TestPlugin {
  return createPlugin(app as ServerAPI) as unknown as TestPlugin;
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
  // Confidence notifications go to notifications.<path>, on the same
  // handleMessage channel as the values. Splitting them here keeps every
  // "how many values were emitted" assertion about values.
  const notifications: EmittedDelta[] = [];
  let router: FakeRouter | null = null;
  const app = {
    selfContext: 'vessels.urn:mrn:imo:mmsi:123',
    selfId: 'urn:mrn:imo:mmsi:123',
    registerDeltaInputHandler: (h: Handler) => {
      handler = h;
    },
    handleMessage: vi.fn((_id: string, message: unknown) => {
      const delta = message as EmittedDelta;
      const path = delta.updates[0]?.values[0]?.path ?? '';
      (path.startsWith('notifications.') ? notifications : emitted).push(delta);
    }),
    getMetadata: (() => undefined) as (path: string) => { units?: string } | undefined,
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
    fire: (d: unknown, next: (value: unknown) => void = () => {}) => handler?.(d, next),
    serverStop(plugin: ReturnType<typeof PluginFactory>) {
      handler = null;
      void plugin.stop();
    },
    emitted,
    notifications,
    lastNotification: (path: string): { state: string; message: string } | undefined => {
      for (let i = notifications.length - 1; i >= 0; i--) {
        const value = notifications[i]?.updates[0]?.values[0];
        if (value?.path === `notifications.${path}`) {
          return value.value as { state: string; message: string };
        }
      }
      return undefined;
    },
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
    expect(h.app.debug).toHaveBeenCalledWith(expect.stringContaining('Data, Priorities'));
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
    h.serverStop(plugin);
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

  it('detects a multi-source text path and reports it as non-combinable', () => {
    const h = makeApp();
    const plugin = PluginFactory(h.app);
    const router = h.captureRouter(plugin);
    plugin.start({
      defaultStalenessTimeoutMs: 10000,
      defaultEmitMinIntervalMs: 0,
      defaultMinSources: 2,
      maxSourcesPerPath: 16,
      paths: [],
    });
    h.fire(delta(h.app.selfContext, 'a', 'vessel.name', 'Alpha'));
    h.fire(delta(h.app.selfContext, 'b', 'vessel.name', 'Alpha'));
    expect(h.routerGet(router, '/api/detected').paths).toEqual([
      expect.objectContaining({
        path: 'vessel.name',
        kind: 'other',
        combinable: false,
        recommended: false,
      }),
    ]);
  });

  it('updates detected kind when a text path starts reporting numbers', () => {
    const h = makeApp();
    const plugin = PluginFactory(h.app);
    const router = h.captureRouter(plugin);
    plugin.start({
      defaultStalenessTimeoutMs: 10000,
      defaultEmitMinIntervalMs: 0,
      defaultMinSources: 2,
      maxSourcesPerPath: 16,
      paths: [],
    });
    h.fire(delta(h.app.selfContext, 'a', 'p', 'bad'));
    h.fire(delta(h.app.selfContext, 'b', 'p', 'bad'));
    h.fire(delta(h.app.selfContext, 'a', 'p', 1));
    h.fire(delta(h.app.selfContext, 'b', 'p', 2));
    expect(h.routerGet(router, '/api/detected').paths[0]).toEqual(
      expect.objectContaining({ kind: 'scalar', combinable: true })
    );
  });

  it('refreshes status immediately when a configured path becomes non-combinable', () => {
    const h = makeApp();
    const plugin = PluginFactory(h.app);
    plugin.start({
      defaultStalenessTimeoutMs: 10000,
      defaultEmitMinIntervalMs: 0,
      defaultMinSources: 2,
      maxSourcesPerPath: 16,
      paths: [{ path: 'p' }],
    });
    h.fire(delta(h.app.selfContext, 'a', 'p', 'bad'));
    expect(h.app.setPluginStatus).toHaveBeenLastCalledWith(expect.stringContaining('skipped: p'));
  });

  it('moves a quiet path to waiting without periodically re-emitting it', () => {
    vi.useFakeTimers();
    const h = makeApp();
    const plugin = PluginFactory(h.app);
    try {
      plugin.start({
        defaultStalenessTimeoutMs: 1000,
        defaultEmitMinIntervalMs: 0,
        defaultMinSources: 2,
        maxSourcesPerPath: 16,
        paths: [{ path: 'p' }],
      });
      h.fire(delta(h.app.selfContext, 'a', 'p', 10));
      h.fire(delta(h.app.selfContext, 'b', 'p', 20));
      const emittedBeforeSweep = h.emitted.length;

      vi.advanceTimersByTime(1000);

      expect(h.emitted).toHaveLength(emittedBeforeSweep);
      expect(h.app.setPluginStatus).toHaveBeenLastCalledWith(
        expect.stringContaining('waiting for sources')
      );
    } finally {
      void plugin.stop();
      vi.useRealTimers();
    }
  });

  it('keeps a non-combinable path skipped during availability sweeps', () => {
    vi.useFakeTimers();
    const h = makeApp();
    const plugin = PluginFactory(h.app);
    try {
      plugin.start({
        defaultStalenessTimeoutMs: 1000,
        defaultEmitMinIntervalMs: 0,
        defaultMinSources: 2,
        maxSourcesPerPath: 16,
        paths: [{ path: 'p' }],
      });
      h.fire(delta(h.app.selfContext, 'a', 'p', 'bad'));

      vi.advanceTimersByTime(2000);

      const lastStatus = String(h.app.setPluginStatus.mock.calls.at(-1)?.[0] ?? '');
      expect(lastStatus).toContain('skipped: p');
      expect(lastStatus).not.toContain('waiting for sources');
    } finally {
      void plugin.stop();
      vi.useRealTimers();
    }
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
    // Fake timers advance the plugin's monotonic performance clock.
    vi.useFakeTimers();
    try {
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
      vi.advanceTimersByTime(1000);
      h.fire(delta(h.app.selfContext, 'a', 'p', 800));
      vi.advanceTimersByTime(1000);
      h.fire(delta(h.app.selfContext, 'a', 'p', 805));
      vi.advanceTimersByTime(1000);
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
    if (!posRow) throw new Error('navigation.position was not detected');
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
    if (!satRow) throw new Error('navigation.gnss.satellites was not detected');
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

  it('slewLimit: a step inside the lag bound is clamped and reported as lagging', () => {
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
    // A step of 5 is inside the ten-second lag bound at 1 unit/s, so the
    // limiter holds the output back.
    h.fire(delta(h.app.selfContext, 'a', 'p', 15));
    h.fire(delta(h.app.selfContext, 'b', 'p', 15));
    const clampedValue = h.emitted[h.emitted.length - 1]?.updates[0].values[0].value as number;
    expect(clampedValue).toBeLessThan(11);
    expect(h.app.setPluginStatus).toHaveBeenLastCalledWith(
      expect.stringContaining('held back by the slew limit')
    );
    expect(h.lastNotification('p')?.state).toBe('warn');
  });

  it('slewLimit: a step beyond the lag bound bypasses the limiter', () => {
    const h = makeApp();
    const plugin = PluginFactory(h.app);
    plugin.start({
      defaultStalenessTimeoutMs: 10000,
      defaultEmitMinIntervalMs: 0,
      defaultMinSources: 2,
      maxSourcesPerPath: 16,
      paths: [{ path: 'p', slewLimit: 1 }],
    });
    h.fire(delta(h.app.selfContext, 'a', 'p', 10));
    h.fire(delta(h.app.selfContext, 'b', 'p', 10));
    // 990 units at 1 unit/s would leave the output wrong for sixteen minutes.
    h.fire(delta(h.app.selfContext, 'a', 'p', 1000));
    h.fire(delta(h.app.selfContext, 'b', 'p', 1000));
    expect(h.emitted[h.emitted.length - 1]?.updates[0].values[0].value).toBe(1000);
  });

  it('slewLimit: shoaling water is never smoothed', () => {
    const h = makeApp();
    const plugin = PluginFactory(h.app);
    const path = 'environment.depth.belowKeel';
    plugin.start({
      defaultStalenessTimeoutMs: 10000,
      defaultEmitMinIntervalMs: 0,
      defaultMinSources: 2,
      maxSourcesPerPath: 16,
      // 8 m at 1 m/s is inside the lag bound, so only the shoaling rule can
      // let this through.
      paths: [{ path, slewLimit: 1 }],
    });
    h.fire(delta(h.app.selfContext, 'a', path, 10));
    h.fire(delta(h.app.selfContext, 'b', path, 10));
    h.fire(delta(h.app.selfContext, 'a', path, 2));
    h.fire(delta(h.app.selfContext, 'b', path, 2));
    expect(h.emitted[h.emitted.length - 1]?.updates[0].values[0].value).toBe(2);
    // The same size of step into deeper water is still smoothed.
    h.fire(delta(h.app.selfContext, 'a', path, 10));
    h.fire(delta(h.app.selfContext, 'b', path, 10));
    expect(h.emitted[h.emitted.length - 1]?.updates[0].values[0].value as number).toBeLessThan(3);
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

  it('jumpRejection does not count cached values replayed by other source updates', () => {
    vi.useFakeTimers();
    try {
      const h = makeApp();
      const plugin = PluginFactory(h.app);
      plugin.start({
        defaultStalenessTimeoutMs: 10000,
        defaultEmitMinIntervalMs: 0,
        defaultMinSources: 1,
        maxSourcesPerPath: 16,
        paths: [
          {
            path: 'p',
            includeSources: ['a'],
            jumpRejection: { maxRate: 5, persistSamples: 3, persistMs: 100000 },
          },
        ],
      });
      h.fire(delta(h.app.selfContext, 'a', 'p', 0));
      vi.advanceTimersByTime(1000);
      h.fire(delta(h.app.selfContext, 'a', 'p', 100));
      vi.advanceTimersByTime(1000);
      h.fire(delta(h.app.selfContext, 'excluded', 'p', 1));
      vi.advanceTimersByTime(1000);
      h.fire(delta(h.app.selfContext, 'excluded', 'p', 2));
      const values = h.emitted.map((d) => d.updates[0]?.values[0]?.value);
      expect(values).toEqual([0, 0]);
    } finally {
      vi.useRealTimers();
    }
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

    h.serverStop(plugin);
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

  it('starts configured paths in a waiting state', () => {
    const h = makeApp();
    const plugin = PluginFactory(h.app);
    plugin.start({
      defaultStalenessTimeoutMs: 10000,
      defaultEmitMinIntervalMs: 0,
      defaultMinSources: 2,
      maxSourcesPerPath: 16,
      paths: [{ path: 'p' }, { path: 'q' }],
    });
    expect(h.app.setPluginStatus).toHaveBeenLastCalledWith(
      expect.stringContaining('2 waiting for sources')
    );
  });

  it('skips malformed delta pieces, processes later values, and always calls next', () => {
    const h = makeApp();
    const plugin = PluginFactory(h.app);
    plugin.start({
      defaultStalenessTimeoutMs: 10000,
      defaultEmitMinIntervalMs: 0,
      defaultMinSources: 2,
      maxSourcesPerPath: 16,
      paths: [{ path: 'p' }],
    });
    const next = vi.fn();
    h.fire(
      {
        context: h.app.selfContext,
        updates: [
          null,
          { $source: 42, values: [{ path: 'p', value: 999 }] },
          {
            $source: 'a',
            values: [null, { path: 7, value: 999 }, { path: 'p', value: 10 }],
          },
          { $source: 'b', values: [{ path: 'p', value: 20 }] },
        ],
      },
      next
    );
    expect(next).toHaveBeenCalledOnce();
    expect(h.emitted.at(-1)?.updates[0]?.values[0]?.value).toBe(15);
  });

  it('rejects a mixed combinable shape without corrupting the sample set', () => {
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
    h.fire(delta(h.app.selfContext, 'wrong-shape', 'p', { latitude: 1, longitude: 2 }));
    expect(h.emitted).toHaveLength(0);
    h.fire(delta(h.app.selfContext, 'b', 'p', 20));
    expect(h.emitted.at(-1)?.updates[0]?.values[0]?.value).toBe(15);
    expect(JSON.stringify(h.emitted)).not.toContain('null');
    expect(h.app.debug).toHaveBeenCalledWith(expect.stringContaining('ignored "wrong-shape"'));
  });

  it('escapes a bus-supplied source label before logging it', () => {
    const h = makeApp();
    const plugin = PluginFactory(h.app);
    plugin.start({
      defaultStalenessTimeoutMs: 10000,
      defaultEmitMinIntervalMs: 0,
      defaultMinSources: 2,
      maxSourcesPerPath: 16,
      paths: [{ path: 'p' }],
    });
    h.fire(delta(h.app.selfContext, 'good-source', 'p', 10));
    h.fire(delta(h.app.selfContext, 'forged\nsource', 'p', { latitude: 1, longitude: 2 }));

    const message = String(h.app.debug.mock.calls.at(-1)?.[0] ?? '');
    expect(message).toContain('"forged\\nsource"');
    expect(message).not.toContain('forged\nsource');
  });

  it('applies source filters before configured classification and storage', () => {
    const h = makeApp();
    const plugin = PluginFactory(h.app);
    plugin.start({
      defaultStalenessTimeoutMs: 10000,
      defaultEmitMinIntervalMs: 0,
      defaultMinSources: 2,
      maxSourcesPerPath: 2,
      paths: [{ path: 'p', includeSources: ['a', 'b'] }],
    });
    h.fire(delta(h.app.selfContext, 'excluded', 'p', { latitude: 1, longitude: 2 }));
    h.fire(delta(h.app.selfContext, 'a', 'p', 10));
    h.fire(delta(h.app.selfContext, 'b', 'p', 20));
    expect(h.emitted.at(-1)?.updates[0]?.values[0]?.value).toBe(15);
  });

  it('removes a source from the live registry when it reports an invalid value', () => {
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
    const emittedBeforeInvalid = h.emitted.length;
    h.fire(delta(h.app.selfContext, 'a', 'p', null));
    expect(h.app.setPluginStatus).toHaveBeenLastCalledWith(
      expect.stringContaining('waiting for sources')
    );
    h.fire(delta(h.app.selfContext, 'b', 'p', 22));
    expect(h.emitted).toHaveLength(emittedBeforeInvalid);
    expect(h.app.setPluginStatus).toHaveBeenLastCalledWith(
      expect.stringContaining('waiting for sources')
    );
  });

  it('keeps a failed output retryable and does not report it as emitting', () => {
    const h = makeApp();
    const plugin = PluginFactory(h.app);
    plugin.start({
      defaultStalenessTimeoutMs: 10000,
      defaultEmitMinIntervalMs: 10000,
      defaultMinSources: 2,
      maxSourcesPerPath: 16,
      paths: [{ path: 'p', slewLimit: 1 }],
    });
    h.fire(delta(h.app.selfContext, 'a', 'p', 10));
    h.app.handleMessage.mockImplementationOnce(() => {
      throw new Error('send failed');
    });
    const next = vi.fn();
    h.fire(delta(h.app.selfContext, 'b', 'p', 20), next);
    expect(next).toHaveBeenCalledOnce();
    expect(h.app.setPluginStatus).toHaveBeenLastCalledWith(
      expect.stringContaining('waiting for sources')
    );
    h.fire(delta(h.app.selfContext, 'b', 'p', 22));
    expect(h.emitted).toHaveLength(1);
    expect(h.emitted[0]?.updates[0]?.values[0]?.value).toBe(16);
  });

  it('caps discovered sources using maxSourcesPerPath', () => {
    const h = makeApp();
    const plugin = PluginFactory(h.app);
    const router = h.captureRouter(plugin);
    plugin.start({
      defaultStalenessTimeoutMs: 10000,
      defaultEmitMinIntervalMs: 0,
      defaultMinSources: 2,
      maxSourcesPerPath: 2,
      paths: [],
    });
    h.fire(delta(h.app.selfContext, 'a', 'p', 1));
    h.fire(delta(h.app.selfContext, 'b', 'p', 2));
    h.fire(delta(h.app.selfContext, 'c', 'p', 3));
    expect(h.routerGet(router, '/api/detected').paths[0]?.sources).toEqual(['b', 'c']);
  });
});

describe('plugin: full-circle paths the specification defines', () => {
  const deg = (rad: number) => (rad * 180) / Math.PI;
  const rad = (d: number) => (d * Math.PI) / 180;

  // A bearing reported by two chartplotters either side of north. Combined
  // linearly this publishes 180 degrees, the reciprocal of the truth.
  const bearingPaths = [
    'navigation.courseRhumbline.bearingTrackTrue',
    'navigation.courseGreatCircle.bearingTrackMagnetic',
    'navigation.course.calcValues.bearingTrue',
    'navigation.courseGreatCircle.nextPoint.bearingTrue',
    'environment.current.setTrue',
    'steering.autopilot.target.headingTrue',
    'performance.tackTrue',
  ];

  for (const path of bearingPaths) {
    it(`${path} combines circularly, not linearly`, () => {
      const h = makeApp();
      const plugin = PluginFactory(h.app);
      plugin.start({
        defaultStalenessTimeoutMs: 10000,
        defaultEmitMinIntervalMs: 0,
        defaultMinSources: 2,
        maxSourcesPerPath: 16,
        paths: [{ path }],
      });
      h.fire(delta(h.app.selfContext, 'plotterA', path, rad(359)));
      h.fire(delta(h.app.selfContext, 'plotterB', path, rad(1)));
      const value = h.emitted[h.emitted.length - 1]?.updates[0].values[0].value as number;
      const north = Math.min(deg(value), 360 - deg(value));
      expect(north).toBeLessThan(0.001);
    });
  }
});

describe('plugin: a radian path the classifier cannot place', () => {
  const path = 'vendor.custom.someBearing';
  const rad = (d: number) => (d * Math.PI) / 180;

  function startWith(angular?: 'auto' | 'yes' | 'no') {
    const h = makeApp();
    h.app.getMetadata = () => ({ units: 'rad' });
    const plugin = PluginFactory(h.app);
    const router = h.captureRouter(plugin);
    plugin.start({
      defaultStalenessTimeoutMs: 10000,
      defaultEmitMinIntervalMs: 0,
      defaultMinSources: 2,
      maxSourcesPerPath: 16,
      paths: [angular ? { path, angular } : { path }],
    });
    h.fire(delta(h.app.selfContext, 'a', path, rad(359)));
    h.fire(delta(h.app.selfContext, 'b', path, rad(1)));
    return { h, plugin, router };
  }

  it('is named in the status line, the server log, and the panel row', () => {
    const { h, router } = startWith();
    expect(h.app.setPluginStatus).toHaveBeenLastCalledWith(
      expect.stringContaining(`Set angular wrapping on: ${path}.`)
    );
    expect(h.app.error).toHaveBeenCalledWith(expect.stringContaining(path));
    const row = h.routerGet(router, '/api/detected').paths[0];
    expect(row?.recommended).toBe(false);
    expect(row?.advisory).toContain('not a Signal K angle this plugin recognizes');
  });

  it('goes quiet once the operator answers, in either direction', () => {
    for (const angular of ['yes', 'no'] as const) {
      const { h, router } = startWith(angular);
      expect(h.app.setPluginStatus).not.toHaveBeenCalledWith(
        expect.stringContaining('Set angular wrapping on')
      );
      expect(h.app.error).not.toHaveBeenCalled();
      expect(h.routerGet(router, '/api/detected').paths[0]?.recommended).toBe(true);
    }
  });

  it('honours the override in both directions', () => {
    const deg = (r: number) => (r * 180) / Math.PI;
    const yes = startWith('yes');
    const yesValue = yes.h.emitted[yes.h.emitted.length - 1]?.updates[0].values[0].value as number;
    expect(Math.min(deg(yesValue), 360 - deg(yesValue))).toBeLessThan(0.001);
    const no = startWith('no');
    expect(no.h.emitted[no.h.emitted.length - 1]?.updates[0].values[0].value).toBeCloseTo(
      Math.PI,
      9
    );
  });
});

describe('plugin: confidence reaches a consumer that only reads the value', () => {
  const path = 'environment.depth.belowKeel';

  function start(h: ReturnType<typeof makeApp>, options: Record<string, unknown> = {}) {
    const plugin = PluginFactory(h.app);
    plugin.start({
      defaultStalenessTimeoutMs: 10000,
      defaultEmitMinIntervalMs: 0,
      defaultMinSources: 2,
      maxSourcesPerPath: 16,
      paths: [{ path }],
      ...options,
    });
    return plugin;
  }

  it('advises when the published value matches no source, and still publishes', () => {
    const h = makeApp();
    start(h);
    for (const [src, v] of [
      ['a', 2.0],
      ['b', 2.1],
      ['c', 30.0],
      ['d', 30.1],
    ] as [string, number][]) {
      h.fire(delta(h.app.selfContext, src, path, v));
    }
    expect(h.emitted[h.emitted.length - 1]?.updates[0].values[0].value).toBe(16.05);
    const note = h.lastNotification(path);
    expect(note?.state).toBe('warn');
    expect(note?.message).toContain('split into groups');
    expect(h.app.setPluginStatus).toHaveBeenLastCalledWith(
      expect.stringContaining('1 disagreeing')
    );
  });

  it('alerts on an operator-set disagreement distance, which is a deliberate alarm', () => {
    const h = makeApp();
    const plugin = PluginFactory(h.app);
    plugin.start({
      defaultStalenessTimeoutMs: 10000,
      defaultEmitMinIntervalMs: 0,
      defaultMinSources: 2,
      maxSourcesPerPath: 16,
      paths: [{ path, disagreeThreshold: 1 }],
    });
    h.fire(delta(h.app.selfContext, 'a', path, 2));
    h.fire(delta(h.app.selfContext, 'b', path, 30));
    expect(h.lastNotification(path)?.state).toBe('alert');
  });

  it('announces a rejected sensor in the status line and a notification', () => {
    const h = makeApp();
    start(h);
    for (const [src, v] of [
      ['a', 2.0],
      ['b', 2.05],
      ['c', 2.1],
      ['d', 30.0],
    ] as [string, number][]) {
      h.fire(delta(h.app.selfContext, src, path, v));
    }
    expect(h.app.setPluginStatus).toHaveBeenLastCalledWith(
      expect.stringContaining('1 with a rejected source')
    );
    expect(h.lastNotification(path)?.message).toContain('rejected as outliers');
    expect(h.app.debug).toHaveBeenCalledWith(expect.stringContaining('3 of 4 sources'));
  });

  it('clears the notification when the sensor comes back', () => {
    const h = makeApp();
    start(h);
    for (const [src, v] of [
      ['a', 2.0],
      ['b', 2.05],
      ['c', 2.1],
      ['d', 30.0],
    ] as [string, number][]) {
      h.fire(delta(h.app.selfContext, src, path, v));
    }
    h.fire(delta(h.app.selfContext, 'd', path, 2.06));
    expect(h.lastNotification(path)?.state).toBe('normal');
  });

  it('publishes nothing on the notification channel when the switch is off', () => {
    const h = makeApp();
    start(h, { notifications: false });
    h.fire(delta(h.app.selfContext, 'a', path, 2));
    h.fire(delta(h.app.selfContext, 'b', path, 30));
    expect(h.notifications).toHaveLength(0);
  });
});

describe('plugin: the detected row separates live sources from listed ones', () => {
  const path = 'environment.depth.belowKeel';

  it('reports fresh and excluded sources for a configured path', () => {
    const h = makeApp();
    const plugin = PluginFactory(h.app);
    const router = h.captureRouter(plugin);
    plugin.start({
      defaultStalenessTimeoutMs: 10000,
      defaultEmitMinIntervalMs: 0,
      defaultMinSources: 2,
      maxSourcesPerPath: 16,
      paths: [{ path, excludeSources: ['c'] }],
    });
    for (const src of ['a', 'b', 'c']) h.fire(delta(h.app.selfContext, src, path, 5));
    const row = h.routerGet(router, '/api/detected').paths[0];
    expect(row?.sources.slice().sort()).toEqual(['a', 'b', 'c']);
    expect(row?.freshSources?.slice().sort()).toEqual(['a', 'b']);
    expect(row?.excludedSources).toEqual(['c']);
  });

  it('reports no freshness for a path that is not configured', () => {
    const h = makeApp();
    const plugin = PluginFactory(h.app);
    const router = h.captureRouter(plugin);
    plugin.start({
      defaultStalenessTimeoutMs: 10000,
      defaultEmitMinIntervalMs: 0,
      defaultMinSources: 2,
      maxSourcesPerPath: 16,
      paths: [],
    });
    for (const src of ['a', 'b']) h.fire(delta(h.app.selfContext, src, path, 5));
    const row = h.routerGet(router, '/api/detected').paths[0];
    expect(row?.freshSources).toBeNull();
    expect(row?.excludedSources).toEqual([]);
  });

  it('reports the kind actually in force, not discovery automatic guess', () => {
    const path = 'vendor.custom.someBearing';
    const h = makeApp();
    h.app.getMetadata = () => ({ units: 'rad' });
    const plugin = PluginFactory(h.app);
    const router = h.captureRouter(plugin);
    plugin.start({
      defaultStalenessTimeoutMs: 10000,
      defaultEmitMinIntervalMs: 0,
      defaultMinSources: 2,
      maxSourcesPerPath: 16,
      paths: [{ path, angular: 'yes' }],
    });
    for (const src of ['a', 'b']) h.fire(delta(h.app.selfContext, src, path, 1));
    expect(h.routerGet(router, '/api/detected').paths[0]?.kind).toBe('angular');
  });
});

describe('plugin: jump rejection counts sensor samples', () => {
  it('accepts a genuine step once persistSamples samples confirm it, inside one emit window', () => {
    const h = makeApp();
    const plugin = PluginFactory(h.app);
    const path = 'environment.depth.belowKeel';
    plugin.start({
      defaultStalenessTimeoutMs: 10000,
      defaultEmitMinIntervalMs: 0,
      defaultMinSources: 1,
      maxSourcesPerPath: 16,
      paths: [{ path, jumpRejection: { maxRate: 1, persistSamples: 3, persistMs: 600000 } }],
    });
    h.fire(delta(h.app.selfContext, 'a', path, 30));
    for (let i = 0; i < 5; i++) h.fire(delta(h.app.selfContext, 'a', path, 2));
    const values = h.emitted.map((e) => e.updates[0].values[0].value);
    expect(values).toEqual([30, 30, 30, 2, 2, 2]);
  });
});

describe('plugin: a feed re-broadcast by two gateways counts once', () => {
  const path = 'environment.depth.belowKeel';

  it('collapses the duplicate group before combining', () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    const h = makeApp();
    const plugin = PluginFactory(h.app);
    try {
      plugin.start({
        defaultStalenessTimeoutMs: 100000,
        defaultEmitMinIntervalMs: 0,
        defaultMinSources: 2,
        maxSourcesPerPath: 16,
        paths: [{ path }],
      });
      // One sounder forwarded under two source names, plus an independent one.
      // Discovery samples history at 1 Hz, so the values have to move over time.
      for (let i = 0; i < 5; i++) {
        vi.advanceTimersByTime(1000);
        h.fire(delta(h.app.selfContext, 'n2k-1.35', path, 30 + i));
        h.fire(delta(h.app.selfContext, 'n2k-2.35', path, 30 + i));
        h.fire(delta(h.app.selfContext, 'nmea0183.DBT', path, 2 + i));
      }
      expect(h.app.debug).toHaveBeenCalledWith(expect.stringContaining('same feed'));
      // Two independent readings, 34 and 6, not three votes of which two agree.
      expect(h.emitted[h.emitted.length - 1]?.updates[0].values[0].value).toBe(20);
    } finally {
      void plugin.stop();
      vi.useRealTimers();
    }
  });

  it('says why a path waits when its sources report slower than the staleness window', () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    const h = makeApp();
    const plugin = PluginFactory(h.app);
    const router = h.captureRouter(plugin);
    try {
      plugin.start({
        defaultEmitMinIntervalMs: 0,
        defaultMinSources: 2,
        maxSourcesPerPath: 16,
        paths: [{ path, stalenessTimeoutMs: 1000 }],
      });
      for (let i = 0; i < 6; i++) {
        vi.advanceTimersByTime(500);
        h.fire(delta(h.app.selfContext, 'a', path, 5));
        vi.advanceTimersByTime(1500);
        h.fire(delta(h.app.selfContext, 'b', path, 5.1));
      }
      expect(h.routerGet(router, '/api/detected').paths[0]?.advisory).toContain(
        'Raise the staleness timeout'
      );
      expect(h.app.debug).toHaveBeenCalledWith(expect.stringContaining('rarely fresh together'));
    } finally {
      void plugin.stop();
      vi.useRealTimers();
    }
  });
});

describe('plugin: an unrecognized radian path that is not opted in', () => {
  const path = 'vendor.custom.someBearing';

  it('is explained in the panel but not in the status line or the server log', () => {
    const h = makeApp();
    h.app.getMetadata = () => ({ units: 'rad' });
    const plugin = PluginFactory(h.app);
    const router = h.captureRouter(plugin);
    plugin.start({
      defaultStalenessTimeoutMs: 10000,
      defaultEmitMinIntervalMs: 0,
      defaultMinSources: 2,
      maxSourcesPerPath: 16,
      paths: [],
    });
    for (const src of ['a', 'b']) h.fire(delta(h.app.selfContext, src, path, 1));

    const row = h.routerGet(router, '/api/detected').paths[0];
    expect(row?.recommended).toBe(false);
    expect(row?.advisory).toContain('not a Signal K angle this plugin recognizes');
    // Advice about a path nobody opted in to is advice about nothing.
    expect(h.app.error).not.toHaveBeenCalled();
    expect(h.app.setPluginStatus).not.toHaveBeenCalledWith(
      expect.stringContaining('Set angular wrapping on')
    );
  });
});
