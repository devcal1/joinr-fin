// Balance history (stage-4.md §6.4 item 4, UX-18, D69): one fund's balance entries as a line and a
// table (As of · Balance · Change · Flows in · Transfer in · Gain · Note · Source · Actions; phone:
// status-first). Edit re-saves one entry (its fund and date again, `PUT /api/super/balances`) with
// its transfer in; a fund keeps at least one balance, so its last entry has no Delete.
import type { SuperBalanceEntryDto, SuperFundDto, SuperPageResponse } from '@joinr/schema';
import {
  Button,
  ChartCard,
  ColumnTable,
  Grid,
  GridItem,
  LineChart,
  MoneyField,
  Select,
  TextField,
  compactMoneyFormatter,
  formatDate,
  moneyFormatter,
  type ColumnTableColumn,
  type Series,
} from '@joinr/ui';
import { Pencil, Trash2 } from 'lucide-react';
import { useMemo, useState, type JSX } from 'react';
import { useDeleteSuperBalanceEntry, useSaveSuperBalances } from '../../api/hooks';
import { Missing } from '../../components/QueryStates';
import { BalanceCell, FlowCell, MoneyCell, SourceCell } from '../cashflow/cells';
import {
  DeleteConfirm,
  FormError,
  InlineForm,
  NewAppDataNote,
  WorkbookCallout,
} from '../cashflow/forms';
import { actionSelector, formErrorsOf, orderColumns, useRowDelete } from '../cashflow/formState';
import { toDollars } from '../assets/display';
import { FirstCell } from '../assets/markers';
import { useTableLayout } from '../assets/layout';
import { TRANSFER_HINT, entryActionKey } from './superText';

const DESKTOP_ORDER = [
  'asOf',
  'balance',
  'change',
  'flows',
  'transferIn',
  'gain',
  'note',
  'source',
  'actions',
] as const;
const PHONE_ORDER = [
  'asOf',
  'balance',
  'gain',
  'change',
  'flows',
  'transferIn',
  'note',
  'source',
  'actions',
] as const;

const dollarFormatter = moneyFormatter();

interface HistoryRow extends SuperBalanceEntryDto {
  changeCents: number | null;
}

/** The chosen fund (default: the one with the most entries) and its entries, newest first. */
function historyOf(page: SuperPageResponse, fundId: number | null) {
  const withEntries = page.funds.filter((f) => page.balanceEntries.some((e) => e.fundId === f.id));
  const fallback = [...withEntries].sort((a, b) => b.entryCount - a.entryCount)[0];
  const chosen = withEntries.find((f) => f.id === fundId) ?? fallback ?? null;
  const entries = page.balanceEntries.filter((e) => e.fundId === chosen?.id);
  const ascending = [...entries].reverse();
  const rows: HistoryRow[] = ascending
    .map((entry, i) => ({
      ...entry,
      changeCents: i === 0 ? null : entry.balanceCents - (ascending[i - 1]?.balanceCents ?? 0),
    }))
    .reverse();
  return {
    withEntries,
    chosen,
    rows,
    categories: ascending.map((e) => formatDate(e.asOf)),
    series: [
      { name: 'Balance', data: ascending.map((e) => toDollars(e.balanceCents)) },
    ] satisfies Series[],
  };
}

export interface FundHistoryProps {
  page: SuperPageResponse;
  fundId: number | null;
  onFundChange: (id: number) => void;
  editingEntry: SuperBalanceEntryDto | null;
  locked: boolean;
  onEditEntry: (entry: SuperBalanceEntryDto) => void;
  onEntryDone: (message: string) => void;
  onEntryCancel: () => void;
  onDeleted: (message: string) => void;
}

