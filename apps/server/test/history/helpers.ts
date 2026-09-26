// Shared helpers for the Stage 5 server suites (stage-5.md §7.4): a fake engine whose Stage 5
// members follow the frozen rules closely enough for the server's wiring (the recording rules of
// §2.9, a composer that copies its inputs, the §2.5 derived columns, `netWorthOf`), so the record,
// correction and delete paths run before the engine lands; hand-built engine results for the DTO
// mapping tests; and an app on the generic seed with that engine. Generic values only.
import type {
  ComposeSnapshotInput,
  DerivedSnapshotColumns,
  EngineApi,
  NetWorthBreakdown,
  SnapshotFigures,
} from '@joinr/engine';
import {
  isoMonthOf,
  JoinrDecimal,
  monthEndOf,
  normaliseDecimal,
  SNAPSHOT_FIGURE_COLUMNS,
  type IsoDate,
  type IsoMonth,
} from '@joinr/schema';
import { nextIsoMonth } from '../../src/history/inputs';
import { assetsFakeEngine } from '../assets/helpers';
import type { FakeEngine } from '../investments/helpers';

export { call, errorOf, hasAppDataOf, startApp, type TestApp } from '../cashflow/helpers';
export { AS_OF, fakeMarket, NOW } from '../investments/helpers';

/** Every figure null. */
export function nullFigures(): SnapshotFigures {
  return Object.fromEntries(
    SNAPSHOT_FIGURE_COLUMNS.map((c) => [c, null]),
  ) as unknown as SnapshotFigures;
}

/** A figure set: every column null except the given ones. */
export function figures(p: Partial<SnapshotFigures> = {}): SnapshotFigures {
  return { ...nullFigures(), ...p };
}

/** The sheet ratio `IFERROR(g ÷ (v − g), 0)` at 12 significant digits (§2.1). */
export function sheetRatio(gain: number | null, value: number | null): string {
  if (gain === null || value === null || value - gain === 0) return '0';
  return normaliseDecimal(
    new JoinrDecimal(gain).div(value - gain).toSignificantDigits(12, JoinrDecimal.ROUND_HALF_UP),
  );
}

// ─── The recording rules (§2.9) ─────────────────────────────────────────────────────────────────

export function nextRecordMonthRule(
  snapshots: readonly { periodMonth: IsoMonth }[],
  today: IsoDate,
): IsoMonth {
  const latest = snapshots.reduce<IsoMonth | null>(
    (best, s) => (best === null || s.periodMonth > best ? s.periodMonth : best),
    null,
  );
  return latest === null ? isoMonthOf(today) : nextIsoMonth(latest);
}

export function recordableMonthsRule(
  snapshots: readonly { periodMonth: IsoMonth }[],
  today: IsoDate,
): IsoMonth[] {
  const current = isoMonthOf(today);
  const out: IsoMonth[] = [];
  for (let m = nextRecordMonthRule(snapshots, today); m <= current; m = nextIsoMonth(m))
    out.push(m);
  return out;
}

// ─── A composer and the derived columns (§2.4, §2.5), enough for the server's wiring ───────────

/**
 * Copies its inputs: the four kinds' value and total return, cash N and O, the seam's super,
 * property and other-asset columns, U = V = 0, W, the extras. Movements: the number of trades in
 * the window × 100 cents (so a test sees the window).
 */
