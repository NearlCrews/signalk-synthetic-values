import type { Clock } from './clock'
import type { SampleValue } from './metrics'
import type { Sample } from './combine'

interface Entry {
  value: SampleValue
  receiptTs: number
}

export class Registry {
  private store = new Map<string, Map<string, Entry>>()
  private _maxSourcesPerPath: number

  constructor(private clock: Clock, maxSourcesPerPath: number) {
    this._maxSourcesPerPath = maxSourcesPerPath
  }

  setMaxSourcesPerPath(n: number): void {
    this._maxSourcesPerPath = n
  }

  update(path: string, sourceRef: string, value: SampleValue, ts: number): void {
    let bySource = this.store.get(path)
    if (!bySource) {
      bySource = new Map()
      this.store.set(path, bySource)
    }
    if (!bySource.has(sourceRef) && bySource.size >= this._maxSourcesPerPath) {
      let oldestRef: string | undefined
      let oldestTs = Infinity
      for (const [ref, e] of bySource) {
        if (e.receiptTs < oldestTs) {
          oldestTs = e.receiptTs
          oldestRef = ref
        }
      }
      if (oldestRef !== undefined) bySource.delete(oldestRef)
    }
    bySource.set(sourceRef, { value, receiptTs: ts })
  }

  fresh(path: string, stalenessMs: number): Sample[] {
    const bySource = this.store.get(path)
    if (!bySource) return []
    const cutoff = this.clock.now() - stalenessMs
    const out: Sample[] = []
    for (const [sourceRef, e] of bySource) {
      if (e.receiptTs > cutoff) out.push({ sourceRef, value: e.value })
    }
    return out
  }

  reset(): void {
    this.store.clear()
  }
}
