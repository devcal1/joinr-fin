// The app version shown in /api/health (the root package.json "version").
//
// The production bundle has it baked in by esbuild (`define: { __APP_VERSION__ }` in
// scripts/build.mjs). In dev and tests the identifier does not exist, so it is read from the file.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot, SERVER_DIR } from './paths';

declare const __APP_VERSION__: string | undefined;

const UNKNOWN_VERSION = '0.0.0-dev';

/** Reads `version` from `<repoRoot>/package.json`; falls back to "0.0.0-dev". */
export function readVersionFromPackageJson(repoRoot: string | undefined): string {
  if (!repoRoot) return UNKNOWN_VERSION;
  try {
    const pkg: unknown = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
    if (pkg && typeof pkg === 'object' && 'version' in pkg && typeof pkg.version === 'string') {
      return pkg.version;
    }
  } catch {
    // Missing or unreadable package.json: use the fallback below.
  }
  return UNKNOWN_VERSION;
}

export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string'
    ? __APP_VERSION__
    : readVersionFromPackageJson(findRepoRoot(SERVER_DIR));
