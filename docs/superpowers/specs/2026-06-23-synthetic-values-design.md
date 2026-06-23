# signalk-synthetic-values: design

- Date: 2026-06-23
- Status: approved design, pre-implementation (revised after two review rounds)
- Plugin id: `signalk-synthetic-values`

## 1. Problem

A boat often has several sensors feeding the same Signal K path: four GPS
receivers all producing `navigation.position`, duplicate depth sounders,
redundant wind and heading sources, and so on. The Signal K server's source
priority feature picks one source at a time, so the redundant sensors are wasted
rather than combined. The owner wants a single robust value computed from all the
duplicate sources, so a flaky or biased sensor cannot dominate.

## 2. Goals

1. Combine multiple sources of the same path into one robust synthetic value.
2. Work generically for any duplicated path, configured per path, not just position.
3. Auto-detect paths that currently have two or more sources, and let the user opt in per path.
4. Be robust: median, outlier rejection, and disagreement detection that actually work at the two to four sources a real boat has, so one bad source cannot drag the result.
5. Emit the synthetic value as an additional source on the same path, leaving the raw sources untouched and visible.
6. Run on the owner's current server (signalk-server 2.27.x) as well as newer releases.

## 3. Non-goals (YAGNI boundaries)

- No automatic writing of server source priorities. There is no stable plugin API for it (section 11). The user sets priority once per path, by hand, guided by the docs.
- No geodesic or ECEF position fusion. Component-wise combining with an antimeridian-safe longitude is sufficient for the synthetic value at antenna-separation scale (section 9.4). Geodesic distance is used only as a rejection and disagreement metric, never to compute the emitted value, so this non-goal stands.
- No cross-frame conversion (true vs magnetic). Signal K keeps those on distinct paths, so there is nothing to reconcile.
- No combining of non-numeric values (enumerations, booleans, strings, counts). Those paths are detected and skipped with a clear status message.
- No custom config webapp in v1. The standard admin form, driven by a dynamic schema, plus a read-only discovery endpoint, is enough.

## 4. Key decisions

| Decision | Choice |
| --- | --- |
| Scope | Generic, any duplicated path, per-path config |
| Discovery | Auto-detect paths with 2+ sources, opt in per path |
| Output target | Same path, dedicated source, raw sources untouched |
| Combining | Robust: median, trimmed mean, or mean, with kind-aware rejection and disagreement detection |
| Emit timing | Recompute on each input delta, rate-limited (leading edge) |
| Priority strategy | Approach C: emit alongside, user sets per-path priority once |
| Source observation | `registerDeltaInputHandler`, registered every `start()`, version-independent |
| Jump damping | Included in v1, optional, off by default |

## 5. Architecture overview

The plugin is TypeScript, compiled to `dist/`, and ships as a standard Signal K
node-server plugin. It is built from small, single-purpose modules. The
Signal-K-facing modules are thin; the math is pure and isolated for testing.

```
index.js                 module.exports = require('./dist/index.js')  (entry)
src/
  index.ts               plugin factory: lifecycle, handler registration, REST route, wiring
  config.ts              config types + pure validateConfig()
  pathClassifier.ts      classify a path: scalar | angular | position | other
  registry.ts            per-path, per-source latest sample + receipt time; staleness; source cap
  metrics.ts             pure kind-aware distance d(a, b): scalar, angular, geodesic-position
  combine.ts             pure per-cycle combine returning a CombineResult (section 9.8)
  damping.ts             pure jump rejection + output slew limiting (state passed in)
  emitter.ts             rate-limited emit via app.handleMessage
  status.ts              maps a CombineResult outcome to a setPluginStatus string
  schema.ts              dynamic, never-throwing schema() with detected-path options
  discovery.ts           tracks all observed (path -> set of sourceRefs) for detection and REST
  clock.ts               Clock interface { now(): number }; real impl wraps Date.now
```

Time is injected everywhere it is used (registry staleness, emitter rate limit,
damping) through a `Clock`, so tests are deterministic. The production clock wraps
`Date.now()`; tests pass a manually advanced counter.

The design uses **no timers**. Staleness is evaluated lazily at combine time, the
rate limit is a timestamp comparison, and emission is driven by incoming deltas.
There is nothing to leak or cancel.

