import { describe, expect, it, vi } from 'vitest';
import { type EmitApp, Emitter } from '../src/emitter';
import { fakeClock } from './helpers';

describe('Emitter', () => {
  it('emits a scalar delta with $source set as a bare string', () => {
    const app: EmitApp = { handleMessage: vi.fn() };
    const e = new Emitter(app, 'signalk-synthetic-values', fakeClock(0));
    expect(e.due('environment.depth.belowTransducer', 1000)).toBe(true);
    e.emit('environment.depth.belowTransducer', 4.2, 'signalk-synthetic-values');
    const delta: any = (app.handleMessage as any).mock.calls[0][1];
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
    const calls = (app.handleMessage as any).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1][1].updates[0].values[0].value).toBe(3);
  });
  it('emits a position value object', () => {
    const app: EmitApp = { handleMessage: vi.fn() };
    const e = new Emitter(app, 'sv', fakeClock(0));
    e.emit('navigation.position', { latitude: 1, longitude: 2 }, 'sv');
    const delta: any = (app.handleMessage as any).mock.calls[0][1];
    expect(delta.updates[0].values[0].value).toEqual({ latitude: 1, longitude: 2 });
    expect(delta.updates[0].$source).toBe('sv');
    expect(delta.updates[0].timestamp).toBeUndefined();
    expect(delta.context).toBeUndefined();
  });
});

function makeEmitter() {
  const app: EmitApp = { handleMessage: vi.fn() };
  const c = fakeClock(0);
  const e = new Emitter(app, 'sv', c);
  return { app, c, e };
}

describe('Emitter due() and emit()', () => {
  it('due() returns true on first call', () => {
    const { e } = makeEmitter();
    expect(e.due('p', 1000)).toBe(true);
  });
  it('due() returns false within the interval after emit()', () => {
    const { c, e } = makeEmitter();
    e.emit('p', 1, 'sv');
    c.set(500);
    expect(e.due('p', 1000)).toBe(false);
  });
  it('due() returns true at exactly the interval boundary', () => {
    const { c, e } = makeEmitter();
    e.emit('p', 1, 'sv');
    c.set(1000);
    expect(e.due('p', 1000)).toBe(true);
  });
  it('emit() records lastEmit and calls handleMessage with bare $source', () => {
    const { app, e } = makeEmitter();
    e.emit('q', 42, 'sv');
    const delta: any = (app.handleMessage as any).mock.calls[0][1];
    expect(delta.updates[0].$source).toBe('sv');
    expect(delta.updates[0].timestamp).toBeUndefined();
    expect(delta.context).toBeUndefined();
    expect(delta.updates[0].values[0]).toEqual({ path: 'q', value: 42 });
  });
  it('reset() clears rate-limit state so the next due() is true again', () => {
    const { c, e } = makeEmitter();
    e.emit('p', 1, 'sv');
    c.set(500);
    expect(e.due('p', 1000)).toBe(false);
    e.reset();
    expect(e.due('p', 1000)).toBe(true);
  });
});
