# Contributing

Thanks for your interest in contributing to Synthetic Values
(`signalk-synthetic-values`).

## Code of Conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). By
participating, you agree to uphold it.

## Reporting bugs

Check existing issues first to avoid duplicates, then open a bug report with:

- A clear title and description
- Steps to reproduce
- Expected vs actual behavior
- Environment details (plugin version, Signal K server version, Node.js
  version, OS)
- Relevant log output and the plugin configuration

## Suggesting enhancements

Open a feature request issue describing the proposed feature, the use case it
serves, and any implementation ideas you have.

## Development requirements

The published plugin supports Node 20.18 or newer at runtime. The development
and build toolchain requires Node `^22.22.2 || ^24.15.0 || ^26.0.0`. The checked-in
`.node-version` selects Node 22.23.1. Use `npm ci` to install the exact dependency
tree recorded in `package-lock.json`.

The test toolchain starts at Node 22: Vitest, jsdom, and jest-dom all declare
that floor. The advisory armv7 Cerbo GX lane in the official Signal K plugin
workflow therefore installs and builds the plugin but cannot run the unit
suite; upstream declares that lane `continue-on-error`, so it never gated a
release. What defends the published runtime floor is the blocking `node-20-runtime` job in
`.github/workflows/ci.yml`: it type-checks, builds the declaration and runtime
bundles, and imports the built artifact on 20.18. Keep `@types/node` on the
major named by `engines.node` so a Node API the floor cannot run never passes
the type checks; `scripts/check-package.mjs` enforces the pairing. Vitest
declares an optional `@types/node` peer at Node 22 types or newer, so the
`overrides` block in `package.json` holds that peer at the root pin. It changes
resolution only: TypeScript still reads the root `@types/node`.

## Pull requests

1. Fork the repository and create a feature branch from `main`.
2. Install dependencies with `npm ci`, then build with `npm run build`.
   Optional: enable the local pre-commit check with `npm run hooks` (it is not
   auto-installed). It runs `npm run check`; the full validation and browser
   matrix remain required before pushing.
3. Make focused commits with clear messages (see below).
4. Add tests for any new functionality and keep the existing suite green.
5. Run `npm run verify:release` before preparing a release.
6. Update documentation (`README.md` and `CHANGELOG.md`) as needed.
7. Open a pull request with a clear description of the change. For changes that
   touch the Signal K paths the plugin reads or emits, note the affected paths
   in the pull request description.

## Code style

- All source is TypeScript under `src/`. The plugin runtime is bundled to
  `dist/` by esbuild, and the React configuration panel is built to `public/`
  by webpack as an ESM Module Federation remote with JavaScript and CSS assets.
- Keep modules focused and small. Each module owns its own types alongside the
  code that uses them.
- Run source, Markdown, and spelling checks with `npm run lint`. Use
  `npm run lint:fix` to apply safe source fixes.
- Run `npm run knip` when adding or removing modules, exports, scripts, or
  dependencies.
- Do not edit `dist/` or `public/`; both are generated build output.
- The configuration panel bundles `signalk-nearlcrews-ui` at an exact pin and
  takes its Module Federation share map from `signalk-nearlcrews-ui/federation`.
  `npm run check:panel` runs the library's `snui-check-consumer` against the
  built remote (the pin, the version stamp, the share map, the absence of a
  React runtime, and the size baseline in `scripts/panel-size-baseline.json`);
  `scripts/check-panel-bundle.mjs` keeps only this repository's own build and
  CSS assertions. Read the library's migration guide before moving the pin.
- A panel CSS class that lands on a shared UI component is written doubled
  (`.name.name`) so it outranks the library's scoped rule; the doubling case in
  `test/configpanel/styles.test.ts` enforces it. Prefer a library prop over an
  override wherever one exists.
- Tests live in `test/`, mirroring the source structure, and run on Vitest
  (`npm test` for a single run, `npm run test:watch` for the watcher). Backend
  tests are type-checked by `npm run type-check:test`.
- Production-remote browser tests live in `tests/browser/`. Install Chromium,
  Firefox, and WebKit with
  `npx --no-install playwright install chromium firefox webkit`, then run
  `npm run test:browser:cross`.
- `test:browser:cross` and `test:browser:cross:built` run the same command. The
  first has a `pretest` hook that builds; the second does not, and exists for CI,
  where the `build` job has already produced the panel remote. Use the plain one
  locally.
- Browser tests start an isolated fixture server. If port 4175 is occupied, set
  `SYNTHETIC_VALUES_BROWSER_PORT` to an unused port from 1024 through 65535.
- Default to no comments. Add one only when the WHY is non-obvious (a hidden
  constraint, a subtle invariant, or a workaround).

## Architecture rule

This repository ships exactly ONE npm package and ONE Signal K plugin. Keep
the code modular by splitting it into focused files under `src/`. Never split
the project into multiple npm packages or a monorepo. New functionality is a
new module under `src/`, not a new package.

See the [README](../README.md) for the feature set, the configuration options,
and the build, test, and release commands.

## Commit messages

Use conventional-commit prefixes that match the actual diff scope:

```text
feat: add weighted-mean strategy for sensor fusion
fix: clamp outlier window when fewer than three sources are active
docs: update configuration table for the new default strategy
test: cover the single-source passthrough path
chore: update dependencies
```

## Release verification

Publishing requires explicit final approval. The publish workflow verifies the
release tag, runs `npm run verify:release`, injects the release commit as the
packed manifest's `gitHead`, and publishes that exact tarball with provenance.
After publishing, verify the registry artifact against the approved commit:

```bash
npm view signalk-synthetic-values@VERSION version gitHead dist.integrity dist.shasum --json
```

Confirm that `gitHead` equals the release commit, the npm version matches the
GitHub Release tag, the App Store hero is the first packaged screenshot, the
official Signal K plugin workflow is green on that commit, and a clean
temporary Signal K install can load the plugin and its panel remote.

## License and attribution

By contributing, you agree your contributions are licensed under the
Apache-2.0 License that covers this project.
