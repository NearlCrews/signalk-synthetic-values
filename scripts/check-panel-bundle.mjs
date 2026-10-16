import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { findStrictVersionShares } from './repo-guards.mjs';

/**
 * Repository-specific checks on the built panel. The shared UI package's own
 * `snui-check-consumer`, which `npm run check:panel` runs right after this,
 * asserts the exact pin against the installed release, the host loading
 * contract, the version stamp in the built remote, the absence of a bundled
 * React runtime or a second React Aria copy, every `--snui-*` name in the
 * built CSS, the doubled override classes in the CSS modules, a render of the
 * remote the way the Admin host mounts it, the host share map, and the gzip
 * size baseline.
 */

// Signal K 2.24 Admin registers its React shares as 19.0.0 while shipping a
// newer React, so a strict share rejects a compatible host and the panel never
// mounts. The shares come from the shared UI package, so read them from the
// plugin instance webpack actually receives rather than from the config text.
const require = createRequire(import.meta.url);
const { ModuleFederationPlugin } = require('webpack').container;
const federationPlugins = require('../webpack.config.cjs').plugins.filter(
  (plugin) => plugin instanceof ModuleFederationPlugin
);
if (federationPlugins.length === 0) {
  throw new Error('webpack.config.cjs no longer configures a ModuleFederationPlugin.');
}
const strictShares = federationPlugins.flatMap((plugin) =>
  findStrictVersionShares(plugin.options.shared)
);
if (strictShares.length > 0) {
  throw new Error(
    `Module Federation shares must not be strict, or an Admin that under-reports its React version refuses the panel: ${strictShares.join(', ')}.`
  );
}

const outputDirectory = 'public';
const names = await readdir(outputDirectory);
const javascriptNames = names.filter((name) => name.endsWith('.js') || name.endsWith('.mjs'));
const cssNames = names.filter((name) => name.endsWith('.css'));
const cssSources = await Promise.all(
  cssNames.map((name) => readFile(join(outputDirectory, name), 'utf8'))
);
const combinedCss = cssSources.join('\n');
const stats = JSON.parse(await readFile('.tmp/panel-stats.json', 'utf8'));

if (stats.errorsCount !== 0 || stats.warningsCount !== 0) {
  throw new Error(
    `Panel build reported ${stats.errorsCount} errors and ${stats.warningsCount} warnings.`
  );
}

if (cssNames.length === 0) {
  throw new Error('The configuration panel did not emit its CSS module asset.');
}
for (const [index, source] of cssSources.entries()) {
  if (/\n{2,}$/.test(source)) {
    throw new Error(`Generated CSS asset ${cssNames[index]} ends with a blank line.`);
  }
}
if (combinedCss.includes('module__snui-')) {
  throw new Error('Webpack renamed a public signalk-nearlcrews-ui CSS identifier.');
}
if (!/@container\s+snui-panel\b/.test(combinedCss)) {
  throw new Error('The panel CSS did not preserve the shared snui-panel container name.');
}

console.log(
  `Panel bundle passed: ${javascriptNames.length} JavaScript files, ${cssNames.length} CSS ${cssNames.length === 1 ? 'file' : 'files'}, a clean build, non-strict shares, and the shared container name.`
);
