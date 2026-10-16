import { describe, expect, it } from 'vitest';
import { DISCOVERY_SOURCE_TIMEOUT_MS, Discovery } from '../src/discovery';
import { fakeClock } from './helpers';

describe('Discovery', () => {
  it('reports a path only once it has two or more sources', () => {
    const d = new Discovery(fakeClock());
    // A lone source changes nothing the detected list shows.
    expect(d.observe('p', 'a')).toBe(false);
    expect(d.detected()).toEqual([]);
    expect(d.observe('p', 'b')).toBe(true);
    expect(d.observe('p', 'b')).toBe(false);
    expect(d.detected()).toEqual([{ path: 'p', sources: ['a', 'b'], duplicateGroups: [] }]);
  });
  it('reset clears state', () => {
    const d = new Discovery(fakeClock());
    d.observe('p', 'a');
    d.observe('p', 'b');
    d.reset();
    expect(d.detected()).toEqual([]);
  });
  it('count returns the number of multi-source paths without analysis', () => {
    const d = new Discovery(fakeClock());
    d.observe('p', 'a');
    expect(d.count()).toBe(0);
    d.observe('p', 'b');
    d.observe('q', 'a');
    d.observe('q', 'b');
    expect(d.count()).toBe(2);
  });
  it('expires sources that have stopped reporting', () => {
    const c = fakeClock(0);
    const d = new Discovery(c);
    d.observe('p', 'a');
    d.observe('p', 'b');
    c.set(DISCOVERY_SOURCE_TIMEOUT_MS - 1);
    d.observe('p', 'a');
    c.set(DISCOVERY_SOURCE_TIMEOUT_MS);
    expect(d.detected()).toEqual([]);
    expect(d.count()).toBe(0);
  });
});

describe('Discovery duplicate detection', () => {
  it('flags sources reporting identical changing values as a duplicate group', () => {
    const c = fakeClock(0);
    const d = new Discovery(c);
    // Three sources: a and b re-broadcast the same changing value; c differs.
    for (let i = 0; i < 4; i++) {
      c.set(i * 1000);
      d.observe('navigation.speedOverGround', 'a', i);
      d.observe('navigation.speedOverGround', 'b', i);
      d.observe('navigation.speedOverGround', 'c', i + 0.5);
    }
    const row = d.detected()[0];
    expect(row?.duplicateGroups).toHaveLength(1);
    expect(row?.duplicateGroups[0]?.sort()).toEqual(['a', 'b']);
  });
  it('does not flag identical values that never change (at rest)', () => {
    const c = fakeClock(0);
    const d = new Discovery(c);
    for (let i = 0; i < 4; i++) {
      c.set(i * 1000);
      d.observe('navigation.speedOverGround', 'a', 5);
      d.observe('navigation.speedOverGround', 'b', 5);
    }
    expect(d.detected()[0]?.duplicateGroups).toEqual([]);
  });
  it('does not flag independent sources that move differently', () => {
    const c = fakeClock(0);
    const d = new Discovery(c);
    for (let i = 0; i < 4; i++) {
      c.set(i * 1000);
      d.observe('navigation.speedOverGround', 'a', i);
      d.observe('navigation.speedOverGround', 'b', i + 0.01);
    }
    expect(d.detected()[0]?.duplicateGroups).toEqual([]);
  });
  it('does not group a varying source with a static source that happens to match', () => {
    const c = fakeClock(0);
    const d = new Discovery(c);
    for (let i = 0; i < 4; i++) {
      c.set(i * 1000);
      d.observe('p', 'varying', i < 3 ? i : 5);
      d.observe('p', 'static', 5);
    }
    expect(d.detected()[0]?.duplicateGroups).toEqual([]);
  });
  it('clears duplicate history when a source becomes non-combinable', () => {
    const c = fakeClock(0);
    const d = new Discovery(c);
    for (let i = 0; i < 3; i++) {
      c.set(i * 1000);
      d.observe('p', 'a', i);
      d.observe('p', 'b', i);
    }
    expect(d.detected()[0]?.duplicateGroups).toEqual([['a', 'b']]);
    c.set(3000);
    d.observe('p', 'a', undefined, 'other');
    expect(d.detected()[0]?.duplicateGroups).toEqual([]);
    expect(d.detected()[0]?.kind).toBe('other');
    expect(d.kind('p')).toBe('other');
  });
});

