// Sheet mode (stage-6.md §2.6, §7.3 step 3): the Sheets functions at documented values, the value
// rules the tab relies on (ROUNDUP signs, IFERROR texts, text above numbers, "" as 0), and the tab
// on generic inputs, including the grid branches the local workbook does not exercise (accumulation
// I:K, top-ups P:R, growth only S), cross-checked with a doubles re-derivation and the row
// identities N(t) = N(t−1) + K(t) and T(t) = T(t−1) + R(t) + S(t). Generic values only.
import { describe, expect, it } from 'vitest';
import { fireSheet } from '../src/index';
import type { FireSheetInput, FireSheetValue } from '../src/index';
import { sheetFunctions as F } from '../src/fireSheet';

const FIRE = "You're FIRE! ✅";

const near = (v: FireSheetValue | undefined, expected: number, tol = 1e-9): void => {
  expect(typeof v).toBe('number');
  expect(Math.abs((v as number) - expected)).toBeLessThanOrEqual(
    Math.max(tol, 1e-12 * Math.abs(expected)),
  );
};
const num = (v: FireSheetValue | undefined): number => {
  expect(typeof v).toBe('number');
  return v as number;
};

describe('the Sheets financial functions (type 0) at documented values', () => {
  it('PMT: a $10,000 loan over 10 months at 8 % a year costs $1,037.03 a month', () => {
    // −10,000 × q × r ÷ (q − 1), q = (1 + 0.08/12)^10.
    near(F.PMT(0.08 / 12, 10, 10000, 0), -1037.0320893591606, 1e-6);
  });

  it('PV: $500 a month for 20 years at 8 % is worth $59,777.15 today', () => {
    near(F.PV(0.08 / 12, 240, 500, 0), -59777.14585118777, 1e-6);
  });

  it('FV: $1,000 a month for 12 months at 12 % a year grows to $12,682.50', () => {
    near(F.FV(0.12 / 12, 12, -1000, 0), 12682.503013196976, 1e-6);
  });

  it('NPER: $100 a month at 12 % from −$1,000 to $10,000 takes 60.08 months', () => {
    // ln((−100 − 10,000 × 0.01) ÷ (−100 − 1,000 × 0.01)) ÷ ln(1.01) = ln(200/110) ÷ ln(1.01).
    near(F.NPER(0.01, -100, -1000, 10000), Math.log(200 / 110) / Math.log(1.01), 1e-9);
  });

  it('IPMT: the first month’s interest on $8,000 at 10 % over 3 years is −$66.67; year 3 of 3 −$292.45', () => {
    near(F.IPMT(0.1 / 12, 1, 36, 8000, 0), -66.66666666666667, 1e-9);
    near(F.IPMT(0.1, 3, 3, 8000, 0), -292.4471299093656, 1e-6);
  });

  it('PPMT: month 1 of $2,000 over 2 years at 10 % repays −$75.62; year 10 of $200,000 at 8 % −$27,598.05', () => {
    const r = 0.1 / 12;
    const q = (1 + r) ** 24;
    // PMT − IPMT = −2,000·r·q ÷ (q − 1) + 2,000·r.
    near(F.PPMT(r, 1, 24, 2000, 0), (-2000 * r * q) / (q - 1) + 2000 * r, 1e-9);
    near(F.PPMT(r, 1, 24, 2000, 0), -75.62, 0.005);
    near(F.PPMT(0.08, 10, 10, 200000, 0), -27598.05346, 1e-5);
  });

  it('PPMT + IPMT = PMT in every period, and the principal parts repay the loan', () => {
    let principal = 0;
    for (let per = 1; per <= 10; per++) {
      const pmt = num(F.PMT(0.05, 10, 1000, 0));
      near(num(F.PPMT(0.05, per, 10, 1000, 0)) + num(F.IPMT(0.05, per, 10, 1000, 0)), pmt, 1e-9);
      principal += num(F.PPMT(0.05, per, 10, 1000, 0));
    }
    near(principal, -1000, 1e-9);
  });

  it('takes the r = 0 limits', () => {
    expect(F.FV(0, 5, -100, -1000)).toBe(1500);
    expect(F.PV(0, 5, -100, 0)).toBe(500);
    expect(F.PMT(0, 4, 1000, 0)).toBe(-250);
    expect(F.NPER(0, -100, 1000, 0)).toBe(10);
  });

  it('gives #NUM! outside the domain and #VALUE! on a text operand', () => {
    expect(F.IPMT(0.05, 0, 10, 1000, 0)).toBe('#NUM!');
    expect(F.IPMT(0.05, 11, 10, 1000, 0)).toBe('#NUM!');
    // (p − f·r) ÷ (p + v·r) ≤ 0: no solution.
    expect(F.NPER(0.05, 100, -3000, 0)).toBe('#NUM!');
    expect(F.NPER(0.05, 'Neg. Savings Rate', 1000, 0)).toBe('#VALUE!');
    expect(F.PMT(0, 0, 1000, 0)).toBe('#DIV/0!');
  });
});

