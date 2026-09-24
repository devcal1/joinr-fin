import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { formatMoney } from '../format';
import { ColumnTable, type ColumnTableColumn } from './ColumnTable';

interface Holding {
  code: string;
  name: string;
  units: number;
  valueCents: number | null;
}

const ROWS: Holding[] = [
  { code: 'XYZ', name: 'Example Co', units: 10, valueCents: 250_000 },
  { code: 'ABC', name: 'Sample Ltd', units: 200, valueCents: 1_000_000 },
  { code: 'DEF', name: 'Placeholder Group', units: 5, valueCents: null },
  { code: 'abd', name: 'Another One', units: 30, valueCents: -12_300 },
];

const COLUMNS: ColumnTableColumn<Holding>[] = [
  { id: 'code', header: 'Code', value: (row) => row.code, sortable: true },
  { id: 'name', header: 'Name', value: (row) => row.name },
  { id: 'units', header: 'Units', value: (row) => row.units, numeric: true, sortable: true },
  {
    id: 'value',
    header: 'Value',
    value: (row) => row.valueCents,
    cell: (row) => (row.valueCents === null ? '—' : formatMoney(row.valueCents)),
    numeric: true,
    sortable: true,
    minWidth: 120,
  },
];

function renderTable(props: Partial<Parameters<typeof ColumnTable<Holding>>[0]> = {}) {
  return render(
    <ColumnTable<Holding>
      columns={COLUMNS}
      rows={ROWS}
      getRowId={(row) => row.code}
      caption="Holdings"
      {...props}
    />,
  );
}

/** First-column text of each body row, in order. */
function codes(): string[] {
  const table = screen.getByRole('table', { name: 'Holdings' });
  const body = table.querySelector('tbody') as HTMLElement;
  return within(body)
    .getAllByRole('row')
    .map((row) => within(row).getByRole('rowheader').textContent ?? '');
}

describe('ColumnTable structure', () => {
  it('is a captioned table with column headers and row headers', () => {
    renderTable();
    const table = screen.getByRole('table', { name: 'Holdings' });
    const headers = within(table).getAllByRole('columnheader');
    expect(headers.map((h) => h.textContent)).toEqual(['Code', 'Name', 'Units', 'Value']);
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((h) => h.textContent),
    ).toEqual(['XYZ', 'ABC', 'DEF', 'abd']);
    expect(table.querySelector('caption')).toHaveClass('jf-visually-hidden');
  });

  it('right-aligns numeric columns and uses the custom cell renderer', () => {
    renderTable();
    const valueHeader = screen.getByRole('columnheader', { name: /Value/ });
    expect(valueHeader).toHaveClass('jf-table__th--num');
    expect(valueHeader).toHaveStyle({ minWidth: '120px' });
    const cell = screen.getByText('$2,500.00');
    expect(cell).toHaveClass('jf-table__cell', 'jf-table__cell--num');
    expect(screen.getByText('Example Co')).not.toHaveClass('jf-table__cell--num');
    expect(screen.getByText('−$123.00')).toBeInTheDocument();
  });

  it('makes the first column sticky by default, and not when disabled', () => {
    const { container, unmount } = renderTable();
    expect(container.firstChild).toHaveClass('jf-table', 'jf-table--dense', 'jf-table--sticky');
    expect(screen.getByRole('rowheader', { name: 'XYZ' })).toHaveClass('jf-table__cell--first');
    unmount();
    const again = renderTable({ stickyFirstColumn: false, density: 'regular' });
    expect(again.container.firstChild).not.toHaveClass('jf-table--sticky');
    expect(again.container.firstChild).toHaveClass('jf-table--regular');
  });

  it('shows the caption above the table when asked', () => {
    const { container } = renderTable({ showCaption: true });
    expect(container.querySelector('.jf-table__title')).toHaveTextContent('Holdings');
    expect(container.querySelector('.jf-table__title')).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows the empty message', () => {
    renderTable({ rows: [] });
    expect(screen.getByRole('cell', { name: 'Nothing here yet.' })).toHaveAttribute('colspan', '4');
    renderTable({ rows: [], emptyMessage: 'No holdings.' });
    expect(screen.getByText('No holdings.')).toBeInTheDocument();
  });
});

