// "Consistency check" (stage-5.md §2.5, §6.4 item 7, the PLAN acceptance): the headline counts
// derived figures only ("Every stored figure reproduces (6 of 6 imported months)"); movement
// differences are information, never failures; a derived difference, never expected, asks to be
// reported (a correction of any figure re-derives the row anyway). Phone: Month, Column, Stored,
// Recomputed, Why (§6.8).
import type { HistoryPageResponse, IsoMonth, SnapshotDifferenceDto } from '@joinr/schema';
import { Callout, ColumnTable, SectionBar, type ColumnTableColumn } from '@joinr/ui';
import type { JSX } from 'react';
import { monthWords } from './display';
import {
  consistencyHeadline,
  derivedDifferenceText,
  differenceColumn,
  differenceValue,
  differenceWhy,
  movementText,
} from './historyText';

interface DifferenceRow extends SnapshotDifferenceDto {
  periodMonth: IsoMonth;
}

const COLUMNS: ColumnTableColumn<DifferenceRow>[] = [
  {
    id: 'month',
    header: 'Month',
    value: (d) => d.periodMonth,
    cell: (d) => monthWords(d.periodMonth),
    minWidth: 110,
  },
  { id: 'column', header: 'Column', value: differenceColumn, minWidth: 150 },
  { id: 'stored', header: 'Stored', value: (d) => differenceValue(d, 'stored'), numeric: true },
  {
    id: 'recomputed',
    header: 'Recomputed',
    value: (d) => differenceValue(d, 'recomputed'),
    numeric: true,
  },
  {
    id: 'why',
    header: 'Why',
    value: differenceWhy,
    cell: (d) => <span className="jf-app-note-cell">{differenceWhy(d)}</span>,
    minWidth: 200,
  },
];

export function ConsistencySection({ page }: { page: HistoryPageResponse }): JSX.Element {
  const { consistency } = page;
  const rows: DifferenceRow[] = page.snapshots.flatMap((s) =>
    s.check.differences.map((d) => ({ ...d, periodMonth: s.periodMonth })),
  );
  const movement = movementText(consistency.movementMonths);
  const derivedMonths = [
    ...new Set(rows.filter((d) => d.kind === 'derived').map((d) => d.periodMonth)),
  ];
  return (
    <section className="jf-app-block" aria-labelledby="history-consistency-heading">
      <SectionBar id="history-consistency-heading" title="Consistency check" role="reference" />
      <p className="jf-app-strong" data-testid="consistency-headline">
        {consistencyHeadline(consistency)}
      </p>
      {derivedMonths.map((month) => (
        <Callout key={month} kind="important" title="Stored figure differs">
          <p>{derivedDifferenceText(month)}</p>
        </Callout>
      ))}
      {movement ? (
        <p className="jf-app-meta" data-testid="consistency-movements">
          {movement}
        </p>
      ) : null}
      {rows.length > 0 ? (
        <ColumnTable
          columns={COLUMNS}
          rows={rows}
          getRowId={(d) => `${d.periodMonth}-${d.column}`}
          caption="Consistency differences"
        />
      ) : null}
    </section>
  );
}