### 5.1 Runtime state

All mutable state lives on instance fields, keyed by the raw self path string,
rebuilt in `start()`, and cleared in `stop()`:

| State | Shape |
| --- | --- |
| `registry` | `Map<path, Map<sourceRef, { value, receiptTs }>>` |
| `discovery` | `Map<path, Set<sourceRef>>` |
| `lastEmit` | `Map<path, ts>` |
| `classification` | `Map<path, kind>` (cached scalar/angular/position/other) |
| `jumpState` | `Map<path, Map<sourceRef, { lastAccepted: { value, ts }, pending?: { value, ts, count } }>>` |
| `slewState` | `Map<path, { lastValue, ts }>` |
| `runtimeConfig` | resolved per-path settings, the opted-in path `Set`, the emit-label `Set`, and the captured `app.selfContext` |

The REST route state reads live `discovery`. The route itself is registered once
for the plugin's lifetime (section 15), unlike the delta handler.

## 6. Source observation and feedback prevention

The plugin observes every source by registering a single delta input handler on
each `start()`:

```ts
app.registerDeltaInputHandler((delta, next) => {
  observe(delta)   // update registry/discovery for opted-in self paths only
  next(delta)      // never drop: Approach C is observe-only
})
```

Verified against signalk-server (2.28.0-beta.2 source and `@signalk/server-api`):

- The handler intercepts all deltas before server processing, regardless of server
  version, so it works on 2.27.x. This avoids `sourcePolicy: 'all'`, which for
  plugin subscriptions only forwards correctly on server 2.28.0 and newer and
  silently degrades to a single source on older servers.
- The server registers the handler on its delta chains and **auto-unregisters it on
  every `stop()`** (the loader pushes the unregister into the plugin's stop
  handlers, which run before `plugin.stop()`). Therefore the plugin registers the
  handler on **every** `start()` with no guard flag, and does not try to keep one
  handler alive across restarts. A register-once guard would leave the plugin
  permanently deaf after the first config save. `start()` captures `runtimeConfig`
  in the handler's closure.
- Context: only self deltas are combined. By the time the handler runs, the server
  has rewritten `'vessels.self'` to the expanded self context, so the filter is
  `delta.context === app.selfContext || delta.context === undefined`, not a literal
  `'vessels.self'`. `app.selfContext` is captured in `start()`.
- Delta shape: `delta.updates[]` are `Update` objects carrying `$source` and
  `timestamp` at the update level, and `values: { path, value }[]`. There is no
  per-value `$source`. The loop reads `update.$source` once, skips meta-only updates
  (`hasValues(update)` is false), and iterates `update.values`.
- Feedback loop: the plugin emits on the same path, so its own delta re-enters the
  handler synchronously (section 10.1). `observe()` ignores any update whose
  `$source` is one the plugin emits. The emit-label `Set` is built in `start()`
  (the plugin id plus any configured per-path suffix); the filter is
  `$source === pluginId || $source.startsWith(pluginId + '.')`. The trailing dot
  prevents a foreign source id that merely begins with the plugin id from matching.
  This filter is the loop guard and is load-bearing (section 10.1).

## 7. Configuration

### 7.1 Global options

| Option | Default | Meaning |
| --- | --- | --- |
| `defaultStalenessTimeoutMs` | `1000` | A source whose last receipt is older than this is excluded from combining. Per-path overridable. |
| `defaultEmitMinIntervalMs` | `1000` | Minimum interval between synthetic emits for a path. Per-path overridable. |
| `defaultMinSources` | `2` | Minimum fresh sources required to emit a combined value. Per-path overridable; `1` enables single-source passthrough. |
| `maxSourcesPerPath` | `16` | Global cap on tracked sources per path, guarding sourceRef accumulation. Validated once at the global level. |

### 7.2 Per-path options

