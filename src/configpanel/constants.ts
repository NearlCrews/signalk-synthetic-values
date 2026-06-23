// The set of path kinds that can be meaningfully combined. 'other' is excluded
// because the plugin cannot average text or non-numeric objects. 'unknown'
// is included: classification resolves on the first live value, and combining
// is allowed in advance.
export const COMBINABLE_KINDS: ReadonlySet<string> = new Set([
  'position',
  'angular',
  'scalar',
  'unknown',
]);

export function isCombinableKind(kind: string): boolean {
  return COMBINABLE_KINDS.has(kind);
}
