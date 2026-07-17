# Changelog

All notable changes to the signalk-synthetic-values project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

<a id="v040"></a>

## [0.4.0] - 2026-07-16

This release modernizes the configuration panel, hardens runtime validation and
sensor combining, and expands production-package validation. Existing valid
saved configurations remain compatible.

### Added

- Added production Module Federation remote checks that verify host-shared React, bundled shared UI code, generated panel assets, and package contents.
- Added browser coverage for configuration saves, failed-save recovery, theme migration, keyboard focus, narrow layouts, coarse-pointer targets, accessibility, and unsupported browser handling across Chromium, Firefox, WebKit, and mobile Chromium.
- Added a browser fixture and screenshot workflow that load the built remote through a host-equivalent React share scope.
- Added Knip validation for dead files, exports, and dependencies.
- Added backend-test type checking, coverage thresholds, and live Signal K verification for the detected-path API.

### Fixed

- Corrected source-priority guidance for the current Signal K Data, Priorities workflow, including group rankings, lower-ranked fallback timing, and optional path-level overrides.
- Detection now rejects malformed API payloads without crashing, keeps explicitly non-combinable rows out of Combine all, and prevents duplicate detected rows from creating duplicate path configuration.
- Manual detection refreshes now show a busy state, block duplicate activation, and keep Retry state clear while requests are active.
- Repeated row controls now include the Signal K path in their accessible names, while visible labels and layout remain unchanged.
- Browser fixtures now use the runtime's real default values instead of stale hardcoded placeholders.
- Builds no longer delete coverage output, CI and prepublish checks avoid a redundant browser-test rebuild, and package validation covers every declared JavaScript and type entrypoint plus the runtime source map.
- Declaration generation now invokes the TypeScript CLI through Node so official Windows plugin builds work alongside Linux and macOS builds.
- Successful refreshes now update the last-checked time, and manual refreshes announce completion even when the detected paths are unchanged.
- Source-filter checkboxes now use collision-safe IDs, clear the opposite filter model, and keep every live source excluded when the final include-only source is unchecked.
- Removed duplicated screen-reader row details and empty source groups, preserved complete source and kind labels, and aligned form controls' accessible names with their visible labels.
- Long path names now wrap at Signal K dot boundaries on narrow panels, row metadata stays grouped, and the priority reminder keeps a compact accessible dismiss action.
- Webpack now preserves public shared UI design tokens and the shared responsive container name inside CSS Modules, and generated CSS no longer ends with blank lines.
- Installed browser engines in the npm publish workflow so the cross-browser `prepublishOnly` gate can run.
- Browser test runs now rebuild the production remote before launching the host fixture.
- Cross-browser execution uses one worker and a fresh runner process per engine to avoid retained browser memory on Pi-class development and CI hosts.
- Full validation now builds before coverage so the generated coverage report remains available afterward.
- Verified every generated panel asset is packed and served with the expected content type.
- Configuration validation now handles null and malformed input without throwing, rejects incorrect field types, caps tracked sources at 64, requires `jumpRejection.maxRate`, and enforces the same bounds as the schema.
- Malformed deltas, invalid paths, and incorrect source types are skipped without aborting later values or bypassing the Signal K handler chain.
- Source filters now apply before configured classification and storage. Invalid or shape-changing samples remove that source's stale registry value, and mixed combinable shapes can no longer produce invalid synthetic output.
- Discovery and configured storage now share the source cap, trim immediately when the cap decreases, clear stale duplicate history, and require at least two changing feeds before flagging a duplicate group.
- Failed sends remain immediately retryable and no longer advance rate-limit, slew, or status state. Runtime intervals now use a monotonic clock so wall-clock changes cannot distort staleness or damping.
- Finite extreme scalar values no longer overflow mean or median calculations, absolute rejection remains a ceiling while MAD is active, and a one-source post-rejection result reports lost redundancy.
- Position slew limiting now follows a distance-capped great-circle step, position coordinates are range-checked, and robust methods use a circular longitude medoid instead of allowing one longitude outlier to drag the result.
- Plugin status starts configured paths as waiting, points to the current Data, Priorities workflow, and updates an outcome only after a successful synthetic send.

### Changed

- Updated the checked-in Node 22 runtime to 22.23.1.
- Kept the pre-commit hook offline-friendly by running focused type, lint, dead-code, and unit checks while retaining the complete validation gates before push and publish.
- Migrated the configuration panel to `signalk-nearlcrews-ui` 0.2.0, replacing duplicated theme, control, disclosure, banner, badge, layout, and form presentation.
- Moved consumer-specific styling into focused CSS modules that use only the shared UI's public design tokens.
- Migrated the legacy `skn-theme` preference into the shared theme key and added a clear compatibility message for browsers without native CSS `@scope`.
- Refreshed the configuration-panel screenshots and expanded package, runtime-audit, build, and prepublish validation.
- Documented the approved 24,000-byte gzip ceiling for the shared UI migration. The current production panel assets are 23,883 bytes gzip.
- Removed unused exports, the unused lint-staged configuration and dependency, and a redundant browser-test script.
- The npm package now ships only its supported root declaration instead of internal declaration files with no corresponding JavaScript exports.
- CI now uploads coverage once, enforces the clean dependency audit, runs version matrices independently, and applies timeouts and concurrency controls to analysis and publication jobs.

