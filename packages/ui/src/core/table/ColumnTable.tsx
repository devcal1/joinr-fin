// ColumnTable: the only file that touches TanStack Table (v8), so a later upgrade stays local.
import {
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingFn,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import { cx } from '../cx';
import { Icon } from '../layout/Icon';

export interface ColumnTableColumn<Row> {
  id: string;
  header: string;
  /** Sort key and default cell content. */
  value: (row: Row) => string | number | null;
  /** Custom cell content (e.g. a formatted <Amount/>). */
  cell?: (row: Row) => ReactNode;
  /** Right-aligned, monospaced, tabular. */
  numeric?: boolean;
  sortable?: boolean;
  minWidth?: number;
}

export interface ColumnTableTotal {
  /** Shown in the first column. */
  label: string;
  /** Cell content by column id. */
  cells: Record<string, ReactNode>;
  /** The total figure: the table's only teal cell. */
  keyColumnId?: string;
}

export interface ColumnTableProps<Row> {
  columns: ColumnTableColumn<Row>[];
  rows: readonly Row[];
  getRowId: (row: Row) => string;
  /** Accessible name (a visually hidden caption unless `showCaption`). */
  caption: string;
  showCaption?: boolean;
  total?: ColumnTableTotal;
  /** Keep the first column in view while the table scrolls sideways. Default true. */
  stickyFirstColumn?: boolean;
  initialSort?: { columnId: string; desc?: boolean };
  /** Default "Nothing here yet." */
  emptyMessage?: ReactNode;
  /** 'dense' = 13px (default), 'regular' = 14.5px. */
  density?: 'dense' | 'regular';
}

type SortValue = string | number | undefined;

const collator = new Intl.Collator('en-AU', { numeric: true, sensitivity: 'base' });

// Numbers compare numerically, anything else by en-AU collation. Missing values (null) are
// handled by `sortUndefined: 'last'`, so they stay at the bottom in both directions.
const compareValues: SortingFn<unknown> = (a, b, columnId) => {
  const x = a.getValue<SortValue>(columnId);
  const y = b.getValue<SortValue>(columnId);
  if (typeof x === 'number' && typeof y === 'number') return x === y ? 0 : x < y ? -1 : 1;
  return collator.compare(String(x), String(y));
};

const ARIA_SORT = { asc: 'ascending', desc: 'descending' } as const;

/** Tracks whether an element's content is wider than its box, and whether it is scrolled. */
function useHorizontalScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    // ResizeObserver reports once on observe(), then on every size change.
    const observer = new ResizeObserver(() => {
      setOverflowing(element.scrollWidth > element.clientWidth + 1);
      setScrolled(element.scrollLeft > 0);
    });
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, []);

  const onScroll = (): void => {
    const element = ref.current;
    if (element) setScrolled(element.scrollLeft > 0);
  };

  return { ref, overflowing, scrolled, onScroll };
}

/**
 * A data table (STYLE_GUIDE §5): `--raised` header with small uppercase labels, `--surface` cells,
 * hairline row dividers, numeric columns right-aligned and monospaced. The total row is the only
 * row with white bold text, and its key figure is the only teal cell. Wide tables scroll inside
 * their own container with the first column sticky.
 */
