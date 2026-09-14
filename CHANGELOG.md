# Changelog

All notable changes to the signalk-synthetic-values project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Confidence notifications. Each combined path publishes
  `notifications.<path>` describing how much the published value can be
  trusted, so a consumer that reads only the value can still tell a clean
  four-sensor consensus from a value assembled after half the sensors were
  discarded. `alert` covers a suppressed value and a breach of the
  `disagreeThreshold` you set, `warn` covers a rejected sensor, a lone
  remaining source, a slew-limited output, a split sensor set, and a path that
  has run out of fresh sources, and `normal` clears a previous notification.
  Only an alert requests the `visual` method, so the plugin never asks the boat
  to make a sound, and `alarm` and `emergency` are never used. The new
  top-level `notifications` option switches the channel off.
- A split check that needs no units. With three or more readings, a combined
  value whose nearest reading is further away than a quarter of the whole
  spread means the sources have split into groups and the published value sits
  in the gap between them. The path reports as disagreeing and raises a
  notification, and the value is still published, because suppressing it needs
  a threshold in the path's own units. Setting `disagreeThreshold` replaces the
  check on that path. Position is excluded, because receivers at the bow and
  the stern are a legitimate pair of groups whose midpoint is the answer
  wanted.
- Duplicate feeds are collapsed before combining. One sounder forwarded by two
  gateways is two source names and one sensor, and left alone it votes twice,
  satisfies `minSources` on its own, and outvotes an independent sensor.
  Sources that report the same values while those values are changing are
  grouped and counted once. A feed quantized on the way round, such as this
  plugin's own output returning over NMEA 2000, is not an exact match and is
  documented as a configuration hazard instead.
- Angles are classified against the Signal K specification rather than a short
  allowlist plus metadata units. Full-circle quantities combine circularly even
  where the server resolves no units for them, the specification's bounded
  angles such as a rudder angle combine linearly, and a path reporting radians
  that is neither is named in the status line, logged once, marked in the panel
  row, and left out of "Combine all", because averaging a bearing linearly
  publishes the reciprocal.
- A path whose sources report less often than its staleness timeout says so.
  The status line already reported it as waiting for sources; the debug log and
  the panel row now give the measured reporting interval and name the setting
  to raise.
- The detected-path row separates live, stale, and excluded sources. A source
  that has stopped reporting reads "no data" and an excluded one reads
  "excluded", the count reads "2 of 3 sources combining" when they differ, and
  a combined path with nothing live reads "no live sources" instead of keeping
  its combined accent. Discovery lists a source for a minute while the combiner
  drops it after the staleness timeout, so the two disagree for up to 59
  seconds after a sensor dies.
- Sources past the first three sit behind a real disclosure control rather than
  a `title` tooltip, which a touch or keyboard user never sees.

### Changed

- The configuration panel now builds on `signalk-nearlcrews-ui` 0.11.1. The
  theme selector shows its "Panel theme" group label and names the two
  automatic choices for what they follow, "Match Admin" and "Match device",
  where they read "Auto" and "System" before. The save bar reads "All changes
  saved", "Save sent to the server", and "Save to enable the plugin", and a
  per-path number field that rejects a value now reads, for example, "Enter a
  number of 0 or more." instead of "Enter a number of at least 0.". Every
  field error leads with the danger tone mark and its spoken tone word, so an
  error no longer depends on the danger color alone, and the info tone the
  panel's notices use is painted in cyan rather than sharing the link color.
- The priority reminder takes its landmark name from its own visible title
  instead of repeating that title in a label of its own, which is what the
  shared banner now does for any banner given a landmark role.
- The panel size baseline is re-recorded at 47,933 gzip bytes, against 38,263
  on 0.9.0. The growth is the shared UI release, which the panel takes whole:
  no panel code was added in the same step, so the 5% growth band measures
  from the new figure.
- Jump rejection runs on each observation as it arrives, so `persistSamples`
  counts sensor samples, which is what its label promises. Running it at emit
  time only ever saw one sample per emit interval, so a fast sounder needed
  `persistSamples * emitMinIntervalMs` to confirm a real step. Per-source jump
  history is now discarded on age rather than on absence from one emit cycle,
  so a source slower than the staleness window keeps its history instead of
  re-arming the limiter.
