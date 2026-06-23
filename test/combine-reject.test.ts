// test/combine-reject.test.ts
import { describe, expect, it } from 'vitest';
import { rejectMask, robustCenter } from '../src/combine';
import type { LatLon } from '../src/metrics';

describe('robustCenter', () => {
  it('scalar center is the median', () => {
    expect(robustCenter('scalar', [1, 2, 100])).toBe(2);
  });
  it('position center is component median (lat) and circular mean (lon)', () => {
    const c = robustCenter('position', [
      { latitude: 10, longitude: 20 },
      { latitude: 10.0001, longitude: 20.0001 },
      { latitude: 9.9999, longitude: 19.9999 },
    ]) as LatLon;
    expect(c.latitude).toBeCloseTo(10, 3);
    expect(c.longitude).toBeCloseTo(20, 3);
  });
});

describe('rejectMask', () => {
  it('keeps all below N=4 without a rejectThreshold', () => {
    expect(rejectMask('scalar', [0, 100], 3)).toEqual([true, true]);
    expect(rejectMask('scalar', [0, 1, 100], 3)).toEqual([true, true, true]);
  });
  it('applies an absolute rejectThreshold below N=4', () => {
    expect(rejectMask('scalar', [0, 1, 100], 3, 10)).toEqual([true, true, false]);
  });
  it('applies rejectThreshold at N=2 (non-MAD branch)', () => {
    // N=2 < 4, MAD path never runs; rejectThreshold gates each point by distance from center.
    // center of [0, 200] is median = 100; distances are 100 each; threshold 50 rejects both.
    expect(rejectMask('scalar', [0, 200], 3, 50)).toEqual([false, false]);
    // threshold 150 keeps both
    expect(rejectMask('scalar', [0, 200], 3, 150)).toEqual([true, true]);
  });
  it('rejects a gross outlier at N=4 with non-identical inliers', () => {
    expect(rejectMask('scalar', [0, 0.1, -0.1, 100], 3)).toEqual([true, true, true, false]);
  });
  it('rejects a gross outlier at N=4 even when inliers are bit-identical (MAD=0 fallback)', () => {
    expect(rejectMask('scalar', [0, 0, 0, 100], 3)).toEqual([true, true, true, false]);
  });
  it('rejects a whole position source by geodesic distance', () => {
    const tight: LatLon = { latitude: 10, longitude: 20 };
    const near1: LatLon = { latitude: 10.00001, longitude: 20.00001 };
    const near2: LatLon = { latitude: 9.99999, longitude: 19.99999 };
    const far: LatLon = { latitude: 11, longitude: 21 };
    expect(rejectMask('position', [tight, near1, near2, far], 3)).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });
});
