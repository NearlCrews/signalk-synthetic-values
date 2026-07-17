import { readFile } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const pluginId = 'signalk-synthetic-values';
if (packageJson.name !== pluginId) {
  throw new Error(`Expected package.json name ${pluginId}.`);
}
const baseUrl = new URL(process.env.SIGNALK_URL ?? 'http://127.0.0.1:3000');
const authorization = process.env.SIGNALK_AUTHORIZATION?.trim();
const remotePath = `/${pluginId}/remoteEntry.js`;
const requestTimeoutMs = 10_000;
const requestOptions = () => ({
  ...(authorization ? { headers: { Authorization: authorization } } : {}),
  signal: AbortSignal.timeout(requestTimeoutMs),
});

const serverResponse = await fetch(new URL('/signalk', baseUrl), requestOptions());
if (!serverResponse.ok) {
  throw new Error(`Signal K discovery failed with HTTP ${serverResponse.status}.`);
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
  ? plugins.find((plugin) => plugin.packageName === pluginId)
  : undefined;
if (!installedPlugin) {
  throw new Error(`Signal K did not load ${pluginId}.`);
}
if (installedPlugin.data?.enabled !== true) {
  throw new Error(`Signal K did not enable ${pluginId}.`);
}
for (const keyword of ['signalk-node-server-plugin', 'signalk-plugin-configurator']) {
  if (!installedPlugin.keywords?.includes(keyword)) {
    throw new Error(`Signal K did not recognize the ${keyword} keyword.`);
  }
}

const detectedResponse = await fetch(
  new URL(`/plugins/${pluginId}/api/detected`, baseUrl),
  requestOptions()
);
if (!detectedResponse.ok) {
  throw new Error(`The detected-path API failed with HTTP ${detectedResponse.status}.`);
}
const detectedBody = await detectedResponse.json();
if (
  typeof detectedBody !== 'object' ||
  detectedBody === null ||
  !Array.isArray(detectedBody.paths)
) {
  throw new Error('The detected-path API did not return a paths array.');
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
  `Signal K registered the plugin and served its detected-path API and configuration remote from ${baseUrl.origin}.`
);