describe('the value rules', () => {
  it('ROUNDUP rounds away from zero; ROUNDDOWN toward zero', () => {
    expect(F.ROUNDUP(2.1)).toBe(3);
    expect(F.ROUNDUP(-2.1)).toBe(-3);
    expect(F.ROUNDUP(3)).toBe(3);
    expect(F.ROUNDUP(0)).toBe(0);
    expect(F.ROUNDDOWN(2.9)).toBe(2);
    expect(F.ROUNDDOWN(-2.9)).toBe(-2);
    expect(F.ROUNDUP('x')).toBe('#VALUE!');
  });

  it('IFERROR turns an error into its text', () => {
    expect(F.IFERROR_DIV(1, 0)).toBe('-');
    expect(F.IFERROR_DIV(1, 4)).toBe(0.25);
  });

  it('sorts text above every number; compares texts without case', () => {
    expect(F.compare('abc', 1e12)).toBe(1);
    expect(F.compare(-1e12, '')).toBe(-1);
    expect(F.compare(FIRE, 1e12)).toBe(1);
    expect(F.compare('A', 'a')).toBe(0);
    expect(F.compare(2, 10)).toBe(-1);
  });

  it('counts "" as 0 in arithmetic; other text is #VALUE!', () => {
    expect(F.add('', 5)).toBe(5);
    expect(F.add('x', 5)).toBe('#VALUE!');
  });
});

// ─── The tab on generic inputs ──────────────────────────────────────────────────────────────────

/** Accumulating: age 40 in 2030, access 60, spend $40,000, savings $30,000, growth 6 %, inflation 2 %. */
const ACCUMULATING: FireSheetInput = {
  today: '2030-03-15',
  birthYear: 1990,
  superContributionPerYear: 10000,
  inflation: 0.02,
  withdrawalRate: 0.04,
  accessAge: 60,
  preSuper: 100000,
  superBalance: 50000,
  savings: 30000,
  spend: 40000,
  growth: 0.06,
  salary: 80000,
  disclaimerAccepted: true,
};

/** The template's formulas in doubles (a re-derivation of spec 04 §5.3 for the headline cells). */
function reference(i: FireSheetInput) {
  const r = i.growth - i.inflation;
  const S = i.spend;
  const P = i.savings as number;
  const PV = (n: number, pmt: number, fv: number) =>
    -(fv + (pmt * ((1 + r) ** n - 1)) / r) / (1 + r) ** n;
  const FV = (n: number, pmt: number, pv: number) =>
    -(pv * (1 + r) ** n + (pmt * ((1 + r) ** n - 1)) / r);
  const NPER = (pmt: number, pv: number, fv: number) =>
    Math.log((pmt - fv * r) / (pmt + pv * r)) / Math.log(1 + r);
  const Y = Number(i.today.slice(0, 4));
  const E52 = i.accessAge - (Y - i.birthYear);
  const rows = i.birthYear + i.accessAge + 1 - Y + 1;
  const V = Array.from({ length: rows }, (_, h) => PV(E52 - h, -S, 0) * (1 + r) - S);
  const W = Array.from({ length: rows }, (_, h) => FV(h, -P, -i.preSuper));
  const X = V.map((v, h) => v - W[h]!);
  const V3 = E52 - X.filter((x) => x > S).length;
  const E53 = PV(V3, -S, 0);
  const E56 = Math.ceil(NPER(P, i.preSuper, -E53));
  const E60 = S / i.withdrawalRate;
  const E61 = FV(E56, -i.superContributionPerYear, -i.superBalance);
  const E62 = PV(E52 - E56 - 2, 0, -E60);
  const E64 = Math.ceil(NPER(i.salary!, E61, -E62));
  return {
    r,
    E52,
    rows,
    V,
    W,
    X,
    V3,
    E53,
    E54: PV(E52, -S, 0),
    E56,
    E60,
    E61,
    E62,
    E63: E62 - E61,
    E64,
  };
}

