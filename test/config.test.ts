import { describe, expect, it } from 'vitest';
import {
  DEFAULT_JUMP_PERSIST_MS,
  DEFAULT_JUMP_PERSIST_SAMPLES,
  DEFAULT_MAX_SOURCES_PER_PATH,
  DEFAULT_MIN_SOURCES,
  DEFAULT_STALENESS_MS,
  type PluginOptions,
  validateConfig,
} from '../src/config';

// Entries are deliberately loose: many cases feed invalid shapes through the
// validator, which is exactly what it exists to reject.
const opts = (paths: unknown[]): PluginOptions => ({
  defaultStalenessTimeoutMs: 1000,
  defaultEmitMinIntervalMs: 1000,
  defaultMinSources: 2,
  maxSourcesPerPath: 16,
  paths: paths as PluginOptions['paths'],
});

describe('validateConfig', () => {
  it('resolves defaults into a path entry', () => {
    const r = validateConfig(opts([{ path: 'navigation.position' }]));
    expect(r.errors).toEqual([]);
    expect(r.config.paths[0].minSources).toBe(2);
    expect(r.config.paths[0].method).toBe('median');
    expect(r.config.paths[0].stalenessTimeoutMs).toBe(1000);
  });
  it('rejects a path that sets both includeSources and excludeSources', () => {
    const r = validateConfig(opts([{ path: 'a', includeSources: ['x'], excludeSources: ['y'] }]));
    expect(r.config.paths).toHaveLength(0);
    expect(r.errors[0].path).toBe('a');
  });
  it('advises when madThreshold is set with outlierRejection off', () => {
    const r = validateConfig(opts([{ path: 'a', outlierRejection: false, madThreshold: 3 }]));
    expect(r.config.paths).toHaveLength(1);
    expect(r.advisories[0].path).toBe('a');
    expect(r.advisories[0].message).toContain('madThreshold');
  });
  it('rejects a non-positive slewLimit', () => {
    const r = validateConfig(opts([{ path: 'a', slewLimit: 0 }]));
    expect(r.config.paths).toHaveLength(0);
    expect(r.errors[0].path).toBe('a');
    expect(r.errors[0].message).toContain('slewLimit');
  });
  it('drops duplicate paths, keeping the first', () => {
    const r = validateConfig(opts([{ path: 'a' }, { path: 'a' }]));
    expect(r.config.paths).toHaveLength(1);
    expect(r.errors.some((e) => e.path === 'a')).toBe(true);
  });
  it('rejects a non-positive staleness timeout', () => {
    const r = validateConfig(opts([{ path: 'a', stalenessTimeoutMs: 0 }]));
    expect(r.config.paths).toHaveLength(0);
  });
  it('rejects an unknown method', () => {
    const r = validateConfig(opts([{ path: 'a', method: 'bogus' }]));
    expect(r.config.paths).toHaveLength(0);
    expect(r.errors[0].path).toBe('a');
  });
  it('rejects an unknown angular mode', () => {
    const r = validateConfig(opts([{ path: 'a', angular: 'maybe' }]));
    expect(r.config.paths).toHaveLength(0);
    expect(r.errors[0].path).toBe('a');
  });
  it('rejects trimFraction of 0.5 (out of [0, 0.5))', () => {
    const r = validateConfig(opts([{ path: 'a', trimFraction: 0.5 }]));
    expect(r.config.paths).toHaveLength(0);
    expect(r.errors[0].path).toBe('a');
  });
  it('rejects trimFraction of -0.1 (out of [0, 0.5))', () => {
    const r = validateConfig(opts([{ path: 'a', trimFraction: -0.1 }]));
    expect(r.config.paths).toHaveLength(0);
    expect(r.errors[0].path).toBe('a');
  });
  it('rejects a negative emitMinIntervalMs', () => {
    const r = validateConfig(opts([{ path: 'a', emitMinIntervalMs: -1 }]));
    expect(r.config.paths).toHaveLength(0);
    expect(r.errors[0].path).toBe('a');
  });
  it('accepts emitMinIntervalMs of 0 (emit on every update)', () => {
    const r = validateConfig(opts([{ path: 'a', emitMinIntervalMs: 0 }]));
    expect(r.config.paths).toHaveLength(1);
    expect(r.errors).toHaveLength(0);
  });
  it('rejects a non-positive minSources', () => {
    const r = validateConfig(opts([{ path: 'a', minSources: 0 }]));
    expect(r.config.paths).toHaveLength(0);
    expect(r.errors[0].path).toBe('a');
  });
  it('rejects a non-positive rejectThreshold', () => {
    const r = validateConfig(opts([{ path: 'a', rejectThreshold: 0 }]));
    expect(r.config.paths).toHaveLength(0);
    expect(r.errors[0].path).toBe('a');
  });
  it('rejects a non-positive jumpRejection.maxRate', () => {
    const r = validateConfig(opts([{ path: 'a', jumpRejection: { maxRate: 0 } }]));
    expect(r.config.paths).toHaveLength(0);
    expect(r.errors[0].path).toBe('a');
  });
  it('rejects a missing path string', () => {
    const r = validateConfig(opts([{ path: '' }]));
    expect(r.config.paths).toHaveLength(0);
    expect(r.errors[0].message).toBe('missing path');
  });
  it('reports "missing path" for each entry with an empty path, never "duplicate"', () => {
    const r = validateConfig(opts([{ path: '' }, { path: '' }]));
    expect(r.config.paths).toHaveLength(0);
    expect(r.errors).toHaveLength(2);
    expect(r.errors.every((e) => e.message === 'missing path')).toBe(true);
  });
  it('rejects the second occurrence of a path even when the first entry is invalid', () => {
    // First entry: invalid because both includeSources and excludeSources are set.
    // Second entry: valid on its own, but must be rejected as a duplicate.
    const r = validateConfig(
      opts([{ path: 'a', includeSources: ['x'], excludeSources: ['y'] }, { path: 'a' }])
    );
    expect(r.config.paths).toHaveLength(0);
    const dupeError = r.errors.find(
      (e) => e.path === 'a' && e.message === 'duplicate path entry ignored'
    );
    expect(dupeError).toBeDefined();
  });
});

