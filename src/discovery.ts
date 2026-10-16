import type { Clock } from './clock';
import { DEFAULT_MAX_SOURCES_PER_PATH } from './config';
import { deleteOldest } from './mapUtil';
import { ATTITUDE_COMPONENTS, type Kind, type SampleValue } from './metrics';

export interface DetectedPath {
  path: string;
  sources: string[];
  kind?: Kind;
  /**
   * Groups of sources that are one sensor under several names: sources naming
   * the same NMEA 2000 device, and sources that currently report identical
   * values while the value is changing, the signature of one feed re-broadcast
   * (for example a GPS forwarded by an autopilot) rather than two independent
   * sensors that merely agree. Empty when nothing looks duplicated.
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

// How many paths discovery tracks. A busy server publishes more than this, so
// the store runs full in steady state and eviction is a routine event.
const MAX_DETECTED_PATHS = 200;

// The share of the store one eviction may clear, taken from its oldest
// single-source paths. Evicting one path per new path would rescan the whole
// store on every delta from an untracked path.
const EVICTION_FRACTION = 0.1;

// An NMEA 2000 CAN Name is a 64-bit identifier rendered as the last sixteen hex
// digits of a source reference, and it names one physical device wherever it
// is seen: "canhat.c0788c00e7e04312" and "YDEN02.c0788c00e7e04312" are one
// sensor through two gateways. Signal K Server's source priorities match
// devices by the same rule.
const CAN_NAME_SUFFIX = /\.([0-9a-f]{16})$/i;

function canName(sourceRef: string): string | undefined {
  return CAN_NAME_SUFFIX.exec(sourceRef)?.[1]?.toLowerCase();
}

interface SourceHist {
  ring: string[];
  lastSampledAt: number;
  lastSeen: number;
  /** The NMEA 2000 device the reference names, parsed once when the source appears. */
  readonly device: string | undefined;
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
  cachedGroups?: { version: number; groups: string[][] };
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
  if (entry.sources.size < 2) return [];
  // Union the matches so a feed re-broadcast twice lands in one group rather
  // than in two overlapping pairs.
  const groupOf = new Map<string, string[]>();
  const groups: string[][] = [];
  // Sources naming one CAN device are one sensor whatever their values do.
  const byDevice = new Map<string, string>();
  for (const [src, { device }] of entry.sources) {
    if (device === undefined) continue;
    const first = byDevice.get(device);
    if (first === undefined) byDevice.set(device, src);
    else joinGroup(groups, groupOf, first, src);
  }
  const varying = varyingSources(entry);
  for (let i = 0; i < varying.length; i++) {
    const a = varying[i] as VaryingSource;
    for (let j = i + 1; j < varying.length; j++) {
      const b = varying[j] as VaryingSource;
      if (sharesEnoughValues(a.values, b.values)) joinGroup(groups, groupOf, a.src, b.src);
    }
  }
  return groups;
}

// The sources whose recent values moved, each history hashed once here rather
// than once per pair, so n sources cost n sets instead of the n squared the
// pairwise comparison would otherwise build.
function varyingSources(entry: Entry): VaryingSource[] {
  const varying: VaryingSource[] = [];
  for (const [src, hist] of entry.sources) {
    // Varying if any sample differs from the first: an allocation-free scan
    // before paying for the Set.
    const first = hist.ring[0];
    if (first !== undefined && hist.ring.some((v) => v !== first)) {
      varying.push({ src, values: new Set(hist.ring) });
    }
  }
  return varying;
}

// Membership is answered by the map that is being maintained anyway, rather
// than by scanning the group.
function addToGroup(group: string[], groupOf: Map<string, string[]>, src: string): void {
  if (groupOf.get(src) === group) return;
  group.push(src);
  groupOf.set(src, group);
}

/**
 * Put two sources in one group. When each already belongs to a different
 * group, the two groups merge: a source matched once by device and once by
 * value is one feed, and leaving it in two groups would let the combiner keep a
 * reading from each.
 */
function joinGroup(groups: string[][], groupOf: Map<string, string[]>, a: string, b: string): void {
  const groupA = groupOf.get(a);
  const groupB = groupOf.get(b);
  if (groupA !== undefined && groupB !== undefined) {
    if (groupA === groupB) return;
    for (const src of groupB) addToGroup(groupA, groupOf, src);
    groups.splice(groups.indexOf(groupB), 1);
    return;
  }
  const group = groupA ?? groupB ?? [];
  if (group.length === 0) groups.push(group);
  addToGroup(group, groupOf, a);
  addToGroup(group, groupOf, b);
}

/**
 * Add a value to one source's history. Sampling is throttled so the key string
 * is built at most once per SAMPLE_MS per source, not on every delta. True when
 * the history changed.
 */
