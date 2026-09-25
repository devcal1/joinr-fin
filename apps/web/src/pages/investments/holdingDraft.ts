// The holding form's state and rules (stage-2.md §4.3, §6.6). The round trip keeps `origin` and
// re-import safe: the body starts from `instrumentEditableFromDto(dto)` and overlays only the
// fields the owner changed, so untouched fields go back exactly as the DTO holds them. Percent
// fields convert with `ratioFromPercentText` / `percentTextFromRatio` (string shifts, no floats).
import {
  instrumentCreateSchema,
  makeInstrumentUpdateSchema,
  percentTextFromRatio,
  ratioFromPercentText,
  sumDecimals,
  type FeeSpec,
  type InstrumentEditable,
  type InstrumentKind,
} from '@joinr/schema';
import { isApiError } from '../../api/client';
import { splitFormErrors, sentence, type FormErrors } from './apiErrors';
import { percentMaxDp } from './tradeDraft';

export type RegionKey = 'us' | 'asia' | 'aus' | 'other';
export const REGION_KEYS: readonly RegionKey[] = ['us', 'asia', 'aus', 'other'];
export const REGION_LABELS: Readonly<Record<RegionKey, string>> = {
  us: 'US',
  asia: 'Asia',
  aus: 'Australia',
  other: 'EU/Other',
};

export type DrpChoice = 'yes' | 'no' | 'unknown';

/** The form's fields as the owner types them (percent fields hold percent text: "12.5"). */
export interface HoldingDraft {
  symbol: string;
  name: string;
  quoteCurrency: string;
  watched: boolean;
  target: string;
  sector: string;
  location: string;
  mgmtFee: string;
  regions: Record<RegionKey, string>;
  dividendFreq: string;
  drp: DrpChoice;
  useGlobalFee: boolean;
  feeMode: 'flat' | 'rate';
  feeCents: number | null;
  feePercent: string;
  note: string;
}

/** The editable fields (InstrumentEditable keys) plus the create-only symbol. */
export type HoldingField = keyof InstrumentEditable | 'symbol';

/** A new holding: watched, AUD, every other field empty (the global default fee). */
export const EMPTY_EDITABLE: InstrumentEditable = {
  name: null,
  quoteCurrency: 'AUD',
  watched: true,
  targetRatio: null,
  sector: null,
  location: null,
  mgmtFeeRatio: null,
  regions: null,
  dividendFreqMonths: null,
  drp: null,
  defaultFee: null,
  note: null,
};

const pct = (ratio: string | null): string => (ratio === null ? '' : percentTextFromRatio(ratio));

/** The form fields for an editable record (a DTO's `instrumentEditableFromDto`, or EMPTY_EDITABLE). */
export function draftFromEditable(
  editable: InstrumentEditable,
  kind: InstrumentKind,
  symbol = '',
): HoldingDraft {
  const regions = editable.regions;
  const fee = editable.defaultFee;
  return {
    symbol,
    name: editable.name ?? '',
    quoteCurrency: editable.quoteCurrency,
    watched: editable.watched,
    target: pct(editable.targetRatio),
    sector: editable.sector ?? '',
    location: editable.location ?? '',
    mgmtFee: pct(editable.mgmtFeeRatio),
    regions: {
      us: pct(regions?.us ?? null),
      asia: pct(regions?.asia ?? null),
      aus: pct(regions?.aus ?? null),
      other: pct(regions?.other ?? null),
    },
    dividendFreq: editable.dividendFreqMonths === null ? '' : String(editable.dividendFreqMonths),
    drp: editable.drp === null ? 'unknown' : editable.drp ? 'yes' : 'no',
    useGlobalFee: fee === null,
    feeMode: fee?.kind === 'rate' || (fee === null && kind === 'crypto') ? 'rate' : 'flat',
    feeCents: fee?.kind === 'flat' ? fee.cents : null,
    feePercent: fee?.kind === 'rate' ? percentTextFromRatio(fee.rate) : '',
    note: editable.note ?? '',
  };
}