| Option | Default | Meaning |
| --- | --- | --- |
| `path` | required | Picked from detected multi-source paths, or free text. |
| `method` | `median` | `median` \| `trimmedMean` \| `mean`. Ignored for angular paths (section 9.3). |
| `trimFraction` | `0.25` | Used only by `trimmedMean`; floors to median or mean at small N (section 9.5). |
| `outlierRejection` | `true` | Kind-aware rejection (section 9.6). |
| `madThreshold` | `3` | Sigma-equivalent multiplier for scaled-MAD rejection when N >= 4. |
| `rejectThreshold` | unset | Absolute rejection distance in kind units (meters, value units, or radians). Used at small N or when the robust scale is degenerate (section 9.6). |
| `disagreeThreshold` | unset | Absolute distance in kind units above which the sources are flagged as disagreeing (section 9.7). |
| `angularSpreadThreshold` | `pi/2` | Angular paths: max circular pairwise spread (radians) above which the value is suppressed as divergent (section 9.3). |
| `angular` | `auto` | `auto` \| `yes` \| `no`. `auto` resolves via section 9.2. |
| `includeSources` | unset | If set, only these sourceRefs are combined. |
| `excludeSources` | unset | If set, these sourceRefs are excluded. |
| `minSources` | inherits global | Per-path override. |
| `stalenessTimeoutMs` | inherits global | Per-path override. |
| `emitMinIntervalMs` | inherits global | Per-path override. |
| `jumpRejection` | unset (off) | `{ maxRate, persistSamples, persistMs }` per-source jump rejection (section 9.6.1). |
| `slewLimit` | unset (off) | Max change of the emitted value per second, in kind units (section 9.6.2). |

### 7.3 Validation

`validateConfig(options)` is pure and is the authoritative gate, called at the top
of `start()`. It must not assume the form enforced anything, because config can
also arrive through the REST config API. `schema()` (section 15) encodes enums and
obvious numeric bounds for form-time hints; on any conflict `validateConfig` wins.
Each path entry is validated independently; a failing entry is skipped, logged, and
named in the status. Rules:

- `includeSources` and `excludeSources` must not both be non-empty: skip the path with an explicit error.
- `madThreshold` set while `outlierRejection` is `false`: keep the path, emit a config advisory (the value is ignored).
- `defaultStalenessTimeoutMs`, `defaultEmitMinIntervalMs`, `stalenessTimeoutMs`, `emitMinIntervalMs`, `minSources`, and `maxSourcesPerPath` must be positive finite numbers.
- `method` must be one of the three known methods; `angular` one of the three known modes.
- `trimFraction` must be in `[0, 0.5)`.
- `rejectThreshold`, `disagreeThreshold`, `angularSpreadThreshold`, and `jumpRejection.maxRate` must be positive finite when set.
- Duplicate `path` entries: keep the first, warn on the rest.

## 8. Path classification

`pathClassifier.ts` maps a path plus the runtime value plus metadata to one of
`scalar`, `angular`, `position`, or `other`, and the result is cached in
`classification`:

- `position`: value is an object with finite `latitude` and `longitude` (degrees, the Signal K position unit). Combined per section 9.4.
- `angular`: resolved per section 9.2.
- `scalar`: a finite number that is not angular.
- `other`: any object that is not a position (for example `navigation.attitude`,
  `environment.current`), or a non-numeric value (enumeration, boolean, string).
  Skipped, logged once per path, and named in the status.

## 9. Combining math

`combine.ts` and `metrics.ts` are pure and dependency-free. The cross-cutting
principle, after review, is a **single value-scale distance per kind**, used for
rejection and disagreement alike, so the math is well-defined at the two to four
sources a real boat has:

- scalar: `d(a, b) = |a - b|` (value units).
- angular: `d(a, b) = |atan2(sin(a - b), cos(a - b))|` (radians, circular).
- position: `d(a, b) =` geodesic (haversine) distance in meters.

### 9.1 General flow per cycle

