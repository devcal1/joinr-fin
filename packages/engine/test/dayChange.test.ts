// The day-change rules (stage-9.md §2, FROZEN): every worked example M1–M26, the DST windows on
// 04/10/2026 and 04/04/2027, the rounding and the downsampling. The process runs in UTC here while
// every zone question is about Melbourne, Sydney, New York or London: the engine must never read
// the process zone (§2.1). Generic values only (made-up symbols, round amounts; the repo is public).
process.env.TZ = 'UTC';

import { JoinrDecimal, type InstrumentKind, type PriceStatus } from '@joinr/schema';
import { describe, expect, it } from 'vitest';
import {
  computeDayChange,
  computeInvestments,
  downsample,
  FUND_DAY_MAX_WEEKDAYS,
  portfolioLine,
  type BullionInput,
  type BullionRowInput,
  type DayChangeInput,
  type DayChangeResult,
  type DayHoldingResult,
  type DayRowInput,
  type HoldingResult,
  type LotResult,
  type OtherAssetResult,
} from '../src/index';
import { instrument, trade } from './helpers';

const MEL = 'Australia/Melbourne';
const SYD = 'Australia/Sydney';
const NY = 'America/New_York';
const D = (v: string | number) => new JoinrDecimal(v);
const cents = (d: InstanceType<typeof JoinrDecimal>) =>
  d.times(100).toDecimalPlaces(0, JoinrDecimal.ROUND_HALF_UP).toNumber();
const ratio = (d: InstanceType<typeof JoinrDecimal>) => {
  const r = d.toSignificantDigits(12, JoinrDecimal.ROUND_HALF_UP);
  return r.isZero() ? '0' : r.toFixed();
};
/** Unix seconds of a UTC ISO instant. */
const s = (iso: string) =>
  Date.UTC(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10)),
    Number(iso.slice(11, 13)),
    Number(iso.slice(14, 16)),
  ) / 1000;
/** Every 5 minutes from `fromIso` to `toIso` (inclusive), each price from `price(i)`. */
function bars(fromIso: string, toIso: string, price: (i: number, n: number) => string) {
  const from = s(fromIso);
  const n = (s(toIso) - from) / 300 + 1;
  return Array.from({ length: n }, (_, i) => [from + i * 300, price(i, n)] as [number, string]);
}
/** A straight walk from `a` to `b` over n points (2 dp). */
const walk = (a: number, b: number) => (i: number, n: number) =>
  D(a)
    .plus(
      D(b - a)
        .times(i)
        .div(Math.max(1, n - 1)),
    )
    .toDecimalPlaces(2)
    .toFixed();

// ─── Builders ───────────────────────────────────────────────────────────────────────────────────

interface Spec {
  id: number;
  kind: InstrumentKind;
  symbol: string;
  /** [tradeDate, units, AUD price]. */
  trades: [string, string, string][];
  price: string | null;
  status?: PriceStatus;
  fetched?: { currency: string; price: string; fxNow: string; asOf: string };
  day?: DayRowInput;
}

function aud(price: string, asOf: string) {
  return { currency: 'AUD', price, fxNow: '1', asOf };
}

function row(
  sessionDate: string,
  previousCloseNative: string | null,
  points: [number, string][],
  over: Partial<DayRowInput> = {},
): DayRowInput {
  return {
    sessionDate,
    timeZone: SYD,
    granularity: '5m',
    nativeCurrency: 'AUD',
    previousCloseNative,
    fxPrev: '1',
    points,
    ...over,
  };
}

function build(
  specs: readonly Spec[],
  o: { localDate: string; generatedAt: string; bullion?: BullionInput[] },
): DayChangeInput {
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
        x.trades.map(([date, units, price]) => {
          tradeId += 1;
          return trade(x.id * 100 + tradeId, x.id, date, units, price);
        }),
      ),
      dividends: [],
      prices: new Map(mine.map((x) => [x.id, { price: x.price, status: x.status ?? 'fresh' }])),
    });
    holdings.push(...result.holdings);
    lots.push(...result.lots);
    for (const x of mine) kinds.set(x.id, kind);
  }
  return {
    timeZone: MEL,
    localDate: o.localDate,
    generatedAt: o.generatedAt,
    holdings,
    kinds,
    lots,
    fetched: new Map(specs.flatMap((x) => (x.fetched ? [[x.id, x.fetched] as const] : []))),
    days: new Map(specs.flatMap((x) => (x.day ? [[x.id, x.day] as const] : []))),
    bullion: o.bullion ?? [],
  };
}

function holding(r: DayChangeResult, key: string): DayHoldingResult {
  const h = r.holdings.find((x) => x.key === key);
  if (!h) throw new Error(`no holding ${key}`);
  return h;
}

/** Every result: totals are the sums, weights sum to 1, the line ends at the day total. */
function expectConsistent(r: DayChangeResult) {
  const values = r.holdings.flatMap((h) => (h.valueCents === null ? [] : [h.valueCents]));
  expect(r.totals.valueCents).toBe(values.reduce((a, b) => a + b, 0));
  const ok = r.holdings.filter((h) => h.dayStatus === 'ok');
  expect(r.totals.dayCents).toBe(
    ok.length === 0 ? null : ok.reduce((a, h) => a + (h.dayCents ?? 0), 0),
  );
  expect(r.totals.holdings).toBe(r.holdings.length);
  expect(r.totals.up + r.totals.down + r.totals.flat).toBe(ok.length);
  expect(r.totals.noChange).toBe(r.holdings.length - ok.length);
  if (r.totals.valueCents > 0) {
    const w = r.holdings.reduce((a, h) => a.plus(h.weightRatio ?? 0), D(0));
    expect(w.minus(1).abs().lessThan(1e-9)).toBe(true);
  }
  if (r.portfolioLine !== null) {
    expect(r.portfolioLine.points.at(-1)![1]).toBe(r.totals.dayCents);
    expect(r.portfolioLine.points.length).toBeLessThanOrEqual(120);
    expect(r.portfolioLine.points.at(-1)![0]).toBe(s(r.portfolioLine.to));
  }
}

// Thursday 12/09/2030 15:20 Melbourne (AEST, UTC+10).
const THU = '2030-09-12';
const THU_NOW = '2030-09-12T05:20:00.000Z';
const THU_ASX = bars('2030-09-12T00:00', '2030-09-12T05:15', walk(50, 50.5));
const THU_AS_OF = '2030-09-12T05:15:00.000Z';

