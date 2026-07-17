import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'));

const config = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  outfile: 'dist/index.js',
  platform: 'node',
  target: 'node20.18',
  format: 'esm',
  sourcemap: true,
  minify: true,
  treeShaking: true,
  splitting: false,
  metafile: true,
  legalComments: 'none',

  // Runtime packages are installed by Signal K and remain external to the
  // single plugin bundle. Node built-ins are external for platform=node.
  packages: 'external',

  // Banner for Signal K plugin compatibility
  banner: {
    js: `
// ${packageJson.name} - Signal K Synthetic Values Plugin
// Version: ${packageJson.version}
// Target: Node.js 20.18+
`.trim(),
  },

  // Better error reporting
  logLevel: 'info',
  color: process.stdout.isTTY,

  // Preserve readable non-ASCII Signal K metadata and messages.
  charset: 'utf8',
};

try {
  console.log('Building Signal K Synthetic Values plugin...');
  console.log(`Target: ${config.target} | Format: ${config.format}`);

  const result = await build(config);

  // Analyze bundle size
  if (result.metafile) {
    const outputSize = result.metafile.outputs[config.outfile]?.bytes;
    if (outputSize !== undefined) {
      console.log(`JavaScript bundle size: ${(outputSize / 1024).toFixed(2)} KB`);
    }
  }

  console.log('Build completed successfully.');
  console.log(`Output: ${config.outfile}`);
  console.log(`Source map: ${config.outfile}.map`);
} catch (error) {
  console.error('Build failed:', error);
  process.exit(1);
}
