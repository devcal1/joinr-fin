// ColumnTable stacking (web-polish-ui, stage-6.md §6.9 D, STYLE-11): with a sticky first column the
// header row stays above the body while the table scrolls sideways, and the sticky header cell is
// opaque. jsdom has no layout: the stacking order is read from the computed styles; the e2e
// (e2e/polish.spec.ts) checks it with `elementFromPoint` after scrolling each table.
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { COLORS } from '../tokens';
import { installUiCss } from '../testing/cssHarness';
import { ColumnTable, type ColumnTableColumn } from './ColumnTable';

interface Row {
  month: string;
  a: number;
  b: number;
}

const COLUMNS: ColumnTableColumn<Row>[] = [
  { id: 'month', header: 'Month', value: (r) => r.month },
  { id: 'a', header: 'Pre-super', value: (r) => r.a, numeric: true, sortable: true },
  { id: 'b', header: 'Super', value: (r) => r.b, numeric: true },
];
const ROWS: Row[] = [
  { month: 'Jan 2026', a: 1, b: 2 },
  { month: 'Feb 2026', a: 3, b: 4 },
];

let removeCss: () => void = () => undefined;
afterEach(() => {
  removeCss();
  removeCss = () => undefined;
});

const z = (element: Element): number => Number(getComputedStyle(element).zIndex);

describe('ColumnTable sticky stacking (STYLE-11)', () => {
  it('header cells stack above the body’s sticky cells; the sticky header cell above both', () => {
    removeCss = installUiCss(['tokens', 'base', 'table']);
    render(<ColumnTable caption="Rows" columns={COLUMNS} rows={ROWS} getRowId={(r) => r.month} />);
    const table = screen.getByRole('table', { name: 'Rows' });
    const [first, second, third] = within(table).getAllByRole('columnheader');
    const bodyFirst = within(table).getByRole('rowheader', { name: 'Jan 2026' });

    expect(getComputedStyle(first as HTMLElement).position).toBe('sticky');
    expect(getComputedStyle(bodyFirst).position).toBe('sticky');
    for (const header of [second, third]) {
      expect(getComputedStyle(header as HTMLElement).position).toBe('relative');
      expect(z(header as HTMLElement)).toBeGreaterThan(z(bodyFirst));
    }
    expect(z(first as HTMLElement)).toBeGreaterThan(z(second as HTMLElement));
    expect(z(bodyFirst)).toBeGreaterThan(0);
  });

  it('the sticky header cell is opaque --raised, the body sticky cells opaque --surface', () => {
    removeCss = installUiCss(['tokens', 'base', 'table']);
    render(<ColumnTable caption="Rows" columns={COLUMNS} rows={ROWS} getRowId={(r) => r.month} />);
    const table = screen.getByRole('table', { name: 'Rows' });
    const [first] = within(table).getAllByRole('columnheader');
    expect(getComputedStyle(first as HTMLElement).background).toBe('var(--raised)');
    const bodyFirst = within(table).getByRole('rowheader', { name: 'Feb 2026' });
    expect(getComputedStyle(bodyFirst).background).toBe('var(--surface)');
    // Both tokens are opaque colours (no alpha), so nothing shows through when scrolled.
    expect(COLORS.raised).toMatch(/^#[0-9a-f]{6}$/i);
    expect(COLORS.surface).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('without a sticky column no header cell is lifted', () => {
    removeCss = installUiCss(['tokens', 'base', 'table']);
    render(
      <ColumnTable
        caption="Rows"
        columns={COLUMNS}
        rows={ROWS}
        getRowId={(r) => r.month}
        stickyFirstColumn={false}
      />,
    );
    const [first] = within(screen.getByRole('table', { name: 'Rows' })).getAllByRole(
      'columnheader',
    );
    expect(getComputedStyle(first as HTMLElement).position).not.toBe('sticky');
  });
});
