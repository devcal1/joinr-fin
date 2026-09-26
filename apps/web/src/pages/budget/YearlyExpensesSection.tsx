// The Budget page's yearly expenses (stage-3.md §6.5 item 5): Name · Year cost · Monthly with
// Edit / Delete, the fund row "Set aside each month (rounded up to $5)" (white bold, no teal),
// and the add / edit form (Name, Year cost).
import type { BudgetPageResponse, YearlyExpenseDto } from '@joinr/schema';
import {
  Amount,
  Button,
  ColumnTable,
  Grid,
  GridItem,
  MEDIA,
  MoneyField,
  TextField,
  useMediaQuery,
  type ColumnTableColumn,
} from '@joinr/ui';
import { Pencil, Trash2 } from 'lucide-react';
import { useState, type JSX } from 'react';
import {
  useCreateYearlyExpense,
  useDeleteYearlyExpense,
  useUpdateYearlyExpense,
} from '../../api/hooks';
import { FlowCell } from '../cashflow/cells';
import { sumCents } from '../cashflow/display';
import {
  DeleteConfirm,
  FormError,
  InlineForm,
  NewAppDataNote,
  WorkbookCallout,
} from '../cashflow/forms';
import {
  actionSelector,
  formErrorsOf,
  orderColumns,
  useRowDelete,
  type EditorState,
} from '../cashflow/formState';
import { yearlyActionKey, type BudgetEditor } from './budgetModel';

export const FUND_ROW = 'Set aside each month (rounded up to $5)';

const DESKTOP_ORDER = ['name', 'annual', 'monthly', 'actions'] as const;
const PHONE_ORDER = ['name', 'monthly', 'annual', 'actions'] as const;

const deleteSelector = (id: number): string => actionSelector(yearlyActionKey('delete', id));

export function YearlyExpensesSection({
  page,
  editor,
}: {
  page: BudgetPageResponse;
  editor: EditorState<BudgetEditor>;
}): JSX.Element {
  const phone = useMediaQuery(MEDIA.phone);
  const remove = useDeleteYearlyExpense();
  const rowDelete = useRowDelete<number>(deleteSelector);
  const locked = editor.editor !== null;
  const open = editor.editor;
  const confirming = page.yearlyExpenses.find((e) => e.id === rowDelete.confirming);

  const all: Record<string, ColumnTableColumn<YearlyExpenseDto>> = {
    name: { id: 'name', header: 'Name', value: (e) => e.name, minWidth: phone ? 130 : 200 },
    annual: {
      id: 'annual',
      header: 'Year cost',
      value: (e) => e.annualCents,
      cell: (e) => <FlowCell cents={e.annualCents} />,
      numeric: true,
    },
    monthly: {
      id: 'monthly',
      header: 'Monthly',
      value: (e) => e.monthlyCents,
      cell: (e) => <FlowCell cents={e.monthlyCents} />,
      numeric: true,
    },
    actions: {
      id: 'actions',
      header: 'Actions',
      value: () => null,
      cell: (e) => {
        const label = `yearly expense ${e.name}`;
        if (rowDelete.confirming === e.id) {
          return (
            <DeleteConfirm
              question={`Delete the ${label}?`}
              label={label}
              busy={remove.isPending}
              onConfirm={() =>
                remove.mutate(e.id, {
                  onSuccess: () => {
                    rowDelete.finish();
                    editor.announce('Yearly expense deleted');
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
              data-cf-action={yearlyActionKey('edit', e.id)}
              onClick={() =>
                editor.open({
                  form: 'yearly',
                  expense: e,
                  opener: actionSelector(yearlyActionKey('edit', e.id)),
                })
              }
              disabled={locked || rowDelete.confirming !== null}
            >
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={Trash2}
              aria-label={`Delete the ${label}`}
              data-cf-action={yearlyActionKey('delete', e.id)}
              onClick={() => rowDelete.ask(e.id)}
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
      {open?.form === 'yearly' ? (
        <YearlyExpenseForm
          key={open.expense ? `yearly-${open.expense.id}` : 'new-yearly'}
          expense={open.expense}
          onDone={editor.done}
          onCancel={editor.close}
        />
      ) : null}
      {confirming?.origin === 'import' ? <WorkbookCallout /> : null}
      <FormError message={rowDelete.error} title="Not deleted" />
      <ColumnTable
        columns={orderColumns(all, phone ? PHONE_ORDER : DESKTOP_ORDER)}
        rows={page.yearlyExpenses}
        getRowId={(e) => String(e.id)}
        caption="Yearly expenses"
        emptyMessage="No yearly expenses yet."
        total={{
          label: FUND_ROW,
          cells: {
            annual: (
              <Amount
                cents={sumCents(page.yearlyExpenses.map((e) => e.annualCents))}
                colorNegative={false}
              />
            ),
            monthly: <Amount cents={page.summary.yearlyFundCents} colorNegative={false} />,
          },
        }}
      />
    </>
  );
}

type Field = 'name' | 'annualCents';

function YearlyExpenseForm({
  expense,
  onDone,
  onCancel,
}: {
  expense?: YearlyExpenseDto;
  onDone: (message: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const [name, setName] = useState(expense?.name ?? '');
  const [annual, setAnnual] = useState<number | null>(expense?.annualCents ?? null);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const create = useCreateYearlyExpense();
  const update = useUpdateYearlyExpense();
  const pending = create.isPending || update.isPending;
  const pristine = expense
    ? name.trim() === expense.name && annual === expense.annualCents
    : name.trim() === '' && annual === null;

  const submit = (): boolean => {
    const found: Partial<Record<Field, string>> = {};
    if (!name.trim()) found.name = 'Enter a name.';
    else if (name.trim().length > 80) found.name = 'Use at most 80 characters.';
    if (annual === null) found.annualCents = 'Enter the cost for a year.';
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0 || annual === null) return false;
    const body = { name: name.trim(), annualCents: annual };
    const handlers = {
      onSuccess: () => onDone('Yearly expense saved'),
      onError: (error: Error) => {
        const split = formErrorsOf<Field>(error, ['name', 'annualCents']);
        setErrors(split.fields);
        setFormError(split.form);
      },
    };
    if (expense) update.mutate({ id: expense.id, body }, handlers);
    else create.mutate(body, handlers);
    return true;
  };

  return (
    <InlineForm
      title={expense ? `Edit yearly expense · ${expense.name}` : 'Add yearly expense'}
      subtitle="Budget"
      onSubmit={submit}
      onCancel={onCancel}
      pending={pending}
      pristine={pristine}
      formError={formError}
      notes={
        expense?.origin === 'import' ? <WorkbookCallout /> : expense ? null : <NewAppDataNote />
      }
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
            label="Year cost"
            value={annual}
            onChange={setAnnual}
            required
            error={errors.annualCents}
            disabled={pending}
          />
        </GridItem>
      </Grid>
    </InlineForm>
  );
}
