# Synthetic Values

[![npm version](https://img.shields.io/npm/v/signalk-synthetic-values.svg)](https://www.npmjs.com/package/signalk-synthetic-values)
[![npm downloads](https://img.shields.io/npm/dm/signalk-synthetic-values.svg)](https://www.npmjs.com/package/signalk-synthetic-values)
[![CI](https://github.com/NearlCrews/signalk-synthetic-values/actions/workflows/ci.yml/badge.svg)](https://github.com/NearlCrews/signalk-synthetic-values/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](https://github.com/NearlCrews/signalk-synthetic-values/blob/main/LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20.18-brightgreen.svg)](https://nodejs.org)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=black)](https://www.buymeacoffee.com/nearlcrews)

When two or more sources feed the same Signal K path (multiple GPS receivers, duplicate depth sounders, redundant heading sensors), the server picks one source at a time and ignores the rest. Synthetic Values watches all sources together, computes a single robust value from them, and emits it as an additional source on the same path so one flaky or biased sensor cannot drag the result.

## What's new in 0.1.0

Initial release: combine multiple sources of one Signal K path into a robust synthetic value.

- **Median, trimmed mean, and mean combining, with kind-aware outlier rejection.** Choose the method per path; median is the default and requires no tuning. Scaled-MAD whole-source rejection handles scalars and angular paths, and geodesic-distance rejection handles position. Optional per-source jump rejection and a per-path slew limit hold back sudden spikes that survive rejection.
- **Robust angular combining.** Headings and bearings combine without the 0/360-degree wrap artifact. The default uses the circular medoid, the reading closest to the others, so one off compass cannot drag the result, and a spread guard suppresses the synthetic value when sensors point in opposite directions. Position uses the geodesic centroid.
- **Auto-detection with a purpose-built panel.** The plugin watches all incoming deltas and surfaces every path it has seen with two or more distinct sources, so you opt in from a list rather than typing paths by hand. "Combine all" opts in every recommended path at once.
- **Guardrails against meaningless or non-independent combining.** GNSS fix metadata (satellite count, dilution of precision, and differential-correction age and reference) describes a single receiver, so it is kept out of "Combine all". Sources reporting identical values while the value changes are flagged as a likely re-broadcast of one feed, so a forwarded GPS does not outvote your independent sensors.
- **One stable status line.** The admin UI shows a single summary of the whole plugin (how many paths are combining, plus counts of any waiting, diverging, disagreeing, or single-source paths) instead of flickering through one message per path. Per-path detail goes to the debug log.

See the [v0.1.0 changelog entry](CHANGELOG.md#v010), or the [full changelog](CHANGELOG.md).

## Why you'd want this

Many boats carry more than one of the same instrument: two or three GPS receivers, a backup depth sounder, a couple of compasses. Signal K can only show one of them at a time for each reading, and it simply uses whichever sensor reported most recently. If that one happens to be drifting, noisy, or briefly wrong, your position jumps, your heading wanders, or your depth reads badly, even though a perfectly good sensor is sitting right next to it.

Synthetic Values fixes that. It listens to all of your duplicate sensors at once and publishes a single steadier reading made from them together. Think of it like asking three people for the time and going with the answer in the middle, rather than trusting whoever happened to speak last. One sensor going haywire no longer throws off the number you navigate by, and the value you see is usually more accurate and far less jumpy than any single sensor on its own.

You stay in control. The combined reading is published as its own extra source, so your original sensors are untouched and still visible. You choose which readings to combine (the plugin shows you which ones actually have duplicates), and you tell Signal K to prefer the combined value when you are ready. Nothing on your boat changes until you opt a reading in.

## What it does

Signal K is an open marine data standard that streams a boat's navigation, environment, and AIS data over a single API. When redundant sensors all feed the same path, the server picks whichever source wrote last: a stuttering GPS can make the chart plotter jump, and a bad depth sounder can suppress a good one.

Synthetic Values subscribes to every source on the opted-in paths, applies a combining method (median by default), and emits the result under the plugin's own source label. Because the result rides a separate source, it does not displace raw sensor data and real-instrument consumers can still see the underlying sources.

The plugin handles three value kinds:

- **Scalar:** standard numeric combining. Median is robust; trimmed mean and mean are available. Whole-source outlier rejection uses scaled MAD at four or more sources, and a configured `rejectThreshold` at smaller N.
- **Angular:** headings, bearings, and any path with radian units. Combines without the 0/360-degree wrap artifact, honoring the `method` setting: `median` (the default) uses the circular medoid, the reading closest to the others, so one off compass cannot drag the result; `mean` uses the circular mean. Suppresses the synthetic value when the circular pairwise spread exceeds `angularSpreadThreshold`, so a sensor pointing 180 degrees from the rest does not produce a meaningless average.
- **Position:** latitude/longitude pairs. Combines to the geodesic centroid and applies per-source distance-based outlier rejection so a phantom GPS fix does not drag the result.

A staleness timeout excludes sources that have not sent a fresh reading within the configured window, so a sensor that goes quiet does not silently anchor the average.

## Installation

Install from the Signal K admin UI under **Appstore, then Available**, or from npm:

```bash
cd ~/.signalk
npm install signalk-synthetic-values
```

From source:

```bash
git clone https://github.com/NearlCrews/signalk-synthetic-values.git
cd signalk-synthetic-values
npm install
npm run build
ln -s "$(pwd)" ~/.signalk/node_modules/signalk-synthetic-values
```

## Configuration

In the Signal K admin UI, open **Server, then Plugin Config**, find "Synthetic Values", and enable the plugin. The plugin is disabled by default.

### Configuration panel

Once enabled, the plugin replaces the raw JSON form with a purpose-built configuration panel. The panel shows a live list of every Signal K path the plugin has seen with two or more distinct sources. Each row displays the path name, source count, kind badge (scalar, angular, or position), and the source names as chips.

- **Combine** opts a single path in immediately with default settings.
- **Combine all** opts in every recommended path at once, with a confirmation step before writing. It skips paths that are detected but not meaningful to average (see below).
- **Remove** takes a path back out of combining.
- **Tune** (per opted-in path) opens a settings panel with: the combining method (median, trimmed mean, or mean), minimum sources, and a per-source include/exclude checklist. An **Advanced** sub-section exposes MAD threshold, reject threshold, disagree threshold, angular spread threshold, trim fraction, angular override, jump rejection max rate, slew limit, staleness timeout, and emit interval.

Paths that are detected but not meaningful to average are grouped under **Detected but not recommended**. This covers two cases: values that are not numbers or positions (text and objects, which cannot be averaged at all), and GNSS fix metadata that describes a single receiver's solution rather than a measured quantity (the satellite count, dilution of precision, and differential-correction age and reference). A plotter shows those so you can judge the fix it is using, but averaging them across receivers is not meaningful, so they are kept out of "Combine all". You can still combine one by hand if you have a reason to.

When two or more sources report identical values while the value is changing, the panel flags them as likely the same feed re-broadcast (for example a GPS forwarded by an autopilot under a second source name). Re-broadcast sources are not independent, so counting each one dilutes the combined value toward that single feed. The panel names the duplicates and suggests excluding all but one in the path's **Tune** section; it never excludes a source for you, since identical values can also be legitimate.

After you opt in a path the panel shows a priority reminder: you must still set Signal K source priority to prefer `signalk-synthetic-values` for the combined value to win (see "Make the synthetic source win" below). The panel shows this instruction but does not set priority for you.

Detected multi-source paths are also available programmatically at `GET /plugins/signalk-synthetic-values/api/detected`.

### Global options

| Option | Default | Description |
|--------|---------|-------------|
| `defaultStalenessTimeoutMs` | `1000` | A source whose last receipt is older than this is excluded from combining. Override per path with `stalenessTimeoutMs`. |
| `defaultEmitMinIntervalMs` | `1000` | Minimum interval in milliseconds between synthetic emits for a path. Override per path with `emitMinIntervalMs`. |
| `defaultMinSources` | `2` | Minimum fresh sources required to emit a combined value. Set to `1` to pass through a single-source path without combining. Override per path with `minSources`. |
| `maxSourcesPerPath` | `16` | Global cap on tracked sources per path. |

### Per-path options

Add one entry to **Paths to combine** for each path you want to opt in. The dropdown shows paths the plugin has already seen with two or more sources. If a path does not appear yet, type it directly or reload the page after the sensors have been running for a moment.

| Option | Default | Description |
|--------|---------|-------------|
| `path` | required | The Signal K path to combine. |
| `method` | `median` | Combining method: `median`, `trimmedMean`, or `mean`. For angular paths, `mean` uses the circular mean; `median` and `trimmedMean` use the circular medoid (the reading closest to the others). |
| `trimFraction` | `0.25` | Fraction trimmed from each end when using `trimmedMean`. Falls back to median or mean at small N. |
| `outlierRejection` | `true` | Reject whole-source outliers before combining. |
| `madThreshold` | `3` | Sigma-equivalent multiplier for scaled-MAD outlier rejection when N is 4 or more. |
| `rejectThreshold` | unset | Absolute rejection distance in kind units: meters for position, radians for angular, and value units for scalar. Used at small N or when the robust scale is degenerate. |
| `disagreeThreshold` | unset | Absolute distance in kind units above which sources are flagged as disagreeing in the plugin status. The combined value is still emitted. |
| `angularSpreadThreshold` | `pi/2` | Angular paths only: maximum circular pairwise spread in radians. Sources beyond this threshold cause the synthetic value to be suppressed. |
| `angular` | `auto` | Override angular detection: `auto`, `yes`, or `no`. `auto` uses the known-circular path list and metadata units. |
| `includeSources` | unset | If set, only these sourceRefs are combined for this path. Cannot be set together with `excludeSources`. |
| `excludeSources` | unset | If set, these sourceRefs are excluded for this path. Cannot be set together with `includeSources`. |
| `minSources` | global default | Per-path override for the minimum fresh sources required. |
| `stalenessTimeoutMs` | global default | Per-path override for the staleness timeout. |
| `emitMinIntervalMs` | global default | Per-path override for the minimum emit interval. |
| `jumpRejection` | unset | Per-source jump rejection: `{ maxRate, persistSamples, persistMs }`. Rejects a sudden spike and re-accepts after a genuine step is confirmed. |
| `slewLimit` | unset | Maximum change of the emitted value per second, in kind units. Clamps the output to suppress sudden jumps that survive rejection. |

## Make the synthetic source win

The synthetic value is emitted as an additional source alongside the raw sensors. With no priority set, the server uses last-writer-wins, so the displayed value flickers. You must set source priority once per path. The synthetic value does not win until this step is done.

1. Open the Signal K admin UI and navigate to **Server, then Data, then Sources** (Source Priorities).
2. Find the path you opted in, for example `navigation.position`.
3. Drag **signalk-synthetic-values** to the top of that path's source list.
4. Set a **timeout** on the synthetic source so that if the plugin stops emitting, the server falls back to a raw source rather than displaying a stale synthetic value.
5. Save.

Repeat steps 2 through 4 for each path you have opted in.

The configuration panel shows a priority reminder once you opt a path in. The reminder is informational: the plugin cannot read or write the server's priority store directly, but the priority takes effect server-side once you save it.

## Plugin status messages

The admin UI status line shows one stable summary of the whole plugin, so it stays readable instead of flickering through one message per path. You will see one of:

- **No multi-source paths detected yet (need 2+ sources on a path):** the plugin is running but has not yet seen any path with two or more distinct sources.
- **N multi-source paths detected. Add paths in the config panel to combine them:** the plugin found duplicates but none are opted in yet.
- **Combining N of M paths:** M paths are opted in, and N of them are currently producing a combined value. Plain "Combining N of M paths." means everything is healthy.

When some paths need attention, the summary appends counts rather than naming each path: **waiting for sources** (not enough fresh sources), **diverging** (angular sources point in opposite directions, or position sources are too far apart to combine safely), **disagreeing** (spread exceeds `disagreeThreshold`, but a value is still emitted), and **on a single source** (running without redundancy). For example: `Combining 9 of 12 paths. 2 waiting for sources, and 1 disagreeing.`

For the per-path detail behind those counts (which path is waiting, the exact spread, and so on), enable the plugin's debug log in **Server, then Plugin Config**. The plugin writes a line per path as its state changes.

## Development

This project targets Node 20.18 or newer with TypeScript 6 (development only) and `@signalk/server-api` 2.24 or newer.

```bash
git clone https://github.com/NearlCrews/signalk-synthetic-values.git
cd signalk-synthetic-values
npm install          # install dependencies
npm run build        # compile to dist/
npm test             # Vitest suite, single run
npm run type-check   # TypeScript type check
npm run lint         # Biome check
npm run lint:fix     # lint and auto-fix
npm run validate     # type-check, lint, and tests in one pass
```

Run `npm run validate` before committing. See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for the pull request process.

## License

Apache-2.0: see [LICENSE](LICENSE) for the full text.
