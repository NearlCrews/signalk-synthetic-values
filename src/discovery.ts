import type { Clock } from './clock';

export interface DetectedPath {
  path: string;
  sources: string[];
}

interface Entry {
  sources: Set<string>;
  lastSeen: number;
}

export class Discovery {
  private store = new Map<string, Entry>();

  constructor(
    private clock: Clock,
    private maxPaths = 200
  ) {}

  observe(path: string, sourceRef: string): void {
    let entry = this.store.get(path);
    if (!entry) {
      if (this.store.size >= this.maxPaths) this.evictOldest();
      entry = { sources: new Set(), lastSeen: this.clock.now() };
      this.store.set(path, entry);
    }
    entry.sources.add(sourceRef);
    entry.lastSeen = this.clock.now();
  }

  private evictOldest(): void {
    let oldestPath: string | undefined;
    let oldest = Infinity;
    for (const [path, entry] of this.store) {
      if (entry.lastSeen < oldest) {
        oldest = entry.lastSeen;
        oldestPath = path;
      }
    }
    if (oldestPath !== undefined) this.store.delete(oldestPath);
  }

  detected(): DetectedPath[] {
    const out: DetectedPath[] = [];
    for (const [path, entry] of this.store) {
      if (entry.sources.size >= 2) out.push({ path, sources: [...entry.sources] });
    }
    return out;
  }

  reset(): void {
    this.store.clear();
  }
}
