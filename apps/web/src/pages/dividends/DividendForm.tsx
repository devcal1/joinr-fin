// The dividend form (stage-3.md §6.6 items 3 and 5, §4.5 step 4, D50): add, edit, or confirm a
// Yahoo suggestion (pre-filled: holding, ex-date, the expected payment date, the estimate and the
// holding's DRP; the price at the ex-date is left blank so the server fills it from Yahoo and
// keeps it marked as not typed).
import {
  TRADE_DECIMAL_MAX_DP,
  type DividendInputBody,
  type DividendRowDto,
  type DividendSuggestionDto,
  type DividendsPageResponse,
} from '@joinr/schema';
import {
  Callout,
  DateField,
  Grid,
  GridItem,
  MoneyField,
  NumberField,
  Select,
  TextField,
  formatDate,
  formatPrice,
  toIsoDate,
} from '@joinr/ui';
import { useState, type JSX } from 'react';
import { useCreateDividend, useUpdateDividend } from '../../api/hooks';
import { tomorrowOf } from '../cashflow/display';
import { InlineForm, NewAppDataNote, WorkbookCallout } from '../cashflow/forms';
import { formErrorsOf } from '../cashflow/formState';
import { ESTIMATE_NOTE, holdingOptions } from './dividendsModel';

type Field =
  | 'instrumentId'
  | 'paymentDate'
  | 'exDate'
  | 'reinvested'
  | 'netAmountCents'
  | 'priceAtEx'
  | 'note';
const FIELDS: readonly Field[] = [
  'instrumentId',
  'paymentDate',
  'exDate',
  'reinvested',
  'netAmountCents',
  'priceAtEx',
  'note',
];

const REINVESTED_OPTIONS = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'unknown', label: 'Unknown' },
];

function reinvestedText(value: boolean | null): string {
  return value === null ? 'unknown' : value ? 'yes' : 'no';
}

function reinvestedValue(text: string): boolean | null {
  return text === 'yes' ? true : text === 'no' ? false : null;
}

function safePrice(price: string): string {
  try {
    return formatPrice(price, { maxDp: 4 });
  } catch {
    return price;
  }
}

interface Draft {
  instrumentId: string;
  paymentDate: string | null;
  exDate: string | null;
  reinvested: string;
  netAmountCents: number | null;
  priceAtEx: string;
  note: string;
}

function draftOf(
  dividend: DividendRowDto | undefined,
  suggestion: DividendSuggestionDto | undefined,
  today: string,
  preselected: number | undefined,
): Draft {
  if (suggestion) {
    return {
      instrumentId: String(suggestion.instrumentId),
      paymentDate: suggestion.expectedPaymentDate,
      exDate: suggestion.exDate,
      reinvested: reinvestedText(suggestion.reinvestedDefault),
      netAmountCents: suggestion.estimatedNetCents,
      priceAtEx: '',
      note: '',
    };
  }
  if (dividend) {
    return {
      instrumentId: dividend.instrumentId === null ? '' : String(dividend.instrumentId),
      paymentDate: dividend.paymentDate,
      exDate: dividend.exDate,
      reinvested: reinvestedText(dividend.reinvested),
      netAmountCents: dividend.netAmountCents,
      // A price filled from Yahoo stays blank, so saving keeps it filled rather than typed.
      priceAtEx: dividend.priceAtExManual && dividend.priceAtEx !== null ? dividend.priceAtEx : '',
      note: dividend.note ?? '',
    };
  }
  return {
    instrumentId: preselected === undefined ? '' : String(preselected),
    paymentDate: today,
    exDate: null,
    reinvested: 'unknown',
    netAmountCents: null,
    priceAtEx: '',
    note: '',
  };
}

function sameDraft(a: Draft, b: Draft): boolean {
  return (
    a.instrumentId === b.instrumentId &&
    a.paymentDate === b.paymentDate &&
    a.exDate === b.exDate &&
    a.reinvested === b.reinvested &&
    a.netAmountCents === b.netAmountCents &&
    a.priceAtEx.trim() === b.priceAtEx.trim() &&
    a.note.trim() === b.note.trim()
  );
}

export interface DividendFormProps {
  page: DividendsPageResponse;
  dividend?: DividendRowDto;
  suggestion?: DividendSuggestionDto;
  /** A new dividend starts with this holding (the ledger's holding filter). */
  preselectedId?: number;
  onDone: (message: string) => void;
  onCancel: () => void;
}

