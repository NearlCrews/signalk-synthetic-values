# signalk-synthetic-values Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Signal K node-server plugin that combines multiple sources of the same path into one robust synthetic value (median, kind-aware outlier rejection, and disagreement detection) emitted as an additional source on the same path.

**Architecture:** A single `registerDeltaInputHandler` observes every source for opted-in self paths (version-independent, re-registered each `start()`). Pure math modules (`metrics`, `combine`, `damping`) compute a robust value per cycle; thin Signal-K-facing modules (`registry`, `emitter`, `discovery`, `schema`, `status`, `index`) handle state, emit, discovery, and lifecycle. No timers: staleness is lazy, the rate limit is a timestamp comparison.

**Tech Stack:** TypeScript compiled to CommonJS, Vitest, `@signalk/server-api` (types only, devDependency).

**Reference spec:** `docs/superpowers/specs/2026-06-23-synthetic-values-design.md`. Read it before starting. Section numbers below refer to it.

## Global Constraints

- `engines.node >= 22`. Code must run on Node 22.
- TypeScript targets ES2022, CommonJS modules, `moduleResolution: node`, `strict: true`, declarations off.
- `@signalk/server-api` is a devDependency only; never a runtime dependency. The server injects the live `app`.
- No `prepare` or `prepack` lifecycle script anywhere. Build runs via `prepublishOnly` only.
- All scripts cross-platform: no unix-only `rm`; use a Node clean script.
- License `Apache-2.0`.
- Units are SI: radians for angular paths, meters for lengths, Kelvin for temperatures. Position `navigation.position` is the one exception and is in degrees `{ latitude, longitude }`.
- The plugin registers its delta input handler on EVERY `start()` (the server auto-unregisters on `stop()`). No register-once guard.
- The self-source feedback filter (`$source === pluginId || $source.startsWith(pluginId + '.')`) must run before any registry mutation. It is the loop guard; violating its ordering causes synchronous infinite recursion.
- The synthetic value is emitted by setting `update.$source` directly as a bare string (no `source.label` object), timestamp omitted, context omitted.
- User-facing text (README, CHANGELOG, status strings, schema descriptions, commit messages) uses no em dashes, the Oxford comma, the word "and" not "&", and never describes any AI or review process.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `index.js` | Entry: `module.exports = require('./dist/index.js')` |
| `src/clock.ts` | `Clock` interface and system clock |
| `src/metrics.ts` | Kind type, value types, kind-aware distances |
| `src/combine.ts` | Pure statistics and the `combine()` orchestrator returning a `CombineResult` |
| `src/damping.ts` | Pure jump rejection and slew limiting (state passed in) |
| `src/config.ts` | Config types and `validateConfig()` |
| `src/pathClassifier.ts` | Classify a path as scalar, angular, position, or other |
| `src/registry.ts` | Per-path, per-source latest-sample store with staleness and source cap |
| `src/discovery.ts` | Track observed path to sourceRef sets for detection and REST |
| `src/status.ts` | Map a `CombineResult` outcome to a status string |
| `src/emitter.ts` | Rate-limited emit via `app.handleMessage` |
| `src/schema.ts` | Dynamic, never-throwing `schema()` |
| `src/index.ts` | Plugin factory: lifecycle, handler, observe loop, REST route, wiring |
| `test/*.test.ts` | Vitest specs mirroring `src/` |
| `package.json`, `tsconfig.json`, `vitest.config.ts` | Build, types, tests |
| `.github/workflows/plugin-ci.yml` | Reusable Signal K plugin CI |
| `README.md`, `CHANGELOG.md`, `assets/` | Docs and store assets |

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `index.js`
- Create: `scripts/clean.js`
- Create: `src/.gitkeep`, `test/.gitkeep`

**Interfaces:**
- Produces: an npm project that builds with `npm run build`, tests with `npm test`, and lints types with `npm run typecheck`.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "signalk-synthetic-values",
  "version": "0.1.0",
  "description": "Combine redundant sensors on one Signal K path into a robust median or outlier-rejected value",
  "main": "dist/index.js",
  "license": "Apache-2.0",
  "engines": { "node": ">=22" },
  "files": ["dist", "assets", "README.md", "CHANGELOG.md", "LICENSE"],
  "scripts": {
    "build": "tsc",
    "clean": "node scripts/clean.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "prepublishOnly": "npm run clean && npm run build && npm test"
  },
  "keywords": [
    "signalk-node-server-plugin",
    "signalk-category-utility",
    "signalk",
    "redundancy",
    "sensor-fusion",
    "median",
    "outlier"
  ],
  "signalk": {
    "displayName": "Synthetic Values",
    "appIcon": "assets/appicon.png",
    "screenshots": []
  },
  "devDependencies": {
    "@signalk/server-api": "^2.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "declaration": false,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
})
```

- [ ] **Step 4: Write `index.js`**

```js
module.exports = require('./dist/index.js')
```

- [ ] **Step 5: Write `scripts/clean.js` (cross-platform clean)**

```js
const { rmSync } = require('node:fs')
rmSync('dist', { recursive: true, force: true })
```

- [ ] **Step 6: Add placeholder source and test dirs**

Create empty `src/.gitkeep` and `test/.gitkeep` so the directories exist.

- [ ] **Step 7: Install and verify tooling**

Run: `npm install`
Expected: completes with no error; `node_modules` populated.

- [ ] **Step 8: Verify the test runner runs with no tests**

Run: `npm test`
Expected: Vitest reports "No test files found" or exits 0 with zero tests. Either is acceptable at this point.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts index.js scripts/clean.js src/.gitkeep test/.gitkeep
git commit -m "chore: scaffold plugin project (typescript, vitest, build scripts)"
```

---

## Task 2: Clock

**Files:**
- Create: `src/clock.ts`
- Test: `test/clock.test.ts`

**Interfaces:**
- Produces: `interface Clock { now(): number }`, `const systemClock: Clock`.

- [ ] **Step 1: Write the failing test**

```ts
// test/clock.test.ts
import { describe, it, expect } from 'vitest'
import { systemClock } from '../src/clock'

describe('systemClock', () => {
  it('returns a number close to Date.now()', () => {
    const before = Date.now()
    const t = systemClock.now()
    expect(t).toBeGreaterThanOrEqual(before)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/clock.test.ts`
Expected: FAIL, cannot find module `../src/clock`.

- [ ] **Step 3: Write `src/clock.ts`**

```ts
export interface Clock {
  now(): number
}

export const systemClock: Clock = {
  now: () => Date.now(),
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/clock.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/clock.ts test/clock.test.ts
git commit -m "feat: add injectable Clock"
```

---

## Task 3: Kind-aware distances (metrics)

**Files:**
- Create: `src/metrics.ts`
- Test: `test/metrics.test.ts`

**Interfaces:**
- Produces:
  - `type Kind = 'scalar' | 'angular' | 'position' | 'other'`
  - `interface LatLon { latitude: number; longitude: number }`
  - `type SampleValue = number | LatLon`
  - `function scalarDistance(a: number, b: number): number`
  - `function angularDistance(a: number, b: number): number` (radians, circular, 0..pi)
  - `function geoDistance(a: LatLon, b: LatLon): number` (meters, haversine)
  - `function distance(kind: Kind, a: SampleValue, b: SampleValue): number`
  - `function maxPairwiseDistance(kind: Kind, values: SampleValue[]): number`

- [ ] **Step 1: Write the failing test**

```ts
// test/metrics.test.ts
import { describe, it, expect } from 'vitest'
import {
  scalarDistance, angularDistance, geoDistance, distance, maxPairwiseDistance, LatLon,
} from '../src/metrics'

describe('scalarDistance', () => {
  it('is the absolute difference', () => {
    expect(scalarDistance(3, 7)).toBe(4)
    expect(scalarDistance(7, 3)).toBe(4)
  })
})

describe('angularDistance (radians)', () => {
  it('wraps across 0', () => {
    const d = angularDistance(0.1, 2 * Math.PI - 0.1)
    expect(d).toBeCloseTo(0.2, 9)
  })
  it('is pi for opposite directions', () => {
    expect(angularDistance(0, Math.PI)).toBeCloseTo(Math.PI, 9)
  })
})

describe('geoDistance (meters)', () => {
  it('is near zero for the same point', () => {
    const p: LatLon = { latitude: 10, longitude: 20 }
    expect(geoDistance(p, p)).toBeCloseTo(0, 6)
  })
  it('is small across the antimeridian for nearby points', () => {
    const a: LatLon = { latitude: 0, longitude: 179.99995 }
    const b: LatLon = { latitude: 0, longitude: -179.99995 }
    expect(geoDistance(a, b)).toBeLessThan(20)
  })
  it('matches a known one-degree-latitude distance', () => {
    const a: LatLon = { latitude: 0, longitude: 0 }
    const b: LatLon = { latitude: 1, longitude: 0 }
    expect(geoDistance(a, b)).toBeGreaterThan(111000)
    expect(geoDistance(a, b)).toBeLessThan(111400)
  })
})

describe('distance dispatch and maxPairwiseDistance', () => {
  it('dispatches by kind', () => {
    expect(distance('scalar', 1, 4)).toBe(3)
    expect(distance('angular', 0, Math.PI)).toBeCloseTo(Math.PI, 9)
  })
  it('finds the max pairwise scalar distance', () => {
    expect(maxPairwiseDistance('scalar', [1, 2, 10])).toBe(9)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/metrics.test.ts`
Expected: FAIL, cannot find module `../src/metrics`.

- [ ] **Step 3: Write `src/metrics.ts`**

