// The `mobileToday` fixtures are internally consistent (stage-9.md §3.6; an engine test because
// only the engine's arithmetic can check them): totals are the sums of the holdings, the weights
// sum to 1, the portfolio line ends at the day total, and every `ok` holding's figures follow §2.2
// from its own fields (P − B per unit, the ratio, and the cents when nothing was bought today).
import { JoinrDecimal } from '@joinr/schema';
import { mobileToday } from '@joinr/schema/fixtures';
import { describe, expect, it } from 'vitest';

const D = (v: string | number) => new JoinrDecimal(v);
const cents = (d: InstanceType<typeof JoinrDecimal>) => {
  const c = d.times(100).toDecimalPlaces(0, JoinrDecimal.ROUND_HALF_UP).toNumber();
  return c === 0 ? 0 : c;
};
const ratio = (d: InstanceType<typeof JoinrDecimal>) => {
  const r = d.toSignificantDigits(12, JoinrDecimal.ROUND_HALF_UP);
  return r.isZero() ? '0' : r.toFixed();
};

describe.each(Object.entries(mobileToday))('mobileToday.%s', (_name, t) => {
  it('totals are the sums of the holdings', () => {
    const values = t.holdings.flatMap((h) => (h.valueCents === null ? [] : [h.valueCents]));
    expect(t.totals.valueCents).toBe(values.reduce((a, b) => a + b, 0));
    const ok = t.holdings.filter((h) => h.dayStatus === 'ok');
    expect(t.totals.dayCents).toBe(
      ok.length === 0 ? null : ok.reduce((a, h) => a + h.dayCents!, 0),
    );
    expect(t.totals.up).toBe(ok.filter((h) => h.dayCents! > 0).length);
    expect(t.totals.down).toBe(ok.filter((h) => h.dayCents! < 0).length);
    expect(t.totals.flat).toBe(ok.filter((h) => h.dayCents === 0).length);
    expect(t.totals.noChange).toBe(t.holdings.length - ok.length);
    expect(t.totals.holdings).toBe(t.holdings.length);
    if (t.totals.dayCents === null) expect(t.totals.dayRatio).toBeNull();
  });

  it('the weights sum to 1 ± 1e-9 and match the values', () => {
    if (t.holdings.length === 0 || t.totals.valueCents === 0) return;
    const sum = t.holdings.reduce((a, h) => a.plus(h.weightRatio ?? 0), D(0));
    expect(sum.minus(1).abs().lessThanOrEqualTo('1e-9')).toBe(true);
    for (const h of t.holdings) {
      if (h.valueCents === null) expect(h.weightRatio).toBeNull();
      else expect(h.weightRatio).toBe(ratio(D(h.valueCents).div(t.totals.valueCents)));
    }
  });

  it('the portfolio line ends at the day total', () => {
    const line = t.portfolioLine;
    if (line === null) {
      expect(t.holdings.some((h) => h.dayStatus === 'ok' && h.line !== null)).toBe(false);
      return;
    }
    expect(line.points.at(-1)).toEqual([Date.parse(line.to) / 1000, t.totals.dayCents]);
    expect(line.points[0]![0]).toBe(Date.parse(line.from) / 1000);
    const times = line.points.map(([s]) => s);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('every ok holding follows §2.2 from its own fields', () => {
    for (const h of t.holdings.filter((x) => x.dayStatus === 'ok')) {
      const P = D(h.price!);
      const B = D(h.previousClose!);
      expect(h.changePerUnit, h.key).toBe(P.minus(B).toFixed());
      expect(h.dayRatio, h.key).toBe(ratio(P.minus(B).div(B)));
      if (h.newUnits === '0') {
        // No lot bought in the session (and the fixtures have no after-session lots): every unit
        // moved from B.
        expect(h.dayCents, h.key).toBe(cents(D(h.units).times(P.minus(B))));
      }
      if (h.native !== null && h.native.previousClose !== null) {
        const n = D(h.native.price);
        const nb = D(h.native.previousClose);
        expect(h.native.dayRatio, h.key).toBe(ratio(n.minus(nb).div(nb)));
      }
    }
  });
});
