import type { Kind, LatLon, SampleValue } from './metrics';
import { distance } from './metrics';

export interface JumpConfig {
  maxRate: number;
  persistSamples: number;
  persistMs: number;
}

export interface JumpState {
  lastAccepted: { value: SampleValue; ts: number };
  pending?: { value: SampleValue; ts: number; count: number };
}

function rate(kind: Kind, a: SampleValue, b: SampleValue, dtMs: number): number {
  if (dtMs <= 0) return Infinity;
  return distance(kind, a, b) / (dtMs / 1000);
}

export function applyJump(
  kind: Kind,
  state: JumpState | undefined,
  value: SampleValue,
  ts: number,
  cfg: JumpConfig
): { accepted: SampleValue; state: JumpState } {
  if (!state) {
    return { accepted: value, state: { lastAccepted: { value, ts } } };
  }
  const r = rate(kind, state.lastAccepted.value, value, ts - state.lastAccepted.ts);
  if (r <= cfg.maxRate) {
    return { accepted: value, state: { lastAccepted: { value, ts } } };
  }
  // Candidate jump: track a pending level that must persist before acceptance.
  const near =
    state.pending !== undefined && distance(kind, state.pending.value, value) <= cfg.maxRate;
  const pending =
    near && state.pending !== undefined
      ? { value, ts: state.pending.ts, count: state.pending.count + 1 }
      : { value, ts, count: 1 };
  const persisted = pending.count >= cfg.persistSamples || ts - pending.ts >= cfg.persistMs;
  if (persisted) {
    return { accepted: value, state: { lastAccepted: { value, ts } } };
  }
  return {
    accepted: state.lastAccepted.value,
    state: { lastAccepted: state.lastAccepted, pending },
  };
}

export interface SlewState {
  value: SampleValue;
  ts: number;
}

function clampScalar(prev: number, next: number, maxStep: number): number {
  const delta = next - prev;
  if (Math.abs(delta) <= maxStep) return next;
  return prev + Math.sign(delta) * maxStep;
}

export function applySlew(
  kind: Kind,
  state: SlewState | undefined,
  value: SampleValue,
  ts: number,
  maxRatePerSec: number
): { value: SampleValue; state: SlewState } {
  if (!state) return { value, state: { value, ts } };
  const dtSec = Math.max(0, ts - state.ts) / 1000;
  const maxStep = maxRatePerSec * dtSec;
  if (distance(kind, state.value, value) <= maxStep) {
    return { value, state: { value, ts } };
  }
  let limited: SampleValue;
  if (kind === 'position') {
    const a = state.value as LatLon;
    const b = value as LatLon;
    const f = maxStep / distance(kind, a, b);
    limited = {
      latitude: a.latitude + f * (b.latitude - a.latitude),
      longitude: a.longitude + f * (b.longitude - a.longitude),
    };
  } else if (kind === 'angular') {
    const a = state.value as number;
    const b = value as number;
    const diff = Math.atan2(Math.sin(b - a), Math.cos(b - a));
    const step = Math.sign(diff) * Math.min(Math.abs(diff), maxStep);
    limited = a + step;
  } else {
    limited = clampScalar(state.value as number, value as number, maxStep);
  }
  return { value: limited, state: { value: limited, ts } };
}
