// The period rules (stage-10.md §2, FROZEN): every worked example P1–P19, P21–P23 (P20 is a server
// test: the engine sees dates only), A1–A11 and the calendar C1–C5, the 1W examples again with
// localDate on both DST change days of 2030–2031, and the lines' downsampling. The process runs in
// UTC: the engine never reads a zone (every input is a date). Generic values only (made-up symbols,
// round amounts; the repo is public).
process.env.TZ = 'UTC';

import { JoinrDecimal, type InstrumentKind, type PriceStatus } from '@joinr/schema';
import { describe, expect, it } from 'vitest';
import {
  computeInvestments,
  computePeriods,
  PERIOD_ENGINE_VERSION,
  periodStartDate,
  type DatedValues,
  type HoldingResult,
  type LotResult,
  type OtherAssetResult,
  type PeriodBullionInput,
  type PeriodBullionRowInput,
  type PeriodChangeInput,
  type PeriodCloseSeries,
  type PeriodFigureResult,
  type PeriodResult,
  type PeriodsResult,
  type ServerPeriod,
} from '../src/index';
import { addDaysIso, daysBetween } from '../src/num';
import { instrument, trade } from './helpers';

const D = (v: string | number) => new JoinrDecimal(v);
const cents = (d: InstanceType<typeof JoinrDecimal>) => {
  const c = d.times(100).toDecimalPlaces(0, JoinrDecimal.ROUND_HALF_UP).toNumber();
  return c === 0 ? 0 : c;
};
const ratio = (d: InstanceType<typeof JoinrDecimal>) => {
  const r = d.toSignificantDigits(12, JoinrDecimal.ROUND_HALF_UP);
  return r.isZero() ? '0' : r.toFixed();
};

// ─── Builders ───────────────────────────────────────────────────────────────────────────────────

/** [tradeDate, units (negative = sell), AUD price, fee cents]. */
type TradeSpec = [string, string, string, number?];

interface Spec {
  id: number;
  kind: InstrumentKind;
  symbol: string;
  trades: TradeSpec[];
  price: string | null;
  status?: PriceStatus;
  /** p (§2.1); default null (no check). */
  priceDate?: string | null;
  closes?: [string, string][];
  currency?: string;
  audPerUnit?: [string, string][] | null;
  splits?: string[];
}

interface Built {
  input: PeriodChangeInput;
  holdings: HoldingResult[];
}

function build(
  specs: readonly Spec[],
  o: { localDate: string; bullion?: PeriodBullionInput[] },
): Built {
  const holdings: HoldingResult[] = [];
  const lots: LotResult[] = [];
  const kinds = new Map<number, InstrumentKind>();
  for (const kind of ['stock', 'etf', 'managed_fund', 'crypto'] as const) {
    const mine = specs.filter((x) => x.kind === kind);
    if (mine.length === 0) continue;
    let tradeId = 0;
    const result = computeInvestments({
      kind,
      asOf: o.localDate,
      instruments: mine.map((x) => instrument(x.id, x.symbol, { kind })),
      trades: mine.flatMap((x) =>
        x.trades.map(([date, units, price, fee]) => {
          tradeId += 1;
          return trade(x.id * 100 + tradeId, x.id, date, units, price, { feeCents: fee ?? 0 });
        }),
      ),
      dividends: [],
      prices: new Map(
        mine.flatMap((x) =>
          x.price === null
            ? []
            : [[x.id, { price: x.price, status: x.status ?? 'fresh' }] as const],
        ),
      ),
    });
    holdings.push(...result.holdings);
    lots.push(...result.lots);
    for (const x of mine) kinds.set(x.id, kind);
  }
  const closes = new Map<number, PeriodCloseSeries>();
  for (const x of specs) {
    if (x.closes === undefined && x.splits === undefined) continue;
    closes.set(x.id, {
      currency: x.currency ?? 'AUD',
      closes: x.closes ?? [],
      audPerUnit: x.audPerUnit ?? null,
      splits: x.splits ?? [],
    });
  }
  return {
    holdings,
    input: {
      localDate: o.localDate,
      holdings,
      kinds,
      lots,
      closes,
      priceDates: new Map(specs.map((x) => [x.id, x.priceDate ?? null])),
      bullion: o.bullion ?? [],
    },
  };
}

interface RowSpec {
  units: string;
  oz?: string;
  purchaseDate: string | null;
  /** AUD per unit of the row; null → unknown. */
  unitCost: string | null;
  /** AUD per ounce; null → unpriced. */
  spot: string | null;
  sold?: { units: string; proceeds: string };
}

