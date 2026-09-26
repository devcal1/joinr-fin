// The investment fixtures (stage-2.md §3.4) are internally consistent (ids, sums, counts,
// statuses) and cover every state the pages render.
import { describe, expect, it } from 'vitest';
import {
  API_ERROR_CODES,
  ASSET_CLASSES,
  CONSIDER_REASONS,
  COUNTDOWN_STATES,
  compareDecimals,
  financialYearOfIso,
  HOLDING_FLAGS,
  HOLDING_STATUSES,
  INSTRUMENT_KINDS,
  isApiErrorBody,
  makeTradeInputSchema,
  sumDecimals,
  type AssetClass,
  type InstrumentKind,
  type InvestmentPageResponse,
} from '../src/index';
import * as f from '../src/fixtures/index';

const CLASS_OF: Record<InstrumentKind, AssetClass> = {
  stock: 'stock',
  etf: 'etf',
  managed_fund: 'managed_fund',
  crypto: 'crypto',
};
const STATUS_ORDER = { held: 0, watching: 1, exited: 2 } as const;
const sum = (values: readonly (number | null)[]): number =>
  values.reduce<number>((s, v) => s + (v ?? 0), 0);
const near = (a: string, b: string): boolean =>
  Math.abs(Number(sumDecimals([a, `-${b}`.replace('--', '')]))) < 1e-9;

describe('coverage', () => {
  it('covers every holding status, flag, countdown state and consider reason', () => {
    expect(new Set(f.FIXTURE_COVERAGE.holdingStatuses)).toEqual(new Set(HOLDING_STATUSES));
    expect(new Set(f.FIXTURE_COVERAGE.holdingFlags)).toEqual(new Set(HOLDING_FLAGS));
    expect(new Set(f.FIXTURE_COVERAGE.countdownStates)).toEqual(new Set(COUNTDOWN_STATES));
    expect(new Set(f.FIXTURE_COVERAGE.considerReasons)).toEqual(new Set(CONSIDER_REASONS));
  });

  it('has a populated and an empty page per kind, and the named states', () => {
    for (const kind of INSTRUMENT_KINDS) {
      expect(f.investmentPages[kind].kind).toBe(kind);
      expect(f.investmentPages[kind].holdings.length).toBeGreaterThan(0);
      expect(f.investmentPageEmpty(kind)).toMatchObject({ kind, holdings: [] });
    }
    expect(f.investmentPageUnpriced.summary).toMatchObject({
      unpricedCount: 1,
      stalePriceCount: 1,
    });
    expect(f.investmentPageAllUnpriced.summary).toMatchObject({ valueCents: 0, xirr: null });
    expect(
      f.investmentPageAllUnpriced.allocation.byHolding.every((s) => s.currentRatio === '0'),
    ).toBe(true);
    const nulls = f.investmentPageNulls;
    expect(nulls.summary.xirr).toBeNull();
    expect(nulls.summary.investmentRatePerMonthCents).toBeNull();
    expect(nulls.timing.budget.emergencyFundCents).toBeNull();
    // A held holding bought only under 90 days before as-of (26/06/2026 is 90 days back), and a
    // watched fully-sold one.
    expect(
      nulls.holdings.some(
        (h) => h.status === 'held' && h.lastBuyDate !== null && h.lastBuyDate >= '2026-06-26',
      ),
    ).toBe(true);
    expect(
      nulls.holdings.some(
        (h) =>
          h.status === 'watching' &&
          h.realisedCents !== 0 &&
          h.dividendsCents > 0 &&
          h.units === '0',
      ),
    ).toBe(true);
    expect(Object.keys(f.investmentPageTiming).sort()).toEqual(
      [
        'below_emergency_fund',
        'cash_deficit',
        'cash_first',
        'invest',
        'no_targets',
        'split_off',
        'unavailable',
        'wait',
      ].sort(),
    );
    expect(f.investmentPageTiming.unavailable.timing.missing.length).toBeGreaterThan(0);
    expect(f.investmentPageTiming.invest.timing.budget.useBudget).toBe(false);
    // D46: the budget drives the amount, its automatic split is off, so the investment row is $0.
    expect(f.investmentPageTiming.split_off.timing).toMatchObject({
      monthlyInvestCents: 0,
      budget: { useBudget: true, investmentRowCents: 0, sideIncomeInvestCents: 0 },
      countdown: { state: 'split_off' },
    });
    // Stage 3: the live budget everywhere; the cash-deficit wait lengthens the countdown.
    for (const page of Object.values(f.investmentPageTiming)) {
      expect(page.timing.budget.source).toBe('live_budget');
      expect(page.timing.deferred).toEqual([]);
    }
    const deficit = f.investmentPageTiming.cash_deficit.timing;
    expect(deficit.cashDeficitMonths).toBeGreaterThan(deficit.plan.months);
    const cash = deficit.considerNext.rows.find((r) => r.assetClass === 'cash')!;
    expect(compareDecimals(cash.currentRatio, cash.targetRatio)).toBe(-1);
  });
});

