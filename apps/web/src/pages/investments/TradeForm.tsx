// The trade form (stage-2.md §6.6, D38): add or edit one trade in an inline card. Units or an
// amount (units = amount ÷ price, rounded down per kind; the fee is on top), the holding's price
// and default fee pre-filled, a crypto % fee, a live preview, and Save disabled while the form is
// pristine or saving (so a double click sends one request and an unchanged row is never PUT).
import {
  TRADE_DECIMAL_MAX_DP,
  type InstrumentKind,
  type QuantityMode,
  type TradeRowDto,
  type TradeSide,
} from '@joinr/schema';
import {
  Button,
  Callout,
  Card,
  Cluster,
  DateField,
  Grid,
  GridItem,
  MoneyField,
  NumberField,
  Select,
  Switch,
  TextField,
  formatDate,
  toIsoDate,
  type SelectOption,
} from '@joinr/ui';
import { Save } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';
import { useCreateTrade, useUpdateTrade } from '../../api/hooks';
import { formatHoldingPrice, formatUnits } from './display';
import { KIND_META } from './kinds';
import { Segmented } from './Segmented';
import { forgetLegacyEntryMode, readEntryMode, writeEntryMode } from './storage';
import {
  NOTE_MAX,
  draftFromTrade,
  newTradeDraft,
  percentMaxDp,
  previewText,
  sameDraft,
  tradeApiErrors,
  tradeBody,
  tradePreview,
  validateTradeDraft,
  withHolding,
  type TouchedField,
  type TradeDraft,
  type TradeField,
  type TradeHolding,
} from './tradeDraft';

export const WORKBOOK_ROW_NOTE =
  'This row came from the workbook. Saving (or deleting) it counts as an app edit: re-importing the workbook will then be blocked.';

const SIDE_OPTIONS = [
  { value: 'buy', label: 'Buy' },
  { value: 'sell', label: 'Sell' },
] as const;

const MODE_OPTIONS = [
  { value: 'units', label: 'Units' },
  { value: 'amount', label: 'Amount' },
] as const;

const STATUS_WORDS = { held: '', watching: ' (watching)', exited: ' (exited)' } as const;

export interface TradeFormProps {
  kind: InstrumentKind;
  /** The holdings to choose from: held, watching and exited instruments of the kind. */
  holdings: readonly TradeHolding[];
  /** Edit this trade (the holding cannot change). */
  trade?: TradeRowDto;
  /** A new trade on a holding's page starts with that holding. */
  preselectedId?: number;
  onDone: (message: string) => void;
  onCancel: () => void;
}