/** A bullion row with its engine result worked out like computeOtherAssets (value − cost, both rounded). */
function bullionRow(id: number, r: RowSpec): PeriodBullionRowInput {
  const oz = D(r.oz ?? '1');
  const remaining = D(r.units).minus(r.sold?.units ?? '0');
  const unitPrice = r.spot === null ? null : D(r.spot).times(oz);
  const valueCents = unitPrice === null ? null : cents(remaining.times(unitPrice));
  const costCents = r.unitCost === null ? null : cents(remaining.times(r.unitCost));
  const realised =
    r.sold === undefined || r.unitCost === null
      ? null
      : cents(D(r.sold.proceeds)) - cents(D(r.sold.units).times(r.unitCost));
  const asset: OtherAssetResult = {
    id,
    remainingUnits: remaining.toFixed(),
    costCents,
    unitPriceAud: unitPrice === null ? null : unitPrice.toFixed(),
    valueCents,
    gainCents: valueCents !== null && costCents !== null ? valueCents - costCents : null,
    gainRatio: null,
    cagrRatio: null,
    effectiveDate: r.purchaseDate,
    dateAssumed: false,
    heldDays: null,
    priceStatus: r.spot === null ? 'none' : 'fresh',
    priceAsOf: null,
    sales:
      r.sold === undefined
        ? []
        : [
            {
              id: id * 10,
              saleDate: '2030-03-02',
              units: r.sold.units,
              proceedsCents: cents(D(r.sold.proceeds)),
              costCents: r.unitCost === null ? null : cents(D(r.sold.units).times(r.unitCost)),
              realisedCents: realised,
            },
          ],
    realisedCents: realised ?? 0,
    flags: [],
  };
  return {
    asset,
    ozPerUnit: oz.toFixed(),
    purchaseDate: r.purchaseDate,
    unitCostAud: r.unitCost,
    boughtUnits: r.units,
  };
}

function silver(
  rows: PeriodBullionRowInput[],
  price: string | null,
  closes: DatedValues,
  priceDate: string | null = null,
): PeriodBullionInput {
  return { metal: 'silver', rows, price, priceDate, closes };
}

function period(r: PeriodsResult, p: ServerPeriod): PeriodResult {
  const found = r.periods.find((x) => x.period === p);
  if (!found) throw new Error(`no period ${p}`);
  return found;
}

function fig(r: PeriodsResult, p: ServerPeriod, key: string): PeriodFigureResult {
  const f = period(r, p).figures.find((x) => x.key === key);
  if (!f) throw new Error(`no figure ${key} under ${p}`);
  return f;
}

/** Every result: totals are the sums, lines end where they must (§2.4–§2.6). */
function expectConsistent(r: PeriodsResult) {
  expect(r.periods.map((p) => p.period)).toEqual(['1W', '2W', '1M', '3M', '6M', '12M', 'ALL']);
  for (const p of r.periods) {
    const held = p.figures.filter((f) => f.key !== 'sold');
    const counted = held.filter(
      (f) => f.cents !== null && (f.status === 'ok' || p.period !== 'ALL'),
    );
    const sold = p.figures.find((f) => f.key === 'sold');
    if (p.period !== 'ALL') expect(sold).toBeUndefined();
    const sum = counted.reduce((a, f) => a + f.cents!, 0) + (sold?.cents ?? 0);
    expect(p.totals.cents, p.period).toBe(counted.length === 0 && !sold ? null : sum);
    const ok = held.filter((f) => f.status === 'ok');
    expect(p.totals.up + p.totals.down + p.totals.flat).toBe(ok.length);
    expect(p.totals.missing).toBe(held.length - ok.length);
    expect(p.totals.holdings).toBe(held.length);
    expect(p.totals.partial).toBe(p.totals.missing > 0);
    if (p.totals.cents !== null && p.totals.baseCents !== null && p.totals.baseCents > 0)
      expect(p.totals.ratio).toBe(ratio(D(p.totals.cents).div(p.totals.baseCents)));
    if (p.period === 'ALL') {
      expect(p.startDate).toBeNull();
      if (p.totals.cents !== null)
        expect(p.totals.unrealisedCents! + p.totals.realisedCents!).toBe(p.totals.cents);
      if (p.line !== null) expect(p.line.points.at(-1)![1]).toBe(p.totals.unrealisedCents);
    } else {
      expect(p.totals.unrealisedCents).toBeNull();
      expect(p.totals.realisedCents).toBeNull();
      if (p.line !== null) {
        expect(p.line.points.at(-1)![1]).toBe(p.totals.cents);
        expect(p.line.points[0]![0]).toBe(p.startDate);
      }
    }
    if (p.line !== null) {
      expect(p.line.points.length).toBeLessThanOrEqual(120);
      const dates = p.line.points.map(([d]) => d);
      expect(dates).toEqual([...new Set(dates)].sort());
      expect(dates[0]).toBe(p.line.from);
      expect(dates.at(-1)).toBe(p.line.to);
    }
    for (const f of p.figures)
      if (f.line !== null) expect(f.line.points.length).toBeLessThanOrEqual(40);
  }
}

function run(specs: readonly Spec[], o: { localDate: string; bullion?: PeriodBullionInput[] }) {
  const r = computePeriods(build(specs, o).input);
  expectConsistent(r);
  return r;
}

// ─── The examples' holdings (localDate Thursday 12/09/2030) ─────────────────────────────────────

const THU = '2030-09-12';

const abcP1 = (over: Partial<Spec> = {}): Spec => ({
  id: 1,
  kind: 'etf',
  symbol: 'ASX:ABC',
  trades: [['2030-01-10', '100', '40', 1000]],
  price: '50.5',
  closes: [['2030-09-05', '50']],
  ...over,
});

const exusP5 = (over: Partial<Spec> = {}): Spec => ({
  id: 10,
  kind: 'stock',
  symbol: 'NYSE:EXUS',
  trades: [['2030-05-01', '20', '140']],
  price: '155.384615384615',
  currency: 'USD',
  closes: [['2030-08-12', '100']],
  audPerUnit: [['2030-08-12', '1.5625']],
  ...over,
});

