import { vi } from 'vitest';
import type { Clock } from '../src/clock';
import type { EmitApp } from '../src/emitter';

export function fakeClock(start = 0): Clock & { set: (t: number) => void } {
  let t = start;
  return { now: () => t, set: (n: number) => (t = n) };
}

/** An emitter host that records every message it is handed. */
export function fakeEmitApp(): EmitApp {
  return { handleMessage: vi.fn() };
}
