// The Super page's Funds table (stage-4.md §6.4 item 4, D69): Fund · Balance · As of · Receives SG
// · Source · Actions (Edit, Balance history), with a total row (phone: status-first, §6.8). Update
// balances mode wraps it in one form: a shared As of and Note, one balance field per fund, Save
// sends the changed funds only.
import type { SuperFundDto, SuperPageResponse } from '@joinr/schema';
import {
  Amount,
  Button,
  ColumnTable,
  MoneyField,
  formatDate,
  type ColumnTableColumn,
} from '@joinr/ui';
import { History, Pencil } from 'lucide-react';
import { useState, type JSX } from 'react';
import { useSaveSuperBalances } from '../../api/hooks';
import { Missing } from '../../components/QueryStates';
import { plural } from '../../formatting';
import { BalanceCell, SourceCell } from '../cashflow/cells';
import { orderColumns } from '../cashflow/formState';
import { OlderNote, SharedEntryForm } from '../assets/SharedEntryForm';
import { isOlder, olderThanLatest, useSharedEntry } from '../assets/sharedEntry';
import { FirstCell } from '../assets/markers';
import { useTableLayout } from '../assets/layout';
import { fundActionKey } from './superText';

const DESKTOP_ORDER = ['fund', 'balance', 'asOf', 'receivesSg', 'source', 'actions'] as const;
const PHONE_ORDER = ['fund', 'balance', 'asOf', 'actions', 'receivesSg', 'source'] as const;

interface BalanceEdit {
  drafts: Readonly<Record<number, number | null>>;
  asOf: string | null;
  pending: boolean;
  onDraft: (id: number, cents: number | null) => void;
}

function changed(edit: BalanceEdit, fund: SuperFundDto): boolean {
  const draft = edit.drafts[fund.id];
  return draft !== undefined && draft !== null && draft !== fund.balanceCents;
}

interface FundsTableProps {
  page: SuperPageResponse;
  edit: BalanceEdit | null;
  locked: boolean;
  onEdit: (fund: SuperFundDto) => void;
  onHistory: (fund: SuperFundDto) => void;
}

function FundsTable({ page, edit, locked, onEdit, onHistory }: FundsTableProps): JSX.Element {
  const { phone, firstMin } = useTableLayout();
  const all: Record<string, ColumnTableColumn<SuperFundDto>> = {
    fund: {
      id: 'fund',
      header: 'Fund',
      value: (f) => f.name,
      cell: (f) => (
        <FirstCell
          phone={phone}
          markers={[]}
          extra={f.archived ? <span className="jf-app-muted jf-app-small">Archived</span> : null}
        >
          <span>{f.name}</span>
        </FirstCell>
      ),
      minWidth: firstMin(200, 140),
    },
    balance: {
      id: 'balance',
      header: 'Balance',
      value: (f) => f.balanceCents,
      cell: (f) =>
        edit && !f.archived ? (
          <span className="jf-app-balance-edit">
            <MoneyField
              label={`Balance, ${f.name}`}
              labelHidden
              value={edit.drafts[f.id] ?? null}
              onChange={(cents) => edit.onDraft(f.id, cents)}
              disabled={edit.pending}
            />
            {changed(edit, f) && isOlder(edit.asOf, f.balanceAsOf) && f.balanceAsOf ? (
              <OlderNote text={olderThanLatest('balance', f.balanceAsOf)} />
            ) : null}
          </span>
        ) : (
          <BalanceCell cents={f.balanceCents} />
        ),
      numeric: true,
    },
    asOf: {
      id: 'asOf',
      header: 'As of',
      value: (f) => f.balanceAsOf,
      cell: (f) => (f.balanceAsOf ? formatDate(f.balanceAsOf) : <Missing />),
      numeric: true,
    },
    receivesSg: {
      id: 'receivesSg',
      header: 'Receives SG',
      value: (f) => (f.receivesSg ? 'Yes' : 'No'),
      cell: (f) => (f.receivesSg ? 'Yes' : <span className="jf-app-muted">No</span>),
    },
    source: {
      id: 'source',
      header: 'Source',
      value: (f) => f.origin,
      cell: (f) => <SourceCell origin={f.origin} />,
    },
    actions: {
      id: 'actions',
      header: 'Actions',
      value: () => null,
      cell: (f) => (
        <span className="jf-app-row-actions jf-app-row-actions--wrap">
          <Button
            variant="ghost"
            size="sm"
            icon={Pencil}
            aria-label={`Edit ${f.name}`}
            data-cf-action={fundActionKey('edit', f.id)}
            onClick={() => onEdit(f)}
            disabled={locked || edit !== null}
          >
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={History}
            aria-label={`Balance history of ${f.name}`}
            data-cf-action={fundActionKey('history', f.id)}
            onClick={() => onHistory(f)}
            disabled={edit !== null}
          >
            Balance history
          </Button>
        </span>
      ),
    },
  };
  return (
    <div className="jf-app-funds-table">
      <ColumnTable
        columns={orderColumns(all, phone ? PHONE_ORDER : DESKTOP_ORDER)}
        rows={page.funds}
        getRowId={(f) => String(f.id)}
        caption={`Funds: ${plural(page.funds.length, 'fund')}`}
        showCaption
        total={{ label: 'Total', cells: { balance: <Amount cents={page.totalCents} /> } }}
      />
    </div>
  );
}

