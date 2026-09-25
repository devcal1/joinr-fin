// Investments request schemas and instrument helpers (stage-2.md §4.3, §7.2 step 2).
import { describe, expect, it } from 'vitest';
import {
  decimalFromNumber,
  feeSpecInputSchema,
  idParamsSchema,
  instrumentCreateSchema,
  instrumentEditableFromDto,
  instrumentKindIssues,
  instrumentUpdateSchema,
  investmentKindParamsSchema,
  makeInstrumentUpdateSchema,
  makeTradeInputSchema,
  normaliseInstrumentEditable,
  normaliseInstrumentSymbol,
  ratioInputSchema,
  tradeDecimalSchema,
  type InstrumentEditable,
  type InstrumentEditableBody,
  type TradeInputBody,
} from '../src/index';
import { instrumentDtoById, instrumentDtos } from '../src/fixtures/index';

/** 14:32 local time on Thursday 24/09/2026: tomorrow is 25/09/2026. */
const NOW = () => new Date(2026, 8, 24, 14, 32);
const tradeSchema = makeTradeInputSchema(NOW);

const baseTrade: TradeInputBody = {
  instrumentId: 1,
  side: 'buy',
  tradeDate: '2026-09-24',
  quantity: { mode: 'units', units: '10' },
  price: '12.5',
  fee: { kind: 'flat', cents: 1000 },
};

const issuesOf = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  (result.error?.issues ?? []).map((i) => i.path.map(String).join('.'));

describe('params', () => {
  it('accepts the four kinds only', () => {
    expect(investmentKindParamsSchema.parse({ kind: 'managed_fund' })).toEqual({
      kind: 'managed_fund',
    });
    expect(investmentKindParamsSchema.safeParse({ kind: 'bond' }).success).toBe(false);
  });

  it('parses a positive integer id', () => {
    expect(idParamsSchema.parse({ id: '7' })).toEqual({ id: 7 });
    for (const bad of ['0', '07', '-1', '1.5', 'x', '12345678901234567']) {
      expect(idParamsSchema.safeParse({ id: bad }).success, bad).toBe(false);
    }
  });
});

