# Changelog

All notable changes to the signalk-synthetic-values project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- **Auto-detection of multi-source paths.** The plugin observes incoming deltas and surfaces paths with two or more distinct sourceRefs, available as a dropdown in the config form and via `GET /plugins/signalk-synthetic-values/detected`.
- **Staleness timeout.** Sources older than `defaultStalenessTimeoutMs` (default 1000 ms, per-path overridable) are excluded from combining.
- **Disagreement detection.** When `disagreeThreshold` is set, sources that spread beyond that distance are flagged in the plugin status while a combined value is still emitted.
- **Jump rejection.** Optional per-source `jumpRejection: { maxRate, persistSamples, persistMs }` holds back a sudden spike and re-accepts it after a genuine step is confirmed over the persistence window.
- **Slew limiting.** Optional per-path `slewLimit` caps the maximum change of the emitted value per second in kind units, suppressing runaway jumps that survive outlier rejection.
- **Source include/exclude filters.** `includeSources` and `excludeSources` limit or skip named sourceRefs per path.
- **Full config validation.** `validateConfig` is pure and runs at every `start()`. Failing path entries are skipped and named in the status without stopping the plugin.
- **122 tests** across combining math, damping, registry staleness, emitter shape, config validation, path classification, feedback prevention, and stop/start lifecycle.
