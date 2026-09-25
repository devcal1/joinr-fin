// History functions (stage-2.md §2.11): cumulative contributions, net purchases per snapshot
// window, the windows themselves and the period compressor (Stage 5 reuses it).
import { addMonthsIso, type ChartDateUnit, type InstrumentKind, type IsoDate } from '@joinr/schema';
import { centsOf, dayNumber, dec, dollarsOf, sum, type Dec } from './num';
import type {
  Cents,
  CompressedPoint,
  EngineDividend,
  EngineTrade,
  PurchaseWindow,
  SeriesPoint,
} from './types';

function orderValue(t: EngineTrade): Dec {
  return dec(t.units, `trade ${t.id} units`).times(dec(t.price, `trade ${t.id} price`));
}

/**
 * The cumulative net money invested at each date: Σ units × price (signed, fees excluded) of trades
 * dated ≤ the date, minus Σ net of the kind's reinvested (DRP) positive dividends paid ≤ the date.
 * Every trade given counts, exited instruments included (§11 fix 2).
 */
export function contributionsAt(i: {
  kind: InstrumentKind;
  trades: readonly EngineTrade[];
  dividends: readonly EngineDividend[];
  dates: readonly IsoDate[];
}): Cents[] {
  const flows = i.trades.map((t) => ({ day: dayNumber(t.tradeDate), value: orderValue(t) }));
  const drp = i.dividends
    .filter((d) => d.holdingKind === i.kind && d.reinvested === true && d.netAmountCents > 0)
    .map((d) => ({ day: dayNumber(d.paymentDate), value: dollarsOf(d.netAmountCents) }));
  return i.dates.map((date) => {
    const day = dayNumber(date);
    const invested = sum(flows.filter((f) => f.day <= day).map((f) => f.value));
    const reinvested = sum(drp.filter((d) => d.day <= day).map((d) => d.value));
    return centsOf(invested.minus(reinvested));
  });
}

/** Σ units × price (sells negative) per window `(after, through]` (History E, I, M, AI). */
export function netPurchases(i: {
  trades: readonly EngineTrade[];
  windows: readonly PurchaseWindow[];
}): Cents[] {
  const flows = i.trades.map((t) => ({ day: dayNumber(t.tradeDate), value: orderValue(t) }));
  return i.windows.map((w) => {
    const after = w.after === null ? -Infinity : dayNumber(w.after);
    const through = dayNumber(w.through);
    return centsOf(sum(flows.filter((f) => f.day > after && f.day <= through).map((f) => f.value)));
  });
}

/**
 * Snapshot windows `(previous run date, run date]`, the first `(run date − 1 month, run date]`
 * (the Stage 1 movement rule), plus a live window `(last run date, liveThrough]` when set. With no
 * run dates, one window `(null, liveThrough]`. Run dates are taken in ascending order.
 */
export function purchaseWindows(
  runDates: readonly IsoDate[],
  liveThrough: IsoDate | null,
): PurchaseWindow[] {
  const dates = [...runDates].sort();
  for (const d of dates) dayNumber(d);
  if (liveThrough !== null) dayNumber(liveThrough);
  const windows: PurchaseWindow[] = dates.map((through, index) => ({
    after: index === 0 ? addMonthsIso(through, -1) : dates[index - 1]!,
    through,
  }));
  if (liveThrough !== null) {
    windows.push({
      after: dates.length === 0 ? null : dates[dates.length - 1]!,
      through: liveThrough,
    });
  }
  return windows;
}

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** The template's compressTable defaults: 12 monthly, 8 quarterly, all yearly. */
const DEFAULT_COUNTS: Readonly<Record<ChartDateUnit, number | null>> = {
  monthly: 12,
  quarterly: 8,
  yearly: null,
};

function periodKey(period: string, unit: ChartDateUnit): { key: string; label: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) throw new RangeError(`compressSeries: expected a month written YYYY-MM: ${period}`);
  const year = m[1]!;
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw new RangeError(`compressSeries: not a month: ${period}`);
  switch (unit) {
    case 'monthly':
      return { key: period, label: `${MONTH_LABELS[month - 1]!} ${year}` };
    case 'quarterly': {
      const q = Math.floor((month - 1) / 3) + 1;
      return { key: `${year}-Q${q}`, label: `Q${q} ${year}` };
    }
    case 'yearly':
      return { key: year, label: year };
  }
}

/**
 * Groups points by period (monthly, calendar quarter or calendar year) and keeps the last `count`
 * groups (null → 12 monthly, 8 quarterly, all yearly). Each value key uses its mode: `end` (the
 * group's last point's value) or `sum` (the Σ of the non-null values; null when all are null).
 * Keys without a mode use `end`. A group takes its last point's period, date and live flag.
 */
export function compressSeries(
  points: readonly SeriesPoint[],
  unit: ChartDateUnit,
  count: number | null,
  modes: Readonly<Record<string, 'end' | 'sum'>>,
): CompressedPoint[] {
  const sorted = points
    .map((p, index) => ({ p, index }))
    .sort(
      (a, b) =>
        (a.p.period < b.p.period ? -1 : a.p.period > b.p.period ? 1 : 0) ||
        (a.p.date < b.p.date ? -1 : a.p.date > b.p.date ? 1 : 0) ||
        a.index - b.index,
    )
    .map((x) => x.p);
  const keys = new Set<string>(Object.keys(modes));
  for (const p of sorted) for (const k of Object.keys(p.values)) keys.add(k);

  const groups: { key: string; label: string; points: SeriesPoint[] }[] = [];
  for (const p of sorted) {
    const { key, label } = periodKey(p.period, unit);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.points.push(p);
    else groups.push({ key, label, points: [p] });
  }

  const n = count ?? DEFAULT_COUNTS[unit];
  const kept = n === null ? groups : groups.slice(Math.max(0, groups.length - Math.max(0, n)));
  return kept.map((g) => {
    const last = g.points[g.points.length - 1]!;
    const values: Record<string, number | null> = {};
    for (const k of keys) {
      if ((modes[k] ?? 'end') === 'sum') {
        const present = g.points
          .map((p) => p.values[k])
          .filter((v): v is number => v !== null && v !== undefined);
        values[k] = present.length === 0 ? null : present.reduce((a, b) => a + b, 0);
      } else {
        values[k] = last.values[k] ?? null;
      }
    }
    return { label: g.label, period: last.period, date: last.date, live: last.live, values };
  });
}