const abc = (over: Partial<Spec> = {}): Spec => ({
  id: 1,
  kind: 'etf',
  symbol: 'ASX:ABC',
  trades: [['2030-09-01', '100', '48']],
  price: '50.5',
  fetched: aud('50.5', THU_AS_OF),
  day: row(THU, '50', THU_ASX),
  ...over,
});

// Bullion (M21–M26): gold rows in AUD, `ozPerUnit` 1.
const MIDNIGHT_THU = s('2030-09-11T14:00');
const B_GOLD = '3076.923076923077'; // 2000 ÷ 0.65 as roundDerived stores it
const P_GOLD = '3045.454545454545'; // 2010 ÷ 0.66

function asset(
  id: number,
  units: string,
  valueCents: number | null,
  over: Partial<OtherAssetResult> = {},
): OtherAssetResult {
  return {
    id,
    remainingUnits: units,
    costCents: null,
    unitPriceAud: P_GOLD,
    valueCents,
    gainCents: null,
    gainRatio: null,
    cagrRatio: null,
    effectiveDate: null,
    dateAssumed: false,
    heldDays: null,
    priceStatus: 'fresh',
    priceAsOf: THU,
    sales: [],
    realisedCents: 0,
    flags: [],
    ...over,
  };
}

function goldRow(
  id: number,
  units: string,
  valueCents: number,
  purchaseDate: string | null,
  unitCostAud: string | null = '2500',
): BullionRowInput {
  return { asset: asset(id, units, valueCents), ozPerUnit: '1', purchaseDate, unitCostAud };
}

function gold(rows: BullionRowInput[], over: Partial<BullionInput> = {}): BullionInput {
  return {
    metal: 'gold',
    rows,
    spot: { audPerOz: P_GOLD, nativePerOz: '2010', fxNow: '1.515151515152', asOf: THU_AS_OF },
    day: row(
      THU,
      B_GOLD,
      [
        [MIDNIGHT_THU, B_GOLD],
        [s('2030-09-12T02:00'), '3060'],
        [s('2030-09-12T05:00'), P_GOLD],
      ],
      { timeZone: MEL },
    ),
    nativeDay: row(
      THU,
      '2000',
      [
        [MIDNIGHT_THU, '2000'],
        [s('2030-09-12T05:00'), '2010'],
      ],
      { timeZone: MEL, nativeCurrency: 'USD' },
    ),
    ...over,
  };
}

const GOLD_ROWS = () => [
  goldRow(31, '6', 1827273, '2030-01-10'),
  goldRow(32, '4', 1218182, '2030-02-10'),
];

const friLine = bars('2030-09-13T00:00', '2030-09-13T06:10', walk(50, 50.5));
const friEtf = (id: number, symbol: string) =>
  abc({
    id,
    symbol,
    fetched: aud('50.5', '2030-09-13T06:10:00.000Z'),
    day: row('2030-09-13', '50', friLine),
  });

// ─── M1–M20: instruments ────────────────────────────────────────────────────────────────────────

