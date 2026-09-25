// The XIRR solver (stage-2.md §2.7): Newton from 0.1, then an overflow-safe bracket. Assertions are
// on results, the method and the iteration count, never on wall-clock time.
import { describe, expect, it } from 'vitest';
import { xirr } from '../src/index';
import { addDaysIso } from '../src/num';
import { solveXirr, type XirrFlow } from '../src/xirr';

const DAY0 = '2020-01-01';
const at = (days: number, amount: number): XirrFlow => ({ amount, date: addDaysIso(DAY0, days) });

/** f(r) in plain floats, for residual checks. */
function npv(flows: readonly XirrFlow[], r: number): number {
  const d0 = Math.min(...flows.map((f) => Date.parse(f.date)));
  return flows.reduce(
    (s, f) => s + f.amount * Math.pow(1 + r, -(Date.parse(f.date) - d0) / 86_400_000 / 365),
    0,
  );
}

describe('xirr (§2.7)', () => {
  it('solves the closed form: −1000 → +1100 after 365 days = 10 %', () => {
    const s = solveXirr([at(0, -1000), at(365, 1100)]);
    expect(s.method).toBe('newton');
    expect(s.rate).toBeCloseTo(0.1, 10);
    expect(xirr([at(0, -1000), at(365, 1100)])).toBeCloseTo(0.1, 10);
  });

  it('solves a loss: −1000 → +100 after a year = −90 %', () => {
    expect(xirr([at(0, -1000), at(365, 100)])).toBeCloseTo(-0.9, 9);
  });

  it('solves a +150 % month', () => {
    const r = xirr([at(0, -1000), at(30, 2500)])!;
    expect(r).toBeCloseTo(Math.pow(2.5, 365 / 30) - 1, 0);
    expect(Math.abs(npv([at(0, -1000), at(30, 2500)], r))).toBeLessThan(1e-7 * 3500);
  });

  it('solves mixed buys and sells', () => {
    const flows = [at(0, -1000), at(100, -500), at(200, 300), at(400, 1400)];
    const r = xirr(flows)!;
    expect(r).toBeGreaterThan(0);
    expect(Math.abs(npv(flows, r))).toBeLessThan(1e-7 * 3200);
  });

  it('falls back to the bracket when Newton leaves its domain (a heavy loss)', () => {
    const flows = [at(0, -1000), at(182, -1000), at(329, 150)];
    const s = solveXirr(flows);
    expect(s.method).toBe('bracket');
    expect(s.rate).not.toBeNull();
    expect(s.rate!).toBeGreaterThan(-1);
    expect(s.rate!).toBeLessThan(-0.9);
    expect(Math.abs(npv(flows, s.rate!))).toBeLessThanOrEqual(1e-7 * 2150);
  });

  it('stays finite over a 40-year span with flows of both signs (the overflow guard)', () => {
    const flows = [at(0, -1000), at(365 * 20, 50), at(365 * 40, 10)];
    const s = solveXirr(flows);
    expect(s.rate).not.toBeNull();
    expect(Number.isFinite(s.rate!)).toBe(true);
    expect(s.rate!).toBeGreaterThan(-1);
  });

  it('returns null when all flows share one date or one sign', () => {
    expect(xirr([at(0, -1000), at(0, 1100)])).toBeNull();
    expect(xirr([at(0, -1000), at(30, -1100)])).toBeNull();
    expect(xirr([at(0, 1000), at(30, 1100)])).toBeNull();
    expect(xirr([at(0, -1000)])).toBeNull();
    expect(xirr([])).toBeNull();
  });

  it('finds a near-zero root of 1e-7', () => {
    const r = xirr([at(0, -1000), at(365, 1000.0001)])!;
    expect(r).toBeCloseTo(1e-7, 12);
  });

  it('converges by Newton on a 2000-flow input within 50 iterations', () => {
    const flows: XirrFlow[] = [];
    for (let i = 0; i < 1999; i++) flows.push(at(i, -100));
    flows.push(at(2100, 260_000));
    const s = solveXirr(flows);
    expect(s.method).toBe('newton');
    expect(s.iterations).toBeLessThanOrEqual(50);
    expect(Math.abs(npv(flows, s.rate!))).toBeLessThan(1e-7 * 459_900);
  });

  it('treats a malformed date as a programmer error', () => {
    expect(() => xirr([{ amount: -1, date: '2020-13-01' }, at(1, 2)])).toThrow(RangeError);
  });
});
