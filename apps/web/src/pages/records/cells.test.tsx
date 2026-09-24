import {
  RECORD_ENTITIES,
  REVIEW_FLAGS,
  type RecordColumnType,
  type RecordEntityId,
  type RecordRow,
} from '@joinr/schema';
import { MINUS, formatDate, formatTime } from '@joinr/ui';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import {
  FLAG_LABELS,
  enumWords,
  flagLabel,
  isNumericType,
  recordTableColumns,
  SIGNED_FLOW_COLUMNS,
  renderCell,
  renderSettingValue,
  sortValue,
  WIDE_TEXT_MIN_WIDTH,
} from './cells';

function text(node: ReactNode): string {
  const { container, unmount } = render(<>{node}</>);
  const result = container.textContent ?? '';
  unmount();
  return result;
}

describe('record cell renderers', () => {
  it.each<[RecordColumnType, RecordRow['cells'][string], string]>([
    ['money', 1248000, '$12,480.00'],
    ['money', -123400, `${MINUS}$1,234.00`],
    ['quantity', '0.00012345', '0.00012345'],
    ['quantity', '1234.5', '1,234.5'],
    ['quantity', '-20', `${MINUS}20`],
    ['price', '12.3456789876', '$12.34567899'],
    ['price', '10', '$10.00'],
    ['ratio', '0.056', '5.60%'],
    ['ratio', '0.002', '0.20%'],
    ['integer', 1234, '1,234'],
    ['date', '2026-08-18', '18/08/2026'],
    ['month', '2026-08', 'Aug 2026'],
    ['boolean', true, 'Yes'],
    ['boolean', false, 'No'],
    ['text', 'ASX:ABC', 'ASX:ABC'],
  ])('%s %j → %s', (type, value, expected) => {
    expect(text(renderCell(type, value))).toBe(expected);
  });

  it('shows timestamps as dd/mm/yyyy HH:mm in local time', () => {
    const iso = '2026-09-24T04:32:00.000Z';
    const date = new Date(iso);
    expect(text(renderCell('timestamp', iso))).toBe(`${formatDate(date)} ${formatTime(date)}`);
  });

  it('shows negative money in the stop colour', () => {
    render(<>{renderCell('money', -500)}</>);
    expect(screen.getByText(`${MINUS}$5.00`)).toHaveClass('jf-amount--negative');
  });

  it('shows null (and an empty flag list) as a muted dash', () => {
    const cases = [
      ...(['money', 'text', 'date', 'boolean', 'flags', 'setting'] as const).map((type) =>
        renderCell(type, null),
      ),
      renderCell('flags', []),
    ];
    for (const node of cases) {
      const { unmount } = render(<>{node}</>);
      expect(screen.getByText('—')).toHaveClass('jf-app-muted');
      unmount();
    }
  });

  it('shows each flag as a "check" status badge with a readable label', () => {
    render(<>{renderCell('flags', ['out_of_order', 'price_outlier'])}</>);
    const out = screen.getByText('Out of order').closest('.jf-badge');
    expect(out).toHaveAttribute('data-status', 'check');
    expect(screen.getByText('Price outlier')).toBeInTheDocument();
  });

  it('has a label for every review flag', () => {
    for (const flag of REVIEW_FLAGS) expect(FLAG_LABELS[flag]).toMatch(/^[A-Z]/);
    expect(flagLabel('some_new_flag')).toBe('some new flag');
  });

  it('formats a setting by its value type', () => {
    expect(text(renderSettingValue(300000, 'money'))).toBe('$3,000.00');
    expect(text(renderSettingValue('0.6', 'ratio'))).toBe('60.00%');
    expect(text(renderSettingValue(15, 'integer'))).toBe('15');
    // A year is not a count: no thousands separator.
    expect(text(renderSettingValue(1990, 'integer'))).toBe('1990');
    expect(text(renderSettingValue(true, 'boolean'))).toBe('Yes');
    expect(text(renderSettingValue('2020-01-06', 'date'))).toBe('06/01/2020');
    expect(text(renderSettingValue('fortnightly', 'enum'))).toBe('Fortnightly');
    expect(text(renderSettingValue('four_weekly', 'enum'))).toBe('Four weekly');
    expect(text(renderSettingValue(-3, 'integer'))).toBe(`${MINUS}3`);
    expect(text(renderSettingValue(null, 'money'))).toBe('—');
  });

  it('sets setting figures in mono, inline (the Value column stays left-aligned)', () => {
    for (const [value, type] of [
      ['0.6', 'ratio'],
      [15, 'integer'],
      ['2020-01-06', 'date'],
    ] as const) {
      const { container, unmount } = render(<>{renderSettingValue(value, type)}</>);
      expect(container.querySelector('.jf-app-num.jf-app-num--inline')).not.toBeNull();
      unmount();
    }
    const { container, unmount } = render(<>{renderSettingValue('monthly', 'enum')}</>);
    expect(container.querySelector('.jf-app-num')).toBeNull();
    unmount();
  });

  it('formats negative integers with a U+2212 minus', () => {
    expect(text(renderCell('integer', -3))).toBe(`${MINUS}3`);
    expect(text(renderCell('integer', -1234))).toBe(`${MINUS}1,234`);
    expect(text(renderCell('integer', -3)).codePointAt(0)).toBe(0x2212);
  });

  it('falls back to the raw value when a formatter rejects it', () => {
    expect(text(renderCell('date', 'not a date'))).toBe('not a date');
    expect(text(renderCell('quantity', 'abc'))).toBe('abc');
    expect(text(renderCell('money', 12.5))).toBe('12.5');
  });
});

