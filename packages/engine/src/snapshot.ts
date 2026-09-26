// The snapshot composer and checks (stage-5.md §2.4, §2.5; spec 01 §2.3): one History row (B…AK)
// plus the Stage 5 extras, composed from the Stage 2–4 results and the Stage 4 seam, and the
// recomputation of the derived and movement columns of stored snapshots (the PLAN acceptance).
// Ratios always come from the rounded cents they describe, so a recomputation matches exactly.
import {
  addMonthsIso,
  INSTRUMENT_KINDS,
  SNAPSHOT_CHECK_COLUMNS,
  type InstrumentKind,
  type IsoDate,
} from '@joinr/schema';
import { checkCents, dec, decN, ratioString } from './num';
import { netPurchases } from './history';
import { sortByRunDate } from './periods';
import type {
  Cents,
  ComposeSnapshotInput,
  DerivedSnapshotColumns,
  EngineSnapshot,
  EngineTrade,
  PurchaseWindow,
  SnapshotCheckResult,
  SnapshotDifference,
  SnapshotFigures,
} from './types';

/**
 * The sheet's History ratio `IFERROR(g ÷ (v − g), 0)` of integer cents: '0' when either figure is
 * null or the denominator is 0 (the sheet stored 0), so recorded and migrated rows share one rule.
 */
export function sheetRatio(gainCents: Cents | null, valueCents: Cents | null): string {
  if (gainCents === null || valueCents === null) return '0';
  const g = checkCents(gainCents, 'gain');
  const den = checkCents(valueCents, 'value') - g;
  return den === 0 ? '0' : ratioString(decN(g).div(den));
}

/** The kind of each movement column (History E, I, M, AI). */
const MOVEMENT_KIND = {
  stocksMovementsCents: 'stock',
  etfMovementsCents: 'etf',
  cryptoMovementsCents: 'crypto',
  mfMovementsCents: 'managed_fund',
} as const satisfies Readonly<Record<string, InstrumentKind>>;

/** The movement window of a snapshot: (previous run date, run date], else the month before it. */
function movementWindow(runDate: IsoDate, previousRunDate: IsoDate | null): PurchaseWindow {
  return { after: previousRunDate ?? addMonthsIso(runDate, -1), through: runDate };
}

/** Σ units × price of `trades` over each window (the Stage 2 `netPurchases`). */
function movementsOver(
  trades: readonly EngineTrade[],
  windows: readonly PurchaseWindow[],
): Cents[] {
  return netPurchases({ trades, windows });
}

/**
 * §2.5: the derived columns of a figure set. D, H, L, P, T, AE, AH = the sheet ratio of their own
 * row's cents; O = N − the previous N (null for the first snapshot or when either is null);
 * Z = X + AB + linked offsets (D67; migrated rows have none, so Z = X + AB as the sheet), null only
 * when X and AB are both null.
 */
export function deriveSnapshotColumns(i: {
  figures: SnapshotFigures;
  previousCashValueCents: Cents | null | undefined;
}): DerivedSnapshotColumns {
  const f = i.figures;
  const n = f.cashValueCents;
  const prev = i.previousCashValueCents;
  const cashGainCents =
    n === null || prev === null || prev === undefined
      ? null
      : checkCents(n, 'cash') - checkCents(prev, 'previous cash');
  const x = f.propertyValueCents;
  const ab = f.mortgageBalanceCents;
  const propertyEquityCents =
    x === null && ab === null ? null : (x ?? 0) + (ab ?? 0) + (f.mortgageOffsetCents ?? 0);
  return {
    stocksGainRatio: sheetRatio(f.stocksGainCents, f.stocksValueCents),
    etfGainRatio: sheetRatio(f.etfGainCents, f.etfValueCents),
    cryptoGainRatio: sheetRatio(f.cryptoGainCents, f.cryptoValueCents),
    cashGainCents,
    cashIncreaseRatio: sheetRatio(cashGainCents, n),
    superGainRatio: sheetRatio(f.superGainCents, f.superValueCents),
    propertyEquityCents,
    propertyGainRatio: sheetRatio(f.propertyGainCents, f.propertyValueCents),
    mfGainRatio: sheetRatio(f.mfGainCents, f.mfValueCents),
  };
}

