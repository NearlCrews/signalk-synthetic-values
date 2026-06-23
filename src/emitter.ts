import { Clock } from './clock'
import { SampleValue } from './metrics'

export interface EmitApp {
  handleMessage(id: string, delta: unknown): void
}

export class Emitter {
  private lastEmit = new Map<string, number>()

  constructor(private app: EmitApp, private pluginId: string, private clock: Clock) {}

  maybeEmit(path: string, value: SampleValue, sourceRef: string, minIntervalMs: number): boolean {
    const now = this.clock.now()
    const last = this.lastEmit.get(path)
    if (last !== undefined && now - last < minIntervalMs) return false
    this.lastEmit.set(path, now)
    this.app.handleMessage(this.pluginId, {
      updates: [
        {
          $source: sourceRef,
          values: [{ path, value }],
        },
      ],
    })
    return true
  }

  reset(): void {
    this.lastEmit.clear()
  }
}
