import type { Clock } from './clock';
import type { SampleValue } from './metrics';

export interface DetectedPath {
  path: string;
  sources: string[];
  /**
   * Groups of sources that currently report identical values while the value
   * is changing: the signature of one feed re-broadcast under several source
   * names (for example a GPS forwarded by an autopilot), rather than two
   * independent sensors that merely agree. Empty when nothing looks duplicated.
   */
  duplicateGroups: string[][];
}

// Per-source value history: how many recent samples to keep, and the minimum
// spacing between samples. Sampling at ~1 Hz keeps the delta hot path cheap on
// fast sensors while still spanning several seconds of motion.
const HISTORY = 8;
const SAMPLE_MS = 1000;

interface SourceHist {
  ring: string[];
  lastSampledAt: number;
}

interface Entry {
  sources: Map<string, SourceHist>;
  lastSeen: number;
}

function keyOf(value: SampleValue): string {
  return typeof value === 'number' ? `${value}` : `${value.latitude},${value.longitude}`;
}

// Group sources that currently report the same value where that value has been
// changing. Two independent sensors rarely match to full precision while
// moving, so an exact match on a varying value flags a re-broadcast feed. The
// changing check avoids false positives when everything agrees at rest.
function duplicateGroups(entry: Entry): string[][] {
  const byValue = new Map<string, string[]>();
  const varying = new Set<string>();
  for (const [src, hist] of entry.sources) {
    const last = hist.ring[hist.ring.length - 1];
    if (last === undefined) continue;
    const group = byValue.get(last);
    if (group) group.push(src);
    else byValue.set(last, [src]);
    // Varying if any sample differs from the first: an allocation-free scan
    // instead of building a Set just to count distinct values.
    const first = hist.ring[0];
    if (hist.ring.some((v) => v !== first)) varying.add(src);
  }
  const groups: string[][] = [];
  for (const srcs of byValue.values()) {
    if (srcs.length >= 2 && srcs.some((s) => varying.has(s))) groups.push(srcs);
  }
  return groups;
}

export class Discovery {
  private store = new Map<string, Entry>();

  constructor(
    private clock: Clock,
    private maxPaths = 200
  ) {}

  observe(path: string, sourceRef: string, value?: SampleValue): void {
    const now = this.clock.now();
    let entry = this.store.get(path);
    if (!entry) {
      if (this.store.size >= this.maxPaths) this.evictOldest();
      entry = { sources: new Map(), lastSeen: now };
      this.store.set(path, entry);
    }
    let hist = entry.sources.get(sourceRef);
    if (!hist) {
      hist = { ring: [], lastSampledAt: Number.NEGATIVE_INFINITY };
      entry.sources.set(sourceRef, hist);
    }
    // Throttle history sampling so the key string is built at most once per
    // SAMPLE_MS per source, not on every delta.
    if (value !== undefined && now - hist.lastSampledAt >= SAMPLE_MS) {
      hist.ring.push(keyOf(value));
      if (hist.ring.length > HISTORY) hist.ring.shift();
      hist.lastSampledAt = now;
    }
    entry.lastSeen = now;
  }

  private evictOldest(): void {
    let oldestPath: string | undefined;
    let oldest = Number.POSITIVE_INFINITY;
    for (const [path, entry] of this.store) {
      if (entry.lastSeen < oldest) {
        oldest = entry.lastSeen;
        oldestPath = path;
      }
    }
    if (oldestPath !== undefined) this.store.delete(oldestPath);
  }

  // Number of paths seen with two or more sources, without building the
  // duplicate-group analysis. Cheap enough for the status path.
  count(): number {
    let n = 0;
    for (const entry of this.store.values()) {
      if (entry.sources.size >= 2) n++;
    }
    return n;
  }

  detected(): DetectedPath[] {
    const out: DetectedPath[] = [];
    for (const [path, entry] of this.store) {
      if (entry.sources.size >= 2) {
        out.push({
          path,
          sources: [...entry.sources.keys()],
          duplicateGroups: duplicateGroups(entry),
        });
      }
    }
    return out;
  }

  reset(): void {
    this.store.clear();
  }
}
