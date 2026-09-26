// The sale form (stage-4.md §6.3 item 4, D72): sale date, units (at most the units left), the AUD
// proceeds received and a note. The row's realised gain appears after saving; a sale past the
// units left answers 422 SALE_OVERSELL, shown as the server's words ("Only N units are left to
// sell") in a Do-not callout.
import type { OtherAssetDto, OtherAssetSaleDto } from '@joinr/schema';
import {
  DateField,
  Grid,
  GridItem,
  MoneyField,
  NumberField,
  TextField,
  formatQuantity,
  toIsoDate,
} from '@joinr/ui';
import { useState, type JSX } from 'react';
import { useCreateOtherAssetSale, useUpdateOtherAssetSale } from '../../api/hooks';
import { tomorrowOf } from '../cashflow/display';
import { InlineForm, NewAppDataNote } from '../cashflow/forms';
import { formErrorsOf } from '../cashflow/formState';
import { shortName } from '../assets/display';
import { sellableUnits } from './otherAssetsText';

type SaleField = 'saleDate' | 'units' | 'proceedsCents' | 'note';
const SALE_FIELDS: readonly SaleField[] = ['saleDate', 'units', 'proceedsCents', 'note'];

export interface SaleFormProps {
  asset: OtherAssetDto;
  sale?: OtherAssetSaleDto;
  onDone: (message: string) => void;
  onCancel: () => void;
}

export function SaleForm({ asset, sale, onDone, onCancel }: SaleFormProps): JSX.Element {
  const [today] = useState(() => toIsoDate(new Date()));
  const [saleDate, setSaleDate] = useState<string | null>(sale?.saleDate ?? today);
  const [units, setUnits] = useState(sale?.units ?? '');
  const [proceeds, setProceeds] = useState<number | null>(sale?.proceedsCents ?? null);
  const [note, setNote] = useState(sale?.note ?? '');
  const [errors, setErrors] = useState<Partial<Record<SaleField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const create = useCreateOtherAssetSale();
  const update = useUpdateOtherAssetSale();
  const pending = create.isPending || update.isPending;
  const max = sellableUnits(asset, sale);
  const name = shortName(asset.description);

  const pristine = sale
    ? saleDate === sale.saleDate &&
      Number(units) === Number(sale.units) &&
      proceeds === sale.proceedsCents &&
      (note.trim() || null) === sale.note
    : units === '' && proceeds === null && note.trim() === '';

  const submit = (): boolean => {
    const found: Partial<Record<SaleField, string>> = {};
    if (!saleDate) found.saleDate = 'Enter the sale date.';
    else if (saleDate > tomorrowOf(today)) found.saleDate = 'Enter a date no later than tomorrow.';
    if (units === '') found.units = 'Enter the units sold.';
    else if (!(Number(units) > 0)) found.units = 'Enter more than zero units.';
    else if (Number(units) > max) {
      found.units = `Only ${formatQuantity(max)} ${max === 1 ? 'unit is' : 'units are'} left to sell.`;
    }
    if (proceeds === null) found.proceedsCents = 'Enter the proceeds received.';
    if (note.trim().length > 200) found.note = 'Use at most 200 characters.';
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0 || !saleDate || proceeds === null) return false;
    const body = { saleDate, units, proceedsCents: proceeds, note: note.trim() || null };
    const onError = (error: Error): void => {
      const split = formErrorsOf<SaleField>(error, SALE_FIELDS);
      setErrors(split.fields);
      setFormError(split.form);
    };
    if (sale) {
      update.mutate({ id: sale.id, body }, { onSuccess: () => onDone('Sale recorded'), onError });
    } else {
      create.mutate(
        { assetId: asset.id, body },
        { onSuccess: () => onDone('Sale recorded'), onError },
      );
    }
    return true;
  };

  return (
    <InlineForm
      title={sale ? `Edit sale · ${name}` : `Sell · ${name}`}
      subtitle={`${formatQuantity(max)} ${max === 1 ? 'unit' : 'units'} left to sell`}
      onSubmit={submit}
      onCancel={onCancel}
      pending={pending}
      pristine={pristine}
      formError={formError}
      notes={<NewAppDataNote />}
      saveLabel={sale ? 'Save sale' : 'Record sale'}
    >
      <Grid>
        <GridItem span={6}>
          <DateField
            label="Sale date"
            value={saleDate}
            onChange={setSaleDate}
            max={tomorrowOf(today)}
            required
            error={errors.saleDate}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={6}>
          <NumberField
            label="Units"
            value={units}
            onChange={setUnits}
            maxDp={8}
            required
            hint={`At most ${formatQuantity(max)}`}
            error={errors.units}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={6}>
          <MoneyField
            label="Proceeds received (AUD)"
            value={proceeds}
            onChange={setProceeds}
            required
            hint="What you received, after any fees"
            error={errors.proceedsCents}
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