const fund2P10 = (over: Partial<Spec> = {}): Spec => ({
  id: 12,
  kind: 'managed_fund',
  symbol: 'EXAMPLEFUND2',
  trades: [
    ['2030-01-01', '500', '1.8'],
    ['2030-09-09', '100', '2'],
  ],
  price: '2.1',
  status: 'manual',
  priceDate: '2030-09-11',
  ...over,
});

const mnoP11 = (over: Partial<Spec> = {}): Spec => ({
  id: 4,
  kind: 'stock',
  symbol: 'ASX:MNO',
  trades: [['2030-09-09', '50', '10']],
  price: '10.4',
  ...over,
});

const silverP7 = (
  extra: PeriodBullionRowInput[] = [],
  closes: DatedValues = [['2030-08-12', '50']],
) =>
  silver(
    [
      bullionRow(1, { units: '10', purchaseDate: '2030-01-20', unitCost: '40', spot: '55' }),
      bullionRow(2, { units: '5', purchaseDate: '2030-09-02', unitCost: '52', spot: '55' }),
      ...extra,
    ],
    '55',
    closes,
  );

// ─── Calendar (C) ───────────────────────────────────────────────────────────────────────────────

describe('periodStartDate (C1–C5)', () => {
  const PERIODS = ['1W', '2W', '1M', '3M', '6M', '12M'] as const;
  it.each([
    [
      'C1',
      '2030-09-12',
      ['2030-09-05', '2030-08-29', '2030-08-12', '2030-06-12', '2030-03-12', '2029-09-12'],
    ],
    [
      'C2',
      '2031-03-31',
      ['2031-03-24', '2031-03-17', '2031-02-28', '2030-12-31', '2030-09-30', '2030-03-31'],
    ],
    [
      'C3',
      '2032-02-29',
      ['2032-02-22', '2032-02-15', '2032-01-29', '2031-11-29', '2031-08-29', '2031-02-28'],
    ],
  ] as const)('%s: localDate %s', (_name, localDate, starts) => {
    expect(PERIODS.map((p) => periodStartDate(localDate, p))).toEqual(starts);
    expect(periodStartDate(localDate, 'ALL')).toBeNull();
  });

  it('C4: a weekend start takes Friday’s close for a listing and the Saturday close for a coin', () => {
    expect(periodStartDate('2030-09-14', '1W')).toBe('2030-09-07');
    const r = run(
      [
        abcP1({
          price: '50',
          closes: [
            ['2030-09-05', '49'],
            ['2030-09-06', '49.5'],
          ],
        }),
        {
          id: 13,
          kind: 'crypto',
          symbol: 'BTC',
          trades: [['2030-02-01', '0.5', '90000']],
          price: '164000',
          // The close of Sat 07/09 is the price at 00:00 Sun 08/09 Melbourne (dated by the server).
          closes: [
            ['2030-09-06', '149000'],
            ['2030-09-07', '150000'],
            ['2030-09-08', '151000'],
          ],
        },
      ],
      { localDate: '2030-09-14' },
    );
    expect(fig(r, '1W', 'i1')).toMatchObject({ startCloseDate: '2030-09-06', startClose: '49.5' });
    expect(fig(r, '1W', 'i13')).toMatchObject({
      startCloseDate: '2030-09-07',
      startClose: '150000',
      cents: 700000,
    });
  });

  it('C5: the last close 11 days before S → no_start; 10 days → found', () => {
    const late = run([abcP1({ closes: [['2030-08-25', '50']] })], { localDate: THU });
    expect(fig(late, '1W', 'i1')).toMatchObject({ status: 'no_start', cents: null });
    const edge = run([abcP1({ closes: [['2030-08-26', '50']] })], { localDate: THU });
    expect(fig(edge, '1W', 'i1')).toMatchObject({ status: 'ok', startCloseDate: '2030-08-26' });
  });
});

// ─── 1W–12M (P) ─────────────────────────────────────────────────────────────────────────────────

