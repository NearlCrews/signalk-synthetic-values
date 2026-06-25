// Return the key of the entry with the smallest timestamp, or undefined when
// the map is empty. Shared by the registry (oldest receipt) and discovery
// (oldest last-seen) eviction paths so the min-scan loop lives in one place.
export function oldestKey<V>(
  map: Map<string, V>,
  timestampOf: (value: V) => number
): string | undefined {
  let oldest: string | undefined;
  let oldestTs = Number.POSITIVE_INFINITY;
  for (const [key, value] of map) {
    const ts = timestampOf(value);
    if (ts < oldestTs) {
      oldestTs = ts;
      oldest = key;
    }
  }
  return oldest;
}
