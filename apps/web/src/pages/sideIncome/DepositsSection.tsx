// The Side Income page's deposits (stage-3.md §6.4 item 4, §6.9): Stream and FY filters and the
// ledger (newest first) with Edit and Delete; a deposit is a flow, so a reversal stays in body
// text (D33).
import {
  financialYearOfIso,
  type SideIncomeDepositDto,
  type SideIncomePageResponse,
} from '@joinr/schema';
import {
  Button,
  Cluster,
  ColumnTable,
  MEDIA,
  Select,
  formatDate,
  formatFinancialYear,
  useMediaQuery,
  type ColumnTableColumn,
  type SelectOption,
} from '@joinr/ui';
import { Pencil, Trash2 } from 'lucide-react';
import { useState, type JSX } from 'react';
import { useDeleteDeposit } from '../../api/hooks';
import { Missing } from '../../components/QueryStates';
import { plural } from '../../formatting';
import { FlowCell, SourceCell } from '../cashflow/cells';
import { periodLabel } from '../cashflow/display';
import { DeleteConfirm, FormError, WorkbookCallout } from '../cashflow/forms';
import { actionSelector, orderColumns, useRowDelete } from '../cashflow/formState';
import { depositActionKey } from './sideIncomeEditor';

const DESKTOP_ORDER = ['date', 'stream', 'amount', 'period', 'note', 'source', 'actions'] as const;
const PHONE_ORDER = ['date', 'amount', 'stream', 'note', 'actions', 'period', 'source'] as const;

const deleteSelector = (id: number): string => actionSelector(depositActionKey('delete', id));

function periodText(deposit: SideIncomeDepositDto, page: SideIncomePageResponse): JSX.Element {
  if (deposit.periodMonth === null) {
    const before = page.lastRun === null || deposit.date <= page.lastRun;
    return (
      <span className="jf-app-muted">
        {before ? 'Before the first recorded month' : 'After today'}
      </span>
    );
  }
  return (
    <span className="jf-app-nowrap">
      {periodLabel(deposit.periodMonth)}
      {deposit.provisional ? <span className="jf-app-muted"> (provisional)</span> : null}
    </span>
  );
}

export interface DepositsSectionProps {
  page: SideIncomePageResponse;
  locked: boolean;
  onEdit: (deposit: SideIncomeDepositDto) => void;
  onDeleted: (message: string) => void;
}

export function DepositsSection({ page, locked, onEdit, onDeleted }: DepositsSectionProps) {
  const phone = useMediaQuery(MEDIA.phone);
  const [stream, setStream] = useState('all');
  const [year, setYear] = useState('all');
  const remove = useDeleteDeposit();
  const rowDelete = useRowDelete<number>(deleteSelector);
  const deposits = page.deposits;

  const years = [...new Set(deposits.map((d) => financialYearOfIso(d.date)))].sort((a, b) => b - a);
  const streamOptions: SelectOption[] = [
    { value: 'all', label: 'All streams' },
    ...page.streams.map((s) => ({ value: String(s.id), label: s.name })),
  ];
  const yearOptions: SelectOption[] = [
    { value: 'all', label: 'All years' },
    ...years.map((y) => ({ value: String(y), label: formatFinancialYear(y) })),
  ];
  const rows = deposits.filter(
    (d) =>
      (stream === 'all' || String(d.streamId) === stream) &&
      (year === 'all' || String(financialYearOfIso(d.date)) === year),
  );
  const confirming = deposits.find((d) => d.id === rowDelete.confirming);

  const all: Record<string, ColumnTableColumn<SideIncomeDepositDto>> = {
    date: {
      id: 'date',
      header: 'Date',
      value: (d) => d.date,
      cell: (d) => formatDate(d.date),
      numeric: true,
      minWidth: 104,
    },
    stream: { id: 'stream', header: 'Stream', value: (d) => d.streamName },
    amount: {
      id: 'amount',
      header: 'Amount',
      value: (d) => d.amountCents,
      cell: (d) => <FlowCell cents={d.amountCents} />,
      numeric: true,
    },
    period: {
      id: 'period',
      header: 'Period',
      value: (d) => d.periodMonth,
      cell: (d) => periodText(d, page),
    },
    note: {
      id: 'note',
      header: 'Note',
      value: (d) => d.note,
      cell: (d) => (d.note ? d.note : <Missing />),
    },
    source: {
      id: 'source',
      header: 'Source',
      value: (d) => d.origin,
      cell: (d) => <SourceCell origin={d.origin} />,
    },
    actions: {
      id: 'actions',
      header: 'Actions',
      value: () => null,
      cell: (d) => {
        const label = `deposit of ${formatDate(d.date)} (${d.streamName})`;
        if (rowDelete.confirming === d.id) {
          return (
            <DeleteConfirm
              question={`Delete the ${label}?`}
              label={label}
              busy={remove.isPending}
              onConfirm={() =>
                remove.mutate(d.id, {
                  onSuccess: () => {
                    rowDelete.finish();
                    onDeleted('Deposit deleted');
                  },
                  onError: rowDelete.fail,
                })
              }
              onCancel={rowDelete.cancel}
            />
          );
        }
        return (
          <span className="jf-app-row-actions">
            <Button
              variant="ghost"
              size="sm"
              icon={Pencil}
              aria-label={`Edit the ${label}`}
              data-cf-action={depositActionKey('edit', d.id)}
              onClick={() => onEdit(d)}
              disabled={locked || rowDelete.confirming !== null}
            >
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={Trash2}
              aria-label={`Delete the ${label}`}
              data-cf-action={depositActionKey('delete', d.id)}
              onClick={() => rowDelete.ask(d.id)}
              disabled={locked || rowDelete.confirming !== null}
            >
              Delete
            </Button>
          </span>
        );
      },
    },
  };

  return (
    <>
      {deposits.length > 0 ? (
        <Cluster gap={4} align="end" className="jf-app-filters">
          <div className="jf-app-filters__section">
            <Select label="Stream" value={stream} onChange={setStream} options={streamOptions} />
          </div>
          <div className="jf-app-filters__section">
            <Select label="Financial year" value={year} onChange={setYear} options={yearOptions} />
          </div>
        </Cluster>
      ) : null}
      {confirming?.origin === 'import' ? <WorkbookCallout /> : null}
      <FormError message={rowDelete.error} title="Not deleted" />
      <div className="jf-app-compact-table">
        <ColumnTable
          columns={orderColumns(all, phone ? PHONE_ORDER : DESKTOP_ORDER)}
          rows={rows}
          getRowId={(d) => String(d.id)}
          caption={`Deposits: ${plural(rows.length, 'deposit')}`}
          showCaption
          emptyMessage={
            deposits.length === 0 ? 'No side income yet.' : 'No deposits match the filters.'
          }
        />
      </div>
    </>
  );
}
