// History (stage-2.md §5, §6.3 item 6): market value against contributions, gain ($ or %) and
// net purchases, each with a table twin. The live point's label ends in " (live)".
import type { InvestmentChartPointDto, InvestmentPageResponse } from '@joinr/schema';
import {
  AreaChart,
  BarChart,
  Button,
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
import { useMemo, useState, type JSX, type ReactNode } from 'react';
import { MoneyCell, RatioCell } from './cells';
import { LIVE_POINT_NOTE, chartCategory, unpricedLivePointNote } from './display';
import { KIND_META } from './kinds';

export const NO_HISTORY = 'No history yet';
export const GAIN_RATIO_NOTE =
  'Gain % is gain ÷ (value − gain), as the monthly snapshots record it, so it differs slightly from the holdings table’s return on cost.';

const dollarFormatter = moneyFormatter();
const toDollars = (cents: number | null): number | null => (cents === null ? null : cents / 100);

const periodColumn: ColumnTableColumn<InvestmentChartPointDto> = {
  id: 'period',
  header: 'Period',
  value: (point) => point.period,
  cell: (point) => chartCategory(point),
  minWidth: 120,
};

/**
 * A chart (or its table) with its notes. `liveExtra` qualifies the live point: the Value and Gain
 * cards say when holdings without a price are left out of it (the summary leaves them out, §5).
 */
function withNote(
  content: ReactNode,
  live: boolean,
  extra?: string,
  liveExtra?: string | null,
): JSX.Element {
  return (
    <div className="jf-app-block">
      {content}
      {extra ? <p className="jf-app-meta">{extra}</p> : null}
      {live ? <p className="jf-app-meta">{LIVE_POINT_NOTE}</p> : null}
      {live && liveExtra ? <p className="jf-app-meta">{liveExtra}</p> : null}
    </div>
  );
}

export function HistoryCharts({ page }: { page: InvestmentPageResponse }): JSX.Element {
  const meta = KIND_META[page.kind];
  const points = page.charts.points;
  const live = points.some((point) => point.live);
  // The live point takes the summary's value and gain, which leave unpriced holdings out.
  const unpricedNote = unpricedLivePointNote(page.summary.unpricedCount);
  const [gainMode, setGainMode] = useState<'money' | 'ratio'>('money');

  const series = useMemo(() => {
    const categories = points.map(chartCategory);
    const value: Series[] = [
      { name: 'Market value', data: points.map((p) => toDollars(p.valueCents)) },
      { name: 'Contributions', data: points.map((p) => toDollars(p.contributionsCents)) },
    ];
    const gainMoney: Series[] = [{ name: 'Gain', data: points.map((p) => toDollars(p.gainCents)) }];
    const gainRatio: Series[] = [
      {
        name: 'Gain %',
        data: points.map((p) => (p.gainRatio === null ? null : Number(p.gainRatio))),
      },
    ];
    const purchases: Series[] = [
      { name: 'Net purchases', data: points.map((p) => toDollars(p.netPurchasesCents)) },
    ];
    return { categories, value, gainMoney, gainRatio, purchases };
  }, [points]);

  const table = (columns: ColumnTableColumn<InvestmentChartPointDto>[], caption: string) => (
    <ColumnTable
      columns={[periodColumn, ...columns]}
      rows={points}
      getRowId={(point) => point.period}
      caption={caption}
      emptyMessage={NO_HISTORY}
    />
  );

  const gainSwitch = (
    <div className="jf-app-segmented" role="group" aria-label="Gain: show as">
      {(['money', 'ratio'] as const).map((mode) => (
        <Button
          key={mode}
          size="sm"
          variant={gainMode === mode ? 'secondary' : 'ghost'}
          aria-pressed={gainMode === mode}
          onClick={() => setGainMode(mode)}
        >
          {mode === 'money' ? '$' : '%'}
        </Button>
      ))}
    </div>
  );

  return (
    <Grid>
      <GridItem span={12}>
        <ChartCard
          title="Value"
          subtitle="Market value against contributions"
          chart={withNote(
            <AreaChart
              ariaLabel={`${meta.title}: market value against contributions`}
              categories={series.categories}
              series={series.value}
              valueFormatter={dollarFormatter}
              axisFormatter={compactMoneyFormatter}
              emptyMessage={NO_HISTORY}
            />,
            live,
            undefined,
            unpricedNote,
          )}
          table={withNote(
            table(
              [
                {
                  id: 'value',
                  header: 'Market value',
                  value: (p) => p.valueCents,
                  cell: (p) => <MoneyCell cents={p.valueCents} />,
                  numeric: true,
                },
                {
                  id: 'contributions',
                  header: 'Contributions',
                  value: (p) => p.contributionsCents,
                  cell: (p) => <MoneyCell cents={p.contributionsCents} loss={false} />,
                  numeric: true,
                },
              ],
              `${meta.title}: market value and contributions`,
            ),
            live,
            undefined,
            unpricedNote,
          )}
        />
      </GridItem>
      <GridItem span={6}>
        <ChartCard
          title="Gain"
          subtitle={gainMode === 'money' ? 'Gain in dollars' : 'Gain as a percentage'}
          actions={gainSwitch}
          chart={withNote(
            gainMode === 'money' ? (
              <LineChart
                ariaLabel={`${meta.title}: gain in dollars`}
                categories={series.categories}
                series={series.gainMoney}
                valueFormatter={dollarFormatter}
                axisFormatter={compactMoneyFormatter}
                emptyMessage={NO_HISTORY}
              />
            ) : (
              <LineChart
                ariaLabel={`${meta.title}: gain as a percentage`}
                categories={series.categories}
                series={series.gainRatio}
                valueFormatter={percentFormatter}
                emptyMessage={NO_HISTORY}
              />
            ),
            live,
            GAIN_RATIO_NOTE,
            unpricedNote,
          )}
          table={withNote(
            table(
              [
                {
                  id: 'gain',
                  header: 'Gain',
                  value: (p) => p.gainCents,
                  cell: (p) => <MoneyCell cents={p.gainCents} />,
                  numeric: true,
                },
                {
                  id: 'gainRatio',
                  header: 'Gain %',
                  value: (p) => (p.gainRatio === null ? null : Number(p.gainRatio)),
                  cell: (p) => <RatioCell ratio={p.gainRatio} loss />,
                  numeric: true,
                },
              ],
              `${meta.title}: gain`,
            ),
            live,
            GAIN_RATIO_NOTE,
            unpricedNote,
          )}
        />
      </GridItem>
      <GridItem span={6}>
        <ChartCard
          title="Net purchases"
          subtitle="Buys less sells, per period"
          chart={withNote(
            // One series in chart teal and no sign colours: a net-sell month is not a loss (D33).
            <BarChart
              ariaLabel={`${meta.title}: net purchases per period`}
              categories={series.categories}
              series={series.purchases}
              valueFormatter={dollarFormatter}
              axisFormatter={compactMoneyFormatter}
              emptyMessage={NO_HISTORY}
            />,
            live,
          )}
          table={withNote(
            table(
              [
                {
                  id: 'netPurchases',
                  header: 'Net purchases',
                  value: (p) => p.netPurchasesCents,
                  cell: (p) => <MoneyCell cents={p.netPurchasesCents} loss={false} />,
                  numeric: true,
                },
              ],
              `${meta.title}: net purchases`,
            ),
            live,
          )}
        />
      </GridItem>
    </Grid>
  );
}