```ts
export type Kind = 'scalar' | 'angular' | 'position' | 'other'

export interface LatLon {
  latitude: number
  longitude: number
}

export type SampleValue = number | LatLon

const EARTH_RADIUS_M = 6371000

export function scalarDistance(a: number, b: number): number {
  return Math.abs(a - b)
}

// Smallest circular separation in radians, range 0..pi.
export function angularDistance(a: number, b: number): number {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))
}

export function geoDistance(a: LatLon, b: LatLon): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.latitude - a.latitude)
  const dLon = toRad(b.longitude - a.longitude)
  const lat1 = toRad(a.latitude)
  const lat2 = toRad(b.latitude)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function distance(kind: Kind, a: SampleValue, b: SampleValue): number {
  if (kind === 'position') return geoDistance(a as LatLon, b as LatLon)
  if (kind === 'angular') return angularDistance(a as number, b as number)
  return scalarDistance(a as number, b as number)
}

export function maxPairwiseDistance(kind: Kind, values: SampleValue[]): number {
  let max = 0
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      max = Math.max(max, distance(kind, values[i], values[j]))
    }
  }
  return max
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/metrics.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/metrics.ts test/metrics.test.ts
git commit -m "feat: add kind-aware distance metrics (scalar, circular angular, geodesic)"
```

---

## Task 4: Statistics primitives (combine internals)

**Files:**
- Create: `src/combine.ts`
- Test: `test/combine-stats.test.ts`

**Interfaces:**
- Produces (exported for reuse and testing):
  - `function median(xs: number[]): number`
  - `function mean(xs: number[]): number`
  - `function trimmedMean(xs: number[], trimFraction: number): number`
  - `function circularMeanRad(angles: number[]): { mean: number; R: number }` (mean normalized to `[0, 2pi)`)
  - `function maxCircularSpread(angles: number[]): number`

- [ ] **Step 1: Write the failing test**

```ts
// test/combine-stats.test.ts
import { describe, it, expect } from 'vitest'
import { median, mean, trimmedMean, circularMeanRad, maxCircularSpread } from '../src/combine'

describe('median', () => {
  it('odd length', () => expect(median([3, 1, 2])).toBe(2))
  it('even length averages the middle two', () => expect(median([1, 2, 3, 4])).toBe(2.5))
})

describe('mean', () => {
  it('arithmetic mean', () => expect(mean([1, 2, 3])).toBe(2))
})

describe('trimmedMean small N flooring', () => {
  it('N=2 floors to mean', () => expect(trimmedMean([0, 10], 0.25)).toBe(5))
  it('N=3 trims nothing, equals mean', () => expect(trimmedMean([0, 1, 50], 0.25)).toBeCloseTo(17, 6))
  it('N=4 trims one each end, means middle two', () =>
    expect(trimmedMean([0, 10, 12, 100], 0.25)).toBe(11))
})

describe('circularMeanRad', () => {
  it('cluster around 135 degrees averages there (not the swapped 45)', () => {
    const a = (135 * Math.PI) / 180
    const r = circularMeanRad([a - 0.02, a, a + 0.02])
    expect((r.mean * 180) / Math.PI).toBeCloseTo(135, 4)
    expect(r.R).toBeGreaterThan(0.99)
  })
  it('north cluster across the 0 wrap', () => {
    const r = circularMeanRad([0.01, 2 * Math.PI - 0.01])
    const deg = (r.mean * 180) / Math.PI
    expect(Math.min(deg, 360 - deg)).toBeLessThan(1)
  })
  it('antipodal pair collapses R to near zero', () => {
    const r = circularMeanRad([0, Math.PI])
    expect(r.R).toBeLessThan(1e-6)
  })
  it('mean is normalized into [0, 2pi)', () => {
    const r = circularMeanRad([2 * Math.PI - 0.1, 2 * Math.PI - 0.2])
    expect(r.mean).toBeGreaterThanOrEqual(0)
    expect(r.mean).toBeLessThan(2 * Math.PI)
  })
})

describe('maxCircularSpread', () => {
  it('north fan 0,90,180 has a spread of pi', () => {
    expect(maxCircularSpread([0, Math.PI / 2, Math.PI])).toBeCloseTo(Math.PI, 9)
  })
  it('tight cluster 0,5,355 degrees has a small spread', () => {
    const d = (x: number) => (x * Math.PI) / 180
    expect(maxCircularSpread([d(0), d(5), d(355)])).toBeLessThan(d(11))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/combine-stats.test.ts`
Expected: FAIL, exports not found in `../src/combine`.

- [ ] **Step 3: Write `src/combine.ts` (statistics section only)**

```ts
import { angularDistance } from './metrics'

const TWO_PI = 2 * Math.PI

export function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function trimmedMean(xs: number[], trimFraction: number): number {
  const s = [...xs].sort((a, b) => a - b)
  const k = Math.floor(s.length * trimFraction)
  const kept = s.slice(k, s.length - k)
  return mean(kept.length ? kept : s)
}

function normalize2pi(a: number): number {
  const t = a % TWO_PI
  return t < 0 ? t + TWO_PI : t
}

export function circularMeanRad(angles: number[]): { mean: number; R: number } {
  let sumSin = 0
  let sumCos = 0
  for (const a of angles) {
    sumSin += Math.sin(a)
    sumCos += Math.cos(a)
  }
  const R = Math.hypot(sumSin, sumCos) / angles.length
  return { mean: normalize2pi(Math.atan2(sumSin, sumCos)), R }
}

export function maxCircularSpread(angles: number[]): number {
  let max = 0
  for (let i = 0; i < angles.length; i++) {
    for (let j = i + 1; j < angles.length; j++) {
      max = Math.max(max, angularDistance(angles[i], angles[j]))
    }
  }
  return max
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/combine-stats.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/combine.ts test/combine-stats.test.ts
git commit -m "feat: add statistics primitives (median, trimmed mean, circular mean, spread)"
```

---

## Task 5: Kind-aware outlier rejection

**Files:**
- Modify: `src/combine.ts`
- Test: `test/combine-reject.test.ts`

**Interfaces:**
- Consumes: `median`, `mean` (Task 4); `distance`, `Kind`, `SampleValue`, `LatLon` (Task 3); `circularMeanRad` (Task 4).
- Produces:
  - `function robustCenter(kind: Kind, values: SampleValue[]): SampleValue`
  - `function rejectMask(kind: Kind, values: SampleValue[], madThreshold: number, rejectThreshold?: number): boolean[]` (true = keep)

Rejection rule (spec 9.6): compute each value's distance from the robust center; with `N >= 4` and a usable scale, reject distance `> madThreshold * scaledMAD`, where `scaledMAD = 1.4826 * median(distances)`, and when that is zero but the distances differ, fall back to `1.2533 * mean(distances)`; with `N < 4` or no usable scale, reject by absolute `rejectThreshold` if set, else keep all.

- [ ] **Step 1: Write the failing test**

```ts
// test/combine-reject.test.ts
import { describe, it, expect } from 'vitest'
import { robustCenter, rejectMask } from '../src/combine'
import { LatLon } from '../src/metrics'

describe('robustCenter', () => {
  it('scalar center is the median', () => {
    expect(robustCenter('scalar', [1, 2, 100])).toBe(2)
  })
  it('position center is component median (lat) and circular mean (lon)', () => {
    const c = robustCenter('position', [
      { latitude: 10, longitude: 20 },
      { latitude: 10.0001, longitude: 20.0001 },
      { latitude: 9.9999, longitude: 19.9999 },
    ]) as LatLon
    expect(c.latitude).toBeCloseTo(10, 3)
    expect(c.longitude).toBeCloseTo(20, 3)
  })
})

describe('rejectMask', () => {
  it('keeps all below N=4 without a rejectThreshold', () => {
    expect(rejectMask('scalar', [0, 100], 3)).toEqual([true, true])
    expect(rejectMask('scalar', [0, 1, 100], 3)).toEqual([true, true, true])
  })
  it('applies an absolute rejectThreshold below N=4', () => {
    expect(rejectMask('scalar', [0, 1, 100], 3, 10)).toEqual([true, true, false])
  })
  it('rejects a gross outlier at N=4 with non-identical inliers', () => {
    expect(rejectMask('scalar', [0, 0.1, -0.1, 100], 3)).toEqual([true, true, true, false])
  })
  it('rejects a gross outlier at N=4 even when inliers are bit-identical (MAD=0 fallback)', () => {
    expect(rejectMask('scalar', [0, 0, 0, 100], 3)).toEqual([true, true, true, false])
  })
  it('rejects a whole position source by geodesic distance', () => {
    const tight: LatLon = { latitude: 10, longitude: 20 }
    const near1: LatLon = { latitude: 10.00001, longitude: 20.00001 }
    const near2: LatLon = { latitude: 9.99999, longitude: 19.99999 }
    const far: LatLon = { latitude: 11, longitude: 21 }
    expect(rejectMask('position', [tight, near1, near2, far], 3)).toEqual([true, true, true, false])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/combine-reject.test.ts`
Expected: FAIL, `robustCenter` and `rejectMask` not exported.

- [ ] **Step 3: Append to `src/combine.ts`**

```ts
import { distance, Kind, SampleValue, LatLon } from './metrics'

function lonsToRadians(lons: number[]): number[] {
  return lons.map((d) => (d * Math.PI) / 180)
}

function radiansToLonDegrees(rad: number): number {
  const deg = (rad * 180) / Math.PI
  return (((deg + 180) % 360) + 360) % 360 - 180
}

export function robustCenter(kind: Kind, values: SampleValue[]): SampleValue {
  if (kind === 'position') {
    const lats = (values as LatLon[]).map((v) => v.latitude)
    const lons = (values as LatLon[]).map((v) => v.longitude)
    const lonMeanRad = circularMeanRad(lonsToRadians(lons)).mean
    return { latitude: median(lats), longitude: radiansToLonDegrees(lonMeanRad) }
  }
  if (kind === 'angular') {
    return circularMeanRad(values as number[]).mean
  }
  return median(values as number[])
}

export function rejectMask(
  kind: Kind,
  values: SampleValue[],
  madThreshold: number,
  rejectThreshold?: number,
): boolean[] {
  const n = values.length
  if (n < 2) return values.map(() => true)

  const center = robustCenter(kind, values)
  const distances = values.map((v) => distance(kind, v, center))

  let scale = 1.4826 * median(distances)
  if (scale === 0) {
    const meanAbs = mean(distances)
    scale = meanAbs > 0 && n >= 4 ? 1.2533 * meanAbs : 0
  }

  if (n >= 4 && scale > 0) {
    const t = madThreshold * scale
    return distances.map((d) => d <= t)
  }
  if (rejectThreshold != null) {
    return distances.map((d) => d <= rejectThreshold)
  }
  return values.map(() => true)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/combine-reject.test.ts`
