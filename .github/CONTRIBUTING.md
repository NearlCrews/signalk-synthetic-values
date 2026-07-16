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
and build toolchain requires Node `^22.18.0 || >=24.11.0`. The checked-in
`.node-version` selects Node 22.23.1. Use `npm ci` to install the exact dependency
tree recorded in `package-lock.json`.

## Pull requests

1. Fork the repository and create a feature branch from `main`.
2. Install dependencies with `npm ci`, then build with `npm run build`.
   Optional: enable the local pre-commit check with `npm run hooks` (it is not
   auto-installed). It runs `npm run check`; the full validation and browser
   matrix remain required before pushing.
3. Make focused commits with clear messages (see below).
4. Add tests for any new functionality and keep the existing suite green.
5. Run `npm run validate` and `npm run test:browser:cross` before pushing.
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
- Lint and format with Biome (`npm run lint`, or `npm run lint:fix` to
  auto-fix).
- Run `npm run knip` when adding or removing modules, exports, scripts, or
  dependencies.
- Do not edit `dist/` or `public/`; both are generated build output.
- Tests live in `test/`, mirroring the source structure, and run on Vitest
  (`npm test` for a single run, `npm run test:watch` for the watcher).
- Production-remote browser tests live in `tests/browser/`. Install Chromium,
  Firefox, and WebKit with
  `npx --no-install playwright install chromium firefox webkit`, then run
  `npm run test:browser:cross`.
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

```
feat: add weighted-mean strategy for sensor fusion
fix: clamp outlier window when fewer than three sources are active
docs: update configuration table for the new default strategy
test: cover the single-source passthrough path
chore: update dependencies
```

## License and attribution

By contributing, you agree your contributions are licensed under the
Apache-2.0 License that covers this project.
