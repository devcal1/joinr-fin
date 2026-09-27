// The holding form (stage-2.md §6.6): create a holding on the investment page, edit one on its
// detail page. The body starts from the DTO's editable fields and overlays only what the owner
// changed; percent fields convert as strings; client validation is the server's own schema, so
// field-path errors match. A default-fee-only change keeps re-import allowed (§3.3).
import {
  instrumentEditableFromDto,
  type InstrumentDto,
  type InstrumentEditable,
  type InstrumentKind,
} from '@joinr/schema';
import {
  Button,
  Callout,
  Card,
  Checkbox,
  Cluster,
  Grid,
  GridItem,
  MoneyField,
  NumberField,
  Select,
  Switch,
  TextField,
} from '@joinr/ui';
import { Save } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type JSX } from 'react';
import { useCreateInstrument, useUpdateInstrument } from '../../api/hooks';
import { feeText, percentWords } from './display';
import {
  EMPTY_EDITABLE,
  REGION_KEYS,
  REGION_LABELS,
  changedFields,
  draftFromEditable,
  editableFromDraft,
  holdingApiErrors,
  holdingFormErrors,
  onlyDefaultFeeChanged,
  percentLimits,
  regionsTotalRatio,
  type DrpChoice,
  type HoldingDraft,
  type HoldingField,
} from './holdingDraft';
import { KIND_META } from './kinds';
import { escapeCancels } from '../../components/keyboard';

export const WORKBOOK_HOLDING_NOTE =
  'This holding came from the workbook. Saving a change other than the default fee counts as an app edit: re-importing the workbook will then be blocked.';

