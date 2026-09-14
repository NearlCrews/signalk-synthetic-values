// test/combine.test.ts
import { describe, expect, it } from 'vitest';
import { type CombineOptions, circularMedoid, combine, type Sample } from '../src/combine';
import type { LatLon, SampleValue } from '../src/metrics';
import { toDegrees, toRadians } from '../src/metrics';

const base: Omit<CombineOptions, 'kind'> = {
  method: 'median',
  minSources: 2,
  outlierRejection: true,
  madThreshold: 3,
  angularSpreadThreshold: Math.PI / 2,
  trimFraction: 0.25,
};

const s = (sourceRef: string, value: SampleValue): Sample => ({ sourceRef, value });

describe('combine source-count outcomes', () => {
  it('no samples is allStale', () => {
    const r = combine([], { ...base, kind: 'scalar' });
    expect(r.outcome).toBe('allStale');
    expect(r.value).toBeUndefined();
  });
  it('below minSources is belowMin', () => {
    const r = combine([s('a', 5)], { ...base, kind: 'scalar' });
    expect(r.outcome).toBe('belowMin');
    expect(r.value).toBeUndefined();
  });
  it('single source passes through when minSources is 1', () => {
    const r = combine([s('a', 5)], { ...base, kind: 'scalar', minSources: 1 });
    expect(r.outcome).toBe('singleSource');
    expect(r.value).toBe(5);
  });
});

describe('combine outlier rejection empties the source set', () => {
  it('returns diverged with no value when all sources are rejected', () => {
    // Two sources 100 units apart with rejectThreshold: 10 and minSources: 2.
    // Both sources are far from the center (50), so both get rejected.
    const r = combine([s('a', 0), s('b', 100)], {
      ...base,
      kind: 'scalar',
      minSources: 2,
      outlierRejection: true,
      rejectThreshold: 10,
    });
    expect(r.outcome).toBe('diverged');
    expect(r.value).toBeUndefined();
  });
  it('returns diverged when rejection whittles the used set below minSources', () => {
    // 5 fresh sources pass the pre-rejection gate, MAD rejection drops the two
    // gross outliers, and the 3 survivors sit below minSources=4: reporting
    // 'ok' would present a thin consensus as fully corroborated.
    const r = combine([s('a', 0), s('b', 1), s('c', 2), s('d', 1000), s('e', 2000)], {
      ...base,
      kind: 'scalar',
      minSources: 4,
    });
    expect(r.outcome).toBe('diverged');
    expect(r.value).toBeUndefined();
    expect(r.freshCount).toBe(5);
    expect(r.usedSources).toEqual(['a', 'b', 'c']);
  });
  it('reports a lone post-rejection survivor as single-source operation', () => {
    const r = combine([s('a', 0), s('b', 100), s('c', 200), s('d', 300), s('e', 400)], {
      ...base,
      kind: 'scalar',
      minSources: 1,
      madThreshold: 0,
    });
    expect(r.outcome).toBe('singleSource');
    expect(r.value).toBe(200);
    expect(r.usedSources).toEqual(['c']);
  });
});

describe('combine scalar', () => {
  it('medians three sources', () => {
    const r = combine([s('a', 10), s('b', 11), s('c', 30)], { ...base, kind: 'scalar' });
    expect(r.outcome).toBe('ok');
    expect(r.value).toBe(11);
  });
  it('flags disagreement but still emits', () => {
    const r = combine([s('a', 10), s('b', 11), s('c', 30)], {
      ...base,
      kind: 'scalar',
      disagreeThreshold: 5,
    });
    expect(r.outcome).toBe('disagree');
    expect(r.value).toBe(11);
  });
});

describe('circularMedoid', () => {
  it('returns the reading with the least total angular distance', () => {
    expect(
      (circularMedoid([toRadians(4.2), toRadians(9.4), toRadians(9.4)]) * 180) / Math.PI
    ).toBeCloseTo(9.4, 6);
  });
  it('handles the wrap boundary (readings near north)', () => {
    // 359 deg, 1 deg, 1 deg cluster near north; medoid is one of the 1 deg readings.
    const m = (circularMedoid([toRadians(359), toRadians(1), toRadians(1)]) * 180) / Math.PI;
    expect(m).toBeCloseTo(1, 6);
  });
  it('returns the sole reading for a single angle', () => {
    expect(circularMedoid([toRadians(42)])).toBeCloseTo(toRadians(42), 9);
  });
});

