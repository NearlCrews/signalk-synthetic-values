import { describe, it, expect } from 'vitest'
import { validateConfig, PluginOptions } from '../src/config'

const opts = (paths: any[]): PluginOptions => ({
  defaultStalenessTimeoutMs: 1000,
  defaultEmitMinIntervalMs: 1000,
  defaultMinSources: 2,
  maxSourcesPerPath: 16,
  paths,
})

describe('validateConfig', () => {
  it('resolves defaults into a path entry', () => {
    const r = validateConfig(opts([{ path: 'navigation.position' }]))
    expect(r.errors).toEqual([])
    expect(r.config.paths[0].minSources).toBe(2)
    expect(r.config.paths[0].method).toBe('median')
    expect(r.config.paths[0].stalenessTimeoutMs).toBe(1000)
  })
  it('rejects a path that sets both includeSources and excludeSources', () => {
    const r = validateConfig(opts([{ path: 'a', includeSources: ['x'], excludeSources: ['y'] }]))
    expect(r.config.paths).toHaveLength(0)
    expect(r.errors[0].path).toBe('a')
  })
  it('advises when madThreshold is set with outlierRejection off', () => {
    const r = validateConfig(opts([{ path: 'a', outlierRejection: false, madThreshold: 3 }]))
    expect(r.config.paths).toHaveLength(1)
    expect(r.advisories[0].path).toBe('a')
  })
  it('drops duplicate paths, keeping the first', () => {
    const r = validateConfig(opts([{ path: 'a' }, { path: 'a' }]))
    expect(r.config.paths).toHaveLength(1)
    expect(r.errors.some((e) => e.path === 'a')).toBe(true)
  })
  it('rejects a non-positive staleness timeout', () => {
    const r = validateConfig(opts([{ path: 'a', stalenessTimeoutMs: 0 }]))
    expect(r.config.paths).toHaveLength(0)
  })
})