describe.each(f.allInvestmentPageFixtures.map((p, i) => [`${i}: ${p.kind}`, p] as const))(
  'page fixture %s',
  (_name, page: InvestmentPageResponse) => {
    const held = page.holdings.filter((h) => h.status === 'held');
    const pricedHeld = held.filter((h) => h.valueCents !== null);

    it('lists holdings of its kind: held, then watching, then exited', () => {
      for (const h of page.holdings) expect(h.kind).toBe(page.kind);
      const order = page.holdings.map((h) => STATUS_ORDER[h.status]);
      expect(order).toEqual([...order].sort((a, b) => a - b));
      expect(new Set(page.holdings.map((h) => h.instrumentId)).size).toBe(page.holdings.length);
    });

    it('has statuses and flags that match the units, prices and watch state', () => {
      for (const h of page.holdings) {
        const open = compareDecimals(h.units, '0') > 0;
        expect(h.status === 'held', h.symbol).toBe(open);
        if (h.status === 'watching') expect(h.watched, h.symbol).toBe(true);
        if (h.status === 'exited') expect(h.watched, h.symbol).toBe(false);
        expect(h.flags.includes('unpriced'), h.symbol).toBe(open && h.price.price === null);
        expect(h.flags.includes('unwatched_held'), h.symbol).toBe(open && !h.watched);
        if (h.flags.includes('stale_price')) {
          expect(['stale', 'failed']).toContain(h.price.status);
        }
        if (h.status !== 'held') expect(h.totalReturnCents, h.symbol).toBeNull();
        if (h.valueCents === null) expect(h.totalReturnCents, h.symbol).toBeNull();
      }
    });

    it('sums the summary from the held, priced rows', () => {
      const s = page.summary;
      expect(s.valueCents).toBe(sum(pricedHeld.map((h) => h.valueCents)));
      expect(s.costCents).toBe(sum(pricedHeld.map((h) => h.costCents)));
      expect(s.unrealisedCents).toBe(sum(pricedHeld.map((h) => h.unrealisedCents)));
      expect(s.dividendsHeldCents).toBe(sum(pricedHeld.map((h) => h.dividendsCents)));
      expect(s.totalReturnCents).toBe(sum(pricedHeld.map((h) => h.totalReturnCents)));
      expect(s.realisedCents).toBe(sum(page.holdings.map((h) => h.realisedCents)));
      expect(s.heldCount).toBe(held.length);
      expect(s.watchingCount).toBe(page.holdings.filter((h) => h.status === 'watching').length);
      expect(s.exitedCount).toBe(page.holdings.filter((h) => h.status === 'exited').length);
      expect(s.unpricedCount).toBe(
        page.holdings.filter((h) => h.flags.includes('unpriced')).length,
      );
      expect(s.stalePriceCount).toBe(
        page.holdings.filter((h) => h.flags.includes('stale_price')).length,
      );
      const targets = page.holdings.filter((h) => h.watched && h.targetRatio !== null);
      expect(near(s.targetSumRatio, sumDecimals(targets.map((h) => h.targetRatio!)))).toBe(true);
      const fees = page.holdings.filter((h) => h.estMgmtFeeCents !== null);
      expect(s.estMgmtFeeCents).toBe(fees.length ? sum(fees.map((h) => h.estMgmtFeeCents)) : null);
      if (pricedHeld.length > 0) {
        const total = sumDecimals(pricedHeld.map((h) => h.currentRatio!));
        expect(near(total, '1'), total).toBe(true);
      }
    });

    it('has a realised-by-FY table with the as-of FY, newest first, adding up to realised', () => {
      const fys = page.realisedByFy.map((r) => r.financialYear);
      expect(fys).toEqual([...fys].sort((a, b) => b - a));
      expect(fys).toContain(financialYearOfIso(page.asOf));
      for (const r of page.realisedByFy)
        expect(r.totalCents).toBe(r.shortTermCents + r.longTermCents);
      expect(sum(page.realisedByFy.map((r) => r.totalCents))).toBe(page.summary.realisedCents);
      const thisFy = page.realisedByFy.find(
        (r) => r.financialYear === financialYearOfIso(page.asOf),
      );
      expect(thisFy?.totalCents).toBe(page.summary.realisedThisFyCents);
    });

    it('has allocation views that suit the kind', () => {
      expect(page.allocation.bySector === null).toBe(page.kind === 'crypto');
      expect(page.allocation.byRegion !== null).toBe(
        page.kind === 'etf' || page.kind === 'managed_fund',
      );
      const symbols = new Set(page.holdings.map((h) => h.symbol));
      for (const slice of page.allocation.byHolding) expect(symbols.has(slice.label)).toBe(true);
    });

    it('ends its chart with the live point from the summary', () => {
      const live = page.charts.points.at(-1);
      if (!live) return;
      expect(page.charts.points.filter((p) => p.live)).toEqual([live]);
      expect(live.valueCents).toBe(page.summary.valueCents);
      expect(live.gainCents).toBe(page.summary.totalReturnCents);
      expect(live.date).toBe(page.asOf);
    });

    it('has consider-next rows in class order and a hint for the suggested class', () => {
      const t = page.timing;
      expect(t.considerNext.rows.map((r) => r.assetClass)).toEqual([...ASSET_CLASSES]);
      const own = t.considerNext.rows.find((r) => r.assetClass === CLASS_OF[page.kind]);
      if (page.holdings.length > 0) expect(own?.valueCents).toBe(page.summary.valueCents);
      expect(t.hint.assetClass).toBe(t.considerNext.assetClass);
      if (t.hint.instrumentId !== null) {
        expect(t.considerNext.assetClass).toBe(CLASS_OF[page.kind]);
        const h = page.holdings.find((x) => x.instrumentId === t.hint.instrumentId);
        expect(h?.symbol).toBe(t.hint.symbol);
      }
      if (t.countdown.state === 'wait' || t.countdown.state === 'invest') {
        expect(t.plan?.months).toBeGreaterThan(0);
        // Stage 3 (§2.12): H14 = MAX(plan months, the cash-deficit months).
        expect(t.countdown.periodDays).toBe(
          30 * Math.max(t.plan!.months, t.cashDeficitMonths ?? 0),
        );
      }
      // Nothing to invest (cash first, or the budget's automatic split off): no plan, no parcel.
      if (t.countdown.state === 'cash_first' || t.countdown.state === 'split_off') {
        expect(t.monthlyInvestCents).not.toBeNull();
        expect(t.monthlyInvestCents!).toBeLessThanOrEqual(0);
        expect(t.plan).toBeNull();
        expect(t.hint.parcelCents).toBeNull();
      }
      if (t.budget.emergencyFundCents === null) {
        expect(t.considerNext.reason).not.toBe('below_emergency_fund');
      }
    });
  },
);

