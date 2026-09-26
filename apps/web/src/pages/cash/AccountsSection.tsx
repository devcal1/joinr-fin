// The Cash page's Accounts section (stage-3.md §6.3 item 3, D58, D59): one table per kind group
// (offsets last) with white bold subtotals, the totals table, the Update balances mode (one form
// around every group: a shared as-of date and note, the Balance cells become money fields, Save
// sends the changed rows only) and the balance history card.
import type { CashAccountDto, CashPageResponse, IsoDate } from '@joinr/schema';
import {
  Amount,
  Button,
  Callout,
  Cluster,
  ColumnTable,
  DateField,
  Grid,
  GridItem,
  KeyValueTable,
  MEDIA,
  MoneyField,
  TextField,
  formatDate,
  toIsoDate,
  useMediaQuery,
  type ColumnTableColumn,
} from '@joinr/ui';
import { Link } from '@tanstack/react-router';
import { History, Pencil, Save } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';
import { useSaveBalances } from '../../api/hooks';
import { Missing } from '../../components/QueryStates';
import { plural } from '../../formatting';
import { BalanceCell, SourceCell } from '../cashflow/cells';
import {
  ACCOUNT_GROUPS,
  accountGroupOf,
  sumCents,
  tomorrowOf,
  type AccountGroupId,
} from '../cashflow/display';
import { FormError, NewAppDataNote, WorkbookCallout } from '../cashflow/forms';
import { formErrorsOf, orderColumns } from '../cashflow/formState';
import { BalanceHistory } from './BalanceHistory';
import { accountActionKey, olderNote } from './cashText';

export const NO_ACCOUNTS = 'No cash accounts yet. Add one, or import the workbook on the';
export const NOT_IN_FUND = 'Not in the emergency fund';

const DESKTOP_ORDER = ['account', 'balance', 'asOf', 'source', 'actions'] as const;
const PHONE_ORDER = ['account', 'balance', 'asOf', 'actions', 'source'] as const;

/** Accounts of one group, in the DTO's order (kind order, offsets last, then sort order). */
function groupsOf(accounts: readonly CashAccountDto[]) {
  return ACCOUNT_GROUPS.map((group) => ({
    ...group,
    accounts: accounts.filter((a) => accountGroupOf(a) === group.id),
  })).filter((group) => group.accounts.length > 0);
}

interface BalanceEdit {
  drafts: Readonly<Record<number, number | null>>;
  asOf: IsoDate | null;
  pending: boolean;
  onDraft: (id: number, cents: number | null) => void;
}

interface GroupTableProps {
  id: AccountGroupId;
  title: string;
  accounts: readonly CashAccountDto[];
  edit: BalanceEdit | null;
  locked: boolean;
  onEdit: (account: CashAccountDto) => void;
  onHistory: (account: CashAccountDto) => void;
}

function changedBalance(edit: BalanceEdit, account: CashAccountDto): boolean {
  const draft = edit.drafts[account.id];
  return draft !== undefined && draft !== null && draft !== account.balanceCents;
}

