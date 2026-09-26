// Shared test helpers: temp folders and a ready-made config. Every test uses its own OS temp dir.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DB_FILE_NAME, type Config } from '../src/config';

/** The real, committed migrations folder. */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

export function makeTempDir(prefix = 'joinr-server-test-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

/** Retries cover Windows briefly holding a handle after close. */
export function removeDir(dir: string): Promise<void> {
  return rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

/**
 * A test config: silent logs, no SPA, market data off, no refresh timer, corrections off and no
 * repo root (so nothing ever reads reference/import-corrections.json).
 */
export function testConfig(dataDir: string, overrides: Partial<Config> = {}): Config {
  return {
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 0,
    logLevel: 'silent',
    dataDir,
    dbFile: join(dataDir, DB_FILE_NAME),
    serveWeb: false,
    webDistDir: join(dataDir, 'no-web-dist'),
    migrationsDir: MIGRATIONS_DIR,
    priceRefreshMinutes: 0,
    marketDataMode: 'off',
    importCorrections: { kind: 'off' },
    repoRoot: null,
    autoRecord: null,
    ...overrides,
  };
}