<a id="v031"></a>

## [0.3.1] - 2026-07-15

Development dependency and documentation maintenance release. Runtime behavior,
configuration validation, the data model, and the plugin API are unchanged.

### Changed

- Refreshed compatible transitive development dependencies and deduplicated the lockfile. Biome remains pinned to 2.5.2 because 2.5.3 and 2.5.4 can panic during type-aware panel linting while returning a successful exit status.
- Moved local, CI, and publish builds to Node 22 while retaining Node 20.18 as the published runtime minimum and in the official Signal K plugin compatibility lane.
- Corrected the configuration documentation to distinguish the controls available in the custom panel from options accepted by the runtime configuration.
- Updated development documentation for TypeScript 7 and the current Node toolchain requirement.

<a id="v030"></a>

## [0.3.0] - 2026-07-10

Correctness and configuration-safety release following a full repository review.

### Fixed

- Jump rejection now counts only new observations from each source. Cached samples revisited because another source emitted can no longer confirm a one-off jump.
- The configuration panel enforces the same numeric bounds as runtime validation, keeps configured paths visible while their sources are offline, and serializes saves so older writes cannot overwrite newer changes.
- Detection now reports non-combinable text and object paths, expires sources that stop reporting, and refreshes plugin status immediately when a configured path becomes non-combinable.

### Changed

- Position combining documentation now describes the implemented selected latitude statistic and circular-longitude estimate accurately.

<a id="v020"></a>

## [0.2.0] - 2026-07-04

Correctness and robustness release. A codebase-wide audit fixed several combining and configuration bugs, hardened the config panel against failed saves and stale responses, and tightened theme contrast and accessibility. Existing configurations keep working; a handful of previously silent misconfigurations now surface as validation errors, and a thin post-rejection consensus is now suppressed instead of emitted.

### Fixed