describe('1W–12M (P1–P19, P21–P23)', () => {
  it('P1: held throughout', () => {
    const r = run([abcP1()], { localDate: THU });
    expect(fig(r, '1W', 'i1')).toEqual({
      key: 'i1',
      status: 'ok',
      cents: 5000,
      ratio: '0.01',
      startClose: '50',
      startCloseDate: '2030-09-05',
      changePerUnit: '0.5',
      priceRatio: '0.01',
      startUnits: '100',
      newUnits: '0',
      laterUnits: '0',
      newCostCents: null,
      unrealisedCents: null,
      realisedCents: null,
      costEverCents: null,
      soldCount: null,
      line: {
        base: '50',
        points: [
          ['2030-09-05', '50'],
          [THU, '50.5'],
        ],
      },
    });
    expect(period(r, '1W').totals).toMatchObject({ cents: 5000, baseCents: 500000, ratio: '0.01' });
    expect(period(r, '1W').startDate).toBe('2030-09-05');
  });

  it('P2: bought within (from the purchase price, the fee not used)', () => {
    const r = run(
      [
        abcP1({
          trades: [
            ['2030-01-10', '100', '40', 1000],
            ['2030-09-09', '20', '49', 950],
          ],
        }),
      ],
      {
        localDate: THU,
      },
    );
    expect(fig(r, '1W', 'i1')).toMatchObject({
      status: 'ok',
      cents: 8000,
      ratio: '0.0133779264214',
      startUnits: '100',
      newUnits: '20',
      newCostCents: 98000,
    });
    expect(period(r, '1W').totals.baseCents).toBe(598000);
  });

  it('P3: sold within (D160): the remaining start units only; the sale counts nothing', () => {
    const r = run(
      [
        abcP1({
          trades: [
            ['2030-02-01', '60', '40'],
            ['2030-03-01', '40', '45'],
            ['2030-09-10', '-40', '52'],
          ],
        }),
      ],
      { localDate: THU },
    );
    expect(fig(r, '1W', 'i1')).toMatchObject({
      status: 'ok',
      cents: 3000,
      ratio: '0.01',
      startUnits: '60',
    });
  });

  it('P4: a weekend start', () => {
    const r = run(
      [
        abcP1({
          price: '50',
          closes: [
            ['2030-09-05', '49'],
            ['2030-09-06', '49.5'],
          ],
        }),
      ],
      {
        localDate: '2030-09-14',
      },
    );
    expect(fig(r, '1W', 'i1')).toMatchObject({
      startClose: '49.5',
      startCloseDate: '2030-09-06',
      cents: 5000,
    });
  });

  it('P5: a foreign listing includes the currency move (D143)', () => {
    const r = run([exusP5()], { localDate: THU });
    expect(fig(r, '1M', 'i10')).toMatchObject({
      status: 'ok',
      startClose: '156.25',
      startCloseDate: '2030-08-12',
      cents: -1731,
      ratio: '-0.0055392',
      changePerUnit: '-0.865384615385',
      priceRatio: '-0.00553846153846',
    });
    expect(period(r, '1M').totals.baseCents).toBe(312500);
  });

  it('P6: crypto measures from the close of S (the 00:00 price after it, D142)', () => {
    const r = run(
      [
        {
          id: 13,
          kind: 'crypto',
          symbol: 'BTC',
          trades: [['2030-02-01', '0.5', '90000']],
          price: '164000',
          closes: [['2030-08-29', '150000']],
        },
      ],
      { localDate: THU },
    );
    expect(fig(r, '2W', 'i13')).toMatchObject({ cents: 700000, ratio: '0.0933333333333' });
  });

  it('P7: bullion (D153): start rows from B, a within row from its cost', () => {
    const r = run([], { localDate: THU, bullion: [silverP7()] });
    expect(fig(r, '1M', 'bullion-silver')).toMatchObject({
      status: 'ok',
      cents: 6500,
      ratio: '0.0855263157895',
      startClose: '50',
      startUnits: '10',
      newUnits: '5',
      newCostCents: 26000,
    });
    expect(period(r, '1M').totals).toMatchObject({ baseCents: 76000 });
  });

  it('P8: a bullion row without a date is a start lot', () => {
    const undated = bullionRow(3, { units: '2', purchaseDate: null, unitCost: '30', spot: '55' });
    const r = run([], { localDate: THU, bullion: [silverP7([undated])] });
    expect(fig(r, '1M', 'bullion-silver')).toMatchObject({ cents: 7500, startUnits: '12' });
  });

  it('P9: a fund NAV gap takes the last NAV before it', () => {
    const r = run(
      [
        {
          id: 11,
          kind: 'managed_fund',
          symbol: '0PEXAMPLE1',
          trades: [['2030-01-15', '1000', '1.4']],
          price: '1.515',
          closes: [
            ['2030-09-04', '1.49'],
            ['2030-09-06', '1.5'],
          ],
        },
      ],
      { localDate: THU },
    );
    expect(fig(r, '1W', 'i11')).toMatchObject({
      startClose: '1.49',
      startCloseDate: '2030-09-04',
      cents: 2500,
    });
  });

  it('P10: no start close (D165): the start units "—", the units bought within still count', () => {
    const r = run([fund2P10()], { localDate: THU });
    expect(fig(r, '1W', 'i12')).toMatchObject({
      status: 'no_start',
      cents: 1000,
      newCostCents: 20000,
      ratio: '0.05',
      startUnits: '500',
      newUnits: '100',
      startClose: null,
      startCloseDate: null,
      changePerUnit: null,
      priceRatio: null,
      line: null,
    });
    expect(period(r, '1W').totals).toMatchObject({
      cents: 1000,
      baseCents: 20000,
      missing: 1,
      partial: true,
      up: 0,
    });
    // 12M (S 12/09/2029): every unit was bought within, so no start close is needed.
    expect(fig(r, '12M', 'i12')).toMatchObject({
      status: 'ok',
      cents: 16000,
      startUnits: '0',
      newUnits: '600',
    });
  });

  it('P11: bought within with no stored close: ok and flat', () => {
    const r = run([mnoP11()], { localDate: THU });
    expect(fig(r, '1W', 'i4')).toMatchObject({
      status: 'ok',
      cents: 2000,
      startClose: null,
      line: null,
    });
    expect(period(r, '1W').line).toBeNull();
  });

  it('P12: a split in the period → split in 1W–12M; ALL is the engine figure', () => {
    const r = run(
      [
        {
          id: 2,
          kind: 'stock',
          symbol: 'ASX:XYZ',
          trades: [['2030-01-02', '200', '18']],
          price: '19.6',
          closes: [
            ['2029-12-20', '35'],
            ['2030-09-05', '39'],
          ],
          splits: ['2030-09-10'],
        },
      ],
      { localDate: THU },
    );
    for (const p of ['1W', '2W', '1M', '3M', '6M', '12M'] as const)
      expect(fig(r, p, 'i2')).toMatchObject({ status: 'split', cents: null, line: null });
    expect(fig(r, 'ALL', 'i2')).toMatchObject({ status: 'ok', cents: 32000, line: null });
  });

  it('P13: totals', () => {
    const r = run([abcP1(), mnoP11(), fund2P10()], { localDate: THU });
    expect(period(r, '1W').totals).toEqual({
      cents: 8000,
      ratio: '0.0140350877193',
      baseCents: 570000,
      up: 2,
      down: 0,
      flat: 0,
      missing: 1,
      holdings: 3,
      partial: true,
      unrealisedCents: null,
      realisedCents: null,
    });
  });

  it('P14: the line (drawn and flat holdings; the last point is the total)', () => {
    const r = run(
      [
        abcP1({
          closes: [
            ['2030-09-05', '50'],
            ['2030-09-06', '50.2'],
            ['2030-09-09', '49.8'],
            ['2030-09-10', '50.1'],
            ['2030-09-11', '50.3'],
          ],
        }),
        mnoP11({
          closes: [
            ['2030-09-09', '10.1'],
            ['2030-09-10', '10.2'],
            ['2030-09-11', '10.3'],
          ],
        }),
        fund2P10(),
      ],
      { localDate: THU },
    );
    expect(period(r, '1W').line).toEqual({
      from: '2030-09-05',
      to: THU,
      points: [
        ['2030-09-05', 1000],
        ['2030-09-06', 3000],
        ['2030-09-09', -500],
        ['2030-09-10', 3000],
        ['2030-09-11', 5500],
        [THU, 8000],
      ],
    });
    expect(fig(r, '1W', 'i1').line).toEqual({
      base: '50',
      points: [
        ['2030-09-05', '50'],
        ['2030-09-06', '50.2'],
        ['2030-09-09', '49.8'],
        ['2030-09-10', '50.1'],
        ['2030-09-11', '50.3'],
        [THU, '50.5'],
      ],
    });
    expect(fig(r, '1W', 'i4').line).toEqual({
      base: '10',
      points: [
        ['2030-09-09', '10.1'],
        ['2030-09-10', '10.2'],
        ['2030-09-11', '10.3'],
        [THU, '10.4'],
      ],
    });
    expect(fig(r, '1W', 'i12').line).toBeNull();
  });

  it('P15: a future-dated lot adds 0 and is outside the base', () => {
    const r = run(
      [
        abcP1({
          trades: [
            ['2030-01-10', '100', '40', 1000],
            ['2030-09-20', '10', '50'],
          ],
        }),
      ],
      {
        localDate: THU,
      },
    );
    expect(fig(r, '1W', 'i1')).toMatchObject({ cents: 5000, laterUnits: '10', ratio: '0.01' });
    expect(period(r, '1W').totals.baseCents).toBe(500000);
  });

  it('P16: an FX close too old → no_start', () => {
    const r = run([exusP5({ audPerUnit: [['2030-08-01', '1.5625']] })], { localDate: THU });
    expect(fig(r, '1M', 'i10')).toMatchObject({ status: 'no_start', cents: null });
    const fresh = run([exusP5({ audPerUnit: [['2030-08-02', '1.5625']] })], { localDate: THU });
    expect(fig(fresh, '1M', 'i10')).toMatchObject({ status: 'ok', cents: -1731 });
  });

  it('P17: a stale price after b still gives the figure', () => {
    const r = run([abcP1({ status: 'stale', priceDate: '2030-09-10' })], { localDate: THU });
    expect(fig(r, '1W', 'i1')).toMatchObject({ status: 'ok', cents: 5000 });
  });

  it('P18: rounding once per holding; the total is the exact sum', () => {
    const one = (id: number): Spec => ({
      id,
      kind: 'stock',
      symbol: `ASX:EX${id}`,
      trades: [['2030-01-02', '1', '1']],
      price: '1.005',
      closes: [['2030-09-05', '1']],
    });
    const r = run([one(21), one(22), one(23)], { localDate: THU });
    for (const key of ['i21', 'i22', 'i23']) expect(fig(r, '1W', key).cents).toBe(1);
    expect(period(r, '1W').totals.cents).toBe(3);
  });

  it('P19: a within row with an unknown cost is a start lot', () => {
    const noCost = bullionRow(4, {
      units: '1',
      purchaseDate: '2030-09-03',
      unitCost: null,
      spot: '55',
    });
    const r = run([], { localDate: THU, bullion: [silverP7([noCost])] });
    expect(fig(r, '1M', 'bullion-silver')).toMatchObject({
      status: 'ok',
      cents: 7000,
      startUnits: '11',
      newUnits: '5',
    });
  });

  it('P21: bought after a split → computed; a lot spanning it → split', () => {
    const mno = mnoP11({ trades: [['2030-09-10', '50', '10']], splits: ['2030-09-09'] });
    const r = run([mno], { localDate: THU });
    expect(fig(r, '1W', 'i4')).toMatchObject({ status: 'ok', cents: 2000 });
    const spanning = run(
      [
        mnoP11({
          trades: [
            ['2030-09-06', '10', '19'],
            ['2030-09-10', '50', '10'],
          ],
          splits: ['2030-09-09'],
        }),
      ],
      { localDate: THU },
    );
    expect(fig(spanning, '1W', 'i4')).toMatchObject({ status: 'split', cents: null });
  });

  it('P22: a price older than the start → no figure at all', () => {
    const r = run(
      [
        abcP1({
          status: 'manual',
          priceDate: '2030-08-01',
          closes: [
            ['2030-06-12', '45'],
            ['2030-09-05', '50'],
          ],
        }),
      ],
      { localDate: THU },
    );
    expect(fig(r, '1W', 'i1')).toMatchObject({ status: 'no_start', cents: null, ratio: null });
    expect(period(r, '1W').totals).toMatchObject({ cents: null, missing: 1, partial: true });
    expect(fig(r, '3M', 'i1')).toMatchObject({
      status: 'ok',
      cents: 55000,
      startCloseDate: '2030-06-12',
    });
  });

  it('P23: no B with a within row of unknown cost: no_start, the dated within rows count', () => {
    const noCost = bullionRow(4, {
      units: '1',
      purchaseDate: '2030-09-03',
      unitCost: null,
      spot: '55',
    });
    const r = run([], { localDate: THU, bullion: [silverP7([noCost], [['2030-07-31', '50']])] });
    expect(fig(r, '1M', 'bullion-silver')).toMatchObject({
      status: 'no_start',
      cents: 1500,
      newCostCents: 26000,
      startUnits: '11',
    });
    expect(period(r, '1M').totals).toMatchObject({ missing: 1, partial: true, cents: 1500 });
  });

  it('an unpriced holding has no figure in any period', () => {
    const r = run([abcP1({ price: null })], { localDate: THU });
    for (const p of r.periods)
      expect(p.figures[0]).toMatchObject({ status: 'unpriced', cents: null });
    expect(period(r, 'ALL').totals).toMatchObject({ cents: null, missing: 1, holdings: 1 });
  });
});

