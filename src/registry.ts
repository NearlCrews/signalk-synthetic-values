import type { Clock } from './clock';
import type { Sample } from './combine';
import { oldestKey } from './mapUtil';
import type { SampleValue } from './metrics';

// How many inter-sample gaps to keep per source. Enough to survive one missed
// report without skewing the median, cheap enough to update on every delta.
const INTERVAL_HISTORY = 8;

interface Entry {
  value: SampleValue;
  receiptTs: number;
  /** Recent gaps between reports, newest last, used to spot a source slower than the staleness window. */
  intervals: number[];
}

export class Registry {
  private store = new Map<string, Map<string, Entry>>();
  private maxSources: number;

  constructor(
    private clock: Clock,
    maxSourcesPerPath: number
  ) {
    this.maxSources = maxSourcesPerPath;
  }

  setMaxSourcesPerPath(n: number): void {
    this.maxSources = n;
    for (const bySource of this.store.values()) {
      while (bySource.size > this.maxSources) {
        const oldestRef = oldestKey(bySource, (entry) => entry.receiptTs);
        if (oldestRef === undefined) break;
        bySource.delete(oldestRef);
      }
    }
  }

  update(path: string, sourceRef: string, value: SampleValue, ts: number): void {
    let bySource = this.store.get(path);
    if (!bySource) {
      bySource = new Map();
      this.store.set(path, bySource);
    }
    const previous = bySource.get(sourceRef);
    if (!previous && bySource.size >= this.maxSources) {
      const oldestRef = oldestKey(bySource, (e) => e.receiptTs);
      if (oldestRef !== undefined) bySource.delete(oldestRef);
    }
    const intervals = previous?.intervals ?? [];
    if (previous) {
      intervals.push(ts - previous.receiptTs);
      if (intervals.length > INTERVAL_HISTORY) intervals.shift();
    }
    bySource.set(sourceRef, { value, receiptTs: ts, intervals });
  }

  /**
   * Median gap between reports across the sources on a path, or undefined until
   * at least one source has reported twice. Used to tell an operator that a
   * staleness timeout shorter than the reporting period is why a path never
   * reaches its minimum source count.
   */
  medianReportIntervalMs(path: string): number | undefined {
    const bySource = this.store.get(path);
    if (!bySource) return undefined;
    const gaps: number[] = [];
    for (const entry of bySource.values()) gaps.push(...entry.intervals);
    if (gaps.length === 0) return undefined;
    gaps.sort((a, b) => a - b);
    const mid = Math.floor(gaps.length / 2);
    if (gaps.length % 2) return gaps[mid] as number;
    return (((gaps[mid - 1] as number) + (gaps[mid] as number)) / 2) as number;
  }

  remove(path: string, sourceRef: string): void {
    const bySource = this.store.get(path);
    if (!bySource) return;
    bySource.delete(sourceRef);
    if (bySource.size === 0) this.store.delete(path);
  }

  /**
   * Fresh readings for a path, ordered by source reference. The order is
   * deterministic rather than registry insertion order so a combined value and
   * the source list reported alongside it cannot change when a source drops out
   * and re-registers, or when the plugin restarts and sees the sources in a
   * different order.
   */
  fresh(path: string, stalenessMs: number): Sample[] {
    const bySource = this.store.get(path);
    if (!bySource) return [];
    const cutoff = this.clock.now() - stalenessMs;
    const out: Sample[] = [];
    for (const [sourceRef, e] of bySource) {
      // `>` means a sample exactly stalenessMs old is considered stale.
      if (e.receiptTs > cutoff) {
        out.push({ sourceRef, value: e.value, receiptTs: e.receiptTs });
      }
    }
    out.sort((a, b) => (a.sourceRef < b.sourceRef ? -1 : a.sourceRef > b.sourceRef ? 1 : 0));
    return out;
  }

  reset(): void {
    this.store.clear();
  }
}
