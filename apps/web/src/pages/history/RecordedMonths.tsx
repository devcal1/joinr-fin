// "Recorded months" (stage-5.md §6.4 item 5, D92): newest first; the source markers from the one
// registry (Recorded, Recorded late, Imported) with "Corrected" and its count; months recorded on
// the same day say so; Details, Correct, and Delete on the deletable row only (the latest month
// recorded in the app) with an inline confirm. Details and Correct open as a card directly after
// the table (the Stage 4 editor pattern): focus moves to its heading and returns to the row's
// button on close. Phone: Month, Net worth, Source, Actions, then the rest (§6.8).
import type { HistoryPageResponse, IsoMonth, SnapshotDto } from '@joinr/schema';
import { Button, ColumnTable, formatDate, type ColumnTableColumn } from '@joinr/ui';
import { FileText, Pencil, Trash2 } from 'lucide-react';
import { useCallback, type JSX } from 'react';
import { plural } from '../../formatting';
import { useDeleteSnapshot } from '../../api/hooks';
import { FirstCell, Markers } from '../assets/markers';
import { useTableLayout } from '../assets/layout';
import { SavingsRateCell } from '../cashflow/cells';
import { DeleteConfirm } from '../cashflow/forms';
import { actionSelector, orderColumns, useRowDelete } from '../cashflow/formState';
import { MoneyCell } from '../investments/cells';
import { monthWords, snapshotMarkers } from './display';
import { deleteQuestion, rowActionKey, sharedRunDateText } from './historyText';