- The absolute reject distance applies whether or not outlier rejection is on,
  because it is a hard limit rather than a statistical one, and it is the only
  rejection that works with two or three sources. The MAD threshold must now be
  greater than zero: zero reads like "no threshold" and does the opposite,
  rejecting every reading with any spread at all.
- The slew limiter stands aside when it would hide a real change: once it has
  fallen more than ten seconds of catch-up behind the combined value, and on
  `environment.depth.belowKeel`, `belowTransducer`, and `belowSurface` whenever
  the water is shoaling. While it is holding the output back, the path reports
  as held back by the slew limit rather than as combining normally.
- Fresh readings are ordered by source reference rather than by registry
  insertion order, so a combined value and the source list beside it do not
  change when a source drops out and re-registers or when the plugin restarts.
- The status line and the debug lines carry the units of a reported spread,
  read "3 of 4 sources" when rejection dropped one, count paths with a rejected
  source, and point at Data, Priorities, which is where the current Signal K
  Admin keeps them.
- The lint, workflow-contract, dead-code, and type checks run once on the Node
  22 lane instead of three times across the matrix, matching the coverage
  upload and the audit beside them.
- The backend type-check project covers `test/configpanel`, which a
  top-level-only glob had left type-checked by nothing.
- Pinned workflow references move to `github/codeql-action` 4.37.9,
  `zizmorcore/zizmor-action` 0.6.3, and the official Signal K reusable
  plugin-ci workflow at its 2026-09-13 master commit, which adds an
  asynchronous crash trap to the lifecycle check and a working-directory input
  that defaults to the repository root.

### Fixed

- `mean` and `median` answer `NaN` on an empty array rather than one of them
  returning a plausible-looking zero.
- An angle normalized from a tiny negative remainder no longer rounds back to
  exactly 2pi, which published a heading of 360.000 degrees.
- The circular medoid resolves a tie to the circular mean of the tied readings
  rather than to whichever source registered first, so a two-source path
  answers the bisector and the output no longer moves when delta arrival order
  changes.
- A slew step of zero width, which two emits sharing a timestamp produce, no
  longer consumes the reading it could not apply.
- The panel's Combine button keeps its place in the tab order while it is
  unavailable, so the description explaining why stays reachable and focus does
  not drop to the document body when a poll flips a path to a non-combinable
  kind.

<a id="v056"></a>

## [0.5.6] - 2026-09-08

### Added

- A save bar at the bottom of the configuration panel reports the state of your
  edits: queued edits read as unsaved until the request goes out, then as
  requested, and a plugin that has never been configured reads "Save to enable
  the plugin." Save sends queued edits at once instead of waiting out the
  coalescing window and retries a failed request; Discard drops queued edits
  and returns the form to the last requested snapshot. The browser asks for
  confirmation before the page is left while edits are still queued.
- Per-path number fields now say why a value was rejected, for example "Enter a
  number greater than 0.", instead of snapping back silently, and the fields
  that carry a unit (staleness timeout, emit interval, angular spread, slew
  limit, and jump rejection rate) show that unit beside the input.

### Changed

- Updated the bundled `signalk-nearlcrews-ui` dependency to 0.9.0 and adopted
  its panel shell, save bar, number field, live region, relative age, text,
  hidden text, and inline code primitives. The panel's own copies of each are
  gone: the local title heading and its stylesheet, the visually hidden
  utility, the relative-age wording constant, the numeric input parser, the
  hand-rolled muted and monospace text styling, the priority reminder's custom
  dismiss control, and the doubled overrides that stripped the card padding,
  painted the combined row's accent stripe, and stripped the Tune section
  chrome, which the library now provides as `Card density="flush"`,
  `Card accent`, and `CollapsibleSection variant="embedded"`.
- The panel title is a level-2 heading. Signal K Admin already renders the page
  heading and the plugin card header, so the panel no longer adds a second
  `h1`.
- The not-enabled notice explains the first save and no longer carries its own
  "Enable plugin" button; the save bar's Save performs that save.
