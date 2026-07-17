import { describe, expect, it } from 'vitest';
import { oldestKey } from '../src/mapUtil';

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
