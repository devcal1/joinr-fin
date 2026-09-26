// The dividend summaries (stage-3.md §6.6 items 6–7, §5): by financial year (grouped bars by
// kind; the table with the all-time total row, white bold, no teal) and the last 12 months
// (stacked bars and table). Each kind keeps one palette slot in both charts (ETF 1, stocks 2,
// funds 3, crypto 4); the series run stocks, ETFs, funds, crypto so the ETF segment separates
// violet from fuchsia, while the legend keeps the order ETFs, stocks, funds, crypto.
import type { DividendFyRowDto, DividendMonthRowDto, InstrumentKind } from '@joinr/schema';
import {
  Amount,
  ChartCard,
  ColumnTable,
  EChart,
  MEDIA,
  barOption,
  compactMoneyFormatter,
  formatFinancialYear,
  moneyFormatter,
  useMediaQuery,
  type ChartLegendItem,
  type ColumnTableColumn,
  type Series,
} from '@joinr/ui';
import { useMemo, type JSX } from 'react';
import { FlowCell } from '../cashflow/cells';
import {
  DIVIDEND_KIND_COLORS,
  DIVIDEND_KIND_HEADERS,
  DIVIDEND_KIND_LEGEND_ORDER,
  DIVIDEND_KIND_SERIES_ORDER,
  periodLabel,
  sumCents,
} from '../cashflow/display';
import { orderColumns } from '../cashflow/formState';

const dollarFormatter = moneyFormatter();

const LEGEND: ChartLegendItem[] = DIVIDEND_KIND_LEGEND_ORDER.map((kind) => ({
  name: DIVIDEND_KIND_HEADERS[kind],
  color: DIVIDEND_KIND_COLORS[kind],
  key: 'swatch',
}));

interface KindRow {
  byKind: Record<InstrumentKind, number>;
  totalCents: number;
}

/** A bar chart of the four kinds with the fixed colours and the kind-order legend. */
function KindBars({
  ariaLabel,
  categories,
  rows,
  stacked,
  emptyMessage,
}: {
  ariaLabel: string;
  categories: string[];
  rows: readonly KindRow[];
  stacked: boolean;
  emptyMessage: string;
}): JSX.Element {
  const option = useMemo(() => {
    const series: Series[] = DIVIDEND_KIND_SERIES_ORDER.map((kind) => ({
      name: DIVIDEND_KIND_HEADERS[kind],
      data: rows.map((row) => row.byKind[kind] / 100),
      color: DIVIDEND_KIND_COLORS[kind],
    }));
    return barOption({
      ariaLabel,
      categories,
      series,
      stacked,
      valueFormatter: dollarFormatter,
      axisFormatter: compactMoneyFormatter,
    });
  }, [ariaLabel, categories, rows, stacked]);
  return (
    <EChart
      option={option}
      ariaLabel={ariaLabel}
      empty={rows.every((row) => row.totalCents === 0)}
      emptyMessage={emptyMessage}
      legend={LEGEND}
    />
  );
}

function kindColumns<Row extends KindRow>(): Record<string, ColumnTableColumn<Row>> {
  return Object.fromEntries(
    DIVIDEND_KIND_LEGEND_ORDER.map((kind) => [
      kind,
      {
        id: kind,
        header: DIVIDEND_KIND_HEADERS[kind],
        value: (row: Row) => row.byKind[kind],
        cell: (row: Row) => <FlowCell cents={row.byKind[kind]} />,
        numeric: true,
      } satisfies ColumnTableColumn<Row>,
    ]),
  );
}

function totalCells(rows: readonly KindRow[]): Record<string, JSX.Element> {
  const cells: Record<string, JSX.Element> = {};
  for (const kind of DIVIDEND_KIND_LEGEND_ORDER) {
    cells[kind] = (
      <Amount cents={sumCents(rows.map((row) => row.byKind[kind]))} colorNegative={false} />
    );
  }
  cells.total = (
    <Amount cents={sumCents(rows.map((row) => row.totalCents))} colorNegative={false} />
  );
  return cells;
}

export function FinancialYearChart({ rows }: { rows: readonly DividendFyRowDto[] }): JSX.Element {
  const phone = useMediaQuery(MEDIA.phone);
  // The chart runs oldest to newest; the table stays newest first.
  const ascending = useMemo(() => [...rows].reverse(), [rows]);
  const categories = useMemo(
    () => ascending.map((row) => formatFinancialYear(row.financialYear)),
    [ascending],
  );
  const all: Record<string, ColumnTableColumn<DividendFyRowDto>> = {
    fy: {
      id: 'fy',
      header: 'FY',
      value: (row) => row.financialYear,
      cell: (row) => (
        <span className="jf-app-nowrap">{formatFinancialYear(row.financialYear)}</span>
      ),
      minWidth: 104,
    },
    ...kindColumns<DividendFyRowDto>(),
    total: {
      id: 'total',
      header: 'Total',
      value: (row) => row.totalCents,
      cell: (row) => <FlowCell cents={row.totalCents} />,
      numeric: true,
    },
  };
  const order = phone
    ? ['fy', 'total', ...DIVIDEND_KIND_LEGEND_ORDER]
    : ['fy', ...DIVIDEND_KIND_LEGEND_ORDER, 'total'];
  return (
    <ChartCard
      title="Per financial year by kind"
      subtitle="By payment date, per holding kind"
      chart={
        <KindBars
          ariaLabel="Dividends per financial year by kind"
          categories={categories}
          rows={ascending}
          stacked={false}
          emptyMessage="No dividends yet"
        />
      }
      table={
        <ColumnTable
          columns={orderColumns(all, order)}
          rows={rows}
          getRowId={(row) => String(row.financialYear)}
          caption="Dividends by financial year"
          total={{ label: 'All time', cells: totalCells(rows) }}
        />
      }
    />
  );
}

export function RollingChart({ rows }: { rows: readonly DividendMonthRowDto[] }): JSX.Element {
  const categories = useMemo(() => rows.map((row) => periodLabel(row.month)), [rows]);
  const columns: ColumnTableColumn<DividendMonthRowDto>[] = [
    {
      id: 'month',
      header: 'Month',
      value: (row) => row.month,
      cell: (row) => <span className="jf-app-nowrap">{periodLabel(row.month)}</span>,
      minWidth: 104,
    },
    ...Object.values(kindColumns<DividendMonthRowDto>()),
    {
      id: 'total',
      header: 'Total',
      value: (row) => row.totalCents,
      cell: (row) => <FlowCell cents={row.totalCents} />,
      numeric: true,
    },
  ];
  return (
    <ChartCard
      title="Per month by kind"
      subtitle="By payment month, stacked by kind"
      chart={
        <KindBars
          ariaLabel="Dividends per month over the last 12 months, stacked by kind"
          categories={categories}
          rows={rows}
          stacked
          emptyMessage="No dividends in the last 12 months"
        />
      }
      table={
        <ColumnTable
          columns={columns}
          rows={rows}
          getRowId={(row) => row.month}
          caption="Dividends over the last 12 months"
          total={{ label: '12 months', cells: totalCells(rows) }}
        />
      }
    />
  );
}
