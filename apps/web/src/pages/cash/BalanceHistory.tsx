// Balance history (stage-3.md §6.3 item 3, §5, D58): one account's balance entries as a line and
// a table (As of, Balance, Note, Source, Delete). An account keeps at least one entry, so its last
// entry has no Delete (the server answers 409 LAST_BALANCE_ENTRY otherwise).
import type { CashBalanceEntryDto, CashPageResponse } from '@joinr/schema';
import {
  Button,
  ChartCard,
  ColumnTable,
  LineChart,
  Select,
  compactMoneyFormatter,
  formatDate,
  moneyFormatter,
  type ColumnTableColumn,
  type Series,
} from '@joinr/ui';
import { Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { useDeleteBalanceEntry } from '../../api/hooks';
import { Missing } from '../../components/QueryStates';
import { BalanceCell, SourceCell } from '../cashflow/cells';
import { toDollars } from '../cashflow/display';
import { DeleteConfirm, FormError, WorkbookCallout } from '../cashflow/forms';
import { actionSelector, useRowDelete } from '../cashflow/formState';

const dollarFormatter = moneyFormatter();
const entryDeleteKey = (id: number): string => actionSelector(`entry-delete-${id}`);

export interface BalanceHistoryProps {
  page: CashPageResponse;
  /** The chosen account; null → the account with the most entries. */
  accountId: number | null;
  onAccountChange: (id: number) => void;
}

/** The accounts with entries, the chosen one (default: the most entries) and its history. */
function historyOf(page: CashPageResponse, accountId: number | null) {
  const withEntries = page.accounts.filter((a) =>
    page.entries.some((entry) => entry.accountId === a.id),
  );
  const fallback = [...withEntries].sort((a, b) => b.entryCount - a.entryCount)[0];
  const chosen =
    withEntries.find((a) => a.id === accountId) ?? fallback ?? page.accounts[0] ?? null;
  const entries = page.entries.filter((entry) => entry.accountId === chosen?.id);
  const ascending = [...entries].reverse();
  return {
    withEntries,
    chosen,
    entries,
    categories: ascending.map((entry) => formatDate(entry.asOf)),
    series: [
      { name: 'Balance', data: ascending.map((entry) => toDollars(entry.balanceCents)) },
    ] satisfies Series[],
  };
}

export function BalanceHistory({ page, accountId, onAccountChange }: BalanceHistoryProps) {
  const remove = useDeleteBalanceEntry();
  const rowDelete = useRowDelete<number>(entryDeleteKey);
  // Memoised on the page and the choice, so the chart only redraws when its data changes.
  const history = useMemo(() => historyOf(page, accountId), [page, accountId]);
  const { withEntries, chosen, entries } = history;
  const chart = history;

  if (!chosen) return null;
  const onlyEntry = entries.length <= 1;
  const confirmingEntry = entries.find((entry) => entry.id === rowDelete.confirming);

  const columns: ColumnTableColumn<CashBalanceEntryDto>[] = [
    {
      id: 'asOf',
      header: 'As of',
      value: (entry) => entry.asOf,
      cell: (entry) => formatDate(entry.asOf),
      numeric: true,
      minWidth: 104,
    },
    {
      id: 'balance',
      header: 'Balance',
      value: (entry) => entry.balanceCents,
      cell: (entry) => <BalanceCell cents={entry.balanceCents} />,
      numeric: true,
    },
    {
      id: 'note',
      header: 'Note',
      value: (entry) => entry.note,
      cell: (entry) => (entry.note ? entry.note : <Missing />),
    },
    {
      id: 'source',
      header: 'Source',
      value: (entry) => entry.origin,
      cell: (entry) => <SourceCell origin={entry.origin} />,
    },
    {
      id: 'actions',
      header: 'Actions',
      value: () => null,
      cell: (entry) => {
        const label = `balance of ${formatDate(entry.asOf)}`;
        if (rowDelete.confirming === entry.id) {
          return (
            <DeleteConfirm
              question={`Delete the ${label}?`}
              label={label}
              busy={remove.isPending}
              onConfirm={() =>
                remove.mutate(entry.id, { onSuccess: rowDelete.finish, onError: rowDelete.fail })
              }
              onCancel={rowDelete.cancel}
            />
          );
        }
        if (onlyEntry) return <span className="jf-app-muted">Last balance</span>;
        return (
          <Button
            variant="ghost"
            size="sm"
            icon={Trash2}
            aria-label={`Delete the ${label}`}
            data-cf-action={`entry-delete-${entry.id}`}
            onClick={() => rowDelete.ask(entry.id)}
            disabled={rowDelete.confirming !== null}
          >
            Delete
          </Button>
        );
      },
    },
  ];

  const picker = (
    <div className="jf-app-card-select">
      <Select
        label="Account"
        value={String(chosen.id)}
        onChange={(value) => onAccountChange(Number(value))}
        options={withEntries.map((a) => ({ value: String(a.id), label: a.name }))}
      />
    </div>
  );

  const table = (
    <div className="jf-app-block">
      {confirmingEntry?.origin === 'import' ? <WorkbookCallout /> : null}
      <FormError message={rowDelete.error} title="Not deleted" />
      <ColumnTable
        columns={columns}
        rows={entries}
        getRowId={(entry) => String(entry.id)}
        caption={`Balance history: ${chosen.name}`}
        emptyMessage="No balances recorded yet."
      />
      {onlyEntry ? <p className="jf-app-meta">An account keeps at least one balance.</p> : null}
    </div>
  );

  return (
    <ChartCard
      title="Balance history"
      subtitle={chosen.name}
      actions={picker}
      chart={
        <LineChart
          ariaLabel={`Balance history of ${chosen.name}`}
          categories={chart.categories}
          series={chart.series}
          valueFormatter={dollarFormatter}
          axisFormatter={compactMoneyFormatter}
          emptyMessage="No balances recorded yet"
        />
      }
      table={table}
    />
  );
}
