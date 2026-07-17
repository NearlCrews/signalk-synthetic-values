import { describe, expect, it } from 'vitest';
import { applyJump, applySlew, type JumpConfig } from '../src/damping';
import { geoDistance, type LatLon } from '../src/metrics';

const cfg: JumpConfig = { maxRate: 5, persistSamples: 2, persistMs: 3000 };

describe('applyJump', () => {
  it('accepts the first sample', () => {
    const r = applyJump('scalar', undefined, 100, 0, cfg);
    expect(r.accepted).toBe(100);
    expect(r.state.lastAccepted.value).toBe(100);
  });
  it('accepts steady motion within maxRate', () => {
    const st = applyJump('scalar', undefined, 100, 0, cfg).state;
    const r = applyJump('scalar', st, 103, 1000, cfg); // 3 per second < 5
    expect(r.accepted).toBe(103);
  });
  it('rejects a lone spike, holding the last accepted value', () => {
    const st = applyJump('scalar', undefined, 100, 0, cfg).state;
    const r = applyJump('scalar', st, 900, 1000, cfg); // 800 per second
    expect(r.accepted).toBe(100);
  });
  it('re-accepts a genuine step after it persists', () => {
    const st = applyJump('scalar', undefined, 0, 0, cfg).state; // RPM at 0
    let r = applyJump('scalar', st, 800, 1000, cfg); // engine starts, rejected once
    expect(r.accepted).toBe(0);
    r = applyJump('scalar', r.state, 805, 2000, cfg); // persists near 800
    expect(r.accepted).toBe(805); // re-accepted at the new level
  });
  it('angular: rejects a spike across the 0/2pi wrap by angular distance, not scalar', () => {
    // maxRate=0.05 rad/s. From 0.05 rad, a jump to 6.20 rad:
    // scalar distance: |6.20 - 0.05| = 6.15 rad (would be rejected by scalar math)
    // angular distance: min(6.15, 2*pi - 6.15) = min(6.15, 0.13) = 0.13 rad/s > 0.05, rejected.
    // Crucially, without wrap-aware distance the test below would show a different result.
    const tightCfg: JumpConfig = { maxRate: 0.05, persistSamples: 3, persistMs: 10000 };
    const st = applyJump('angular', undefined, 0.05, 0, tightCfg).state;
    // Jump to 6.20 rad: angular distance from 0.05 is ~0.13 rad/s, above maxRate=0.05 => rejected
    let r = applyJump('angular', st, 6.2, 1000, tightCfg);
    expect(r.accepted as number).toBeCloseTo(0.05, 6); // held at 0.05
    // Persist the same level: count 1 -> 2 -> 3 (persistSamples=3)
    r = applyJump('angular', r.state, 6.2, 2000, tightCfg);
    r = applyJump('angular', r.state, 6.2, 3000, tightCfg);
    // After 3 samples at ~6.20, the pending cluster persists and is accepted
    expect(r.accepted as number).toBeCloseTo(6.2, 4);
  });
  it('position: rejects a large geodesic jump', () => {
    const posCfg: JumpConfig = { maxRate: 10, persistSamples: 3, persistMs: 10000 }; // 10 m/s
    const here: LatLon = { latitude: 51.5, longitude: -0.1 };
    const st = applyJump('position', undefined, here, 0, posCfg).state;
    // 100 km away in 1 s = 100,000 m/s, far above maxRate=10
    const far: LatLon = { latitude: 52.4, longitude: -0.1 };
    const r = applyJump('position', st, far, 1000, posCfg);
    expect(r.accepted).toEqual(here);
  });
  it('persistMs re-acceptance branch accepts a persisted level even with count 1', () => {
    // cfg2 has persistSamples=5 so count alone won't trigger acceptance,
    // but persistMs=1000 means a 2-second wait should trigger acceptance.
    const cfg2: JumpConfig = { maxRate: 5, persistSamples: 5, persistMs: 1000 };
    const st = applyJump('scalar', undefined, 0, 0, cfg2).state;
    // Spike at t=1000: rejected, pending starts at count=1 and ts=1000
    let r = applyJump('scalar', st, 800, 1000, cfg2);
    expect(r.accepted).toBe(0); // rejected
    // Same level at t=3000: ts - pending.ts = 2000 >= persistMs=1000, so accepted
    r = applyJump('scalar', r.state, 800, 3000, cfg2);
    expect(r.accepted).toBe(800);
  });
  it('a drift faster than maxRate cannot ride an aging pending cluster to acceptance', () => {
    // Regression: the near check once divided distance-from-last-pending-sample
    // by time-since-cluster-ORIGIN, so a steady +6/s drift (above maxRate=5)
    // looked slower the longer the cluster lived and was eventually accepted.
    const driftCfg: JumpConfig = { maxRate: 5, persistSamples: 5, persistMs: 100_000 };
    const st = applyJump('scalar', undefined, 0, 0, driftCfg).state;
    // Spike to 10 (rate 10 > 5): rejected, pending cluster opens.
    let r = applyJump('scalar', st, 10, 1000, driftCfg);
    expect(r.accepted).toBe(0);
    // Wobble near the pending level: cluster holds, origin ts stays at 1000.
    r = applyJump('scalar', r.state, 10.1, 2000, driftCfg);
    expect(r.accepted).toBe(0);
    // Steady +6/s from here: every per-step rate exceeds maxRate, so the
    // cluster must reset each time and the held value never advances.
    for (let t = 3; t <= 6; t++) {
      r = applyJump('scalar', r.state, 10.1 + (t - 2) * 6, t * 1000, driftCfg);
    }
    expect(r.accepted).toBe(0);
  });
  it('a non-near second spike resets the pending cluster count', () => {
    // First spike: count becomes 1
    const st = applyJump('scalar', undefined, 0, 0, cfg).state;
    let r = applyJump('scalar', st, 800, 1000, cfg);
    expect(r.accepted).toBe(0);
    // A very different spike: not near 800, so count resets to 1 (not accepted yet)
    r = applyJump('scalar', r.state, 9000, 1500, cfg);
    expect(r.accepted).toBe(0); // still rejected, count reset to 1
    // One more near the same spike value: count becomes 2, now accepted
    r = applyJump('scalar', r.state, 9001, 2000, cfg);
    expect(r.accepted).toBe(9001);
  });
});

