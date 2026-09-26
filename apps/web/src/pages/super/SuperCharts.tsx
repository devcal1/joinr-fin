// Super charts (stage-4.md §5, §6.4 item 6): "Super value" (one line), "Gains" (derived gains; a
// month not updated merges forward and shows no bar), "Return" (the chained Modified Dietz return)
// and "Into the fund" (SG slot 1 and your contributions slot 2, stacked: parts of what the fund
// received). Each has its table; the live point ends in " (live)".
import type { SuperChartPointDto } from '@joinr/schema';
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
import { FlowCell, MoneyCell, RatioCell } from '../cashflow/cells';
import {
  LIVE_POINT_NOTE,
  NO_HISTORY_NOTE,
  chartCategory,
  toDollars,
  toRatio,
} from '../assets/display';

const dollarFormatter = moneyFormatter();
const NO_POINTS = 'No history yet';

const periodColumn: ColumnTableColumn<SuperChartPointDto> = {
  id: 'period',
  header: 'Period',
  value: (p) => p.period,
  cell: (p) => chartCategory(p),
  minWidth: 120,
};

export function SuperCharts({ points }: { points: readonly SuperChartPointDto[] }): JSX.Element {
  const live = points.some((p) => p.live);
  const recorded = points.some((p) => !p.live);
  const data = useMemo(() => {
    const categories = points.map(chartCategory);
    const value: Series[] = [{ name: 'Value', data: points.map((p) => toDollars(p.valueCents)) }];
    const gains: Series[] = [{ name: 'Gain', data: points.map((p) => toDollars(p.gainCents)) }];
    const returns: Series[] = [{ name: 'Return', data: points.map((p) => toRatio(p.returnRatio)) }];
    const into: Series[] = [
      {
        name: 'Employer SG',
        data: points.map((p) => toDollars(p.sgFundCents)),
        color: CHART_PALETTE[0],
      },
      {
        name: 'Your contributions',
        data: points.map((p) => toDollars(p.memberFundCents)),
        color: CHART_PALETTE[1],
      },
    ];
    return { categories, value, gains, returns, into };
  }, [points]);

  const notes = (content: ReactNode): JSX.Element => (
    <div className="jf-app-block">
      {content}
      {live ? <p className="jf-app-meta">{LIVE_POINT_NOTE}</p> : null}
      {recorded ? null : <p className="jf-app-meta">{NO_HISTORY_NOTE}</p>}
    </div>
  );

  const table = (columns: ColumnTableColumn<SuperChartPointDto>[], caption: string) => (
    <ColumnTable
      columns={[periodColumn, ...columns]}
      rows={points}
      getRowId={(p) => p.period}
      caption={caption}
      emptyMessage={NO_POINTS}
    />
  );

  return (
    <Grid>
      <GridItem span={6}>
        <ChartCard
          title="Super value"
          subtitle="Total super at each recorded month"
          chart={notes(
            <LineChart
              ariaLabel="Super value at each recorded month"
              categories={data.categories}
              series={data.value}
              valueFormatter={dollarFormatter}
              axisFormatter={compactMoneyFormatter}
              emptyMessage={NO_POINTS}
            />,
          )}
          table={notes(
            table(
              [
                {
                  id: 'value',
                  header: 'Value',
                  value: (p) => p.valueCents,
                  cell: (p) => <MoneyCell cents={p.valueCents} loss={false} />,
                  numeric: true,
                },
              ],
              'Super value',
            ),
          )}
        />
      </GridItem>
      <GridItem span={6}>
        <ChartCard
          title="Gains"
          subtitle="Change less SG, your contributions and transfers in"
          chart={notes(
            <BarChart
              ariaLabel="Super gains per period"
              categories={data.categories}
              series={data.gains}
              valueFormatter={dollarFormatter}
              axisFormatter={compactMoneyFormatter}
              emptyMessage={NO_POINTS}
            />,
          )}
          table={notes(
            table(
              [
                {
                  id: 'gain',
                  header: 'Gain',
                  value: (p) => p.gainCents,
                  cell: (p) => <MoneyCell cents={p.gainCents} loss />,
                  numeric: true,
                },
              ],
              'Super gains',
            ),
          )}
        />
      </GridItem>
      <GridItem span={6}>
        <ChartCard
          title="Return"
          subtitle="Each period’s Modified Dietz return"
          chart={notes(
            <LineChart
              ariaLabel="Super return per period"
              categories={data.categories}
              series={data.returns}
              valueFormatter={percentFormatter}
              emptyMessage={NO_POINTS}
            />,
          )}
          table={notes(
            table(
              [
                {
                  id: 'return',
                  header: 'Return',
                  value: (p) => toRatio(p.returnRatio),
                  cell: (p) => <RatioCell ratio={p.returnRatio} loss />,
                  numeric: true,
                },
              ],
              'Super return',
            ),
          )}
        />
      </GridItem>
      <GridItem span={6}>
        <ChartCard
          title="Into the fund"
          subtitle="Employer SG and your contributions, as the fund received them"
          chart={notes(
            <BarChart
              ariaLabel="Money into the fund per period: employer SG and your contributions"
              categories={data.categories}
              series={data.into}
              stacked
              valueFormatter={dollarFormatter}
              axisFormatter={compactMoneyFormatter}
              emptyMessage={NO_POINTS}
            />,
          )}
          table={notes(
            table(
              [
                {
                  id: 'sg',
                  header: 'Employer SG',
                  value: (p) => p.sgFundCents,
                  cell: (p) => <FlowCell cents={p.sgFundCents} />,
                  numeric: true,
                },
                {
                  id: 'yours',
                  header: 'Your contributions',
                  value: (p) => p.memberFundCents,
                  cell: (p) => <FlowCell cents={p.memberFundCents} />,
                  numeric: true,
                },
                {
                  id: 'netPay',
                  header: 'Take-home cost',
                  value: (p) => p.memberNetPayCents,
                  cell: (p) => <FlowCell cents={p.memberNetPayCents} />,
                  numeric: true,
                },
              ],
              'Money into the fund',
            ),
          )}
        />
      </GridItem>
    </Grid>
  );
}
