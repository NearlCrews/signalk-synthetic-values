import { describe, expect, it } from 'vitest';
import { classify, type MetadataLookup, valueCategory } from '../src/pathClassifier';

const rad: MetadataLookup = (p) =>
  p === 'vessels.self.navigation.headingTrue' ? { units: 'rad' } : undefined;
const none: MetadataLookup = () => undefined;

describe('classify', () => {
  it('position object is position', () => {
    expect(
      classify('navigation.position', { latitude: 1, longitude: 2 }, 'auto', none, 'vessels.self')
    ).toBe('position');
  });
  it('allowlisted rad path is angular under auto', () => {
    expect(classify('navigation.headingTrue', 1.2, 'auto', rad, 'vessels.self')).toBe('angular');
  });
  it('rateOfTurn (rad but not circular) is scalar under auto', () => {
    const rot: MetadataLookup = () => ({ units: 'rad/s' });
    expect(classify('navigation.rateOfTurn', 0.1, 'auto', rot, 'vessels.self')).toBe('scalar');
  });
  it('angular:yes forces angular off the allowlist', () => {
    expect(classify('some.custom.angle', 1.2, 'yes', none, 'vessels.self')).toBe('angular');
  });
  it('angular:no forces scalar even for an allowlisted rad path', () => {
    expect(classify('navigation.headingTrue', 1.2, 'no', rad, 'vessels.self')).toBe('scalar');
  });
  it('plain number is scalar', () => {
    expect(classify('environment.depth.belowTransducer', 4.2, 'auto', none, 'vessels.self')).toBe(
      'scalar'
    );
  });
  it('attitude object is attitude', () => {
    expect(
      classify('navigation.attitude', { roll: 0, pitch: 0, yaw: 0 }, 'auto', none, 'vessels.self')
    ).toBe('attitude');
  });
  it('a non-position non-attitude object is other', () => {
    expect(
      classify(
        'navigation.foo',
        { foo: 1 } as unknown as Parameters<typeof classify>[1],
        'auto',
        none,
        'vessels.self'
      )
    ).toBe('other');
  });
  it('string value is other', () => {
    expect(
      classify(
        'navigation.state',
        'sailing' as unknown as Parameters<typeof classify>[1],
        'auto',
        none,
        'vessels.self'
      )
    ).toBe('other');
  });
});

describe('valueCategory', () => {
  it('finite number is number', () => {
    expect(valueCategory(4.2)).toBe('number');
    expect(valueCategory(0)).toBe('number');
    expect(valueCategory(-100)).toBe('number');
  });
  it('NaN is invalid', () => {
    expect(valueCategory(NaN)).toBe('invalid');
  });
  it('Infinity is invalid', () => {
    expect(valueCategory(Infinity)).toBe('invalid');
    expect(valueCategory(-Infinity)).toBe('invalid');
  });
  it('null is invalid', () => {
    expect(valueCategory(null)).toBe('invalid');
  });
  it('undefined is invalid', () => {
    expect(valueCategory(undefined)).toBe('invalid');
  });
  it('valid lat/lon object is latlon', () => {
    expect(valueCategory({ latitude: 51.5, longitude: -0.1 })).toBe('latlon');
  });
  it('out-of-range latitude or longitude is invalid', () => {
    expect(valueCategory({ latitude: 90.01, longitude: 0 })).toBe('invalid');
    expect(valueCategory({ latitude: 0, longitude: 180.01 })).toBe('invalid');
  });
  it('partial position with NaN latitude is invalid', () => {
    expect(valueCategory({ latitude: NaN, longitude: 5 })).toBe('invalid');
  });
  it('partial position with NaN longitude is invalid', () => {
    expect(valueCategory({ latitude: 51.5, longitude: NaN })).toBe('invalid');
  });
  it('attitude-like object is attitude', () => {
    expect(valueCategory({ roll: 0, pitch: 0, yaw: 0 })).toBe('attitude');
  });
  it('a partial attitude (missing a component) is nonCombinable', () => {
    expect(valueCategory({ roll: 0, pitch: 0 })).toBe('nonCombinable');
  });
  it('string is nonCombinable', () => {
    expect(valueCategory('sailing')).toBe('nonCombinable');
  });
  it('boolean is nonCombinable', () => {
    expect(valueCategory(true)).toBe('nonCombinable');
  });
});
