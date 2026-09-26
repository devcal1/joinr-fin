// The property form (stage-4.md §6.5 item 4, §6.7): name, purchase date, primary residence (D68),
// purchase price, net rent to date (may be negative, §11 fix 9) and a note; create adds the current
// value and its date (the opening valuation). Delete sits in the edit form, disabled while a loan
// references the property (409 PROPERTY_HAS_LOAN otherwise).
import type { PropertyDto } from '@joinr/schema';
import {
  Button,
  DateField,
  Grid,
  GridItem,
  MoneyField,
  Switch,
  TextField,
  toIsoDate,
} from '@joinr/ui';
import { Trash2 } from 'lucide-react';
import { useState, type JSX } from 'react';
import { useCreateProperty, useDeleteProperty, useUpdateProperty } from '../../api/hooks';
import { plural } from '../../formatting';
import { tomorrowOf } from '../cashflow/display';
import { DeleteConfirm, InlineForm, NewAppDataNote, WorkbookCallout } from '../cashflow/forms';
import { actionErrorText, formErrorsOf } from '../cashflow/formState';
import { NET_RENT_HINT, PRIMARY_RESIDENCE_NOTE } from './propertyText';

type Field =
  | 'name'
  | 'purchaseDate'
  | 'isPrimaryResidence'
  | 'purchaseValueCents'
  | 'netRentToDateCents'
  | 'note'
  | 'valueCents'
  | 'asOf';
const FIELDS: readonly Field[] = [
  'name',
  'purchaseDate',
  'isPrimaryResidence',
  'purchaseValueCents',
  'netRentToDateCents',
  'note',
  'valueCents',
  'asOf',
];

interface Draft {
  name: string;
  purchaseDate: string | null;
  isPrimaryResidence: boolean;
  purchaseValueCents: number | null;
  netRentToDateCents: number | null;
  note: string;
  valueCents: number | null;
  asOf: string | null;
}

function draftOf(property: PropertyDto | undefined, today: string): Draft {
  return {
    name: property?.name ?? '',
    purchaseDate: property?.purchaseDate ?? null,
    isPrimaryResidence: property?.isPrimaryResidence ?? false,
    purchaseValueCents: property?.purchaseValueCents ?? null,
    netRentToDateCents: property?.netRentToDateCents ?? null,
    note: property?.note ?? '',
    valueCents: null,
    asOf: today,
  };
}

export interface PropertyFormProps {
  property?: PropertyDto;
  onDone: (message: string) => void;
  onCancel: () => void;
}