1. Drop stale samples (receipt older than the path's staleness timeout, by the injected clock).
2. Drop non-finite or wrong-typed samples.
3. Apply `includeSources` / `excludeSources`.
4. Determine `effectiveMin = minSources`. If `freshCount < effectiveMin`: if `freshCount === 1` and `effectiveMin <= 1`, pass the single value through with outcome `singleSource`; else emit nothing with outcome `belowMin` (or `allStale` when `freshCount === 0`).
5. Optionally apply per-source jump rejection (section 9.6.1) before combining.
6. Reject whole-source outliers (section 9.6), then combine the survivors by the chosen method (angular always circular mean, section 9.3).
7. Set the disagreement outcome (section 9.7).
8. Apply the output slew limit (section 9.6.2) if configured.

### 9.2 Angular detection

`angular: auto` resolves to angular only when the path is on a known-circular
allowlist AND its metadata units are exactly `'rad'`:

```
navigation.headingTrue, navigation.headingMagnetic,
navigation.courseOverGroundTrue, navigation.courseOverGroundMagnetic,
environment.wind.angleApparent, environment.wind.angleTrueWater,
environment.wind.angleTrueGround
```

Units are read via `app.getMetadata(delta.context + '.' + path)` (the argument must
be context-prefixed, for example `vessels.self.navigation.headingTrue`; a bare path
misses the registry). For allowlisted paths the server's built-in metadata registry
already carries `units: 'rad'` with no source required, so detection resolves from
the first delta. The exact `=== 'rad'` test excludes `'rad/s'`. Radian paths that
are not circular (`navigation.rateOfTurn`, `navigation.attitude.*`,
`steering.rudderAngle`, `navigation.magneticVariation`) are treated as scalar. The
per-path `angular: yes | no` override always wins. If `auto` cannot resolve
(off-allowlist with absent metadata), it falls back to scalar and logs once.

### 9.3 Angular combining and divergence

For angular paths the combiner is **always the circular mean**
(`atan2(sum sin, sum cos)`); the `method` field is ignored and a config advisory is
surfaced. Two divergence guards, in order:

- Antipodal or degenerate collapse: `R = hypot(sumSin, sumCos) / N`. If `R` is below
  `0.2` the mean direction is meaningless (for example two sources 180 degrees
  apart). Suppress with outcome `diverged`. `atan2(0, 0)` is never emitted as a
  heading.
- Wide spread: if the maximum circular pairwise difference exceeds
  `angularSpreadThreshold` (default `pi/2`), suppress with outcome `diverged`. This
  catches a fanned set such as North, East, and South that the `R` guard alone
  passes. Both guards are independent of N.

Outlier rejection on angular paths uses circular differences from the circular mean,
so it does not misfire at the 0 to 2pi wrap.

### 9.4 Position combining

Latitude is combined with the chosen linear method (median by default); it is sound
everywhere including high latitude, because it is bounded, never wraps, and the
antenna-scale spread is tiny. Longitude is combined circularly (degrees to radians,
`atan2(sum sin, sum cos)`, back to degrees), so a fix straddling the +/-180
antimeridian does not average to mid-Pacific. Both components must be finite for a
source to contribute. Outlier rejection for position is **whole-source by geodesic
distance** from the component-wise median centroid (section 9.6), never per-axis, so
the result is always a real convex combination of surviving fixes and never a
phantom coordinate that no source reported. Position lat/lon in degrees is the one
place degrees legitimately appear; every angular path elsewhere is radians.

### 9.5 Trimmed mean and small N

`trimmedMean` sorts, drops `floor(N * trimFraction)` from each end, and means the
rest. At the default `trimFraction = 0.25`: N = 4 trims one each end and means the
middle two; N = 3 trims none and equals the mean; N = 2 floors to the mean; N = 1 is
the single value. Documented so small-N behavior is explicit.

### 9.6 Outlier rejection (kind-aware, whole-source)

Rejection always operates on the scalar **distance of each source from a robust
center** (scalar median, circular mean for angular, or geodesic distance from the
component-median centroid for position), so it is one-dimensional and well-defined,
and for position it is inherently whole-source. A source is rejected when its
distance from the center exceeds a threshold `T`, chosen as:

- `N >= 4` and the distances are not all equal: `T = madThreshold * 1.4826 * MAD(distances)` (scaled MAD, sigma-equivalent).
- `N < 4`, or all distances equal (`MAD = 0` but values differ falls here too): if `rejectThreshold` is set, `T = rejectThreshold`; otherwise no rejection (the robust method carries it). This removes the MAD degeneracies: the constant-ratio no-op at N = 2, and the `MAD = 0` blind spot at N = 4 to 6 where bit-identical inliers (common with integer-quantized sensors) would otherwise hide a gross outlier.

Survivors are then combined by the chosen method.

#### 9.6.1 Jump rejection (optional, off by default)

Per source, `jumpState` holds `lastAccepted { value, ts }` and an optional
`pending { value, ts, count }`. On a new sample `s` at time `t`, the implied rate is
`d(s, lastAccepted.value) / (t - lastAccepted.ts)` (kind distance). If the rate is
within `jumpRejection.maxRate`, accept `s`, update `lastAccepted`, clear `pending`.
Otherwise it is a candidate jump: compare `s` to `pending.value`; if it is within
tolerance of the pending level (the new readings cluster near each other, not near
the stale anchor), increment `pending.count`, else start a new `pending`. When
`pending.count >= persistSamples` (default 2) or `t - pending.ts >= persistMs`
(default 3000), accept the new level and advance `lastAccepted`. This rejects a lone
multipath spike but re-accepts a genuine step change (engine start, depth shelf, hard
turn) instead of freezing the source at its old value.

#### 9.6.2 Slew limit (optional, off by default)

Clamp how far the emitted value may move from `slewState.lastValue` per second,
measured against the previous **emit** time (so a sparse rate limit does not amplify
lag). It trades step fidelity for spike smoothing: a true step of size `S` takes
`S / slewLimit` seconds to track. Recommended only where genuine steps are rare;
documented as such.

### 9.7 Disagreement detection

Independent of rejection and of the emitted value. After combining, if
`disagreeThreshold` is set and the maximum pairwise kind distance among the used
sources exceeds it, the outcome is `disagree`. The value is still emitted (the
chosen robust method, median by default, withstands a single outlier even at N = 3),
and the status narrates the disagreement so a stuck or biased sensor is visible. When
`disagreeThreshold` is unset, no small-N disagreement is reported. This replaces the
earlier MAD-based small-N test, which was mathematically inert at N = 2 and unstable
at N = 3.

### 9.8 Combine result contract

`combine()` returns:

```ts
type Outcome = 'ok' | 'singleSource' | 'belowMin' | 'allStale' | 'diverged' | 'disagree' | 'skipped'
interface CombineResult {
  value?: number | { latitude: number; longitude: number }  // absent unless ok | singleSource | disagree
  usedSources: string[]
  freshCount: number
  outcome: Outcome
}
```

`status.update(path, result)` consumes `outcome` directly (section 16). There is no
standalone `diverged` boolean; divergence is the `diverged` outcome.

## 10. Data flow

```
all deltas
  -> registerDeltaInputHandler (registered this start())
       -> observe(delta):
            if delta.context not self and not undefined: return
            for each update in delta.updates:
              if not hasValues(update): continue            // skip meta-only
              src = update.$source
              if emitLabelSet matches src: continue          // self-source loop guard
              for each { path, value } in update.values:
                if path not in optedInSet: continue
                registry.update(path, src, value, clock.now())
                maybeEmit(path)
       -> next(delta)                                        // always
```

`maybeEmit(path)`: if `clock.now() - lastEmit[path] < emitMinIntervalMs`, return.
Otherwise classify (cached), gather fresh sources, run `combine()`, then if the
result has a value: set `lastEmit[path] = clock.now()` and call `emitter.emit`. The
`lastEmit` and registry mutations complete before `emit` (section 10.1). Always call
`status.update(path, result)`.

### 10.1 Synchronous re-entrancy

`emitter.emit` calls `app.handleMessage`, which processes the synthetic delta
synchronously on the current stack, re-invoking the same handler before the original
`next(delta)` returns. This does not loop because the server stamps the synthetic
`update.$source` to the plugin label before the chain, so the self-source filter in
`observe()` skips it. The filter is therefore load-bearing: if `observe()` ever
acted before the filter, the result is unbounded synchronous recursion (a stack
overflow), not a slow loop. Registry and `lastEmit` are updated before the emit, so
the re-entrant pass sees consistent state.

## 11. Source priority onboarding (manual, required)

Approach C emits the synthetic value as an extra source. It does not win
automatically: with no priority override for a path, the server's resolution is
last-writer-wins, so the top-level value flickers across all sources, including the
synthetic one. The user must set priority once per path. This is documented as a
required step:

1. In the admin UI, open Server, then Data, then Sources (Source Priorities).
2. For the target path, place the synthetic source (the plugin id) at the top.
3. Set a timeout on the synthetic source, so that if the plugin stops emitting the
   model falls back to a raw source rather than displaying a stale synthetic value.

The README carries this as a numbered section with a screenshot of the priority
panel. The plugin status echoes the one-line instruction at opt-in time. The README
does not imply the synthetic value wins on install.

## 12. Emit shape and source label

- Scalar and angular: `{ path, value: <SI number> }`, radians for angular.
- Position: `{ path, value: { latitude, longitude } }`, degrees.
- Source label: the plugin sets `update.$source` directly as a bare string. The
  default is the plugin id. An optional per-path suffix (for example
  `signalk-synthetic-values.median`) is allowed; setting `$source` directly takes the
  string as-is without the server's `source.label` regex normalization, and the
  feedback filter prefix-matches the plugin id (section 6). The implementation uses
  the direct-`$source` form, not a `source.label` object.
- No metadata or units are emitted; the path already has metadata from the raw
  sources. (Input metadata is read for classification; this is the output side.)
- The timestamp is omitted, so the server stamps the compute time, which is the
  honest time of the synthetic value rather than the newest input's time.
- Context is omitted; the server defaults it to the self context.

## 13. Error handling

- Null or NaN value: ignored for that cycle. A present path with a null value still
  reaches the handler (the server only drops updates with a missing or null path
  upstream), so this guard is required.
- A source that sends a value then null: treated as no fresh sample; ages out by staleness.
- Non-numeric or unrecognized-object path (`other`): skipped, logged once, named in status.
- Partial position (missing or non-finite latitude or longitude): that source skipped this cycle.
- Config entry whose path has fewer than two sources at runtime: kept, status notes it is waiting for a second source.
- `observe()` and `combine()` are wrapped in the plugin's own try/catch, surfaced via
  `setPluginError` and `app.error`, so a math or data fault never propagates into the
  delta pipeline. The plugin does not rely on the server to catch its exceptions.
- `schema()` never throws: a throw lets the server overwrite saved config with a
  fallback schema (verified in the loader). The body is fully guarded and returns the
  static schema on any internal error.

## 14. Lifecycle

- `start(options)`: run `validateConfig`; build `runtimeConfig` (opted-in path set,
  per-path resolved settings, emit-label set, captured `app.selfContext`); reset every
  state map in section 5.1; register the delta input handler (every start, no guard,
  capturing the fresh closure); set the initial status.
- `stop()`: the server has already auto-unregistered the delta input handler (its stop
  handlers run before `plugin.stop()`), so the plugin only resets its state maps. No
  guard, no handler-neutering, no timers to clear.
- The server calls `stop()` then `start(newOptions)` on every config save. Because the
  handler is re-registered each `start()` and all state is rebuilt there, there are no
  duplicate or stale handlers and no doubled emits.
- The REST route (section 15) is registered once by the loader for the plugin's
  lifetime and reads live `discovery`, so it tolerates being hit while the plugin is
  stopped.

## 15. Discovery and schema

- `discovery.ts` records, for every observed self delta, the path and the set of
  sourceRefs seen. A path with two or more sourceRefs is "detected."
- `schema.ts` is a function. The server calls it on each `/plugins` render, so it
  returns the currently detected multi-source paths as enum options for the per-path
  `path` field, plus free-text entry for paths not yet detected. It never throws and
  returns the static schema on any internal error.
- A read-only endpoint is registered via `registerWithRouter` (mounted by the loader
  at `/plugins/signalk-synthetic-values`): `GET /plugins/signalk-synthetic-values/detected`
  returns `{ paths: [{ path, sources: string[], kind, optedIn }] }`, unauthenticated,
  reading live `discovery`. This is the fallback when the dynamic enum is empty on a
  cold boot, and a diagnostic. The schema `description` names this exact route. The
  route does not collide with the reserved `/plugins/<id>` and `/plugins/<id>/configure`.
- The enum does not live-refresh while the config page is open; the README notes a reload picks up newly detected paths.

## 16. Status narration

`status.ts` maps the live state to short `setPluginStatus` strings, so the plugin
never looks broken while working correctly. This is the exhaustive catalog:

- No detected multi-source paths: "No multi-source paths detected yet (need 2+ sources on a path)."
- Opted in, priority not yet set: "Combining N sources on `<path>`. Set this path's source priority to prefer `<source>` in Server, Data, Sources."
- `singleSource`: "`<path>`: running on 1 source, redundancy lost."
- `belowMin` / `allStale`: "`<path>`: waiting for `<effectiveMin>` sources (have K)."
- `diverged`: "`<path>`: sources diverge, synthetic value suppressed."
- `disagree`: "`<path>`: sources disagree (max spread `<d>`), emitting `<method>`."
- Skipped paths (validation conflict, `madThreshold`-while-off advisory, duplicate path, `other` kind): a comma-joined "skipped: `<path>` (`<reason>`)" suffix.
- Healthy: "Combining N sources on M paths."

The plugin is not enabled by default; it is a no-op until a human opts in and sets priority.

## 17. Testing (Vitest)

Pure modules carry the bulk of the coverage:

- `metrics.ts`: scalar, circular angular, and geodesic position distances, including the +/-180 longitude pair and a high-latitude pair.
- `combine.ts`: linear median, trimmed mean, and mean; circular mean with a cluster around 135 degrees (catches a swapped `atan2`); the two angular divergence guards (180 apart suppresses; the North, East, South fan suppresses on spread; a 0, 5, 355 cluster does not); position antimeridian safety; whole-source position rejection (no phantom fix for `mean`); kind-aware rejection with `N >= 4` scaled MAD, the `MAD = 0`-with-quantized-inliers outlier case, and the small-N `rejectThreshold` path; the small-N `disagree` outcome at N = 2 and 3; `singleSource` passthrough at `minSources = 1`; `belowMin` and `allStale`; trimmed-mean flooring at N = 1 through 4.
- `damping.ts`: jump rejection accepts steady motion, rejects a lone spike, and re-accepts a genuine step after `persistSamples` (scalar, angular, and position); slew limit clamps a surviving step and tracks over the documented `S / slewLimit` seconds.
- `registry.ts`: staleness eviction by injected clock; the `maxSourcesPerPath` cap; self-source filtering.
- `emitter.ts`: leading-edge rate limit against a mocked `app.handleMessage`; correct emit shape for scalar, angular, and position; `$source` set as a bare string.
- A feedback round-trip test: an emitted delta re-entering the handler is skipped by `observe()`, with no self-amplification.
- A stop/start test: state maps reset and a fresh handler closure is used, with no doubled emit.
- `config.ts`: every validation rule, the include/exclude conflict, and the advisory cases.
- `pathClassifier.ts`: scalar, angular allowlist intersected with units, position, and other; `app.getMetadata` consulted with a context-prefixed path.

## 18. Packaging and release

- `package.json`: `main: dist/index.js`; `files: ["dist", "assets", "README.md", "CHANGELOG.md", "LICENSE"]`; `@signalk/server-api` in `devDependencies` only; `engines.node >= 22`; `license: "Apache-2.0"` (matches the author's other Signal K plugins).
- `tsconfig.json`: target ES2022, CommonJS modules (the 2.27.x plugin loader uses `require`), `moduleResolution: node`, `strict: true`, declarations off. `index.js` is `module.exports = require('./dist/index.js')`.
- Build at publish only: `"prepublishOnly": "npm run build"` running `tsc` to `dist/` and the test suite. No `prepare` or `prepack` script (it corrupts the App Store install simulation in CI). Git hooks, if wanted, go through a manual non-lifecycle script.
- Cross-platform scripts: a Node-based clean, no unix-only `rm`, clean `npm pack` stdout.
- `signalk` manifest: `displayName` "Synthetic Values"; a benefit-stating `description` ("combine redundant sensors on one path into a robust median or outlier-rejected value"); `appIcon` (square PNG, at least 512x512, at `assets/appicon.png`); and `screenshots` referenced at their shipped tarball paths under `assets/screenshots/`. Verify inclusion with `npm pack --dry-run`. Screenshots: the config form with a detected path opted in, the data browser showing raw and synthetic sources on one path, and the source-priority panel mid-setup.
- Keywords: `signalk-node-server-plugin`, `signalk-category-utility`, plus `signalk`, `redundancy`, `sensor-fusion`, `median`, and `outlier`. Not the instruments or nmea-2000 category keywords; the plugin is path-agnostic.
- `signalk.recommends`: omitted for the initial release. No current companion plugin genuinely consumes a synthetic source as a data-flow pairing. Re-evaluate per release.
- `.github/workflows/plugin-ci.yml` calling the reusable Signal K plugin-ci lands in the first commit set, so the published commit carries a green matrix run across the declared Node versions on Linux, macOS, and Windows.
- `CHANGELOG.md` in Keep-a-Changelog format with a dated, anchored entry per version, written first. The README "What's new" section holds only the latest release, overwritten each release. README documents App-Store-first install, every schema option, and the priority onboarding step.

## 19. Project layout

```
signalk-synthetic-values/
  index.js
  package.json
  tsconfig.json
  README.md
  CHANGELOG.md
  LICENSE
  src/                  (modules from section 5)
  test/                 (Vitest specs mirroring src)
  assets/
    appicon.png
    screenshots/
  .github/workflows/plugin-ci.yml
  docs/superpowers/specs/2026-06-23-synthetic-values-design.md
```

## 20. Open questions and future work

- Jump damping and the absolute `rejectThreshold` / `disagreeThreshold` defaults are
  off or unset; sensible per-path values will be tuned against real data after first runs.
- If component-wise position ever proves insufficient (it should not at antenna scale),
  a geodesic or ECEF mean can replace section 9.4 without touching the rest.
- A custom config webapp could replace the dynamic-schema discovery if the standard form proves limiting.

## Appendix A: verified Signal K API facts

Confirmed against signalk-server (2.28.0-beta.2 source) and `@signalk/server-api`:

- `registerDeltaInputHandler((delta, next) => ...)` intercepts all deltas before
  processing; not calling `next` drops the delta. The server returns an unregister and
  **auto-unregisters the handler on every plugin `stop()`** (stop handlers run before
  `plugin.stop()`), so the handler is registered on every `start()`.
- The handler receives `Delta { context?, updates: Update[] }`; each `Update` carries
  `$source` and `timestamp` at the update level and `values: { path, value }[]`. There
  is no per-value `$source`. Meta-only updates carry no `values`.
- Self deltas arrive with `delta.context === app.selfContext` (the expanded self MRN),
  not the literal `'vessels.self'`, because the server rewrites context before the chain.
- `handleMessage(pluginId, delta)` defaults `$source` to the plugin id; a bare
  `update.$source` string is taken as-is without regex validation, whereas a
  `source.label` is honored only if it matches `^[A-Za-z0-9-_.]+$` and is otherwise
  normalized to the plugin id. Omitting the timestamp lets the server stamp it; omitting
  context defaults to the self context. A re-entrant `handleMessage` runs synchronously.
- With no source-priority override for a path, resolution is last-writer-wins, so a
  newly emitted source does not automatically win.
- `sourcePolicy: 'all'` for plugin subscriptions is correctly forwarded only on server
  2.28.0 and newer; older servers silently deliver a single source. Observation uses
  `registerDeltaInputHandler` instead.
- `app.getMetadata(path)` returns built-in well-known metadata (including `units: 'rad'`
  for the allowlisted angular paths) and runtime meta; the argument must be
  context-prefixed (for example `vessels.self.navigation.headingTrue`).
- `registerWithRouter(router)` mounts at `/plugins/<pluginId>`; `/plugins/<id>` and
  `/plugins/<id>/configure` are reserved; Express has no public deregister, so the route
  persists across `stop()`.
- The server calls the plugin `schema()` on each `/plugins` render inside a try/catch and
  can overwrite saved config with a fallback schema if `schema()` throws.
- App Store install skips install lifecycle scripts, so the build must run at publish, and
  a defined `prepare` script corrupts `npm pack --ignore-scripts` in CI.
