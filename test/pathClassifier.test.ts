import { describe, expect, it } from 'vitest';
import { angleFamily, classify, type MetadataLookup, valueCategory } from '../src/pathClassifier';

const rad: MetadataLookup = (p) =>
  p === 'vessels.self.navigation.headingTrue' ? { units: 'rad' } : undefined;
const none: MetadataLookup = () => undefined;

const kindOf = (
  path: string,
  value: Parameters<typeof classify>[1],
  mode: Parameters<typeof classify>[2] = 'auto',
  units: MetadataLookup = none
) => classify(path, value, mode, units, 'vessels.self').kind;

describe('classify', () => {
  it('position object is position', () => {
    expect(kindOf('navigation.position', { latitude: 1, longitude: 2 })).toBe('position');
  });
  it('a named full-circle rad path is angular under auto', () => {
    expect(kindOf('navigation.headingTrue', 1.2, 'auto', rad)).toBe('angular');
  });
  it('rateOfTurn (rad but not circular) is scalar under auto', () => {
    const rot: MetadataLookup = () => ({ units: 'rad/s' });
    expect(kindOf('navigation.rateOfTurn', 0.1, 'auto', rot)).toBe('scalar');
  });
  it('angular:yes forces angular off the list', () => {
    expect(kindOf('some.custom.angle', 1.2, 'yes')).toBe('angular');
  });
  it('angular:no forces scalar even for a named full-circle path', () => {
    expect(kindOf('navigation.headingTrue', 1.2, 'no', rad)).toBe('scalar');
  });
  it('plain number is scalar', () => {
    expect(kindOf('environment.depth.belowTransducer', 4.2)).toBe('scalar');
  });
  it('attitude object is attitude', () => {
    expect(kindOf('navigation.attitude', { roll: 0, pitch: 0, yaw: 0 })).toBe('attitude');
  });
  it('a non-position non-attitude object is other', () => {
    expect(kindOf('navigation.foo', { foo: 1 } as unknown as Parameters<typeof classify>[1])).toBe(
      'other'
    );
  });
  it('string value is other', () => {
    expect(kindOf('navigation.state', 'sailing' as unknown as Parameters<typeof classify>[1])).toBe(
      'other'
    );
  });
});

describe('classify: full-circle coverage', () => {
  // Every one of these is a bearing or a direction that wraps at the seam, so a
  // linear average of 359 and 1 degrees publishes the reciprocal.
  const fullCircle = [
    'navigation.courseRhumbline.bearingTrackTrue',
    'navigation.courseRhumbline.bearingTrackMagnetic',
    'navigation.courseGreatCircle.bearingTrackTrue',
    'navigation.courseGreatCircle.bearingTrackMagnetic',
    'navigation.courseGreatCircle.nextPoint.bearingTrue',
    'navigation.courseRhumbline.nextPoint.bearingMagnetic',
    'navigation.course.calcValues.bearingTrackTrue',
    'navigation.course.calcValues.bearingMagnetic',
    'environment.current.setTrue',
    'environment.current.setMagnetic',
    'steering.autopilot.target.headingTrue',
    'steering.autopilot.target.headingMagnetic',
    'steering.autopilot.target.windAngleApparent',
    'steering.autopilot.target.windAngleTrue',
    'performance.tackTrue',
    'performance.tackMagnetic',
    'performance.targetAngle',
  ];
  for (const path of fullCircle) {
    it(`${path} is angular`, () => {
      expect(kindOf(path, 1.2)).toBe('angular');
    });
  }
  it('does not need metadata, because the server does not resolve units for every spec path', () => {
    expect(angleFamily('navigation.courseGreatCircle.nextPoint.bearingTrue')).toBe('fullCircle');
    expect(kindOf('navigation.courseGreatCircle.nextPoint.bearingTrue', 1.2, 'auto', none)).toBe(
      'angular'
    );
  });
  it('the course prefix rule does not leak outside the course families', () => {
    expect(angleFamily('vendor.course.calcValues.bearingTrue')).toBe('unknown');
    expect(angleFamily('navigation.courseGreatCircle.nextPoint.distance')).toBe('unknown');
  });
});

describe('classify: bounded angles stay scalar and stay quiet', () => {
  const bounded = [
    'navigation.magneticVariation',
    'navigation.magneticDeviation',
    'navigation.leewayAngle',
    'performance.leeway',
    'performance.beatAngle',
    'performance.gybeAngle',
    'steering.rudderAngle',
    'steering.rudderAngleTarget',
    'steering.autopilot.deadZone',
    'steering.autopilot.backlash',
    'steering.autopilot.portLock',
    'steering.autopilot.starboardLock',
    'design.keel.angle',
    'environment.wind.directionChangeAlarm',
    'propulsion.port.drive.thrustAngle',
  ];
  for (const path of bounded) {
    it(`${path} is scalar with no advisory`, () => {
      const c = classify(path, 0.2, 'auto', () => ({ units: 'rad' }), 'vessels.self');
      expect(c.kind).toBe('scalar');
      expect(c.unrecognizedAngle).toBeUndefined();
    });
  }
});

describe('classify: an unrecognized radian path is flagged', () => {
  const radAnything: MetadataLookup = () => ({ units: 'rad' });
  it('combines as a scalar but says so', () => {
    const c = classify('vendor.custom.someBearing', 1.2, 'auto', radAnything, 'vessels.self');
    expect(c).toEqual({ kind: 'scalar', unrecognizedAngle: true });
  });
  it('a path with no radian units is not flagged', () => {
    expect(classify('environment.depth.belowKeel', 4.2, 'auto', none, 'vessels.self')).toEqual({
      kind: 'scalar',
      safeDirection: 'decreasing',
    });
  });
  it('an explicit override answers the question, so neither mode flags', () => {
    expect(classify('vendor.custom.someBearing', 1.2, 'yes', radAnything, 'vessels.self')).toEqual({
      kind: 'angular',
    });
    expect(classify('vendor.custom.someBearing', 1.2, 'no', radAnything, 'vessels.self')).toEqual({
      kind: 'scalar',
    });
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
