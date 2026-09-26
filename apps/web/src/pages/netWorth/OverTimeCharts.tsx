// "Over time" (stage-5.md §5, §6.3 item 5, D83): the four charts under one view (unit and count):
// net worth by month (the class stack with "Net worth" as its total), savings and the savings rate
// (the one chart with a right-hand axis), liquid assets with its trend, and the savings tracker
// (the five liquid classes) with its trend. Titles and the first table column follow the unit;
// the live note shows only when a group is live. While a new view loads the charts dim.
import {
  CHART_PALETTE,
  ChartCard,
  ColumnTable,
  BarChart,
  Grid,
  GridItem,
  compactMoneyFormatter,
  moneyFormatter,
  percentFormatter,
  type ColumnTableColumn,
} from '@joinr/ui';
import type {
  CashChartPointDto,
  ChartDateUnit,
  NetWorthPageResponse,
  SnapshotGroupDto,
} from '@joinr/schema';
import { useMemo, type JSX, type ReactNode } from 'react';
import { toDollars, toRatio } from '../assets/display';
import { FlowCell, SavingsCell } from '../cashflow/cells';
import { MoneyCell, RatioCell } from '../investments/cells';
import {
  groupCategories,
  stackColumns,
  stackSeries,
  stackTotalCents,
  trendOverlay,
  type StackColumn,
} from '../history/charts';
import {
  LIVE_GROUP_NOTE,
  LIVE_TABLE_NOTE,
  NET_WORTH_TOTAL,
  TRACKER_CLASSES,
  groupCategory,
  unitTitle,
} from '../history/display';
import { STACK_CAPTION, trendCaption } from './netWorthText';

const dollars = moneyFormatter();
const NO_GROUPS = 'No recorded months yet.';

/**
 * A chart or table with the live note under it when a group is live (§5): the bar wording under a
 * chart, the "(live)" period wording under a table view.
 */
function withNotes(
  content: ReactNode,
  live: boolean,
  notes: (string | null)[] = [],
  liveNote: string = LIVE_GROUP_NOTE,
): JSX.Element {
  return (
    <div className="jf-app-block jf-app-block--tight">
      {content}
      {notes.map((note) =>
        note ? (
          <p key={note} className="jf-app-meta">
            {note}
          </p>
        ) : null,
      )}
      {live ? <p className="jf-app-meta">{liveNote}</p> : null}
    </div>
  );
}

const periodColumn: ColumnTableColumn<SnapshotGroupDto> = {
  id: 'period',
  header: 'Period',
  value: (g) => g.period,
  cell: (g) => groupCategory(g),
  minWidth: 120,
};

/** The stack's table: every series per group and the stack's total. */
function stackTable(
  groups: readonly SnapshotGroupDto[],
  columns: readonly StackColumn[],
  caption: string,
  totalHeader: string,
  totalOf: (group: SnapshotGroupDto, index: number) => number | null,
): JSX.Element {
  const index = new Map(groups.map((g, i) => [g.period, i]));
  const cols: ColumnTableColumn<SnapshotGroupDto>[] = [
    periodColumn,
    ...columns.map((column) => ({
      id: column.key,
      header: column.label,
      value: (g: SnapshotGroupDto) => column.cents[index.get(g.period) ?? -1] ?? null,
      cell: (g: SnapshotGroupDto) => (
        <MoneyCell cents={column.cents[index.get(g.period) ?? -1] ?? null} />
      ),
      numeric: true,
    })),
    {
      id: 'total',
      header: totalHeader,
      value: (g) => totalOf(g, index.get(g.period) ?? -1),
      cell: (g) => <MoneyCell cents={totalOf(g, index.get(g.period) ?? -1)} />,
      numeric: true,
    },
  ];
  return (
    <ColumnTable
      columns={cols}
      rows={groups}
      getRowId={(g) => g.period}
      caption={caption}
      emptyMessage={NO_GROUPS}
    />
  );
}

