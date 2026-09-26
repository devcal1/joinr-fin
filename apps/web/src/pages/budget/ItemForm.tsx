// The budget item forms (stage-3.md §6.5 item 4, §3.4, D54): an item (name, monthly, category
// with the existing categories as suggestions, account) and an automatic row (category and
// account; with the automatic split off, the investment row also takes an amount per month).
import type { BudgetPageResponse, BudgetRowDto } from '@joinr/schema';
import {
  Callout,
  Grid,
  GridItem,
  MoneyField,
  Select,
  TextField,
  type SelectOption,
} from '@joinr/ui';
import { useId, useState, type JSX } from 'react';
import { useCreateBudgetItem, useSaveBudgetAutoRow, useUpdateBudgetItem } from '../../api/hooks';
import { CASH_KIND_LABELS } from '../cashflow/display';
import { InlineForm, NewAppDataNote, WorkbookCallout } from '../cashflow/forms';
import { formErrorsOf } from '../cashflow/formState';
import { STALE_ACCOUNT, isStaleAccount, rowLabel } from './budgetModel';

export const MANUAL_AMOUNT_HINT = 'The rest of the leftover goes to cash savings';
export const NEGATIVE_CASH_ROW = 'The cash savings row is negative';

type ItemField = 'name' | 'monthlyCents' | 'category' | 'accountId' | 'manualMonthlyCents';
const FIELDS: readonly ItemField[] = [
  'name',
  'monthlyCents',
  'category',
  'accountId',
  'manualMonthlyCents',
];

function accountOptions(page: BudgetPageResponse): SelectOption[] {
  return [
    { value: '', label: 'No account' },
    ...page.accounts.map((a) => ({
      value: String(a.id),
      label: `${a.name} (${CASH_KIND_LABELS[a.kind]})`,
    })),
  ];
}

function categories(page: BudgetPageResponse): string[] {
  const seen = new Set<string>();
  for (const row of page.rows) if (row.category) seen.add(row.category);
  return [...seen].sort((a, b) => a.localeCompare(b));
}

function CategoryField({
  page,
  value,
  onChange,
  error,
  disabled,
}: {
  page: BudgetPageResponse;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled: boolean;
}): JSX.Element {
  const listId = `${useId()}categories`;
  return (
    <>
      <TextField
        label="Category"
        value={value}
        onChange={onChange}
        maxLength={40}
        list={listId}
        hint="Optional; “Savings” marks a savings line"
        error={error}
        disabled={disabled}
      />
      <datalist id={listId}>
        {categories(page).map((category) => (
          <option key={category} value={category} />
        ))}
      </datalist>
    </>
  );
}

export interface ItemFormProps {
  page: BudgetPageResponse;
  row?: BudgetRowDto;
  onDone: (message: string) => void;
  onCancel: () => void;
}

/** An item row (kind `item`): create or edit. */
export function ItemForm({ page, row, onDone, onCancel }: ItemFormProps): JSX.Element {
  const initialAccount = row?.accountLinked && row.accountId !== null ? String(row.accountId) : '';
  const [name, setName] = useState(row?.name ?? '');
  const [monthly, setMonthly] = useState<number | null>(row?.storedMonthlyCents ?? null);
  const [category, setCategory] = useState(row?.category ?? '');
  const [account, setAccount] = useState(initialAccount);
  const [errors, setErrors] = useState<Partial<Record<ItemField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const create = useCreateBudgetItem();
  const update = useUpdateBudgetItem();
  const pending = create.isPending || update.isPending;
  const pristine = row
    ? name.trim() === (row.name ?? '') &&
      monthly === row.storedMonthlyCents &&
      (category.trim() || null) === row.category &&
      account === initialAccount
    : name.trim() === '' && monthly === null && category.trim() === '' && account === '';

  const submit = (): boolean => {
    const found: Partial<Record<ItemField, string>> = {};
    if (!name.trim()) found.name = 'Enter a name.';
    else if (name.trim().length > 80) found.name = 'Use at most 80 characters.';
    if (monthly === null) found.monthlyCents = 'Enter the amount per month.';
    if (category.trim().length > 40) found.category = 'Use at most 40 characters.';
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0 || monthly === null) return false;
    const body = {
      name: name.trim(),
      monthlyCents: monthly,
      category: category.trim() || null,
      accountId: account === '' ? null : Number(account),
    };
    const handlers = {
      onSuccess: () => onDone('Budget item saved'),
      onError: (error: Error) => {
        const split = formErrorsOf<ItemField>(error, FIELDS);
        setErrors(split.fields);
        setFormError(split.form);
      },
    };
    if (row?.id != null) update.mutate({ id: row.id, body }, handlers);
    else create.mutate(body, handlers);
    return true;
  };

  const stale = row !== undefined && isStaleAccount(row);
  return (
    <InlineForm
      title={row ? `Edit item · ${rowLabel(row)}` : 'Add item'}
      subtitle="Budget"
      onSubmit={submit}
      onCancel={onCancel}
      pending={pending}
      pristine={pristine}
      formError={formError}
      notes={row?.origin === 'import' ? <WorkbookCallout /> : row ? null : <NewAppDataNote />}
    >
      <Grid>
        <GridItem span={6}>
          <TextField
            label="Name"
            value={name}
            onChange={setName}
            maxLength={80}
            required
            error={errors.name}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={6}>
          <MoneyField
            label="Monthly"
            value={monthly}
            onChange={setMonthly}
            required
            error={errors.monthlyCents}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={6}>
          <CategoryField
            page={page}
            value={category}
            onChange={setCategory}
            error={errors.category}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={6}>
          <Select
            label="Account"
            value={account}
            onChange={setAccount}
            options={accountOptions(page)}
            hint={
              stale
                ? `${STALE_ACCOUNT} (was “${row.accountName ?? ''}”)`
                : 'The account paid from on payday'
            }
            error={errors.accountId}
            disabled={pending}
          />
        </GridItem>
      </Grid>
    </InlineForm>
  );
}

