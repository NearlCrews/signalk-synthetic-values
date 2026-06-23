import { Clock } from './clock'
import { SampleValue } from './metrics'

export interface EmitApp {
  handleMessage(id: string, delta: unknown): void
}

export class Emitter {
  private lastEmit = new Map<string, number>()

  constructor(private app: EmitApp, private pluginId: string, private clock: Clock) {}

  due(path: string, minIntervalMs: number): boolean {
    const now = this.clock.now()
    const last = this.lastEmit.get(path)
    return last === undefined || now - last >= minIntervalMs
  }

  emit(path: string, value: SampleValue, sourceRef: string): void {
    this.lastEmit.set(path, this.clock.now())
    this.app.handleMessage(this.pluginId, {
      updates: [
        {
          $source: sourceRef,
          values: [{ path, value }],
        },
      ],
    })
  }

  maybeEmit(path: string, value: SampleValue, sourceRef: string, minIntervalMs: number): boolean {
    if (!this.due(path, minIntervalMs)) return false
    this.emit(path, value, sourceRef)
    return true
  }

  reset(): void {
    this.lastEmit.clear()
  }
}