describe('ColumnTable total row', () => {
  it('is the only white bold row, with one teal key cell', () => {
    const { container } = renderTable({
      total: {
        label: 'Total',
        cells: { units: '245', value: '$12,480.00' },
        keyColumnId: 'value',
      },
    });
    const foot = container.querySelector('tfoot') as HTMLElement;
    const row = within(foot).getByRole('row');
    expect(row).toHaveClass('jf-table__total');
    expect(within(row).getByRole('rowheader', { name: 'Total' })).toBeInTheDocument();
    expect(container.querySelectorAll('.jf-table__total')).toHaveLength(1);
    const keyCells = container.querySelectorAll('.jf-table__key');
    expect(keyCells).toHaveLength(1);
    expect(keyCells[0]).toHaveTextContent('$12,480.00');
    expect(within(row).getByText('245')).not.toHaveClass('jf-table__key');
    // No body row carries the total styling.
    expect(container.querySelector('tbody .jf-table__total, tbody .jf-table__key')).toBeNull();
  });

  it('has no teal cell without a keyColumnId', () => {
    const { container } = renderTable({ total: { label: 'Total', cells: {} } });
    expect(container.querySelector('.jf-table__key')).toBeNull();
  });
});

describe('ColumnTable sorting', () => {
  it('sorts by clicking a header button and sets aria-sort', async () => {
    const user = userEvent.setup();
    renderTable();
    const header = screen.getByRole('columnheader', { name: /Code/ });
    expect(header).not.toHaveAttribute('aria-sort');
    const button = within(header).getByRole('button', { name: 'Code' });

    await user.click(button);
    expect(header).toHaveAttribute('aria-sort', 'ascending');
    expect(codes()).toEqual(['ABC', 'abd', 'DEF', 'XYZ']); // en-AU collation, case-insensitive

    await user.click(button);
    expect(header).toHaveAttribute('aria-sort', 'descending');
    expect(codes()).toEqual(['XYZ', 'DEF', 'abd', 'ABC']);
  });

  it('sorts with Enter on the focused header', async () => {
    const user = userEvent.setup();
    renderTable();
    const header = screen.getByRole('columnheader', { name: /Units/ });
    within(header).getByRole('button').focus();
    await user.keyboard('{Enter}');
    expect(header).toHaveAttribute('aria-sort', 'descending');
    // Numbers sort numerically (not as text): 200 > 30 > 10 > 5.
    expect(codes()).toEqual(['ABC', 'abd', 'XYZ', 'DEF']);
  });

  it('sorts figures largest first, keeping missing values last in both directions', async () => {
    const user = userEvent.setup();
    renderTable();
    const header = screen.getByRole('columnheader', { name: /Value/ });
    const button = within(header).getByRole('button');
    await user.click(button);
    expect(header).toHaveAttribute('aria-sort', 'descending');
    expect(codes()).toEqual(['ABC', 'XYZ', 'abd', 'DEF']);
    await user.click(button);
    expect(header).toHaveAttribute('aria-sort', 'ascending');
    expect(codes()).toEqual(['abd', 'XYZ', 'ABC', 'DEF']);
    // A third click returns to the original order.
    await user.click(button);
    expect(header).not.toHaveAttribute('aria-sort');
    expect(codes()).toEqual(['XYZ', 'ABC', 'DEF', 'abd']);
  });

  it('starts from initialSort', () => {
    renderTable({ initialSort: { columnId: 'value' } });
    expect(screen.getByRole('columnheader', { name: /Value/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    expect(codes()).toEqual(['abd', 'XYZ', 'ABC', 'DEF']);
  });

  it('honours initialSort desc and only one sorted column at a time', async () => {
    const user = userEvent.setup();
    renderTable({ initialSort: { columnId: 'units', desc: true } });
    expect(codes()).toEqual(['ABC', 'abd', 'XYZ', 'DEF']);
    await user.click(screen.getByRole('button', { name: 'Code' }));
    const sorted = screen
      .getAllByRole('columnheader')
      .filter((header) => header.hasAttribute('aria-sort'));
    expect(sorted).toHaveLength(1);
  });

  it('renders no sort button on unsortable columns', () => {
    renderTable();
    const header = screen.getByRole('columnheader', { name: 'Name' });
    expect(within(header).queryByRole('button')).not.toBeInTheDocument();
  });
});