- The priority reminder's dismiss control is the shared banner's own, labeled
  "Dismiss", and it still returns focus to the detected-paths heading.
- Refreshed the packaged App Store screenshots to show the migrated panel.
- The Module Federation share map comes from `signalk-nearlcrews-ui/federation`
  instead of a copied block, and `npm run check:panel` runs the library's
  `snui-check-consumer` for the exact pin, the version stamp in the built
  remote, the absence of a bundled React runtime, the share map, and the size
  baseline. `scripts/check-panel-bundle.mjs` keeps only this repository's own
  build, CSS, and module assertions, and `scripts/check-package.mjs` reads the
  pin from the manifest instead of holding a literal.
- The panel size baseline is re-recorded at 38,263 gzip bytes for the migrated
  panel, against 32,152 on 0.8.2; the docked save bar and the number field are
  the largest additions. The 5% growth band measures from that baseline and the
  one-off migration ceiling is gone, so the gate catches unexpected growth
  rather than the migration itself.
- Dependabot proposes shared UI bumps in their own pull request, separate from
  the weekly development batch, because the library ships breaking changes in
  0.x minors.
- Refreshed development dependencies: Biome 2.5.12, cspell 10.2.2, Playwright
  1.63, Testing Library React 16.3.3, the React DOM types, the Vite React
  plugin, Knip 6.34, tsx, webpack 5.110, and webpack-cli 7.2.3, and moved the
  transitive `browserslist` past its two published advisories and the
  transitive `fast-uri` past its four. Both are development-only, so the
  published package never shipped them.
- Took the Vitest 5, `@vitest/coverage-v8` 5, jsdom 30, and
  `@testing-library/jest-dom` 7 majors. All four require Node 22 or newer, so
  the advisory armv7 Cerbo GX lane in the official Signal K plugin workflow can
  still install and build the plugin but can no longer run the unit suite. That
  lane never gated a release, and coverage on the published Node 20.18 floor
  stays with the blocking job that type-checks, builds, and imports the runtime
  artifact there. `@types/node` stays on the major that matches `engines.node`,
  so the manifest overrides Vitest's optional types peer back to that pin; the
  runtime the plugin supports is unchanged.

### Fixed

- The detected-paths announcer no longer sets both `role="status"` and
  `aria-live="polite"`, which some screen readers read twice.
- The "last checked" age no longer reads the clock during render; the shared
  component owns a ten-second tick and stamps the timestamp on a `time`
  element.

<a id="v055"></a>

## [0.5.5] - 2026-08-22

### Added

- A generated `THIRD_PARTY_NOTICES.md` covering the four packages the
  configuration panel bundles and redistributes (`react`, `react-aria`,
  `signalk-nearlcrews-ui`, and the webpack runtime), with each license text
  embedded. The panel is a Module Federation remote, so the published package
  carries that code and owes its MIT and Apache-2.0 notice obligations.
  `npm run licenses` regenerates the file from what the bundler actually emits,
  and `npm run package:check` fails when it drifts.
- A browser check that a tuned per-path value survives collapsing and reopening
  its section.
- A browser check that a failing detection scan surfaces its error notice and
  that the Retry control requests the path list again, driven by a fixture mode
  that keeps detection failing.
- A browser assertion that a source checkbox keeps the coarse-pointer touch
  target it takes from the label wrapping it.
- A blocking Node 20 CI lane that installs fresh on the published 20.18 runtime
  floor, runs the type checks, builds the plugin artifact, and proves the built
  plugin loads there.

### Changed

- Updated the bundled `signalk-nearlcrews-ui` dependency to 0.8.2, which sizes
  compact and icon-only buttons from the shared control token so the refresh
  button and the priority reminder's dismiss control keep a full touch target.
- Replaced the hand-built first-run notice with the shared empty state.
- Relative ages now read in words, as in "last checked 5 minutes ago", through
  one shared wording constant.
- Pinned `@types/node` to the Node 20 line the plugin advertises in
  `engines.node`, with a package check that keeps the two in step so a newer
  Node API cannot typecheck here and then fail on a Cerbo GX.
