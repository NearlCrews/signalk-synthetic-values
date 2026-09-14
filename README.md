# Synthetic Values

[![npm version](https://img.shields.io/npm/v/signalk-synthetic-values.svg)](https://www.npmjs.com/package/signalk-synthetic-values)
[![npm downloads](https://img.shields.io/npm/dm/signalk-synthetic-values.svg)](https://www.npmjs.com/package/signalk-synthetic-values)
[![CI](https://github.com/NearlCrews/signalk-synthetic-values/actions/workflows/ci.yml/badge.svg)](https://github.com/NearlCrews/signalk-synthetic-values/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](https://github.com/NearlCrews/signalk-synthetic-values/blob/main/LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20.18-brightgreen.svg)](https://nodejs.org)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=black)](https://www.buymeacoffee.com/nearlcrews)

When two or more sources feed the same Signal K path (multiple GPS receivers, duplicate depth sounders, redundant heading sensors), the server picks one source at a time and ignores the rest. Synthetic Values watches all sources together, computes a single robust value from them, and emits it as an additional source on the same path so one flaky or biased sensor cannot drag the result.

## What's new in 0.6.0

Version 0.6.0 adds a confidence channel beside every combined value, teaches the
plugin to spot sensors that have split into groups and feeds that are really one
sensor, and rebuilds the configuration panel on the shared component library.

- **Confidence notifications.** Each combined path now publishes
  `notifications.<path>` saying how much the published value can be trusted, so
  a consumer reading only the value can still tell a clean four-sensor consensus
  from a value assembled after half the sensors were discarded. Only a
  suppressed value or a breach of a `disagreeThreshold` you set raises an alert,
  the plugin never asks the boat to make a sound, and the new top-level
  `notifications` option switches the channel off.
- **Split sensors are caught without a threshold.** With three or more readings,
  a combined value sitting in a gap between two groups of sensors is reported as
  disagreeing, no units and no tuning required. Setting `disagreeThreshold`
  still replaces the check on that path.
- **Duplicate feeds are collapsed.** One sounder forwarded by two gateways is
  two source names and one sensor. Sources reporting the same changing values
  are now grouped and counted once, so a re-broadcast feed cannot vote twice or
  satisfy `minSources` on its own.
- **Angles follow the Signal K specification.** Full-circle quantities combine
  circularly even where the server resolves no units, bounded angles such as a
  rudder angle combine linearly, and a radian path that is neither is named in
  the status line and left out of "Combine all" rather than being averaged into
  its own reciprocal.
- **Jump rejection counts sensor samples.** It runs on each reading as it
  arrives, so `persistSamples` means what its label promises instead of needing
  `persistSamples * emitMinIntervalMs` on a fast sounder. Clearing its rate is
  now how you switch it off, and the persist settings survive that.
- **A slew limiter that stands aside.** It gives way once it has fallen more
  than ten seconds behind the combined value, and on the depth paths whenever
  the water is shoaling, and the status line says so while it is holding the
  output back.
- **A save bar you can act on.** The footer of the panel reports the state of
  your edits, **Save** sends queued edits at once and retries a failed request,
  **Discard** returns the form to the last requested snapshot, and the first
  save is what enables the plugin. Number fields say why a value was rejected
  and show the unit they are measured in.
- **Panel detail worth having.** The detected-path row separates live, stale,
  and excluded sources, long source lists sit behind a real disclosure control
  rather than a tooltip, and every field error leads with a tone mark and its
  spoken word instead of relying on color alone.

See the [v0.6.0 changelog entry](https://github.com/NearlCrews/signalk-synthetic-values/blob/main/CHANGELOG.md#v060) and the
[full release history](https://github.com/NearlCrews/signalk-synthetic-values/releases).

## Screenshots

![Synthetic Values inside the current Signal K Admin plugin configuration screen](assets/screenshots/00-admin-hero.png)

The App Store hero shows the production panel inside current Signal K Admin
chrome. Detailed configuration, not-recommended-path, tuning, and Data Browser
captures follow in the package screenshot gallery.

## Why you'd want this

Many boats carry more than one of the same instrument: two or three GPS receivers, a backup depth sounder, a couple of compasses. Signal K can only show one of them at a time for each reading, and it simply uses whichever sensor reported most recently. If that one happens to be drifting, noisy, or briefly wrong, your position jumps, your heading wanders, or your depth reads badly, even though a perfectly good sensor is sitting right next to it.

Synthetic Values fixes that. It listens to all of your duplicate sensors at once and publishes a single steadier reading made from them together. Think of it like asking three people for the time and going with the answer in the middle, rather than trusting whoever happened to speak last. One sensor going haywire no longer throws off the number you navigate by, and the value you see is usually more accurate and far less jumpy than any single sensor on its own.

You stay in control. The combined reading is published as its own extra source, so your original sensors are untouched and still visible. You choose which readings to combine (the plugin shows you which ones actually have duplicates), and you tell Signal K to prefer the combined value when you are ready. Nothing on your boat changes until you opt a reading in.

## What it does

Signal K is an open marine data standard that streams a boat's navigation, environment, and AIS data over a single API. When redundant sensors all feed the same path, the server picks whichever source wrote last: a stuttering GPS can make the chartplotter jump, and a bad depth sounder can suppress a good one.

Synthetic Values subscribes to every source on the opted-in paths, applies a combining method (median by default), and emits the result under the plugin's own source label. Because the result rides a separate source, it does not displace raw sensor data and real-instrument consumers can still see the underlying sources.

The plugin handles four value kinds:

Whole-source outlier rejection uses scaled MAD, and that statistic needs four or more fresh sources to mean anything, so it does nothing on a two-source or three-source path whatever the kind. A configured `rejectThreshold` is an absolute ceiling that applies at any source count, and it is the setting a small installation needs. It applies whether or not `outlierRejection` is on, because it is a hard limit rather than a statistical one.

- **Scalar:** standard numeric combining. Median is robust; trimmed mean and mean are available.
- **Angular:** headings, bearings, wind and current directions, and autopilot targets. Combines without the 0/360-degree wrap artifact, honoring the `method` setting: `median` (the default) uses the circular medoid, the reading closest to the others, so one off compass cannot drag the result, and with exactly two sources it returns the bisector of the two; `mean` uses the circular mean. Suppresses the synthetic value when the circular pairwise spread exceeds `angularSpreadThreshold`, so a sensor pointing 180 degrees from the rest does not produce a meaningless average.
- **Position:** latitude/longitude pairs. Combines latitude with the selected linear statistic and longitude with an antimeridian-safe circular statistic. `mean` uses the circular mean, while `median` and `trimmedMean` use the robust circular medoid. Per-source geodesic-distance rejection keeps a phantom GPS fix from dragging the result, at four or more receivers through scaled MAD or at any count through `rejectThreshold`.
- **Attitude:** the `navigation.attitude` object, with roll, pitch, and yaw combined independently as angular components. A source whose attitude is off on any axis is rejected on the same terms as the other kinds, and the synthetic value is suppressed if any axis is too scattered. This is the Signal K way to fuse several motion sensors into one attitude, then prefer it by source priority, the same outcome as selecting a source on a Garmin display.

A staleness timeout excludes sources that have not sent a fresh reading within the configured window. A one-second availability sweep updates status when every source goes quiet without periodically re-emitting the last combined value.

## Installation

Install from the Signal K admin UI under **Apps and Plugins, then Store**, or from npm:

```bash
cd ~/.signalk
npm install signalk-synthetic-values
```

From source:

The published plugin supports Node 20.18 or newer at runtime. Building from
source requires Node `^22.22.2 || ^24.15.0 || ^26.0.0` and npm 12.0.2; the
checked-in `.node-version` selects Node 22.23.1.

```bash
git clone https://github.com/NearlCrews/signalk-synthetic-values.git
cd signalk-synthetic-values
npm ci
npm run build
ln -s "$(pwd)" ~/.signalk/node_modules/signalk-synthetic-values
```

## Configuration

In the Signal K admin UI, open **Apps and Plugins, then Configuration** and find "Synthetic Values". The plugin is disabled by default: press **Save** in the panel's save bar to request its default configuration, which enables the plugin and starts detection.

### Configuration panel

Once enabled, the plugin replaces the raw JSON form with a purpose-built configuration panel. The panel shows a live list of every Signal K path the plugin has seen with two or more distinct sources. Each row displays the path name, source count, a kind badge, and the source names as chips. Combinable values are classified as scalar, angular, attitude, or position; unsupported values show as other, and configured paths awaiting live data show as unknown.

The panel bundles `signalk-nearlcrews-ui` 0.11.1 for accessible controls, shared
marine theming, and isolated styles. Match Admin follows a host theme when one
is published and otherwise stays Light to match the current Signal K Admin
shell. Match device explicitly follows the operating-system preference. Light,
Dark, and Night remain direct choices, and all five choices are shared with
other panels that use the library. Night changes this panel, not the
surrounding Admin chrome. The retired Synthetic Values `skn-theme` preference
is intentionally ignored.

The shared UI requires native CSS `@scope`: Chromium and Edge 118 or newer,
Firefox 146 or newer, or Safari 17.4 or newer. Older browsers and embedded
WebViews receive a browser-update message instead of an unstyled panel.

Sources that stop reporting age out of the detected list after one minute, but the combiner drops a source after its staleness timeout, which is one second by default. The row shows the difference: a source that has stopped reporting reads "no data", an excluded source reads "excluded", and the source count reads "2 of 3 sources combining" when they differ. A combined path with nothing live loses its green accent and reads "no live sources".

Configured paths remain visible while offline, so they can still be tuned or removed while discovery is rebuilding. The per-source include and exclude checklist needs live sources, so it is hidden until the path reports again.

- **Combine** updates the panel immediately and queues one path with default settings.
- **Combine all** queues every recommended path at once after a confirmation step. It skips paths that are detected but not meaningful to average (see below).
- **Remove** updates the panel immediately and queues removal from combining.
- **Tune** (per opted-in path) opens a settings panel with: the combining method (median, trimmed mean, or mean), minimum sources, and a per-source include/exclude checklist. An **Advanced** sub-section exposes MAD threshold, reject threshold, disagree threshold, angular spread threshold, trim fraction, angular override, jump rejection max rate, slew limit, staleness timeout, and emit interval.

Panel edits are coalesced for 300 milliseconds and sent as the newest complete
snapshot. Signal K Admin's panel callback only acknowledges that a save was
requested, so the panel does not claim persistence from that return value.
A save bar at the bottom of the panel reports that state: queued edits read as
unsaved until the request goes out, then as requested. **Save** sends queued
edits at once or retries a failed request, and **Discard** drops them and
returns the form to the last requested snapshot. The browser asks for
confirmation before the page is left while edits are still queued.
Unknown top-level and per-path configuration fields are retained when the panel
writes known settings, which keeps configurations forward compatible.

Paths that are detected but not meaningful to average are grouped under **Detected but not recommended**. This covers two cases: values that are not supported combinable shapes (text and other objects, which cannot be averaged), and numeric GNSS fix metadata that describes a single receiver's solution rather than a measured quantity (the satellite count, dilution of precision, and differential-correction age and reference). A plotter shows GNSS metadata so you can judge the fix it is using, but averaging it across receivers is not meaningful, so it is kept out of "Combine all". You can still combine numeric GNSS metadata by hand if you have a reason to; text and unsupported objects remain disabled.

When two or more sources report identical values while the value is changing, the panel flags them as likely the same feed re-broadcast (for example a GPS forwarded by an autopilot under a second source name). Re-broadcast sources are not independent, so counting each one dilutes the combined value toward that single feed. The panel names the duplicates and suggests excluding all but one in the path's **Tune** section; it never excludes a source for you, since identical values can also be legitimate.

After you opt in a path, the panel shows a priority reminder: you must still rank `signalk-synthetic-values` first in the relevant Signal K priority group for the combined value to win (see "Make the synthetic source win" below). The panel links to the group-based priority screen and offers a path-level override link, but it does not change priority for you.

Detected multi-source paths are also available programmatically at `GET /plugins/signalk-synthetic-values/api/detected`.

### Global options

The runtime honors the top-level options below. The current custom panel
preserves existing values but does not edit them, and because the panel
replaces the schema-generated form there is no fallback form to set them in.
To change one, edit `~/.signalk/plugin-config-data/signalk-synthetic-values.json`
by hand and restart the server. `maxSourcesPerPath` in particular interacts with
a panel field: the Minimum sources field will not accept a value above it,
because the runtime drops a path whose minimum exceeds the cap.

| Option | Default | Description |
| ------ | ------- | ----------- |
| `defaultStalenessTimeoutMs` | `1000` | A source whose last receipt is older than this is excluded from combining. Override per path with `stalenessTimeoutMs`. |
| `defaultEmitMinIntervalMs` | `1000` | Minimum interval in milliseconds between synthetic emits for a path. Override per path with `emitMinIntervalMs`. |
| `defaultMinSources` | `2` | Minimum fresh sources required to emit a combined value. Set to `1` to pass through a single-source path without combining. Override per path with `minSources`. |
| `maxSourcesPerPath` | `16` | Global cap on tracked and detected sources per path, from `1` to `64`. |
| `notifications` | `true` | Publish `notifications.<path>` describing confidence in each combined value. Visual only, never audible. Set to `false` to keep the notification tree clear. |

### Per-path options

Click **Combine** on each detected path you want to opt in. The current panel
can add only paths it has already seen with two or more sources. Existing saved
paths remain visible while offline. The runtime accepts every option below, but
the panel preserves rather than edits `outlierRejection`,
`jumpRejection.persistSamples`, and `jumpRejection.persistMs`. To change one of
those three, edit `~/.signalk/plugin-config-data/signalk-synthetic-values.json`
by hand and restart the server. Clearing the jump rejection rate switches jump
rejection off and leaves the persist settings saved beside it, so they come back
with the rate whichever editor cleared it.

| Option | Default | Description |
| ------ | ------- | ----------- |
| `path` | required | The Signal K path to combine. |
| `method` | `median` | Combining method: `median`, `trimmedMean`, or `mean`. For angular paths and position longitudes, `mean` uses the circular mean; `median` and `trimmedMean` use the circular medoid (the reading closest to the others). |
| `trimFraction` | `0.25` | Fraction in the range `[0, 0.5)` trimmed from each end when using `trimmedMean`. The count trimmed from each end is `floor(N * trimFraction)`, so small sets may remain untrimmed. Applies to scalar paths and to the latitude half of a position. Angular and attitude paths, and the longitude half of a position, use the circular medoid for both `median` and `trimmedMean`, so `trimFraction` has no effect there. |
| `outlierRejection` | `true` | Reject whole-source outliers before combining. |
| `madThreshold` | `3` | Sigma-equivalent multiplier for scaled-MAD outlier rejection when N is 4 or more. Must be greater than zero: zero rejects every reading with any spread at all and silences the path. Switch `outlierRejection` off to disable rejection. |
| `rejectThreshold` | unset | Absolute rejection ceiling in kind units: meters for position, radians on the worst axis for angular and attitude, and value units for scalar. It applies alongside scaled MAD, and it keeps applying when `outlierRejection` is off, because it is a hard limit rather than a statistical one. It is the only rejection that works with two or three sources. |
| `disagreeThreshold` | unset | Absolute distance in kind units above which sources are flagged as disagreeing in the plugin status and in a notification. The combined value is still emitted. Setting it also replaces the automatic split check described under "When no source is near the combined value", so it is how you say what spread is normal on a path whose sensors are mounted apart. |
| `angularSpreadThreshold` | `pi/2` | Angular and attitude paths: maximum circular pairwise spread in radians. Sources beyond this threshold cause the synthetic value to be suppressed. An attitude path applies the threshold to roll, pitch, and yaw independently, and one axis beyond it suppresses the whole value. |
| `angular` | `auto` | Override angular detection: `auto`, `yes`, or `no`. `auto` recognizes the full-circle paths the Signal K specification defines and treats the specification's bounded angles as scalars. Set `yes` for a full-circle quantity it does not recognize, such as a vendor bearing, and `no` for a bounded angle. Both overrides are absolute and consult neither the path nor the metadata. |
| `includeSources` | unset | If set, only these sourceRefs are combined for this path. Cannot be set together with `excludeSources`. |
| `excludeSources` | unset | If set, these sourceRefs are excluded for this path. Cannot be set together with `includeSources`. |
| `minSources` | global default | Per-path override for the minimum fresh sources required. |
| `stalenessTimeoutMs` | global default | Per-path override for the staleness timeout. |
| `emitMinIntervalMs` | global default | Per-path override for the minimum emit interval. |
| `jumpRejection` | unset | Per-source jump rejection: `{ maxRate, persistSamples, persistMs }`. Rejects a sudden spike and re-accepts after a genuine step is confirmed. `persistSamples` counts sensor samples as they arrive, not emit cycles, so a fast sounder confirms a real step in three readings rather than three seconds. Every field is optional: without `maxRate` jump rejection is off, `persistSamples` defaults to `3`, and `persistMs` to `5000`. |
| `slewLimit` | unset | Maximum change of the emitted value per second, in kind units. Clamps the output to suppress sudden jumps that survive rejection. The limiter is bypassed once it would fall more than ten seconds of catch-up behind the combined value, and on `environment.depth.belowKeel`, `belowTransducer`, or `belowSurface` whenever the water is shoaling, so it can damp noise without hiding a real change. While it is holding the output back, the path reports as held back by the slew limit rather than as combining normally. |

## Make the synthetic source win

The synthetic value is emitted as an additional source alongside the raw sensors. Signal K ranks sources by group, with the first source winning every shared path in that group while it is publishing. The synthetic value does not consistently win until you rank it.

1. Open the Signal K admin UI and navigate to **Data, then Priorities**.
2. In each priority group that contains **signalk-synthetic-values**, drag it to the first position.
3. Review the lower-ranked raw sources' **Fallback after** values. Each value controls how long the currently winning source must be silent before that backup can take over.
4. Add a path-level override only when one path needs a different order from the rest of its group.
5. Save.

The configuration panel shows a priority reminder once you opt a path in. The reminder links to **Data, Priorities**, and each combined row can open a path-level override for that path. The plugin cannot read or write the server's priority store directly, but the ranking takes effect server-side once you save it.

## When no source is near the combined value

Two sensors that agree and two that disagree look identical to a statistic that
has no idea what the numbers mean. Scaled MAD needs four readings before it says
anything, so a two-source or three-source path has nothing that separates two
sounders reading 2.0 and 2.1 metres from two reading 2.0 and 30.0.

With three or more readings the plugin runs a check that needs no units: if the
combined value's nearest reading is further away than a quarter of the whole
spread, the readings have split into groups and the published value sits in the
gap between them, matching none of them. Four sounders reading 2.0, 2.1, 30.0,
and 30.1 publish 16.05, which no sounder reported, so the path reports as
disagreeing and raises a notification. **The value is still published**, because
suppressing it needs a threshold in the path's own units and only you can supply
one.

Two things follow from that.

- **Set `disagreeThreshold` on any path whose sensors are legitimately mounted
  apart**, such as a bow and a stern sounder that genuinely read differently. It
  says what spread is normal, it replaces this automatic check, and a breach of
  it raises the higher `alert` state rather than the advisory `warn`.
- **Set `rejectThreshold` to suppress rather than flag.** It is the only
  rejection that works below four sources, and once rejection leaves fewer than
  `minSources` agreeing readings the path diverges and publishes nothing.

## Confidence notifications

A consumer that reads only the value has no way to tell a clean four-sensor
consensus from a value assembled after discarding half the sensors. So the
plugin publishes `notifications.<path>` alongside each combined path, and a
chartplotter subscribed to `notifications.*` surfaces it.

| State | When |
| ----- | ---- |
| `alert` | Sources diverge and nothing is being published, or the spread exceeds the `disagreeThreshold` you set. |
| `warn` | No source is near the published value, outlier rejection dropped a sensor, only one of several sources is being used, the slew limit is holding the output back, or a path that was combining has run out of fresh sources. |
| `normal` | Combining normally. Sent only to clear a previous notification. |

`method` is `["visual"]` for an alert and empty for a warning, so this plugin
never asks the boat to make a sound. `alarm` and `emergency` are never used: a
data-quality problem is not a vessel emergency, and taking the top of the scale
for one teaches an operator to ignore the channel. Set `notifications` to
`false` to switch the whole channel off.

## Duplicate feeds

One sounder forwarded by two gateways is two source names and one sensor. Left
alone it votes twice, satisfies `minSources` on its own, and outvotes an honest
independent sensor. The plugin watches each source's recent value history and
groups sources that report the same values while those values are changing:
two independent sensors do not match to full floating-point precision while
moving, so an exact match is a re-broadcast. Each group is collapsed to one
reading before combining, and the panel row says which sources look duplicated.

The technique has one limit worth planning around. A value that has been
quantized on the way round is no longer an exact match, so it is not detected.
The common case is this plugin's own output returning over NMEA 2000: a combined
heading published here, sent to the bus by a companion plugin at PGN 127250's
0.0001 rad resolution, and read back by the server under the gateway's source
name. `$source` filtering cannot catch it either, because the echo arrives under
the gateway's name rather than this plugin's. Two ways to prevent it:

- Add the gateway's source to the path's `excludeSources` list, or uncheck it in
  the panel's source checklist.
- Have the companion plugin publish to a path this plugin does not combine.

## Plugin status messages

The admin UI status line shows one stable summary of the whole plugin, so it stays readable instead of flickering through one message per path. You will see one of:

- **No multi-source paths detected yet (need 2+ sources on a path):** the plugin is running but has not yet seen any path with two or more distinct sources.
- **N multi-source paths detected. Add paths in the config panel to combine them:** the plugin found duplicates but none are opted in yet.
- **Combining N of M paths:** M paths are opted in, and N of them are currently producing a combined value. Plain "Combining N of M paths." means everything is healthy.

When some paths need attention, the summary appends counts rather than naming each path: **waiting for sources** (not enough fresh sources), **diverging** (angular or attitude sources point in different directions, or outlier rejection left fewer than the required minimum of agreeing sources), **disagreeing** (the spread exceeds `disagreeThreshold`, or no source is near the combined value, and the value is still emitted), **held back by the slew limit** (the published value is behind what the sources report), **on a single source** (running without redundancy), and **with a rejected source** (outlier rejection dropped a sensor). A position path never diverges on spread alone; set `disagreeThreshold` to have a wide spread reported, with the value still emitted. For example: `Combining 9 of 12 paths. 2 waiting for sources and 1 disagreeing.`

The summary also names any path that reports radian units the plugin could not confirm as a full-circle quantity, because averaging a bearing linearly publishes the reciprocal: `Set angular wrapping on: vendor.custom.someBearing.` Answer it with the path's `angular` setting, in either direction, and the line goes away.

For the per-path detail behind those counts (which path is waiting, the exact spread, and so on), enable the plugin's debug log in **Apps and Plugins, then Configuration**. The plugin writes a line per path as its state changes.

## Development

The published plugin targets Node 20.18 or newer. The development toolchain
requires Node `^22.22.2 || ^24.15.0 || ^26.0.0` and npm 12.0.2;
`.node-version` selects Node 22.23.1.
It uses TypeScript 7 with `@signalk/server-api` 2.31. The published peer
dependency supports `@signalk/server-api` 2.24 or newer.

```bash
git clone https://github.com/NearlCrews/signalk-synthetic-values.git
cd signalk-synthetic-values
npm ci                       # install the locked dependencies
npm run build                # build and verify dist/ and the panel remote
npm test                     # Vitest suite, single run
npm run check                # local lint, workflow, dead-code, type, and unit checks
npm run test:browser         # Chromium production-remote tests
npm run test:browser:cross   # Chromium, Firefox, WebKit, and mobile Chromium
npm run type-check           # runtime, backend tests, panel, and browser-fixture type checks
npm run lint                 # source, Markdown, and spelling checks
npm run lint:fix             # lint and auto-fix
npm run ci:workflows         # validate GitHub Actions syntax and pinned actions
npm run knip                 # dead files, exports, and dependencies
npm run package:check        # inspect the files included by npm pack
npm run audit:runtime        # audit production dependencies
npm run audit:full           # audit the complete dependency tree
npm run screenshots          # refresh the configuration-panel screenshots
npm run verify               # complete non-browser validation
npm run verify:release       # release validation, browser matrix, and full audit
```

Install the browser engines once before running browser tests:

```bash
npx --no-install playwright install chromium firefox webkit
```

An optional live-host check verifies that Signal K registers the plugin, serves
its detected-path API, and serves its configuration remote. Supply the complete
authorization header when the server protects its administration API:

```bash
SIGNALK_URL=http://127.0.0.1:3000 \
SIGNALK_AUTHORIZATION='Bearer <token>' \
npm run test:integration
```

Run `npm run verify:release` before preparing a release. See `CONTRIBUTING.md`
in the repository for the pull request process.

## License

Apache-2.0: see the `LICENSE` file in the repository for the full text.