describe('combine angular', () => {
  it('uses the circular mean for method=mean', () => {
    const r = combine([s('a', toRadians(0)), s('b', toRadians(10)), s('c', toRadians(350))], {
      ...base,
      kind: 'angular',
      method: 'mean',
    });
    const deg = ((r.value as number) * 180) / Math.PI;
    expect(Math.min(deg, 360 - deg)).toBeLessThan(1);
    expect(r.outcome).toBe('ok');
  });

  it('uses the circular medoid for method=median, tracking the consensus not the mean', () => {
    // Two compasses agree at 9.4 deg, one reads 4.2 deg. The circular mean is
    // ~7.6 deg (dragged by the outlier); the medoid is the consensus 9.4 deg.
    const r = combine([s('a', toRadians(4.2)), s('b', toRadians(9.4)), s('c', toRadians(9.4))], {
      ...base,
      kind: 'angular',
      method: 'median',
    });
    expect(r.outcome).toBe('ok');
    expect(((r.value as number) * 180) / Math.PI).toBeCloseTo(9.4, 4);
  });
  it('suppresses an antipodal pair', () => {
    const r = combine([s('a', 0), s('b', Math.PI)], { ...base, kind: 'angular' });
    expect(r.outcome).toBe('diverged');
    expect(r.value).toBeUndefined();
  });
  it('suppresses a wide fan (north, east, south)', () => {
    const r = combine([s('a', 0), s('b', Math.PI / 2), s('c', Math.PI)], {
      ...base,
      kind: 'angular',
    });
    expect(r.outcome).toBe('diverged');
  });
});

describe('combine attitude', () => {
  const att = (roll: number, pitch: number, yaw: number) => ({ roll, pitch, yaw });

  it('combines each component, tracking the consensus per axis', () => {
    // Two sources agree on roll/pitch/yaw, one is off on yaw only.
    const r = combine(
      [
        s('a', att(toRadians(2), toRadians(-5), toRadians(90))),
        s('b', att(toRadians(2), toRadians(-5), toRadians(90))),
        s('c', att(toRadians(2), toRadians(-5), toRadians(80))),
      ],
      { ...base, kind: 'attitude' }
    );
    expect(r.outcome).toBe('ok');
    const v = r.value as { roll: number; pitch: number; yaw: number };
    // medoid per axis lands on the agreeing pair
    expect((v.yaw * 180) / Math.PI).toBeCloseTo(90, 4);
    expect((v.roll * 180) / Math.PI).toBeCloseTo(2, 4);
  });

  it('suppresses the whole attitude when any axis is too scattered', () => {
    // yaw is antipodal (0 and 180) so that axis diverges, suppressing the value.
    const r = combine([s('a', att(0, 0, 0)), s('b', att(0, 0, Math.PI))], {
      ...base,
      kind: 'attitude',
    });
    expect(r.outcome).toBe('diverged');
    expect(r.value).toBeUndefined();
  });
});

describe('combine position', () => {
  it('is antimeridian safe', () => {
    const r = combine(
      [
        s('a', { latitude: 0, longitude: 179.99995 }),
        s('b', { latitude: 0, longitude: -179.99995 }),
      ],
      { ...base, kind: 'position' }
    );
    const v = r.value as LatLon;
    expect(Math.abs(v.longitude)).toBeGreaterThan(179);
  });
  it('uses a robust longitude for median with three sources', () => {
    const r = combine(
      [
        s('a', { latitude: 10, longitude: 20 }),
        s('b', { latitude: 10, longitude: 20 }),
        s('c', { latitude: 10, longitude: 100 }),
      ],
      { ...base, kind: 'position' }
    );
    expect((r.value as { longitude: number }).longitude).toBeCloseTo(20, 9);
  });
  it('rejects a far position whole-source and lands on the cluster', () => {
    const r = combine(
      [
        s('a', { latitude: 10, longitude: 20 }),
        s('b', { latitude: 10.00001, longitude: 20.00001 }),
        s('c', { latitude: 9.99999, longitude: 19.99999 }),
        s('d', { latitude: 11, longitude: 21 }),
      ],
      { ...base, kind: 'position' }
    );
    const v = r.value as LatLon;
    expect(v.latitude).toBeCloseTo(10, 3);
    expect(v.longitude).toBeCloseTo(20, 3);
  });
});

