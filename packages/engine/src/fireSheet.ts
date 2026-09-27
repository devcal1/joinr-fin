// Sheet mode (stage-6.md §2.6; spec 04 §5.3): the template's FIRE tab reproduced literally from its
// cached inputs, for the goldens and a future comparison panel (the server never calls it). A tiny
// spreadsheet value model gives the Sheets semantics the formulas rely on: numbers (decimals here),
// texts ("" for a blank formula result), a truly empty cell, and error values that propagate until
// an IFERROR catches them; text sorts above every number; IF is lazy while AND and OR evaluate
// every argument. The financial functions are the Sheets ones with type 0. Dates are serials
// (days since 30/12/1899), as the sheet compares them; the outputs give years for E57 and G.
import { JoinrDecimal } from '@joinr/schema';
import {
  dayNumber,
  decN,
  isoOfDayNumber,
  roundDownToward,
  roundUpAway,
  ZERO,
  type Dec,
} from './num';
import type {
  FireSheetCell,
  FireSheetColumn,
  FireSheetInput,
  FireSheetResult,
  FireSheetValue,
} from './types';

// ─── The value model ────────────────────────────────────────────────────────────────────────────

class SheetError {
  constructor(readonly code: string) {}
}
const VALUE = new SheetError('#VALUE!');
const NUM = new SheetError('#NUM!');
const DIV0 = new SheetError('#DIV/0!');

/** A truly empty cell (a merged header, a cell without a formula). */
const EMPTY = Symbol('empty');

/** Plain JS numbers are allowed for formula constants (1, 2, 0); they coerce to decimals. */
type Value = Dec | number | string | boolean | SheetError | typeof EMPTY;

const isDec = (v: Value): v is Dec => v instanceof JoinrDecimal;
const isErr = (v: unknown): v is SheetError => v instanceof SheetError;

const FIRE_TEXT = "You're FIRE! ✅";
/** Sheets rows 4…85: at most 82 grid years. */
const GRID_ROWS = 82;
/** Serial of 1970-01-01 (the 1900 date system of Sheets). */
const SERIAL_EPOCH = 25_569;

/** Number coercion: "" and empty count 0, booleans 1/0, other text is #VALUE!. */
function num(v: Value): Dec | SheetError {
  if (isDec(v) || isErr(v)) return v;
  if (typeof v === 'number') return decN(v);
  if (v === EMPTY || v === '') return ZERO;
  if (typeof v === 'boolean') return v ? decN(1) : ZERO;
  return VALUE;
}

/** A finite result, or #NUM! (overflow, NaN) / #DIV/0!. */
function finite(d: Dec, err: SheetError = NUM): Dec | SheetError {
  return d.isFinite() ? d : err;
}

function lift2(a: Value, b: Value, f: (x: Dec, y: Dec) => Dec | SheetError): Value {
  const x = num(a);
  if (isErr(x)) return x;
  const y = num(b);
  if (isErr(y)) return y;
  return f(x, y);
}

const add = (a: Value, b: Value): Value => lift2(a, b, (x, y) => x.plus(y));
const sub = (a: Value, b: Value): Value => lift2(a, b, (x, y) => x.minus(y));
const mul = (a: Value, b: Value): Value => lift2(a, b, (x, y) => finite(x.times(y)));
const div = (a: Value, b: Value): Value =>
  lift2(a, b, (x, y) => (y.isZero() ? DIV0 : finite(x.div(y))));
const neg = (a: Value): Value => {
  const x = num(a);
  return isErr(x) ? x : x.negated();
};

/** Sheets ordering: numbers < text < booleans; texts case-insensitive; empty is 0 or "". */
type Scalar = Dec | string | boolean;

function scalar(v: Exclude<Value, SheetError>, other: Exclude<Value, SheetError>): Scalar {
  if (typeof v === 'number') return decN(v);
  if (v !== EMPTY) return v;
  if (isDec(other) || typeof other === 'number') return ZERO;
  return typeof other === 'boolean' ? false : '';
}

