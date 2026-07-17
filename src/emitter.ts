import type { Clock } from './clock';
import type { SampleValue } from './metrics';

export interface EmitApp {
  handleMessage(id: string, delta: unknown): void;
}

export class Emitter {
  private lastEmit = new Map<string, number>();

  constructor(
    private app: EmitApp,
    private pluginId: string,
    private clock: Clock
  ) {}

  due(path: string, minIntervalMs: number): boolean {
    const now = this.clock.now();
    const last = this.lastEmit.get(path);
    return last === undefined || now - last >= minIntervalMs;
  }

  emit(path: string, value: SampleValue): void {
    this.app.handleMessage(this.pluginId, {
      updates: [
        {
          $source: this.pluginId,
          values: [{ path, value }],
        },
      ],
    });
    // A failed send must remain immediately retryable.
    this.lastEmit.set(path, this.clock.now());
  }

  reset(): void {
    this.lastEmit.clear();
  }
}