describe('validateConfig: jumpRejection normalization', () => {
  it('backfills persistSamples and persistMs when only maxRate is set', () => {
    // A partial jumpRejection reaches damping as a complete JumpConfig, or its
    // persistence check compares against undefined and freezes the value.
    const r = validateConfig(opts([{ path: 'a', jumpRejection: { maxRate: 5 } }]));
    expect(r.errors).toHaveLength(0);
    expect(r.config.paths[0].jumpRejection).toEqual({
      maxRate: 5,
      persistSamples: DEFAULT_JUMP_PERSIST_SAMPLES,
      persistMs: DEFAULT_JUMP_PERSIST_MS,
    });
  });
  it('keeps explicit persist fields', () => {
    const r = validateConfig(
      opts([{ path: 'a', jumpRejection: { maxRate: 5, persistSamples: 7, persistMs: 900 } }])
    );
    expect(r.config.paths[0].jumpRejection).toEqual({
      maxRate: 5,
      persistSamples: 7,
      persistMs: 900,
    });
  });
  it('rejects a non-integer persistSamples', () => {
    const r = validateConfig(
      opts([{ path: 'a', jumpRejection: { maxRate: 5, persistSamples: 1.5 } }])
    );
    expect(r.config.paths).toHaveLength(0);
    expect(r.errors[0].message).toContain('persistSamples');
  });
  it('rejects a negative persistMs', () => {
    const r = validateConfig(opts([{ path: 'a', jumpRejection: { maxRate: 5, persistMs: -1 } }]));
    expect(r.config.paths).toHaveLength(0);
    expect(r.errors[0].message).toContain('persistMs');
  });
});

describe('validateConfig: value hardening', () => {
  it('rejects a negative madThreshold', () => {
    const r = validateConfig(opts([{ path: 'a', madThreshold: -1 }]));
    expect(r.config.paths).toHaveLength(0);
    expect(r.errors[0].message).toContain('madThreshold');
  });
  it('accepts madThreshold 0 (schema minimum)', () => {
    const r = validateConfig(opts([{ path: 'a', madThreshold: 0 }]));
    expect(r.errors).toHaveLength(0);
    expect(r.config.paths[0].madThreshold).toBe(0);
  });
  it('rejects a fractional minSources', () => {
    const r = validateConfig(opts([{ path: 'a', minSources: 1.5 }]));
    expect(r.config.paths).toHaveLength(0);
    expect(r.errors[0].message).toContain('minSources');
  });
  it('falls back to the default when maxSourcesPerPath is fractional', () => {
    const r = validateConfig({ ...opts([{ path: 'a' }]), maxSourcesPerPath: 2.5 });
    expect(r.config.maxSourcesPerPath).toBe(DEFAULT_MAX_SOURCES_PER_PATH);
  });
  it('falls back to shipped defaults when the top-level defaults are missing', () => {
    // A REST-written or hand-edited config can omit the globals entirely;
    // every path must still resolve instead of erroring out.
    const r = validateConfig({ paths: [{ path: 'a' }] } as PluginOptions);
    expect(r.errors).toHaveLength(0);
    expect(r.config.paths[0].minSources).toBe(DEFAULT_MIN_SOURCES);
    expect(r.config.paths[0].stalenessTimeoutMs).toBe(DEFAULT_STALENESS_MS);
  });
});
