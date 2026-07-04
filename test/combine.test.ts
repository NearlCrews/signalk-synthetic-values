// test/combine.test.ts
import { describe, expect, it } from 'vitest';
import { type CombineOptions, circularMedoid, combine, type Sample } from '../src/combine';
import type { LatLon, SampleValue } from '../src/metrics';

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
  const d = (x: number) => (x * Math.PI) / 180;
  it('returns the reading with the least total angular distance', () => {
    expect((circularMedoid([d(4.2), d(9.4), d(9.4)]) * 180) / Math.PI).toBeCloseTo(9.4, 6);
  });
  it('handles the wrap boundary (readings near north)', () => {
    // 359 deg, 1 deg, 1 deg cluster near north; medoid is one of the 1 deg readings.
    const m = (circularMedoid([d(359), d(1), d(1)]) * 180) / Math.PI;
    expect(m).toBeCloseTo(1, 6);
  });
  it('returns the sole reading for a single angle', () => {
    expect(circularMedoid([d(42)])).toBeCloseTo(d(42), 9);
  });
});

describe('combine angular', () => {
  const d = (x: number) => (x * Math.PI) / 180;

  it('uses the circular mean for method=mean', () => {
    const r = combine([s('a', d(0)), s('b', d(10)), s('c', d(350))], {
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
    const r = combine([s('a', d(4.2)), s('b', d(9.4)), s('c', d(9.4))], {
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
  const d = (x: number) => (x * Math.PI) / 180;
  const att = (roll: number, pitch: number, yaw: number) => ({ roll, pitch, yaw });

  it('combines each component, tracking the consensus per axis', () => {
    // Two sources agree on roll/pitch/yaw, one is off on yaw only.
    const r = combine(
      [
        s('a', att(d(2), d(-5), d(90))),
        s('b', att(d(2), d(-5), d(90))),
        s('c', att(d(2), d(-5), d(80))),
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
