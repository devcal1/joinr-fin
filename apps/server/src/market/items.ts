// Read side of the price service: `PriceItem`s and `MarketQuoteItem`s from the stored rows
// (stage-1.md §3.3, §5.6).
import {
  derivePriceSource,
  INSTRUMENT_KINDS,
  MARKET_SERIES,
  MARKET_SERIES_IDS,
  type MarketQuoteItem,
  type PriceItem,
  type PriceProvider,
  type SymbolOrigin,
} from '@joinr/schema';
import {
  instruments,
  marketQuotes,
  prices,
  priceSources,
  type JoinrDb,
  type TableRow,
} from '@joinr/schema/db';
import { asc, eq } from 'drizzle-orm';
import { heldUnitsByInstrument, isHeld } from '../db/queries/holdings';
import { fxCurrencyOfSeries } from './fx';
import { priceStatus, quoteStatus, type FreshnessRule } from './status';

export type InstrumentRow = TableRow<typeof instruments>;
export type PriceSourceRow = TableRow<typeof priceSources>;
export type PriceRow = TableRow<typeof prices>;
export type MarketQuoteRow = TableRow<typeof marketQuotes>;

export interface InstrumentPriceRow {
  instrument: InstrumentRow;
  source: PriceSourceRow | null;
  price: PriceRow | null;
}

export interface EffectiveSource {
  provider: PriceProvider;
  providerSymbol: string | null;
  symbolOrigin: SymbolOrigin;
}

/** Every instrument with its price source and cached price (left joins). */
export function loadInstrumentPriceRows(db: JoinrDb, id?: number): InstrumentPriceRow[] {
  const query = db
    .select({ instrument: instruments, source: priceSources, price: prices })
    .from(instruments)
    .leftJoin(priceSources, eq(priceSources.instrumentId, instruments.id))
    .leftJoin(prices, eq(prices.instrumentId, instruments.id));
  return (id === undefined ? query : query.where(eq(instruments.id, id)))
    .orderBy(asc(instruments.id))
    .all();
}

/** The stored source, or the derived default when an instrument has no `price_sources` row. */
export function effectiveSource(row: {
  instrument: InstrumentRow;
  source: PriceSourceRow | null;
}): EffectiveSource {
  if (row.source) {
    return {
      provider: row.source.provider,
      providerSymbol: row.source.providerSymbol,
      symbolOrigin: row.source.symbolOrigin,
    };
  }
  return { ...derivePriceSource(row.instrument), symbolOrigin: 'derived' };
}

export function freshnessRule(row: InstrumentPriceRow): FreshnessRule {
  return row.instrument.kind === 'crypto' || row.price?.source === 'coingecko'
    ? 'crypto'
    : 'market';
}

export function toPriceItem(
  row: InstrumentPriceRow,
  heldUnits: string | undefined,
  now: Date,
): PriceItem {
  const { instrument, source, price } = row;
  const src = effectiveSource(row);
  const manual =
    source?.manualPrice != null && source.manualPriceAsOf != null
      ? {
          price: source.manualPrice,
          asOf: source.manualPriceAsOf,
          note: source.manualNote,
          origin: source.manualOrigin ?? 'user',
        }
      : null;

  const goodAsOf = price?.asOf ?? price?.fetchedAt ?? null;
  const fetched =
    price?.price != null && price.source != null && goodAsOf !== null
      ? {
          price: price.price,
          nativePrice: price.nativePrice,
          nativeCurrency: price.nativeCurrency,
          fxRate: price.fxRate,
          asOf: goodAsOf,
          fetchedAt: price.fetchedAt ?? goodAsOf,
          source: price.source,
        }
      : null;

  const status = priceStatus(
    {
      manual,
      fetched: price
        ? {
            price: fetched ? fetched.price : null,
            asOf: fetched ? fetched.asOf : null,
            source: price.source,
            lastStatus: price.lastStatus,
          }
        : null,
      rule: freshnessRule(row),
    },
    now,
  );

  return {
    instrumentId: instrument.id,
    kind: instrument.kind,
    symbol: instrument.symbol,
    name: instrument.name,
    watched: instrument.isWatched,
    held: isHeld(heldUnits),
    heldUnits: heldUnits ?? '0',
    provider: src.provider,
    providerSymbol: src.providerSymbol,
    symbolOrigin: src.symbolOrigin,
    status,
    price: manual ? manual.price : (fetched?.price ?? null),
    priceSource: manual ? 'manual' : (fetched?.source ?? null),
    asOf: manual ? manual.asOf : (fetched?.asOf ?? null),
    fetched,
    manual,
    lastAttemptAt: price?.lastAttemptAt ?? null,
    lastError: price?.lastError ?? null,
    consecutiveFailures: price?.consecutiveFailures ?? 0,
  };
}

