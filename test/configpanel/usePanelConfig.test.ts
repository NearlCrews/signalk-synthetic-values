// @vitest-environment jsdom
// Tests for the pure state transitions in usePanelConfig.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import {
  applyAddPath,
  applyAddAllCombinable,
  applyRemovePath,
  applyUpdatePath,
  usePanelConfig,
} from '../../src/configpanel/hooks/usePanelConfig.js';
import type { PluginOptions } from '../../src/config.js';
import type { DetectedRow } from '../../src/configpanel/hooks/useDetected.js';

const baseOptions: PluginOptions = {
  defaultStalenessTimeoutMs: 5000,
  defaultEmitMinIntervalMs: 500,
  defaultMinSources: 2,
  maxSourcesPerPath: 16,
  paths: [],
};

// -- applyAddPath -------------------------------------------------------------

describe('applyAddPath', () => {
  it('appends a minimal { path } entry and preserves all top-level defaults', () => {
    const next = applyAddPath(baseOptions, 'navigation.position');

    expect(next.paths).toHaveLength(1);
    expect(next.paths[0]).toEqual({ path: 'navigation.position' });

    // Top-level defaults must be preserved unchanged.
    expect(next.defaultStalenessTimeoutMs).toBe(baseOptions.defaultStalenessTimeoutMs);
    expect(next.defaultEmitMinIntervalMs).toBe(baseOptions.defaultEmitMinIntervalMs);
    expect(next.defaultMinSources).toBe(baseOptions.defaultMinSources);
    expect(next.maxSourcesPerPath).toBe(baseOptions.maxSourcesPerPath);
  });

  it('is a no-op when the path is already present', () => {
    const withPath = applyAddPath(baseOptions, 'navigation.position');
    const again = applyAddPath(withPath, 'navigation.position');

    expect(again.paths).toHaveLength(1);
    // Returns the same object reference (no mutation).
    expect(again).toBe(withPath);
  });

  it('does not mutate the input object', () => {
    const frozen = Object.freeze({ ...baseOptions, paths: Object.freeze([]) as PluginOptions['paths'] });
    const next = applyAddPath(frozen as PluginOptions, 'navigation.headingTrue');
    expect(next).not.toBe(frozen);
    expect(next.paths).toHaveLength(1);
  });
});

// -- applyAddAllCombinable -----------------------------------------------------

describe('applyAddAllCombinable', () => {
  const rows: DetectedRow[] = [
    { path: 'navigation.position', sources: ['gps1', 'gps2'], kind: 'position', optedIn: false },
    { path: 'navigation.headingTrue', sources: ['compass1', 'compass2'], kind: 'angular', optedIn: false },
    { path: 'environment.depth.belowKeel', sources: ['depth1', 'depth2'], kind: 'scalar', optedIn: false },
    { path: 'some.unknown.path', sources: ['s1', 's2'], kind: 'unknown', optedIn: false },
    { path: 'vessel.name', sources: ['ais', 'manual'], kind: 'other', optedIn: false },
  ];

  it('adds position, angular, scalar, and unknown rows but not other', () => {
    const next = applyAddAllCombinable(baseOptions, rows);

    const addedPaths = next.paths.map((p) => p.path);
    expect(addedPaths).toContain('navigation.position');
    expect(addedPaths).toContain('navigation.headingTrue');
    expect(addedPaths).toContain('environment.depth.belowKeel');
    expect(addedPaths).toContain('some.unknown.path');
    expect(addedPaths).not.toContain('vessel.name');
    expect(next.paths).toHaveLength(4);
  });

  it('skips rows already present in paths', () => {
    const alreadyIn: PluginOptions = {
      ...baseOptions,
      paths: [{ path: 'navigation.position' }],
    };
    const next = applyAddAllCombinable(alreadyIn, rows);

    expect(next.paths.filter((p) => p.path === 'navigation.position')).toHaveLength(1);
    expect(next.paths).toHaveLength(4); // 3 new combinable + 1 already in
  });

  it('preserves top-level defaults', () => {
    const next = applyAddAllCombinable(baseOptions, rows);
    expect(next.defaultMinSources).toBe(baseOptions.defaultMinSources);
    expect(next.defaultStalenessTimeoutMs).toBe(baseOptions.defaultStalenessTimeoutMs);
    expect(next.defaultEmitMinIntervalMs).toBe(baseOptions.defaultEmitMinIntervalMs);
    expect(next.maxSourcesPerPath).toBe(baseOptions.maxSourcesPerPath);
  });

  it('returns the same object when there is nothing to add', () => {
    const alreadyIn: PluginOptions = {
      ...baseOptions,
      paths: [
        { path: 'navigation.position' },
        { path: 'navigation.headingTrue' },
        { path: 'environment.depth.belowKeel' },
        { path: 'some.unknown.path' },
      ],
    };
    const next = applyAddAllCombinable(alreadyIn, rows);
    expect(next).toBe(alreadyIn);
  });
});

