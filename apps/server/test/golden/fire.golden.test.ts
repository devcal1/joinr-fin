// Server golden (stage-6.md §9.4): the local workbook imported with corrections OFF → the D98
// one-off (as the routes run it after an import) → `buildApp` (market off, now = Net Worth!E52 at
// 12:00 local) → the Settings and FIRE APIs, compared with the workbook's own cells read at runtime
// (the FIRE tab's typed inputs E6–E10, and the closed-row recomputation of E47/E48 from the Cash
// rows, §9.3 rules 3–4); a what-if saves nothing; a re-import keeps the upgraded access age and does
// not replace it again. Nothing here holds an owner value: only template cell references and rules.
// Gated on every engine and importer flag; skipped when the workbook is absent. Prints counts only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ASSETS_ENGINE_IMPLEMENTED,
  CASHFLOW_ENGINE_IMPLEMENTED,
  ENGINE_IMPLEMENTED,
  FIRE_ENGINE_IMPLEMENTED,
  HISTORY_ENGINE_IMPLEMENTED,
} from '@joinr/engine';
import { importWorkbook, readWorkbook, type WorkbookReader } from '@joinr/importer';
import {
  describeWithLocalWorkbook,
  IMPORTER_IMPLEMENTED,
  IMPORTER_STAGE3_IMPLEMENTED,
  IMPORTER_STAGE4_IMPLEMENTED,
  IMPORTER_STAGE5_IMPLEMENTED,
} from '@joinr/importer/testing';
import {
  centsFromNumber,
  FIRE_REPLACED_ACCESS_AGE,
  FIRE_TAB_PREFIX,
  JoinrDecimal,
  type FirePageResponse,
  type ImportRunDetail,
  type IsoDate,
  type SettingsPageResponse,
} from '@joinr/schema';
import { settings } from '@joinr/schema/db';
import { asc } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { openDatabase, runMigrations, type AppDatabase } from '../../src/db/database';
import { accessAgeNotice } from '../../src/fire/notices';
import { applySettingUpgrades } from '../../src/fire/upgrade';
import { expectRowsAddUp } from '../fire/helpers';
import { makeTempDir, removeDir, testConfig } from '../helpers';

const GATED =
  ENGINE_IMPLEMENTED &&
  CASHFLOW_ENGINE_IMPLEMENTED &&
  ASSETS_ENGINE_IMPLEMENTED &&
  HISTORY_ENGINE_IMPLEMENTED &&
  FIRE_ENGINE_IMPLEMENTED &&
  IMPORTER_IMPLEMENTED &&
  IMPORTER_STAGE3_IMPLEMENTED &&
  IMPORTER_STAGE4_IMPLEMENTED &&
  IMPORTER_STAGE5_IMPLEMENTED;

/** The raw figures: a once-rounded monthly mean × 12 (§9.5). */
const RAW_TOLERANCE_CENTS = 12;

// ─── Counting (§9.3 rule 7: counts only) ────────────────────────────────────────────────────────

const tally = { compared: 0, recomputed: 0 };

// ─── The workbook's cells (detected at runtime) ─────────────────────────────────────────────────

function fireTab(r: WorkbookReader): string {
  const name = r.sheetNames.find((n) => n.startsWith(FIRE_TAB_PREFIX));
  if (name === undefined) throw new Error('no FIRE tab');
  return name;
}

interface CashRow {
  date: IsoDate;
  savings: number | null;
  spend: number | null;
}

/** The Cash rows with a date in H (row 3 on) and their N (savings) and P (spend). */
function cashRows(r: WorkbookReader): CashRow[] {
  const out: CashRow[] = [];
  for (let row = 3; row <= r.lastRow('Cash'); row++) {
    const date = r.date('Cash', `H${row}`);
    if (date === null) continue;
    out.push({ date, savings: r.number('Cash', `N${row}`), spend: r.number('Cash', `P${row}`) });
  }
  return out;
}

