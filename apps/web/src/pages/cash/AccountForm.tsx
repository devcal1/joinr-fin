// The cash account form (stage-3.md §6.3 item 3, §3.4, §6.8): create (with an opening balance and
// its date) or edit (name, kind, offset, note). A kind-only change on a workbook account keeps
// re-import available (a note instead of the workbook callout). Delete lives in the edit form and
// is refused while budget rows use the account (409 ACCOUNT_IN_USE).
import { CASH_ACCOUNT_KINDS, type CashAccountDto, type CashAccountKind } from '@joinr/schema';
import {
  Button,
  Callout,
  DateField,
  Grid,
  GridItem,
  MoneyField,
  Select,
  Switch,
  TextField,
  toIsoDate,
} from '@joinr/ui';
import { Trash2 } from 'lucide-react';
import { useState, type JSX } from 'react';
import { useCreateCashAccount, useDeleteCashAccount, useUpdateCashAccount } from '../../api/hooks';
import { plural } from '../../formatting';
import { CASH_KIND_LABELS, tomorrowOf } from '../cashflow/display';
import { DeleteConfirm, InlineForm, NewAppDataNote, WorkbookCallout } from '../cashflow/forms';
import { actionErrorText, formErrorsOf } from '../cashflow/formState';

export const KIND_ONLY_NOTE = 'Changing only the kind keeps re-import available.';

type Field = 'name' | 'kind' | 'isOffset' | 'note' | 'openingBalanceCents' | 'asOf';
const FIELDS: readonly Field[] = [
  'name',
  'kind',
  'isOffset',
  'note',
  'openingBalanceCents',
  'asOf',
];

interface Draft {
  name: string;
  kind: CashAccountKind;
  isOffset: boolean;
  note: string;
  openingBalanceCents: number | null;
  asOf: string | null;
}

function draftOf(account: CashAccountDto | undefined, today: string): Draft {
  return {
    name: account?.name ?? '',
    kind: account?.kind ?? 'bank',
    isOffset: account?.isOffset ?? false,
    note: account?.note ?? '',
    openingBalanceCents: null,
    asOf: today,
  };
}

/** Which editable fields differ from the account (trimmed; '' = no note). */
function changedFields(
  draft: Draft,
  account: CashAccountDto,
): Set<'name' | 'kind' | 'isOffset' | 'note'> {
  const changed = new Set<'name' | 'kind' | 'isOffset' | 'note'>();
  if (draft.name.trim() !== account.name) changed.add('name');
  if (draft.kind !== account.kind) changed.add('kind');
  if (draft.isOffset !== account.isOffset) changed.add('isOffset');
  if ((draft.note.trim() || null) !== (account.note ?? null)) changed.add('note');
  return changed;
}

export interface AccountFormProps {
  account?: CashAccountDto;
  onDone: (message: string) => void;
  onCancel: () => void;
}

