// The D98 one-off on the import paths (stage-6.md §3.4, §7.4 step 3) with the real importer and
// the generic synthetic workbook, its FIRE access age typed as 65: the upload route and the CLI run
// `applySettingUpgrades` after a committed import and never after a dry run; a re-import after the
// upgrade keeps 60 (a preference row, `settings.keptAppPreference`) without replacing it again; a
// forced `--replace-app-data` import keeps it too; `hasAppData` stays false throughout (D103). If
// the upgrade fails after the import committed (SQLITE_BUSY), both still succeed (triage CODE-3).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildSyntheticWorkbook,
  IMPORTER_IMPLEMENTED,
  SYNTHETIC_WORKBOOK_IMPLEMENTED,
} from '@joinr/importer/testing';
import { FIRE_TAB_PREFIX, type ImportRunDetail, type ImportRunsResponse } from '@joinr/schema';
import { settings } from '@joinr/schema/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp, offServices } from '../../src/app';
import { EXIT, main, type CliIo } from '../../src/cli/import';
import {
  closeDatabase,
  openDatabase,
  runMigrations,
  type AppDatabase,
} from '../../src/db/database';
import { hasAppData } from '../../src/db/queries/domain';
import { applySettingUpgrades, readAccessAgeMarker } from '../../src/fire/upgrade';
import { makeTempDir, removeDir, testConfig } from '../helpers';
import { fakeEngine, NOW } from '../investments/helpers';

// A partial mock: the real upgrade, unless a test sets the flag (then it throws SQLITE_BUSY).
const upgradeFails = vi.hoisted(() => ({ on: false }));
vi.mock('../../src/fire/upgrade', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/fire/upgrade')>();
  return {
    ...actual,
    applySettingUpgrades: (...args: Parameters<typeof actual.applySettingUpgrades>) => {
      if (upgradeFails.on) {
        throw Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
      }
      return actual.applySettingUpgrades(...args);
    },
  };
});

const KEY = 'fire.preservationAge';

/** The synthetic FIRE tab's access age (E10) typed as 65. */
const withAccessAge65: NonNullable<
  NonNullable<Parameters<typeof buildSyntheticWorkbook>[0]>['mutate']
> = (wb) => {
  const name = wb.SheetNames.find((n) => n.startsWith(FIRE_TAB_PREFIX))!;
  wb.Sheets[name]!.E10 = { t: 'n', v: 65 };
};

const ageRow = (database: AppDatabase) =>
  database.db.select().from(settings).where(eq(settings.key, KEY)).get();

describe.skipIf(!SYNTHETIC_WORKBOOK_IMPLEMENTED || !IMPORTER_IMPLEMENTED)(
  'the upload route runs the D98 one-off after a committed import',
  { timeout: 60_000 },
  () => {
    let tempDir: string;
    let database: AppDatabase;
    let app: FastifyInstance;
    const workbook = Buffer.from(buildSyntheticWorkbook({ mutate: withAccessAge65 }));

    beforeAll(async () => {
      tempDir = await makeTempDir();
      const config = testConfig(join(tempDir, 'data'));
      database = openDatabase(config.dataDir);
      runMigrations(database, config.migrationsDir);
      app = await buildApp({ config, db: database, now: () => NOW, engine: fakeEngine() });
    });

    afterAll(async () => {
      await app?.close();
      if (tempDir) await removeDir(tempDir);
    });

    const upload = (query: string) =>
      app.inject({
        method: 'POST',
        url: `/api/import${query}`,
        payload: workbook,
        headers: { 'content-type': 'application/octet-stream' },
      });
    const hasAppDataNow = async () =>
      (await app.inject({ method: 'GET', url: '/api/import/runs' })).json<ImportRunsResponse>()
        .hasAppData;

    it('a dry run never upgrades (nothing is written)', async () => {
      const dry = await upload('?dryRun=true');
      expect(dry.statusCode).toBe(200);
      expect(ageRow(database)).toBeUndefined();
      expect(readAccessAgeMarker(database.db)).toBeNull();
    });

    it('a committed import of 65 becomes 60 (app origin) with the marker', async () => {
      const res = await upload('');
      expect(res.statusCode).toBe(201);
      // The route's own clock (its backups and failed runs use it too) stamps the row and marker.
      const row = ageRow(database)!;
      expect(row).toMatchObject({ valueJson: '60', origin: 'app' });
      const marker = readAccessAgeMarker(database.db)!;
      expect(marker).toMatchObject({ from: 65, to: 60 });
      expect(marker.at).toBe(row.updatedAt);
      expect(await hasAppDataNow()).toBe(false);
    });

    it('a re-import keeps 60 (keptAppPreference) and does not replace again', async () => {
      const res = await upload('?confirmReplace=true');
      expect(res.statusCode).toBe(201);
      const run = res.json<ImportRunDetail>();
      expect(run.report?.checks.some((c) => c.id === 'settings.keptAppPreference')).toBe(true);
      expect(ageRow(database)).toMatchObject({ valueJson: '60', origin: 'app' });
      expect(applySettingUpgrades(database, NOW)).toEqual([]);
      expect(await hasAppDataNow()).toBe(false);
    });
  },
);