export function ColumnTable<Row>({
  columns,
  rows,
  getRowId,
  caption,
  showCaption = false,
  total,
  stickyFirstColumn = true,
  initialSort,
  emptyMessage = 'Nothing here yet.',
  density = 'dense',
}: ColumnTableProps<Row>): JSX.Element {
  const captionId = useId();
  const { ref: scrollRef, overflowing, scrolled, onScroll } = useHorizontalScroll<HTMLDivElement>();
  const [sorting, setSorting] = useState<SortingState>(() =>
    initialSort ? [{ id: initialSort.columnId, desc: initialSort.desc ?? false }] : [],
  );

  const columnDefs = useMemo<ColumnDef<Row, SortValue>[]>(
    () =>
      columns.map((column) => ({
        id: column.id,
        accessorFn: (row: Row) => column.value(row) ?? undefined,
        enableSorting: column.sortable ?? false,
        // Figures sort largest first on the first click; text A–Z.
        sortDescFirst: column.numeric ?? false,
        sortUndefined: 'last',
        sortingFn: compareValues as SortingFn<Row>,
      })),
    [columns],
  );

  // TanStack returns fresh functions on purpose; the table instance is not memoisable.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable<Row>({
    // TanStack never mutates `data`; the cast only drops `readonly`.
    data: rows as Row[],
    columns: columnDefs,
    state: { sorting },
    onSortingChange: setSorting,
    enableMultiSort: false,
    getRowId: (row) => getRowId(row),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const byId = new Map(columns.map((column) => [column.id, column]));
  const sticky = stickyFirstColumn && columns.length > 1;
  const cellClass = (column: ColumnTableColumn<Row> | undefined, index: number): string =>
    cx(
      'jf-table__cell',
      column?.numeric && 'jf-table__cell--num',
      index === 0 && 'jf-table__cell--first',
    );

  return (
    <div
      className={cx(
        'jf-table',
        `jf-table--${density}`,
        sticky && 'jf-table--sticky',
        scrolled && 'jf-table--scrolled',
      )}
    >
      {showCaption ? (
        <p className="jf-table__title" aria-hidden="true">
          {caption}
        </p>
      ) : null}
      <div
        ref={scrollRef}
        className="jf-table__scroll"
        onScroll={onScroll}
        // A scrollable region must be reachable by keyboard; only then is it a named region.
        tabIndex={overflowing ? 0 : undefined}
        role={overflowing ? 'region' : undefined}
        aria-labelledby={overflowing ? captionId : undefined}
      >
        <table className="jf-table__table">
          <caption id={captionId} className="jf-visually-hidden">
            {caption}
          </caption>
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header, index) => {
                  const column = byId.get(header.column.id);
                  const sorted = header.column.getIsSorted();
                  const SortIcon =
                    sorted === 'asc' ? ArrowUp : sorted === 'desc' ? ArrowDown : ArrowUpDown;
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      className={cx(
                        'jf-table__th',
                        column?.numeric && 'jf-table__th--num',
                        index === 0 && 'jf-table__th--first',
                        sorted && 'jf-table__th--sorted',
                      )}
                      style={column?.minWidth ? { minWidth: column.minWidth } : undefined}
                      aria-sort={sorted ? ARIA_SORT[sorted] : undefined}
                    >
                      {header.column.getCanSort() ? (
                        <button
                          type="button"
                          className="jf-table__sort"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          <span>{column?.header}</span>
                          <Icon icon={SortIcon} className="jf-table__sort-icon" />
                        </button>
                      ) : (
                        column?.header
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody className="jf-table__body">
            {rows.length === 0 ? (
              <tr>
                <td className="jf-table__empty" colSpan={columns.length}>
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id}>
                  {row.getVisibleCells().map((cell, index) => {
                    const column = byId.get(cell.column.id);
                    const content = column?.cell
                      ? column.cell(row.original)
                      : (column?.value(row.original) ?? '');
                    return index === 0 ? (
                      <th key={cell.id} scope="row" className={cellClass(column, index)}>
                        {content}
                      </th>
                    ) : (
                      <td key={cell.id} className={cellClass(column, index)}>
                        {content}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
          {total ? (
            <tfoot>
              <tr className="jf-table__total">
                {columns.map((column, index) =>
                  index === 0 ? (
                    <th
                      key={column.id}
                      scope="row"
                      className={cx(
                        cellClass(column, index),
                        column.id === total.keyColumnId && 'jf-table__key',
                      )}
                    >
                      {total.label}
                    </th>
                  ) : (
                    <td
                      key={column.id}
                      className={cx(
                        cellClass(column, index),
                        column.id === total.keyColumnId && 'jf-table__key',
                      )}
                    >
                      {total.cells[column.id] ?? null}
                    </td>
                  ),
                )}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}
