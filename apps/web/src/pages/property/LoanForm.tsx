// The loan form (stage-4.md §6.5 item 5, §6.7, D66, D76): property, name, lender, start date and
// balance (the log's start point), interest rate, how interest compounds (a choice, plus a stored
// value outside it), the repayment amount and its frequency, and a note; create adds the current
// balance and its date. Changing the repayment says it re-estimates the entries without entered
// repayments (SPEC-15). Delete sits in the edit form.
import {
  ratioFromPercentText,
  type LoanDto,
  type PaymentFrequency,
  type PropertyPageResponse,
} from '@joinr/schema';
import {
  Button,
  Callout,
  DateField,
  Grid,
  GridItem,
  MoneyField,
  NumberField,
  Select,
  TextField,
  toIsoDate,
} from '@joinr/ui';
import { Trash2 } from 'lucide-react';
import { useState, type JSX } from 'react';
import { useCreateLoan, useDeleteLoan, useUpdateLoan } from '../../api/hooks';
import { tomorrowOf } from '../cashflow/display';
import { DeleteConfirm, InlineForm, NewAppDataNote, WorkbookCallout } from '../cashflow/forms';
import { actionErrorText, formErrorsOf } from '../cashflow/formState';
import { PAYMENT_FREQUENCY_LABELS } from '../assets/display';
import { compoundingOptions, loanDraftOf, repaymentChanged, type LoanDraft } from './loanDraft';
import { PAYMENT_FREQUENCY_CHOICES, REPAYMENT_CHANGE_NOTE } from './propertyText';

type Field =
  | 'propertyId'
  | 'name'
  | 'lender'
  | 'startDate'
  | 'startBalanceCents'
  | 'annualRate'
  | 'compoundingPerYear'
  | 'paymentCents'
  | 'paymentFrequency'
  | 'note'
  | 'balanceCents'
  | 'asOf';
const FIELDS: readonly Field[] = [
  'propertyId',
  'name',
  'lender',
  'startDate',
  'startBalanceCents',
  'annualRate',
  'compoundingPerYear',
  'paymentCents',
  'paymentFrequency',
  'note',
  'balanceCents',
  'asOf',
];

export interface LoanFormProps {
  page: PropertyPageResponse;
  loan?: LoanDto;
  onDone: (message: string) => void;
  onCancel: () => void;
}