function GroupTable({ id, title, accounts, edit, locked, onEdit, onHistory }: GroupTableProps) {
  const phone = useMediaQuery(MEDIA.phone);
  const all: Record<string, ColumnTableColumn<CashAccountDto>> = {
    account: {
      id: 'account',
      header: 'Account',
      value: (a) => a.name,
      cell: (a) => (
        <span className="jf-app-account-cell">
          <span>{a.name}</span>
          {a.note ? <span className="jf-app-instrument__name">{a.note}</span> : null}
          {a.countsForEmergencyFund ? null : (
            <span className="jf-app-muted jf-app-small">{NOT_IN_FUND}</span>
          )}
        </span>
      ),
      minWidth: phone ? 130 : undefined,
    },
    balance: {
      id: 'balance',
      header: 'Balance',
      value: (a) => a.balanceCents,
      cell: (a) =>
        edit ? (
          <span className="jf-app-balance-edit">
            <MoneyField
              label={`Balance, ${a.name}`}
              labelHidden
              allowNegative
              value={edit.drafts[a.id] ?? null}
              onChange={(cents) => edit.onDraft(a.id, cents)}
              disabled={edit.pending}
            />
            {changedBalance(edit, a) &&
            edit.asOf !== null &&
            a.balanceAsOf !== null &&
            edit.asOf < a.balanceAsOf ? (
              <span className="jf-app-meta jf-app-older-note">{olderNote(a.balanceAsOf)}</span>
            ) : null}
          </span>
        ) : (
          <BalanceCell cents={a.balanceCents} />
        ),
      numeric: true,
    },
    asOf: {
      id: 'asOf',
      header: 'As of',
      value: (a) => a.balanceAsOf,
      cell: (a) => (a.balanceAsOf ? formatDate(a.balanceAsOf) : <Missing />),
      numeric: true,
    },
    source: {
      id: 'source',
      header: 'Source',
      value: (a) => a.origin,
      cell: (a) => <SourceCell origin={a.origin} />,
    },
    actions: {
      id: 'actions',
      header: 'Actions',
      value: () => null,
      cell: (a) => (
        <span className="jf-app-row-actions">
          <Button
            variant="ghost"
            size="sm"
            icon={Pencil}
            aria-label={`Edit ${a.name}`}
            data-cf-action={accountActionKey('edit', a.id)}
            onClick={() => onEdit(a)}
            disabled={locked}
          >
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={History}
            aria-label={`History of ${a.name}`}
            data-cf-action={accountActionKey('history', a.id)}
            onClick={() => onHistory(a)}
            disabled={edit !== null}
          >
            History
          </Button>
        </span>
      ),
    },
  };
  const subtotal = sumCents(accounts.map((a) => a.balanceCents));
  return (
    <div className="jf-app-account-group" data-group={id}>
      <ColumnTable
        columns={orderColumns(all, phone ? PHONE_ORDER : DESKTOP_ORDER)}
        rows={accounts}
        getRowId={(a) => String(a.id)}
        caption={`${title}: ${plural(accounts.length, 'account')}`}
        showCaption
        total={{ label: 'Subtotal', cells: { balance: <Amount cents={subtotal} /> } }}
      />
    </div>
  );
}

export interface AccountsSectionProps {
  page: CashPageResponse;
  /** Update balances mode is open. */
  editingBalances: boolean;
  /** Another form is open: row Edit buttons are disabled. */
  locked: boolean;
  onEditAccount: (account: CashAccountDto) => void;
  onBalancesDone: (message: string) => void;
  onBalancesCancel: () => void;
}

export function AccountsSection({
  page,
  editingBalances,
  locked,
  onEditAccount,
  onBalancesDone,
  onBalancesCancel,
}: AccountsSectionProps): JSX.Element {
  const [historyAccountId, setHistoryAccountId] = useState<number | null>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const groups = groupsOf(page.accounts);
  const { totals } = page;

  const showHistory = (account: CashAccountDto): void => {
    setHistoryAccountId(account.id);
    const card = historyRef.current;
    card?.scrollIntoView?.({ block: 'nearest' });
    card?.querySelector<HTMLElement>('select')?.focus();
  };

  if (page.accounts.length === 0) {
    return (
      <Callout kind="note" title="No accounts">
        <p>
          {NO_ACCOUNTS} <Link to="/import">Import page</Link>.
        </p>
      </Callout>
    );
  }

  const tables = (edit: BalanceEdit | null) =>
    groups.map((group) => (
      <GroupTable
        key={group.id}
        id={group.id}
        title={group.title}
        accounts={group.accounts}
        edit={edit}
        locked={locked || edit !== null}
        onEdit={onEditAccount}
        onHistory={showHistory}
      />
    ));

  return (
    <>
      {editingBalances ? (
        <BalancesForm
          page={page}
          renderTables={tables}
          onDone={onBalancesDone}
          onCancel={onBalancesCancel}
        />
      ) : (
        tables(null)
      )}
      <KeyValueTable
        caption="Cash totals"
        items={[
          {
            label: 'Total cash',
            value: <Amount cents={totals.totalCashCents} className="jf-app-strong" />,
            numeric: true,
          },
          {
            label: "Available cash (total − loans you've made)",
            value: <Amount cents={totals.availableCashCents} />,
            numeric: true,
          },
          {
            label: 'Emergency-fund cash',
            value: <Amount cents={totals.emergencyFundTestCents} />,
            numeric: true,
          },
        ]}
      />
      <div ref={historyRef}>
        <BalanceHistory
          page={page}
          accountId={historyAccountId}
          onAccountChange={setHistoryAccountId}
        />
      </div>
    </>
  );
}

