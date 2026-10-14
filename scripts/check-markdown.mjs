import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lint, readConfig } from 'markdownlint/promise';

/**
 * Lints the maintained Markdown with the markdownlint library, called
 * directly. Its command-line wrapper exists to expand globs, and its glob stack
 * carried an advisory with no fixed release. The scope needs no glob: the root
 * guides plus the Markdown directly under assets/ and .github/.
 * docs/superpowers/ holds dated design memos and public/ is build output, so
 * neither is in scope.
 */

const root = fileURLToPath(new URL('..', import.meta.url));

async function markdownIn(directory) {
  const names = await readdir(join(root, directory));
  return names.filter((name) => name.endsWith('.md')).map((name) => `${directory}/${name}`);
}

const files = [
  'README.md',
  'CHANGELOG.md',
  'CLAUDE.md',
  ...(await markdownIn('assets')),
  ...(await markdownIn('.github')),
].sort();
const config = await readConfig(join(root, '.markdownlint.json'));
const results = await lint({ config, files: files.map((path) => join(root, path)) });
const failures = files.flatMap((path) =>
  results[join(root, path)]
    .toSorted((left, right) => left.lineNumber - right.lineNumber)
    .map((issue) => {
      const detail = issue.errorDetail ?? issue.errorContext;
      return `${path}:${issue.lineNumber}: ${issue.ruleNames.join('/')} ${issue.ruleDescription}${detail ? ` [${detail}]` : ''}`;
    })
);

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Markdown lint passed for ${files.length} files.`);