export function composeRule(input: ComposeSnapshotInput): SnapshotFigures {
  const inv = input.investments;
  const after = input.previous?.runDate ?? null;
  const moves = (kind: keyof ComposeSnapshotInput['trades']) =>
    input.trades[kind].filter(
      (t) => (after === null || t.tradeDate > after) && t.tradeDate <= input.runDate,
    ).length * 100;
  const n = input.cash.totalCashCents;
  const prevN = input.previous?.cashValueCents ?? null;
  const o = prevN === null ? null : n - prevN;
  const debt = input.cashAccounts
    .filter((a) => !a.isOffset && a.balanceCents < 0)
    .reduce((s, a) => s + a.balanceCents, 0);
  const a = input.assets;
  return {
    stocksValueCents: inv.stock.summary.valueCents,
    stocksGainCents: inv.stock.summary.totalReturnCents,
    stocksGainRatio: sheetRatio(inv.stock.summary.totalReturnCents, inv.stock.summary.valueCents),
    stocksMovementsCents: moves('stock'),
    etfValueCents: inv.etf.summary.valueCents,
    etfGainCents: inv.etf.summary.totalReturnCents,
    etfGainRatio: sheetRatio(inv.etf.summary.totalReturnCents, inv.etf.summary.valueCents),
    etfMovementsCents: moves('etf'),
    cryptoValueCents: inv.crypto.summary.valueCents,
    cryptoGainCents: inv.crypto.summary.totalReturnCents,
    cryptoGainRatio: sheetRatio(inv.crypto.summary.totalReturnCents, inv.crypto.summary.valueCents),
    cryptoMovementsCents: moves('crypto'),
    cashValueCents: n,
    cashGainCents: o,
    cashIncreaseRatio: sheetRatio(o, n),
    superValueCents: a.superValueCents,
    superContribCents: a.superContribCents,
    superGainCents: a.superGainCents,
    superGainRatio: sheetRatio(a.superGainCents, a.superValueCents),
    liabilitiesBalanceCents: 0,
    liabilitiesPaidCents: 0,
    salaryMonthlyCents: input.salaryMonthlyCents,
    propertyValueCents: a.propertyValueCents,
    propertyPurchaseCents: a.propertyPurchaseCents,
    propertyEquityCents: a.propertyEquityCents,
    propertyGainCents: a.propertyGainCents,
    mortgageBalanceCents: a.mortgageBalanceCents,
    mortgageInterestFeesCents: a.mortgageInterestFeesCents,
    mortgagePrincipalPaidCents: a.mortgagePrincipalPaidCents,
    propertyGainRatio: sheetRatio(a.propertyGainCents, a.propertyValueCents),
    mfValueCents: inv.managed_fund.summary.valueCents,
    mfGainCents: inv.managed_fund.summary.totalReturnCents,
    mfGainRatio: sheetRatio(
      inv.managed_fund.summary.totalReturnCents,
      inv.managed_fund.summary.valueCents,
    ),
    mfMovementsCents: moves('managed_fund'),
    otherValueCents: a.otherValueCents,
    otherGainCents: a.otherGainCents,
    offsetCents: input.cash.offsetCents,
    mortgageOffsetCents: a.mortgageOffsetCents,
    cashDebtCents: debt,
    superMeasuredThrough: input.superMeasuredThrough,
  };
}

/** §2.5's derived columns. */
export function deriveRule(i: {
  figures: SnapshotFigures;
  previousCashValueCents: number | null | undefined;
}): DerivedSnapshotColumns {
  const f = i.figures;
  const prev = i.previousCashValueCents;
  const o =
    prev === undefined || prev === null || f.cashValueCents === null
      ? null
      : f.cashValueCents - prev;
  return {
    stocksGainRatio: sheetRatio(f.stocksGainCents, f.stocksValueCents),
    etfGainRatio: sheetRatio(f.etfGainCents, f.etfValueCents),
    cryptoGainRatio: sheetRatio(f.cryptoGainCents, f.cryptoValueCents),
    cashGainCents: o,
    cashIncreaseRatio: sheetRatio(o, f.cashValueCents),
    superGainRatio: sheetRatio(f.superGainCents, f.superValueCents),
    propertyEquityCents:
      f.propertyValueCents === null || f.mortgageBalanceCents === null
        ? null
        : f.propertyValueCents + f.mortgageBalanceCents + (f.mortgageOffsetCents ?? 0),
    propertyGainRatio: sheetRatio(f.propertyGainCents, f.propertyValueCents),
    mfGainRatio: sheetRatio(f.mfGainCents, f.mfValueCents),
  };
}

/** §2.6 step 1. */
export function netWorthRule(f: SnapshotFigures): NetWorthBreakdown {
  const v = (c: number | null) => c ?? 0;
  const missing = (
    [
      'stocksValueCents',
      'etfValueCents',
      'cryptoValueCents',
      'cashValueCents',
      'mfValueCents',
      'otherValueCents',
      'superValueCents',
      'propertyValueCents',
    ] as const
  ).filter((k) => f[k] === null);
  const liquid =
    v(f.stocksValueCents) +
    v(f.etfValueCents) +
    v(f.cryptoValueCents) +
    v(f.cashValueCents) +
    v(f.mfValueCents) +
    v(f.otherValueCents);
  const liabilities = -Math.abs(v(f.liabilitiesBalanceCents)) - Math.abs(v(f.mortgageBalanceCents));
  const offsets = v(f.offsetCents);
  return {
    liquidCents: liquid,
    superCents: v(f.superValueCents),
    propertyCents: v(f.propertyValueCents),
    liabilitiesCents: liabilities,
    offsetsCents: offsets,
    netWorthCents: liquid + v(f.superValueCents) + v(f.propertyValueCents) + liabilities + offsets,
    missing: [...missing],
  };
}

/** The structural assets fake plus the Stage 5 rules above (overrides win). */
export function historyFakeEngine(overrides: Partial<EngineApi> = {}): FakeEngine {
  return assetsFakeEngine({
    composeSnapshot: composeRule,
    deriveSnapshotColumns: deriveRule,
    netWorthOf: netWorthRule,
    nextRecordMonth: nextRecordMonthRule,
    recordableMonths: recordableMonthsRule,
    ...overrides,
  });
}

/** The last day of the month of `date` (tests on month ends). */
export function lastDayOf(date: IsoDate): IsoDate {
  return monthEndOf(isoMonthOf(date));
}
