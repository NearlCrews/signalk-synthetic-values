# signalk-synthetic-values

Combine redundant sensors on one Signal K path into a robust median or outlier-rejected synthetic value.

## Install

Install from the Signal K App Store: search for **Synthetic Values** and click Install. After installation, restart the server and configure the plugin from the admin UI under Server, Plugin Config, Synthetic Values.

## What it does

When two or more sources feed the same Signal K path (multiple GPS receivers on `navigation.position`, duplicate depth sounders, redundant wind or heading sensors), the Signal K server picks one source at a time. This plugin watches all sources together, computes a single robust value from them, and emits it as an additional source on the same path. One flaky or biased sensor cannot drag the result.

The synthetic value does not automatically win. You must set source priority once per path (see "Make the synthetic source win" below). Until you do, the top-level value flickers across all sources.

## Configuration options

### Global options

| Option | Default | Description |
| --- | --- | --- |
| `defaultStalenessTimeoutMs` | `1000` | A source whose last receipt is older than this is excluded from combining. Per-path overridable. |
| `defaultEmitMinIntervalMs` | `1000` | Minimum interval between synthetic emits for a path. Per-path overridable. |
| `defaultMinSources` | `2` | Minimum fresh sources required to emit a combined value. Per-path overridable; set to `1` to enable single-source passthrough. |
| `maxSourcesPerPath` | `16` | Global cap on tracked sources per path. |

### Per-path options

| Option | Default | Description |
| --- | --- | --- |
| `path` | required | The Signal K path to combine. Pick from the detected multi-source paths in the dropdown, or type a path directly. |
| `method` | `median` | Combining method: `median`, `trimmedMean`, or `mean`. Ignored for angular paths (which always use circular mean). |
| `trimFraction` | `0.25` | Fraction trimmed from each end when using `trimmedMean`. Falls back to median or mean at small N. |
| `outlierRejection` | `true` | Reject whole-source outliers before combining. |
| `madThreshold` | `3` | Sigma-equivalent multiplier for scaled-MAD outlier rejection when N is 4 or more. |
| `rejectThreshold` | unset | Absolute rejection distance in kind units (meters for position, radians for angular, value units for scalar). Used at small N or when the robust scale is degenerate. |
| `disagreeThreshold` | unset | Absolute distance in kind units above which sources are flagged as disagreeing in the plugin status. |
| `angularSpreadThreshold` | `pi/2` | Angular paths only: maximum circular pairwise spread in radians. Sources beyond this threshold cause the synthetic value to be suppressed. |
| `angular` | `auto` | Override angular detection: `auto`, `yes`, or `no`. `auto` uses the known-circular path list and metadata units. |
| `includeSources` | unset | If set, only these sourceRefs are combined for this path. Cannot be set together with `excludeSources`. |
| `excludeSources` | unset | If set, these sourceRefs are excluded for this path. Cannot be set together with `includeSources`. |
| `minSources` | global default | Per-path override for the minimum fresh sources required. |
| `stalenessTimeoutMs` | global default | Per-path override for the staleness timeout. |
| `emitMinIntervalMs` | global default | Per-path override for the minimum emit interval. |
| `jumpRejection` | unset (off) | Per-source jump rejection: `{ maxRate, persistSamples, persistMs }`. Rejects a sudden spike and re-accepts after a genuine step is confirmed. |
| `slewLimit` | unset (off) | Maximum change of the emitted value per second, in kind units. Clamps the output to suppress sudden jumps that survive rejection. |

The config dropdown shows paths the plugin has already seen with two or more sources. If a path does not appear yet, type it directly or reload the page after the sensors have been running for a moment.

## Make the synthetic source win

The synthetic value is emitted as an additional source alongside the raw sensors. With no priority set, the server uses last-writer-wins, so the displayed value flickers. You must set source priority once per path. The synthetic value does not win until this step is done.

1. Open the Signal K admin UI and navigate to **Server**, then **Data**, then **Sources** (Source Priorities).
2. Find the path you opted in (for example `navigation.position`).
3. Drag **signalk-synthetic-values** to the top of that path's source list.
4. Set a **timeout** on the synthetic source so that if the plugin stops emitting, the server falls back to a raw source rather than displaying a stale synthetic value.
5. Save. The plugin status will change from the priority-reminder message to "Combining N sources on M paths."

Repeat steps 2 through 4 for each path you have opted in.

## Plugin status messages

The plugin reports its state in the admin UI status line:

- **No multi-source paths detected yet** - the plugin is running but has not yet seen any path with two or more distinct sources.
- **Combining N sources on `<path>`. Set this path's source priority...** - the path is opted in and combining, but source priority has not been set yet for that path.
- **`<path>`: running on 1 source, redundancy lost** - only one fresh source is available.
- **`<path>`: waiting for N sources (have K)** - not enough fresh sources to combine.
- **`<path>`: sources diverge, synthetic value suppressed** - angular sources point in opposite directions, or position sources are too far apart to combine safely.
- **`<path>`: sources disagree (max spread X), emitting `<method>`** - the spread exceeds `disagreeThreshold` but a combined value is still emitted.
- **Combining N sources on M paths** - fully operational.

## What's new in 0.1.0

- Initial release. Combine multiple sources of one Signal K path into a robust synthetic value: median, trimmed mean, or mean, with kind-aware outlier rejection, angular divergence guards, and disagreement detection.
- Auto-detection of multi-source paths, opt-in per path.
- Optional jump rejection and output slew limiting.

## License

Apache-2.0
