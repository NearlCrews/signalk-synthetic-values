import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Repository-specific checks on the built panel. The shared UI package's own
 * `snui-check-consumer`, which `npm run check:panel` runs right after this,
 * asserts the exact pin against the installed release, the version stamp in
 * the built remote, the absence of a bundled React runtime, the host share map
 * in both the remote and webpack.config.cjs, and the gzip size baseline.
 */

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

const remoteEntry = await readFile(join(outputDirectory, 'remoteEntry.js'), 'utf8');
if (!remoteEntry.includes('export')) {
  throw new Error('The ESM Module Federation remote does not export its container.');
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
for (const token of ['--snui-color-text-muted', '--snui-color-border', '--snui-space-2']) {
  if (!combinedCss.includes(`var(${token})`)) {
    throw new Error(`The panel CSS did not preserve the public ${token} token.`);
  }
}
if (!/@container\s+snui-panel\b/.test(combinedCss)) {
  throw new Error('The panel CSS did not preserve the shared snui-panel container name.');
}

function collectModuleNames(modules = []) {
  return modules.flatMap((module) => [
    module.name,
    ...collectModuleNames(module.modules ?? []),
    ...collectModuleNames(module.children ?? []),
  ]);
}

const moduleNames = collectModuleNames(stats.modules).filter((name) => typeof name === 'string');
if (!moduleNames.some((name) => name.includes('signalk-nearlcrews-ui'))) {
  throw new Error('Webpack statistics do not show the shared UI package in the panel bundle.');
}

// The consumer check rejects React runtime markers in the emitted files; the
// module list is the stricter view, because it names every React file webpack
// bundled rather than the ones that happen to carry a marker.
const bundledReactModules = moduleNames.filter((name) =>
  /node_modules[\\/]react(?:-dom)?[\\/]/.test(name)
);
const unexpectedReactModules = bundledReactModules.filter(
  (name) =>
    !/[\\/]react[\\/]jsx-runtime\.js$/.test(name) &&
    !/[\\/]react[\\/]cjs[\\/]react-jsx-runtime\.production\.js$/.test(name)
);
if (unexpectedReactModules.length > 0) {
  throw new Error(
    `The panel bundled unexpected React modules: ${unexpectedReactModules.join(', ')}.`
  );
}

console.log(
  `Panel bundle passed: ${javascriptNames.length} JavaScript files, ${cssNames.length} CSS ${cssNames.length === 1 ? 'file' : 'files'}, a clean build, preserved public tokens, and only the JSX runtime from React.`
);
