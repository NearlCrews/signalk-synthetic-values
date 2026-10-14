# signalk-synthetic-values

A Signal K server plugin that combines redundant sensors on one Signal K path
into a robust median, trimmed mean, or outlier-rejected value, and publishes it
under its own source. The runtime is TypeScript bundled to `dist/` by esbuild.
The React configuration panel is an ESM Module Federation remote built to
`public/` by webpack on `signalk-nearlcrews-ui`, which the Signal K Admin UI
mounts in place of the generated form. `public/` is committed. An ESM remote
needs Signal K 2.25.0 or newer: 2.24.0 injects remotes as classic scripts, so
the panel cannot mount there. `.github/CONTRIBUTING.md` has contributor detail.

## Architecture rule

One npm package, one Signal K plugin. New functionality is a new focused module
under `src/`, never a new package or a monorepo.

## Gates

| Command | When it runs | What it adds |
| --- | --- | --- |
| `npm run verify:commit` | pre-commit hook | lint (Biome, markdownlint, cspell), workflow contracts, knip |
| `npm run verify` | pre-push hook | type checks, unit tests with coverage thresholds, build, package check, runtime audit |
| `npm run verify:browser` | configuration panel changes | the Playwright matrix: Chromium, Firefox, WebKit, and mobile Chromium |
| `npm run verify:release` | before tagging, and in the publish workflow | the full dependency audit, development tools included |

Enable the hooks once per clone with `npm run hooks` (it sets
`core.hooksPath` to `.githooks`). `verify` never runs a browser suite or the
development-tree audit.

CI layout: `ci.yml` runs the Node-independent gates and coverage once on Node
22.22.2, unit tests on Node 26, the Node 20.18 runtime smoke, the build with
the browser matrix, and the Signal K Admin job, which installs the packed
tarball into Signal K 2.25.0 and latest and mounts the production panel in
Chrome (`npm run test:integration`). `plugin-ci.yml` calls the official
reusable workflow on Node 22 and 24 for pushes to `main`, pull requests, and a
weekly run scheduled after every other one, because the registry reads only
the newest 20 runs on a release commit. `workflow-security.yml` runs
actionlint, zizmor, and the weekly full dependency audit. Add no other
scheduled workflow.

Deterministic guards, each tested in `test/repo-guards.test.ts`. Update a
guard in the same change as the file it guards.

- `scripts/check-workflows.mjs`: action pins, concurrency, schedules, audit
  placement, plugin CI inputs, the Admin job matrix against the README panel
  floor, and a Playwright install for every engine the Playwright config
  launches.
- `scripts/check-package.mjs`: packed contents, and no relative link targets in
  `README.md`, because the App Store renders links unmodified.
- `scripts/check-panel-bundle.mjs`: no strict Module Federation share, because
  Signal K Admin through at least 2.24 registers React as 19.0.0, and a strict
  share refuses such a host.

## Release authority

The version number, the tag, and the npm publish each need the owner's
explicit go. Propose a version freely; never tag or publish on inference. Tag
only a `main` commit whose CI and plugin CI runs are green.

## Shared skills

Domain expertise lives in the shared skills installed for both Claude Code and
Codex from the owner's local agent toolkit. Load these before working here:

- `signalk-development`: plugin lifecycle, server APIs, deltas, schemas, route
  security, package metadata, App Store, registry score, plugin CI, and release
  readiness.
- `standardize-project-toolchain`: lint, type, test, and CI alignment, and Node
  or TypeScript floor decisions.
- `maritime-ui`, plus `better-accessibility`, `better-colors`, `better-layout`,
  `better-typography`, and `better-writing`: only for work on the configuration
  panel in `src/configpanel`.

To delegate, spawn a general-purpose subagent and name the skills to load.

## Writing rules

For code comments, docs, CHANGELOG entries, commit messages, and PR text:

- No em dashes. Use a colon, a comma, or two sentences.
- Oxford comma in every list of three or more.
- Write "and", never the ampersand, in prose and UI text.
- "chartplotter" is one word.
- Describe what changed, never how it was produced or reviewed.