describe('trade input', () => {
  it('parses units mode and normalises the decimals', () => {
    const parsed = tradeSchema.parse({
      ...baseTrade,
      quantity: { mode: 'units', units: '10.50' },
      price: '12.500',
      note: '  first buy  ',
    });
    expect(parsed.quantity).toEqual({ mode: 'units', units: '10.5' });
    expect(parsed.price).toBe('12.5');
    expect(parsed.note).toBe('first buy');
  });

  it('parses amount mode (D38)', () => {
    const parsed = tradeSchema.parse({
      ...baseTrade,
      quantity: { mode: 'amount', amountCents: 50000 },
    });
    expect(parsed.quantity).toEqual({ mode: 'amount', amountCents: 50000 });
    for (const amountCents of [0, -1, 1.5, 1e13 + 1]) {
      const r = tradeSchema.safeParse({ ...baseTrade, quantity: { mode: 'amount', amountCents } });
      expect(r.success, String(amountCents)).toBe(false);
    }
  });

  it('accepts up to 18 decimal places and 15 significant digits', () => {
    const units = (u: string) =>
      tradeSchema.safeParse({ ...baseTrade, quantity: { mode: 'units', units: u } });
    expect(units('0.000000000000000001').success).toBe(true); // 18 dp
    expect(units('0.0000000000000000001').success).toBe(false); // 19 dp
    expect(units('123456789.123456').success).toBe(true); // 15 significant digits
    expect(units('123456789.1234567').success).toBe(false); // 16
    expect(units(decimalFromNumber(0.000012345678901234)).success).toBe(true);
    expect(tradeDecimalSchema(1e9).safeParse('1000000001').success).toBe(false);
    expect(tradeDecimalSchema(1e12).safeParse('1000000000000').success).toBe(true);
  });

  it('rejects zero, negative, exponent and blank units or prices', () => {
    for (const bad of ['0', '-1', '1e3', '', 'abc', '1,000']) {
      expect(tradeSchema.safeParse({ ...baseTrade, price: bad }).success, bad).toBe(false);
      expect(
        tradeSchema.safeParse({ ...baseTrade, quantity: { mode: 'units', units: bad } }).success,
        bad,
      ).toBe(false);
    }
  });

  it('bounds the trade date: 1900-01-01 through tomorrow (local)', () => {
    const at = (tradeDate: string) => tradeSchema.safeParse({ ...baseTrade, tradeDate });
    expect(at('2026-09-25').success).toBe(true); // tomorrow
    expect(at('2026-09-26').success).toBe(false); // the day after
    expect(at('1900-01-01').success).toBe(true);
    expect(at('1899-12-31').success).toBe(false);
    const bad = at('24/09/2026');
    expect(bad.success).toBe(false);
    expect(issuesOf(bad)).toEqual(['tradeDate']); // one issue, not one per rule
  });

  it('takes a flat or a rate fee, strictly', () => {
    expect(feeSpecInputSchema.parse({ kind: 'rate', rate: '0.0050' })).toEqual({
      kind: 'rate',
      rate: '0.005',
    });
    expect(feeSpecInputSchema.safeParse({ kind: 'flat', cents: -1 }).success).toBe(false);
    expect(feeSpecInputSchema.safeParse({ kind: 'flat', cents: 100_000_001 }).success).toBe(false);
    expect(feeSpecInputSchema.safeParse({ kind: 'flat', cents: 1.5 }).success).toBe(false);
    expect(feeSpecInputSchema.safeParse({ kind: 'flat', cents: 0, x: 1 }).success).toBe(false);
    expect(feeSpecInputSchema.safeParse({ kind: 'rate', rate: '1.5' }).success).toBe(false);
  });

  it('is strict and reports field paths', () => {
    const extra = tradeSchema.safeParse({ ...baseTrade, typo: 1 });
    expect(extra.success).toBe(false);
    const bad = tradeSchema.safeParse({
      ...baseTrade,
      quantity: { mode: 'units', units: '-1' },
      price: '0',
    });
    expect(issuesOf(bad)).toEqual(expect.arrayContaining(['quantity.units', 'price']));
  });

  it('turns a blank note into null and leaves it optional', () => {
    expect(tradeSchema.parse({ ...baseTrade, note: '   ' }).note).toBeNull();
    expect(tradeSchema.parse(baseTrade).note).toBeUndefined();
  });

  it('bounds the order value (units × price) at ORDER_VALUE_CENTS_MAX, with a field path', () => {
    // 1e6 units × 1e9 = 1e15 dollars: each is within its own bound, the product is not.
    const big = tradeSchema.safeParse({
      ...baseTrade,
      quantity: { mode: 'units', units: '1000000' },
      price: '1000000000',
    });
    expect(big.success).toBe(false);
    expect(issuesOf(big)).toEqual(['quantity.units']);
    expect(big.error?.issues[0]?.message).toBe('the order value is too large');
    // Exactly the ceiling ($1e11) is accepted; one cent more is not.
    const at = { ...baseTrade, quantity: { mode: 'units', units: '100' }, price: '1000000000' };
    expect(tradeSchema.safeParse(at).success).toBe(true);
    expect(
      tradeSchema.safeParse({ ...at, quantity: { mode: 'units', units: '100.00000000001' } })
        .success,
    ).toBe(false);
    // A rate fee on an over-limit order reports the order (a rate is at most 1).
    const rate = tradeSchema.safeParse({
      ...baseTrade,
      quantity: { mode: 'units', units: '1000000000000' },
      price: '1000000000',
      fee: { kind: 'rate', rate: '0.01' },
    });
    expect(issuesOf(rate)).toEqual(['quantity.units']);
    // Amount mode is bounded by amountCents alone.
    expect(
      tradeSchema.safeParse({
        ...baseTrade,
        quantity: { mode: 'amount', amountCents: 1e13 },
        price: '0.000001',
      }).success,
    ).toBe(true);
  });
});

describe('ratio input', () => {
  it('normalises and bounds ratios', () => {
    expect(ratioInputSchema().parse(' 0.250 ')).toBe('0.25');
    expect(ratioInputSchema().parse('1')).toBe('1');
    expect(ratioInputSchema().parse('0')).toBe('0');
    expect(ratioInputSchema().safeParse('1.0000001').success).toBe(false);
    expect(ratioInputSchema(0.1).safeParse('0.1').success).toBe(true);
    expect(ratioInputSchema(0.1).safeParse('0.11').success).toBe(false);
    for (const bad of ['-0.1', '+0.1', '1e-3', '', 'abc', '0.0000000000000000001']) {
      expect(ratioInputSchema().safeParse(bad).success, bad).toBe(false);
    }
  });
});