const minusDays = (date: IsoDate, days: number): IsoDate => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d - days));
  return t.toISOString().slice(0, 10);
};

/**
 * The sheet's E47/E48 rule over the CLOSED rows only (§9.3 rules 3–4): the rows dated after
 * `lastRun − days` and on or before `lastRun` (the live row is after it), the baseline row (the
 * earliest, which has no period figures) left out; mean × 12 in cents, or null with no row.
 */
function closedRowMeanCents(
  rows: readonly CashRow[],
  lastRun: IsoDate,
  days: number,
  pick: (row: CashRow) => number | null,
): number | null {
  const baseline = rows.reduce<CashRow | null>(
    (first, row) => (first === null || row.date < first.date ? row : first),
    null,
  );
  const from = minusDays(lastRun, days);
  const values = rows
    .filter((row) => row !== baseline && row.date > from && row.date <= lastRun)
    .map(pick)
    .filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  const mean = values.reduce((s, v) => s.plus(v), new JoinrDecimal(0)).div(values.length);
  return centsFromNumber(mean.times(12).toNumber());
}

// ─── The test ───────────────────────────────────────────────────────────────────────────────────

describeWithLocalWorkbook('FIRE server golden (import → D98 → API)', (workbookPath) => {
  describe.skipIf(!GATED)(
    'corrections off, market off, as of the workbook date',
    { timeout: 180_000 },
    () => {
      let tempDir: string;
      let database: AppDatabase;
      let app: FastifyInstance;
      let bytes: Uint8Array;
      let r: WorkbookReader;
      let tab: string;
      let now: Date;
      let importedAge: number | null;

      const get = async <T>(url: string): Promise<T> => {
        const res = await app.inject({ method: 'GET', url });
        expect(res.statusCode, url).toBe(200);
        return res.json<T>();
      };
      const dump = () =>
        JSON.stringify(database.db.select().from(settings).orderBy(asc(settings.key)).all());

      beforeAll(async () => {
        bytes = new Uint8Array(readFileSync(workbookPath));
        r = readWorkbook(bytes);
        tab = fireTab(r);
        importedAge = r.number(tab, 'E10');
        const e52 = r.date('Net Worth', 'E52');
        if (e52 === null) throw new Error('Net Worth!E52 is not a date');
        const [y, m, d] = e52.split('-').map(Number) as [number, number, number];
        now = new Date(y, m - 1, d, 12, 0, 0);

        tempDir = await makeTempDir('joinr-golden-fire-');
        const config = testConfig(join(tempDir, 'data'));
        database = openDatabase(config.dataDir);
        runMigrations(database, config.migrationsDir);
        const result = importWorkbook(database.db, {
          bytes,
          fileName: 'workbook.xlsx',
          trigger: 'cli',
          corrections: null,
          now: () => now,
        });
        expect(result.status).toBe('succeeded');
        // As the upload route and the CLI do after a committed import (§3.4).
        applySettingUpgrades(database, now);
        app = await buildApp({ config, db: database, now: () => now });
      }, 180_000);

      afterAll(async () => {
        await app?.close();
        if (tempDir) await removeDir(tempDir);
        console.log(
          `[golden:server:fire] compared: ${tally.compared} · recomputed: ${tally.recomputed} (closed_rows)`,
        );
      });

      it('GET /api/settings: the FIRE inputs from the tab, the D98 replacement, no app data', async () => {
        const page = await get<SettingsPageResponse>('/api/settings');
        const byKey = new Map(page.settings.map((s) => [s.key, s]));
        const age = byKey.get('fire.preservationAge')!;
        if (importedAge === FIRE_REPLACED_ACCESS_AGE) {
          expect(age).toMatchObject({ value: 60, origin: 'app' });
          expect(age.notice).toBe(accessAgeNotice({ from: 65, to: 60, at: now.toISOString() }));
        } else {
          expect(age.value).toBe(importedAge);
          expect(age.notice).toBeNull();
        }
        expect(byKey.get('fire.birthYear')!.value).toBe(r.number(tab, 'E6'));
        for (const [key, cell] of [
          ['fire.inflationRate', 'E8'],
          ['fire.withdrawalRate', 'E9'],
        ] as const) {
          const value = byKey.get(key)!.value as string;
          expect(Number(value), key).toBeCloseTo(r.number(tab, cell)!, 12);
        }
        expect(page.hasAppData).toBe(false);
        tally.compared += 4;
      });

      it('GET /api/fire: the workbook’s contribution, the raw figures over the closed rows, a sane plan', async () => {
        const page = await get<FirePageResponse>('/api/fire');
        expect(page.whatIfActive).toBe(false);
        expect(page.hasAppData).toBe(false);
        // Owner question 1's default (D105): the workbook's figure is shown, the derived one used.
        const e7 = r.number(tab, 'E7');
        expect(page.inputs.superContribution).toMatchObject({
          source: 'derived',
          workbookCents: e7 === null ? null : centsFromNumber(e7),
        });
        expect(page.inputs.accessAge.replaced !== null).toBe(
          importedAge === FIRE_REPLACED_ACCESS_AGE,
        );
        tally.compared += 2;

        // §9.3 rules 3–4: the app's raw figures against the sheet's rule over the closed rows.
        const lastRun = r.date('Net Worth', 'C51');
        if (lastRun === null) throw new Error('Net Worth!C51 is not a date');
        const rows = cashRows(r);
        const spend = closedRowMeanCents(rows, lastRun, 366, (row) => row.spend);
        const savingsMean = closedRowMeanCents(rows, lastRun, 365, (row) => row.savings);
        const savings = savingsMean === null ? null : Math.max(0, savingsMean);
        for (const [ours, sheet, what] of [
          [page.derived.spend.rawYearlyCents, spend, 'E48'],
          [page.derived.savings.rawYearlyCents, savings, 'E47'],
        ] as const) {
          tally.recomputed += 1;
          // Both must exist (as the engine golden's area D `raw` helper): null on both sides fails.
          expect(sheet, `${what} closed-row helper`).not.toBeNull();
          expect(ours, what).not.toBeNull();
          if (ours === null || sheet === null) continue;
          expect(Math.abs(ours - sheet), what).toBeLessThanOrEqual(RAW_TOLERANCE_CENTS);
        }

        expect(page.projection.status).not.toBe('needs_input');
        expectRowsAddUp(page.projection.rows);
      });

      it('a what-if (access age 65) has a baseline and saves nothing', async () => {
        const before = dump();
        const page = await get<FirePageResponse>('/api/fire?accessAge=65');
        expect(page.whatIfActive).toBe(true);
        expect(page.baseline).not.toBeNull();
        expect(page.inputs.accessAge).toMatchObject({ value: 65, source: 'what_if' });
        expect(dump()).toBe(before);
      });

      it('a re-import keeps the access age and does not replace it again', async () => {
        const res = await app.inject({
          method: 'POST',
          url: '/api/import?confirmReplace=true',
          payload: Buffer.from(bytes),
          headers: { 'content-type': 'application/octet-stream' },
        });
        expect(res.statusCode).toBe(201);
        const run = res.json<ImportRunDetail>();
        if (importedAge === FIRE_REPLACED_ACCESS_AGE) {
          expect(run.report?.checks.some((c) => c.id === 'settings.keptAppPreference')).toBe(true);
        }
        const page = await get<SettingsPageResponse>('/api/settings');
        const age = page.settings.find((s) => s.key === 'fire.preservationAge')!;
        expect(age.value).toBe(importedAge === FIRE_REPLACED_ACCESS_AGE ? 60 : importedAge);
        expect(page.hasAppData).toBe(false);
        expect(applySettingUpgrades(database, now)).toEqual([]);
      });
    },
  );
});