- Declared every Signal K plugin-ci input explicitly rather than inheriting the
  reusable workflow's defaults.
- Refreshed development dependencies: Biome, the Signal K server types, the Vite
  React plugin, Vite, and Vitest.
- Held `jsdom` and `@testing-library/jest-dom` at their newest Node
  20-compatible majors, and told Dependabot to stop proposing the newer ones.
  Both require Node 22 or later, which the armv7 Cerbo GX lane cannot run.
- Named the bundled shared UI release in the README so it can be read without
  opening the manifest.

### Fixed

- Restored the configuration panel on Signal K 2.24.x hosts, where plugin
  versions 0.5.3 and 0.5.4 never load it. Those releases share React and
  React DOM with a strict version check, but the 2.24.0 Admin bundles React
  19.2.4 while registering its shares as 19.0.0, so the check refused a
  fully compatible host, and with no bundled fallback the panel never
  rendered. The shares keep their singleton, `^19.2.0`, and
  host-provided-only settings; a version mismatch now warns and continues.
- Removed the relative link wrapping the README hero screenshot. The Signal K
  App Store rewrites image paths but leaves link targets alone, so the link
  resolved to nothing there.
- Corrected the plugin-ci comment that credited the armv7 lane with covering
  Node 20. That job is advisory and cannot fail a check, so the new Node 20 CI
  lane, the package guard, and the Dependabot ignores are the blocking defense.

<a id="v054"></a>

## [0.5.4] - 2026-08-13

### Fixed

- Restored the padding, the combined-row accent border, and the duplicate-source
  hint indent on detected path cards, which the shared UI scoped styles had been
  overriding, so controls and badges no longer sit flush against the card border.
- Reordered each detected path card so the path name leads and its Combine or
  Remove button follows at the trailing edge, full width when the panel is too
  narrow for a single row.
- Squared the priority reminder's dismiss control so the glyph sits in an icon
  target instead of a text button padded out around it.

### Changed

- Refreshed the packaged panel screenshots to match the corrected row layout.

<a id="v053"></a>

## [0.5.3] - 2026-08-12

### Fixed

- Kept the DOM test dependencies on Node 20-compatible releases so the
  official armv7 Signal K plugin lane can start every Vitest worker.
- Replaced ineffective Promise-based save serialization with deterministic
  300-millisecond latest-snapshot coalescing, accurate save-request language,
  synchronous invocation-error recovery, and a final latest-snapshot request
  when Admin closes the panel during the coalescing window.
- Preserved unknown top-level and per-path configuration fields during panel
  edits so newer settings are not erased by an older panel, and ignored
  malformed path-list entries instead of letting them crash the panel.
- Added a current Signal K Admin-shaped browser fixture, including its
  horizontal-overflow container and responsive configuration card.
- Isolated Playwright's fixture server from unrelated processes and added a
  validated browser-port override for parallel local checkout testing.
- Raised the browser-test timeout to cover interaction-heavy WebKit runs on
  Pi-class development hosts without weakening per-action assertions.
- Replaced the duplicated unsupported-browser fallback with the standalone
  shared notice, which renders before the scoped panel can mount.
- Replaced local typography constants, including the repeated fixed-width font
  stack, with shared UI tokens so density changes remain consistent across
  themes and coarse-pointer layouts.

### Changed

- Updated the exact bundled `signalk-nearlcrews-ui` dependency to 0.7.1.
- Shared React and React DOM as strict host-provided Module Federation
  singletons under the UI package's `^19.2.0` contract, and extended the
  production-bundle checks accordingly.
- Aligned theme documentation with Auto's Light fallback and the explicit
  System preference, and standardized relative-age presentation through the
  shared UI helper.
- Refreshed compatible development dependencies, including Signal K server
  types, accessibility checks, DOM testing, build tooling, and dead-code
  analysis, while retaining the published Node 20.18 runtime floor.
- Added a 1280 by 800 current-Admin hero image and a package gate for App Store
  screenshot dimensions and size.
- Injected and verified the exact release commit as `gitHead` in the packed npm
  artifact, without committing build-only metadata to the source manifest.
