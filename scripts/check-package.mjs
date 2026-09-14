import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
if (Object.hasOwn(packageJson, 'gitHead')) {
  throw new Error(
    'gitHead must be injected into the release artifact, not committed to package.json.'
  );
}
if (packageJson.packageManager !== 'npm@12.0.2') {
  throw new Error('packageManager must pin the contributor and release toolchain to npm 12.0.2.');
}
const { stdout } = await execFileAsync(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['pack', '--dry-run', '--json', '--ignore-scripts'],
  { maxBuffer: 10 * 1024 * 1024 }
);
const parsedPackResult = JSON.parse(stdout);
const packResults = Array.isArray(parsedPackResult)
  ? parsedPackResult
  : Object.values(parsedPackResult);
if (packResults.length !== 1 || !Array.isArray(packResults[0]?.files)) {
  throw new Error('npm pack must return exactly one package with a file manifest.');
}
const [packResult] = packResults;
const files = new Set(packResult.files.map((file) => file.path));
const normalizeDeclaredPath = (declaredPath) => declaredPath.replace(/^\.\//, '');

for (const requiredPath of [
  'CHANGELOG.md',
  'LICENSE',
  'README.md',
  'dist/index.d.ts',
  'dist/index.js',
  'dist/index.js.map',
  'package.json',
  'public/remoteEntry.js',
]) {
  if (!files.has(requiredPath)) {
    throw new Error(`Packed package is missing ${requiredPath}.`);
  }
}

const expectedDistFiles = new Set(['dist/index.d.ts', 'dist/index.js', 'dist/index.js.map']);
for (const file of files) {
  if (file.startsWith('dist/') && !expectedDistFiles.has(file)) {
    throw new Error(`Packed package contains an unsupported internal build artifact ${file}.`);
  }
}
const rootDeclaration = await readFile('dist/index.d.ts', 'utf8');
if (/\bfrom\s+['"]\.\//.test(rootDeclaration) || /\bimport\(['"]\.\//.test(rootDeclaration)) {
  throw new Error('dist/index.d.ts references an internal declaration that is not exported.');
}

const rootExport = packageJson.exports?.['.'];
const declaredEntrypoints = [
  ['main', packageJson.main],
  ['types', packageJson.types],
  [
    'exports["."].import',
    typeof rootExport === 'object' && rootExport !== null ? rootExport.import : rootExport,
  ],
  [
    'exports["."].types',
    typeof rootExport === 'object' && rootExport !== null ? rootExport.types : undefined,
  ],
];
for (const [field, declaredPath] of declaredEntrypoints) {
  if (typeof declaredPath !== 'string' || !declaredPath.trim()) {
    throw new Error(`${field} must declare a non-empty package-relative entrypoint.`);
  }
  const packedPath = normalizeDeclaredPath(declaredPath.trim());
  if (packedPath.startsWith('../') || packedPath.startsWith('/') || !files.has(packedPath)) {
    throw new Error(`${field} does not resolve to packed file ${packedPath}.`);
  }
}

if (![...files].some((file) => /^public\/.+\.mjs$/.test(file))) {
  throw new Error('Packed package is missing the panel JavaScript chunks.');
}
if (![...files].some((file) => /^public\/.+\.css$/.test(file))) {
  throw new Error('Packed package is missing the panel CSS asset.');
}
for (const entry of await readdir('public', { withFileTypes: true })) {
  if (entry.isFile() && !files.has(`public/${entry.name}`)) {
    throw new Error(`Packed package is missing generated panel asset public/${entry.name}.`);
  }
}

const screenshots = packageJson.signalk?.screenshots;
if (!Array.isArray(screenshots) || screenshots.length === 0) {
  throw new Error('signalk.screenshots must list the App Store hero and detail images.');
}
const declaredAssets = [
  ['signalk.appIcon', packageJson.signalk?.appIcon],
  ...screenshots.map((declaredPath, index) => [`signalk.screenshots[${index}]`, declaredPath]),
];
for (const [field, declaredPath] of declaredAssets) {
  if (typeof declaredPath !== 'string' || !declaredPath.trim()) {
    throw new Error(`${field} must declare a non-empty package-relative asset path.`);
  }
  const packedPath = normalizeDeclaredPath(declaredPath.trim());
  if (packedPath.startsWith('../') || packedPath.startsWith('/') || !files.has(packedPath)) {
    throw new Error(`${field} does not resolve to packed file ${packedPath}.`);
  }
}

const heroPath = normalizeDeclaredPath(screenshots[0]);
if (heroPath !== 'assets/screenshots/00-admin-hero.png') {
  throw new Error('The current Admin hero must be the first App Store screenshot.');
}
const hero = await readFile(heroPath);
if (
  hero.subarray(1, 4).toString('ascii') !== 'PNG' ||
  hero.readUInt32BE(16) !== 1280 ||
  hero.readUInt32BE(20) !== 800
) {
  throw new Error('The first App Store screenshot must be a 1280 by 800 PNG hero image.');
}
if (hero.byteLength > 500_000) {
  throw new Error('The first App Store screenshot must remain under 500 KB.');
}

for (const file of files) {
  if (
    file.startsWith('src/') ||
    file.startsWith('test/') ||
    file.startsWith('tests/') ||
    file.startsWith('fixtures/') ||
    file.startsWith('docs/superpowers/') ||
    file.startsWith('.tmp/')
  ) {
    throw new Error(`Packed package contains development-only file ${file}.`);
  }
}

if (packageJson.dependencies?.['signalk-nearlcrews-ui']) {
  throw new Error('signalk-nearlcrews-ui must be a bundled development dependency.');
}
// The exact pin, and its match with the installed tree and the built remote,
// are asserted by the shared UI package's own `snui-check-consumer` in
// `npm run check:panel`. The README names the bundled release so a reader does
// not have to open the manifest; reading the pin here is what keeps that
// sentence from going stale on the next re-pin.
const uiPin = packageJson.devDependencies?.['signalk-nearlcrews-ui'];
if (typeof uiPin !== 'string' || uiPin === '') {
  throw new Error('package.json must pin signalk-nearlcrews-ui in devDependencies.');
}
const readme = await readFile('README.md', 'utf8');
if (!readme.includes(`\`signalk-nearlcrews-ui\` ${uiPin}`)) {
  throw new Error(`README.md must name the bundled signalk-nearlcrews-ui ${uiPin}.`);
}
// @types/node must describe the runtime floor this package advertises, not a
// newer Node. Deriving the major from engines.node keeps the two in step: a
// floor raise that forgets the types, or a types bump that outruns the floor,
// fails here instead of quietly typechecking an API the Cerbo GX cannot run.
const engineFloorMajor = /(\d+)/.exec(packageJson.engines?.node ?? '')?.[1];
if (engineFloorMajor === undefined) {
  throw new Error('engines.node must declare a version floor.');
}
const typesNodeRange = packageJson.devDependencies?.['@types/node'];
if (typeof typesNodeRange !== 'string' || !typesNodeRange.startsWith(`^${engineFloorMajor}.`)) {
  throw new Error(
    `@types/node must be a ^${engineFloorMajor}.x range to match the engines.node floor, received ${String(typesNodeRange)}.`
  );
}

// The test toolchain no longer starts on the runtime floor: Vitest 5, jsdom 30,
// and jest-dom 7 all require Node 22 or newer, so the advisory armv7 Cerbo GX
// lane in the official plugin workflow can install and build the plugin but can
// no longer run the unit suite. That lane is declared continue-on-error
// upstream, so it never gated a release. Floor coverage stays with ci.yml's
// node-20-runtime job, which runs the type checks, the runtime build, and an
// import smoke on 20.18.
//
// Vitest declares an optional @types/node peer at Node 22 types or newer, which
// the pinned major above cannot satisfy, so the manifest holds that peer at the
// root pin for the Vitest packages. Without it npm refuses to resolve the tree.
// It changes resolution only: TypeScript still reads the root @types/node.
const vitestPackages = Object.keys(packageJson.devDependencies ?? {}).filter(
  (name) => name === 'vitest' || name.startsWith('@vitest/')
);
for (const scope of vitestPackages) {
  if (packageJson.overrides?.[scope]?.['@types/node'] !== '$@types/node') {
    throw new Error(
      `overrides["${scope}"]["@types/node"] must be "$@types/node" so npm resolves the Vitest peer on the Node ${engineFloorMajor} types.`
    );
  }
}

/** Whether a pinned version is at or above a floor, so a routine bump passes. */
function meetsFloor(pin, floor) {
  const parsed = /^(\d+)\.(\d+)\.(\d+)/.exec(String(pin ?? ''));
  if (parsed === null) return false;
  for (const [index, minimum] of floor.entries()) {
    const part = Number(parsed[index + 1]);
    if (part > minimum) return true;
    if (part < minimum) return false;
  }
  return true;
}

// smol-toml before 1.8.0 is the development-only advisory that turned this
// repository's security audit red (GHSA-c83g-rgw3-j3cx and the fast-uri set
// arrived at the same time and were fixed by an ordinary refresh; this one
// needed a pin because cspell, knip, and markdownlint-cli2 all resolved an
// older transitive copy). Recorded here because package.json cannot carry a
// comment. Asserted as a floor rather than an exact version so raising the pin
// is an ordinary dependency bump. Drop the pin once every consumer resolves
// 1.8.0 or newer on its own, which `npm ls smol-toml --all` will show.
if (!meetsFloor(packageJson.overrides?.['smol-toml'], [1, 8, 0])) {
  throw new Error(
    'overrides["smol-toml"] must hold 1.8.0 or newer while cspell, knip, and markdownlint-cli2 still resolve an older transitive copy.'
  );
}

console.log(`Packed package passed: ${files.size} files in ${packResult.filename}.`);
