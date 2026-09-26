// Chart data (stage-2.md §5): market value, gain $ and % from the snapshots, cumulative
// contributions and net purchases from the engine (so corrections, in-app trades and exited
// instruments count), plus a live point when no snapshot exists for the as-of month. Points are
// compressed with the engine's `compressSeries` (charts.dateUnit, charts.unitCount). Stage 5
// (stage-5.md §11 fix 5, D52): the yearly unit groups financial years, as every other chart.
import type { SeriesPoint } from '@joinr/engine';
import {
  isoMonthOf,
  normaliseDecimal,
  type DecimalString,
  type InstrumentKind,
  type InvestmentChartsDto,
  type IsoDate,
} from '@joinr/schema';
import { chartDateUnitSetting, numberSetting } from '../db/queries/settings';
import type { InvestmentsContext } from './context';
import { ratioOf } from './format';
import { toEngineDividend, toEngineTrade, type SnapshotRow } from './load';

/** The snapshot columns of each kind (History B–D, F–H, J–L, AF–AH). */
const SNAPSHOT_COLUMNS: Readonly<
  Record<
    InstrumentKind,
    {
      value: 'stocksValueCents' | 'etfValueCents' | 'cryptoValueCents' | 'mfValueCents';
      gain: 'stocksGainCents' | 'etfGainCents' | 'cryptoGainCents' | 'mfGainCents';
      ratio: 'stocksGainRatio' | 'etfGainRatio' | 'cryptoGainRatio' | 'mfGainRatio';
    }
  >
> = {
  stock: { value: 'stocksValueCents', gain: 'stocksGainCents', ratio: 'stocksGainRatio' },
  etf: { value: 'etfValueCents', gain: 'etfGainCents', ratio: 'etfGainRatio' },
  crypto: { value: 'cryptoValueCents', gain: 'cryptoGainCents', ratio: 'cryptoGainRatio' },
  managed_fund: { value: 'mfValueCents', gain: 'mfGainCents', ratio: 'mfGainRatio' },
};

/** The compress mode of each series key; `idx` carries the source point (for the gain %). */
const MODES = {
  value: 'end',
  contributions: 'end',
  gain: 'end',
  purchases: 'sum',
  idx: 'end',
} as const;

/** Gain % as History D/H/L/AH define it: gain / (value − gain); null when that is 0. */
export function liveGainRatio(valueCents: number, gainCents: number): DecimalString | null {
  return ratioOf(gainCents, valueCents - gainCents);
}

const safeRatio = (v: string | null): DecimalString | null => {
  if (v === null) return null;
  try {
    return normaliseDecimal(v);
  } catch {
    return null;
  }
};

export function buildCharts(ctx: InvestmentsContext, kind: InstrumentKind): InvestmentChartsDto {
  const s = ctx.data.settings;
  const unit = chartDateUnitSetting(s) ?? 'monthly';
  const count = numberSetting(s, 'charts.unitCount');
  const rows = ctx.rows(kind);
  const snaps: SnapshotRow[] = ctx.data.snapshots;

  // No history and nothing ever traded: no points (the chart shows its empty state).
  if (snaps.length === 0 && rows.trades.length === 0) return { unit, count, points: [] };

  const cols = SNAPSHOT_COLUMNS[kind];
  const live = !snaps.some((sn) => sn.periodMonth === isoMonthOf(ctx.asOf));
  const runDates: IsoDate[] = snaps.map((sn) => sn.runDate);
  const trades = rows.trades.map(toEngineTrade);
  const dividends = rows.dividends.map(toEngineDividend);

  const contributions = ctx.engine.contributionsAt({
    kind,
    trades,
    dividends,
    dates: live ? [...runDates, ctx.asOf] : runDates,
  });
  const windows = ctx.engine.purchaseWindows(runDates, live ? ctx.asOf : null);
  const purchases = ctx.engine.netPurchases({ trades, windows });

  const ratios: (DecimalString | null)[] = [];
  const points: SeriesPoint[] = snaps.map((sn, i) => {
    ratios.push(safeRatio(sn[cols.ratio]));
    return {
      period: sn.periodMonth,
      date: sn.runDate,
      live: false,
      values: {
        value: sn[cols.value],
        gain: sn[cols.gain],
        contributions: contributions[i] ?? null,
        purchases: purchases[i] ?? null,
        idx: i,
      },
    };
  });
  if (live) {
    const summary = ctx.compute(kind).summary;
    const i = points.length;
    ratios.push(liveGainRatio(summary.valueCents, summary.totalReturnCents));
    points.push({
      period: isoMonthOf(ctx.asOf),
      date: ctx.asOf,
      live: true,
      values: {
        value: summary.valueCents,
        gain: summary.totalReturnCents,
        contributions: contributions[i] ?? null,
        purchases: purchases[i] ?? null,
        idx: i,
      },
    });
  }
  points.sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));

  const compressed = ctx.engine.compressSeries(points, unit, count, MODES, 'fy');
  return {
    unit,
    count,
    points: compressed.map((p) => {
      const idx = p.values.idx;
      return {
        label: p.label,
        period: p.period,
        date: p.date,
        live: p.live,
        valueCents: p.values.value ?? null,
        contributionsCents: p.values.contributions ?? null,
        gainCents: p.values.gain ?? null,
        gainRatio: typeof idx === 'number' ? (ratios[idx] ?? null) : null,
        netPurchasesCents: p.values.purchases ?? null,
      };
    }),
  };
}