export function OverTimeCharts({
  page,
  loading,
}: {
  page: NetWorthPageResponse;
  loading: boolean;
}): JSX.Element {
  const { groups, savings, trends, unit } = page.charts;
  const live = groups.some((g) => g.live);
  const data = useMemo(() => {
    const categories = groupCategories(groups);
    const netWorth = stackColumns(groups);
    const tracker = stackColumns(groups, TRACKER_CLASSES, false);
    return {
      categories,
      netWorth,
      netWorthSeries: stackSeries(netWorth),
      tracker,
      trackerSeries: stackSeries(tracker),
      liquidSeries: [
        {
          name: 'Liquid assets',
          color: CHART_PALETTE[0],
          data: groups.map((g) => toDollars(g.netWorth.liquidCents)),
        },
      ],
      liquidTrend: [trendOverlay(trends.liquid)],
      trackerTrend: [trendOverlay(trends.tracker)],
      savingsCategories: savings.map((p) => (p.live ? `${p.label} (live)` : p.label)),
      savingsSeries: [
        {
          name: 'Savings',
          color: CHART_PALETTE[0],
          data: savings.map((p) => toDollars(p.savingsCents)),
        },
      ],
      savingsRate: [
        {
          name: 'Savings rate',
          color: CHART_PALETTE[1],
          values: savings.map((p) => toRatio(p.savingsRatio)),
          axis: 'secondary' as const,
        },
      ],
    };
  }, [groups, savings, trends]);
  const savingsLive = savings.some((p) => p.live);

  return (
    <Grid>
      <GridItem span={12}>
        <ChartCard
          title={unitTitle('Net worth', unit)}
          subtitle="What you own less what you owe, by class"
          chart={withNotes(
            <BarChart
              ariaLabel={unitTitle('Net worth', unit)}
              categories={data.categories}
              series={data.netWorthSeries}
              stacked
              totalLabel={NET_WORTH_TOTAL}
              valueFormatter={dollars}
              axisFormatter={compactMoneyFormatter}
              loading={loading}
              emptyMessage={NO_GROUPS}
              height={320}
            />,
            live,
            [STACK_CAPTION],
          )}
          table={withNotes(
            stackTable(
              groups,
              data.netWorth,
              unitTitle('Net worth', unit),
              NET_WORTH_TOTAL,
              (g) => g.netWorth.netWorthCents,
            ),
            live,
            [STACK_CAPTION],
            LIVE_TABLE_NOTE,
          )}
        />
      </GridItem>
      <GridItem span={12}>
        <ChartCard
          title="Savings and savings rate"
          subtitle="Savings (adjusted) and the savings rate on the right-hand axis"
          chart={withNotes(
            <BarChart
              ariaLabel="Savings and savings rate"
              categories={data.savingsCategories}
              series={data.savingsSeries}
              overlays={data.savingsRate}
              valueFormatter={dollars}
              axisFormatter={compactMoneyFormatter}
              secondaryAxisFormatter={percentFormatter}
              loading={loading}
              emptyMessage={NO_GROUPS}
            />,
            savingsLive,
          )}
          table={withNotes(
            <SavingsTable points={savings} unit={unit} />,
            savingsLive,
            [],
            LIVE_TABLE_NOTE,
          )}
        />
      </GridItem>
      <GridItem span={6} spanTablet={6}>
        <ChartCard
          title="Liquid assets"
          subtitle="Excludes super and property"
          chart={withNotes(
            <BarChart
              ariaLabel={unitTitle('Liquid assets', unit)}
              categories={data.categories}
              series={data.liquidSeries}
              overlays={data.liquidTrend}
              valueFormatter={dollars}
              axisFormatter={compactMoneyFormatter}
              loading={loading}
              emptyMessage={NO_GROUPS}
            />,
            live,
            [trendCaption(trends.liquid.slopePerMonthCents)],
          )}
          table={withNotes(
            <TrendTable
              groups={groups}
              caption={unitTitle('Liquid assets', unit)}
              header="Liquid assets"
              valueOf={(g) => g.netWorth.liquidCents}
              fitted={trends.liquid.fittedCents}
            />,
            live,
            [trendCaption(trends.liquid.slopePerMonthCents)],
            LIVE_TABLE_NOTE,
          )}
        />
      </GridItem>
      <GridItem span={6} spanTablet={6}>
        <ChartCard
          title="Savings tracker"
          subtitle="Stocks, ETFs, crypto, cash and managed funds"
          chart={withNotes(
            <BarChart
              ariaLabel={unitTitle('Savings tracker', unit)}
              categories={data.categories}
              series={data.trackerSeries}
              overlays={data.trackerTrend}
              stacked
              valueFormatter={dollars}
              axisFormatter={compactMoneyFormatter}
              loading={loading}
              emptyMessage={NO_GROUPS}
            />,
            live,
            [trendCaption(trends.tracker.slopePerMonthCents)],
          )}
          table={withNotes(
            stackTable(
              groups,
              data.tracker,
              unitTitle('Savings tracker', unit),
              'Total',
              (_g, i) => (i < 0 ? null : stackTotalCents(data.tracker, i)),
            ),
            live,
            [trendCaption(trends.tracker.slopePerMonthCents)],
            LIVE_TABLE_NOTE,
          )}
        />
      </GridItem>
    </Grid>
  );
}

