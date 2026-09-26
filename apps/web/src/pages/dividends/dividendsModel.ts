// The Dividends page's editor state, action keys and small helpers (stage-3.md §6.6). No
// components (react-refresh).
import type {
  DividendRowDto,
  DividendSuggestionDto,
  DividendsPageResponse,
  InstrumentKind,
} from '@joinr/schema';
import { INSTRUMENT_KINDS } from '@joinr/schema';
import { HOLDING_KIND_LABELS } from '../cashflow/display';

export type DividendsEditor =
  | { form: 'dividend'; dividend?: DividendRowDto; opener: string }
  | { form: 'confirm'; suggestion: DividendSuggestionDto; opener: string };

/** A suggestion's key: the cached event's (instrument, ex-date). */
export function suggestionKey(s: Pick<DividendSuggestionDto, 'instrumentId' | 'exDate'>): string {
  return `${s.instrumentId}-${s.exDate}`;
}

export function suggestionActionKey(
  action: 'confirm' | 'dismiss' | 'restore',
  key: string,
): string {
  return `suggestion-${action}-${key}`;
}

export function dividendActionKey(action: 'edit' | 'delete', id: number): string {
  return `dividend-${action}-${id}`;
}

/** The holding choices for the dividend form: by kind, then symbol ("ETF · ASX:ABC"). */
export function holdingOptions(
  holdings: DividendsPageResponse['holdings'],
): { value: string; label: string }[] {
  const rank = (kind: InstrumentKind): number => INSTRUMENT_KINDS.indexOf(kind);
  return [...holdings]
    .sort((a, b) => rank(a.kind) - rank(b.kind) || a.symbol.localeCompare(b.symbol))
    .map((h) => ({
      value: String(h.instrumentId),
      label: `${HOLDING_KIND_LABELS[h.kind]} · ${h.symbol}`,
    }));
}

export const SUGGESTIONS_NOTE =
  'Suggestions cover ASX listings in AUD. Amounts are before any withholding; franking is not tracked.';
export const ESTIMATE_NOTE = 'Estimated from Yahoo; enter the amount that reached your account.';
export const MARKET_OFF_NOTE = 'Yahoo suggestions are off (market data is switched off).';
export const DRP_RULE_NOTE =
  'The advice compares the months a payment takes to buy one more unit with 6 months: under 6, switching the dividend reinvestment plan (DRP) on compounds sooner; 6 or more, taking the cash keeps parcels larger.';