describe('record text columns', () => {
  it('shows enum values as words and keeps codes on one line', () => {
    expect(enumWords('managed_fund')).toBe('Managed fund');
    expect(enumWords('stock')).toBe('Stock');
    expect(enumWords('etf')).toBe('ETF');
    expect(enumWords('auto_yearly')).toBe('Auto yearly');
    const [kind, sheetRef, name] = recordTableColumns([
      { id: 'kind', label: 'Kind', type: 'text' },
      { id: 'sheetRef', label: 'Sheet ref', type: 'text' },
      { id: 'name', label: 'Name', type: 'text' },
    ]);
    const row: RecordRow = {
      id: '1',
      cells: {
        kind: 'managed_fund',
        sheetRef: 'Managed Funds!A23',
        name: 'Example Bank – Everyday',
      },
    };
    const { container, unmount } = render(
      <>
        {kind?.cell?.(row)}|{sheetRef?.cell?.(row)}|{name?.cell?.(row)}
      </>,
    );
    expect(container.textContent).toBe('Managed fund|Managed Funds!A23|Example Bank – Everyday');
    expect(container.querySelectorAll('.jf-app-nowrap')).toHaveLength(2);
    // The sort key stays the raw value.
    expect(kind?.value(row)).toBe('managed_fund');
    unmount();
  });
});

describe('record column layout', () => {
  it('moves the symbol first for instruments only, leaving the registry order alone', () => {
    const registry = [
      { id: 'kind', label: 'Kind', type: 'text' },
      { id: 'symbol', label: 'Symbol', type: 'text' },
      { id: 'name', label: 'Name', type: 'text' },
    ] as const;
    expect(recordTableColumns(registry, 'instruments').map((c) => c.id)).toEqual([
      'symbol',
      'kind',
      'name',
    ]);
    expect(recordTableColumns(registry, 'trades').map((c) => c.id)).toEqual([
      'kind',
      'symbol',
      'name',
    ]);
    expect(registry.map((c) => c.id)).toEqual(['kind', 'symbol', 'name']);
  });

  it('puts the label before the key for settings, leaving the registry order alone', () => {
    const registry = RECORD_ENTITIES.settings.columns;
    expect(recordTableColumns(registry, 'settings').map((c) => c.id)).toEqual([
      'label',
      'key',
      'category',
      'value',
      'updatedAt',
    ]);
    expect(registry.map((c) => c.id)).toEqual(['key', 'label', 'category', 'value', 'updatedAt']);
  });

  it('gives free-text columns a minimum width', () => {
    const columns = recordTableColumns([
      { id: 'name', label: 'Name', type: 'text' },
      { id: 'note', label: 'Note', type: 'text' },
      { id: 'kind', label: 'Kind', type: 'text' },
      { id: 'units', label: 'Units', type: 'quantity' },
    ]);
    expect(columns.map((c) => c.minWidth)).toEqual([
      WIDE_TEXT_MIN_WIDTH,
      WIDE_TEXT_MIN_WIDTH,
      undefined,
      undefined,
    ]);
  });

  it('shows settings categories as words, but not other categories', () => {
    const [category] = recordTableColumns(
      [{ id: 'category', label: 'Category', type: 'text' }],
      'settings',
    );
    const [other] = recordTableColumns([{ id: 'category', label: 'Category', type: 'text' }]);
    const row: RecordRow = { id: '1', cells: { category: 'allocation' } };
    expect(text(category?.cell?.(row))).toBe('Allocation');
    expect(text(other?.cell?.(row))).toBe('allocation');
  });
});

