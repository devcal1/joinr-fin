// The asset form (stage-4.md §6.3 item 4, §6.7): an inline Card to add or edit an item. Priced by
// "My valuation" (hand-priced, D72) or "Bullion spot" (spot × oz per unit, priced in AUD, no FX at
// purchase and no price fields). FX at purchase shows for a foreign currency only and is blanked
// when the currency or the purchase date changes; GBX asks for AUD per 1 GBP. Delete sits in the
// edit form with an inline confirm.
import { METALS, type Metal, type OtherAssetDto } from '@joinr/schema';
import {
  Button,
  DateField,
  Grid,
  GridItem,
  NumberField,
  Select,
  TextField,
  toIsoDate,
} from '@joinr/ui';
import { Trash2 } from 'lucide-react';
import { useState, type JSX } from 'react';
import { useCreateOtherAsset, useDeleteOtherAsset, useUpdateOtherAsset } from '../../api/hooks';
import { tomorrowOf } from '../cashflow/display';
import { DeleteConfirm, InlineForm, NewAppDataNote, WorkbookCallout } from '../cashflow/forms';
import { actionErrorText, formErrorsOf } from '../cashflow/formState';
import { Segmented } from '../investments/Segmented';
import { fxQuoteCurrency, shortName } from '../assets/display';
import {
  ASSET_FIELDS,
  applyAssetChange,
  assetCreateBody,
  assetDraftOf,
  assetUnchanged,
  assetUpdateBody,
  currencyOptions,
  validateAsset,
  type AssetDraft,
  type AssetField,
} from './assetDraft';
import { METAL_LABELS } from './otherAssetsText';

const PRICED_BY = [
  { value: 'manual', label: 'My valuation' },
  { value: 'bullion', label: 'Bullion spot' },
] as const;

export const PURCHASE_DATE_HINT = 'Leave blank if unknown: the first recorded month is assumed';

export interface AssetFormProps {
  asset?: OtherAssetDto;
  onDone: (message: string) => void;
  onCancel: () => void;
}

