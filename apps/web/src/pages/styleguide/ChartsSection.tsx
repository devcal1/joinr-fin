// Style guide: charts (charts owner). Every chart sits in a ChartCard with its table twin.
// All figures are generic sample data (round numbers), never real holdings.
import {
  Amount,
  AreaChart,
  BarChart,
  CHART_OTHER,
  CHART_PALETTE,
  ChartCard,
  ColumnTable,
  DonutChart,
  GaugeChart,
  Grid,
  GridItem,
  LineChart,
  SectionBar,
  compactMoneyFormatter,
  formatMoney,
  formatPercent,
  moneyFormatter,
  type ColumnTableColumn,
  type Datum,
  type Series,
} from '@joinr/ui';
import type { JSX } from 'react';
import { GalleryItem } from './GalleryItem';

/* ───────────── sample data (cents in tables, dollars in charts) ───────────── */

const MONTHS_H1 = ['Jan 2026', 'Feb 2026', 'Mar 2026', 'Apr 2026', 'May 2026', 'Jun 2026'];
const MONTHS_YEAR = [
  ...MONTHS_H1,
  'Jul 2026',
  'Aug 2026',
  'Sep 2026',
  'Oct 2026',
  'Nov 2026',
  'Dec 2026',
];

const dollars = moneyFormatter();
const toDollars = (cents: number): number => cents / 100;
const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

interface AllocationRow {
  label: string;
  current: number;
  target: number;
}
const ALLOCATION: AllocationRow[] = [
  { label: 'Australian shares', current: 520_000, target: 499_200 },
  { label: 'International shares', current: 340_000, target: 374_400 },
  { label: 'Property', current: 248_000, target: 249_600 },
  { label: 'Cash', current: 140_000, target: 124_800 },
];
const ALLOCATION_TOTAL = sum(ALLOCATION.map((r) => r.current));
const ALLOCATION_TARGET_TOTAL = sum(ALLOCATION.map((r) => r.target));
const ALLOCATION_CURRENT: Datum[] = ALLOCATION.map((r) => ({
  label: r.label,
  value: toDollars(r.current),
}));
const ALLOCATION_TARGET: Datum[] = ALLOCATION.map((r) => ({
  label: r.label,
  value: toDollars(r.target),
}));

interface MonthRow {
  month: string;
  values: number[];
}
function monthRows(months: readonly string[], seriesCents: readonly number[][]): MonthRow[] {
  return months.map((month, i) => ({ month, values: seriesCents.map((s) => s[i] ?? 0) }));
}
function toSeries(names: readonly string[], seriesCents: readonly number[][]): Series[] {
  return names.map((name, i) => ({ name, data: (seriesCents[i] ?? []).map(toDollars) }));
}

const SAVINGS_NAMES = ['Saved'];
const SAVINGS_CENTS = [[124_000, 98_000, 150_000, 112_000, 138_000, 104_000]];

const INCOME_NAMES = ['Salary', 'Side income', 'Dividends'];
const INCOME_CENTS = [
  [520_000, 520_000, 520_000, 540_000, 540_000, 540_000],
  [60_000, 85_000, 40_000, 72_000, 90_000, 65_000],
  [0, 12_000, 0, 0, 34_000, 0],
];

const CHANGE_NAMES = ['Change in net worth'];
const CHANGE_CENTS = [[124_000, -62_000, 88_000, 156_000, -123_400, 94_000]];

const SPENDING_CATEGORIES = ['Housing', 'Groceries', 'Transport', 'Utilities', 'Leisure'];
const SPENDING_NAMES = ['Spent'];
const SPENDING_CENTS = [[210_000, 84_000, 36_000, 28_000, 22_000]];

const NET_WORTH_NAMES = ['Net worth', 'Invested'];
const NET_WORTH_CENTS = [
  [
    1_000_000, 1_025_000, 1_018_000, 1_060_000, 1_082_000, 1_070_000, 1_115_000, 1_142_000,
    1_138_000, 1_180_000, 1_210_000, 1_248_000,
  ],
  [
    600_000, 620_000, 615_000, 650_000, 670_000, 660_000, 700_000, 725_000, 720_000, 755_000,
    780_000, 810_000,
  ],
];

const CASH_NAMES = ['Cash'];
const CASH_CENTS = [
  [
    240_000, 265_000, 250_000, 290_000, 310_000, 280_000, 330_000, 350_000, 320_000, 360_000,
    380_000, 400_000,
  ],
];

