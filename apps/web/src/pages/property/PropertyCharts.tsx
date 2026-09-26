// Property value over time (stage-4.md §5, §6.5 item 6, UX-18, UX-21): "Value and purchase price"
// (two unstacked lines: Value slot 1, Purchase price slot 2) and "Loan to value" (one line). Past
// points come from the recorded months (gross: snapshots hold no offsets); the live point is net of
// the linked offsets, and the foot note says so when offsets exist.
import type { PropertyChartPointDto } from '@joinr/schema';
import {
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
import { MoneyCell, RatioCell } from '../cashflow/cells';
import { NO_HISTORY_NOTE, chartCategory, toDollars, toRatio } from '../assets/display';
import { OFFSET_POINTS_NOTE, PAST_POINTS_NOTE, VALUE_SERIES } from './propertyText';

const dollarFormatter = moneyFormatter();
const NO_POINTS = 'No history yet';

const periodColumn: ColumnTableColumn<PropertyChartPointDto> = {
  id: 'period',
  header: 'Period',
  value: (p) => p.period,
  cell: (p) => chartCategory(p),
  minWidth: 120,
};

export function PropertyCharts({
  points,
  hasOffsets,
}: {
  points: readonly PropertyChartPointDto[];
  hasOffsets: boolean;
}): JSX.Element {
  const recorded = points.some((p) => !p.live);
  const data = useMemo(() => {
    const categories = points.map(chartCategory);
    const value: Series[] = [
      {
        name: VALUE_SERIES[0].name,
        data: points.map((p) => toDollars(p.valueCents)),
        color: VALUE_SERIES[0].color,
      },
      {
        name: VALUE_SERIES[1].name,
        data: points.map((p) => toDollars(p.purchaseCents)),
        color: VALUE_SERIES[1].color,
      },
    ];
    const lvr: Series[] = [{ name: 'Loan to value', data: points.map((p) => toRatio(p.lvrRatio)) }];
    return { categories, value, lvr };
  }, [points]);

  const notes = (content: ReactNode, offsets = false): JSX.Element => (
    <div className="jf-app-block">
      {content}
      {recorded ? (
        <p className="jf-app-meta">{PAST_POINTS_NOTE}</p>
      ) : (
        <p className="jf-app-meta">{NO_HISTORY_NOTE}</p>
      )}
      {offsets && hasOffsets ? <p className="jf-app-meta">{OFFSET_POINTS_NOTE}</p> : null}
    </div>
  );

  return (
    <Grid>
      <GridItem span={6}>
        <ChartCard
          title="Value and purchase price"
          subtitle="The properties’ value against what you paid"
          chart={notes(
            <LineChart
              ariaLabel="Property value and purchase price at each recorded month"
              categories={data.categories}
              series={data.value}
              valueFormatter={dollarFormatter}
              axisFormatter={compactMoneyFormatter}
              emptyMessage={NO_POINTS}
            />,
          )}
          table={notes(
            <ColumnTable
              columns={[
                periodColumn,
                {
                  id: 'value',
                  header: 'Value',
                  value: (p) => p.valueCents,
                  cell: (p) => <MoneyCell cents={p.valueCents} loss={false} />,
                  numeric: true,
                },
                {
                  id: 'purchase',
                  header: 'Purchase price',
                  value: (p) => p.purchaseCents,
                  cell: (p) => <MoneyCell cents={p.purchaseCents} loss={false} />,
                  numeric: true,
                },
                {
                  id: 'equity',
                  header: 'Equity',
                  value: (p) => p.equityCents,
                  cell: (p) => <MoneyCell cents={p.equityCents} loss />,
                  numeric: true,
                },
              ]}
              rows={points}
              getRowId={(p) => p.period}
              caption="Property value and purchase price"
              emptyMessage={NO_POINTS}
            />,
          )}
        />
      </GridItem>
      <GridItem span={6}>
        <ChartCard
          title="Loan to value"
          subtitle="The mortgage as a share of the value"
          chart={notes(
            <LineChart
              ariaLabel="Loan to value at each recorded month"
              categories={data.categories}
              series={data.lvr}
              valueFormatter={percentFormatter}
              emptyMessage={NO_POINTS}
            />,
            true,
          )}
          table={notes(
            <ColumnTable
              columns={[
                periodColumn,
                {
                  id: 'lvr',
                  header: 'Loan to value',
                  value: (p) => toRatio(p.lvrRatio),
                  cell: (p) => <RatioCell ratio={p.lvrRatio} />,
                  numeric: true,
                },
                {
                  id: 'mortgage',
                  header: 'Mortgage',
                  value: (p) => p.mortgageCents,
                  cell: (p) => <MoneyCell cents={p.mortgageCents} loss={false} />,
                  numeric: true,
                },
              ]}
              rows={points}
              getRowId={(p) => p.period}
              caption="Loan to value"
              emptyMessage={NO_POINTS}
            />,
            true,
          )}
        />
      </GridItem>
    </Grid>
  );
}
