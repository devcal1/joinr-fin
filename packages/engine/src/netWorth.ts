// Net worth (stage-5.md §2.6; D67, D83, D93; §11 fixes 1–3, 7, 8, 17): the breakdown of any figure
// set, the dashboard (classes, liabilities, changes, the distribution, the gauge and the averages),
// and the rolling table with a projection. Every dashboard figure comes from the figure set, so the
// page adds up for any snapshot: assets − liabilities = net worth by construction.
import {
  monthEndOf,
  NET_WORTH_STACK_ORDER,
  type IsoDate,
  type IsoMonth,
  type NetWorthClass,
} from '@joinr/schema';
import { checkCents, decN, ratioString } from './num';
import { nextMonth, sortByRunDate, yearWindow } from './periods';
import type {
  Cents,
  EngineSnapshot,
  NetWorthBreakdown,
  NetWorthChange,
  NetWorthClassRow,
  NetWorthDashboardInput,
  NetWorthDashboardResult,
  NetWorthLiabilityRow,
  RollingNetWorthInput,
  RollingNetWorthRow,
  SnapshotFigures,
} from './types';

/** The value columns the breakdown sums; a null counts 0 and is named in `missing`. */
const BREAKDOWN_COLUMNS = [
  'stocksValueCents',
  'etfValueCents',
  'cryptoValueCents',
  'cashValueCents',
  'superValueCents',
  'liabilitiesBalanceCents',
  'propertyValueCents',
  'mortgageBalanceCents',
  'mfValueCents',
  'otherValueCents',
] as const satisfies readonly (keyof SnapshotFigures)[];

/** 0 for null (the sheet's blank behaves as 0 in its sums); never −0. */
const z = (c: Cents | null): Cents => (c === null ? 0 : checkCents(c));
const clean = (c: Cents): Cents => (c === 0 ? 0 : c);

/** gain ÷ (value − gain); null when the gain is null or the denominator 0 (a dashboard ratio). */
function gainRatio(gainCents: Cents | null, valueCents: Cents): string | null {
  if (gainCents === null) return null;
  const den = valueCents - gainCents;
  return den === 0 ? null : ratioString(decN(gainCents).div(den));
}

/**
 * §2.6 step 1: liquid = B + F + J + N + AF + AJ; super = Q; property = X; liabilities = −|U| − |AB|;
 * offsets = every offset account; net worth = their Σ (for a migrated row, the sheet's P).
 */
export function netWorthOf(f: SnapshotFigures): NetWorthBreakdown {
  const liquidCents = clean(
    z(f.stocksValueCents) +
      z(f.etfValueCents) +
      z(f.cryptoValueCents) +
      z(f.cashValueCents) +
      z(f.mfValueCents) +
      z(f.otherValueCents),
  );
  const superCents = z(f.superValueCents);
  const propertyCents = z(f.propertyValueCents);
  const liabilitiesCents = clean(
    -(Math.abs(z(f.liabilitiesBalanceCents)) + Math.abs(z(f.mortgageBalanceCents))),
  );
  const offsetsCents = z(f.offsetCents);
  return {
    liquidCents,
    superCents,
    propertyCents,
    liabilitiesCents,
    offsetsCents,
    netWorthCents: clean(
      liquidCents + superCents + propertyCents + liabilitiesCents + offsetsCents,
    ),
    missing: BREAKDOWN_COLUMNS.filter((k) => f[k] === null),
  };
}

/** live − base; ratio = cents ÷ |base| (null when the base is 0 or missing). */
function changeFrom(netWorthCents: Cents, base: EngineSnapshot | null): NetWorthChange {
  if (base === null) return { base: null, cents: null, ratio: null };
  const baseCents = netWorthOf(base).netWorthCents;
  const cents = clean(netWorthCents - baseCents);
  return {
    base: { periodMonth: base.periodMonth, runDate: base.runDate, netWorthCents: baseCents },
    cents,
    ratio: baseCents === 0 ? null : ratioString(decN(cents).div(Math.abs(baseCents))),
  };
}

