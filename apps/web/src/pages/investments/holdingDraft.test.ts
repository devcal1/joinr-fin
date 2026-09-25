import {
  instrumentEditableFromDto,
  makeInstrumentUpdateSchema,
  normaliseInstrumentEditable,
  type InstrumentKind,
} from '@joinr/schema';
import { apiErrors, instrumentDtoById, instrumentDtos } from '@joinr/schema/fixtures';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/client';
import {
  EMPTY_EDITABLE,
  changedFields,
  draftErrors,
  draftFromEditable,
  editableFromDraft,
  holdingApiErrors,
  holdingFormErrors,
  holdingIssueMessage,
  onlyDefaultFeeChanged,
  percentLimits,
  regionsTotalRatio,
  schemaErrors,
  type HoldingDraft,
} from './holdingDraft';

const KINDS: readonly InstrumentKind[] = ['stock', 'etf', 'managed_fund', 'crypto'];

function start(kind: InstrumentKind) {
  const dto = instrumentDtos[kind];
  const base = instrumentEditableFromDto(dto);
  const initial = draftFromEditable(base, kind);
  return { dto, base, initial, limits: percentLimits(initial) };
}

describe('the holding form round trip (§6.6)', () => {
  it.each(KINDS)('%s: an untouched form sends the DTO’s editable fields exactly', (kind) => {
    const { base, initial, limits } = start(kind);
    const body = editableFromDraft(initial, initial, base, kind, limits);
    expect(body).toEqual(base);
    expect(normaliseInstrumentEditable(body)).toEqual(normaliseInstrumentEditable(base));
    expect(makeInstrumentUpdateSchema(kind).safeParse(body).success).toBe(true);
    expect(changedFields(initial, initial).size).toBe(0);
  });

  it.each(KINDS)(
    '%s: DTO → form → body with only the default fee changed equals the DTO except defaultFee',
    (kind) => {
      const { base, initial, limits } = start(kind);
      const draft: HoldingDraft =
        kind === 'crypto'
          ? { ...initial, useGlobalFee: false, feeMode: 'rate', feePercent: '0.3' }
          : { ...initial, useGlobalFee: false, feeMode: 'flat', feeCents: 0 };
      const changed = changedFields(draft, initial);
      const body = editableFromDraft(draft, initial, base, kind, limits);
      const defaultFee = body.defaultFee;
      expect({ ...body, defaultFee: null }).toEqual({ ...base, defaultFee: null });
      if (kind === 'crypto') expect(defaultFee).toEqual({ kind: 'rate', rate: '0.003' });
      else if (kind === 'etf') {
        // ASX:DEF already has a $0 default: nothing changed.
        expect(changed.size).toBe(0);
      } else expect(defaultFee).toEqual({ kind: 'flat', cents: 0 });
      if (changed.size > 0) expect(onlyDefaultFeeChanged(changed)).toBe(true);
    },
  );

  it('"Use the global default" sends null', () => {
    const { base, initial, limits } = start('etf');
    const draft = { ...initial, useGlobalFee: true };
    expect(changedFields(draft, initial)).toEqual(new Set(['defaultFee']));
    expect(editableFromDraft(draft, initial, base, 'etf', limits).defaultFee).toBeNull();
  });

  it('converts percent text with the string helpers, never floats', () => {
    const { base, initial, limits } = start('etf');
    expect(initial.target).toBe('60');
    expect(initial.mgmtFee).toBe('0.07');
    expect(initial.regions).toEqual({ us: '60', asia: '10', aus: '20', other: '10' });
    const draft = { ...initial, target: '12.5', mgmtFee: '0.35' };
    const body = editableFromDraft(draft, initial, base, 'etf', limits);
    expect(body.targetRatio).toBe('0.125');
    expect(body.mgmtFeeRatio).toBe('0.0035');
    expect(changedFields(draft, initial)).toEqual(new Set(['targetRatio', 'mgmtFeeRatio']));
  });

  it('empty text → null; regions null when all four are empty', () => {
    const { base, initial, limits } = start('etf');
    const draft = {
      ...initial,
      name: '   ',
      sector: '',
      location: '',
      note: '',
      regions: { us: '', asia: '', aus: '', other: '' },
    };
    const body = editableFromDraft(draft, initial, base, 'etf', limits);
    expect(body).toMatchObject({
      name: null,
      sector: null,
      location: null,
      note: null,
      regions: null,
    });
  });

  it('keeps regions null for stocks and crypto', () => {
    for (const kind of ['stock', 'crypto'] as const) {
      const { base, initial, limits } = start(kind);
      const body = editableFromDraft({ ...initial, name: 'Renamed' }, initial, base, kind, limits);
      expect(body.regions).toBeNull();
      expect(body.location).toBeNull();
      expect(body.mgmtFeeRatio).toBeNull();
    }
    const { base, initial, limits } = start('crypto');
    expect(editableFromDraft(initial, initial, base, 'crypto', limits).sector).toBeNull();
  });

  it('builds a create body from the empty record', () => {
    const initial = draftFromEditable(EMPTY_EDITABLE, 'stock');
    expect(initial).toMatchObject({
      watched: true,
      quoteCurrency: 'AUD',
      useGlobalFee: true,
      drp: 'unknown',
    });
    const draft = {
      ...initial,
      symbol: 'asx:zzz',
      name: 'ZZZ Example',
      target: '5',
      drp: 'yes' as const,
      dividendFreq: '6',
    };
    const limits = percentLimits(initial);
    const body = editableFromDraft(draft, initial, EMPTY_EDITABLE, 'stock', limits);
    expect(body).toMatchObject({
      name: 'ZZZ Example',
      targetRatio: '0.05',
      drp: true,
      dividendFreqMonths: 6,
    });
    expect(schemaErrors(body, 'stock', { symbol: draft.symbol })).toEqual({});
    expect(schemaErrors(body, 'stock', { symbol: 'NOPE' })).toEqual({
      symbol: 'Use the exchange, a colon, then the code.',
    });
    expect(schemaErrors({ ...body, sector: null }, 'crypto', { symbol: 'BT C' })).toEqual({
      symbol: 'Use up to 15 letters and digits, with no spaces or symbols.',
    });
    expect(schemaErrors(body, 'stock', { symbol: '' }).symbol).toBeDefined();
  });

  it('keeps stored ratios with more decimals than a typed one', () => {
    const dto = {
      ...instrumentDtoById[12]!,
      targetRatio: '0.123456',
      defaultFee: null,
    };
    const base = instrumentEditableFromDto(dto);
    const initial = draftFromEditable(base, 'etf');
    const limits = percentLimits(initial);
    expect(initial.target).toBe('12.3456');
    expect(limits.target).toBe(4);
    const body = editableFromDraft({ ...initial, note: 'x' }, initial, base, 'etf', limits);
    expect(body.targetRatio).toBe('0.123456');
  });
});

