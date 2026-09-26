// Value over time (stage-4.md §5, §6.3 item 5, UX-18): "Cost and value" (two unstacked lines with
// an area wash; Value slot 1, Cost slot 2; §11 fix 15) and "Gain" (one series, a loss below zero
// with its sign in the tooltip and table), each with its table. The live point ends in " (live)"
// and there is no current-month zero (§11 fix 14).
import type { OtherAssetsChartPointDto } from '@joinr/schema';
import {
  AreaChart,
  BarChart,
  CHART_PALETTE,
  ChartCard,
  ColumnTable,
  Grid,
  GridItem,
  compactMoneyFormatter,
  moneyFormatter,
  type ColumnTableColumn,
  type Series,
} from '@joinr/ui';
import { useMemo, type JSX, type ReactNode } from 'react';
import { MoneyCell, RatioCell } from '../cashflow/cells';
import {
  LIVE_POINT_NOTE,
  NO_HISTORY_NOTE,
  chartCategory,
  toDollars,
  toRatio,
} from '../assets/display';
import { COST_FOOTNOTE } from './otherAssetsText';

const dollarFormatter = moneyFormatter();
const NO_POINTS = 'No history yet';

const periodColumn: ColumnTableColumn<OtherAssetsChartPointDto> = {
  id: 'period',
  header: 'Period',
  value: (p) => p.period,
  cell: (p) => chartCategory(p),
  minWidth: 120,
};

/** The Cost and value chart's series, in slot order: Value slot 1, Cost slot 2 (§5). */
const COST_VALUE_SERIES = [
  { name: 'Value', color: CHART_PALETTE[0] },
  { name: 'Cost', color: CHART_PALETTE[1] },
] as const;

export function OtherAssetsCharts({
  points,
}: {
  points: readonly OtherAssetsChartPointDto[];
}): JSX.Element {
  const live = points.some((p) => p.live);
  const recorded = points.some((p) => !p.live);
  const data = useMemo(() => {
    const categories = points.map(chartCategory);
    const costValue: Series[] = [
      {
        name: COST_VALUE_SERIES[0].name,
        data: points.map((p) => toDollars(p.valueCents)),
        color: COST_VALUE_SERIES[0].color,
      },
      {
        name: COST_VALUE_SERIES[1].name,
        data: points.map((p) => toDollars(p.costCents)),
        color: COST_VALUE_SERIES[1].color,
      },
    ];
    const gain: Series[] = [{ name: 'Gain', data: points.map((p) => toDollars(p.gainCents)) }];
    return { categories, costValue, gain };
  }, [points]);

  const notes = (content: ReactNode, extra?: string): JSX.Element => (
    <div className="jf-app-block">
      {content}
      {extra ? <p className="jf-app-meta">{extra}</p> : null}
      {live ? <p className="jf-app-meta">{LIVE_POINT_NOTE}</p> : null}
      {recorded ? null : <p className="jf-app-meta">{NO_HISTORY_NOTE}</p>}
    </div>
  );

  const table = (columns: ColumnTableColumn<OtherAssetsChartPointDto>[], caption: string) => (
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
          title="Cost and value"
          subtitle="Value against the cost of the items held"
          chart={notes(
            <AreaChart
              ariaLabel="Other assets: value and cost at each recorded month"
              categories={data.categories}
              series={data.costValue}
              valueFormatter={dollarFormatter}
              axisFormatter={compactMoneyFormatter}
              emptyMessage={NO_POINTS}
            />,
            COST_FOOTNOTE,
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
                {
                  id: 'cost',
                  header: 'Cost',
                  value: (p) => p.costCents,
                  cell: (p) => <MoneyCell cents={p.costCents} loss={false} />,
                  numeric: true,
                },
              ],
              'Other assets: cost and value',
            ),
            COST_FOOTNOTE,
          )}
        />
      </GridItem>
      <GridItem span={6}>
        <ChartCard
          title="Gain"
          subtitle="Value less cost at each recorded month"
          chart={notes(
            <BarChart
              ariaLabel="Other assets: gain at each recorded month"
              categories={data.categories}
              series={data.gain}
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
                {
                  id: 'gainRatio',
                  header: 'Gain %',
                  value: (p) => toRatio(p.gainRatio),
                  cell: (p) => <RatioCell ratio={p.gainRatio} loss />,
                  numeric: true,
                },
              ],
              'Other assets: gain',
            ),
          )}
        />
      </GridItem>
    </Grid>
  );
}