// ─── ALL (A) ────────────────────────────────────────────────────────────────────────────────────

const abcA1 = (over: Partial<Spec> = {}): Spec =>
  abcP1({
    trades: [
      ['2030-02-01', '60', '40', 1000],
      ['2030-03-01', '40', '45', 1000],
      ['2030-09-10', '-40', '52', 1000],
    ],
    closes: [],
    ...over,
  });

const oldA2: Spec = {
  id: 9,
  kind: 'stock',
  symbol: 'ASX:OLD',
  trades: [
    ['2030-01-07', '100', '20', 1000],
    ['2030-06-03', '-100', '25', 1000],
  ],
  price: null,
};

const silverA3 = (closes: DatedValues = []) =>
  silver(
    [
      bullionRow(1, { units: '10', purchaseDate: '2030-01-20', unitCost: '40', spot: '55' }),
      bullionRow(2, { units: '5', purchaseDate: '2030-02-20', unitCost: '52', spot: '55' }),
      bullionRow(3, {
        units: '4',
        purchaseDate: '2029-11-01',
        unitCost: '45',
        spot: '55',
        sold: { units: '4', proceeds: '220' },
      }),
    ],
    '55',
    closes,
  );

const goldA4: PeriodBullionInput = {
  metal: 'gold',
  rows: [
    bullionRow(5, {
      units: '1',
      purchaseDate: '2029-02-01',
      unitCost: '3000',
      spot: '3200',
      sold: { units: '1', proceeds: '3100' },
    }),
  ],
  price: '3200',
  priceDate: null,
  closes: [],
};

