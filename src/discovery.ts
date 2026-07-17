import type { Clock } from './clock';
import { DEFAULT_MAX_SOURCES_PER_PATH } from './config';
import { oldestKey } from './mapUtil';
import { ATTITUDE_COMPONENTS, type Kind, type SampleValue } from './metrics';

export interface DetectedPath {
  path: string;
  sources: string[];
  kind?: Kind;
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
const PRUNE_INTERVAL_MS = 1000;
export const DISCOVERY_SOURCE_TIMEOUT_MS = 60_000;

interface SourceHist {
  ring: string[];
  lastSampledAt: number;
  lastSeen: number;
}

interface Entry {
  sources: Map<string, SourceHist>;
  lastSeen: number;
  kind?: Kind;
}

function keyOf(value: SampleValue): string {
  if (typeof value === 'number') return `${value}`;
  if ('latitude' in value) return `${value.latitude},${value.longitude}`;
  return ATTITUDE_COMPONENTS.map((c) => value[c]).join(',');
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
    if (srcs.length >= 2 && srcs.filter((source) => varying.has(source)).length >= 2) {
      groups.push(srcs);
    }
  }
  return groups;
}

export class Discovery {
  private store = new Map<string, Entry>();
  private nextPruneAt = 0;

  constructor(
    private clock: Clock,
    private maxPaths = 200,
    private maxSourcesPerPath = DEFAULT_MAX_SOURCES_PER_PATH
  ) {}

  setMaxSourcesPerPath(maxSourcesPerPath: number): void {
    this.maxSourcesPerPath = maxSourcesPerPath;
    for (const entry of this.store.values()) this.trimSources(entry);
  }

  kind(path: string): Kind | undefined {
    return this.store.get(path)?.kind;
  }

  observe(path: string, sourceRef: string, value?: SampleValue, kind?: Kind): boolean {
    const now = this.clock.now();
    let membershipChanged = this.pruneIfDue(now);
    let entry = this.store.get(path);
    if (!entry) {
      if (this.store.size >= this.maxPaths)
        membershipChanged = this.evictOldest() || membershipChanged;
      entry = { sources: new Map(), lastSeen: now };
      this.store.set(path, entry);
    }
    let hist = entry.sources.get(sourceRef);
    if (!hist) {
      if (entry.sources.size >= this.maxSourcesPerPath) this.evictOldestSource(entry);
      hist = { ring: [], lastSampledAt: Number.NEGATIVE_INFINITY, lastSeen: now };
      entry.sources.set(sourceRef, hist);
      membershipChanged = true;
    }
    hist.lastSeen = now;
    // Throttle history sampling so the key string is built at most once per
    // SAMPLE_MS per source, not on every delta.
    if (value !== undefined && now - hist.lastSampledAt >= SAMPLE_MS) {
      hist.ring.push(keyOf(value));
      if (hist.ring.length > HISTORY) hist.ring.shift();
      hist.lastSampledAt = now;
    } else if (value === undefined) {
      // A source that switches to a non-combinable value must not retain old
      // numeric history and appear to duplicate a live numeric source.
      hist.ring.length = 0;
      hist.lastSampledAt = Number.NEGATIVE_INFINITY;
    }
    entry.lastSeen = now;
    if (kind !== undefined) entry.kind = kind;
    return membershipChanged;
  }

  private evictOldest(): boolean {
    const oldestPath = oldestKey(this.store, (entry) => entry.lastSeen);
    return oldestPath === undefined ? false : this.store.delete(oldestPath);
  }

  private evictOldestSource(entry: Entry): boolean {
    const oldestSource = oldestKey(entry.sources, (history) => history.lastSeen);
    return oldestSource === undefined ? false : entry.sources.delete(oldestSource);
  }

  private trimSources(entry: Entry): void {
    while (entry.sources.size > this.maxSourcesPerPath) this.evictOldestSource(entry);
  }

  // Number of paths seen with two or more sources, without building the
  // duplicate-group analysis. Cheap enough for the status path.
  count(): number {
    this.pruneStaleSources(this.clock.now());
    let n = 0;
    for (const entry of this.store.values()) {
      if (entry.sources.size >= 2) n++;
    }
    return n;
  }

  detected(): DetectedPath[] {
    this.pruneStaleSources(this.clock.now());
    const out: DetectedPath[] = [];
    for (const [path, entry] of this.store) {
      if (entry.sources.size >= 2) {
        const detected: DetectedPath = {
          path,
          sources: [...entry.sources.keys()],
          duplicateGroups: duplicateGroups(entry),
        };
        if (entry.kind !== undefined) detected.kind = entry.kind;
        out.push(detected);
      }
    }
    return out;
  }

  reset(): void {
    this.store.clear();
    this.nextPruneAt = 0;
  }

  private pruneIfDue(now: number): boolean {
    if (now < this.nextPruneAt) return false;
    return this.pruneStaleSources(now);
  }

  private pruneStaleSources(now: number): boolean {
    const cutoff = now - DISCOVERY_SOURCE_TIMEOUT_MS;
    let changed = false;
    for (const [path, entry] of this.store) {
      for (const [sourceRef, hist] of entry.sources) {
        if (hist.lastSeen <= cutoff) changed = entry.sources.delete(sourceRef) || changed;
      }
      if (entry.sources.size === 0) changed = this.store.delete(path) || changed;
    }
    this.nextPruneAt = now + PRUNE_INTERVAL_MS;
    return changed;
  }
}