function recordHistory(hist: SourceHist, value: SampleValue | undefined, now: number): boolean {
  if (value !== undefined) {
    if (now - hist.lastSampledAt < SAMPLE_MS) return false;
    hist.ring.push(keyOf(value));
    if (hist.ring.length > HISTORY) hist.ring.shift();
    hist.lastSampledAt = now;
    return true;
  }
  if (hist.ring.length === 0) return false;
  // A source that switches to a non-combinable value must not retain old
  // numeric history and appear to duplicate a live numeric source.
  hist.ring.length = 0;
  hist.lastSampledAt = Number.NEGATIVE_INFINITY;
  return true;
}

/** The duplicate groups for one entry, recomputed only after its history moved. */
function cachedDuplicateGroups(entry: Entry): string[][] {
  if (entry.cachedGroups?.version === entry.ringVersion) return entry.cachedGroups.groups;
  const groups = duplicateGroups(entry);
  entry.cachedGroups = { version: entry.ringVersion, groups };
  return groups;
}

export class Discovery {
  private store = new Map<string, Entry>();
  private nextPruneAt = 0;

  constructor(
    private clock: Clock,
    private maxPaths = MAX_DETECTED_PATHS,
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

  /**
   * Record one observation. True when the set of multi-source paths, or the
   * sources on one of them, changed: that is what `count` and `detected`
   * report, so a caller showing either knows when to refresh it.
   */
  observe(
    path: string,
    sourceRef: string,
    value?: SampleValue,
    kind?: Kind,
    now = this.clock.now()
  ): boolean {
    let detectedChanged = this.pruneIfDue(now);
    let entry = this.store.get(path);
    if (!entry) {
      if (this.store.size >= this.maxPaths)
        detectedChanged = this.evictForNewPath() || detectedChanged;
      entry = { sources: new Map(), lastSeen: now, ringVersion: 0 };
      this.store.set(path, entry);
    }
    let hist = entry.sources.get(sourceRef);
    if (!hist) {
      if (entry.sources.size >= this.maxSourcesPerPath) this.evictOldestSource(entry);
      hist = {
        ring: [],
        lastSampledAt: Number.NEGATIVE_INFINITY,
        lastSeen: now,
        device: canName(sourceRef),
      };
      entry.sources.set(sourceRef, hist);
      entry.ringVersion++;
      if (entry.sources.size >= 2) detectedChanged = true;
    }
    hist.lastSeen = now;
    if (recordHistory(hist, value, now)) entry.ringVersion++;
    entry.lastSeen = now;
    if (kind !== undefined) entry.kind = kind;
    return detectedChanged;
  }

  /**
   * Make room for a new path. Single-source paths go first, oldest first and a
   * batch at a time, because a path with two sources is the one the panel
   * exists to show. Only a store holding nothing else loses a multi-source
   * path, the oldest one. True when that happened.
   */
  private evictForNewPath(): boolean {
    const singles: { path: string; lastSeen: number }[] = [];
    for (const [path, entry] of this.store) {
      if (entry.sources.size < 2) singles.push({ path, lastSeen: entry.lastSeen });
    }
    if (singles.length === 0) return deleteOldest(this.store, (entry) => entry.lastSeen);
    singles.sort((a, b) => a.lastSeen - b.lastSeen);
    const batch = Math.min(
      singles.length,
      Math.max(1, Math.floor(this.maxPaths * EVICTION_FRACTION))
    );
    for (const { path } of singles.slice(0, batch)) this.store.delete(path);
    return false;
  }

  private evictOldestSource(entry: Entry): void {
    if (deleteOldest(entry.sources, (history) => history.lastSeen)) entry.ringVersion++;
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

  /** The multi-source paths, without the duplicate-group analysis `detected` adds. */
  detectedPaths(): string[] {
    this.pruneStaleSources(this.clock.now());
    const out: string[] = [];
    for (const [path, entry] of this.store) {
      if (entry.sources.size >= 2) out.push(path);
    }
    return out;
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

  // True when a multi-source path lost a source, which is the only pruning the
  // detected set can see.
  private pruneStaleSources(now: number): boolean {
    const cutoff = now - DISCOVERY_SOURCE_TIMEOUT_MS;
    let changed = false;
    for (const [path, entry] of this.store) {
      const before = entry.sources.size;
      for (const [sourceRef, hist] of entry.sources) {
        if (hist.lastSeen > cutoff) continue;
        entry.ringVersion++;
        entry.sources.delete(sourceRef);
      }
      if (before >= 2 && entry.sources.size < before) changed = true;
      if (entry.sources.size === 0) this.store.delete(path);
    }
    this.nextPruneAt = now + PRUNE_INTERVAL_MS;
    return changed;
  }
}
