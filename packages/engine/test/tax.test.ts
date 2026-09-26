// The marginal-rate suggestion (stage-5.md §2.10, §7.3 step 6; D85, D90). Hand-worked cases on the
// public ATO tables of `@joinr/schema` (§3.2); generic incomes only.
import { describe, expect, it } from 'vitest';
import { suggestMarginalRate } from '../src/index';

const FY2024 = '2025-03-01'; // FY2024–25 (16 %)
const FY2026 = '2026-09-24'; // FY2026–27 (15 %)
const FY2027 = '2027-09-01'; // FY2027–28 (14 %)

const s = (incomeCents: number | null, asOf = FY2026) => suggestMarginalRate({ incomeCents, asOf });

describe('suggestMarginalRate: the bracket and the income tax (§2.10)', () => {
  it('finds the band with threshold < income ≤ next threshold, at every edge and 50 cents above', () => {
    const cases: [number, number, number | null, string][] = [
      [0, 0, 1_820_000, '0'],
      [1_820_000, 0, 1_820_000, '0'],
      [1_820_050, 1_820_000, 4_500_000, '0.15'],
      [4_500_000, 1_820_000, 4_500_000, '0.15'],
      [4_500_050, 4_500_000, 13_500_000, '0.3'],
      [13_500_000, 4_500_000, 13_500_000, '0.3'],
      [13_500_050, 13_500_000, 19_000_000, '0.37'],
      [19_000_000, 13_500_000, 19_000_000, '0.37'],
      [19_000_050, 19_000_000, null, '0.45'],
    ];
    for (const [income, thresholdCents, toCents, ratio] of cases) {
      const r = s(income)!;
      expect(r.bracket, String(income)).toEqual({ thresholdCents, toCents, ratio });
      expect(r.bracketRatio).toBe(ratio);
    }
  });

  it('sums the tax over every band, rounded once (FY2026–27)', () => {
    const tax = (income: number) => s(income)!.incomeTaxCents;
    expect(tax(0)).toBe(0);
    expect(tax(1_820_000)).toBe(0);
    expect(tax(1_820_050)).toBe(8); // 50 × 0.15 = 7.5 → 8
    expect(tax(4_500_000)).toBe(402_000);
    expect(tax(4_500_050)).toBe(402_015);
    expect(tax(13_500_000)).toBe(3_102_000);
    expect(tax(13_500_050)).toBe(3_102_019); // + 18.5
    expect(tax(19_000_000)).toBe(5_137_000);
    expect(tax(19_000_050)).toBe(5_137_023); // + 22.5
    expect(tax(9_000_000)).toBe(1_752_000);
  });

  it('uses the table of the FY: 16 % in FY2024–25, 14 % in FY2027–28', () => {
    const a = s(4_500_050, FY2024)!;
    expect(a.financialYear).toBe(2024);
    expect(a.tableFinancialYear).toBe(2024);
    expect(a.tableCurrent).toBe(true);
    expect(a.incomeTaxCents).toBe(428_815); // 2,680,000 × 0.16 + 50 × 0.3
    expect(s(1_820_050, FY2024)!.bracket.ratio).toBe('0.16');
    const b = s(4_500_050, FY2027)!;
    expect(b.financialYear).toBe(2027);
    expect(b.incomeTaxCents).toBe(375_215); // 2,680,000 × 0.14 + 15
    expect(s(1_820_050, FY2027)!.bracketRatio).toBe('0.14');
  });

  it('falls back to the latest table for an FY after the last one (tableCurrent false)', () => {
    const r = s(9_000_000, '2029-01-15')!;
    expect(r.financialYear).toBe(2028);
    expect(r.tableFinancialYear).toBe(2027);
    expect(r.tableCurrent).toBe(false);
    expect(r.bracketRatio).toBe('0.3');
  });

  it('gives no suggestion without an income or for a negative one', () => {
    expect(s(null)).toBeNull();
    expect(s(-1)).toBeNull();
    expect(() => s(1.5)).toThrow(RangeError);
    expect(() => s(100, '2026-02-30')).toThrow(RangeError);
  });
});

describe('suggestMarginalRate: the Medicare levy and the suggested rate (§2.10; D90)', () => {
  it('has no levy up to the threshold, 10 c/$ to threshold × 1.25, then 2 % of the income', () => {
    // FY2026–27 has no announced threshold: FY2025–26's applies.
    const at = (income: number) => s(income)!.medicare;
    expect(at(2_801_100)).toEqual({
      thresholdCents: 2_801_100,
      thresholdFinancialYear: 2025,
      ratio: '0',
      band: 'none',
    });
    expect(s(2_801_100)!.medicareLevyCents).toBe(0);
    expect(at(2_801_150)).toMatchObject({ ratio: '0.1', band: 'shade_in' });
    expect(s(2_801_150)!.medicareLevyCents).toBe(5);
    // threshold × 1.25 = 3,501,375 cents: still the shade-in; one cent more is the full levy.
    expect(at(3_501_375)).toMatchObject({ band: 'shade_in' });
    expect(s(3_501_375)!.medicareLevyCents).toBe(70_028); // 0.1 × 700,275 = 70,027.5
    expect(at(3_501_376)).toMatchObject({ ratio: '0.02', band: 'full' });
    expect(s(3_501_376)!.medicareLevyCents).toBe(70_028); // 0.02 × 3,501,376 = 70,027.52
  });

  it("uses the FY's own threshold where there is one", () => {
    const r = s(2_722_250, FY2024)!;
    expect(r.medicare).toMatchObject({
      thresholdCents: 2_722_200,
      thresholdFinancialYear: 2024,
      band: 'shade_in',
    });
    expect(s(2_722_200, FY2024)!.medicare.band).toBe('none');
  });

  it('suggests the bracket plus the marginal levy rate; the bracket is offered alone too (D90)', () => {
    const r = s(9_000_000)!;
    expect(r.bracketRatio).toBe('0.3');
    expect(r.medicare.band).toBe('full');
    expect(r.suggestedRatio).toBe('0.32');
    expect(r.medicareLevyCents).toBe(180_000);
    expect(r.incomeCents).toBe(9_000_000);
    expect(s(3_000_000)!.suggestedRatio).toBe('0.25'); // 15 % + the 10 % shade-in
    expect(s(0)!.suggestedRatio).toBe('0');
  });

  it('flags the LITO phase-out range ($37,500, $66,667]', () => {
    expect(s(3_750_000)!.litoPhaseOut).toBe(false);
    expect(s(3_750_001)!.litoPhaseOut).toBe(true);
    expect(s(6_666_700)!.litoPhaseOut).toBe(true);
    expect(s(6_666_701)!.litoPhaseOut).toBe(false);
  });
});