describe('computeDayChange: instruments (M1–M20)', () => {
  it('M1 ASX ETF, nothing new: 100 × 0.50 → 5000, ratio 0.01', () => {
    const r = computeDayChange(build([abc()], { localDate: THU, generatedAt: THU_NOW }));
    const h = holding(r, 'i1');
    expect(h).toMatchObject({
      dayStatus: 'ok',
      dayCents: 5000,
      dayRatio: '0.01',
      changePerUnit: '0.5',
      previousClose: '50',
      newUnits: '0',
      laterUnits: '0',
      native: null,
      session: { date: THU, timeZone: SYD, daily: false },
      kind: 'etf',
      instrumentId: 1,
      items: null,
    });
    expect(h.line?.base).toBe('50');
    expectConsistent(r);
  });

  it('M2 bought in the session: 50.00 + 3.00 → 5300; newUnits 10', () => {
    const spec = abc({
      trades: [
        ['2030-09-01', '100', '48'],
        [THU, '10', '50.2'],
      ],
    });
    const h = holding(
      computeDayChange(build([spec], { localDate: THU, generatedAt: THU_NOW })),
      'i1',
    );
    expect(h).toMatchObject({
      dayCents: 5300,
      changePerUnit: '0.5',
      dayRatio: '0.01',
      newUnits: '10',
      units: '110',
    });
  });

  it('M3 sold in the session (FIFO): 60 old × 0.50 → 3000', () => {
    const spec = abc({
      trades: [
        ['2030-09-01', '100', '48'],
        [THU, '-40', '50.4'],
      ],
    });
    const h = holding(
      computeDayChange(build([spec], { localDate: THU, generatedAt: THU_NOW })),
      'i1',
    );
    expect(h).toMatchObject({ dayCents: 3000, units: '60', newUnits: '0' });
  });

  it('M4 US listing with an FX move: −1731, native +1 %, AUD −0.55 %', () => {
    const P = '155.384615385'; // 101 ÷ 0.65 at 12 significant digits
    const exus: Spec = {
      id: 4,
      kind: 'stock',
      symbol: 'NYSE:EXUS',
      trades: [['2030-09-01', '20', '140']],
      price: P,
      fetched: {
        currency: 'USD',
        price: '101',
        fxNow: '1.538461538462',
        asOf: '2030-09-11T20:00:00.000Z',
      },
      day: row('2030-09-11', '100', bars('2030-09-11T13:30', '2030-09-11T20:00', walk(100, 101)), {
        timeZone: NY,
        nativeCurrency: 'USD',
        fxPrev: '1.5625', // 1 ÷ 0.64
      }),
    };
    const r = computeDayChange(build([exus], { localDate: THU, generatedAt: THU_NOW }));
    const h = holding(r, 'i4');
    expect(h.previousClose).toBe('156.25');
    expect(h.dayCents).toBe(-1731);
    expect(h.dayCents).toBe(cents(D(20).times(D(P).minus('156.25'))));
    expect(h.dayRatio).toBe(ratio(D(P).minus('156.25').div('156.25')));
    expect(h.dayRatio!.startsWith('-0.005538')).toBe(true);
    expect(h.native).toEqual({
      currency: 'USD',
      price: '101',
      previousClose: '100',
      dayRatio: '0.01',
    });
    expect(h.session).toEqual({ date: '2030-09-11', timeZone: NY, daily: false });
    expectConsistent(r);
  });

  it('M5 crypto since 00:00: 0.5 × 4000 → 200000, ratio 0.025', () => {
    const btc: Spec = {
      id: 5,
      kind: 'crypto',
      symbol: 'BTC',
      trades: [['2030-08-01', '0.5', '100000']],
      price: '164000',
      fetched: aud('164000', THU_AS_OF),
      day: row(
        THU,
        '160000',
        [
          [MIDNIGHT_THU, '160000'],
          [s('2030-09-12T02:00'), '162000'],
        ],
        { timeZone: MEL },
      ),
    };
    const h = holding(
      computeDayChange(build([btc], { localDate: THU, generatedAt: THU_NOW })),
      'i5',
    );
    expect(h).toMatchObject({ dayStatus: 'ok', dayCents: 200000, dayRatio: '0.025' });
    expect(h.line?.points.at(-1)).toEqual([s('2030-09-12T05:15'), '164000']);
  });

  it('M6 crypto with no chart since midnight → no_base; the value counts', () => {
    const eth: Spec = {
      id: 6,
      kind: 'crypto',
      symbol: 'ETH',
      trades: [['2030-08-01', '2', '4000']],
      price: '5000',
      fetched: aud('5000', THU_AS_OF),
      day: row('2030-09-11', '4900', [[s('2030-09-10T14:00'), '4900']], { timeZone: MEL }),
    };
    const r = computeDayChange(build([eth], { localDate: THU, generatedAt: THU_NOW }));
    expect(holding(r, 'i6')).toMatchObject({
      dayStatus: 'no_base',
      valueCents: 1000000,
      dayCents: null,
      line: null,
    });
    expect(r.totals).toMatchObject({
      valueCents: 1000000,
      dayCents: null,
      dayRatio: null,
      noChange: 1,
    });
    expect(r.portfolioLine).toBeNull();
  });

  const fund = (over: Partial<Spec> = {}): Spec => ({
    id: 7,
    kind: 'managed_fund',
    symbol: '0PEXAMPLE1',
    trades: [['2030-08-01', '1000', '1.4']],
    price: '1.515',
    fetched: aud('1.515', '2030-09-11T06:00:00.000Z'),
    day: row('2030-09-11', '1.5', [[s('2030-09-11T06:00'), '1.515']], { granularity: '1d' }),
    ...over,
  });

  it('M7 a fund priced daily by Yahoo: 1000 × 0.015 → 1500; no line; daily', () => {
    const h = holding(
      computeDayChange(build([fund()], { localDate: THU, generatedAt: THU_NOW })),
      'i7',
    );
    expect(h).toMatchObject({
      dayStatus: 'ok',
      dayCents: 1500,
      line: null,
      session: { date: '2030-09-11', daily: true },
    });
  });

  it('M7 an exchange-quoted fund with 5-minute bars still has no line (D141)', () => {
    const spec = fund({
      fetched: aud('1.515', THU_AS_OF),
      day: row(THU, '1.5', bars('2030-09-12T00:00', '2030-09-12T05:15', walk(1.5, 1.515))),
    });
    const h = holding(
      computeDayChange(build([spec], { localDate: THU, generatedAt: THU_NOW })),
      'i7',
    );
    expect(h).toMatchObject({
      dayStatus: 'ok',
      dayCents: 1500,
      line: null,
      session: { daily: true },
    });
  });

  it('M8 a hand-priced fund: manual; value and weight count; no day', () => {
    const manual: Spec = {
      id: 8,
      kind: 'managed_fund',
      symbol: 'EXAMPLEFUND2',
      trades: [['2030-08-01', '500', '1.8']],
      price: '2',
      status: 'manual',
    };
    const r = computeDayChange(build([abc(), manual], { localDate: THU, generatedAt: THU_NOW }));
    expect(holding(r, 'i8')).toMatchObject({
      dayStatus: 'manual',
      valueCents: 100000,
      dayCents: null,
      priceAsOf: null,
      native: null,
    });
    expect(holding(r, 'i8').weightRatio).not.toBeNull();
    expectConsistent(r);
  });

  it('M9 stale: a Friday price on Tuesday has no day figure', () => {
    const spec = abc({
      status: 'stale',
      fetched: aud('50.5', '2030-09-06T06:10:00.000Z'),
      day: row('2030-09-06', '50', [[s('2030-09-06T06:10'), '50.5']]),
    });
    const r = computeDayChange(
      build([spec], { localDate: '2030-09-10', generatedAt: '2030-09-10T02:00:00.000Z' }),
    );
    expect(holding(r, 'i1')).toMatchObject({
      dayStatus: 'stale',
      dayCents: null,
      valueCents: 505000,
    });
  });

  it('M10 totals: M1 + M2 + M5 + M7 + M8', () => {
    const xyz = abc({ id: 2, symbol: 'ASX:XYZ' });
    const abc2 = abc({
      trades: [
        ['2030-09-01', '100', '48'],
        [THU, '10', '50.2'],
      ],
    });
    const btc: Spec = {
      id: 5,
      kind: 'crypto',
      symbol: 'BTC',
      trades: [['2030-08-01', '0.5', '100000']],
      price: '164000',
      fetched: aud('164000', THU_AS_OF),
      day: row(THU, '160000', [[MIDNIGHT_THU, '160000']], { timeZone: MEL }),
    };
    const manual: Spec = {
      id: 8,
      kind: 'managed_fund',
      symbol: 'EXAMPLEFUND2',
      trades: [['2030-08-01', '500', '1.8']],
      price: '2',
      status: 'manual',
    };
    const r = computeDayChange(
      build([xyz, abc2, btc, fund(), manual], { localDate: THU, generatedAt: THU_NOW }),
    );
    expect(r.totals.dayCents).toBe(5000 + 5300 + 200000 + 1500);
    const okValues = 505000 + 555500 + 8200000 + 151500;
    expect(r.totals.baseCents).toBe(okValues - (5000 + 5300 + 200000 + 1500));
    expect(r.totals.dayRatio).toBe(ratio(D(211800).div(r.totals.baseCents!)));
    expect(r.totals).toMatchObject({
      up: 4,
      down: 0,
      flat: 0,
      noChange: 1,
      holdings: 5,
      valueCents: okValues + 100000,
    });
    expectConsistent(r);
  });

  it('M11 Saturday 11:00: the ETF shows Friday; the line runs 00:00 → now; the ETF counts in full from 00:00', () => {
    const fri = bars('2030-09-13T00:00', '2030-09-13T06:10', walk(50, 50.5));
    const etf = abc({
      fetched: aud('50.5', '2030-09-13T06:10:00.000Z'),
      day: row('2030-09-13', '50', fri),
    });
    const midnight = s('2030-09-13T14:00');
    const btc: Spec = {
      id: 5,
      kind: 'crypto',
      symbol: 'BTC',
      trades: [['2030-08-01', '0.5', '100000']],
      price: '161000',
      fetched: aud('161000', '2030-09-14T00:45:00.000Z'),
      day: row(
        '2030-09-14',
        '160000',
        [
          [midnight, '160000'],
          [s('2030-09-13T20:00'), '162000'],
          [s('2030-09-14T00:45'), '161000'],
        ],
        { timeZone: MEL },
      ),
    };
    const r = computeDayChange(
      build([etf, btc], { localDate: '2030-09-14', generatedAt: '2030-09-14T01:00:00.000Z' }),
    );
    expect(holding(r, 'i1')).toMatchObject({
      dayStatus: 'ok',
      dayCents: 5000,
      session: { date: '2030-09-13' },
    });
    const line = r.portfolioLine!;
    expect(line).toMatchObject({
      from: '2030-09-13T14:00:00.000Z',
      to: '2030-09-14T01:00:00.000Z',
      sessionDate: '2030-09-14',
    });
    expect(line.points[0]).toEqual([midnight, 5000]); // the ETF's final value + BTC at its base
    expect(line.points[1]).toEqual([midnight + 300, 5000]);
    expectConsistent(r);
  });

  it("M12 Monday 08:00 without crypto: the line is Friday's session", () => {
    const r = computeDayChange(
      build([friEtf(1, 'ASX:ABC'), friEtf(2, 'ASX:XYZ')], {
        localDate: '2030-09-16',
        generatedAt: '2030-09-15T22:00:00.000Z',
      }),
    );
    const line = r.portfolioLine!;
    expect(line).toMatchObject({
      from: '2030-09-13T00:00:00.000Z',
      to: '2030-09-13T06:10:00.000Z',
      sessionDate: '2030-09-13',
    });
    expect(line.points).toHaveLength(75);
    expect(line.points[0]).toEqual([s('2030-09-13T00:00'), 0]);
    expect(line.points.at(-1)).toEqual([s('2030-09-13T06:10'), 10000]);
    expectConsistent(r);
  });

  it('M13 a pre-open fetch with no bars: the kept Friday row and its price still give Friday', () => {
    // The server keeps the row and writes only the price; the price's as-of is still Friday's close.
    const r = computeDayChange(
      build([friEtf(1, 'ASX:ABC')], {
        localDate: '2030-09-16',
        generatedAt: '2030-09-15T21:30:00.000Z',
      }),
    );
    expect(holding(r, 'i1')).toMatchObject({
      dayStatus: 'ok',
      dayCents: 5000,
      session: { date: '2030-09-13' },
    });
  });

  it('M14 rounding: three holdings of 0.005 → 1 cent each, total 3 (never 2)', () => {
    const specs = [1, 2, 3].map((id) =>
      abc({
        id,
        symbol: `ASX:T${id}`,
        trades: [['2030-09-01', '1', '1']],
        price: '1.005',
        fetched: aud('1.005', THU_AS_OF),
        day: row(THU, '1', [[s('2030-09-12T00:00'), '1']]),
      }),
    );
    const r = computeDayChange(build(specs, { localDate: THU, generatedAt: THU_NOW }));
    expect(r.holdings.map((h) => h.dayCents)).toEqual([1, 1, 1]);
    expect(r.totals.dayCents).toBe(3);
    expectConsistent(r);
  });

  it('M15 a lot after the session adds nothing: day 1500, laterUnits 200, base 150000', () => {
    const spec = fund({
      trades: [
        ['2030-08-01', '1000', '1.4'],
        ['2030-09-13', '200', '1.51'],
      ],
      day: row(THU, '1.5', [[s('2030-09-12T06:00'), '1.515']], { granularity: '1d' }),
      fetched: aud('1.515', '2030-09-12T06:00:00.000Z'),
    });
    const r = computeDayChange(
      build([spec], { localDate: '2030-09-13', generatedAt: '2030-09-13T02:00:00.000Z' }),
    );
    expect(holding(r, 'i7')).toMatchObject({
      dayCents: 1500,
      laterUnits: '200',
      newUnits: '0',
      valueCents: 181800,
    });
    expect(r.totals.baseCents).toBe(181800 - 1500 - 30300);
    expect(r.totals.baseCents).toBe(150000);
  });

  it('M16 a US lot dated the next Melbourne day: after-session, then new from its price', () => {
    const P = '160';
    const spec = (session: string, asOf: string): Spec => ({
      id: 4,
      kind: 'stock',
      symbol: 'NYSE:EXUS',
      trades: [
        ['2030-09-01', '20', '140'],
        ['2030-09-13', '10', '150'],
      ],
      price: P,
      fetched: { currency: 'USD', price: '100', fxNow: '1.6', asOf },
      day: row(session, '98', [[s(asOf.slice(0, 16)), '100']], {
        timeZone: NY,
        nativeCurrency: 'USD',
        fxPrev: '1.6',
      }),
    });
    const thursday = holding(
      computeDayChange(
        build([spec('2030-09-12', '2030-09-12T20:00:00.000Z')], {
          localDate: '2030-09-13',
          generatedAt: '2030-09-12T22:00:00.000Z',
        }),
      ),
      'i4',
    );
    expect(thursday).toMatchObject({
      dayStatus: 'ok',
      laterUnits: '10',
      newUnits: '0',
      dayCents: cents(D(20).times(D(P).minus('156.8'))),
    });
    const friday = holding(
      computeDayChange(
        build([spec('2030-09-13', '2030-09-13T20:00:00.000Z')], {
          localDate: '2030-09-14',
          generatedAt: '2030-09-13T22:00:00.000Z',
        }),
      ),
      'i4',
    );
    expect(friday).toMatchObject({ dayStatus: 'ok', laterUnits: '0', newUnits: '10' });
    expect(friday.dayCents).toBe(
      cents(
        D(20)
          .times(D(P).minus('156.8'))
          .plus(D(10).times(D(P).minus(150))),
      ),
    );
  });

  it('M17 a fund NAV lag (D150): Monday ok with Thursday’s NAV; Tuesday stale', () => {
    expect(FUND_DAY_MAX_WEEKDAYS).toBe(2);
    const spec = fund({
      status: 'stale',
      fetched: aud('1.515', '2030-09-12T06:00:00.000Z'),
      day: row(THU, '1.5', [[s('2030-09-12T06:00'), '1.515']], { granularity: '1d' }),
    });
    const monday = holding(
      computeDayChange(
        build([spec], { localDate: '2030-09-16', generatedAt: '2030-09-16T02:00:00.000Z' }),
      ),
      'i7',
    );
    expect(monday).toMatchObject({
      dayStatus: 'ok',
      priceStatus: 'stale',
      dayCents: 1500,
      session: { date: THU, daily: true },
    });
    const tuesday = holding(
      computeDayChange(
        build([spec], { localDate: '2030-09-17', generatedAt: '2030-09-17T02:00:00.000Z' }),
      ),
      'i7',
    );
    expect(tuesday).toMatchObject({ dayStatus: 'stale', dayCents: null });
    // A failed price is never let through, and the exception is for managed funds only.
    const failed = holding(
      computeDayChange(
        build([{ ...spec, status: 'failed' }], {
          localDate: '2030-09-16',
          generatedAt: '2030-09-16T02:00:00.000Z',
        }),
      ),
      'i7',
    );
    expect(failed.dayStatus).toBe('stale');
    const etf = holding(
      computeDayChange(
        build([{ ...spec, kind: 'etf', symbol: 'ASX:DEF' }], {
          localDate: '2030-09-16',
          generatedAt: '2030-09-16T02:00:00.000Z',
        }),
      ),
      'i7',
    );
    expect(etf.dayStatus).toBe('stale');
  });

  it('M18 a GBp listing: B 4.655, P 4.775 → 1200; native and AUD ratios', () => {
    const spec: Spec = {
      id: 9,
      kind: 'stock',
      symbol: 'LON:EXGB',
      trades: [['2030-09-01', '100', '4']],
      price: '4.775',
      fetched: { currency: 'GBp', price: '250', fxNow: '0.0191', asOf: '2030-09-12T15:30:00.000Z' },
      day: row(THU, '245', [[s('2030-09-12T15:30'), '250']], {
        timeZone: 'Europe/London',
        nativeCurrency: 'GBp',
        fxPrev: '0.019',
      }),
    };
    const h = holding(
      computeDayChange(
        build([spec], { localDate: '2030-09-13', generatedAt: '2030-09-12T16:00:00.000Z' }),
      ),
      'i9',
    );
    expect(h).toMatchObject({
      previousClose: '4.655',
      dayCents: 1200,
      dayRatio: '0.0257787325456',
    });
    expect(h.native).toEqual({
      currency: 'GBp',
      price: '250',
      previousClose: '245',
      dayRatio: '0.0204081632653',
    });
  });

  it("M19 a price newer than the day row → no_base (never Tuesday's price against Monday's base)", () => {
    const spec = abc({
      fetched: aud('51', '2030-09-17T00:25:00.000Z'),
      price: '51',
      day: row('2030-09-16', '50', [[s('2030-09-16T06:10'), '50.5']]),
    });
    const h = holding(
      computeDayChange(
        build([spec], { localDate: '2030-09-17', generatedAt: '2030-09-17T00:30:00.000Z' }),
      ),
      'i1',
    );
    expect(h).toMatchObject({ dayStatus: 'no_base', dayCents: null, line: null });
  });

  it('M19 a currency change between the price and the row → no_base; native keeps no base', () => {
    const spec: Spec = {
      id: 4,
      kind: 'stock',
      symbol: 'NYSE:EXUS',
      trades: [['2030-09-01', '20', '140']],
      price: '155',
      fetched: { currency: 'USD', price: '101', fxNow: '1.535', asOf: '2030-09-11T20:00:00.000Z' },
      day: row('2030-09-11', '100', [], { timeZone: NY, nativeCurrency: 'CAD', fxPrev: '1.1' }),
    };
    const h = holding(
      computeDayChange(build([spec], { localDate: THU, generatedAt: THU_NOW })),
      'i4',
    );
    expect(h.dayStatus).toBe('no_base');
    expect(h.native).toEqual({
      currency: 'USD',
      price: '101',
      previousClose: null,
      dayRatio: null,
    });
  });

  it('M20 two sessions on the same Friday: the window comes from the EXUS line; the ASX line holds its final value', () => {
    const exus: Spec = {
      id: 4,
      kind: 'stock',
      symbol: 'NYSE:EXUS',
      trades: [['2030-09-01', '20', '140']],
      price: '161.6',
      fetched: { currency: 'USD', price: '101', fxNow: '1.6', asOf: '2030-09-13T20:00:00.000Z' },
      day: row('2030-09-13', '100', bars('2030-09-13T13:30', '2030-09-13T20:00', walk(100, 101)), {
        timeZone: NY,
        nativeCurrency: 'USD',
        fxPrev: '1.6',
      }),
    };
    const r = computeDayChange(
      build([friEtf(1, 'ASX:ABC'), exus], {
        localDate: '2030-09-14',
        generatedAt: '2030-09-13T22:00:00.000Z',
      }),
    );
    const line = r.portfolioLine!;
    // EXUS's bars after 00:00 Melbourne are dated Saturday: the window starts at its first one.
    expect(line).toMatchObject({
      from: '2030-09-13T14:00:00.000Z',
      to: '2030-09-13T22:00:00.000Z',
      sessionDate: '2030-09-14',
    });
    const exusAt = (p: string) => cents(D(20).times(D(p).times('1.6').minus(160)));
    const at14 = bars('2030-09-13T13:30', '2030-09-13T20:00', walk(100, 101)).find(
      ([t]) => t === s('2030-09-13T14:00'),
    )![1];
    expect(line.points[0]).toEqual([s('2030-09-13T14:00'), 5000 + exusAt(at14)]);
    expectConsistent(r);
  });
});

