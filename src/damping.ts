import type { Attitude, Kind, LatLon, SampleValue } from './metrics';
import { distance, EARTH_RADIUS_M, mapAttitudeComponents, toDegrees, toRadians } from './metrics';

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

function normalizeAngle(angle: number): number {
  const fullCircle = 2 * Math.PI;
  return ((angle % fullCircle) + fullCircle) % fullCircle;
}

export interface JumpConfig {
  maxRate: number;
  persistSamples: number;
  persistMs: number;
}

export interface JumpState {
  lastAccepted: { value: SampleValue; ts: number };
  lastProcessedObservationId?: number;
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

function normalizeLongitude(longitude: number): number {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

// Follow the initial great-circle bearing for exactly maxStep meters. Linear
// latitude/longitude interpolation can exceed the requested rate near the
// poles and on long legs.
function stepPosition(a: LatLon, b: LatLon, maxStep: number): LatLon {
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const dLon = toRadians(normalizeLongitude(b.longitude - a.longitude));
  const bearing = Math.atan2(
    Math.sin(dLon) * Math.cos(lat2),
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  );
  const angularStep = maxStep / EARTH_RADIUS_M;
  const steppedLat = Math.asin(
    Math.sin(lat1) * Math.cos(angularStep) +
      Math.cos(lat1) * Math.sin(angularStep) * Math.cos(bearing)
  );
  const steppedLon =
    toRadians(a.longitude) +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularStep) * Math.cos(lat1),
      Math.cos(angularStep) - Math.sin(lat1) * Math.sin(steppedLat)
    );
  return {
    latitude: toDegrees(steppedLat),
    longitude: normalizeLongitude(toDegrees(steppedLon)),
  };
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
  if (maxStep === 0) return { value: state.value, state: { value: state.value, ts } };
  const d = distance(kind, state.value, value);
  if (d <= maxStep) {
    return { value, state: { value, ts } };
  }
  let limited: SampleValue;
  if (kind === 'position') {
    const a = state.value as LatLon;
    const b = value as LatLon;
    limited = stepPosition(a, b, maxStep);
  } else if (kind === 'angular') {
    limited = normalizeAngle(stepAngle(state.value as number, value as number, maxStep));
  } else if (kind === 'attitude') {
    const a = state.value as Attitude;
    const b = value as Attitude;
    limited = mapAttitudeComponents((c) => stepAngle(a[c], b[c], maxStep));
  } else {
    limited = clampScalar(state.value as number, value as number, maxStep);
  }
  return { value: limited, state: { value: limited, ts } };
}