/**
 * §2.4: every History column for `periodMonth` at `runDate` from the Stage 2–4 results, then the
 * derived columns by `deriveSnapshotColumns` (so a recorded row's stored derived columns agree
 * with its inputs by construction). U and V are 0 (D2); W is the pay settings' monthly salary; the
 * extras are the offset total, the linked offsets, the accounts in debit and the super cut-off.
 */
export function composeSnapshot(input: ComposeSnapshotInput): SnapshotFigures {
  const previousRun = input.previous?.runDate ?? null;
  const window = movementWindow(input.runDate, previousRun);
  const movement = (kind: InstrumentKind): Cents =>
    movementsOver(input.trades[kind] ?? [], [window])[0]!;
  const summary = (kind: InstrumentKind) => input.investments[kind].summary;
  const a = input.assets;
  let cashDebtCents = 0;
  for (const acc of input.cashAccounts) {
    const balance = checkCents(acc.balanceCents, `account ${acc.id} balance`);
    if (!acc.isOffset && balance < 0) cashDebtCents += balance;
  }
  const figures: SnapshotFigures = {
    stocksValueCents: summary('stock').valueCents,
    stocksGainCents: summary('stock').totalReturnCents,
    stocksGainRatio: null,
    stocksMovementsCents: movement('stock'),
    etfValueCents: summary('etf').valueCents,
    etfGainCents: summary('etf').totalReturnCents,
    etfGainRatio: null,
    etfMovementsCents: movement('etf'),
    cryptoValueCents: summary('crypto').valueCents,
    cryptoGainCents: summary('crypto').totalReturnCents,
    cryptoGainRatio: null,
    cryptoMovementsCents: movement('crypto'),
    cashValueCents: input.cash.totalCashCents,
    cashGainCents: null,
    cashIncreaseRatio: null,
    superValueCents: a.superValueCents,
    superContribCents: a.superContribCents,
    superGainCents: a.superGainCents,
    superGainRatio: null,
    liabilitiesBalanceCents: 0,
    liabilitiesPaidCents: 0,
    salaryMonthlyCents: input.salaryMonthlyCents,
    propertyValueCents: a.propertyValueCents,
    propertyPurchaseCents: a.propertyPurchaseCents,
    propertyEquityCents: null,
    propertyGainCents: a.propertyGainCents,
    mortgageBalanceCents: a.mortgageBalanceCents,
    mortgageInterestFeesCents: a.mortgageInterestFeesCents,
    mortgagePrincipalPaidCents: a.mortgagePrincipalPaidCents,
    propertyGainRatio: null,
    mfValueCents: summary('managed_fund').valueCents,
    mfGainCents: summary('managed_fund').totalReturnCents,
    mfGainRatio: null,
    mfMovementsCents: movement('managed_fund'),
    otherValueCents: a.otherValueCents,
    otherGainCents: a.otherGainCents,
    offsetCents: input.cash.offsetCents,
    mortgageOffsetCents: a.mortgageOffsetCents,
    cashDebtCents: cashDebtCents === 0 ? 0 : cashDebtCents,
    superMeasuredThrough: input.superMeasuredThrough,
  };
  return {
    ...figures,
    ...deriveSnapshotColumns({
      figures,
      previousCashValueCents: input.previous === null ? undefined : input.previous.cashValueCents,
    }),
  };
}

// ─── Checks (§2.5) ──────────────────────────────────────────────────────────────────────────────

/** The ratio columns with their gain and value columns (also `aggregateSnapshots`'s recomputation). */
export const RATIO_CHECKS = {
  stocksGainRatio: ['stocksGainCents', 'stocksValueCents'],
  etfGainRatio: ['etfGainCents', 'etfValueCents'],
  cryptoGainRatio: ['cryptoGainCents', 'cryptoValueCents'],
  cashIncreaseRatio: ['cashGainCents', 'cashValueCents'],
  superGainRatio: ['superGainCents', 'superValueCents'],
  propertyGainRatio: ['propertyGainCents', 'propertyValueCents'],
  mfGainRatio: ['mfGainCents', 'mfValueCents'],
} as const satisfies Readonly<
  Record<string, readonly [keyof SnapshotFigures, keyof SnapshotFigures]>