/** Decimal places each percent field accepts: 4, or more when the stored value needs them. */
export interface PercentLimits {
  target: number;
  mgmtFee: number;
  regions: number;
  fee: number;
}

export function percentLimits(initial: HoldingDraft): PercentLimits {
  return {
    target: percentMaxDp(initial.target),
    mgmtFee: percentMaxDp(initial.mgmtFee),
    regions: Math.max(...REGION_KEYS.map((key) => percentMaxDp(initial.regions[key]))),
    fee: percentMaxDp(initial.feePercent),
  };
}

const regionsEqual = (a: HoldingDraft['regions'], b: HoldingDraft['regions']): boolean =>
  REGION_KEYS.every((key) => a[key] === b[key]);

const feeEqual = (a: HoldingDraft, b: HoldingDraft): boolean =>
  a.useGlobalFee === b.useGlobalFee &&
  (a.useGlobalFee ||
    (a.feeMode === b.feeMode &&
      (a.feeMode === 'flat' ? a.feeCents === b.feeCents : a.feePercent === b.feePercent)));

/** The fields the owner has changed (compared with the form's starting values). */
export function changedFields(draft: HoldingDraft, initial: HoldingDraft): Set<HoldingField> {
  const changed = new Set<HoldingField>();
  if (draft.symbol !== initial.symbol) changed.add('symbol');
  if (draft.name !== initial.name) changed.add('name');
  if (draft.quoteCurrency !== initial.quoteCurrency) changed.add('quoteCurrency');
  if (draft.watched !== initial.watched) changed.add('watched');
  if (draft.target !== initial.target) changed.add('targetRatio');
  if (draft.sector !== initial.sector) changed.add('sector');
  if (draft.location !== initial.location) changed.add('location');
  if (draft.mgmtFee !== initial.mgmtFee) changed.add('mgmtFeeRatio');
  if (!regionsEqual(draft.regions, initial.regions)) changed.add('regions');
  if (draft.dividendFreq !== initial.dividendFreq) changed.add('dividendFreqMonths');
  if (draft.drp !== initial.drp) changed.add('drp');
  if (!feeEqual(draft, initial)) changed.add('defaultFee');
  if (draft.note !== initial.note) changed.add('note');
  return changed;
}

/** Only the default fee changed: re-import stays allowed (§3.3). */
export function onlyDefaultFeeChanged(changed: ReadonlySet<HoldingField>): boolean {
  return changed.size === 1 && changed.has('defaultFee');
}

const text = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/** Parse problems the schema cannot see (percent text, whole months), by field. */
export function draftErrors(
  draft: HoldingDraft,
  kind: InstrumentKind,
  limits: PercentLimits,
): Partial<Record<HoldingField, string>> {
  const errors: Partial<Record<HoldingField, string>> = {};
  const percentError = (value: string, maxDp: number): string | undefined =>
    value.trim() === '' || ratioFromPercentText(value, maxDp) !== null
      ? undefined
      : `Enter a percentage with up to ${maxDp} decimal places.`;
  const target = percentError(draft.target, limits.target);
  if (target) errors.targetRatio = target;
  if (kind === 'etf' || kind === 'managed_fund') {
    const fee = percentError(draft.mgmtFee, limits.mgmtFee);
    if (fee) errors.mgmtFeeRatio = fee;
    const region = REGION_KEYS.map((key) => percentError(draft.regions[key], limits.regions)).find(
      Boolean,
    );
    if (region) errors.regions = region;
  }
  if (draft.dividendFreq.trim() !== '') {
    const months = Number(draft.dividendFreq);
    if (!Number.isInteger(months) || months < 1 || months > 12) {
      errors.dividendFreqMonths = 'Enter a whole number of months from 1 to 12.';
    }
  }
  if (!draft.useGlobalFee) {
    if (draft.feeMode === 'flat' && draft.feeCents === null) {
      errors.defaultFee = 'Enter the default fee, or use the global default.';
    } else if (draft.feeMode === 'rate') {
      if (draft.feePercent.trim() === '') {
        errors.defaultFee = 'Enter the default fee %, or use the global default.';
      } else if (ratioFromPercentText(draft.feePercent, limits.fee) === null) {
        errors.defaultFee = `Enter a percentage with up to ${limits.fee} decimal places.`;
      }
    }
  }
  return errors;
}

