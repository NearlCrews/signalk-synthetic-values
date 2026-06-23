// Cross-platform replacement for the unix-only "rm -rf dist/ coverage/" clean
// step, so the build runs on Linux, macOS, and Windows CI runners alike.
import { rmSync } from 'node:fs';

for (const dir of ['dist', 'public', 'coverage']) {
  rmSync(dir, { recursive: true, force: true });
}