Expected: PASS (all cases, including the MAD=0 fallback and whole-source position rejection).

- [ ] **Step 5: Commit**

```bash
git add src/combine.ts test/combine-reject.test.ts
git commit -m "feat: add kind-aware whole-source outlier rejection with MAD-zero fallback"
```

---

## Task 6: The combine orchestrator

**Files:**
- Modify: `src/combine.ts`
- Test: `test/combine.test.ts`

**Interfaces:**
- Consumes: everything in Tasks 3 to 5.
- Produces:
  - `type CombineMethod = 'median' | 'trimmedMean' | 'mean'`
  - `type Outcome = 'ok' | 'singleSource' | 'belowMin' | 'allStale' | 'diverged' | 'disagree' | 'skipped'`
  - `interface Sample { sourceRef: string; value: SampleValue }`
  - `interface CombineOptions { kind: Kind; method: CombineMethod; minSources: number; outlierRejection: boolean; madThreshold: number; rejectThreshold?: number; disagreeThreshold?: number; angularSpreadThreshold: number; trimFraction: number }`
  - `interface CombineResult { value?: SampleValue; usedSources: string[]; freshCount: number; outcome: Outcome }`
  - `function combine(samples: Sample[], opts: CombineOptions): CombineResult`

Flow (spec 9.1, 9.3, 9.4, 9.7): handle the source-count outcomes first; reject outliers (when enabled); for angular apply the two divergence guards and combine with the circular mean (method ignored); for position combine lat by the method and lon circularly; for scalar combine by the method; then flag disagreement.

- [ ] **Step 1: Write the failing test**

```ts
// test/combine.test.ts
import { describe, it, expect } from 'vitest'
import { combine, CombineOptions, Sample } from '../src/combine'
import { LatLon } from '../src/metrics'

const base: Omit<CombineOptions, 'kind'> = {
  method: 'median',
  minSources: 2,
  outlierRejection: true,
  madThreshold: 3,
  angularSpreadThreshold: Math.PI / 2,
  trimFraction: 0.25,
}

const s = (sourceRef: string, value: any): Sample => ({ sourceRef, value })

describe('combine source-count outcomes', () => {
  it('no samples is allStale', () => {
    const r = combine([], { ...base, kind: 'scalar' })
    expect(r.outcome).toBe('allStale')
    expect(r.value).toBeUndefined()
  })
  it('below minSources is belowMin', () => {
    const r = combine([s('a', 5)], { ...base, kind: 'scalar' })
    expect(r.outcome).toBe('belowMin')
  })
  it('single source passes through when minSources is 1', () => {
    const r = combine([s('a', 5)], { ...base, kind: 'scalar', minSources: 1 })
    expect(r.outcome).toBe('singleSource')
    expect(r.value).toBe(5)
  })
})

describe('combine scalar', () => {
  it('medians three sources', () => {
    const r = combine([s('a', 10), s('b', 11), s('c', 30)], { ...base, kind: 'scalar' })
    expect(r.outcome).toBe('ok')
    expect(r.value).toBe(11)
  })
  it('flags disagreement but still emits', () => {
    const r = combine([s('a', 10), s('b', 11), s('c', 30)], {
      ...base, kind: 'scalar', disagreeThreshold: 5,
    })
    expect(r.outcome).toBe('disagree')
    expect(r.value).toBe(11)
  })
})

describe('combine angular', () => {
  it('uses the circular mean and ignores method', () => {
    const d = (x: number) => (x * Math.PI) / 180
    const r = combine([s('a', d(0)), s('b', d(10)), s('c', d(350))], {
      ...base, kind: 'angular', method: 'mean',
    })
    const deg = ((r.value as number) * 180) / Math.PI
    expect(Math.min(deg, 360 - deg)).toBeLessThan(1)
    expect(r.outcome).toBe('ok')
  })
  it('suppresses an antipodal pair', () => {
    const r = combine([s('a', 0), s('b', Math.PI)], { ...base, kind: 'angular' })
    expect(r.outcome).toBe('diverged')
    expect(r.value).toBeUndefined()
  })
  it('suppresses a wide fan (north, east, south)', () => {
    const r = combine([s('a', 0), s('b', Math.PI / 2), s('c', Math.PI)], {
      ...base, kind: 'angular',
    })
    expect(r.outcome).toBe('diverged')
  })
})

describe('combine position', () => {
  it('is antimeridian safe', () => {
    const r = combine(
      [s('a', { latitude: 0, longitude: 179.99995 }), s('b', { latitude: 0, longitude: -179.99995 })],
      { ...base, kind: 'position' },
    )
    const v = r.value as LatLon
    expect(Math.abs(v.longitude)).toBeGreaterThan(179)
  })
  it('rejects a far position whole-source and lands on the cluster', () => {
    const r = combine(
      [
        s('a', { latitude: 10, longitude: 20 }),
        s('b', { latitude: 10.00001, longitude: 20.00001 }),
        s('c', { latitude: 9.99999, longitude: 19.99999 }),
        s('d', { latitude: 11, longitude: 21 }),
      ],
      { ...base, kind: 'position' },
    )
    const v = r.value as LatLon
    expect(v.latitude).toBeCloseTo(10, 3)
    expect(v.longitude).toBeCloseTo(20, 3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/combine.test.ts`
Expected: FAIL, `combine` not exported.

- [ ] **Step 3: Append to `src/combine.ts`**

```ts
import { maxPairwiseDistance } from './metrics'

export type CombineMethod = 'median' | 'trimmedMean' | 'mean'
export type Outcome =
  | 'ok' | 'singleSource' | 'belowMin' | 'allStale' | 'diverged' | 'disagree' | 'skipped'

export interface Sample {
  sourceRef: string
  value: SampleValue
}

export interface CombineOptions {
  kind: Kind
  method: CombineMethod
  minSources: number
  outlierRejection: boolean
  madThreshold: number
  rejectThreshold?: number
  disagreeThreshold?: number
  angularSpreadThreshold: number
  trimFraction: number
}

export interface CombineResult {
  value?: SampleValue
  usedSources: string[]
  freshCount: number
  outcome: Outcome
}

const R_MIN = 0.2

function linear(method: CombineMethod, xs: number[], trimFraction: number): number {
  if (method === 'mean') return mean(xs)
  if (method === 'trimmedMean') return trimmedMean(xs, trimFraction)
  return median(xs)
}

export function combine(samples: Sample[], opts: CombineOptions): CombineResult {
  const freshCount = samples.length
  if (freshCount === 0) {
    return { usedSources: [], freshCount, outcome: 'allStale' }
  }
  if (freshCount < opts.minSources) {
    if (freshCount === 1 && opts.minSources <= 1) {
      return { value: samples[0].value, usedSources: [samples[0].sourceRef], freshCount, outcome: 'singleSource' }
    }
    return { usedSources: samples.map((s) => s.sourceRef), freshCount, outcome: 'belowMin' }
  }

  let used = samples
  if (opts.outlierRejection) {
    const mask = rejectMask(opts.kind, samples.map((s) => s.value), opts.madThreshold, opts.rejectThreshold)
    used = samples.filter((_, i) => mask[i])
  }
  const usedSources = used.map((s) => s.sourceRef)

  let value: SampleValue
  if (opts.kind === 'angular') {
    const angles = used.map((s) => s.value as number)
    const { mean: cm, R } = circularMeanRad(angles)
    if (R < R_MIN || maxCircularSpread(angles) > opts.angularSpreadThreshold) {
      return { usedSources, freshCount, outcome: 'diverged' }
    }
    value = cm
  } else if (opts.kind === 'position') {
    const lats = used.map((s) => (s.value as LatLon).latitude)
    const lons = used.map((s) => (s.value as LatLon).longitude)
    const lonMeanRad = circularMeanRad(lonsToRadians(lons)).mean
    value = { latitude: linear(opts.method, lats, opts.trimFraction), longitude: radiansToLonDegrees(lonMeanRad) }
  } else {
    value = linear(opts.method, used.map((s) => s.value as number), opts.trimFraction)
  }

  let outcome: Outcome = 'ok'
  if (opts.disagreeThreshold != null) {
    const spread = maxPairwiseDistance(opts.kind, used.map((s) => s.value))
    if (spread > opts.disagreeThreshold) outcome = 'disagree'
  }
  return { value, usedSources, freshCount, outcome }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/combine.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Run the full math suite and typecheck**

Run: `npx vitest run test/metrics.test.ts test/combine-stats.test.ts test/combine-reject.test.ts test/combine.test.ts && npm run typecheck`
Expected: all PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/combine.ts test/combine.test.ts
git commit -m "feat: add combine orchestrator with outcomes, divergence, and disagreement"
```

---

## Task 7: Damping (jump rejection and slew limit)

**Files:**
- Create: `src/damping.ts`
- Test: `test/damping.test.ts`

**Interfaces:**
- Consumes: `Kind`, `SampleValue`, `LatLon`, `distance`, `geoDistance` (Task 3).
- Produces:
  - `interface JumpConfig { maxRate: number; persistSamples: number; persistMs: number }`
  - `interface JumpState { lastAccepted: { value: SampleValue; ts: number }; pending?: { value: SampleValue; ts: number; count: number } }`
  - `function applyJump(kind: Kind, state: JumpState | undefined, value: SampleValue, ts: number, cfg: JumpConfig): { accepted: SampleValue; state: JumpState }`
  - `interface SlewState { value: SampleValue; ts: number }`
  - `function applySlew(kind: Kind, state: SlewState | undefined, value: SampleValue, ts: number, maxRatePerSec: number): { value: SampleValue; state: SlewState }`

Jump rule (spec 9.6.1): accept when the implied rate is within `maxRate`; otherwise hold the last accepted value but track a pending level and re-accept once it persists for `persistSamples` updates or `persistMs`. Slew rule (spec 9.6.2): clamp the move from the previous emitted value to `maxRatePerSec * dt`, dt measured from the previous emit time.

- [ ] **Step 1: Write the failing test**

