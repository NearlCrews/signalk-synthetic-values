// Join a list with the serial (Oxford) comma: "a", "a and b", "a, b, and c".
export function oxfordJoin(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

// Plural suffix for a count: "" for exactly one, "s" otherwise. Used as
// `path${plural(n)}` / `source${plural(n)}` so the `n !== 1 ? 's' : ''` idiom
// lives in one place across the runtime status and the panel.
export function plural(n: number): string {
  return n === 1 ? '' : 's';
}
