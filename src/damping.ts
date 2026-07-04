import type { Attitude, Kind, LatLon, SampleValue } from './metrics';
import { distance, mapAttitudeComponents } from './metrics';

function signedAngularDelta(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

// Move `base` by `delta`, capped at maxStep, preserving the sign of `delta`.
// Shared by the angular and scalar slew limiters.
function stepToward(base: number, delta: number, maxStep: number): number {
  return base + Math.sign(delta) * Math.min(Math.abs(delta), maxStep);
}

// Step one angle from a toward b by at most maxStep, the short way around.
function stepAngle(a: number, b: number, maxStep: number): number {
  return stepToward(a, signedAngularDelta(a, b), maxStep);
}

export interface JumpConfig {
  maxRate: number;
  persistSamples: number;
  persistMs: number;
}

export interface JumpState {
  lastAccepted: { value: SampleValue; ts: number };
  // `ts` is the cluster origin (drives the persistMs check); `lastTs` is the
  // most recent pending sample's timestamp (drives the per-step near check).
  pending?: { value: SampleValue; ts: number; lastTs: number; count: number };
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
  // The near check uses the per-step rate: distance from the last pending
  // sample over time since THAT sample (lastTs). Dividing by time since the
  // cluster origin would grow ever more lenient as the cluster ages, letting a
  // drift faster than maxRate be accepted as a persisted level.
  const near =
    state.pending !== undefined &&
    rate(kind, state.pending.value, value, ts - state.pending.lastTs) <= cfg.maxRate;
  const pending =
    near && state.pending !== undefined
      ? { value, ts: state.pending.ts, lastTs: ts, count: state.pending.count + 1 }
      : { value, ts, lastTs: ts, count: 1 };
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
  // Return next exactly when within the step (no float drift from reconstructing it).
  if (Math.abs(delta) <= maxStep) return next;
  return stepToward(prev, delta, maxStep);
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
  const d = distance(kind, state.value, value);
  if (d <= maxStep) {
    return { value, state: { value, ts } };
  }
  let limited: SampleValue;
  if (kind === 'position') {
    const a = state.value as LatLon;
    const b = value as LatLon;
    // a === state.value and b === value, so the over-limit distance is `d`; reuse it.
    const f = maxStep / d;
    // Wrap the longitude delta into [-180, 180) so a step across the
    // antimeridian moves the short way around. The lat/lon-space lerp is an
    // approximation of the geodesic; per-second slew steps are small, so the
    // error only matters within a fraction of a degree of the poles.
    const dLon = (((b.longitude - a.longitude + 540) % 360) + 360) % 360;
    const lon = a.longitude + f * (dLon - 180);
    limited = {
      latitude: a.latitude + f * (b.latitude - a.latitude),
      longitude: ((((lon + 540) % 360) + 360) % 360) - 180,
    };
  } else if (kind === 'angular') {
    limited = stepAngle(state.value as number, value as number, maxStep);
  } else if (kind === 'attitude') {
    const a = state.value as Attitude;
    const b = value as Attitude;
    limited = mapAttitudeComponents((c) => stepAngle(a[c], b[c], maxStep));
  } else {
    limited = clampScalar(state.value as number, value as number, maxStep);
  }
  return { value: limited, state: { value: limited, ts } };
}