export function AssetForm({ asset, onDone, onCancel }: AssetFormProps): JSX.Element {
  const [today] = useState(() => toIsoDate(new Date()));
  const [draft, setDraft] = useState<AssetDraft>(() => assetDraftOf(asset, today));
  const [errors, setErrors] = useState<Partial<Record<AssetField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const create = useCreateOtherAsset();
  const update = useUpdateOtherAsset();
  const remove = useDeleteOtherAsset();
  const pending = create.isPending || update.isPending || remove.isPending;
  const bullion = draft.priceSource === 'bullion';
  const foreign = !bullion && draft.currency !== 'AUD';
  const quote = fxQuoteCurrency(draft.currency);

  const pristine = asset
    ? assetUnchanged(draft, asset)
    : draft.description.trim() === '' && draft.units === '' && draft.unitCost === '';

  const set = <K extends keyof AssetDraft>(key: K, value: AssetDraft[K]): void => {
    setDraft((current) => applyAssetChange(current, key, value));
  };

  const onError = (error: Error): void => {
    const split = formErrorsOf<AssetField>(error, ASSET_FIELDS, { 'price.unitPrice': 'price' });
    setErrors(split.fields);
    setFormError(split.form);
  };

  const submit = (): boolean => {
    const found = validateAsset(draft, { create: !asset, today });
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return false;
    if (asset) {
      update.mutate(
        { id: asset.id, body: assetUpdateBody(draft, asset) },
        { onSuccess: () => onDone('Asset saved'), onError },
      );
    } else {
      create.mutate(assetCreateBody(draft), { onSuccess: () => onDone('Asset saved'), onError });
    }
    return true;
  };

  const confirmDelete = (): void => {
    if (!asset) return;
    setFormError(null);
    remove.mutate(asset.id, {
      onSuccess: () => onDone('Asset deleted'),
      onError: (error) => {
        setConfirming(false);
        setFormError(actionErrorText(error));
      },
    });
  };

  const name = asset ? shortName(asset.description) : '';
  const deleteButton = asset ? (
    confirming ? (
      <DeleteConfirm
        question={`Delete ${name} with its prices and sales?`}
        label={`item ${name}`}
        busy={remove.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setConfirming(false)}
      />
    ) : (
      <Button variant="ghost" icon={Trash2} onClick={() => setConfirming(true)} disabled={pending}>
        Delete item
      </Button>
    )
  ) : null;

  // One or the other (§6.7): the workbook callout on an imported row, else the app-data note.
  const notes = asset?.origin === 'import' ? <WorkbookCallout /> : <NewAppDataNote />;

  return (
    <InlineForm
      title={asset ? `Edit item · ${name}` : 'Add asset'}
      subtitle="Other assets"
      onSubmit={submit}
      onCancel={onCancel}
      pending={pending}
      pristine={pristine}
      formError={formError}
      extraActions={deleteButton}
      notes={notes}
    >
      <Grid>
        <GridItem span={6}>
          <TextField
            label="Description"
            value={draft.description}
            onChange={(value) => set('description', value)}
            maxLength={200}
            required
            error={errors.description}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={6}>
          <TextField
            label="Valuation source"
            value={draft.url}
            onChange={(value) => set('url', value)}
            maxLength={500}
            hint="Optional: a link to where you value it (http:// or https://)"
            error={errors.url}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={12}>
          <Segmented
            label="Priced by"
            options={PRICED_BY}
            value={draft.priceSource}
            onChange={(value) => set('priceSource', value)}
            hint={
              bullion
                ? 'Priced from the spot price (AUD per ounce) × the ounces in each unit'
                : 'You enter its price; it goes stale after the days set below'
            }
            error={errors.priceSource}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={4}>
          <DateField
            label="Purchase date"
            value={draft.purchaseDate}
            onChange={(date) => set('purchaseDate', date)}
            max={tomorrowOf(today)}
            hint={PURCHASE_DATE_HINT}
            error={errors.purchaseDate}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={4}>
          <NumberField
            label="Units"
            value={draft.units}
            onChange={(value) => set('units', value)}
            maxDp={8}
            required
            error={errors.units}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={4}>
          <Select
            label="Currency"
            value={bullion ? 'AUD' : draft.currency}
            onChange={(value) => set('currency', value)}
            options={currencyOptions(asset?.currency ?? null)}
            hint={bullion ? 'Bullion is priced in AUD' : undefined}
            error={errors.currency}
            disabled={pending || bullion}
          />
        </GridItem>
        <GridItem span={4}>
          <NumberField
            label="Unit cost"
            value={draft.unitCost}
            onChange={(value) => set('unitCost', value)}
            maxDp={8}
            suffix={bullion ? 'AUD' : draft.currency}
            hint={`Per unit, in ${bullion ? 'AUD' : draft.currency}`}
            error={errors.unitCost}
            disabled={pending}
          />
        </GridItem>
        {foreign ? (
          <GridItem span={4}>
            <NumberField
              label="FX at purchase"
              value={draft.fxQuoted}
              onChange={(value) => set('fxQuoted', value)}
              maxDp={8}
              hint={`AUD per 1 ${quote} on the purchase date. Left blank, it is fetched from Yahoo.`}
              error={errors.purchaseFxRate}
              disabled={pending}
            />
          </GridItem>
        ) : null}
        {bullion ? (
          <>
            <GridItem span={4}>
              <Select
                label="Metal"
                value={draft.metal}
                onChange={(value) => set('metal', value as Metal)}
                options={METALS.map((metal) => ({ value: metal, label: METAL_LABELS[metal] }))}
                placeholder="Choose the metal"
                error={errors.metal}
                disabled={pending}
              />
            </GridItem>
            <GridItem span={4}>
              <NumberField
                label="Oz per unit"
                value={draft.ozPerUnit}
                onChange={(value) => set('ozPerUnit', value)}
                maxDp={8}
                suffix="oz"
                error={errors.ozPerUnit}
                disabled={pending}
              />
            </GridItem>
          </>
        ) : null}
        {!asset && !bullion ? (
          <>
            <GridItem span={4}>
              <NumberField
                label="Current price"
                value={draft.price}
                onChange={(value) => set('price', value)}
                maxDp={8}
                suffix={draft.currency}
                hint="Optional: per unit, today's value"
                error={errors.price}
                disabled={pending}
              />
            </GridItem>
            <GridItem span={4}>
              <DateField
                label="Price as of"
                value={draft.priceAsOf}
                onChange={(date) => set('priceAsOf', date)}
                max={tomorrowOf(today)}
                disabled={pending}
              />
            </GridItem>
          </>
        ) : null}
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
