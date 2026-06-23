# Config UI: list and combine detected multi-source paths

- Date: 2026-06-23
- Status: approved design, pre-implementation
- Branch: `feat/config-ui`
- Scope decided: Phase 0 discovery fix, then the full React configurator panel, including a guarded "Combine all".

## 1. Problem

The plugin auto-detects Signal K paths reported by two or more sources (redundant GPS, depth, wind, etc.) so the user can combine them into one robust value. Today the user must type path strings into the config form. The user wants the config UI to SHOW the detected duplicate paths so they can see them and opt them in directly.

## 2. Blocking prerequisite (Phase 0): make detection config-independent

A latent bug blocks the whole feature. In `src/index.ts`, `discovery.observe(pv.path, src)` runs only after the `if (!cfg) return` gate inside `observeValue`, so `Discovery` records sources only for paths the user has ALREADY configured. The `/detected` endpoint and the schema hints can therefore never show un-configured duplicates, which is exactly what this feature needs.

Fix:

- In the observe path, call `discovery.observe(pv.path, src)` for every fresh self-context value BEFORE the `byPath` gate. Keep `registry.update` and `maybeEmit` gated on `byPath` (only configured paths are combined and emitted). Own-source deltas are already filtered by `isOwnSource`, so the synthetic source never pollutes discovery.
- Bound the discovery store: `Discovery` gains a `maxPaths` cap (default 200) and evicts the least-recently-seen path when exceeded, so observing all self paths cannot grow without limit. Track a last-seen timestamp per path for eviction and for a "re-scan / forget history" affordance later.
- Move the REST route from `/plugins/signalk-synthetic-values/detected` to `/plugins/signalk-synthetic-values/api/detected`, matching the sibling `api-base` convention so the panel's fetch base drops in unchanged.
- Tests: discovery records a path with 2+ sources even when that path is NOT in the config; the cap evicts the oldest; the self source is excluded; the route responds at the `/api/detected` path.

This phase is required for either UI surface and is a correctness fix in its own right.

## 3. Architecture: the configurator panel

A React panel rendered inside the Signal K admin UI, following the sibling pattern exactly (verified against `signalk-virtual-weather-sensors`, `signalk-nmea2000-emitter-cannon`, and `signalk-openrouter-companion`).

- Webpack Module Federation, exposed as `./PluginConfigurationPanel`, triggered by the `signalk-plugin-configurator` keyword. Because the package is `"type": "module"`, the build uses `library: { type: 'module' }`, `experiments.outputModule`, `output.module`/`chunkFormat: 'module'`, and `react`/`react-dom` as shared singletons whose `requiredVersion` comes from devDependencies. Output to `public/`.
- The admin UI mounts the federated module and passes exactly two props: `configuration` (the current saved `PluginOptions`) and `save(config)` (persists and restarts the plugin). There is no auth token, base URL, or server-context prop. The panel derives its API base as `/plugins/signalk-synthetic-values/api` and relies on same-origin cookie credentials.
- `save()` resolves with no useful value, so success is confirmed by polling after save (see 4). Never fire-and-forget.
- The plugin runtime stays esbuild ESM. The panel is a separate webpack build into `public/`. Two independent steps under one `npm run build`, mirroring the siblings. No `signalk` manifest configurator entry is needed: the keyword plus the fixed `./PluginConfigurationPanel` expose name is the entire contract.

### 3.1 Build, deps, and packaging

