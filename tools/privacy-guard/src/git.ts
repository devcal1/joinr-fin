// Reading file lists and staged content from git.
import { execFileSync, spawn } from 'node:child_process';

const MAX_BUFFER = 256 * 1024 * 1024;

function git(args: readonly string[], cwd: string): Buffer {
  return execFileSync('git', args, {
    cwd,
    maxBuffer: MAX_BUFFER,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

function splitNul(output: Buffer): string[] {
  return output
    .toString('utf8')
    .split('\0')
    .filter((p) => p !== '');
}

/** The working tree's top folder (forward slashes on Windows too). */
export function gitTopLevel(cwd: string): string {
  return git(['rev-parse', '--show-toplevel'], cwd).toString('utf8').trim();
}

/** False before the first commit (an unborn branch), when `git restore --staged` cannot work. */
export function hasHead(root: string): boolean {
  try {
    git(['rev-parse', '--verify', '--quiet', 'HEAD'], root);
    return true;
  } catch {
    return false;
  }
}

/** Staged paths that will exist after the commit: added, copied, modified, renamed, type-changed. */
export function listStagedPaths(root: string): string[] {
  return splitNul(git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMRT'], root));
}

/** Tracked files plus untracked files that are not git-ignored. */
export function listAllPaths(root: string): string[] {
  return [
    ...new Set(
      splitNul(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], root)),
    ),
  ];
}

export interface IndexBlob {
  size: number;
  /**
   * Up to `keepBytes(path, size)` bytes from the start of the blob. Undefined when it declined
   * the content (a negative limit) or the index entry has no readable object.
   */
  content: Buffer | undefined;
}

/**
 * Reads the staged (index, stage 0) content of `paths` through one `git cat-file --batch` process.
 * `keepBytes(path, size)` says how much of each blob to keep: all of it, only its head (a huge
 * file, sniffed for its type) or nothing (a negative limit, e.g. a blocked path). The rest is
 * streamed past without buffering.
 */
export function readIndexBlobs(
  root: string,
  paths: readonly string[],
  keepBytes: (path: string, size: number) => number,
): Promise<Map<string, IndexBlob>> {
  const results = new Map<string, IndexBlob>();
  if (paths.length === 0) return Promise.resolve(results);

  const badPath = paths.find((p) => /[\r\n]/.test(p));
  if (badPath !== undefined) {
    return Promise.reject(
      new Error(`cannot scan a path containing a line break: ${JSON.stringify(badPath)}`),
    );
  }

  return new Promise((resolve, reject) => {
    const child = spawn('git', ['cat-file', '--batch'], {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    type Body = {
      path: string;
      size: number;
      remaining: number;
      /** Bytes still to keep: at most `size`, so the trailing LF is never kept. */
      keep: number;
      chunks: Buffer[] | undefined;
    };
    let pending: Buffer = Buffer.alloc(0);
    let body: Body | undefined;
    let next = 0;
    let failed = false;
    let stderr = '';

    const fail = (err: Error): void => {
      if (failed) return;
      failed = true;
      child.kill();
      reject(err);
    };

    const pump = (): void => {
      while (!failed) {
        if (!body) {
          const newline = pending.indexOf(0x0a);
          if (newline === -1) return;
          const header = pending.subarray(0, newline).toString('utf8');
          pending = pending.subarray(newline + 1);
          const path = paths[next++];
          if (path === undefined) return fail(new Error('git cat-file returned extra output'));
          // "<object> missing" / "<object> ambiguous": no content to scan (e.g. a submodule).
          if (/ (?:missing|ambiguous)$/.test(header)) {
            results.set(path, { size: 0, content: undefined });
            continue;
          }
          const match = /^[0-9a-f]+ [a-z]+ (\d+)$/.exec(header);
          if (!match) return fail(new Error(`unexpected git cat-file output: ${header}`));
          const size = Number(match[1]);
          const limit = keepBytes(path, size);
          body = {
            path,
            size,
            remaining: size + 1,
            keep: limit < 0 ? 0 : Math.min(size, limit),
            chunks: limit < 0 ? undefined : [],
          };
        } else {
          if (pending.length === 0) return;
          const take = Math.min(pending.length, body.remaining);
          if (body.chunks && body.keep > 0) {
            const kept = pending.subarray(0, Math.min(take, body.keep));
            body.chunks.push(kept);
            body.keep -= kept.length;
          }
          pending = pending.subarray(take);
          body.remaining -= take;
          if (body.remaining === 0) {
            const content = body.chunks ? Buffer.concat(body.chunks) : undefined;
            results.set(body.path, { size: body.size, content });
            body = undefined;
          }
        }
      }
    };

    child.stdout.on('data', (chunk: Buffer) => {
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      pump();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', fail);
    child.on('close', (code) => {
      if (failed) return;
      if (code !== 0) return fail(new Error(`git cat-file exited with ${code}: ${stderr.trim()}`));
      if (results.size !== paths.length) {
        return fail(new Error(`git cat-file returned ${results.size} of ${paths.length} files`));
      }
      resolve(results);
    });

    // ":0:<path>" is the stage-0 index entry; the explicit stage keeps paths like "1:x" unambiguous.
    child.stdin.on('error', fail);
    child.stdin.end(paths.map((p) => `:0:${p}\n`).join(''));
  });
}