describe('trade ledgers', () => {
  it.each(INSTRUMENT_KINDS)(
    '%s: newest first, of the page instruments, adding up per holding',
    (kind) => {
      const ledger = f.investmentTrades[kind];
      const page = f.investmentPages[kind];
      expect(ledger.kind).toBe(kind);
      const keys = ledger.trades.map((t) => [t.tradeDate, t.seq, t.id] as const);
      const sorted = [...keys].sort((a, b) =>
        a[0] !== b[0] ? (a[0] < b[0] ? 1 : -1) : a[1] !== b[1] ? b[1] - a[1] : b[2] - a[2],
      );
      expect(keys).toEqual(sorted);
      expect(new Set(ledger.trades.map((t) => t.id)).size).toBe(ledger.trades.length);
      for (const h of page.holdings) {
        const trades = ledger.trades.filter((t) => t.instrumentId === h.instrumentId);
        for (const t of trades) {
          expect(t).toMatchObject({ kind, symbol: h.symbol });
          expect(compareDecimals(t.units, '0')).toBe(1);
          expect(t.orderValueCents).toBeGreaterThan(0);
          if (t.origin === 'app') expect(t.sheetRef).toBeNull();
          expect(t.flags.includes('oversell')).toBe(t.oversoldUnits !== null);
        }
        const buys = trades.filter((t) => t.side === 'buy');
        const sells = trades.filter((t) => t.side === 'sell');
        expect(sumDecimals(buys.map((t) => t.remainingUnits!)), h.symbol).toBe(h.units);
        expect(sum(sells.map((t) => t.realisedCents)), h.symbol).toBe(h.realisedCents);
        for (const s of sells)
          expect(s.realisedCents).toBe(s.realisedShortCents! + s.realisedLongCents!);
        expect(h.flags.includes('oversell'), h.symbol).toBe(
          sells.some((s) => s.oversoldUnits !== null),
        );
      }
    },
  );

  it('covers the ledger states the table renders', () => {
    const all = INSTRUMENT_KINDS.flatMap((k) => f.investmentTrades[k].trades);
    expect(all.some((t) => t.realisedShortCents! > 0 && t.realisedLongCents! > 0)).toBe(true);
    expect(all.some((t) => t.oversoldUnits !== null)).toBe(true);
    expect(all.some((t) => t.origin === 'import' && t.flags.includes('out_of_order'))).toBe(true);
    expect(all.some((t) => t.origin === 'app')).toBe(true);
    expect(all.some((t) => t.kind === 'crypto' && t.fee.kind === 'rate')).toBe(true);
    expect(f.tradeMutationResponse.trade).toEqual(
      f.investmentTrades.etf.trades.find((t) => t.id === f.deletedResponse.id),
    );
  });
});