describe('combine: an output no source is near', () => {
  const scalar = { ...base, kind: 'scalar' as const };
  const four = (...xs: number[]): Sample[] => xs.map((v, i) => s(`s${i + 1}`, v));

  it('flags four sounders split into two pairs, and still emits', () => {
    const r = combine(four(2.0, 2.1, 30.0, 30.1), scalar);
    expect(r.value).toBe(16.05);
    expect(r.outcome).toBe('disagree');
    expect(r.unsupported).toBe(true);
    expect(r.spread).toBeCloseTo(28.1, 6);
  });

  it('flags a mean that lands between clusters at three sources', () => {
    const r = combine(four(2.0, 2.1, 30.0), { ...scalar, method: 'mean' });
    expect(r.unsupported).toBe(true);
  });

  it('leaves an evenly scattered set alone', () => {
    expect(combine(four(1, 2, 3, 4, 5), scalar).outcome).toBe('ok');
    expect(combine(four(2.0, 2.05, 2.1, 2.15), scalar).outcome).toBe('ok');
  });

  it('leaves identical readings alone', () => {
    const r = combine(four(5, 5, 5, 5), scalar);
    expect(r.outcome).toBe('ok');
    expect(r.unsupported).toBeUndefined();
  });

  it('cannot run below three readings, which is what the config advisory says', () => {
    const r = combine(four(2, 30), scalar);
    expect(r.outcome).toBe('ok');
    expect(r.unsupported).toBeUndefined();
  });

  it('defers to an operator-set disagreement distance', () => {
    const within = combine(four(2.0, 2.1, 2.4, 2.5), { ...scalar, disagreeThreshold: 1 });
    expect(within.outcome).toBe('ok');
    expect(within.unsupported).toBeUndefined();
    const beyond = combine(four(2.0, 2.1, 30.0, 30.1), { ...scalar, disagreeThreshold: 1 });
    expect(beyond.outcome).toBe('disagree');
    expect(beyond.unsupported).toBeUndefined();
  });

  it('does not run on position, where two antenna groups are a legitimate pair', () => {
    const bow = { latitude: 50, longitude: -1 };
    const stern = { latitude: 50.0001, longitude: -1 };
    const r = combine([s('a', bow), s('b', bow), s('c', stern), s('d', stern)], {
      ...base,
      kind: 'position',
    });
    expect(r.outcome).toBe('ok');
    expect(r.unsupported).toBeUndefined();
  });
});

describe('combine: rejectThreshold is an absolute limit', () => {
  const three = [s('s1', 2.0), s('s2', 2.1), s('s3', 30)];
  it('applies with outlier rejection on', () => {
    const r = combine(three, { ...base, kind: 'scalar', rejectThreshold: 1 });
    expect(r.usedSources).toEqual(['s1', 's2']);
    expect(r.rejectedSources).toEqual(['s3']);
  });
  it('still applies with outlier rejection off', () => {
    const r = combine(three, {
      ...base,
      kind: 'scalar',
      outlierRejection: false,
      rejectThreshold: 1,
    });
    expect(r.usedSources).toEqual(['s1', 's2']);
    expect(r.rejectedSources).toEqual(['s3']);
  });
  it('with rejection off and no rejectThreshold, nothing is rejected', () => {
    const r = combine(three, { ...base, kind: 'scalar', outlierRejection: false });
    expect(r.usedSources).toEqual(['s1', 's2', 's3']);
    expect(r.rejectedSources).toEqual([]);
  });
});

describe('circularMedoid tie handling', () => {
  it('returns the bisector for two readings, whichever order they arrive in', () => {
    expect(toDegrees(circularMedoid([toRadians(10), toRadians(50)]))).toBeCloseTo(30, 9);
    expect(toDegrees(circularMedoid([toRadians(50), toRadians(10)]))).toBeCloseTo(30, 9);
  });
  it('takes the short way around the seam', () => {
    expect(toDegrees(circularMedoid([toRadians(350), toRadians(30)]))).toBeCloseTo(10, 9);
    expect(toDegrees(circularMedoid([toRadians(30), toRadians(350)]))).toBeCloseTo(10, 9);
  });
  it('keeps identical readings exact rather than routing them through trigonometry', () => {
    expect(circularMedoid([0.1, 0.1])).toBe(0.1);
    expect(circularMedoid([1.5, 1.5, 1.5])).toBe(1.5);
  });
  it('a clear winner is still an observed reading', () => {
    expect(toDegrees(circularMedoid([toRadians(359), toRadians(1), toRadians(1)]))).toBeCloseTo(
      1,
      9
    );
  });
  it('the combined angular value does not depend on source order', () => {
    const angular = { ...base, kind: 'angular' as const };
    const forward = combine([s('a', toRadians(10)), s('b', toRadians(50))], angular)
      .value as number;
    const reverse = combine([s('b', toRadians(50)), s('a', toRadians(10))], angular)
      .value as number;
    expect(forward).toBe(reverse);
  });
  it('the combined longitude does not depend on source order', () => {
    const position = { ...base, kind: 'position' as const };
    const a: LatLon = { latitude: 50, longitude: -1 };
    const b: LatLon = { latitude: 50, longitude: -1.0002 };
    const forward = combine([s('a', a), s('b', b)], position).value as LatLon;
    const reverse = combine([s('b', b), s('a', a)], position).value as LatLon;
    expect(forward).toEqual(reverse);
  });
});