const editable = (over: Partial<InstrumentEditableBody> = {}): InstrumentEditableBody => ({
  name: 'Example',
  watched: true,
  targetRatio: null,
  sector: null,
  location: null,
  mgmtFeeRatio: null,
  regions: null,
  dividendFreqMonths: null,
  drp: null,
  defaultFee: null,
  note: null,
  ...over,
});

const regions = { us: '0.5', asia: '0.1', aus: '0.3', other: '0.1' };

describe('instrument update and create', () => {
  it("turns '' into null for name, sector, location and note, and defaults the currency", () => {
    const parsed = instrumentUpdateSchema.parse(
      editable({ name: '  ', sector: '', location: ' ', note: '' }),
    );
    expect(parsed).toMatchObject({
      name: null,
      sector: null,
      location: null,
      note: null,
      quoteCurrency: 'AUD',
    });
  });

  it('checks the currency code', () => {
    for (const ok of ['AUD', 'USD', 'GBp', 'GBX']) {
      expect(instrumentUpdateSchema.safeParse(editable({ quoteCurrency: ok })).success, ok).toBe(
        true,
      );
    }
    for (const bad of ['aud', 'AU', 'AUDD', '']) {
      expect(instrumentUpdateSchema.safeParse(editable({ quoteCurrency: bad })).success, bad).toBe(
        false,
      );
    }
  });

  it('allows a rate default fee for crypto only', () => {
    const rate = { defaultFee: { kind: 'rate', rate: '0.001' } } as const;
    const etf = makeInstrumentUpdateSchema('etf').safeParse(editable(rate));
    expect(etf.success).toBe(false);
    expect(issuesOf(etf)).toEqual(['defaultFee']);
    expect(makeInstrumentUpdateSchema('crypto').safeParse(editable(rate)).success).toBe(true);
    const flat = { defaultFee: { kind: 'flat', cents: 0 } } as const;
    expect(makeInstrumentUpdateSchema('etf').safeParse(editable(flat)).success).toBe(true);
    const created = instrumentCreateSchema.safeParse({
      ...editable(rate),
      kind: 'stock',
      symbol: 'ASX:ABC',
    });
    expect(issuesOf(created)).toEqual(['defaultFee']);
  });

  it('allows regions, location and a management fee on ETFs and managed funds only', () => {
    const fund = { regions, location: 'Australia', mgmtFeeRatio: '0.002' };
    expect(makeInstrumentUpdateSchema('etf').safeParse(editable(fund)).success).toBe(true);
    expect(makeInstrumentUpdateSchema('managed_fund').safeParse(editable(fund)).success).toBe(true);
    const stock = makeInstrumentUpdateSchema('stock').safeParse(editable(fund));
    expect(issuesOf(stock).sort()).toEqual(['location', 'mgmtFeeRatio', 'regions']);
    const crypto = makeInstrumentUpdateSchema('crypto').safeParse(
      editable({ ...fund, sector: 'Tech' }),
    );
    expect(issuesOf(crypto).sort()).toEqual(['location', 'mgmtFeeRatio', 'regions', 'sector']);
    // Four null shares count as no regions.
    const allNull = { regions: { us: null, asia: null, aus: null, other: null } };
    expect(makeInstrumentUpdateSchema('stock').safeParse(editable(allNull)).success).toBe(true);
    // The create schema runs the same rules with the body's kind.
    const createStock = instrumentCreateSchema.safeParse({
      ...editable(fund),
      kind: 'stock',
      symbol: 'ASX:ABC',
    });
    expect(issuesOf(createStock).sort()).toEqual(['location', 'mgmtFeeRatio', 'regions']);
    expect(
      instrumentCreateSchema.safeParse({ ...editable(fund), kind: 'etf', symbol: 'ASX:ABC' })
        .success,
    ).toBe(true);
  });

  it('limits the regions to 100 % in total', () => {
    const schema = makeInstrumentUpdateSchema('etf');
    expect(schema.safeParse(editable({ regions })).success).toBe(true);
    const over = schema.safeParse(editable({ regions: { ...regions, other: '0.1000001' } }));
    expect(over.success).toBe(false);
    expect(issuesOf(over)).toEqual(['regions']);
  });

  it('lists the per-kind issues directly', () => {
    const v: InstrumentEditable = instrumentUpdateSchema.parse(
      editable({ sector: 'Tech', defaultFee: { kind: 'rate', rate: '0.001' } }),
    );
    expect(instrumentKindIssues('crypto', v)).toEqual([
      { path: 'sector', message: 'must be empty for crypto' },
    ]);
    expect(instrumentKindIssues('etf', v)).toEqual([
      { path: 'defaultFee', message: 'a percentage fee is for crypto only' },
    ]);
    expect(instrumentKindIssues('stock', v)).toHaveLength(1);
  });

  it('checks and normalises the symbol per kind', () => {
    const create = (kind: string, symbol: string) =>
      instrumentCreateSchema.safeParse({ ...editable(), kind, symbol });
    const stock = create('stock', ' asx:abc ');
    expect(stock.success && stock.data.symbol).toBe('ASX:ABC');
    const etf = create('etf', 'asx:def.x');
    expect(etf.success && etf.data.symbol).toBe('ASX:DEF.X');
    const coin = create('crypto', 'btc');
    expect(coin.success && coin.data.symbol).toBe('BTC');
    const fund = create('managed_fund', 'ExampleFund^A');
    expect(fund.success && fund.data.symbol).toBe('ExampleFund^A');
    for (const [kind, symbol] of [
      ['stock', 'ABC'],
      ['etf', 'ASX:'],
      ['stock', 'ASX:.ABC'],
      ['crypto', 'BTC-X'],
      ['managed_fund', 'Example Fund'],
      ['stock', ''],
    ] as const) {
      const r = create(kind, symbol);
      expect(r.success, `${kind} ${symbol}`).toBe(false);
      expect(issuesOf(r), `${kind} ${symbol}`).toContain('symbol');
    }
    expect(normaliseInstrumentSymbol('managed_fund', ' Fund ')).toBe('Fund');
  });
});

