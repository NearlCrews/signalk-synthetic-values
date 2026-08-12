const DEFAULT_BROWSER_PORT = 4175;

export function resolveBrowserFixturePort(rawPort: string | undefined): number {
  const port = rawPort === undefined ? DEFAULT_BROWSER_PORT : Number(rawPort);

  if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
    throw new Error(
      `SYNTHETIC_VALUES_BROWSER_PORT must be an integer from 1024 through 65535; received ${JSON.stringify(rawPort)}.`
    );
  }

  return port;
}

export const browserFixturePort = resolveBrowserFixturePort(
  process.env.SYNTHETIC_VALUES_BROWSER_PORT
);
export const browserFixtureUrl = `http://127.0.0.1:${String(browserFixturePort)}`;
