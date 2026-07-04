import { describe, expect, it, vi } from 'vitest';
import { type EmitApp, Emitter } from '../src/emitter';
import { fakeClock } from './helpers';

interface EmittedDelta {
  context?: unknown;
  updates: { $source: string; timestamp?: unknown; values: { path: string; value: unknown }[] }[];
}

// The EmitApp mock is always a vi.fn; this narrows a recorded call's delta.
function sentDelta(app: EmitApp, call = 0): EmittedDelta {
  return vi.mocked(app.handleMessage).mock.calls[call]?.[1] as EmittedDelta;
}

describe('Emitter', () => {
  it('emits a scalar delta with $source set as a bare string', () => {
    const app: EmitApp = { handleMessage: vi.fn() };
    const e = new Emitter(app, 'signalk-synthetic-values', fakeClock(0));
    expect(e.due('environment.depth.belowTransducer', 1000)).toBe(true);
    e.emit('environment.depth.belowTransducer', 4.2, 'signalk-synthetic-values');
    const delta = sentDelta(app);
    expect(delta.updates[0].$source).toBe('signalk-synthetic-values');
    expect(delta.updates[0].timestamp).toBeUndefined();
    expect(delta.context).toBeUndefined();
    expect(delta.updates[0].values[0]).toEqual({
      path: 'environment.depth.belowTransducer',
      value: 4.2,
    });
  });
  it('rate-limits within the interval', () => {
    const app: EmitApp = { handleMessage: vi.fn() };
    const c = fakeClock(0);
    const e = new Emitter(app, 'sv', c);
    expect(e.due('p', 1000)).toBe(true);
    e.emit('p', 1, 'sv');
    c.set(500);
    expect(e.due('p', 1000)).toBe(false);
    c.set(1000);
    expect(e.due('p', 1000)).toBe(true);
    e.emit('p', 3, 'sv');
    expect(vi.mocked(app.handleMessage).mock.calls).toHaveLength(2);
    expect(sentDelta(app, 1).updates[0].values[0].value).toBe(3);
  });
  it('emits a position value object', () => {
    const app: EmitApp = { handleMessage: vi.fn() };
    const e = new Emitter(app, 'sv', fakeClock(0));
    e.emit('navigation.position', { latitude: 1, longitude: 2 }, 'sv');
    const delta = sentDelta(app);
    expect(delta.updates[0].values[0].value).toEqual({ latitude: 1, longitude: 2 });
    expect(delta.updates[0].$source).toBe('sv');
    expect(delta.updates[0].timestamp).toBeUndefined();
    expect(delta.context).toBeUndefined();
  });
});

describe('Emitter reset', () => {
  it('reset() clears rate-limit state so the next due() is true again', () => {
    const app: EmitApp = { handleMessage: vi.fn() };
    const c = fakeClock(0);
    const e = new Emitter(app, 'sv', c);
    e.emit('p', 1, 'sv');
    c.set(500);
    expect(e.due('p', 1000)).toBe(false);
    e.reset();
    expect(e.due('p', 1000)).toBe(true);
  });
});