- A configured path that received one text or object sample was locked as non-combinable until a plugin restart. It now recovers as soon as combinable values arrive, and the stale "skipped" note clears from the status line.
- A `jumpRejection` config carrying only `maxRate` (saved by the panel's jump field, a REST write, or a hand-edited config.json) froze the damped value forever after the first spike, because the persistence check compared against missing fields. The validator now backfills `persistSamples` (default 3) and `persistMs` (default 5000), rejects invalid values, and the schema declares the same defaults.
- The jump-rejection "near" check divided the distance from the last pending sample by the time since the cluster origin, so a drift faster than `maxRate` grew ever more likely to be accepted as the cluster aged. It now uses the true per-step rate.
- Outlier rejection could whittle the used sources below `minSources` yet still emit with a healthy "ok" outcome. The result is now suppressed as diverged, keeping the redundancy guarantee honest.
- Position slew limiting stepped the wrong way around the antimeridian; the longitude delta is now wrapped so the step takes the short way.
- The admin-form schema accepted values the validator then rejected: 0 for `rejectThreshold`, `disagreeThreshold`, `angularSpreadThreshold`, `slewLimit`, and `jumpRejection.maxRate` (all now exclusive minimums), `trimFraction` of 0.5 and above (now bounded), and fractional source counts (now integers).
- `madThreshold` is validated (non-negative) instead of flowing into rejection unchecked, and a config missing the top-level defaults falls back to the shipped defaults instead of erroring every path.
- Config advisories (for example `madThreshold` set while outlier rejection is off) no longer mark a working path as "skipped" in the status line; they go to the debug log only.
- A failed save from the config panel was silently recorded as saved, masking the loss; it now rolls the baseline back and shows a banner with a Retry button.
- A failed detected-paths poll replaced the whole list with the error banner, unmounting every row. The banner now renders above the retained list, so open Tune panels, in-progress edits, and focus survive a transient blip.
- Overlapping detected-paths requests (poll, tab focus, and post-save refresh) could land out of order and overwrite fresher data with stale rows; responses are now sequenced.
- A configuration echoed back by the admin host after a save no longer wipes edits made while the save was in flight.

### Added

- `environment.wind.directionTrue`, `environment.wind.directionMagnetic`, and `navigation.headingCompass` are recognized as circular radian paths under `angular: auto`, so redundant wind vanes and compasses on those paths combine without the 0/360-degree wrap artifact.
- The panel announces a manual refresh to screen readers even when the list is unchanged, and the "Combine all" confirmation moves focus onto Confirm and back instead of dropping it.
- Tests covering the fixes above plus hook polling, save failure, and out-of-order responses: the suite grew from 273 to 301 tests across 26 files.

### Changed

- Theme contrast now meets WCAG AA on the accent pair: the light theme accent is a deeper blue, and dark-theme accent text is dark on the light-blue accent. Hover and active feedback brightens in the dark and night themes instead of darkening imperceptibly.
- The opted-in pill reads "combined", matching the Combine button and the documentation.
- Per-path placeholders show the resolved default values; the staleness and emit-interval placeholders previously showed numbers that did not match the real defaults.
- For angular paths `trimmedMean` and `median` are the same circular medoid; `trimFraction` has no effect there. This has always been the behavior and is now documented.
- Angular and attitude disagree checks reuse the spread already computed during combining instead of redoing the pairwise-distance work on every emit.

<a id="v012"></a>

## [0.1.2] - 2026-06-25

Maintenance release. Refreshes build-time dependencies with no change to runtime behavior, configuration, the data model, or the plugin API. Combined values, paths, and settings are identical to 0.1.1.

### Changed

- Updated development dependencies to their latest patch releases (`@types/node` 26.0.1 and `webpack` 5.108.0). These cover the build and type-check toolchain only; the published runtime is unchanged.

<a id="v011"></a>

## [0.1.1] - 2026-06-25

Maintenance release. Internal code-quality cleanup with no change to combining behavior, configuration, the data model, or the plugin API. Combined values, paths, and settings are identical to 0.1.0.

### Changed

- The config panel shows a clearer message ("could not load detected paths") when the detected-paths request fails.
- Consolidated duplicated logic into shared helpers without changing behavior: degree and radian conversion, plural suffixing, numeric-input parsing, the expand and collapse disclosure used across the panel, the pill style variants, and the oldest-entry eviction scan.
- Tightened types so the kind-badge table and the detected-path kind are checked against the combine kinds at compile time.

### Removed

- Dead code: two unused CSS theme tokens, an unused error-formatting helper, and a redundant serialize and parse round-trip on each detected-paths poll.

<a id="v010"></a>

## [0.1.0] - 2026-06-23

Initial release. The plugin watches all sources on opted-in Signal K paths and
combines them into a single robust synthetic value, emitting it as an additional
source so raw sensor data is never replaced.

### Added

- **Median, trimmed mean, and mean combining.** Choose the method per path via `method`; median is the default and requires no tuning. Trimmed mean trims a configurable `trimFraction` from each end and falls back to median or mean at small N.
- **Kind-aware outlier rejection.** Enabled by default (`outlierRejection: true`). Uses scaled-MAD whole-source rejection with a configurable `madThreshold` (default 3) at four or more sources, and a configured `rejectThreshold` for absolute-distance rejection at smaller N or when the robust scale is degenerate.
- **Angular path support.** Paths with radian units or on the known-circular list (headings, bearings, course over ground) combine without the 0/360-degree wrap artifact and honor the combining method: `median` (the default) and `trimmedMean` use the circular medoid, the reading closest to the others, so one off compass cannot drag the result, while `mean` uses the circular mean. A configurable `angularSpreadThreshold` (default pi/2 radians) suppresses the synthetic value when the circular pairwise spread is too large, for example when sensors point in opposite directions.
- **Position path support.** Latitude/longitude pairs combine with the selected latitude statistic and an antimeridian-safe circular longitude mean, with per-source geodesic-distance outlier rejection so a phantom GPS fix does not drag the result.
- **Attitude path support.** The `navigation.attitude` object combines roll, pitch, and yaw independently as angular components. A source that is off on any axis is rejected, and the synthetic value is suppressed when any axis is too scattered. Several motion sensors fuse into one attitude that you then prefer by source priority.
- **Auto-detection of multi-source paths.** The plugin watches all incoming deltas and surfaces paths with two or more distinct sourceRefs, regardless of whether they are configured. Detected paths are available as a dropdown in the config panel and via `GET /plugins/signalk-synthetic-values/api/detected`.
- **Configurator panel.** The Signal K admin UI shows a dedicated configuration screen instead of the raw JSON form. The panel lists every detected multi-source path with its source count and kind (scalar, angular, attitude, or position). A "Combine" button opts a single path in immediately; "Combine all" opts in every recommended path with one click (with a confirmation step). Each opted-in path has a "Tune" disclosure that exposes the combining method, minimum sources, and a per-source include/exclude checklist; an "Advanced" sub-disclosure covers MAD threshold, reject threshold, disagree threshold, angular spread threshold, trim fraction, angular override, jump rejection, slew limit, staleness timeout, and emit interval. A priority banner reminds you to set Signal K source priority to prefer the synthetic source (the panel shows the instruction but does not set priority for you).
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