const HOLDINGS_NAMES = ['Shares', 'Property', 'Cash'];
const HOLDINGS_CENTS = [
  [500_000, 520_000, 510_000, 545_000, 560_000, 575_000],
  [240_000, 242_000, 244_000, 246_000, 248_000, 250_000],
  [240_000, 265_000, 250_000, 290_000, 310_000, 280_000],
];

const SAVINGS_SERIES = toSeries(SAVINGS_NAMES, SAVINGS_CENTS);
const INCOME_SERIES = toSeries(INCOME_NAMES, INCOME_CENTS);
const CHANGE_SERIES = toSeries(CHANGE_NAMES, CHANGE_CENTS);
const SPENDING_SERIES = toSeries(SPENDING_NAMES, SPENDING_CENTS);
const NET_WORTH_SERIES = toSeries(NET_WORTH_NAMES, NET_WORTH_CENTS);
const CASH_SERIES = toSeries(CASH_NAMES, CASH_CENTS);
const HOLDINGS_SERIES = toSeries(HOLDINGS_NAMES, HOLDINGS_CENTS);
const NO_SERIES: Series[] = [];
const NO_DATA: Datum[] = [];

/* ───────────── table helpers ───────────── */

const money = (cents: number): string => formatMoney(cents);

/** A month-by-series table with an optional total column and total row. */
function MonthTable({
  caption,
  firstHeader = 'Month',
  months,
  names,
  cents,
  withTotal = true,
}: {
  caption: string;
  firstHeader?: string;
  months: readonly string[];
  names: readonly string[];
  cents: readonly number[][];
  withTotal?: boolean;
}): JSX.Element {
  const rows = monthRows(months, cents);
  const showTotalColumn = withTotal && names.length > 1;
  const columns: ColumnTableColumn<MonthRow>[] = [
    { id: 'month', header: firstHeader, value: (r) => r.month },
    ...names.map((name, i): ColumnTableColumn<MonthRow> => ({
      id: `s${i}`,
      header: name,
      numeric: true,
      value: (r) => r.values[i] ?? 0,
      cell: (r) => <Amount cents={r.values[i] ?? 0} />,
    })),
    ...(showTotalColumn
      ? [
          {
            id: 'total',
            header: 'Total',
            numeric: true,
            value: (r: MonthRow) => sum(r.values),
            cell: (r: MonthRow) => <Amount cents={sum(r.values)} />,
          },
        ]
      : []),
  ];
  const keyColumnId = showTotalColumn ? 'total' : 's0';
  const totalCells: Record<string, string> = {};
  names.forEach((_, i) => {
    totalCells[`s${i}`] = money(sum(cents[i] ?? []));
  });
  if (showTotalColumn) totalCells.total = money(sum(cents.map((s) => sum(s))));
  return (
    <ColumnTable
      caption={caption}
      columns={columns}
      rows={rows}
      getRowId={(r) => r.month}
      total={withTotal ? { label: 'Total', cells: totalCells, keyColumnId } : undefined}
    />
  );
}

const ALLOCATION_COLUMNS: ColumnTableColumn<AllocationRow>[] = [
  { id: 'label', header: 'Asset class', value: (r) => r.label },
  {
    id: 'current',
    header: 'Current',
    numeric: true,
    value: (r) => r.current,
    cell: (r) => money(r.current),
  },
  {
    id: 'share',
    header: 'Share',
    numeric: true,
    value: (r) => r.current / ALLOCATION_TOTAL,
    cell: (r) => formatPercent(r.current / ALLOCATION_TOTAL),
  },
  {
    id: 'target',
    header: 'Target',
    numeric: true,
    value: (r) => r.target,
    cell: (r) => money(r.target),
  },
  {
    id: 'difference',
    header: 'Difference',
    numeric: true,
    value: (r) => r.current - r.target,
    cell: (r) => <Amount cents={r.current - r.target} signDisplay="always" />,
  },
];

function AllocationTable(): JSX.Element {
  return (
    <ColumnTable
      caption="Allocation by asset class, current and target"
      columns={ALLOCATION_COLUMNS}
      rows={ALLOCATION}
      getRowId={(r) => r.label}
      total={{
        label: 'Total',
        keyColumnId: 'current',
        cells: {
          current: money(ALLOCATION_TOTAL),
          share: formatPercent(1),
          target: money(ALLOCATION_TARGET_TOTAL),
          difference: money(ALLOCATION_TOTAL - ALLOCATION_TARGET_TOTAL),
        },
      }}
    />
  );
}

