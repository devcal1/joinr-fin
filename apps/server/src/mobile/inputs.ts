// The shared engine-input loader of the phone API (stage-10.md §6.2): steps 1 of the today builder
// (stage-9.md §6.5), factored out so `/api/mobile/today` and `/api/mobile/periods` read the same
// finance context, the same `compute(kind)` results and the same clock. Moving it here changed
// nothing in `/today`'s output (its Stage 9 suites pass unedited).
import type { HoldingResult, LotResult } from '@joinr/engine';
import { INSTRUMENT_KINDS, dateInZone, type InstrumentKind, type IsoDate } from '@joinr/schema';
import type { FastifyBaseLogger } from 'fastify';
import { createFinanceContext, type FinanceContext, type FinanceDeps } from '../cashflow/context';

export interface MobileInputs {
  ctx: FinanceContext;
  now: Date;
  /** `now` as a UTC ISO instant (the response's `generatedAt`). */
  generatedAt: string;
  /** The server's date (its zone), exactly as `/today` uses it. */
  localDate: IsoDate;
  /** EVERY instrument of the four kinds (held, watching, exited). */
  holdings: HoldingResult[];
  /** Every lot of the four kinds, fully sold ones included. */
  lots: LotResult[];
  /** Every instrument's kind. */
  kinds: Map<number, InstrumentKind>;
  holdingById: Map<number, HoldingResult>;
}

/** The finance context and the four kinds' engine results, once per request. */
export function loadMobileInputs(o: {
  deps: FinanceDeps;
  timeZone: string;
  log?: FastifyBaseLogger;
}): MobileInputs {
  const ctx = createFinanceContext(o.deps, o.log);
  const now = ctx.now;
  const generatedAt = now.toISOString();
  const localDate = dateInZone(now.getTime(), o.timeZone) ?? ctx.asOf;

  const holdings: HoldingResult[] = [];
  const lots: LotResult[] = [];
  const kinds = new Map<number, InstrumentKind>();
  for (const kind of INSTRUMENT_KINDS) {
    const result = ctx.compute(kind);
    holdings.push(...result.holdings);
    lots.push(...result.lots);
    for (const i of ctx.rows(kind).instruments) kinds.set(i.id, kind);
  }
  const holdingById = new Map(holdings.map((h) => [h.instrumentId, h]));
  return { ctx, now, generatedAt, localDate, holdings, lots, kinds, holdingById };
}
