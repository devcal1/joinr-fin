# Stage 2 — Investments: Stocks, ETFs, Managed Funds, Crypto: build plan

_Planner output, 2026-09-25. Inputs: PLAN.md (Architecture, Stage 2), docs/HANDOFF.md, docs/DECISIONS.md (D5, D22–D29, D31, D33, D34, D36–D43), docs/STAGE_PROCESS.md, docs/stages/stage-0.md and stage-1.md (incl. their Scaffold notes, close notes and review log), spec 03 §1–8 (the source of truth), spec 01 §3.1 (asset allocation, "Consider next") and §5.4 (investment timing block), spec 02 §2–4 (Side Income averages, the Budget rows, Dividends), the dumps, the Stage 1 code, and the local workbook (read with the workspace's SheetJS through `@joinr/importer`'s reader in scratch scripts under `artifacts/planner/`)._

> **This repo is PUBLIC.** Nothing from `reference/` (except `reference/brand/`) or `docs/private/` may be copied into any other file: no amounts, no tickers, coins or funds the owner holds, no account, bank, fund or business names, addresses, IPs, emails, Drive ids. Code, tests, seeds, fixtures and committed docs use only generic values: `ASX:ABC`, `ASX:XYZ`, `ASX:DEF`, an exited `ASX:OLD`, `EXAMPLEFUND`, round numbers. **BTC and ETH are the only crypto examples allowed.** The owner-specific facts for this stage are in **`docs/private/stage-2-private.md`** (git-ignored): the engine and server-api implementers, the spec reviewer, the code reviewer and the Verifier read it; nobody copies from it.
>
> **Golden tests never contain owner values:** they read every expected value from the local workbook at runtime and skip when it is absent (§9). **No snapshot files** (`toMatchSnapshot` & co.). The guard also blocks any committed path with a folder segment named `data`.

**Flow:** Coordinator pre-step (guard terms, §7.0) → **Scaffolder** (alone; must pass its done-check, §7.2) → 3 implementers in parallel (**engine**, **server-api**, **web phase A**) → **Integrator** (web phase B + e2e; starts when engine and server-api have reported done, §7.6) → Reviewers in parallel (**spec-correctness**, **style-ux**, **code-quality/security**) → **Fixer** → **Verifier**. That is 10 agents. **Nobody commits or pushes.** The coordinator commits at stage close with the owner's OK (D10).

**Golden values:** template cell references only (§9); the values are read from the workbook at runtime. **Template bug fixes applied in Stage 2:** §11 (vetoable).