/** §2.6 steps 2–6: the dashboard of `live` (and the snapshots for the changes). */
export function netWorthDashboard(input: NetWorthDashboardInput): NetWorthDashboardResult {
  const f = input.live;
  const breakdown = netWorthOf(f);
  const offsets = breakdown.offsetsCents;
  // The uncapped Σ of the offsets linked to property loans (inside Z) and the part that actually
  // nets the mortgages (capped in aggregate; per-loan capping is display only).
  const linked = z(f.mortgageOffsetCents);
  const grossMortgage = Math.abs(z(f.mortgageBalanceCents));
  const applied = Math.max(0, Math.min(linked, grossMortgage));
  const cashDebt = Math.min(0, z(f.cashDebtCents));

  // Step 2: the classes (NET_WORTH_CLASSES order), every one kept.
  const cls = (
    key: NetWorthClass,
    valueCents: Cents,
    gainCents: Cents | null,
  ): NetWorthClassRow => ({
    key,
    valueCents: clean(valueCents),
    gainCents,
    gainRatio: gainRatio(gainCents, valueCents),
  });
  const classes: NetWorthClassRow[] = [
    cls('etf', z(f.etfValueCents), f.etfGainCents),
    cls('stock', z(f.stocksValueCents), f.stocksGainCents),
    cls('managed_fund', z(f.mfValueCents), f.mfGainCents),
    cls('crypto', z(f.cryptoValueCents), f.cryptoGainCents),
    cls('cash', z(f.cashValueCents) - cashDebt, null),
    cls('offsets', offsets - applied, null),
    cls('other_assets', z(f.otherValueCents), f.otherGainCents),
    cls('super', z(f.superValueCents), f.superGainCents),
    cls('property', z(f.propertyValueCents), f.propertyGainCents),
  ];

  // Step 3: the liabilities (NET_WORTH_LIABILITIES order), every one kept.
  const liabilities: NetWorthLiabilityRow[] = [
    {
      key: 'mortgages',
      balanceCents: clean(grossMortgage - applied),
      grossCents: grossMortgage,
      offsetCents: applied,
    },
    {
      key: 'cash_debit',
      balanceCents: clean(-cashDebt),
      grossCents: clean(-cashDebt),
      offsetCents: 0,
    },
    {
      key: 'other_debts',
      balanceCents: Math.abs(z(f.liabilitiesBalanceCents)),
      grossCents: Math.abs(z(f.liabilitiesBalanceCents)),
      offsetCents: 0,
    },
  ];
  const assetsCents = classes.reduce((s, c) => s + c.valueCents, 0);
  const liabilitiesCents = liabilities.reduce((s, l) => s + l.balanceCents, 0);
  const superClass = classes.find((c) => c.key === 'super')!.valueCents;

  // Step 4: the changes. Since the last record: the latest snapshot run before asOf. This year: the
  // latest snapshot whose period month ends before the year starts (D29: the period rule).
  const sorted = sortByRunDate(input.snapshots);
  const lastBefore = sorted.filter((s) => s.runDate < input.asOf).at(-1) ?? null;
  const year = yearWindow(input.asOf, input.kpis.year.basis);
  const yearBase = sorted.filter((s) => monthEndOf(s.periodMonth) < year.start).at(-1) ?? null;

  // Step 6: the distribution: net values in NET_WORTH_STACK_ORDER; cash is net cash plus the
  // offsets not inside equity; property is net equity (Z). Σ values = net worth + |U|.
  const netValue: Readonly<Record<(typeof NET_WORTH_STACK_ORDER)[number], Cents>> = {
    stock: z(f.stocksValueCents),
    etf: z(f.etfValueCents),
    crypto: z(f.cryptoValueCents),
    cash: z(f.cashValueCents) + offsets - linked,
    managed_fund: z(f.mfValueCents),
    other_assets: z(f.otherValueCents),
    super: z(f.superValueCents),
    property: z(f.propertyEquityCents),
  };
  const values = NET_WORTH_STACK_ORDER.map((key) => ({ key, valueCents: clean(netValue[key]) }));
  const drawn = values.filter((v) => v.valueCents > 0);
  const drawnCents = drawn.reduce((s, v) => s + v.valueCents, 0);

  const kpis = input.kpis;
  return {
    breakdown,
    assetsCents,
    liabilitiesCents,
    classes,
    liabilities,
    assetsExSuperCents: assetsCents - superClass,
    sinceLastRecord: changeFrom(breakdown.netWorthCents, lastBefore),
    thisYear: { ...changeFrom(breakdown.netWorthCents, yearBase), year },
    distribution: {
      values,
      slices: drawn.map((v) => ({
        key: v.key,
        valueCents: v.valueCents,
        ratio: ratioString(decN(v.valueCents).div(drawnCents)),
      })),
      excluded: values.filter((v) => v.valueCents < 0),
      drawnCents,
    },
    savingsRate: {
      ratio: kpis.yearSavingsRatio,
      rawRatio: kpis.yearSavingsRawRatio,
      year: kpis.year,
      periods: kpis.yearPeriods,
      targetRatio: input.plannedSavingsRatio,
    },
    averageSavings: {
      monthCents: kpis.avgSavingsCents,
      yearCents: kpis.avgSavingsCents === null ? null : kpis.avgSavingsCents * 12,
      periods: kpis.avgWindow?.periods ?? 0,
    },
    allocation: input.considerNext,
  };
}

