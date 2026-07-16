// Cross-platform build-output cleanup for Linux, macOS, and Windows.
import { rmSync } from 'node:fs';

for (const dir of ['dist', 'public', '.tmp']) {
  rmSync(dir, { recursive: true, force: true });
}
