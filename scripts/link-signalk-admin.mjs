import { existsSync, mkdirSync, realpathSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

/**
 * Signal K serves its Admin UI from the server package's own
 * node_modules/@signalk/server-admin-ui, but npm may hoist that package to the
 * host's top level when signalk-server is installed as a dependency, as the
 * Admin integration job does. This links the installed Admin package back to
 * the path the server expects.
 */

const hostArgument = process.argv[2];
if (!hostArgument) {
  throw new Error('Pass the Signal K test-host directory as the first argument.');
}
const hostDirectory = resolve(hostArgument);
const require = createRequire(import.meta.url);
const serverDirectory = dirname(
  require.resolve('signalk-server/package.json', { paths: [hostDirectory] })
);
const expectedAdminDirectory = join(serverDirectory, 'node_modules', '@signalk', 'server-admin-ui');
let adminDirectory;

if (existsSync(expectedAdminDirectory)) {
  adminDirectory = realpathSync(expectedAdminDirectory);
} else {
  adminDirectory = dirname(
    require.resolve('@signalk/server-admin-ui/package.json', {
      paths: [serverDirectory, hostDirectory],
    })
  );
  mkdirSync(dirname(expectedAdminDirectory), { recursive: true });
  symlinkSync(adminDirectory, expectedAdminDirectory, 'dir');
}

console.log(`Signal K Admin assets linked from ${adminDirectory}.`);
