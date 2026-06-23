import type { Clock } from '../src/clock'

export function fakeClock(start = 0): Clock & { set: (t: number) => void } {
  let t = start
  return { now: () => t, set: (n: number) => (t = n) }
}
