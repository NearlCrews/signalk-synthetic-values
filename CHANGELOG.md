# Changelog

All notable changes to the signalk-synthetic-values project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Configurator panel.** The Signal K admin UI now shows a dedicated configuration screen instead of the raw JSON form. The panel lists every detected multi-source path with its source count and kind (scalar, angular, or position). A "Combine" button opts a single path in immediately; "Combine all" opts in every combinable path with one click (with a confirmation step). Each opted-in path has a "Tune" disclosure that exposes the combining method, minimum sources, and a per-source include/exclude checklist; an "Advanced" sub-disclosure covers MAD threshold, reject threshold, disagree threshold, angular spread threshold, trim fraction, angular override, jump rejection, slew limit, staleness timeout, and emit interval. A priority banner reminds you to set Signal K source priority to prefer the synthetic source (the panel shows the instruction but does not set priority for you).
- **Config-independent multi-source path detection.** The plugin watches all incoming deltas and surfaces detected paths regardless of whether they are configured. Detected paths are available via `GET /plugins/signalk-synthetic-values/api/detected`.
- **"Combine all" skips paths that are not meaningful to average.** GNSS fix metadata (satellite count, dilution of precision, and differential-correction age and reference) describes a single receiver's solution, so it is detected but grouped under "Detected but not recommended" and left out of "Combine all". It can still be combined by hand.
- **Likely-duplicate source detection.** When two or more sources report identical values while the value is changing, the panel flags them as probably the same feed re-broadcast and suggests combining only one, so a re-broadcast feed does not outvote your independent sensors. Detection samples each source about once a second, so it adds no measurable cost to the delta path, and it never excludes a source automatically.

### Fixed

- Paths were only detected after being added to the configured paths list. Detection now runs for every observed delta, so the panel populates before any path is configured.
- The configuration panel crashed with "Cannot read properties of undefined" on a fresh install when no configuration had been saved yet. It now renders with defaults.
- Detected paths in the panel showed an "unknown" kind badge. They now report the correct scalar, angular, or position kind.
- The panel could show a stale save snapshot when a tuning change was made immediately after a Combine or Remove action.
- The schema description for the paths array cited the wrong discovery route URL; it now correctly points to `/api/detected`.

### Changed

- Angular paths (headings and bearings) now honor the combining method. `median` (the default) uses the circular medoid, the reading closest to the others, so a single off compass cannot drag the result; `mean` uses the circular mean. Previously angular paths always used the circular mean and ignored the method.
- The plugin status line now shows one stable summary (how many paths are combining, plus counts of any waiting, diverging, disagreeing, or single-source paths) instead of cycling a separate message for every path on each emit. Per-path detail moved to the debug log.
- Shared style tokens extracted into a module; component styles now reference tokens rather than inlined values.
- Duplicate helper functions deduplicated across the combining and registry modules.
- Build output is now deterministic across runs.
- Test coverage expanded from 122 to 252 tests; new tests cover the config panel components, the per-path settings form, the detected-path row states, the aggregate status summary, the circular medoid, the combinability list, and duplicate-source detection.

<a id="v010"></a>

## [0.1.0] - 2026-06-23

Initial release. The plugin watches all sources on opted-in Signal K paths and
combines them into a single robust synthetic value, emitting it as an additional
source so raw sensor data is never replaced.

### Added

- **Median, trimmed mean, and mean combining.** Choose the method per path via `method`; median is the default and requires no tuning. Trimmed mean trims a configurable `trimFraction` from each end and falls back to median or mean at small N.
- **Kind-aware outlier rejection.** Enabled by default (`outlierRejection: true`). Uses scaled-MAD whole-source rejection with a configurable `madThreshold` (default 3) at four or more sources, and a configured `rejectThreshold` for absolute-distance rejection at smaller N or when the robust scale is degenerate.
- **Angular path support.** Paths with radian units or on the known-circular list (headings, bearings, course over ground) use circular mean to avoid the 0/360-degree wrap artifact. A configurable `angularSpreadThreshold` (default pi/2 radians) suppresses the synthetic value when the circular pairwise spread is too large, for example when sensors point in opposite directions.
- **Position path support.** Latitude/longitude pairs combine to the geodesic centroid with per-source distance-based outlier rejection, so a phantom GPS fix does not drag the result.
- **Auto-detection of multi-source paths.** The plugin observes incoming deltas and surfaces paths with two or more distinct sourceRefs, available as a dropdown in the config form and via `GET /plugins/signalk-synthetic-values/api/detected`.
- **Staleness timeout.** Sources older than `defaultStalenessTimeoutMs` (default 1000 ms, per-path overridable) are excluded from combining.
- **Disagreement detection.** When `disagreeThreshold` is set, sources that spread beyond that distance are flagged in the plugin status while a combined value is still emitted.
- **Jump rejection.** Optional per-source `jumpRejection: { maxRate, persistSamples, persistMs }` holds back a sudden spike and re-accepts it after a genuine step is confirmed over the persistence window.
- **Slew limiting.** Optional per-path `slewLimit` caps the maximum change of the emitted value per second in kind units, suppressing runaway jumps that survive outlier rejection.
- **Source include/exclude filters.** `includeSources` and `excludeSources` limit or skip named sourceRefs per path.
- **Full config validation.** `validateConfig` is pure and runs at every `start()`. Failing path entries are skipped and named in the status without stopping the plugin.
- **Tests** across combining math, damping, registry staleness, emitter shape, config validation, path classification, feedback prevention, and stop/start lifecycle.