interface ChangeRow {
  month: string;
  cents: number;
}
const CHANGE_ROWS: ChangeRow[] = MONTHS_H1.map((month, i) => ({
  month,
  cents: CHANGE_CENTS[0]?.[i] ?? 0,
}));
const CHANGE_COLUMNS: ColumnTableColumn<ChangeRow>[] = [
  { id: 'month', header: 'Month', value: (r) => r.month },
  {
    id: 'change',
    header: 'Change',
    numeric: true,
    value: (r) => r.cents,
    cell: (r) => <Amount cents={r.cents} signDisplay="always" />,
  },
  {
    id: 'direction',
    header: 'Direction',
    value: (r) => (r.cents > 0 ? 'Gain' : r.cents < 0 ? 'Loss' : 'No change'),
  },
];

const LOADING_COLUMNS: ColumnTableColumn<MonthRow>[] = [
  { id: 'month', header: 'Month', value: (r) => r.month },
  { id: 'value', header: 'Net worth', numeric: true, value: (r) => r.values[0] ?? 0 },
];

interface GaugeRow {
  label: string;
  value: number;
  target: number;
}
const GAUGE_COLUMNS: ColumnTableColumn<GaugeRow>[] = [
  { id: 'label', header: 'Measure', value: (r) => r.label },
  {
    id: 'value',
    header: 'Actual',
    numeric: true,
    value: (r) => r.value,
    cell: (r) => formatPercent(r.value),
  },
  {
    id: 'target',
    header: 'Target',
    numeric: true,
    value: (r) => r.target,
    cell: (r) => formatPercent(r.target),
  },
];

/* ───────────── the section ───────────── */

