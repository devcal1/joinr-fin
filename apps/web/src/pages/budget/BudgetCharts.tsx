// The Budget page's charts (stage-3.md §6.5 item 7, §5): donuts "By item" and "By category" (no
// target ring, the monthly total in the centre; past six slices fold into "Other") and the
// planned vs actual spend bars with the Adjusted | Raw switch. Each has its table twin.
import type { BudgetPageResponse } from '@joinr/schema';
import {
  BarChart,
  Button,
  ChartCard,
  ColumnTable,
  DonutChart,
  Grid,
  GridItem,
  compactMoneyFormatter,
  formatMoney,
  moneyFormatter,
  type Datum,
  type Series,
} from '@joinr/ui';
import { useMemo, useState, type JSX } from 'react';
import { FlowCell } from '../cashflow/cells';
import { rowLabel } from './budgetModel';

const dollarFormatter = moneyFormatter();

interface Slice {
  key: string;
  label: string;
  cents: number;
}

function SliceTable({ rows, caption, header }: { rows: Slice[]; caption: string; header: string }) {
  return (
    <ColumnTable
      columns={[
        { id: 'label', header, value: (s: Slice) => s.label },
        {
          id: 'monthly',
          header: 'Monthly',
          value: (s: Slice) => s.cents,
          cell: (s: Slice) => <FlowCell cents={s.cents} />,
          numeric: true,
        },
      ]}
      rows={rows}
      getRowId={(s) => s.key}
      caption={caption}
      emptyMessage="Nothing budgeted yet."
    />
  );
}

export function BudgetCharts({ page }: { page: BudgetPageResponse }): JSX.Element {
  const [actualView, setActualView] = useState<'adjusted' | 'raw'>('adjusted');
  const data = useMemo(() => {
    const items: Slice[] = page.rows
      .filter((row) => row.monthlyCents > 0)
      .map((row) => ({
        key: row.id === null ? row.kind : String(row.id),
        label: rowLabel(row),
        cents: row.monthlyCents,
      }))
      .sort((a, b) => b.cents - a.cents);
    const categories: Slice[] = page.byCategory.map((c, index) => ({
      key: `${index}-${c.category ?? ''}`,
      label: c.category ?? 'No category',
      cents: c.monthlyCents,
    }));
    const toData = (slices: Slice[]): Datum[] =>
      slices.map((s) => ({ label: s.label, value: s.cents / 100 }));
    const total = items.reduce((sum, s) => sum + s.cents, 0);
    return { items, categories, itemData: toData(items), categoryData: toData(categories), total };
  }, [page.rows, page.byCategory]);

  const actualCents = actualView === 'raw' ? page.actual.actualRawCents : page.actual.actualCents;
  const planned = page.actual.plannedCents;
  const pair = useMemo(() => {
    const series: Series[] = [
      {
        name: 'Monthly spend',
        data: [planned / 100, actualCents === null ? null : actualCents / 100],
      },
    ];
    return { categories: ['Planned spend', 'Actual spend (6-month average)'], series };
  }, [planned, actualCents]);

  const viewSwitch = (
    <div className="jf-app-segmented" role="group" aria-label="Actual spend: show as">
      {(['adjusted', 'raw'] as const).map((view) => (
        <Button
          key={view}
          size="sm"
          variant={actualView === view ? 'secondary' : 'ghost'}
          aria-pressed={actualView === view}
          onClick={() => setActualView(view)}
        >
          {view === 'adjusted' ? 'Adjusted' : 'Raw'}
        </Button>
      ))}
    </div>
  );
  const centre = formatMoney(data.total, { wholeDollars: true });

  return (
    <Grid>
      <GridItem span={6}>
        <ChartCard
          title="By item"
          subtitle="Monthly, every budget row"
          chart={
            <DonutChart
              ariaLabel="Monthly budget by item"
              data={data.itemData}
              valueFormatter={dollarFormatter}
              centerLabel="Monthly"
              centerValue={centre}
              emptyMessage="Nothing budgeted yet"
            />
          }
          table={<SliceTable rows={data.items} caption="Monthly budget by item" header="Item" />}
        />
      </GridItem>
      <GridItem span={6}>
        <ChartCard
          title="By category"
          subtitle="Monthly, every budget row"
          chart={
            <DonutChart
              ariaLabel="Monthly budget by category"
              data={data.categoryData}
              valueFormatter={dollarFormatter}
              centerLabel="Monthly"
              centerValue={centre}
              emptyMessage="Nothing budgeted yet"
            />
          }
          table={
            <SliceTable
              rows={data.categories}
              caption="Monthly budget by category"
              header="Category"
            />
          }
        />
      </GridItem>
      <GridItem span={12}>
        <ChartCard
          title="Planned vs actual spend"
          subtitle={
            actualView === 'raw'
              ? 'Actual spend as the sheet computes it'
              : 'Actual spend after one-off adjustments'
          }
          actions={viewSwitch}
          chart={
            <div className="jf-app-block">
              <BarChart
                ariaLabel="Planned spend against the actual 6-month average spend"
                categories={pair.categories}
                series={pair.series}
                valueFormatter={dollarFormatter}
                axisFormatter={compactMoneyFormatter}
                emptyMessage="Nothing budgeted yet"
              />
              {actualCents === null ? (
                <p className="jf-app-meta">Actual spend needs recorded months.</p>
              ) : null}
            </div>
          }
          table={
            <SliceTable
              rows={[
                { key: 'planned', label: 'Planned spend', cents: planned },
                ...(actualCents === null
                  ? []
                  : [
                      {
                        key: 'actual',
                        label: 'Actual spend (6-month average)',
                        cents: actualCents,
                      },
                    ]),
              ]}
              caption="Planned vs actual spend"
              header="Spend"
            />
          }
        />
      </GridItem>
    </Grid>
  );
}