describe('applySlew', () => {
  it('passes the first value through', () => {
    const r = applySlew('scalar', undefined, 50, 0, 1);
    expect(r.value).toBe(50);
  });
  it('clamps a large step to maxRate per second', () => {
    const st = applySlew('scalar', undefined, 0, 0, 1).state;
    const r = applySlew('scalar', st, 10, 1000, 1); // 1 unit/s, dt 1s
    expect(r.value).toBeCloseTo(1, 6);
  });
  it('holds the exact prior representation when no time has elapsed', () => {
    const previous: LatLon = { latitude: 0, longitude: 180 };
    const st = applySlew('position', undefined, previous, 1000, 1).state;
    const result = applySlew('position', st, { latitude: 1, longitude: 170 }, 1000, 100).value;
    expect(result).toBe(previous);
  });
  it('angular slew steps the short way around the circle', () => {
    // From 0.1 rad, target is 2*pi - 0.1 rad (just below 0 going clockwise).
    // The short angular distance is 0.2 rad; with maxRatePerSec=0.05 and dt=1s
    // the step is clamped to 0.05 rad in the negative direction.
    const prev = 0.1;
    const target = 2 * Math.PI - 0.1;
    const st = applySlew('angular', undefined, prev, 0, 0.05).state;
    const r = applySlew('angular', st, target, 1000, 0.05); // max 0.05 rad/s over 1 s
    // Should step 0.05 rad backward (shortest path), landing near 0.1 - 0.05 = 0.05
    expect(r.value as number).toBeCloseTo(0.05, 6);
  });
  it('angular slew keeps a wrapped result in the 0 to 2pi range', () => {
    const st = applySlew('angular', undefined, 0.01, 0, 0.05).state;
    const result = applySlew('angular', st, 2 * Math.PI - 0.1, 1000, 0.05).value as number;
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(2 * Math.PI);
    expect(result).toBeCloseTo(2 * Math.PI - 0.04, 6);
  });
  it('position slew clamps a large step and moves toward target', () => {
    const a: LatLon = { latitude: 0, longitude: 0 };
    const b: LatLon = { latitude: 10, longitude: 0 }; // ~1110 km away
    const st = applySlew('position', undefined, a, 0, 1).state;
    // maxRatePerSec=100 m/s, dt=1 s => maxStep=100 m; full distance ~1110 km
    const r = applySlew('position', st, b, 1000, 100);
    const result = r.value as LatLon;
    // Moved toward target but not all the way: latitude should be slightly above 0
    expect(result.latitude).toBeGreaterThan(0);
    expect(result.latitude).toBeLessThan(10);
    expect(result.longitude).toBeCloseTo(0, 6);
  });
  it('position slew crosses the antimeridian the short way', () => {
    const a: LatLon = { latitude: 0, longitude: 179.9 };
    const b: LatLon = { latitude: 0, longitude: -179.9 }; // 0.2 deg east across the line
    const st = applySlew('position', undefined, a, 0, 1).state;
    // maxRatePerSec=100 m/s, dt=1 s: a 100 m step of the ~22 km leg.
    const r = applySlew('position', st, b, 1000, 100);
    const v = r.value as LatLon;
    // Must move EAST toward the line, not lurch west the long way around.
    expect(v.longitude).toBeGreaterThan(179.9);
    expect(v.longitude).toBeLessThanOrEqual(180);
  });
  it('position slew with longitude difference exercises the bearing interpolation', () => {
    // Two points that differ in both lat and lon to ensure the geodesic fraction path runs.
    const a: LatLon = { latitude: 0, longitude: 0 };
    const b: LatLon = { latitude: 0, longitude: 10 }; // ~1110 km due east
    const st = applySlew('position', undefined, a, 0, 1).state;
    // maxRatePerSec=100 m/s, dt=1 s => maxStep=100 m; full distance ~1110 km
    const r = applySlew('position', st, b, 1000, 100);
    const result = r.value as LatLon;
    // Must have moved east (longitude increased) but not reached the target
    expect(result.longitude).toBeGreaterThan(0);
    expect(result.longitude).toBeLessThan(10);
    // Latitude should be very close to 0 (the path is due east)
    expect(result.latitude).toBeCloseTo(0, 4);
  });
  it('position slew honors the distance cap near the poles', () => {
    const a: LatLon = { latitude: 80, longitude: 0 };
    const b: LatLon = { latitude: 80, longitude: 180 };
    const st = applySlew('position', undefined, a, 0, 1).state;
    const result = applySlew('position', st, b, 1000, 100).value as LatLon;
    expect(geoDistance(a, result)).toBeCloseTo(100, 6);
  });
});