export function FundHistory({
  page,
  fundId,
  onFundChange,
  editingEntry,
  locked,
  onEditEntry,
  onEntryDone,
  onEntryCancel,
  onDeleted,
}: FundHistoryProps): JSX.Element | null {
  const { phone, firstMin } = useTableLayout();
  const remove = useDeleteSuperBalanceEntry();
  const rowDelete = useRowDelete<number>((id) => actionSelector(entryActionKey('delete', id)));
  const history = useMemo(() => historyOf(page, fundId), [page, fundId]);
  const { withEntries, chosen, rows } = history;
  if (!chosen) return null;
  const onlyEntry = rows.length <= 1;
  const confirming = rows.find((r) => r.id === rowDelete.confirming);

  const all: Record<string, ColumnTableColumn<HistoryRow>> = {
    asOf: {
      id: 'asOf',
      header: 'As of',
      value: (r) => r.asOf,
      cell: (r) => (
        <FirstCell phone={phone} markers={[]}>
          <span className="jf-app-nowrap">{formatDate(r.asOf)}</span>
        </FirstCell>
      ),
      minWidth: firstMin(104),
    },
    balance: {
      id: 'balance',
      header: 'Balance',
      value: (r) => r.balanceCents,
      cell: (r) => <BalanceCell cents={r.balanceCents} />,
      numeric: true,
    },
    change: {
      id: 'change',
      header: 'Change',
      value: (r) => r.changeCents,
      cell: (r) => <FlowCell cents={r.changeCents} />,
      numeric: true,
    },
    flows: {
      id: 'flows',
      header: 'Flows in',
      value: (r) => r.flowsCents,
      cell: (r) => <FlowCell cents={r.flowsCents} />,
      numeric: true,
    },
    transferIn: {
      id: 'transferIn',
      header: 'Transfer in',
      value: (r) => r.transferInCents,
      cell: (r) => <FlowCell cents={r.transferInCents} />,
      numeric: true,
    },
    gain: {
      id: 'gain',
      header: 'Gain',
      value: (r) => r.gainCents,
      cell: (r) => <MoneyCell cents={r.gainCents} loss />,
      numeric: true,
    },
    note: {
      id: 'note',
      header: 'Note',
      value: (r) => r.note,
      cell: (r) => (r.note ? <span className="jf-app-note-cell">{r.note}</span> : <Missing />),
      // Room for a whole 12-letter word, so a note never splits mid-word (768–1199 px, STYLE-3).
      minWidth: 120,
    },
    source: {
      id: 'source',
      header: 'Source',
      value: (r) => r.origin,
      cell: (r) => <SourceCell origin={r.origin} />,
    },
    actions: {
      id: 'actions',
      header: 'Actions',
      value: () => null,
      cell: (r) => {
        const label = `balance of ${formatDate(r.asOf)}`;
        if (rowDelete.confirming === r.id) {
          return (
            <DeleteConfirm
              question={`Delete the ${label}?`}
              label={label}
              busy={remove.isPending}
              onConfirm={() =>
                remove.mutate(r.id, {
                  onSuccess: () => {
                    rowDelete.finish();
                    onDeleted('Balance deleted');
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
              data-cf-action={entryActionKey('edit', r.id)}
              onClick={() => onEditEntry(r)}
              disabled={locked || rowDelete.confirming !== null}
            >
              Edit
            </Button>
            {onlyEntry ? (
              <span className="jf-app-muted">Last balance</span>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                icon={Trash2}
                aria-label={`Delete the ${label}`}
                data-cf-action={entryActionKey('delete', r.id)}
                onClick={() => rowDelete.ask(r.id)}
                disabled={locked || rowDelete.confirming !== null}
              >
                Delete
              </Button>
            )}
          </span>
        );
      },
    },
  };

  const picker = (
    <div className="jf-app-card-select">
      <Select
        label="Fund"
        value={String(chosen.id)}
        onChange={(value) => onFundChange(Number(value))}
        options={withEntries.map((f) => ({ value: String(f.id), label: f.name }))}
      />
    </div>
  );

  const table = (
    <div className="jf-app-block jf-app-fund-history">
      {confirming?.origin === 'import' ? <WorkbookCallout /> : null}
      <FormError message={rowDelete.error} title="Not deleted" />
      <ColumnTable
        columns={orderColumns(all, phone ? PHONE_ORDER : DESKTOP_ORDER)}
        rows={rows}
        getRowId={(r) => String(r.id)}
        caption={`Balance history: ${chosen.name}`}
        emptyMessage="No balances recorded yet."
      />
      {onlyEntry ? <p className="jf-app-meta">A fund keeps at least one balance.</p> : null}
    </div>
  );

  return (
    <>
      <ChartCard
        title="Balance history"
        subtitle={chosen.name}
        actions={picker}
        defaultView={editingEntry ? 'table' : 'chart'}
        chart={
          <LineChart
            ariaLabel={`Balance history of ${chosen.name}`}
            categories={history.categories}
            series={history.series}
            valueFormatter={dollarFormatter}
            axisFormatter={compactMoneyFormatter}
            emptyMessage="No balances recorded yet"
          />
        }
        table={table}
      />
      {editingEntry ? (
        <EntryForm
          key={editingEntry.id}
          entry={editingEntry}
          fund={page.funds.find((f) => f.id === editingEntry.fundId) ?? chosen}
          onDone={onEntryDone}
          onCancel={onEntryCancel}
        />
      ) : null}
    </>
  );
}

type EntryField = 'balanceCents' | 'transferInCents' | 'note';

/** Edit one balance entry: its balance, transfer in and note (the date and fund stay). */
function EntryForm({
  entry,
  fund,
  onDone,
  onCancel,
}: {
  entry: SuperBalanceEntryDto;
  fund: SuperFundDto;
  onDone: (message: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const [balance, setBalance] = useState<number | null>(entry.balanceCents);
  const [transfer, setTransfer] = useState<number | null>(entry.transferInCents);
  const [note, setNote] = useState(entry.note ?? '');
  const [errors, setErrors] = useState<Partial<Record<EntryField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const save = useSaveSuperBalances();
  const pristine =
    balance === entry.balanceCents &&
    transfer === entry.transferInCents &&
    (note.trim() || null) === entry.note;

  const submit = (): boolean => {
    const found: Partial<Record<EntryField, string>> = {};
    if (balance === null) found.balanceCents = 'Enter the balance.';
    if (note.trim().length > 200) found.note = 'Use at most 200 characters.';
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0 || balance === null) return false;
    save.mutate(
      {
        asOf: entry.asOf,
        entries: [
          {
            fundId: entry.fundId,
            balanceCents: balance,
            transferInCents: transfer,
            note: note.trim() || null,
          },
        ],
      },
      {
        onSuccess: () => onDone('Balances saved'),
        onError: (error) => {
          const split = formErrorsOf<EntryField>(
            error,
            ['balanceCents', 'transferInCents', 'note'],
            {
              'entries.0.balanceCents': 'balanceCents',
              'entries.0.transferInCents': 'transferInCents',
              'entries.0.note': 'note',
            },
          );
          setErrors(split.fields);
          setFormError(split.form);
        },
      },
    );
    return true;
  };

  return (
    <InlineForm
      title={`Edit balance · ${fund.name} · ${formatDate(entry.asOf)}`}
      subtitle="Super"
      onSubmit={submit}
      onCancel={onCancel}
      pending={save.isPending}
      pristine={pristine}
      formError={formError}
      notes={entry.origin === 'import' ? <WorkbookCallout /> : <NewAppDataNote />}
    >
      <Grid>
        <GridItem span={4}>
          <MoneyField
            label="Balance"
            value={balance}
            onChange={setBalance}
            required
            error={errors.balanceCents}
            disabled={save.isPending}
          />
        </GridItem>
        <GridItem span={4}>
          <MoneyField
            label="Transfer in"
            value={transfer}
            onChange={setTransfer}
            hint={TRANSFER_HINT}
            error={errors.transferInCents}
            disabled={save.isPending}
          />
        </GridItem>
        <GridItem span={4}>
          <TextField
            label="Note"
            value={note}
            onChange={setNote}
            maxLength={200}
            hint="Optional"
            error={errors.note}
            disabled={save.isPending}
          />
        </GridItem>
      </Grid>
    </InlineForm>
  );
}
