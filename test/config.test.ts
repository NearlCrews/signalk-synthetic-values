import { describe, expect, it } from 'vitest';
import { type PluginOptions, validateConfig } from '../src/config';

const opts = (paths: any[]): PluginOptions => ({
  defaultStalenessTimeoutMs: 1000,
  defaultEmitMinIntervalMs: 1000,
  defaultMinSources: 2,
  maxSourcesPerPath: 16,
  paths,
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
