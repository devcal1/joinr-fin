// Shared helpers for the Stage 4 mutations (stage-4.md §4.5 "Mutations", §3.4): the 409 and 422
// errors of §4.1, decimal comparisons after normalising both sides, and the "latest entry" query
// every denormalised copy follows. Every mutation runs in one synchronous `BEGIN IMMEDIATE`
// transaction (the Stage 3 order: import lock, parse, load, cross-row rules, write, commit).
import { JoinrDecimal, normaliseDecimal, type DecimalValue } from '@joinr/schema';
import { HttpError } from '../../errors';

export {
  assertNoImportRunning,
  assertSameIds,
  nextSortOrder,
  normText,
  notFound,
  parseIdAfterLock,
  parsePeriodMonth,
  validation,
} from '../../cashflow/mutations/common';
export type { MutationDeps } from '../../cashflow/mutations/cash';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** 409 FUND_IN_USE (§4.1). */
export function fundInUse(contributions: number): HttpError {
  return new HttpError(
    409,
    `This fund has ${contributions} ${plural(contributions, 'contribution', 'contributions')}; move or delete ${plural(contributions, 'it', 'them')} first`,
    'FUND_IN_USE',
  );
}

/** 409 PROPERTY_HAS_LOAN (§4.1). */
export function propertyHasLoan(loans: number): HttpError {
  return new HttpError(
    409,
    `This property has ${loans} ${plural(loans, 'loan', 'loans')}; delete ${plural(loans, 'it', 'them')} first`,
    'PROPERTY_HAS_LOAN',
  );
}

/** 422 SALE_OVERSELL (§4.1): `left` = the units still held before this sale (never below 0). */
export function saleOversell(left: string): HttpError {
  const units = left === '1' ? 'unit is' : 'units are';
  return new HttpError(422, `Only ${left} ${units} left to sell`, 'SALE_OVERSELL');
}

/** 409 LAST_BALANCE_ENTRY with the entity's message (§4.1). */
export function lastEntry(what: 'fund' | 'property' | 'loan'): HttpError {
  const message =
    what === 'fund'
      ? 'A fund keeps at least one balance'
      : what === 'property'
        ? 'A property keeps at least one valuation'
        : 'A loan keeps at least one balance';
  return new HttpError(409, message, 'LAST_BALANCE_ENTRY');
}

/** A decimal normalised for a "changed" comparison (a malformed stored value compares as itself). */
export function normDecimal(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  try {
    return normaliseDecimal(v.trim());
  } catch {
    return v;
  }
}

/** True when both decimals are equal after normalising (null equals null only). */
export function sameDecimal(a: string | null | undefined, b: string | null | undefined): boolean {
  return normDecimal(a) === normDecimal(b);
}

/** Σ of decimal strings (a malformed stored value is left out). */
export function sumDecimal(values: readonly string[]): DecimalValue {
  let sum = new JoinrDecimal(0);
  for (const v of values) {
    try {
      sum = sum.plus(v);
    } catch {
      // Left out: a malformed stored decimal cannot be counted.
    }
  }
  return sum;
}

/** The entry with the latest as-of (then the highest id), or null: every denormalised copy's source. */
export function latestByAsOf<T extends { asOf: string; id: number }>(rows: readonly T[]): T | null {
  let best: T | null = null;
  for (const r of rows) {
    if (best === null || r.asOf > best.asOf || (r.asOf === best.asOf && r.id > best.id)) best = r;
  }
  return best;
}
