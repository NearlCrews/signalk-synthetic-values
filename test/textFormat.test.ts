import { describe, expect, it } from 'vitest';
import { oxfordJoin } from '../src/textFormat';

describe('oxfordJoin', () => {
  it('returns an empty string for no items', () => {
    expect(oxfordJoin([])).toBe('');
  });
  it('returns the sole item unchanged', () => {
    expect(oxfordJoin(['a'])).toBe('a');
  });
  it('joins two items with "and", no comma', () => {
    expect(oxfordJoin(['a', 'b'])).toBe('a and b');
  });
  it('uses the serial comma for three or more items', () => {
    expect(oxfordJoin(['a', 'b', 'c'])).toBe('a, b, and c');
    expect(oxfordJoin(['a', 'b', 'c', 'd'])).toBe('a, b, c, and d');
  });
});
