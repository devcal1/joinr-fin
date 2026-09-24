import { apiErrors } from '@joinr/schema/fixtures';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/client';
import {
  AS_OF_REQUIRED,
  PRICE_NOT_POSITIVE,
  PRICE_REQUIRED,
  PRICE_TOO_LARGE,
  SYMBOL_INVALID,
  SYMBOL_REQUIRED,
  splitApiErrors,
  validateManualPrice,
  validatePriceSource,
} from './validation';

describe('manual price validation', () => {
  it('requires a positive price up to 1e9 and a date', () => {
    expect(validateManualPrice('', null)).toEqual({ price: PRICE_REQUIRED, asOf: AS_OF_REQUIRED });
    expect(validateManualPrice('0', '2026-09-24')).toEqual({ price: PRICE_NOT_POSITIVE });
    expect(validateManualPrice('1000000001', '2026-09-24')).toEqual({ price: PRICE_TOO_LARGE });
    expect(validateManualPrice('12.5', '2026-09-24')).toEqual({});
    expect(validateManualPrice('0.00000001', '2026-09-24')).toEqual({});
  });
});

describe('price source validation', () => {
  it('requires a valid symbol unless the provider is none', () => {
    expect(validatePriceSource('none', '')).toBeNull();
    expect(validatePriceSource('yahoo', '  ')).toBe(SYMBOL_REQUIRED);
    expect(validatePriceSource('yahoo', 'ABC.AX')).toBeNull();
    expect(validatePriceSource('yahoo', 'SI=F')).toBeNull();
    expect(validatePriceSource('coingecko', 'bitcoin')).toBeNull();
    expect(validatePriceSource('yahoo', 'ABC AX')).toBe(SYMBOL_INVALID);
    expect(validatePriceSource('yahoo', 'x'.repeat(65))).toMatch(/at most 64/);
  });
});

describe('splitApiErrors', () => {
  it('ties validation issues to their fields and keeps the rest for the form', () => {
    const error = new ApiError(
      400,
      'VALIDATION_ERROR',
      'price: must be greater than zero; asOf: must not be after tomorrow; something else',
    );
    expect(splitApiErrors(error, ['price', 'asOf', 'note'] as const)).toEqual({
      fields: { price: 'Must be greater than zero.', asOf: 'Must not be after tomorrow.' },
      form: 'Something else.',
    });
  });

  it('uses the fixture message shape', () => {
    const { code, message } = apiErrors.validation.error;
    expect(splitApiErrors(new ApiError(400, code, message), ['price'] as const).fields.price).toBe(
      'Must be greater than zero.',
    );
  });

  it('puts other errors on the form', () => {
    const { code, message } = apiErrors.notFound.error;
    expect(splitApiErrors(new ApiError(404, code, message), ['price'] as const)).toEqual({
      fields: {},
      form: 'No instrument 999',
    });
  });
});