export function TradeForm({
  kind,
  holdings,
  trade,
  preselectedId,
  onDone,
  onCancel,
}: TradeFormProps): JSX.Element {
  const [today] = useState(() => toIsoDate(new Date()));
  const [initial] = useState<TradeDraft>(() =>
    trade
      ? draftFromTrade(trade)
      : newTradeDraft(
          holdings.find((h) => h.instrumentId === preselectedId),
          kind,
          today,
          readEntryMode,
        ),
  );
  const [draft, setDraft] = useState<TradeDraft>(initial);
  const [touched, setTouched] = useState<ReadonlySet<TouchedField>>(() => new Set());
  const [errors, setErrors] = useState<Partial<Record<TradeField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const create = useCreateTrade();
  const update = useUpdateTrade();
  const submitting = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);

  const pending = create.isPending || update.isPending;
  const pristine = sameDraft(draft, initial);
  const feeMaxDp = percentMaxDp(initial.feePercent);
  const holding = holdings.find((h) => h.instrumentId === draft.instrumentId);
  const meta = KIND_META[kind];
  const preview = tradePreview(draft, kind, feeMaxDp);

  // D47: the Units / Amount choice is remembered per holding; the old browser-wide key goes.
  useEffect(() => forgetLegacyEntryMode(), []);

  // Bring the form into view and put the cursor in its first field (the PricesPage pattern).
  useEffect(() => {
    const form = formRef.current;
    form?.scrollIntoView?.({ block: 'nearest' });
    form
      ?.querySelector<HTMLElement>(
        'select:not([disabled]), input:not([disabled]):not([type="hidden"])',
      )
      ?.focus();
  }, []);

  const set = <K extends keyof TradeDraft>(key: K, value: TradeDraft[K]): void => {
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const touch = (field: TouchedField): void => {
    setTouched((current) => (current.has(field) ? current : new Set([...current, field])));
  };

  const onHolding = (value: string): void => {
    const next = holdings.find((h) => String(h.instrumentId) === value);
    if (next) setDraft((current) => withHolding(current, next, kind, touched, readEntryMode));
  };

  const onMode = (mode: QuantityMode): void => {
    set('mode', mode);
    touch('mode');
    // D47: remembered for the holding it was chosen on (none chosen yet: on Save, below).
    if (draft.instrumentId !== null) writeEntryMode(draft.instrumentId, mode);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (submitting.current || pending || pristine) return;
    const found = validateTradeDraft(draft, kind, feeMaxDp);
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return;
    const body = tradeBody(
      draft,
      feeMaxDp,
      trade ? { fee: trade.fee, feeTouched: touched.has('fee') } : undefined,
    );
    submitting.current = true;
    const handlers = {
      onSuccess: () => {
        // An explicit choice made before the holding (or kept across a holding change) belongs to
        // the holding the trade was saved on.
        if (touched.has('mode')) writeEntryMode(body.instrumentId, body.quantity.mode);
        onDone(trade ? 'Trade updated' : 'Trade added');
      },
      onError: (error: Error) => {
        const split = tradeApiErrors(error, draft.mode);
        setErrors(split.fields);
        setFormError(split.form);
      },
      onSettled: () => {
        submitting.current = false;
      },
    };
    if (trade) update.mutate({ id: trade.id, body }, handlers);
    else create.mutate(body, handlers);
  };

  const holdingOptions: SelectOption[] = holdings.map((h) => ({
    value: String(h.instrumentId),
    label: `${h.symbol}${STATUS_WORDS[h.status]}`,
  }));

  const title = trade ? `Edit trade · ${trade.symbol} ${formatDate(trade.tradeDate)}` : 'Add trade';
  const sellHint =
    draft.side === 'sell' && holding
      ? `Held now: ${formatUnits(holding.units, kind)} units`
      : undefined;
  const currentPrice = holding?.price.price ?? null;
  const priceHint =
    currentPrice === null ? undefined : `Current price ${formatHoldingPrice(currentPrice, kind)}`;
  const rateFee = kind === 'crypto' && draft.feeMode === 'rate';
  const feeHint = !touched.has('fee') && !trade && holding ? 'Default for this holding' : undefined;

  return (
    <Card as="section" title={title} subtitle={meta.title}>
      <form
        ref={formRef}
        className="jf-app-form"
        onSubmit={onSubmit}
        noValidate
        aria-label={title}
        aria-busy={pending || undefined}
      >
        <Grid>
          <GridItem span={4}>
            <Select
              label="Holding"
              value={draft.instrumentId === null ? '' : String(draft.instrumentId)}
              onChange={onHolding}
              options={holdingOptions}
              placeholder="Choose a holding"
              required
              disabled={pending || trade !== undefined}
              error={errors.instrumentId}
            />
          </GridItem>
          <GridItem span={4}>
            <Segmented<TradeSide>
              label="Side"
              options={SIDE_OPTIONS}
              value={draft.side}
              onChange={(side) => set('side', side)}
              hint={sellHint}
              error={errors.side}
              disabled={pending}
            />
          </GridItem>
          <GridItem span={4}>
            <DateField
              label="Date"
              value={draft.tradeDate}
              onChange={(date) => set('tradeDate', date)}
              max={today}
              required
              error={errors.tradeDate}
              disabled={pending}
            />
          </GridItem>
          <GridItem span={4}>
            <Segmented<QuantityMode>
              label="Entry"
              options={MODE_OPTIONS}
              value={draft.mode}
              onChange={onMode}
              hint={
                draft.mode === 'amount'
                  ? 'Units = amount ÷ price, rounded down; the fee is on top'
                  : undefined
              }
              disabled={pending}
            />
          </GridItem>
          <GridItem span={4}>
            {draft.mode === 'units' ? (
              <NumberField
                label="Units"
                value={draft.units}
                onChange={(units) => set('units', units)}
                maxDp={TRADE_DECIMAL_MAX_DP}
                required
                error={errors.units}
                disabled={pending}
              />
            ) : (
              <MoneyField
                label="Amount"
                value={draft.amountCents}
                onChange={(cents) => set('amountCents', cents)}
                required
                error={errors.amountCents}
                disabled={pending}
              />
            )}
          </GridItem>
          <GridItem span={4}>
            <NumberField
              label="Price per unit"
              value={draft.price}
              onChange={(price) => {
                set('price', price);
                touch('price');
              }}
              maxDp={TRADE_DECIMAL_MAX_DP}
              hint={priceHint}
              required
              error={errors.price}
              disabled={pending}
            />
          </GridItem>
          <GridItem span={6}>
            <div className="jf-app-block jf-app-block--tight">
              {rateFee ? (
                <NumberField
                  label="Fee %"
                  value={draft.feePercent}
                  onChange={(percent) => {
                    set('feePercent', percent);
                    touch('fee');
                  }}
                  maxDp={feeMaxDp}
                  suffix="%"
                  hint={feeHint}
                  required
                  error={errors.fee}
                  disabled={pending}
                />
              ) : (
                <MoneyField
                  label="Fee"
                  value={draft.feeCents}
                  onChange={(cents) => {
                    set('feeCents', cents);
                    touch('fee');
                  }}
                  hint={feeHint}
                  required
                  error={errors.fee}
                  disabled={pending}
                />
              )}
              {kind === 'crypto' ? (
                <Switch
                  label="Flat fee instead"
                  checked={draft.feeMode === 'flat'}
                  onChange={(flat) => {
                    set('feeMode', flat ? 'flat' : 'rate');
                    touch('fee');
                  }}
                  disabled={pending}
                />
              ) : null}
            </div>
          </GridItem>
          <GridItem span={6}>
            <TextField
              label="Note"
              value={draft.note}
              onChange={(note) => set('note', note)}
              maxLength={NOTE_MAX}
              hint="Optional"
              error={errors.note}
              disabled={pending}
            />
          </GridItem>
        </Grid>
        <p className="jf-app-preview" aria-live="polite" data-testid="trade-preview">
          {preview ? previewText(preview, kind) : null}
        </p>
        {trade?.origin === 'import' ? (
          <Callout kind="important" title="Workbook row">
            <p>{WORKBOOK_ROW_NOTE}</p>
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
          <Button variant="ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
        </Cluster>
      </form>
    </Card>
  );
}
