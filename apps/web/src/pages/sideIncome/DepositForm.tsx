// The side-income deposit form (stage-3.md §6.4 item 5, D57): stream, date (default today, not
// after tomorrow), a signed non-zero amount (negative = a reversal) and a note.
import type { IncomeStreamDto, SideIncomeDepositDto } from '@joinr/schema';
import {
  DateField,
  Grid,
  GridItem,
  MoneyField,
  Select,
  TextField,
  formatDate,
  toIsoDate,
} from '@joinr/ui';
import { useState, type JSX } from 'react';
import { useCreateDeposit, useUpdateDeposit } from '../../api/hooks';
import { tomorrowOf } from '../cashflow/display';
import { InlineForm, NewAppDataNote, WorkbookCallout } from '../cashflow/forms';
import { formErrorsOf } from '../cashflow/formState';

type Field = 'streamId' | 'date' | 'amountCents' | 'note';
const FIELDS: readonly Field[] = ['streamId', 'date', 'amountCents', 'note'];

export interface DepositFormProps {
  streams: readonly IncomeStreamDto[];
  deposit?: SideIncomeDepositDto;
  onDone: (message: string) => void;
  onCancel: () => void;
}

export function DepositForm({ streams, deposit, onDone, onCancel }: DepositFormProps): JSX.Element {
  const [today] = useState(() => toIsoDate(new Date()));
  const [streamId, setStreamId] = useState(deposit ? String(deposit.streamId) : '');
  const [date, setDate] = useState<string | null>(deposit?.date ?? today);
  const [amount, setAmount] = useState<number | null>(deposit?.amountCents ?? null);
  const [note, setNote] = useState(deposit?.note ?? '');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const create = useCreateDeposit();
  const update = useUpdateDeposit();
  const pending = create.isPending || update.isPending;

  // Archived streams are hidden from the form, except the one an edited deposit already uses.
  const options = streams
    .filter((s) => !s.archived || String(s.id) === streamId)
    .map((s) => ({ value: String(s.id), label: s.archived ? `${s.name} (archived)` : s.name }));

  const pristine = deposit
    ? streamId === String(deposit.streamId) &&
      date === deposit.date &&
      amount === deposit.amountCents &&
      (note.trim() || null) === deposit.note
    : streamId === '' && amount === null && note.trim() === '';

  const submit = (): boolean => {
    const found: Partial<Record<Field, string>> = {};
    if (!streamId) found.streamId = 'Choose a stream.';
    if (!date) found.date = 'Enter the date.';
    else if (date > tomorrowOf(today)) found.date = 'Enter a date no later than tomorrow.';
    if (amount === null) found.amountCents = 'Enter the amount.';
    else if (amount === 0) found.amountCents = 'Enter an amount other than zero.';
    if (note.trim().length > 200) found.note = 'Use at most 200 characters.';
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0 || amount === null || !date) return false;
    const body = {
      streamId: Number(streamId),
      date,
      amountCents: amount,
      note: note.trim() || null,
    };
    const handlers = {
      onSuccess: () => onDone(deposit ? 'Deposit saved' : 'Deposit added'),
      onError: (error: Error) => {
        const split = formErrorsOf<Field>(error, FIELDS);
        setErrors(split.fields);
        setFormError(split.form);
      },
    };
    if (deposit) update.mutate({ id: deposit.id, body }, handlers);
    else create.mutate(body, handlers);
    return true;
  };

  const title = deposit ? `Edit deposit · ${formatDate(deposit.date)}` : 'Add deposit';
  return (
    <InlineForm
      title={title}
      subtitle="Side income"
      onSubmit={submit}
      onCancel={onCancel}
      pending={pending}
      pristine={pristine}
      formError={formError}
      notes={
        deposit?.origin === 'import' ? <WorkbookCallout /> : deposit ? null : <NewAppDataNote />
      }
    >
      <Grid>
        <GridItem span={6}>
          <Select
            label="Stream"
            value={streamId}
            onChange={setStreamId}
            options={options}
            placeholder="Choose a stream"
            required
            error={errors.streamId}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={6}>
          <DateField
            label="Date"
            value={date}
            onChange={setDate}
            max={tomorrowOf(today)}
            required
            error={errors.date}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={6}>
          <MoneyField
            label="Amount"
            value={amount}
            onChange={setAmount}
            allowNegative
            required
            hint="Negative for a reversal; zero is not allowed"
            error={errors.amountCents}
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
