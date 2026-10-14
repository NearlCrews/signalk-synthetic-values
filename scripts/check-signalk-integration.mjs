import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

/**
 * Checks a running Signal K server that has this plugin installed. The server
 * must load and enable the plugin, serve its detected-path API and its ESM
 * configuration remote, and inject that remote into the Admin page. A real
 * browser then opens the plugin's Admin configuration screen and the
 * production panel must mount there, which is the check that catches a
 * remote the Admin host refuses, such as one with a strict React share. The
 * Admin integration job in ci.yml runs this against a fresh server for each
 * supported release.
 */

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const pluginId = 'signalk-synthetic-values';
if (packageJson.name !== pluginId) {
  throw new Error(`Expected package.json name ${pluginId}.`);
}
const rawBaseUrl = process.env.SIGNALK_URL?.trim();
if (!rawBaseUrl) {
  throw new Error(
    'Set SIGNALK_URL to the running Signal K server, for example http://127.0.0.1:3000.'
  );
}
const baseUrl = new URL(rawBaseUrl);
const authorization = process.env.SIGNALK_AUTHORIZATION?.trim();
const browserChannel = process.env.SIGNALK_BROWSER_CHANNEL?.trim();
const remotePath = `/${pluginId}/remoteEntry.js`;
const requestTimeoutMs = 10_000;
const mountTimeoutMs = 30_000;
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

const adminResponse = await fetch(new URL('/admin/', baseUrl), requestOptions());
if (!adminResponse.ok) {
  throw new Error(`Signal K Admin failed with HTTP ${adminResponse.status}.`);
}
const adminHtml = await adminResponse.text();
// Signal K 2.24 injects every remote as a classic script, and newer releases
// inject an ESM package's remote as a module script, so only the reference is
// asserted here. The browser mount below proves the Admin loads it either way.
const escapedRemotePath = remotePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
if (!new RegExp(`<script\\b[^>]*\\bsrc=["']${escapedRemotePath}["']`).test(adminHtml)) {
  throw new Error('Signal K Admin did not inject the configuration remote.');
}

const browser = await chromium.launch({
  headless: true,
  ...(browserChannel ? { channel: browserChannel } : {}),
});
try {
  const context = await browser.newContext(
    authorization ? { extraHTTPHeaders: { Authorization: authorization } } : {}
  );
  const page = await context.newPage();
  const consoleLines = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      consoleLines.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => consoleLines.push(`pageerror: ${error.message}`));

  const adminUrl = new URL(`/admin/#/serverConfiguration/plugins/${pluginId}`, baseUrl);
  await page.goto(adminUrl.href, { waitUntil: 'domcontentloaded', timeout: mountTimeoutMs });
  try {
    // The theme selector belongs to the shared panel shell, so it renders only
    // once the Admin host has loaded the remote and mounted the panel.
    await page
      .getByRole('radiogroup', { name: 'Panel theme' })
      .waitFor({ state: 'visible', timeout: mountTimeoutMs });
  } catch (error) {
    throw new Error(
      `Signal K Admin did not mount the production panel. Browser console:\n${consoleLines.join('\n') || '(empty)'}`,
      { cause: error }
    );
  }

  for (const fallback of ['Plugin Configuration Unavailable', 'Error loading component']) {
    if ((await page.getByText(fallback, { exact: true }).count()) > 0) {
      throw new Error(`Signal K Admin displayed "${fallback}" for the panel.`);
    }
  }
  if ((await page.locator('[data-snui-version]').count()) === 0) {
    throw new Error('The mounted panel did not render signalk-nearlcrews-ui.');
  }
  const unloadable = consoleLines.filter((line) => line.includes('Could not load module'));
  if (unloadable.length > 0) {
    throw new Error(`Signal K Admin could not load a module:\n${unloadable.join('\n')}`);
  }
  const exposesContainer = await page.evaluate(async (path) => {
    const remote = await import(path);
    return typeof remote.get === 'function' && typeof remote.init === 'function';
  }, remotePath);
  if (!exposesContainer) {
    throw new Error('The configuration remote did not export the Module Federation get and init.');
  }
} finally {
  await browser.close();
}

console.log(
  `Signal K at ${baseUrl.origin} enabled the plugin, served its detected-path API and ESM remote, and mounted the production panel in its Admin UI.`
);
