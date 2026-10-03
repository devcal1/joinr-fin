// The `mobilePeriods` fixtures are internally consistent (stage-10.md §3.6; an engine test because
// only the engine's arithmetic can check them): in every period the totals are the sums of the
// counted figures (plus the Sold figure under ALL), unrealised + realised = cents under ALL, the
// last line point is totals.cents (1W–12M) or totals.unrealisedCents (ALL, D167), no ALL point sits
// on a sale date unless a drawn holding has a close that day, every `ok` 1W–12M figure follows §2.2
// from its own fields within a cent, every `no_start` figure with cents has its ratio on
// newCostCents, and `open` has mobileToday.open's holdings and value.
import { JoinrDecimal } from '@joinr/schema';
import { mobilePeriods, mobileToday } from '@joinr/schema/fixtures';
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

/** The made-up sale dates behind the fixtures (DEF's partial sale, the silver row, gold, OLD). */
const SALE_DATES = ['2029-06-04', '2030-03-02', '2030-04-01', '2030-06-03'];

describe.each(Object.entries(mobilePeriods))('mobilePeriods.%s', (_name, r) => {
  const holding = new Map(r.holdings.map((h) => [h.key, h]));

  it('totals are the sums of the figures', () => {
    for (const p of r.periods) {
      const held = p.figures.filter((f) => f.key !== 'sold');
      const sold = p.figures.find((f) => f.key === 'sold');
      const ok = held.filter((f) => f.status === 'ok');
      const counted =
        p.period === 'ALL' ? ok : held.filter((f) => f.status !== 'unpriced' && f.cents !== null);
      const any = counted.length > 0 || sold !== undefined;
      expect(p.totals.cents, p.period).toBe(
        any ? counted.reduce((a, f) => a + f.cents!, 0) + (sold?.cents ?? 0) : null,
      );
      const base =
        p.period === 'ALL'
          ? counted.reduce((a, f) => a + f.costEverCents!, 0) + (sold?.costEverCents ?? 0)
          : counted.reduce((a, f) => {
              if (f.status !== 'ok') return a + f.newCostCents!;
              const h = holding.get(f.key)!;
              return a + h.valueCents! - f.cents! - cents(D(f.laterUnits).times(h.price!));
            }, 0);
      expect(p.totals.baseCents, p.period).toBe(any ? base : null);
      if (any && base > 0) expect(p.totals.ratio).toBe(ratio(D(p.totals.cents!).div(base)));
      expect(p.totals.up).toBe(ok.filter((f) => f.cents! > 0).length);
      expect(p.totals.down).toBe(ok.filter((f) => f.cents! < 0).length);
      expect(p.totals.flat).toBe(ok.filter((f) => f.cents === 0).length);
      expect(p.totals.missing).toBe(held.length - ok.length);
      expect(p.totals.holdings).toBe(r.holdings.length);
      expect(p.totals.partial).toBe(p.totals.missing > 0);
      if (p.period === 'ALL' && any) {
        expect(p.totals.unrealisedCents).toBe(ok.reduce((a, f) => a + f.unrealisedCents!, 0));
        expect(p.totals.realisedCents).toBe(
          ok.reduce((a, f) => a + f.realisedCents!, 0) + (sold?.cents ?? 0),
        );
        expect(p.totals.unrealisedCents! + p.totals.realisedCents!).toBe(p.totals.cents);
        for (const f of ok) expect(f.cents).toBe(f.unrealisedCents! + f.realisedCents!);
        if (sold !== undefined) expect(sold.realisedCents).toBe(sold.cents);
      }
    }
  });

  it('every line ends where it must (D164, D167)', () => {
    for (const p of r.periods) {
      if (p.line === null) continue;
      const last = p.line.points.at(-1)!;
      expect(last[0]).toBe(r.localDate);
      expect(last[1], p.period).toBe(
        p.period === 'ALL' ? p.totals.unrealisedCents : p.totals.cents,
      );
      expect(p.line.points[0]![0]).toBe(p.line.from);
      if (p.period !== 'ALL') expect(p.line.from).toBe(p.startDate);
      for (const f of p.figures)
        if (f.line !== null) {
          const h = holding.get(f.key)!;
          expect(f.line.points.at(-1)).toEqual([r.localDate, h.price]);
        }
    }
  });

  it('no ALL point on a sale date unless a drawn holding has a close that day (D167)', () => {
    const all = r.periods.find((p) => p.period === 'ALL')!;
    for (const [date] of all.line?.points ?? []) {
      if (!SALE_DATES.includes(date)) continue;
      const drawnClose = all.figures.some((f) => f.line?.points.some(([d]) => d === date));
      expect(drawnClose, date).toBe(true);
    }
  });

  it('every ok 1W–12M figure follows §2.2 from its own fields (within a cent)', () => {
    for (const p of r.periods) {
      if (p.period === 'ALL') continue;
      for (const f of p.figures) {
        if (f.status !== 'ok') continue;
        const h = holding.get(f.key)!;
        const P = D(h.price!);
        const start = f.startUnits === '0' ? D(0) : D(f.startUnits).times(P.minus(f.startClose!));
        const expected = cents(start.plus(D(f.newUnits).times(P))) - (f.newCostCents ?? 0);
        expect(Math.abs(f.cents! - expected), `${p.period} ${f.key}`).toBeLessThanOrEqual(1);
        const base = h.valueCents! - f.cents! - cents(D(f.laterUnits).times(P));
        expect(f.ratio).toBe(base > 0 ? ratio(D(f.cents!).div(base)) : null);
        if (f.startUnits !== '0') {
          expect(f.changePerUnit).toBe(P.minus(f.startClose!).toFixed());
          expect(f.priceRatio).toBe(ratio(P.minus(f.startClose!).div(f.startClose!)));
        } else expect(f.startClose).toBeNull();
      }
    }
  });

  it('every no_start figure with cents has its ratio on newCostCents (D165)', () => {
    for (const p of r.periods)
      for (const f of p.figures)
        if (f.status === 'no_start' && f.cents !== null)
          expect(f.ratio).toBe(ratio(D(f.cents).div(f.newCostCents!)));
  });
});

describe('mobilePeriods.open against mobileToday.open', () => {
  it('has the same holdings, keys and value', () => {
    const r = mobilePeriods.open;
    expect(r.holdings.map((h) => h.key)).toEqual(mobileToday.open.holdings.map((h) => h.key));
    expect(r.valueCents).toBe(mobileToday.open.totals.valueCents);
  });
});