describe('ALL (A1–A11)', () => {
  it('A1: held, partly sold: unrealised + realised, % of everything bought', () => {
    const r = run([abcA1()], { localDate: THU });
    expect(fig(r, 'ALL', 'i1')).toEqual({
      key: 'i1',
      status: 'ok',
      cents: 88000,
      ratio: '0.208530805687',
      startClose: null,
      startCloseDate: null,
      changePerUnit: null,
      priceRatio: null,
      startUnits: '0',
      newUnits: '0',
      laterUnits: '0',
      newCostCents: null,
      unrealisedCents: 41667,
      realisedCents: 46333,
      costEverCents: 422000,
      soldCount: null,
      line: null,
    });
  });

  it('A2: a fully sold instrument goes to Sold holdings', () => {
    const r = run([oldA2], { localDate: THU });
    const all = period(r, 'ALL');
    expect(all.figures).toHaveLength(1);
    expect(fig(r, 'ALL', 'sold')).toMatchObject({
      status: 'ok',
      cents: 48000,
      costEverCents: 201000,
      soldCount: 1,
      unrealisedCents: 0,
      realisedCents: 48000,
    });
    expect(all.totals).toMatchObject({
      cents: 48000,
      holdings: 0,
      unrealisedCents: 0,
      realisedCents: 48000,
    });
    expect(all.line).toBeNull();
    for (const p of r.periods.filter((x) => x.period !== 'ALL'))
      expect(p.totals).toMatchObject({ cents: null, holdings: 0, partial: false });
  });

  it('A3: bullion with a sale: held gains + realised', () => {
    const r = run([], { localDate: THU, bullion: [silverA3()] });
    expect(fig(r, 'ALL', 'bullion-silver')).toMatchObject({
      status: 'ok',
      cents: 20500,
      unrealisedCents: 16500,
      realisedCents: 4000,
      costEverCents: 84000,
      ratio: '0.244047619048',
    });
  });

  it('A4: a metal no longer held goes to Sold holdings', () => {
    const r = run([], { localDate: THU, bullion: [goldA4] });
    expect(period(r, 'ALL').figures).toEqual([
      expect.objectContaining({ key: 'sold', cents: 10000, costEverCents: 300000, soldCount: 1 }),
    ]);
  });

  it('A5: totals', () => {
    const r = run([abcA1(), oldA2], { localDate: THU, bullion: [silverA3(), goldA4] });
    const all = period(r, 'ALL');
    expect(all.totals).toEqual({
      cents: 166500,
      ratio: '0.165342601787',
      baseCents: 1007000,
      up: 2,
      down: 0,
      flat: 0,
      missing: 0,
      holdings: 2,
      partial: false,
      unrealisedCents: 58167,
      realisedCents: 108333,
    });
    expect(fig(r, 'ALL', 'sold')).toMatchObject({
      cents: 58000,
      ratio: '0.115768463074',
      soldCount: 2,
    });
    expect(all.figures.map((f) => f.key)).toEqual(['i1', 'bullion-silver', 'sold']);
  });

  it('A6: a hand-priced fund is ok (as the web) and flat in the line', () => {
    const r = run([fund2P10()], { localDate: THU });
    expect(fig(r, 'ALL', 'i12')).toMatchObject({ status: 'ok', cents: 16000, line: null });
    expect(period(r, 'ALL').line).toBeNull();
  });

  it('A7: an unpriced held stock is left out with its realised part', () => {
    const r = run([abcA1({ price: null }), oldA2], { localDate: THU });
    expect(fig(r, 'ALL', 'i1')).toMatchObject({
      status: 'unpriced',
      cents: null,
      realisedCents: 46333,
    });
    expect(period(r, 'ALL').totals).toMatchObject({
      cents: 48000,
      realisedCents: 48000,
      unrealisedCents: 0,
      missing: 1,
      partial: true,
    });
  });

  it('A8: a held bullion row without a cost → no_cost for the metal', () => {
    const r = run([], {
      localDate: THU,
      bullion: [
        silver(
          [
            bullionRow(1, { units: '10', purchaseDate: '2030-01-20', unitCost: '40', spot: '55' }),
            bullionRow(2, { units: '1', purchaseDate: '2030-02-20', unitCost: null, spot: '55' }),
          ],
          '55',
          [],
        ),
      ],
    });
    expect(fig(r, 'ALL', 'bullion-silver')).toMatchObject({ status: 'no_cost', cents: null });
    expect(period(r, 'ALL').totals).toMatchObject({ cents: null, partial: true, missing: 1 });
  });

  it('A9: the line: the unrealised gain of today’s lots, brokerage in', () => {
    const r = run(
      [
        abcP1({
          trades: [['2030-02-04', '60', '40', 1000]],
          price: '43',
          closes: [
            ['2030-02-04', '41'],
            ['2030-02-05', '42'],
          ],
        }),
      ],
      { localDate: '2030-02-06' },
    );
    const all = period(r, 'ALL');
    expect(all.line).toEqual({
      from: '2030-02-04',
      to: '2030-02-06',
      points: [
        ['2030-02-04', 5000],
        ['2030-02-05', 11000],
        ['2030-02-06', 17000],
      ],
    });
    expect(all.totals).toMatchObject({ cents: 17000, unrealisedCents: 17000, realisedCents: 0 });
    expect(fig(r, 'ALL', 'i1').line).toEqual({
      base: '40',
      points: [
        ['2030-02-04', '41'],
        ['2030-02-05', '42'],
        ['2030-02-06', '43'],
      ],
    });
  });

  it('A10: no step on a sale date (D167): the line ends at the unrealised total', () => {
    const r = run(
      [
        abcP1({
          trades: [['2030-02-04', '60', '40', 1000]],
          price: '43',
          closes: [
            ['2030-02-04', '41'],
            ['2030-02-05', '42'],
          ],
        }),
        oldA2,
      ],
      { localDate: THU },
    );
    const all = period(r, 'ALL');
    expect(all.line).toEqual({
      from: '2030-02-04',
      to: THU,
      points: [
        ['2030-02-04', 5000],
        ['2030-02-05', 11000],
        [THU, 17000],
      ],
    });
    expect(all.totals).toMatchObject({
      cents: 65000,
      unrealisedCents: 17000,
      realisedCents: 48000,
    });
  });

  it('A11: a held holding’s realised part is not in the line (D167)', () => {
    const closes: [string, string][] = [];
    for (let d = '2030-02-01'; d < THU; d = addDaysIso(d, 7)) closes.push([d, '47']);
    const xag: [string, string][] = [];
    for (let d = '2030-01-20'; d < THU; d = addDaysIso(d, 7)) xag.push([d, '50']);
    const r = run([abcA1({ closes }), oldA2], { localDate: THU, bullion: [silverA3(xag), goldA4] });
    const all = period(r, 'ALL');
    expect(all.line).not.toBeNull();
    expect(all.line!.from).toBe('2030-01-20');
    expect(all.line!.points.at(-1)).toEqual([THU, 58167]);
    expect(all.totals.cents! - all.line!.points.at(-1)![1]).toBe(108333);
    expect(all.line!.points.some(([d]) => d === '2030-06-03' || d === '2030-03-02')).toBe(false);
    expect(fig(r, 'ALL', 'i1').line?.base).toBe('43.3333333333');
    expect(fig(r, 'ALL', 'bullion-silver').line?.base).toBe('44');
  });

  it('a holding with no close since its earliest lot is flat in the ALL line', () => {
    const r = run(
      [
        abcP1({
          trades: [['2030-02-04', '60', '40']],
          price: '43',
          closes: [['2030-02-04', '41']],
        }),
        mnoP11({ trades: [['2030-09-11', '50', '10']], closes: [['2030-09-03', '9.9']] }),
      ],
      { localDate: THU },
    );
    const all = period(r, 'ALL');
    expect(fig(r, 'ALL', 'i4')).toMatchObject({ cents: 2000, line: null });
    expect(all.line!.points).toEqual([
      ['2030-02-04', 6000 + 2000],
      [THU, 18000 + 2000],
    ]);
  });

  it('a split after the earliest lot draws the holding flat in the ALL line', () => {
    const r = run(
      [
        abcP1({
          closes: [
            ['2030-01-10', '41'],
            ['2030-05-01', '45'],
          ],
          splits: ['2030-04-01'],
        }),
      ],
      { localDate: THU },
    );
    expect(period(r, 'ALL').line).toBeNull();
    expect(fig(r, 'ALL', 'i1')).toMatchObject({ status: 'ok', cents: 104000, line: null });
  });
});