// ─── M21–M26: bullion (D148, D153) ──────────────────────────────────────────────────────────────

describe('computeDayChange: bullion (M21–M26)', () => {
  it('M21 nothing new: GOLD, 10 oz, 2 items; −31469; USD +0.5 %', () => {
    const r = computeDayChange(
      build([], { localDate: THU, generatedAt: THU_NOW, bullion: [gold(GOLD_ROWS())] }),
    );
    const h = holding(r, 'bullion-gold');
    expect(h).toMatchObject({
      instrumentId: null,
      kind: 'bullion',
      metal: 'gold',
      units: '10',
      items: 2,
      price: P_GOLD,
      priceStatus: 'fresh',
      previousClose: B_GOLD,
      dayStatus: 'ok',
      dayCents: -31469,
      changePerUnit: '-31.468531468532',
      dayRatio: '-0.0102272727273',
      valueCents: 1827273 + 1218182,
      session: { date: THU, timeZone: MEL, daily: false },
      priceAsOf: THU_AS_OF,
    });
    expect(h.native).toEqual({
      currency: 'USD',
      price: '2010',
      previousClose: '2000',
      dayRatio: '0.005',
    });
    expect(h.line).toMatchObject({ base: B_GOLD, timeZone: MEL, sessionDate: THU });
    expect(h.line!.points[0]).toEqual([MIDNIGHT_THU, B_GOLD]);
    expect(h.line!.points.at(-1)).toEqual([s('2030-09-12T05:15'), P_GOLD]);
    expect(r.totals.valueCents).toBe(3045455);
    expect(r.portfolioLine).toMatchObject({ from: '2030-09-11T14:00:00.000Z', sessionDate: THU });
    expect(r.portfolioLine!.points[0]).toEqual([MIDNIGHT_THU, 0]);
    expectConsistent(r);
  });

  it('M22 bought today: the 2 oz from 3050.00 → −32378; newUnits 2', () => {
    const rows = [...GOLD_ROWS(), goldRow(33, '2', 609091, THU, '3050')];
    const h = holding(
      computeDayChange(build([], { localDate: THU, generatedAt: THU_NOW, bullion: [gold(rows)] })),
      'bullion-gold',
    );
    expect(h).toMatchObject({ dayCents: -32378, newUnits: '2', units: '12', items: 3 });
  });

  it('M23 a purchase dated after today: the 2 oz add 0; base 3076924', () => {
    const rows = [...GOLD_ROWS(), goldRow(33, '2', 609091, '2030-09-13', '3050')];
    const r = computeDayChange(
      build([], { localDate: THU, generatedAt: THU_NOW, bullion: [gold(rows)] }),
    );
    expect(holding(r, 'bullion-gold')).toMatchObject({
      dayCents: -31469,
      laterUnits: '2',
      valueCents: 3654546,
    });
    expect(r.totals.baseCents).toBe(3654546 + 31469 - 609091);
    expect(r.totals.baseCents).toBe(3076924);
  });

  it('M22 a new row without a known cost is measured from B (as old)', () => {
    const rows = [...GOLD_ROWS(), goldRow(33, '2', 609091, THU, null)];
    const h = holding(
      computeDayChange(build([], { localDate: THU, generatedAt: THU_NOW, bullion: [gold(rows)] })),
      'bullion-gold',
    );
    expect(h).toMatchObject({
      newUnits: '0',
      dayCents: cents(D(12).times(D(P_GOLD).minus(B_GOLD))),
    });
  });

  // Saturday 14/09 to Monday 16/09/2030 (AEST): the futures closed Saturday 07:00 Melbourne
  // (21:00Z Friday) and reopen Monday 08:00 (22:00Z Sunday).
  const closeAt = '2030-09-13T21:00:00.000Z';
  const spotAt = (audPerOz: string, asOf: string) => ({
    audPerOz,
    nativePerOz: '2000',
    fxNow: '1.5',
    asOf,
  });
  const goldOn = (
    date: string,
    base: string,
    points: [number, string][],
    spot: ReturnType<typeof spotAt>,
  ) =>
    gold(GOLD_ROWS(), { spot, day: row(date, base, points, { timeZone: MEL }), nativeDay: null });

  it('M24 Saturday: the move from 00:00 to the close, flat after it', () => {
    const midnight = s('2030-09-13T14:00');
    const pts: [number, string][] = [
      [midnight, '3000'],
      [s('2030-09-13T18:00'), '3005'],
      [s('2030-09-13T21:00'), '3010'],
    ];
    const r = computeDayChange(
      build([], {
        localDate: '2030-09-14',
        generatedAt: '2030-09-14T01:00:00.000Z',
        bullion: [goldOn('2030-09-14', '3000', pts, spotAt('3010', closeAt))],
      }),
    );
    expect(holding(r, 'bullion-gold')).toMatchObject({ dayStatus: 'ok', dayCents: 10000 });
    const after = r.portfolioLine!.points.filter(([t]) => t >= s('2030-09-13T21:00'));
    expect(new Set(after.map(([, c]) => c))).toEqual(new Set([10000]));
    expectConsistent(r);
  });

  it('M24 Sunday: ok, day 0, flat 1, a one-point line (the base is the closing spot)', () => {
    const midnight = s('2030-09-14T14:00');
    const r = computeDayChange(
      build([], {
        localDate: '2030-09-15',
        generatedAt: '2030-09-15T01:00:00.000Z',
        bullion: [goldOn('2030-09-15', '3010', [[midnight, '3010']], spotAt('3010', closeAt))],
      }),
    );
    const h = holding(r, 'bullion-gold');
    expect(h).toMatchObject({ dayStatus: 'ok', dayCents: 0, dayRatio: '0', changePerUnit: '0' });
    expect(h.line!.points).toEqual([[midnight, '3010']]);
    expect(r.totals).toMatchObject({ flat: 1, up: 0, down: 0, dayCents: 0 });
    expect(new Set(r.portfolioLine!.points.map(([, c]) => c))).toEqual(new Set([0]));
    expectConsistent(r);
  });

  it("M24 Monday after the reopen: the move since 00:00 = since Friday's closing spot", () => {
    const midnight = s('2030-09-15T14:00');
    const pts: [number, string][] = [
      [midnight, '3010'],
      [s('2030-09-15T22:00'), '3015'],
      [s('2030-09-15T23:15'), '3020'],
    ];
    const r = computeDayChange(
      build([], {
        localDate: '2030-09-16',
        generatedAt: '2030-09-15T23:30:00.000Z',
        bullion: [goldOn('2030-09-16', '3010', pts, spotAt('3020', '2030-09-15T23:15:00.000Z'))],
      }),
    );
    expect(holding(r, 'bullion-gold')).toMatchObject({ dayStatus: 'ok', dayCents: 10000 });
    expectConsistent(r);
  });

  it('M24 a bullion row from yesterday (no write since 00:00) → no_base', () => {
    const r = computeDayChange(
      build([], {
        localDate: '2030-09-16',
        generatedAt: '2030-09-15T23:30:00.000Z',
        bullion: [
          goldOn('2030-09-15', '3010', [[s('2030-09-14T14:00'), '3010']], spotAt('3010', closeAt)),
        ],
      }),
    );
    expect(holding(r, 'bullion-gold')).toMatchObject({ dayStatus: 'no_base', dayCents: null });
  });

  it('M25 Monday 08:00 with bullion and no crypto: window 00:00 → 08:00; ASX final throughout; gold 0', () => {
    const midnight = s('2030-09-15T14:00');
    const goldMonday = goldOn('2030-09-16', '3010', [[midnight, '3010']], spotAt('3010', closeAt));
    const r = computeDayChange(
      build([friEtf(1, 'ASX:ABC')], {
        localDate: '2030-09-16',
        generatedAt: '2030-09-15T22:00:00.000Z',
        bullion: [goldMonday],
      }),
    );
    const line = r.portfolioLine!;
    expect(line).toMatchObject({
      from: '2030-09-15T14:00:00.000Z',
      to: '2030-09-15T22:00:00.000Z',
      sessionDate: '2030-09-16',
    });
    expect(line.points).toHaveLength(97);
    expect(new Set(line.points.map(([, c]) => c))).toEqual(new Set([5000]));
    expect(holding(r, 'bullion-gold')).toMatchObject({ dayCents: 0 });
    expectConsistent(r);
  });

  it('M26 bullion without a spot: stale from the rows’ fallback values; no day figure', () => {
    const rows: BullionRowInput[] = [
      {
        asset: asset(31, '6', 1800000, { unitPriceAud: '3000', priceStatus: 'stale' }),
        ozPerUnit: '1',
        purchaseDate: null,
        unitCostAud: '2500',
      },
      {
        asset: asset(32, '4', 1200000, { unitPriceAud: '3000', priceStatus: 'stale' }),
        ozPerUnit: '1',
        purchaseDate: null,
        unitCostAud: '2500',
      },
    ];
    const r = computeDayChange(
      build([], { localDate: THU, generatedAt: THU_NOW, bullion: [gold(rows, { spot: null })] }),
    );
    expect(holding(r, 'bullion-gold')).toMatchObject({
      dayStatus: 'stale',
      priceStatus: 'stale',
      valueCents: 3000000,
      dayCents: null,
      price: '3000',
      native: null,
    });
    expect(r.totals).toMatchObject({ noChange: 1, dayCents: null });
  });

  it('a bullion row in ounces per unit: units = remaining × ozPerUnit; rows without a price → unpriced', () => {
    const half: BullionRowInput = {
      asset: asset(40, '20', null, { unitPriceAud: null, priceStatus: 'none' }),
      ozPerUnit: '0.5',
      purchaseDate: null,
      unitCostAud: null,
    };
    const r = computeDayChange(
      build([], {
        localDate: THU,
        generatedAt: THU_NOW,
        bullion: [{ ...gold([half]), metal: 'silver', spot: null }],
      }),
    );
    expect(holding(r, 'bullion-silver')).toMatchObject({
      units: '10',
      dayStatus: 'unpriced',
      valueCents: null,
      priceStatus: 'none',
    });
  });
});