function compare(a: Value, b: Value): number | SheetError {
  if (isErr(a)) return a;
  if (isErr(b)) return b;
  const x = scalar(a, b);
  const y = scalar(b, a);
  const rank = (v: Scalar) => (typeof v === 'boolean' ? 2 : typeof v === 'string' ? 1 : 0);
  if (rank(x) !== rank(y)) return rank(x) < rank(y) ? -1 : 1;
  if (typeof x === 'string' && typeof y === 'string') {
    const lx = x.toLowerCase();
    const ly = y.toLowerCase();
    return lx < ly ? -1 : lx > ly ? 1 : 0;
  }
  if (typeof x === 'boolean' && typeof y === 'boolean') return Number(x) - Number(y);
  return (x as Dec).comparedTo(y as Dec);
}

const cmpWith =
  (test: (c: number) => boolean) =>
  (a: Value, b: Value): Value => {
    const c = compare(a, b);
    return isErr(c) ? c : test(c);
  };
const eq = cmpWith((c) => c === 0);
const ne = cmpWith((c) => c !== 0);
const gt = cmpWith((c) => c > 0);
const ge = cmpWith((c) => c >= 0);
const lt = cmpWith((c) => c < 0);
const le = cmpWith((c) => c <= 0);

/** A condition's truth value (numbers: non-zero; "" false; other text #VALUE!). */
function truth(v: Value): boolean | SheetError {
  if (typeof v === 'boolean' || isErr(v)) return v;
  if (typeof v === 'number') return v !== 0;
  if (isDec(v)) return !v.isZero();
  if (v === EMPTY || v === '') return false;
  return VALUE;
}

/** IF: lazy branches. */
function IF(cond: Value, then: () => Value, otherwise: () => Value): Value {
  const c = truth(cond);
  if (isErr(c)) return c;
  return c ? then() : otherwise();
}

function IFERROR(value: Value, fallback: Value): Value {
  return isErr(value) ? fallback : value;
}

/** AND / OR: every argument evaluated; the first error wins. */
function AND(...values: Value[]): Value {
  let all = true;
  for (const v of values) {
    const c = truth(v);
    if (isErr(c)) return c;
    all &&= c;
  }
  return all;
}

function OR(...values: Value[]): Value {
  let any = false;
  for (const v of values) {
    const c = truth(v);
    if (isErr(c)) return c;
    any ||= c;
  }
  return any;
}

/** ROUNDUP(x, 0) away from zero; ROUNDDOWN(x, 0) toward zero. */
const ROUNDUP = (v: Value): Value => {
  const x = num(v);
  return isErr(x) ? x : roundUpAway(x, 0);
};
const ROUNDDOWN = (v: Value): Value => {
  const x = num(v);
  return isErr(x) ? x : roundDownToward(x, 0);
};

/** DATE(y, 1, 1) as a serial (years 0–1899 add 1900, as Sheets does). */
function DATE(yearValue: Value): Value {
  const y = num(yearValue);
  if (isErr(y)) return y;
  let year = y.toDecimalPlaces(0, JoinrDecimal.ROUND_DOWN).toNumber();
  if (year < 0 || year >= 10_000) return NUM;
  if (year < 1900) year += 1900;
  return decN(dayNumber(`${String(year).padStart(4, '0')}-01-01`) + SERIAL_EPOCH);
}

/** YEAR(serial). */
function YEAR(v: Value): Value {
  const x = num(v);
  if (isErr(x)) return x;
  const day = x.toDecimalPlaces(0, JoinrDecimal.ROUND_FLOOR).toNumber() - SERIAL_EPOCH;
  if (!Number.isSafeInteger(day)) return NUM;
  const iso = isoOfDayNumber(day);
  const year = Number(iso.slice(0, 4));
  return Number.isFinite(year) ? decN(year) : NUM;
}

/** `value & text`: a number as Sheets writes it (whole numbers without decimals). */
function concat(v: Value, text: string): Value {
  if (isErr(v)) return v;
  if (isDec(v)) return `${v.isZero() ? '0' : v.toFixed()}${text}`;
  if (v === EMPTY) return text;
  if (typeof v === 'boolean') return `${v ? 'TRUE' : 'FALSE'}${text}`;
  return `${v}${text}`;
}

// ─── The Sheets financial functions (type 0) ────────────────────────────────────────────────────

