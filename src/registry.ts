import type { Clock } from './clock';
import type { Sample } from './combine';
import { oldestKey } from './mapUtil';
import type { SampleValue } from './metrics';

interface Entry {
  value: SampleValue;
  receiptTs: number;
  observationId: number;
}

export class Registry {
  private store = new Map<string, Map<string, Entry>>();
  private maxSources: number;
  private nextObservationId = 1;

  constructor(
    private clock: Clock,
    maxSourcesPerPath: number
  ) {
    this.maxSources = maxSourcesPerPath;
  }

  setMaxSourcesPerPath(n: number): void {
    this.maxSources = n;
  }

  update(path: string, sourceRef: string, value: SampleValue, ts: number): void {
    let bySource = this.store.get(path);
    if (!bySource) {
      bySource = new Map();
      this.store.set(path, bySource);
    }
    if (!bySource.has(sourceRef) && bySource.size >= this.maxSources) {
      const oldestRef = oldestKey(bySource, (e) => e.receiptTs);
      if (oldestRef !== undefined) bySource.delete(oldestRef);
    }
    bySource.set(sourceRef, { value, receiptTs: ts, observationId: this.nextObservationId++ });
  }

  fresh(path: string, stalenessMs: number): Sample[] {
    const bySource = this.store.get(path);
    if (!bySource) return [];
    const cutoff = this.clock.now() - stalenessMs;
    const out: Sample[] = [];
    for (const [sourceRef, e] of bySource) {
      // `>` means a sample exactly stalenessMs old is considered stale.
      if (e.receiptTs > cutoff) {
        out.push({
          sourceRef,
          value: e.value,
          receiptTs: e.receiptTs,
          observationId: e.observationId,
        });
      }
    }
    return out;
  }

  reset(): void {
    this.store.clear();
    this.nextObservationId = 1;
  }
}
