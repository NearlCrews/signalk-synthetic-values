import { describe, expect, it } from 'vitest';
import { systemClock } from '../src/clock';

describe('systemClock', () => {
  it('returns a number close to Date.now()', () => {
    const before = Date.now();
    const t = systemClock.now();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThan(before + 1000);
  });
});
