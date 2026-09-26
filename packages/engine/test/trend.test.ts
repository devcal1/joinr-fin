// The linear trend (stage-5.md §2.8, §7.3 step 4). Hand-worked least squares on day numbers.
import { describe, expect, it } from 'vitest';
import { linearTrend } from '../src/index';

describe('linearTrend (§2.8)', () => {
  it('fits a hand-worked line through three points', () => {
    // Days 0, 10, 20 from 2026-01-01 with 100, 300, 200 cents: x̄ = 10, ȳ = 200,
    // slope = Σ dx·dy / Σ dx² = (−10·−100 + 10·0) / 200 = 5 cents a day, intercept 150 at day 0.
    const r = linearTrend([
      { date: '2026-01-01', valueCents: 100 },
      { date: '2026-01-11', valueCents: 300 },
      { date: '2026-01-21', valueCents: 200 },
    ]);
    expect(r.fittedCents).toEqual([150, 200, 250]);
    expect(r.points).toBe(3);
    // 5 × 365.25 ÷ 12 = 152.1875 → 152.
    expect(r.slopePerMonthCents).toBe(152);
  });

  it('skips null points (null fitted there) and fits the others', () => {
    const r = linearTrend([
      { date: '2026-01-01', valueCents: 0 },
      { date: '2026-01-05', valueCents: null },
      { date: '2026-01-11', valueCents: 1_000 },
    ]);
    expect(r.fittedCents).toEqual([0, null, 1_000]);
    expect(r.points).toBe(2);
    expect(r.slopePerMonthCents).toBe(3_044); // 100 a day × 30.4375
  });

  it('gives no line with one point, no point, or a single distinct date', () => {
    expect(linearTrend([{ date: '2026-01-01', valueCents: 5 }])).toEqual({
      fittedCents: [null],
      slopePerMonthCents: null,
      points: 1,
    });
    expect(linearTrend([])).toEqual({ fittedCents: [], slopePerMonthCents: null, points: 0 });
    expect(
      linearTrend([
        { date: '2026-01-01', valueCents: 5 },
        { date: '2026-01-01', valueCents: 9 },
        { date: '2026-01-02', valueCents: null },
      ]),
    ).toEqual({ fittedCents: [null, null, null], slopePerMonthCents: null, points: 2 });
  });

  it('rounds each fitted value once, half away from zero, and handles a falling line', () => {
    const r = linearTrend([
      { date: '2026-01-01', valueCents: 0 },
      { date: '2026-01-03', valueCents: -1 },
    ]);
    expect(r.fittedCents).toEqual([0, -1]);
    expect(r.slopePerMonthCents).toBe(-15); // −0.5 a day × 30.4375 = −15.21875
  });

  it('refuses a malformed date or non-integer cents', () => {
    expect(() => linearTrend([{ date: '2026-13-01', valueCents: 1 }])).toThrow(RangeError);
    expect(() =>
      linearTrend([
        { date: '2026-01-01', valueCents: 1.5 },
        { date: '2026-01-02', valueCents: 1 },
      ]),
    ).toThrow(RangeError);
  });
});
