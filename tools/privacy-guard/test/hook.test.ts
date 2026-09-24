// Integration: the real .githooks/pre-commit in a throwaway repo (stage-0.md §8 "Integration").
import { chmodSync, cpSync, mkdirSync, realpathSync, symlinkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TempRepo } from './temp-repo';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TSX_CLI = join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const TIMEOUT = 60_000;

let repo: TempRepo;
let tsxLink: string | undefined;

/** Copies the hook and the guard in, and links tsx the way the hook expects to find it. */
function installGuard(target: TempRepo): void {
  cpSync(join(REPO_ROOT, '.githooks'), target.path('.githooks'), { recursive: true });
  chmodSync(target.path('.githooks/pre-commit'), 0o755);
  cpSync(join(REPO_ROOT, 'tools/privacy-guard/src'), target.path('tools/privacy-guard/src'), {
    recursive: true,
  });
  cpSync(
    join(REPO_ROOT, 'tools/privacy-guard/package.json'),
    target.path('tools/privacy-guard/package.json'),
  );
  // Only the tsx package is linked (a junction on Windows); it resolves its own dependencies
  // from its real location. The link is removed explicitly before the folder is deleted.
  mkdirSync(target.path('node_modules'));
  tsxLink = target.path('node_modules/tsx');
  symlinkSync(realpathSync(join(REPO_ROOT, 'node_modules', 'tsx')), tsxLink, 'junction');
  target.write('.gitignore', 'node_modules/\n');
}

beforeEach(() => {
  repo = TempRepo.create();
});

afterEach(() => {
  if (tsxLink) unlinkSync(tsxLink);
  tsxLink = undefined;
  repo.remove();
});

describe('pre-commit hook', () => {
  it(
    'blocks a commit of docs/private and allows a clean one',
    () => {
      installGuard(repo);
      repo.git('config', 'core.hooksPath', '.githooks');

      repo.write('docs/private/notes.md', 'test\n');
      repo.git('add', '-f', 'docs/private/notes.md');
      const blocked = repo.run('git', ['commit', '-m', 'should be blocked']);
      expect(blocked.status).not.toBe(0);
      expect(blocked.stderr).toContain('docs/private/notes.md  blocked-path');
      expect(repo.run('git', ['rev-parse', '--verify', '-q', 'HEAD']).status).not.toBe(0);

      repo.git('rm', '-q', '--cached', 'docs/private/notes.md');
      repo.write('README.md', '# Example\n\nNothing private here.\n');
      repo.git('add', 'README.md');
      const allowed = repo.run('git', ['commit', '-m', 'clean commit']);
      expect(allowed.stderr).not.toContain('blocked');
      expect(allowed.status).toBe(0);
      expect(repo.git('log', '--format=%s').trim()).toBe('clean commit');
    },
    TIMEOUT,
  );

  it(
    'fails closed when tsx is not installed',
    () => {
      installGuard(repo);
      repo.git('config', 'core.hooksPath', '.githooks');
      unlinkSync(tsxLink!);
      tsxLink = undefined;

      repo.write('README.md', 'clean\n');
      repo.git('add', 'README.md');
      const result = repo.run('git', ['commit', '-m', 'no tsx']);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("run 'pnpm install' first");
    },
    TIMEOUT,
  );
});

describe('guard --all (CLI process)', () => {
  it(
    'flags a tracked .env',
    () => {
      // Committed while hooks are off (TempRepo points core.hooksPath at an empty folder).
      repo.write('.env', 'SECRET=placeholder\n');
      repo.git('add', '.env');
      repo.git('commit', '-q', '-m', 'tracked env');
      installGuard(repo);

      const result = repo.run('node', [TSX_CLI, 'tools/privacy-guard/src/cli.ts', '--all']);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('.env  blocked-path');
      // The guard's own sources, copied in untracked, pass their own scan.
      expect(result.stderr).not.toContain('tools/privacy-guard');
    },
    TIMEOUT,
  );
});