describe.skipIf(!SYNTHETIC_WORKBOOK_IMPLEMENTED || !IMPORTER_IMPLEMENTED)(
  'the CLI runs the D98 one-off after a committed import',
  { timeout: 60_000 },
  () => {
    let root: string;
    let workbook: string;

    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), 'joinr-fire-cli-'));
      workbook = join(root, 'synthetic.xlsx');
      writeFileSync(workbook, buildSyntheticWorkbook({ mutate: withAccessAge65 }));
    });

    afterAll(() => rmSync(root, { recursive: true, force: true }));

    function run(argv: string[], dataDir: string) {
      let out = '';
      let err = '';
      const io: CliIo = {
        stdout: { write: (s: string) => (out += s) },
        stderr: { write: (s: string) => (err += s) },
        env: { NODE_ENV: 'test', DATA_DIR: dataDir, IMPORT_CORRECTIONS_FILE: 'none' },
        cwd: root,
      };
      return main(argv, io).then((code) => ({ code, out, err }));
    }

    function inspect<T>(dataDir: string, fn: (database: AppDatabase) => T): T {
      const database = openDatabase(dataDir);
      try {
        return fn(database);
      } finally {
        closeDatabase(database);
      }
    }

    it('dry run: no upgrade; committed: 60 with one line; forced re-import keeps it', async () => {
      const dataDir = join(root, 'data');
      const dry = await run([workbook, '--no-corrections', '--dry-run'], dataDir);
      expect(dry.code).toBe(EXIT.ok);
      expect(dry.out).not.toContain('Access age changed');
      inspect(dataDir, (d) => expect(readAccessAgeMarker(d.db)).toBeNull());

      const first = await run([workbook, '--no-corrections'], dataDir);
      expect(first.code).toBe(EXIT.ok);
      expect(first.out.match(/Access age changed from 65 \(the workbook\) to 60/g)).toHaveLength(1);
      inspect(dataDir, (d) => {
        expect(ageRow(d)).toMatchObject({ valueJson: '60', origin: 'app' });
        expect(readAccessAgeMarker(d.db)).toMatchObject({ from: 65, to: 60 });
        expect(hasAppData(d.db)).toBe(false);
      });

      // A forced replace keeps preference rows too, and the marker stops a second line.
      const forced = await run(
        [workbook, '--no-corrections', '--yes', '--replace-app-data', '--json'],
        dataDir,
      );
      expect(forced.code).toBe(EXIT.ok);
      expect(forced.out + forced.err).not.toContain('Access age changed');
      // stdout stays pure JSON with --json.
      expect(() => JSON.parse(forced.out) as unknown).not.toThrow();
      inspect(dataDir, (d) => {
        expect(ageRow(d)).toMatchObject({ valueJson: '60', origin: 'app' });
        expect(hasAppData(d.db)).toBe(false);
      });
    });

    it('with --json the upgrade line goes to stderr', async () => {
      const dataDir = join(root, 'data-json');
      const res = await run([workbook, '--no-corrections', '--json'], dataDir);
      expect(res.code).toBe(EXIT.ok);
      expect(() => JSON.parse(res.out) as unknown).not.toThrow();
      expect(res.err).toContain('Access age changed from 65 (the workbook) to 60');
    });
  },
);

describe.skipIf(!SYNTHETIC_WORKBOOK_IMPLEMENTED || !IMPORTER_IMPLEMENTED)(
  'a failed upgrade after a committed import is deferred, never an error (triage CODE-3)',
  { timeout: 60_000 },
  () => {
    let root: string;
    afterEach(() => {
      upgradeFails.on = false;
      if (root) rmSync(root, { recursive: true, force: true });
    });
    const bytes = () => Buffer.from(buildSyntheticWorkbook({ mutate: withAccessAge65 }));

    it('the upload route answers 201 with the run and still schedules the price refresh', async () => {
      root = mkdtempSync(join(tmpdir(), 'joinr-fire-busy-'));
      const config = testConfig(join(root, 'data'));
      const database = openDatabase(config.dataDir);
      runMigrations(database, config.migrationsDir);
      let notify: ReturnType<typeof vi.fn> | undefined;
      const app = await buildApp({
        config,
        db: database,
        now: () => NOW,
        engine: fakeEngine(),
        services: (deps) => {
          const built = offServices(deps);
          notify = vi.spyOn(built.market, 'notifyInstrumentsChanged');
          return built;
        },
      });
      try {
        upgradeFails.on = true;
        const res = await app.inject({
          method: 'POST',
          url: '/api/import',
          payload: bytes(),
          headers: { 'content-type': 'application/octet-stream' },
        });
        expect(res.statusCode).toBe(201);
        expect(res.json<ImportRunDetail>().status).toBe('succeeded');
        expect(notify).toHaveBeenCalled();
        // Deferred: the imported 65 stays and no marker is written.
        expect(ageRow(database)).toMatchObject({ valueJson: '65' });
        expect(readAccessAgeMarker(database.db)).toBeNull();
      } finally {
        await app.close();
      }
    });

    it('the CLI prints the result, one stderr line, and exits 0', async () => {
      root = mkdtempSync(join(tmpdir(), 'joinr-fire-busy-cli-'));
      const workbook = join(root, 'synthetic.xlsx');
      writeFileSync(workbook, bytes());
      let out = '';
      let err = '';
      const io: CliIo = {
        stdout: { write: (s: string) => (out += s) },
        stderr: { write: (s: string) => (err += s) },
        env: { NODE_ENV: 'test', DATA_DIR: join(root, 'data'), IMPORT_CORRECTIONS_FILE: 'none' },
        cwd: root,
      };
      upgradeFails.on = true;
      const code = await main([workbook, '--no-corrections', '--json'], io);
      expect(code).toBe(EXIT.ok);
      expect((JSON.parse(out) as { status: string }).status).toBe('succeeded');
      expect(err).toContain('Access-age upgrade deferred to the next server start.');
      expect(err).not.toContain('Access age changed');
    });
  },
);
