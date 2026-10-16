/** A plain object: not null and not an array. Shared by the runtime and the panel. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
