# Changelog

All notable changes to the signalk-synthetic-values project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<a id="v010"></a>

## [0.1.0] - 2026-06-23

Initial release. The plugin watches all sources on opted-in Signal K paths and
combines them into a single robust synthetic value, emitting it as an additional
source so raw sensor data is never replaced.

### Added

- **Median, trimmed mean, and mean combining.** Choose the method per path via `method`; median is the default and requires no tuning. Trimmed mean trims a configurable `trimFraction` from each end and falls back to median or mean at small N.
- **Kind-aware outlier rejection.** Enabled by default (`outlierRejection: true`). Uses scaled-MAD whole-source rejection with a configurable `madThreshold` (default 3) at four or more sources, and a configured `rejectThreshold` for absolute-distance rejection at smaller N or when the robust scale is degenerate.
- **Angular path support.** Paths with radian units or on the known-circular list (headings, bearings, course over ground) combine without the 0/360-degree wrap artifact and honor the combining method: `median` (the default) and `trimmedMean` use the circular medoid, the reading closest to the others, so one off compass cannot drag the result, while `mean` uses the circular mean. A configurable `angularSpreadThreshold` (default pi/2 radians) suppresses the synthetic value when the circular pairwise spread is too large, for example when sensors point in opposite directions.
- **Position path support.** Latitude/longitude pairs combine to the geodesic centroid with per-source distance-based outlier rejection, so a phantom GPS fix does not drag the result.
- **Attitude path support.** The `navigation.attitude` object combines roll, pitch, and yaw independently as angular components. A source that is off on any axis is rejected, and the synthetic value is suppressed when any axis is too scattered. Several motion sensors fuse into one attitude that you then prefer by source priority.
- **Auto-detection of multi-source paths.** The plugin watches all incoming deltas and surfaces paths with two or more distinct sourceRefs, regardless of whether they are configured. Detected paths are available as a dropdown in the config panel and via `GET /plugins/signalk-synthetic-values/api/detected`.
- **Configurator panel.** The Signal K admin UI shows a dedicated configuration screen instead of the raw JSON form. The panel lists every detected multi-source path with its source count and kind (scalar, angular, or position). A "Combine" button opts a single path in immediately; "Combine all" opts in every recommended path with one click (with a confirmation step). Each opted-in path has a "Tune" disclosure that exposes the combining method, minimum sources, and a per-source include/exclude checklist; an "Advanced" sub-disclosure covers MAD threshold, reject threshold, disagree threshold, angular spread threshold, trim fraction, angular override, jump rejection, slew limit, staleness timeout, and emit interval. A priority banner reminds you to set Signal K source priority to prefer the synthetic source (the panel shows the instruction but does not set priority for you).
- **"Combine all" skips paths that are not meaningful to average.** GNSS fix metadata (satellite count, dilution of precision, and differential-correction age and reference) describes a single receiver's solution, so it is detected but grouped under "Detected but not recommended" and left out of "Combine all". It can still be combined by hand.
- **Likely-duplicate source detection.** When two or more sources report identical values while the value is changing, the panel flags them as probably the same feed re-broadcast (for example a GPS forwarded by an autopilot under a second source name) and suggests combining only one, so a re-broadcast feed does not outvote your independent sensors. Detection samples each source about once a second, so it adds no measurable cost to the delta path, and it never excludes a source automatically.
- **Single stable status line.** The admin UI shows one summary of the whole plugin (how many paths are combining, plus counts of any waiting, diverging, disagreeing, or single-source paths) rather than cycling a separate message for every path on each emit. Per-path detail goes to the debug log.
- **Staleness timeout.** Sources older than `defaultStalenessTimeoutMs` (default 1000 ms, per-path overridable) are excluded from combining.
- **Disagreement detection.** When `disagreeThreshold` is set, sources that spread beyond that distance are flagged in the plugin status while a combined value is still emitted.
- **Jump rejection.** Optional per-source `jumpRejection: { maxRate, persistSamples, persistMs }` holds back a sudden spike and re-accepts it after a genuine step is confirmed over the persistence window.
- **Slew limiting.** Optional per-path `slewLimit` caps the maximum change of the emitted value per second in kind units, suppressing runaway jumps that survive outlier rejection.
- **Source include/exclude filters.** `includeSources` and `excludeSources` limit or skip named sourceRefs per path.
- **Full config validation.** `validateConfig` is pure and runs at every `start()`. Failing path entries are skipped and named in the status without stopping the plugin.
- **Tests** across combining math, the circular medoid, damping, registry staleness, emitter shape, config validation, path classification, the combinability list, duplicate-source detection, the aggregate status summary, the config panel components, the per-path settings form, the detected-path row states, feedback prevention, and the stop/start lifecycle. The suite is 273 tests across 24 files.
