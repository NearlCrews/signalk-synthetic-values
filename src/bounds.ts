// The limits on every number a configuration may carry, in one table, so the
// validator, the JSON schema, and the panel's number fields read the same bound
// instead of each restating it. Imports nothing, so the combiner, the config
// module, and the browser bundle can all depend on it without a cycle.

export interface NumberBounds {
  readonly min: number;
  /** The minimum itself is out of range. */
  readonly exclusiveMin?: true;
  readonly max?: number;
  /** The maximum itself is out of range. */
  readonly exclusiveMax?: true;
  readonly integer?: true;
}

export const MAX_SOURCES_PER_PATH = 64;

const POSITIVE: NumberBounds = { min: 0, exclusiveMin: true };
const NON_NEGATIVE: NumberBounds = { min: 0 };
const POSITIVE_INTEGER: NumberBounds = { min: 1, integer: true };

export const BOUNDS = {
  trimFraction: { min: 0, max: 0.5, exclusiveMax: true },
  stalenessTimeoutMs: POSITIVE,
  emitMinIntervalMs: NON_NEGATIVE,
  minSources: POSITIVE_INTEGER,
  madThreshold: POSITIVE,
  rejectThreshold: POSITIVE,
  disagreeThreshold: POSITIVE,
  angularSpreadThreshold: POSITIVE,
  slewLimit: POSITIVE,
  maxRate: POSITIVE,
  persistSamples: POSITIVE_INTEGER,
  persistMs: NON_NEGATIVE,
  maxSourcesPerPath: { min: 1, max: MAX_SOURCES_PER_PATH, integer: true },
} as const satisfies Record<string, NumberBounds>;

export function inBounds(value: unknown, bounds: NumberBounds): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (bounds.integer && !Number.isInteger(value)) return false;
  if (bounds.exclusiveMin ? value <= bounds.min : value < bounds.min) return false;
  if (bounds.max === undefined) return true;
  return bounds.exclusiveMax ? value < bounds.max : value <= bounds.max;
}

/** The bound in words, completing "must be": "a positive number", "in [0, 0.5)". */
export function describeBounds(bounds: NumberBounds): string {
  if (bounds.max !== undefined) {
    if (bounds.integer) return `an integer from ${bounds.min} to ${bounds.max}`;
    const open = bounds.exclusiveMin ? '(' : '[';
    const close = bounds.exclusiveMax ? ')' : ']';
    return `in ${open}${bounds.min}, ${bounds.max}${close}`;
  }
  if (bounds.integer)
    return bounds.min === 1 ? 'a positive integer' : `an integer of at least ${bounds.min}`;
  if (bounds.min === 0) return bounds.exclusiveMin ? 'a positive number' : 'a non-negative number';
  return `${bounds.exclusiveMin ? 'greater than' : 'at least'} ${bounds.min}`;
}

/** The JSON schema keywords that express the bound. */
export function schemaBounds(bounds: NumberBounds): Record<string, number | string> {
  return {
    type: bounds.integer ? 'integer' : 'number',
    [bounds.exclusiveMin ? 'exclusiveMinimum' : 'minimum']: bounds.min,
    ...(bounds.max === undefined
      ? {}
      : { [bounds.exclusiveMax ? 'exclusiveMaximum' : 'maximum']: bounds.max }),
  };
}