export function PropertyForm({ property, onDone, onCancel }: PropertyFormProps): JSX.Element {
  const [today] = useState(() => toIsoDate(new Date()));
  const [draft, setDraft] = useState<Draft>(() => draftOf(property, today));
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const create = useCreateProperty();
  const update = useUpdateProperty();
  const remove = useDeleteProperty();
  const pending = create.isPending || update.isPending || remove.isPending;
  const loanCount = property?.loanIds.length ?? 0;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const pristine = property
    ? draft.name.trim() === property.name &&
      draft.purchaseDate === property.purchaseDate &&
      draft.isPrimaryResidence === property.isPrimaryResidence &&
      draft.purchaseValueCents === property.purchaseValueCents &&
      (draft.netRentToDateCents ?? 0) === property.netRentToDateCents &&
      (draft.note.trim() || null) === property.note
    : draft.name.trim() === '' && draft.purchaseValueCents === null && draft.valueCents === null;

  const submit = (): boolean => {
    const found: Partial<Record<Field, string>> = {};
    const name = draft.name.trim();
    if (!name) found.name = 'Enter a name.';
    else if (name.length > 80) found.name = 'Use at most 80 characters.';
    if (draft.purchaseDate && draft.purchaseDate > tomorrowOf(today)) {
      found.purchaseDate = 'Enter a date no later than tomorrow.';
    }
    if (draft.purchaseValueCents === null) found.purchaseValueCents = 'Enter the purchase price.';
    if (draft.note.trim().length > 200) found.note = 'Use at most 200 characters.';
    if (!property) {
      if (draft.valueCents === null) found.valueCents = 'Enter the current value.';
      if (!draft.asOf) found.asOf = 'Enter the date of the value.';
      else if (draft.asOf > tomorrowOf(today)) found.asOf = 'Enter a date no later than tomorrow.';
    }
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return false;
    const base = {
      name,
      purchaseDate: draft.purchaseDate,
      isPrimaryResidence: draft.isPrimaryResidence,
      purchaseValueCents: draft.purchaseValueCents ?? 0,
      netRentToDateCents: draft.netRentToDateCents ?? 0,
      note: draft.note.trim() || null,
    };
    const onError = (error: Error): void => {
      const split = formErrorsOf<Field>(error, FIELDS);
      setErrors(split.fields);
      setFormError(split.form);
    };
    if (property) {
      update.mutate(
        { id: property.id, body: base },
        { onSuccess: () => onDone('Property saved'), onError },
      );
    } else {
      create.mutate(
        { ...base, valueCents: draft.valueCents ?? 0, asOf: draft.asOf ?? today },
        { onSuccess: () => onDone('Property saved'), onError },
      );
    }
    return true;
  };

  const confirmDelete = (): void => {
    if (!property) return;
    setFormError(null);
    remove.mutate(property.id, {
      onSuccess: () => onDone('Property deleted'),
      onError: (error) => {
        setConfirming(false);
        setFormError(actionErrorText(error));
      },
    });
  };

  const deleteButton = property ? (
    confirming ? (
      <DeleteConfirm
        question={`Delete ${property.name} and its valuations?`}
        label={`property ${property.name}`}
        busy={remove.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setConfirming(false)}
      />
    ) : (
      <Button
        variant="ghost"
        icon={Trash2}
        onClick={() => setConfirming(true)}
        disabled={pending || loanCount > 0}
        aria-describedby={loanCount > 0 ? 'property-has-loan' : undefined}
      >
        Delete property
      </Button>
    )
  ) : null;

  return (
    <InlineForm
      title={property ? `Edit property · ${property.name}` : 'Add property'}
      subtitle="Property"
      onSubmit={submit}
      onCancel={onCancel}
      pending={pending}
      pristine={pristine}
      formError={formError}
      extraActions={deleteButton}
      notes={
        <>
          {property?.origin === 'import' ? <WorkbookCallout /> : <NewAppDataNote />}
          {loanCount > 0 ? (
            <p id="property-has-loan" className="jf-app-meta">
              This property has {plural(loanCount, 'loan')}; delete them first.
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
            onChange={(value) => set('name', value)}
            maxLength={80}
            required
            error={errors.name}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={6}>
          <DateField
            label="Purchase date"
            value={draft.purchaseDate}
            onChange={(date) => set('purchaseDate', date)}
            max={tomorrowOf(today)}
            hint="Optional: the annualised gain needs it"
            error={errors.purchaseDate}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={6}>
          <div className="jf-app-switch-field">
            <Switch
              label="Primary residence"
              checked={draft.isPrimaryResidence}
              onChange={(value) => set('isPrimaryResidence', value)}
              hint={PRIMARY_RESIDENCE_NOTE}
              disabled={pending}
            />
          </div>
        </GridItem>
        <GridItem span={6}>
          <MoneyField
            label="Purchase price"
            value={draft.purchaseValueCents}
            onChange={(cents) => set('purchaseValueCents', cents)}
            required
            error={errors.purchaseValueCents}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={6}>
          <MoneyField
            label="Net rent to date"
            value={draft.netRentToDateCents}
            onChange={(cents) => set('netRentToDateCents', cents)}
            allowNegative
            hint={NET_RENT_HINT}
            error={errors.netRentToDateCents}
            disabled={pending}
          />
        </GridItem>
        {property ? null : (
          <>
            <GridItem span={6}>
              <MoneyField
                label="Current value"
                value={draft.valueCents}
                onChange={(cents) => set('valueCents', cents)}
                required
                error={errors.valueCents}
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