- Recalibrated the production panel ceiling to 32,000 gzip bytes for the shared
  UI 0.7 compatibility notice, relative-age helper, and typography token.
- Aligned the Biome schema with the installed CLI and documented the Express
  type package required transitively by the current Signal K server API types.
- Updated contributor and release commands to npm 12.0.2 without changing the
  plugin's published Node 20.18 runtime floor.

<a id="v052"></a>

## [0.5.2] - 2026-08-04

### Fixed

- A one-second availability sweep now moves a configured path to the waiting
  state when all of its sources go stale, without re-emitting the last combined
  value. Non-combinable paths remain classified as skipped during the sweep.
- Bus-provided source labels are now escaped before interpolation into debug
  logs.
- README references to repository-only files now remain useful in Signal K App
  Store and npm package views.

### Changed

- The bounded discovery table now evicts an older single-source path before a
  multi-source path that is ready to combine.
- The panel now bundles `signalk-nearlcrews-ui` 0.6.2.

<a id="v051"></a>

## [0.5.1] - 2026-08-02

This patch release updates the shared configuration panel and development
toolchain without changing the Signal K configuration schema, runtime API, or
stored values.

### Changed

- Updated the bundled `signalk-nearlcrews-ui` package to 0.6.1 and replaced the
  removed disclosure API with `CollapsibleSection`. Fresh profiles now follow
  the shared Auto theme, and the retired plugin-specific `skn-theme` key is
  ignored instead of being migrated.
- Refreshed direct development dependencies to their latest compatible
  releases while retaining Node 20.18 or newer for the published plugin.
- Added Markdown linting, spelling checks, local workflow validation, and a
  single release-verification command to the documented development toolchain.
- Hardened GitHub workflows with immutable action references, least-privilege
  credentials, cache protections, dependency-update cooldowns, and automated
  workflow security analysis.
- Split npm publication into verification and trusted-publication jobs. The
  exact tarball that passes the complete release gate is now the artifact sent
  to npm.
- Recalibrated the documented configuration-panel ceiling to 30,000 gzip bytes
  for shared UI 0.6.1. The current production assets total 29,660 gzip bytes.

### Fixed

- Corrected an asynchronous hook test that left its refresh promise floating
  under the current Biome correctness rules.
- Restored jsdom's browser storage in configuration-panel tests when Node 26
  exposes its own file-backed `localStorage` global.

<a id="v050"></a>

## [0.5.0] - 2026-07-27

This release updates the shared configuration-panel library and development
toolchain without changing the Signal K configuration schema, runtime API, or
stored values. Existing saved configurations and theme preferences remain
compatible.

### Changed

- Updated `signalk-nearlcrews-ui` to 0.4.1. Fresh profiles now start in
  Light without persisting an implicit preference, while existing Light, Dark,
  Night, Auto, shared, and migrated legacy preferences remain unchanged.
- Refreshed every direct development dependency to its latest release and
  raised the development toolchain floor to Node
  `^22.22.2 || ^24.15.0 || >=26.0.0`. The published plugin still supports
  Node 20.18 or newer at runtime.
- Kept the exposed panel and bundled shared UI in one lazy chunk, reducing the
  production panel to 22,805 gzip bytes while retaining the approved
  24,000-byte ceiling.

### Fixed

- Updated the transitive `fast-uri` dependency to a release that fixes its
  authority-delimiter host-confusion vulnerability.

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
- Browser accessibility checks now wait for settled theme state and disable color transitions before scanning computed contrast.
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
- Live integration checks now validate package identity and keep file-derived values out of authenticated request URLs.

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

[Unreleased]: https://github.com/NearlCrews/signalk-synthetic-values/compare/v0.5.6...HEAD
[0.5.6]: https://github.com/NearlCrews/signalk-synthetic-values/compare/v0.5.5...v0.5.6
[0.5.5]: https://github.com/NearlCrews/signalk-synthetic-values/compare/v0.5.4...v0.5.5
[0.5.4]: https://github.com/NearlCrews/signalk-synthetic-values/compare/v0.5.3...v0.5.4
[0.5.3]: https://github.com/NearlCrews/signalk-synthetic-values/compare/v0.5.2...v0.5.3
