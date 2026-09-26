// Stage 3 importer changes (stage-3.md §3.5, §7.6) on the generic synthetic workbook: dated
// side-income deposits (D57), one balance entry per account (D58), account kinds kept across a
// re-import (D49), the typed Budget C28 amount (D54), the settings gap (§3.3 rule 3), the
// re-pointed reconciliation checks, and overlays a re-import never touches (§3.4).
import type { CellObject, WorkBook } from 'xlsx';
import { isSettingKey, isWorkbookSetting, type CashAccountKind } from '@joinr/schema';
import {
  budgetItems,
  cashAccounts,
  cashBalanceEntries,
  dividendEvents,
  DOMAIN_TABLES_DELETE_ORDER,
  instruments,
  periodNotes,
  savingsAdjustments,
  savingsGoals,
  settings,
  sideIncomeDeposits,
  sideIncomeEntries,
  type JoinrDb,
} from '@joinr/schema/db';
import { createTestDb, dumpDomainTables, type TestDb } from '@joinr/schema/testing';
import { asc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { carryAccountKinds } from '../src/process';
import { IMPORTER_STAGE3_IMPLEMENTED } from '../src/testing/index';
import { buildSyntheticWorkbook, SYNTHETIC_FACTS } from '../src/testing/syntheticWorkbook';
import { checkById, problems, reportOf, runImport } from './helpers';

const LATER = () => new Date('2026-04-02T03:04:05.000Z');

it('is flagged implemented for the gated server suites (§3.5 item 7)', () => {
  expect(IMPORTER_STAGE3_IMPLEMENTED).toBe(true);
});

const num = (v: number, f?: string): CellObject =>
  f === undefined ? { t: 'n', v } : { t: 'n', v, f };
const str = (v: string): CellObject => ({ t: 's', v });

function cellValue(wb: WorkBook, sheet: string, addr: string): number {
  return (wb.Sheets[sheet]![addr] as CellObject).v as number;
}

/** The live Side Income row (row 7, F = the month end after the as-of) gets an amount and a note. */
function withLiveRowDeposit(wb: WorkBook, amount: number): void {
  const ws = wb.Sheets['Side Income']!;
  ws.G7 = num(amount);
  ws.I7 = num(amount, 'IF(F7<>"",sum(G7:H7),"")');
  ws.J7 = str('Example note: live month');
  ws.C7 = num(cellValue(wb, 'Side Income', 'C7') + amount, 'sum($I$2:$I799)');
}

type CashRow = [row: number, name: string, balance: number, offset: boolean];

/** The synthetic accounts in their template rows (row 4 blank). */
const CASH_ROWS: CashRow[] = [
  [2, 'Example Bank – Everyday', 1500.25, false],
  [3, 'Example Bank – Savings', 10000, false],
  [5, 'Example Card – Credit', -350.5, false],
  [6, 'Example Offset', 5000, true],
];

/** Rewrites Cash!A2:E12 with these accounts (extra accounts hold 0, so the totals stay). */
function withCashRows(rows: readonly CashRow[]) {
  return (wb: WorkBook): void => {
    const ws = wb.Sheets.Cash!;
    for (let r = 2; r <= 12; r++) for (const c of ['A', 'B', 'C', 'D', 'E']) delete ws[`${c}${r}`];
    for (const [r, name, balance, offset] of rows) {
      ws[`A${r}`] = str(name);
      ws[`B${r}`] = str('AUD');
      ws[`C${r}`] = num(balance);
      ws[`D${r}`] = num(balance, `IF($B${r}<>"",C${r},C${r})`);
      ws[`E${r}`] = { t: 'b', v: offset };
    }
  };
}

/** Rows shifted down by one, with a zero-balance account inserted at row 2. */
const SHIFTED: CashRow[] = [
  [2, 'Example Bank – Travel', 0, false],
  ...CASH_ROWS.map(([r, name, balance, offset]): CashRow => [r + 1, name, balance, offset]),
];

/** §3.3 rule 2 over the tables the importer owns (the server's hasAppData, minus the marker). */
function hasAppRows(db: JoinrDb): boolean {
  const appSettings = db
    .select()
    .from(settings)
    .where(eq(settings.origin, 'app'))
    .all()
    .some((s) => isSettingKey(s.key) && isWorkbookSetting(s.key));
  if (appSettings) return true;
  return [instruments, ...DOMAIN_TABLES_DELETE_ORDER].some(
    (table) =>
      db
        .select({ origin: table.origin })
        .from(table)
        .where(eq(table.origin, 'app'))
        .limit(1)
        .get() !== undefined,
  );
}

describe('carryAccountKinds (D49)', () => {
  const stored = (name: string, sheetRef: string | null, kind: CashAccountKind) => ({
    name,
    sheetRef,
    kind,
  });

  it('matches a unique name even when the row moved', () => {
    const result = carryAccountKinds(
      [
        stored('Everyday', 'Cash!A2', 'bank'),
        stored('Loan to a friend', 'Cash!A3', 'loan_receivable'),
      ],
      [
        { name: 'New account', sheetRef: 'Cash!A2' },
        { name: 'Everyday', sheetRef: 'Cash!A3' },
        { name: ' Loan to a friend ', sheetRef: 'Cash!A4' },
      ],
    );
    expect(result).toEqual({ kinds: ['bank', 'bank', 'loan_receivable'], notCarried: [] });
  });

  it('falls back to the sheet ref and name when a name repeats', () => {
    const before = [
      stored('Example Loan', 'Cash!A4', 'bank'),
      stored('Example Loan', 'Cash!A7', 'loan_receivable'),
    ];
    expect(
      carryAccountKinds(before, [
        { name: 'Example Loan', sheetRef: 'Cash!A4' },
        { name: 'Example Loan', sheetRef: 'Cash!A7' },
      ]),
    ).toEqual({ kinds: ['bank', 'loan_receivable'], notCarried: [] });
    // Both rows moved: neither ref matches, so the kind cannot be carried over.
    expect(
      carryAccountKinds(before, [
        { name: 'Example Loan', sheetRef: 'Cash!A5' },
        { name: 'Example Loan', sheetRef: 'Cash!A8' },
      ]),
    ).toEqual({ kinds: ['bank', 'bank'], notCarried: ['Example Loan'] });
  });

  it('uses the ref when a name is unique among the new accounts but not the stored ones', () => {
    const result = carryAccountKinds(
      [stored('Card', 'Cash!A5', 'credit_card'), stored('Card', null, 'other')],
      [{ name: 'Card', sheetRef: 'Cash!A5' }],
    );
    expect(result).toEqual({ kinds: ['credit_card'], notCarried: ['Card'] });
  });

  it('gives a renamed account bank and lists the lost kind; bank kinds are never listed', () => {
    const result = carryAccountKinds(
      [stored('Everyday', 'Cash!A2', 'bank'), stored('Old card', 'Cash!A3', 'credit_card')],
      [{ name: 'New card', sheetRef: 'Cash!A3' }],
    );
    expect(result).toEqual({ kinds: ['bank'], notCarried: ['Old card'] });
    expect(carryAccountKinds([], [{ name: 'A', sheetRef: null }])).toEqual({
      kinds: ['bank'],
      notCarried: [],
    });
  });
});

describe('importWorkbook: Stage 3 cash flow data', () => {
  let t: TestDb;
  beforeEach(() => {
    t = createTestDb();
  });
  afterEach(() => t.close());

  const deposits = () =>
    t.db
      .select()
      .from(sideIncomeDeposits)
      .orderBy(asc(sideIncomeDeposits.id))
      .all()
      .map((d) => [d.sheetRef, d.streamId, d.depositDate, d.amountCents]);
  const accountsByName = () =>
    new Map(
      t.db
        .select()
        .from(cashAccounts)
        .all()
        .map((a) => [a.name, a]),
    );
  const kindOf = (name: string) => accountsByName().get(name)?.kind;
  const setKind = (name: string, kind: CashAccountKind) =>
    t.db.update(cashAccounts).set({ kind }).where(eq(cashAccounts.name, name)).run();
  const autoInvest = () =>
    t.db
      .select()
      .from(budgetItems)
      .all()
      .find((b) => b.kind === 'auto_invest');

  describe('side income (D57)', () => {
    it('writes one deposit per non-zero cell, dated at the period end, and no entries', () => {
      const report = reportOf(runImport(t.db, buildSyntheticWorkbook()));
      expect(problems(report)).toEqual([]);
      // G → stream 1, H → stream 2; the zero cells G3 and H2 write nothing.
      expect(deposits()).toEqual([
        ['Side Income!G2', 1, '2025-10-31', 100000],
        ['Side Income!H3', 2, '2025-11-30', 15000],
        ['Side Income!G4', 1, '2025-12-31', 25050],
        ['Side Income!G5', 1, '2026-01-31', 120000],
        ['Side Income!H5', 2, '2026-01-31', 7513],
        ['Side Income!G6', 1, '2026-02-28', 80025],
        ['Side Income!H6', 2, '2026-02-28', 6000],
      ]);
      const rows = t.db.select().from(sideIncomeDeposits).all();
      expect(rows.every((d) => d.origin === 'import' && d.note === null)).toBe(true);
      expect(t.db.select().from(sideIncomeEntries).all()).toEqual([]);
      // The J notes stay period notes.
      expect(
        t.db
          .select()
          .from(periodNotes)
          .where(eq(periodNotes.kind, 'side_income'))
          .all()
          .map((n) => [n.periodMonth, n.sheetRef]),
      ).toEqual([
        ['2025-11', 'Side Income!J3'],
        ['2026-01', 'Side Income!J5'],
      ]);
      // Every deposit lies on or before its period end: none needed the as-of date.
      expect(report.checks.some((c) => c.id === 'income.datedAtAsOf')).toBe(false);
    });

    it('dates the live row’s deposits at the workbook as-of and says so (count only)', () => {
      const bytes = buildSyntheticWorkbook({ mutate: (wb) => withLiveRowDeposit(wb, 300) });
      const report = reportOf(runImport(t.db, bytes));
      expect(problems(report)).toEqual([]);
      expect(deposits().at(-1)).toEqual(['Side Income!G7', 1, SYNTHETIC_FACTS.asOf, 30000]);
      expect(checkById(report, 'income.datedAtAsOf')).toMatchObject({
        status: 'info',
        section: 'income',
        unit: 'count',
        actual: 1,
        expected: null,
      });
      expect(checkById(report, 'income.datedAtAsOf').reason).not.toMatch(/\d{3}/);
      // The live row's note is still a period note of its own month.
      expect(
        t.db
          .select()
          .from(periodNotes)
          .all()
          .find((n) => n.sheetRef === 'Side Income!J7'),
      ).toMatchObject({ kind: 'side_income', periodMonth: '2026-03' });
      expect(checkById(report, 'counts.side-income')).toMatchObject({
        status: 'match',
        expected: 8,
        actual: 8,
      });
      expect(checkById(report, 'income.total')).toMatchObject({ status: 'match' });
    });

    it('re-points the reconciliation at the deposits', () => {
      const report = reportOf(runImport(t.db, buildSyntheticWorkbook()));
      expect(checkById(report, 'counts.side-income')).toMatchObject({
        label: 'Side income deposits',
        status: 'match',
        expected: 7,
        actual: 7,
      });
      expect(report.counts['side-income']).toBe(7);
      // Stream sums: G = 1000 + 0 + 250.50 + 1200 + 800.25, H = 0 + 150 + 75.125 + 60.
      expect(checkById(report, 'income.stream.1')).toMatchObject({
        status: 'match',
        expected: 325075,
        actual: 325075,
      });
      expect(checkById(report, 'income.stream.2')).toMatchObject({
        status: 'match',
        expected: 28513,
        actual: 28513,
      });
      expect(checkById(report, 'income.total')).toMatchObject({
        status: 'match',
        actual: 353588,
      });
    });
  });

  describe('balance history (D58)', () => {
    it('writes one entry per account at the workbook as-of', () => {
      const report = reportOf(runImport(t.db, buildSyntheticWorkbook()));
      const accounts = t.db.select().from(cashAccounts).orderBy(asc(cashAccounts.id)).all();
      const entries = t.db
        .select()
        .from(cashBalanceEntries)
        .orderBy(asc(cashBalanceEntries.id))
        .all();
      expect(entries.map((e) => [e.accountId, e.asOf, e.balanceCents, e.sheetRef])).toEqual(
        accounts.map((a) => [a.id, SYNTHETIC_FACTS.asOf, a.balanceCents, a.sheetRef]),
      );
      expect(entries.every((e) => e.origin === 'import' && e.note === null)).toBe(true);
      expect(accounts.every((a) => a.balanceAsOf === SYNTHETIC_FACTS.asOf)).toBe(true);
      expect(checkById(report, 'counts.cash-balance-entries')).toMatchObject({
        status: 'match',
        expected: 4,
        actual: 4,
      });
      expect(report.counts['cash-balance-entries']).toBe(4);
    });
  });

  describe('account kinds across a re-import (D49)', () => {
    it('keeps a kind set in the app, by a unique name', () => {
      const bytes = buildSyntheticWorkbook();
      runImport(t.db, bytes);
      setKind('Example Bank – Savings', 'loan_receivable');
      setKind('Example Card – Credit', 'credit_card');
      const before = dumpDomainTables(t.db);
      const report = reportOf(runImport(t.db, bytes, { now: LATER }));
      expect(problems(report)).toEqual([]);
      expect(kindOf('Example Bank – Savings')).toBe('loan_receivable');
      expect(kindOf('Example Card – Credit')).toBe('credit_card');
      expect(kindOf('Example Bank – Everyday')).toBe('bank');
      expect(report.checks.some((c) => c.id === 'cash.kindsNotCarried')).toBe(false);
      // A kind-only edit is import-safe: the re-import leaves every table as it was.
      expect(dumpDomainTables(t.db)).toEqual(before);
      expect(hasAppRows(t.db)).toBe(false);
    });

    it('keeps the kinds when a row is inserted above the accounts', () => {
      runImport(t.db, buildSyntheticWorkbook());
      setKind('Example Bank – Savings', 'loan_receivable');
      setKind('Example Offset', 'other');
      const bytes = buildSyntheticWorkbook({ mutate: withCashRows(SHIFTED) });
      const report = reportOf(runImport(t.db, bytes, { now: LATER }));
      expect(problems(report)).toEqual([]);
      const accounts = accountsByName();
      expect(accounts.get('Example Bank – Savings')).toMatchObject({
        kind: 'loan_receivable',
        sheetRef: 'Cash!A4',
      });
      expect(accounts.get('Example Offset')).toMatchObject({ kind: 'other', sheetRef: 'Cash!A7' });
      expect(accounts.get('Example Bank – Travel')?.kind).toBe('bank');
      expect(report.checks.some((c) => c.id === 'cash.kindsNotCarried')).toBe(false);
    });

    it('matches repeated names by sheet ref and name', () => {
      const rows: CashRow[] = [
        ...CASH_ROWS,
        [4, 'Example Loan', 0, false],
        [7, 'Example Loan', 0, false],
      ];
      const bytes = buildSyntheticWorkbook({ mutate: withCashRows(rows) });
      runImport(t.db, bytes);
      t.db
        .update(cashAccounts)
        .set({ kind: 'loan_receivable' })
        .where(eq(cashAccounts.sheetRef, 'Cash!A7'))
        .run();
      const report = reportOf(runImport(t.db, bytes, { now: LATER }));
      expect(problems(report)).toEqual([]);
      const loans = t.db
        .select()
        .from(cashAccounts)
        .where(eq(cashAccounts.name, 'Example Loan'))
        .all()
        .map((a) => [a.sheetRef, a.kind]);
      expect(loans).toEqual([
        ['Cash!A4', 'bank'],
        ['Cash!A7', 'loan_receivable'],
      ]);
      expect(report.checks.some((c) => c.id === 'cash.kindsNotCarried')).toBe(false);
    });

    it('gives a renamed account bank and adds an info line naming the lost kind', () => {
      runImport(t.db, buildSyntheticWorkbook());
      setKind('Example Offset', 'other');
      const renamed = CASH_ROWS.map(([r, name, balance, offset]): CashRow => [
        r,
        name === 'Example Offset' ? 'Example Offset – Home' : name,
        balance,
        offset,
      ]);
      const bytes = buildSyntheticWorkbook({ mutate: withCashRows(renamed) });
      const report = reportOf(runImport(t.db, bytes, { now: LATER }));
      expect(problems(report)).toEqual([]);
      expect(kindOf('Example Offset – Home')).toBe('bank');
      expect(checkById(report, 'cash.kindsNotCarried')).toMatchObject({
        status: 'info',
        section: 'cash',
        unit: 'count',
        expected: 1,
        reason:
          '1 account kind could not be carried over; set it again on the Cash page (Example Offset)',
      });
    });
  });

  describe('Budget C28 (D54)', () => {
    it('stores a typed investment amount and leaves the template formula null', () => {
      runImport(t.db, buildSyntheticWorkbook());
      expect(autoInvest()).toMatchObject({
        name: 'Investment Savings - Automatic',
        monthlyCents: null,
      });
      const derived = t.db
        .select()
        .from(budgetItems)
        .all()
        .filter((b) => b.kind === 'auto_yearly' || b.kind === 'auto_cash');
      expect(derived.map((b) => b.monthlyCents)).toEqual([null, null]);

      const typed = (v: number) =>
        buildSyntheticWorkbook({ mutate: (wb) => (wb.Sheets.Budget!.C28 = num(v)) });
      let report = reportOf(runImport(t.db, typed(300), { now: LATER }));
      expect(problems(report)).toEqual([]);
      expect(autoInvest()?.monthlyCents).toBe(30000);
      report = reportOf(runImport(t.db, typed(0), { now: LATER }));
      expect(problems(report)).toEqual([]);
      expect(autoInvest()?.monthlyCents).toBe(0);
    });
  });

  describe('the settings gap (§3.3 rule 3)', () => {
    it('removes app values of workbook keys the workbook does not provide', () => {
      const bytes = buildSyntheticWorkbook();
      runImport(t.db, bytes);
      const setting = (key: string) =>
        t.db.select().from(settings).where(eq(settings.key, key)).get();
      const payDay = setting('pay.dayOfMonth');
      if (!payDay) throw new Error('the synthetic workbook provides pay.dayOfMonth');
      const at = '2026-03-25T00:00:00.000Z';
      // D3 holds the default formula, so the workbook does not provide the override.
      t.db
        .insert(settings)
        .values({
          key: 'budget.emergencyFundOverrideCents',
          valueJson: '700000',
          updatedAt: at,
          origin: 'app',
        })
        .run();
      t.db
        .update(settings)
        .set({ valueJson: '28', updatedAt: at, origin: 'app' })
        .where(eq(settings.key, 'pay.dayOfMonth'))
        .run();
      t.db
        .insert(settings)
        .values({ key: 'savings.yearBasis', valueJson: '"calendar"', updatedAt: at, origin: 'app' })
        .run();
      expect(hasAppRows(t.db)).toBe(true);

      // A dry run changes nothing.
      runImport(t.db, bytes, { dryRun: true, now: LATER });
      expect(setting('budget.emergencyFundOverrideCents')?.origin).toBe('app');

      const report = reportOf(runImport(t.db, bytes, { now: LATER }));
      expect(problems(report)).toEqual([]);
      expect(setting('budget.emergencyFundOverrideCents')).toBeUndefined();
      expect(setting('pay.dayOfMonth')).toMatchObject({
        valueJson: payDay.valueJson,
        origin: 'import',
        updatedAt: LATER().toISOString(),
      });
      // An app-only key is never touched by an import (and never counts as app data).
      expect(setting('savings.yearBasis')).toMatchObject({
        valueJson: '"calendar"',
        origin: 'app',
        updatedAt: at,
      });
      expect(hasAppRows(t.db)).toBe(false);
      expect(checkById(report, 'settings.budget.emergencyFundOverrideCents')).toMatchObject({
        status: 'info',
        reasonCode: 'formula_default',
        actual: null,
      });
    });
  });

  describe('re-imports', () => {
    it('never touch the overlays (adjustments, goals, the dividend-events cache)', () => {
      const bytes = buildSyntheticWorkbook();
      runImport(t.db, bytes);
      const etf = t.db
        .select()
        .from(instruments)
        .all()
        .find((i) => i.symbol === 'ASX:DEF')!.id;
      t.db
        .insert(savingsAdjustments)
        .values({
          periodMonth: '2026-01',
          amountCents: -50000,
          note: 'Example one-off',
          origin: 'app',
        })
        .run();
      t.db
        .insert(savingsGoals)
        .values({ name: 'Example goal', targetCents: 1000000, sortOrder: 1, origin: 'app' })
        .run();
      t.db
        .insert(dividendEvents)
        .values({
          instrumentId: etf,
          exDate: '2025-12-30',
          amountPerUnit: '0.5',
          currency: 'AUD',
          closeBeforeEx: '49',
          closeDate: '2025-12-29',
          source: 'fake',
          fetchedAt: '2026-03-25T00:00:00.000Z',
          dismissedAt: '2026-03-26T00:00:00.000Z',
        })
        .run();
      const overlays = () => ({
        adjustments: t.db.select().from(savingsAdjustments).all(),
        goals: t.db.select().from(savingsGoals).all(),
        events: t.db.select().from(dividendEvents).all(),
      });
      const before = overlays();
      reportOf(runImport(t.db, bytes, { now: LATER }));
      expect(overlays()).toEqual(before);
      expect(before.events).toHaveLength(1);
      // Overlays never count as app data.
      expect(hasAppRows(t.db)).toBe(false);
    });

    it('stay idempotent with deposits, balance entries and carried kinds (ids included)', () => {
      const bytes = buildSyntheticWorkbook({ mutate: (wb) => withLiveRowDeposit(wb, 125.5) });
      const first = reportOf(runImport(t.db, bytes));
      setKind('Example Card – Credit', 'credit_card');
      const dump = dumpDomainTables(t.db);
      expect(dump.cash_balance_entries).toHaveLength(4);
      expect(dump.side_income_deposits).toHaveLength(8);
      const second = reportOf(runImport(t.db, bytes, { now: LATER }));
      expect(dumpDomainTables(t.db)).toEqual(dump);
      const view = (r: typeof first) => r.checks.map((c) => [c.id, c.status, c.expected, c.actual]);
      expect(view(second)).toEqual(view(first));
      expect(second.counts).toEqual(first.counts);
    });
  });
});