export function LoanForm({ page, loan, onDone, onCancel }: LoanFormProps): JSX.Element {
  const [today] = useState(() => toIsoDate(new Date()));
  const firstProperty = page.properties[0]?.id ?? null;
  const [draft, setDraft] = useState<LoanDraft>(() => loanDraftOf(loan, today, firstProperty));
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const create = useCreateLoan();
  const update = useUpdateLoan();
  const remove = useDeleteLoan();
  const pending = create.isPending || update.isPending || remove.isPending;
  const initial = loanDraftOf(loan, today, firstProperty);

  const set = <K extends keyof LoanDraft>(key: K, value: LoanDraft[K]): void => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const pristine = loan
    ? (Object.keys(initial) as (keyof LoanDraft)[])
        .filter((key) => key !== 'balanceCents' && key !== 'asOf')
        .every((key) =>
          typeof draft[key] === 'string'
            ? String(draft[key]).trim() === String(initial[key]).trim()
            : draft[key] === initial[key],
        )
    : draft.name.trim() === '' && draft.balanceCents === null;

  const submit = (): boolean => {
    const found: Partial<Record<Field, string>> = {};
    if (draft.propertyId === '') found.propertyId = 'Choose the property this mortgage is for.';
    const name = draft.name.trim();
    if (!name) found.name = 'Enter a name.';
    else if (name.length > 80) found.name = 'Use at most 80 characters.';
    if (draft.lender.trim().length > 80) found.lender = 'Use at most 80 characters.';
    if (draft.startDate && draft.startDate > tomorrowOf(today)) {
      found.startDate = 'Enter a date no later than tomorrow.';
    }
    let annualRate: string | null = null;
    if (draft.ratePercent.trim() !== '') {
      annualRate = ratioFromPercentText(draft.ratePercent);
      if (annualRate === null) found.annualRate = 'Enter a rate like 6.04.';
      else if (Number(annualRate) > 1) found.annualRate = 'Enter a rate from 0 to 100.';
    }
    if (draft.note.trim().length > 200) found.note = 'Use at most 200 characters.';
    if (!loan) {
      if (draft.balanceCents === null) found.balanceCents = 'Enter the current balance.';
      if (!draft.asOf) found.asOf = 'Enter the date of the balance.';
      else if (draft.asOf > tomorrowOf(today)) found.asOf = 'Enter a date no later than tomorrow.';
    }
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return false;
    const base = {
      propertyId: Number(draft.propertyId),
      name,
      lender: draft.lender.trim() || null,
      startDate: draft.startDate,
      startBalanceCents: draft.startBalanceCents,
      annualRate,
      compoundingPerYear: draft.compounding === '' ? null : Number(draft.compounding),
      paymentCents: draft.paymentCents,
      paymentFrequency: draft.paymentFrequency,
      note: draft.note.trim() || null,
    };
    const onError = (error: Error): void => {
      const split = formErrorsOf<Field>(error, FIELDS);
      setErrors(split.fields);
      setFormError(split.form);
    };
    if (loan) {
      update.mutate(
        { id: loan.id, body: base },
        { onSuccess: () => onDone('Loan saved'), onError },
      );
    } else {
      create.mutate(
        { ...base, balanceCents: draft.balanceCents ?? 0, asOf: draft.asOf ?? today },
        { onSuccess: () => onDone('Loan saved'), onError },
      );
    }
    return true;
  };

  const confirmDelete = (): void => {
    if (!loan) return;
    setFormError(null);
    // This form sits inside the loan's card, which unmounts once the refetch drops the loan, and
    // TanStack Query skips the mutate() callbacks of an unmounted observer; the mutateAsync promise
    // still settles, so the page (which stays mounted) closes the editor and announces the delete.
    void remove.mutateAsync(loan.id).then(
      () => onDone('Loan deleted'),
      (error: unknown) => {
        setConfirming(false);
        setFormError(actionErrorText(error));
      },
    );
  };

  const deleteButton = loan ? (
    confirming ? (
      <DeleteConfirm
        question={`Delete ${loan.name}, its balance log and its offset links?`}
        label={`loan ${loan.name}`}
        busy={remove.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setConfirming(false)}
      />
    ) : (
      <Button variant="ghost" icon={Trash2} onClick={() => setConfirming(true)} disabled={pending}>
        Delete loan
      </Button>
    )
  ) : null;

  const propertyOptions = page.properties.map((p) => ({ value: String(p.id), label: p.name }));

  return (
    <InlineForm
      title={loan ? `Edit loan · ${loan.name}` : 'Add loan'}
      subtitle="Mortgage"
      onSubmit={submit}
      onCancel={onCancel}
      pending={pending}
      pristine={pristine}
      formError={formError}
      extraActions={deleteButton}
      notes={
        <>
          {repaymentChanged(draft, loan) ? (
            <Callout kind="important" title="Repayment changed">
              <p>{REPAYMENT_CHANGE_NOTE}</p>
            </Callout>
          ) : null}
          {loan?.origin === 'import' ? <WorkbookCallout /> : <NewAppDataNote />}
        </>
      }
    >
      <Grid>
        <GridItem span={4}>
          <Select
            label="Property"
            value={draft.propertyId}
            onChange={(value) => set('propertyId', value)}
            options={propertyOptions}
            placeholder={
              propertyOptions.length === 0 ? 'Add a property first' : 'Choose a property'
            }
            required
            error={errors.propertyId}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={4}>
          <TextField
            label="Name"
            value={draft.name}
            onChange={(value) => set('name', value)}
            maxLength={80}
            required
            error={errors.name}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={4}>
          <TextField
            label="Lender"
            value={draft.lender}
            onChange={(value) => set('lender', value)}
            maxLength={80}
            hint="Optional"
            error={errors.lender}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={4}>
          <DateField
            label="Start date"
            value={draft.startDate}
            onChange={(date) => set('startDate', date)}
            max={tomorrowOf(today)}
            hint="The repayments fall on dates counted from it"
            error={errors.startDate}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={4}>
          <MoneyField
            label="Start balance"
            value={draft.startBalanceCents}
            onChange={(cents) => set('startBalanceCents', cents)}
            hint="The amount borrowed: the log's first point"
            error={errors.startBalanceCents}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={4}>
          <NumberField
            label="Interest rate"
            value={draft.ratePercent}
            onChange={(value) => set('ratePercent', value)}
            maxDp={4}
            suffix="%"
            hint="A year, e.g. 6.04"
            error={errors.annualRate}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={4}>
          <Select
            label="Interest compounds"
            value={draft.compounding}
            onChange={(value) => set('compounding', value)}
            options={compoundingOptions(loan?.compoundingPerYear ?? null)}
            placeholder="Not set"
            error={errors.compoundingPerYear}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={4}>
          <MoneyField
            label="Repayment amount"
            value={draft.paymentCents}
            onChange={(cents) => set('paymentCents', cents)}
            error={errors.paymentCents}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={4}>
          <Select
            label="Repayment frequency"
            value={draft.paymentFrequency}
            onChange={(value) => set('paymentFrequency', value as PaymentFrequency)}
            options={PAYMENT_FREQUENCY_CHOICES.map((f) => ({
              value: f,
              label: PAYMENT_FREQUENCY_LABELS[f],
            }))}
            error={errors.paymentFrequency}
            disabled={pending}
          />
        </GridItem>
        {loan ? null : (
          <>
            <GridItem span={4}>
              <MoneyField
                label="Current balance"
                value={draft.balanceCents}
                onChange={(cents) => set('balanceCents', cents)}
                required
                error={errors.balanceCents}
                disabled={pending}
              />
            </GridItem>
            <GridItem span={4}>
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
        <GridItem span={12}>
          <TextField
            label="Note"
            value={draft.note}
            onChange={(value) => set('note', value)}
            maxLength={200}
            hint="Optional"
            error={errors.note}
            disabled={pending}
          />
        </GridItem>
      </Grid>
    </InlineForm>
  );
}