**Verified by the Planner against the workbook (2026-09-25, scratch scripts).** With the workbook's cached prices and its as-of date (`Net Worth!E52`):
- FIFO by trade date then seq reproduces the remaining units of **every** buy row in the Capital Gains helper column O, and every disposal in P/S to the cent.
- Every per-lot unrealised gain (ledger J/I), and every per-holding value, total return $ and %, average price and XIRR of every priced holding reproduce within the §9.5 tolerances. The XIRR solver of §2.7 (Newton, or its bracket fallback) matches the sheet's XIRR within 1e-6.
- Every tab summary (value, total return $ and %, the sheet's simple est. return, the 1Y investment rate) reproduces. The simple est. return floors the cost-weighted average date (DATEDIF semantics).
- Contributions history reproduces within 1e-5 **when only watched instruments are fed** (the sheet's exclusion; §9.3).
- The Budget investment-row chain (monthly income, yearly fund, planned spend, leftover, emergency fund, cash share, investment row) reproduces, including the last-snapshot cash share.
- The ETF target regional look-through, the managed-fund current and target look-through and the managed-fund fee estimate (daily compounding) reproduce.

Details, including which cells the sheet itself broke, are in `docs/private/stage-2-private.md` §2–§4.

---

## 1. Overview & flow

### 1.1 What Stage 2 delivers
1. **`@joinr/engine`** (pure TypeScript, §2). It covers:
   - FIFO lots (D36) with a matching-strategy seam, realised gains with the ATO holding-period split, and per-lot unrealised gains.
   - Holding metrics per kind and portfolio summaries (Total Return per D41, realised shown separately, portfolio XIRR per D43).
   - Allocation: sector, regional look-through, per holding/coin; the target checks.
   - Dividend and staking metrics, and the realised-gains-by-FY summary (D42).
   - Contributions and net-purchase history with a period compressor.
   - Investment timing (D39/D40): the Budget investment amount, the parcel optimiser, the countdown, "consider next" and the next-buy hint.
2. **Schema** (§3): migration `0002_stage2_investments` (per-holding default fee, D38), the trading helpers, the investment DTOs and request schemas, the error codes, the fixtures and the seed update.
3. **Server** (§4): the investments API (page data, ledger, holding detail, trade and holding CRUD) with the D34 origin rules. It builds engine inputs from the DB and the price service.
4. **Web** (§6):
   - The four investment pages, built from one shared component, and a holding detail page per kind.
   - The trade form with units-or-amount entry and default-fee pre-fill (D38), and the holding form.
   - Allocation donuts, value, gain and purchase history charts, the FY realised table and the next-buy panel.
   - Phone width (375 px) works.
5. **Golden tests** (§9): engine goldens fed sheet-faithful inputs, and a server golden that goes import → DB → API.

### 1.2 Workspace changes (no new packages)
```
packages/engine/   @joinr/engine   src/** (engine), test/** (unit + golden); deps @joinr/schema; devDeps @joinr/importer
packages/schema/   @joinr/schema   + src/trading.ts, src/dto/investments.ts, enums, instruments columns, rows, records,
                                   fixtures/investments.ts, seed; src/index.ts exports the new modules
apps/server/       @joinr/server   + migrations/0002_stage2_investments.sql (+ meta), src/investments/**,
                                   src/routes/investments.ts, src/db/queries/settings.ts; dep @joinr/engine;
                                   small edits: app.ts (engine option), routes/import.ts, cli/import.ts, market/refresh.ts
apps/web/          @joinr/web      + src/pages/investments/**, api additions, typed routes for the four pages + detail
e2e/                               + investments.spec.ts, investments-states.spec.ts, trades.spec.ts, investments-support.ts
packages/importer/                 process.ts re-exports splitSymbol from @joinr/schema (one line; no behaviour change)
```

### 1.3 Dependencies (no third-party additions)
| Package | Spec | Where | Notes |
|---|---|---|---|
| @joinr/schema | `workspace:*` | engine **dependencies** | JoinrDecimal, the decimal and date helpers, the types and `trading.ts`. The engine imports the **root entry only** (no drizzle, no node). decimal.js comes through it; the engine lists no direct decimal.js dependency. |
| @joinr/importer | `workspace:*` | engine **devDependencies** | Golden tests only: `readWorkbook`, `describeWithLocalWorkbook`. |
| @joinr/engine | `workspace:*` | server **dependencies** | esbuild bundles workspace code into `dist/server.js` (stage-0 §1), so nothing new is external. |
| — | — | web | **No change.** The only client-side calculations (the D38 preview: units from an amount, a fee from a rate, the default fee) live in `@joinr/schema` `trading.ts`, which the web already imports. |

pnpm 11 rules are unchanged: `allowBuilds` untouched, keep any `minimumReleaseAgeExclude` lines pnpm writes, never `pnpm approve-builds`. **Only the Scaffolder installs** (`pnpm install` links the workspace packages). Implementers never edit a dependency list or the lockfile; stop and report instead.

### 1.4 Scripts
No new root scripts. The scoped commands used in this plan are:
- `pnpm vitest run --project engine` (unit + golden)
- `pnpm vitest run --project engine test/golden`
- `pnpm vitest run --project server test/investments`
- `pnpm vitest run --project server test/golden`
- `pnpm vitest run --project schema`
- `pnpm vitest run --project web src/pages/investments`

### 1.5 Not in Stage 2 (deferred; say so in the UI where it matters)
- **Stage 3:**
  - The Dividends page and dividend editing. Stage 2 reads dividends.
  - The Budget page and the live Budget engine. Stage 2 computes the investment row from the **imported** budget rows (D40).
  - The cash-deficit wait (`SheetOptions!H12`), which needs the Stage 3 savings engine.
- **Stages 3–4:** live Cash and Other Assets engines. "Consider next" uses the imported balances and unit prices meanwhile.
- **Stage 5:**
  - Snapshot recording and the aggregation API. The Stage 2 compressor (§2.11) is written so Stage 5 can reuse it.
  - Settings editing. Stage 2 reads the imported settings and falls back to defaults.
- **Not built:**
  - Specific-parcel matching (the D36 seam only).
  - The 180-day sparkline and P/E columns (no price history is stored).
  - The historical order-price lookup script.
  - Email and calendar reminders (D39).

---

## 2. Engine spec (`@joinr/engine`)

### 2.1 Conventions (all engine code)
| Concern | Rule |
|---|---|
| Purity | No I/O of any kind: no fs, fetch, DB, env, console, timers. **No clock:** `new Date()` without arguments and `Date.now()` are banned in `packages/engine/src` (ESLint `no-restricted-syntax`, added by the Scaffolder). Every "today" is the `asOf: IsoDate` input. |
| Imports | `@joinr/schema` **root** only (types, `JoinrDecimal`, `normaliseDecimal`, `centsFromDecimal`, `decimalFromNumber`, `addMonthsIso`, `compareIso`, `financialYearOfIso`, `isoMonthOf`, `trading.ts`). No drizzle, no node modules. The engine must bundle for the browser, although only the server imports it now. |
| Arithmetic | `JoinrDecimal` for money, units, prices and ratios. Float64 only inside the XIRR solver (§2.7). |
| Boundaries | **Money** in and out as integer cents (`Cents`). **Units and prices** as normalised `DecimalString` (`normaliseDecimal`). **Ratios** as `DecimalString` with 12 significant digits (`JoinrDecimal#toSignificantDigits(12)`, then normalised). **Dates** as `IsoDate`. |
| Rounding | Compute in decimals and round **once** at the output, half away from zero (`centsFromDecimal`). Summary money fields are the **Σ of the per-holding rounded cents** (over the rows each field covers, §2.8), so a total row equals the sum of the rows it covers; the web defines each holdings total cell in §6.3 item 4. Summary ratios come from the unrounded decimals. |
| Order | Deterministic. Holdings in instrument `sortOrder`, then `id`. Lots and trades by the processing order of §2.4. |
| Errors | Never throws for data problems (oversell, zero price, missing price, a trade whose instrument is not in `instruments`); it flags instead. It throws `RangeError` only for programmer errors, such as a malformed decimal string. |
| Retirement | `is_retirement` is ignored everywhere (D37). A sector named "Retirement" is an ordinary label. |

### 2.2 Public API (FROZEN — `packages/engine/src/types.ts` + `src/index.ts`)
The Scaffolder writes `types.ts` complete (every type below) and `index.ts` (the values `MATCHING_STRATEGIES` and `ENGINE_IMPLEMENTED = false`, and every function below as a stub throwing `new Error('engine: not implemented')`). The engine owner replaces the stubs in place and adds internal modules (`src/lots.ts`, `src/xirr.ts`, …) freely. Names, fields and signatures below do not change.

```ts
import type {
  AllocationAggressiveness, AssetClass, BudgetItemKind, CapitalGainTerm, ChartDateUnit, ConsiderReason,
  DecimalString, HoldingFlag, HoldingStatus, InstrumentKind, IsoDate, IsoMonth, PayFrequency, PriceStatus,
  SettingKey, TradeSide,
} from '@joinr/schema';

export type Cents = number;                        // integer cents (safe integer)
export type MatchingStrategy = 'fifo';             // D36: the seam; only FIFO exists
export const MATCHING_STRATEGIES: readonly MatchingStrategy[];   // ['fifo']
export const ENGINE_IMPLEMENTED: boolean;          // Scaffolder: false; engine sets true (§7.3 step 10)

// ─── Inputs ─────────────────────────────────────────────────────────────────────────────────
export interface EngineTrade {
  id: number; instrumentId: number; tradeDate: IsoDate;
  units: DecimalString;              // signed; negative = sell; "0" rows are ignored
  price: DecimalString;              // AUD per unit
  feeCents: Cents;                   // exact when feeRate is null (fee authority, §2.3)
  feeRate: DecimalString | null;     // crypto % fee: fee = |feeRate × units × price|
  seq: number;                       // FIFO tie-break (entry order within the kind)
}
export interface EngineDividend {
  id: number; instrumentId: number | null;   // null = unmatched ticker (D28)
  holdingKind: InstrumentKind; paymentDate: IsoDate; exDate: IsoDate | null;
  reinvested: boolean | null; netAmountCents: Cents; priceAtEx: DecimalString | null;
}
export interface EngineRegions { us: DecimalString | null; asia: DecimalString | null;
  aus: DecimalString | null; other: DecimalString | null }
export interface EngineInstrument {
  id: number; kind: InstrumentKind; symbol: string; name: string | null; watched: boolean; sortOrder: number;
  targetRatio: DecimalString | null; sector: string | null; regions: EngineRegions;
  mgmtFeeRatio: DecimalString | null; dividendFreqMonths: number | null;
}
export interface EnginePrice { price: DecimalString | null; status: PriceStatus }   // effective price, manual wins

export interface InvestmentsInput {
  kind: InstrumentKind;
  asOf: IsoDate;
  instruments: readonly EngineInstrument[];         // every instrument of `kind`
  trades: readonly EngineTrade[];                   // every trade of those instruments
  dividends: readonly EngineDividend[];             // every dividend with holdingKind === kind (linked or not)
  prices: ReadonlyMap<number, EnginePrice>;         // by instrument id; absent = no price
  matching?: MatchingStrategy;                      // default 'fifo'
}

// ─── Outputs ────────────────────────────────────────────────────────────────────────────────
export interface LotResult {
  tradeId: number; instrumentId: number; tradeDate: IsoDate; seq: number;
  units: DecimalString; remainingUnits: DecimalString; price: DecimalString;
  feeCents: Cents;                   // the whole buy fee (authority fee, rounded)
  remainingCostCents: Cents;         // price × remaining + fee × remaining / units
  unrealisedCents: Cents | null;     // null when unpriced or remaining = 0
  unrealisedRatio: DecimalString | null;   // unrealised / (price × units): the sheet's per-parcel % (vs original cost)
  heldDays: number;                  // asOf − tradeDate
  termIfSoldToday: CapitalGainTerm;  // §2.5
}
export interface DisposalResult {
  sellTradeId: number; lotTradeId: number; instrumentId: number;
  sellDate: IsoDate; acquiredDate: IsoDate; units: DecimalString;
  proceedsCents: Cents; costCents: Cents; gainCents: Cents;   // each rounded once from decimals
  term: CapitalGainTerm; financialYear: number;               // FY start year of sellDate
}
export interface TradeResult {
  tradeId: number; side: TradeSide;
  orderValueCents: Cents;            // |units × price|, fee excluded (the sheet's Order Value, unsigned)
  feeCents: Cents;                   // authority fee, rounded once
  remainingUnits: DecimalString | null; unrealisedCents: Cents | null;        // buys (its lot)
  realisedCents: Cents | null; realisedShortCents: Cents | null; realisedLongCents: Cents | null; // sells
  oversoldUnits: DecimalString | null;                                       // sells: units matched to no lot
}
export interface HoldingResult {
  instrumentId: number; status: HoldingStatus; flags: HoldingFlag[];
  netUnits: DecimalString;           // Σ trade units (the sheet's held units)
  openUnits: DecimalString;          // Σ lot remaining units (never negative)
  price: DecimalString | null; priceStatus: PriceStatus;
  valueCents: Cents | null;          // openUnits × price; null when unpriced
  costCents: Cents;                  // Σ lot remainingCost
  unrealisedCents: Cents | null;
  dividendsCents: Cents;             // Σ linked net dividends/staking, all time
  totalReturnCents: Cents | null;    // D41: unrealised + dividends; held and priced only
  totalReturnRatio: DecimalString | null;   // totalReturn / cost (cost > 0)
  realisedCents: Cents;              // Σ disposals, all time
  xirr: DecimalString | null;
  averagePrice: DecimalString | null;       // Σ(price × remaining) / openUnits, fees excluded; null when openUnits = 0
  currentRatio: DecimalString | null;       // §2.8
  targetRatio: DecimalString | null; differenceRatio: DecimalString | null;   // current − target
  dividendYieldRatio: DecimalString | null; // §2.9 (crypto: staking yield)
  estMgmtFeeCents: Cents | null;            // §2.8, when mgmtFeeRatio and value exist
  lastBuyDate: IsoDate | null; lastTradeDate: IsoDate | null;
}
export interface SummaryResult {
  valueCents: Cents; costCents: Cents; unrealisedCents: Cents; dividendsHeldCents: Cents;
  totalReturnCents: Cents; totalReturnRatio: DecimalString | null;
  realisedCents: Cents; realisedThisFyCents: Cents;
  xirr: DecimalString | null;                 // D43 portfolio XIRR
  investmentRatePerMonthCents: Cents | null;  // the sheet's "1Y Inv. Rate", whole dollars rounded up
  dividendsThisFyCents: Cents; dividendsAllTimeCents: Cents;   // by holding kind (linked or not)
  heldCount: number; watchingCount: number; exitedCount: number; unpricedCount: number; stalePriceCount: number;
  targetSumRatio: DecimalString;              // Σ targets of watched instruments
  targetCount: number;                        // targets > 0, plus held with current > 0 and target 0/null
  estMgmtFeeCents: Cents | null;              // Σ holdings' estMgmtFeeCents (null when none)
  lastBuyDate: IsoDate | null;
}
export interface AllocationSliceResult { key: string; label: string; currentRatio: DecimalString; targetRatio: DecimalString }
export interface AllocationResult {
  byHolding: AllocationSliceResult[];          // key = String(instrumentId), label = symbol
  bySector: AllocationSliceResult[];           // label = sector, or 'Unassigned'
  byRegion: AllocationSliceResult[] | null;    // etf and managed_fund only (§2.8)
}
export interface FyRealisedRow { financialYear: number; shortTermCents: Cents; longTermCents: Cents;
  totalCents: Cents; disposals: number }
export interface DividendResult {                  // §2.9, one per input dividend, input order
  dividendId: number; instrumentId: number | null;
  unitsAtEx: DecimalString | null; yieldRatio: DecimalString | null;
}
export interface InvestmentsResult {
  kind: InstrumentKind; asOf: IsoDate;
  holdings: HoldingResult[]; lots: LotResult[]; disposals: DisposalResult[]; trades: TradeResult[];
  dividends: DividendResult[];
  summary: SummaryResult; allocation: AllocationResult; realisedByFy: FyRealisedRow[];
}

// ─── History (§2.11) ────────────────────────────────────────────────────────────────────────
export interface PurchaseWindow { after: IsoDate | null; through: IsoDate }      // (after, through]
export interface SeriesPoint { period: IsoMonth; date: IsoDate; live: boolean; values: Readonly<Record<string, number | null>> }
export interface CompressedPoint { label: string; period: IsoMonth; date: IsoDate; live: boolean; values: Record<string, number | null> }

// ─── Timing (§2.12) ─────────────────────────────────────────────────────────────────────────
export type TimingInput = SettingKey | 'budget.items' | 'snapshots' | 'investments.lastPurchaseDate';
export interface BudgetInvestInput {
  asOf: IsoDate;
  payFrequency: PayFrequency | null; netPayCents: Cents | null; includeSideIncome: boolean;
  sideIncomePeriods: readonly { periodStart: IsoDate; periodEnd: IsoDate; amountCents: Cents }[]; // Σ streams per period
  items: readonly { kind: BudgetItemKind; monthlyCents: Cents | null }[];
  yearlyExpenseAnnualCents: readonly Cents[];
  autoInvestSplit: boolean | null; useBudgetForInvest: boolean | null;
  cashTargetRatio: DecimalString | null; aggressiveness: AllocationAggressiveness | null;
  lastSnapshotCashShare: DecimalString | null;   // cash / liquid assets at the latest snapshot
  currentCashShare: DecimalString | null;        // fallback when there is no snapshot; both null → 0 (§2.12 step 7)
  cashCents: Cents;                              // Σ non-offset cash accounts
  emergencyFundMonths: number | null; emergencyFundOverrideCents: Cents | null;
  marginalTaxRate: DecimalString | null;
  lastPurchaseDate: IsoDate | null;              // last ETF or stock BUY (SheetOptions H20)
}
export interface BudgetInvestResult {
  monthlyIncomeCents: Cents | null; yearlyFundCents: Cents; plannedSpendCents: Cents;
  leftoverCents: Cents | null;
  emergencyFundCents: Cents | null;              // null when both the months and the override are null
  cashShareRatio: DecimalString | null; investShareRatio: DecimalString | null;
  investmentRowCents: Cents | null; cashRowCents: Cents | null;
  sideIncomeInvestCents: Cents;
  monthlyInvestCents: Cents | null;              // D40
  missing: TimingInput[];
}
export interface ParcelPlan { months: number; parcelCents: Cents; optimalParcelCents: Cents }
export type Countdown =
  | { state: 'wait'; days: number; nextPurchaseDate: IsoDate; periodDays: number }
  | { state: 'invest'; nextPurchaseDate: IsoDate; periodDays: number }
  | { state: 'cash_first' }
  | { state: 'unavailable'; missing: TimingInput[] };
export interface ConsiderNextRow { assetClass: AssetClass; valueCents: Cents; currentRatio: DecimalString;
  targetRatio: DecimalString | null; deltaRatio: DecimalString | null }
export interface ConsiderNextResult { assetClass: AssetClass | null; reason: ConsiderReason; rows: ConsiderNextRow[] }
export interface NextBuyHintResult { assetClass: AssetClass | null; instrumentId: number | null; parcelCents: Cents | null }

// ─── Functions (FROZEN signatures) ───────────────────────────────────────────────────────────
export function computeInvestments(input: InvestmentsInput): InvestmentsResult;
export function xirr(flows: readonly { amount: number; date: IsoDate }[]): number | null;   // amount in dollars
export function realisedByFinancialYear(disposals: readonly DisposalResult[], asOf: IsoDate): FyRealisedRow[];
export function contributionsAt(i: { kind: InstrumentKind; trades: readonly EngineTrade[];
  dividends: readonly EngineDividend[]; dates: readonly IsoDate[] }): Cents[];
export function netPurchases(i: { trades: readonly EngineTrade[]; windows: readonly PurchaseWindow[] }): Cents[];
export function purchaseWindows(runDates: readonly IsoDate[], liveThrough: IsoDate | null): PurchaseWindow[];
export function compressSeries(points: readonly SeriesPoint[], unit: ChartDateUnit, count: number | null,
  modes: Readonly<Record<string, 'end' | 'sum'>>): CompressedPoint[];
export function budgetInvestment(input: BudgetInvestInput): BudgetInvestResult;
export function parcelOptimiser(i: { monthlyInvestCents: Cents | null; brokerageCents: Cents | null;
  growthRatio: DecimalString | null; cashRateRatio: DecimalString | null }): ParcelPlan | null;
export function investCountdown(i: { asOf: IsoDate; monthlyInvestCents: Cents | null; plan: ParcelPlan | null;
  lastPurchaseDate: IsoDate | null; payDayOfMonth: number | null; growthRatio: DecimalString | null }): Countdown;
export function considerNext(i: { classes: Readonly<Record<AssetClass, { valueCents: Cents; targetRatio: DecimalString | null }>>;
  cashCents: Cents; emergencyFundCents: Cents | null }): ConsiderNextResult;
export function nextBuyHint(i: { kind: InstrumentKind; considerNext: ConsiderNextResult;
  holdings: readonly HoldingResult[]; parcelCents: Cents | null }): NextBuyHintResult;
export function assetClassOfKind(kind: InstrumentKind): AssetClass;   // stock→'stock', etf→'etf', managed_fund→'managed_fund', crypto→'crypto'
export function sheetDate(year: number, month: number, day: number): IsoDate;  // Sheets DATE(): day/month overflow rolls over

// ─── The function set as one value (server injection, §4.5) ─────────────────────────────────
export interface EngineApi {                       // in types.ts: one member per function above, same signature
  computeInvestments: typeof computeInvestments; xirr: typeof xirr;
  realisedByFinancialYear: typeof realisedByFinancialYear; contributionsAt: typeof contributionsAt;
  netPurchases: typeof netPurchases; purchaseWindows: typeof purchaseWindows; compressSeries: typeof compressSeries;
  budgetInvestment: typeof budgetInvestment; parcelOptimiser: typeof parcelOptimiser;
  investCountdown: typeof investCountdown; considerNext: typeof considerNext; nextBuyHint: typeof nextBuyHint;
  assetClassOfKind: typeof assetClassOfKind; sheetDate: typeof sheetDate;
}
export const engine: EngineApi;                    // index.ts: { computeInvestments, xirr, … } (the Scaffolder writes it over the stubs)
```
Both `computeInvestments` and the history functions accept trades of **any** order; they sort internally. `types.ts` spells the `EngineApi` members out as function types (it cannot use `typeof` on the stubs); the Scaffolder adds a type-level test that `engine` satisfies it.

### 2.3 Trading helpers (`@joinr/schema` `src/trading.ts`; the Scaffolder writes them complete, with tests)
These live in the schema root because the server (validation), the engine and the web (the D38 form preview) all need them.
```ts
export type FeeSpec = { kind: 'flat'; cents: number } | { kind: 'rate'; rate: DecimalString };
export const TRADE_DECIMAL_MAX_DP = 18;       // decimal places accepted for units, prices and ratios by the API
export const DECIMAL_INPUT_MAX_SIG = 15;      // significant digits accepted (imports carry ≤ 12, so every stored value round-trips)
export const AMOUNT_MODE_UNIT_DP: Readonly<Record<InstrumentKind, number>> =
  { stock: 4, etf: 4, managed_fund: 6, crypto: 8 };   // amount-mode rounding AND the unit display precision (§6.3)
export const PERCENT_INPUT_MAX_DP = 4;        // typed percent fields (so a typed ratio has ≤ 6 dp)
/** Fee authority (stage-1 §2.4): feeRate set → |feeRate × units × price| in decimal; else feeCents/100. Dollars. */
export function tradeFeeDollars(t: { units: string; price: string; feeCents: number; feeRate: string | null }): DecimalString;
/** The same fee rounded once to cents (half away from zero): the display value and `fee_cents` of a rate fee. */
export function tradeFeeCents(t: { units: string; price: string; feeCents: number; feeRate: string | null }): number;
/** D38: the units an amount buys or sells: amount / price, rounded DOWN (toward zero) to AMOUNT_MODE_UNIT_DP[kind]. "0" when less than one step. */
export function unitsFromAmount(amountCents: number, price: DecimalString, kind: InstrumentKind): DecimalString;
/** D38: the fee the trade form pre-fills. See the rules below. */
export function effectiveDefaultFee(
  i: { kind: InstrumentKind; defaultFeeCents: number | null; defaultFeeRate: DecimalString | null },
  s: { defaultBrokerageCents: number | null; cryptoFeeRate: DecimalString | null },
): FeeSpec;
/** Percent text → ratio string by shifting the decimal point on the string (never floats): "0.07" → "0.0007",
 *  "12.5" → "0.125". Null for blank or invalid text, a sign, an exponent or more than `maxDp` decimal places. */
export function ratioFromPercentText(text: string, maxDp?: number /* default PERCENT_INPUT_MAX_DP */): DecimalString | null;
/** Ratio string → percent text, the exact inverse (no rounding): "0.0007" → "0.07", "0.125" → "12.5". */
export function percentTextFromRatio(ratio: DecimalString): string;
/** A decimal input string is acceptable: ≤ TRADE_DECIMAL_MAX_DP places and ≤ DECIMAL_INPUT_MAX_SIG significant digits. */
export function withinDecimalInputLimits(value: DecimalString): boolean;
```
The web converts every percent field with these two helpers (§6.6), never with `× 100` or `÷ 100` on numbers.
**Default fee rules (D38).**
- The holding's own default wins: `defaultFeeRate` gives `{ rate }` (crypto only) and `defaultFeeCents` gives `{ flat }`.
- Otherwise, by kind:
  - crypto → `{ rate: s.cryptoFeeRate ?? '0' }`
  - stock or ETF → `{ flat: s.defaultBrokerageCents ?? 0 }`
  - managed fund → `{ flat: 0 }` (the template has no brokerage for funds)
- There is **no inference from the ledger.** The owner sets `$0` once on the auto-invest holdings; the private doc lists which.

### 2.4 Lots — FIFO (D36)
1. **Scope:** one queue per instrument. Two instruments of different kinds never mix, even with the same code. The sheet merged by ticker string.
2. **Processing order:** `tradeDate` ascending. Within one date, **buys before sells**. Then `seq` ascending, then `id`. The same-day rule means a sell entered before its same-day buy can still use it. Older lots are always consumed first anyway, because they are already in the queue.
3. **Buy:** push a lot `{ units, price, fee = tradeFeeDollars(trade) }`. Rows with `units = 0` are ignored; the importer already flags them.
4. **Sell:** `S = |units|`. Consume open lots oldest first. For each matched quantity `q` of lot `L`:
   - `cost = q × L.price + L.fee × q / L.units`. The buy fee is apportioned pro rata.
   - `proceeds = q × sell.price − sell.fee × q / S`. The sell fee is apportioned pro rata.
   - `gain = proceeds − cost`.

   The Planner verified this on the workbook: a multi-parcel exit with fees reproduces the sheet's figure to the cent.
5. **Oversell** (units left after every open lot is exhausted):
   - The remainder becomes the sell's `oversoldUnits`, and no gain is booked for it.
   - The holding gets the flag `oversell`, and the trade row gets the review flag `oversell`, added live.
   - The engine never throws.
6. **Remaining lot:**
   - `remainingCost = price × remaining + fee × remaining / units`, and the unrealised gain `(P − price) × remaining − fee × remaining / units`.
   - The fee is **pro-rated on a partly-sold lot**. The sheet deducted the full fee (§11 fix 9).
   - `unrealisedRatio = unrealised / (price × units)`, the sheet's per-parcel % against the **original** parcel cost.
7. **Seam (D36):**
   - `MatchingStrategy` has the one value `'fifo'`.
   - Internally, a `selectLots(openLots, sell)` function is chosen by strategy.
   - Adding specific-parcel matching later means a new strategy plus a sell→lot allocation input. Nothing else is built now.

### 2.5 Realised gains and the ATO holding period (D42)
- **Term:**
  - `long` when `sellDate > addMonthsIso(acquiredDate, 12)`, i.e. the disposal is later than the acquisition anniversary. `addMonthsIso` has EDATE clamping, so 29 Feb → 28 Feb.
  - Otherwise `short`.
  - This is the ATO rule: held at least 12 months, excluding the acquisition and disposal days (spec 03 §5.6). The sheet's own boundary could not be confirmed (spec 03 §5.3).
- `financialYear` = `financialYearOfIso(sellDate)` (1 July – 30 June).
- **Per sell:** `realisedCents` = the Σ of its matches' unrounded gains, rounded once. `realisedShortCents` and `realisedLongCents` are split the same way.
- **Per disposal row:** each figure is rounded once.
- **`realisedByFinancialYear`:**
  - Per FY, the unrounded gains are summed by term and rounded once. `totalCents = shortTermCents + longTermCents`, and `disposals` counts the matches.
  - Rows are every FY with at least one disposal, **plus the FY of `asOf`** (zeros when empty), **newest first**.
  - There is no tax, no rate, no discount, no loss ordering and no carry-forward (D42). "Long term" is labelled *discount-eligible* in the UI only.

### 2.6 Holding metrics (`computeInvestments`)
**Status** (§2.2 `HoldingStatus`):
- `held`: `openUnits > 0`.
- `watching`: not held, and `watched`.
- `exited`: not held and not watched (normally a ledger-only instrument whose units were all sold).

A watched instrument with no trades is `watching`. A held, unwatched instrument is `held` with the flag `unwatched_held`.

**Flags** (§2.2 `HoldingFlag`, schema enum):
- `unpriced`: held, and the effective price is null.
- `stale_price`: held, and the price status is `stale` or `failed` with a last good price.
- `oversell`
- `unwatched_held`

| Field | Rule (sheet reference) |
|---|---|
| `netUnits` | Σ trade units (Stocks G, ETFs F, MF E, Crypto D). |
| `openUnits` | Σ lot remaining. Equals `netUnits` unless there is an oversell. |
| `valueCents` | `openUnits × price`, or null when unpriced (Stocks H, ETFs G, MF F, Crypto E). |
| `costCents` | Σ lot `remainingCost` (the Total Return % denominator: Σ D×L + fees of live lots). |
| `unrealisedCents` | Σ lot unrealised (null when unpriced). |
| `dividendsCents` | Σ **linked** (instrument id, D28) net amounts, all time (Stocks L, ETFs K, MF J, Crypto I = staking). |
| `totalReturnCents` | **D41:** `unrealised + dividends`, only when held and priced; otherwise null (Stocks I, ETFs H, MF G, Crypto F). |
| `totalReturnRatio` | `totalReturn / cost` (Stocks J, ETFs I, MF H, Crypto G). |
| `realisedCents` | Σ the instrument's disposals, all time (new column, D41). |
| `xirr` | Flows, with brokerage excluded as the sheet does: `−units × price` at each trade date (sells are positive), `+net` for each linked dividend at its payment date, and `+value` at `asOf` when held and priced. Null when held and unpriced (Stocks K, ETFs J, MF I, Crypto H). Exited holdings get an XIRR from their trades and dividends alone. |
| `averagePrice` | `Σ(price × remaining) / openUnits`, fees excluded; null when `openUnits = 0` (Stocks N, ETFs M, MF L, Crypto K). |
| `currentRatio` | `value / Σ values of held priced holdings of the kind`. It is `0` for a watched instrument with no open units, and null for a held unpriced one (Stocks O, ETFs N, MF M, Crypto N). |
| `differenceRatio` | `current − target` when both are set (Stocks Q, ETFs P, MF O, Crypto L). |
| `estMgmtFeeCents` | `value × ((1 + fee/365)^365 − 1)`, daily compounding (MF W). Computed for **ETFs and managed funds**; the ETF figure is an addition (§11 fix 13). |
| `lastBuyDate`, `lastTradeDate` | Max `tradeDate` over buys, and over all trades. |

**Per-kind differences** (the UI labels live in the web, §6.4):

| | Stocks | ETFs | Managed funds | Crypto |
|---|---|---|---|---|
| Fee | flat brokerage | flat | flat; the sheet has no fee column (0) | a rate (`feeRate`) or flat |
| Dividends are called | dividends | distributions | distributions | staking rewards |
| Sector | ✓ | ✓ | ✓ | — |
| Regions, location, mgmt fee | — | ✓ | ✓ | — |
| Est. mgmt fee $/yr | — | ✓ (addition) | ✓ | — |
| Counts vs limit (current `heldCount` / target `targetCount` / `investing.etfLimit`) | — | ✓ (the web warns when **either** count exceeds the limit; the sheet highlighted the target count only) | — | — |
| Allocation donut | sector, holding | sector, region, holding | sector, region, holding | coin (holding) |
| Current allocation (sheet) | O | N (the whole column errors when any price errors; fixed) | M | N (rows 2–4 only; fixed) |
| Total return of an instrument no longer held (sheet) | Σ ledger J (a fully sold lot still shows −fee) | 0 | 0 | **the staking total** (`F = IF(D>0, ΣJ, 0) + I`) |
| Total return of an instrument no longer held (app, D41) | null | null | null | null (staking stays in `dividendsCents`, realised stays separate; §11 fix 21) |

### 2.7 XIRR (a robust solver)
- **Inputs:** `{ amount (dollars, number), date }[]`.
- **Returns null when:** there are fewer than 2 distinct dates, there is not at least one positive and one negative amount, or the solver does not converge.
- **Model:** `f(r) = Σ aᵢ (1 + r)^(−tᵢ)` with `tᵢ = (dayᵢ − day_min) / 365`, solved for `r > −1`.
  1. **Newton** from `r₀ = 0.1`, up to 50 iterations. It converges when `|Δr| < 1e-10` and `|f(r)| ≤ 1e-7 × Σ|aᵢ|`. Leaving `(−1, 1e9)`, a zero or non-finite derivative, or no convergence → step 2. Heavy-loss holdings often leave the domain on the first step; the fallback is a normal path, not an error.
  2. **Bracket and bisect.** Set `lo = −0.9999999999` and `hi = 1`. Double `hi` until the sign changes or `hi > 1e9` (then null). Then bisect or use Brent until the width is below `1e-12` (at most 500 iterations).
     - **Overflow guard:** every sign test in this step uses the scaled form `g(r) = Σ aᵢ · exp(eᵢ − max e)`, with `eᵢ = −tᵢ · ln(1 + r)`. It has the sign of `f` and stays finite for any span (plain `(1 + lo)^(−t)` overflows to `Infinity` beyond about 30 years at `lo`, making `f(lo)` NaN).
- **Multiple roots:** the Newton root from 0.1 when it converges, which matches Sheets and Excel in practice.
- **Returned** as a JS number. Callers convert with `decimalFromNumber`.
- **Internal helper** (not frozen): `solveXirr(flows) → { rate, method: 'newton' | 'bracket' | null, iterations }`; `xirr` returns its `rate`. Tests assert on `method` and `iterations`, never on wall-clock time.
- **Unit tests:**
  - A closed form: −1000 → +1100 after 365 days = 0.1.
  - A loss: −1000 → +100 after one year = −0.9.
  - A +150 % month; mixed buys and sells.
  - A multi-flow heavy-loss holding where Newton leaves the domain (e.g. buys of −1000 at day 0 and −1000 at day 182, value +150 at day 329): `method = 'bracket'`, and the root satisfies `|f(r)| ≤ 1e-7 × Σ|aᵢ|`.
  - A 40-year span with flows of both signs: a finite result (the overflow guard).
  - All flows on one date → null; all negative → null.
  - A 1e-7 near-zero root.
  - A 2000-flow input that converges by Newton: `method = 'newton'`, `iterations ≤ 50`.

### 2.8 Portfolio summary and allocation
- **Summary sums** run over held **priced** holdings (value, cost, unrealised, dividends held, total return).
  - `totalReturnRatio = Σ totalReturn / Σ cost`.
  - Unpriced holdings are **left out of every sum** and counted in `unpricedCount`. They never zero the tab (§2.13, §11 fix 1).
- **`realisedCents`** covers every instrument of the kind (exited ones too). `realisedThisFyCents` covers disposals in `asOf`'s FY.
- **`xirr` (D43)** is the portfolio XIRR over all trades and linked dividends of the kind's instruments, except held unpriced ones, plus `Σ value` at `asOf`. The sheet's simple annualised figure (Stocks H17, ETFs I16, MF J16) is **not** produced. It exists only as a golden-test helper (§9.2).
- **`investmentRatePerMonthCents`** (the sheet's "1Y Inv. Rate": Stocks H18, ETFs I19, MF J17, Crypto H11):
  - Window: trades with `asOf − 365 days < tradeDate ≤ asOf`.
  - `first` = the earliest trade date in the window, buy or sell. The sheet takes the first ledger row in the window; the two agree for chronological ledgers (§11 fix 12).
  - `rate = Σ buys' order value in the window / ((asOf − first) days / 30.416)`, **rounded up to whole dollars**, returned as cents.
  - Null when the window is empty or `asOf = first`.
- **Dividends:**
  - `dividendsAllTimeCents` is the Σ over every dividend of the kind, by holding kind (linked or not).
  - `dividendsThisFyCents` covers those paid in `asOf`'s FY.
  - The template's per-tab variants (a 5-FY sum on ETFs, the "calendar year" label) become this one rule.
- **Target checks:**
  - `targetSumRatio` = Σ `targetRatio` of watched instruments. The UI warns when it is neither 0 nor 1 (±1e-9). This fixes ETFs `O13`, which missed a row.
  - `targetCount` = count(target > 0) + count(held with current > 0 and target 0 or null). This is the ETF "Target Count" (ETFs L17).
- **Allocation:**
  - `byHolding`: every held or targeted instrument; current = `currentRatio ?? 0`, target = `targetRatio ?? 0`.
  - `bySector`: current is the Σ of held priced `currentRatio` by sector; target is the Σ of watched `targetRatio` by sector. A null sector is 'Unassigned'.
  - `byRegion` (ETF and managed fund only). Keys and labels: `us` "US", `asia` "Asia", `aus` "Australia", `other` "EU/Other", `unassigned` "Unassigned".
    - current = Σ `currentRatio × region`; target = Σ `targetRatio × region`. A null region counts as 0. This is ETFs S12:V13 and MF R12:U13.
    - `unassigned` = the total weight minus the Σ of the four regions, floored at 0.
  - Slice order: current descending, then target descending, then label. The web folds anything past six slices into "Other" (STYLE_GUIDE §6.1).

### 2.9 Dividend and staking metrics
- **Per payment** (output: `InvestmentsResult.dividends`, one `DividendResult` per input dividend; the detail page's `HoldingDividendDto` reads it):
  - `unitsAtEx` = Σ units of the instrument's trades with `tradeDate < exDate` (Dividends H). Null when `exDate` is null or the dividend is unlinked (`instrumentId` null).
  - `yield = net / (priceAtEx × unitsAtEx)`. It is null when `exDate` or `priceAtEx` is null, or `unitsAtEx ≤ 0`.
- **`dividendYieldRatio` for stocks, ETFs and managed funds** (Stocks M, ETFs L, MF K):
  - The mean of the payment yields that are not null, all time, × `365 × (count − 1) / spanDays`. `count` and `span` (the last payment date − the first) are taken over those same payments.
  - It needs `count ≥ 2` and `span > 0`; otherwise null.
  - The sheet divided by `span / count` (§11 fix 3).
- **Crypto staking yield** (Crypto J → Dividends O): the mean of the non-null yields of payments in the last 365 days × `12 / dividendFreqMonths`. When no frequency is set, the cadence rule above applies; otherwise null.
- **DRP** (`reinvested = true`) matters only for contributions (§2.11). Reinvested units are ordinary buy trades.

### 2.10 Realised-by-FY summary (D42)
This is `InvestmentsResult.realisedByFy = realisedByFinancialYear(disposals, asOf)` for the kind (§2.5). There is one table per investment page. The FY label format is `FY2025–26` (`formatFinancialYear`).

### 2.11 History functions
- **`contributionsAt`** gives the cumulative net money invested at each date:
  - Σ `units × price` (signed, fees excluded) of trades with `tradeDate ≤ date`, **minus** Σ `netAmount` of dividends with `holdingKind = kind`, `reinvested = true`, `net > 0` and `paymentDate ≤ date`.
  - Every instrument of the kind is included, **exited ones too** (§11 fix 2).
  - `≤` applies on every tab. The template's Stocks and ETFs used `<` (§11 fix 14).
  - Sheet: Stocks and ETFs `O49:P…`, MF `N23:O…`.
  - **Evaluation dates:** each snapshot's `run_date`, not the calendar month-end. The sheet evaluates at `History!A`, which is the run date for frozen rows and the month-end only for its live row. The market value the line is charted against was captured on the run date, so a buy made after a mid-month snapshot never appears before its value does. The live point uses `asOf`.
- **`purchaseWindows(runDates, liveThrough)`:**
  - Snapshot windows are `(previous run date, run date]`. The first is `(addMonthsIso(first, −1), first]`, the Stage 1 movement rule.
  - When `liveThrough` is set, a final `(last run date, liveThrough]` window is added. With no run dates, one window `(null, liveThrough]` is returned.
- **`netPurchases`** is Σ `units × price` per window (sells are negative). This is History E, I, M and AI.
- **`compressSeries(points, unit, count, modes)`:**
  - Groups points by period:
    - monthly: the `IsoMonth`, label `Aug 2026`
    - quarterly: the calendar quarter, label `Q3 2026`
    - yearly: the calendar year, label `2026`
  - Each value key uses its mode: `end` (the last point's value in the group) or `sum`.
  - A group is `live` when its last point is live.
  - Keeps the last `count` groups. `count = null` means 12 monthly, 8 quarterly or all yearly (the template's `compressTable` defaults).
  - Stage 5 reuses it for the aggregation API.

### 2.12 Timing: amount, optimiser, countdown, consider next, hint (D39, D40)
**Stage 2 input sources** (the server builds these; §4.5):

| Input | Stage 2 source | Missing → |
|---|---|---|
| Budget items, yearly expenses | imported `budget_items` (kind `item` only; the `auto_*` rows are derived) and `yearly_expenses` | `budget.items` when there are no items |
| Pay | settings `pay.frequency`, `pay.netPayCents`, `pay.dayOfMonth` | the setting key |
| Switches | `budget.useForInvestAmount` (ID 3), `budget.autoInvestSplit` (ID 33), `budget.includeSideIncome` (Budget D4) | the key (the amount becomes null); `includeSideIncome` null means false |
| Allocation | class targets: etf `allocation.etf`, stock `allocation.stock`, crypto `allocation.crypto`, cash `allocation.cash`, managed_fund `allocation.managedFund`, other_assets `allocation.otherAssets`; `investing.allocationAggressiveness` (null → aggressive, the template's else branch) | the key (a null class target leaves that class out of the minimum) |
| Cash | Σ non-offset `cash_accounts.balance_cents` (the imported balances until Stage 3) | never missing (0) |
| Emergency fund | `budget.emergencyFundMonths` (ID 30) and `budget.emergencyFundOverrideCents` (Budget D3, only when typed) | both null → `emergencyFundCents` null and `budget.emergencyFundMonths` in `missing`; the cash-first override (step 8) and the below-emergency-fund rule (`considerNext`) are then off |
| Last snapshot cash share | the latest snapshot: `cash_value / (stocks + etf + crypto + cash + mf + other value)` (SheetOptions H43) | `snapshots` (the current cash share, `cash / Σ class values`, is used instead; when that total is 0 too, the share is 0, as the sheet's IFERROR gives) |
| Side income | `side_income_entries` summed per `period_month` over its streams. `periodStart = period_start ?? the first day of the month`, `periodEnd = period_end ?? the last day of the month`. Only filled periods exist: the importer skips a row whose amounts are both blank (the sheet's unfilled current period, §11 fix 20). | the side part is 0 |
| Returns, brokerage, tax | `returns.marketReturn`, `returns.cashInterestRate`, `investing.defaultBrokerageCents`, `tax.marginalRate` | the key (plan null → countdown `unavailable`; tax null → side part 0) |
| Other assets value | Σ `(units − sold_units) × unit_price` of AUD rows of the imported `other_assets` (static until Stage 4) | 0 |
| Last purchase | max `trade_date` of **buys** of stock and ETF instruments (SheetOptions H20) | `investments.lastPurchaseDate` |
| Cash-deficit wait (H12) | **Deferred to Stage 3** (it needs the savings engine). Only relevant when cash is below its target. | reported in `deferred` |

**`budgetInvestment`** (Budget B2, C24, J4, L7, D3, C28, C29 and SheetOptions H41–H43, H2):
1. `monthlyIncome = netPay × factor(frequency) + (includeSideIncome ? sideIncome365 : 0)`.
   - Factors (spec 02 §0.5, exact template constants): monthly `1`, four_weekly `1.0833333333`, fortnightly `4.34523783659 × 0.5`, weekly `4.34523783659`, twice_monthly `2`.
   - `sideIncome365` is the mean period total over periods with `periodStart > asOf − 365 days` (Side Income C6), filled periods only (§11 fix 20).
2. `yearlyFund = ROUNDUP(Σ annual / 60 dollars) × 5` dollars, i.e. `ceil(Σ annualCents / 6000) × 500` cents.
3. `plannedSpend = Σ item monthly (null → 0) + yearlyFund`.
4. `leftover = monthlyIncome − plannedSpend`.
5. `emergencyFund = override ?? (months === null ? null : ceil(months × plannedSpend / 1000 dollars) × 1000 dollars)`. The template summed rows 8–26; the app sums every item row, which is identical unless the last item row is non-zero (§11 fix 15). Null → `budget.emergencyFundMonths` in `missing`.
6. `k` = light 1, normal 2, aggressive 3.
7. `share = lastSnapshotCashShare ?? currentCashShare ?? 0`.
8. `cashShare = max(min(ROUNDUP(target + k × (target − share), 2), 1), (useBudget && emergencyFund !== null && cash < emergencyFund) ? 1 : 0)`. ROUNDUP is away from zero at 2 dp. `investShare = 1 − cashShare`.
9. `investmentRow = autoInvestSplit ? ROUNDDOWN(leftover / 10 × investShare) × 10 : 0` dollars. ROUNDDOWN is toward zero.
10. `cashRow = autoInvestSplit ? ROUNDDOWN(leftover / 10 × cashShare) × 10 : ROUNDDOWN((leftover − investmentRow) / 10) × 10`.
11. `sideIncomeInvest = investShare × (1 − tax) × mean(period totals with periodEnd > lastPurchaseDate)`. It is 0 when there are no such periods or no last purchase. The sheet's AVERAGEIFS (SheetOptions H2) also counts its unfilled current period as a 0, which the importer skips, so the two agree only while no filled period ends after the last purchase; otherwise the sheet's mean is the app's × n/(n+1) (§11 fix 20; §9.3 rule 6 recomputes the expectation without the unfilled row).
12. **D40:** `monthlyInvest = (useBudget ? investmentRow : monthlyIncome × investShare) + sideIncomeInvest`. The template read the **cash** row here (§11 fix 11).

Any of `netPayCents`, `payFrequency`, `cashTargetRatio`, `autoInvestSplit` or `useBudgetForInvest` being null makes `monthlyInvest` null, and the key is listed in `missing`.

**`parcelOptimiser`** (spec 01 §5.4; **inferred** — the script is not in the export; SheetOptions H13 and H19):
- `monthlyInvest` null or ≤ 0 → null.
- `brokerage ≤ 0` → `{ months: 1, parcel = monthly }`.
- `growth − cashRate ≤ 0` → `{ months: 12, parcel = 12 × monthly }`.
- Otherwise:
  - `optimal = sqrt(2 × brokerage$ × 12 × monthly$ / (growth − cashRate))`, the classic order-size trade-off.
  - `months = clamp(ceil(optimal / monthly$), 1, 12)`.
  - `parcelCents = months × monthlyInvestCents`.
  - `optimalParcelCents = round(optimal × 100)`.
- The sheet's H13 and H19 are static outputs of an earlier script run. They are **not** reproduced, and the imported `investing.parcel*` settings are not used (see the owner decisions in the final report).

**`investCountdown`** (SheetOptions H14–H18, ETFs I18):
The checks run in this order:
- `monthlyInvest` null → `unavailable`.
- `monthlyInvest ≤ 0` → `cash_first` (the sheet's "Cash First").
- `plan` null, no last purchase or no pay day → `unavailable` (with the keys).
- Otherwise:
  - `periodDays = 30 × plan.months`. The H12 cash-deficit months are deferred (§1.5).
  - `base = sheetDate(year(last), month(last), payDay + 2)`, then `+ periodDays` days.
  - Roll forward to a **Thursday**: with `w` = weekday, Sun=1…Sat=7, add `w ≤ 5 ? 5 − w : 12 − w` days.
  - When `growth = 0`, add 365 days (the template quirk, kept).
  - The result is `nextPurchaseDate`.
  - `asOf ≥ nextPurchaseDate` → `invest`. Else `wait` with `days = nextPurchaseDate − asOf` (calendar days; the template's half-day offset is dropped, §11 fix 16).

**`considerNext`** (Net Worth B36:E45):
- Class values come from the server: the four investment kinds from `computeInvestments` summaries (priced values), plus cash and other assets as above.
- `current = value / Σ values` (0 when the total is 0). `delta = current − target`, and null when the target is null.
- If the emergency fund is known and `cashCents < emergencyFund` → `cash` (`below_emergency_fund`). `E45` applies this rule whatever the "use budget" switch says; only the cash split (step 8 of `budgetInvestment`) checks that switch.
- Otherwise the class with the minimum delta → `most_underweight`. Ties go to `ASSET_CLASSES` order. With no targets → `no_targets` and a null class.
- The row order is `ASSET_CLASSES`.

**`nextBuyHint`** (Stocks H19, ETFs I17, Crypto H12, SheetOptions B74:B78):
- If `considerNext.assetClass === assetClassOfKind(kind)`, pick the holding with the minimum `differenceRatio` among watched instruments with a target and a non-null `currentRatio`. Held unpriced ones are skipped; ties go to holding order.
- The result is `{ assetClass, instrumentId, parcelCents }`. Otherwise it is `{ assetClass, instrumentId: null, parcelCents: null }`.
- Crypto uses the same rule (§11 fix 5). The template read an empty column and total return.

### 2.13 Prices and unpriced holdings
- The server passes each instrument's **effective price** from `market.getPrices()`: `PriceItem.price` (manual wins over the last good fetched price) and `PriceItem.status`. The engine never fetches.
- **Held with no price:**
  - `valueCents`, `unrealisedCents`, `totalReturnCents`, `totalReturnRatio`, `xirr` and `currentRatio` are null.
  - The holding is flagged `unpriced`, left out of every summary sum and of the portfolio XIRR, and counted in `unpricedCount`.
  - Its cost stays in `costCents` on the holding row, but **not** in the summary cost.
- **Stale or failed with a last good price:** the price is used and the holding is flagged `stale_price`.
- Watching and exited instruments need no price.

---

## 3. Data model changes (`@joinr/schema`, migration `0002_stage2_investments`)

### 3.1 Migration (append-only; stage-1 §2.1 evolution rule)
```sql
ALTER TABLE `instruments` ADD `default_fee_cents` integer;   -- D38: the holding's flat default fee (null = global default)
ALTER TABLE `instruments` ADD `default_fee_rate` text;       -- D38: crypto % default (ratio; null = crypto.feeRate)
```
- Drizzle `instruments`: `defaultFeeCents: integer('default_fee_cents')` and `defaultFeeRate: text('default_fee_rate')`. Both are nullable, with no default and no CHECK.
- Generate with `pnpm --filter @joinr/server db:generate --name stage2_investments`, giving `0002_stage2_investments.sql` plus `meta/`. Then run `git diff --exit-code` on the `0000_*` and `0001_*` SQL and snapshot files.
- **No new tables.** The D34 deletion marker lives in `app_meta` (§3.3).
- The importer's instrument upsert does not write these columns (they are not in its row, stage-1 §4.8), so a re-import keeps them. A server-api test proves it (§7.4 step 5: synthetic import → set a default fee → re-import → the fee is kept).

### 3.2 Schema module changes (Scaffolder)
- **`enums.ts`** (append only):
  ```ts
  TRADE_SIDES          = ['buy', 'sell']
  QUANTITY_MODES       = ['units', 'amount']                                  // D38
  FEE_KINDS            = ['flat', 'rate']
  HOLDING_STATUSES     = ['held', 'watching', 'exited']
  HOLDING_FLAGS        = ['unpriced', 'stale_price', 'oversell', 'unwatched_held']
  CAPITAL_GAIN_TERMS   = ['short', 'long']
  ASSET_CLASSES        = ['etf', 'stock', 'crypto', 'cash', 'managed_fund', 'other_assets']   // Net Worth B38:B43 order
  CONSIDER_REASONS     = ['below_emergency_fund', 'most_underweight', 'no_targets']
  COUNTDOWN_STATES     = ['wait', 'invest', 'cash_first', 'unavailable']
  DEFERRED_TIMING_INPUTS = ['cash_deficit_period']
  ```
  Each tuple is `as const` with its type: `TradeSide`, `QuantityMode`, `FeeKind`, `HoldingStatus`, `HoldingFlag`, `CapitalGainTerm`, `AssetClass`, `ConsiderReason`, `CountdownState`, `DeferredTimingInput`.
- **`rows.ts`:** `newInstrumentSchema` gains `defaultFeeCents: nullable(CentsSchema.min(0))` and `defaultFeeRate: nullable(DecimalStringSchema)`. The type-level parity test is updated.
- **`records.ts`:** the `instruments` entity gains the columns `defaultFee:money` ("Default fee") and `defaultFeeRate:ratio` ("Default fee %"). The server's records serializer maps them. The Scaffolder does this so the Stage 1 records tests stay green (§7.2).
- **`trading.ts`** as §2.3, exported from the root.
- **`dto/investments.ts`** as §4.3–4.4, exported from the root, including the instrument helpers of §4.3 (`instrumentKindIssues`, `makeInstrumentUpdateSchema`, `instrumentEditableFromDto`, `normaliseInstrumentEditable`). **`dto/errors.ts`** gains three codes (§4.1).
- **`pricing.ts`** gains `splitSymbol(symbol) → { exchange, code }`, moved from the importer so the server's instrument create uses the same rule. The importer's `process.ts` re-exports it from `@joinr/schema` so its internal uses and tests are unchanged.
- **`testing`** gains `COMMITTED_MIGRATION_COUNT` (the entry count of `apps/server/migrations/meta/_journal.json`, read next to `MIGRATIONS_DIR`). Every test that asserts a migration count uses it instead of a literal, so later stages do not repeat the 2 → 3 edits.
- **`settings.ts`:** unchanged. Stage 2 reads the keys listed in §2.12 and `charts.dateUnit` / `charts.unitCount`.

### 3.3 Origin rules and D34
| Action | Effect |
|---|---|
| Create a trade or instrument | `origin = 'app'`, `sheet_ref = null`. |
| Update a trade | `origin = 'app'`. `sheet_ref` and `correction_id` are kept. `review_flags` is **cleared**: the owner has reviewed the row, and `oversell` is recomputed live anyway. |
| Update an instrument | `origin = 'app'` when any importer-written column changes, i.e. everything except `default_fee_cents` and `default_fee_rate`. "Changes" is decided after `normaliseInstrumentEditable` on both the stored row and the body (trimmed text, `''` ≡ null, `normaliseDecimal` ratios, all-null regions ≡ null, the `AUD` default), so a no-op save never flips `origin`. Setting only a default fee keeps `origin`. |
| Delete a trade or instrument that **came from the workbook** (`sheet_ref` not null, whatever its current `origin`: an imported row edited in the app keeps its `sheet_ref`) | Write or update the `app_meta` row `app_edits.deleted_import_rows` = `{"count": n, "lastAt": "<ISO>"}` in the same transaction. Deleting a row created in the app (`sheet_ref` null) writes nothing. |
| `hasAppData(db)` (server-api, `db/queries/domain.ts`) | Also true when that `app_meta` key exists. The upload route (409 `IMPORT_APP_DATA_EXISTS`) and the CLI (exit 3 without `--yes --replace-app-data`) are unchanged. |
| A committed import succeeds (CLI with `--replace-app-data`, or the upload route when allowed) | `clearAppEditMarker(db)` deletes the key after the run succeeds. A dry run leaves it. |

This keeps D34's promise: a re-import can no longer undo an in-app edit, including a deletion, without the explicit CLI override.

### 3.4 Seed and fixtures (Scaffolder)
- **`seedGenericData`:**
  - Sets `default_fee_cents = 0` on one ETF and `default_fee_rate` on one crypto (the seed's instruments have `sheet_ref` set, like imported rows).
  - Leaves every `origin` as it is: **no `app` rows**, so the Stage 1 import-route tests that seed and then import still get 201.
  - It still fills every table, and the seed test is extended to assert the new columns.
- **`src/fixtures/investments.ts`** (exported from `@joinr/schema/fixtures`). Typed with `satisfies`, generic values only, internally consistent (ids, sums, statuses). It includes:
  - `investmentPages: Record<InstrumentKind, InvestmentPageResponse>` (populated, one per kind):
    - stock: `ASX:ABC` (held; one partly-sold lot) and `ASX:XYZ` (held), an exited `ASX:OLD` (with a realised gain), a watching instrument.
    - etf: `ASX:DEF` (`$0` default fee), `ASX:MNO`, regions set.
    - managed_fund: `EXAMPLEFUND` (manual price, mgmt fee).
    - crypto: `BTC` and `ETH` (a rate fee, staking dividends).
  - `investmentPageEmpty(kind)`.
  - `investmentPageUnpriced` (one held unpriced, one stale) and `investmentPageAllUnpriced` (every held holding unpriced: value $0, null XIRR, an empty current ring).
  - `investmentPageNulls`: null portfolio XIRR, null 1Y rate, null `emergencyFundCents`, a held holding first bought under 90 days before `asOf` (§6.3 XIRR rule), and a watched fully-sold holding with realised and dividends.
  - `investmentPageTiming`: one page per countdown state (`wait`, `invest`, `cash_first`, `unavailable` with missing keys) and each `ConsiderReason`.
  - `investmentTrades: Record<InstrumentKind, InvestmentTradesResponse>`:
    - Includes a sell with realised short and long parts, an oversold sell (flag), an imported flagged row (`out_of_order`), an `app` row and a crypto rate fee.
  - `holdingDetails: Record<number, HoldingDetailResponse>`: a held stock with open and closed lots and disposals, an exited ETF, a crypto with staking dividends and yields.
  - `instrumentDtos` (one per kind, with and without a default fee), `tradeMutationResponse`, `deletedResponse`.
  - `apiErrors` gains `tradeOversell`, `instrumentExists`, `instrumentInUse` and `tradeValidation` (a field-path message such as `quantity.units: must be a positive number`).
  - `FIXTURE_COVERAGE` gains `holdingStatuses`, `holdingFlags`, `countdownStates` and `considerReasons`, so a schema test can assert full coverage.

---

## 4. API contract (FROZEN)

All routes are under `/api`, JSON, `cache-control: no-store`, with the Stage 0 error shape. Request bodies, params and queries are validated with `parseWith(schema, value)` (400 `VALIDATION_ERROR`, message `path: issue; …`). Money is integer cents; decimals are strings.

### 4.1 Error codes (`API_ERROR_CODES` gains three)
Status codes: `TRADE_OVERSELL` **422** · `INSTRUMENT_EXISTS` **409** · `INSTRUMENT_IN_USE` **409**. The existing `NOT_FOUND` 404 and `VALIDATION_ERROR` 400 are reused.

The `TRADE_OVERSELL` message names the first newly oversold sell, e.g. "The sell on 15/11/2025 is for 20 units but only 12 are held then." (dd/mm/yyyy; generic in the fixtures).

### 4.2 Endpoints
| Method & path | Request | 2xx | Errors |
|---|---|---|---|
| `GET /api/investments/:kind` | `kind ∈ INSTRUMENT_KINDS` | 200 `InvestmentPageResponse` | 404 unknown kind |
| `GET /api/investments/:kind/trades` | — | 200 `InvestmentTradesResponse` (newest first: date desc, seq desc, id desc) | 404 |
| `GET /api/instruments/:id` | positive int | 200 `HoldingDetailResponse` | 400 · 404 |
| `POST /api/instruments` | `instrumentCreateSchema` | **201** `InstrumentDto` | 400 · 409 `INSTRUMENT_EXISTS` (same kind and symbol) |
| `PUT /api/instruments/:id` | `makeInstrumentUpdateSchema(storedKind)` (full replace of the editable fields; the per-kind rules run with the stored kind) | 200 `InstrumentDto` | 400 · 404 |
| `DELETE /api/instruments/:id` | — | 200 `DeletedResponse` | 404 · 409 `INSTRUMENT_IN_USE` (trades or dividends reference it) |
| `POST /api/trades` | `tradeInputSchema` | **201** `TradeMutationResponse` | 400 · 404 (instrument) · 422 `TRADE_OVERSELL` |
| `PUT /api/trades/:id` | `tradeInputSchema` (`instrumentId` must equal the stored one, else 400) | 200 `TradeMutationResponse` | 400 · 404 · 422 |
| `DELETE /api/trades/:id` | — | 200 `DeletedResponse` | 404 · 422 `TRADE_OVERSELL` (a later sell needs this buy) |
| `GET /api/health` | (Stage 0) | `db.migrations` becomes **3** | |

Every trade and instrument mutation also answers **409 `IMPORT_IN_PROGRESS`** (the existing code) while an upload import holds the import lock (§4.5).

### 4.3 Request schemas (`dto/investments.ts`)
```ts
export const investmentKindParamsSchema = z.object({ kind: z.enum(INSTRUMENT_KINDS) });   // failure → 404, not 400
export const idParamsSchema = z.object({ id: /^[1-9]\d{0,15}$/ → Number });              // as the prices routes
export const tradeDecimalSchema = (max: number) =>                 // PositiveDecimalSchema(TRADE_DECIMAL_MAX_DP, max)
  PositiveDecimalSchema(TRADE_DECIMAL_MAX_DP, max).refine(withinDecimalInputLimits, …);  // + ≤ DECIMAL_INPUT_MAX_SIG significant digits
export const ratioInputSchema = (max = 1) =>                        // "0.25" → "0.25"; 0 ≤ r ≤ max; no sign or exponent;
  z.string().trim()….refine(withinDecimalInputLimits).transform(normaliseDecimal);   // ≤ 18 dp and ≤ 15 significant digits
const optionalText = (max: number) =>                               // trimmed; '' → null (so a blank field never fails or flips origin)
  z.string().trim().max(max).transform((v) => (v === '' ? null : v)).nullable();
export const feeSpecInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('flat'), cents: CentsSchema.min(0).max(100_000_000) }),
  z.strictObject({ kind: z.literal('rate'), rate: ratioInputSchema() }),   // crypto only (server check)
]);
export function makeTradeInputSchema(now: () => Date) {                 // tradeInputSchema = make…(() => new Date())
  return z.strictObject({
    instrumentId: z.number().int().positive(),
    side: z.enum(TRADE_SIDES),
    tradeDate: IsoDateSchema,                    // ≥ 1900-01-01 and ≤ tomorrow (local calendar date at parse time)
    quantity: z.discriminatedUnion('mode', [
      z.strictObject({ mode: z.literal('units'), units: tradeDecimalSchema(1e12) }),
      z.strictObject({ mode: z.literal('amount'), amountCents: z.number().int().positive().max(1e13) }),  // D38
    ]),
    price: tradeDecimalSchema(1e9),                              // AUD per unit
    fee: feeSpecInputSchema,
    note: optionalText(200).optional(),                          // '' → null
  });
}
const regionsInputSchema = z.strictObject({ us: ratio, asia: ratio, aus: ratio, other: ratio });  // each nullable; Σ ≤ 1 + 1e-9
export const instrumentUpdateSchema = z.strictObject({            // kind-agnostic base; never used alone on a route
  name: optionalText(120),
  quoteCurrency: z.string().regex(/^(?:[A-Z]{3}|GBX|GBp)$/).default('AUD'),
  watched: z.boolean(),
  targetRatio: ratioInputSchema().nullable(),
  sector: optionalText(60),
  location: optionalText(60),
  mgmtFeeRatio: ratioInputSchema(0.1).nullable(),
  regions: regionsInputSchema.nullable(),
  dividendFreqMonths: z.number().int().min(1).max(12).nullable(),
  drp: z.boolean().nullable(),
  defaultFee: feeSpecInputSchema.nullable(),
  note: optionalText(200),
});
export type InstrumentEditable = z.output<typeof instrumentUpdateSchema>;
/** The per-kind rules below as field-path issues ({ path: 'regions', message }); [] when valid. */
export function instrumentKindIssues(kind: InstrumentKind, input: InstrumentEditable): { path: string; message: string }[];
/** instrumentUpdateSchema + superRefine(instrumentKindIssues(kind, …)): PUT uses it with the STORED kind; the web form too. */
export function makeInstrumentUpdateSchema(kind: InstrumentKind): z.ZodType<InstrumentEditable>;
export const instrumentCreateSchema = instrumentUpdateSchema.extend({
  kind: z.enum(INSTRUMENT_KINDS), symbol: z.string().trim().min(1).max(32),
}).superRefine(/* instrumentKindIssues(kind, …) + the symbol rule */);
/** The one canonical mapping of the editable columns, used to build a form body and to compare for origin (§3.3). */
export function instrumentEditableFromDto(dto: InstrumentDto): InstrumentEditable;   // regions null for stock/crypto or all-null
export function normaliseInstrumentEditable(v: InstrumentEditable): InstrumentEditable; // trim, '' → null, normaliseDecimal, all-null regions → null
```
Refinements attached before `.extend()` do not carry over (zod 4), which is why the per-kind rules live in `instrumentKindIssues` and are attached to each final schema.

**Per-kind rules** (`instrumentKindIssues`, so the server and the web get the same field-path errors):

| Kind | Symbol (normalised) | Fields that must be null |
|---|---|---|
| stock | upper-cased, `^[A-Z]{1,10}:[A-Z0-9][A-Z0-9.\-]{0,11}$` (EXCHANGE:CODE, the sheet's rule) | location, mgmtFeeRatio, regions |
| etf | the same pattern | — |
| managed_fund | `^[A-Za-z0-9^.=\-_:]{1,32}$` as typed | — |
| crypto | upper-cased, `^[A-Z0-9]{1,15}$` | sector, location, mgmtFeeRatio, regions |

A `rate` fee (in the trade `fee` or `defaultFee`) is **crypto only**. The server derives `exchange` and `code` with `splitSymbol` from `@joinr/schema` (the importer's rule, now shared).

### 4.4 DTOs (`dto/investments.ts`, frozen field lists)
```ts
export type FeeSpec = …;                                          // re-exported from trading.ts
export interface PriceInfoDto { price: DecimalString | null; status: PriceStatus;
  source: 'manual' | PriceSource | null; asOf: string | null; lastError: string | null }     // from PriceItem
export interface RegionsDto { us: DecimalString | null; asia: DecimalString | null; aus: DecimalString | null;
  other: DecimalString | null }

export interface InstrumentDto {
  id: number; kind: InstrumentKind; symbol: string; exchange: string | null; code: string; name: string | null;
  quoteCurrency: string; watched: boolean; sortOrder: number; targetRatio: DecimalString | null;
  sector: string | null; location: string | null; mgmtFeeRatio: DecimalString | null; regions: RegionsDto;
  dividendFreqMonths: number | null; drp: boolean | null;
  defaultFee: FeeSpec | null;          // the holding's own default; null = use the global default
  effectiveDefaultFee: FeeSpec;        // what the trade form pre-fills (§2.3)
  note: string | null; origin: Origin; sheetRef: string | null;
  price: PriceInfoDto; tradeCount: number; dividendCount: number;   // delete needs both 0
}
export interface HoldingRowDto {
  instrumentId: number; kind: InstrumentKind; symbol: string; name: string | null; note: string | null; watched: boolean;
  status: HoldingStatus; flags: HoldingFlag[]; units: DecimalString;            // open units
  price: PriceInfoDto;
  valueCents: number | null; costCents: number; unrealisedCents: number | null; dividendsCents: number;
  totalReturnCents: number | null; totalReturnRatio: DecimalString | null; realisedCents: number;
  xirr: DecimalString | null; averagePrice: DecimalString | null;
  currentRatio: DecimalString | null; targetRatio: DecimalString | null; differenceRatio: DecimalString | null;
  dividendYieldRatio: DecimalString | null;
  sector: string | null; regions: RegionsDto | null;                          // regions: etf and managed_fund only
  mgmtFeeRatio: DecimalString | null; estMgmtFeeCents: number | null;
  lastBuyDate: IsoDate | null; lastTradeDate: IsoDate | null; effectiveDefaultFee: FeeSpec;
}
export interface InvestmentSummaryDto {                              // = SummaryResult (§2.2), field for field
  valueCents: number; costCents: number; unrealisedCents: number; dividendsHeldCents: number;
  totalReturnCents: number; totalReturnRatio: DecimalString | null; realisedCents: number; realisedThisFyCents: number;
  xirr: DecimalString | null; investmentRatePerMonthCents: number | null;
  dividendsThisFyCents: number; dividendsAllTimeCents: number;
  heldCount: number; watchingCount: number; exitedCount: number; unpricedCount: number; stalePriceCount: number;
  targetSumRatio: DecimalString; targetCount: number; estMgmtFeeCents: number | null; lastBuyDate: IsoDate | null;
}
export interface AllocationSliceDto { key: string; label: string; currentRatio: DecimalString; targetRatio: DecimalString }
export interface InvestmentAllocationDto { byHolding: AllocationSliceDto[]; bySector: AllocationSliceDto[] | null;
  byRegion: AllocationSliceDto[] | null }                            // bySector null for crypto
export interface RealisedFyRowDto { financialYear: number; shortTermCents: number; longTermCents: number;
  totalCents: number; disposals: number }
export type CountdownDto =
  | { state: 'wait'; days: number; nextPurchaseDate: IsoDate; periodDays: number }
  | { state: 'invest'; nextPurchaseDate: IsoDate; periodDays: number }
  | { state: 'cash_first' } | { state: 'unavailable' };
export interface ConsiderNextRowDto { assetClass: AssetClass; valueCents: number; currentRatio: DecimalString;
  targetRatio: DecimalString | null; deltaRatio: DecimalString | null }
export interface InvestmentTimingDto {
  monthlyInvestCents: number | null;                                  // D40
  budget: { monthlyIncomeCents: number | null; plannedSpendCents: number; leftoverCents: number | null;
    emergencyFundCents: number | null; investShareRatio: DecimalString | null; investmentRowCents: number | null;
    sideIncomeInvestCents: number; useBudget: boolean | null; source: 'imported_budget' };
  plan: { months: number; parcelCents: number; optimalParcelCents: number } | null;
  lastPurchaseDate: IsoDate | null;
  countdown: CountdownDto;
  considerNext: { assetClass: AssetClass | null; reason: ConsiderReason; rows: ConsiderNextRowDto[] };
  hint: { assetClass: AssetClass | null; instrumentId: number | null; symbol: string | null; parcelCents: number | null };
  missing: string[];            // TimingInput values; the web shows settingDef(key).label for setting keys
  deferred: DeferredTimingInput[];
}
export interface InvestmentChartPointDto { label: string; period: IsoMonth; date: IsoDate; live: boolean;
  valueCents: number | null; contributionsCents: number | null; gainCents: number | null;
  gainRatio: DecimalString | null; netPurchasesCents: number | null }
export interface InvestmentChartsDto { unit: ChartDateUnit; count: number | null; points: InvestmentChartPointDto[] }
export interface InvestmentSettingsDto { defaultBrokerageCents: number | null; cryptoFeeRate: DecimalString | null;
  etfLimit: number | null }
export interface InvestmentPageResponse {
  kind: InstrumentKind; asOf: IsoDate; generatedAt: IsoTimestamp;
  prices: { mode: MarketDataMode; lastRefreshAt: string | null; running: boolean };
  summary: InvestmentSummaryDto;
  holdings: HoldingRowDto[];                   // held, then watching, then exited; each in sortOrder
  allocation: InvestmentAllocationDto; realisedByFy: RealisedFyRowDto[];
  timing: InvestmentTimingDto; charts: InvestmentChartsDto; settings: InvestmentSettingsDto;
}
export interface TradeRowDto {
  id: number; instrumentId: number; symbol: string; kind: InstrumentKind; tradeDate: IsoDate; side: TradeSide;
  units: DecimalString;                          // positive
  price: DecimalString; orderValueCents: number; // positive (D33: the side says buy or sell; body text, never red)
  fee: FeeSpec;                                  // as stored: rate when fee_rate is set, else flat
  feeCents: number;                              // authority fee, rounded
  seq: number; origin: Origin; sheetRef: string | null; note: string | null;
  flags: ReviewFlag[];                           // stored review flags ∪ live 'oversell'
  correctionId: string | null;
  remainingUnits: DecimalString | null; unrealisedCents: number | null;                           // buys
  realisedCents: number | null; realisedShortCents: number | null; realisedLongCents: number | null; // sells
  oversoldUnits: DecimalString | null;
}
export interface InvestmentTradesResponse { kind: InstrumentKind; asOf: IsoDate; trades: TradeRowDto[] }
export interface LotRowDto { tradeId: number; tradeDate: IsoDate; units: DecimalString; remainingUnits: DecimalString;
  price: DecimalString; feeCents: number; remainingCostCents: number; unrealisedCents: number | null;
  unrealisedRatio: DecimalString | null; heldDays: number; termIfSoldToday: CapitalGainTerm; status: 'open' | 'closed' }
export interface DisposalRowDto { sellTradeId: number; lotTradeId: number; sellDate: IsoDate; acquiredDate: IsoDate;
  units: DecimalString; proceedsCents: number; costCents: number; gainCents: number; term: CapitalGainTerm;
  financialYear: number }
export interface HoldingDividendDto { id: number; paymentDate: IsoDate; exDate: IsoDate | null; reinvested: boolean | null;
  netAmountCents: number; priceAtEx: DecimalString | null;
  unitsAtEx: DecimalString | null; yieldRatio: DecimalString | null;      // from InvestmentsResult.dividends (§2.9)
  origin: Origin; sheetRef: string | null }
export interface HoldingDetailResponse { asOf: IsoDate; instrument: InstrumentDto; holding: HoldingRowDto;
  lots: LotRowDto[]; disposals: DisposalRowDto[]; trades: TradeRowDto[]; dividends: HoldingDividendDto[] }
export interface TradeMutationResponse { trade: TradeRowDto }
export interface DeletedResponse { id: number }
```

### 4.5 Server behaviour (server-api; `apps/server/src/investments/**`, `routes/investments.ts`)
**Route options.**
- `InvestmentsRouteOptions { database: AppDatabase; config: Config; market: MarketDataService; now?: () => Date; engine?: EngineApi }`.
- `EngineApi` is the frozen function set of §2.2. It defaults to the real `engine` value; tests inject a fake.
- **`BuildAppOptions` gains `engine?: EngineApi`** (Scaffolder), passed through to the investments routes, so route tests built with `buildApp` can inject a fake engine exactly as they inject `services`.
- `buildApp` passes its existing `now` option through. `asOf` = the **server-local calendar date** of `now()`, like the freshness rules (Stage 7 sets `TZ`).

**Page build** (`GET /api/investments/:kind`; the same inputs feed `/trades` and `/instruments/:id`):
1. Prices: `market.getPrices()`, then the items of the kind → `Map<id, { price, status }>`. `prices.mode`, `lastRefreshAt` and `running` come from `market.status()`.
2. Load the kind's instruments, their trades and the dividends with `holding_kind = kind` (the engine reads links by `instrument_id`, D28), plus the settings, snapshots and budget inputs, **in one read transaction** so a concurrent CLI import (another process) cannot give a mixed snapshot. Settings come from a typed reader, `db/queries/settings.ts` (`readSettings(db)`: parse `value_json` with `settingValueSchema(key)`; invalid → null plus a warn log without the value). The other-assets value reuses `otherAssetValueCents`, which server-api exports from `records/index.ts`.
3. `computeInvestments` for **all four kinds** (the class values feed "consider next"; the data is small). Memoise within the request.
4. Timing:
   - Build `BudgetInvestInput` (§2.12), then `budgetInvestment` → `parcelOptimiser` → `investCountdown`.
   - `considerNext` takes the four kind values, cash, other assets and the emergency fund from `budgetInvestment`. Then `nextBuyHint` for the page's kind.
   - `deferred = ['cash_deficit_period']` when cash is below its target share.
5. Charts, §5.
6. Map to the DTOs. The server adds only display fields: symbol, name, price info, `effectiveDefaultFee` and `settings`. **All figures come from the engine.**

**Trade mutations** (one synchronous `BEGIN IMMEDIATE` transaction; `db.transaction(fn, { behavior: 'immediate' })` or the better-sqlite3 equivalent used by the Stage 1 price writes):
0. If `importLock.held` (the upload import's process-wide lock, `routes/import.ts`) → 409 `IMPORT_IN_PROGRESS`, before anything else.
1. Parse (400). Load the instrument (404). Kind rules: a `rate` fee is crypto only (400). On update, the instrument cannot change (400).
2. Units:
   - Units mode: as given.
   - Amount mode (D38): `unitsFromAmount(amountCents, price, kind)`. `"0"` → 400 `quantity.amountCents: the amount buys less than one unit step`.
   - The stored units are `+u` for a buy and `−u` for a sell.
3. Fee:
   - Flat: `fee_cents = cents`, `fee_rate = null`.
   - Rate: `fee_rate = rate`, `fee_cents = tradeFeeCents(...)`, the display value.
4. `seq`: create → `1 + max(seq)` over trades of instruments of the **same kind** (0 when none). Update → kept.
5. **Oversell check:**
   - Call `computeInvestments` restricted to that one instrument (its trades only; no prices needed) before and after the change.
   - If the Σ of `oversoldUnits` after > before → roll back, 422 `TRADE_OVERSELL`.
   - Imported ledgers that already contain an oversell stay editable, as long as an edit does not make it worse.
   - The same check covers a DELETE of a buy.
6. Write with the §3.3 origin rules. A delete of a row with a `sheet_ref` writes the marker.
7. Commit. Then, if the instrument's held status changed (open units crossed 0), call `market.notifyInstrumentsChanged()`.
8. Respond with the `TradeRowDto` recomputed by the engine for the kind (201 or 200). DELETE → `{ id }`.

**Instrument mutations** (same transaction style; the same 409 `IMPORT_IN_PROGRESS` pre-check):
- **Create:**
  - Normalise the symbol per kind; `(kind, symbol)` must be unique → 409 `INSTRUMENT_EXISTS`.
  - `sort_order = 1 + max` within the kind. `is_watched = watched`. `quote_currency` defaults to `AUD`. `exchange` and `code` from `splitSymbol`.
  - Insert `price_sources` with `derivePriceSource()` and `symbol_origin = 'derived'`, as the importer does.
- **Update:** parse with `makeInstrumentUpdateSchema(storedKind)`; apply the editable fields with the origin rule of §3.3, comparing `normaliseInstrumentEditable(stored)` with `normaliseInstrumentEditable(body)`. `symbol` and `kind` are immutable.
- **Delete:** 409 `INSTRUMENT_IN_USE` when any trade or dividend references it. Otherwise delete (cascades `price_sources` and `prices`) and write the marker when `sheet_ref` is not null.
- After create, update or delete: `market.notifyInstrumentsChanged()`.

**Consistency and concurrency.**
- The app is single-user: last write wins. There is no optimistic locking; the `trades` and `instruments` tables have no `updated_at`.
- SQLite serialises writers (WAL + busy timeout). The upload import awaits the corrections file **after** its `hasAppData` check, so two guards close the gap: mutations refuse while `importLock.held` (above), and `routes/import.ts` re-checks `hasAppData` synchronously right before `importWorkbook` (409 `IMPORT_APP_DATA_EXISTS`, as before).
- A CLI import running beside the server may replace rows. A later mutation that names a vanished row gets 404.
- After a mutation, `hasAppData(db)` is true unless the mutation was a default-fee-only instrument update, or the delete of an app-created row (`sheet_ref` null) with no other app data and no marker.
- **Id reuse:** instrument ids have no AUTOINCREMENT, so deleting the highest id and creating another reuses it. The price refresh's write step (`market/refresh.ts`) therefore also checks that the instrument's `kind` and `symbol` still equal the ones captured when the refresh chose its targets, and skips the write on a mismatch.

**Cross-cutting (server-api).**
- `db/queries/domain.ts`:
  - `hasAppData` checks the marker.
  - Exports `markImportRowDeleted(tx, now)` and `clearAppEditMarker(db)`.
- `cli/import.ts` and `routes/import.ts` call `clearAppEditMarker` after a committed, successful import; `routes/import.ts` also gets the synchronous `hasAppData` re-check above.
- `records/index.ts` shows the two new instrument columns (the Scaffolder does the minimum; server-api owns it afterwards) and exports `otherAssetValueCents`.
- `market/refresh.ts`: the identity check above, with a test (delete + recreate between target selection and write → no price written to the new instrument).

---

## 5. Chart data (value, gain and purchase history; allocation)

| Series (per page kind) | Source | Per snapshot period | Live point (only when no snapshot exists for `isoMonthOf(asOf)`) | Compress mode |
|---|---|---|---|---|
| Market value | **snapshots** (imported, D29 `period_month`): `stocks_value_cents` / `etf_value_cents` / `crypto_value_cents` / `mf_value_cents` | the stored value | `summary.valueCents` | end |
| Gain $ | snapshots `*_gain_cents` (the sheet froze Total Growth, the D41 definition) | stored | `summary.totalReturnCents` | end |
| Gain % | snapshots `*_gain_ratio` (History D/H/L/AH = `gain / (value − gain)`) | stored | `gain / (value − gain)`, the **same definition** (it differs slightly from the holdings table's `gain / cost`, which is noted under the chart) | end |
| Cumulative contributions | **engine** `contributionsAt(kind, trades, dividends, [runDate…, asOf])` | evaluated at the snapshot's `run_date`, where the frozen market value was captured | at `asOf` | end |
| Net purchases | **engine** `netPurchases` over `purchaseWindows(runDates, asOf)` | the window ending at that run date | the window `(last run date, asOf]` | sum |
| Allocation donuts | engine `allocation` (current = outer ring, target = inner ring) | — | live | — |

- **Why the engine for contributions and purchases:** they reflect corrections and in-app trades, and include exited instruments (§11 fix 2). The stored snapshot movement columns stay as imported; Stage 3's savings engine decides how to use them.
- **Points** are sorted by period, then compressed with `compressSeries(unit = charts.dateUnit ?? 'monthly', count = charts.unitCount ?? null)`.
- **Live point:** labelled like any period and marked `live: true`. The web appends " (live)" to its category label in both the chart and the table view (e.g. `Sep 2026 (live)`) and adds a muted note under the card: "The last point uses today's prices." There is no special marker: `@joinr/ui` charts have no per-point style, and `packages/ui` has no Stage 2 owner.
- **Empty snapshot table:** only the live point is shown. The empty state comes from the chart's `emptyMessage` when there is no data at all.
- **Crypto** had no history block in the template. Its charts come from the same snapshot columns, which the Records page already shows.

---

## 6. Web spec (`apps/web`)

### 6.1 Routes and files
- **Typed routes** in `router.tsx` replace the four placeholders:
  - `/stocks`, `/etfs`, `/managed-funds`, `/crypto` → `InvestmentPage kind=…`.
  - `/stocks/$instrumentId` (and the same under each path) → `HoldingDetailPage kind=… instrumentId=…`. `beforeLoad` accepts a positive int only (else `notFound()`). The page shows `NotFoundPage` when the instrument is of another kind (the API answers 200 with a different `kind`).
  - `pages.ts` is unchanged: the paths exist, and sub-routes already resolve to the page.
- **The kind ↔ path ↔ label map** lives in `src/pages/investments/kinds.ts`:

  | kind | path | title | dividends label | holding noun |
  |---|---|---|---|---|
  | stock | `/stocks` | Stocks | Dividends | stock |
  | etf | `/etfs` | ETFs | Distributions | ETF |
  | managed_fund | `/managed-funds` | Managed Funds | Distributions | fund |
  | crypto | `/crypto` | Crypto | Staking | coin |

- **Asset class labels** (`ASSET_CLASSES`): ETFs · Stocks · Crypto · Cash savings · Managed funds · Other assets.
- **Files:** `src/pages/investments/**`, e.g. `InvestmentPage.tsx`, `HoldingsTable.tsx`, `TradeLedger.tsx`, `TradeForm.tsx`, `HoldingForm.tsx`, `NextBuyCard.tsx`, `AllocationCard.tsx`, `HistoryCharts.tsx`, `RealisedFyTable.tsx`, `HoldingDetailPage.tsx`, `kinds.ts`, `display.ts`. No folder named `data`.

### 6.2 API layer (`src/api/hooks.ts` additions)
- **Query keys** (fixed):
  - `['investments', kind]`
  - `['investments', kind, 'trades']`
  - `['instruments', id]`
- **Queries:** `useInvestmentPage(kind)`, `useInvestmentTrades(kind)` (the ledger, key `['investments', kind, 'trades']`) and `useHoldingDetail(id)` refetch every 60 s while visible, like `usePrices`.
- **Mutations:**
  - `useCreateTrade`, `useUpdateTrade`, `useDeleteTrade`
  - `useCreateInstrument`, `useUpdateInstrument`, `useDeleteInstrument`
- **On success**, every mutation invalidates `['investments']`, `['instruments']`, `['prices']`, `['records']`, `['import']` (`hasAppData` changes) and `['status']`.
- **Stage 1 hooks:** `invalidateAfterImport` and `invalidatePrices` also invalidate `['investments']` and `['instruments']`, so an import, a refresh, a manual price or a source change never leaves stale investment figures behind the 30 s `staleTime`.
- **Imports:** DTO types with `import type`. Value imports from `@joinr/schema` root only: enums, `trading.ts` (incl. `ratioFromPercentText`, `percentTextFromRatio`), the instrument helpers of §4.3 (`makeInstrumentUpdateSchema`, `instrumentEditableFromDto`, `normaliseInstrumentEditable`), `settingDef`, `financialYearOfIso`.

### 6.3 Investment page composition (desktop ≥ 1200 px; STYLE_GUIDE §3–§6, §8, §10)
1. **`PageHeader`**
   - Title = the kind title (h1; the smoke spec asserts it), sub-line "Investments".
   - Actions: **Add trade** (primary, `Plus`) and **Add holding** (secondary).
   - Freshness under the header: "Prices 14:32" from `prices.lastRefreshAt`, and the `Pill` "Test prices" in fake mode.
2. **Price callout** (`Callout important`, only when `unpricedCount + stalePriceCount > 0`):
   - Text: "1 holding has no price and is left out of the totals: ASX:ABC. 2 prices are stale."
   - It links to `/prices`. Plain words (STYLE_GUIDE §8 tone).
3. **KPI tiles** (`Grid`; rows are always full: **6 tiles at span 4** on stocks, managed funds and crypto; **8 tiles at span 3** on ETFs; tablet 6, phone 12):
   - Portfolio value: the **only teal KPI** (key figure), whole dollars. Hint "3 holdings", or "3 held · 1 without a price" whenever `unpricedCount > 0`; managed funds append " · est. fees $X/yr".
   - Total return: $ with a `delta` of `%` (the up/down arrow and word, go/stop tone), hint "Unrealised + dividends, priced holdings".
   - Realised gains: all time (every instrument, exited ones included), hint "This FY $X".
   - Est. return / yr (XIRR). Null → "—" with the hint "Needs a priced holding and two dates". When the kind's first trade is under 90 days before `asOf` → "—" with the hint "Held under 90 days" (the XIRR display rule, item 4).
   - Invested / month: the 1Y rate, "$X/month". Null → "—" with the hint "No trades in the last 12 months".
   - Dividends this FY (kind label), hint "All time $X"; crypto adds " · fee rate 0.1%".
   - ETF extras (tiles 7 and 8): "Holdings" with the value "4 · target 5 · limit 6" and a `StatusBadge status="check" label="Over limit"` when **either** `heldCount` or `targetCount` exceeds `etfLimit`; "Est. fees / yr".
4. **`SectionBar` "Holdings"** (primary/orange), then the **holdings table** (`ColumnTable`, caption "<Title> holdings"; it scrolls inside its container with Holding sticky when it is wider than the page, on desktop too):
   - **Columns** (core, always shown):
     - Holding: the symbol in mono, the muted name, and a `StatusBadge` only for flags: `unpriced` → failed "No price"; `stale_price` → stale "Stale"; `oversell` → stop "Oversold"; `unwatched_held` → check "Not watched".
     - Value, Total return, Return %, Est. return / yr, Units, Price, Current, Target, Difference, Dividends (kind label), Realised.
   - **"More columns"** (`Switch` above the table, off by default; the choice is remembered per browser in `localStorage`, wrapped in try/catch): Average price, Yield (crypto: Staking yield), and for ETF/MF Mgmt fee and Est. fee / yr, for stocks/ETF/MF Sector. The detail page always shows them.
   - **Total row** (label "Total (priced holdings)"): Value and Total return = `summary.valueCents` / `summary.totalReturnCents` (Σ of the held priced rows; the teal key cell is Value, the only teal table cell on the page). Dividends and Realised = the Σ of the rows shown in the main table, computed in the web from the row DTOs, so the total equals what is visible. The exited `<details>` table has its own "Total" row for Realised; the all-time realised figure lives on the KPI tile.
   - **Cells:**
     - Money is 2 dp, and negatives use the stop tint **only for losses and negative returns**.
     - Ratios are 1 dp. Units with `maxDp = AMOUNT_MODE_UNIT_DP[kind]` (stock and ETF 4, fund 6, crypto 8) in every investment table, preview and form. Prices via `formatPrice` (crypto and MF up to 8 dp).
     - A null value shows `Missing` (—).
     - **XIRR display rule** (web only; the engine values and goldens are unchanged): a held holding whose first trade is under 90 days before `asOf` shows "—" with a tooltip/`title` "Held under 90 days", because a few days' move annualises into extreme figures (§11 fix 22). The same rule applies on the detail page tile.
     - Each row links to the detail page.
   - **Watching** instruments follow the held rows. They show Price, Target, Difference, Dividends and Realised when non-null (a fully sold watched holding keeps its realised gain and dividends visible); only value-type cells (Units, Value, Total return, Return %, Est. return / yr, Current) show dashes. **Exited** instruments go in a closed `<details>` "Exited holdings (n)": Holding, Realised, Last trade, plus the total row.
   - A target warning shows under the table when `targetSumRatio ∉ {0, 1}`: "Targets add up to 95%".
5. **Two-column `Grid`** (6/6), under the `SectionBar` supporting/teal "Next buy & allocation":
   - **Card "Next buy"**. The hint line shows on all four pages; the countdown, parcel and amount show **on the ETFs page only** (the sheet's countdown lived on ETFs; the timing is about ETF and stock buys). The other pages show the hint line, the class row of the `KeyValueTable`, and a link "See the timing on the ETFs page".
     - Hint line, by `considerNext.reason` and `hint`:
       - a holding of this kind: "Consider ASX:DEF — $1,500.00 parcel" (no parcel → "Consider ASX:DEF").
       - another class, `most_underweight`: "Consider ETFs".
       - `below_emergency_fund`: "Top up cash first: cash is below the emergency fund ($10,000.00)".
       - `no_targets`: "Set allocation targets to get a suggestion".
     - Countdown line (ETFs page):
       - wait: "Wait 12 days (next buy 18/08/2026)"; one day → "Wait 1 day (…)".
       - invest: "N days since the last buy: consider investing", with N = `asOf − timing.lastPurchaseDate` (pluralised: "1 day since …").
       - cash_first: "Cash first: nothing is left to invest this month"
       - unavailable: "Not available" (the missing callout says why).
     - `KeyValueTable` (ETFs page):
       - Monthly amount to invest: "$X from the budget's investment row + $Y side income" when `budget.useBudget` is true; otherwise "$X of monthly income at the invest share + $Y side income".
       - Parcel: "Every N months · $X (estimate; optimal $Y)". The optimiser formula is inferred, so it is labelled an estimate.
       - Last ETF or stock buy: dd/mm/yyyy.
       - Asset class (all pages): current % vs target % for the suggested class.
     - A muted foot line: "From the imported budget; the live budget arrives in Stage 3."
     - `missing` → a `Callout note` listing the labels: `settingDef(key).label` for setting keys; `budget.items` "Budget items", `snapshots` "Monthly snapshots" and `investments.lastPurchaseDate` "An ETF or stock buy" for the others. It ends: "Set these in the workbook and re-import (only while no app edits exist), or on the Settings page in Stage 5." `deferred` → "Cash is below its target; the cash-first wait is added in Stage 3."
   - **`ChartCard` "Allocation"**:
     - A `DonutChart` with current as the outer ring, target as the inner ring, and the centre label "Value" with whole dollars.
     - A segmented switch, `Button`s with `aria-pressed`: By sector · By region (ETF and MF) · By holding. Crypto shows By coin only.
     - The table view: Slice, Current, Target, Difference.
     - When no held holding is priced (the current ring is empty, so `DonutChart` shows its empty state), the card opens on the table view and the chart's `emptyMessage` is "No priced holdings yet. Targets are in the table view."
6. **`SectionBar` "History"** (supporting), then three `ChartCard`s, each with a Chart | Table toggle:
   - **Value:** an `AreaChart`, not stacked: "Contributions" (slot 2) vs "Market value" (slot 1), with a legend.
   - **Gain:** a `LineChart` with a $ | % switch. One series, chart teal.
   - **Net purchases:** a `BarChart`, one series, teal. **No `signColors`:** a net-sell month is not a loss (D33).
   - The live point's category label ends in " (live)" in the chart and the table, with the muted note "The last point uses today's prices." (§5).
7. **`SectionBar` "Realised gains by financial year"** (supporting):
   - A `ColumnTable` with columns Financial year (`FY2025–26`), Short term (under 12 months), Long term (12 months or more), Total, Disposals. The total row is the all-time total. No `keyColumnId` (no teal cell).
   - Then a `Callout note`: "No tax is calculated. Long term = held 12 months or more; those gains may be eligible for the CGT discount." (D42).
   - Empty → "No realised gains yet."
8. **`SectionBar` "Trades"** (reference/violet: raw ledger data):
   - Filters (`Cluster`): Holding (`Select`, "All holdings"), Side (All · Buys · Sells).
   - **`ColumnTable`** columns: Date, Holding, Side (the word "Buy" or "Sell"), Units, Price, Order value (always positive, body text, D33), Fee, Result, Flags, Source, Actions.
     - Result: buys show "12.5 of 15 left" plus unrealised; sells show the realised gain as an `Amount`, red only when negative, with an "Oversold 5" badge when relevant.
     - Flags: review flags as `StatusBadge check` with words, reusing `pages/records/cells.tsx` labels.
     - Source: a small muted "App" for `origin = 'app'`, "Workbook" otherwise (so the owner can see which rows an edit would turn into app data).
     - Actions: ghost buttons with icons and the visible labels "Edit" and "Delete"; the full text ("Edit ASX:DEF trade of 18/08/2026") is the `aria-label`.
   - Newest first. The table caption shows the row count.

### 6.4 Per-kind differences (web)
- **Crypto:**
  - There are no sector or region switches.
  - The dividends label is Staking. The yield column is "Staking yield".
  - The fee field in the trade form is a **percentage** by default, with a "Flat fee instead" `Switch`.
  - Prices show up to 8 dp and units 8 dp.
- **Managed funds:**
  - The default fee is `$0` unless the holding sets one.
  - The price source is usually manual: the price badge is "Manual", with a link to `/prices`.
  - Units show up to 6 dp.
- **ETFs:** shows the counts tile and the limit warning, and the full timing card (§6.3 item 5).
- **Stocks:** no regions.

### 6.5 Holding detail (`/<kind path>/$instrumentId`)
- **Header:** `PageHeader` with title = symbol (h1), subtitle = the name (or kind title), a back link "All <title>", and actions Add trade and Edit holding.
- **KPI tiles** (6 at span 4): Value (key), Units, Total return, Realised, Est. return / yr (the 90-day display rule of §6.3), Average price. The "More columns" fields (yield, mgmt fee, est. fee, sector) show in a `KeyValueTable` under the tiles.
- **Lots** (`SectionBar` "Parcels"): `ColumnTable` with Bought (date), Units, Left, Price, Fee, Cost left, Unrealised, Return % (vs original cost), Held (days), "If sold today" (`Pill` "Short term" / "Long term"), Status (open/closed).
- **Disposals:** Sold, Bought, Units, Proceeds, Cost, Gain (red only when negative), Term, FY.
- **Trades:** the ledger filtered to this holding, with the same actions.
- **Dividends** (read-only in Stage 2): Paid, Ex-date, Net, Reinvested, Price at ex-date, Units at ex-date, Yield. A note: "Dividends are edited on the Dividends page (Stage 3)."
- **Holding settings:** the `HoldingForm` (§6.6) in a `Card`. **Delete holding** (danger) shows only when `tradeCount = 0` and `dividendCount = 0`, behind an inline "Do not" confirm (with the workbook callout of §6.6 when `sheetRef` is set).

### 6.6 Forms
- **`TradeForm`** (an inline `Card` under the page header or the detail header; one open at a time):
  - Fields:
    - Holding: `Select` of held, watching and exited instruments of the kind, pre-selected on the detail page.
    - Side: two `Button`s with `aria-pressed`, "Buy" and "Sell". When Side = Sell, the hint "Held now: N units" (the holding's open units, `AMOUNT_MODE_UNIT_DP[kind]` dp).
    - Date: `DateField`, default today, max today.
    - Entry: a segmented "Units" / "Amount" (D38: units = amount ÷ price; the fee is on top). **Default mode:** Amount when the selected holding's `effectiveDefaultFee` is a $0 flat fee (auto-invest holdings), otherwise Units; the owner's last explicit choice is remembered per browser (`localStorage`, try/catch) and wins. Edit always opens in Units mode.
    - Units (`NumberField`, maxDp `TRADE_DECIMAL_MAX_DP`, so any stored trade can be edited) **or** Amount (`MoneyField`).
    - Price per unit: `NumberField`, maxDp `TRADE_DECIMAL_MAX_DP`, pre-filled with the holding's effective price, with the hint "Current price $X".
    - Fee:
      - Flat: `MoneyField`, pre-filled from `effectiveDefaultFee` (D38), hint "Default for this holding".
      - Crypto: a "Fee %" `NumberField` in percent (maxDp `PERCENT_INPUT_MAX_DP`), converted with `ratioFromPercentText` / `percentTextFromRatio`.
    - Note: `TextField`.
    - **Re-fill on a holding change:** when the Holding changes, the price and fee (and the default entry mode) re-fill from the new holding's price and `effectiveDefaultFee`, unless the owner has already edited that field in this form.
  - **Preview line**, computed with `@joinr/schema` `unitsFromAmount` and `tradeFeeCents`: "≈ 10.2345 units · order $500.00 · fee $0.00 · total $500.00". A sell shows "proceeds".
  - Save, then Cancel. **Save is disabled** while the form is pristine (Edit with nothing changed) and while the mutation is pending (`aria-busy` on the form), so a double-click cannot create two trades and an unchanged imported row is never PUT.
  - **Focus** (the PricesPage pattern): on open, scroll the form into view and focus its first field; on close, return focus to the button that opened it (`data-*` action buttons); after a delete, move focus to the Trades section heading.
  - **Errors:**
    - API `VALIDATION_ERROR` issues are mapped by path prefix onto fields (`quantity.units`, `price`, `fee.cents`, …); anything else goes to a form-level `Callout do-not`.
    - `TRADE_OVERSELL` → a `Callout do-not` with the server message. `IMPORT_IN_PROGRESS` → a `Callout do-not` "An import is running; try again shortly".
  - **Edit** opens the same form with the stored values (units mode; `fee` as stored; an untouched fee % or units value is sent back exactly as stored).
  - **Workbook rows** (`origin = 'import'`): the edit form and the delete confirm show a `Callout important`: "This row came from the workbook. Saving (or deleting) it counts as an app edit: re-importing the workbook will then be blocked."
  - **Delete:** the row's Actions cell is replaced by "Delete? [Delete] [Cancel]" (focus on Cancel; Escape cancels), plus the workbook callout above the table when it applies. `TRADE_OVERSELL` on delete shows the message.
- **`HoldingForm`** (create on the page; edit on the detail page):
  - Symbol: create only, with the kind hint "EXCHANGE:CODE, e.g. ASX:ABC" or "Coin symbol, e.g. BTC".
  - Name, Currency (default AUD), Watched (`Switch`), Target % (`NumberField`, suffix %), Sector.
  - Location, Management fee %, Regions % × 4 (with the running total "Regions add up to 95%"): ETF and MF only.
  - Dividend frequency (months), DRP (`Select` Yes / No / Unknown).
  - Default fee: a flat `MoneyField`, or a crypto %, plus a "Use the global default" `Checkbox` that sends null.
  - Note.
  - **Round trip (keeps `origin` and re-import safe):**
    - The request body starts from `instrumentEditableFromDto(dto)` and overlays only the fields the owner changed; untouched fields are sent exactly as the DTO holds them.
    - Empty text → null; `regions` is null for stock and crypto and when all four are empty.
    - Percent fields (target, mgmt fee, regions, crypto fee) use `ratioFromPercentText` / `percentTextFromRatio` with maxDp `PERCENT_INPUT_MAX_DP`; never float `× 100` / `÷ 100`.
    - Client validation uses `makeInstrumentUpdateSchema(kind)` (create: `instrumentCreateSchema`), so field-path errors match the server's.
  - Save is disabled while pristine and while pending. When the holding has `origin = 'import'` and the owner changed anything other than the default fee, the workbook `Callout important` shows above Save (a default-fee-only change keeps re-import allowed).
  - `409 INSTRUMENT_EXISTS` goes under the Symbol field.

### 6.7 Phone (375 px; STYLE_GUIDE §3, D31)
- One column: tiles stack, the two-column grid stacks, charts go full width with the legend above, and filters wrap.
- **No page-level horizontal scroll.** Tables scroll inside their containers, with the first column sticky.
- **Status-first column orders** (D31; `useMediaQuery(MEDIA.phone)`, as the Prices page does):
  - Holdings: Holding, Value, Total return, Return %, Price (with its status badge), Units, …the rest.
  - Trades: Date, Holding (on phone the review-flag badges and the "Oversold N" badge render inside the Holding cell, as the holdings table does), Side, Order value, Actions, Units, Price, Fee, Result, Source. The separate Flags column is dropped on phone.
  - Lots: Bought, Left, Unrealised, If sold today, …
  - FY table: unchanged (5 columns).
- Forms stack, one field per row. The Buy/Sell and Units/Amount switches stay on one line. Buttons are full width.

### 6.8 States
- **Loading:** `Loading` "Loading ETFs…".
- **Error:** `LoadError` "Could not load the ETFs" with a retry.
- **Empty kind** (no instruments): a `Callout note` "No ETFs yet. Add a holding, or import the workbook on the Import page.", with both actions.
- **Watching-only** (no trades): the tiles show $0.00 with the hint "No trades yet".
- **Every held holding unpriced:** the value tile shows $0 with "N held · N without a price", the price callout (item 2) explains it, XIRR "—", and the allocation card opens on its table view (§6.3 item 5).
- **Null tiles:** as §6.3 item 3 (XIRR, 1Y rate, the 90-day rule).
- **Charts:** with no snapshots and no value, `emptyMessage` "No history yet".
- **Price refresh running:** the freshness shows "Refreshing prices…".
- **After a mutation:** a `LiveRegion` announces "Trade added", "Trade updated", "Trade deleted" or "Holding saved".

---

## 7. Roles, tasks and FILE OWNERSHIP

### 7.0 Rules (all agents)
- **Ownership:** edit **only** files you own (§7.1). Need a change elsewhere? Report it; the coordinator routes it. Do not work around a contract gap by editing another owner's file.
- **Frozen contracts:** §2.2, §2.3, §3.1–3.3, §4 (endpoints, schemas, DTO fields, codes). Adding internal modules in your own area is fine; changing frozen names, fields or signatures is not.
- **No installs** after the Scaffolder (lockfile collisions). A missing package → stop and report.
- **Stubs** the Scaffolder creates become the named owner's files; replace them in place.
- **Scoped runs** while others work:
  - `pnpm vitest run --project engine`
  - `pnpm vitest run --project server test/investments`
  - `pnpm exec eslint packages/engine --max-warnings=0`
  - `pnpm --filter @joinr/web typecheck`

  Keep your files compiling at every step.
- **Privacy:**
  - Never paste owner values (from the workbook, the API on an owner import, `docs/private/`) into a tracked file, test, fixture, comment or commit-ready doc. Run `pnpm guard:all` before you finish.
  - A guard hit on a value you believe is generic means **change your value** (pick another round number). Never edit `docs/private/guard-terms.txt`; report the hit to the coordinator instead.
  - **No snapshot files:** no `toMatchSnapshot`, `toMatchInlineSnapshot` or `toMatchFileSnapshot`. Assert explicit fields.
  - **Owner symbols are private:** anything printed from an owner import (holding symbols, check ids, API bodies) stays in git-ignored `artifacts/` or `docs/private/`. Final reports give counts and template cell refs, never symbols or values.
  - **Golden tests** contain template cell addresses and rules only. Expected values are read from the workbook at runtime (§9).
- **Coordinator pre-step** (before the Scaffolder starts): add the distinctive Stage 2 owner values listed in `docs/private/stage-2-private.md` §8 and §8.1 (units, average prices, per-holding ratios, app-only figures, contributions) to `docs/private/guard-terms.txt` in dollar, comma and integer-cents forms. Then re-run `pnpm guard:all`; it must stay clean. Skip a term that produces a false positive on existing tracked files, and note that in the private file.

### 7.1 Ownership table (every new or changed Stage 2 file has exactly one owner)
| Owner | Files |
|---|---|
| **scaffolder** | **Dependency manifests:** `pnpm-lock.yaml` · `packages/engine/{package.json,vitest.config.ts}` · `apps/server/package.json` (the dependencies field only). **Schema, engine types and migration:** `packages/schema/**` · `packages/engine/src/types.ts` · `apps/server/migrations/**` (the new `0002_*` + `meta/`). **Tests the migration breaks** (switched to `COMMITTED_MIGRATION_COUNT`, plus the upgrade test): `apps/server/test/{migrations,app,db,backup}.test.ts` · `packages/schema/test/db.test.ts`. **Shared helper move:** `packages/importer/src/process.ts` (only: `splitSymbol` re-exported from `@joinr/schema`). **Config:** `eslint.config.js` (the engine clock rule). **Minimal edits, then handed over:** `apps/server/src/records/index.ts` (the two new instrument columns; → server-api after scaffolding). **Stubs:** `packages/engine/src/index.ts` (stubs + the `engine` value; → engine); `apps/server/src/routes/investments.ts` (→ server-api); `apps/server/src/app.ts` (`BuildAppOptions.engine` + the registration lines; → server-api); `apps/web/src/router.tsx` typed routes (→ web); `apps/web/src/pages/investments/{InvestmentPage,HoldingDetailPage}.tsx` (→ web). |
| **engine** | `packages/engine/**` except the Scaffolder files above: `src/index.ts` after scaffolding, every `src/*.ts` module, `test/**` including `test/golden/**`. |
| **server-api** | **Source (after scaffolding):** `apps/server/src/investments/**` · `apps/server/src/routes/investments.ts` · `apps/server/src/app.ts` · `apps/server/src/db/queries/{domain.ts,settings.ts}` · `apps/server/src/records/index.ts` · `apps/server/src/routes/import.ts` (the marker clear and the synchronous `hasAppData` re-check only) · `apps/server/src/cli/import.ts` (the marker clear only) · `apps/server/src/market/refresh.ts` (the identity check of §4.5 only). **Post-scaffold owner of `packages/schema/**`** for Stage 2 (DTO, `trading.ts` or fixture fixes that another agent reports): each change needs the coordinator's OK and a "Scaffold notes" entry; frozen names and fields still change only with the coordinator's approval. **Tests:** `apps/server/test/investments/**` (including the marker, `hasAppData`, the re-import-keeps-default-fee and the refresh identity tests) · `apps/server/test/golden/**` · `apps/server/test/db.test.ts` (after scaffolding). Only when an existing assertion must change: `apps/server/test/{records-routes,import-routes,cli-import}.test.ts`, `apps/server/test/market/**`. **Docs:** `README.md` (the investments API, trade entry, D34 note) · `docs/ARCHITECTURE.md` (the engine in the package graph, the page build flow). |
| **web** (phase A) | `apps/web/src/**` (incl. `router.tsx` after scaffolding, `api/**`, `pages/investments/**`, `app.css`, `components/**`) · `apps/web/test/**` (incl. supplementary fixtures in `apps/web/test/fixtures/**`, typed against the frozen DTOs with `satisfies`) · drafts of `e2e/{investments.spec.ts,investments-states.spec.ts,trades.spec.ts,investments-support.ts}` (§7.5 step 5; they pass to the Integrator with the rest). |
| **integrator** (phase B) | Takes over **web**'s files (the e2e drafts included), plus `e2e/import.setup.ts` (the cleanup pre-step, §7.6) · `playwright.config.ts` (the `mutations` project only, §7.6). After engine and server-api report done, their files pass to the Integrator **for integration fixes only**; each such edit is listed in its report. |
| coordinator | `PLAN.md` · `docs/HANDOFF.md` · `docs/DECISIONS.md` · `docs/STAGE_PROCESS.md` · `docs/stages/**` (implementers may append only to "Scaffold notes") · `CLAUDE.md` · `docs/style/**` · `docs/private/**` · `reference/**` |

### 7.2 Scaffolder (alone; done-check before hand-over)
1. **Dependencies** (§1.3):
   - Edit `packages/engine/package.json` (`"dependencies": { "@joinr/schema": "workspace:*" }`, `"devDependencies": { "@joinr/importer": "workspace:*" }`) and `apps/server/package.json` (`"@joinr/engine": "workspace:*"`).
   - Run `pnpm install`: no errors and no new build prompts.
   - `packages/engine/vitest.config.ts` gains `testTimeout: 60_000`. Golden describes set their own 120 s.
2. **`packages/schema`**, per §2.3 and §3.2–3.4:
   - enums, `trading.ts`, the instruments columns, rows and parity, records, `dto/investments.ts`, the errors, the index exports.
   - Fixtures (`fixtures/investments.ts` + index) and the seed update.
   - `pricing.ts` `splitSymbol` (moved; the importer re-exports it) and `testing` `COMMITTED_MIGRATION_COUNT`.
   - **Tests:**
     - `trading.ts`: the fee authority with a rate and flat; `unitsFromAmount` rounding down per kind and the "0" case; every `effectiveDefaultFee` branch.
     - `ratioFromPercentText` / `percentTextFromRatio`: 0.07 ↔ 0.0007, 0.35 ↔ 0.0035, 12.5 ↔ 0.125, 100 ↔ 1, 0 ↔ 0; a stored 6-dp ratio round-trips to the same string; blank, a sign, an exponent and 5 percent dp → null.
     - The request schemas:
       - Units and amount modes; `≤ 18` dp accepted, 19 rejected; 16 significant digits rejected; `decimalFromNumber(0.000012345678901234)` (a 12-significant-digit value with more than 12 dp) accepted.
       - Date bounds (tomorrow accepted, the day after rejected; injected `now`).
       - Kind rules via `instrumentKindIssues` on both `instrumentCreateSchema` and `makeInstrumentUpdateSchema(kind)` (a rate default fee only for crypto: rejected on an ETF update; regions only for ETF and MF; the Σ regions limit; symbol patterns and upper-casing).
       - `''` → null for note, name, sector and location.
       - `normaliseInstrumentEditable(instrumentEditableFromDto(dto))` equals `normaliseInstrumentEditable` of the parsed body for every `instrumentDtos` fixture (the no-op round trip).
     - Fixture coverage: every `HoldingStatus`, `HoldingFlag`, `CountdownDto` state and `ConsiderReason` appears. Every fixture parses where a schema exists.
     - The seed fills the new columns.
3. **Migration** `0002_stage2_investments` (§3.1):
   - `git diff --exit-code` on the `0000_*` and `0001_*` files.
   - Tests: a fresh DB reaches `COMMITTED_MIGRATION_COUNT` (3); a DB migrated to 0001 **with data** (use `seedGenericData` on a DB stopped at 0001) upgrades cleanly and keeps its rows; the new columns are null.
   - Switch every existing count assertion to `COMMITTED_MIGRATION_COUNT`: `apps/server/test/migrations.test.ts`, `app.test.ts` (health), `db.test.ts`, `backup.test.ts` and `packages/schema/test/db.test.ts` (a grep for `applied: 2`, `n: 2`, `toBe(2)` on `__drizzle_migrations` finds them all).
4. **Engine skeleton:**
   - `src/types.ts`, complete per §2.2 (incl. `DividendResult` and `EngineApi`).
   - `src/index.ts`: re-exports the types, `MATCHING_STRATEGIES`, `ENGINE_IMPLEMENTED = false`, every §2.2 function as a stub that throws, and the `engine` value (a type-level test: `engine satisfies EngineApi`). `assetClassOfKind` and `sheetDate` may be real.
   - Delete the Stage 0 `packageName` test, or keep it passing.
   - **ESLint:** for `packages/engine/src/**/*.ts`, `no-restricted-syntax`:
     - `NewExpression[callee.name='Date'][arguments.length=0]`
     - `CallExpression[callee.object.name='Date'][callee.property.name='now']`
     - an `ImportDeclaration` whose source starts with `node:` or is `drizzle-orm`, `@joinr/schema/db` or `@joinr/schema/testing`

     Each has a message pointing to §2.1.
5. **Server scaffolding:**
   - `routes/investments.ts`: every §4.2 route answers 501 `NOT_IMPLEMENTED` in the error shape (re-add a local helper; Stage 1 removed `sendNotImplemented`).
   - Export `InvestmentsRouteOptions`.
   - `app.ts`: `BuildAppOptions` gains `engine?: EngineApi`; register the routes with `{ prefix: '/api', database: db, config, market, now, engine }`.
   - `records/index.ts`: the two new columns.
6. **Web scaffolding:**
   - `router.tsx`: the four typed page routes plus the four `$instrumentId` routes (§6.1).
   - The two page components render `PageHeader` with the right h1 and a `Callout note` "Arrives with the Stage 2 web work", so `e2e/smoke.spec.ts` still passes.
7. **Done-check** (all green):
   - `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` (≥ the 1271 Stage 1 tests + new; the importer's `splitSymbol` tests still pass), `pnpm build`, `pnpm guard:all`.
   - `PORT=3070 WEB_PORT=5170 DATA_DIR=artifacts/scaffolder/data pnpm e2e e2e/smoke.spec.ts` passes. Delete the folder first.
   - `/api/health` shows `migrations: 3`.
   - `DATA_DIR=artifacts/scaffolder/data pnpm seed:dev --yes` exits 0.
   - Ports 5170 and 3070 are free afterwards.
   - Append "Scaffold notes" (below) with every deviation.

### 7.3 engine
1. `trades → lots` (§2.4) with the seam, then realised and terms (§2.5). Unit tests:
   - A multi-parcel exit with a fee on every trade (hand-worked).
   - A partial sell leaving a partly-sold lot with a fee (pro-rata unrealised).
   - A same-day buy and sell entered sell-first.
   - An oversell (flag, no gain for the excess).
   - The anniversary boundary: the day before, on the anniversary, the day after, and a 29 Feb acquisition.
   - A zero-unit row.
   - Rate fees: authority, not rounded cents.
   - Two kinds with the same code.
2. XIRR (§2.7) with its tests.
3. Holding metrics and summary (§2.6, §2.8), including every per-kind difference, unpriced and stale handling, watching and exited status, the 1Y rate window edges (a trade exactly 365 days back is out; `asOf = first` → null), and the D43 portfolio XIRR.
4. Allocation (§2.8): sector, region with unassigned, by holding, target sum and count.
5. Dividends and staking (§2.9): a yield with `count = 1` → null, the cadence rule, missing ex-date or price, units at ex-date using `<`, and `InvestmentsResult.dividends` (one row per input dividend, unlinked → nulls).
6. `realisedByFinancialYear` (§2.5): the 30 June / 1 July boundary, the current FY always present, newest first.
7. History (§2.11): contributions with DRP (`≤`), exited instruments included, windows (the first window, the live window, no snapshots), and compression (monthly/quarterly/yearly, `count` defaults, `end` vs `sum`, the live flag).
8. Timing (§2.12): `budgetInvestment` for each frequency, the rounding points (ROUNDUP 2 dp away from zero, ROUNDDOWN toward zero, the ×5 and ×1000 steps), the emergency override, null months (emergency fund null, no cash-first override), both cash shares null (share 0), `useBudget` false, `autoInvestSplit` false, side income with several filled periods after the last purchase, and every missing input; the `parcelOptimiser` branches; `investCountdown` (a Thursday roll from each weekday, `growth = 0` +365, the `invest` boundary, `sheetDate` overflow); `considerNext` (emergency fund, ties, no targets); `nextBuyHint` (other class; unpriced skipped; ties).
9. **Goldens** (§9): `test/golden/{adapter.ts,sheetFormulas.ts,*.golden.test.ts}` with `describeWithLocalWorkbook`. Each golden test prints **counts only** (compared/skipped per tab and reason), never values.
10. Set `ENGINE_IMPLEMENTED = true` **only after** your full unit suite passes (it gates the server integration and golden tests). A `test/purity.test.ts` scans `src/**` for `Date.now(`, `new Date()`, `node:`, `fetch(`, `process.` and `console.`.

### 7.4 server-api
1. `db/queries/settings.ts` (`readSettings`) + tests (valid, invalid JSON, wrong type → null).
2. **Loader** (`investments/load.ts`):
   - DB rows → engine inputs (fee authority fields straight through; review flags kept for the DTOs).
   - The budget inputs of §2.12 (items of kind `item`; side income summed per period; cash non-offset; the latest snapshot cash share; other assets AUD rows; the last stock/ETF buy).
3. **Page, ledger and detail builders** (`investments/page.ts`, `trades.ts`, `detail.ts`) and the chart assembly (§5). Unit tests inject a **fake engine** (a hand-built `InvestmentsResult`) and check the DTO mapping field by field.
4. **Mutations** (`investments/mutations.ts`) per §4.5, with the §3.3 origin rules (the normalised instrument comparison), the marker keyed on `sheet_ref`, the oversell check, the `importLock` 409 and `notifyInstrumentsChanged` (a spy).
5. **`routes/investments.ts`:** every §4.2 route. Route tests use `buildApp({ …, engine })` + `app.inject` + `seedGenericData`. Tests that do not depend on real FIFO inject a **minimal fake engine** and run now:
   - 404 for an unknown kind or id, 400 shapes (field paths, incl. a rate default fee on an ETF PUT), 409 for a duplicate instrument and for deleting an instrument in use, 409 `IMPORT_IN_PROGRESS` while `importLock` is held.
   - Instrument origin: a PUT of `instrumentEditableFromDto(dto)` with only the default fee changed keeps `origin` and leaves `hasAppData` false; a PUT that changes the target sets `origin = 'app'`.
   - Re-import keeps the default fee: synthetic import → PUT a default fee → re-import (allowed: default-fee-only) → the fee is kept.
   - The upload route answers 409 when the marker exists, and re-checks `hasAppData` after the corrections load (a mutation committed in that gap → 409). The CLI `--yes --replace-app-data` clears the marker.
   - The refresh identity check (§4.5).
   
   Tests whose assertions need the real FIFO go under `describe.skipIf(!ENGINE_IMPLEMENTED)` with the real engine:
   - 201/200 bodies (the recomputed `TradeRowDto`), 422 on an oversell and on deleting a needed buy.
   - D34: `hasAppData` after create, update of an import row, delete of an import row (marker), **edit of an import row then its delete (marker)**, and delete of an app-created row (no marker).
6. **Integration tests** gated by `describe.skipIf(!ENGINE_IMPLEMENTED)`:
   - Real engine plus `seedGenericData`: the pages build for all four kinds.
   - A trade create/update/delete round trip leaves `dumpDomainTables` identical except `app_meta`.
   - The synthetic workbook (`buildSyntheticWorkbook()`, corrections off) imported, then the four pages build without error, and `unpricedCount` matches the prices present.
7. **Server golden** (§9.4) in `test/golden/investments.golden.test.ts`, gated by `ENGINE_IMPLEMENTED && IMPORTER_IMPLEMENTED` and `describeWithLocalWorkbook`, with `{ timeout: 120_000 }`.
8. **Docs:** README (the investments API, trade entry including D38, what blocks a re-import, D34) and `docs/ARCHITECTURE.md` (the engine package, the page build flow, origin rules). Generic only.
9. **Done means the gated suites ran.** server-api reports done only after every `ENGINE_IMPLEMENTED`-gated suite of steps 5–7 has run green against the real engine. If the engine is not done yet, report "blocked on engine" with everything else green; the coordinator resumes server-api once the engine reports.

### 7.5 web (phase A — parallel; no running API needed)
1. The API layer (§6.2), `kinds.ts`, and the display helpers (`display.ts`: fee text, countdown text, hint text, asset-class labels, flag badges, FY label). Unit tests for each helper.
2. `InvestmentPage` and every part of §6.3–6.4, `HoldingDetailPage` (§6.5), and the forms (§6.6).
3. **Unit tests** with mocked fetch (`test/mockApi.ts`) on **`@joinr/schema/fixtures`** (plus any supplementary fixtures in `apps/web/test/fixtures/**`):
   - Loading, error and empty states for each kind; the all-unpriced page and the null tiles (`investmentPageAllUnpriced`, `investmentPageNulls`).
   - The holdings table: the total row **equals the Σ of the visible rows** (Dividends, Realised) on the populated and unpriced fixtures, the exited table's own total, a watched fully-sold row showing its realised and dividends, flags and badges, units dp per kind (fund 6, crypto 8), the XIRR 90-day rule, the "More columns" switch, and the phone column order via `matchMedia`.
   - Each countdown state and consider reason, with the §6.3 item 5 copy (incl. "1 day" singular), the full card on ETFs only, and the `useBudget` false amount text.
   - The allocation switches (per kind), the empty-current-ring table default, the chart table views with the "(live)" label, the FY table (empty and populated).
   - The trade form:
     - Units/amount preview and the default-fee pre-fill; the default entry mode ($0 fee → Amount).
     - **Re-fill on a holding change** (a $0-default ETF after another holding: fee $0), and no re-fill of a field the owner edited.
     - Save disabled while pristine and while pending (a double click sends one request).
     - Focus on open and its return on close.
     - The crypto % fee through `ratioFromPercentText`.
     - The sell hint "Held now: N units".
     - The workbook callout on an `origin = 'import'` row.
     - Field errors from `tradeValidation`, `TRADE_OVERSELL` and `IMPORT_IN_PROGRESS`.
     - The request body shape for each mode.
   - The delete confirm in the Actions cell (focus on Cancel, Escape cancels).
   - The holding form per kind: hidden fields; percent ↔ ratio via the helpers; 409 under the symbol; **DTO → form → body with only the default fee changed equals `instrumentEditableFromDto(dto)` except `defaultFee`**; empty text → null; stock/crypto regions null; the workbook callout except for a default-fee-only change.
   - The detail page tables, and the Stage 1 invalidation hooks now covering `['investments']` and `['instruments']`.

   Missing fixture states: add them under `apps/web/test/fixtures/**` (typed with `satisfies` against the frozen DTOs). A DTO or schema defect → report it to the coordinator (server-api applies approved schema fixes, §7.1); do not invent DTO shapes.
4. `RootLayout.test.tsx` and `router.test.tsx` updates if the route tree needs them.
5. **Write, but do not yet rely on,** the e2e drafts of §7.6 (`investments.spec.ts`, `investments-states.spec.ts`, `trades.spec.ts`, `investments-support.ts`). Report "phase A done" with typecheck, lint and unit results.

### 7.6 Integrator (phase B — starts when engine and server-api report done)
1. **Run the whole stack** on 5185/3185:
   - Fresh `artifacts/integrator/data`, `MARKET_DATA_MODE=fake`.
   - Import the synthetic workbook.
   - Fix integration defects in web files. After engine and server-api report done, their files may be touched for integration fixes only, each listed in the report.
2. **`e2e/investments-support.ts`:**
   - `E2E_NOTE = 'e2e-temp'`.
   - `cleanupE2eRows(request)` lists each kind's trades (`/api/investments/:kind/trades`) and deletes those whose `note` starts with `E2E_NOTE`, then deletes instruments whose `HoldingRowDto.note` starts with it and that have no trades.
   - `waitForPrices(request)` polls `/api/prices` until no refresh is `running`.
   - `mockInvestmentPage(page, fixture)`: `page.route('**/api/investments/**', …)` fulfils a `@joinr/schema` fixture (imported by relative path, as `brand.spec.ts` imports web sources), so fixture-only states can be rendered in a real browser. No data is touched.
3. **`e2e/import.setup.ts`:** call `cleanupE2eRows` **before** the synthetic import, so a crashed earlier run cannot leave `app` rows that make the import answer 409 (D34). The Verifier also starts each e2e run from an empty `DATA_DIR`.
4. **`e2e/investments.spec.ts`** (both projects, read-only):
   - For each of the four pages: the h1; the KPI tile "Portfolio value"; the holdings table lists the synthetic symbols; charts render an `svg` (or the empty message); the FY table is visible; the Trades table has rows; no page horizontal scroll; no console errors; screenshots.
   - One holding detail per kind (the parcels table is visible) with screenshots.
   - The ETFs page shows a realised loss or gain row for the exited `ASX:OLD` in its FY.
   - At 1440 px, record (do not assert) whether the ETF holdings table overflows its container, with "More columns" off and on; the style reviewer judges it.
5. **`e2e/investments-states.spec.ts`** (both projects, read-only, `mockInvestmentPage`): screenshots at 1440 and 375 of each `investmentPageTiming` state (wait, invest, cash_first, unavailable with the missing callout, below_emergency_fund, no_targets), `investmentPageUnpriced`, `investmentPageAllUnpriced`, `investmentPageNulls` and `investmentPageEmpty`, plus the trade form open on a fixture with an oversold row. Asserts only the h1 and no console errors.
6. **`e2e/trades.spec.ts`** runs in a new Playwright project **`mutations`** (desktop viewport, `testMatch: /trades\.spec\.ts/`, `dependencies: ['desktop', 'phone']`); `desktop` and `phone` add it to `testIgnore`. The app rows it creates would make the Stage 1 `import.spec.ts` upload answer 409 (D34) if both ran at once, so it runs **after** every other spec. Every row created carries the note `E2E_NOTE`:
   1. On `/etfs/<ASX:DEF id>`: Edit holding → set the default fee to $0 → Save → `GET /api/import/runs` → `hasAppData === false` (a default-fee-only change is not app data).
   2. On `/etfs`: Add trade → `ASX:DEF` → the fee shows $0.00 pre-filled and the entry mode is Amount → Buy, **Amount** $500, price 50 → the preview shows 10 units → Save → the holding's units rise by 10 and the value tile changes.
   3. Edit it to Units 5 → the units update.
   4. A sell of more units than held → the oversell message.
   5. Delete the trade → the units return to the start value.
   6. Add holding `ASX:ZZZ` (generic) → it appears as watching → delete it.
   7. `afterAll` → `cleanupE2eRows`.
   8. After the spec, `GET /api/import/runs` → `hasAppData === false`.
   
   **Fast loop:** Playwright runs dependency projects unfiltered, so selecting `trades.spec.ts` alone still runs every desktop and phone spec first. While iterating, run `pnpm e2e --project=setup` once, then `pnpm e2e --project=mutations --no-deps`. The full run keeps the dependencies.
7. Screenshots go under `artifacts/screenshots/{desktop,phone}/investments-*.png`. Run the full e2e suite on your ports (the `mutations` project must **run and pass**; skipped counts as failed), then write the final report (§13).

### 7.7 Reviewers (report findings; do not edit)
- **spec-correctness:**
  - The engine vs spec 03 §1–8, spec 01 §3.1/§5.4, spec 02 §2–4 and this plan; D36–D43 applied; every §11 fix present.
  - Run the goldens (`pnpm vitest run --project engine test/golden`, `--project server test/golden`) and check that **every** §9.2 cell is compared or skipped only for a §9.3 reason. Nothing is silently skipped.
  - Check the owner-import expectations of `docs/private/stage-2-private.md` §2–§5 via the API on `artifacts/review-spec/data` (`MARKET_DATA_MODE=off`).
  - No owner values in tracked files.
- **style-ux:**
  - Screenshots at 1440 and 375 of each page, a detail page, the trade form (units, amount and crypto %), the holding form, the next-buy card in each state and the fixture-only states (from `e2e/investments-states.spec.ts`, which renders the fixtures in a real browser) and the charts. Judge the recorded ETF table overflow (§7.6 step 4).
  - Compare them against STYLE_GUIDE §1–§10 and D6, D7, D17–D20, D31, D33: one accent (the one key figure), uppercase letter-spaced labels, mono right-aligned numbers, status words + icons, §8 formats (FY labels, U+2212), no page scroll at 375, status-first tables, red only for losses, and the chart palette slots.
- **code-quality/security:**
  - Validation at every write boundary (strict schemas, bounds, the kind rules) and error leakage (no SQL, paths or stacks).
  - Transactions (`IMMEDIATE`, rollback on 422) and the D34 marker semantics.
  - Decimal use (no float money; the XIRR float is contained), engine purity (lint + purity test), injection of `now`, and no clock in routes.
  - Test isolation (temp DBs, no network, no reads of `reference/import-corrections.json` outside goldens, no snapshot files), and gating flags that are never faked.
  - A **scratch numeric scan** (a script under `artifacts/review-code/`, output "found/not found" per file only) of the tracked diff against every number with ≥ 4 significant digits in `docs/private/stage-2-private.md`, in dollar, comma and cents forms (template constants such as the pay-frequency factors excluded). Leave the script in place: the Verifier re-runs it on the final diff (§10 #14).

### 7.8 Fixer and Verifier
- **Fixer:** applies the verified findings across owners (the only agent allowed to touch several areas). Keeps the contracts unless the coordinator approves a change (recorded in "Scaffold notes"). Re-runs the affected checks and reports each finding's outcome.
- **Verifier:** runs §10 on ports 5195/3195 with the per-item `DATA_DIR`s of §10 (never `data/`). It reports pass or fail with evidence (commands, exit codes, counts, screenshot paths). It never commits and never prints owner values into any tracked file.

---

## 8. Ports & environment
**No new environment variables.** Playwright keeps its Stage 1 defaults (`MARKET_DATA_MODE=fake`, `PRICE_REFRESH_MINUTES=0`, `IMPORT_CORRECTIONS_FILE=none`).

| Agent | WEB_PORT | PORT | DATA_DIR |
|---|---|---|---|
| default / owner / `.claude/launch.json` | 5173 | 3001 | `data` (never used by agents) |
| Scaffolder | 5170 | 3070 | `artifacts/scaffolder/data` |
| engine | — (no server; tests only) | — | — |
| server-api | 5183 | 3183 | `artifacts/server-api/data` |
| web (phase A) | 5184 | 3184 | `artifacts/web/data` |
| Integrator | 5185 | 3185 | `artifacts/integrator/data` |
| Reviewer spec-correctness | 5191 | 3191 | `artifacts/review-spec/data` |
| Reviewer style-ux | 5192 | 3192 | `artifacts/review-style/data` |
| Reviewer code-quality | 5193 | 3193 | `artifacts/review-code/data` |
| Fixer | 5194 | 3194 | `artifacts/fixer/data` |
| Verifier | 5195 | 3195 | `artifacts/verifier/{e2e,owner,live,prod}` (one per §10 group) |

- Git Bash: `PORT=3185 WEB_PORT=5185 DATA_DIR=artifacts/integrator/data MARKET_DATA_MODE=fake pnpm dev`.
- PowerShell: `$env:PORT='3185'; $env:WEB_PORT='5185'; $env:DATA_DIR='artifacts/integrator/data'; $env:MARKET_DATA_MODE='fake'; pnpm dev`.
- Owner import into a scratch dir: `DATA_DIR=artifacts/<role>/data pnpm import:workbook --yes` (corrections `auto`).
- Unit tests use OS temp dirs or `:memory:`; never `data/`.
- Stop your servers when done and confirm the ports are free (commands in stage-0.md §11).

---

## 9. Golden values & tests (read at runtime; nothing committed)

### 9.1 The sheet-faithful adapter (`packages/engine/test/golden/adapter.ts`)
It reads the local workbook with `readWorkbook(readLocalWorkbookBytes())` inside `describeWithLocalWorkbook`, and builds engine inputs **the way the sheet computed them** (the fixes are not applied, so cached cells can be compared).
- **As-of:** `Net Worth!E52`.
- **Watch rows:** Stocks `A2:A12`, ETFs `A2:A11`, MF `A2:A11`, Crypto `A2:A7`, up to the importer's terminator rule. MF rows with zero units and no ledger rows are skipped (the feed rows, D22/D23).
- **Prices:** Stocks, ETFs and MF column `D`; Crypto `B`. Numeric > 0 → the price (status `fresh`); anything else → no price.
- **Watch fields:**
  - Targets: Stocks `P`, ETFs `O`, MF `N`, Crypto `M`.
  - Sectors: Stocks `R`, ETFs `W`, MF `V`.
  - Regions: ETFs `S:V`, MF `R:U`.
  - Mgmt fee: ETFs `Q`, MF `P`.
  - Dividend frequency: Stocks `S`, ETFs `X`, MF `X`, Crypto `O`. Placeholders → null.
- **Ledgers:**
  - Stocks and ETFs `A23:E500`; MF `A23:D500` (fee 0); Crypto `A17:E500`.
  - `seq` = the order of non-blank rows; the ledger-only symbols become unwatched instruments.
  - Crypto: `feeRate = E / |C × D|`, rounded to 12 significant digits (the ledger's cached fee, not the crypto fee setting).
- **Dividends:** `Dividends!A4:F500`. A dividend links to a holding only when column B **equals the holding's symbol exactly** and column C equals the tab's type string (`Stocks`, `ETF`, `Managed Fund`, `Crypto`). This is the sheet's semantics before D28.
- **Snapshot dates:** the dates of each tab's history block (Stocks and ETFs `O49:O…`, MF `N23:N…`), which mirror `History!A3:A…` including the live row's month-end.
- **No corrections file:** the goldens compare with the sheet as it computed.
- **Timing inputs** (the Budget chain and consider-next goldens; `BudgetInvestInput` and `considerNext`):

  | Input | Source |
  |---|---|
  | asOf | `Net Worth!E52` |
  | pay frequency, net pay | `Budget!B3` (mapped as the importer maps the frequency text), `Budget!B4` |
  | include side income | `Budget!D4` (Yes → true) |
  | auto-invest split | `Budget!F4` (the echo of ID 33) |
  | use budget, aggressiveness, emergency months, pay day | SheetOptions IDs **3, 13, 30, 2** (they exist only in column L): the row is found by the ID in column P, as the importer does, and the value read from column L of that row |
  | emergency override | `Budget!D3` only when it holds no formula (else null) |
  | budget items | `Budget` rows 8 → the row before `Cash Savings -`, column C (blank → null), **kind `item` only**: the importer's kind rule drops the `Yearly Expenses - Automatic`, `Investment Savings -` and `Cash Savings -` rows |
  | yearly expenses | `Budget!F32:F60`, rows with a name and a numeric F |
  | side-income periods | `Side Income` rows 2 → 799 with a date in F: `periodStart` E, `periodEnd` F, amount I. Rows whose G and H are **both blank** are dropped, as the importer drops them (the sheet's unfilled current period; §11 fix 20) |
  | cash target, class targets | `Net Worth!D41`; `Net Worth!D38:D43` (echoes of the allocation settings) |
  | tax | `SheetOptions!H31` (the echo of the tax setting) |
  | last-snapshot cash share | recomputed `SheetOptions!H43`: `History!N` / `Net Worth!L` at the row whose date equals `Net Worth!C51` |
  | current cash share | `Net Worth!C41` (used only when there is no snapshot row) |
  | cash, other assets | `Cash!C13`; `Other Assets!D3` |
  | class values (consider next) | the engine summaries of the four tabs (priced values), cash and other assets as above |
  | last purchase | the engine's max buy date over the Stocks and ETF ledgers (compared with `SheetOptions!H20`) |

  **Column L rule:** the adapter reads SheetOptions column L only for the four non-secret IDs above, never for the secret IDs 1 and 29, and never prints a column-L value (golden output is counts only, §7.3 step 9).

`sheetFormulas.ts` (golden-only helpers):
- the sheet's simple est. return: `pct / (asOf − floor(Σ(date × price × remaining) / Σ(price × remaining))) days × 365`. Both this helper and the §9.3 recomputed expectation use the **lots of priced holdings only** (ledger rows whose holding has a numeric live-price cell), so the two sides always weigh the same lots; on a tab with no unpriced holding this equals the sheet's all-lot formula;
- `parseMonthlyRate("$N/month") → cents`;
- `recomputedPricedTotals(...)` (§9.3 rules 1 and 5).

### 9.2 Cells compared (template references; each read at runtime)
| Area | Cells | Engine output |
|---|---|---|
| **Stocks, per watch row** | `G` · `H` · `I` · `J` · `K` · `L` · `N` · `O` · `Q` | netUnits · valueCents · totalReturnCents · totalReturnRatio · xirr · dividendsCents · averagePrice · currentRatio · differenceRatio |
| **Stocks summary** | `E16` · `E17` · `E18` · `H17` · `H18` · `E19` · `H19` (class or holding only) | summary value, total return $ and % · simple est. return (helper) · investmentRatePerMonthCents · dividendsAllTimeCents · nextBuyHint |
| **ETFs, per watch row** | `F` · `G` · `H` · `I` · `J` · `K` · `M` · `N` · `P` | as for Stocks (`N` and `P` via §9.3) |
| **ETFs summary** | `F15` (§9.3) · `F16` · `F17` · `I16` · `I19` · `F18` · `F19` · `L16` · `L17` (§9.3) · `I17` (class or holding only) · `S12:V12` (§9.3) · `S13:V13` | summary · simple est. return · 1Y rate · dividends this FY / all time · heldCount · targetCount · allocation.byRegion current and target |
| **MF, per watch row** | `E` · `F` · `G` · `H` · `I` · `J` · `L` · `M` · `O` · `W` | the holding fields · estMgmtFeeCents |
| **MF summary** | `B16` · `H16` · `H17` · `J16` · `J17` · `H18` · `J18` · `R12:U12` · `R13:U13` | summary · byRegion |
| **Crypto** | per row `D`, `I` (staking $), `K`; summary `H11` | netUnits · dividendsCents · averagePrice · 1Y rate (price-dependent cells: §9.3) |
| **Ledgers, per row** (Stocks and ETFs F/G/J/K/L; MF E/F/I/J/K; Crypto E/F/G/L) | sold units · order value · unrealised · unrealised % · remaining; Crypto E = fee | LotResult / TradeResult (sold = units − remaining) |
| **Capital Gains** | `O` of every buy row; `P`, `Q`, `S` of every sell row. Rows are mapped to the tab ledgers in block order **ETF → Stocks → Crypto → MF** (the `AA3:AA11` counts, asserting column A matches at each step). `U11:U…` FY starts and `V11:V…` FY totals. | lot remainingUnits · sell realisedShort/Long/total · realisedByFinancialYear (Σ over kinds, per FY). The FY rows are compared over the **union** of FY starts on both sides; an FY missing on either side counts as 0 (the sheet lists every FY from the year before the first trade to one after the last; the engine lists FYs with disposals plus asOf's FY). |
| **History blocks** | Stocks and ETFs `O49:P…`, MF `N23:O…` (contributions per snapshot date, live row included) | `contributionsAt`, watched symbols only (§9.3) |
| **History movements** | `History!E`, `I`, `M`, `AI`, per frozen row, **all instruments**. Frozen rows are values captured on the run date, whatever the watch table held then; the Planner verified that all four columns equal the all-instrument windows over the uncorrected ledger (the goldens run without corrections). | `netPurchases(purchaseWindows(...))` |
| **Budget chain** | `Budget!B2` (§9.3 rule 6 when side income is included), `C24`, `J4`, `L7`, `D3`, `C28`, `C29`; `SheetOptions!H41`, `H42`, `H43` (recomputed from the History row whose date equals `Net Worth!C51`) and `H20` | budgetInvestment fields; the last-purchase date |
| **Consider next** | `Net Worth!C38:C43`, `E45`; `SheetOptions!H9` (class and holding, §9.3 rule 11) | considerNext rows; **`E45` ↔ `considerNext.assetClass`**; nextBuyHint |

### 9.3 Cells the sheet itself broke: rules, detected at runtime (no row numbers hard-coded)
1. **Holdings whose cached price is not a positive number** (an error value or sentinel):
   - Skip their value, total return $ and %, XIRR, current and difference cells (reason `unpriced`).
   - Tab totals the sheet computed **with** such rows are compared with expectations **recomputed from the sheet's own cells over priced rows**:
     - tab value = Σ numeric value cells;
     - tab total return = the sheet's cell (unpriced rows contributed 0 there, as they do in the engine);
     - total return % = tab total return / Σ over ledger rows with a numeric live-price cell of `D × L` (+ `E` where L > 0);
     - simple est. return: the same restriction, with the pct above and the cost-weighted date over the **priced holdings' lots only** (the `sheetFormulas.ts` helper uses the same lots; §9.1);
     - current % = `valueᵢ / Σ numeric values`, and difference = that − target;
     - regional current = Σ recomputed current × region;
     - target count = count(target > 0) + count(recomputed current > 0 and target = 0);
     - `Net Worth!C38:C43` = recomputed class values (cash `Cash!C13`, other `Other Assets!D3`);
     - `E45` and `H9` from those (rule 11 for `H9`).
2. **A tab with no priced row at all** (a tab whose cached prices are all missing): every price-dependent cell of that tab is skipped, reason `no_prices`. On Crypto those are `E`, `F`, `G`, `H`, `L`, `N` and `E9`, `E10`, `E11`, `H10`, `H12`; on the other tabs, the per-row value, total return $ and %, XIRR, current and difference cells and the tab's value, total return, simple est. return and hint cells. Units, the dividends/staking totals (Crypto `I` is a SUMIFS over Dividends, no price), the average price, the ledger fee, order value and remaining, and the 1Y rate are still compared. Crypto `J` follows rule 13.
3. **Dividends the sheet did not link** (a ticker without the exchange prefix): the adapter reproduces the non-link, so the cells compare exactly. A second assertion re-links the D28 way (`code` match within the holding kind) and checks that the holding's total return and dividends rise by exactly the linked amounts, and that its XIRR changes.
4. **Exited (ledger-only) instruments:**
   - The **live-computed** contributions blocks (Stocks and ETFs `P49:P…`, MF `O23:O…`) filter by the **current** watch table, so the golden feeds only watched symbols to reproduce those cells.
   - A second assertion with **all** instruments checks that the difference equals the exited instruments' net order value to each date (§11 fix 2).
   - The frozen `History` movement cells need no filter: they are compared with all instruments (§9.2).
5. **A partly-sold lot with a non-zero fee** (§11 fix 9): the sheet deducts the lot's full fee, the engine only the unsold share. With `δ = fee × sold / units` per such lot (sold = `C − L`, from the sheet's own ledger cells), every dependent cell is compared with an **adjusted** expectation, counted as `partial_lot_fee` (compared, not skipped):
   - ledger unrealised `J + δ`, and ledger % `(J + δ) / G`;
   - the holding's total return $ (Stocks I, ETFs H, MF G, Crypto F) + Σδ of its lots, and the tab's total return $ (Stocks E17, ETFs F16, MF H16, Crypto E10) + Σδ over the priced holdings;
   - the holding's and the tab's total return % (Stocks J/E18, ETFs I/F17, MF H/H17, Crypto G/E11) and the simple est. return, recomputed by `recomputedPricedTotals` as the adjusted total return / (Σ `D × L` + Σ `E × L / C`) over the relevant priced lots.
   
   The rule is coded whether or not such a lot exists (MF ledgers have no fee column, so δ is 0 there).
6. **Side-income means** (the D40 bug and §11 fix 20). The adapter drops the unfilled Side Income rows (§9.1), so:
   - `SheetOptions!H2` reads the cash row: the expectation is `C28 + H41 × (1 − tax) × mean(I of the kept rows with F > H20)` (0 when none).
   - `Budget!B2` is compared as cached when `Budget!D4` is not "Yes". When it is "Yes", the expectation is `B2 − Side Income!C6 + mean(I of the kept rows with E > asOf − 365)`.
7. **Never compared:** static script outputs (`SheetOptions!H13`, `H19`, `H10`, `H11`), the Target Date text (`ETFs!I18`), the dollar amount inside the next-investment texts (the stale static parcel), the Capital Gains placeholder columns `H:L` (the dangling reference), and the sparkline and P/E columns.
8. **An out-of-order ledger row** (e.g. a D26 suspect sell): FIFO by date equals the sheet's row-order FIFO for it when it still consumes the same parcel. It is compared normally.
9. **Five-FY dividend sums** (`ETFs!F19` = `Dividends!L11`, `Managed Funds!J18` = `Dividends!N11`): compared with `dividendsAllTimeCents` only when no dividend of that type predates the five-FY window of `Dividends!K4:K8`; otherwise skipped (`five_fy_window`). `Stocks!E19` is all time and always compared.
10. **Capital Gains FY rows:** compared over the union of FY starts (`U11:U…` and the engine's rows), a missing FY counting as 0 on either side (§9.2).
11. **`SheetOptions!H9`** takes the minimum delta over `Net Worth!E38:E42` only (other assets excluded) and has **no** emergency-fund rule, unlike `E45`. Its expected class is the minimum recomputed delta over the five non-`other_assets` classes, ignoring the emergency fund; its holding part is `nextBuyHint` for that class's kind. Only `E45` maps to `considerNext.assetClass`.
12. **Watch rows with net units ≤ 0** (a watched instrument never bought or fully sold): the sheet shows 0 or "-" for total return $ and %, dividend return and average price (Stocks I may show the sold lots' −fees; Crypto F shows the staking total). Those cells are not compared with the sheet; the golden asserts the engine's `totalReturnCents`, `totalReturnRatio` and `averagePrice` are **null**, and skips the XIRR and dividend-return cells. All are counted as `not_held`. Units, value (0 ↔ 0 or null), current (0) and difference (−target) are compared normally.
13. **Crypto `J`** (staking yield) is a VLOOKUP into the current-FY dividends table (`Dividends!K45:O88`), so it exists only for coins paid this FY; the app's §2.9 rule uses a rolling window. It is skipped with reason `fy_table_lookup`.
14. Every skip and every adjusted comparison is counted per reason; the test output prints `compared: n · skipped: {unpriced: n, no_prices: n, not_held: n, fy_table_lookup: n, five_fy_window: n} · adjusted: {partial_lot_fee: n, recomputed: n}` per tab. The spec reviewer checks that the counts match `docs/private/stage-2-private.md` §3.

### 9.4 Server golden (`apps/server/test/golden/investments.golden.test.ts`)
- **Setup:**
  - `createTestDb` (or a temp `DATA_DIR`), then `importWorkbook` of the local workbook with **corrections off**.
  - `buildApp` with market `off` and `now` = the workbook as-of at 12:00 local. The prices are the sheet-seeded ones.
- **Assertions via `app.inject`:**
  - `GET /api/investments/stock`: summary value, total return $ and % = `E16`–`E18`; every holding's value, return and XIRR = the sheet rows.
  - `GET /api/investments/etf`: value = the recomputed §9.3 total; total return = `F16` + the D28-linked dividends; per holding, the total return = the sheet `H` + that holding's linked dividends; `unpricedCount` = the count of held watch rows without a positive cached price.
  - `GET /api/investments/managed_fund`: `B16`, `H16`, `H17` and the fund rows.
  - `GET /api/investments/crypto`: `unpricedCount` = the count of held coins without a positive cached price; units per holding.
  - Across the four kinds: the Σ of `realisedByFy.totalCents` per FY = Capital Gains `V`, over the union of FYs (missing = 0; §9.3 rule 10).
  - `timing.monthlyInvestCents` = the recomputed `SheetOptions!H2` (§9.3 rule 6: the importer skipped the unfilled Side Income row, so the recomputation drops it too).
  - One `GET /api/instruments/:id` per kind: lot remaining units = the Capital Gains `O` of its rows.
- **Stage 1 `derived_later_stage` lines:** the tab gains `Stocks!E17`, `ETFs!F16`, `Managed Funds!H16` and `Net Worth!D4:D6` are asserted here and in §9.2. `Crypto!E10` and `Net Worth!D7` are asserted too, unless their tab has no priced row (then skipped, `no_prices`). The importer's report keeps them as `info`; the importer does not depend on the engine.

### 9.5 Tolerances
The export stores **cached formula results with 10 significant digits** (typed cells and script-written values keep full precision). So every numeric comparison below allows `max(the listed tolerance, 1e-9 × |sheet value|)`; without the relative term, a high-magnitude price or a unit count with more than 10 significant digits fails on rounding alone.

| Quantity | Tolerance |
|---|---|
| Units, ledger remaining | `max(1e-8, 1e-9 × abs(v))` |
| Prices (average price, lot price) | `1e-9 × max(1, abs(v))` |
| Money, per holding, lot or disposal | ≤ 1 cent vs the sheet value × 100, rounded half away from zero (or the relative term) |
| Money, summaries | ≤ `max(1, ⌈n/2⌉)` cents, n = the number of holdings summed (the rows are rounded first) |
| Ratios (return %, allocation, regions, shares) | 1e-7 absolute (or the relative term) |
| XIRR, simple est. return | 1e-6 absolute |
| 1Y rate | exact whole dollars |
| Dates, texts, classes | exact |

---

## 10. Acceptance tests (the Verifier runs every item)
**Run order and isolation.**
- Never use `data/`. Before each server item, confirm 5195 and 3195 are free, and **delete that item's `DATA_DIR` first**. Stop every server you started before the next group.
- Order: **1, 2, 3, 4, 5 → 6 (e2e) → 7, 8, 9, 10 (owner copy) → 11 → 12 (live) → 13 (prod) → 14, 15.**

| # | Check | How |
|---|---|---|
| 1 | Install and static checks | `pnpm install` (no prompts), `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`: all exit 0 |
| 2 | Unit tests | `pnpm test` green: ≥ 1271 Stage 1 tests + the new ones. `ENGINE_IMPLEMENTED` is true, and the server integration suites and the engine-gated route tests **ran** (not skipped). |
| 3 | Migrations append-only | `git diff --exit-code` on the `0000_*`/`0001_*` SQL and snapshots; the migration tests (fresh → 3; a 0001 DB with data upgrades) pass; `/api/health` → `migrations: 3` |
| 4 | Engine goldens | `pnpm vitest run --project engine test/golden --reporter=verbose`: every §9.2 area compared; the per-tab skip counts match `docs/private/stage-2-private.md` §3 (compare privately; record only counts) |
| 5 | Server golden | `pnpm vitest run --project server test/golden --reporter=verbose` passes (ran, not skipped) |
| 6 | e2e | Ports free, `artifacts/verifier/e2e` deleted, then `PORT=3195 WEB_PORT=5195 DATA_DIR=artifacts/verifier/e2e pnpm e2e`. `setup` + every Stage 0/1 spec + `investments` + `investments-states` pass on desktop and phone (skips only where designed, plus the desktop-only mutating steps), and `trades` **ran and passed** in the `mutations` project (a skipped or not-run `mutations` project is a failure). Afterwards `GET /api/import/runs` → `hasAppData: false`. |
| 7 | Owner data, API (as-of-independent figures) | `DATA_DIR=artifacts/verifier/owner pnpm import:workbook --yes` (corrections auto), then `PORT=3195 WEB_PORT=5195 DATA_DIR=artifacts/verifier/owner MARKET_DATA_MODE=off pnpm dev`. For each kind, `GET /api/investments/:kind` summary value, total return $ and %, realised and the FY rows match `docs/private/stage-2-private.md` §5 (XIRR and timing depend on today: check only that they are present or null as §5 says). Scratch script in `artifacts/verifier/`; print pass/fail only. |
| 8 | Trade CRUD + D34 (owner copy) | Right after the #7 import, save `dumpDomainTables` as the baseline. On the #7 server: `POST /api/trades` (amount mode) → 201, units = `unitsFromAmount`; page totals change; `GET /api/import/runs` → `hasAppData: true`; `PUT` (units mode) → 200; `DELETE` → 200, and `dumpDomainTables` equals the pre-create dump. Then `PUT` an **imported** trade (same values) → `origin: app`, and `DELETE` that same edited trade → the marker is written (it came from the workbook); `DELETE` another imported trade → the marker count rises. `pnpm import:workbook --yes` exits 3; `--yes --replace-app-data` exits 0; the marker is gone; the dump equals the #7 baseline, ignoring the pricing timestamp columns (`updated_at`, `fetched_at`, `last_attempt_at`). |
| 9 | Oversell | On the #7 server (after a fresh import): a sell larger than the held units → 422 `TRADE_OVERSELL` (dump unchanged); deleting a buy that a later sell needs → 422 |
| 10 | Instruments | On the #7 server, starting from `hasAppData: false` (re-import with `--yes --replace-app-data` first if needed): in the browser, open an imported ETF's Edit holding, change only the default fee, Save → `GET /api/import/runs` → `hasAppData: false` and the instrument's `origin` is unchanged (the form round trip). Then via the API: `POST /api/instruments` (a generic symbol) → 201 with a derived price source; `PUT` default fee only → `origin` unchanged; `PUT` target → `origin: app`; `PUT` a rate default fee on an ETF → 400; `DELETE` with trades → 409; without → 200 |
| 11 | Pages at 1440 and 375 | On the #7 server (owner data, prices from the workbook): `/stocks`, `/etfs`, `/managed-funds`, `/crypto`, one detail page each, and the trade and holding forms open. Each has an h1, no console errors and **no page-level horizontal scroll**. Screenshots go under `artifacts/screenshots/{desktop,phone}/` (owner data on screen: they stay in git-ignored `artifacts/`). |
| 12 | Live prices | Stop the #7 server; `PORT=3195 WEB_PORT=5195 DATA_DIR=artifacts/verifier/live MARKET_DATA_MODE=live pnpm dev`; import the owner workbook; `POST /api/prices/refresh`. Every held instrument is priced (then counted in the totals) or flagged `unpriced`/`stale_price` on its page. No page errors. Record the counts privately. |
| 13 | Prod bundle | Stop all dev servers. `pnpm build`, then `PORT=3195 DATA_DIR=artifacts/verifier/prod IMPORT_CORRECTIONS_FILE=none pnpm start`. Deep links `/etfs` and `/etfs/1` serve HTML. Import the **synthetic** workbook; `GET /api/investments/etf` → 200 from `dist/server.js` (the engine is bundled). |
| 14 | Privacy | `pnpm guard:all` exits 0 (the guard terms include the Stage 2 owner values, §7.0). **Re-run** the code reviewer's numeric-scan script (`artifacts/review-code/`) on the final tracked diff, after the Fixer: nothing found. There are no snapshot files and no owner symbols in the tracked diff (`git diff --stat` plus a scratch grep of the private symbol list, printing found/not found). |
| 15 | Engine purity | `pnpm exec eslint packages/engine --max-warnings=0` (the clock and import rules are active) and `test/purity.test.ts` pass |

**Demo frames** for the owner. The demo runs `preview_start joinr-dev`, i.e. `pnpm dev` on the owner's real `data/` database, and the first Stage 2 start applies migration 0002 to it (there is no automatic pre-migration backup). Editing or deleting an **imported** trade or holding makes that database refuse re-imports from then on (D34), so the demo never does it unless the owner asks and accepts that.
0. **Before the first Stage 2 start**, with every server stopped: copy `data/finance.db*` (the DB and its `-wal`/`-shm` files) to a git-ignored backup, e.g. `data/backups/pre-stage2-<date>/`. (Which database the demo uses is an owner question; the default is `data/` after this backup.)
1. Each investment page with live prices (value, total return, realised, the next-buy card; the full timing card on ETFs).
2. On one auto-invest ETF: Edit holding → set the default fee to $0 → Save. The Import page still allows a re-import (`hasAppData` false): only the default fee changed. (These are real settings the owner keeps; the private doc lists the candidate holdings.)
3. Add trade on that ETF: the $0 fee is pre-filled and the form opens in Amount mode; add an amount-mode test trade, see the units and totals move, then delete it (the totals return). The Import page still allows a re-import.
4. A holding's parcels, and the FY table.
5. Phone views of the ETFs page and the trade form.

---

## 11. Template bug fixes applied in Stage 2 (owner can veto)
1. **Unpriced holdings are left out and flagged, not zeroed.** The sheet's IFERROR over SUMIF turned one bad price into a zero tab value, "-" current allocations and a −100 % gain history (spec 03 §7.1–7.2). Stage 1 fixed the price sources; Stage 2 fixes the aggregation.
2. **Contributions and net purchases include exited instruments.** The sheet's contributions history (recomputed live) and its live movement row filter by the current watch table, so an exited holding vanished from past months (spec 03 §1.8, §7.4). The frozen History movements already include it, so the app's recomputed purchases agree with them.
3. **The dividend yield period** uses `span / (count − 1)`, not `span / count`. A single payment gives no yield instead of an error (spec 03 §1.5 M, §7.8).
4. **Dividends and staking link by instrument id** (D28) in total return, dividend return, XIRR flows, units at ex-date and DRP-adjusted contributions. The sheet matched exact ticker strings, and missed the type on the Stocks dividend return.
5. **Crypto allocation:** a current allocation and difference for every coin (the template filled rows 2–4 only), and the crypto next-buy hint uses the allocation difference (it read an empty column, and total return in B76) (spec 03 §4, §7.8).
6. **FIFO by trade date then seq**, with buys before sells on the same date, instead of ledger row order. An out-of-order row can no longer consume the wrong parcel (spec 03 §5.3 "Not handled").
7. **Oversells are flagged,** and the API refuses changes that create one (the sheet's behaviour was undefined).
8. **The holding-period split follows the ATO anniversary rule** (the disposal later than the acquisition anniversary; spec 03 §5.6). The sheet's rule was unknown.
9. **Partly-sold parcels deduct only the unsold share of their buy fee** in unrealised gain and cost. The sheet deducted the full fee even after part of it had gone into a realised gain (spec 03 §1.4 J, §8 algorithm 3).
10. **The allocation target check covers every holding** (ETFs `O13` summed one row short) and reports the actual total.
11. **D40: the monthly amount to invest reads the Budget investment row** (plus after-tax side income), not the cash row.
12. **The 1Y investment rate starts at the earliest trade in the window by date,** not the first ledger row. They are the same for chronological ledgers.
13. **The estimated management fee is shown for ETFs too** (the template only showed it for managed funds). This is an addition, vetoable.
14. **DRP-reinvested dividends are subtracted up to and including the snapshot date on every tab.** Stocks and ETFs used `<`, managed funds `≤`.
15. **The emergency fund** sums every budget item plus the yearly fund. The template's range stopped one item row early; this matters only if that row is non-zero.
16. **The countdown counts calendar days.** The purchase date itself says "consider investing"; the sheet's half-day offset showed "Wait 1 more days".
17. **The portfolio "Est. return %/yr" is a portfolio XIRR** (D43), consistent with the per-holding XIRR, instead of a simple annualisation over the cost-weighted average age.
18. **XIRR never shows "-" for solvable cases:** a Newton-plus-bracketing solver returns null only when no root exists.
19. **A ticker in two tabs no longer mixes parcels:** lots are per instrument (kind + symbol), where the sheet merged by ticker string.
20. **Side-income averages leave out the unfilled current period.** The sheet counts its not-yet-filled current row as $0 in the 365-day mean that feeds Budget income (`Side Income!C6`) and in the side-income part of the amount to invest (`SheetOptions!H2`); the importer skips that row, so the app averages filled periods only (spec 02 §6 item 5).
21. **A fully sold coin shows no total return** (D41-consistent). The sheet's crypto total return still added the staking total after every unit was sold; the app shows "—" as for every other sold holding, while the staking stays in the Staking column and realised gains stay separate.
22. **The per-holding "Est. return / yr" is hidden for holdings first bought under 90 days ago** (display only; the engine and goldens keep the raw XIRR). A few days' move annualises into figures like +3,000 %/yr; the cell shows "—" with "Held under 90 days". The portfolio tile follows the same rule when the kind's first trade is that recent.

Not template fixes but D-decisions applied: FIFO only (D36), the Retirement tag ignored (D37), quick-add + default fees (D38), timing in-app only (D39), Total Return kept + realised separately (D41), the FY realised table without tax (D42).

---

## 12. Risks & fallbacks
| Risk | Status / fallback |
|---|---|
| XIRR multiple roots or non-convergence | Newton from 0.1 usually converges; when it leaves its domain (typical of heavy losses) the bracket fallback, with the scaled overflow-safe sign test, solves it. Both paths were checked against the sheet within 1e-6 during planning; null otherwise. The UI shows "—". |
| The parcel optimiser formula is inferred (the script is not in the export) | Labelled "estimate" in the parcel row (§6.3 item 5); a pure function with hand-worked tests; the owner can veto (final report). The imported static parcel settings are not used. |
| The D40 amount comes from imported budget rows | A pure function golden-tested against the Budget chain; Stage 3 swaps in live budget inputs without changing the signature. The UI says "From the imported budget". |
| The template's timing needs the Stage 3 savings engine when cash is below target | Reported in `deferred`; the countdown then uses the optimiser months only. |
| Golden brittleness at cutover (a fresh export) | Expectations are read at runtime; broken cells are detected by rule (§9.3), not by row. The skip counts are printed and reviewed privately. |
| Re-import after in-app edits | D34 + the deletion marker; the CLI override is explicit; e2e cleans up its own rows; the Verifier deletes each `DATA_DIR`. |
| A crashed e2e run leaves `app` rows | `import.setup.ts` runs `cleanupE2eRows` before importing; all e2e rows carry `e2e-temp`. |
| The mutating trade spec races the Stage 1 import spec (D34 409) | `trades.spec.ts` runs in its own `mutations` project that depends on `desktop` and `phone`, so it starts only after every other spec has finished. |
| Engine cost per request (four kinds, every page load) | Small for a personal ledger (hundreds of trades at most); linear in trades. If profiling ever shows > 50 ms, memoise per request by the max `rowid` or a data version in `app_meta` (not built now). |
| Decimal vs float drift | Decimal everywhere except inside XIRR; rounding once; summary = Σ rounded rows. |
| Timezones | `asOf` = the server-local calendar date of the injected `now()`; dates never go through `new Date(string)`. Stage 7 sets `TZ`. |
| Unpriced holdings in the golden run | Expected wherever the workbook's cached prices are errors or missing; §9.3 rules handle them. With live prices (Verifier #12) they are priced or flagged. |
| Cached formula precision (10 significant digits) | Every golden comparison adds a 1e-9 relative term (§9.5). |
| A demo or manual edit of imported rows blocks re-import of the owner's `data/` | The web warns on workbook rows, disables pristine saves, and a default-fee-only change stays re-import safe; the demo backs up `data/` first and edits no imported rows (§10 Demo frames). |
| Implementers blocked by stubs | The engine stubs throw; server unit and route tests inject a fake engine (`BuildAppOptions.engine`); FIFO-dependent route, integration and golden tests are gated by `ENGINE_IMPLEMENTED`, and server-api reports done only after they ran; the web builds on fixtures (phase A). |
| Ownership handover to the Integrator | Only after engine and server-api report done; every cross-area edit is listed in the Integrator's report and appended to "Scaffold notes". |
| Bundle size | The engine is not in the web bundle (the web uses `@joinr/schema` `trading.ts` only). Route splitting stays a Stage 6 item. |

---

## 13. Every agent: final report checklist
- Files created or changed (all inside your ownership; list any Scaffold-notes entries you appended, and any Integrator cross-area edits).
- Commands run with pass/fail: typecheck, lint, format:check, the tests for your scope, your e2e specs on your ports, `pnpm guard:all`.
- For engine, server-api, the spec reviewer and the Verifier: golden counts per tab (compared / skipped by reason). **No owner values or symbols** in anything that could be committed; private details go under `artifacts/` or `docs/private/`.
- Screenshot paths under `artifacts/screenshots/` (UI roles).
- The STYLE_GUIDE §10 self-check (UI roles).
- Contract gaps or cross-owner requests (do not work around them).
- Confirmation that your ports are free and no background processes remain.
- Nothing committed or pushed; nothing added to `docs/` or `reference/` outside your ownership; no owner data in any tracked file.

---

## Scaffold notes

_Scaffolder appends here (append-only): where the skeleton differs from, or adds to, the plan above. The Integrator and the Fixer append contract clarifications here too._

### 2026-09-25 — Scaffolder

The done-check passed: typecheck, lint, format:check, 1460 unit tests (85 files), build, `guard:all`, the smoke e2e on 5170/3070 (47 passed), `/api/health` → `migrations: 3`, and `seed:dev --yes` into `artifacts/scaffolder/data`. The `0000_*`/`0001_*` SQL and snapshot files are unchanged (`git diff --exit-code`).

**Dependencies and config**
- `@joinr/engine` has `@joinr/schema` (dependency) and `@joinr/importer` (devDependency), plus `"sideEffects": false`. The server depends on `@joinr/engine`. `pnpm install` linked the workspace with no prompts; the lockfile changed only in the server and engine importer entries.
- `packages/engine/vitest.config.ts` has `testTimeout: 60_000`.
- The ESLint engine rule (`packages/engine/src/**/*.ts`) bans `new Date()` with no arguments, `Date.now()`, `node:*` imports, `@joinr/schema/db` and `@joinr/schema/testing`. It also bans `drizzle-orm` **and its subpaths**, a superset of the plan. `new Date(0)` stays allowed.

**Schema (`@joinr/schema`)**
- **Enums** are appended as §3.2. **Error codes:** `TRADE_OVERSELL`, `INSTRUMENT_EXISTS` and `INSTRUMENT_IN_USE` are appended to `API_ERROR_CODES`.
- **`trading.ts`** is as §2.3, with these choices:
  - `unitsFromAmount` throws `RangeError` for a price that is not positive, or an amount that is not whole, non-negative cents. Callers validate both first; the web preview should check `isPositiveDecimal` before calling it.
  - `effectiveDefaultFee` honours `defaultFeeRate` for crypto only (it is ignored on other kinds). When a crypto has both a rate and a flat default, the rate wins.
  - `withinDecimalInputLimits` counts integer trailing zeros as significant digits (decimal.js `sd(true)`) and is false for a non-number.
  - `ratioFromPercentText` accepts `12`, `12.5`, `12.` and `.5`.
- **`dto/investments.ts`** is as §4.3–4.4. Additions (no frozen name or field changed):
  - Exported names: `MIN_TRADE_DATE`, `INSTRUMENT_SYMBOL_PATTERNS`, `normaliseInstrumentSymbol(kind, symbol)`, and the types `TradeInput`, `TradeInputBody` (the `z.input`), `InstrumentEditableBody`, `InstrumentCreate` and `InstrumentCreateBody`.
  - `instrumentCreateSchema` ends in a `.transform` that stores the **normalised** symbol (upper-cased for stock, ETF and crypto; managed funds as typed). The server gets it ready to store.
  - The trade date's three rules and the ratio input's format rules abort early, so a malformed value reports one issue, not one per rule.
  - `instrumentKindIssues` treats regions with four nulls as null (no issue on a stock or crypto). Messages are `must be empty for a stock`, `… for crypto` and so on. A rate default fee on a non-crypto kind reports `{ path: 'defaultFee', message: 'a percentage fee is for crypto only' }`.
  - The regions Σ check allows up to `1.000000001`.
- **Records:** `records.ts` gains `defaultFee` ("Default fee", money) and `defaultFeeRate` ("Default fee %", ratio) after `drp`. The records fixture rows and `apps/server/src/records/index.ts` fill both.
- **`splitSymbol`** now lives in `pricing.ts`. The importer's `process.ts` imports it from `@joinr/schema` and re-exports it, so its call sites and tests are unchanged.
- **`@joinr/schema/testing`** exports `COMMITTED_MIGRATION_COUNT`, the entry count of `meta/_journal.json` next to `MIGRATIONS_DIR`.
- **Seed:** `ASX:DEF` gets a `$0` flat default fee and `BTC` a `0.0025` default rate. Every row keeps `origin = 'import'`. No settings were added, so a page built on the seed reports its timing keys in `missing`.

**Fixtures (`@joinr/schema/fixtures`)**
- `src/fixtures/investments.ts` holds literal values produced by a scratch script (`artifacts/scaffolder/fixture-*.mjs`). The script applies the §2 rules: FIFO, pro-rata fees, the anniversary term, rounding once, summary = Σ rows, 12-significant-digit ratios, allocation and consider-next. `test/investment-fixtures.test.ts` re-checks the sums, counts, statuses, ledger totals, detail totals and coverage.
- **Exports:**
  - `INVESTMENT_FIXTURE_AS_OF` (`2026-09-24`, a Thursday) and `investmentSettings`.
  - `investmentPages` (one per kind) and `investmentPageEmpty(kind)`.
  - `investmentPageUnpriced` (ETFs), `investmentPageAllUnpriced` (stocks) and `investmentPageNulls` (managed funds).
  - `investmentPageTiming`: `{ wait, invest, cash_first, unavailable, below_emergency_fund, no_targets }`, all on the ETFs page. `invest` also has `budget.useBudget = false`.
  - `allInvestmentPageFixtures`, `investmentTrades`, `instrumentDtoById` and `instrumentDtos` (one per kind: no default, `$0` flat, none, a rate).
  - `holdingDetails` for ids 1 (stock: closed, partly sold and open parcels), 3 (exited ETF), 4 (`$0`-fee ETF with an app row), 5 (fund, 6-dp units) and 8 (coin with staking yields).
  - `tradeMutationResponse`, `deletedResponse` and `tradeInputExamples` (units, amount, crypto rate).
- `apiErrors` gains the four §3.4 entries. `FIXTURE_COVERAGE` moved to `src/fixtures/coverage.ts` (same export name through the index) and gains the four new lists.
- **Generic instruments used:**
  - Stock: `ASX:ABC` (1), `ASX:XYZ` (11), `ASX:GHI` (13; watching, created in the app, with a note) and `ASX:OLD` (2; exited, with an oversold sell).
  - ETF: `ASX:DEF` (4), `ASX:MNO` (12) and `ASX:XYZ` (3; exited). The same code as stock 11 on another kind, on purpose.
  - Managed fund: `EXAMPLEFUND` (5), `EXAMPLEFUND2` (6) and `EXAMPLEFUND3` (10; held and unwatched, in the nulls page).
  - Crypto: `BTC` (7) and `ETH` (8).
- **Knowing choices:**
  - `investmentPageNulls` sets its portfolio XIRR to null to exercise the null tile. The engine would solve one from the fully sold holding's flows. Its 1Y rate is genuinely null: the only trade in the window is on the as-of date.
  - `below_emergency_fund` shows a `cash_first` countdown (invest share 0 by §2.12 step 8). `no_targets` shows `unavailable`, with the six class-target keys in `missing`.
  - A watching instrument that has a price shows `valueCents 0` and `unrealisedCents 0` (open units × price, no lots). Exited instruments have `currentRatio: null`.
  - The empty page has no chart points and one FY row (the as-of FY).

**Migration and tests the migration breaks**
- `0002_stage2_investments.sql` was generated by drizzle-kit: two `ALTER TABLE … ADD` statements plus `meta/0002_snapshot.json` and the journal entry. The Drizzle `instruments` table lists the two columns last (their physical position).
- `migrations.test.ts`, `app.test.ts`, `db.test.ts`, `backup.test.ts` and `packages/schema/test/db.test.ts` use `COMMITTED_MIGRATION_COUNT`.
- **Deviation:** the "0001 database with data" upgrade test cannot call `seedGenericData` on a database stopped at 0001, because Drizzle's insert names every column of the current table definition (the new columns included). The test therefore does the following:
  1. Seeds a fully migrated in-memory database and dumps it (`dumpDomainTables`).
  2. Drops the two new columns and inserts the rows with raw SQL into a database stopped at 0001.
  3. Upgrades that database and asserts that the dump is unchanged, apart from the two new columns being null.

**Engine skeleton**
- `types.ts` is complete per §2.2. `EngineApi` members use named function-type aliases (`ComputeInvestmentsFn`, `XirrFn`, …, `SheetDateFn`), which are additions. `index.ts` re-exports every type (`export type *`).
- `index.ts` defines `MATCHING_STRATEGIES = ['fifo']` and `ENGINE_IMPLEMENTED: boolean = false`. Every other function is a stub throwing `engine: not implemented`, and `engine` (`satisfies EngineApi`) is built over them.
- `assetClassOfKind` and `sheetDate` are real. `sheetDate` uses UTC `setUTCFullYear`, so years below 100 are not shifted, and non-integers throw `RangeError`.
- The Stage 0 `packageName` test was deleted. `packages/engine/test/api.test.ts` holds the type-level `EngineApi` checks, `sheetDate` and `assetClassOfKind` tests, and a stub-throw test under `skipIf(ENGINE_IMPLEMENTED)`. The engine owner owns it from here.

**Server and web stubs**
- `routes/investments.ts` exports `InvestmentsRouteOptions` (with `now?` and `engine?`) and registers the nine §4.2 routes. Each answers `501 { code: 'NOT_IMPLEMENTED', message: 'Not implemented yet' }` through a local `sendNotImplemented`, and every response is `no-store`. `NOT_IMPLEMENTED` is a transient stub code and is not in `API_ERROR_CODES` (as in Stage 1).
- `app.ts`: `BuildAppOptions.engine?: EngineApi`. The routes are registered with `{ prefix: '/api', database: db, config, market, now, engine }`.
- `router.tsx` has typed routes for `/stocks`, `/etfs`, `/managed-funds` and `/crypto`. Each also has a `$instrumentId` route with a positive-int `beforeLoad` (non-matches go to `notFound()`), read through `useParams({ strict: false })` and keyed by id.
- The page stubs are `InvestmentPage` (h1 = the kind title, sub-line "Investments") and `HoldingDetailPage` (h1 "Holding", sub-line the kind title, since the symbol needs data). Both show the callout "Arrives with the Stage 2 web work".

**Contract gaps (closest compliant behaviour chosen; owners may refine)**
- §2.6 defines `currentRatio` as 0 for a watched holding with no units and null for a held unpriced one. It does not cover an exited (unwatched) instrument; the fixtures use null.
- The 0001 upgrade test cannot use `seedGenericData` directly (above).

### 2026-09-25 — server-api

Choices where the contract is silent (no frozen name, field or code changed):
- **`PUT /api/trades/:id` with `note` omitted** keeps the stored note (the schema makes `note` optional); `""` or `null` clears it. A create with no note stores null.
- **Amount mode:** besides the `"0"` case, derived units above the units-mode limit (1e12, or beyond the decimal input limits) answer `400 quantity.amountCents: the amount buys more units than a trade can hold`.
- **Messages:** `TRADE_OVERSELL` pluralises ("1 unit", "1 is held"); when no single sell can be named it says "This change sells more units than are held." `INSTRUMENT_EXISTS` reads "A stock / An ETF / A managed fund / A coin with the symbol X already exists". Not-found messages are "Instrument N not found" and "Trade N not found"; an unknown kind is "No investments page for this kind". A rate fee on a non-crypto trade is `400 fee: a percentage fee is for crypto only`; changing a trade's instrument is `400 instrumentId: the holding of a trade cannot change`.
- **Import lock:** for `PUT`/`DELETE` the `409 IMPORT_IN_PROGRESS` check runs before the `:id` is parsed, so it comes first even for a malformed id.
- **`timing.missing`:** the engine's keys first (`budgetInvestment`, then an `unavailable` countdown's), then the server's: every null class-target key (`allocation.*`), and — only when `monthlyInvestCents > 0` — null `investing.defaultBrokerageCents`, `returns.marketReturn`, `returns.cashInterestRate`, `pay.dayOfMonth` and a missing `investments.lastPurchaseDate`. Deduplicated, in that order.
- **`timing.deferred`** is `['cash_deficit_period']` when the consider-next cash row's current ratio is below its (non-null) target.
- **Cash shares:** `lastSnapshotCashShare` is null when there is no snapshot or the latest snapshot's six values add up to ≤ 0; `currentCashShare` is null when the six class values add up to 0 (the engine then uses 0).
- **Charts:** no points at all when there are no snapshots and the kind has no trades (the empty state). `purchaseWindows` gets `liveThrough = asOf` only when the live point is added.
- **Holding detail:** dividends are the ones linked to the instrument, oldest payment first; lots and disposals keep the engine's order.
- **Refresh identity check** (§4.5) also guards the CoinGecko id write, not only the price write.
- **Settings reader:** a stored JSON `null` reads as null without a warning; bad JSON or a wrong type warns with the key only.

### 2026-09-25 — engine

`@joinr/engine` is implemented and `ENGINE_IMPLEMENTED = true`: 127 engine tests pass, the goldens included (10 files). The frozen API (§2.2) is unchanged. Internal modules: `num.ts`, `lots.ts` (FIFO and the `selectLots` seam), `realised.ts`, `xirr.ts` (`solveXirr`), `investments.ts`, `history.ts` and `timing.ts`. `sheetDate` and `assetClassOfKind` now live in `timing.ts` and are re-exported unchanged.

Choices where the contract is silent (no frozen name, field or signature changed):
- **Data problems:**
  - A trade whose instrument is not in `instruments` is ignored everywhere: it gets no lot, trade row or disposal, because there is no holding to flag.
  - A zero or negative effective price counts as no price. The held holding is flagged `unpriced`, and its `price` is null.
  - A zero-unit row gets a `TradeResult` (side `buy`, order value 0, null remaining). It gets no lot, and it counts toward no date, window or flow.
- **Holdings:**
  - An exited instrument has `currentRatio: null`, which confirms the Scaffolder's fixture choice.
  - A watching instrument with a price has `valueCents: 0` and `unrealisedCents: 0`; without a price, both are null.
  - `estMgmtFeeCents` is computed whenever a value exists, so a priced watching row gets 0. `summary.estMgmtFeeCents` sums the held priced holdings only, and is null when none has a fee.
  - `averagePrice` has 12 significant digits, like a ratio.
- **Summary:**
  - `realisedThisFyCents` is the `totalCents` of the as-of FY row of `realisedByFy`, so the KPI hint equals the FY table.
  - The portfolio XIRR's terminal flow is the unrounded Σ of the held priced values.
- **Allocation:**
  - Target rings use watched instruments only, matching `targetSumRatio`: an unwatched instrument's target counts as 0. `byHolding` lists held instruments, plus watched ones with a target > 0.
  - A sector slice appears only when its current or target is > 0. The null-sector key is `unassigned`.
  - `byRegion` always has the five slices.
- **FY table:** `computeInvestments` builds `realisedByFy` from the unrounded gains, rounded once per FY and term (§2.5). The public `realisedByFinancialYear(disposals)` only receives rounded `gainCents`, so it sums those. The two can differ by a cent on the same disposals.
- **Dividends:**
  - `unitsAtEx` is `"0"`, not null, when a linked dividend's ex-date precedes every trade; its yield is then null.
  - The crypto staking yield uses the payments in (asOf − 365, asOf]. With no frequency set, the cadence rule applies to those same payments.
- **Timing:**
  - `budgetInvestment.missing` also lists these keys when their input is null, even though the amount is still computed: `investing.allocationAggressiveness` (aggressive is used), `snapshots` (the fallback share is used), `tax.marginalRate` and `investments.lastPurchaseDate` (the side part is 0) and `budget.items` (no `item` rows).
  - The order of `missing` is fixed: pay, items, switches, cash target, aggressiveness, emergency fund, snapshots, tax, last purchase.
  - `investCountdown` `unavailable.missing` holds only what the countdown sees:
    - `returns.marketReturn` when both the plan and the growth are null;
    - `investments.lastPurchaseDate`;
    - `pay.dayOfMonth`.
    
    When `monthlyInvest` is null it is `[]`, because the budget's list explains why.
  - `parcelOptimiser`: in the degenerate branches (no brokerage; growth ≤ cash rate), `optimalParcelCents` equals `parcelCents`.
  - `nextBuyHint`: "with a target" means a target > 0. Watched means `watching`, or `held` without `unwatched_held`.
- **Goldens:** `test/golden/{adapter,sheetFormulas,tally}.ts` with `investments.golden.test.ts` and `history.golden.test.ts`. Each area prints one counts-only line.
  - The Budget rows 8 → the row before "Cash Savings -" include unnamed rows as items, as `J4` sums them. The importer drops unnamed rows, which only matters when one holds a non-zero amount.
  - Every §9.3 skip and adjusted count matches the private companion's §3.

### 2026-09-25 — web (phase A)

The four investment pages, the holding detail page, the trade and holding forms and the API hooks are built on the fixtures with mocked fetch. No frozen name, field or code changed. Choices where the contract is silent:
- **XIRR display rule (§6.3 item 4):** `HoldingRowDto` carries no first-trade date, so the web takes it from the kind's ledger (`GET /api/investments/:kind/trades`, which the page loads anyway), and on the detail page from `detail.trades`. While the ledger is still loading, a held holding traded in the last 90 days shows "—" too, so an extreme figure never flashes. The portfolio tile uses the kind's earliest trade in the same way.
- **Tiles:** only Portfolio value is whole dollars; the other money tiles show cents (matching "$0.00" in §6.8). Total return's delta reads "+14.2% up on cost" / "down on cost". Watching-only: every trade-based tile hints "No trades yet".
- **Empty kind** (no instruments): the page shows the header and the §6.8 callout only (no tiles or sections). "Add trade" appears only when the kind has at least one instrument.
- **Holdings table:** the Price cell shows the price, plus a "Manual" badge that links to `/prices` for a manual price (§6.4). Stale and unpriced states show as the Holding cell's flag badges (not repeated in the Price cell, on phone either). Difference is signed (+/−) in body text: it is not a loss. The management fee shows 2 dp (0.07% would read 0.1% at 1 dp). The exited `<details>` table has Holding (with its flags), Realised and Last trade, and a "Total" row.
- **Ledger:** the caption shows the row count after the filters ("ETFs trades: 6 rows"). On a holding's detail page the Holding column is dropped (every row is that holding); on a phone its Flags column then stays. A rate fee shows the rounded fee plus the rate ("$9.26" over "0.5%").
- **Trade form:** the Holding field starts empty ("Choose a holding") on the investment page and pre-selected on a detail page. The remembered Units/Amount choice is one per-browser key for every kind. For an edit, an untouched fee is sent back exactly as stored, and a percent field accepts as many decimal places as its stored value needs (at least 4). The detail page loads the kind's page (for the Holding list) only when the form opens.
- **Holding form:** the detail page shows it always, in the "Holding settings" card; "Edit holding" scrolls to it and focuses its first field, and Cancel undoes unsaved changes. Its workbook callout reads "This holding came from the workbook. Saving a change other than the default fee counts as an app edit…". Fields that do not apply to the kind are sent as null.
- **Tests:** helpers are in `apps/web/test/investments.ts`; supplementary fixtures in `apps/web/test/fixtures/investments.ts`: the nulls page's ledger, over the ETF limit, targets at 95%, a price refresh running, and watching only.
- **For the Integrator:**
  - The e2e drafts skip while `/api/investments/etf` answers 501 (`investmentsApiReady`).
  - `trades.spec.ts` skips itself outside a `mutations` project, and its hooks do nothing there.
  - `investments-states.spec.ts` needs no investments API; it passed 26/26 on 5184 against a scratch fixture server.
  - With the real routes and the synthetic import (5184/3184, `--no-deps`), `investments.spec.ts` passed 19 (plus 1 skipped: the phone run of the desktop-only overflow record), and `smoke.spec.ts` passed 46/46. The pages now call the API, so a server whose investment routes answer 501 would fail the smoke console-error check.
  - The ETF holdings table at 1440 px overflows its container: 1250/1152 px with "More columns" off, 1790/1152 px with it on (synthetic data).

### 2026-09-25 — Integrator (phase B)

The stack ran on 5185/3185 (`MARKET_DATA_MODE=fake`, synthetic import). The pages already called the real API; no engine or server-api file needed an integration fix. The owner-copy check on a scratch `DATA_DIR` (`MARKET_DATA_MODE=off`) covered the four pages, one detail page each and both forms at 1440 and 375: no console errors and no page-level horizontal scroll once fix 2 below was in.

**Cross-agent requests**
- `playwright.config.ts` adds the `mutations` project: desktop viewport, `testMatch: /trades\.spec\.ts/`, `dependencies: ['desktop', 'phone']`. Desktop and phone add `trades.spec.ts` to `testIgnore`.
- `e2e/import.setup.ts` calls `cleanupE2eRows` before the synthetic import.
- The engine asked for the FY figures to come from `InvestmentsResult.realisedByFy`. `investments/page.ts` already does this; no change.
- server-api's repo-wide lint and format request was already clean when phase B started.

**Integration defects fixed (web files)**
1. **Deleting a holding on its detail page refetched that holding** and logged a 404. The `['instruments']` invalidation reached the deleted holding's still-mounted detail query before the page navigated away.
   - `useDeleteInstrument` now calls `invalidateAfterInstrumentDelete(queryClient, id)`. It covers the same keys as the other mutations, but the deleted id's detail is cancelled and marked stale without a refetch.
   - A new hook unit test fails on the old behaviour.
2. **The "Held under 90 days" dash (`DashWithReason`) could widen the page at 375 px.** Its visually hidden text is absolutely positioned. It was placed against a block outside the table's scroll container, so a dash far to the right of a wide table widened the page.
   - The span is now its containing block (`.jf-app-anchor { position: relative }`).
   - `investments-states.spec.ts` now also asserts no page-level horizontal scroll. It fails on the old behaviour (the all-unpriced state at 375).
3. **ETF counts tile:**
   - A no-break space keeps each count with its word, so a lone number never wraps onto its own line.
   - The "Over limit" badge wraps under the figure (`.jf-app-tile-flag--wrap`) instead of squeezing it into one word per line.
   - The `etfCounts` text and its tests are unchanged.

**e2e**
- `trades.spec.ts`: the oversell step waits for the `POST /api/trades` 422. The console check then allows exactly that one failed-resource entry, which Chromium logs for every 4xx. The units are also re-checked after Cancel.
- `investments.spec.ts` gains a read-only forms test on real data (nothing is saved). It covers:
  - the trade form in amount mode, and in units mode with the sell "Held now" hint;
  - the holding form;
  - the crypto % fee.

  Each form gets screenshots, and the test asserts no page scroll and no console errors.

**Contract gaps (reported, not edited: no Stage 2 owner)**
- `e2e/ui-core.spec.ts` (the frame test) still asserts the placeholder note "Stocks arrives in Stage 2" on `/stocks`. Stage 2 replaced that page, so the test has failed since scaffolding (the Scaffolder's done-check ran `smoke.spec.ts` only). Proposed fix: assert `getByRole('group', { name: 'Portfolio value' })` instead.
- `e2e/records.spec.ts` "every record table renders from the real API" loads 16 pages in one test:
  - Stage 1 runs took 24–28 s against the 30 s default.
  - With Stage 2's 170 tests on 12 workers it takes 31–36 s and times out.

  Proposed fix: `test.setTimeout(60_000)` in that test.
- Both proposed fixes were verified with patched copies under a git-ignored scratch Playwright config. From an empty `DATA_DIR`, the full chain passes, the `mutations` project included.
- While these two tests fail, the `mutations` project does not run, because it depends on `desktop` and `phone`.

**Accepted as recorded (no change):** the engine, server-api and web choices above. The web's 90-day XIRR rule takes the first trade from the ledger and needs no DTO change.

### 2026-09-25 — Fixer (round 1)

The verified review findings were applied across owners. No frozen name, field, code or signature changed. The contract clarifications below were approved through triage (coordinator OK).

**Contract clarifications**
- **§4.4 `TradeRowDto.flags`** (SPEC-1): the stored review flags **except `oversell`**, ∪ the live `oversell`. `oversell` is live-only (§3.3). An importer-written `oversell` can go stale: a same-day sell entered before its buy (the importer's running total has no buys-first rule), or an oversold sell the owner later fixes by adding the missing buy. The Records view keeps the raw stored flags. The importer (Stage 1) is unchanged.
- **§9.3 rule 14** (SPEC-4): new skip reason `zero_units`. A zero-unit ledger row in a Capital Gains block is neither a lot (`O`) nor a disposal (`P`/`Q`/`S`), so it is now counted rather than silently dropped. It is 0 on the current workbook.
- **Trade input** (CODE-3), an additive schema refinement:
  - `@joinr/schema` exports `ORDER_VALUE_CENTS_MAX` (1e13 cents, the amount-mode ceiling) and `orderValueIssue`.
  - In units mode, `makeTradeInputSchema` rejects |units × price| above that ceiling with `400 quantity.units: the order value is too large`. A rate fee above it gives `fee.rate: the fee is too large`, which cannot happen while a rate is at most 1.
  - The web's `validateTradeDraft` applies the same bound (CODE-4). `tradePreview` returns null instead of throwing, so a huge product never crashes the form.
- **§2.1 / §2.13 engine** (CODE-2): a held holding's price is unusable when its value, unrealised gain, total return or any open lot's unrealised gain would pass `Number.MAX_SAFE_INTEGER` cents. Such a holding is flagged `unpriced` with `price: null`, left out of every sum and counted in `unpricedCount` (the existing path; no enum change). One absurd price no longer fails every investment page.
- **§5 clarification** (STYLE-8): when `summary.unpricedCount > 0` and a live point exists, the Value and Gain cards add "N holding(s) without a price are left out of the last point." under the live-point note.
- **§6.3 item 7 and §6.7** (STYLE-3): the FY table's headers are "Short term" and "Long term". The callout under the table already defines the 12-month rule. On a phone the columns are Financial year, Total, Short term, Long term, Disposals.

**Web choices (no contract change)**
- **Tables:**
  - The holdings table and both ledgers use `.jf-app-compact-table` (STYLE-1). Headers may wrap onto two lines, and cells have 8px side padding.
  - The core columns now fit the 1152px content area at 1440 on every kind. On synthetic data the min-content widths are 1044 (stock), 1061 (ETF), 1075 (managed fund) and 988 (crypto) for the holdings table, and 963, 934, 1080 and 989 for the ledgers. Before the change the holdings table measured 1226, 1250, 1289 and 1184.
  - With More columns on, the holdings table still scrolls inside its container with Holding sticky. A right-edge scroll fade in `packages/ui` is left for Stage 6.
- **Ledger:**
  - The Result column is numeric (right-aligned). Its figures carry a muted "unrealised" or "realised" word (STYLE-11).
  - The review-flag "Oversell" badge is left out wherever the "Oversold N" badge renders (STYLE-10).
  - On a holding's page the caption uses the symbol ("ASX:DEF trades: 3 rows") (STYLE-16).
- **Delete confirm** (STYLE-4, STYLE-7):
  - The visible question names the trade ("Delete the ASX:DEF buy of 18/08/2026?") and is the group's name.
  - Cancel's accessible name is "Cancel: keep the … trade of …".
  - On open, a table that scrolls sideways is scrolled so the confirm cell starts right of the sticky first column. Focus then moves to Cancel with `preventScroll`. The group wraps within 13rem, so it fits beside a phone ledger's Date column.
- **Next buy** (STYLE-15): in the `cash_first` state, the amount to invest shows $0.00 with the source in words ("the budget's investment row is −$1,000.00"). The hint reads "Next: ASX:DEF, once cash allows" (or "Next: ETFs, once cash allows").
- **Allocation** (STYLE-12): a donut whose ring has exactly one slice names it under the ring ("100% Diversified"). The donut shows no legend for a single slice.
- **Holding form:**
  - Saves use `mutateAsync` (review-style SPEC-1). A save that changes the editable fields remounts the form, and "Holding saved" still shows.
  - On the detail page the notice now shows beside the form, in a live region named "Holding save result". The page's "Save result" region keeps the trade notices.
  - The parse checks and the schema checks run together, so every error shows on the first Save (STYLE-14).
  - Percent fields word ratio bounds in percent ("Must be 100% or less.", "Must be 10% or less."), for both client and server messages.
  - The stock, ETF and crypto symbol errors are worded apart from their hints.
- **`packages/ui` `KeyValueTable`** (STYLE-2): the 38% label column is set on a `<colgroup>` (`.jf-kv__col-label`), because a visually hidden caption stopped the cell width applying under `table-layout: fixed`. The label/table ratio measures 0.380 on the detail facts and the next-buy card.

**Tests and tooling**
- `e2e`: `investmentsApiReady` and its skips are gone (CODE-12). The investments and trades specs now assert `GET /api/investments/etf` answers 200 (`expectInvestmentsApi`), so a missing API fails instead of skipping.
- The server golden compares the Capital Gains symbol and `SheetOptions!H20` as booleans, so a failure prints cell refs only (CODE-11).
- `packages/engine/test/timing.test.ts`: the "aggressive" clamp case uses a generic cash share of `0.6` (CODE-1).

### 2026-09-25 — Fixer (round 2)

No contract change. One Stage 0 spec with no Stage 2 owner was fixed after triage routed it (VER-1).
- **The problem.** In `e2e/ui-core.spec.ts`, "desktop: a short page fits the viewport, footer included" checked `/stocks` and `/budget`. It asserts `scrollHeight === innerHeight`, which holds only for a placeholder page. Stage 2 built `/stocks`, so the test failed on every full run. Because it failed, the `mutations` project (`trades.spec.ts`) did not run, which §10 #6 counts as a failure.
- **The fix.**
  - The test now checks `/fire` and `/budget`, two routes that still render `PlaceholderPage`.
  - It waits for the placeholder's "arrives in Stage" note before it measures. The measurement no longer races the first render, and a page that a later stage builds fails with a plain message.
  - A later stage that builds one of these pages swaps in another placeholder route.

### 2026-09-25 — Fixer (owner-decision round: D46, D47, server test timeouts)

**D46: the automatic investment split is off (Coordinator-approved, D46).** An additive contract change; no existing name, field or value changed.
- **Schema:** `COUNTDOWN_STATES` gains `'split_off'` (appended last), and `CountdownDto` gains `{ state: 'split_off' }`.
- **Engine:**
  - `Countdown` gains `{ state: 'split_off' }`.
  - The `InvestCountdownFn` input gains two optional fields, `useBudgetForInvest?` and `autoInvestSplit?`: the budget switches, as sent to `budgetInvestment`.
  - With nothing to invest (`monthlyInvestCents ≤ 0`), `useBudgetForInvest === true && autoInvestSplit === false` gives `split_off`. Every other case gives `cash_first`, as before, and so does leaving out both fields.
  - The amount is unchanged: the investment row is $0 and the after-tax side income is still added (§2.12 step 12). With side income since the last buy, the countdown still runs as usual.
- **Server:** `buildTiming` passes both switches from the settings and maps `split_off` through. `missing` is unchanged: the plan inputs are listed only when there is something to invest.
- **Fixtures:** `investmentPageTiming.split_off` (ETFs page): the budget drives the amount, the investment row is $0, there is no side income and no plan, and the hint is ASX:DEF with no parcel. The coverage test now expects five countdown states.
- **Web** (an addition to §6.3 item 5):
  - The countdown line is a status line, "Automatic investment split is off". It uses the check-tone (orange) alert icon plus the words, the `.jf-app-tile-flag` pattern, and no red.
  - A muted line follows: "The budget sends the whole leftover to cash, so there is no monthly amount to invest."
  - Monthly amount to invest shows $0.00 with "the budget's automatic investment split is off".
  - The hint is the plain suggestion ("Consider ASX:DEF"), not "…, once cash allows", because waiting for cash changes nothing while the split is off. The cash-first copy is unchanged.
- **Tests:**
  - Engine: the state, only for that switch combination, and the budget → optimiser → countdown chain.
  - Server builders: the switches as passed, the `split_off` mapping, and the real budget and countdown on the seed (split off → `split_off`; split on → an amount to invest).
  - Schema fixture checks, the web display helpers and the card.
  - `e2e/investments-states.spec.ts` gains the `timing-split-off` state (screenshots at 1440 and 375).

**D47: the Units / Amount choice per holding.** §6.6 "Entry → Default mode" now reads: Amount when the selected holding's `effectiveDefaultFee` is a $0 flat fee, otherwise Units. **The owner's last explicit choice for that holding wins**; it is keyed by instrument id (`localStorage` `joinr.investments.entryMode.<id>`, try/catch). Another holding's choice never applies. Edit still opens in Units mode. This replaces the web phase A note "one per-browser key for every kind".
- **When a choice is stored:** when the owner clicks Units or Amount with a holding selected. A successful Save also stores the chosen mode for the saved trade's holding, when the mode was chosen in that form, so a choice made before a holding is picked is kept too.
- **The old key:** the browser-wide `joinr.investments.entryMode` is never read, and it is removed when the trade form opens. Every storage access is wrapped: reads fall back to the holding's default, and writes and removals do nothing.
- **Code:** `tradeDraft.ts` `defaultEntryMode`, `newTradeDraft` and `withHolding` take a `RememberedMode` lookup (instrument id → mode or null). `NO_REMEMBERED_MODE` is the empty lookup.
- **e2e:** no existing step relied on the old key, because each Playwright test starts with empty storage. `investments-states.spec.ts` gains a D47 test. With the old key set to Units, a Units click on ASX:MNO leaves the $0-fee ASX:DEF in Amount, and the old key is gone once the form opens.

**Server test timeouts.** `apps/server/vitest.config.ts` sets `testTimeout` and `hookTimeout` to 20 000 ms. The first test in `app.test.ts` and in `status-routes.test.ts` builds the app cold, and under heavy machine load it passed the 5 s default. No test changed.

## Stage close notes (coordinator)

**Outcome (2026-09-25).** The flow ran as planned, in four workflows:
1. Planner → 3 plan critics → reviser.
2. Scaffolder → engine, server-api and web phase A in parallel → Integrator.
3. 3 reviewers → adversarial triage → Fixer → Verifier (two rounds).
4. One owner-decision round (Fixer → Verifier).

The owner approved the demo on the real database.
- **Final state:**
  - typecheck, lint, format:check, build and `guard:all` are green.
  - **1878 unit tests** pass (110 files). The engine goldens, the server golden and the engine-gated server suites all ran; none were skipped.
  - **e2e: 163 passed, 11 skipped by design**, and the `mutations` project ran.
  - The Verifier passed all 15 items of §10.
- **Goldens:** every §9.2 cell is compared, or skipped for a §9.3 reason. The per-tab skip counts match the private companion. The owner import reproduces the private expectations through the API, including the FIFO remaining units on every lot and both disposals.
- **Demo:** migration 0002 was applied to the owner's database on the first Stage 2 start, after a backup (D44). The four pages rendered with live prices. The database ended with no app-entered rows, so re-import is still allowed.

**Plan review.** The critics raised 46 findings: 45 were applied and 1 was applied in part (see the Plan review log).

**Build review.** The reviewers raised 34 findings (1 blocker, 6 major).
- **Triage:** 22 confirmed, none refuted, 10 deferred, and 2 returned as owner decisions (D46, D47).
- **Fixes:** the Fixer fixed 21. The other confirmed one was a note in the private companion, which the coordinator fixed.
- **The blocker was a privacy one.** An engine test copied a rounded (4-significant-digit) owner ratio that the guard did not list. The test now uses a generic value, and the guard now also lists the rounded and percent forms of the private ratios.

**Integration fixes outside the Stage 2 ownership.** Two Stage 0 assertions in `e2e/ui-core.spec.ts` still expected the `/stocks` placeholder page. A records test in `e2e/records.spec.ts` needed a 60 s timeout for the larger suite. The coordinator fixed the first placeholder assertion and the timeout; the round-2 Fixer fixed the second assertion (the short-page test).

**Owner decisions during the stage:** D44–D48 (`docs/DECISIONS.md`):
- The demo ran on the backed-up real database.
- There is no sparkline or P/E column.
- A manual-split budget keeps a $0 amount to invest and says why, through a new additive countdown state `split_off`.
- Units/Amount is remembered per holding.
- All 22 §11 fixes were accepted at the demo.

**Contract changes after the plan** (all additive; details in the Scaffold notes):
- The countdown state `split_off` (D46).
- `ORDER_VALUE_CENTS_MAX` and `orderValueIssue()`, which add a joint units × price bound on trade input.
- Oversell is a live-only trade flag.
- A price that would overflow safe-integer cents is treated as no price.
- The golden skip reason `zero_units`.
- The FY table headers are "Short term" and "Long term".
- `KeyValueTable` gains a label `colgroup`.
- The server Vitest project's test and hook timeouts are 20 s.

**Deferred (with target stage):**
- **Stage 3:** harden the engine purity checks (timers, dynamic `import()`, `require`, `Math.random`) before the engine gains cash-flow code.
- **Stage 5:** the history charts draw the gap between the last snapshot month and the live point as a single category step. Period filling comes with snapshot recording and aggregation.
- **Stage 6 polish:**
  - Make the default-fee edit easier to find in the Edit holding flow.
  - The ETF Holdings tile puts a sentence in the figure style.
  - The trade form duplicates the schema's limits.
  - Small helpers are duplicated across the engine, server and web (the local ISO date, the region sets).
  - The investments service imports the import lock from a route module.
- **Stage 7:**
  - Pick one rule for trades dated after the server's as-of date. This is only reachable across time zones, once the NAS time zone is set.
  - A CLI import running beside the server can race the D34 re-check and the page build's two reads. The upload route is safe under the import lock.

**Environment notes.**
- e2e runs can fail with `net::ERR_NETWORK_CHANGED` when the PC's VPN or Tailscale adapters change; a re-run passes.
- Under the Claude preview, `pnpm dev` gets `PORT=5173`, so the server listens on 127.0.0.1:5173 beside Vite on ::1:5173. It works through the proxy, as in Stage 1.

## Plan review log (2026-09-25)

Three critics (spec, feasibility, UX/privacy) reviewed this plan and the private companion. The plan reviser verified each finding against the code, the specs and the local workbook (scratch scripts under `artifacts/plan-reviser/`, plus re-runs of the critics' probes), then applied it, applied it in part, or rejected it. Findings are numbered in the order received; the critic's id is in brackets.

| # | Finding (generic) | Outcome |
|---|---|---|
| 1 [SPEC-1] | Golden tolerances were absolute and had no row for prices; cached formula results keep only 10 significant digits, so high-magnitude prices and long unit counts fail on rounding | **Applied:** a 1e-9 relative term on every numeric comparison, a prices row, units `max(1e-8, 1e-9·abs(v))` (§9.5) |
| 2 [SPEC-2] | The Budget-chain and consider-next goldens had no adapter inputs; "never reads SheetOptions column L" contradicted inputs that exist only there | **Applied:** a timing-inputs source table in §9.1; column L read only for four non-secret IDs by ID lookup, never printed; the secret IDs never read |
| 3 [SPEC-3] | The sheet counts its unfilled current side-income period as 0 (the 365-day mean and the H2 mean); the app skips it, so the two diverge once a filled period ends after the last buy | **Applied:** §11 fix 20 (vetoable; spec 02 §6 item 5); §2.12 step 11 corrected; the adapter drops unfilled rows; §9.3 rule 6 recomputes H2 and B2 without them |
| 4 [SPEC-4] | The simple est. return helper did not say which lots enter the cost-weighted date; mixing priced-only and all lots moves the result far beyond tolerance | **Applied:** the helper and the recomputed expectation both use the priced holdings' lots only (§9.1, §9.3 rule 1) |
| 5 [SPEC-5] | The partly-sold-lot fee rule adjusted only the ledger unrealised cell; the full-fee deduction also flows into the ledger %, the holding and tab total return $ and %, and the simple est. return | **Applied:** every dependent cell gets an adjusted expectation, counted `partial_lot_fee` (§9.3 rule 5) |
| 6 [SPEC-6] | A price-free staking-total column was skipped as price-dependent; the staking-yield column is a lookup into a current-FY table | **Applied:** the staking total is compared with `dividendsCents`; the yield column gets its own reason `fy_table_lookup` (§9.2, §9.3 rules 2 and 13); private counts updated |
| 7 [SPEC-7] | Watched rows with no net units show 0 or "-" where the engine returns null | **Applied in part:** rule `not_held` (§9.3 rule 12) asserts a null total return $ and % and average price; the XIRR and dividend-return cells are skipped rather than mapped, because a fully sold holding keeps a real XIRR and all-time dividends in the engine. `averagePrice` null at zero units is now explicit (§2.2, §2.6) |
| 8 [SPEC-8] | No rule for FY rows present on only one side of the realised-by-FY comparison | **Applied:** union of FYs, missing = 0 (§9.2, §9.3 rule 10, §9.4) |
| 9 [SPEC-9] | The sheet's H9 class excludes other assets and has no emergency-fund override, unlike E45 | **Applied:** H9 has its own expected-class rule; only E45 maps to `considerNext` (§9.2, §9.3 rule 11) |
| 10 [SPEC-10] | Newton leaves its domain for heavy-loss holdings (so the bracket fallback is a normal path, contrary to §12), and `(1+lo)^(−t)` overflows beyond about 30 years | **Applied:** an overflow-safe scaled sign test, a heavy-loss fallback test and a 40-year test; §12 corrected (§2.7) |
| 11 [SPEC-11] | Null emergency-fund months and a missing cash share had no defined behaviour; two inputs were missing from the source table | **Applied:** `emergencyFundCents` is nullable in the frozen result and the DTO (null disables the cash-first and below-emergency-fund rules; the key goes in `missing`); the share falls back to 0 as the sheet's IFERROR does (§2.2, §2.12, §4.4) |
| 12 [SPEC-12] | The sheet highlights the ETF target count over the limit, the plan the held count | **Applied:** warn when either count exceeds the limit (§2.6, §6.3) |
| 13 [SPEC-13] | Crypto total return keeps the staking total after a full sale; the difference was undocumented | **Applied:** per-kind table rows and §11 fix 21 (D41-consistent) |
| 14 [SPEC-14] | The private consider-next table lacked targets; the private API figures assumed an as-of FY without saying so | **Applied** in the private companion (§5, §6) |
| 15 [FEAS-1] | Migration 0002 breaks five migration-count assertions, three outside the Scaffolder's files | **Applied (blocker):** all five files go to the Scaffolder; a `COMMITTED_MIGRATION_COUNT` helper (the journal's entry count) replaces the literals (§3.2, §7.1, §7.2) |
| 16 [FEAS-2] | The detail DTO needs per-payment units at ex-date and yield, which the frozen engine result did not expose | **Applied:** `DividendResult[]` in `InvestmentsResult` (§2.2, §2.9, §4.4) |
| 17 [FEAS-3] | Route tests go through `buildApp`, which had no engine option; FIFO-dependent route tests would fail until the engine lands | **Applied:** `BuildAppOptions.engine`, `EngineApi` and the `engine` value; FIFO-dependent route tests gated; server-api is done only after the gated suites ran (§2.2, §4.5, §7.4) |
| 18 [FEAS-4] | No owner for schema fixes or new fixture states after scaffolding | **Applied:** server-api is the post-scaffold owner of `packages/schema/**` (coordinator OK + a Scaffold note per change); web adds supplementary fixtures under its own tests (§7.1, §7.5) |
| 19 [FEAS-5] | The deletion marker keyed on `origin = 'import'` missed imported rows that were edited and then deleted; one consistency sentence contradicted the default-fee rule | **Applied:** the marker is keyed on a non-null `sheet_ref`; tests and Verifier #8 cover edit-then-delete; the sentence is corrected (§3.3, §4.5, §7.4, §10) |
| 20 [FEAS-6] | The instrument PUT schema had no kind, so the per-kind rules could not run; there was no canonical comparison for the origin rule | **Applied:** `instrumentKindIssues`, `makeInstrumentUpdateSchema(kind)`, `instrumentEditableFromDto`, `normaliseInstrumentEditable` (§4.3, §4.5) |
| 21 [FEAS-7] | A 12-decimal-place limit rejected some 12-significant-digit stored values | **Applied:** ≤ 18 dp and ≤ 15 significant digits for units, prices and ratios (§2.3, §4.3, §7.2) |
| 22 [FEAS-8] | The upload import awaits the corrections file after its app-data check, so a mutation could slip in; the page loader read without a transaction | **Applied:** mutations answer 409 `IMPORT_IN_PROGRESS` while the import lock is held; a synchronous re-check right before the import; the loader reads in one transaction (§4.2, §4.5) |
| 23 [FEAS-9] | Instrument ids can be reused after a delete, so an in-flight price refresh could write to the new instrument | **Applied:** the refresh write also checks kind and symbol (server-api owns that edit, with a test) (§4.5, §7.1) |
| 24 [FEAS-10] | No ledger query hook; the Stage 1 import and price invalidations missed the investment keys | **Applied** (§6.2) |
| 25 [FEAS-11] | e2e cleanup needed the instrument note; dependency projects run unfiltered; the e2e drafting ownership conflicted | **Applied:** `note` on `HoldingRowDto`; a fast loop and "a skipped `mutations` project is a failure"; web phase A owns the e2e drafts (§4.4, §7.1, §7.6, §10) |
| 26 [FEAS-12] | Two pieces of work had no owner: the re-import-keeps-default-fee test and a per-point chart marker | **Applied:** the test goes to server-api; the marker is dropped for a "(live)" label (§3.1, §5, §6.3) |
| 27 [FEAS-13] | "The dump equals a fresh import's" cannot hold, because pricing rows carry run timestamps | **Applied:** compare with a baseline dump taken right after the #7 import, ignoring the pricing timestamp columns (§10 #8) |
| 28 [FEAS-14] | A wall-clock XIRR assertion could flake under parallel test projects | **Applied:** an internal `solveXirr` exposes the method and iterations; no timing assertions (§2.7) |
| 29 [FEAS-15] | The importer's symbol split and the records other-assets valuation were private | **Applied:** `splitSymbol` moves to `@joinr/schema` (the importer re-exports it); server-api exports the valuation (§3.2, §4.5, §7.1) |
| 30 [UX-1] | The holdings total row could not equal the visible rows (hidden exited rows, unpriced rows, dashed watching rows) | **Applied:** each total cell is defined; watching rows show realised and dividends; the exited table has its own total; a web test (§6.3, §7.5) |
| 31 [UX-2] | Percent ↔ ratio conversion by float maths produces long ratios the schema rejects, and odd displays | **Applied:** string-based `ratioFromPercentText` / `percentTextFromRatio` with tests; typed percent fields capped at 4 dp (§2.3, §6.6) |
| 32 [UX-3] | The holding form's full-replace PUT could flip `origin` or fail on round-trip differences | **Applied:** the canonical editable mapping, `''` → null, stock/crypto regions null, untouched fields sent verbatim, a normalised server comparison; web, server and Verifier UI tests (§4.3, §6.6, §7.4, §7.5, §10 #10) |
| 33 [UX-4] | Nothing warned that editing or deleting workbook rows blocks re-import; a pristine save would still PUT | **Applied:** the workbook callout, Save disabled while pristine, a Source column (§6.3, §6.6) |
| 34 [UX-5] | The demo runs on the owner's database, migrates it without a backup and never shows the default-fee flow | **Applied:** rewritten demo frames with a backup step, a default-fee-only edit and re-import checks; which database to use is an owner question (§10, §12) |
| 35 [UX-6] | A hollow live marker and a header pill needed `@joinr/ui` features that do not exist and have no owner | **Applied:** a "(live)" category label plus a note; the discount wording moves into the callout (§5, §6.3) |
| 36 [UX-7] | Trade-form gaps: no re-fill on a holding change, double submit, focus handling, an unbuildable confirm row, long visible labels, no held-units hint, no default entry mode | **Applied:** all seven; the default mode is Amount for $0-fee holdings, else Units, remembered per browser (§6.3, §6.6, §7.5) |
| 37 [UX-8] | Missing copy for several timing states and labels | **Applied:** copy for every reason and state, singular days, the estimate label, the non-budget amount text, and how to fix missing inputs (§6.3) |
| 38 [UX-9] | Null and partial KPI and allocation states were unspecified | **Applied:** null tiles, unpriced hints, the empty-ring table default, new fixtures (§3.4, §6.3, §6.8) |
| 39 [UX-10] | The phone trades order put status last | **Applied:** flags render inside the Holding cell on phone (§6.7) |
| 40 [UX-11] | Units displayed at 4 dp while funds carry 6 | **Applied:** display dp per kind from `AMOUNT_MODE_UNIT_DP` (§2.3, §6.3, §6.4) |
| 41 [UX-12] | The ETF holdings table is too wide for desktop | **Applied:** core columns plus a "More columns" switch, in-container scroll with a sticky first column, and an overflow record for the style reviewer (§6.3, §7.6) |
| 42 [UX-13] | A state shown as a pill, several teal figures, ragged KPI rows | **Applied:** a status badge, one teal table cell, full rows per kind (§6.3) |
| 43 [UX-14] | Fixture-only states could not be screenshotted | **Applied:** `mockInvestmentPage` and a read-only states spec (§7.6, §7.7) |
| 44 [UX-15] | The per-holding XIRR of very recent holdings annualises into extreme figures | **Applied:** a web display rule (under 90 days → "—"), listed as vetoable §11 fix 22; the engine and goldens are unchanged |
| 45 [PRIV-1] | The guard terms missed distinctive units, prices, ratios and contributions; the Verifier relied on an earlier scan | **Applied:** private §8.1 (checked: no false positives; a template constant excluded); "change your value, never the terms file"; the Verifier re-runs the scan (§7.0, §7.7, §10 #14) |
| 46 [PRIV-2] | The tracked plan carried counts and qualitative facts that fingerprint the owner's ledger | **Applied:** reworded generically (header, §2.4, §7.3, §9.2–§9.4, §12) |

Rejected: none outright. Two were applied in a different form from the critic's suggestion: #7 asserts null only where the engine's value is null by definition and skips XIRR and dividend return (a fully sold holding keeps a real XIRR and all-time dividends), and #11 uses the sheet's IFERROR fallback (a share of 0) instead of making the amount null when no cash share exists. The critics' owner questions were settled in the plan where an existing decision already answers them (D38 defines amount mode as units = amount ÷ price with the fee on top; D34 covers edit-then-delete; D41 covers the sold coin's total return) or where the choice is a cheap, vetoable default (the ETF limit warning, trade precision, the default entry mode, the timing-card placement, the 90-day XIRR rule, the side-income fix). Only the demo database remains an owner question.