const DRP_OPTIONS = [
  { value: 'unknown', label: 'Unknown' },
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

export interface HoldingFormProps {
  kind: InstrumentKind;
  /** Edit this holding; without it the form creates one. */
  instrument?: InstrumentDto;
  /** Focus the first field on mount (the inline create form). */
  autoFocus?: boolean;
  onDone: (message: string) => void;
  /** Create: close the form. Edit: omitted (Cancel then undoes the changes). */
  onCancel?: () => void;
}

export function HoldingForm({
  kind,
  instrument,
  autoFocus = false,
  onDone,
  onCancel,
}: HoldingFormProps): JSX.Element {
  const meta = KIND_META[kind];
  const create = instrument === undefined;
  const base: InstrumentEditable = useMemo(
    () => (instrument ? instrumentEditableFromDto(instrument) : EMPTY_EDITABLE),
    [instrument],
  );
  const [initial] = useState<HoldingDraft>(() => draftFromEditable(base, kind));
  const [draft, setDraft] = useState<HoldingDraft>(initial);
  const [errors, setErrors] = useState<Partial<Record<HoldingField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const createMutation = useCreateInstrument();
  const updateMutation = useUpdateInstrument();
  const submitting = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);

  const limits = percentLimits(initial);
  const changed = changedFields(draft, initial);
  const pristine = changed.size === 0;
  const pending = createMutation.isPending || updateMutation.isPending;
  const workbookEdit =
    instrument?.origin === 'import' && !pristine && !onlyDefaultFeeChanged(changed);
  const regionsTotal = meta.hasRegions ? regionsTotalRatio(draft, limits.regions) : null;

  useEffect(() => {
    if (!autoFocus) return;
    const form = formRef.current;
    form?.scrollIntoView?.({ block: 'nearest' });
    form?.querySelector<HTMLElement>('input:not([disabled]):not([type="hidden"])')?.focus();
  }, [autoFocus]);

  const set = <K extends keyof HoldingDraft>(key: K, value: HoldingDraft[K]): void => {
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const setRegion = (key: (typeof REGION_KEYS)[number], value: string): void => {
    setDraft((current) => ({ ...current, regions: { ...current.regions, [key]: value } }));
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (submitting.current || pending || pristine) return;
    setFormError(null);
    // Every problem shows on the first Save: the parse checks and the server's schema together.
    const found = holdingFormErrors(draft, initial, base, kind, limits, create);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const body = editableFromDraft(draft, initial, base, kind, limits);
    submitting.current = true;
    // mutateAsync, not mutate(vars, handlers): a save that changes the editable fields remounts
    // this form (its key) while the hook's invalidation refetches the detail, and the per-call
    // callbacks of an unmounted mutation observer never run. The parent's onDone must still run.
    const request = instrument
      ? updateMutation.mutateAsync({ id: instrument.id, body })
      : createMutation.mutateAsync({ ...body, kind, symbol: draft.symbol.trim() });
    request
      .then(
        () => onDone('Holding saved'),
        (error: unknown) => {
          const split = holdingApiErrors(error, kind);
          setErrors(split.fields);
          setFormError(split.form);
        },
      )
      .finally(() => {
        submitting.current = false;
      });
  };

  const cancel = (): void => {
    if (onCancel) {
      onCancel();
      return;
    }
    setDraft(initial);
    setErrors({});
    setFormError(null);
  };

  const feeField = draft.useGlobalFee ? null : kind === 'crypto' && draft.feeMode === 'rate' ? (
    <NumberField
      label="Default fee %"
      value={draft.feePercent}
      onChange={(value) => set('feePercent', value)}
      maxDp={limits.fee}
      suffix="%"
      error={errors.defaultFee}
      disabled={pending}
    />
  ) : (
    <MoneyField
      label="Default fee"
      value={draft.feeCents}
      onChange={(value) => set('feeCents', value)}
      error={errors.defaultFee}
      disabled={pending}
    />
  );

  const title = create ? `Add ${meta.noun}` : 'Holding settings';
  return (
    <Card as="section" title={title} subtitle={create ? meta.title : instrument.symbol}>
      <form
        ref={formRef}
        className="jf-app-form"
        onSubmit={onSubmit}
        onKeyDown={escapeCancels(cancel, pending || (!onCancel && pristine))}
        noValidate
        aria-label={create ? `Add ${meta.noun}` : `Holding settings for ${instrument.symbol}`}
        aria-busy={pending || undefined}
      >
        <Grid>
          {create ? (
            <GridItem span={4}>
              <TextField
                label="Symbol"
                value={draft.symbol}
                onChange={(value) => set('symbol', value)}
                hint={meta.symbolHint}
                maxLength={32}
                required
                error={errors.symbol}
                disabled={pending}
              />
            </GridItem>
          ) : null}
          <GridItem span={create ? 4 : 6}>
            <TextField
              label="Name"
              value={draft.name}
              onChange={(value) => set('name', value)}
              maxLength={120}
              error={errors.name}
              disabled={pending}
            />
          </GridItem>
          <GridItem span={create ? 4 : 6}>
            <TextField
              label="Currency"
              value={draft.quoteCurrency}
              onChange={(value) => set('quoteCurrency', value)}
              hint="The price's currency, usually AUD"
              maxLength={3}
              error={errors.quoteCurrency}
              disabled={pending}
            />
          </GridItem>
          <GridItem span={4}>
            <NumberField
              label="Target"
              value={draft.target}
              onChange={(value) => set('target', value)}
              maxDp={limits.target}
              suffix="%"
              hint="Share of this page's holdings"
              error={errors.targetRatio}
              disabled={pending}
            />
          </GridItem>
          {meta.hasSector ? (
            <GridItem span={4}>
              <TextField
                label="Sector"
                value={draft.sector}
                onChange={(value) => set('sector', value)}
                maxLength={60}
                error={errors.sector}
                disabled={pending}
              />
            </GridItem>
          ) : null}
          <GridItem span={4}>
            <div className="jf-app-switch-field">
              <Switch
                label="Watched"
                checked={draft.watched}
                onChange={(value) => set('watched', value)}
                hint="Watched holdings stay on the page when none are held"
                disabled={pending}
              />
            </div>
          </GridItem>
          {meta.hasRegions ? (
            <>
              <GridItem span={6}>
                <TextField
                  label="Location"
                  value={draft.location}
                  onChange={(value) => set('location', value)}
                  maxLength={60}
                  error={errors.location}
                  disabled={pending}
                />
              </GridItem>
              <GridItem span={6}>
                <NumberField
                  label="Management fee"
                  value={draft.mgmtFee}
                  onChange={(value) => set('mgmtFee', value)}
                  maxDp={limits.mgmtFee}
                  suffix="%"
                  hint="Per year"
                  error={errors.mgmtFeeRatio}
                  disabled={pending}
                />
              </GridItem>
              {REGION_KEYS.map((key) => (
                <GridItem key={key} span={3}>
                  <NumberField
                    label={`Region: ${REGION_LABELS[key]}`}
                    value={draft.regions[key]}
                    onChange={(value) => setRegion(key, value)}
                    maxDp={limits.regions}
                    suffix="%"
                    disabled={pending}
                  />
                </GridItem>
              ))}
              <GridItem span={12}>
                <p className="jf-app-meta" aria-live="polite" data-testid="regions-total">
                  {regionsTotal === null ? null : `Regions add up to ${percentWords(regionsTotal)}`}
                </p>
                {errors.regions ? (
                  <p className="jf-app-error" role="alert">
                    {errors.regions}
                  </p>
                ) : null}
              </GridItem>
            </>
          ) : null}
          <GridItem span={4}>
            <NumberField
              label="Dividend frequency (months)"
              value={draft.dividendFreq}
              onChange={(value) => set('dividendFreq', value)}
              maxDp={0}
              error={errors.dividendFreqMonths}
              disabled={pending}
            />
          </GridItem>
          <GridItem span={4}>
            <Select
              label="DRP"
              value={draft.drp}
              onChange={(value) => set('drp', value as DrpChoice)}
              options={DRP_OPTIONS}
              hint="Dividends reinvested"
              error={errors.drp}
              disabled={pending}
            />
          </GridItem>
          <GridItem span={4}>
            <div className="jf-app-block jf-app-block--tight">
              <Checkbox
                label="Use the global default fee"
                checked={draft.useGlobalFee}
                onChange={(value) => set('useGlobalFee', value)}
                hint={
                  instrument && draft.useGlobalFee
                    ? `Trades pre-fill ${feeText(instrument.effectiveDefaultFee)}`
                    : 'The fee a new trade pre-fills'
                }
                disabled={pending}
              />
              {kind === 'crypto' && !draft.useGlobalFee ? (
                <Switch
                  label="Flat fee instead"
                  checked={draft.feeMode === 'flat'}
                  onChange={(flat) => set('feeMode', flat ? 'flat' : 'rate')}
                  disabled={pending}
                />
              ) : null}
              {feeField}
              {draft.useGlobalFee && errors.defaultFee ? (
                <p className="jf-app-error" role="alert">
                  {errors.defaultFee}
                </p>
              ) : null}
            </div>
          </GridItem>
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
        {workbookEdit ? (
          <Callout kind="important" title="Workbook holding">
            <p>{WORKBOOK_HOLDING_NOTE}</p>
          </Callout>
        ) : null}
        {formError ? (
          <Callout kind="do-not" title="Not saved">
            <p>{formError}</p>
          </Callout>
        ) : null}
        <Cluster gap={3} className="jf-app-form-actions">
          <Button
            type="submit"
            variant="primary"
            icon={Save}
            disabled={pristine || pending}
            aria-busy={pending || undefined}
          >
            Save
          </Button>
          <Button variant="ghost" onClick={cancel} disabled={pending || (!onCancel && pristine)}>
            Cancel
          </Button>
        </Cluster>
      </form>
    </Card>
  );
}