describe('checks', () => {
  it('reports percent text, months and a missing default fee', () => {
    const { initial, limits } = start('etf');
    expect(
      draftErrors(
        {
          ...initial,
          target: '12.34567',
          mgmtFee: 'abc',
          regions: { ...initial.regions, us: '-1' },
          dividendFreq: '13',
          useGlobalFee: false,
          feeCents: null,
          feeMode: 'flat',
        },
        'etf',
        limits,
      ),
    ).toEqual({
      targetRatio: 'Enter a percentage with up to 4 decimal places.',
      mgmtFeeRatio: 'Enter a percentage with up to 4 decimal places.',
      regions: 'Enter a percentage with up to 4 decimal places.',
      dividendFreqMonths: 'Enter a whole number of months from 1 to 12.',
      defaultFee: 'Enter the default fee, or use the global default.',
    });
    expect(draftErrors(initial, 'etf', limits)).toEqual({});
  });

  it('runs the server’s own kind rules: regions add up to at most 100%', () => {
    const { base, initial, limits } = start('etf');
    const draft = { ...initial, regions: { us: '70', asia: '20', aus: '20', other: '' } };
    expect(regionsTotalRatio(draft, limits.regions)).toBe('1.1');
    const body = editableFromDraft(draft, initial, base, 'etf', limits);
    expect(schemaErrors(body, 'etf', null)).toEqual({ regions: 'Must add up to at most 100%.' });
    expect(regionsTotalRatio(initial, limits.regions)).toBe('1');
    expect(
      regionsTotalRatio({ ...initial, regions: { us: '', asia: '', aus: '', other: '' } }, 4),
    ).toBeNull();
  });

  it('words percent bounds in percent, not ratio units', () => {
    const { base, initial, limits } = start('etf');
    const draft = { ...initial, target: '120', mgmtFee: '12' };
    const body = editableFromDraft(draft, initial, base, 'etf', limits);
    expect(schemaErrors(body, 'etf', null)).toEqual({
      targetRatio: 'Must be 100% or less.',
      mgmtFeeRatio: 'Must be 10% or less.',
    });
    expect(holdingIssueMessage('regions.us', 'must be at most 1')).toBe('Must be 100% or less.');
    expect(holdingIssueMessage('defaultFee.rate', 'must be at most 1')).toBe(
      'Must be 100% or less.',
    );
    // A money or text bound keeps its own words.
    expect(holdingIssueMessage('note', 'must be at most 200 characters')).toBe(
      'Must be at most 200 characters.',
    );
    // The server's 400 messages get the same words.
    const server = new ApiError(
      400,
      'VALIDATION_ERROR',
      'targetRatio: must be at most 1; mgmtFeeRatio: must be at most 0.1',
    );
    expect(holdingApiErrors(server, 'etf').fields).toEqual({
      targetRatio: 'Must be 100% or less.',
      mgmtFeeRatio: 'Must be 10% or less.',
    });
  });

  it('reports the parse and the schema problems together on the first Save', () => {
    const { base, initial, limits } = start('etf');
    // A parse problem (too many decimals) and a schema problem (over 100%) in different fields.
    const draft = { ...initial, mgmtFee: '0.123456', target: '120' };
    expect(holdingFormErrors(draft, initial, base, 'etf', limits, false)).toEqual({
      targetRatio: 'Must be 100% or less.',
      mgmtFeeRatio: 'Enter a percentage with up to 4 decimal places.',
    });
    // The parse error wins for its own field.
    expect(
      holdingFormErrors({ ...initial, target: '1.23456' }, initial, base, 'etf', limits, false),
    ).toEqual({ targetRatio: 'Enter a percentage with up to 4 decimal places.' });
  });

  it('puts 409 INSTRUMENT_EXISTS under the Symbol field', () => {
    const error = new ApiError(409, 'INSTRUMENT_EXISTS', apiErrors.instrumentExists.error.message);
    expect(holdingApiErrors(error)).toEqual({
      fields: { symbol: 'An ETF with the symbol ASX:DEF already exists.' },
      form: null,
    });
    const validation = new ApiError(
      400,
      'VALIDATION_ERROR',
      'defaultFee: a percentage fee is for crypto only',
    );
    expect(holdingApiErrors(validation).fields).toEqual({
      defaultFee: 'A percentage fee is for crypto only.',
    });
  });
});
