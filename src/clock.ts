export interface Clock {
  now(): number;
}

export const systemClock: Clock = {
  // Every runtime use is elapsed-time based. performance.now() is monotonic,
  // so wall-clock corrections cannot freeze rate limiting or distort damping.
  now: () => performance.now(),
};