type Args = (Dec | SheetError)[];
const firstErr = (args: Args): SheetError | null => args.find(isErr) ?? null;
const pow = (base: Dec, exp: Dec): Dec => base.pow(exp);

/** FV(r, n, pmt, pv) = −(pv·(1+r)^n + pmt·((1+r)^n − 1)/r). */
function FV(rate: Value, nper: Value, pmt: Value, pv: Value): Value {
  const args = [num(rate), num(nper), num(pmt), num(pv)];
  const e = firstErr(args);
  if (e) return e;
  const [r, n, p, v] = args as Dec[];
  if (r!.isZero()) return v!.plus(p!.times(n!)).negated();
  const g = pow(r!.plus(1), n!);
  return finite(
    v!
      .times(g)
      .plus(p!.times(g.minus(1)).div(r!))
      .negated(),
  );
}

/** PV(r, n, pmt, fv) = −(fv + pmt·((1+r)^n − 1)/r)/(1+r)^n. */
function PV(rate: Value, nper: Value, pmt: Value, fv: Value): Value {
  const args = [num(rate), num(nper), num(pmt), num(fv)];
  const e = firstErr(args);
  if (e) return e;
  const [r, n, p, f] = args as Dec[];
  if (r!.isZero()) return f!.plus(p!.times(n!)).negated();
  const g = pow(r!.plus(1), n!);
  if (g.isZero()) return DIV0;
  return finite(
    f!
      .plus(p!.times(g.minus(1)).div(r!))
      .div(g)
      .negated(),
  );
}

/** PMT(r, n, pv, fv) = −(pv·(1+r)^n + fv)·r/((1+r)^n − 1). */
function PMT(rate: Value, nper: Value, pv: Value, fv: Value): Value {
  const args = [num(rate), num(nper), num(pv), num(fv)];
  const e = firstErr(args);
  if (e) return e;
  const [r, n, v, f] = args as Dec[];
  if (r!.isZero()) return n!.isZero() ? DIV0 : finite(v!.plus(f!).div(n!).negated());
  const g = pow(r!.plus(1), n!);
  const den = g.minus(1);
  if (den.isZero()) return DIV0;
  return finite(v!.times(g).plus(f!).times(r!).div(den).negated());
}

/** NPER(r, pmt, pv, fv) = ln((pmt − fv·r)/(pmt + pv·r))/ln(1+r); an error when undefined. */
function NPER(rate: Value, pmt: Value, pv: Value, fv: Value): Value {
  const args = [num(rate), num(pmt), num(pv), num(fv)];
  const e = firstErr(args);
  if (e) return e;
  const [r, p, v, f] = args as Dec[];
  if (r!.isZero()) return p!.isZero() ? DIV0 : finite(v!.plus(f!).div(p!).negated());
  const den = p!.plus(v!.times(r!));
  if (den.isZero()) return DIV0;
  const arg = p!.minus(f!.times(r!)).div(den);
  const base = r!.plus(1);
  if (!arg.greaterThan(0) || !base.greaterThan(0)) return NUM;
  const lnBase = base.ln();
  if (lnBase.isZero()) return DIV0;
  // ln at 50 digits leaves noise in the last places; 30 significant digits keep ROUNDUP honest.
  return finite(arg.ln().div(lnBase).toSignificantDigits(30));
}

/** IPMT(r, per, n, pv, fv) = FV(r, per − 1, PMT(r, n, pv, fv), pv)·r; per outside 1…n: #NUM!. */
function IPMT(rate: Value, per: Value, nper: Value, pv: Value, fv: Value): Value {
  const args = [num(rate), num(per), num(nper), num(pv), num(fv)];
  const e = firstErr(args);
  if (e) return e;
  const [r, k, n, v] = args as Dec[];
  if (k!.lessThan(1) || k!.greaterThan(n!)) return NUM;
  const payment = PMT(rate, nper, pv, fv);
  if (isErr(payment)) return payment;
  if (k!.equals(1)) return finite(v!.times(r!).negated());
  return mul(FV(r!, k!.minus(1), payment, v!), r!);
}

/** PPMT = PMT − IPMT. */
function PPMT(rate: Value, per: Value, nper: Value, pv: Value, fv: Value): Value {
  return sub(PMT(rate, nper, pv, fv), IPMT(rate, per, nper, pv, fv));
}