export interface AutoRowFormProps {
  page: BudgetPageResponse;
  row: BudgetRowDto;
  onDone: (message: string) => void;
  onCancel: () => void;
}

/** An automatic row: category and account; the investment row's amount while the split is off. */
export function AutoRowForm({ page, row, onDone, onCancel }: AutoRowFormProps): JSX.Element {
  const kind = row.kind === 'item' ? 'auto_yearly' : row.kind;
  const withAmount = kind === 'auto_invest' && page.summary.investManual;
  const initialAccount = row.accountLinked && row.accountId !== null ? String(row.accountId) : '';
  const [category, setCategory] = useState(row.category ?? '');
  const [account, setAccount] = useState(initialAccount);
  const [amount, setAmount] = useState<number | null>(row.storedMonthlyCents);
  const [errors, setErrors] = useState<Partial<Record<ItemField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const save = useSaveBudgetAutoRow();
  const pristine =
    (category.trim() || null) === row.category &&
    account === initialAccount &&
    (!withAmount || amount === row.storedMonthlyCents);
  const leftover = page.summary.leftoverCents;
  const over = withAmount && amount !== null && leftover !== null && amount > leftover;

  const submit = (): boolean => {
    const found: Partial<Record<ItemField, string>> = {};
    if (category.trim().length > 40) found.category = 'Use at most 40 characters.';
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return false;
    save.mutate(
      {
        kind,
        body: {
          category: category.trim() || null,
          accountId: account === '' ? null : Number(account),
          ...(withAmount ? { manualMonthlyCents: amount } : {}),
        },
      },
      {
        onSuccess: () => onDone('Budget item saved'),
        onError: (error) => {
          const split = formErrorsOf<ItemField>(error, FIELDS);
          setErrors(split.fields);
          setFormError(split.form);
        },
      },
    );
    return true;
  };

  const stale = isStaleAccount(row);
  return (
    <InlineForm
      title={`Edit · ${rowLabel(row)}`}
      subtitle="Automatic budget row"
      onSubmit={submit}
      onCancel={onCancel}
      pending={save.isPending}
      pristine={pristine}
      formError={formError}
      notes={
        <>
          {over ? (
            <Callout kind="important" title="Check the amount">
              <p>{NEGATIVE_CASH_ROW}: the amount is more than is left over each month.</p>
            </Callout>
          ) : null}
          {row.origin === 'import' ? (
            <WorkbookCallout />
          ) : row.id === null ? (
            <NewAppDataNote />
          ) : null}
        </>
      }
    >
      <Grid>
        {withAmount ? (
          <GridItem span={4}>
            <MoneyField
              label="Amount per month"
              value={amount}
              onChange={setAmount}
              hint={MANUAL_AMOUNT_HINT}
              error={errors.manualMonthlyCents}
              disabled={save.isPending}
            />
          </GridItem>
        ) : null}
        <GridItem span={withAmount ? 4 : 6}>
          <CategoryField
            page={page}
            value={category}
            onChange={setCategory}
            error={errors.category}
            disabled={save.isPending}
          />
        </GridItem>
        <GridItem span={withAmount ? 4 : 6}>
          <Select
            label="Account"
            value={account}
            onChange={setAccount}
            options={accountOptions(page)}
            hint={stale ? `${STALE_ACCOUNT} (was “${row.accountName ?? ''}”)` : undefined}
            error={errors.accountId}
            disabled={save.isPending}
          />
        </GridItem>
      </Grid>
    </InlineForm>
  );
}
