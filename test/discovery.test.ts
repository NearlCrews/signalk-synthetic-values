import { describe, expect, it } from 'vitest';
import { Discovery } from '../src/discovery';
import { fakeClock } from './helpers';

describe('Discovery', () => {
  it('reports a path only once it has two or more sources', () => {
    const d = new Discovery(fakeClock());
    d.observe('p', 'a');
    expect(d.detected()).toEqual([]);
    d.observe('p', 'b');
    d.observe('p', 'b');
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
});
