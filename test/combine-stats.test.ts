import { describe, expect, it } from 'vitest';
import { circularMeanRad, maxCircularSpread, mean, median, trimmedMean } from '../src/combine';

describe('median', () => {
  it('odd length', () => expect(median([3, 1, 2])).toBe(2));
  it('even length averages the middle two', () => expect(median([1, 2, 3, 4])).toBe(2.5));
  it('does not overflow finite same-sign values', () => {
    expect(median([Number.MAX_VALUE, Number.MAX_VALUE])).toBe(Number.MAX_VALUE);
  });
});

describe('mean', () => {
  it('arithmetic mean', () => expect(mean([1, 2, 3])).toBe(2));
  it('does not overflow finite same-sign values', () => {
    expect(mean([Number.MAX_VALUE, Number.MAX_VALUE])).toBe(Number.MAX_VALUE);
  });
  it('retains a small residual through cancellation', () => {
    expect(mean([Number.MAX_SAFE_INTEGER, 1, -Number.MAX_SAFE_INTEGER])).toBeCloseTo(1 / 3, 12);
  });
});

describe('trimmedMean small N flooring', () => {
  it('N=2 floors to mean', () => expect(trimmedMean([0, 10], 0.25)).toBe(5));
  it('N=3 trims nothing, equals mean', () =>
    expect(trimmedMean([0, 1, 50], 0.25)).toBeCloseTo(17, 6));
  it('N=4 trims one each end, means middle two', () =>
    expect(trimmedMean([0, 10, 12, 100], 0.25)).toBe(11));
  it('trimFraction=0 degenerates to mean', () =>
    expect(trimmedMean([1, 2, 3, 4], 0)).toBe(mean([1, 2, 3, 4])));
  it('an out-of-range trimFraction on a direct call falls back to the full mean', () => {
    // validateConfig keeps trimFraction inside [0, 0.5) for the app, so this
    // guards direct callers of the exported helper only.
    expect(trimmedMean([1, 2, 100], 0.6)).toBe(mean([1, 2, 100]));
    expect(trimmedMean([1, 2, 100], -0.1)).toBe(mean([1, 2, 100]));
  });
});

describe('circularMeanRad', () => {
  it('cluster around 135 degrees averages there (not the swapped 45)', () => {
    const a = (135 * Math.PI) / 180;
    const r = circularMeanRad([a - 0.02, a, a + 0.02]);
    expect((r.mean * 180) / Math.PI).toBeCloseTo(135, 4);
    expect(r.R).toBeGreaterThan(0.99);
  });
  it('north cluster across the 0 wrap', () => {
    const r = circularMeanRad([0.01, 2 * Math.PI - 0.01]);
    const deg = (r.mean * 180) / Math.PI;
    expect(Math.min(deg, 360 - deg)).toBeLessThan(1);
  });
  it('antipodal pair collapses R to near zero', () => {
    const r = circularMeanRad([0, Math.PI]);
    expect(r.R).toBeLessThan(1e-6);
  });
  it('mean is normalized into [0, 2pi)', () => {
    const r = circularMeanRad([2 * Math.PI - 0.1, 2 * Math.PI - 0.2]);
    expect(r.mean).toBeGreaterThanOrEqual(0);
    expect(r.mean).toBeLessThan(2 * Math.PI);
  });
});

describe('maxCircularSpread', () => {
  it('north fan 0,90,180 has a spread of pi', () => {
    expect(maxCircularSpread([0, Math.PI / 2, Math.PI])).toBeCloseTo(Math.PI, 9);
  });
  it('tight cluster 0,5,355 degrees has a small spread', () => {
    const d = (x: number) => (x * Math.PI) / 180;
    expect(maxCircularSpread([d(0), d(5), d(355)])).toBeLessThan(d(11));
  });
});

describe('normalize2pi boundary', () => {
  it('a pair straddling north means to 0, never to exactly 2pi', () => {
    const d = (deg: number) => (deg * Math.PI) / 180;
    const r = circularMeanRad([d(359.9), d(0.1)]);
    expect(r.mean).not.toBe(2 * Math.PI);
    expect(r.mean).toBeGreaterThanOrEqual(0);
    expect(r.mean).toBeLessThan(2 * Math.PI);
    expect(r.mean).toBe(0);
  });
  it('a tiny negative resultant lands on 0 rather than a full turn', () => {
    for (const angles of [
      [-1e-17, 1e-17],
      [2 * Math.PI - 1e-9, 1e-9],
    ]) {
      const mean = circularMeanRad(angles).mean;
      expect(mean).toBeGreaterThanOrEqual(0);
      expect(mean).toBeLessThan(2 * Math.PI);
    }
  });
});

describe('empty input', () => {
  it('mean and median agree on the illegal empty array', () => {
    expect(mean([])).toBeNaN();
    expect(median([])).toBeNaN();
  });
});