describe('fireSheet: an accumulating plan (every branch of the grid)', () => {
  const res = fireSheet(ACCUMULATING);
  const ref = reference(ACCUMULATING);
  const c = res.cells;

  it('reproduces the headline and forecast cells', () => {
    expect(c.E52).toBe(20);
    expect(c.V3).toBe(ref.V3);
    near(c.E53, ref.E53, 1e-6);
    near(c.E54, ref.E54, 1e-6);
    near(c.E55, ref.E53 - 100000, 1e-6);
    expect(c.E56).toBe(ref.E56);
    expect(c.E57).toBe(2030 + ref.E56);
    expect(c.E60).toBe(1000000);
    near(c.E61, ref.E61, 1e-6);
    near(c.E62, ref.E62, 1e-6);
    near(c.E63, ref.E63, 1e-6);
    expect(c.E64).toBe(ref.E64);
    // "Years to go" = E56 + E64 (the template's rule, fix 13 in the app).
    expect(c.D2).toBe(`${ref.E56 + ref.E64} Years to go`);
    expect(ref.E56).toBeGreaterThan(0);
    expect(ref.E64).toBeGreaterThan(0);
  });

  it('fills the KPI table: C15/(D15 + C15) and C16/(D16 + C16)', () => {
    expect(c.C15).toBe(100000);
    near(c.D15, ref.E53 - 100000, 1e-6);
    near(c.E15, 100000 / ref.E53, 1e-12);
    expect(c.C16).toBe(50000);
    near(c.E16, 50000 / (ref.E63 + 50000), 1e-12);
  });

  it('runs the grid from the current year to the access year + 1', () => {
    expect(res.rows).toHaveLength(ref.rows);
    expect(res.rows.map((r) => r.G)).toEqual(Array.from({ length: ref.rows }, (_, h) => 2030 + h));
    expect(res.rows.map((r) => r.H)).toEqual(Array.from({ length: ref.rows }, (_, h) => h));
    res.rows.forEach((row, h) => {
      near(row.V, ref.V[h]!, 1e-6);
      near(row.W, ref.W[h]!, 1e-6);
      near(row.X, ref.X[h]!, 1e-6);
    });
  });

  it('accumulates in I:K up to the FIRE year: N(t) = N(t−1) + K(t), reaching E53 there', () => {
    const fireYear = num(c.E57);
    const acc = res.rows.filter((r) => r.I !== '');
    expect(acc.map((r) => r.G)).toEqual(Array.from({ length: ref.E56 }, (_, k) => 2031 + k));
    for (let h = 1; h < res.rows.length; h++) {
      const row = res.rows[h]!;
      if (row.I === '') continue;
      // I is the level payment; J + K − I = 0 up to the template's sign games (J uses −E45, E53).
      near(num(row.I), num(res.rows[1]!.I), 1e-9);
      near(
        num(res.rows[h - 1]!.N) + num(row.K),
        row.G === fireYear ? num(c.E53) : num(row.N),
        1e-6,
      );
    }
    expect(res.rows.find((r) => r.G === fireYear)!.N).toBe(c.E53);
  });

  it('draws down from the FIRE year in L:M (M at the real rate), to the access year', () => {
    const fireRow = res.rows.findIndex((r) => r.G === c.E57);
    expect(res.rows[fireRow]!.L).toBe(c.E53);
    for (let h = fireRow + 1; h < res.rows.length - 1; h++) {
      const prev = res.rows[h - 1]!;
      near(num(res.rows[h]!.L), num(prev.L) - 40000 + num(prev.M), 1e-6);
      near(num(res.rows[h]!.M), num(res.rows[h]!.L) * ref.r, 1e-6);
    }
    expect(res.rows.at(-1)!.L).toBe('');
  });

  it('tops super up in P:R for E64 years after the FIRE year, then grows it in S', () => {
    const fireYear = num(c.E57);
    const topUps = res.rows.filter((r) => r.P !== '');
    expect(topUps.map((r) => r.G)).toEqual(
      Array.from({ length: ref.E64 }, (_, k) => fireYear + 1 + k),
    );
    expect(topUps.map((r) => r.O)).toEqual(Array.from({ length: ref.E64 }, (_, k) => 1 + k));
    const growth = res.rows.filter((r) => r.S !== '');
    expect(growth[0]!.G).toBe(fireYear + ref.E64 + 1);
    expect(growth.at(-1)!.G).toBe(2051);
    // T(t) = T(t−1) + R(t) + S(t) (R and S blank count 0); T at the FIRE year is E61.
    const fireRow = res.rows.findIndex((r) => r.G === fireYear);
    expect(res.rows[fireRow]!.T).toBe(c.E61);
    for (let h = fireRow + 1; h < res.rows.length; h++) {
      const row = res.rows[h]!;
      const r = row.R === '' ? 0 : num(row.R);
      const s = row.S === '' ? 0 : num(row.S);
      near(num(row.T), num(res.rows[h - 1]!.T) + r + s, 1e-6);
    }
    // The top-ups reach the self-sustaining balance (E62) after E64 years.
    near(num(topUps.at(-1)!.T), num(c.E62), 1e-6);
  });

  it('leaves row 4’s I:K and O blank (no formula in the template)', () => {
    const first = res.rows[0]!;
    expect([first.I, first.J, first.K, first.O, first.L, first.M]).toEqual([
      '',
      '',
      '',
      '',
      '',
      '',
    ]);
    expect(first.N).toBe(100000);
    // S4 reads the blank header above it as 0 only in the growth window; here it is blank.
    expect(first.S).toBe('');
  });
});

