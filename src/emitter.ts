import type { Clock } from './clock';
import type { SampleValue } from './metrics';

export interface EmitApp {
  handleMessage(id: string, delta: unknown): void;
}

/**
 * Signal K notification states this plugin uses. `alert` says the published
 * value cannot be trusted, `warn` says the plugin is degraded but still
 * producing, and `normal` clears a previous one. `alarm` and `emergency` are
 * deliberately never used: a data-quality problem is not a vessel emergency,
 * and taking the top of the scale for one would train an operator to ignore it.
 */
export type NotificationState = 'normal' | 'warn' | 'alert';

// Notification delivery per state. An alert is worth showing on a plotter; a
// warning stays discoverable in the notifications tree without interrupting.
// `sound` is never requested, so this plugin cannot make the boat beep.
const METHODS: Record<NotificationState, string[]> = {
  normal: [],
  warn: [],
  alert: ['visual'],
};

export class Emitter {
  private lastEmit = new Map<string, number>();
  private lastNotification = new Map<string, string>();

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

  /**
   * Publish `notifications.<path>` describing the confidence in the synthetic
   * value, so a consumer that only reads the value has somewhere to learn that
   * the sources disagree or that a sensor has been rejected. Repeats are
   * suppressed: only a change of state or message reaches the bus, and a
   * `normal` that was never preceded by anything is not sent at all.
   */
  notify(path: string, state: NotificationState, message: string): void {
    const key = `${state}|${message}`;
    const previous = this.lastNotification.get(path);
    if (previous === key) return;
    if (previous === undefined && state === 'normal') return;
    this.lastNotification.set(path, key);
    this.app.handleMessage(this.pluginId, {
      updates: [
        {
          $source: this.pluginId,
          values: [
            {
              path: `notifications.${path}`,
              value: { state, method: METHODS[state], message },
            },
          ],
        },
      ],
    });
  }

  reset(): void {
    this.lastEmit.clear();
    this.lastNotification.clear();
  }
}