- `package.json`: add `signalk-plugin-configurator` to `keywords`; add `public/` to `files`; add devDependencies `react`, `react-dom`, `@types/react`, `webpack`, `webpack-cli`, `babel-loader`, `@babel/core`, `@babel/preset-react`, `@babel/preset-typescript` (match the sibling versions); add scripts `build:panel` (webpack, folded into `build`) and `type-check:panel` (`tsc -p tsconfig.panel.json --noEmit`, folded into `type-check`/`validate`). No `prepare`/`prepack` lifecycle script. The clean script (already `scripts/clean.mjs`) also removes `public/`.
- `webpack.config.cjs` and `tsconfig.panel.json`: copy the sibling form, retargeted (jsx `react-jsx`, module ESNext, moduleResolution Bundler, include `src/configpanel`).
- Compliance: react/webpack/babel are devDependencies only, so `npm audit --omit=dev` is unaffected. `public/remoteEntry.js` and its chunks MUST appear in `npm pack --dry-run`, or the admin UI renders "Plugin Configuration Unavailable". The panel makes real screenshots possible, which clears the last validator warning. CI must build the panel on the lowest advertised Node (>=20.18) across Linux, macOS, and Windows; webpack and babel are cross-platform.

### 3.2 File layout

```
src/configpanel/
  index.tsx                    re-export of PluginConfigurationPanel
  PluginConfigurationPanel.tsx composition root: { configuration, save } props, theme provider, layout
  api-base.ts                  the /api base plus a fetchJson helper (same-origin credentials)
  styles.ts                    the --skn-* token blocks and the S style object (copied from the cannon, retargeted)
  hooks/
    useDetected.ts             poll GET /api/detected (visibility-aware, changed-payload gate)
    usePanelConfig.ts          form state over the whole PluginOptions, save-and-confirm
  components/
    DetectedPathList.tsx       container: header, empty/loading/error states, rows, Combine all
    DetectedPathRow.tsx        one row: rail, path, badges, chips, opt-in control, Tune
    SourceChips.tsx            source-ref chips with +N overflow
    KindBadge.tsx              position/angular/scalar/other/unknown pill
    SourceChecklist.tsx        include/exclude as a checklist seeded from the row's live sources
    PerPathSettings.tsx        the Tune and Advanced disclosure tiers
    PriorityBanner.tsx         the persistent priority handoff banner
    ThemeToggle.tsx            the Auto/Light/Dark/Night segmented control (from the siblings)
  kindMeta.ts                  pure map kind -> { label, token, srLabel }
```

## 4. Data flow and API contract

- `GET /api/detected` returns the existing shape `{ paths: [{ path, sources: string[], kind, optedIn }] }`, fed by the config-independent discovery (Phase 0). `optedIn` is `byPath.has(path)`, recomputed server-side after each save-and-restart.
- `useDetected` polls every 10 seconds, pauses on a hidden tab, refreshes on visibility, and gates on a changed payload so an idle panel does no work. A "last checked" timestamp and a manual "Refresh" control sit at the top.
- The panel holds the whole `PluginOptions` as form state (NOT just `paths`), so the top-level defaults (`defaultStalenessTimeoutMs`, `defaultEmitMinIntervalMs`, `defaultMinSources`, `maxSourcesPerPath`) are preserved on save. Reconcile detected paths against the form `paths` by path string: trust server `optedIn` for initial render, local form state for in-session edits, to avoid a flicker where a just-added unsaved path still reports `optedIn: false`.
- Opting a path in appends `{ path }` to `paths`. Every other per-path field is optional and resolved at validation time from the plugin-level defaults (`validateConfig` fills `method: median`, `angular: auto`, `trimFraction: 0.25`, staleness/emit/minSources from the defaults). The minimal opt-in payload is `paths.push({ path })`.
- Save: the panel calls `save({ ...options, paths: nextPaths })`, awaits it, then polls `/api/detected` to confirm the restart and refresh `optedIn`. No write endpoint is added to the plugin router: config persistence flows through the admin UI's authenticated `save()` channel. A read-only `GET /api/detected` stays open (consistent with the siblings' open status reads); if any write route is ever added it gets `addAdminWriteMiddleware`.

## 5. Interaction design and information architecture

