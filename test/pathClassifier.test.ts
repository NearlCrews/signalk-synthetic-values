import { describe, it, expect } from 'vitest'
import { classify, MetadataLookup } from '../src/pathClassifier'

const rad: MetadataLookup = (p) =>
  p === 'vessels.self.navigation.headingTrue' ? { units: 'rad' } : undefined
const none: MetadataLookup = () => undefined

describe('classify', () => {
  it('position object is position', () => {
    expect(classify('navigation.position', { latitude: 1, longitude: 2 }, 'auto', none, 'vessels.self')).toBe('position')
  })
  it('allowlisted rad path is angular under auto', () => {
    expect(classify('navigation.headingTrue', 1.2, 'auto', rad, 'vessels.self')).toBe('angular')
  })
  it('rateOfTurn (rad but not circular) is scalar under auto', () => {
    const rot: MetadataLookup = () => ({ units: 'rad/s' })
    expect(classify('navigation.rateOfTurn', 0.1, 'auto', rot, 'vessels.self')).toBe('scalar')
  })
  it('angular:yes forces angular off the allowlist', () => {
    expect(classify('some.custom.angle', 1.2, 'yes', none, 'vessels.self')).toBe('angular')
  })
  it('angular:no forces scalar even for an allowlisted rad path', () => {
    expect(classify('navigation.headingTrue', 1.2, 'no', rad, 'vessels.self')).toBe('scalar')
  })
  it('plain number is scalar', () => {
    expect(classify('environment.depth.belowTransducer', 4.2, 'auto', none, 'vessels.self')).toBe('scalar')
  })
  it('non-position object is other', () => {
    expect(classify('navigation.attitude', { roll: 0, pitch: 0, yaw: 0 } as any, 'auto', none, 'vessels.self')).toBe('other')
  })
  it('string value is other', () => {
    expect(classify('navigation.state', 'sailing' as any, 'auto', none, 'vessels.self')).toBe('other')
  })
})
