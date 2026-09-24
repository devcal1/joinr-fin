// A throwaway git repository in the OS temp folder, isolated from the user's git setup.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** The environment without GIT_* variables, so an outer git process can't redirect ours. */
export function isolatedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.toUpperCase().startsWith('GIT_')) env[key] = value;
  }
  return env;
}

export class TempRepo {
  readonly root: string;

  private constructor(root: string) {
    this.root = root;
  }

  /** `git init` plus local settings that override anything in the user's global config. */
  static create(prefix = 'joinr-guard-test-'): TempRepo {
    const repo = new TempRepo(mkdtempSync(join(tmpdir(), prefix)));
    repo.git('init', '-q');
    repo.git('config', 'user.name', 'Guard Test');
    repo.git('config', 'user.email', 'guard-test@example.com');
    repo.git('config', 'commit.gpgsign', 'false');
    repo.git('config', 'core.autocrlf', 'false');
    // No hooks unless a test installs them (a global core.hooksPath must not leak in).
    repo.git('config', 'core.hooksPath', '.no-hooks');
    return repo;
  }

  path(relative: string): string {
    return join(this.root, relative);
  }

  write(relative: string, content: string | Uint8Array): void {
    const target = this.path(relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }

  run(command: string, args: readonly string[]): RunResult {
    const result = spawnSync(command, args, {
      cwd: this.root,
      env: isolatedEnv(),
      encoding: 'utf8',
      windowsHide: true,
    });
    if (result.error) throw result.error;
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  /** Runs git and throws on a non-zero exit. */
  git(...args: string[]): string {
    const result = this.run('git', args);
    if (result.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed (${result.status}): ${result.stderr}`);
    }
    return result.stdout;
  }

  remove(): void {
    rmSync(this.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