export function ChartsSection(): JSX.Element {
  return (
    <section id="charts" className="jf-app-styleguide__section" aria-labelledby="charts-title">
      <SectionBar id="charts-title" title="Charts" role="reference" />
      <Grid>
        <GridItem span={12}>
          <GalleryItem name="Palette" note="Validated categorical order (STYLE_GUIDE §6)">
            <ol className="jf-chart-palette" aria-label="Chart palette, in slot order">
              {CHART_PALETTE.map((color, i) => (
                <li key={color} className="jf-chart-palette__item">
                  <span
                    className="jf-chart-palette__swatch"
                    style={{ backgroundColor: color }}
                    aria-hidden="true"
                  />
                  <span className="jf-chart-palette__slot">{i + 1}</span>
                  <span className="jf-chart-palette__hex">{color}</span>
                </li>
              ))}
              <li className="jf-chart-palette__item">
                <span
                  className="jf-chart-palette__swatch"
                  style={{ backgroundColor: CHART_OTHER }}
                  aria-hidden="true"
                />
                <span className="jf-chart-palette__slot">Other</span>
                <span className="jf-chart-palette__hex">{CHART_OTHER}</span>
              </li>
            </ol>
          </GalleryItem>
        </GridItem>

        <GridItem span={6} spanTablet={6}>
          <GalleryItem name="DonutChart" note="Current (outer) vs target (inner ring)">
            <ChartCard
              title="Allocation"
              subtitle="Current vs target · Aug 2026"
              chart={
                <DonutChart
                  ariaLabel="Allocation by asset class: current against target"
                  data={ALLOCATION_CURRENT}
                  target={ALLOCATION_TARGET}
                  valueFormatter={dollars}
                  centerValue={formatMoney(ALLOCATION_TOTAL, { wholeDollars: true })}
                  centerLabel="Total"
                />
              }
              table={<AllocationTable />}
            />
          </GalleryItem>
        </GridItem>

        <GridItem span={6} spanTablet={6}>
          <GalleryItem name="BarChart" note="Single series: teal, no legend">
            <ChartCard
              title="Monthly savings"
              subtitle="Jan–Jun 2026"
              chart={
                <BarChart
                  ariaLabel="Monthly savings, January to June 2026"
                  categories={MONTHS_H1}
                  series={SAVINGS_SERIES}
                  valueFormatter={dollars}
                  axisFormatter={compactMoneyFormatter}
                />
              }
              table={
                <MonthTable
                  caption="Monthly savings"
                  months={MONTHS_H1}
                  names={SAVINGS_NAMES}
                  cents={SAVINGS_CENTS}
                />
              }
            />
          </GalleryItem>
        </GridItem>

        <GridItem span={6} spanTablet={6}>
          <GalleryItem name="BarChart/stacked" note="2px surface gap between segments">
            <ChartCard
              title="Income by source"
              subtitle="Jan–Jun 2026"
              chart={
                <BarChart
                  ariaLabel="Income by source per month, stacked"
                  categories={MONTHS_H1}
                  series={INCOME_SERIES}
                  stacked
                  valueFormatter={dollars}
                  axisFormatter={compactMoneyFormatter}
                />
              }
              table={
                <MonthTable
                  caption="Income by source"
                  months={MONTHS_H1}
                  names={INCOME_NAMES}
                  cents={INCOME_CENTS}
                />
              }
            />
          </GalleryItem>
        </GridItem>

        <GridItem span={6} spanTablet={6}>
          <GalleryItem name="BarChart/gain-loss" note="signColors: --go / --stop, sign and word">
            <ChartCard
              title="Change in net worth"
              subtitle="Month on month · Jan–Jun 2026"
              chart={
                <BarChart
                  ariaLabel="Change in net worth per month: gains and losses"
                  categories={MONTHS_H1}
                  series={CHANGE_SERIES}
                  signColors
                  valueFormatter={dollars}
                  axisFormatter={compactMoneyFormatter}
                />
              }
              table={
                <ColumnTable
                  caption="Change in net worth per month"
                  columns={CHANGE_COLUMNS}
                  rows={CHANGE_ROWS}
                  getRowId={(r) => r.month}
                  total={{
                    label: 'Net change',
                    keyColumnId: 'change',
                    cells: {
                      change: formatMoney(sum(CHANGE_CENTS[0] ?? []), { signDisplay: 'always' }),
                    },
                  }}
                />
              }
            />
          </GalleryItem>
        </GridItem>

        <GridItem span={6} spanTablet={6}>
          <GalleryItem name="BarChart/horizontal" note="Long category names read left to right">
            <ChartCard
              title="Spending by category"
              subtitle="Aug 2026"
              chart={
                <BarChart
                  ariaLabel="Spending by category, August 2026"
                  categories={SPENDING_CATEGORIES}
                  series={SPENDING_SERIES}
                  horizontal
                  valueFormatter={dollars}
                  axisFormatter={compactMoneyFormatter}
                />
              }
              table={
                <MonthTable
                  caption="Spending by category"
                  firstHeader="Category"
                  months={SPENDING_CATEGORIES}
                  names={SPENDING_NAMES}
                  cents={SPENDING_CENTS}
                />
              }
            />
          </GalleryItem>
        </GridItem>

        <GridItem span={6} spanTablet={6}>
          <GalleryItem name="LineChart" note="Crosshair tooltip lists every series">
            <ChartCard
              title="Net worth"
              subtitle="2026"
              chart={
                <LineChart
                  ariaLabel="Net worth and invested amount per month, 2026"
                  categories={MONTHS_YEAR}
                  series={NET_WORTH_SERIES}
                  valueFormatter={dollars}
                  axisFormatter={compactMoneyFormatter}
                />
              }
              table={
                <MonthTable
                  caption="Net worth and invested amount per month"
                  months={MONTHS_YEAR}
                  names={NET_WORTH_NAMES}
                  cents={NET_WORTH_CENTS}
                  withTotal={false}
                />
              }
            />
          </GalleryItem>
        </GridItem>

        <GridItem span={6} spanTablet={6}>
          <GalleryItem name="AreaChart" note="Single series with a soft wash">
            <ChartCard
              title="Cash balance"
              subtitle="2026"
              chart={
                <AreaChart
                  ariaLabel="Cash balance per month, 2026"
                  categories={MONTHS_YEAR}
                  series={CASH_SERIES}
                  valueFormatter={dollars}
                  axisFormatter={compactMoneyFormatter}
                />
              }
              table={
                <MonthTable
                  caption="Cash balance per month"
                  months={MONTHS_YEAR}
                  names={CASH_NAMES}
                  cents={CASH_CENTS}
                  withTotal={false}
                />
              }
            />
          </GalleryItem>
        </GridItem>

        <GridItem span={6} spanTablet={6}>
          <GalleryItem name="AreaChart/stacked" note="Bands stack; the edges are the lines">
            <ChartCard
              title="Holdings"
              subtitle="Jan–Jun 2026"
              chart={
                <AreaChart
                  ariaLabel="Holdings by type per month, stacked"
                  categories={MONTHS_H1}
                  series={HOLDINGS_SERIES}
                  stacked
                  valueFormatter={dollars}
                  axisFormatter={compactMoneyFormatter}
                />
              }
              table={
                <MonthTable
                  caption="Holdings by type per month"
                  months={MONTHS_H1}
                  names={HOLDINGS_NAMES}
                  cents={HOLDINGS_CENTS}
                  withTotal={false}
                />
              }
            />
          </GalleryItem>
        </GridItem>

        <GridItem span={6} spanTablet={6}>
          <GalleryItem name="GaugeChart" note="Ratio with a target tick; negatives clamp the arc">
            <ChartCard
              title="Savings rate"
              subtitle="Aug 2026 · and a month in deficit"
              chart={
                <Grid>
                  <GridItem span={6} spanTablet={3}>
                    <GaugeChart
                      ariaLabel="Savings rate 7.4% against a target of 20.0%"
                      value={0.074}
                      target={0.2}
                      label="Savings rate"
                      height={220}
                    />
                  </GridItem>
                  <GridItem span={6} spanTablet={3}>
                    <GaugeChart
                      ariaLabel="Savings rate −2.1% against a target of 20.0%"
                      value={-0.021}
                      target={0.2}
                      label="Deficit month"
                      height={220}
                    />
                  </GridItem>
                </Grid>
              }
              table={
                <ColumnTable
                  caption="Savings rate against target"
                  columns={GAUGE_COLUMNS}
                  rows={[
                    { label: 'Savings rate', value: 0.074, target: 0.2 },
                    { label: 'Deficit month', value: -0.021, target: 0.2 },
                  ]}
                  getRowId={(r) => r.label}
                />
              }
            />
          </GalleryItem>
        </GridItem>

        <GridItem span={6} spanTablet={6}>
          <GalleryItem name="ChartCard" note="Opens on the table view; Chart | Table toggle">
            <ChartCard
              title="Monthly savings"
              subtitle="Table first"
              defaultView="table"
              chart={
                <BarChart
                  ariaLabel="Monthly savings, January to June 2026"
                  categories={MONTHS_H1}
                  series={SAVINGS_SERIES}
                  valueFormatter={dollars}
                  axisFormatter={compactMoneyFormatter}
                />
              }
              table={
                <MonthTable
                  caption="Monthly savings"
                  months={MONTHS_H1}
                  names={SAVINGS_NAMES}
                  cents={SAVINGS_CENTS}
                />
              }
            />
          </GalleryItem>
        </GridItem>

        <GridItem span={6} spanTablet={6}>
          <GalleryItem name="Chart/empty" note="No data: same footprint, plain message">
            <ChartCard
              title="Allocation"
              subtitle="No holdings yet"
              chart={
                <DonutChart
                  ariaLabel="Allocation by asset class"
                  data={NO_DATA}
                  emptyMessage="Add a holding to see your allocation."
                />
              }
              table={
                <ColumnTable
                  caption="Allocation by asset class"
                  columns={ALLOCATION_COLUMNS}
                  rows={[]}
                  getRowId={(r) => r.label}
                />
              }
            />
          </GalleryItem>
        </GridItem>

        <GridItem span={6} spanTablet={6}>
          <GalleryItem name="Chart/loading" note="First load, then a refetch that keeps the frame">
            <Grid>
              <GridItem span={6} spanTablet={3}>
                <ChartCard
                  title="Net worth"
                  subtitle="Loading"
                  chart={
                    <LineChart
                      ariaLabel="Net worth per month"
                      categories={MONTHS_YEAR}
                      series={NO_SERIES}
                      loading
                      height={200}
                    />
                  }
                  table={
                    <ColumnTable
                      caption="Net worth per month"
                      columns={LOADING_COLUMNS}
                      rows={[]}
                      getRowId={(r) => r.month}
                      emptyMessage="Loading…"
                    />
                  }
                />
              </GridItem>
              <GridItem span={6} spanTablet={3}>
                <ChartCard
                  title="Monthly savings"
                  subtitle="Refreshing"
                  chart={
                    <BarChart
                      ariaLabel="Monthly savings, January to June 2026"
                      categories={MONTHS_H1}
                      series={SAVINGS_SERIES}
                      valueFormatter={dollars}
                      axisFormatter={compactMoneyFormatter}
                      loading
                      height={200}
                    />
                  }
                  table={
                    <MonthTable
                      caption="Monthly savings"
                      months={MONTHS_H1}
                      names={SAVINGS_NAMES}
                      cents={SAVINGS_CENTS}
                    />
                  }
                />
              </GridItem>
            </Grid>
          </GalleryItem>
        </GridItem>
      </Grid>
    </section>
  );
}
