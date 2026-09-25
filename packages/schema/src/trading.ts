// Trading helpers (stage-2.md §2.3, frozen): the fee authority rule, D38 amount-mode units and
// default fees, percent ↔ ratio text, and the decimal input limits. The server (validation), the
// engine and the web (the trade form preview) all use these, so they live in the schema root.
// Pure: decimal.js through JoinrDecimal, never JS floats; no drizzle, no node modules.
import Decimal from 'decimal.js';
import { centsFromDecimal, JoinrDecimal, normaliseDecimal, type DecimalValue } from './decimal';
import type { InstrumentKind } from './enums';
import type { DecimalString } from './primitives';

/** A trade fee: a flat amount in cents, or a rate (a ratio of the order value; crypto only). */
export type FeeSpec = { kind: 'flat'; cents: number } | { kind: 'rate'; rate: DecimalString };

/** Decimal places accepted for units, prices and ratios by the API. */
export const TRADE_DECIMAL_MAX_DP = 18;

/** Significant digits accepted (imports carry ≤ 12, so every stored value round-trips). */
export const DECIMAL_INPUT_MAX_SIG = 15;

/** Amount-mode rounding (D38) AND the unit display precision per kind (§6.3). */
export const AMOUNT_MODE_UNIT_DP: Readonly<Record<InstrumentKind, number>> = {
  stock: 4,
  etf: 4,
  managed_fund: 6,
  crypto: 8,
};

/** Decimal places of a typed percent field (so a typed ratio has at most 6 dp). */
export const PERCENT_INPUT_MAX_DP = 4;

/**
 * The largest order value, and the largest rate fee, a trade may carry: the amount-mode ceiling of
 * 1e13 cents. Units (≤ 1e12) and price (≤ 1e9) are bounded separately, but their product is not,
 * so a units-mode trade could otherwise reach money figures beyond safe-integer cents.
 */
export const ORDER_VALUE_CENTS_MAX = 1e13;

/**
 * Which part of a units-mode trade is beyond `ORDER_VALUE_CENTS_MAX`: `'order'` when
 * |units × price| is, `'fee'` when a rate fee |rate × units × price| is, else null. Null for input
 * that is not a number (the field checks report that).
 */
export function orderValueIssue(t: {
  units: string;
  price: string;
  feeRate: string | null;
}): 'order' | 'fee' | null {
  let order: DecimalValue;
  let rate: DecimalValue | null = null;
  try {
    order = new JoinrDecimal(t.units.trim()).times(new JoinrDecimal(t.price.trim())).abs();
    if (t.feeRate !== null) rate = new JoinrDecimal(t.feeRate.trim()).abs();
  } catch {
    return null;
  }
  if (order.isNaN() || (rate !== null && rate.isNaN())) return null;
  const max = new JoinrDecimal(ORDER_VALUE_CENTS_MAX).div(100);
  if (order.greaterThan(max)) return 'order';
  if (rate !== null && rate.times(order).greaterThan(max)) return 'fee';
  return null;
}

interface FeeInput {
  units: string;
  price: string;
  feeCents: number;
  feeRate: string | null;
}

function dec(value: string, fn: string): DecimalValue {
  let d: DecimalValue;
  try {
    d = new JoinrDecimal(value);
  } catch {
    throw new RangeError(`${fn}: not a number: ${JSON.stringify(value)}`);
  }
  if (!d.isFinite()) throw new RangeError(`${fn}: not a finite number: ${JSON.stringify(value)}`);
  return d;
}

/**
 * Fee authority (stage-1 §2.4): `feeRate` set → |feeRate × units × price| in decimal; otherwise
 * `feeCents / 100`. Dollars, normalised.
 */
export function tradeFeeDollars(t: FeeInput): DecimalString {
  if (t.feeRate !== null) {
    const fee = dec(t.feeRate, 'tradeFeeDollars')
      .times(dec(t.units, 'tradeFeeDollars'))
      .times(dec(t.price, 'tradeFeeDollars'))
      .abs();
    return normaliseDecimal(fee);
  }
  if (!Number.isSafeInteger(t.feeCents)) {
    throw new RangeError(`tradeFeeDollars: fee cents must be a safe integer: ${t.feeCents}`);
  }
  return normaliseDecimal(new JoinrDecimal(t.feeCents).div(100));
}

/** The same fee rounded once to cents (half away from zero): the display value and `fee_cents` of a rate fee. */
export function tradeFeeCents(t: FeeInput): number {
  return centsFromDecimal(tradeFeeDollars(t));
}

/**
 * D38: the units an amount buys or sells: amount / price, rounded DOWN (toward zero) to
 * `AMOUNT_MODE_UNIT_DP[kind]` decimal places. `"0"` when the amount buys less than one step.
 * Throws RangeError when `amountCents` is not a non-negative safe integer or `price` is not a
 * positive decimal (callers validate both first).
 */