// ─── The tab ────────────────────────────────────────────────────────────────────────────────────

type Row = Record<FireSheetColumn, Value>;

function out(v: Value): FireSheetValue {
  if (isErr(v)) return v.code;
  if (typeof v === 'number') return v === 0 ? 0 : v;
  if (v === EMPTY) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (isDec(v)) {
    const n = v.toNumber();
    return n === 0 ? 0 : n;
  }
  return v;
}

/** A date serial → its year; texts and errors as they are. */
function yearOut(v: Value): FireSheetValue {
  if (!isDec(v)) return out(v);
  const y = YEAR(v);
  return out(y);
}

export function fireSheet(input: FireSheetInput): FireSheetResult {
  const today = input.today;
  dayNumber(today);
  const accepted = input.disclaimerAccepted;
  const E6: Value = decN(input.birthYear);
  const E7: Value = decN(input.superContributionPerYear);
  const E8: Value = decN(input.inflation);
  const E9: Value = decN(input.withdrawalRate);
  const E10: Value = decN(input.accessAge);
  const E45: Value = decN(input.preSuper);
  const E46: Value = decN(input.superBalance);
  const E47: Value = typeof input.savings === 'number' ? decN(input.savings) : input.savings;
  const E48: Value = decN(input.spend);
  const E49: Value = decN(input.growth);
  const salary: Value = input.salary === null ? EMPTY : decN(input.salary);
  const TODAY: Value = decN(dayNumber(today) + SERIAL_EPOCH);
  const Y = YEAR(TODAY);
  const r = sub(E49, E8);
  const accessYear = add(E6, E10);

  // E52: years until preservation.
  const E52 = sub(E10, sub(Y, E6));

  // The grid (rows 4…85): years first, then the helper V:X (V3 needs every X).
  const G: Value[] = [];
  const H: Value[] = [];
  G.push(IFERROR(DATE(Y), '-'));
  H.push(decN(0));
  for (let h = 1; h < GRID_ROWS; h++) {
    const prev = G[h - 1]!;
    const g = IFERROR(
      IF(
        AND(ne(prev, ''), lt(sub(YEAR(prev), 1), accessYear)),
        () => DATE(add(YEAR(prev), 1)),
        () => '',
      ),
      '-',
    );
    if (!isDec(g)) break;
    G.push(g);
    H.push(
      IF(
        eq(g, ''),
        () => '',
        () => add(H[h - 1]!, 1),
      ),
    );
  }
  const rowCount = G.length;
  const pvSpend = (years: Value) => PV(r, years, neg(E48), decN(0));
  const V = H.map((hv, h) =>
    IF(
      ne(h === 0 ? hv : G[h]!, ''),
      () => {
        const pv = pvSpend(sub(E52, hv));
        return sub(add(pv, mul(pv, r)), E48);
      },
      () => '',
    ),
  );
  const W = H.map((hv, h) =>
    IF(
      ne(h === 0 ? hv : G[h]!, ''),
      () => FV(r, hv, neg(E47), neg(E45)),
      () => '',
    ),
  );
  const X = V.map((v, h) =>
    IF(
      ne(h === 0 ? H[0]! : G[h]!, ''),
      () => sub(v, W[h]!),
      () => '',
    ),
  );
  // V3 = E52 − COUNTIF(X, ">"&E48): numeric cells only.
  const counted = X.filter((x) => isDec(x) && isDec(E48) && x.greaterThan(E48)).length;
  const V3 = sub(E52, decN(counted));

  // Pre-super forecasts.
  const E53 = IF(
    lt(V3, 0),
    () => decN(0),
    () => pvSpend(V3),
  );
  const E54 = IF(
    lt(V3, 0),
    () => decN(0),
    () => pvSpend(E52),
  );
  const E55 = IF(
    lt(E45, E53),
    () => sub(E53, E45),
    () =>
      IF(
        eq(E48, 0),
        () => 'Yearly Spend Needed',
        () => FIRE_TEXT,
      ),
  );
  const E56: Value = !accepted
    ? 'Accept Disclaimer'
    : IFERROR(
        ROUNDUP(
          IF(
            gt(E45, E53),
            () => decN(0),
            () => NPER(r, E47, E45, neg(E53)),
          ),
        ),
        '-',
      );
  const E57: Value = !accepted ? 'Accept Disclaimer' : IFERROR(DATE(add(Y, ROUNDUP(E56))), '-');

  // Post-super forecasts.
  const E60 = div(E48, E9);
  const superFire = () =>
    IF(
      eq(E48, 0),
      () => 'Yearly Spend Needed',
      () => FIRE_TEXT,
    );
  const E61 = IFERROR(
    IF(gt(E46, E60), superFire, () => FV(r, E56, neg(E7), neg(E46))),
    '-',
  );
  const E62 = IFERROR(PV(r, sub(sub(E52, E56), 2), decN(0), neg(E60)), '-');
  const E63 = IFERROR(
    IF(gt(E46, E60), superFire, () =>
      IF(
        le(E62, E61),
        () => decN(0),
        () => sub(E62, E61),
      ),
    ),
    '-',
  );
  // E64 (a DUMMYFUNCTION wrapper in the export): the salary is the NPER payment (the D99 bug).
  const E64: Value = IFERROR(
    !accepted
      ? 'Accept Disclaimer'
      : IFERROR(
          ROUNDUP(
            IF(
              ge(E61, E60),
              () => decN(0),
              () =>
                IF(
                  le(E63, 0),
                  () => decN(0),
                  () => NPER(r, salary, E61, neg(E62)),
                ),
            ),
          ),
          '-',
        ),
    decN(0),
  );
  const D2: Value = !accepted
    ? 'Accept Sheet Disclaimer'
    : IFERROR(
        IF(
          gt(E46, E60),
          () =>
            IF(
              eq(E48, 0),
              () => 'No Spend History',
              () => FIRE_TEXT,
            ),
          () =>
            concat(
              ROUNDUP(
                IF(
                  ge(E46, E60),
                  () => sub(Y, E57),
                  () => add(E56, E64),
                ),
              ),
              ' Years to go',
            ),
        ),
        'N/A - No Sheet History',
      );

  // The grid's other columns, row by row.
  const accessDate = DATE(accessYear);
  const pEnd = () => DATE(add(YEAR(E57), ROUNDUP(E64)));
  const sStart = () => DATE(add(YEAR(E57), ROUNDDOWN(E64)));
  const rows: Row[] = [];
  let prev: Row | null = null;
  for (let h = 0; h < rowCount; h++) {
    const g = G[h]!;
    const hv = H[h]!;
    let I: Value = EMPTY;
    let J: Value = EMPTY;
    let K: Value = EMPTY;
    let L: Value;
    let M: Value;
    let N: Value;
    let O: Value = EMPTY;
    if (prev === null) {
      L = IFERROR(
        IF(
          eq(g, E57),
          () => E53,
          () => '',
        ),
        '-',
      );
      M = IFERROR(
        IF(
          ne(L, ''),
          () => mul(L, E49),
          () => '',
        ),
        '-',
      );
      N = E45;
    } else {
      const p = prev;
      I = IFERROR(
        IF(
          OR(eq(g, ''), ne(p.L, ''), gt(g, E57)),
          () => '',
          () => PMT(r, E56, E45, neg(E53)),
        ),
        '-',
      );
      J = IFERROR(
        IF(
          ne(I, ''),
          () => IPMT(r, hv, E56, neg(E45), E53),
          () => '',
        ),
        '-',
      );
      K = IFERROR(
        IF(
          ne(I, ''),
          () => PPMT(r, hv, E56, E45, neg(E53)),
          () => '',
        ),
        '-',
      );
      const drawdown = () =>
        IF(
          AND(ne(p.L, ''), le(g, accessDate)),
          () => add(sub(p.L, E48), p.M),
          () => '',
        );
      L = IFERROR(
        IF(eq(g, E57), () => E53, drawdown),
        '-',
      );
      M = IFERROR(
        IF(
          ne(L, ''),
          () => mul(L, r),
          () => '',
        ),
        '-',
      );
      N = IFERROR(
        IF(
          AND(eq(L, ''), ne(K, '')),
          () => add(p.N, K),
          () => IF(eq(g, E57), () => E53, drawdown),
        ),
        '-',
      );
      O = IF(
        AND(ge(g, add(E57, 1)), ne(g, '')),
        () => add(p.O, 1),
        () => '',
      );
    }
    const P = IFERROR(
      IF(
        AND(gt(g, E57), le(g, pEnd())),
        () => PMT(r, E64, E61, neg(E62)),
        () => '',
      ),
      '-',
    );
    const Q = IFERROR(
      IF(
        ne(P, ''),
        () => IPMT(r, O, E64, neg(E61), E62),
        () => '',
      ),
      '-',
    );
    const R = IFERROR(
      IF(
        ne(P, ''),
        () => PPMT(r, O, E64, E61, neg(E62)),
        () => '',
      ),
      '-',
    );
    const Tprev: Value = prev === null ? EMPTY : prev.T;
    const S = IFERROR(
      IF(
        AND(ne(g, ''), le(YEAR(g), add(accessYear, 1)), eq(P, ''), ge(g, sStart())),
        () => mul(Tprev, r),
        () => '',
      ),
      '-',
    );
    const T = IFERROR(
      IF(
        eq(g, E57),
        () => E61,
        () =>
          IF(
            OR(ne(P, ''), ne(S, '')),
            () => add(add(Tprev, R), S),
            () => '',
          ),
      ),
      '-',
    );
    const row: Row = {
      G: g,
      H: hv,
      I,
      J,
      K,
      L,
      M,
      N,
      O,
      P,
      Q,
      R,
      S,
      T,
      V: V[h]!,
      W: W[h]!,
      X: X[h]!,
    };
    rows.push(row);
    prev = row;
  }

  const E15 = IFERROR(div(E45, add(E55, E45)), '-');
  const E16 = IFERROR(div(E46, add(E63, E46)), '-');
  const cells: Record<FireSheetCell, FireSheetValue> = {
    D2: out(D2),
    V3: out(V3),
    E52: out(E52),
    E53: out(E53),
    E54: out(E54),
    E55: out(E55),
    E56: out(E56),
    E57: yearOut(E57),
    E60: out(E60),
    E61: out(E61),
    E62: out(E62),
    E63: out(E63),
    E64: out(E64),
    C15: out(E45),
    D15: out(E55),
    E15: out(E15),
    C16: out(E46),
    D16: out(E63),
    E16: out(E16),
  };
  return {
    cells,
    rows: rows.map((row) => {
      const o = {} as Record<FireSheetColumn, FireSheetValue>;
      for (const [col, v] of Object.entries(row) as [FireSheetColumn, Value][]) {
        o[col] = col === 'G' ? yearOut(v) : out(v);
      }
      return o;
    }),
  };
}