// -- applyRemovePath ----------------------------------------------------------

describe('applyRemovePath', () => {
  it('removes the matching entry', () => {
    const withTwo: PluginOptions = {
      ...baseOptions,
      paths: [{ path: 'navigation.position' }, { path: 'environment.depth.belowKeel' }],
    };
    const next = applyRemovePath(withTwo, 'navigation.position');
    expect(next.paths).toHaveLength(1);
    expect(next.paths[0]?.path).toBe('environment.depth.belowKeel');
  });

  it('is a no-op when the path is not present', () => {
    const next = applyRemovePath(baseOptions, 'navigation.position');
    expect(next).toBe(baseOptions);
  });

  it('preserves top-level defaults', () => {
    const withOne: PluginOptions = { ...baseOptions, paths: [{ path: 'navigation.position' }] };
    const next = applyRemovePath(withOne, 'navigation.position');
    expect(next.defaultMinSources).toBe(baseOptions.defaultMinSources);
  });
});

// -- applyUpdatePath ----------------------------------------------------------

describe('applyUpdatePath', () => {
  it('merges a patch into the matching entry', () => {
    const withOne: PluginOptions = {
      ...baseOptions,
      paths: [{ path: 'navigation.position', minSources: 2 }],
    };
    const next = applyUpdatePath(withOne, 'navigation.position', { minSources: 3 });
    expect(next.paths[0]).toEqual({ path: 'navigation.position', minSources: 3 });
  });

  it('preserves other paths unmodified', () => {
    const withTwo: PluginOptions = {
      ...baseOptions,
      paths: [
        { path: 'navigation.position' },
        { path: 'environment.depth.belowKeel', minSources: 2 },
      ],
    };
    const next = applyUpdatePath(withTwo, 'navigation.position', { method: 'mean' });
    expect(next.paths[1]).toEqual({ path: 'environment.depth.belowKeel', minSources: 2 });
  });

  it('is a no-op when the path is not present', () => {
    const next = applyUpdatePath(baseOptions, 'navigation.position', { minSources: 3 });
    expect(next).toBe(baseOptions);
  });
});

// -- usePanelConfig hook (renderHook) ----------------------------------------

describe('usePanelConfig hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('commit() calls save with the full PluginOptions and saved becomes true', async () => {
    const mockSave = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => usePanelConfig(baseOptions, mockSave));

    // Mutate state first, then commit in a separate act so the state update settles.
    act(() => {
      result.current.addPath('navigation.position');
    });
    await act(async () => {
      await result.current.commit();
    });

    expect(mockSave).toHaveBeenCalledOnce();
    const calledWith = mockSave.mock.calls[0]?.[0] as PluginOptions;

    // The path added before commit must be present.
    expect(calledWith.paths).toEqual([{ path: 'navigation.position' }]);

    // Top-level defaults must be preserved intact.
    expect(calledWith.defaultStalenessTimeoutMs).toBe(baseOptions.defaultStalenessTimeoutMs);
    expect(calledWith.defaultEmitMinIntervalMs).toBe(baseOptions.defaultEmitMinIntervalMs);
    expect(calledWith.defaultMinSources).toBe(baseOptions.defaultMinSources);
    expect(calledWith.maxSourcesPerPath).toBe(baseOptions.maxSourcesPerPath);

    // saved flag becomes true after a successful commit.
    expect(result.current.saved).toBe(true);

    // saving flag must be false once the commit resolves.
    expect(result.current.saving).toBe(false);
  });
});