>;
export type RatioColumn = keyof typeof RATIO_CHECKS;

function isRatioColumn(column: string): column is RatioColumn {
  return Object.hasOwn(RATIO_CHECKS, column);
}

/**
 * A stored ratio `r` of gain `g` and value `v` (cents) matches when `v − g = 0` and `r = 0`, or when
 * `|r × (v − g) − g| ≤ 1 + |r|`. With `g` or `v` null the sheet stored 0 (or the cell was blank):
 * `r` matches when it is 0 or null. Otherwise a null `r` never matches.
 */
export function ratioMatches(
  stored: string | null,
  gainCents: Cents | null,
  valueCents: Cents | null,
): boolean {
  if (gainCents === null || valueCents === null)
    return stored === null || dec(stored, 'ratio').isZero();
  if (stored === null) return false;
  const r = dec(stored, 'ratio');
  const den = valueCents - gainCents;
  if (den === 0) return r.isZero();
  return r.times(den).minus(gainCents).abs().lessThanOrEqualTo(r.abs().plus(1));
}

/** Money cells (O, Z, movements): within 1 cent; a null matches a null only. */
function centsMatch(stored: Cents | null, recomputed: Cents | null): boolean {
  if (stored === null || recomputed === null) return stored === recomputed;
  return Math.abs(stored - recomputed) <= 1;
}

/**
 * §2.5: for every snapshot (run-date order), each derived column against its recomputation from
 * the row's stored cents (`derived`; the first snapshot's O is a seed and is not checked), and each
 * movement column against the net purchases of the kind's trades over the snapshot's window
 * (`movement`; the first snapshot's window is the month before its run date).
 */
export function checkSnapshots(i: {
  snapshots: readonly EngineSnapshot[];
  trades: Readonly<Record<InstrumentKind, readonly EngineTrade[]>>;
}): SnapshotCheckResult {
  const sorted = sortByRunDate(i.snapshots);
  const windows = sorted.map((s, k) =>
    movementWindow(s.runDate, k === 0 ? null : sorted[k - 1]!.runDate),
  );
  const movements = new Map<InstrumentKind, Cents[]>(
    INSTRUMENT_KINDS.map((kind) => [kind, movementsOver(i.trades[kind] ?? [], windows)]),
  );
  let checked = 0;
  let matched = 0;
  const rows = sorted.map((s, k) => {
    const derived = deriveSnapshotColumns({
      figures: s,
      previousCashValueCents: k === 0 ? undefined : sorted[k - 1]!.cashValueCents,
    });
    const differences: SnapshotDifference[] = [];
    let rowChecked = 0;
    const record = (ok: boolean, diff: SnapshotDifference) => {
      rowChecked += 1;
      if (ok) matched += 1;
      else differences.push(diff);
    };
    for (const column of SNAPSHOT_CHECK_COLUMNS) {
      if (isRatioColumn(column)) {
        const [gain, value] = RATIO_CHECKS[column];
        const stored = s[column];
        record(ratioMatches(stored, s[gain], s[value]), {
          column,
          kind: 'derived',
          storedCents: null,
          recomputedCents: null,
          storedRatio: stored,
          recomputedRatio: derived[column],
        });
      } else if (column === 'cashGainCents' || column === 'propertyEquityCents') {
        if (column === 'cashGainCents' && k === 0) continue; // the first O is a seed (§9.3 rule 1)
        record(centsMatch(s[column], derived[column]), {
          column,
          kind: 'derived',
          storedCents: s[column],
          recomputedCents: derived[column],
          storedRatio: null,
          recomputedRatio: null,
        });
      } else {
        const kind = MOVEMENT_KIND[column];
        const stored = s[column];
        const recomputed = movements.get(kind)![k]!;
        record(centsMatch(stored, recomputed), {
          column,
          kind: 'movement',
          storedCents: stored,
          recomputedCents: recomputed,
          storedRatio: null,
          recomputedRatio: null,
        });
      }
    }
    checked += rowChecked;
    return {
      periodMonth: s.periodMonth,
      runDate: s.runDate,
      source: s.source,
      checked: rowChecked,
      differences,
    };
  });
  return { checked, matched, rows };
}