// ─── The DST windows (§2.7; the process runs in UTC) ────────────────────────────────────────────

describe('the portfolio line across DST (Australia/Melbourne)', () => {
  it('runs in a UTC process (the file sets TZ)', () => {
    expect(new Date(2026, 9, 3).toISOString()).toBe('2026-10-03T00:00:00.000Z');
  });

  it('M11 on Sunday 04/10/2026 (02:00 → 03:00): the window starts at 00:00 AEST and steps 5 minutes', () => {
    const midnight = s('2026-10-03T14:00'); // 00:00 AEST
    const fri = bars('2026-10-02T00:00', '2026-10-02T06:10', walk(50, 50.5));
    const etf = abc({
      trades: [['2026-09-01', '100', '48']],
      fetched: aud('50.5', '2026-10-02T06:10:00.000Z'),
      day: row('2026-10-02', '50', fri),
    });
    const crypto = bars('2026-10-03T14:00', '2026-10-03T21:30', walk(160000, 161000));
    const btc: Spec = {
      id: 5,
      kind: 'crypto',
      symbol: 'BTC',
      trades: [['2026-08-01', '0.5', '100000']],
      price: '161000',
      fetched: aud('161000', '2026-10-03T21:30:00.000Z'),
      day: row('2026-10-04', '160000', crypto, { timeZone: MEL }),
    };
    // 09:00 AEDT = 22:00Z: 8 hours of the 23-hour day.
    const r = computeDayChange(
      build([etf, btc], { localDate: '2026-10-04', generatedAt: '2026-10-03T22:00:00.000Z' }),
    );
    const line = r.portfolioLine!;
    expect(line).toMatchObject({
      from: '2026-10-03T14:00:00.000Z',
      to: '2026-10-03T22:00:00.000Z',
      sessionDate: '2026-10-04',
    });
    expect(line.points).toHaveLength(97);
    for (let i = 1; i < line.points.length; i += 1)
      expect(line.points[i]![0] - line.points[i - 1]![0]).toBe(300);
    expect(line.points[0]).toEqual([midnight, 5000]);
    expectConsistent(r);
  });

  it("M12 on Monday 05/10/2026 08:00 AEDT (21:00Z Sunday): Friday's sessions, never the UTC date", () => {
    const fri = bars('2026-10-02T00:00', '2026-10-02T06:10', walk(50, 50.5));
    const etf = abc({
      trades: [['2026-09-01', '100', '48']],
      fetched: aud('50.5', '2026-10-02T06:10:00.000Z'),
      day: row('2026-10-02', '50', fri),
    });
    const exus: Spec = {
      id: 4,
      kind: 'stock',
      symbol: 'NYSE:EXUS',
      trades: [['2026-09-01', '20', '140']],
      price: '161.6',
      fetched: { currency: 'USD', price: '101', fxNow: '1.6', asOf: '2026-10-02T20:00:00.000Z' },
      day: row('2026-10-02', '100', bars('2026-10-02T13:30', '2026-10-02T20:00', walk(100, 101)), {
        timeZone: NY,
        nativeCurrency: 'USD',
        fxPrev: '1.6',
      }),
    };
    const r = computeDayChange(
      build([etf, exus], { localDate: '2026-10-05', generatedAt: '2026-10-04T21:00:00.000Z' }),
    );
    // No point is dated Monday in Melbourne: the line whose last point is the latest (EXUS).
    expect(r.portfolioLine).toMatchObject({
      from: '2026-10-02T13:30:00.000Z',
      to: '2026-10-02T20:00:00.000Z',
      sessionDate: '2026-10-02',
    });
    expect(r.portfolioLine!.points[0]![1]).toBe(5000);
    expectConsistent(r);
  });

  it('M25 on Sunday 04/04/2027 (03:00 → 02:00, a 25-hour day): gold from 00:00 AEDT; the repeated hour', () => {
    const midnight = s('2027-04-03T13:00'); // 00:00 AEDT
    const fri = bars('2027-04-01T23:00', '2027-04-02T05:10', walk(50, 50.5)); // Friday 10:00–16:10 AEDT
    const etf = abc({
      trades: [['2027-03-01', '100', '48']],
      fetched: aud('50.5', '2027-04-02T05:10:00.000Z'),
      day: row('2027-04-02', '50', fri),
    });
    const goldSunday = gold(
      GOLD_ROWS().map((x) => ({ ...x, purchaseDate: null })),
      {
        spot: {
          audPerOz: '3010',
          nativePerOz: '2000',
          fxNow: '1.5',
          asOf: '2027-04-02T21:00:00.000Z',
        },
        day: row('2027-04-04', '3010', [[midnight, '3010']], { timeZone: MEL }),
        nativeDay: null,
      },
    );
    const btc: Spec = {
      id: 5,
      kind: 'crypto',
      symbol: 'BTC',
      trades: [['2027-01-01', '0.5', '100000']],
      price: '160000',
      fetched: aud('160000', '2027-04-03T16:30:00.000Z'),
      // 02:30 AEDT, 02:00 AEST, 02:30 AEST: the repeated hour, all dated 04/04.
      day: row(
        '2027-04-04',
        '160000',
        [
          [midnight, '160000'],
          [s('2027-04-03T15:30'), '160000'],
          [s('2027-04-03T16:00'), '160000'],
          [s('2027-04-03T16:30'), '160000'],
        ],
        { timeZone: MEL },
      ),
    };
    // 08:00 AEST = 22:00Z.
    const r = computeDayChange(
      build([etf, btc], {
        localDate: '2027-04-04',
        generatedAt: '2027-04-03T22:00:00.000Z',
        bullion: [goldSunday],
      }),
    );
    const line = r.portfolioLine!;
    expect(line).toMatchObject({
      from: '2027-04-03T13:00:00.000Z',
      to: '2027-04-03T22:00:00.000Z',
      sessionDate: '2027-04-04',
    });
    expect(line.points).toHaveLength(109);
    expect(new Set(line.points.map(([, c]) => c))).toEqual(new Set([5000]));
    expectConsistent(r);
  });
});

