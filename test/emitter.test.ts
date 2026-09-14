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
    e.emit('environment.depth.belowTransducer', 4.2);
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
    e.emit('p', 1);
    c.set(500);
    expect(e.due('p', 1000)).toBe(false);
    c.set(1000);
    expect(e.due('p', 1000)).toBe(true);
    e.emit('p', 3);
    expect(vi.mocked(app.handleMessage).mock.calls).toHaveLength(2);
    expect(sentDelta(app, 1).updates[0].values[0].value).toBe(3);
  });
  it('emits a position value object', () => {
    const app: EmitApp = { handleMessage: vi.fn() };
    const e = new Emitter(app, 'sv', fakeClock(0));
    e.emit('navigation.position', { latitude: 1, longitude: 2 });
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
    e.emit('p', 1);
    c.set(500);
    expect(e.due('p', 1000)).toBe(false);
    e.reset();
    expect(e.due('p', 1000)).toBe(true);
  });
  it('does not rate-limit a retry after handleMessage throws', () => {
    const app: EmitApp = {
      handleMessage: vi.fn(() => {
        throw new Error('send failed');
      }),
    };
    const e = new Emitter(app, 'sv', fakeClock(0));
    expect(() => e.emit('p', 1)).toThrow('send failed');
    expect(e.due('p', 1000)).toBe(true);
  });
});

describe('Emitter notifications', () => {
  const app = (): EmitApp => ({ handleMessage: vi.fn() });
  const calls = (a: EmitApp): number => vi.mocked(a.handleMessage).mock.calls.length;

  it('publishes notifications.<path> with a visual method for an alert', () => {
    const a = app();
    new Emitter(a, 'sv', fakeClock(0)).notify(
      'environment.depth.belowKeel',
      'alert',
      'Sources diverge.'
    );
    expect(sentDelta(a)).toEqual({
      updates: [
        {
          $source: 'sv',
          values: [
            {
              path: 'notifications.environment.depth.belowKeel',
              value: { state: 'alert', method: ['visual'], message: 'Sources diverge.' },
            },
          ],
        },
      ],
    });
  });

  it('never asks for sound, because a data-quality problem is not an alarm', () => {
    const a = app();
    const e = new Emitter(a, 'sv', fakeClock(0));
    e.notify('p', 'alert', 'a');
    e.notify('p', 'warn', 'b');
    for (let i = 0; i < calls(a); i++) {
      const value = sentDelta(a, i).updates[0].values[0].value as { method: string[] };
      expect(value.method).not.toContain('sound');
    }
  });

  it('repeats nothing: only a change of state or message reaches the bus', () => {
    const a = app();
    const e = new Emitter(a, 'sv', fakeClock(0));
    e.notify('p', 'warn', 'same');
    e.notify('p', 'warn', 'same');
    expect(calls(a)).toBe(1);
    e.notify('p', 'normal', 'clear');
    expect(calls(a)).toBe(2);
  });

  it('does not open with a clear for a path that was never flagged', () => {
    const a = app();
    new Emitter(a, 'sv', fakeClock(0)).notify('p', 'normal', 'Combining normally.');
    expect(calls(a)).toBe(0);
  });

  it('reset forgets what was published, so a restart re-announces', () => {
    const a = app();
    const e = new Emitter(a, 'sv', fakeClock(0));
    e.notify('p', 'warn', 'same');
    e.reset();
    e.notify('p', 'warn', 'same');
    expect(calls(a)).toBe(2);
  });
});
