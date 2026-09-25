// Golden-only helpers (stage-2.md §9.1): the sheet's simple est. return, the "$N/month" parser and
// the recomputed priced totals of §9.3 rules 1 and 5. They read the sheet's own ledger cells.
import type { InstrumentKind, IsoDate } from '@joinr/schema';
import type { Sheet } from './adapter';
import { serialOf } from './adapter';

/** One remaining parcel: its date, order price and remaining units. */
export interface WeightedLot {
  date: IsoDate;
  price: number;
  remaining: number;
}

/**
 * The sheet's simple est. return: pct / (asOf − floor(Σ(date × price × remaining) / Σ(price ×
 * remaining))) days × 365 (DATEDIF floors the cost-weighted average date).
 */
export function simpleEstReturn(
  pct: number,
  lots: readonly WeightedLot[],
  asOf: IsoDate,
): number | null {
  let num = 0;
  let den = 0;
  for (const l of lots) {
    if (!(l.remaining > 0)) continue;
    const w = l.price * l.remaining;
    num += serialOf(l.date) * w;
    den += w;
  }
  if (den === 0) return null;
  const days = serialOf(asOf) - Math.floor(num / den);
  return days === 0 ? null : (pct / days) * 365;
}

/** `"$615/month"` → 61500 cents (whole dollars); null for anything else. */
export function parseMonthlyRate(text: string | null): number | null {
  const m = text === null ? null : /^\$(-?\d+)\/month$/.exec(text.trim());
  return m ? Number(m[1]) * 100 : null;
}

export interface PricedTotals {
  /** Σ D × L + Σ E × L / C over the priced holdings' remaining lots. */
  cost: number;
  costBySymbol: Map<string, number>;
  /** δ = E × (C − L) / C per partly-sold lot with a fee (§9.3 rule 5), by ledger row. */
  deltaByRow: Map<number, number>;
  deltaBySymbol: Map<string, number>;
  deltaTotal: number;
  /** The priced holdings' remaining lots, for the simple est. return. */
  lots: WeightedLot[];
}

/**
 * Totals recomputed from the sheet's own ledger cells over the priced holdings' lots (§9.3 rules 1
 * and 5): the cost with the buy fees pro-rated, and the δ of each partly-sold lot with a fee.
 */
export function recomputedPricedTotals(sheet: Sheet, kind: InstrumentKind): PricedTotals {
  const t = sheet.tab(kind);
  const l = t.layout;
  const priced = new Set(t.watch.filter((w) => w.price !== null).map((w) => w.symbol));
  const out: PricedTotals = {
    cost: 0,
    costBySymbol: new Map(),
    deltaByRow: new Map(),
    deltaBySymbol: new Map(),
    deltaTotal: 0,
    lots: [],
  };
  for (const x of t.ledger) {
    if (x.units <= 0) continue;
    const remaining = sheet.wb.number(l.sheet, `${l.ledger.remaining}${x.row}`) ?? 0;
    const sold = x.units - remaining;
    const delta = x.fee !== 0 && remaining > 0 && sold > 0 ? (x.fee * sold) / x.units : 0;
    if (delta !== 0) out.deltaByRow.set(x.row, delta);
    if (!priced.has(x.symbol) || !(remaining > 0)) continue;
    const cost = x.price * remaining + (x.fee * remaining) / x.units;
    out.cost += cost;
    out.costBySymbol.set(x.symbol, (out.costBySymbol.get(x.symbol) ?? 0) + cost);
    out.deltaBySymbol.set(x.symbol, (out.deltaBySymbol.get(x.symbol) ?? 0) + delta);
    out.deltaTotal += delta;
    out.lots.push({ date: x.date, price: x.price, remaining });
  }
  return out;
}