The user's goal is "make my boat show one trustworthy number for this path", not "configure a synthetic value". The UI speaks in those terms. Combining is only half the fix: the plugin emits an extra source, and the boat shows no change until the user sets Signal K source priority to prefer it. The priority step is the second half of the primary task, carried in the flow, not an epilogue.

### 5.1 Flow

1. First run (the normal empty state): detection has no live data yet, so the list is empty. This is expected, not an error. Copy: "No duplicate paths detected yet. This plugin watches your live data for paths reported by two or more sources. Leave your instruments running for a minute, then refresh." A "Refresh" control and a "last checked" timestamp sit at the top; the panel polls quietly and fills rows in as they appear.
2. Duplicates appear: rows populate, sorted with the most-redundant, not-yet-combined paths first.
3. Primary action, "Combine": each combinable row has one primary button. Clicking it opts the path in with defaults and writes config immediately; the row flips to "Combined" in place. No dialog, no required field.
4. "Combine all": a single action above the list combines every combinable, not-yet-configured detected path with defaults. It shows a count confirmation first ("Combine 5 detected paths with default settings? You can exclude individual sources afterward."), then writes. It never touches already-combined or non-combinable paths. The per-path exclude-a-bad-source affordance (5.4) is the guardrail.
5. Priority handoff: the instant the first path is combined, a persistent, dismissible banner appears: the synthetic value is published as the source `signalk-synthetic-values`, and the user must set it as top priority per combined path in Signal K's Data, Source priorities, with a deep link. Each combined row carries a per-path "Priority not set, the boat is not using this yet" indicator. In v1 this is an instruction and link, NOT a "Preferred" checkmark, because the plugin cannot read priority (`prioritySet` is empty by design); claiming a state we cannot observe is a worse footgun than admitting we cannot.
6. Confirmation of success: per row, a live "combining N of M sources" readout and the current combined value. Globally, the existing `summaryStatus` line surfaced read-only at the top.

### 5.2 Row contents (collapsed default)

