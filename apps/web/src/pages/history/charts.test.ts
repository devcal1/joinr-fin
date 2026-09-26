// The stacked-class series (stage-5.md §5): "Other debts" is drawn only where there is a debt, so
// ECharts' samesign stacking never lifts a 0 of the below-zero series onto the positive stack
// (found by the Integrator on the real API: the live group's U is always 0, D2); the table keeps 0.
import { netWorthPages } from '@joinr/schema/fixtures';
import { describe, expect, it } from 'vitest';
import { stackColumns, stackSeries } from './charts';
import { otherDebtsCents } from './display';

describe('stackSeries: Other debts', () => {
  const base = netWorthPages.otherDebts.charts.groups;
  // A month with a debt, then the live group (U is always 0 there).
  const groups = [
    { ...base[0]!, figures: { ...base[0]!.figures, liabilitiesBalanceCents: -50_000 } },
    { ...base[0]!, live: true, figures: { ...base[0]!.figures, liabilitiesBalanceCents: 0 } },
  ];

  it('draws the debt where U is below zero and nothing where it is 0', () => {
    const [debtAt, zeroAt] = [0, 1];
    const columns = stackColumns(groups);
    const debts = columns.find((c) => c.key === 'other_debts');
    const series = stackSeries(columns).find((s) => s.name === debts?.label);
    expect(series?.data[debtAt]).toBeLessThan(0);
    expect(series?.data[zeroAt]).toBeNull();
    // The table's column keeps the 0 (not -0).
    expect(Object.is(debts?.cents[zeroAt], 0)).toBe(true);
  });

  it('a 0 U is 0, never -0', () => {
    const figures = { ...groups[0]!.figures, liabilitiesBalanceCents: 0 };
    expect(Object.is(otherDebtsCents(figures), 0)).toBe(true);
  });
});
