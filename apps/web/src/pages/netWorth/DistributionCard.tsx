// "Distribution" (stage-5.md §5, §6.3 item 4, D93): one slice per positive class, up to eight, no
// "Other" fold, in the stack order and each in its class colour. The centre reads "Net worth"
// when everything is drawn, else "Assets shown" with what is left out; a negative class (negative
// property equity) is left out with a note. The table lists every class.
import type { NetWorthPageResponse } from '@joinr/schema';
import {
  Callout,
  ChartCard,
  ColumnTable,
  DonutChart,
  formatMoney,
  moneyFormatter,
  type ColumnTableColumn,
  type Datum,
} from '@joinr/ui';
import { useMemo, type JSX } from 'react';
import { MoneyCell, RatioCell } from '../investments/cells';
import { STACK_LABELS, classColor, isStackClass } from '../history/display';
import { donutCentre, excludedNotes } from './netWorthText';

const dollars = moneyFormatter();

interface ShareRow {
  key: string;
  label: string;
  valueCents: number;
  ratio: string | null;
}

const COLUMNS: ColumnTableColumn<ShareRow>[] = [
  { id: 'class', header: 'Class', value: (row) => row.label, minWidth: 140 },
  {
    id: 'value',
    header: 'Value',
    value: (row) => row.valueCents,
    cell: (row) => <MoneyCell cents={row.valueCents} />,
    numeric: true,
  },
  {
    id: 'share',
    header: 'Share',
    value: (row) => (row.ratio === null ? null : Number(row.ratio)),
    cell: (row) => <RatioCell ratio={row.ratio} />,
    numeric: true,
  },
];

export function DistributionCard({
  page,
  loading,
}: {
  page: NetWorthPageResponse;
  loading: boolean;
}): JSX.Element {
  const { distribution } = page;
  const data = useMemo<Datum[]>(
    () =>
      distribution.slices.flatMap((slice) =>
        isStackClass(slice.key)
          ? [
              {
                label: STACK_LABELS[slice.key],
                value: slice.valueCents / 100,
                color: classColor(slice.key),
              },
            ]
          : [],
      ),
    [distribution.slices],
  );
  const rows: ShareRow[] = distribution.values.map((v) => ({
    key: v.key,
    label: isStackClass(v.key) ? STACK_LABELS[v.key] : v.key,
    valueCents: v.valueCents,
    ratio: distribution.slices.find((s) => s.key === v.key)?.ratio ?? null,
  }));
  const centre = donutCentre(page);
  const notes = excludedNotes(page);
  return (
    <ChartCard
      title="Distribution"
      subtitle="What you own, by class"
      chart={
        <div className="jf-app-block">
          <DonutChart
            ariaLabel="Distribution of net worth by class"
            data={data}
            maxSegments={8}
            valueFormatter={dollars}
            centerLabel={centre.label}
            centerValue={formatMoney(centre.cents, { wholeDollars: true })}
            loading={loading}
            emptyMessage="Nothing to chart yet."
          />
          {centre.footNote ? <p className="jf-app-meta">{centre.footNote}</p> : null}
          {notes.map((note) => (
            <Callout key={note} kind="note" title="Left out of the chart">
              <p>{note}</p>
            </Callout>
          ))}
        </div>
      }
      table={
        <ColumnTable
          columns={COLUMNS}
          rows={rows}
          getRowId={(row) => row.key}
          caption="Distribution"
          total={{
            label: centre.label,
            cells: { value: <MoneyCell cents={centre.cents} loss={false} /> },
          }}
        />
      }
    />
  );
}
