// test/registry.test.ts
import { describe, expect, it } from 'vitest';
import { Registry } from '../src/registry';
import { fakeClock } from './helpers';

describe('Registry', () => {
  it('returns fresh samples within the staleness window', () => {
    const c = fakeClock(0);
    const r = new Registry(c, 16);
    r.update('p', 'a', 1, 0);
    r.update('p', 'b', 2, 0);
    c.set(500);
    expect(
      r
        .fresh('p', 1000)
        .map((s) => s.sourceRef)
        .sort()
    ).toEqual(['a', 'b']);
    expect(r.fresh('p', 1000)[0]?.receiptTs).toBe(0);
  });
  it('drops a stale source', () => {
    const c = fakeClock(0);
    const r = new Registry(c, 16);
    r.update('p', 'a', 1, 0);
    r.update('p', 'b', 2, 900);
    c.set(1000);
    expect(r.fresh('p', 1000).map((s) => s.sourceRef)).toEqual(['b']);
  });
  it('caps tracked sources, evicting the oldest', () => {
    const c = fakeClock(0);
    const r = new Registry(c, 2);
    r.update('p', 'a', 1, 0);
    r.update('p', 'b', 2, 1);
    r.update('p', 'c', 3, 2);
    c.set(2);
    const refs = r
      .fresh('p', 1000)
      .map((s) => s.sourceRef)
      .sort();
    expect(refs).toEqual(['b', 'c']);
  });
  it('reset clears everything', () => {
    const c = fakeClock(0);
    const r = new Registry(c, 16);
    r.update('p', 'a', 1, 0);
    r.reset();
    expect(r.fresh('p', 1000)).toEqual([]);
  });
  it('updating an existing sourceRef at capacity does not evict any source', () => {
    const c = fakeClock(0);
    const r = new Registry(c, 2);
    r.update('p', 'a', 1, 0);
    r.update('p', 'b', 2, 1);
    // Update 'a' again while at cap=2: the !has(sourceRef) guard prevents eviction
    r.update('p', 'a', 99, 2);
    c.set(2);
    const refs = r
      .fresh('p', 1000)
      .map((s) => s.sourceRef)
      .sort();
    expect(refs).toEqual(['a', 'b']);
  });
  it('fresh() on a never-updated path returns []', () => {
    const c = fakeClock(0);
    const r = new Registry(c, 16);
    expect(r.fresh('p', 1000)).toEqual([]);
  });
  it('removes one source without disturbing the others', () => {
    const c = fakeClock(0);
    const r = new Registry(c, 16);
    r.update('p', 'a', 1, 0);
    r.update('p', 'b', 2, 0);
    r.remove('p', 'a');
    expect(r.fresh('p', 1000).map((sample) => sample.sourceRef)).toEqual(['b']);
    r.remove('p', 'missing');
    expect(r.fresh('p', 1000).map((sample) => sample.sourceRef)).toEqual(['b']);
  });
  it('setMaxSourcesPerPath takes effect on subsequent updates', () => {
    const c = fakeClock(0);
    const r = new Registry(c, 16);
    r.setMaxSourcesPerPath(2);
    r.update('p', 'a', 1, 10);
    r.update('p', 'b', 2, 20);
    r.update('p', 'c', 3, 30);
    c.set(30);
    const refs = r
      .fresh('p', 1000)
      .map((s) => s.sourceRef)
      .sort();
    expect(refs).toEqual(['b', 'c']);
  });
  it('setMaxSourcesPerPath immediately trims existing paths', () => {
    const c = fakeClock(30);
    const r = new Registry(c, 3);
    r.update('p', 'a', 1, 10);
    r.update('p', 'b', 2, 20);
    r.update('p', 'c', 3, 30);
    r.setMaxSourcesPerPath(2);
    expect(r.fresh('p', 1000).map((sample) => sample.sourceRef)).toEqual(['b', 'c']);
  });
});

describe('Registry ordering and reporting cadence', () => {
  it('returns fresh readings ordered by source reference, not by arrival', () => {
    const c = fakeClock(0);
    const r = new Registry(c, 16);
    r.update('p', 'zulu', 1, 0);
    r.update('p', 'alpha', 2, 0);
    r.update('p', 'mike', 3, 0);
    expect(r.fresh('p', 1000).map((s) => s.sourceRef)).toEqual(['alpha', 'mike', 'zulu']);
  });

  it('reports the median gap between reports once a source has reported twice', () => {
    const c = fakeClock(0);
    const r = new Registry(c, 16);
    expect(r.medianReportIntervalMs('p')).toBeUndefined();
    r.update('p', 'a', 1, 0);
    expect(r.medianReportIntervalMs('p')).toBeUndefined();
    for (let i = 1; i <= 4; i++) r.update('p', 'a', 1, i * 2000);
    expect(r.medianReportIntervalMs('p')).toBe(2000);
  });

  it('has no interval for an unknown path', () => {
    expect(new Registry(fakeClock(0), 16).medianReportIntervalMs('nope')).toBeUndefined();
  });
});
