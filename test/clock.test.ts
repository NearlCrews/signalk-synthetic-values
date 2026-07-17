import { describe, expect, it } from 'vitest';
import { systemClock } from '../src/clock';

describe('systemClock', () => {
  it('uses the monotonic performance clock', () => {
    const before = performance.now();
    const t = systemClock.now();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThan(before + 1000);
  });
});
