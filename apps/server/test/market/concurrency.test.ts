// A second writer on the same WAL file (e.g. a CLI import holding the write lock): read-then-write
// transactions must wait for busy_timeout (BEGIN IMMEDIATE) instead of failing at once with
// SQLITE_BUSY. Also: a provider's Retry-After cannot silence it for more than a day.
import Database from 'better-sqlite3';
import { seedGenericData } from '@joinr/schema/testing';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DB_FILE_NAME } from '../../src/config';
import {
  closeDatabase,
  openDatabase,
  runMigrations,
  type AppDatabase,
} from '../../src/db/database';
import { Cooldowns, RETRY_AFTER_MAX_MS } from '../../src/market/refresh';
import { parseRetryAfter } from '../../src/market/providers/http';
import { createService } from '../../src/market/service';
import { createScheduler } from '../../src/scheduler/index';
import { makeTempDir, MIGRATIONS_DIR, removeDir } from '../helpers';
import { mockFetch, settableClock, silentLogger } from './helpers';

const NOW = '2026-09-24T02:00:00.000Z';

describe('Retry-After cap', () => {
  it('never cools a provider down for more than 24 h', () => {
    const now = new Date(NOW);
    const cooldowns = new Cooldowns();
    const retryAfterMs = parseRetryAfter('99999999', now);
    expect(retryAfterMs).toBe(99999999 * 1000);
    cooldowns.start('yahoo', now, retryAfterMs);
    const until = Date.parse(cooldowns.untilIso('yahoo')!);
    expect(until - now.getTime()).toBe(RETRY_AFTER_MAX_MS);
    expect(RETRY_AFTER_MAX_MS).toBe(24 * 3600 * 1000);
    // A short Retry-After is honoured as is.
    cooldowns.start('coingecko', now, 120_000);
    expect(Date.parse(cooldowns.untilIso('coingecko')!) - now.getTime()).toBe(120_000);
  });
});

describe('write transactions under a concurrent writer', () => {
  let dir: string | null = null;
  let database: AppDatabase | null = null;
  let other: Database.Database | null = null;

  afterEach(async () => {
    if (other?.inTransaction) other.exec('ROLLBACK');
    other?.close();
    other = null;
    if (database) closeDatabase(database);
    database = null;
    if (dir) await removeDir(dir);
    dir = null;
  });

  it('waits for busy_timeout (then succeeds once the lock is released)', async () => {
    dir = await makeTempDir();
    database = openDatabase(dir);
    runMigrations(database, MIGRATIONS_DIR);
    const clock = settableClock(NOW);
    const { instrumentIds } = seedGenericData(database.db, { now: clock.now() });
    const log = silentLogger();
    const scheduler = createScheduler({ db: database.db, log, clock });
    const market = createService({
      db: database.db,
      config: { marketDataMode: 'off', priceRefreshMinutes: 0 },
      log,
      scheduler,
      fetchImpl: mockFetch(() => new Response('{}')).fetchImpl,
      clock,
    });
    const id = instrumentIds['ASX:ABC']!;
    const timeoutMs = 300;
    database.sqlite.pragma(`busy_timeout = ${timeoutMs}`);

    other = new Database(join(dir, DB_FILE_NAME));
    other.pragma('busy_timeout = 0');
    other.exec('BEGIN IMMEDIATE');

    const t0 = performance.now();
    let error: unknown = null;
    try {
      market.setManualPrice(id, { price: '14', asOf: '2026-09-24' });
    } catch (err) {
      error = err;
    }
    const waited = performance.now() - t0;
    expect(error).toMatchObject({ code: 'SQLITE_BUSY' });
    // A deferred read-then-write transaction fails after ~0 ms; IMMEDIATE waits the timeout.
    expect(waited).toBeGreaterThanOrEqual(timeoutMs * 0.8);

    other.exec('ROLLBACK');
    expect(market.setManualPrice(id, { price: '14', asOf: '2026-09-24' })).toMatchObject({
      status: 'manual',
      price: '14',
    });
    await scheduler.stop();
  });
});
