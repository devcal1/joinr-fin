// Dividend suggestions (stage-3.md §2.11; D50, D62; §7.3 step 8). Generic instruments and events.
import { describe, expect, it } from 'vitest';
import { dividendSuggestions, type DividendEventInput } from '../src/index';
import { dividend, ratio, D, trade } from './helpers';

const event = (
  instrumentId: number,
  exDate: string,
  amountPerUnit: string,
  closeBeforeEx: string | null,
  over: Partial<DividendEventInput> = {},
): DividendEventInput => ({
  instrumentId,
  exDate,
  amountPerUnit,
  currency: 'AUD',
  closeBeforeEx,
  dismissed: false,
  ...over,
});

const trades = [
  trade(1, 1, '2026-01-01', '100', '10'),
  trade(2, 2, '2026-01-01', '10', '10'),
  trade(3, 3, '2025-01-10', '30', '90'),
  trade(4, 3, '2026-05-01', '5', '100'),
  trade(5, 4, '2024-01-10', '1000', '45'),
  trade(6, 5, '2024-09-10', '1000', '1.4'),
  trade(7, 6, '2026-09-01', '10', '20'),
];
const dividends = [
  // Instrument 4 paid 15, 15, 19 and 15 days after its ex-dates.
  dividend(1, 4, '2025-10-16', 12_500, { holdingKind: 'etf', exDate: '2025-10-01' }),
  dividend(2, 4, '2026-01-17', 12_600, { holdingKind: 'etf', exDate: '2026-01-02' }),
  dividend(3, 4, '2026-04-20', 13_000, { holdingKind: 'etf', exDate: '2026-04-01' }),
  dividend(4, 4, '2026-07-16', 13_500, { holdingKind: 'etf', exDate: '2026-07-01' }),
  // Instrument 3: a payment without an ex-date.
  dividend(5, 3, '2026-07-20', 4_200, { holdingKind: 'etf', exDate: null }),
  // Instrument 1: one lag of 19 days, and one outside 0–90 days (ignored for the lag).
  dividend(6, 1, '2026-03-20', 3_000, { exDate: '2026-03-01' }),
  dividend(7, 1, '2025-12-31', 3_000, { exDate: '2025-06-01' }),
];
const events: DividendEventInput[] = [
  event(4, '2026-07-01', '0.1125', '52'), // matched by the ex-date
  event(4, '2026-09-18', '0.115', '53.1'),
  event(3, '2026-07-01', '1.2', '104'), // matched by the payment without an ex-date
  event(3, '2026-04-01', '1.1', '100'), // 110 days before that payment: not matched
  event(3, '2026-09-01', '1.35', '105.2'), // the next quarter: not matched
  event(1, '2026-03-02', '0.3', '11.8', { dismissed: true }),
  event(5, '2026-09-05', '0.02', '1.55', { currency: 'USD' }), // not AUD
  event(6, '2026-08-01', '0.5', '20'), // no units before the ex-date
  event(4, '2026-09-30', '0.1', '53'), // after asOf
  event(1, '2026-09-10', '0.25', null),
  event(2, '2026-09-18', '0.2', '10'),
];

describe('dividendSuggestions (§2.11)', () => {
  const r = dividendSuggestions({ asOf: '2026-09-24', events, trades, dividends });

  it('suggests the unmatched AUD events with units, ex-date descending then instrument', () => {
    expect(r.map((s) => [s.instrumentId, s.exDate, s.status])).toEqual([
      [2, '2026-09-18', 'upcoming'],
      [4, '2026-09-18', 'upcoming'],
      [1, '2026-09-10', 'upcoming'],
      [3, '2026-09-01', 'due'],
      [3, '2026-04-01', 'due'],
      [1, '2026-03-02', 'dismissed'],
    ]);
  });

  it('estimates the payment and its yield on the close before the ex-date', () => {
    expect(r[1]).toEqual({
      instrumentId: 4,
      exDate: '2026-09-18',
      amountPerUnit: '0.115',
      unitsAtEx: '1000',
      estimatedNetCents: 11_500,
      priceAtEx: '53.1',
      yieldRatio: ratio(D('0.115').div('53.1')),
      // The median of 15, 15, 15 and 19 days (the two middle ones are both 15).
      expectedPaymentDate: '2026-10-03',
      status: 'upcoming',
    });
    // No close: no yield. Instrument 1's usual lag is 19 days (the 213-day one is ignored).
    expect(r[2]).toMatchObject({
      unitsAtEx: '100',
      estimatedNetCents: 2_500,
      priceAtEx: null,
      yieldRatio: null,
      expectedPaymentDate: '2026-09-29',
    });
    // Units before the ex-date only (the May buy counts for September, not for April).
    expect(r[3]).toMatchObject({
      unitsAtEx: '35',
      estimatedNetCents: 4_725,
      expectedPaymentDate: '2026-09-15',
    });
    expect(r[4]).toMatchObject({
      unitsAtEx: '30',
      estimatedNetCents: 3_300,
      expectedPaymentDate: '2026-04-15',
    });
  });

  it('shows a dismissed event as dismissed whatever its dates', () => {
    expect(r[5]).toMatchObject({ unitsAtEx: '100', estimatedNetCents: 3_000, status: 'dismissed' });
  });

  it('matches a payment without an ex-date to its own distribution, 0–90 days before it', () => {
    const suggest = (paymentDate: string) =>
      dividendSuggestions({
        asOf: '2026-12-31',
        events: [event(3, '2026-07-01', '1.2', '104')],
        trades,
        dividends: [dividend(9, 3, paymentDate, 4_200, { holdingKind: 'etf' })],
      });
    expect(suggest('2026-07-01')).toEqual([]); // paid on the ex-date: 0 days
    expect(suggest('2026-09-29')).toEqual([]); // 90 days
    expect(suggest('2026-09-30')).toHaveLength(1); // 91 days: not this event's payment
    expect(suggest('2026-06-30')).toHaveLength(1); // paid before the ex-date
  });

  it('takes the rounded mean of the two middle lags for an even count', () => {
    const r2 = dividendSuggestions({
      asOf: '2026-12-31',
      events: [event(4, '2026-10-01', '0.1', '50')],
      trades,
      dividends: [
        dividend(1, 4, '2026-01-12', 100, { holdingKind: 'etf', exDate: '2026-01-02' }),
        dividend(2, 4, '2026-04-14', 100, { holdingKind: 'etf', exDate: '2026-04-01' }),
      ],
    });
    // Lags 10 and 13: round(11.5) = 12.
    expect(r2[0]!.expectedPaymentDate).toBe('2026-10-13');
    const none = dividendSuggestions({
      asOf: '2026-12-31',
      events: [event(4, '2026-10-01', '0.1', '50')],
      trades,
      dividends: [],
    });
    expect(none[0]!.expectedPaymentDate).toBe('2026-10-15');
  });
});