describe('Discovery bounded store', () => {
  it('evicts the least-recently-seen path when over the cap', () => {
    const c = fakeClock(0);
    const d = new Discovery(c, 2);
    d.observe('a', 's1');
    d.observe('a', 's2'); // a detected, seen at 0
    c.set(10);
    d.observe('b', 's1');
    d.observe('b', 's2'); // b detected, seen at 10
    c.set(20);
    d.observe('c', 's1');
    d.observe('c', 's2'); // c added, a is oldest, evicted
    const paths = d
      .detected()
      .map((p) => p.path)
      .sort();
    expect(paths).toEqual(['b', 'c']);
  });
  it('updates last-seen so a refreshed path is not the eviction target', () => {
    const c = fakeClock(0);
    const d = new Discovery(c, 2);
    d.observe('a', 's1');
    d.observe('a', 's2');
    c.set(10);
    d.observe('b', 's1');
    d.observe('b', 's2');
    c.set(20);
    d.observe('a', 's3'); // a refreshed, now newer than b
    c.set(30);
    d.observe('c', 's1');
    d.observe('c', 's2'); // b is oldest, evicted
    const paths = d
      .detected()
      .map((p) => p.path)
      .sort();
    expect(paths).toEqual(['a', 'c']);
  });
  it('evicts an older single-source path before a combinable path', () => {
    const c = fakeClock(0);
    const d = new Discovery(c, 2);
    d.observe('combinable', 's1');
    d.observe('combinable', 's2');
    c.set(10);
    d.observe('single', 's1');
    c.set(20);
    d.observe('new-combinable', 's1');
    d.observe('new-combinable', 's2');

    expect(
      d
        .detected()
        .map((path) => path.path)
        .sort()
    ).toEqual(['combinable', 'new-combinable']);
  });
  it('caps sources per path and evicts the least recently seen source', () => {
    const c = fakeClock(0);
    const d = new Discovery(c, 200, 2);
    d.observe('p', 'a');
    c.set(10);
    d.observe('p', 'b');
    c.set(20);
    d.observe('p', 'c');
    expect(d.detected()[0]?.sources).toEqual(['b', 'c']);
  });
  it('trims existing source sets when the cap decreases', () => {
    const c = fakeClock(0);
    const d = new Discovery(c, 200, 3);
    d.observe('p', 'a');
    c.set(10);
    d.observe('p', 'b');
    c.set(20);
    d.observe('p', 'c');
    d.setMaxSourcesPerPath(2);
    expect(d.detected()[0]?.sources).toEqual(['b', 'c']);
  });
});

describe('Discovery duplicate detection across the window', () => {
  it('catches a re-broadcast that lags behind its origin', () => {
    const c = fakeClock(0);
    const d = new Discovery(c);
    for (let i = 0; i < 6; i++) {
      c.set(i * 1000);
      d.observe('p', 'origin', 10 + i);
      // The repeat is two sampling intervals behind, so the newest values never match.
      d.observe('p', 'repeat', 10 + Math.max(0, i - 2));
      d.observe('p', 'independent', 10 + i + 0.017);
    }
    expect(d.duplicateGroupsFor('p')).toEqual([['origin', 'repeat']]);
  });

  it('needs more than one shared value, so a single coincidence is not a group', () => {
    const c = fakeClock(0);
    const d = new Discovery(c);
    const a = [1, 2, 3, 4];
    const b = [9, 8, 3, 7];
    for (let i = 0; i < a.length; i++) {
      c.set(i * 1000);
      d.observe('p', 'a', a[i]);
      d.observe('p', 'b', b[i]);
    }
    expect(d.duplicateGroupsFor('p')).toEqual([]);
  });

  it('unions a feed re-broadcast twice into one group', () => {
    const c = fakeClock(0);
    const d = new Discovery(c);
    for (let i = 0; i < 4; i++) {
      c.set(i * 1000);
      for (const src of ['origin', 'gw1', 'gw2']) d.observe('p', src, 10 + i);
    }
    const groups = d.duplicateGroupsFor('p');
    expect(groups).toHaveLength(1);
    expect(groups[0]?.slice().sort()).toEqual(['gw1', 'gw2', 'origin']);
  });

  it('does not group a value quantized on the way round, which stays a documented hazard', () => {
    const c = fakeClock(0);
    const d = new Discovery(c);
    for (let i = 0; i < 6; i++) {
      c.set(i * 1000);
      const v = 1.234567 + i * 0.01;
      d.observe('p', 'compassA', v);
      d.observe('p', 'n2k-echo', Math.round(v / 0.0001) * 0.0001);
    }
    expect(d.duplicateGroupsFor('p')).toEqual([]);
  });

  it('has no groups for an unknown path', () => {
    expect(new Discovery(fakeClock(0)).duplicateGroupsFor('nope')).toEqual([]);
  });
});