const KIND_ORDER = new Map(INSTRUMENT_KINDS.map((k, i) => [k, i]));

/** Held first, then kind order (INSTRUMENT_KINDS), then the instrument's sort order, then id. */
export function comparePriceItems(
  a: { item: PriceItem; sortOrder: number },
  b: { item: PriceItem; sortOrder: number },
): number {
  if (a.item.held !== b.item.held) return a.item.held ? -1 : 1;
  const kind = (KIND_ORDER.get(a.item.kind) ?? 0) - (KIND_ORDER.get(b.item.kind) ?? 0);
  if (kind !== 0) return kind;
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.item.instrumentId - b.item.instrumentId;
}

export function listPriceItems(db: JoinrDb, now: Date): PriceItem[] {
  const held = heldUnitsByInstrument(db);
  return loadInstrumentPriceRows(db)
    .map((row) => ({
      item: toPriceItem(row, held.get(row.instrument.id), now),
      sortOrder: row.instrument.sortOrder,
    }))
    .sort(comparePriceItems)
    .map((x) => x.item);
}

/** One item, or null when the instrument does not exist. */
export function priceItemFor(db: JoinrDb, instrumentId: number, now: Date): PriceItem | null {
  const row = loadInstrumentPriceRows(db, instrumentId)[0];
  if (!row) return null;
  return toPriceItem(row, heldUnitsByInstrument(db).get(instrumentId), now);
}

function seriesLabel(seriesId: string): { label: string; unit: string } {
  const builtIn = (MARKET_SERIES as Record<string, { label: string; unit: string } | undefined>)[
    seriesId
  ];
  if (builtIn) return { label: builtIn.label, unit: builtIn.unit };
  const ccy = fxCurrencyOfSeries(seriesId);
  return ccy ? { label: `${ccy}/AUD`, unit: `AUD per ${ccy}` } : { label: seriesId, unit: '' };
}

export function toQuoteItem(
  seriesId: string,
  row: MarketQuoteRow | null,
  now: Date,
): MarketQuoteItem {
  const { label, unit } = seriesLabel(seriesId);
  return {
    seriesId,
    label,
    value: row?.value ?? null,
    unit: row?.unit ?? unit,
    asOf: row?.value != null ? row.asOf : null,
    fetchedAt: row?.value != null ? row.fetchedAt : null,
    source: row?.value != null ? row.source : null,
    status: quoteStatus(row, now),
    lastError: row?.lastError ?? null,
  };
}

/** The built-in series in registry order (always present), then stored `FX_<CCY>AUD` rows. */
export function listSeries(db: JoinrDb, now: Date): MarketQuoteItem[] {
  const rows = new Map(
    db
      .select()
      .from(marketQuotes)
      .all()
      .map((r) => [r.seriesId, r]),
  );
  const builtIn = MARKET_SERIES_IDS.map((id) => toQuoteItem(id, rows.get(id) ?? null, now));
  const extra = [...rows.keys()]
    .filter((id) => fxCurrencyOfSeries(id) !== null)
    .sort()
    .map((id) => toQuoteItem(id, rows.get(id) ?? null, now));
  return [...builtIn, ...extra];
}