/**
 * The Sheets functions and value rules behind the tab, for the unit tests (internal; not part of
 * the public API). Arguments may be JS numbers or texts; results are written as `fireSheet` writes
 * cells (numbers, texts, error codes).
 */
export const sheetFunctions = {
  FV: (r: number, n: number, pmt: number, pv: number) => out(FV(r, n, pmt, pv)),
  PV: (r: number, n: number, pmt: number, fv: number) => out(PV(r, n, pmt, fv)),
  PMT: (r: number, n: number, pv: number, fv: number) => out(PMT(r, n, pv, fv)),
  NPER: (r: number, pmt: number | string, pv: number, fv: number) => out(NPER(r, pmt, pv, fv)),
  IPMT: (r: number, per: number, n: number, pv: number, fv: number) => out(IPMT(r, per, n, pv, fv)),
  PPMT: (r: number, per: number, n: number, pv: number, fv: number) => out(PPMT(r, per, n, pv, fv)),
  ROUNDUP: (x: number | string) => out(ROUNDUP(x)),
  ROUNDDOWN: (x: number | string) => out(ROUNDDOWN(x)),
  IFERROR_DIV: (a: number, b: number) => out(IFERROR(div(a, b), '-')),
  /** -1, 0, 1 by the Sheets ordering (text above numbers). */
  compare: (a: number | string, b: number | string) => {
    const c = compare(a, b);
    return isErr(c) ? c.code : c;
  },
  /** Arithmetic on a text operand: "" counts 0, other text is #VALUE!. */
  add: (a: number | string, b: number | string) => out(add(a, b)),
};
