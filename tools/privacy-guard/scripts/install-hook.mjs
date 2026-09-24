// Points git at the repo's .githooks folder so the privacy guard runs before every commit.
// Runs from the root `prepare` script. It must never fail an install: in Docker (no .git)
// or where git is not installed it does nothing.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

try {
  if (existsSync(join(repoRoot, '.git'))) {
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], {
      cwd: repoRoot,
      stdio: 'ignore',
    });
  }
} catch {
  // git is missing or the repo is unusable: skip silently.
}