// ─── downsample and the line's edges ────────────────────────────────────────────────────────────

describe('downsample and portfolioLine', () => {
  it('keeps short lists, and the first and last of long ones', () => {
    expect(downsample([1, 2, 3], 5)).toEqual([1, 2, 3]);
    const long = Array.from({ length: 289 }, (_, i) => i);
    const out = downsample(long, 120);
    expect(out).toHaveLength(120);
    expect(out[0]).toBe(0);
    expect(out.at(-1)).toBe(288);
    expect(out[1]).toBe(Math.round(288 / 119));
    expect(downsample(long, 1)).toEqual([288]);
    expect(downsample(long, 0)).toEqual([]);
  });

  it('downsamples a long portfolio line to LINE_MAX_POINTS, ending at the total', () => {
    const crypto = bars('2030-09-11T14:00', '2030-09-12T05:15', walk(160000, 162000));
    const btc: Spec = {
      id: 5,
      kind: 'crypto',
      symbol: 'BTC',
      trades: [['2030-08-01', '0.5', '100000']],
      price: '164000',
      fetched: aud('164000', THU_AS_OF),
      day: row(THU, '160000', crypto, { timeZone: MEL }),
    };
    const r = computeDayChange(build([btc], { localDate: THU, generatedAt: THU_NOW }));
    expect(r.portfolioLine!.points).toHaveLength(120);
    expect(r.portfolioLine!.points.at(-1)).toEqual([s('2030-09-12T05:20'), 200000]);
    expectConsistent(r);
  });

  it('is null without a line; a daily fund contributes its day throughout', () => {
    expect(
      portfolioLine({
        timeZone: MEL,
        localDate: THU,
        generatedAt: THU_NOW,
        holdings: [{ dayCents: 1500, line: null }],
      }),
    ).toBeNull();
    const r = portfolioLine({
      timeZone: MEL,
      localDate: THU,
      generatedAt: THU_NOW,
      holdings: [
        { dayCents: 1500, line: null },
        {
          dayCents: 100,
          line: {
            sessionDate: THU,
            points: [[s('2030-09-12T05:00'), '2']],
            fxNow: '1',
            oldUnits: '100',
            newLots: [],
            base: '1.99',
          },
        },
      ],
    })!;
    expect(r.from).toBe('2030-09-12T05:00:00.000Z');
    expect(r.points).toEqual([
      [s('2030-09-12T05:00'), 1600],
      [s('2030-09-12T05:05'), 1600],
      [s('2030-09-12T05:10'), 1600],
      [s('2030-09-12T05:15'), 1600],
      [s('2030-09-12T05:20'), 1600],
    ]);
  });

  it('a line holding contributes 0 before its first point', () => {
    const r = portfolioLine({
      timeZone: MEL,
      localDate: THU,
      generatedAt: '2030-09-12T00:20:00.000Z',
      holdings: [
        {
          dayCents: 300,
          line: {
            sessionDate: THU,
            points: [
              [MIDNIGHT_THU, '10'],
              [s('2030-09-12T00:10'), '13'],
            ],
            fxNow: '1',
            oldUnits: '1',
            newLots: [],
            base: '10',
          },
        },
        {
          dayCents: 50,
          line: {
            sessionDate: THU,
            points: [[s('2030-09-12T00:00'), '1.5']],
            fxNow: '1',
            oldUnits: '100',
            newLots: [{ units: '10', price: '1.6' }],
            base: '1.5',
          },
        },
      ],
    })!;
    expect(r.points[0]).toEqual([MIDNIGHT_THU, 0]);
    expect(r.points.at(-1)).toEqual([s('2030-09-12T00:20'), 350]);
    const at0 = r.points.find(([t]) => t === s('2030-09-12T00:00'))!;
    expect(at0[1]).toBe(cents(D(10).times('-0.1'))); // BTC flat at its base; the new lot below its price
  });
});