```ts
// test/damping.test.ts
import { describe, it, expect } from 'vitest'
import { applyJump, applySlew, JumpConfig } from '../src/damping'

const cfg: JumpConfig = { maxRate: 5, persistSamples: 2, persistMs: 3000 }

describe('applyJump', () => {
  it('accepts the first sample', () => {
    const r = applyJump('scalar', undefined, 100, 0, cfg)
    expect(r.accepted).toBe(100)
    expect(r.state.lastAccepted.value).toBe(100)
  })
  it('accepts steady motion within maxRate', () => {
    let st = applyJump('scalar', undefined, 100, 0, cfg).state
    const r = applyJump('scalar', st, 103, 1000, cfg) // 3 per second < 5
    expect(r.accepted).toBe(103)
  })
  it('rejects a lone spike, holding the last accepted value', () => {
    let st = applyJump('scalar', undefined, 100, 0, cfg).state
    const r = applyJump('scalar', st, 900, 1000, cfg) // 800 per second
    expect(r.accepted).toBe(100)
  })
  it('re-accepts a genuine step after it persists', () => {
    let st = applyJump('scalar', undefined, 0, 0, cfg).state // RPM at 0
    let r = applyJump('scalar', st, 800, 1000, cfg) // engine starts, rejected once
    expect(r.accepted).toBe(0)
    r = applyJump('scalar', r.state, 805, 2000, cfg) // persists near 800
    expect(r.accepted).toBeGreaterThan(700) // re-accepted at the new level
  })
})

describe('applySlew', () => {
  it('passes the first value through', () => {
    const r = applySlew('scalar', undefined, 50, 0, 1)
    expect(r.value).toBe(50)
  })
  it('clamps a large step to maxRate per second', () => {
    const st = applySlew('scalar', undefined, 0, 0, 1).state
    const r = applySlew('scalar', st, 10, 1000, 1) // 1 unit/s, dt 1s
    expect(r.value).toBeCloseTo(1, 6)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/damping.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `src/damping.ts`**

```ts
import { Kind, SampleValue, LatLon, distance } from './metrics'

export interface JumpConfig {
  maxRate: number
  persistSamples: number
  persistMs: number
}

export interface JumpState {
  lastAccepted: { value: SampleValue; ts: number }
  pending?: { value: SampleValue; ts: number; count: number }
}

function rate(kind: Kind, a: SampleValue, b: SampleValue, dtMs: number): number {
  if (dtMs <= 0) return Infinity
  return distance(kind, a, b) / (dtMs / 1000)
}

export function applyJump(
  kind: Kind,
  state: JumpState | undefined,
  value: SampleValue,
  ts: number,
  cfg: JumpConfig,
): { accepted: SampleValue; state: JumpState } {
  if (!state) {
    return { accepted: value, state: { lastAccepted: { value, ts } } }
  }
  const r = rate(kind, state.lastAccepted.value, value, ts - state.lastAccepted.ts)
  if (r <= cfg.maxRate) {
    return { accepted: value, state: { lastAccepted: { value, ts } } }
  }
  // Candidate jump: track a pending level that must persist before acceptance.
  const near = state.pending && distance(kind, state.pending.value, value) <= cfg.maxRate
  const pending = near
    ? { value, ts: state.pending!.ts, count: state.pending!.count + 1 }
    : { value, ts, count: 1 }
  const persisted = pending.count >= cfg.persistSamples || ts - pending.ts >= cfg.persistMs
  if (persisted) {
    return { accepted: value, state: { lastAccepted: { value, ts } } }
  }
  return { accepted: state.lastAccepted.value, state: { lastAccepted: state.lastAccepted, pending } }
}

export interface SlewState {
  value: SampleValue
  ts: number
}

function clampScalar(prev: number, next: number, maxStep: number): number {
  const delta = next - prev
  if (Math.abs(delta) <= maxStep) return next
  return prev + Math.sign(delta) * maxStep
}