function feeFromDraft(draft: HoldingDraft, limits: PercentLimits): FeeSpec | null {
  if (draft.useGlobalFee) return null;
  if (draft.feeMode === 'flat') return { kind: 'flat', cents: draft.feeCents ?? 0 };
  return { kind: 'rate', rate: ratioFromPercentText(draft.feePercent, limits.fee) ?? '0' };
}

/**
 * The PUT/POST body: `base` (the DTO's editable fields, or EMPTY_EDITABLE) with only the changed
 * fields replaced. Empty text → null; regions → null when all four are empty (and always for
 * stocks and crypto); fields that do not apply to the kind are null.
 */
export function editableFromDraft(
  draft: HoldingDraft,
  initial: HoldingDraft,
  base: InstrumentEditable,
  kind: InstrumentKind,
  limits: PercentLimits,
): InstrumentEditable {
  const changed = changedFields(draft, initial);
  const ratio = (value: string, maxDp: number): string | null =>
    value.trim() === '' ? null : ratioFromPercentText(value, maxDp);
  const body: InstrumentEditable = { ...base };
  if (changed.has('name')) body.name = text(draft.name);
  if (changed.has('quoteCurrency')) body.quoteCurrency = draft.quoteCurrency.trim() || 'AUD';
  if (changed.has('watched')) body.watched = draft.watched;
  if (changed.has('targetRatio')) body.targetRatio = ratio(draft.target, limits.target);
  if (changed.has('sector')) body.sector = text(draft.sector);
  if (changed.has('location')) body.location = text(draft.location);
  if (changed.has('mgmtFeeRatio')) body.mgmtFeeRatio = ratio(draft.mgmtFee, limits.mgmtFee);
  if (changed.has('regions')) {
    const regions = {
      us: ratio(draft.regions.us, limits.regions),
      asia: ratio(draft.regions.asia, limits.regions),
      aus: ratio(draft.regions.aus, limits.regions),
      other: ratio(draft.regions.other, limits.regions),
    };
    body.regions = REGION_KEYS.every((key) => regions[key] === null) ? null : regions;
  }
  if (changed.has('dividendFreqMonths')) {
    body.dividendFreqMonths = draft.dividendFreq.trim() === '' ? null : Number(draft.dividendFreq);
  }
  if (changed.has('drp')) body.drp = draft.drp === 'unknown' ? null : draft.drp === 'yes';
  if (changed.has('defaultFee')) body.defaultFee = feeFromDraft(draft, limits);
  if (changed.has('note')) body.note = text(draft.note);
  // Fields that do not apply to the kind are always empty (instrumentKindIssues, §4.3).
  if (kind === 'stock' || kind === 'crypto') {
    body.location = null;
    body.mgmtFeeRatio = null;
    body.regions = null;
  }
  if (kind === 'crypto') body.sector = null;
  return body;
}

/** "Regions add up to 95%" (null when every region is empty or a value does not parse). */
export function regionsTotalRatio(draft: HoldingDraft, maxDp: number): string | null {
  const ratios = REGION_KEYS.map((key) =>
    draft.regions[key].trim() === '' ? '0' : ratioFromPercentText(draft.regions[key], maxDp),
  );
  if (REGION_KEYS.every((key) => draft.regions[key].trim() === '')) return null;
  if (ratios.some((r) => r === null)) return null;
  return sumDecimals(ratios as string[]);
}

const FIELD_OF_PATH: Readonly<Record<string, HoldingField>> = {
  symbol: 'symbol',
  name: 'name',
  quoteCurrency: 'quoteCurrency',
  watched: 'watched',
  targetRatio: 'targetRatio',
  sector: 'sector',
  location: 'location',
  mgmtFeeRatio: 'mgmtFeeRatio',
  regions: 'regions',
  dividendFreqMonths: 'dividendFreqMonths',
  drp: 'drp',
  defaultFee: 'defaultFee',
  note: 'note',
};

