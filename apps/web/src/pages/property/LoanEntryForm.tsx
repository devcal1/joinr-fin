// One loan's balance entry (stage-4.md §6.5 item 5, D66, UX-7): "Update balance" adds an entry (As
// of, Balance, Repayments, Note; `PUT /api/property/loan-balances` with that loan only) and "Edit"
// changes a stored one (Balance, Repayments, Note; the date is fixed). Repayments are optional: the
// placeholder is the estimate the engine would use ("Estimated X (N payments)", from the loan's
// payment dates via `paymentDatesBetween`), so leaving it empty saves exactly that estimate.
import type { LoanBalanceEntryDto, LoanDto, PropertyPageResponse } from '@joinr/schema';
import {
  DateField,
  Grid,
  GridItem,
  MoneyField,
  TextField,
  formatDate,
  formatMoney,
  toIsoDate,
} from '@joinr/ui';
import { useState, type JSX } from 'react';
import { useSaveLoanBalances, useUpdateLoanBalanceEntry } from '../../api/hooks';
import { tomorrowOf } from '../cashflow/display';
import { InlineForm, NewAppDataNote, WorkbookCallout } from '../cashflow/forms';
import { formErrorsOf } from '../cashflow/formState';
import {
  REPAYMENTS_EMPTY_HINT,
  entryEstimate,
  estimatePlaceholder,
  estimateRepayments,
  loanLog,
} from './propertyText';

type Field = 'asOf' | 'balanceCents' | 'repaymentsCents' | 'note';
const FIELDS: readonly Field[] = ['asOf', 'balanceCents', 'repaymentsCents', 'note'];
const ALIASES: Readonly<Record<string, Field>> = {
  'entries.0.balanceCents': 'balanceCents',
  'entries.0.repaymentsCents': 'repaymentsCents',
  'entries.0.note': 'note',
};

export interface LoanEntryFormProps {
  page: PropertyPageResponse;
  loan: LoanDto;
  /** Edit this stored entry; without it the form adds a new one. */
  entry?: LoanBalanceEntryDto;
  onDone: (message: string) => void;
  onCancel: () => void;
}

export function LoanEntryForm({
  page,
  loan,
  entry,
  onDone,
  onCancel,
}: LoanEntryFormProps): JSX.Element {
  const [today] = useState(() => toIsoDate(new Date()));
  const [asOf, setAsOf] = useState<string | null>(entry?.asOf ?? today);
  const [balance, setBalance] = useState<number | null>(entry?.balanceCents ?? null);
  const [repayments, setRepayments] = useState<number | null>(
    entry?.repaymentsTyped ? entry.repaymentsCents : null,
  );
  const [note, setNote] = useState(entry?.note ?? '');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const add = useSaveLoanBalances();
  const edit = useUpdateLoanBalanceEntry();
  const pending = add.isPending || edit.isPending;

  const log = loanLog(page, loan.id).filter((e) => e.id !== entry?.id);
  const estimate = entry
    ? entryEstimate(loan, entry)
    : estimateRepayments(loan, log, asOf ?? today);
  const typedBefore = entry?.repaymentsTyped ? entry.repaymentsCents : null;

  const pristine = entry
    ? balance === entry.balanceCents &&
      repayments === typedBefore &&
      (note.trim() || null) === entry.note
    : balance === null && repayments === null && note.trim() === '';

  const submit = (): boolean => {
    const found: Partial<Record<Field, string>> = {};
    if (!entry) {
      if (!asOf) found.asOf = 'Enter the date of the balance.';
      else if (asOf > tomorrowOf(today)) found.asOf = 'Enter a date no later than tomorrow.';
    }
    if (balance === null) found.balanceCents = 'Enter the balance.';
    if (note.trim().length > 200) found.note = 'Use at most 200 characters.';
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0 || balance === null) return false;
    const onError = (error: Error): void => {
      const split = formErrorsOf<Field>(error, FIELDS, ALIASES);
      setErrors(split.fields);
      setFormError(split.form);
    };
    if (entry && entry.id !== null) {
      edit.mutate(
        {
          id: entry.id,
          body: { balanceCents: balance, repaymentsCents: repayments, note: note.trim() || null },
        },
        { onSuccess: () => onDone('Loan saved'), onError },
      );
    } else {
      add.mutate(
        {
          asOf: asOf ?? today,
          entries: [
            {
              loanId: loan.id,
              balanceCents: balance,
              // Empty: left out, so a new entry takes the default estimate and an entry already
              // stored at that date keeps its figure (§4.3).
              ...(repayments !== null ? { repaymentsCents: repayments } : {}),
              ...(note.trim() ? { note: note.trim() } : {}),
            },
          ],
        },
        { onSuccess: () => onDone('Balances saved'), onError },
      );
    }
    return true;
  };

  const title = entry
    ? `Edit entry · ${loan.name} · ${formatDate(entry.asOf)}`
    : `Update balance · ${loan.name}`;
  return (
    <InlineForm
      title={title}
      subtitle="Mortgage"
      onSubmit={submit}
      onCancel={onCancel}
      pending={pending}
      pristine={pristine}
      formError={formError}
      notes={entry?.origin === 'import' ? <WorkbookCallout /> : <NewAppDataNote />}
    >
      <Grid>
        {entry ? null : (
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
        )}
        <GridItem span={6}>
          <MoneyField
            label="Balance"
            value={balance}
            onChange={setBalance}
            required
            hint={
              entry
                ? undefined
                : `Now ${formatMoney(loan.balanceCents)} as of ${formatDate(loan.balanceAsOf)}`
            }
            error={errors.balanceCents}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={6}>
          <MoneyField
            label="Repayments"
            value={repayments}
            onChange={setRepayments}
            placeholder={estimatePlaceholder(estimate)}
            hint={`Optional: the total repaid since the previous entry. ${REPAYMENTS_EMPTY_HINT}.`}
            error={errors.repaymentsCents}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={6}>
          <TextField
            label="Note"
            value={note}
            onChange={setNote}
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
