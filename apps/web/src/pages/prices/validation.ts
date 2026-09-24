// Form validation for the prices page, and server validation messages → per-field errors. The server joins Zod issues as
// "price: must be greater than zero; asOf: must not be after tomorrow" (apps/server errors.ts).
import { PROVIDER_SYMBOL_RE, type PriceProvider } from '@joinr/schema';
import { isApiError } from '../../api/client';

export interface SplitErrors<Field extends string> {
  fields: Partial<Record<Field, string>>;
  /** What could not be tied to a field. */
  form: string | null;
}

function sentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  const capitalised = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capitalised) ? capitalised : `${capitalised}.`;
}

/** Splits an API error into field messages (by the issue path's first key) and the rest. */
export function splitApiErrors<Field extends string>(
  error: unknown,
  fields: readonly Field[],
): SplitErrors<Field> {
  const message = error instanceof Error ? error.message : String(error);
  if (!isApiError(error) || error.code !== 'VALIDATION_ERROR') {
    return { fields: {}, form: message };
  }
  const result: SplitErrors<Field> = { fields: {}, form: null };
  const rest: string[] = [];
  for (const part of message.split('; ')) {
    const match = /^([A-Za-z]+)(?:\.[^:]*)?:\s*(.+)$/.exec(part);
    const field = match?.[1] as Field | undefined;
    if (match && field && fields.includes(field) && !result.fields[field]) {
      result.fields[field] = sentence(match[2] ?? '');
    } else {
      rest.push(part);
    }
  }
  if (rest.length) result.form = rest.map(sentence).join(' ');
  return result;
}

export const PRICE_REQUIRED = 'Enter a price.';
export const PRICE_NOT_POSITIVE = 'Enter a price greater than zero.';
export const PRICE_TOO_LARGE = 'Enter a price up to 1,000,000,000.';
export const AS_OF_REQUIRED = 'Enter the date of the price.';
export const NOTE_MAX = 200;
const PRICE_MAX = 1e9;

export type ManualPriceField = 'price' | 'asOf' | 'note';

/** Client-side checks; the server checks again. */
export function validateManualPrice(
  price: string,
  asOf: string | null,
): Partial<Record<ManualPriceField, string>> {
  const errors: Partial<Record<ManualPriceField, string>> = {};
  if (price === '') errors.price = PRICE_REQUIRED;
  else if (!(Number(price) > 0)) errors.price = PRICE_NOT_POSITIVE;
  else if (Number(price) > PRICE_MAX) errors.price = PRICE_TOO_LARGE;
  if (!asOf) errors.asOf = AS_OF_REQUIRED;
  return errors;
}

export const SYMBOL_REQUIRED = 'Enter the symbol for this provider.';
export const SYMBOL_INVALID = 'Use only letters, digits and . ^ = - _ :';
export const SYMBOL_MAX = 64;

/** Client-side checks for a price source; a symbol is required unless the provider is none. */
export function validatePriceSource(provider: PriceProvider, symbol: string): string | null {
  if (provider === 'none') return null;
  const trimmed = symbol.trim();
  if (trimmed === '') return SYMBOL_REQUIRED;
  if (trimmed.length > SYMBOL_MAX) return `Use at most ${SYMBOL_MAX} characters.`;
  if (!PROVIDER_SYMBOL_RE.test(trimmed)) return SYMBOL_INVALID;
  return null;
}
