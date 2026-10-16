import { describe, expect, it } from 'vitest';
import { deleteOldest, oldestKey } from '../src/mapUtil';

describe('oldestKey', () => {
  it('returns undefined for an empty map', () => {
    expect(oldestKey(new Map(), (value: number) => value)).toBeUndefined();
  });

  it('returns the first oldest key, including an infinite timestamp', () => {
    expect(oldestKey(new Map([['a', Number.POSITIVE_INFINITY]]), (value) => value)).toBe('a');
    expect(
      oldestKey(
        new Map([
          ['a', 2],
          ['b', 1],
          ['c', 1],
        ]),
        (value) => value
      )
    ).toBe('b');
  });
});

describe('deleteOldest', () => {
  it('removes the entry with the smallest timestamp and reports it', () => {
    const map = new Map([
      ['a', 2],
      ['b', 1],
    ]);
    expect(deleteOldest(map, (value) => value)).toBe(true);
    expect([...map.keys()]).toEqual(['a']);
  });

  it('reports false for an empty map', () => {
    expect(deleteOldest(new Map<string, number>(), (value) => value)).toBe(false);
  });
});