/** Period · Savings · Income · Rate (§6.3 item 5). */
function SavingsTable({
  points,
  unit,
}: {
  points: readonly CashChartPointDto[];
  unit: ChartDateUnit;
}): JSX.Element {
  const columns: ColumnTableColumn<CashChartPointDto>[] = [
    {
      id: 'period',
      header: 'Period',
      value: (p) => p.period,
      cell: (p) => (p.live ? `${p.label} (live)` : p.label),
      minWidth: 120,
    },
    {
      id: 'savings',
      header: 'Savings',
      value: (p) => p.savingsCents,
      cell: (p) => <SavingsCell cents={p.savingsCents} />,
      numeric: true,
    },
    {
      id: 'income',
      header: 'Income',
      value: (p) => p.incomeCents,
      cell: (p) => <FlowCell cents={p.incomeCents} />,
      numeric: true,
    },
    {
      id: 'rate',
      header: 'Rate',
      value: (p) => toRatio(p.savingsRatio),
      cell: (p) => <RatioCell ratio={p.savingsRatio} loss />,
      numeric: true,
    },
  ];
  return (
    <ColumnTable
      columns={columns}
      rows={points}
      getRowId={(p) => p.period}
      caption={unitTitle('Savings', unit)}
      emptyMessage={NO_GROUPS}
    />
  );
}

/** Period · value · Trend: a single series with its fitted line. */
function TrendTable({
  groups,
  caption,
  header,
  valueOf,
  fitted,
}: {
  groups: readonly SnapshotGroupDto[];
  caption: string;
  header: string;
  valueOf: (group: SnapshotGroupDto) => number | null;
  fitted: readonly (number | null)[];
}): JSX.Element {
  const index = new Map(groups.map((g, i) => [g.period, i]));
  const columns: ColumnTableColumn<SnapshotGroupDto>[] = [
    periodColumn,
    {
      id: 'value',
      header,
      value: valueOf,
      cell: (g) => <MoneyCell cents={valueOf(g)} />,
      numeric: true,
    },
    {
      id: 'trend',
      header: 'Trend',
      value: (g) => fitted[index.get(g.period) ?? -1] ?? null,
      cell: (g) => <MoneyCell cents={fitted[index.get(g.period) ?? -1] ?? null} />,
      numeric: true,
    },
  ];
  return (
    <ColumnTable
      columns={columns}
      rows={groups}
      getRowId={(g) => g.period}
      caption={caption}
      emptyMessage={NO_GROUPS}
    />
  );
}
