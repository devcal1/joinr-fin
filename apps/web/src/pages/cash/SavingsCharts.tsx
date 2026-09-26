// The Cash page's savings charts (stage-3.md §5, §6.3 item 4): cash value history (bars), savings
// history (stacked: cash gain slot 1, added investments slot 2, the adjustment slot 3 drawn below
// zero; the raw view drops it) and the savings rate with its 3-month trend. Each has a table twin;
// the live point ends in " (live)".
import type { CashChartPointDto } from '@joinr/schema';
import {
  BarChart,
  CHART_PALETTE,
  ChartCard,
  ColumnTable,
  Grid,
  GridItem,
  LineChart,
  compactMoneyFormatter,
  moneyFormatter,
  percentFormatter,
  type ColumnTableColumn,
  type Series,
} from '@joinr/ui';
import { useMemo, type JSX, type ReactNode } from 'react';
import { FlowCell, RatioCell, SavingsCell } from '../cashflow/cells';
import { toDollars, toRatio } from '../cashflow/display';
import type { SavingsView } from './cashEditor';

export const NO_CASH_HISTORY = 'No recorded months yet';
export const LIVE_CASH_NOTE = "The last point is provisional: it uses today's balances.";

const dollarFormatter = moneyFormatter();

function category(point: Pick<CashChartPointDto, 'label' | 'live'>): string {
  return point.live ? `${point.label} (live)` : point.label;
}

const periodColumn: ColumnTableColumn<CashChartPointDto> = {
  id: 'period',
  header: 'Period',
  value: (p) => p.period,
  cell: (p) => category(p),
  minWidth: 120,
};

function withLiveNote(content: ReactNode, live: boolean): JSX.Element {
  return (
    <div className="jf-app-block">
      {content}
      {live ? <p className="jf-app-meta">{LIVE_CASH_NOTE}</p> : null}
    </div>
  );
}

export function SavingsCharts({
  points,
  view,
}: {
  points: readonly CashChartPointDto[];
  view: SavingsView;
}): JSX.Element {
  const live = points.some((p) => p.live);
  const raw = view === 'raw';
  const data = useMemo(() => {
    const categories = points.map(category);
    const cash: Series[] = [{ name: 'Cash', data: points.map((p) => toDollars(p.cashCents)) }];
    const savings: Series[] = [
      {
        name: 'Cash gain',
        data: points.map((p) => toDollars(p.cashGainCents)),
        color: CHART_PALETTE[0],
      },
      {
        name: 'Added investments',
        data: points.map((p) => toDollars(p.addedInvestmentsCents)),
        color: CHART_PALETTE[1],
      },
    ];
    if (!raw) {
      // The adjustment is taken out of savings: a segment below zero in slot 3 (never --stop).
      savings.push({
        name: 'Adjustment',
        data: points.map((p) => (p.adjustmentCents === 0 ? 0 : -p.adjustmentCents / 100)),
        color: CHART_PALETTE[2],
      });
    }
    const rate: Series[] = [
      {
        name: 'Savings rate',
        data: points.map((p) => toRatio(raw ? p.savingsRawRatio : p.savingsRatio)),
      },
      { name: '3-month trend', data: points.map((p) => toRatio(p.trendRatio)) },
    ];
    return { categories, cash, savings, rate };
  }, [points, raw]);

  const table = (columns: ColumnTableColumn<CashChartPointDto>[], caption: string) => (
    <ColumnTable
      columns={[periodColumn, ...columns]}
      rows={points}
      getRowId={(p) => p.period}
      caption={caption}
      emptyMessage={NO_CASH_HISTORY}
    />
  );

  const savingsColumns: ColumnTableColumn<CashChartPointDto>[] = [
    {
      id: 'cashGain',
      header: 'Cash gain',
      value: (p) => p.cashGainCents,
      cell: (p) => <FlowCell cents={p.cashGainCents} />,
      numeric: true,
    },
    {
      id: 'added',
      header: 'Added investments',
      value: (p) => p.addedInvestmentsCents,
      cell: (p) => <FlowCell cents={p.addedInvestmentsCents} />,
      numeric: true,
    },
    ...(raw
      ? []
      : [
          {
            id: 'adjustment',
            header: 'Adjustment',
            value: (p: CashChartPointDto) => p.adjustmentCents,
            cell: (p: CashChartPointDto) => <FlowCell cents={p.adjustmentCents} />,
            numeric: true,
          },
        ]),
    {
      id: 'savings',
      header: 'Savings',
      value: (p) => (raw ? p.savingsRawCents : p.savingsCents),
      cell: (p) => <SavingsCell cents={raw ? p.savingsRawCents : p.savingsCents} />,
      numeric: true,
    },
  ];

  return (
    <Grid>
      <GridItem span={6}>
        <ChartCard
          title="Cash value history"
          subtitle="Total cash at each recorded month"
          chart={withLiveNote(
            <BarChart
              ariaLabel="Cash value at each recorded month"
              categories={data.categories}
              series={data.cash}
              valueFormatter={dollarFormatter}
              axisFormatter={compactMoneyFormatter}
              emptyMessage={NO_CASH_HISTORY}
            />,
            live,
          )}
          table={withLiveNote(
            table(
              [
                {
                  id: 'cash',
                  header: 'Cash',
                  value: (p) => p.cashCents,
                  cell: (p) => <SavingsCell cents={p.cashCents} />,
                  numeric: true,
                },
              ],
              'Cash value history',
            ),
            live,
          )}
        />
      </GridItem>
      <GridItem span={6}>
        <ChartCard
          title="Savings history"
          subtitle={
            raw
              ? 'Cash gain + added investments (as the sheet)'
              : 'Cash gain + added investments − adjustments'
          }
          chart={withLiveNote(
            <BarChart
              ariaLabel={`Savings per period${raw ? ', as the sheet' : ''}`}
              categories={data.categories}
              series={data.savings}
              stacked
              valueFormatter={dollarFormatter}
              axisFormatter={compactMoneyFormatter}
              emptyMessage={NO_CASH_HISTORY}
            />,
            live,
          )}
          table={withLiveNote(table(savingsColumns, 'Savings history'), live)}
        />
      </GridItem>
      <GridItem span={12}>
        <ChartCard
          title="Savings rate"
          subtitle={raw ? 'Savings ÷ income, as the sheet' : 'Savings ÷ income (adjusted)'}
          chart={withLiveNote(
            <LineChart
              ariaLabel={`Savings rate per period with the 3-month trend${raw ? ', as the sheet' : ''}`}
              categories={data.categories}
              series={data.rate}
              valueFormatter={percentFormatter}
              emptyMessage={NO_CASH_HISTORY}
            />,
            live,
          )}
          table={withLiveNote(
            table(
              [
                {
                  id: 'rate',
                  header: 'Savings rate',
                  value: (p) => toRatio(raw ? p.savingsRawRatio : p.savingsRatio),
                  cell: (p) => <RatioCell ratio={raw ? p.savingsRawRatio : p.savingsRatio} loss />,
                  numeric: true,
                },
                {
                  id: 'trend',
                  header: '3-month trend',
                  value: (p) => toRatio(p.trendRatio),
                  cell: (p) => <RatioCell ratio={p.trendRatio} />,
                  numeric: true,
                },
              ],
              'Savings rate',
            ),
            live,
          )}
        />
      </GridItem>
    </Grid>
  );
}
