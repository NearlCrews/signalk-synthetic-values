import { describe, expect, it } from 'vitest';
import {
  BOUNDS,
  describeBounds,
  inBounds,
  MAX_SOURCES_PER_PATH,
  schemaBounds,
} from '../src/bounds';

describe('inBounds', () => {
  it('rejects anything that is not a finite number', () => {
    for (const value of [undefined, null, '1', Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(inBounds(value, BOUNDS.slewLimit), String(value)).toBe(false);
    }
  });
  it('honors exclusive and inclusive ends', () => {
    expect(inBounds(0, BOUNDS.slewLimit)).toBe(false);
    expect(inBounds(0, BOUNDS.emitMinIntervalMs)).toBe(true);
    expect(inBounds(0.5, BOUNDS.trimFraction)).toBe(false);
    expect(inBounds(0.49, BOUNDS.trimFraction)).toBe(true);
    expect(inBounds(MAX_SOURCES_PER_PATH, BOUNDS.maxSourcesPerPath)).toBe(true);
    expect(inBounds(MAX_SOURCES_PER_PATH + 1, BOUNDS.maxSourcesPerPath)).toBe(false);
  });
  it('requires an integer where the bound says so', () => {
    expect(inBounds(2.5, BOUNDS.minSources)).toBe(false);
    expect(inBounds(2, BOUNDS.minSources)).toBe(true);
  });
});

describe('describeBounds', () => {
  it('words each kind of bound', () => {
    expect(describeBounds(BOUNDS.slewLimit)).toBe('a positive number');
    expect(describeBounds(BOUNDS.emitMinIntervalMs)).toBe('a non-negative number');
    expect(describeBounds(BOUNDS.minSources)).toBe('a positive integer');
    expect(describeBounds(BOUNDS.trimFraction)).toBe('in [0, 0.5)');
    expect(describeBounds(BOUNDS.maxSourcesPerPath)).toBe(
      `an integer from 1 to ${MAX_SOURCES_PER_PATH}`
    );
  });
});

describe('schemaBounds', () => {
  it('maps a bound to the JSON schema keywords', () => {
    expect(schemaBounds(BOUNDS.slewLimit)).toEqual({ type: 'number', exclusiveMinimum: 0 });
    expect(schemaBounds(BOUNDS.trimFraction)).toEqual({
      type: 'number',
      minimum: 0,
      exclusiveMaximum: 0.5,
    });
    expect(schemaBounds(BOUNDS.minSources)).toEqual({ type: 'integer', minimum: 1 });
  });
});
