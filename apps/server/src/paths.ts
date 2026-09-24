// Where the server finds things on disk (stage-0.md §1).
//
// Everything is resolved relative to this module's own file. In dev that is `src/paths.ts`; in the
// production bundle it is `dist/server.js`. Both sit one level below the server package folder,
// so `..` is `apps/server` in the repo and `/app` in the Docker image.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The server package folder (`apps/server` in the repo, `/app` in the image). */
export const SERVER_DIR = fileURLToPath(new URL('..', import.meta.url));

const WORKSPACE_MARKER = 'pnpm-workspace.yaml';

/**
 * Walks up from `start` to the first folder holding `pnpm-workspace.yaml`.
 * Returns undefined when there is none (for example inside the Docker image).
 */
export function findRepoRoot(
  start: string,
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  let dir = resolve(start);
  for (;;) {
    if (exists(join(dir, WORKSPACE_MARKER))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** The folders that relative settings and defaults resolve against. */
export interface ConfigBase {
  /** Relative `DATA_DIR`, `WEB_DIST_DIR` and `MIGRATIONS_DIR` values resolve against this. */
  repoRoot: string;
  /** The server package folder; the migrations and web-dist defaults hang off it. */
  serverDir: string;
}

/** The repo root (or `process.cwd()` outside a workspace) and this server's package folder. */
export function defaultConfigBase(): ConfigBase {
  return {
    repoRoot: findRepoRoot(SERVER_DIR) ?? process.cwd(),
    serverDir: SERVER_DIR,
  };
}

/** `<server>/migrations`: `apps/server/migrations` in the repo, `/app/migrations` in the image. */
export function defaultMigrationsDir(serverDir: string): string {
  return join(serverDir, 'migrations');
}

/** `<server>/../web/dist`: the Vite build output in the repo. Docker overrides it. */
export function defaultWebDistDir(serverDir: string): string {
  return resolve(serverDir, '..', 'web', 'dist');
}
