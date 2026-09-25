// XIRR (stage-2.md §2.7): f(r) = Σ aᵢ (1 + r)^(−tᵢ), tᵢ = (dayᵢ − day_min) / 365, solved for r > −1.
// Newton from 0.1 first (the root Sheets and Excel find in practice); when it leaves its domain,
// meets a zero or non-finite derivative or does not converge, a bracket-and-bisect fallback whose
// sign tests use an overflow-safe scaled form. Float64 is used here only (§2.1).
import type { IsoDate } from '@joinr/schema';
import { dayNumber } from './num';

export interface XirrFlow {
  /** Dollars. */
  amount: number;
  date: IsoDate;
}

export interface XirrSolution {
  rate: number | null;
  method: 'newton' | 'bracket' | null;
  iterations: number;
}

const NEWTON_START = 0.1;
const NEWTON_MAX_ITERATIONS = 50;
const NEWTON_STEP_TOLERANCE = 1e-10;
const RESIDUAL_TOLERANCE = 1e-7;
const DOMAIN_MAX = 1e9;
const BRACKET_LO = -0.9999999999;
const BRACKET_HI_START = 1;
const BRACKET_WIDTH = 1e-12;
const BRACKET_MAX_ITERATIONS = 500;

interface Prepared {
  a: number[];
  t: number[];
  absSum: number;
}

function prepare(flows: readonly XirrFlow[]): Prepared | null {
  if (flows.length < 2) return null;
  const days = flows.map((f) => dayNumber(f.date));
  for (const f of flows) {
    if (!Number.isFinite(f.amount)) {
      throw new RangeError(`xirr: amounts must be finite numbers: ${f.amount}`);
    }
  }
  if (new Set(days).size < 2) return null;
  if (!flows.some((f) => f.amount > 0) || !flows.some((f) => f.amount < 0)) return null;
  const first = Math.min(...days);
  return {
    a: flows.map((f) => f.amount),
    t: days.map((d) => (d - first) / 365),
    absSum: flows.reduce((s, f) => s + Math.abs(f.amount), 0),
  };
}

/** f(r) and f'(r) in plain float arithmetic (may overflow; the caller checks). */
function evaluate(p: Prepared, r: number): { f: number; df: number } {
  let f = 0;
  let df = 0;
  const base = 1 + r;
  for (let i = 0; i < p.a.length; i++) {
    const ai = p.a[i]!;
    const ti = p.t[i]!;
    const v = ai * Math.pow(base, -ti);
    f += v;
    df += (-ti * v) / base;
  }
  return { f, df };
}

/**
 * The sign of f(r) through the scaled form g(r) = Σ aᵢ·exp(eᵢ − max e), eᵢ = −tᵢ·ln(1 + r):
 * it has the sign of f and stays finite for any span (§2.7 overflow guard).
 */
function scaledValue(p: Prepared, r: number): number {
  const ln = Math.log1p(r);
  let maxE = -Infinity;
  const e = p.t.map((ti) => {
    const v = -ti * ln;
    if (v > maxE) maxE = v;
    return v;
  });
  let g = 0;
  for (let i = 0; i < p.a.length; i++) g += p.a[i]! * Math.exp(e[i]! - maxE);
  return g;
}

function newton(
  p: Prepared,
): { rate: number; iterations: number } | { rate: null; iterations: number } {
  let r = NEWTON_START;
  const tolerance = RESIDUAL_TOLERANCE * p.absSum;
  for (let i = 1; i <= NEWTON_MAX_ITERATIONS; i++) {
    const { f, df } = evaluate(p, r);
    if (!Number.isFinite(f) || !Number.isFinite(df) || df === 0)
      return { rate: null, iterations: i };
    const next = r - f / df;
    if (!Number.isFinite(next) || next <= -1 || next >= DOMAIN_MAX) {
      return { rate: null, iterations: i };
    }
    const step = Math.abs(next - r);
    r = next;
    if (step < NEWTON_STEP_TOLERANCE) {
      const residual = evaluate(p, r).f;
      if (Number.isFinite(residual) && Math.abs(residual) <= tolerance)
        return { rate: r, iterations: i };
    }
  }
  return { rate: null, iterations: NEWTON_MAX_ITERATIONS };
}

function bracket(p: Prepared): { rate: number | null; iterations: number } {
  let lo = BRACKET_LO;
  let hi = BRACKET_HI_START;
  const gLo = scaledValue(p, lo);
  if (gLo === 0) return { rate: lo, iterations: 0 };
  const sLo = Math.sign(gLo);
  let gHi = scaledValue(p, hi);
  let iterations = 0;
  while (Math.sign(gHi) === sLo) {
    hi *= 2;
    iterations++;
    if (hi > DOMAIN_MAX) return { rate: null, iterations };
    gHi = scaledValue(p, hi);
  }
  if (gHi === 0) return { rate: hi, iterations };
  for (let i = 0; i < BRACKET_MAX_ITERATIONS && hi - lo >= BRACKET_WIDTH; i++) {
    iterations++;
    const mid = lo + (hi - lo) / 2;
    if (mid <= lo || mid >= hi) break; // no representable midpoint left
    const gMid = scaledValue(p, mid);
    if (gMid === 0) return { rate: mid, iterations };
    if (Math.sign(gMid) === sLo) lo = mid;
    else hi = mid;
  }
  return { rate: lo + (hi - lo) / 2, iterations };
}

/** The solver with its method and iteration count (tests assert on these, never on time). */
export function solveXirr(flows: readonly XirrFlow[]): XirrSolution {
  const p = prepare(flows);
  if (p === null) return { rate: null, method: null, iterations: 0 };
  const n = newton(p);
  if (n.rate !== null) return { rate: n.rate, method: 'newton', iterations: n.iterations };
  const b = bracket(p);
  if (b.rate !== null && Number.isFinite(b.rate)) {
    return { rate: b.rate, method: 'bracket', iterations: b.iterations };
  }
  return { rate: null, method: null, iterations: n.iterations + b.iterations };
}

/** The annual rate of the flows (amounts in dollars), or null when there is no root (§2.7). */
export function xirrRate(flows: readonly XirrFlow[]): number | null {
  return solveXirr(flows).rate;
}