export function DividendForm({
  page,
  dividend,
  suggestion,
  preselectedId,
  onDone,
  onCancel,
}: DividendFormProps): JSX.Element {
  const [today] = useState(() => toIsoDate(new Date()));
  const [initial] = useState(() => draftOf(dividend, suggestion, today, preselectedId));
  const [draft, setDraft] = useState<Draft>(initial);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const create = useCreateDividend();
  const update = useUpdateDividend();
  const pending = create.isPending || update.isPending;
  // A confirmed suggestion can be saved as pre-filled; a new or edited row only once changed.
  const pristine = suggestion ? false : sameDraft(draft, initial);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const submit = (): boolean => {
    const found: Partial<Record<Field, string>> = {};
    if (!draft.instrumentId) found.instrumentId = 'Choose a holding.';
    if (!draft.paymentDate) found.paymentDate = 'Enter the payment date.';
    else if (draft.paymentDate > tomorrowOf(today)) {
      found.paymentDate = 'Enter a date no later than tomorrow.';
    }
    if (draft.exDate && draft.paymentDate && draft.exDate > draft.paymentDate) {
      found.exDate = 'The ex-date is on or before the payment date.';
    }
    if (draft.netAmountCents === null) found.netAmountCents = 'Enter the amount received.';
    else if (draft.netAmountCents === 0) found.netAmountCents = 'Enter an amount other than zero.';
    const price = draft.priceAtEx.trim();
    if (price !== '' && !(Number(price) > 0)) found.priceAtEx = 'Enter a price above zero.';
    if (draft.note.trim().length > 200) found.note = 'Use at most 200 characters.';
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0 || draft.netAmountCents === null || !draft.paymentDate) {
      return false;
    }
    const body: DividendInputBody = {
      instrumentId: Number(draft.instrumentId),
      paymentDate: draft.paymentDate,
      exDate: draft.exDate,
      reinvested: reinvestedValue(draft.reinvested),
      netAmountCents: draft.netAmountCents,
      ...(price === '' ? {} : { priceAtEx: price }),
      note: draft.note.trim() || null,
    };
    // mutateAsync, not mutate(…, callbacks): confirming the last due suggestion lets the refetch
    // drop it before the save settles, and TanStack Query skips the callbacks of an unmounted
    // observer; the promise still settles, so the editor always closes and announces.
    void (dividend ? update.mutateAsync({ id: dividend.id, body }) : create.mutateAsync(body)).then(
      () => onDone(dividend ? 'Dividend saved' : 'Dividend added'),
      (error: unknown) => {
        const split = formErrorsOf<Field>(error, FIELDS);
        setErrors(split.fields);
        setFormError(split.form);
      },
    );
    return true;
  };

  // A price that was not typed came from the workbook (an import row) or from Yahoo (an app row).
  const autoPrice =
    dividend && !dividend.priceAtExManual && dividend.priceAtEx !== null
      ? dividend.origin === 'import'
        ? `From the workbook: ${safePrice(dividend.priceAtEx)}. Left blank, Yahoo's close replaces it when one is known`
        : `Filled from Yahoo: ${safePrice(dividend.priceAtEx)}. Left blank, it stays filled from Yahoo`
      : null;
  const priceHint = suggestion
    ? suggestion.priceAtEx === null
      ? 'No Yahoo close before the ex-date; left blank, the yield stays empty'
      : `Yahoo close before the ex-date: ${safePrice(suggestion.priceAtEx)}; left blank, it is filled from Yahoo`
    : (autoPrice ?? 'Filled from Yahoo when left blank and an ex-date is known');

  const title = suggestion
    ? `Confirm · ${suggestion.symbol} ex-date ${formatDate(suggestion.exDate)}`
    : dividend
      ? `Edit dividend · ${dividend.symbol ?? dividend.ticker} ${formatDate(dividend.paymentDate)}`
      : 'Add dividend';

  const options = holdingOptions(page.holdings);
  return (
    <InlineForm
      title={title}
      subtitle="Dividends"
      onSubmit={submit}
      onCancel={onCancel}
      pending={pending}
      pristine={pristine}
      formError={formError}
      saveLabel={suggestion ? 'Add dividend' : 'Save'}
      notes={
        <>
          {suggestion ? (
            <Callout kind="note" title="Estimate">
              <p>{ESTIMATE_NOTE}</p>
            </Callout>
          ) : null}
          {dividend?.origin === 'import' ? (
            <WorkbookCallout />
          ) : dividend ? null : (
            <NewAppDataNote />
          )}
        </>
      }
    >
      <Grid>
        <GridItem span={4}>
          <Select
            label="Holding"
            value={draft.instrumentId}
            onChange={(value) => set('instrumentId', value)}
            options={options}
            placeholder="Choose a holding"
            required
            hint={
              dividend && dividend.instrumentId === null
                ? `Not linked: typed as “${dividend.ticker}”`
                : undefined
            }
            error={errors.instrumentId}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={4}>
          <DateField
            label="Payment date"
            value={draft.paymentDate}
            onChange={(date) => set('paymentDate', date)}
            max={tomorrowOf(today)}
            required
            error={errors.paymentDate}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={4}>
          <DateField
            label="Ex-date"
            value={draft.exDate}
            onChange={(date) => set('exDate', date)}
            hint="Optional; needed for the yield"
            error={errors.exDate}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={4}>
          <MoneyField
            label="Net amount"
            value={draft.netAmountCents}
            onChange={(cents) => set('netAmountCents', cents)}
            allowNegative
            required
            hint="What reached your account (negative for a reversal)"
            error={errors.netAmountCents}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={4}>
          <Select
            label="Reinvested"
            value={draft.reinvested}
            onChange={(value) => set('reinvested', value)}
            options={REINVESTED_OPTIONS}
            error={errors.reinvested}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={4}>
          <NumberField
            label="Price at ex-date"
            value={draft.priceAtEx}
            onChange={(value) => set('priceAtEx', value)}
            maxDp={TRADE_DECIMAL_MAX_DP}
            hint={priceHint}
            error={errors.priceAtEx}
            disabled={pending}
          />
        </GridItem>
        <GridItem span={12}>
          <TextField
            label="Note"
            value={draft.note}
            onChange={(note) => set('note', note)}
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
