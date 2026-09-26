// Dividend suggestions (stage-3.md §2.11; D50, D62; §11 fix 10): cached Yahoo dividend events that
// no recorded dividend matches, with an estimate and an expected payment date. Nothing is added
// automatically: confirming one is a normal dividend entry.
import type { IsoDate } from '@joinr/schema';
import { addDaysIso, centsOf, dayNumber, dec, decimalString, ratioString } from './num';
import { unitsBeforeOf } from './dividends';
import type {
  DividendEventInput,
  DividendSuggestionResult,
  EngineDividend,
  EngineTrade,
} from './types';

/** The expected gap between an ex-date and its payment without history (D62). */
export const DEFAULT_PAYMENT_LAG_DAYS = 14;
/** A payment without an ex-date matches an event 0–90 days before it (D62). */
export const MATCH_WINDOW_DAYS = 90;
/** Only AUD listings are suggested (D62, §11 fix 10). */
const SUGGESTED_CURRENCY = 'AUD';

/** The median of whole-day lags (the rounded mean of the two middle ones for an even count). */
function medianLag(lags: readonly number[]): number {
  const sorted = [...lags].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

export function dividendSuggestions(i: {
  asOf: IsoDate;
  events: readonly DividendEventInput[];
  trades: readonly EngineTrade[];
  dividends: readonly EngineDividend[];
}): DividendSuggestionResult[] {
  const asOf = i.asOf;
  dayNumber(asOf);
  const unitsBefore = unitsBeforeOf(i.trades);
  const dividendsOf = (instrumentId: number) =>
    i.dividends.filter((d) => d.instrumentId === instrumentId);
  const eventsOf = (instrumentId: number) =>
    i.events.filter((e) => e.instrumentId === instrumentId);

  // Step 5: the instrument's usual lag, from its payments with both dates and 0 ≤ lag ≤ 90.
  const lagOf = (instrumentId: number): number => {
    const lags = dividendsOf(instrumentId)
      .filter((d) => d.exDate !== null)
      .map((d) => dayNumber(d.paymentDate) - dayNumber(d.exDate!))
      .filter((lag) => lag >= 0 && lag <= MATCH_WINDOW_DAYS);
    return lags.length === 0 ? DEFAULT_PAYMENT_LAG_DAYS : medianLag(lags);
  };

  // Step 3: an event is matched by a payment with its ex-date, or by a payment without an ex-date
  // paid 0–90 days after it when it is the instrument's latest event on or before that payment.
  const matched = (e: DividendEventInput): boolean => {
    const exDay = dayNumber(e.exDate);
    for (const d of dividendsOf(e.instrumentId)) {
      if (d.exDate !== null) {
        if (d.exDate === e.exDate) return true;
        continue;
      }
      const lag = dayNumber(d.paymentDate) - exDay;
      if (lag < 0 || lag > MATCH_WINDOW_DAYS) continue;
      const latest = eventsOf(e.instrumentId)
        .filter((x) => x.exDate <= d.paymentDate)
        .reduce<DividendEventInput | null>(
          (best, x) => (best === null || x.exDate > best.exDate ? x : best),
          null,
        );
      if (latest !== null && latest.exDate === e.exDate) return true;
    }
    return false;
  };

  const out: DividendSuggestionResult[] = [];
  for (const e of i.events) {
    dayNumber(e.exDate);
    // Step 1: AUD listings with an ex-date on or before asOf.
    if (e.currency !== SUGGESTED_CURRENCY || e.exDate > asOf) continue;
    // Step 2: units held before the ex-date.
    const units = unitsBefore(e.instrumentId, e.exDate);
    if (!units.greaterThan(0)) continue;
    if (matched(e)) continue;
    // Step 4: the estimate, gross of any withholding; the yield on the close before the ex-date.
    const amount = dec(e.amountPerUnit, `event ${e.instrumentId} ${e.exDate} amount`);
    const close =
      e.closeBeforeEx === null ? null : dec(e.closeBeforeEx, `event ${e.instrumentId} close`);
    const expectedPaymentDate = addDaysIso(e.exDate, lagOf(e.instrumentId));
    out.push({
      instrumentId: e.instrumentId,
      exDate: e.exDate,
      amountPerUnit: e.amountPerUnit,
      unitsAtEx: decimalString(units),
      estimatedNetCents: centsOf(units.times(amount)),
      priceAtEx: e.closeBeforeEx,
      yieldRatio: close === null || !close.greaterThan(0) ? null : ratioString(amount.div(close)),
      expectedPaymentDate,
      // Step 6.
      status: e.dismissed ? 'dismissed' : expectedPaymentDate <= asOf ? 'due' : 'upcoming',
    });
  }
  // Step 7: ex-date descending, then instrument id.
  return out.sort(
    (a, b) =>
      (a.exDate < b.exDate ? 1 : a.exDate > b.exDate ? -1 : 0) || a.instrumentId - b.instrumentId,
  );
}