describe('signed flow columns (D33)', () => {
  const negative = (entity: RecordEntityId, columnId: string) => {
    const column = RECORD_ENTITIES[entity].columns.find((c) => c.id === columnId);
    if (!column) throw new Error(`no column ${columnId}`);
    const [table] = recordTableColumns([column], entity);
    const row: RecordRow = { id: '1', cells: { [columnId]: -12000 } };
    const { container, unmount } = render(<>{table?.cell?.(row)}</>);
    const amount = container.querySelector('.jf-amount');
    const result = {
      text: amount?.textContent,
      tinted: amount?.classList.contains('jf-amount--negative'),
    };
    unmount();
    return result;
  };

  it('shows a sell order value and net-sell movements in body text, keeping the minus', () => {
    expect(negative('trades', 'orderValue')).toEqual({ text: `${MINUS}$120.00`, tinted: false });
    for (const id of ['stocksMovements', 'etfMovements', 'cryptoMovements', 'mfMovements']) {
      expect(SIGNED_FLOW_COLUMNS.snapshots?.has(id)).toBe(true);
      expect(negative('snapshots', id)).toEqual({ text: `${MINUS}$120.00`, tinted: false });
    }
  });

  it('keeps the stop tint for other negative money', () => {
    expect(negative('trades', 'fee')).toEqual({ text: `${MINUS}$120.00`, tinted: true });
    expect(negative('snapshots', 'stocksGain')).toEqual({ text: `${MINUS}$120.00`, tinted: true });
    expect(negative('cash-accounts', 'balance')).toEqual({ text: `${MINUS}$120.00`, tinted: true });
  });
});

describe('record sort values', () => {
  it('sorts figures as numbers, dates as ISO text and booleans as words', () => {
    expect(sortValue('money', 1200)).toBe(1200);
    expect(sortValue('quantity', '0.5')).toBe(0.5);
    expect(sortValue('ratio', '0.056')).toBe(0.056);
    expect(sortValue('date', '2026-08-18')).toBe('2026-08-18');
    expect(sortValue('boolean', true)).toBe('Yes');
    expect(sortValue('flags', ['oversell'])).toBe('Oversell');
    expect(sortValue('flags', [])).toBeNull();
    expect(sortValue('text', null)).toBeNull();
  });

  it('marks figure columns numeric', () => {
    expect(
      ['money', 'quantity', 'price', 'ratio', 'integer'].every((t) =>
        isNumericType(t as RecordColumnType),
      ),
    ).toBe(true);
    expect(isNumericType('text')).toBe(false);
    expect(isNumericType('date')).toBe(false);
  });

  it('builds sortable table columns from registry columns', () => {
    const columns = recordTableColumns([
      { id: 'date', label: 'Date', type: 'date' },
      { id: 'units', label: 'Units', type: 'quantity' },
    ]);
    expect(columns.map((c) => [c.id, c.header, c.numeric, c.sortable])).toEqual([
      ['date', 'Date', false, true],
      ['units', 'Units', true, true],
    ]);
    const row: RecordRow = { id: '1', cells: { date: '2026-01-02', units: '3' } };
    expect(columns[1]?.value(row)).toBe(3);
    expect(columns[0]?.value({ id: '2', cells: {} })).toBeNull();
  });
});