export function AccountForm({ account, onDone, onCancel }: AccountFormProps): JSX.Element {
  const [today] = useState(() => toIsoDate(new Date()));
  const [draft, setDraft] = useState<Draft>(() => draftOf(account, today));
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const create = useCreateCashAccount();
  const update = useUpdateCashAccount();
  const remove = useDeleteCashAccount();
  const pending = create.isPending || update.isPending || remove.isPending;

  const changed = account ? changedFields(draft, account) : null;
  const pristine = account
    ? changed?.size === 0
    : draft.name.trim() === '' && draft.note.trim() === '' && draft.openingBalanceCents === null;
  const kindOnly = changed !== null && changed.size === 1 && changed.has('kind');
  const workbook = account?.origin === 'import';

  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const validate = (): Partial<Record<Field, string>> => {
    const found: Partial<Record<Field, string>> = {};
    const name = draft.name.trim();
    if (!name) found.name = 'Enter a name.';
    else if (name.length > 80) found.name = 'Use at most 80 characters.';
    if (draft.note.trim().length > 200) found.note = 'Use at most 200 characters.';
    if (!account) {
      if (draft.openingBalanceCents === null) found.openingBalanceCents = 'Enter the balance.';
      if (!draft.asOf) found.asOf = 'Enter the date of the balance.';
      else if (draft.asOf > tomorrowOf(today)) found.asOf = 'Enter a date no later than tomorrow.';
    }
    return found;
  };

  const onError = (error: Error): void => {
    const split = formErrorsOf<Field>(error, FIELDS);
    setErrors(split.fields);
    setFormError(split.form);
  };

  const submit = (): boolean => {
    const found = validate();
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return false;
    const base = {
      name: draft.name.trim(),
      kind: draft.kind,
      isOffset: draft.isOffset,
      note: draft.note.trim() || null,
    };
    if (account) {
      update.mutate(
        { id: account.id, body: base },
        { onSuccess: () => onDone('Account saved'), onError },
      );
    } else {
      create.mutate(
        {
          ...base,
          openingBalanceCents: draft.openingBalanceCents ?? 0,
          asOf: draft.asOf ?? today,
        },
        { onSuccess: () => onDone('Account added'), onError },
      );
    }
    return true;
  };

  const confirmDelete = (): void => {
    if (!account) return;
    setFormError(null);
    remove.mutate(account.id, {
      onSuccess: () => onDone('Account deleted'),
      onError: (error) => {
        setConfirming(false);
        setFormError(actionErrorText(error));
      },
    });
  };

  const inUse = (account?.budgetRowCount ?? 0) > 0;
  const deleteButton = account ? (
    confirming ? (
      <DeleteConfirm
        question={`Delete ${account.name} and its balance history?`}
        label={`account ${account.name}`}
        busy={remove.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setConfirming(false)}
      />
    ) : (
      <Button
        variant="ghost"
        icon={Trash2}
        onClick={() => setConfirming(true)}
        disabled={pending || inUse}
        aria-describedby={inUse ? 'cash-account-in-use' : undefined}
      >
        Delete account
      </Button>
    )
  ) : null;

  let notes: JSX.Element | null = null;
  if (!account) notes = <NewAppDataNote />;
  else if (workbook && kindOnly) {
    notes = (
      <Callout kind="note" title="Import-safe">
        <p>{KIND_ONLY_NOTE}</p>
      </Callout>
    );
  } else if (workbook) notes = <WorkbookCallout />;

  const title = account ? `Edit account · ${account.name}` : 'Add account';
  return (
    <InlineForm
      title={title}
      subtitle="Cash"
      onSubmit={submit}
      onCancel={onCancel}
      pending={pending}
      pristine={pristine}
      formError={formError}
      extraActions={deleteButton}
      notes={
        <>
          {notes}
          {inUse ? (
            <p id="cash-account-in-use" className="jf-app-meta">
              Used by {plural(account?.budgetRowCount ?? 0, 'budget row')}: move them to another
              account on the Budget page before deleting it.
            </p>
          ) : null}
        </>
      }
    >
      <Grid>
        <GridItem span={6}>
          <TextField
            label="Name"
            value={draft.name}
            onChange={(name) => set('name', name)}
            maxLength={80}
            required
            error={errors.name}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={6}>
          <Select
            label="Kind"
            value={draft.kind}
            onChange={(kind) => set('kind', kind as CashAccountKind)}
            options={CASH_ACCOUNT_KINDS.map((kind) => ({
              value: kind,
              label: CASH_KIND_LABELS[kind],
            }))}
            error={errors.kind}
            disabled={pending}
          />
        </GridItem>
        {account ? null : (
          <>
            <GridItem span={6}>
              <MoneyField
                label="Opening balance"
                value={draft.openingBalanceCents}
                onChange={(cents) => set('openingBalanceCents', cents)}
                allowNegative
                hint="A credit card owed is negative"
                required
                error={errors.openingBalanceCents}
                disabled={pending}
              />
            </GridItem>
            <GridItem span={6}>
              <DateField
                label="As of"
                value={draft.asOf}
                onChange={(date) => set('asOf', date)}
                max={tomorrowOf(today)}
                required
                error={errors.asOf}
                disabled={pending}
              />
            </GridItem>
          </>
        )}
        <GridItem span={6}>
          <TextField
            label="Note"
            value={draft.note}
            onChange={(note) => set('note', note)}
            maxLength={200}
            hint="Optional"
            error={errors.note}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={6}>
          <div className="jf-app-switch-field">
            <Switch
              label="Offset account: kept out of Total cash"
              checked={draft.isOffset}
              onChange={(isOffset) => set('isOffset', isOffset)}
              disabled={pending}
            />
          </div>
        </GridItem>
      </Grid>
    </InlineForm>
  );
}
