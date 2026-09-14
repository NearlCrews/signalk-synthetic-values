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
  /**
   * Bumped whenever a source's value history or the source membership changes.
   * The duplicate-group analysis is a pairwise scan over the whole entry and
   * its answer cannot move between bumps, so the cache below is keyed on this
   * rather than recomputed on every emit.
   */
  ringVersion: number;
  cachedGroups?: string[][];
  cachedGroupsVersion?: number;
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

/** One source's changing value history, hashed once per analysis. */
interface VaryingSource {
  src: string;
  values: ReadonlySet<string>;
}

// Whether the two histories share DUPLICATE_SHARED_VALUES distinct values
// exactly. Comparing across the whole window rather than only the newest sample
// is what makes this tolerant of a re-broadcast that arrives a second or two
// behind its origin. Counting stops at the threshold, and the smaller set is
// the one walked, so a pair costs no allocation at all.
function sharesEnoughValues(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const value of smaller) {
    if (larger.has(value) && ++shared >= DUPLICATE_SHARED_VALUES) return true;
  }
  return false;
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
  const varying: VaryingSource[] = [];
  for (const [src, hist] of entry.sources) {
    // Varying if any sample differs from the first: an allocation-free scan
    // before paying for the Set.
    const first = hist.ring[0];
    if (first !== undefined && hist.ring.some((v) => v !== first)) {
      // Hashed once here rather than once per pair, so n sources cost n sets
      // instead of the n squared the pairwise loop below would otherwise build.
      varying.push({ src, values: new Set(hist.ring) });
    }
  }
  // Union the pairwise matches so a feed re-broadcast twice lands in one group
  // rather than in two overlapping pairs.
  const groupOf = new Map<string, string[]>();
  const groups: string[][] = [];
  for (const [i, a] of varying.entries()) {
    for (const b of varying.slice(i + 1)) {
      if (sharesEnoughValues(a.values, b.values)) joinGroup(groups, groupOf, a.src, b.src);
    }
  }
  return groups;
}

// Membership is answered by the map that is being maintained anyway, rather
// than by scanning the group. The comparison is against this group in
// particular, so a source already held by a different group still joins.
function addToGroup(group: string[], groupOf: Map<string, string[]>, src: string): void {
  if (groupOf.get(src) !== group) group.push(src);
  groupOf.set(src, group);
}

function joinGroup(groups: string[][], groupOf: Map<string, string[]>, a: string, b: string): void {
  const existing = groupOf.get(a) ?? groupOf.get(b);
  const group = existing ?? [];
  if (!existing) groups.push(group);
  addToGroup(group, groupOf, a);
  addToGroup(group, groupOf, b);
}

/** The duplicate groups for one entry, recomputed only after its history moved. */
function cachedDuplicateGroups(entry: Entry): string[][] {
  if (entry.cachedGroups !== undefined && entry.cachedGroupsVersion === entry.ringVersion) {
    return entry.cachedGroups;
  }
  const groups = duplicateGroups(entry);
  entry.cachedGroups = groups;
  entry.cachedGroupsVersion = entry.ringVersion;
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

  /**
   * Duplicate groups for one path, so the combiner can collapse a re-broadcast
   * feed to a single reading instead of letting it outvote an honest sensor.
   */
  duplicateGroupsFor(path: string): string[][] {
    const entry = this.store.get(path);
    return entry ? cachedDuplicateGroups(entry) : [];
  }

  observe(path: string, sourceRef: string, value?: SampleValue, kind?: Kind): boolean {
    const now = this.clock.now();
    let membershipChanged = this.pruneIfDue(now);
    let entry = this.store.get(path);
    if (!entry) {
      if (this.store.size >= this.maxPaths)
        membershipChanged = this.evictOldest() || membershipChanged;
      entry = { sources: new Map(), lastSeen: now, ringVersion: 0 };
      this.store.set(path, entry);
    }
    let hist = entry.sources.get(sourceRef);
    if (!hist) {
      if (entry.sources.size >= this.maxSourcesPerPath) this.evictOldestSource(entry);
      hist = { ring: [], lastSampledAt: Number.NEGATIVE_INFINITY, lastSeen: now };
      entry.sources.set(sourceRef, hist);
      entry.ringVersion++;
      membershipChanged = true;
    }
    hist.lastSeen = now;
    // Throttle history sampling so the key string is built at most once per
    // SAMPLE_MS per source, not on every delta.
    if (value !== undefined && now - hist.lastSampledAt >= SAMPLE_MS) {
      hist.ring.push(keyOf(value));
      if (hist.ring.length > HISTORY) hist.ring.shift();
      hist.lastSampledAt = now;
      entry.ringVersion++;
    } else if (value === undefined && hist.ring.length > 0) {
      // A source that switches to a non-combinable value must not retain old
      // numeric history and appear to duplicate a live numeric source.
      hist.ring.length = 0;
      hist.lastSampledAt = Number.NEGATIVE_INFINITY;
      entry.ringVersion++;
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
    if (oldestSource === undefined) return false;
    entry.ringVersion++;
    return entry.sources.delete(oldestSource);
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
          duplicateGroups: cachedDuplicateGroups(entry),
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
        if (hist.lastSeen > cutoff) continue;
        entry.ringVersion++;
        changed = entry.sources.delete(sourceRef) || changed;
      }
      if (entry.sources.size === 0) changed = this.store.delete(path) || changed;
    }
    this.nextPruneAt = now + PRUNE_INTERVAL_MS;
    return changed;
  }
}