// ─── The DST change days: the engine sees dates only ────────────────────────────────────────────

describe('1W–12M on the DST change days (the engine never reads a zone)', () => {
  /** P1, P2, P6, P10, P11 and P14's closes, every date moved so that localDate lands on `target`. */
  function scenario(target: string) {
    const delta = daysBetween(THU, target);
    const at = (d: string) => addDaysIso(d, delta);
    const r = run(
      [
        abcP1({
          trades: [
            ['2030-01-10', '100', '40', 1000],
            [at('2030-09-09'), '20', '49', 950],
          ],
          closes: [
            [at('2030-09-05'), '50'],
            [at('2030-09-06'), '50.2'],
            [at('2030-09-09'), '49.8'],
            [at('2030-09-10'), '50.1'],
            [at('2030-09-11'), '50.3'],
          ],
        }),
        mnoP11({
          trades: [[at('2030-09-09'), '50', '10']],
          closes: [
            [at('2030-09-09'), '10.1'],
            [at('2030-09-10'), '10.2'],
            [at('2030-09-11'), '10.3'],
          ],
        }),
        fund2P10({
          trades: [
            ['2030-01-01', '500', '1.8'],
            [at('2030-09-09'), '100', '2'],
          ],
          priceDate: at('2030-09-11'),
        }),
        {
          id: 13,
          kind: 'crypto',
          symbol: 'BTC',
          trades: [['2030-02-01', '0.5', '90000']],
          price: '164000',
          closes: [
            [at('2030-08-29'), '150000'],
            [at('2030-09-05'), '160000'],
          ],
        },
      ],
      { localDate: target },
    );
    return { r, at };
  }

  it.each(['2030-10-06', '2031-04-06'])('localDate %s', (target) => {
    const { r, at } = scenario(target);
    expect(fig(r, '1W', 'i1')).toMatchObject({ cents: 8000, startCloseDate: at('2030-09-05') });
    expect(fig(r, '1W', 'i4')).toMatchObject({ cents: 2000 });
    expect(fig(r, '1W', 'i12')).toMatchObject({ status: 'no_start', cents: 1000 });
    expect(fig(r, '1W', 'i13')).toMatchObject({ cents: 200000 });
    expect(fig(r, '2W', 'i13')).toMatchObject({ cents: 700000 });
    expect(period(r, '1W').line!.points).toEqual([
      [at('2030-09-05'), 1000],
      [at('2030-09-06'), 3000],
      [at('2030-09-09'), 1100],
      [at('2030-09-10'), 5200],
      [at('2030-09-11'), 8100],
      [target, 211000],
    ]);
  });
});

// ─── Lines: the downsampling caps ───────────────────────────────────────────────────────────────

describe('long lines', () => {
  it('a year of daily closes: the 12M line ≤ 120 points, a holding’s ≤ 40, first and last kept', () => {
    const closes: [string, string][] = [];
    for (let d = '2029-08-15'; d < THU; d = addDaysIso(d, 1))
      closes.push([
        d,
        D(40)
          .plus(D(daysBetween('2029-08-15', d)).div(100))
          .toFixed(),
      ]);
    const r = run([abcP1({ trades: [['2029-08-20', '100', '40']], closes })], { localDate: THU });
    const p = period(r, '12M');
    expect(p.line!.points).toHaveLength(120);
    expect(p.line!.points[0]![0]).toBe('2029-09-12');
    expect(p.line!.points.at(-1)).toEqual([THU, p.totals.cents]);
    const line = fig(r, '12M', 'i1').line!;
    expect(line.points).toHaveLength(40);
    expect(line.points.at(-1)).toEqual([THU, '50.5']);
    expect(period(r, 'ALL').line!.points).toHaveLength(120);
    expect(PERIOD_ENGINE_VERSION).toBe(1);
  });
});
