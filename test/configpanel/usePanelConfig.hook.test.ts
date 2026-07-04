// @vitest-environment jsdom
// Hook-level tests for usePanelConfig's resync guard: a genuine external
// configuration change resyncs, a self-save echo does not. The pure
// transitions are covered in usePanelConfig.test.ts.
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PluginOptions } from '../../src/config.js';
import { normalizeOptions, usePanelConfig } from '../../src/configpanel/hooks/usePanelConfig.js';

interface HookProps {
  cfg: Partial<PluginOptions> | null | undefined;
}

function setup() {
  const lastSavedRef = { current: normalizeOptions(undefined) };
  const rendered = renderHook(({ cfg }: HookProps) => usePanelConfig(cfg, lastSavedRef), {
    initialProps: { cfg: undefined as HookProps['cfg'] },
  });
  return { lastSavedRef, ...rendered };
}

describe('usePanelConfig resync guard', () => {
  it('resyncs on a genuine external configuration change and advances the baseline', () => {
    const { result, rerender, lastSavedRef } = setup();
    act(() => {
      result.current.addPath('local.edit');
    });
    expect(result.current.options.paths).toHaveLength(1);

    const external: PluginOptions = {
      defaultStalenessTimeoutMs: 2000,
      defaultEmitMinIntervalMs: 1000,
      defaultMinSources: 2,
      maxSourcesPerPath: 16,
      paths: [{ path: 'external.path' }],
    };
    rerender({ cfg: external });
    expect(result.current.options.paths.map((p) => p.path)).toEqual(['external.path']);
    expect(lastSavedRef.current).toEqual(normalizeOptions(external));
  });

  it('ignores a self-save echo so an in-flight edit survives', () => {
    const { result, rerender, lastSavedRef } = setup();
    // The panel saves: the baseline advances to the saved options.
    act(() => {
      result.current.addPath('saved.path');
    });
    const saved = result.current.options;
    lastSavedRef.current = saved;
    // An edit lands while the save is in flight.
    act(() => {
      result.current.addPath('in.flight.edit');
    });
    expect(result.current.options.paths).toHaveLength(2);
    // The host echoes the earlier save back as a NEW object reference.
    rerender({ cfg: JSON.parse(JSON.stringify(saved)) as PluginOptions });
    // The echo matches the baseline, so the resync is skipped: the edit survives.
    expect(result.current.options.paths.map((p) => p.path)).toEqual([
      'saved.path',
      'in.flight.edit',
    ]);
  });
});