describe('holding details and instruments', () => {
  it('match their page rows and add up', () => {
    const ids = Object.keys(f.holdingDetails).map(Number);
    expect(ids.length).toBeGreaterThanOrEqual(3);
    const kinds = new Set<InstrumentKind>();
    for (const id of ids) {
      const d = f.holdingDetails[id]!;
      kinds.add(d.instrument.kind);
      expect(d.instrument.id).toBe(id);
      expect(d.holding.instrumentId).toBe(id);
      expect(d.holding).toEqual(
        f.investmentPages[d.instrument.kind].holdings.find((h) => h.instrumentId === id),
      );
      expect(sumDecimals(d.lots.map((l) => l.remainingUnits))).toBe(d.holding.units);
      for (const l of d.lots) {
        expect(l.status).toBe(compareDecimals(l.remainingUnits, '0') > 0 ? 'open' : 'closed');
      }
      expect(sum(d.disposals.map((x) => x.gainCents))).toBe(d.holding.realisedCents);
      for (const x of d.disposals) expect(x.gainCents).toBe(x.proceedsCents - x.costCents);
      expect(sum(d.dividends.map((x) => x.netAmountCents))).toBe(d.holding.dividendsCents);
      expect(d.trades.every((t) => t.instrumentId === id)).toBe(true);
      expect(d.trades.length).toBe(d.instrument.tradeCount);
      expect(d.dividends.length).toBe(d.instrument.dividendCount);
    }
    expect(kinds).toEqual(new Set(['stock', 'etf', 'managed_fund', 'crypto']));
    // A held stock with open and closed parcels and disposals; an exited ETF; staking yields.
    expect(f.holdingDetails[1]!.lots.map((l) => l.status)).toEqual(
      expect.arrayContaining(['open', 'closed']),
    );
    expect(f.holdingDetails[3]!.holding.status).toBe('exited');
    expect(f.holdingDetails[8]!.dividends.every((x) => x.yieldRatio !== null)).toBe(true);
  });

  it('have instrument DTOs per kind, with and without a default fee', () => {
    for (const kind of INSTRUMENT_KINDS) expect(f.instrumentDtos[kind].kind).toBe(kind);
    const fees = Object.values(f.instrumentDtos).map((d) => d.defaultFee);
    expect(fees.some((x) => x === null)).toBe(true);
    expect(fees.some((x) => x?.kind === 'flat' && x.cents === 0)).toBe(true);
    expect(fees.some((x) => x?.kind === 'rate')).toBe(true);
    for (const dto of Object.values(f.instrumentDtoById)) {
      if (dto.defaultFee !== null) expect(dto.effectiveDefaultFee).toEqual(dto.defaultFee);
      const row = f.investmentPages[dto.kind].holdings.find((h) => h.instrumentId === dto.id);
      expect(row?.symbol).toBe(dto.symbol);
      expect(row?.effectiveDefaultFee).toEqual(dto.effectiveDefaultFee);
      expect(row?.price).toEqual(dto.price);
    }
  });
});

describe('requests and errors', () => {
  it('has trade bodies that parse', () => {
    const schema = makeTradeInputSchema(() => new Date(2026, 8, 24, 14, 32));
    for (const [name, body] of Object.entries(f.tradeInputExamples)) {
      expect(schema.safeParse(body).success, name).toBe(true);
    }
  });

  it('has the Stage 2 error bodies with known codes', () => {
    for (const key of [
      'tradeOversell',
      'instrumentExists',
      'instrumentInUse',
      'tradeValidation',
    ] as const) {
      const body = f.apiErrors[key];
      expect(isApiErrorBody(body)).toBe(true);
      expect(API_ERROR_CODES).toContain(body.error.code);
    }
    expect(f.apiErrors.tradeValidation.error.message).toMatch(/^quantity\.units: /);
  });
});