describe('instrument editable round trip (§3.3)', () => {
  it('maps a DTO to the editable fields; regions null for stocks, crypto and all-null', () => {
    expect(instrumentEditableFromDto(instrumentDtos.stock).regions).toBeNull();
    expect(instrumentEditableFromDto(instrumentDtos.crypto).regions).toBeNull();
    expect(instrumentEditableFromDto(instrumentDtos.etf).regions).toEqual({
      us: '0.6',
      asia: '0.1',
      aus: '0.2',
      other: '0.1',
    });
    const noRegions = {
      ...instrumentDtos.etf,
      regions: { us: null, asia: null, aus: null, other: null },
    };
    expect(instrumentEditableFromDto(noRegions).regions).toBeNull();
  });

  it('a no-op save parses to the same normalised value for every instrument fixture', () => {
    const dtos = Object.values(instrumentDtoById);
    expect(dtos.length).toBeGreaterThanOrEqual(4);
    for (const dto of dtos) {
      const body = instrumentEditableFromDto(dto);
      const parsed = makeInstrumentUpdateSchema(dto.kind).safeParse(body);
      expect(parsed.success, dto.symbol).toBe(true);
      if (!parsed.success) continue;
      expect(normaliseInstrumentEditable(parsed.data), dto.symbol).toEqual(
        normaliseInstrumentEditable(body),
      );
      // A JSON round trip (as the web sends it) changes nothing either.
      const viaJson = makeInstrumentUpdateSchema(dto.kind).parse(JSON.parse(JSON.stringify(body)));
      expect(normaliseInstrumentEditable(viaJson), dto.symbol).toEqual(
        normaliseInstrumentEditable(body),
      );
    }
  });

  it('normalises text, decimals, regions and the fee', () => {
    const v: InstrumentEditable = {
      name: '  Example  ',
      quoteCurrency: ' ',
      watched: false,
      targetRatio: '0.50',
      sector: '',
      location: ' Global ',
      mgmtFeeRatio: '0.0020',
      regions: { us: null, asia: null, aus: null, other: null },
      dividendFreqMonths: 3,
      drp: null,
      defaultFee: { kind: 'rate', rate: '0.0010' },
      note: '   ',
    };
    expect(normaliseInstrumentEditable(v)).toEqual({
      name: 'Example',
      quoteCurrency: 'AUD',
      watched: false,
      targetRatio: '0.5',
      sector: null,
      location: 'Global',
      mgmtFeeRatio: '0.002',
      regions: null,
      dividendFreqMonths: 3,
      drp: null,
      defaultFee: { kind: 'rate', rate: '0.001' },
      note: null,
    });
    expect(
      normaliseInstrumentEditable({
        ...v,
        regions: { us: '0.60', asia: null, aus: null, other: null },
      }).regions,
    ).toEqual({ us: '0.6', asia: null, aus: null, other: null });
  });
});
