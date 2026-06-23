import { describe, it, expect } from 'vitest'
import { classify, valueCategory, MetadataLookup } from '../src/pathClassifier'

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

describe('valueCategory', () => {
  it('finite number is number', () => {
    expect(valueCategory(4.2)).toBe('number')
    expect(valueCategory(0)).toBe('number')
    expect(valueCategory(-100)).toBe('number')
  })
  it('NaN is invalid', () => {
    expect(valueCategory(NaN)).toBe('invalid')
  })
  it('Infinity is invalid', () => {
    expect(valueCategory(Infinity)).toBe('invalid')
    expect(valueCategory(-Infinity)).toBe('invalid')
  })
  it('null is invalid', () => {
    expect(valueCategory(null)).toBe('invalid')
  })
  it('undefined is invalid', () => {
    expect(valueCategory(undefined)).toBe('invalid')
  })
  it('valid lat/lon object is latlon', () => {
    expect(valueCategory({ latitude: 51.5, longitude: -0.1 })).toBe('latlon')
  })
  it('partial position with NaN latitude is invalid', () => {
    expect(valueCategory({ latitude: NaN, longitude: 5 })).toBe('invalid')
  })
  it('partial position with NaN longitude is invalid', () => {
    expect(valueCategory({ latitude: 51.5, longitude: NaN })).toBe('invalid')
  })
  it('attitude-like object is nonCombinable', () => {
    expect(valueCategory({ roll: 0, pitch: 0, yaw: 0 })).toBe('nonCombinable')
  })
  it('string is nonCombinable', () => {
    expect(valueCategory('sailing')).toBe('nonCombinable')
  })
  it('boolean is nonCombinable', () => {
    expect(valueCategory(true)).toBe('nonCombinable')
  })
})