export function RecordedMonthsTable({
  page,
  locked,
  onDetails,
  onCorrect,
  onDeleted,
}: {
  page: HistoryPageResponse;
  /** A form is open: the row actions wait. */
  locked: boolean;
  onDetails: (snapshot: SnapshotDto) => void;
  onCorrect: (snapshot: SnapshotDto) => void;
  onDeleted: (message: string) => void;
}): JSX.Element {
  const layout = useTableLayout();
  const remove = useDeleteSnapshot();
  const deleteSelector = useCallback(
    (month: IsoMonth) => actionSelector(rowActionKey('delete', month)),
    [],
  );
  const confirm = useRowDelete<IsoMonth>(deleteSelector);
  const checkNoteId = 'history-rate-check';

  const markersCell = (s: SnapshotDto): JSX.Element => (
    <span className="jf-app-markers">
      <Markers ids={snapshotMarkers(s)} />
      {s.revision > 0 ? (
        <span className="jf-app-meta">{plural(s.revision, 'correction')}</span>
      ) : null}
    </span>
  );

  const all: Record<string, ColumnTableColumn<SnapshotDto>> = {
    month: {
      id: 'month',
      header: 'Month',
      value: (s) => s.periodMonth,
      cell: (s) => {
        const shared = sharedRunDateText(s, page.snapshots);
        return (
          // The Source column shows the markers on every width (third on phone), so the month
          // cell does not repeat them (Fixer round 1, STYLE-4).
          <FirstCell
            markers={[]}
            phone={layout.phone}
            extra={shared ? <span className="jf-app-meta">{shared}</span> : null}
          >
            <span className="jf-app-nowrap">{monthWords(s.periodMonth)}</span>
          </FirstCell>
        );
      },
      // 120 px from 1200 px (150 on phone, 200 on a tablet): with a Delete row the table then fits
      // the 1152 px content area at 1440 px, so the sticky Actions column covers no figure (STYLE-1).
      minWidth: layout.firstMin(120, 150),
    },
    recorded: {
      id: 'recorded',
      header: 'Recorded',
      value: (s) => s.runDate,
      cell: (s) => formatDate(s.runDate),
    },
    source: { id: 'source', header: 'Source', value: (s) => s.source, cell: markersCell },
    netWorth: {
      id: 'netWorth',
      header: 'Net worth',
      value: (s) => s.netWorth.netWorthCents,
      cell: (s) => <MoneyCell cents={s.netWorth.netWorthCents} loss={false} />,
      numeric: true,
    },
    liquid: {
      id: 'liquid',
      header: 'Liquid assets',
      value: (s) => s.netWorth.liquidCents,
      cell: (s) => <MoneyCell cents={s.netWorth.liquidCents} />,
      numeric: true,
    },
    cash: {
      id: 'cash',
      header: 'Cash',
      value: (s) => s.figures.cashValueCents,
      cell: (s) => <MoneyCell cents={s.figures.cashValueCents} />,
      numeric: true,
    },
    super: {
      id: 'super',
      header: 'Super',
      value: (s) => s.figures.superValueCents,
      cell: (s) => <MoneyCell cents={s.figures.superValueCents} />,
      numeric: true,
    },
    equity: {
      id: 'equity',
      header: 'Property equity',
      value: (s) => s.figures.propertyEquityCents,
      cell: (s) => <MoneyCell cents={s.figures.propertyEquityCents} />,
      numeric: true,
    },
    rate: {
      id: 'rate',
      header: 'Savings rate',
      value: (s) => (s.savingsRatio === null ? null : Number(s.savingsRatio)),
      cell: (s) => <SavingsRateCell ratio={s.savingsRatio} checkNoteId={checkNoteId} />,
      numeric: true,
    },
    actions: {
      id: 'actions',
      header: 'Actions',
      value: () => null,
      cell: (s) => {
        const month = monthWords(s.periodMonth);
        if (confirm.confirming === s.periodMonth) {
          return (
            <DeleteConfirm
              question={deleteQuestion(s.periodMonth)}
              label={`recorded month ${month}`}
              busy={remove.isPending}
              onCancel={confirm.cancel}
              onConfirm={() => {
                // mutateAsync: deleting the only recorded month unmounts this table in the refetch,
                // before mutate's per-call callbacks would run; the page still announces it.
                remove.mutateAsync(s.periodMonth).then(() => {
                  confirm.finish();
                  onDeleted(`${month} deleted`);
                }, confirm.fail);
              }}
            />
          );
        }
        return (
          // Details · Correct, then Delete as its own pair: from 768 px the pairs stack, so the
          // sticky Actions column is only as wide as its widest pair and never covers the figures
          // at 1440 px (Fixer round 1, STYLE-1).
          <span className="jf-app-row-actions jf-app-row-actions--pairs">
            <span className="jf-app-row-actions__pair">
              <Button
                variant="ghost"
                size="sm"
                icon={FileText}
                data-cf-action={rowActionKey('details', s.periodMonth)}
                aria-label={`Details of ${month}`}
                onClick={() => onDetails(s)}
                disabled={locked}
              >
                Details
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={Pencil}
                data-cf-action={rowActionKey('correct', s.periodMonth)}
                aria-label={`Correct ${month}`}
                onClick={() => onCorrect(s)}
                disabled={locked}
              >
                Correct
              </Button>
            </span>
            {s.deletable ? (
              <span className="jf-app-row-actions__pair">
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Trash2}
                  data-cf-action={rowActionKey('delete', s.periodMonth)}
                  aria-label={`Delete ${month}`}
                  onClick={() => confirm.ask(s.periodMonth)}
                  disabled={locked}
                >
                  Delete
                </Button>
              </span>
            ) : null}
          </span>
        );
      },
    },
  };
  const order = layout.phone
    ? [
        'month',
        'netWorth',
        'source',
        'actions',
        'recorded',
        'liquid',
        'cash',
        'super',
        'equity',
        'rate',
      ]
    : [
        'month',
        'recorded',
        'source',
        'netWorth',
        'liquid',
        'cash',
        'super',
        'equity',
        'rate',
        'actions',
      ];
  return (
    <div className="jf-app-block jf-app-block--tight">
      <div className="jf-app-compact-table jf-app-wide-table jf-app-history-months">
        <ColumnTable
          columns={orderColumns(all, order)}
          rows={page.snapshots}
          getRowId={(s) => s.periodMonth}
          caption={`Recorded months: ${plural(page.snapshots.length, 'month')}`}
        />
      </div>
      {confirm.error ? (
        <p className="jf-app-error" role="alert">
          {confirm.error}
        </p>
      ) : null}
    </div>
  );
}
