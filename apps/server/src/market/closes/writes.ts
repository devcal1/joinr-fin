// The `closes` job's writes (stage-10.md §5.6): one IMMEDIATE transaction per target at the end of
// its fetch (so a deadline keeps the work done), upserting by primary key (the incoming value wins
// on the same date). Nothing is deleted here: only the instrument cascade and a real price-source
// change (market/service.ts) delete closes.
import { derivePriceSource, type CloseSource } from '@joinr/schema';
import {
  instrumentCloses,
  instruments,
  instrumentSplits,
  priceSources,
  seriesCloses,
  type JoinrDb,
} from '@joinr/schema/db';
import { eq, sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../../db/queries/domain';
import type { HistoryClose, SplitEvent } from '../providers/types';
import type { InstrumentCloseTarget } from './targets';

/** Rows per INSERT statement (7 bound values each, well under SQLite's variable limit). */
const CHUNK = 400;

/** `excluded.<column>`: the incoming row's value in a multi-row upsert (fixed column names only). */
function excludedText(column: 'close' | 'currency' | 'source' | 'fetched_at' | 'value'): SQL {
  return sql.raw(`excluded.${column}`);
}

function chunks<T>(rows: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
  return out;
}

/**
 * §5.6 identity and source check, inside the transaction: the instrument still exists with the
 * captured kind and symbol (the Stage 9 identity check) and its effective source (the stored row,
 * else the derived default) still has the provider and provider symbol captured when the run chose
 * it. A `setPriceSource` during the fetch therefore never lets the old symbol's closes back in.
 */
export function targetStillValid(tx: Tx, t: InstrumentCloseTarget): boolean {
  const instrument = tx.select().from(instruments).where(eq(instruments.id, t.instrumentId)).get();
  if (!instrument || instrument.kind !== t.instrumentKind || instrument.symbol !== t.symbol) {
    return false;
  }
  const stored = tx
    .select({ provider: priceSources.provider, providerSymbol: priceSources.providerSymbol })
    .from(priceSources)
    .where(eq(priceSources.instrumentId, t.instrumentId))
    .get();
  const src = stored ?? derivePriceSource(instrument);
  return src.provider === t.provider && src.providerSymbol === t.providerSymbol;
}

export interface InstrumentClosesWrite {
  target: InstrumentCloseTarget;
  closes: readonly HistoryClose[];
  currency: string;
  splits: readonly SplitEvent[];
  source: CloseSource;
}

/**
 * Writes one instrument's closes and splits in its own IMMEDIATE transaction; null when the
 * identity or source check failed (nothing written).
 */
export function writeInstrumentCloses(
  db: JoinrDb,
  w: InstrumentClosesWrite,
  fetchedAt: string,
): { rows: number; splits: number } | null {
  return db.transaction(
    (tx) => {
      if (!targetStillValid(tx, w.target)) return null;
      const id = w.target.instrumentId;
      for (const part of chunks(w.closes)) {
        tx.insert(instrumentCloses)
          .values(
            part.map((c) => ({
              instrumentId: id,
              date: c.date,
              close: c.close,
              currency: w.currency,
              source: w.source,
              fetchedAt,
            })),
          )
          .onConflictDoUpdate({
            target: [instrumentCloses.instrumentId, instrumentCloses.date],
            set: {
              close: excludedText('close'),
              currency: excludedText('currency'),
              source: excludedText('source'),
              fetchedAt: excludedText('fetched_at'),
            },
          })
          .run();
      }
      for (const s of w.splits) {
        const set = { numerator: s.numerator, denominator: s.denominator, fetchedAt };
        tx.insert(instrumentSplits)
          .values({ instrumentId: id, date: s.date, ...set })
          .onConflictDoUpdate({
            target: [instrumentSplits.instrumentId, instrumentSplits.date],
            set,
          })
          .run();
      }
      return { rows: w.closes.length, splits: w.splits.length };
    },
    { behavior: 'immediate' },
  );
}

/**
 * Writes one fetched series' closes (`AUDUSD`, `FX_<CCY>AUD`, the futures) in its own IMMEDIATE
 * transaction. These series never carry `derived` or `midnight` rows, so the incoming value wins.
 */
export function writeSeriesCloses(
  db: JoinrDb,
  seriesId: string,
  closes: readonly HistoryClose[],
  source: CloseSource,
  fetchedAt: string,
): number {
  if (closes.length === 0) return 0;
  db.transaction(
    (tx) => {
      for (const part of chunks(closes)) {
        tx.insert(seriesCloses)
          .values(part.map((c) => ({ seriesId, date: c.date, value: c.close, source, fetchedAt })))
          .onConflictDoUpdate({
            target: [seriesCloses.seriesId, seriesCloses.date],
            set: {
              value: excludedText('value'),
              source: excludedText('source'),
              fetchedAt: excludedText('fetched_at'),
            },
          })
          .run();
      }
    },
    { behavior: 'immediate' },
  );
  return closes.length;
}
