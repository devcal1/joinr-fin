// The contribution form (stage-4.md §6.4 item 5, D71): Type (Salary sacrifice | After-tax), Date
// (the day the fund received it, for the cap), Fund ("Not assigned" allowed), Amount (pre-tax as on
// the payslip, or paid from take-home pay) and Note, with a hint naming the rates in use. Editing an
// imported entry asks for its type and pre-tax amount, pre-filled with the current reading.
import {
  type SuperContributionDto,
  type SuperContributionType,
  type SuperPageResponse,
} from '@joinr/schema';
import {
  DateField,
  Grid,
  GridItem,
  MoneyField,
  Select,
  TextField,
  formatMoney,
  toIsoDate,
} from '@joinr/ui';
import { useState, type JSX } from 'react';
import { useCreateSuperContribution, useUpdateSuperContribution } from '../../api/hooks';
import { tomorrowOf } from '../cashflow/display';
import { InlineForm, NewAppDataNote, WorkbookCallout } from '../cashflow/forms';
import { formErrorsOf } from '../cashflow/formState';
import { Segmented } from '../investments/Segmented';
import {
  CONTRIBUTION_TYPES,
  CONTRIBUTION_TYPE_LABELS,
  contributionRatesHint,
  importedReadingOf,
  marginalRateOf,
} from './superText';

type Field = 'kind' | 'date' | 'fundId' | 'amountCents' | 'note';
const FIELDS: readonly Field[] = ['kind', 'date', 'fundId', 'amountCents', 'note'];

const AMOUNT_LABELS: Readonly<Record<SuperContributionType, string>> = {
  salary_sacrifice: 'Pre-tax amount, as on your payslip',
  after_tax: 'Amount paid from your take-home pay',
};

/** The form's starting type and amount: an imported entry pre-fills with its current reading. */
function startOf(
  contribution: SuperContributionDto | undefined,
  reading: SuperContributionType,
): { kind: SuperContributionType; amount: number | null } {
  if (!contribution) return { kind: 'salary_sacrifice', amount: null };
  if (contribution.kind !== 'voluntary_contribution') {
    return { kind: contribution.kind, amount: contribution.amountCents };
  }
  return reading === 'salary_sacrifice'
    ? { kind: 'salary_sacrifice', amount: contribution.preTaxCents ?? contribution.amountCents }
    : { kind: 'after_tax', amount: contribution.amountCents };
}

export interface ContributionFormProps {
  page: SuperPageResponse;
  contribution?: SuperContributionDto;
  onDone: (message: string) => void;
  onCancel: () => void;
}

export function ContributionForm({
  page,
  contribution,
  onDone,
  onCancel,
}: ContributionFormProps): JSX.Element {
  const [today] = useState(() => toIsoDate(new Date()));
  const start = startOf(contribution, importedReadingOf(page));
  const imported = contribution?.kind === 'voluntary_contribution';
  const [kind, setKind] = useState<SuperContributionType>(start.kind);
  const [date, setDate] = useState<string | null>(contribution?.date ?? today);
  const [fundId, setFundId] = useState<string>(
    contribution?.fundId === null || contribution === undefined ? '' : String(contribution.fundId),
  );
  const [amount, setAmount] = useState<number | null>(start.amount);
  const [note, setNote] = useState(contribution?.note ?? '');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const create = useCreateSuperContribution();
  const update = useUpdateSuperContribution();
  const pending = create.isPending || update.isPending;

  // An imported entry becomes typed when saved (even unchanged figures): Save is always allowed.
  const pristine = contribution
    ? !imported &&
      kind === contribution.kind &&
      date === contribution.date &&
      fundId === (contribution.fundId === null ? '' : String(contribution.fundId)) &&
      amount === contribution.amountCents &&
      (note.trim() || null) === contribution.note
    : amount === null && note.trim() === '';

  const submit = (): boolean => {
    const found: Partial<Record<Field, string>> = {};
    if (!date) found.date = 'Enter the date.';
    else if (date > tomorrowOf(today)) found.date = 'Enter a date no later than tomorrow.';
    if (amount === null) found.amountCents = 'Enter the amount.';
    else if (amount <= 0) found.amountCents = 'Enter an amount above zero.';
    if (note.trim().length > 200) found.note = 'Use at most 200 characters.';
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0 || !date || amount === null) return false;
    const body = {
      fundId: fundId === '' ? null : Number(fundId),
      date,
      kind,
      amountCents: amount,
      note: note.trim() || null,
    };
    const onError = (error: Error): void => {
      const split = formErrorsOf<Field>(error, FIELDS);
      setErrors(split.fields);
      setFormError(split.form);
    };
    if (contribution) {
      update.mutate(
        { id: contribution.id, body },
        { onSuccess: () => onDone('Contribution saved'), onError },
      );
    } else {
      create.mutate(body, { onSuccess: () => onDone('Contribution saved'), onError });
    }
    return true;
  };

  return (
    <InlineForm
      title={contribution ? 'Edit contribution' : 'Add contribution'}
      subtitle="Super"
      onSubmit={submit}
      onCancel={onCancel}
      pending={pending}
      pristine={pristine}
      formError={formError}
      notes={contribution?.origin === 'import' ? <WorkbookCallout /> : <NewAppDataNote />}
    >
      <Grid>
        <GridItem span={12}>
          <Segmented
            label="Type"
            options={CONTRIBUTION_TYPES.map((value) => ({
              value,
              label: CONTRIBUTION_TYPE_LABELS[value],
            }))}
            value={kind}
            onChange={setKind}
            hint={contributionRatesHint(
              kind,
              marginalRateOf(page),
              page.statutory.contributionsTaxRatio,
            )}
            error={errors.kind}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={4}>
          <MoneyField
            label={AMOUNT_LABELS[kind]}
            value={amount}
            onChange={setAmount}
            required
            error={errors.amountCents}
            disabled={pending}
          />
          {imported && contribution ? (
            <p className="jf-app-meta">
              Imported as {formatMoney(contribution.amountCents)} take-home cost
            </p>
          ) : null}
        </GridItem>
        <GridItem span={4}>
          <DateField
            label="Date"
            value={date}
            onChange={setDate}
            max={tomorrowOf(today)}
            required
            hint="The date your fund received it, for the cap"
            error={errors.date}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={4}>
          <Select
            label="Fund"
            value={fundId}
            onChange={setFundId}
            options={[
              { value: '', label: 'Not assigned' },
              ...page.funds
                .filter((f) => !f.archived || String(f.id) === fundId)
                .map((f) => ({ value: String(f.id), label: f.name })),
            ]}
            error={errors.fundId}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={12}>
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