export function unitsFromAmount(
  amountCents: number,
  price: DecimalString,
  kind: InstrumentKind,
): DecimalString {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
    throw new RangeError(
      `unitsFromAmount: amount must be whole, non-negative cents: ${amountCents}`,
    );
  }
  const p = dec(price, 'unitsFromAmount');
  if (!p.greaterThan(0)) {
    throw new RangeError(`unitsFromAmount: price must be positive: ${JSON.stringify(price)}`);
  }
  const units = new JoinrDecimal(amountCents)
    .div(100)
    .div(p)
    .toDecimalPlaces(AMOUNT_MODE_UNIT_DP[kind], Decimal.ROUND_DOWN);
  return normaliseDecimal(units);
}

/**
 * D38: the fee the trade form pre-fills.
 * - The holding's own default wins: `defaultFeeRate` → `{ rate }` (crypto only; ignored for other
 *   kinds), else `defaultFeeCents` → `{ flat }`.
 * - Otherwise by kind: crypto → `{ rate: cryptoFeeRate ?? '0' }`; stock or ETF →
 *   `{ flat: defaultBrokerageCents ?? 0 }`; managed fund → `{ flat: 0 }` (no brokerage in the template).
 * There is no inference from the ledger.
 */
export function effectiveDefaultFee(
  i: { kind: InstrumentKind; defaultFeeCents: number | null; defaultFeeRate: DecimalString | null },
  s: { defaultBrokerageCents: number | null; cryptoFeeRate: DecimalString | null },
): FeeSpec {
  if (i.kind === 'crypto' && i.defaultFeeRate !== null) {
    return { kind: 'rate', rate: i.defaultFeeRate };
  }
  if (i.defaultFeeCents !== null) return { kind: 'flat', cents: i.defaultFeeCents };
  switch (i.kind) {
    case 'crypto':
      return { kind: 'rate', rate: s.cryptoFeeRate ?? '0' };
    case 'stock':
    case 'etf':
      return { kind: 'flat', cents: s.defaultBrokerageCents ?? 0 };
    case 'managed_fund':
      return { kind: 'flat', cents: 0 };
  }
}

/** Plain non-negative decimal text: `12`, `12.5`, `12.`, `.5` (no sign, no exponent, no separators). */
const PLAIN_DECIMAL_TEXT_RE = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

/**
 * Percent text → ratio string by shifting the decimal point on the string (never floats):
 * `"0.07"` → `"0.0007"`, `"12.5"` → `"0.125"`, `"100"` → `"1"`. Null for blank or invalid text,
 * a sign, an exponent or more than `maxDp` decimal places.
 */
export function ratioFromPercentText(
  text: string,
  maxDp: number = PERCENT_INPUT_MAX_DP,
): DecimalString | null {
  const t = text.trim();
  if (!PLAIN_DECIMAL_TEXT_RE.test(t)) return null;
  const [intPart = '', fracPart = ''] = t.split('.');
  if (fracPart.length > maxDp) return null;
  // At least three integer digits, so the point can move two places left.
  const digits = intPart.padStart(3, '0');
  return normaliseDecimal(`${digits.slice(0, -2)}.${digits.slice(-2)}${fracPart}`);
}

/**
 * Ratio string → percent text, the exact inverse of `ratioFromPercentText` (no rounding):
 * `"0.0007"` → `"0.07"`, `"0.125"` → `"12.5"`, `"1"` → `"100"`. Throws RangeError for a
 * non-number.
 */
export function percentTextFromRatio(ratio: DecimalString): string {
  const n = normaliseDecimal(ratio);
  const negative = n.startsWith('-');
  const abs = negative ? n.slice(1) : n;
  const [intPart = '0', fracPart = ''] = abs.split('.');
  const frac = fracPart.padEnd(2, '0');
  const rest = frac.slice(2);
  const shifted = `${intPart}${frac.slice(0, 2)}${rest === '' ? '' : `.${rest}`}`;
  return normaliseDecimal(`${negative ? '-' : ''}${shifted}`);
}

/**
 * A decimal input string is acceptable: at most `TRADE_DECIMAL_MAX_DP` decimal places and at most
 * `DECIMAL_INPUT_MAX_SIG` significant digits (integer trailing zeros count). False for a non-number.
 */
export function withinDecimalInputLimits(value: DecimalString): boolean {
  let d: DecimalValue;
  try {
    d = new JoinrDecimal(value.trim());
  } catch {
    return false;
  }
  if (!d.isFinite()) return false;
  return d.decimalPlaces() <= TRADE_DECIMAL_MAX_DP && d.sd(true) <= DECIMAL_INPUT_MAX_SIG;
}