export interface FundsSectionProps {
  page: SuperPageResponse;
  editingBalances: boolean;
  locked: boolean;
  onEdit: (fund: SuperFundDto) => void;
  onHistory: (fund: SuperFundDto) => void;
  onBalancesDone: (message: string) => void;
  onBalancesCancel: () => void;
}

export function FundsSection({
  page,
  editingBalances,
  locked,
  onEdit,
  onHistory,
  onBalancesDone,
  onBalancesCancel,
}: FundsSectionProps): JSX.Element {
  if (!editingBalances) {
    return (
      <FundsTable page={page} edit={null} locked={locked} onEdit={onEdit} onHistory={onHistory} />
    );
  }
  return (
    <BalancesForm
      page={page}
      onDone={onBalancesDone}
      onCancel={onBalancesCancel}
      renderTable={(edit) => (
        <FundsTable page={page} edit={edit} locked={locked} onEdit={onEdit} onHistory={onHistory} />
      )}
    />
  );
}

function BalancesForm({
  page,
  renderTable,
  onDone,
  onCancel,
}: {
  page: SuperPageResponse;
  renderTable: (edit: BalanceEdit) => JSX.Element;
  onDone: (message: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const state = useSharedEntry();
  const save = useSaveSuperBalances();
  const [drafts, setDrafts] = useState<Record<number, number | null>>(() =>
    Object.fromEntries(page.funds.filter((f) => !f.archived).map((f) => [f.id, f.balanceCents])),
  );
  const edit: BalanceEdit = {
    drafts,
    asOf: state.asOf,
    pending: save.isPending,
    onDraft: (id, cents) => setDrafts((d) => ({ ...d, [id]: cents })),
  };
  const rows = page.funds.filter((f) => !f.archived && changed(edit, f));

  const submit = (): boolean => {
    if (!state.asOf) return false;
    save.mutate(
      {
        asOf: state.asOf,
        entries: rows.map((f) => ({
          fundId: f.id,
          balanceCents: drafts[f.id] ?? f.balanceCents ?? 0,
          ...(state.sharedNote ? { note: state.sharedNote } : {}),
        })),
      },
      { onSuccess: () => onDone('Balances saved'), onError: state.fail },
    );
    return true;
  };

  return (
    <SharedEntryForm
      label="Update balances"
      saveLabel="Save balances"
      state={state}
      pristine={rows.length === 0}
      statusLine={
        rows.length === 0
          ? 'Type the new balances below; only the funds you change are saved.'
          : `${plural(rows.length, 'balance')} changed.`
      }
      workbook={rows.some((f) => f.origin === 'import')}
      pending={save.isPending}
      onSubmit={submit}
      onCancel={onCancel}
    >
      {renderTable(edit)}
    </SharedEntryForm>
  );
}
