import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import webpack from 'webpack';

/**
 * The configuration panel is a Module Federation remote, so webpack bundles its
 * dependency tree into public/*.mjs and the published package redistributes
 * that code. MIT requires the copyright and permission notice to travel with a
 * copy, and Apache-2.0 section 4(a) requires giving recipients the license.
 * Terser extracts only comments carrying an @license or @preserve marker, and
 * nearly every package here ships none, so the emitted sidecar discharges
 * neither obligation on its own.
 *
 * The plugin bundle needs no entry. esbuild builds dist/index.js from this
 * repository's own sources, and the only packages it names are type-only
 * imports that compile away, so it carries no third-party code.
 *
 * Run `npm run licenses` to regenerate. `--check` verifies the committed file
 * against the installed tree without paying for a second webpack build, and
 * runs inside `npm run package:check`.
 */

const repositoryDir = new URL('../', import.meta.url);
const noticesUrl = new URL('THIRD_PARTY_NOTICES.md', repositoryDir);
const checkOnly = process.argv.includes('--check');

const HEADER_MARKER = '<!-- generated-for-signalk-nearlcrews-ui:';

function readJson(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, repositoryDir), 'utf8'));
}

/**
 * The shared UI version comes from the manifest rather than a literal in this
 * file, so a re-pin touches one place. `scripts/check-package.mjs` owns the
 * tripwire that an unreviewed bump has to clear.
 */
function sharedUiVersion() {
  const pinned = readJson('package.json').devDependencies?.['signalk-nearlcrews-ui'];
  if (typeof pinned !== 'string' || !pinned) {
    throw new Error('package.json does not pin signalk-nearlcrews-ui.');
  }
  // Resolved by path: the package exports no ./package.json subpath.
  const installed = readJson('node_modules/signalk-nearlcrews-ui/package.json').version;
  if (installed !== pinned) {
    throw new Error(
      `Installed signalk-nearlcrews-ui ${String(installed)} does not match package.json ${pinned}.`
    );
  }
  return installed;
}

function licenseTextFor(name) {
  for (const candidate of ['LICENSE', 'license', 'LICENSE.md', 'LICENSE.txt']) {
    const url = new URL(`node_modules/${name}/${candidate}`, repositoryDir);
    if (existsSync(url)) return readFileSync(url, 'utf8').trim();
  }
  return null;
}

function licenseIdFor(name) {
  const manifest = readJson(`node_modules/${name}/package.json`);
  return typeof manifest.license === 'string' ? manifest.license : 'see below';
}

function collectModules(modules = []) {
  return modules.flatMap((module) => [
    module,
    ...collectModules(module.modules ?? []),
    ...collectModules(module.children ?? []),
  ]);
}

/**
 * Webpack's own bootstrap, chunk loader, CSS loader, and Module Federation
 * share-scope code are generated into the emitted files, but they are reported
 * as `webpack/runtime/*` with no node_modules path, so the package scan below
 * cannot see them by name. Attribute webpack whenever the build reports them.
 */
function emitsWebpackRuntime(modules) {
  return modules.some(
    (module) =>
      module.moduleType === 'runtime' ||
      (typeof module.name === 'string' && module.name.includes('webpack/runtime'))
  );
}

/** Ask webpack which packages it actually bundles, rather than guessing from the manifest. */
async function bundledPackageNames() {
  const require = createRequire(import.meta.url);
  const config = require('../webpack.config.cjs');
  const stats = await new Promise((resolve, reject) => {
    webpack(config, (error, result) => {
      if (error) reject(error);
      else if (!result) reject(new Error('Webpack completed without build statistics.'));
      else resolve(result);
    });
  });
  if (stats.hasErrors()) {
    throw new Error('Webpack reported errors, so its module list cannot be trusted.');
  }
  const statsJson = stats.toJson({
    all: false,
    chunkModules: true,
    chunks: true,
    modules: true,
    nestedModules: true,
    runtimeModules: true,
  });
  const modules = collectModules(statsJson.modules);
  const names = new Set();
  if (emitsWebpackRuntime(modules)) names.add('webpack');
  for (const { name: moduleName } of modules) {
    const match = /node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/.exec(moduleName ?? '');
    if (match?.[1]) names.add(match[1].replace(/\\/g, '/'));
  }
  return [...names].sort();
}

function render(names, version) {
  const sections = names.map((name) => {
    const id = licenseIdFor(name);
    const text = licenseTextFor(name);
    const body =
      text === null
        ? `This package ships no license file. Its manifest declares ${id}.`
        : `\`\`\`text\n${text}\n\`\`\``;
    return `## ${name}\n\nLicense: ${id}\n\n${body}`;
  });
  // Each entry is one rendered paragraph. Keep a wrapped paragraph as a single
  // string: splitting it across entries would render every line as its own
  // paragraph.
  return [
    '# Third-party notices',
    `${HEADER_MARKER}${version} -->`,
    [
      'The configuration panel is a Module Federation remote, so the packages below',
      'are bundled into `public/*.mjs` and redistributed with this plugin. Their',
      'licenses follow. Regenerate with `npm run licenses` after any change to the',
      "panel's dependency tree.",
    ].join('\n'),
    [
      'React and React DOM are supplied by the Signal K admin host as singletons and',
      'are not bundled here; the React entry that does appear is the JSX runtime.',
      'Webpack is listed because its module bootstrap, chunk loader, style loader, and',
      'Module Federation share-scope code are generated into the same files, even though',
      'those runtime modules carry no package path of their own. The plugin bundle',
      "`dist/index.js` is built from this repository's own sources by esbuild and carries",
      'no third-party code.',
    ].join('\n'),
    ...sections,
  ].join('\n\n');
}

const version = sharedUiVersion();

if (checkOnly) {
  if (!existsSync(noticesUrl)) {
    throw new Error('THIRD_PARTY_NOTICES.md is missing; run npm run licenses.');
  }
  const current = readFileSync(noticesUrl, 'utf8');
  if (!current.includes(`${HEADER_MARKER}${version} -->`)) {
    throw new Error(
      `THIRD_PARTY_NOTICES.md was generated for a different signalk-nearlcrews-ui than ${version}; run npm run licenses.`
    );
  }
  // Every package the file names must still resolve with the license it claims,
  // which catches a removal or a relicense without paying for a webpack build.
  const listed = [...current.matchAll(/^## (\S+)$/gm)].map((match) => match[1]);
  if (listed.length === 0) throw new Error('THIRD_PARTY_NOTICES.md lists no packages.');
  for (const name of listed) {
    if (!existsSync(new URL(`node_modules/${name}/package.json`, repositoryDir))) {
      throw new Error(`THIRD_PARTY_NOTICES.md names ${name}, which is no longer installed.`);
    }
    const declared = licenseIdFor(name);
    if (!current.includes(`## ${name}\n\nLicense: ${declared}\n`)) {
      throw new Error(`${name} now declares ${declared}; run npm run licenses.`);
    }
  }
  process.stdout.write(`Third-party notices cover ${listed.length} bundled packages.\n`);
} else {
  const names = await bundledPackageNames();
  if (names.length === 0) throw new Error('Webpack reported no bundled packages.');
  writeFileSync(noticesUrl, `${render(names, version)}\n`);
  process.stdout.write(`Wrote THIRD_PARTY_NOTICES.md for ${names.length} bundled packages.\n`);
}