export function applySlew(
  kind: Kind,
  state: SlewState | undefined,
  value: SampleValue,
  ts: number,
  maxRatePerSec: number,
): { value: SampleValue; state: SlewState } {
  if (!state) return { value, state: { value, ts } }
  const dtSec = Math.max(0, ts - state.ts) / 1000
  const maxStep = maxRatePerSec * dtSec
  if (distance(kind, state.value, value) <= maxStep) {
    return { value, state: { value, ts } }
  }
  let limited: SampleValue
  if (kind === 'position') {
    const a = state.value as LatLon
    const b = value as LatLon
    const f = maxStep / distance(kind, a, b)
    limited = { latitude: a.latitude + f * (b.latitude - a.latitude), longitude: a.longitude + f * (b.longitude - a.longitude) }
  } else if (kind === 'angular') {
    const a = state.value as number
    const b = value as number
    const diff = Math.atan2(Math.sin(b - a), Math.cos(b - a))
    const step = Math.sign(diff) * Math.min(Math.abs(diff), maxStep)
    limited = a + step
  } else {
    limited = clampScalar(state.value as number, value as number, maxStep)
  }
  return { value: limited, state: { value: limited, ts } }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/damping.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/damping.ts test/damping.test.ts
git commit -m "feat: add optional jump rejection with re-acceptance and slew limiting"
```

---

## Task 8: Config types and validation

**Files:**
- Create: `src/config.ts`
- Test: `test/config.test.ts`

**Interfaces:**
- Consumes: `CombineMethod` (Task 6); `JumpConfig` (Task 7).
- Produces:
  - `interface PathConfig { path: string; method: CombineMethod; trimFraction: number; outlierRejection: boolean; madThreshold: number; rejectThreshold?: number; disagreeThreshold?: number; angularSpreadThreshold: number; angular: 'auto' | 'yes' | 'no'; includeSources?: string[]; excludeSources?: string[]; minSources: number; stalenessTimeoutMs: number; emitMinIntervalMs: number; jumpRejection?: JumpConfig; slewLimit?: number }`
  - `interface PluginOptions { defaultStalenessTimeoutMs: number; defaultEmitMinIntervalMs: number; defaultMinSources: number; maxSourcesPerPath: number; paths: RawPathConfig[] }` (RawPathConfig is the partial form from the form; resolution fills defaults)
  - `interface ResolvedConfig { maxSourcesPerPath: number; paths: PathConfig[] }`
  - `interface ConfigError { path: string; message: string }`
  - `interface ValidationResult { config: ResolvedConfig; errors: ConfigError[]; advisories: ConfigError[] }`
  - `function validateConfig(options: PluginOptions): ValidationResult`

- [ ] **Step 1: Write the failing test**

```ts
// test/config.test.ts
import { describe, it, expect } from 'vitest'
import { validateConfig, PluginOptions } from '../src/config'

const opts = (paths: any[]): PluginOptions => ({
  defaultStalenessTimeoutMs: 1000,
  defaultEmitMinIntervalMs: 1000,
  defaultMinSources: 2,
  maxSourcesPerPath: 16,
  paths,
})

describe('validateConfig', () => {
  it('resolves defaults into a path entry', () => {
    const r = validateConfig(opts([{ path: 'navigation.position' }]))
    expect(r.errors).toEqual([])
    expect(r.config.paths[0].minSources).toBe(2)
    expect(r.config.paths[0].method).toBe('median')
    expect(r.config.paths[0].stalenessTimeoutMs).toBe(1000)
  })
  it('rejects a path that sets both includeSources and excludeSources', () => {
    const r = validateConfig(opts([{ path: 'a', includeSources: ['x'], excludeSources: ['y'] }]))
    expect(r.config.paths).toHaveLength(0)
    expect(r.errors[0].path).toBe('a')
  })
  it('advises when madThreshold is set with outlierRejection off', () => {
    const r = validateConfig(opts([{ path: 'a', outlierRejection: false, madThreshold: 3 }]))
    expect(r.config.paths).toHaveLength(1)
    expect(r.advisories[0].path).toBe('a')
  })
  it('drops duplicate paths, keeping the first', () => {
    const r = validateConfig(opts([{ path: 'a' }, { path: 'a' }]))
    expect(r.config.paths).toHaveLength(1)
    expect(r.errors.some((e) => e.path === 'a')).toBe(true)
  })
  it('rejects a non-positive staleness timeout', () => {
    const r = validateConfig(opts([{ path: 'a', stalenessTimeoutMs: 0 }]))
    expect(r.config.paths).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `src/config.ts`**

```ts
import { CombineMethod } from './combine'
import { JumpConfig } from './damping'

export interface RawPathConfig {
  path: string
  method?: CombineMethod
  trimFraction?: number
  outlierRejection?: boolean
  madThreshold?: number
  rejectThreshold?: number
  disagreeThreshold?: number
  angularSpreadThreshold?: number
  angular?: 'auto' | 'yes' | 'no'
  includeSources?: string[]
  excludeSources?: string[]
  minSources?: number
  stalenessTimeoutMs?: number
  emitMinIntervalMs?: number
  jumpRejection?: JumpConfig
  slewLimit?: number
}

export interface PathConfig {
  path: string
  method: CombineMethod
  trimFraction: number
  outlierRejection: boolean
  madThreshold: number
  rejectThreshold?: number
  disagreeThreshold?: number
  angularSpreadThreshold: number
  angular: 'auto' | 'yes' | 'no'
  includeSources?: string[]
  excludeSources?: string[]
  minSources: number
  stalenessTimeoutMs: number
  emitMinIntervalMs: number
  jumpRejection?: JumpConfig
  slewLimit?: number
}

export interface PluginOptions {
  defaultStalenessTimeoutMs: number
  defaultEmitMinIntervalMs: number
  defaultMinSources: number
  maxSourcesPerPath: number
  paths: RawPathConfig[]
}

export interface ResolvedConfig {
  maxSourcesPerPath: number
  paths: PathConfig[]
}

export interface ConfigError {
  path: string
  message: string
}

export interface ValidationResult {
  config: ResolvedConfig
  errors: ConfigError[]
  advisories: ConfigError[]
}

const METHODS: CombineMethod[] = ['median', 'trimmedMean', 'mean']
const ANGULAR_MODES = ['auto', 'yes', 'no']

function positive(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

export function validateConfig(options: PluginOptions): ValidationResult {
  const errors: ConfigError[] = []
  const advisories: ConfigError[] = []
  const paths: PathConfig[] = []
  const seen = new Set<string>()

  for (const raw of options.paths ?? []) {
    const id = raw.path
    if (!id || typeof id !== 'string') {
      errors.push({ path: String(id), message: 'missing path' })
      continue
    }
    if (seen.has(id)) {
      errors.push({ path: id, message: 'duplicate path entry ignored' })
      continue
    }
    if (raw.includeSources?.length && raw.excludeSources?.length) {
      errors.push({ path: id, message: 'set either includeSources or excludeSources, not both' })
      continue
    }
    const method = raw.method ?? 'median'
    if (!METHODS.includes(method)) {
      errors.push({ path: id, message: `unknown method ${method}` })
      continue
    }
    const angular = raw.angular ?? 'auto'
    if (!ANGULAR_MODES.includes(angular)) {
      errors.push({ path: id, message: `unknown angular mode ${angular}` })
      continue
    }
    const trimFraction = raw.trimFraction ?? 0.25
    if (!(trimFraction >= 0 && trimFraction < 0.5)) {
      errors.push({ path: id, message: 'trimFraction must be in [0, 0.5)' })
      continue
    }
    const staleness = raw.stalenessTimeoutMs ?? options.defaultStalenessTimeoutMs
    const emitInterval = raw.emitMinIntervalMs ?? options.defaultEmitMinIntervalMs
    const minSources = raw.minSources ?? options.defaultMinSources
    if (!positive(staleness) || !positive(emitInterval) || !positive(minSources)) {
      errors.push({ path: id, message: 'staleness, emit interval, and minSources must be positive' })
      continue
    }
    for (const [k, v] of [
      ['rejectThreshold', raw.rejectThreshold],
      ['disagreeThreshold', raw.disagreeThreshold],
      ['angularSpreadThreshold', raw.angularSpreadThreshold],
    ] as const) {
      if (v != null && !positive(v)) {
        errors.push({ path: id, message: `${k} must be positive when set` })
      }
    }
    if (raw.jumpRejection && !positive(raw.jumpRejection.maxRate)) {
      errors.push({ path: id, message: 'jumpRejection.maxRate must be positive' })
    }
    if (errors.length && errors[errors.length - 1].path === id) continue

    const outlierRejection = raw.outlierRejection ?? true
    if (!outlierRejection && raw.madThreshold != null) {
      advisories.push({ path: id, message: 'madThreshold ignored while outlierRejection is off' })
    }
    seen.add(id)
    paths.push({
      path: id,
      method,
      trimFraction,
      outlierRejection,
      madThreshold: raw.madThreshold ?? 3,
      rejectThreshold: raw.rejectThreshold,
      disagreeThreshold: raw.disagreeThreshold,
      angularSpreadThreshold: raw.angularSpreadThreshold ?? Math.PI / 2,
      angular,
      includeSources: raw.includeSources,
      excludeSources: raw.excludeSources,
      minSources,
      stalenessTimeoutMs: staleness,
      emitMinIntervalMs: emitInterval,
      jumpRejection: raw.jumpRejection,
      slewLimit: raw.slewLimit,
    })
  }

  const maxSourcesPerPath = positive(options.maxSourcesPerPath) ? options.maxSourcesPerPath : 16
  return { config: { maxSourcesPerPath, paths }, errors, advisories }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -m "feat: add config types and pure validateConfig"
```

---

## Task 9: Path classifier

**Files:**
- Create: `src/pathClassifier.ts`
- Test: `test/pathClassifier.test.ts`

**Interfaces:**
- Consumes: `Kind`, `SampleValue`, `LatLon` (Task 3); `PathConfig['angular']` mode (Task 8).
- Produces:
  - `type MetadataLookup = (contextPrefixedPath: string) => { units?: string } | undefined`
  - `const ANGULAR_ALLOWLIST: ReadonlySet<string>`
  - `function classify(path: string, value: SampleValue, angularMode: 'auto' | 'yes' | 'no', getUnits: MetadataLookup, context: string): Kind`

Angular detection (spec 9.2): `auto` resolves to angular only when the path is on the allowlist AND `getUnits('<context>.<path>')?.units === 'rad'`. `yes`/`no` override. A non-finite-or-object value that is not a valid position is `other`.

- [ ] **Step 1: Write the failing test**

```ts
// test/pathClassifier.test.ts
import { describe, it, expect } from 'vitest'
import { classify, MetadataLookup } from '../src/pathClassifier'

const rad: MetadataLookup = (p) =>
  p === 'vessels.self.navigation.headingTrue' ? { units: 'rad' } : undefined
const none: MetadataLookup = () => undefined

describe('classify', () => {
  it('position object is position', () => {
    expect(classify('navigation.position', { latitude: 1, longitude: 2 }, 'auto', none, 'vessels.self')).toBe('position')
  })
  it('allowlisted rad path is angular under auto', () => {
    expect(classify('navigation.headingTrue', 1.2, 'auto', rad, 'vessels.self')).toBe('angular')
  })
  it('rateOfTurn (rad but not circular) is scalar under auto', () => {
    const rot: MetadataLookup = () => ({ units: 'rad/s' })
    expect(classify('navigation.rateOfTurn', 0.1, 'auto', rot, 'vessels.self')).toBe('scalar')
  })
  it('angular:yes forces angular off the allowlist', () => {
    expect(classify('some.custom.angle', 1.2, 'yes', none, 'vessels.self')).toBe('angular')
  })
  it('plain number is scalar', () => {
    expect(classify('environment.depth.belowTransducer', 4.2, 'auto', none, 'vessels.self')).toBe('scalar')
  })
  it('non-position object is other', () => {
    expect(classify('navigation.attitude', { roll: 0, pitch: 0, yaw: 0 } as any, 'auto', none, 'vessels.self')).toBe('other')
  })
  it('string value is other', () => {
    expect(classify('navigation.state', 'sailing' as any, 'auto', none, 'vessels.self')).toBe('other')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/pathClassifier.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `src/pathClassifier.ts`**

```ts
import { Kind, SampleValue, LatLon } from './metrics'

export type MetadataLookup = (contextPrefixedPath: string) => { units?: string } | undefined

export const ANGULAR_ALLOWLIST: ReadonlySet<string> = new Set([
  'navigation.headingTrue',
  'navigation.headingMagnetic',
  'navigation.courseOverGroundTrue',
  'navigation.courseOverGroundMagnetic',
  'environment.wind.angleApparent',
  'environment.wind.angleTrueWater',
  'environment.wind.angleTrueGround',
])

function isLatLon(v: unknown): v is LatLon {
  return (
    typeof v === 'object' && v !== null &&
    Number.isFinite((v as LatLon).latitude) &&
    Number.isFinite((v as LatLon).longitude)
  )
}

export function classify(
  path: string,
  value: SampleValue,
  angularMode: 'auto' | 'yes' | 'no',
  getUnits: MetadataLookup,
  context: string,
): Kind {
  if (isLatLon(value)) return 'position'
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'other'
  if (angularMode === 'yes') return 'angular'
  if (angularMode === 'no') return 'scalar'
  const units = getUnits(`${context}.${path}`)?.units
  return ANGULAR_ALLOWLIST.has(path) && units === 'rad' ? 'angular' : 'scalar'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/pathClassifier.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pathClassifier.ts test/pathClassifier.test.ts
git commit -m "feat: add path classifier with angular allowlist and rad-units gate"
```

---

## Task 10: Registry

**Files:**
- Create: `src/registry.ts`
- Test: `test/registry.test.ts`

**Interfaces:**
- Consumes: `Clock` (Task 2); `SampleValue` (Task 3); `Sample` (Task 6).
- Produces:
  - `class Registry { constructor(clock: Clock, maxSourcesPerPath: number); update(path: string, sourceRef: string, value: SampleValue, ts: number): void; fresh(path: string, stalenessMs: number): Sample[]; reset(): void }`

`fresh` returns samples whose receipt time is within `stalenessMs` of `clock.now()`. `update` evicts the oldest source when a new sourceRef would exceed the cap.

- [ ] **Step 1: Write the failing test**

```ts
// test/registry.test.ts
import { describe, it, expect } from 'vitest'
import { Registry } from '../src/registry'
import { Clock } from '../src/clock'

function fakeClock(start = 0): Clock & { set: (t: number) => void } {
  let t = start
  return { now: () => t, set: (n: number) => (t = n) }
}

describe('Registry', () => {
  it('returns fresh samples within the staleness window', () => {
    const c = fakeClock(0)
    const r = new Registry(c, 16)
    r.update('p', 'a', 1, 0)
    r.update('p', 'b', 2, 0)
    c.set(500)
    expect(r.fresh('p', 1000).map((s) => s.sourceRef).sort()).toEqual(['a', 'b'])
  })
  it('drops a stale source', () => {
    const c = fakeClock(0)
    const r = new Registry(c, 16)
    r.update('p', 'a', 1, 0)
    r.update('p', 'b', 2, 900)
    c.set(1000)
    expect(r.fresh('p', 1000).map((s) => s.sourceRef)).toEqual(['b'])
  })
  it('caps tracked sources, evicting the oldest', () => {
    const c = fakeClock(0)
    const r = new Registry(c, 2)
    r.update('p', 'a', 1, 0)
    r.update('p', 'b', 2, 1)
    r.update('p', 'c', 3, 2)
    c.set(2)
    const refs = r.fresh('p', 1000).map((s) => s.sourceRef).sort()
    expect(refs).toEqual(['b', 'c'])
  })
  it('reset clears everything', () => {
    const c = fakeClock(0)
    const r = new Registry(c, 16)
    r.update('p', 'a', 1, 0)
    r.reset()
    expect(r.fresh('p', 1000)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/registry.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `src/registry.ts`**

```ts
import { Clock } from './clock'
import { SampleValue } from './metrics'
import { Sample } from './combine'

interface Entry {
  value: SampleValue
  receiptTs: number
}

export class Registry {
  private store = new Map<string, Map<string, Entry>>()

  constructor(private clock: Clock, private maxSourcesPerPath: number) {}

  update(path: string, sourceRef: string, value: SampleValue, ts: number): void {
    let bySource = this.store.get(path)
    if (!bySource) {
      bySource = new Map()
      this.store.set(path, bySource)
    }
    if (!bySource.has(sourceRef) && bySource.size >= this.maxSourcesPerPath) {
      let oldestRef: string | undefined
      let oldestTs = Infinity
      for (const [ref, e] of bySource) {
        if (e.receiptTs < oldestTs) {
          oldestTs = e.receiptTs
          oldestRef = ref
        }
      }
      if (oldestRef !== undefined) bySource.delete(oldestRef)
    }
    bySource.set(sourceRef, { value, receiptTs: ts })
  }

  fresh(path: string, stalenessMs: number): Sample[] {
    const bySource = this.store.get(path)
    if (!bySource) return []
    const cutoff = this.clock.now() - stalenessMs
    const out: Sample[] = []
    for (const [sourceRef, e] of bySource) {
      if (e.receiptTs >= cutoff) out.push({ sourceRef, value: e.value })
    }
    return out
  }

  reset(): void {
    this.store.clear()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/registry.ts test/registry.test.ts
git commit -m "feat: add per-path per-source registry with staleness and source cap"
```

---

## Task 11: Discovery

**Files:**
- Create: `src/discovery.ts`
- Test: `test/discovery.test.ts`

**Interfaces:**
- Produces:
  - `interface DetectedPath { path: string; sources: string[] }`
  - `class Discovery { observe(path: string, sourceRef: string): void; detected(): DetectedPath[]; reset(): void }`

`detected()` returns only paths with two or more distinct sources.

- [ ] **Step 1: Write the failing test**

```ts
// test/discovery.test.ts
import { describe, it, expect } from 'vitest'
import { Discovery } from '../src/discovery'

describe('Discovery', () => {
  it('reports a path only once it has two or more sources', () => {
    const d = new Discovery()
    d.observe('p', 'a')
    expect(d.detected()).toEqual([])
    d.observe('p', 'b')
    d.observe('p', 'b')
    expect(d.detected()).toEqual([{ path: 'p', sources: ['a', 'b'] }])
  })
  it('reset clears state', () => {
    const d = new Discovery()
    d.observe('p', 'a')
    d.observe('p', 'b')
    d.reset()
    expect(d.detected()).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/discovery.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `src/discovery.ts`**

```ts
export interface DetectedPath {
  path: string
  sources: string[]
}

export class Discovery {
  private store = new Map<string, Set<string>>()

  observe(path: string, sourceRef: string): void {
    let set = this.store.get(path)
    if (!set) {
      set = new Set()
      this.store.set(path, set)
    }
    set.add(sourceRef)
  }

  detected(): DetectedPath[] {
    const out: DetectedPath[] = []
    for (const [path, set] of this.store) {
      if (set.size >= 2) out.push({ path, sources: [...set] })
    }
    return out
  }

  reset(): void {
    this.store.clear()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/discovery.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/discovery.ts test/discovery.test.ts
git commit -m "feat: add discovery of multi-source paths"
```

---

## Task 12: Status narration

**Files:**
- Create: `src/status.ts`
- Test: `test/status.test.ts`

**Interfaces:**
- Consumes: `CombineResult`, `Outcome` (Task 6).
- Produces:
  - `function pathStatus(path: string, result: CombineResult, sourceLabel: string, effectiveMin: number, prioritySet: boolean): string`
  - `function summaryStatus(activePaths: number, detectedCount: number, skipped: { path: string; reason: string }[]): string`

Strings follow spec section 16 exactly. No em dashes, the word "and" not "&".

- [ ] **Step 1: Write the failing test**

```ts
// test/status.test.ts
import { describe, it, expect } from 'vitest'
import { pathStatus, summaryStatus } from '../src/status'
import { CombineResult } from '../src/combine'

const res = (outcome: any, n = 3): CombineResult => ({ outcome, usedSources: [], freshCount: n, value: 0 })

describe('pathStatus', () => {
  it('asks for priority when not yet set', () => {
    const s = pathStatus('navigation.position', res('ok'), 'signalk-synthetic-values', 2, false)
    expect(s).toContain('Set this path')
    expect(s).toContain('signalk-synthetic-values')
  })
  it('reports single source', () => {
    expect(pathStatus('p', res('singleSource', 1), 'sv', 2, true)).toContain('running on 1 source')
  })
  it('reports divergence', () => {
    expect(pathStatus('p', res('diverged'), 'sv', 2, true)).toContain('sources diverge')
  })
  it('reports disagreement', () => {
    expect(pathStatus('p', res('disagree'), 'sv', 2, true)).toContain('sources disagree')
  })
  it('reports waiting below min', () => {
    expect(pathStatus('p', res('belowMin', 1), 'sv', 2, true)).toContain('waiting for 2 sources')
  })
  it('contains no em dash or ampersand', () => {
    const s = pathStatus('p', res('ok'), 'sv', 2, true)
    expect(s).not.toMatch(/[—&]/)
  })
})

describe('summaryStatus', () => {
  it('reports nothing detected', () => {
    expect(summaryStatus(0, 0, [])).toContain('No multi-source paths detected')
  })
  it('lists skipped paths', () => {
    expect(summaryStatus(1, 2, [{ path: 'x', reason: 'non-numeric' }])).toContain('skipped: x (non-numeric)')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/status.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `src/status.ts`**

```ts
import { CombineResult } from './combine'

export function pathStatus(
  path: string,
  result: CombineResult,
  sourceLabel: string,
  effectiveMin: number,
  prioritySet: boolean,
): string {
  switch (result.outcome) {
    case 'singleSource':
      return `${path}: running on 1 source, redundancy lost.`
    case 'belowMin':
    case 'allStale':
      return `${path}: waiting for ${effectiveMin} sources (have ${result.freshCount}).`
    case 'diverged':
      return `${path}: sources diverge, synthetic value suppressed.`
    case 'disagree':
      return `${path}: sources disagree, emitting the robust value.`
    default:
      if (!prioritySet) {
        return `Combining ${result.usedSources.length} sources on ${path}. Set this path's source priority to prefer ${sourceLabel} in Server, Data, Sources.`
      }
      return `Combining ${result.usedSources.length} sources on ${path}.`
  }
}

export function summaryStatus(
  activePaths: number,
  detectedCount: number,
  skipped: { path: string; reason: string }[],
): string {
  const parts: string[] = []
  if (detectedCount === 0) {
    parts.push('No multi-source paths detected yet (need 2+ sources on a path).')
  } else {
    parts.push(`Combining on ${activePaths} of ${detectedCount} detected paths.`)
  }
  if (skipped.length) {
    parts.push(skipped.map((s) => `skipped: ${s.path} (${s.reason})`).join(', '))
  }
  return parts.join(' ')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/status.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/status.ts test/status.test.ts
git commit -m "feat: add status narration strings"
```

---

## Task 13: Emitter

**Files:**
- Create: `src/emitter.ts`
- Test: `test/emitter.test.ts`

**Interfaces:**
- Consumes: `Clock` (Task 2); `SampleValue`, `LatLon` (Task 3).
- Produces:
  - `interface EmitApp { handleMessage(id: string, delta: unknown): void }`
  - `class Emitter { constructor(app: EmitApp, pluginId: string, clock: Clock); maybeEmit(path: string, value: SampleValue, sourceRef: string, minIntervalMs: number): boolean; reset(): void }`

`maybeEmit` returns false (and emits nothing) when called again within `minIntervalMs` for the same path. It sets `update.$source` directly to `sourceRef`, omits timestamp and context, and uses `handleMessage(pluginId, delta)`.

- [ ] **Step 1: Write the failing test**

```ts
// test/emitter.test.ts
import { describe, it, expect, vi } from 'vitest'
import { Emitter, EmitApp } from '../src/emitter'
import { Clock } from '../src/clock'

function fakeClock(start = 0): Clock & { set: (t: number) => void } {
  let t = start
  return { now: () => t, set: (n: number) => (t = n) }
}

describe('Emitter', () => {
  it('emits a scalar delta with $source set as a bare string', () => {
    const app: EmitApp = { handleMessage: vi.fn() }
    const e = new Emitter(app, 'signalk-synthetic-values', fakeClock(0))
    const ok = e.maybeEmit('environment.depth.belowTransducer', 4.2, 'signalk-synthetic-values', 1000)
    expect(ok).toBe(true)
    const delta: any = (app.handleMessage as any).mock.calls[0][1]
    expect(delta.updates[0].$source).toBe('signalk-synthetic-values')
    expect(delta.updates[0].timestamp).toBeUndefined()
    expect(delta.context).toBeUndefined()
    expect(delta.updates[0].values[0]).toEqual({ path: 'environment.depth.belowTransducer', value: 4.2 })
  })
  it('rate-limits within the interval', () => {
    const app: EmitApp = { handleMessage: vi.fn() }
    const c = fakeClock(0)
    const e = new Emitter(app, 'sv', c)
    expect(e.maybeEmit('p', 1, 'sv', 1000)).toBe(true)
    c.set(500)
    expect(e.maybeEmit('p', 2, 'sv', 1000)).toBe(false)
    c.set(1000)
    expect(e.maybeEmit('p', 3, 'sv', 1000)).toBe(true)
    expect((app.handleMessage as any).mock.calls).toHaveLength(2)
  })
  it('emits a position value object', () => {
    const app: EmitApp = { handleMessage: vi.fn() }
    const e = new Emitter(app, 'sv', fakeClock(0))
    e.maybeEmit('navigation.position', { latitude: 1, longitude: 2 }, 'sv', 1000)
    const delta: any = (app.handleMessage as any).mock.calls[0][1]
    expect(delta.updates[0].values[0].value).toEqual({ latitude: 1, longitude: 2 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/emitter.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `src/emitter.ts`**

```ts
import { Clock } from './clock'
import { SampleValue } from './metrics'

export interface EmitApp {
  handleMessage(id: string, delta: unknown): void
}

export class Emitter {
  private lastEmit = new Map<string, number>()

  constructor(private app: EmitApp, private pluginId: string, private clock: Clock) {}

  maybeEmit(path: string, value: SampleValue, sourceRef: string, minIntervalMs: number): boolean {
    const now = this.clock.now()
    const last = this.lastEmit.get(path)
    if (last !== undefined && now - last < minIntervalMs) return false
    this.lastEmit.set(path, now)
    this.app.handleMessage(this.pluginId, {
      updates: [
        {
          $source: sourceRef,
          values: [{ path, value }],
        },
      ],
    })
    return true
  }

  reset(): void {
    this.lastEmit.clear()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/emitter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/emitter.ts test/emitter.test.ts
git commit -m "feat: add rate-limited emitter setting bare \$source"
```

---

## Task 14: Schema

**Files:**
- Create: `src/schema.ts`
- Test: `test/schema.test.ts`

**Interfaces:**
- Consumes: `DetectedPath` (Task 11).
- Produces:
  - `function buildSchema(detected: () => DetectedPath[]): object` (returns a JSON Schema object; never throws, returns the static schema if `detected()` throws)

The per-path `path` field carries an `enum` of detected paths (when any), and free text is allowed. The schema `description` names the REST discovery route.

- [ ] **Step 1: Write the failing test**

```ts
// test/schema.test.ts
import { describe, it, expect } from 'vitest'
import { buildSchema } from '../src/schema'

describe('buildSchema', () => {
  it('includes detected paths as enum hints', () => {
    const schema: any = buildSchema(() => [{ path: 'navigation.position', sources: ['a', 'b'] }])
    const pathProp = schema.properties.paths.items.properties.path
    expect(pathProp.examples).toContain('navigation.position')
  })
  it('never throws when detection throws, returns a usable schema', () => {
    const schema: any = buildSchema(() => {
      throw new Error('boom')
    })
    expect(schema.properties.paths).toBeDefined()
  })
  it('description names the discovery route', () => {
    const schema: any = buildSchema(() => [])
    expect(JSON.stringify(schema)).toContain('/plugins/signalk-synthetic-values/detected')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/schema.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `src/schema.ts`**

```ts
import { DetectedPath } from './discovery'

export function buildSchema(detected: () => DetectedPath[]): object {
  let examples: string[] = []
  try {
    examples = detected().map((d) => d.path)
  } catch {
    examples = []
  }
  return {
    type: 'object',
    properties: {
      defaultStalenessTimeoutMs: { type: 'number', title: 'Default staleness timeout (ms)', default: 1000 },
      defaultEmitMinIntervalMs: { type: 'number', title: 'Default minimum emit interval (ms)', default: 1000 },
      defaultMinSources: { type: 'number', title: 'Default minimum sources', default: 2 },
      maxSourcesPerPath: { type: 'number', title: 'Maximum sources tracked per path', default: 16 },
      paths: {
        type: 'array',
        title: 'Paths to combine',
        description:
          'Each entry combines all sources of one path. Detected multi-source paths are listed at GET /plugins/signalk-synthetic-values/detected.',
        items: {
          type: 'object',
          required: ['path'],
          properties: {
            path: { type: 'string', title: 'Signal K path', examples },
            method: { type: 'string', enum: ['median', 'trimmedMean', 'mean'], default: 'median' },
            outlierRejection: { type: 'boolean', default: true },
            madThreshold: { type: 'number', default: 3 },
            rejectThreshold: { type: 'number', title: 'Absolute reject distance (kind units)' },
            disagreeThreshold: { type: 'number', title: 'Disagreement distance (kind units)' },
            angular: { type: 'string', enum: ['auto', 'yes', 'no'], default: 'auto' },
            minSources: { type: 'number' },
            stalenessTimeoutMs: { type: 'number' },
            emitMinIntervalMs: { type: 'number' },
          },
        },
      },
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/schema.ts test/schema.test.ts
git commit -m "feat: add dynamic never-throwing schema with detected-path hints"
```

---

## Task 15: Plugin integration

**Files:**
- Create: `src/index.ts`
- Test: `test/index.test.ts`

**Interfaces:**
- Consumes: every module above.
- Produces: the default-exported Signal K plugin factory `(app) => Plugin`.

This task wires observe -> registry -> combine -> emit, registers the handler each `start()`, captures `app.selfContext`, applies the self-source filter before any mutation, runs damping, classifies via `app.getMetadata`, registers the REST route, and narrates status. Reference spec sections 6, 8, 9.1, 10, 13, 14, 15, 16.

- [ ] **Step 1: Write the failing integration test**

```ts
// test/index.test.ts
import { describe, it, expect, vi } from 'vitest'
import PluginFactory from '../src/index'

type Handler = (delta: any, next: (d: any) => void) => void

function makeApp() {
  let handler: Handler | null = null
  const emitted: any[] = []
  const app: any = {
    selfContext: 'vessels.urn:mrn:imo:mmsi:123',
    selfId: 'urn:mrn:imo:mmsi:123',
    registerDeltaInputHandler: (h: Handler) => {
      handler = h
      return () => { handler = null }
    },
    handleMessage: (_id: string, delta: any) => emitted.push(delta),
    getMetadata: () => undefined,
    setPluginStatus: vi.fn(),
    setPluginError: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }
  return { app, fire: (d: any) => handler && handler(d, () => {}), emitted, isRegistered: () => handler !== null }
}

function delta(context: string, $source: string, path: string, value: any) {
  return { context, updates: [{ $source, timestamp: '2026-06-23T00:00:00.000Z', values: [{ path, value }] }] }
}

describe('plugin integration', () => {
  it('combines two sources on an opted-in path and emits a synthetic value', () => {
    const h = makeApp()
    const plugin = PluginFactory(h.app)
    plugin.start({
      defaultStalenessTimeoutMs: 10000, defaultEmitMinIntervalMs: 0, defaultMinSources: 2,
      maxSourcesPerPath: 16, paths: [{ path: 'environment.depth.belowTransducer' }],
    })
    h.fire(delta(h.app.selfContext, 'gps1', 'environment.depth.belowTransducer', 10))
    h.fire(delta(h.app.selfContext, 'gps2', 'environment.depth.belowTransducer', 12))
    const last = h.emitted[h.emitted.length - 1]
    expect(last.updates[0].values[0].value).toBe(11)
    expect(last.updates[0].$source).toBe('signalk-synthetic-values')
  })

  it('ignores its own emitted source (no feedback amplification)', () => {
    const h = makeApp()
    const plugin = PluginFactory(h.app)
    plugin.start({
      defaultStalenessTimeoutMs: 10000, defaultEmitMinIntervalMs: 0, defaultMinSources: 2,
      maxSourcesPerPath: 16, paths: [{ path: 'p' }],
    })
    h.fire(delta(h.app.selfContext, 'a', 'p', 10))
    h.fire(delta(h.app.selfContext, 'b', 'p', 20))
    const countAfterTwo = h.emitted.length
    // Feed back the synthetic source: must be ignored, so no new distinct combine from it.
    h.fire(delta(h.app.selfContext, 'signalk-synthetic-values', 'p', 999))
    expect(h.emitted.length).toBe(countAfterTwo)
  })

  it('ignores non-self context', () => {
    const h = makeApp()
    const plugin = PluginFactory(h.app)
    plugin.start({
      defaultStalenessTimeoutMs: 10000, defaultEmitMinIntervalMs: 0, defaultMinSources: 2,
      maxSourcesPerPath: 16, paths: [{ path: 'p' }],
    })
    h.fire(delta('vessels.urn:mrn:other', 'a', 'p', 10))
    h.fire(delta('vessels.urn:mrn:other', 'b', 'p', 20))
    expect(h.emitted).toHaveLength(0)
  })

  it('re-registers the handler on a restart (stop then start)', () => {
    const h = makeApp()
    const plugin = PluginFactory(h.app)
    plugin.start({ defaultStalenessTimeoutMs: 10000, defaultEmitMinIntervalMs: 0, defaultMinSources: 2, maxSourcesPerPath: 16, paths: [{ path: 'p' }] })
    // simulate the server auto-unregistering on stop
    plugin.stop()
    h.fire(delta(h.app.selfContext, 'a', 'p', 10)) // handler gone; nothing happens
    plugin.start({ defaultStalenessTimeoutMs: 10000, defaultEmitMinIntervalMs: 0, defaultMinSources: 2, maxSourcesPerPath: 16, paths: [{ path: 'p' }] })
    expect(h.isRegistered()).toBe(true)
  })
})
```

Note: the restart test relies on the test harness dropping the handler when `stop()` runs. Implement `stop()` to call the unregister returned by `registerDeltaInputHandler` so the test's `() => { handler = null }` fires, mirroring the real server.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/index.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `src/index.ts`**

```ts
import { systemClock } from './clock'
import { Kind, SampleValue } from './metrics'
import { Registry } from './registry'
import { Discovery } from './discovery'
import { Emitter } from './emitter'
import { combine, CombineOptions, Sample } from './combine'
import { applyJump, applySlew, JumpState, SlewState } from './damping'
import { classify, MetadataLookup } from './pathClassifier'
import { validateConfig, PluginOptions, PathConfig } from './config'
import { buildSchema } from './schema'
import { pathStatus, summaryStatus } from './status'

const PLUGIN_ID = 'signalk-synthetic-values'

export = function (app: any) {
  let unregister: (() => void) | null = null
  let selfContext = 'vessels.self'
  let byPath = new Map<string, PathConfig>()
  let maxSourcesPerPath = 16
  const registry = new Registry(systemClock, maxSourcesPerPath)
  const discovery = new Discovery()
  const emitter = new Emitter(app, PLUGIN_ID, systemClock)
  const jumpState = new Map<string, Map<string, JumpState>>()
  const slewState = new Map<string, SlewState>()
  const classification = new Map<string, Kind>()
  const skipped: { path: string; reason: string }[] = []
  const prioritySet = new Set<string>() // best-effort; populated only if we ever learn priority. Stays empty in v1.

  const getUnits: MetadataLookup = (p) => {
    try {
      return app.getMetadata ? app.getMetadata(p) : undefined
    } catch {
      return undefined
    }
  }

  function isSelf(context: string | undefined): boolean {
    return context === undefined || context === selfContext
  }

  function isOwnSource(src: string): boolean {
    return src === PLUGIN_ID || src.startsWith(PLUGIN_ID + '.')
  }

  function classifyPath(path: string, value: SampleValue, cfg: PathConfig): Kind {
    const cached = classification.get(path)
    if (cached) return cached
    const kind = classify(path, value, cfg.angular, getUnits, selfContext)
    classification.set(path, kind)
    if (kind === 'other') skipped.push({ path, reason: 'non-combinable value' })
    return kind
  }

  function damped(path: string, cfg: PathConfig, kind: Kind, samples: Sample[], now: number): Sample[] {
    if (!cfg.jumpRejection) return samples
    let perSource = jumpState.get(path)
    if (!perSource) {
      perSource = new Map()
      jumpState.set(path, perSource)
    }
    return samples.map((s) => {
      const r = applyJump(kind, perSource!.get(s.sourceRef), s.value, now, cfg.jumpRejection!)
      perSource!.set(s.sourceRef, r.state)
      return { sourceRef: s.sourceRef, value: r.accepted }
    })
  }

  function maybeEmit(path: string, cfg: PathConfig): void {
    const value0 = registry.fresh(path, cfg.stalenessTimeoutMs)[0]?.value
    if (value0 === undefined) return
    const kind = classifyPath(path, value0, cfg)
    if (kind === 'other') return

    const now = systemClock.now()
    let samples = registry.fresh(path, cfg.stalenessTimeoutMs)
    if (cfg.includeSources?.length) samples = samples.filter((s) => cfg.includeSources!.includes(s.sourceRef))
    if (cfg.excludeSources?.length) samples = samples.filter((s) => !cfg.excludeSources!.includes(s.sourceRef))
    samples = damped(path, cfg, kind, samples, now)

    const opts: CombineOptions = {
      kind,
      method: cfg.method,
      minSources: cfg.minSources,
      outlierRejection: cfg.outlierRejection,
      madThreshold: cfg.madThreshold,
      rejectThreshold: cfg.rejectThreshold,
      disagreeThreshold: cfg.disagreeThreshold,
      angularSpreadThreshold: cfg.angularSpreadThreshold,
      trimFraction: cfg.trimFraction,
    }
    const result = combine(samples, opts)
    app.setPluginStatus(pathStatus(path, result, PLUGIN_ID, cfg.minSources, prioritySet.has(path)))
    if (result.value === undefined) return

    let value = result.value
    if (cfg.slewLimit != null) {
      const r = applySlew(kind, slewState.get(path), value, now, cfg.slewLimit)
      slewState.set(path, r.state)
      value = r.value
    }
    emitter.maybeEmit(path, value, PLUGIN_ID, cfg.emitMinIntervalMs)
  }

  function observe(delta: any): void {
    if (!delta || !isSelf(delta.context)) return
    for (const update of delta.updates ?? []) {
      const src: string | undefined = update.$source
      if (!src || isOwnSource(src) || !Array.isArray(update.values)) continue
      for (const pv of update.values) {
        const cfg = byPath.get(pv.path)
        if (!cfg) continue
        discovery.observe(pv.path, src)
        registry.update(pv.path, src, pv.value, systemClock.now())
        maybeEmit(pv.path, cfg)
      }
    }
  }

  return {
    id: PLUGIN_ID,
    name: 'Synthetic Values',
    schema: () => buildSchema(() => discovery.detected()),

    start(options: PluginOptions) {
      const { config, errors, advisories } = validateConfig(options)
      maxSourcesPerPath = config.maxSourcesPerPath
      byPath = new Map(config.paths.map((p) => [p.path, p]))
      selfContext = app.selfContext ?? 'vessels.self'
      registry.reset()
      emitter.reset()
      jumpState.clear()
      slewState.clear()
      classification.clear()
      skipped.length = 0
      for (const e of [...errors, ...advisories]) {
        skipped.push({ path: e.path, reason: e.message })
        app.debug(`config ${e.path}: ${e.message}`)
      }
      unregister = app.registerDeltaInputHandler((delta: any, next: (d: any) => void) => {
        try {
          observe(delta)
        } catch (err) {
          app.setPluginError(err instanceof Error ? err.message : String(err))
          app.error(err)
        }
        next(delta)
      })
      app.setPluginStatus(summaryStatus(byPath.size, discovery.detected().length, skipped))
    },

    stop() {
      if (unregister) {
        unregister()
        unregister = null
      }
      registry.reset()
      emitter.reset()
      discovery.reset()
      jumpState.clear()
      slewState.clear()
      classification.clear()
    },

    registerWithRouter(router: any) {
      router.get('/detected', (_req: any, res: any) => {
        const detected = discovery.detected()
        res.json({
          paths: detected.map((d) => ({
            path: d.path,
            sources: d.sources,
            kind: classification.get(d.path) ?? 'unknown',
            optedIn: byPath.has(d.path),
          })),
        })
      })
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/index.test.ts`
Expected: PASS (all four cases).

- [ ] **Step 5: Run the full suite and the build**

Run: `npm test && npm run build`
Expected: all tests PASS; `tsc` emits `dist/` with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts test/index.test.ts
git commit -m "feat: wire plugin lifecycle, observe loop, REST route, and status"
```

---

## Task 16: Packaging, CI, and docs

**Files:**
- Create: `LICENSE`
- Create: `README.md`
- Create: `CHANGELOG.md`
- Create: `.github/workflows/plugin-ci.yml`
- Create: `assets/README.md` (notes the required screenshot and icon files)
- Modify: `package.json` (set `signalk.screenshots` once images exist)

**Interfaces:**
- Produces: a publishable, App-Store-compliant package skeleton. No runtime code change.

- [ ] **Step 1: Add the Apache-2.0 LICENSE**

Run: download the standard Apache-2.0 text into `LICENSE` (copy from another of the author's plugins, for example `signalk-virtual-weather-sensors/LICENSE`, to keep the copyright line consistent).

- [ ] **Step 2: Write `CHANGELOG.md`**

```markdown
# Changelog

All notable changes to this project are documented here. The format follows Keep a Changelog.

## [0.1.0] - 2026-06-23

### Added

- Initial release. Combine multiple sources of one Signal K path into a robust synthetic value: median, trimmed mean, or mean, with kind-aware outlier rejection, angular divergence guards, and disagreement detection.
- Auto-detection of multi-source paths, opt-in per path.
- Optional jump rejection and output slew limiting.
```

- [ ] **Step 3: Write `README.md`**

Include: a one-line summary, App-Store-first install, every schema option, and a numbered "Make the synthetic source win" section with the exact admin-UI steps (Server, Data, Sources; place the `signalk-synthetic-values` source at the top for each combined path; set a timeout so a stalled plugin falls back to a raw source). State plainly that the synthetic value does not win until this step is done. A "What's new in 0.1.0" section mirrors the CHANGELOG entry. No em dashes, the Oxford comma, and the word "and" not "&".

- [ ] **Step 4: Write `.github/workflows/plugin-ci.yml`**

```yaml
name: plugin-ci
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:
jobs:
  ci:
    uses: SignalK/signalk-server/.github/workflows/plugin-ci.yml@master
    with:
      node-versions: '["22", "24"]'
```

(If the reusable workflow's input names differ on the pinned ref, align them to its current signature; the intent is the full Node 22 and 24 matrix across Linux, macOS, and Windows.)

- [ ] **Step 5: Note the required assets**

Write `assets/README.md` listing the files to add before publish: `appicon.png` (square, at least 512x512) and `screenshots/` (config form with a detected path opted in, the data browser showing raw and synthetic sources on one path, and the source-priority panel mid-setup). Once added, set `signalk.screenshots` in `package.json` to their shipped paths and verify with `npm pack --dry-run`.

- [ ] **Step 6: Verify the package contents**

Run: `npm run build && npm pack --dry-run`
Expected: stdout is clean; the file list includes `dist/`, `assets/`, `README.md`, `CHANGELOG.md`, and `LICENSE`; `main` resolves to `dist/index.js`.

- [ ] **Step 7: Commit**

```bash
git add LICENSE README.md CHANGELOG.md .github/workflows/plugin-ci.yml assets/README.md package.json
git commit -m "chore: add license, docs, plugin-ci, and packaging metadata"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
| --- | --- |
| 5 module list, 5.1 runtime state | Tasks 2 to 15 (state reset in Task 15 start/stop) |
| 6 observation, self-context, self-source filter | Task 15 |
| 7 config and validation | Task 8 |
| 8 path classification | Task 9 |
| 9.1 to 9.5 combine, stats, rejection | Tasks 4, 5, 6 |
| 9.3 angular divergence (R and spread) | Task 6 |
| 9.4 position antimeridian and whole-source rejection | Tasks 5, 6 |
| 9.6 jump rejection and slew | Task 7 |
| 9.7 disagreement | Task 6 |
| 9.8 CombineResult contract | Task 6 |
| 10 data flow, 10.1 re-entrancy | Task 15 (feedback test) |
| 11 priority onboarding | Task 16 README |
| 12 emit shape and label | Task 13 |
| 13 error handling | Tasks 8, 9, 15 |
| 14 lifecycle (register every start) | Task 15 (restart test) |
| 15 discovery, schema, REST | Tasks 11, 14, 15 |
| 16 status | Task 12 |
| 17 testing | every task's tests |
| 18 packaging, 19 layout | Tasks 1, 16 |

No spec section is left without a task.

**Placeholder scan:** every code step contains complete code; commands have expected output; no "TBD" or "handle errors appropriately" remains. The only deferred artifacts are the binary screenshot and icon image files, which are inherently out of band and are tracked in Task 16 Step 5.

**Type consistency:** `Sample`, `SampleValue`, `Kind`, `CombineOptions`, `CombineResult`, `PathConfig`, and `JumpState` names match across Tasks 3 through 15. `combine`, `rejectMask`, `robustCenter`, `classify`, `validateConfig`, `Registry.fresh`, `Emitter.maybeEmit`, `applyJump`, and `applySlew` signatures are used consistently by Task 15.

---

## Execution Handoff

Plan complete. Choose an execution approach when ready.