describe('fireSheet: the texts and the template’s bugs', () => {
  it('says "You’re FIRE" when super alone exceeds spend ÷ withdrawal rate, with E64 0 by text ordering', () => {
    const res = fireSheet({ ...ACCUMULATING, superBalance: 2000000 });
    expect(res.cells.D2).toBe(FIRE);
    expect(res.cells.E61).toBe(FIRE);
    expect(res.cells.E63).toBe(FIRE);
    expect(res.cells.D16).toBe(FIRE);
    // E61 is text, and text sorts above E60: E61 ≥ E60, so no top-up years.
    expect(res.cells.E64).toBe(0);
    expect(res.cells.E16).toBe('-');
  });

  it('draws down at the nominal rate in its first year (M4 = L4 × E49) when FIRE is this year', () => {
    const res = fireSheet({ ...ACCUMULATING, preSuper: 2000000 });
    expect(res.cells.E56).toBe(0);
    expect(res.cells.E57).toBe(2030);
    expect(res.cells.E55).toBe(FIRE);
    expect(res.cells.E15).toBe('-');
    const [r4, r5] = res.rows;
    near(num(r4!.M), num(r4!.L) * 0.06, 1e-6);
    near(num(r5!.M), num(r5!.L) * 0.04, 1e-6);
    // S4 reads the blank header above T4 as 0.
    expect(r4!.T).toBe(res.cells.E61);
  });

  it('reports "No Spend History" and "Yearly Spend Needed" without spend', () => {
    const res = fireSheet({ ...ACCUMULATING, spend: 0 });
    expect(res.cells.D2).toBe('No Spend History');
    expect(res.cells.E55).toBe('Yearly Spend Needed');
    expect(res.cells.E61).toBe('Yearly Spend Needed');
  });

  it('gates the ETA cells behind the disclaimer', () => {
    const res = fireSheet({ ...ACCUMULATING, disclaimerAccepted: false });
    expect(res.cells.D2).toBe('Accept Sheet Disclaimer');
    expect(res.cells.E56).toBe('Accept Disclaimer');
    expect(res.cells.E57).toBe('Accept Disclaimer');
    expect(res.cells.E64).toBe('Accept Disclaimer');
    expect(res.cells.E61).toBe('-');
  });

  it('breaks every calculation downstream of a text E47 ("Neg. Savings Rate")', () => {
    const res = fireSheet({ ...ACCUMULATING, savings: 'Neg. Savings Rate' });
    expect(res.cells.E56).toBe('-');
    expect(res.cells.E57).toBe('-');
    expect(res.cells.E61).toBe('-');
    expect(res.cells.D2).toBe('N/A - No Sheet History');
    expect(res.rows[0]!.W).toBe('#VALUE!');
    expect(res.rows[0]!.X).toBe('#VALUE!');
    // V does not read E47.
    expect(typeof res.rows[0]!.V).toBe('number');
    // With E57 text, O has no IFERROR: E57 + 1 is an error.
    expect(res.rows[1]!.O).toBe('#VALUE!');
    expect(res.rows[1]!.P).toBe('-');
  });

  it('adds the unexplained "− 2" to E62: PV over E52 − E56 − 2 years', () => {
    const res = fireSheet(ACCUMULATING);
    const ref = reference(ACCUMULATING);
    near(res.cells.E62, 1000000 / (1 + ref.r) ** (20 - ref.E56 - 2), 1e-6);
  });

  it('uses the salary, not the super contribution, as E64’s payment (the D99 bug)', () => {
    const low = fireSheet({ ...ACCUMULATING, salary: 20000 });
    const high = fireSheet({ ...ACCUMULATING, salary: 200000 });
    expect(num(low.cells.E64)).toBeGreaterThan(num(high.cells.E64));
    // A blank salary pays 0: E64 becomes the years for E61 to grow to E62 alone.
    const none = fireSheet({ ...ACCUMULATING, salary: null });
    const ref = reference(ACCUMULATING);
    expect(none.cells.E64).toBe(Math.ceil(Math.log(ref.E62 / ref.E61) / Math.log(1 + ref.r)));
  });

  it('rejects a malformed date as a programmer error', () => {
    expect(() => fireSheet({ ...ACCUMULATING, today: '2030-13-01' })).toThrow(RangeError);
  });
});