/**
 * §2.6 step 7 (the sheet's K:U): one row per snapshot (run-date order), the live row, then the
 * projected months after it (only with an average): growth and liquid growth vs the previous row,
 * the savings period of the same month, and liquid projected at `monthlyCents` a month (§11 fix 8).
 */
export function rollingNetWorth(input: RollingNetWorthInput): RollingNetWorthRow[] {
  const byMonth = new Map(input.savings.map((p) => [p.periodMonth, p]));
  const data: {
    periodMonth: IsoMonth;
    runDate: IsoDate;
    status: 'recorded' | 'live';
    source: EngineSnapshot['source'] | null;
    breakdown: NetWorthBreakdown;
  }[] = sortByRunDate(input.snapshots).map((s) => ({
    periodMonth: s.periodMonth,
    runDate: s.runDate,
    status: 'recorded',
    source: s.source,
    breakdown: netWorthOf(s),
  }));
  if (input.live !== null) {
    data.push({
      periodMonth: input.live.periodMonth,
      runDate: input.live.runDate,
      status: 'live',
      source: null,
      breakdown: netWorthOf(input.live.figures),
    });
  }
  const rows: RollingNetWorthRow[] = data.map((d, k) => {
    const prev = k === 0 ? null : data[k - 1]!.breakdown;
    const period = byMonth.get(d.periodMonth);
    return {
      periodMonth: d.periodMonth,
      runDate: d.runDate,
      status: d.status,
      source: d.source,
      breakdown: d.breakdown,
      growthCents: prev === null ? null : clean(d.breakdown.netWorthCents - prev.netWorthCents),
      liquidGrowthCents: prev === null ? null : clean(d.breakdown.liquidCents - prev.liquidCents),
      savingsRatio: period?.adjusted.savingsRatio ?? null,
      rawSavingsRatio: period?.raw.savingsRatio ?? null,
      projectedLiquidCents: d.breakdown.liquidCents,
    };
  });
  const last = data.at(-1);
  const monthly = input.projection.monthlyCents;
  if (last !== undefined && monthly !== null) {
    checkCents(monthly, 'projection');
    let month = last.periodMonth;
    for (let k = 1; k <= input.projection.months; k++) {
      month = nextMonth(month);
      rows.push({
        periodMonth: month,
        runDate: null,
        status: 'projected',
        source: null,
        breakdown: null,
        growthCents: null,
        liquidGrowthCents: null,
        savingsRatio: null,
        rawSavingsRatio: null,
        projectedLiquidCents: last.breakdown.liquidCents + k * monthly,
      });
    }
  }
  return rows;
}
