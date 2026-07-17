import { spawn } from 'node:child_process';
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';

const temporaryDirectory = '.tmp/types';
const executable =
  process.platform === 'win32' ? 'node_modules/.bin/tsc.cmd' : 'node_modules/.bin/tsc';

await rm(temporaryDirectory, { recursive: true, force: true });

const exitCode = await new Promise((resolve, reject) => {
  const child = spawn(
    executable,
    [
      '--noEmit',
      'false',
      '--declaration',
      '--emitDeclarationOnly',
      '--declarationMap',
      'false',
      '--outDir',
      temporaryDirectory,
    ],
    { stdio: 'inherit' }
  );
  child.once('error', reject);
  child.once('close', resolve);
});

if (exitCode !== 0) {
  await rm(temporaryDirectory, { recursive: true, force: true });
  throw new Error(`TypeScript declaration build exited with code ${exitCode}.`);
}

await mkdir('dist', { recursive: true });
for (const name of await readdir('dist')) {
  if (name.endsWith('.d.ts') || name.endsWith('.d.ts.map')) {
    await rm(`dist/${name}`, { force: true });
  }
}
await copyFile(`${temporaryDirectory}/index.d.ts`, 'dist/index.d.ts');
await rm(temporaryDirectory, { recursive: true, force: true });