/** An issue path (`regions.us`, `defaultFee.rate`) → its field (the first segment). */
export function holdingFieldOfPath(path: string): HoldingField | undefined {
  return FIELD_OF_PATH[path.split('.')[0] ?? ''];
}

/** Percent fields: the schema bounds them as ratios ("must be at most 1"). */
function isPercentPath(path: string): boolean {
  return (
    path === 'targetRatio' ||
    path === 'mgmtFeeRatio' ||
    path.startsWith('regions.') ||
    path === 'defaultFee.rate'
  );
}

const RATIO_BOUND_RE = /^must be at most (\d+(?:\.\d+)?)$/;

/** The symbol error, worded apart from the field's hint (which already shows the pattern). */
const SYMBOL_ERRORS: Partial<Record<InstrumentKind, string>> = {
  stock: 'Use the exchange, a colon, then the code.',
  etf: 'Use the exchange, a colon, then the code.',
  crypto: 'Use up to 15 letters and digits, with no spaces or symbols.',
};

/**
 * A schema or server issue in the form's words: a percent field's ratio bound in percent
 * ("must be at most 1" → "Must be 100% or less."), and the symbol rule without repeating its hint.
 */
export function holdingIssueMessage(path: string, message: string, kind?: InstrumentKind): string {
  const bound = RATIO_BOUND_RE.exec(message.trim());
  if (bound?.[1] !== undefined && isPercentPath(path)) {
    return `Must be ${percentTextFromRatio(bound[1])}% or less.`;
  }
  const symbolError = kind === undefined ? undefined : SYMBOL_ERRORS[kind];
  if (path === 'symbol' && symbolError && message.trim().startsWith('must be')) return symbolError;
  return sentence(message);
}

/**
 * The same checks as the server: `makeInstrumentUpdateSchema(kind)` (edit) or
 * `instrumentCreateSchema` (create), so field-path errors match.
 */
export function schemaErrors(
  body: InstrumentEditable,
  kind: InstrumentKind,
  create: { symbol: string } | null,
): Partial<Record<HoldingField, string>> {
  const result = create
    ? instrumentCreateSchema.safeParse({ ...body, kind, symbol: create.symbol })
    : makeInstrumentUpdateSchema(kind).safeParse(body);
  const errors: Partial<Record<HoldingField, string>> = {};
  if (result.success) return errors;
  for (const issue of result.error.issues) {
    const path = issue.path.map(String).join('.');
    const field = holdingFieldOfPath(path);
    if (field && errors[field] === undefined) {
      errors[field] = holdingIssueMessage(path, issue.message, kind);
    }
  }
  return errors;
}

/**
 * Every client-side problem at once (§6.6): the parse checks (percent text, months, a missing
 * fee) and the server's schema over the body built from the draft. A parse error wins for its
 * field (the body holds null there, so the schema cannot see it).
 */
export function holdingFormErrors(
  draft: HoldingDraft,
  initial: HoldingDraft,
  base: InstrumentEditable,
  kind: InstrumentKind,
  limits: PercentLimits,
  create: boolean,
): Partial<Record<HoldingField, string>> {
  const body = editableFromDraft(draft, initial, base, kind, limits);
  return {
    ...schemaErrors(body, kind, create ? { symbol: draft.symbol } : null),
    ...draftErrors(draft, kind, limits),
  };
}

/** Server errors: INSTRUMENT_EXISTS goes under the Symbol field (§6.6); issues in the form's words. */
export function holdingApiErrors(error: unknown, kind?: InstrumentKind): FormErrors<HoldingField> {
  if (isApiError(error) && error.code === 'INSTRUMENT_EXISTS') {
    return { fields: { symbol: sentence(error.message) }, form: null };
  }
  return splitFormErrors(error, holdingFieldOfPath, (path, message) =>
    holdingIssueMessage(path, message, kind),
  );
}
