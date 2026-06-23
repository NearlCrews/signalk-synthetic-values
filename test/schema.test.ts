import { describe, it, expect } from 'vitest'
import { buildSchema } from '../src/schema'

describe('buildSchema', () => {
  it('includes detected paths as enum hints', () => {
    const schema: any = buildSchema(() => [{ path: 'navigation.position', sources: ['a', 'b'] }])
    const pathProp = schema.properties.paths.items.properties.path
    expect(pathProp.examples).toContain('navigation.position')
  })
  it('never throws when detection throws, returns a usable schema', () => {
    const schema: any = buildSchema(() => {
      throw new Error('boom')
    })
    expect(schema.properties.paths).toBeDefined()
    expect(schema.properties.paths.items.properties.path.examples).toEqual([])
  })
  it('description names the discovery route', () => {
    const schema: any = buildSchema(() => [])
    expect(JSON.stringify(schema)).toContain('/plugins/signalk-synthetic-values/detected')
  })
})
