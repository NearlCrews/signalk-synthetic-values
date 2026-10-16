import type { Attitude, Kind, LatLon, SampleValue } from './metrics';
import {
  distance,
  EARTH_RADIUS_M,
  mapAttitudeComponents,
  onBranchOf,
  signedAngularDelta,
  toDegrees,
  toRadians,
  wrapLongitude,
} from './metrics';

// Move `base` by `delta`, capped at maxStep, preserving the sign of `delta`.
// Shared by the angular and scalar slew limiters.
function stepToward(base: number, delta: number, maxStep: number): number {
  return base + Math.sign(delta) * Math.min(Math.abs(delta), maxStep);
}

// Step one angle from a toward b by at most maxStep, the short way around, and
// keep the result on the branch the two arrived on.
function stepAngle(a: number, b: number, maxStep: number): number {
  return onBranchOf(stepToward(a, signedAngularDelta(a, b), maxStep), [a, b]);
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

/**
 * When this state last saw a sample, whether that sample was accepted or held
 * back. The caller prunes on age rather than on absence from one emit cycle, so
 * a source that reports more slowly than the staleness window keeps its jump
 * history instead of being re-armed with a clean slate on every fast emit.
 */
export function jumpStateLastSeen(state: JumpState): number {
  const pendingTs = state.pending?.lastTs;
  return pendingTs !== undefined && pendingTs > state.lastAccepted.ts
    ? pendingTs
    : state.lastAccepted.ts;
}

// A reading taken as the new level, with no step pending.
function acceptJump(value: SampleValue, ts: number): { accepted: SampleValue; state: JumpState } {
  return { accepted: value, state: { lastAccepted: { value, ts } } };
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
  if (!state) return acceptJump(value, ts);
  const r = rate(kind, state.lastAccepted.value, value, ts - state.lastAccepted.ts);
  if (r <= cfg.maxRate) return acceptJump(value, ts);
  // Candidate jump: track a pending level that must persist before acceptance.
  // The near check uses the per-step rate: distance from the last pending
  // sample over time since THAT sample (lastTs). Dividing by time since the
  // cluster origin would grow ever more lenient as the cluster ages, letting a
  // drift faster than maxRate be accepted as a persisted level.
  const prior = state.pending;
  const near =
    prior !== undefined && rate(kind, prior.value, value, ts - prior.lastTs) <= cfg.maxRate;
  const pending = near
    ? { value, ts: prior.ts, lastTs: ts, count: prior.count + 1 }
    : { value, ts, lastTs: ts, count: 1 };
  if (pending.count >= cfg.persistSamples || ts - pending.ts >= cfg.persistMs) {
    return acceptJump(value, ts);
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

// Follow the initial great-circle bearing for exactly maxStep meters. Linear
// latitude/longitude interpolation can exceed the requested rate near the
// poles and on long legs.
function stepPosition(a: LatLon, b: LatLon, maxStep: number): LatLon {
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const dLon = toRadians(wrapLongitude(b.longitude - a.longitude));
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
    longitude: wrapLongitude(toDegrees(steppedLon)),
  };
}

/**
 * Limit one step toward `value`. `clamped` says whether the returned value is
 * behind the one asked for, which is a fact each return site already knows:
 * reconstructing it from the result would mean a second full distance
 * computation, and on a position that is another haversine per emit.
 */
export function applySlew(
  kind: Kind,
  state: SlewState | undefined,
  value: SampleValue,
  ts: number,
  maxRatePerSec: number
): { value: SampleValue; state: SlewState; clamped: boolean } {
  if (!state) return { value, state: { value, ts }, clamped: false };
  const dtSec = Math.max(0, ts - state.ts) / 1000;
  const maxStep = maxRatePerSec * dtSec;
  const d = distance(kind, state.value, value);
  // A zero-width step (two emits sharing a timestamp) can allow no movement at
  // all. Returning the previous state unchanged leaves the reading to be
  // applied on the next call with a correctly sized step, instead of dropping
  // it and advancing the clock past it.
  if (maxStep === 0) return { value: state.value, state, clamped: d > 0 };
  if (d <= maxStep) {
    return { value, state: { value, ts }, clamped: false };
  }
  let limited: SampleValue;
  if (kind === 'position') {
    limited = stepPosition(state.value as LatLon, value as LatLon, maxStep);
  } else if (kind === 'angular') {
    limited = stepAngle(state.value as number, value as number, maxStep);
  } else if (kind === 'attitude') {
    const from = state.value as Attitude;
    const to = value as Attitude;
    limited = mapAttitudeComponents((c) => {
      const target = to[c];
      if (target === undefined) return undefined;
      // A component the previous value lacked has nothing to step from.
      const start = from[c];
      return start === undefined ? target : stepAngle(start, target, maxStep);
    });
  } else {
    limited = clampScalar(state.value as number, value as number, maxStep);
  }
  return { value: limited, state: { value: limited, ts }, clamped: true };
}