// ─── Update balances (D58) ──────────────────────────────────────────────────────────────────────

interface BalancesFormProps {
  page: CashPageResponse;
  renderTables: (edit: BalanceEdit) => JSX.Element[];
  onDone: (message: string) => void;
  onCancel: () => void;
}

type BalanceField = 'asOf' | 'note';

function BalancesForm({ page, renderTables, onDone, onCancel }: BalancesFormProps): JSX.Element {
  const [today] = useState(() => toIsoDate(new Date()));
  const [asOf, setAsOf] = useState<IsoDate | null>(today);
  const [note, setNote] = useState('');
  const [drafts, setDrafts] = useState<Record<number, number | null>>(() =>
    Object.fromEntries(page.accounts.map((a) => [a.id, a.balanceCents])),
  );
  const [errors, setErrors] = useState<Partial<Record<BalanceField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const save = useSaveBalances();
  const formRef = useRef<HTMLFormElement>(null);
  const submitting = useRef(false);
  const pending = save.isPending;

  const changed = page.accounts.filter((a) => {
    const draft = drafts[a.id];
    return draft !== undefined && draft !== null && draft !== a.balanceCents;
  });
  const pristine = changed.length === 0;
  const workbookRow = changed.some((a) => a.origin === 'import');

  useEffect(() => {
    const form = formRef.current;
    form?.scrollIntoView?.({ block: 'nearest' });
    form?.querySelector<HTMLElement>('input:not([tabindex="-1"])')?.focus();
  }, []);

  useEffect(() => {
    if (!pending) submitting.current = false;
  }, [pending]);

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (submitting.current || pending || pristine) return;
    if (!event.currentTarget.checkValidity()) return;
    const found: Partial<Record<BalanceField, string>> = {};
    if (!asOf) found.asOf = 'Enter the date of the balances.';
    else if (asOf > tomorrowOf(today)) found.asOf = 'Enter a date no later than tomorrow.';
    if (note.trim().length > 200) found.note = 'Use at most 200 characters.';
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0 || !asOf) return;
    submitting.current = true;
    const shared = note.trim();
    save.mutate(
      {
        asOf,
        entries: changed.map((a) => ({
          accountId: a.id,
          balanceCents: drafts[a.id] ?? a.balanceCents,
          ...(shared ? { note: shared } : {}),
        })),
      },
      {
        onSuccess: () => onDone(changed.length === 1 ? 'Balance saved' : 'Balances saved'),
        onError: (error) => {
          const split = formErrorsOf<BalanceField>(error, ['asOf', 'note'], {
            'entries.note': 'note',
          });
          setErrors(split.fields);
          setFormError(split.form);
        },
      },
    );
  };

  const edit: BalanceEdit = {
    drafts,
    asOf,
    pending,
    onDraft: (id, cents) => setDrafts((current) => ({ ...current, [id]: cents })),
  };

  return (
    <form
      ref={formRef}
      className="jf-app-form jf-app-balances-form"
      onSubmit={onSubmit}
      noValidate
      aria-label="Update balances"
      aria-busy={pending || undefined}
    >
      <Grid>
        <GridItem span={6}>
          <DateField
            label="As of"
            value={asOf}
            onChange={setAsOf}
            max={tomorrowOf(today)}
            required
            error={errors.asOf}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={6}>
          <TextField
            label="Note"
            value={note}
            onChange={setNote}
            maxLength={200}
            hint="Optional: saved with every changed balance"
            error={errors.note}
            disabled={pending}
          />
        </GridItem>
      </Grid>
      <p className="jf-app-meta">
        {pristine
          ? 'Type the new balances below; only the accounts you change are saved.'
          : `${plural(changed.length, 'balance')} changed.`}
      </p>
      {/* One callout: the workbook one already says a re-import is blocked. */}
      {workbookRow ? <WorkbookCallout /> : <NewAppDataNote />}
      <FormError message={formError} />
      <Cluster gap={3} className="jf-app-form-actions">
        <Button
          type="submit"
          variant="primary"
          icon={Save}
          disabled={pristine || pending}
          aria-busy={pending || undefined}
        >
          Save balances
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </Cluster>
      {renderTables(edit)}
    </form>
  );
}
