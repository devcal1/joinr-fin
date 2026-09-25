// Trade and instrument mutations (stage-2.md §4.5, §3.3). Each runs in one synchronous
// `BEGIN IMMEDIATE` transaction, refuses while an upload import holds the import lock (409
// IMPORT_IN_PROGRESS), applies the D34 origin rules and writes the deletion marker when a workbook
// row (`sheet_ref` set) is deleted. Trade changes that would oversell (more than before) roll back
// with 422 TRADE_OVERSELL.
import type { EngineApi } from '@joinr/engine';
import {
  derivePriceSource,
  instrumentCreateSchema,
  instrumentEditableFromDto,
  JoinrDecimal,
  makeInstrumentUpdateSchema,
  makeTradeInputSchema,
  normaliseDecimal,
  normaliseInstrumentEditable,
  splitSymbol,
  tradeDecimalSchema,
  tradeFeeCents,
  unitsFromAmount,
  type DecimalValue,
  type FeeSpec,
  type InstrumentEditable,
  type InstrumentKind,
  type IsoDate,
  type TradeInput,
} from '@joinr/schema';
import { dividends, instruments, priceSources, trades } from '@joinr/schema/db';
import { and, count, eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { markImportRowDeleted, type Tx } from '../db/queries/domain';
import { readSettings } from '../db/queries/settings';
import { HttpError, parseWith } from '../errors';
import { importLock } from '../routes/import';
import type { InvestmentsDeps } from './context';
import { displayDate, localIsoDate } from './format';
import { toEngineInstrument, toEngineTrade, type InstrumentRow, type TradeRow } from './load';
import { instrumentDto } from './mappers';

/** 409 IMPORT_IN_PROGRESS while an upload import holds the process-wide lock (§4.5 step 0). */
export const IMPORT_IN_PROGRESS_MESSAGE = 'An import is running; try again shortly';
export const INSTRUMENT_IN_USE_MESSAGE =
  'This holding has trades or dividends, so it cannot be deleted';
export const AMOUNT_TOO_SMALL_MESSAGE =
  'quantity.amountCents: the amount buys less than one unit step';

const KIND_ARTICLE_NOUN: Readonly<Record<InstrumentKind, string>> = {
  stock: 'A stock',
  etf: 'An ETF',
  managed_fund: 'A managed fund',
  crypto: 'A coin',
};

export function assertNoImportRunning(): void {
  if (importLock.held) throw new HttpError(409, IMPORT_IN_PROGRESS_MESSAGE, 'IMPORT_IN_PROGRESS');
}

function notifyInstrumentsChanged(deps: InvestmentsDeps, log?: FastifyBaseLogger): void {
  try {
    deps.market.notifyInstrumentsChanged();
  } catch (err) {
    log?.warn({ err }, 'could not schedule a price refresh after an investments change');
  }
}

function loadInstrument(tx: Tx, id: number): InstrumentRow | undefined {
  return tx.select().from(instruments).where(eq(instruments.id, id)).get();
}

function tradesOf(tx: Tx, instrumentId: number): TradeRow[] {
  return tx.select().from(trades).where(eq(trades.instrumentId, instrumentId)).all();
}

// ─── Oversell check (§4.5 step 5) ───────────────────────────────────────────────────────────────

interface OversellState {
  total: DecimalValue;
  bySell: Map<number, DecimalValue>;
  /** Open units after every trade (the held status). */
  open: DecimalValue;
}

/** computeInvestments restricted to one instrument (its trades only; no prices needed). */
function oversellState(
  engine: EngineApi,
  instrument: InstrumentRow,
  rows: readonly TradeRow[],
  asOf: IsoDate,
): OversellState {
  const result = engine.computeInvestments({
    kind: instrument.kind,
    asOf,
    instruments: [toEngineInstrument(instrument)],
    trades: rows.map(toEngineTrade),
    dividends: [],
    prices: new Map(),
  });
  const bySell = new Map<number, DecimalValue>();
  let total = new JoinrDecimal(0);
  for (const t of result.trades) {
    if (t.oversoldUnits === null) continue;
    const v = new JoinrDecimal(t.oversoldUnits);
    if (!v.greaterThan(0)) continue;
    bySell.set(t.tradeId, v);
    total = total.plus(v);
  }
  const holding = result.holdings.find((h) => h.instrumentId === instrument.id);
  return { total, bySell, open: new JoinrDecimal(holding?.openUnits ?? 0) };
}

const plural = (n: string, one: string, many: string) => (n === '1' ? one : many);

/** "The sell on 15/11/2025 is for 20 units but only 12 are held then." (§4.1) */
export function oversellMessage(sell: TradeRow, oversold: DecimalValue): string {
  const qty = new JoinrDecimal(sell.units).abs();
  const held = normaliseDecimal(JoinrDecimal.max(qty.minus(oversold), 0));
  const units = normaliseDecimal(qty);
  return (
    `The sell on ${displayDate(sell.tradeDate)} is for ${units} ${plural(units, 'unit', 'units')} ` +
    `but only ${held} ${plural(held, 'is', 'are')} held then.`
  );
}

/** FIFO processing order of sells: date, then seq, then id (§2.4). */
function compareProcessing(a: TradeRow, b: TradeRow): number {
  if (a.tradeDate !== b.tradeDate) return a.tradeDate < b.tradeDate ? -1 : 1;
  return a.seq - b.seq || a.id - b.id;
}

/** Throws 422 TRADE_OVERSELL when the change oversells more than before; else the new state. */
function checkOversell(
  engine: EngineApi,
  instrument: InstrumentRow,
  before: OversellState,
  afterRows: readonly TradeRow[],
  asOf: IsoDate,
): OversellState {
  const after = oversellState(engine, instrument, afterRows, asOf);
  if (!after.total.greaterThan(before.total)) return after;
  const sells = afterRows.filter((r) => after.bySell.has(r.id)).sort(compareProcessing);
  const first =
    sells.find((r) => after.bySell.get(r.id)!.greaterThan(before.bySell.get(r.id) ?? 0)) ??
    sells[0];
  const message = first
    ? oversellMessage(first, after.bySell.get(first.id)!)
    : 'This change sells more units than are held.';
  throw new HttpError(422, message, 'TRADE_OVERSELL');
}

// ─── Trades ─────────────────────────────────────────────────────────────────────────────────────

interface TradeColumns {
  tradeDate: IsoDate;
  units: string;
  price: string;
  feeCents: number;
  feeRate: string | null;
}

/** Units (D38 amount mode via unitsFromAmount), the signed units and the stored fee (§4.5 1–3). */
function tradeColumns(input: TradeInput, kind: InstrumentKind): TradeColumns {
  if (input.fee.kind === 'rate' && kind !== 'crypto') {
    throw new HttpError(400, 'fee: a percentage fee is for crypto only', 'VALIDATION_ERROR');
  }
  let units: string;
  if (input.quantity.mode === 'units') {
    units = input.quantity.units;
  } else {
    units = unitsFromAmount(input.quantity.amountCents, input.price, kind);
    if (units === '0') throw new HttpError(400, AMOUNT_TOO_SMALL_MESSAGE, 'VALIDATION_ERROR');
    if (!tradeDecimalSchema(1e12).safeParse(units).success) {
      throw new HttpError(
        400,
        'quantity.amountCents: the amount buys more units than a trade can hold',
        'VALIDATION_ERROR',
      );
    }
  }
  const signed = input.side === 'sell' ? normaliseDecimal(new JoinrDecimal(units).neg()) : units;
  const fee =
    input.fee.kind === 'flat'
      ? { feeCents: input.fee.cents, feeRate: null }
      : {
          feeRate: input.fee.rate,
          feeCents: tradeFeeCents({
            units: signed,
            price: input.price,
            feeCents: 0,
            feeRate: input.fee.rate,
          }),
        };
  return { tradeDate: input.tradeDate, units: signed, price: input.price, ...fee };
}

/** `1 + max(seq)` over the trades of instruments of the same kind (entry order within the kind). */
function nextSeq(tx: Tx, kind: InstrumentKind): number {
  const row = tx
    .select({ max: sql<number | null>`max(${trades.seq})` })
    .from(trades)
    .innerJoin(instruments, eq(instruments.id, trades.instrumentId))
    .where(eq(instruments.kind, kind))
    .get();
  return (row?.max ?? 0) + 1;
}

const isHeld = (s: OversellState) => s.open.greaterThan(0);

export interface TradeMutationOutcome {
  tradeId: number;
  kind: InstrumentKind;
}

/** POST /api/trades. Returns the new trade's id (the route answers 201 with its ledger row). */
export function createTrade(
  deps: InvestmentsDeps,
  body: unknown,
  log?: FastifyBaseLogger,
): TradeMutationOutcome {
  assertNoImportRunning();
  const input = parseWith(makeTradeInputSchema(deps.now), body);
  const now = deps.now();
  const asOf = localIsoDate(now);
  const outcome = deps.database.db.transaction(
    (tx) => {
      const instrument = loadInstrument(tx, input.instrumentId);
      if (!instrument) {
        throw new HttpError(404, `Instrument ${input.instrumentId} not found`, 'NOT_FOUND');
      }
      const cols = tradeColumns(input, instrument.kind);
      const before = oversellState(deps.engine, instrument, tradesOf(tx, instrument.id), asOf);
      const tradeId = tx
        .insert(trades)
        .values({
          instrumentId: instrument.id,
          ...cols,
          seq: nextSeq(tx, instrument.kind),
          reviewFlags: null,
          correctionId: null,
          note: input.note ?? null,
          origin: 'app',
          sheetRef: null,
        })
        .returning({ id: trades.id })
        .get().id;
      const after = checkOversell(
        deps.engine,
        instrument,
        before,
        tradesOf(tx, instrument.id),
        asOf,
      );
      return { tradeId, kind: instrument.kind, heldChanged: isHeld(before) !== isHeld(after) };
    },
    { behavior: 'immediate' },
  );
  if (outcome.heldChanged) notifyInstrumentsChanged(deps, log);
  return { tradeId: outcome.tradeId, kind: outcome.kind };
}

/**
 * PUT /api/trades/:id: a full replace of the trade's values. The instrument cannot change. The
 * row becomes `origin = 'app'`, keeps its `sheet_ref`, `correction_id` and `seq`, and its stored
 * review flags are cleared (the owner reviewed it; `oversell` is live). An omitted `note` keeps
 * the stored note.
 */
export function updateTrade(
  deps: InvestmentsDeps,
  tradeId: number,
  body: unknown,
  log?: FastifyBaseLogger,
): TradeMutationOutcome {
  assertNoImportRunning();
  const input = parseWith(makeTradeInputSchema(deps.now), body);
  const now = deps.now();
  const asOf = localIsoDate(now);
  const outcome = deps.database.db.transaction(
    (tx) => {
      const stored = tx.select().from(trades).where(eq(trades.id, tradeId)).get();
      if (!stored) throw new HttpError(404, `Trade ${tradeId} not found`, 'NOT_FOUND');
      if (input.instrumentId !== stored.instrumentId) {
        throw new HttpError(
          400,
          'instrumentId: the holding of a trade cannot change',
          'VALIDATION_ERROR',
        );
      }
      const instrument = loadInstrument(tx, stored.instrumentId);
      if (!instrument) {
        throw new HttpError(404, `Instrument ${stored.instrumentId} not found`, 'NOT_FOUND');
      }
      const cols = tradeColumns(input, instrument.kind);
      const before = oversellState(deps.engine, instrument, tradesOf(tx, instrument.id), asOf);
      tx.update(trades)
        .set({
          ...cols,
          reviewFlags: null,
          note: input.note === undefined ? stored.note : input.note,
          origin: 'app',
        })
        .where(eq(trades.id, tradeId))
        .run();
      const after = checkOversell(
        deps.engine,
        instrument,
        before,
        tradesOf(tx, instrument.id),
        asOf,
      );
      return { kind: instrument.kind, heldChanged: isHeld(before) !== isHeld(after) };
    },
    { behavior: 'immediate' },
  );
  if (outcome.heldChanged) notifyInstrumentsChanged(deps, log);
  return { tradeId, kind: outcome.kind };
}

/** DELETE /api/trades/:id. 422 when a later sell needs this buy; the marker for workbook rows. */
export function deleteTrade(deps: InvestmentsDeps, tradeId: number, log?: FastifyBaseLogger): void {
  assertNoImportRunning();
  const now = deps.now();
  const asOf = localIsoDate(now);
  const heldChanged = deps.database.db.transaction(
    (tx) => {
      const stored = tx.select().from(trades).where(eq(trades.id, tradeId)).get();
      if (!stored) throw new HttpError(404, `Trade ${tradeId} not found`, 'NOT_FOUND');
      const instrument = loadInstrument(tx, stored.instrumentId);
      if (!instrument) {
        throw new HttpError(404, `Instrument ${stored.instrumentId} not found`, 'NOT_FOUND');
      }
      const before = oversellState(deps.engine, instrument, tradesOf(tx, instrument.id), asOf);
      tx.delete(trades).where(eq(trades.id, tradeId)).run();
      const after = checkOversell(
        deps.engine,
        instrument,
        before,
        tradesOf(tx, instrument.id),
        asOf,
      );
      if (stored.sheetRef !== null) markImportRowDeleted(tx, now);
      return isHeld(before) !== isHeld(after);
    },
    { behavior: 'immediate' },
  );
  if (heldChanged) notifyInstrumentsChanged(deps, log);
}

// ─── Instruments ────────────────────────────────────────────────────────────────────────────────

/** The canonical editable fields of a stored row (the same mapping the web form starts from). */
export function editableFromRow(row: InstrumentRow): InstrumentEditable {
  return instrumentEditableFromDto(
    instrumentDto(row, { price: undefined, settings: null, tradeCount: 0, dividendCount: 0 }),
  );
}

function defaultFeeColumns(fee: FeeSpec | null): {
  defaultFeeCents: number | null;
  defaultFeeRate: string | null;
} {
  if (fee === null) return { defaultFeeCents: null, defaultFeeRate: null };
  return fee.kind === 'rate'
    ? { defaultFeeCents: null, defaultFeeRate: fee.rate }
    : { defaultFeeCents: fee.cents, defaultFeeRate: null };
}

/** The importer-written editable columns (everything but the default fee). */
function editableColumns(v: InstrumentEditable) {
  return {
    name: v.name,
    quoteCurrency: v.quoteCurrency,
    isWatched: v.watched,
    targetRatio: v.targetRatio,
    sector: v.sector,
    location: v.location,
    mgmtFeeRatio: v.mgmtFeeRatio,
    regionUsRatio: v.regions?.us ?? null,
    regionAsiaRatio: v.regions?.asia ?? null,
    regionAusRatio: v.regions?.aus ?? null,
    regionOtherRatio: v.regions?.other ?? null,
    dividendFreqMonths: v.dividendFreqMonths,
    drp: v.drp,
    note: v.note,
  };
}

/** POST /api/instruments. Returns the new instrument's id. */
export function createInstrument(
  deps: InvestmentsDeps,
  body: unknown,
  log?: FastifyBaseLogger,
): number {
  assertNoImportRunning();
  const input = parseWith(instrumentCreateSchema, body);
  const now = deps.now();
  const v = normaliseInstrumentEditable(input);
  const id = deps.database.db.transaction(
    (tx) => {
      const existing = tx
        .select({ id: instruments.id })
        .from(instruments)
        .where(and(eq(instruments.kind, input.kind), eq(instruments.symbol, input.symbol)))
        .get();
      if (existing) {
        throw new HttpError(
          409,
          `${KIND_ARTICLE_NOUN[input.kind]} with the symbol ${input.symbol} already exists`,
          'INSTRUMENT_EXISTS',
        );
      }
      const maxSort = tx
        .select({ max: sql<number | null>`max(${instruments.sortOrder})` })
        .from(instruments)
        .where(eq(instruments.kind, input.kind))
        .get();
      const { exchange, code } = splitSymbol(input.symbol);
      const newId = tx
        .insert(instruments)
        .values({
          kind: input.kind,
          symbol: input.symbol,
          exchange,
          code,
          sortOrder: (maxSort?.max ?? 0) + 1,
          isRetirement: false,
          ...editableColumns(v),
          ...defaultFeeColumns(v.defaultFee),
          origin: 'app',
          sheetRef: null,
        })
        .returning({ id: instruments.id })
        .get().id;
      const source = derivePriceSource({ kind: input.kind, symbol: input.symbol, exchange, code });
      tx.insert(priceSources)
        .values({
          instrumentId: newId,
          provider: source.provider,
          providerSymbol: source.providerSymbol,
          symbolOrigin: 'derived',
          updatedAt: now.toISOString(),
        })
        .run();
      return newId;
    },
    { behavior: 'immediate' },
  );
  notifyInstrumentsChanged(deps, log);
  return id;
}

/**
 * PUT /api/instruments/:id: a full replace of the editable fields, parsed with the STORED kind's
 * rules. `origin` becomes `app` only when an importer-written column changes, compared after
 * normalising both sides (§3.3); a default-fee-only change keeps `origin`.
 */
export function updateInstrument(
  deps: InvestmentsDeps,
  instrumentId: number,
  body: unknown,
  log?: FastifyBaseLogger,
): void {
  assertNoImportRunning();
  deps.database.db.transaction(
    (tx) => {
      const row = loadInstrument(tx, instrumentId);
      if (!row) throw new HttpError(404, `Instrument ${instrumentId} not found`, 'NOT_FOUND');
      const next = normaliseInstrumentEditable(
        parseWith(makeInstrumentUpdateSchema(row.kind), body),
      );
      const stored = normaliseInstrumentEditable(editableFromRow(row));
      const importerFieldsChanged =
        JSON.stringify({ ...stored, defaultFee: null }) !==
        JSON.stringify({ ...next, defaultFee: null });
      const fee = defaultFeeColumns(next.defaultFee);
      tx.update(instruments)
        .set(
          importerFieldsChanged
            ? { ...editableColumns(next), ...fee, origin: 'app' as const }
            : fee,
        )
        .where(eq(instruments.id, instrumentId))
        .run();
    },
    { behavior: 'immediate' },
  );
  notifyInstrumentsChanged(deps, log);
}

/** DELETE /api/instruments/:id: 409 while trades or dividends reference it. */
export function deleteInstrument(
  deps: InvestmentsDeps,
  instrumentId: number,
  log?: FastifyBaseLogger,
): void {
  assertNoImportRunning();
  const now = deps.now();
  deps.database.db.transaction(
    (tx) => {
      const row = loadInstrument(tx, instrumentId);
      if (!row) throw new HttpError(404, `Instrument ${instrumentId} not found`, 'NOT_FOUND');
      const tradeCount =
        tx.select({ n: count() }).from(trades).where(eq(trades.instrumentId, instrumentId)).get()
          ?.n ?? 0;
      const dividendCount =
        tx
          .select({ n: count() })
          .from(dividends)
          .where(eq(dividends.instrumentId, instrumentId))
          .get()?.n ?? 0;
      if (tradeCount > 0 || dividendCount > 0) {
        throw new HttpError(409, INSTRUMENT_IN_USE_MESSAGE, 'INSTRUMENT_IN_USE');
      }
      // Cascades price_sources and prices.
      tx.delete(instruments).where(eq(instruments.id, instrumentId)).run();
      if (row.sheetRef !== null) markImportRowDeleted(tx, now);
    },
    { behavior: 'immediate' },
  );
  notifyInstrumentsChanged(deps, log);
}

/** An instrument's DTO read back after a mutation (null when it does not exist). */
export function loadInstrumentDto(
  deps: InvestmentsDeps,
  instrumentId: number,
  log?: FastifyBaseLogger,
) {
  const db = deps.database.db;
  const row = db.select().from(instruments).where(eq(instruments.id, instrumentId)).get();
  if (!row) return null;
  const tradeCount =
    db.select({ n: count() }).from(trades).where(eq(trades.instrumentId, instrumentId)).get()?.n ??
    0;
  const dividendCount =
    db.select({ n: count() }).from(dividends).where(eq(dividends.instrumentId, instrumentId)).get()
      ?.n ?? 0;
  const price = deps.market.getPrices().items.find((i) => i.instrumentId === instrumentId);
  return instrumentDto(row, {
    price,
    settings: readSettings(db, log),
    tradeCount,
    dividendCount,
  });
}
