// Stage 4 mutation responses (stage-4.md §4.5 step 9): after the commit, the changed row's DTO is
// rebuilt from a fresh request context, so every figure in it comes from the engine. A row that
// vanished in between (only a concurrent CLI import can do that) answers 404.
import type {
  IsoMonth,
  LoanBalancesResponse,
  LoanMutationResponse,
  LoanOffsetsResponse,
  OtherAssetMutationResponse,
  OtherAssetPricesResponse,
  PropertyMutationResponse,
  SgOverrideResponse,
  SuperBalancesResponse,
  SuperContributionMutationResponse,
  SuperFundMutationResponse,
  ValuationsResponse,
} from '@joinr/schema';
import type { FastifyBaseLogger } from 'fastify';
import { createFinanceContext, type FinanceContext, type FinanceDeps } from '../cashflow/context';
import { HttpError } from '../errors';
import { otherAssetDtos } from './otherAssets';
import { loanDtos, offsetAccountDtos, propertyDtos } from './property';
import { sgMonthDtos, superContributionDtos, superFundDtos } from './super';

function gone(what: string, id: number | string): HttpError {
  return new HttpError(404, `${what} ${id} not found`, 'NOT_FOUND');
}

function context(deps: FinanceDeps, log?: FastifyBaseLogger): FinanceContext {
  return createFinanceContext(deps, log);
}

// ─── Other assets ───────────────────────────────────────────────────────────────────────────────

export function otherAssetResponse(
  deps: FinanceDeps,
  id: number,
  log?: FastifyBaseLogger,
): OtherAssetMutationResponse {
  const asset = otherAssetDtos(context(deps, log)).find((a) => a.id === id);
  if (!asset) throw gone('Asset', id);
  return { asset };
}

/** The assets a prices body named, in the page order. */
export function otherAssetPricesResponse(
  deps: FinanceDeps,
  ids: readonly number[],
  log?: FastifyBaseLogger,
): OtherAssetPricesResponse {
  const want = new Set(ids);
  return { assets: otherAssetDtos(context(deps, log)).filter((a) => want.has(a.id)) };
}

// ─── Super ──────────────────────────────────────────────────────────────────────────────────────

export function superFundResponse(
  deps: FinanceDeps,
  id: number,
  log?: FastifyBaseLogger,
): SuperFundMutationResponse {
  const ctx = context(deps, log);
  const fund = superFundDtos(ctx.data, ctx.superResult()).find((f) => f.id === id);
  if (!fund) throw gone('Fund', id);
  return { fund };
}

/** The funds a balances body named, in the page order. */
export function superBalancesResponse(
  deps: FinanceDeps,
  ids: readonly number[],
  log?: FastifyBaseLogger,
): SuperBalancesResponse {
  const ctx = context(deps, log);
  const want = new Set(ids);
  return { funds: superFundDtos(ctx.data, ctx.superResult()).filter((f) => want.has(f.id)) };
}

export function superContributionResponse(
  deps: FinanceDeps,
  id: number,
  log?: FastifyBaseLogger,
): SuperContributionMutationResponse {
  const ctx = context(deps, log);
  const contribution = superContributionDtos(ctx.data, ctx.superResult()).find((c) => c.id === id);
  if (!contribution) throw gone('Contribution', id);
  return { contribution };
}

/** The last day of a month (`2026-02` → `2026-02-28`). */
function monthEnd(month: IsoMonth): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const day = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, '0')}`;
}

/**
 * The SG month of a statement (§4.2). The page lists the months the two cap years count; for an
 * older month the engine is asked again as of that month's end, so its figures still come from the
 * engine.
 */
export function sgOverrideResponse(
  deps: FinanceDeps,
  month: IsoMonth,
  log?: FastifyBaseLogger,
): SgOverrideResponse {
  const ctx = context(deps, log);
  let found = sgMonthDtos(ctx.data, ctx.superResult()).find((m) => m.month === month);
  if (!found) {
    const earlier = ctx.engine.computeSuper({ ...ctx.superInput(), asOf: monthEnd(month) });
    found = sgMonthDtos(ctx.data, earlier).find((m) => m.month === month);
  }
  if (!found) throw gone('SG month', month);
  return { month: found };
}

// ─── Property ───────────────────────────────────────────────────────────────────────────────────

export function propertyResponse(
  deps: FinanceDeps,
  id: number,
  log?: FastifyBaseLogger,
): PropertyMutationResponse {
  const ctx = context(deps, log);
  const property = propertyDtos(ctx.data, ctx.property()).find((p) => p.id === id);
  if (!property) throw gone('Property', id);
  return { property };
}

/** The properties a valuations body named, in the page order. */
export function valuationsResponse(
  deps: FinanceDeps,
  ids: readonly number[],
  log?: FastifyBaseLogger,
): ValuationsResponse {
  const ctx = context(deps, log);
  const want = new Set(ids);
  return { properties: propertyDtos(ctx.data, ctx.property()).filter((p) => want.has(p.id)) };
}

export function loanResponse(
  deps: FinanceDeps,
  id: number,
  log?: FastifyBaseLogger,
): LoanMutationResponse {
  const ctx = context(deps, log);
  const loan = loanDtos(ctx.data, ctx.property()).find((l) => l.id === id);
  if (!loan) throw gone('Loan', id);
  return { loan };
}

/** The loans a balances body named, in the page order. */
export function loanBalancesResponse(
  deps: FinanceDeps,
  ids: readonly number[],
  log?: FastifyBaseLogger,
): LoanBalancesResponse {
  const ctx = context(deps, log);
  const want = new Set(ids);
  return { loans: loanDtos(ctx.data, ctx.property()).filter((l) => want.has(l.id)) };
}

export function loanOffsetsResponse(
  deps: FinanceDeps,
  id: number,
  log?: FastifyBaseLogger,
): LoanOffsetsResponse {
  const ctx = context(deps, log);
  const loan = loanDtos(ctx.data, ctx.property()).find((l) => l.id === id);
  if (!loan) throw gone('Loan', id);
  return { loan, offsetAccounts: offsetAccountDtos(ctx.data) };
}