describe('Discovery device identity', () => {
  it('groups sources naming one NMEA 2000 device, whatever their values do', () => {
    const d = new Discovery(fakeClock(0));
    d.observe('p', 'canhat.c0788c00e7e04312', 4.1);
    d.observe('p', 'YDEN02.C0788C00E7E04312', 4.2);
    d.observe('p', 'YDEN02.c0788c00e7e04399', 4.3);
    expect(d.duplicateGroupsFor('p')).toEqual([
      ['canhat.c0788c00e7e04312', 'YDEN02.C0788C00E7E04312'],
    ]);
  });
  it('merges a device group and a value group that share a source into one', () => {
    const c = fakeClock(0);
    const d = new Discovery(c);
    // a.x and b.x name one device; c.y and d.y name another; b.x and c.y then
    // report the same changing values, so all four are one feed.
    for (let i = 0; i < 4; i++) {
      c.set(i * 1000);
      d.observe('p', 'a.0000000000000001', 100 + i * 7);
      d.observe('p', 'b.0000000000000001', 10 + i);
      d.observe('p', 'c.0000000000000002', 10 + i);
      d.observe('p', 'd.0000000000000002', 200 + i * 3);
    }
    const groups = d.duplicateGroupsFor('p');
    expect(groups).toHaveLength(1);
    expect(groups[0]?.slice().sort()).toEqual([
      'a.0000000000000001',
      'b.0000000000000001',
      'c.0000000000000002',
      'd.0000000000000002',
    ]);
  });
  it('leaves short suffixes such as N2K addresses and talker ids alone', () => {
    const d = new Discovery(fakeClock(0));
    d.observe('p', 'can0.43', 1);
    d.observe('p', 'can1.43', 2);
    expect(d.duplicateGroupsFor('p')).toEqual([]);
  });
});

describe('Discovery change reporting and eviction', () => {
  it('reports a change only when the multi-source set moves', () => {
    const c = fakeClock(0);
    const d = new Discovery(c, 3);
    d.observe('multi', 'a');
    d.observe('multi', 'b');
    // New single-source paths fill and churn the store without touching the detected set.
    for (const path of ['s1', 's2', 's3', 's4']) {
      c.set(c.now() + 1);
      expect(d.observe(path, 'a')).toBe(false);
    }
    expect(d.detectedPaths()).toEqual(['multi']);
  });
  it('evicts a tenth of the oldest single-source paths once the store is full', () => {
    const c = fakeClock(0);
    const d = new Discovery(c, 21);
    for (let i = 0; i < 21; i++) {
      c.set(i);
      d.observe(`p${i}`, 'a');
    }
    c.set(100);
    d.observe('p0', 'b'); // p0 now has two sources and is protected
    d.observe('new', 'a');
    d.observe('new', 'b');
    // One eviction freed a tenth of the store's capacity, two paths: p1 and p2.
    expect(d.detectedPaths().sort()).toEqual(['new', 'p0']);
    // An evicted path comes back with one source; a kept one gains its second.
    expect(d.observe('p1', 'b')).toBe(false);
    expect(d.observe('p3', 'b')).toBe(true);
  });
});