Path (the full path string, the row's identity), source count plus kind together ("4 sources, position"), a compact sources chip that reveals the `$source` list on hover or tap, the state (Combinable, Combined with its priority sub-state, or Cannot combine with a one-line reason), and once combining a live value preview with "N of M sources fresh".

### 5.3 Sort and grouping

A single flat list (the list is short by nature) sorted by: not-yet-combined combinable paths first, then by source count descending, then combined paths, then non-combinable paths collapsed under a quiet "Detected but not combinable (N)" disclosure. This puts "what should I do" on top and "what I already did" and "what I cannot do" below.

The detected list is the single source of truth for "what is configured": a configured path appears as a "Combined" row in the same list (a manually-typed path with no live second source yet shows "Combined, waiting for a second source"). There are not two screens to keep in sync.

### 5.4 Progressive disclosure of per-path settings

- Tier 0 (default, nothing shown): combine with defaults. Most paths never need config opened.
- Tier 1, "Tune" (the common knobs): method (median, trimmed mean, mean), minimum sources, and an include/exclude SOURCE CHECKLIST seeded from the row's live sources (uncheck a source to ignore it). The checklist structurally cannot set both include and exclude, removing that error class.
- Tier 2, "Advanced" (the long tail, collapsed): `madThreshold`, `rejectThreshold`, `disagreeThreshold`, `angularSpreadThreshold`, `trimFraction`, the `angular` override, jump rejection, slew limit, staleness, and emit interval, each showing its current effective value before override.

### 5.5 States and edge cases (first-class)

- Empty (first run): the explanatory state above.
- Loading or refreshing: non-blocking; rows stream in; a subtle "checking" indicator and "last checked HH:MM".
- A combined path loses its second source: the row stays and shows "1 of 2 sources fresh, waiting", never silently vanishes. A detected-only path that drops below two sources can leave the list, with a quiet "some duplicates may have stopped reporting" note.
- Already opted in: shown as "Combined" in place with its live readout and priority sub-state, not duplicated, not offered again.
- Non-combinable (classifier kind `other`, a non-position object or a string): in the collapsed group, disabled, with a plain reason ("this value is text, not a number or position, so it cannot be averaged").
- Kind still `unknown` (detected but not yet classified): shown as "Combinable (kind pending)"; combining is allowed, classification resolves on first value.
- Detected-list staleness: the "last checked" timestamp plus a "Re-scan" or "Forget detected history" action so a user who fixed their wiring sees current reality, not a stale union of every source ever seen.

### 5.6 Guardrails

- Non-combinable paths are never clickable to combine (the disabled state prevents the basic footgun at the UI layer).
- Raising `minSources` above the row's current source count warns inline ("this path has 3 sources, requiring 4 means it will never combine") without blocking (sources can grow).
- The forgotten priority step is the biggest footgun: the persistent banner, the per-path "not preferred yet" indicator, and the deep link all target it. "Combined but not preferred" is treated as an incomplete task.
- The include/exclude checklist cannot produce the both-set conflict the config layer rejects.
- "Combine all" confirms the count first and never touches non-combinable or already-combined paths.

## 6. Visual design and house consistency

Reuse the sibling design system verbatim; do not invent a new one.

- Token namespace `--skn-*`, defined once per theme in `styles.ts`, mirroring the cannon block order: scale tokens plus the light block on `.skn-panel`, the host-dark override (`[data-bs-theme="dark"]`, `.dark-mode`), then pinned `[data-skn-theme="light|dark|night"]` blocks last so an explicit choice outranks the host. Copy the cannon token blocks (surface, text, accent, ok/wait/off, danger/warn/success/info) value-for-value; the night-red palette is hand-tuned and must not be regenerated. Scale tokens: radius 6/4/999, font 14/12/15, space 8/12/16.
- Surfaces are explicit per theme (white in light, slate `#262833` in dark, near-black `#160a0a` in night); never derive a surface from the host page.
- Primitives lifted from the cannon and weather panels: `ThemeToggle` plus the segmented control (36px segments), `CollapsibleSection`, a disclosure caret, the save/footer bar, number inputs, and the `S` style object with its `btn()`/`btnClass()` helpers and the injected stylesheet (`:focus-visible` ring `outline: 2px solid var(--skn-accent)`, disabled-button override, hover brightness). Ported unchanged.

### 6.1 Row anatomy (left to right)

A left rail (3px `border-left`): solid `--skn-ok` when opted in, transparent when available, so opted-in paths anchor down the left edge. Then the opt-in control: a primary `Add`/`Combine` button when available, swapping to a secondary `Remove` plus the indicator when combined (a button, not a bare checkbox, because the action writes a whole config object); minimum 40px tall for helm touch. Then the path label (`--skn-font-body`, `--skn-text`, truncating). Then the source-count badge, the headline datum, a pill in `--skn-info-bg`/`--skn-info-fg` with an `aria-label` spelling out "3 sources". Then the source chips (`--skn-surface-raised`, `--skn-font-small`, `--skn-text-muted`), collapsing past 3 to "+N more" with the full list in a `title` and a visually-hidden enumeration. Then the kind badge, the quietest pill (`--skn-surface-muted`/`--skn-text-muted`, shape and text, no saturated color). Then the opted-in indicator, a "added" pill in `--skn-success-bg`/`--skn-success-fg`, carrying its text label.

### 6.2 State visuals

Each state reads by a distinct token family AND carries text, so the night-red theme (where hues collapse) stays legible: empty and loading use muted info-toned centered text (no spinner churn); available is the default actionable row; opted-in uses the solid ok rail plus the added pill plus the Remove label (three redundant cues); non-combinable dims to `--skn-text-faint` with a disabled Add and a warn pill "not combinable", the reason in the button's `aria-describedby`; error uses the shared danger banner above the list with a retry, never a silent empty list. No raw hex anywhere (a literal would not collapse at night).

### 6.3 Theming, accessibility, and the plugin motif

- Night-red: every badge uses a token family already redefined in the cannon night block; because no state is encoded by hue alone, the list stays legible when every color is a shade of red.
- Contrast: the info/success/warn/danger fg-on-bg pairs are AA-tuned in all three themes; reuse them, add nothing. The quiet kind badge uses `--skn-text-muted` on `--skn-surface-muted` (AA in the shipped palettes).
- Focus: the shared `:focus-visible` ring covers every button; do not suppress it. Keyboard: `Add`/`Remove`/`Refresh` are real `<button>`s in DOM order; an expandable Tune row follows the cannon toggle-button-plus-`aria-expanded`-plus-`aria-controls` and focus-return pattern. Screen reader: the source count and kind ride into each row's accessible name via visually-hidden spans; a polite `role="status"` region announces the detected count after each refresh and after Add/Remove. Touch: 40px targets, 12px row gaps, non-interactive chips.
- The green funnel motif appears once, small, beside the panel header title, as an inline SVG in `currentColor` so it recolors per theme (including red at night). The panel is NOT themed green and badges are NOT tinted brand-green: green already means "opted-in / ok" here, so a brand green elsewhere would be ambiguous. One header glyph, nothing more.

## 7. Testing

- Phase 0 (Vitest, plugin side): discovery records an un-configured multi-source path; the cap evicts the oldest; the self source is excluded; combine and emit still only run for configured paths; the `/api/detected` route responds with the documented shape.
- Panel hooks (Vitest with jsdom or a thin DOM shim): `useDetected` polling, visibility pause, and changed-payload gate; `usePanelConfig` reconcile (server `optedIn` vs local edits), the minimal `{ path }` opt-in payload, top-level-defaults preservation on save, and the save-then-confirm cycle.
- Panel components (Vitest plus Testing Library): a row renders the count and kind with correct accessible names; the opt-in control writes the expected config and flips state; the non-combinable row is disabled with its reason; "Combine all" confirms and adds only combinable, not-yet-configured paths; the source checklist cannot emit both include and exclude; the empty, loading, and error states render.
- Build: `npm pack --dry-run` includes `public/remoteEntry.js`; `type-check:panel` is clean; the App Store validator stays at 0 errors.

## 8. Out of scope (v1)

- No automatic setting of Signal K source priority (the plugin emitting a source and the user choosing to prefer it is the correct separation; writing priority config is a large, risky surface). v1 instructs and deep-links; verified priority status waits until the plugin can read priority.
- No threshold visualization or tuning charts (advanced thresholds are plain inputs showing their effective defaults).
- No category bucketing or search of the detected list (it is short; sort plus the collapsed non-combinable group suffices).

## 9. Open questions

- The exact sibling dependency versions for react, webpack, and babel to pin (read from `signalk-virtual-weather-sensors/package.json` at build time).
- Whether the "Forget detected history / Re-scan" action clears the server-side discovery store via a new authenticated route or only resets the panel's view; decide during implementation, defaulting to a panel-only reset if a write route would add surface.

## Appendix A: verified mechanics facts

Confirmed against the sibling repos and signalk-server source:
- The admin UI passes only `{ configuration, save }` to the federated `./PluginConfigurationPanel`; `save()` resolves with no value, so success is confirmed by polling.
- Plugin routers mount at `/plugins/<id>` with no auth middleware by default; `addAdminMiddleware`/`addAdminWriteMiddleware`/`addWriteMiddleware` exist if a write route is ever added.
- The `signalk-plugin-configurator` keyword plus the fixed `./PluginConfigurationPanel` expose name is the entire wiring contract; no `signalk` manifest entry is required.
- The package is `"type": "module"`, so the panel must use the ESM Module Federation form (`library: { type: 'module' }`, `experiments.outputModule`).
- `public/` must be in `files` or the federated bundle is absent from the tarball.
