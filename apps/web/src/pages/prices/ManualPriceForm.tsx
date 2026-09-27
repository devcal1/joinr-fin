// "Set price": a manual AUD price for one instrument, with its date and a note (stage-1.md §6.5).
import type { PriceItem } from '@joinr/schema';
import {
  Button,
  Callout,
  Card,
  Cluster,
  DateField,
  Grid,
  GridItem,
  NumberField,
  TextField,
  toIsoDate,
} from '@joinr/ui';
import { Save, Trash2 } from 'lucide-react';
import { useState, type FormEvent, type JSX } from 'react';
import { useClearManualPrice, useSetManualPrice } from '../../api/hooks';
import { NOTE_MAX, splitApiErrors, validateManualPrice, type ManualPriceField } from './validation';
import { escapeCancels } from '../../components/keyboard';

/** Tomorrow's local calendar date (the API accepts as-of dates up to tomorrow). */
function tomorrowIso(now: Date): string {
  return toIsoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
}

export interface ManualPriceFormProps {
  item: PriceItem;
  /** Called after a save or a clear, with a message for the page. */
  onDone: (message: string) => void;
  onCancel: () => void;
}

export function ManualPriceForm({ item, onDone, onCancel }: ManualPriceFormProps): JSX.Element {
  const now = new Date();
  const [price, setPrice] = useState(item.manual?.price ?? '');
  const [asOf, setAsOf] = useState<string | null>(item.manual?.asOf ?? toIsoDate(now));
  const [note, setNote] = useState(item.manual?.note ?? '');
  const [errors, setErrors] = useState<Partial<Record<ManualPriceField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const save = useSetManualPrice();
  const clear = useClearManualPrice();
  const busy = save.isPending || clear.isPending;

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const found = validateManualPrice(price, asOf);
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0 || !asOf) return;
    const trimmed = note.trim();
    save.mutate(
      {
        instrumentId: item.instrumentId,
        input: { price, asOf, ...(trimmed ? { note: trimmed } : {}) },
      },
      {
        onSuccess: () => onDone(`Manual price saved for ${item.symbol}.`),
        onError: (error) => {
          const split = splitApiErrors(error, ['price', 'asOf', 'note'] as const);
          setErrors(split.fields);
          setFormError(split.form);
        },
      },
    );
  };

  const onClear = (): void => {
    setFormError(null);
    clear.mutate(item.instrumentId, {
      onSuccess: () => onDone(`Manual price cleared for ${item.symbol}.`),
      onError: (error) => setFormError(splitApiErrors(error, []).form),
    });
  };

  return (
    <Card
      as="section"
      title={`Set price · ${item.symbol}`}
      subtitle="A manual price wins over fetched prices until you clear it."
    >
      <form
        className="jf-app-form"
        onSubmit={onSubmit}
        onKeyDown={escapeCancels(onCancel, busy)}
        noValidate
        aria-label={`Set price for ${item.symbol}`}
      >
        <Grid>
          <GridItem span={4}>
            <NumberField
              label="Price (AUD)"
              value={price}
              onChange={setPrice}
              maxDp={8}
              required
              error={errors.price}
              disabled={busy}
            />
          </GridItem>
          <GridItem span={4}>
            <DateField
              label="As of"
              value={asOf}
              onChange={setAsOf}
              max={tomorrowIso(now)}
              required
              error={errors.asOf}
              disabled={busy}
            />
          </GridItem>
          <GridItem span={4}>
            <TextField
              label="Note"
              value={note}
              onChange={setNote}
              maxLength={NOTE_MAX}
              hint="Optional, e.g. where the price came from"
              error={errors.note}
              disabled={busy}
            />
          </GridItem>
        </Grid>
        {formError ? (
          <Callout kind="do-not" title="Not saved">
            <p>{formError}</p>
          </Callout>
        ) : null}
        <Cluster gap={3}>
          <Button
            type="submit"
            variant="primary"
            icon={Save}
            disabled={busy}
            aria-busy={save.isPending || undefined}
          >
            Save
          </Button>
          {item.manual ? (
            <Button
              variant="danger"
              icon={Trash2}
              onClick={onClear}
              disabled={busy}
              aria-busy={clear.isPending || undefined}
            >
              Clear manual price
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        </Cluster>
      </form>
    </Card>
  );
}
