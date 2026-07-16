import { readdir, readFile } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const baseUrl = new URL(process.env.SIGNALK_URL ?? 'http://127.0.0.1:3000');
const authorization = process.env.SIGNALK_AUTHORIZATION?.trim();
const remotePath = `/${packageJson.name}/remoteEntry.js`;
const requestTimeoutMs = 10_000;
const requestOptions = () => ({
  ...(authorization ? { headers: { Authorization: authorization } } : {}),
  signal: AbortSignal.timeout(requestTimeoutMs),
});

const serverResponse = await fetch(new URL('/signalk', baseUrl), requestOptions());
if (!serverResponse.ok) {
  throw new Error(`Signal K discovery failed with HTTP ${serverResponse.status}.`);
}

const panelAssetNames = (await readdir('public')).filter((name) => /\.(?:css|js|mjs)$/.test(name));
for (const assetName of panelAssetNames) {
  const assetPath = `/${packageJson.name}/${assetName}`;
  const assetResponse = await fetch(new URL(assetPath, baseUrl), requestOptions());
  if (!assetResponse.ok) {
    throw new Error(
      `The installed panel asset ${assetPath} failed with HTTP ${assetResponse.status}.`
    );
  }
  const contentType = assetResponse.headers.get('content-type') ?? '';
  const expectedType = assetName.endsWith('.css') ? 'text/css' : 'javascript';
  if (!contentType.includes(expectedType)) {
    throw new Error(
      `The installed panel asset ${assetPath} used unexpected content type ${contentType || '(missing)'}.`
    );
  }
}

const pluginsResponse = await fetch(new URL('/skServer/plugins', baseUrl), requestOptions());
if (!pluginsResponse.ok) {
  if (pluginsResponse.status === 401 && !authorization) {
    throw new Error(
      'Signal K plugin discovery requires authentication. Set SIGNALK_AUTHORIZATION to the complete Authorization header value.'
    );
  }
  throw new Error(`Signal K plugin discovery failed with HTTP ${pluginsResponse.status}.`);
}
const plugins = await pluginsResponse.json();
const installedPlugin = Array.isArray(plugins)
  ? plugins.find((plugin) => plugin.packageName === packageJson.name)
  : undefined;
if (!installedPlugin) {
  throw new Error(`Signal K did not load ${packageJson.name}.`);
}
if (installedPlugin.data?.enabled !== true) {
  throw new Error(`Signal K did not enable ${packageJson.name}.`);
}
for (const keyword of ['signalk-node-server-plugin', 'signalk-plugin-configurator']) {
  if (!installedPlugin.keywords?.includes(keyword)) {
    throw new Error(`Signal K did not recognize the ${keyword} keyword.`);
  }
}

const remoteResponse = await fetch(new URL(remotePath, baseUrl), requestOptions());
if (!remoteResponse.ok) {
  throw new Error(`The installed configuration remote failed with HTTP ${remoteResponse.status}.`);
}
const remoteSource = await remoteResponse.text();
if (!remoteSource.includes('export')) {
  throw new Error('The installed configuration remote is not an ESM container.');
}

console.log(
  `Signal K registered the plugin and served ${panelAssetNames.length} panel assets from ${baseUrl.origin}.`
);
