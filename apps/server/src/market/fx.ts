// FX conversion and derived series (stage-1.md §5.3; D23, D25). Pure, decimal.js only.
import { JoinrDecimal, normaliseDecimal, type DecimalValue } from '@joinr/schema';

/** Decimal places kept for rates, derived series and converted prices (small values keep 12 sig. digits). */
export const DERIVED_DP = 12;

/** Rounds a computed value: 12 dp, or 12 significant digits below 1 (crypto dust, tiny rates). */
export function roundDerived(d: DecimalValue): string {
  const rounded = d.abs().greaterThanOrEqualTo(1)
    ? d.toDecimalPlaces(DERIVED_DP)
    : d.toSignificantDigits(DERIVED_DP);
  return normaliseDecimal(rounded);
}

/** a / b, rounded; null when b is zero or either is missing. */
export function divideDecimals(a: string | null, b: string | null): string | null {
  if (a === null || b === null) return null;
  const denominator = new JoinrDecimal(b);
  if (denominator.isZero()) return null;
  return roundDerived(new JoinrDecimal(a).div(denominator));
}

/** The dynamic series id holding AUD per one unit of `ccy` (Yahoo `<CCY>AUD=X`). */
export function fxSeriesId(ccy: string): string {
  return `FX_${ccy}AUD`;
}

export function fxYahooSymbol(ccy: string): string {
  return `${ccy}AUD=X`;
}

/** `FX_GBPAUD` → `GBP`; null for any other id. */
export function fxCurrencyOfSeries(seriesId: string): string | null {
  const m = /^FX_([A-Z]{3})AUD$/.exec(seriesId);
  return m ? m[1]! : null;
}

/** London pence: Yahoo reports `GBp` (sometimes `GBX`). */
export function isPence(currency: string): boolean {
  return currency === 'GBp' || currency.toUpperCase() === 'GBX';
}

export type FxNeed = { kind: 'aud' } | { kind: 'usd' } | { kind: 'cross'; ccy: string };

/** Which rate converting `currency` to AUD needs; null for a currency code we cannot use. */
export function fxNeedFor(currency: string): FxNeed | null {
  if (isPence(currency)) return { kind: 'cross', ccy: 'GBP' };
  const ccy = currency.toUpperCase();
  if (!/^[A-Z]{3}$/.test(ccy)) return null;
  if (ccy === 'AUD') return { kind: 'aud' };
  if (ccy === 'USD') return { kind: 'usd' };
  return { kind: 'cross', ccy };
}

export interface FxRates {
  /** USD per AUD (`AUDUSD=X`). */
  audUsd: string | null;
  /** AUD per one unit of `ccy` (`FX_<CCY>AUD`). */
  cross(ccy: string): string | null;
}

export type Conversion = { price: string; fxRate: string } | { error: string };

/**
 * A native price → AUD: `AUD` as is; `USD` ÷ AUDUSD; `GBp`/`GBX` ÷ 100 then × GBP→AUD; any other
 * `<CCY>` × `FX_<CCY>AUD`. `fxRate` is the AUD per native unit applied.
 */
export function convertToAud(nativePrice: string, currency: string, rates: FxRates): Conversion {
  const need = fxNeedFor(currency);
  if (need === null) return { error: `Unsupported currency ${currency.slice(0, 12)}` };
  const native = new JoinrDecimal(nativePrice);
  switch (need.kind) {
    case 'aud':
      return { price: normaliseDecimal(native), fxRate: '1' };
    case 'usd': {
      if (rates.audUsd === null || new JoinrDecimal(rates.audUsd).isZero()) {
        return { error: 'No FX rate for USD' };
      }
      const audUsd = new JoinrDecimal(rates.audUsd);
      return {
        price: roundDerived(native.div(audUsd)),
        fxRate: roundDerived(new JoinrDecimal(1).div(audUsd)),
      };
    }
    case 'cross': {
      const rate = rates.cross(need.ccy);
      if (rate === null) return { error: `No FX rate for ${need.ccy}` };
      const perUnit = isPence(currency) ? new JoinrDecimal(rate).div(100) : new JoinrDecimal(rate);
      return { price: roundDerived(native.times(perUnit)), fxRate: roundDerived(perUnit) };
    }
  }
}

export interface SeriesPoint {
  value: string;
  asOf: string;
}

/** numerator / denominator with the older input's as-of; null when an input is missing. */
export function deriveSeries(
  numerator: SeriesPoint | null,
  denominator: SeriesPoint | null,
): SeriesPoint | null {
  if (numerator === null || denominator === null) return null;
  const value = divideDecimals(numerator.value, denominator.value);
  if (value === null) return null;
  const asOf = numerator.asOf <= denominator.asOf ? numerator.asOf : denominator.asOf;
  return { value, asOf };
}
