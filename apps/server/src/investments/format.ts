// Small shared helpers for the investments API: the server-local as-of date, dd/mm/yyyy text and
// ratio formatting (12 significant digits, the engine's boundary rule, stage-2.md §2.1).
import { JoinrDecimal, normaliseDecimal, type DecimalString, type IsoDate } from '@joinr/schema';

/** The server-local calendar date of `d` (`asOf`, stage-2.md §4.5; Stage 7 sets TZ). */
export function localIsoDate(d: Date): IsoDate {
  const p = (n: number, w: number) => String(n).padStart(w, '0');
  return `${p(d.getFullYear(), 4)}-${p(d.getMonth() + 1, 2)}-${p(d.getDate(), 2)}`;
}

/** `2025-11-15` → `15/11/2025` (STYLE_GUIDE §8). */
export function displayDate(iso: IsoDate): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** numerator / denominator as a ratio string with 12 significant digits; null when dividing by 0. */
export function ratioOf(
  numerator: number | string,
  denominator: number | string,
): DecimalString | null {
  const den = new JoinrDecimal(denominator);
  if (den.isZero()) return null;
  return normaliseDecimal(new JoinrDecimal(numerator).div(den).toSignificantDigits(12));
}
