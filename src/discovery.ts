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

// Distinct values two sources must have reported in common before they count as
// one feed. Exact equality on a full-precision float is already a strong signal,
// and requiring a second shared value removes the case where two coarsely
// quantized sensors happen to land on the same reading once.
const DUPLICATE_SHARED_VALUES = 2;

// Number of distinct values the two histories share exactly. Comparing across
// the whole window rather than only the newest sample is what makes this
// tolerant of a re-broadcast that arrives a second or two behind its origin.
function sharedValueCount(a: string[], b: string[]): number {
  const other = new Set(b);
  const shared = new Set<string>();
  for (const value of a) {
    if (other.has(value)) shared.add(value);
  }
  return shared.size;
}

/**
 * Group sources that report the same values while those values are changing:
 * the signature of one feed re-broadcast under several source names. Exact
 * equality is the whole point. Two independent sensors do not match to full
 * float precision while moving, so this cannot mistake two sensors that merely
 * agree for one feed, which matters because the combiner collapses each group
 * to a single reading.
 *
 * The limit of the technique is a re-broadcast that has been quantized on the
 * way round, such as a heading returning over NMEA 2000 at 0.0001 rad
 * resolution: it is no longer an exact match and is not detected here. Widening
 * this to a tolerance would also group two good sensors that agree closely,
 * which would silently drop a real sensor, so the round trip is handled as a
 * documented configuration hazard instead.
 */
function duplicateGroups(entry: Entry): string[][] {
  const varying: { src: string; ring: string[] }[] = [];
  for (const [src, hist] of entry.sources) {
    // Varying if any sample differs from the first: an allocation-free scan
    // instead of building a Set just to count distinct values.
    const first = hist.ring[0];
    if (first !== undefined && hist.ring.some((v) => v !== first)) {
      varying.push({ src, ring: hist.ring });
    }
  }
  // Union the pairwise matches so a feed re-broadcast twice lands in one group
  // rather than in two overlapping pairs.
  const groupOf = new Map<string, string[]>();
  const groups: string[][] = [];
  for (let i = 0; i < varying.length; i++) {
    for (let j = i + 1; j < varying.length; j++) {
      const a = varying[i] as { src: string; ring: string[] };
      const b = varying[j] as { src: string; ring: string[] };
      if (sharedValueCount(a.ring, b.ring) >= DUPLICATE_SHARED_VALUES) {
        joinGroup(groups, groupOf, a.src, b.src);
      }
    }
  }
  return groups;
}

function joinGroup(groups: string[][], groupOf: Map<string, string[]>, a: string, b: string): void {
  const existing = groupOf.get(a) ?? groupOf.get(b);
  const group = existing ?? [];
  if (!existing) groups.push(group);
  for (const src of [a, b]) {
    if (!group.includes(src)) group.push(src);
    groupOf.set(src, group);
  }
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

  /**
   * Duplicate groups for one path, so the combiner can collapse a re-broadcast
   * feed to a single reading instead of letting it outvote an honest sensor.
   */
  duplicateGroupsFor(path: string): string[][] {
    const entry = this.store.get(path);
    return entry ? duplicateGroups(entry) : [];
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
    let oldestSingleSourcePath: string | undefined;
    let oldestSingleSourceTs = Number.POSITIVE_INFINITY;
    for (const [path, entry] of this.store) {
      if (entry.sources.size >= 2 || entry.lastSeen >= oldestSingleSourceTs) continue;
      oldestSingleSourcePath = path;
      oldestSingleSourceTs = entry.lastSeen;
    }
    const oldestPath = oldestSingleSourcePath ?? oldestKey(this.store, (entry) => entry.lastSeen);
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
