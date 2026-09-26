# Stage 3 — Cash flow & income: Cash, Side Income, Dividends, Budget: build plan

_Planner output, 2026-09-25. Inputs: PLAN.md (Architecture, Stage 3, Stages 4–5 for deferrals), docs/HANDOFF.md, docs/DECISIONS.md (D5, D25, D28, D29, D34, D38–D62; D59–D62 are the owner's plan-review answers, applied on 2026-09-25), docs/STAGE_PROCESS.md, docs/stages/stage-2.md in full (structure, frozen-contract style, Scaffold notes, close notes, plan review log) and the data-model, importer and price-service parts of stage-1.md, spec 02 in full (the source of truth), spec 01 (SheetOptions H2, H12, H18, H27, H28, H30, H41–H43; Net Worth E45, C51, E52; History; compressTable), spec 03 where dividends feed holdings, the Stage 1–2 code, and the local workbook (read with the workspace's SheetJS through `@joinr/importer`'s reader in scratch scripts under `artifacts/stage3/planner/`)._

> **This repo is PUBLIC.** Nothing from `reference/` (except `reference/brand/`) or `docs/private/` may be copied into any other file: no amounts, balances or rates, no tickers, coins or funds the owner holds, no account, bank, fund, person or business names, addresses, IPs, emails, Drive ids. Code, tests, seeds, fixtures and committed docs use only generic values: `ASX:ABC`, `ASX:XYZ`, `ASX:DEF`, `EXAMPLEFUND`, `BTC`/`ETH`, "Everyday account", "Loan to a friend", "Consulting", "Rent", round numbers. The owner-specific facts for this stage are in **`docs/private/stage-3-private.md`** (git-ignored): the engine, server-api, market-events and importer implementers, the spec reviewer, the code reviewer and the Verifier read it; nobody copies from it.
>
> **Golden tests never contain owner values:** they read every expected value from the local workbook at runtime and skip when it is absent (§9). **No snapshot files** (`toMatchSnapshot` & co.). The guard also blocks any committed path with a folder segment named `data`.

**Flow:** Coordinator pre-step (guard terms incl. rounded forms, §7.0) → **Scaffolder** (alone; must pass its done-check, §7.2) → 5 implementers in parallel (**engine**, **server-api**, **market-events** (the dividend-events market data), **importer**, **web phase A**) → **Integrator** (web phase B + e2e; starts when engine, server-api, market-events and importer have reported done, §7.8) → Reviewers in parallel (**spec-correctness**, **style-ux**, **code-quality/security**) → triage → **Fixer** → **Verifier**. At most 10 agents per workflow: the build workflow has 7 (Scaffolder, 5 implementers, Integrator), the review workflow 6 (3 reviewers, triage, Fixer, Verifier). **Nobody commits or pushes.** The coordinator commits at stage close with the owner's OK (D10).

**Golden values:** template cell references only (§9); the values are read from the workbook at runtime. TODAY()-dependent cells are compared at the workbook export date (`Net Worth!E52`), which the adapter reads from the workbook. **Template bug fixes applied in Stage 3:** §11. The owner has already answered four of them: fix 20 is confirmed and widened (D59), fixes 12 and 15 are accepted and fix 7 is vetoed (D61). The rest stay vetoable at the demo.

**Verified by the Planner against the workbook (2026-09-25, scratch scripts).** With the workbook's cached values and its as-of dates (`Net Worth!E52`, `C51`):
- The Cash-history engine reproduces **every** cached cell of **every** History row: Added Investments `L` (including the first row's windows and the live row), Monthly Savings `N`, Savings Rate `M` and Monthly Spend `P`, which always equals income − savings.
- The frozen History movement columns (`E`, `I`, `M`, `AI`) equal the net order value recomputed from the four ledgers over the snapshot windows, in every window including the first `(EDATE(first, −1), first]` and the live row. The savings engine can therefore take trades rather than the frozen movement columns.
- An engine that works from integer cents (as the importer stores the snapshots) stays within 1 cent of every cached money cell and within 1e-5 relative of every cached savings rate (§9.5).
- The Cash KPI panel `C17`–`C43` reproduces with the sheet's semantics (Net Worth `C51` as "now", the calendar year, the live row included); so do the house-deposit cells (`C45`–`C52`, documented for the D55 replacement) and the `C41` breakage (its INDIRECT column letters regress the wrong columns).
- Side Income `C3`–`C7` and the E/F period bounds of every row reproduce, including the unfilled current row counted as 0. (The live row's `F` is its month end; the app's provisional period ends at the as-of date instead, §9.3 rule 2.)
- The Budget chain reproduces: `B2`, `F2`, `D3`, `J4`, `L7`, `L9`, `C24`, `C28`, `C29`, `L11`, `M4` (the live row included), the per-item `B`/`D`/`E` columns and the payday-transfer list `A35:B` (first-appearance order, the per-frequency amounts).
- Dividends: the per-row `H`/`I`, the FY summary `K4:P11`, the rolling 12 months `K30:P41` (at `E52`), the per-ticker table `K45:R89` and SheetOptions `H28`/`H30`/`H27`/`H12` reproduce.
- Yahoo's chart API (two probes of a widely held ASX ETF the owner does not hold, saved under `artifacts/stage3/planner/`) returns dividend events (ex-date + per-unit amount) and daily closes in one request with `period1`/`period2`/`events=div`. Bar and event timestamps sit at 10:00 exchange time, so during daylight saving the **UTC date is one day early**; the exchange time zone (`meta.exchangeTimezoneName`) gives the right local date (§4.6).

Details, including which cells the sheet itself broke and how many rows each runtime rule catches, are in `docs/private/stage-3-private.md` §1–§3.

---

## 1. Overview & flow

### 1.1 What Stage 3 delivers
1. **`@joinr/engine`** (pure TypeScript, §2), additions:
   - Cash totals by account kind (D49 loans, offsets, available cash (D59), the D56 emergency-fund test).
   - The **savings engine** per snapshot period: sheet-faithful raw figures plus the app's adjusted figures (D51), a provisional current period, and the Cash KPIs on a FY or calendar year basis (D52), with the fixed 3-month trend.
   - Savings goals with a waterfall (D55).
   - Side income bucketed from dated deposits into snapshot periods, with FY and 365-day averages (D57, D53).
   - The live **Budget** engine (income, items, the yearly fund, the emergency fund, the automatic or manual split (D54), payday transfers, breakdowns); `budgetInvestment` keeps its signature and shares its code.
   - Dividends: FY and rolling-12-month summaries, per-holding FY table with DRP advice, and the Yahoo suggestion matcher (D50).
   - The cash-deficit wait (`SheetOptions!H12`) wired into the Stage 2 timing chain.
   - Purity hardening (timers, dynamic `import()`, `require`, `Math.random`, local-time and locale APIs).
2. **Schema** (§3): migration `0003_stage3_cashflow` (balance history, dated side-income deposits, savings adjustments, savings goals, the dividend-events cache, and the conversion of existing rows), one new setting key, the editable-settings list, request schemas, DTOs, error codes, fixtures and seed updates.
3. **Server** (§4): the Cash, Side Income, Budget and Dividends APIs with CRUD and the D34 origin rules; a settings PATCH endpoint; the dividend-events market service (Yahoo chart events + closes, a fake provider, a daily job); the live timing chain for the Stage 2 pages.
4. **Importer** (§3.5): writes dated deposits and one balance entry per account, keeps an account's kind across a re-import, reads a typed manual investment amount, and closes the Stage 1 D34 settings gap.
5. **Web** (§6): the `/cash`, `/side-income`, `/budget` and `/dividends` pages with forms, charts and phone layouts; the Stage 2 next-buy card and holding pages updated.
6. **Golden tests** (§9): engine goldens fed sheet-faithful inputs, and a server golden that goes import → DB → API.

### 1.2 Workspace changes (no new packages)
```
packages/schema/     + db tables (cashflow.ts, instruments.ts), rows, records, enums, settings (savings.yearBasis,
                       EDITABLE_SETTING_KEYS, isWorkbookSetting), src/dto/cashflow.ts, errors, dto/investments.ts
                       (timing additions), fixtures/cashflow.ts, coverage, seed, dump
packages/engine/     + src/{cash,savings,kpis,goals,sideIncome,budget,dividends,suggestions,periods,charts}.ts,
                       types.ts additions, test/** (+ test/golden/cashflow.*)
packages/importer/   writer.ts, reconcile.ts, extract.ts (Budget C28), model.ts; tests
apps/server/         + migrations/0003_stage3_cashflow.sql (+ meta), src/cashflow/**, src/market/dividends/**,
                       src/routes/{cash,sideIncome,budget,dividends,settings}.ts; edits: app.ts, investments/**,
                       db/queries/{domain,settings}.ts, records/index.ts, market/providers/{yahoo,fake}.ts,
                       market/service.ts (an optional shared cool-down, §4.6)
apps/web/            + src/pages/{cash,sideIncome,budget,dividends,cashflow}/**, api additions, typed routes;
                       edits: pages/investments/{NextBuyCard,HoldingDetailPage,display}.ts(x)
packages/ui/         + src/core/content/Meter.tsx (a progress meter; web phase A); additive props: `labelHidden`
                       on FieldFrame/MoneyField, `list` on TextField (§6.1)
e2e/                 + cashflow.spec.ts, cashflow-states.spec.ts, cashflow-mutations.spec.ts, cashflow-support.ts;
                       edits: ui-core.spec.ts, records.spec.ts, import.setup.ts, investments-support.ts
playwright.config.ts + the `cashflow-mutations` project
eslint.config.js     the engine purity rules (§2.1)
```

### 1.3 Dependencies (no third-party additions)
No package changes anywhere. Time-zone conversion uses Node's built-in `Intl.DateTimeFormat` (full ICU ships with Node 24); decimal arithmetic stays with decimal.js through `@joinr/schema`. pnpm 11 rules are unchanged: `allowBuilds` untouched, never `pnpm approve-builds`. **Only the Scaffolder may run `pnpm install`** (it should not need to). Implementers never edit a dependency list or the lockfile; stop and report instead.

### 1.4 Scripts
No new root scripts. Scoped commands used in this plan:
- `pnpm vitest run --project engine` (unit + golden) and `--project engine test/golden`
- `pnpm vitest run --project server test/cashflow`, `--project server test/market`, `--project server test/golden`
- `pnpm vitest run --project importer`
- `pnpm vitest run --project schema`
- `pnpm vitest run --project web src/pages/cash src/pages/sideIncome src/pages/budget src/pages/dividends`
- `pnpm vitest run --project ui` (the `Meter` and the additive field props)

### 1.5 Not in Stage 3 (deferred; the UI says so where it matters)
- **Stage 4:**
  - The other-assets, super and property engines. The current (provisional) period reads the imported other-asset purchase dates, super contributions, property purchase value, mortgage balance and principal paid, which stay static until Stage 4. The provisional row says "Other assets, super and the mortgage use the imported figures until Stage 4."
  - Bullion pricing for other assets.
- **Stage 5:**
  - Recording snapshots. The current period stays provisional until a month is recorded; the Cash page says "Recording a month arrives in Stage 5."
  - The monthly/quarterly/yearly aggregation API (the Stage 3 charts use `compressSeries`/`compressCashflow`; their yearly unit follows the year basis, D52, §2.13; the Stage 2 value charts keep calendar years until then).
  - The Settings page. Stage 3 pages edit only the settings they use (§3.3); the rest stay as imported.
  - The Net Worth dashboard, its savings-rate gauge and the rolling net-worth table.
- **Stage 6 polish:** loading skeletons, the keyboard and number-format audits, route-level code splitting, the chart gap step before a live point.
- **Not built:** franking credits, withholding tax, DRP auto-buy trades (D50); multi-currency accounts (D25: AUD only; the currency column stays `AUD`); account archiving (the column exists, not exposed); FY start other than 1 July; the house-price and deposit-% settings (kept in the DB, unused, D55); email/calendar reminders (D39); correcting past imported side income that includes loan principal repayments (D60: those deposits stay as imported, so re-import stays available; the D51 adjustment corrects savings only, and those periods' income stays slightly high). Nothing in Stage 3 changes an imported deposit's amount: the migration and the importer only turn period amounts into dated deposits (§3.1, §3.5), and no server or web step rewrites them (only an explicit owner edit on the Side Income page would, which D34 then counts as app data).

---

## 2. Engine spec (`@joinr/engine`)

### 2.1 Conventions (all engine code; Stage 2 §2.1 still applies)
| Concern | Rule |
|---|---|
| Purity | No I/O, no clock, no randomness, no timers, no host time zone or locale. `asOf` is always an input. |
| Imports | `@joinr/schema` **root** only. |
| Arithmetic | `JoinrDecimal` for money, units, prices and ratios; floats only inside XIRR. |
| Boundaries | Money in and out as integer cents; units and prices as normalised decimal strings; ratios with 12 significant digits; dates as `IsoDate`, months as `IsoMonth`. |
| Rounding | Compute in decimals, round **once** at the output, half away from zero. Sums of periods are Σ of the per-period rounded cents; averages and ratios come from unrounded decimals. |
| Nulls | A null input money cell counts as 0 inside a sum (the sheet's blank arithmetic); a null that makes a figure meaningless makes that figure null (documented per field). |
| Errors | Data problems give nulls or flags; `RangeError` only for programmer errors (malformed decimals or dates). |

**Purity hardening (deferred from Stage 2).**
- ESLint (`eslint.config.js`, `packages/engine/src/**/*.ts`, Scaffolder), added to the Stage 2 `no-restricted-syntax` list, each with a message pointing here:
  - `CallExpression[callee.name=/^(setTimeout|setInterval|setImmediate|queueMicrotask|require)$/]`
  - `ImportExpression` (dynamic `import()`)
  - `MemberExpression[object.name='Math'][property.name='random']`, `MemberExpression[object.name='crypto']`, `MemberExpression[object.name='performance']`, `Identifier[name='globalThis']`, `MemberExpression[object.name='Intl']`
  - `MemberExpression[object.name='Date'][property.name='parse']`
  - `CallExpression[callee.property.name=/^(getFullYear|getMonth|getDate|getDay|getHours|getMinutes|getSeconds|getMilliseconds|getTimezoneOffset|setFullYear|setMonth|setDate|setHours|setMinutes|setSeconds|setMilliseconds|toLocaleString|toLocaleDateString|toLocaleTimeString)$/]` (local-time and locale APIs; the engine uses the `getUTC*`/`setUTC*` forms).
- `test/purity.test.ts` (engine owner) scans `src/**` for the same list on top of the Stage 2 list, **after stripping `//` and `/* */` comments** (a string-aware strip), with regexes that need a call or member access: `/\b(setTimeout|setInterval|setImmediate|queueMicrotask|require)\s*\(/`, `/\bimport\s*\(/`, `/\bMath\.random\b/`, `/\bcrypto\.[A-Za-z_$]/`, `/\bperformance\.[A-Za-z_$]/`, `/\bglobalThis\b/`, `/\bIntl\.[A-Za-z_$]/`, `/\bDate\.parse\b/`, the local accessors as `/\.(getFullYear|…|toLocaleTimeString)\s*\(/`. A test proves each pattern is detected on a one-line sample, and that a comment containing a banned word (e.g. "… uses no crypto." or "// setTimeout(") is **not** a hit.

### 2.2 Public API (FROZEN — additions to `packages/engine/src/types.ts` + `src/index.ts`)
The Scaffolder appends every type below to `types.ts`, adds a stub throwing `new Error('engine: not implemented')` for every new function to `index.ts`, adds the new members to `EngineApi` and the `engine` value, and adds `CASHFLOW_ENGINE_IMPLEMENTED = false` (the engine owner sets it `true` only after its full Stage 3 unit suite passes; it gates the server's Stage 3 integration, route and golden tests, §7.4). `ENGINE_IMPLEMENTED` stays `true`. Names, fields and signatures below do not change; internal modules are free. The compile and expectation fixes these additions force in Stage 2 files (the server's fake engine, the engine's API member test) are the Scaffolder's (§7.1).

```ts
import type {
  BudgetItemKind, CashAccountKind, ChartDateUnit, DecimalString, DividendSuggestionStatus, DrpAdvice,
  InstrumentKind, IsoDate, IsoMonth, KpiTrend, PayFrequency, SavingsPeriodStatus, YearBasis,
} from '@joinr/schema';

// ─── Stage 2 types changed additively (optional fields appended) ───────────────────────────────
// BudgetInvestInput.items is unchanged (the emergency-fund basis keeps every item row, D61, §2.9)
// BudgetInvestInput.cashCents doc: "the cash the emergency-fund test compares (cashTotals.emergencyFundTestCents)"
// InvestCountdownFn input gains: cashDeficitMonths?: number | null    // §2.12 (H12)
// CompressSeriesFn gains an optional 5th parameter: yearBasis?: YearBasis (default 'calendar', so every
//   Stage 2 caller is unchanged; the yearly unit then groups by yearWindow(date, yearBasis), §2.13)

// ─── Cash accounts (§2.4) ──────────────────────────────────────────────────────────────────────
export interface EngineCashAccount { id: number; kind: CashAccountKind; isOffset: boolean; balanceCents: Cents }
export interface CashTotalsResult {
  totalCashCents: Cents;                                   // Σ non-offset accounts (Cash!C13; D49 loans included)
  byKind: Readonly<Record<CashAccountKind, Cents>>;        // non-offset subtotals
  offsetCents: Cents;                                      // Σ offset accounts (never in Total Cash)
  loansCents: Cents;                                       // = byKind.loan_receivable
  availableCashCents: Cents;                               // total − loans (the "Available cash" figure; D59: the
                                                           //   EF test, goals, cash target and EOY goal use it)
  emergencyFundTestCents: Cents;                           // (loansCountForEmergencyFund ? total : available)
                                                           //   + (offsetsIncludeEmergencyFund ? offsets : 0) (D59, §11 fix 20, D56)
}

// ─── Savings engine (§2.5) ─────────────────────────────────────────────────────────────────────
export interface SavingsSnapshotInput {                    // one per snapshot (History row), any order
  periodMonth: IsoMonth; runDate: IsoDate;
  cashValueCents: Cents | null;                            // History N
  superContribCents: Cents | null;                         // History R
  salaryMonthlyCents: Cents | null;                        // History W
  propertyPurchaseCents: Cents | null;                     // History Y
  mortgageBalanceCents: Cents | null;                      // History AB (≤ 0)
  mortgagePrincipalPaidCents: Cents | null;                // History AD (cumulative)
}
export interface SavingsLiveInput {                        // the provisional period's live values
  cashCents: Cents;                                        // Total Cash now (cashTotals.totalCashCents; loans in, D59)
  salaryMonthlyCents: Cents | null;                        // monthlyPayCents(current pay settings) (§4.5)
  superContribCents: Cents;                                // voluntary contributions for months after the latest snapshot's (§4.5)
  propertyPurchaseCents: Cents | null; mortgageBalanceCents: Cents | null; mortgagePrincipalPaidCents: Cents | null;
}
export interface SavingsInput {
  asOf: IsoDate;
  snapshots: readonly SavingsSnapshotInput[];
  live: SavingsLiveInput | null;                           // null → no provisional period
  trades: readonly EngineTrade[];                          // every trade of every kind (added investments)
  otherAssetPurchases: readonly { date: IsoDate; amountCents: Cents }[];
  sideIncome: readonly { date: IsoDate; amountCents: Cents }[];          // deposits (D57)
  dividends: readonly EngineDividend[];                    // income (§2.5 step 5)
  adjustments: readonly { periodMonth: IsoMonth; amountCents: Cents }[]; // D51
  includeMortgagePrincipal: boolean;                       // savings.includeMortgagePrincipal (null → true)
}
export interface SavingsFigures {
  incomeCents: Cents | null; savingsCents: Cents | null; savingsRatio: DecimalString | null; spendCents: Cents | null;
}
export interface SavingsPeriod {
  periodMonth: IsoMonth; runDate: IsoDate;                 // provisional: runDate = asOf
  after: IsoDate | null; through: IsoDate;                 // the window (after, through]; the first period: after = null
  status: SavingsPeriodStatus;                             // 'first' | 'closed' | 'provisional'
  cashCents: Cents | null;
  cashGainCents: Cents | null;                             // Cash J
  cashGainRatio: DecimalString | null;                     // Cash K
  addedInvestmentsCents: Cents | null;                     // Cash L (null for the first period)
  added: { tradesCents: Cents; otherAssetsCents: Cents; superCents: Cents; mortgagePrincipalCents: Cents;
    propertyDepositCents: Cents } | null;
  income: { salaryCents: Cents | null; sideIncomeCents: Cents; cashDividendsCents: Cents; otherDividendsCents: Cents } | null;
  adjustmentCents: Cents;                                  // 0 when none
  raw: SavingsFigures;                                     // as the sheet computes (Cash M, N, P)
  adjusted: SavingsFigures;                                // the app's figures (D51 + §11 fixes 12, 19)
}
export interface SavingsResult { periods: SavingsPeriod[] }   // run-date order; the provisional period last

// ─── Cash KPIs (§2.6) ──────────────────────────────────────────────────────────────────────────
export interface CashKpisInput {
  asOf: IsoDate; periods: readonly SavingsPeriod[]; yearBasis: YearBasis; jobStartDate: IsoDate | null;
  currentCashCents: Cents;                                 // available cash now (cashTotals.availableCashCents; D59, §2.6)
  eoyCashGoalCents: Cents | null; cashSavingsTargetCents: Cents | null;
}
export interface YearWindow { basis: YearBasis; start: IsoDate; end: IsoDate; year: number }   // [start, end); year = FY start year or calendar year
export interface CashKpisResult {
  anchor: IsoDate | null;                                  // the latest recorded snapshot's run date (Net Worth C51)
  year: YearWindow;                                        // containing the anchor (asOf when none)
  lastPeriod: { periodMonth: IsoMonth; runDate: IsoDate; cashGainCents: Cents | null; savingsCents: Cents | null;
    savingsRatio: DecimalString | null; rawSavingsRatio: DecimalString | null } | null;          // C17, C18, C37
  avgWindow: { from: IsoDate; periods: number } | null;    // the 12-month averaging window
  avgCashGainCents: Cents | null;                          // C19 (closed periods only)
  avgCashGainAdjustedCents: Cents | null;                  // mean of (cash gain − adjustment)
  avgAddedInvestmentsCents: Cents | null;
  avgSavingsCents: Cents | null;                           // C20 (adjusted)
  avgSavingsRawCents: Cents | null;
  predictedCashPerYearCents: Cents | null;                 // C22 = avgCashGainAdjusted × 12 (§2.6)
  yearCashGainCents: Cents; yearSavingsCents: Cents; yearAddedInvestmentsCents: Cents;   // C21, C42, C43
  yearIncomeCents: Cents; yearPeriods: number;
  yearSavingsRatio: DecimalString | null;                  // C38 fixed: Σ savings / Σ income (adjusted)
  yearSavingsRawRatio: DecimalString | null;
  last3SavingsRatio: DecimalString | null;                 // C39 (closed)
  trendPerMonth: DecimalString | null;                     // C41 fixed: ratio change per month
  trend: KpiTrend | null;                                  // C40
  monthsToYearEnd: number | null;
  eoyProjectedCashCents: Cents | null;                     // C24
  eoyGapPerMonthCents: Cents | null;                       // C27 fixed (÷ months left); positive = surplus
  eoyOnTarget: boolean | null;                             // C25
  cashTarget: { targetCents: Cents; progressRatio: DecimalString; monthsToTarget: number | null;
    arrival: IsoDate | null; status: 'reached' | 'on_track' | 'no_savings' } | null;      // C30–C34
  spend6mCents: Cents | null; spend6mRawCents: Cents | null; spend6mPeriods: number;       // Budget M4
}

// ─── Savings goals (§2.7, D55) ────────────────────────────────────────────────────────────────
export interface SavingsGoalsInput {
  anchor: IsoDate;                                         // cashKpis.anchor ?? asOf
  goals: readonly { id: number; targetCents: Cents; targetDate: IsoDate | null }[];   // waterfall order
  goalsCashCents: Cents;                                   // the cash base: available cash (D59; the server's rule, §4.5)
  emergencyFundCents: Cents | null;
  investmentsValueCents: Cents;                            // Σ ETF, stock, fund and crypto values (priced)
  investmentShareRatio: DecimalString | null;              // goals.houseDepositInvestmentShare (null → 0)
  avgCashGainAdjustedCents: Cents | null; avgAddedInvestmentsCents: Cents | null;
}
export interface SavingsGoalResult {
  id: number; allocatedCents: Cents; remainingCents: Cents; progressRatio: DecimalString; reached: boolean;
  monthsToGo: number | null; eta: IsoDate | null; onTrack: boolean | null; requiredPerMonthCents: Cents | null;
}
export interface SavingsGoalsResult { savedCents: Cents; monthlyProgressCents: Cents | null; goals: SavingsGoalResult[] }

// ─── Side income (§2.8, D57) ──────────────────────────────────────────────────────────────────
export interface SideIncomeInput {
  asOf: IsoDate;
  snapshots: readonly { periodMonth: IsoMonth; runDate: IsoDate }[];
  deposits: readonly { id: number; streamId: number; date: IsoDate; amountCents: Cents }[];
}
export interface SideIncomePeriodResult {
  periodMonth: IsoMonth; start: IsoDate; end: IsoDate;    // [start, end] (inclusive dates, the sheet's E/F)
  status: 'closed' | 'provisional'; totalCents: Cents;
  byStream: { streamId: number; amountCents: Cents }[]; depositIds: number[];
}
export interface SideIncomeResult {
  periods: SideIncomePeriodResult[];                       // oldest first; the provisional period last
  beforeFirstCents: Cents; afterAsOfCents: Cents;          // deposits outside every period
  fy: { financialYear: number; start: IsoDate; end: IsoDate };
  avgPerPeriodThisFyCents: Cents | null; periodsThisFy: number;   // C3 fixed
  fyToDateCents: Cents;                                           // C4 fixed
  projectedYearCents: Cents | null;                               // C5 = C3 × 12 (SheetOptions H27)
  avg365Cents: Cents | null; periods365: number;                  // C6 fixed
  lifetimeCents: Cents;                                           // C7
  byStreamLifetime: { streamId: number; amountCents: Cents }[];
}

// ─── Budget (§2.9) ─────────────────────────────────────────────────────────────────────────────
export interface BudgetRowInput {
  id: number | null; kind: BudgetItemKind; name: string | null; monthlyCents: Cents | null;
  category: string | null; accountId: number | null; accountName: string | null;
}
export interface BudgetInput extends Omit<BudgetInvestInput, 'items' | 'yearlyExpenseAnnualCents'> {
  rows: readonly BudgetRowInput[];                         // display order: items and the auto rows
  yearlyExpenses: readonly { id: number; name: string; annualCents: Cents }[];
}
export interface BudgetRowResult {
  id: number | null; kind: BudgetItemKind; name: string | null;
  monthlyCents: Cents;                                     // auto rows computed; a null item → 0
  incomeShareRatio: DecimalString | null;                  // B
  weeklyCents: Cents; yearlyCents: Cents;                  // D, E
  category: string | null; accountId: number | null; accountName: string | null;
  savingsLine: boolean; derived: boolean; manual: boolean; // derived: auto rows; manual: auto_invest with the split off (D54)
}
export interface BudgetTransferResult { accountId: number | null; accountName: string | null; perPayCents: Cents;
  monthlyCents: Cents; rows: number }
export interface BudgetResult {
  invest: BudgetInvestResult;                              // the shared D40 chain (B2, C24, J4, L7, D3, H41–H43, C28, C29, H2)
  annualIncomeCents: Cents | null;                         // F2
  yearlySavingsCents: Cents | null;                        // L9
  plannedSavingsRatio: DecimalString | null;               // L11
  unallocatedCents: Cents | null;                          // leftover − investment row − cash row (the $10 rounding); null without a leftover
  emergencyFundBasisCents: Cents;                          // Σ every item row (savings lines included) + yearly fund:
                                                           //   the sheet's D3 basis (D61), so it equals the planned spend
  rows: BudgetRowResult[];
  yearlyExpenses: { id: number; name: string; annualCents: Cents; monthlyCents: Cents }[];
  transfers: BudgetTransferResult[];                       // A35:B, first-appearance order
  unassigned: { perPayCents: Cents; monthlyCents: Cents; rows: number };
  perPayTotalCents: Cents | null;
  byCategory: { category: string | null; monthlyCents: Cents }[];
  investManual: boolean;                                   // D54
}

// ─── Dividends (§2.10) and suggestions (§2.11) ────────────────────────────────────────────────
export interface DividendHoldingInput {
  instrumentId: number; kind: InstrumentKind; dividendFreqMonths: number | null; drp: boolean | null;
  unitsNow: DecimalString;                                 // HoldingResult.netUnits
}
export interface DividendsInput {
  asOf: IsoDate; holdings: readonly DividendHoldingInput[];
  trades: readonly EngineTrade[]; dividends: readonly EngineDividend[];
}
export interface DividendFyRow { financialYear: number; byKind: Readonly<Record<InstrumentKind, Cents>>; totalCents: Cents }
export interface DividendMonthRow { month: IsoMonth; byKind: Readonly<Record<InstrumentKind, Cents>>; totalCents: Cents }
export interface DividendHoldingFyResult {
  instrumentId: number; kind: InstrumentKind; netThisFyCents: Cents; payments: number;
  frequencyMonths: number | null; drp: boolean | null;
  yield365Ratio: DecimalString | null;                     // Dividends O
  monthsToExtraUnit: number | null;                        // Dividends N
  advice: DrpAdvice | null;                                // Dividends R
}
export interface DividendsResult {
  rows: DividendResult[];                                  // one per input dividend, input order (Stage 2 §2.9 rule)
  byFinancialYear: DividendFyRow[];                        // newest first; asOf's FY and the 4 before it (zero rows kept),
                                                           //   plus every older FY that has a payment (§2.10)
  rolling12: DividendMonthRow[];                           // oldest first; the 12 calendar months ending with asOf's month
  holdingsThisFy: DividendHoldingFyResult[];               // net desc, then instrumentId
  unlinkedThisFyCents: Cents;
  kpis: { financialYear: number; thisFyCents: Cents; lastFyCents: Cents; allTimeCents: Cents; rolling12Cents: Cents;
    reinvestedThisFyCents: Cents; daysIntoFy: number; projectedFyCents: Cents | null };   // SheetOptions H30, H28
}
export interface DividendEventInput {
  instrumentId: number; exDate: IsoDate; amountPerUnit: DecimalString; currency: string;
  closeBeforeEx: DecimalString | null; dismissed: boolean;
}
export interface DividendSuggestionResult {
  instrumentId: number; exDate: IsoDate; amountPerUnit: DecimalString; unitsAtEx: DecimalString;
  estimatedNetCents: Cents; priceAtEx: DecimalString | null; yieldRatio: DecimalString | null;
  expectedPaymentDate: IsoDate; status: DividendSuggestionStatus;
}

// ─── Charts (§2.13) ────────────────────────────────────────────────────────────────────────────
export interface CashflowChartPoint {
  label: string; period: IsoMonth; date: IsoDate; live: boolean;
  cashCents: Cents | null; cashGainCents: Cents | null; addedInvestmentsCents: Cents | null; adjustmentCents: Cents;
  savingsCents: Cents | null; savingsRawCents: Cents | null; incomeCents: Cents | null;
  savingsRatio: DecimalString | null; savingsRawRatio: DecimalString | null; trendRatio: DecimalString | null;
}

// ─── Functions (FROZEN signatures) ────────────────────────────────────────────────────────────
export function cashTotals(i: { accounts: readonly EngineCashAccount[]; offsetsIncludeEmergencyFund: boolean;
  loansCountForEmergencyFund: boolean }): CashTotalsResult;                  // the server passes false (D59, §11 fix 20, §4.5)
export function monthlyPayCents(i: { netPayCents: Cents | null; payFrequency: PayFrequency | null }): Cents | null;
  // net pay × the template's pay-frequency factor (the same factors budgetInvestment uses); null when either is null
export function computeSavings(input: SavingsInput): SavingsResult;
export function cashKpis(input: CashKpisInput): CashKpisResult;
export function savingsGoals(input: SavingsGoalsInput): SavingsGoalsResult;
export function computeSideIncome(input: SideIncomeInput): SideIncomeResult;
export function computeBudget(input: BudgetInput): BudgetResult;
export function budgetInvestInputOf(input: BudgetInput): BudgetInvestInput;   // the timing chain's exact input
export function computeDividends(input: DividendsInput): DividendsResult;
export function dividendSuggestions(i: { asOf: IsoDate; events: readonly DividendEventInput[];
  trades: readonly EngineTrade[]; dividends: readonly EngineDividend[] }): DividendSuggestionResult[];
export function cashDeficitMonths(i: { cashCents: Cents; liquidTotalCents: Cents; targetRatio: DecimalString | null;
  avgMonthlySavingsCents: Cents | null }): number | null;
export function compressCashflow(i: { periods: readonly SavingsPeriod[]; unit: ChartDateUnit;
  count: number | null; yearBasis: YearBasis }): CashflowChartPoint[];
export function yearWindow(date: IsoDate, basis: YearBasis): YearWindow;
export const CASHFLOW_ENGINE_IMPLEMENTED: boolean;         // Scaffolder: false; engine sets true (§7.3)
// EngineApi gains: cashTotals, monthlyPayCents, computeSavings, cashKpis, savingsGoals, computeSideIncome,
// computeBudget, budgetInvestInputOf, computeDividends, dividendSuggestions, cashDeficitMonths, compressCashflow,
// yearWindow (13; named *Fn aliases, as Stage 2). The `engine` value gains the same members.
```

### 2.3 Periods, windows and years (shared rules)
- **Snapshots** are sorted by run date. Period *i* ≥ 1 has the window `(run_{i−1}, run_i]`; every dated input (trades, other-asset purchases, deposits, dividends by payment date) is bucketed by that half-open window.
- **The first snapshot is the baseline** (`status 'first'`): cash only; its cash gain, added investments and savings figures are null (the sheet shows "-" or 0 there, §11 fix 18).
- **The provisional period** exists when `live` is given, at least one snapshot exists and `asOf > lastRun`: window `(lastRun, asOf]`, `runDate = asOf`, `status 'provisional'`. Its `periodMonth` is `isoMonthOf(asOf)` unless a snapshot already has that month, in which case it is the month after the latest snapshot's `periodMonth`. Inputs dated after `asOf` belong to no period. Because this month label can change (at a month change, or when Stage 5 records the month), **adjustments attach to closed periods only and notes to recorded periods only** (the server refuses the provisional month, §4.5; the web hides the actions there, §6.3).
- **Side-income periods (D57)** use the same windows except the first, which is the calendar month of the first snapshot up to its run date: `[first day of run₀'s month, run₀]` (the sheet's E2 = F2 − DAY(F2) + 1). A later period *i* has `start = run_{i−1} + 1 day`, `end = run_i` (the sheet's E/F). The provisional side-income period is `[lastRun + 1 day, asOf]` (the sheet's live row ends at its month end instead; §9.3 rule 2).
- **`yearWindow(date, basis)`:** `fy` → `[YYYY-07-01, (YYYY+1)-07-01)` containing `date`, `year` = the start year; `calendar` → `[YYYY-01-01, (YYYY+1)-01-01)`.
- **Month counts** use DATEDIF "M": `months(from, to) = (ty − fy) × 12 + (tm − fm) − (td < fd ? 1 : 0)`. **EDATE** is `addMonthsIso` (clamping).
- **Closed periods** are those with `status 'closed'`; the averages, year sums and trends use closed periods only (§11 fix 14).

### 2.4 Cash accounts and totals (`cashTotals`; D49, D56, D59)
- `totalCashCents` = Σ balances of **non-offset** accounts, every kind (bank, credit card with its negative balance, `loan_receivable`, other). This is `Cash!C13` and the net-worth cash. Loans stay in (D49), so a principal repayment is a balance move that nets to zero.
- `offsetCents` = Σ offset accounts; never in Total Cash (the sheet's SUMIFS on the Offset flag).
- `availableCashCents` = total − `loan_receivable` balances (money lent out is not available).
- **Where each figure is used (D59):** loans you've made count **only** in Total Cash, net worth (the cash class of the allocation, so also the §2.12 cash-deficit wait) and the savings engine (§2.5). Everything that asks "how much cash do I have to fall back on or to reach a goal" uses **available cash**: the emergency-fund test (below), the savings goals' "saved so far" (§2.7), the cash savings target and the end-of-year cash goal (§2.6).
- `emergencyFundTestCents` = (`loansCountForEmergencyFund` ? total : available) + (setting `property.offsetsIncludeEmergencyFund` ? offsets : 0) (D56). The server passes `loansCountForEmergencyFund = false` from one constant (D59, owner-confirmed; §11 fix 20). The parameter stays so the engine is general (its tests cover both values), and the DTO reports it so the web copy follows (§4.4).
- The emergency-fund test is **`emergencyFundTestCents < emergencyFundCents`**. It drives: the cash-first advice (`considerNext.cashCents`), the budget's 100%-to-cash rule (`BudgetInvestInput.cashCents`) and the Cash page's emergency-fund tile. The server passes the same value to all three.

### 2.5 The savings engine (`computeSavings`)
For each period (steps for closed and provisional periods; the first period stops after step 1):
1. **Cash:** `cashCents` = the snapshot's cash (provisional: `live.cashCents`).
2. **Cash gain** (J) = cash − the previous period's cash; null when either is null. **Cash gain %** (K) = gain / previous cash; null when the previous cash is 0 or null.
3. **Added investments** (L), each part in cents from decimals, rounded once at the total:
   - trades: Σ `units × price` of every trade of every kind in the window (sells negative, fees excluded); this equals the frozen History `E + I + M + AI` (verified);
   - other assets: Σ purchases dated in the window (`(units − sold) × unit cost`, AUD rows; the server's rule, §4.5);
   - super: the snapshot's `superContribCents` (provisional: `live.superContribCents`); null → 0;
   - mortgage principal: `includeMortgagePrincipal ? AD_i − AD_{i−1} : 0` (nulls → 0);
   - property deposit: when the purchase value changed (`Y_i ≠ Y_{i−1}`), `(Y_i − Y_{i−1}) + (AB_i − AB_{i−1})`, else 0.
4. **Adjustment** (D51) = the adjustment whose `periodMonth` equals the period's (0 when none; the first period ignores it).
5. **Income:**
   - salary = the snapshot's `salaryMonthlyCents` (provisional: `live.salaryMonthlyCents`); null counts as 0;
   - side income = Σ deposits dated in the window;
   - `cashDividendsCents` = Σ net of dividends paid in the window with `reinvested === false` (the sheet's `E = "No"`); `otherDividendsCents` = the rest (reinvested or unknown).
   - **raw** income = salary + side income + cash dividends; **adjusted** income = raw + other dividends (§11 fix 12, accepted: D61).
6. **raw** (the sheet: Cash M, N, P): savings = cash gain + added; ratio = savings / income; spend = income − savings.
7. **adjusted:** savings = raw savings − adjustment; ratio = savings / adjusted income; spend = adjusted income − savings.
8. Nulls: savings null when the cash gain is null; ratio and spend null when income ≤ 0 or savings is null (§11 fix 19: spend is `income − savings`, never `N × (1/M − 1)`).

The snapshots' stored movement and cash-gain columns are **not** read: the engine recomputes movements from trades (so corrections and in-app trades count) and the gain from stored cash. The stored columns stay as imported (Stage 5 compares them).

### 2.6 Cash KPIs (`cashKpis`, D52, D59)
Figures are computed from `adjusted` unless the field says raw; every cash projection (C22, C24, C27, the cash target) uses **`avgCashGainAdjustedCents`**, so a one-off inflow the owner has adjusted is not extrapolated (D51). The goldens feed no adjustments, so there the adjusted average equals the sheet's C19 recomputation. `anchor` = the latest recorded snapshot's run date (a closed or the first period; the sheet's `Net Worth!C51`); null without snapshots, when only `currentCash`-based fields are non-null. `year = yearWindow(anchor ?? asOf, yearBasis)`.

**Available cash for the cash goals (D59).** `currentCash` is **available cash** now (the server passes `cashTotals.availableCashCents`): the end-of-year projection, gap and on-target flag (C24–C27) and the cash target (C30–C34) start from it. **The monthly rate stays `avgCashGainAdjustedCents`,** the mean gain in **total** cash (after D51 adjustments) over the closed periods of the window, because the snapshots record total cash only. That is the right rate: a loan principal repayment (or new lending) moves money between a loan and a bank account without changing total cash, so the total-cash gain is the cash actually saved each month. Every past loan movement is already in today's available cash; the projections assume the loans' balances stay as they are from here (a repayment would only bring the dates forward). `predictedCashPerYearCents` is a rate (no starting balance), so D59 does not touch it. In the sheet every account is a bank account, so available cash equals `Cash!C13` and the goldens reproduce the sheet (§9.1).
| Field | Rule (sheet cell) |
|---|---|
| `lastPeriod` | the last closed period (C17 cash gain, C18 savings, C37 rate). The sheet took its live row. |
| `avgWindow` | closed periods with `runDate ≥ max(anchor − 365 days, jobStartDate)` (C19/C20 criteria; `jobStartDate` null → no floor) |
| `avgCashGainCents` | mean cash gain over the window (C19) |
| `avgCashGainAdjustedCents` | mean of (cash gain − adjustment) over the window |
| `avgAddedInvestmentsCents` | mean added investments over the window |
| `avgSavingsCents` / `…RawCents` | mean adjusted / raw savings over the window (C20) |
| `predictedCashPerYearCents` | `avgCashGainAdjusted × 12` (C22) |
| `yearCashGainCents`, `yearSavingsCents`, `yearAddedInvestmentsCents`, `yearIncomeCents`, `yearPeriods` | Σ over closed periods with `runDate ∈ year` (C21, C42, C43) |
| `yearSavingsRatio` | `Σ savings / Σ income` over those periods (C38; income-weighted, §11 fix 15, accepted: D61); raw alongside |
| `last3SavingsRatio` | mean rate of the last 3 closed periods with a rate (C39) |
| `trendPerMonth` | least-squares slope of the rate against the run date (in days) over those same ≤ 3 points, × 365.25/12; null with fewer than 2 points or one distinct date (C41 fixed, §11 fix 1) |
| `trend` | `increasing` (> 0), `decreasing` (< 0), `flat` (= 0) (C40) |
| `monthsToYearEnd` | `months(anchor, year.end)` |
| `eoyProjectedCashCents` | `monthsToYearEnd × avgCashGainAdjusted + currentCash` (C24; `currentCash` = available cash, D59) |
| `eoyGapPerMonthCents` | `(projected − goal) / max(1, monthsToYearEnd)` (C27, §11 fix 2); null without a goal |
| `eoyOnTarget` | `projected ≥ goal` (C25) |
| `cashTarget` | progress = current (available cash, D59) / target (C34); `reached` when current ≥ target (checked first, even while not saving: §11 fix 24); else `on_track` with `monthsToTarget = ceil((target − current) / avgCashGainAdjusted)` and `arrival = EDATE(anchor, months)` when `avgCashGainAdjusted > 0` (C30, C33); else `no_savings` |
| `spend6m*` | mean adjusted / raw spend of closed periods with `runDate > anchor − 185 days` (Budget M4) |

### 2.7 Savings goals (`savingsGoals`, D55, D59)
- `savedCents = max(0, goalsCash − (emergencyFund ?? 0)) + round(share × investmentsValue)`, share = `investmentShareRatio ?? 0`. The sheet dropped the investment share entirely while cash was below the emergency fund; the app keeps it (§11 fix 3). **`goalsCashCents` is available cash** (D59: total cash minus loans you've made; owner-confirmed, refining D55's "total cash"); the server passes it through one constant, `GOALS_CASH_BASIS = 'available'` (§4.5).
- **Waterfall** in list order: `allocated_k = min(target_k, remaining)`, `remaining −= allocated_k`; `progress = allocated / target`; `reached = allocated ≥ target`.
- `monthlyProgressCents = avgCashGainAdjusted + round(share × avgAddedInvestments)` (the part of average monthly savings that feeds the goals; the cash part is the total-cash gain, as for the cash goals, §2.6); null when the cash-gain average is null.
- For an unreached goal k: `monthsToGo = ceil((Σ_{j≤k} target_j − saved) / monthlyProgress)` when progress > 0, `eta = EDATE(anchor, monthsToGo)`; else null.
- `onTrack` = null without a target date; else `reached || (eta ≤ targetDate)`. `requiredPerMonthCents` = `ceil((Σ_{j≤k} target_j − saved) / max(1, months(anchor, targetDate)))` for an unreached goal with a date, else null.
- No hard-coded 65 % (the sheet's C50/C51). The imported house-price and deposit-% settings are not read (D55).

### 2.8 Side income (`computeSideIncome`, D57)
- Periods per §2.3; each deposit lands in exactly one period, or in `beforeFirstCents` / `afterAsOfCents`.
- `fy` = the FY of `asOf` (side income is always FY-based, D52).
- `avgPerPeriodThisFyCents` = mean total of **closed** periods whose `start` is in the FY (C3; the sheet also counted its unfilled current row as 0, §11 fix 5); `projectedYearCents` = that × 12 (C5, SheetOptions H27).
- `fyToDateCents` = Σ deposits **dated** in `[fy.start, fy.end)` and `≤ asOf`, provisional ones included (C4; the sheet summed periods by start date with an upper bound of 1 January after the FY end, §11 fix 6). Deposits dated after `asOf` count only in `afterAsOfCents`.
- `avg365Cents` = mean total of closed periods with `start > asOf − 365 days` (C6, the Budget's "include side income" figure, D53).
- `lifetimeCents` = Σ every deposit (C7).
- The server feeds `budgetInvestment.sideIncomePeriods` with the **closed** periods (`periodStart = start`, `periodEnd = end`, `amountCents = totalCents`), so the budget, the D40 amount and this page agree (a test asserts `budgetInvestment`'s 365-day figure equals `avg365Cents`).

### 2.9 Budget (`computeBudget`, `budgetInvestInputOf`; D53, D54, D61)
`budgetInvestInputOf(input)` maps `rows` to `items` (`{ kind, monthlyCents }`) and `yearlyExpenses` to `yearlyExpenseAnnualCents`; `computeBudget` calls `budgetInvestment(budgetInvestInputOf(input))` and adds the page figures. `budgetInvestment` keeps its Stage 2 signature and its twelve steps with two changes:
- **Step 5 (emergency fund) is unchanged** (D61, §11 fix 7 vetoed): the basis stays the sheet's `D3 = ROUNDUP(months × SUM(C8:C26) / 1000, 0) × 1000` over **every** `item` row, savings lines included (the EF top-up itself counts), plus the yearly fund, i.e. the planned spend; the Stage 2 range fix (every item row, not rows 8–26: Stage 2 §11 fix 15, D48) still applies. The override still wins.
- **Step 9 (D54):** with the automatic split off, `investmentRow` = the `auto_invest` row's `monthlyCents ?? 0` (a typed amount), no longer 0. Step 10 is unchanged: `cashRow = ROUNDDOWN((leftover − investmentRow) / 10) × 10`, which can go negative when the typed amount exceeds the leftover (the web warns).
- **Step 8:** `cashCents` is the emergency-fund-test cash (§2.4: available cash, D59, plus offsets when D56 is on).

`computeBudget` also returns:
- **Rows** in input order. Auto rows: `auto_yearly` = the yearly fund, `auto_invest` = the investment row (`manual` when the split is off), `auto_cash` = the cash row; `derived = true`. A missing auto row is still returned (id null, name null). `savingsLine` marks an `item` whose category, trimmed and case-insensitive, is `Savings` (the template's category for the EF top-up and big-purchase lines); it is a display flag only (the "Savings" pill, §6.5) and changes no figure (D61). `incomeShareRatio = monthly / monthlyIncome` (null when income is null or 0); `weeklyCents = round(monthly / 4.34523783659)`; `yearlyCents = monthly × 12`.
- **Yearly expenses** with `monthlyCents = round(annual / 12)` (G).
- `annualIncomeCents` = income × 12 (F2); `yearlySavingsCents` = leftover × 12 (L9); `plannedSavingsRatio = (investmentRow + cashRow) / income` (L11, automatic rows only, as the sheet); `emergencyFundBasisCents` = the step 5 basis (the planned spend, D61); `unallocatedCents = leftover − investmentRow − cashRow` (the cash row's $10 rounding; negative when a D54 amount exceeds the leftover), so the page's leftover table adds up (§6.5).
- **Transfers** (A35:B): rows grouped by `accountId`, or by `accountName` when unlinked (a stale name stays visible); grouped in first-appearance order. Per pay from the group's Σ monthly (unrounded): monthly `Σ`, twice-monthly `Σ × 0.5`, weekly `Σ / 4.34523783659`, fortnightly `2 × Σ / 4.34523783659`, four-weekly `4 × Σ / 4.34523783659`, rounded once. Rows with no account at all go to `unassigned` (§11 fix 17). `perPayTotalCents` = Σ groups + unassigned (null without a pay frequency).
- **byCategory:** Σ monthly by category over rows with monthly > 0, amount descending (null category last).

### 2.10 Dividends (`computeDividends`)
- `rows`: the Stage 2 §2.9 per-payment rule for every dividend of every kind (`unitsAtEx` from the instrument's own trades dated before the ex-date; `yield = net / (priceAtEx × unitsAtEx)`), one implementation shared with `computeInvestments`.
- `byFinancialYear`: by payment date, per holding kind (linked or not), newest first: **always `asOf`'s FY and the four FYs before it** (zero rows kept, as the sheet's K4:K8 always shows five FY labels), plus every older FY that has a payment. The first five rows, reversed, are K4:K8 (K4 the oldest); the sheet's row 11 (`L11:P11`) totals only those five. `kpis.allTimeCents` covers every row.
- `rolling12`: 12 calendar months ending with `asOf`'s month, oldest first; each month sums payments dated in it (K30:P41; the sheet anchors on TODAY()).
- `holdingsThisFy`: linked holdings with a payment in `asOf`'s FY (payment date in `[FY start, FY end)`, §11 fix 22):
  - `netThisFyCents`, `payments`, `frequencyMonths`, `drp` from the holding (a frequency ≤ 0 counts as none);
  - `yield365Ratio` = mean of the non-null per-payment yields with payment dates in `(asOf − 365, asOf]` × `12 / frequencyMonths` (O); null without a frequency or a yield (the sheet averaged payments with no units as 0, §11 fix 23);
  - `monthsToExtraUnit = ceil(frequencyMonths / (meanYield365 × unitsNow))` (N); null when any factor is null or ≤ 0;
  - `advice` (R): `switch_on` when months < 6 and `drp === false`; `switch_off` when months ≥ 6 and `drp === true`; `keep` otherwise when both are known; null when DRP is unknown or months is null. `DRP_ADVICE_MONTHS = 6`.
- `unlinkedThisFyCents`: this FY's payments with no instrument.
- `kpis`: this FY, last FY, all time, the rolling-12 total, reinvested this FY; `daysIntoFy = asOf − FY start + 1` (H30); `projectedFyCents = round(thisFy / daysIntoFy × 365.25)` (H28).

### 2.11 Dividend suggestions (`dividendSuggestions`, D50, D62)
1. Events with `currency === 'AUD'` and `exDate ≤ asOf` only (non-AUD listings are not suggested, §11 fix 10; AUD only is owner-confirmed, D62).
2. `unitsAtEx` = Σ units of the instrument's trades dated before the ex-date; events with `unitsAtEx ≤ 0` are dropped.
3. **Matched** (dropped) when a dividend of the same instrument has the same ex-date, or when a dividend of the same instrument **without** an ex-date was paid 0–90 days after the event's ex-date (the 90-day window, owner-confirmed: D62) and this event is the latest of that instrument with `exDate ≤ paymentDate` (so an imported payment without an ex-date matches its own distribution, not the next one).
4. `estimatedNetCents = round(unitsAtEx × amountPerUnit × 100)` (gross of any withholding; the owner confirms the net); `priceAtEx = closeBeforeEx`; `yieldRatio = amountPerUnit / closeBeforeEx`.
5. `expectedPaymentDate = exDate + lag`, lag = the median `paymentDate − exDate` over the instrument's dividends with both dates and 0 ≤ lag ≤ 90, else `DEFAULT_PAYMENT_LAG_DAYS = 14` (the 14-day expected gap, owner-confirmed: D62).
6. `status`: `dismissed` when the event is dismissed; else `due` when `expectedPaymentDate ≤ asOf`, else `upcoming`.
7. Order: ex-date descending, then instrument id.
Nothing is added automatically; confirming is a normal `POST /api/dividends` (§4).

### 2.12 Cash-deficit wait (`cashDeficitMonths`, SheetOptions H12) and the timing chain
- `current = cash / liquidTotal` (null when liquidTotal ≤ 0); null result when the target is null, `current ≥ target` (the sheet's "-"), or the average savings is null or ≤ 0.
- Otherwise `months = floor((target × liquidTotal − cash) / avgMonthlySavings) + 1`. The sheet multiplied the shortfall by the cash balance instead of the liquid total (§11 fix 16).
- The server passes the cash class value, the Σ of the six class values, `allocation.cash` and `cashKpis.avgSavingsCents`. The sheet also wraps H12 in `IFERROR(…, 0)` and tests a strict `> 0` surplus; the engine's null covers both the "-" and the error case (§9.3 rule 13).
- `investCountdown` with `cashDeficitMonths`: `periodDays = 30 × max(plan.months, cashDeficitMonths ?? 0)` (H14 = MAX(H12:H13)). `timing.deferred` is always `[]` from Stage 3.

### 2.13 Chart series (`compressCashflow`)
Groups periods like `compressSeries` (monthly, calendar quarter, and **year by `yearWindow(date, yearBasis)`**: the FY by default, the calendar year when `savings.yearBasis` is `calendar` (D52), labelled `FY2025–26` or `2026`; the last `count` groups, null → 12/8/all). FY quarters coincide with calendar quarters. The side-income chart uses `compressSeries(…, yearBasis 'fy')` (side income is always FY-based, §2.8). Per group: cash = the last point's (end); cash gain, added, adjustment, savings (adjusted and raw) and income are sums; `savingsRatio = Σ savings / Σ income` and the raw one likewise (income-weighted, consistent with §11 fix 15); `live` when the group's last period is provisional. The first period contributes cash only. `trendRatio` (monthly unit only): the fitted value of the §2.6 trend line at each of its ≤ 3 closed periods, null elsewhere.

---

## 3. Data model (`@joinr/schema`, migration `0003_stage3_cashflow`)

### 3.1 Migration (append-only; stage-1 §2.1 evolution rule)
Generated with `pnpm --filter @joinr/server db:generate --name stage3_cashflow`, then the data statements below are appended by hand after a `--> statement-breakpoint` (the file keeps a header comment saying so). `git diff --exit-code` on every `0000`–`0002` SQL and snapshot file.

New tables (Drizzle; every one has `origin` + `sheet_ref` unless stated):
| Table | Columns | Keys and FKs |
|---|---|---|
| `cash_balance_entries` (D58) | `id` · `account_id integer not null` · `as_of text not null` · `balance_cents integer not null` · `note text` · provenance | `unique(account_id, as_of)`, `index(account_id)`; FK → `cash_accounts.id` **on delete cascade** |
| `side_income_deposits` (D57) | `id` · `stream_id integer not null` · `deposit_date text not null` · `amount_cents integer not null` (non-zero) · `note text` · provenance | `index(deposit_date)`, `index(stream_id)`; FK → `income_streams.id` on delete cascade |
| `savings_adjustments` (D51) | `id` · `period_month text not null` · `amount_cents integer not null` (non-zero, signed) · `note text not null` · provenance | `unique(period_month)` |
| `savings_goals` (D55) | `id` · `name text not null` · `target_cents integer not null` · `target_date text` · `sort_order integer not null` · `note text` · provenance | — |
| `dividend_events` (D50 cache; no provenance) | `instrument_id integer not null` · `ex_date text not null` · `amount_per_unit text not null` · `currency text not null` · `close_before_ex text` · `close_date text` · `source text not null` (`PRICE_SOURCES`: `yahoo` or `fake`) · `fetched_at text not null` · `dismissed_at text` | `primary key(instrument_id, ex_date)`; FK → `instruments.id` on delete cascade |

No existing column changes. The appended **data statements** convert a database that already holds imported data:
```sql
INSERT INTO `cash_balance_entries` (`account_id`, `as_of`, `balance_cents`, `note`, `origin`, `sheet_ref`)
  SELECT `id`, COALESCE(`balance_as_of`, date('now')), `balance_cents`, NULL, `origin`, `sheet_ref`
  FROM `cash_accounts` ORDER BY `id`;
--> statement-breakpoint
INSERT INTO `side_income_deposits` (`stream_id`, `deposit_date`, `amount_cents`, `note`, `origin`, `sheet_ref`)
  SELECT `stream_id`,
         MIN(COALESCE(`period_end`, date(`period_month` || '-01', '+1 month', '-1 day')),
             COALESCE((SELECT MAX(`balance_as_of`) FROM `cash_accounts`), '9999-12-31')),
         `amount_cents`, NULL, `origin`, `sheet_ref`
  FROM `side_income_entries` WHERE `amount_cents` <> 0 ORDER BY `period_month`, `stream_id`, `id`;
--> statement-breakpoint
DELETE FROM `side_income_entries`;
```
- `side_income_entries` stays (append-only rule) but is never written again; a zero-amount entry carries no information in the deposit model.
- A deposit is dated at its period end, but never after the imported as-of (the latest `balance_as_of`): the live row's period end is its month end, which lies after the as-of (the importer's rule, §3.5 item 1).
- The converted rows keep `origin` and `sheet_ref`, so a database with no app rows still has `hasAppData = false` after the upgrade.
- `COMMITTED_MIGRATION_COUNT` becomes 4; `/api/health` → `migrations: 4`.

### 3.2 Schema module changes (Scaffolder)
- **`enums.ts`** (append only):
  ```ts
  YEAR_BASES                   = ['fy', 'calendar']                        // D52
  SAVINGS_PERIOD_STATUSES      = ['first', 'closed', 'provisional']
  KPI_TRENDS                   = ['increasing', 'decreasing', 'flat']
  DIVIDEND_SUGGESTION_STATUSES = ['due', 'upcoming', 'dismissed']
  DRP_ADVICE                   = ['switch_on', 'switch_off', 'keep']
  BUDGET_AUTO_KINDS            = ['auto_yearly', 'auto_invest', 'auto_cash']   // a subset of BUDGET_ITEM_KINDS
  EDITABLE_NOTE_KINDS          = ['spend', 'side_income']
  JOB_NAMES                    += 'dividends'
  ```
  Each with its type (`YearBasis`, `SavingsPeriodStatus`, `KpiTrend`, `DividendSuggestionStatus`, `DrpAdvice`, `BudgetAutoKind`, `EditableNoteKind`).
- **Tables:** the five new tables in `db/tables/cashflow.ts` (four) and `db/tables/instruments.ts` (`dividendEvents`); `db/index.ts` exports them. **`DOMAIN_TABLES_DELETE_ORDER`** becomes `dividends, trades, side_income_deposits, side_income_entries, income_streams, period_notes, budget_items, yearly_expenses, cash_balance_entries, cash_accounts, snapshots, super_entries, super_funds, loans, properties, other_assets`. `savings_adjustments`, `savings_goals` and `dividend_events` are **not** in it (§3.4).
- **`rows.ts`:** `newCashBalanceEntrySchema`, `newSideIncomeDepositSchema`, `newSavingsAdjustmentSchema`, `newSavingsGoalSchema`, `newDividendEventSchema` + the type-level parity test.
- **`records.ts`:** `RECORD_ENTITY_IDS` appends `'cash-balance-entries'`, `'savings-adjustments'`, `'savings-goals'`, `'dividend-events'`; `'side-income'` is re-pointed to `side_income_deposits`:
  - `cash-balance-entries` (Cash flow): `account:text asOf:date balance:money note:text sheetRef:text` (default sort asOf desc)
  - `side-income` (Cash flow): `date:date stream:text amount:money note:text sheetRef:text` (default sort date desc)
  - `savings-adjustments` (History): `period:month amount:money note:text`
  - `savings-goals` (Cash flow): `name:text target:money targetDate:date sortOrder:integer note:text`
  - `dividend-events` (Investments): `symbol:text exDate:date amountPerUnit:price currency:text closeBeforeEx:price closeDate:date source:text fetchedAt:timestamp dismissed:boolean`
- **`settings.ts`:** §3.3.
- **`dto/cashflow.ts`** (§4.3–4.4) exported from the root; every DTO is declared field by field there (`@joinr/schema` cannot import engine types); **`dto/errors.ts`** gains three codes (§4.1); **`dto/investments.ts`**: `InvestmentTimingDto.budget.source` widens to `'imported_budget' | 'live_budget'` and the DTO gains `cashDeficitMonths: number | null`; `CountdownDto` is unchanged.
- **`testing/dump.ts`:** `DUMPED_TABLES` adds `cash_balance_entries` and `side_income_deposits` (the import writes them); overlays and the events cache are not dumped.
- **Fixtures and seed:** §3.6.

### 3.3 Settings: the new key, the editable keys and the D34 settings rule
- **New key** (appended to `SETTING_KEYS` and `SETTINGS`): `savings.yearBasis`, label "Year for the cash figures", category `savings`, type `enum` (`YEAR_BASES`), `source: null`, `defaultValue: 'fy'` (D52). Readers use `?? 'fy'`.
- **Label change:** `goals.houseDepositInvestmentShare` → "Savings goals: share of investments counted" (D55; key unchanged).
- **`EDITABLE_SETTING_KEYS`** (new export with its type `EditableSettingKey`; Stage 5 extends it to every key): `pay.frequency`, `pay.netPayCents`, `pay.dayOfMonth`, `pay.jobStartDate`, `budget.includeSideIncome`, `budget.emergencyFundMonths`, `budget.emergencyFundOverrideCents`, `budget.autoInvestSplit`, `budget.useForInvestAmount`, `goals.cashSavingsTargetCents`, `goals.eoyCashGoalCents`, `goals.houseDepositInvestmentShare`, `savings.includeMortgagePrincipal`, `savings.yearBasis`, `property.offsetsIncludeEmergencyFund`. The Budget page edits the first nine; the Cash page the rest.
- **`isWorkbookSetting(key)`** (new export): true when the registry `source` is not null.
- **The Stage 1 D34 settings gap is decided here:**
  1. An in-app edit writes `origin = 'app'`. A value equal to the stored one (after parsing) writes nothing, so a no-op save never flips `origin`. `null` stores JSON `null` (read as unset).
  2. `hasAppData` counts a `settings` row only when `origin = 'app'` **and** `isWorkbookSetting(key)`. Editing an app-only key (`savings.yearBasis`) never blocks a re-import, because an import never touches it. Editing a workbook key (pay, budget, goals, savings, offsets) blocks it, because an import would overwrite it (D34).
  3. A committed import (the CLI with `--yes --replace-app-data`) deletes the `origin = 'app'` rows of workbook keys that this workbook does not provide (for example an app-entered emergency-fund override while the workbook holds the default formula), so the database matches the workbook and `hasAppData` can become false again. Keys the workbook provides are written as before.

### 3.4 Origin rules and D34 for every new editable entity
**Principle:** `hasAppData` is true when a re-import would undo or lose something entered in the app. Import-owned tables (in `DOMAIN_TABLES_DELETE_ORDER`) follow the Stage 2 rules; **overlay tables** that an import never touches (`savings_adjustments`, `savings_goals`, the `dividend_events.dismissed_at` flag) never count, and a re-import keeps them.

| Entity | Create | Update | Delete | Counts as app data |
|---|---|---|---|---|
| Cash account | `origin app` + its opening balance entry (`origin app`) | **kind only** → `origin` kept (import-safe; the importer keeps the kind, §3.5); name, offset or note → `origin app` | refused 409 `ACCOUNT_IN_USE` while budget rows reference it; cascades its entries; marker when `sheet_ref` is set | app rows, marker |
| Balance entry (D58) | a balance save writes or replaces the entry for `(account, asOf)` with `origin app`; the account's `balance_cents`/`balance_as_of` become the latest entry's (a denormalised copy that does not change the account's `origin`) | same (replacing an imported entry makes it `app`) | refused 409 `LAST_BALANCE_ENTRY` for an account's only entry; marker when `sheet_ref` is set; the account's balance is recomputed | app rows, marker |
| Side-income deposit | `origin app` | `origin app` | marker when `sheet_ref` set | yes |
| Income stream | `origin app` | name or archived → `origin app` | refused 409 `STREAM_IN_USE` while deposits exist; marker when `sheet_ref` set | yes |
| Period note (spend, side income) | `origin app` (recorded periods only: 400 for the provisional month, §4.5) | `origin app` | `''` deletes; marker when `sheet_ref` set | yes |
| Budget item (`item`) | `origin app` | `origin app`; review flags cleared; a chosen account sets `cash_account_id` and `account_name` | marker when `sheet_ref` set | yes |
| Budget auto row | created on first save when missing (`origin app`) | category, account, and the `auto_invest` manual amount (D54) → `origin app` | never deleted | yes |
| Yearly expense | `origin app` | `origin app` | marker when `sheet_ref` set | yes |
| Dividend | `origin app` (also when confirmed from a suggestion) | `origin app`; review flags cleared | marker when `sheet_ref` set | yes |
| Settings | — | §3.3 | — | workbook keys only |
| Savings adjustment, savings goal | overlay (an adjustment only on a closed period: 400 otherwise, §4.5) | overlay | overlay | **no** |
| Suggestion dismiss / restore | sets / clears `dividend_events.dismissed_at` | — | — | **no** |

### 3.5 Importer changes (importer owner)
1. **Side income (D57):** write one `side_income_deposits` row per **non-zero** numeric G/H cell of a row with a date in F: `deposit_date = min(F, the workbook as-of)` (the period end; the live row's F is its month end, after the as-of, so its deposits land in the provisional period and in FY-to-date), `stream_id` of that column, `note = null`, `origin import`, `sheet_ref` = the cell. `side_income_entries` is no longer written. Period notes (J) stay `period_notes` of kind `side_income`. The reconciliation adds an info line when any deposit was dated at the as-of instead of F (count only).
2. **Balance history (D58):** one `cash_balance_entries` row per imported account: `as_of` = the workbook as-of, the balance, `sheet_ref` = the account's.
3. **Kind kept across a re-import (D49):** before the replace-all delete, read the kind of every account whose kind is not `bank`, keyed by name and by `(sheet_ref, name)`. After inserting, a new account takes the kind of the old account with the **same name when that name is unique** among both the old and the new accounts, else of the one with the same `sheet_ref` and name (an added or removed row above a loan shifts the row-based refs). New accounts get `bank`. A non-bank kind that matched no new account adds an **info** line to the import report ("N account kinds could not be carried over; set them again on the Cash page") with the account names (the report lives in the DB, never in a tracked file).
4. **Budget C28 (D54):** the `auto_invest` row's `monthly_cents` = `C<row>` when that cell is a typed number (no formula), else null. The template's formula (`IF(... Automatic ..., 0)`) stays null.
5. **Settings gap (§3.3 rule 3)** in the writer's settings step.
6. **Reconciliation:** `counts.side-income` expects the non-zero numeric G/H cells and reads back deposits; `income.stream.<n>` and `income.total` sum deposits; the report's `counts` includes `cash-balance-entries` (expected = cash accounts). Every other check is unchanged.
7. `IMPORTER_STAGE3_IMPLEMENTED` (`@joinr/importer/testing`; Scaffolder: false) is set true only after the importer's own suite passes with the changes above.

### 3.6 Seed and fixtures (Scaffolder)
- **`seedGenericData`:**
  - One balance entry per seeded account (`origin import`, the account's `sheet_ref`) plus one earlier entry for the everyday account, so a history chart has two points.
  - Deposits with the same non-zero amounts and dates as the seeded side-income entries, plus one deposit after the last seeded snapshot (a provisional amount). **The seed keeps its `side_income_entries` rows** so the Stage 2 loader (which reads them until server-api rewires it) keeps its figures; server-api removes them when it switches the loader to deposits (Scaffold note). The migration's conversion test does not depend on them (§7.2 step 2).
  - The seeded "Example Bank – Offset" stays an offset; a fourth account "Loan to a friend" of kind `loan_receivable` (it joins the Stage 2 loader's non-offset cash sum until server-api switches to `cashTotals`; the Scaffolder updates the Stage 2 expectations that sum the seeded cash, §7.2).
  - No overlays, no events, **no `app` rows**, so the Stage 1 import-route tests still get 201. The seed test asserts the new tables.
- **`src/fixtures/cashflow.ts`** (from `@joinr/schema/fixtures`; typed with `satisfies`, generic values, internally consistent, produced by a scratch script that applies the §2 rules):
  - `cashPages`: `populated` (bank, credit card, loan and offset accounts; closed periods, one with an adjustment, one rate above 100 % raw, one negative savings, a provisional period; an orphan adjustment; goals), `empty` (no accounts), `noSnapshots` (accounts, no periods), `emergencyShort` (the EF test short with loans left out, offsets counted), `goalStates` (reached, partial, not started, one past its date, no progress; `stalePriceCount` and `unpricedCount` > 0), `noGoals`, `earlyYear` (no closed period in the year yet: year rate null), `missingSettings` (EF target null).
  - `sideIncomePages`: `populated` (two streams, deposits across closed and provisional periods, one before the first snapshot), `empty`, `noSnapshots`.
  - `budgetPages`: `autoSplit`, `manualSplit` (D54 amount), `manualOverLeftover` (a negative cash row), `belowEmergencyFund` (100 % to cash), `missingPay` (missing inputs), `unmatchedAccounts` (a stale account name, an unassigned row), `negativeActual` (actual spend below zero).
  - `dividendsPages`: `populated` (every kind, the FY table with its five FYs, rolling months, holdings with each `DrpAdvice`, an unlinked row), `suggestions` (due, upcoming, dismissed), `checkedNoneFound` (a check ran, nothing due or upcoming, some dismissed), `checkFailed` (`lastError` set), `empty`, `marketOff`, `fakeMode`.
  - Every state carries the DTO fields added in the plan review (`emergencyFund.loansIncluded`, `goals.cashBasis`, `goals.unpricedCount`, `goals.stalePriceCount`, `summary.unallocatedCents`, `summary.cashTargetRatio`, `summary.aggressiveness`), with the D59 values `loansIncluded: false` and `cashBasis: 'available'`; the cash target and EOY figures in `kpis` are consistent with the state's available cash.
  - Mutation examples: `cashAccountMutationResponse`, `balancesResponse`, `depositMutationResponse`, `budgetItemMutationResponse`, `dividendMutationResponse`, `settingsPatchResponse`.
  - `apiErrors` gains `accountInUse`, `streamInUse`, `lastBalanceEntry`, `cashValidation`, `dividendValidation`.
  - `investmentPageTiming`: every state gets `budget.source: 'live_budget'` and `cashDeficitMonths: null`, plus a new `cash_deficit` state (the deficit months exceed the plan's).
  - `FIXTURE_COVERAGE` gains `cashAccountKinds`, `savingsPeriodStatuses`, `yearBases`, `kpiTrends`, `suggestionStatuses`, `drpAdvice`.
- Records fixtures (`sampleDtos.ts`): one page per new entity and the re-pointed `side-income`.

---

## 4. API contract (FROZEN)

All routes are under `/api`, JSON, `cache-control: no-store`, with the Stage 0 error shape; bodies, params and queries validated with `parseWith` (400 `VALIDATION_ERROR`, `path: issue; …`). Money is integer cents; decimals are strings; dates `YYYY-MM-DD`.

### 4.1 Error codes (`API_ERROR_CODES` gains three)
`ACCOUNT_IN_USE` **409** ("This account is used by N budget rows; move them first") · `STREAM_IN_USE` **409** ("This stream has N deposits") · `LAST_BALANCE_ENTRY` **409** ("An account keeps at least one balance"). `NOT_FOUND` 404, `VALIDATION_ERROR` 400, `IMPORT_IN_PROGRESS` 409 and `MARKET_DATA_DISABLED` 503 are reused.

### 4.2 Endpoints
| Method & path | Request | 2xx | Errors |
|---|---|---|---|
| `GET /api/cash` | — | 200 `CashPageResponse` | |
| `POST /api/cash/accounts` | `cashAccountCreateSchema` | **201** `CashAccountMutationResponse` | 400 |
| `PUT /api/cash/accounts/:id` | `cashAccountUpdateSchema` | 200 `CashAccountMutationResponse` | 400 · 404 |
| `DELETE /api/cash/accounts/:id` | — | 200 `DeletedResponse` | 404 · 409 `ACCOUNT_IN_USE` |
| `PUT /api/cash/balances` | `cashBalancesInputSchema` | 200 `CashBalancesResponse` | 400 · 404 (an account) |
| `DELETE /api/cash/balance-entries/:id` | — | 200 `CashAccountMutationResponse` | 404 · 409 `LAST_BALANCE_ENTRY` |
| `PUT /api/cash/adjustments/:periodMonth` | `savingsAdjustmentInputSchema` | 200 `SavingsAdjustmentDto` | 400 (incl. `periodMonth: not a recorded period` unless it is a closed period's month) |
| `DELETE /api/cash/adjustments/:periodMonth` | — (also removes an orphan) | 200 `{ periodMonth }` | 404 |
| `PUT /api/period-notes/:kind/:periodMonth` | `periodNoteInputSchema` (`kind ∈ EDITABLE_NOTE_KINDS`, else 404) | 200 `PeriodNoteResponse` | 400 (incl. `periodMonth: not a recorded period` unless a snapshot has that month) · 404 |
| `POST /api/savings-goals` | `savingsGoalInputSchema` | **201** `SavingsGoalMutationResponse` | 400 |
| `PUT /api/savings-goals/:id` | `savingsGoalInputSchema` | 200 `SavingsGoalMutationResponse` | 400 · 404 |
| `DELETE /api/savings-goals/:id` | — | 200 `DeletedResponse` | 404 |
| `POST /api/savings-goals/reorder` | `reorderSchema` (every goal id exactly once) | 200 `{ ids }` | 400 |
| `GET /api/side-income` | — | 200 `SideIncomePageResponse` | |
| `POST /api/side-income/deposits` | `depositInputSchema` | **201** `DepositMutationResponse` | 400 · 404 (stream) |
| `PUT /api/side-income/deposits/:id` | `depositInputSchema` | 200 `DepositMutationResponse` | 400 · 404 |
| `DELETE /api/side-income/deposits/:id` | — | 200 `DeletedResponse` | 404 |
| `POST /api/side-income/streams` | `incomeStreamInputSchema` | **201** `IncomeStreamMutationResponse` | 400 |
| `PUT /api/side-income/streams/:id` | `incomeStreamInputSchema` | 200 `IncomeStreamMutationResponse` | 400 · 404 |
| `DELETE /api/side-income/streams/:id` | — | 200 `DeletedResponse` | 404 · 409 `STREAM_IN_USE` |
| `GET /api/budget` | — | 200 `BudgetPageResponse` | |
| `POST /api/budget/items` | `budgetItemInputSchema` | **201** `BudgetItemMutationResponse` | 400 · 404 (account) |
| `PUT /api/budget/items/:id` | `budgetItemInputSchema` (kind `item` rows only; an auto row → 400 `id: an automatic row`) | 200 `BudgetItemMutationResponse` | 400 · 404 |
| `DELETE /api/budget/items/:id` | — (items only) | 200 `DeletedResponse` | 400 · 404 |
| `POST /api/budget/items/reorder` | `reorderSchema` (every `item` and `auto_yearly` id exactly once) | 200 `{ ids }` | 400 |
| `PUT /api/budget/auto/:kind` | `budgetAutoRowInputSchema` (`kind ∈ BUDGET_AUTO_KINDS`, else 404) | 200 `BudgetItemMutationResponse` | 400 · 404 |
| `POST /api/budget/yearly-expenses` | `yearlyExpenseInputSchema` | **201** `YearlyExpenseMutationResponse` | 400 |
| `PUT /api/budget/yearly-expenses/:id` | `yearlyExpenseInputSchema` | 200 `YearlyExpenseMutationResponse` | 400 · 404 |
| `DELETE /api/budget/yearly-expenses/:id` | — | 200 `DeletedResponse` | 404 |
| `GET /api/dividends` | — | 200 `DividendsPageResponse` | |
| `POST /api/dividends` | `dividendInputSchema` | **201** `DividendMutationResponse` | 400 · 404 (instrument) |
| `PUT /api/dividends/:id` | `dividendInputSchema` (the holding may change; ticker and kind follow it) | 200 `DividendMutationResponse` | 400 · 404 |
| `DELETE /api/dividends/:id` | — | 200 `DeletedResponse` | 404 |
| `POST /api/dividends/suggestions/refresh` | empty body | 200 `DividendEventsRefreshResponse` (awaits the run; joins one in flight; works whatever `PRICE_REFRESH_MINUTES` is) | 503 `MARKET_DATA_DISABLED` |
| `POST /api/dividends/suggestions/dismiss` | `dividendEventKeySchema` | 200 `DividendEventKey` | 400 · 404 (no such event) |
| `POST /api/dividends/suggestions/restore` | `dividendEventKeySchema` | 200 `DividendEventKey` | 400 · 404 |
| `PATCH /api/settings` | `settingsPatchSchema` | 200 `SettingsPatchResponse` | 400 |
| `GET /api/health` | (Stage 0) | `db.migrations` becomes **4** | |
| `GET /api/investments/:kind` | (Stage 2) | `timing` changes additively (§3.2) | |

Every mutation above (all but the GETs and the suggestion refresh) answers **409 `IMPORT_IN_PROGRESS`** first while the upload import holds the import lock. `:id` params use `idParamsSchema`; `:periodMonth` uses `IsoMonthSchema`.

### 4.3 Request schemas (`dto/cashflow.ts`)
```ts
export const CASHFLOW_MONEY_MAX = 10_000_000_000;              // cents (|x| ≤ $100m) for balances, deposits, dividends, adjustments
export function makeCashflowDateSchema(now: () => Date): z.ZodType<IsoDate>;   // ≥ MIN_TRADE_DATE and ≤ local tomorrow (the trade rule)
const signedCents = z.number().int().min(-CASHFLOW_MONEY_MAX).max(CASHFLOW_MONEY_MAX);
const nonZeroCents = signedCents.refine((v) => v !== 0, { error: 'must not be zero' });
const name = (max: number) => z.string().trim().min(1).max(max);
// optionalText(max) as in dto/investments.ts ('' → null)

export const cashAccountUpdateSchema = z.strictObject({
  name: name(80), kind: z.enum(CASH_ACCOUNT_KINDS), isOffset: z.boolean(), note: optionalText(200) });
export function makeCashAccountCreateSchema(now) {                  // cashAccountCreateSchema = make…(() => new Date())
  return cashAccountUpdateSchema.extend({ openingBalanceCents: signedCents, asOf: makeCashflowDateSchema(now) }); }
export function makeCashBalancesInputSchema(now) {
  return z.strictObject({ asOf: makeCashflowDateSchema(now),
    entries: z.array(z.strictObject({ accountId: z.number().int().positive(), balanceCents: signedCents,
      note: optionalText(200).optional() })).min(1).max(200) })      // + refine: account ids unique ('entries: an account appears twice')
}
export const savingsAdjustmentInputSchema = z.strictObject({ amountCents: nonZeroCents, note: name(200) });
export const periodNoteInputSchema = z.strictObject({ note: z.string().trim().max(500) });   // '' deletes
export const savingsGoalInputSchema = z.strictObject({ name: name(80),
  targetCents: z.number().int().positive().max(CASHFLOW_MONEY_MAX),
  targetDate: IsoDateSchema.nullable(),                             // 1900-01-01 … 2200-12-31
  note: optionalText(200) });
export const reorderSchema = z.strictObject({ ids: z.array(z.number().int().positive()).min(1).max(500) });  // + unique
export function makeDepositInputSchema(now) {
  return z.strictObject({ streamId: z.number().int().positive(), date: makeCashflowDateSchema(now),
    amountCents: nonZeroCents, note: optionalText(200) }); }
export const incomeStreamInputSchema = z.strictObject({ name: name(60), archived: z.boolean() });
export const budgetItemInputSchema = z.strictObject({ name: name(80),
  monthlyCents: z.number().int().min(0).max(CASHFLOW_MONEY_MAX), category: optionalText(40),
  accountId: z.number().int().positive().nullable() });
export const budgetAutoRowInputSchema = z.strictObject({ category: optionalText(40),
  accountId: z.number().int().positive().nullable(),
  manualMonthlyCents: z.number().int().min(0).max(CASHFLOW_MONEY_MAX).nullable().optional() });   // auto_invest only (else 400)
export const yearlyExpenseInputSchema = z.strictObject({ name: name(80),
  annualCents: z.number().int().min(0).max(CASHFLOW_MONEY_MAX) });
export function makeDividendInputSchema(now) {
  return z.strictObject({ instrumentId: z.number().int().positive(), paymentDate: makeCashflowDateSchema(now),
    exDate: IsoDateSchema.nullable(),                               // + refine: exDate ≤ paymentDate ('exDate: after the payment date')
    reinvested: z.boolean().nullable(), netAmountCents: nonZeroCents,
    priceAtEx: tradeDecimalSchema(1e9).nullable().optional(),       // omitted → filled from the events cache (§4.5)
    note: optionalText(200) }); }
export const dividendEventKeySchema = z.strictObject({ instrumentId: z.number().int().positive(), exDate: IsoDateSchema });
export const settingsPatchSchema: z.ZodType<{ values: Partial<Record<EditableSettingKey, SettingValue | null>> }>;
  // strict: 1–20 keys, each in EDITABLE_SETTING_KEYS (else 400 `values.<key>: not editable here`),
  // each value parsed with settingValueSchema(key) or null
```

### 4.4 DTOs (`dto/cashflow.ts`, frozen field lists)
```ts
export interface SettingsSliceDto {                                 // the settings a page edits
  values: Partial<Record<SettingKey, SettingValue | null>>;
  origins: Partial<Record<SettingKey, Origin | null>>;              // null = never stored
}

// ─── Cash ───
export interface CashAccountDto {
  id: number; name: string; kind: CashAccountKind; isOffset: boolean; currency: string;
  balanceCents: number; balanceAsOf: IsoDate | null;
  inTotalCash: boolean; countsForEmergencyFund: boolean;
  note: string | null; sortOrder: number; origin: Origin; sheetRef: string | null;
  entryCount: number; budgetRowCount: number;                       // delete needs budgetRowCount 0
}
export interface CashBalanceEntryDto { id: number; accountId: number; asOf: IsoDate; balanceCents: number;
  note: string | null; origin: Origin; sheetRef: string | null }
export interface CashTotalsDto {
  totalCashCents: number; byKind: Record<CashAccountKind, number>; offsetCents: number; loansCents: number;
  availableCashCents: number; emergencyFundTestCents: number;
  emergencyFund: { targetCents: number | null; covered: boolean | null; shortfallCents: number | null;
    offsetsIncluded: boolean; loansIncluded: boolean };            // loansIncluded = the §4.5 constant (false: D59)
}
export interface SavingsFiguresDto { incomeCents: number | null; savingsCents: number | null;
  savingsRatio: DecimalString | null; spendCents: number | null }
export interface SavingsPeriodDto {
  periodMonth: IsoMonth; runDate: IsoDate; after: IsoDate | null; through: IsoDate; status: SavingsPeriodStatus;
  cashCents: number | null; cashGainCents: number | null; cashGainRatio: DecimalString | null;
  addedInvestmentsCents: number | null;
  added: { tradesCents: number; otherAssetsCents: number; superCents: number; mortgagePrincipalCents: number;
    propertyDepositCents: number } | null;
  income: { salaryCents: number | null; sideIncomeCents: number; cashDividendsCents: number;
    otherDividendsCents: number } | null;
  adjustment: SavingsAdjustmentDto | null;
  raw: SavingsFiguresDto; adjusted: SavingsFiguresDto;
  spendNote: PeriodNoteDto | null;
}
export interface SavingsAdjustmentDto { periodMonth: IsoMonth; amountCents: number; note: string }
export interface PeriodNoteDto { periodMonth: IsoMonth; kind: EditableNoteKind; note: string; origin: Origin;
  sheetRef: string | null }
// Declared field by field (= CashKpisResult, YearWindow and CashflowChartPoint of §2.2 with Cents → number);
// server-api adds a type-level test that each engine result is assignable to its DTO.
export interface YearWindowDto { basis: YearBasis; start: IsoDate; end: IsoDate; year: number }
export interface CashKpisDto {
  anchor: IsoDate | null; year: YearWindowDto;
  lastPeriod: { periodMonth: IsoMonth; runDate: IsoDate; cashGainCents: number | null; savingsCents: number | null;
    savingsRatio: DecimalString | null; rawSavingsRatio: DecimalString | null } | null;
  avgWindow: { from: IsoDate; periods: number } | null;
  avgCashGainCents: number | null; avgCashGainAdjustedCents: number | null; avgAddedInvestmentsCents: number | null;
  avgSavingsCents: number | null; avgSavingsRawCents: number | null; predictedCashPerYearCents: number | null;
  yearCashGainCents: number; yearSavingsCents: number; yearAddedInvestmentsCents: number;
  yearIncomeCents: number; yearPeriods: number;
  yearSavingsRatio: DecimalString | null; yearSavingsRawRatio: DecimalString | null;
  last3SavingsRatio: DecimalString | null; trendPerMonth: DecimalString | null; trend: KpiTrend | null;
  monthsToYearEnd: number | null; eoyProjectedCashCents: number | null; eoyGapPerMonthCents: number | null;
  eoyOnTarget: boolean | null;
  cashTarget: { targetCents: number; progressRatio: DecimalString; monthsToTarget: number | null;
    arrival: IsoDate | null; status: 'reached' | 'on_track' | 'no_savings' } | null;
  spend6mCents: number | null; spend6mRawCents: number | null; spend6mPeriods: number;
}
export interface SavingsGoalDto {
  id: number; name: string; targetCents: number; targetDate: IsoDate | null; sortOrder: number; note: string | null;
  allocatedCents: number; remainingCents: number; progressRatio: DecimalString; reached: boolean;
  monthsToGo: number | null; eta: IsoDate | null; onTrack: boolean | null; requiredPerMonthCents: number | null;
}
export interface CashChartPointDto {
  label: string; period: IsoMonth; date: IsoDate; live: boolean;
  cashCents: number | null; cashGainCents: number | null; addedInvestmentsCents: number | null; adjustmentCents: number;
  savingsCents: number | null; savingsRawCents: number | null; incomeCents: number | null;
  savingsRatio: DecimalString | null; savingsRawRatio: DecimalString | null; trendRatio: DecimalString | null;
}
export interface CashChartsDto { unit: ChartDateUnit; count: number | null; points: CashChartPointDto[] }
export interface CashPageResponse {
  asOf: IsoDate; generatedAt: IsoTimestamp; lastRun: IsoDate | null;
  accounts: CashAccountDto[];                                       // kind order (CASH_ACCOUNT_KINDS), offsets last, then sortOrder
  entries: CashBalanceEntryDto[];                                   // every account's history, asOf desc
  totals: CashTotalsDto;
  periods: SavingsPeriodDto[];                                      // newest first (the provisional period first)
  orphanAdjustments: SavingsAdjustmentDto[];                        // months with no period, or the first period
  kpis: CashKpisDto;
  goals: { savedCents: number; monthlyProgressCents: number | null; investmentsValueCents: number;
    cashBasis: 'total' | 'available';                               // the §4.5 goals-cash constant ('available': D59)
    unpricedCount: number; stalePriceCount: number;                 // Σ over the four investment kinds' summaries
    items: SavingsGoalDto[] };
  charts: CashChartsDto;
  settings: SettingsSliceDto;                                       // the Cash page's keys (§3.3)
  staticUntilStage4: boolean;                                       // other assets / super / mortgage from the import
}
export interface CashAccountMutationResponse { account: CashAccountDto }
export interface CashBalancesResponse { accounts: CashAccountDto[] }
export interface PeriodNoteResponse { note: PeriodNoteDto | null }
export interface SavingsGoalMutationResponse { goal: SavingsGoalDto }

// ─── Side income ───
export interface IncomeStreamDto { id: number; name: string; sortOrder: number; archived: boolean; origin: Origin;
  sheetRef: string | null; depositCount: number; lifetimeCents: number }
export interface SideIncomeDepositDto { id: number; streamId: number; streamName: string; date: IsoDate;
  amountCents: number; note: string | null; origin: Origin; sheetRef: string | null;
  periodMonth: IsoMonth | null; provisional: boolean }
export interface SideIncomePeriodDto { periodMonth: IsoMonth; start: IsoDate; end: IsoDate;
  status: 'closed' | 'provisional'; totalCents: number; byStream: { streamId: number; amountCents: number }[];
  note: PeriodNoteDto | null }
export interface SideIncomeKpisDto { financialYear: number; fyStart: IsoDate; fyEnd: IsoDate;
  avgPerPeriodThisFyCents: number | null; periodsThisFy: number; fyToDateCents: number;
  projectedYearCents: number | null; avg365Cents: number | null; periods365: number; lifetimeCents: number }
export interface SideIncomeChartPointDto { label: string; period: IsoMonth; date: IsoDate; live: boolean;
  byStream: Record<string, number | null>; totalCents: number | null }   // keys = String(streamId)
export interface SideIncomePageResponse {
  asOf: IsoDate; generatedAt: IsoTimestamp; lastRun: IsoDate | null;
  streams: IncomeStreamDto[]; deposits: SideIncomeDepositDto[];     // deposits newest first
  periods: SideIncomePeriodDto[];                                   // newest first
  outside: { beforeFirstCents: number; afterAsOfCents: number };
  kpis: SideIncomeKpisDto;
  charts: { unit: ChartDateUnit; count: number | null; points: SideIncomeChartPointDto[] };
  budget: { includeSideIncome: boolean; avg365Cents: number | null };   // D53: what the Budget adds
}
export interface DepositMutationResponse { deposit: SideIncomeDepositDto }
export interface IncomeStreamMutationResponse { stream: IncomeStreamDto }

// ─── Budget ───
export interface BudgetRowDto {
  id: number | null; kind: BudgetItemKind; name: string | null;
  storedMonthlyCents: number | null; monthlyCents: number; incomeShareRatio: DecimalString | null;
  weeklyCents: number; yearlyCents: number; category: string | null;
  accountId: number | null; accountName: string | null; accountLinked: boolean;
  savingsLine: boolean; derived: boolean; manual: boolean;
  flags: ReviewFlag[]; sortOrder: number | null; origin: Origin | null; sheetRef: string | null;
}
export interface YearlyExpenseDto { id: number; name: string; annualCents: number; monthlyCents: number;
  sortOrder: number; origin: Origin; sheetRef: string | null }
export interface BudgetTransferDto { accountId: number | null; accountName: string | null; linked: boolean;
  perPayCents: number; monthlyCents: number; rows: number }
export interface BudgetSummaryDto {
  payFrequency: PayFrequency | null; netPayCents: number | null;
  monthlyIncomeCents: number | null; annualIncomeCents: number | null;
  sideIncomeIncluded: boolean; sideIncomeAvgCents: number | null;
  yearlyFundCents: number; plannedSpendCents: number; leftoverCents: number | null; yearlySavingsCents: number | null;
  emergencyFundCents: number | null; emergencyFundBasisCents: number; belowEmergencyFund: boolean;
  cashShareRatio: DecimalString | null; investShareRatio: DecimalString | null;
  investmentRowCents: number | null; cashRowCents: number | null; investManual: boolean;
  unallocatedCents: number | null;                                  // BudgetResult.unallocatedCents
  plannedSavingsRatio: DecimalString | null;
  cashTargetRatio: DecimalString | null;                            // allocation.cash (read-only here)
  aggressiveness: AllocationAggressiveness | null;                  // investing.allocationAggressiveness (read-only)
  monthlyInvestCents: number | null; sideIncomeInvestCents: number;   // D40, as the investment pages show
}
export interface BudgetPageResponse {
  asOf: IsoDate; generatedAt: IsoTimestamp;
  summary: BudgetSummaryDto;
  rows: BudgetRowDto[];                                             // items and auto rows in display order
  yearlyExpenses: YearlyExpenseDto[];
  transfers: BudgetTransferDto[]; unassigned: { perPayCents: number; monthlyCents: number; rows: number };
  perPayTotalCents: number | null;
  byCategory: { category: string | null; monthlyCents: number }[];
  actual: { plannedCents: number; actualCents: number | null; actualRawCents: number | null; periods: number };
  accounts: { id: number; name: string; kind: CashAccountKind }[]; // every account (fixes the F8:F29 range)
  settings: SettingsSliceDto;                                       // the Budget page's keys (§3.3)
  missing: string[];                                                // BudgetInvestResult.missing
}
export interface BudgetItemMutationResponse { row: BudgetRowDto }
export interface YearlyExpenseMutationResponse { expense: YearlyExpenseDto }

// ─── Dividends ───
export interface DividendRowDto {
  id: number; instrumentId: number | null; symbol: string | null; ticker: string; holdingKind: InstrumentKind;
  paymentDate: IsoDate; exDate: IsoDate | null; reinvested: boolean | null; netAmountCents: number;
  priceAtEx: DecimalString | null; priceAtExManual: boolean;
  unitsAtEx: DecimalString | null; yieldRatio: DecimalString | null; financialYear: number;
  flags: ReviewFlag[]; note: string | null; origin: Origin; sheetRef: string | null;
}
export interface DividendFyRowDto { financialYear: number; byKind: Record<InstrumentKind, number>; totalCents: number }
export interface DividendMonthRowDto { month: IsoMonth; byKind: Record<InstrumentKind, number>; totalCents: number }
export interface DividendHoldingFyDto { instrumentId: number; symbol: string; kind: InstrumentKind;
  netThisFyCents: number; payments: number; frequencyMonths: number | null; drp: boolean | null;
  yield365Ratio: DecimalString | null; monthsToExtraUnit: number | null; advice: DrpAdvice | null }
export interface DividendSuggestionDto { instrumentId: number; symbol: string; kind: InstrumentKind; exDate: IsoDate;
  amountPerUnit: DecimalString; currency: string; unitsAtEx: DecimalString; estimatedNetCents: number;
  priceAtEx: DecimalString | null; yieldRatio: DecimalString | null; expectedPaymentDate: IsoDate;
  status: DividendSuggestionStatus; reinvestedDefault: boolean | null }   // = the holding's DRP
export interface DividendEventsStatusDto { mode: MarketDataMode; running: boolean; lastRefreshAt: string | null;
  nextRefreshAt: string | null; eventCount: number; instrumentsCovered: number; lastError: string | null }
export interface DividendsKpisDto { financialYear: number; thisFyCents: number; lastFyCents: number;
  allTimeCents: number; rolling12Cents: number; reinvestedThisFyCents: number; daysIntoFy: number;
  projectedFyCents: number | null }                                 // = DividendsResult['kpis'], declared here
export interface DividendsPageResponse {
  asOf: IsoDate; generatedAt: IsoTimestamp;
  dividends: DividendRowDto[];                                      // payment date desc, then id desc
  kpis: DividendsKpisDto;
  byFinancialYear: DividendFyRowDto[]; rolling12: DividendMonthRowDto[];
  holdingsThisFy: DividendHoldingFyDto[]; unlinkedThisFyCents: number;
  suggestions: DividendSuggestionDto[];                             // due, upcoming and dismissed
  events: DividendEventsStatusDto;
  holdings: { instrumentId: number; symbol: string; kind: InstrumentKind; drp: boolean | null;
    dividendFreqMonths: number | null }[];                          // the dividend form's holding list
}
export interface DividendMutationResponse { dividend: DividendRowDto }
export type DividendEventKey = z.output<typeof dividendEventKeySchema>;
export interface DividendEventsRefreshSummary { jobRunId: number | null; requested: number; ok: number;
  failed: number; skipped: number; events: number; durationMs: number }
export interface DividendEventsRefreshResponse { summary: DividendEventsRefreshSummary; events: DividendEventsStatusDto }

// ─── Settings ───
export interface SettingsPatchResponse { settings: SettingsSliceDto; hasAppData: boolean }
```
`DeletedResponse` is reused from `dto/investments.ts`.

### 4.5 Server behaviour (server-api; `apps/server/src/cashflow/**`, the routes)
**One request context.**
- A `FinanceContext` (server-api designs it) loads every row the four pages and the timing chain need in **one read transaction** (it extends or replaces the Stage 2 loader, which already reads in one transaction), takes the prices from `market.getPrices()` first, and memoises the engine results per request: `computeInvestments` ×4, `cashTotals`, `computeSideIncome`, `computeSavings`, `cashKpis`, `computeBudget`, `computeDividends`.
- `asOf` = the server-local calendar date of the injected `now()`. Route options add `engine?: EngineApi` (the Stage 2 `BuildAppOptions.engine` is reused); tests inject fakes.
- The server adds only display fields (names, symbols, origins, notes); **every figure comes from the engine**.

**Engine inputs built by the server.**
| Input | Source |
|---|---|
| `SavingsSnapshotInput` | `snapshots` rows: `cash_value_cents`, `super_contrib_cents`, `salary_monthly_cents`, `property_purchase_cents`, `mortgage_balance_cents`, `mortgage_principal_paid_cents` |
| `SavingsLiveInput` | cash = `cashTotals.totalCashCents` (the savings engine keeps loans in, D59); salary = `engine.monthlyPayCents({ netPayCents: pay.netPayCents, payFrequency: pay.frequency })` (null when either is null); super = Σ `super_entries` of kind `voluntary_contribution` whose `period_month` is after the latest snapshot's and not after `isoMonthOf(asOf)`; property = Σ `properties.purchase_value_cents`; mortgage = −Σ current balances of loans with a `property_id`, and principal paid = Σ their `payments_paid_cents` − Σ their interest and fees (none are imported before Stage 4, so 0; the sheet's History AD = |F11 − |AC||) (static until Stage 4) |
| cash totals | `cashTotals({ accounts, offsetsIncludeEmergencyFund, loansCountForEmergencyFund: LOANS_COUNT_FOR_EMERGENCY_FUND })`, one exported constant `false` in `src/cashflow/` (D59, owner-confirmed; §11 fix 20); `CashTotalsDto.emergencyFund.loansIncluded` and `CashAccountDto.countsForEmergencyFund` follow it |
| savings goals | `goalsCashCents` = `availableCashCents`, chosen by the exported constant `GOALS_CASH_BASIS = 'available'` in `src/cashflow/` (D59, owner-confirmed; `'total'` would pass `totalCashCents`); `goals.cashBasis` reports it |
| cash KPIs | `cashKpis({ …, currentCashCents: cashTotals.availableCashCents })` (D59: the cash target and the EOY cash goal use available cash; the monthly rate stays the average total-cash gain, §2.6) |
| other-asset purchases | `other_assets` rows with a `purchase_date` and currency AUD: `(units − sold_units) × unit_cost`; other currencies are skipped (Stage 4 adds FX) |
| deposits, dividends, trades | every row (dividends via `toEngineDividend`) |
| budget rows | every `budget_items` row in `sort_order`, then `id`; `accountName` = the linked account's name, else the stored text |
| class values / EF test | the four kinds' `summary.valueCents`, `cashTotals.totalCashCents` (cash class: net worth keeps loans in, D59), the other-assets value; `considerNext.cashCents` and `BudgetInvestInput.cashCents` = `emergencyFundTestCents` |
| cash-deficit wait | `cashDeficitMonths({ cashCents: total cash (the cash class, D59), liquidTotalCents: Σ six class values, targetRatio: allocation.cash, avgMonthlySavingsCents: kpis.avgSavingsCents })` → `investCountdown({ …, cashDeficitMonths })` |
| settings | `readSettings`; `savings.yearBasis ?? 'fy'`, `savings.includeMortgagePrincipal ?? true`, `property.offsetsIncludeEmergencyFund ?? false`, `budget.includeSideIncome ?? false` |

**Stage 2 timing chain (live).** Consider-next's `cashCents` and the countdown read the live cash balances (the context's `cashTotals`). `buildTiming` uses the live budget (`budgetInvestInputOf` of the same `BudgetInput` the Budget page uses), the closed side-income periods, the emergency-fund-test cash and the cash-deficit months; `timing.budget.source = 'live_budget'`, `timing.cashDeficitMonths` set, `timing.deferred = []`. The D40 amount, the D46/D54 `split_off` state and every other Stage 2 rule are otherwise unchanged.

**Mutations** (one synchronous `BEGIN IMMEDIATE` transaction each):
0. `importLock.held` → 409 `IMPORT_IN_PROGRESS`, before parsing an `:id`.
1. Parse (400); load the target (404); cross-row rules (400: an auto-row id on the items route; `manualMonthlyCents` on an auto row other than `auto_invest`; a duplicate account in a balances body; an adjustment PUT whose `periodMonth` is not a closed period's month, or a note PUT whose month no snapshot has: `periodMonth: not a recorded period`).
2. Write with the §3.4 origin rules; a delete of a row with a `sheet_ref` calls `markImportRowDeleted`. Compare "changed" after normalising both sides (trim, `''` → null), so a no-op save never flips `origin`.
3. Balance saves upsert `(account_id, as_of)` and then set the account's `balance_cents`/`balance_as_of` from its latest entry; deleting an entry recomputes them.
4. Dividend create/update: `ticker` = the instrument's symbol, `holding_kind` = its kind; `priceAtEx` omitted → the cached event's `close_before_ex` for `(instrument, exDate)` when present (`price_at_ex_manual = false`), else null; given → stored with `price_at_ex_manual = true`.
5. Commit, then respond with the DTO recomputed from the engine (201 or 200). DELETE → `{ id }`.
6. After a dividend or budget change nothing needs `market.notifyInstrumentsChanged()`; after an account change neither.

**Settings PATCH:** parse; per key compare the parsed value with the stored one; write changed keys with `origin = 'app'` and `updated_at = now`; respond with the page slice and `hasAppData(db)`.

**Cross-cutting (server-api):**
- `db/queries/domain.ts`: `hasAppData` scans the new import-owned tables through `DOMAIN_TABLES_DELETE_ORDER` (automatic) and applies the §3.3 settings rule; overlays and the events cache are never scanned.
- `records/index.ts`: the four new entities and the re-pointed `side-income` (the Scaffolder does the minimum; server-api owns it afterwards).
- A type-level test (`expectTypeOf<…>().toMatchTypeOf<…>()`) that `CashKpisResult`, `YearWindow`, `CashflowChartPoint` and `DividendsResult['kpis']` are assignable to `CashKpisDto`, `YearWindowDto`, `CashChartPointDto` and `DividendsKpisDto`.
- Remove the seed's `side_income_entries` rows when the loader switches to deposits (Scaffold note).
- **Consistency:** single user, last write wins (as Stage 2). A CLI import beside the server can replace rows; a later mutation naming a vanished row gets 404.

### 4.6 Dividend events service (market data; market-events, §7.5)
- **`DividendEventsService`** (`apps/server/src/market/dividends/**`; the interface and the factory signatures are FROZEN; the Scaffolder writes them with an off-mode implementation):
  ```ts
  export interface DividendEventsService {
    refresh(opts?: { instrumentIds?: number[]; trigger?: JobTrigger }): Promise<DividendEventsRefreshSummary>; // off → MarketDataDisabledError
    status(): Omit<DividendEventsStatusDto, 'eventCount' | 'instrumentsCovered' | 'lastError'>;
  }
  export interface DividendEventsServiceOptions {           // mirrors MarketDataServiceOptions (market/service.ts)
    db: JoinrDb; config: Pick<Config, 'marketDataMode' | 'priceRefreshMinutes'>; log: FastifyBaseLogger;
    scheduler: Scheduler; cooldowns?: Cooldowns; fetchImpl?: typeof fetch; clock?: Clock;
    runDeadlineMs?: number; yahooSpacingMs?: number; requestTimeoutMs?: number;   // test knobs
  }
  export function createDividendEventsService(o: DividendEventsServiceOptions): DividendEventsService;
  export function createOffDividendEventsService(): DividendEventsService;
  ```
  `AppServices` gains an **optional** `dividendEvents?: DividendEventsService` (so the existing test factories keep compiling); `buildApp` falls back to `createOffDividendEventsService()`. `defaultServices` builds it in the config mode with the **same `Cooldowns` instance** as the price service (`MarketDataServiceOptions` gains an optional `cooldowns?: Cooldowns`, used instead of the service's private one; `defaultServices` in `app.ts` creates one and passes it to both; the Scaffolder writes this wiring); `offServices` in `off`. server-api's routes and page builders use only this interface plus the `dividend_events` and `job_runs` tables.
- **Job `dividends`** on the scheduler (the Stage 1 generic scheduler; one `job_runs` row per run): **registered whenever the mode is `live` or `fake`**, with `intervalMs = PRICE_REFRESH_MINUTES > 0 ? 24 h : 0` (as the price job: an interval of 0 schedules no timer, so tests and e2e, which set 0, have none, while manual runs, `job_runs` rows and joining a run in flight all work); first scheduled run 60 s after `start()`. The refresh route runs it through `scheduler.run('dividends')` and joins a run in flight.
- **Sharing Yahoo with the price job:** a run first waits while the `prices` job is running (`scheduler.isRunning('prices')`, polled on the injected clock, bounded by its deadline); it checks the shared Yahoo cool-down before every request and starts it on a 429/403, as the price job does; its deadline is the price job's `RUN_DEADLINE_MS` (a run that hits it is `partial`, the remaining targets skipped).
- **Targets:** stock, ETF and managed-fund instruments with provider `yahoo`, a `provider_symbol` and at least one trade. Crypto is never fetched.
- **Yahoo request** (one per target, the provider's spacing, concurrency and 10 s timeout; the browser-like User-Agent): `GET https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?period1={unix(firstTradeDate − 14 days)}&period2={unix(now)}&interval=1d&events=div`.
- **Parsing** (`parseYahooDividends(body)`, pure, unit-tested with generic JSON shaped like the real response):
  - `chart.error` or no result → failure "Symbol not found" (as prices).
  - Local dates: every unix timestamp → the calendar date in `meta.exchangeTimezoneName` via `Intl.DateTimeFormat('en-CA', { timeZone, year, month, day })`; fallback `unix + meta.gmtoffset` then the UTC date. **Never the raw UTC date** (it is a day early under daylight saving).
  - Events: `events.dividends` values `{ amount, date }` → `{ exDate: localDate(date), amountPerUnit: decimalFromNumber(amount), currency: meta.currency }`; non-finite or ≤ 0 amounts are skipped.
  - Closes: `indicators.quote[0].close[i]` with `timestamp[i]`; nulls skipped. `closeBeforeEx` = the last close whose local date is **before** the ex-date (the "last close on or before ex-date minus one trading day"; spec 02 §4.4); none → null. The adjusted close is never used.
  - `GBp`/`GBX` currencies are stored as reported; the engine does not suggest non-AUD events (§2.11).
- **Writes:** one synchronous transaction per run; upsert `dividend_events` by `(instrument_id, ex_date)` setting amount, currency, close, close date, `source`, `fetched_at`; **`dismissed_at` is never touched by a refresh**. An instrument that vanished mid-run (an import) is skipped (the Stage 2 identity check: kind and symbol captured at target selection).
- **Rate limits:** a 429/403 stops the run and starts the shared Yahoo cool-down; the remaining targets count as skipped; the run is `partial`. A run that starts while the cool-down is active skips every target.
- **Fake provider** (`MARKET_DATA_MODE=fake`): deterministic quarterly events on the first weekday of January, April, July and October from two years before `now` to `now`, `amount = 0.1 + (fnv1a(symbol) % 50) / 100` AUD per unit, `closeBeforeEx = fakePrice(symbol)`.
- **Status:** `lastRefreshAt`/`running`/`nextRefreshAt` from the scheduler; the page DTO adds `eventCount`, `instrumentsCovered` and the last run's error text from `job_runs` (≤ 200 chars, no URLs).

---

## 5. Chart data
| Chart (page) | Source | Per period | Live point | Mode |
|---|---|---|---|---|
| Cash value history (Cash) | `compressCashflow` `cashCents` (snapshots; the provisional period's live Total Cash) | stored cash | provisional | end |
| Savings history (Cash) | cash gain + added investments − adjustment, stacked (adjusted); the raw switch drops the adjustment segment | sums | provisional | sum |
| Savings rate (Cash) | `savingsRatio` (line), `trendRatio` (the 3-month trend line), raw on the switch | Σ savings / Σ income | provisional | weighted |
| Account balance history (Cash) | `cash_balance_entries` of the chosen account, by `asOf` | — | — | raw points |
| Side income by stream (Side Income) | engine periods → `compressSeries(…, 'fy')` (keys = stream ids; yearly = FY) | per stream | provisional | sum |
| Dividends by FY and type (Dividends) | `byFinancialYear` | — | — | — |
| Last 12 months by type (Dividends) | `rolling12` | — | — | — |
| Budget by item, by category (Budget) | `rows` (monthly > 0), `byCategory` | — | — | — |
| Planned vs actual spend (Budget) | `summary.plannedSpendCents` vs `actual.actualCents` (raw on the switch) | — | — | — |

- Unit and count come from `charts.dateUnit ?? 'monthly'` and `charts.unitCount ?? null`, as Stage 2.
- The live point's label ends in " (live)" and the card says "The last point is provisional: it uses today's balances." (Stage 2 §5 pattern).
- Colour: stacked series take palette slots in order (cash gain slot 1, added investments slot 2, adjustment slot 3); dividend kinds keep one slot each across both dividend charts (ETF 1, stocks 2, managed funds 3, crypto 4), but the **series order** in the stacks and bar groups is stocks, ETFs, managed funds, crypto (bottom to top / left to right), so the ETF segment, nearly always present, separates violet (2) from fuchsia (4) (STYLE_GUIDE §6.1 known limit); the legend keeps the kind order ETFs, stocks, managed funds, crypto. Donuts fold past six slices into "Other" (STYLE_GUIDE §6.1). A negative adjustment segment is drawn below zero, never in `--stop` (it is not a loss).

---

## 6. Web spec (`apps/web`)

### 6.1 Routes and files
- Typed routes replace the four placeholders: `/cash` → `CashPage`, `/side-income` → `SideIncomePage`, `/budget` → `BudgetPage`, `/dividends` → `DividendsPage` (`validateSearch`: an optional positive-int `holding` filter). `pages.ts` is unchanged.
- Files: `src/pages/cash/**`, `src/pages/sideIncome/**`, `src/pages/budget/**`, `src/pages/dividends/**`, shared helpers in `src/pages/cashflow/**` (period labels, money and rate cells, the workbook-row callout, settings forms). No folder named `data`.
- `packages/ui`:
  - a **`Meter`** (`src/core/content/Meter.tsx` + CSS + test + export): a horizontal progress bar with an uppercase label, the value and target as text; `role="meter"` with `aria-valuemin=0`, `aria-valuemax` = the target, `aria-valuenow` **clamped** to [0, target] and `aria-valuetext` in money with the true figure ("$X of $Y", "Over by $Z"); the fill is clamped at 100 % while the text keeps the true value (the STYLE_GUIDE §6.2 gauge rule); teal fill on a 16 % teal track; a status word ("Reached", "Over by $X", "Short by $X") so status is never colour-only. Used by the savings goals, the cash target and the EOY goal (the emergency fund is a KPI tile, not a meter).
  - **additive props** (web owns these edits, each with a test and a Scaffold note): `labelHidden?: boolean` on `FieldFrame` and `MoneyField` (a visually hidden label that still names the input, for the inline balance cells), and `list?: string` on `TextField` (a `datalist` id, for the budget category).
- **Colour of negative figures** (D33; STYLE_GUIDE §8): the stop tint (red) only for a **negative savings figure or savings rate** (a real shortfall) and a **negative balance on any account kind** (money owed). Flows stay in body text: cash gain, added investments, adjustments, deposits (a reversal), dividends, the cash-savings row, spend and actual spend (`Amount`/`MoneyCell` with the Stage 2 `loss` flag off). Web tests assert both treatments.
- **Teal table cells** (Stage 2 precedent: at most one teal table cell per page besides the key KPI): Cash — none (group subtotals and the accounts `KeyValueTable` are white bold); Side Income — none; Budget — the "Left over" total of the leftover-split table only; Dividends — none (the FY table's all-time total row is white bold). Every other `ColumnTable` total has no `keyColumnId`.

### 6.2 API layer (`src/api/hooks.ts` additions)
- Query keys: `['cash']`, `['side-income']`, `['budget']`, `['dividends']`; each page refetches every 60 s while visible.
- Mutations: one hook per endpoint of §4.2. **Every Stage 3 mutation** invalidates `['cash']`, `['side-income']`, `['budget']`, `['dividends']`, `['investments']`, `['instruments']`, `['records']`, `['import']` and `['status']` (`invalidateAfterCashflowChange`). The Stage 1 import and price invalidations, and the Stage 2 `invalidateAfterInvestmentChange` (trades and instruments feed added investments, the last-buy date, units at the ex-date and the suggestions), also cover the four new keys.
- Value imports from `@joinr/schema` root only (enums, the request-schema factories for client validation, `settingDef`, `isWorkbookSetting`, `EDITABLE_SETTING_KEYS`); DTO types with `import type`.

### 6.3 Cash page (desktop ≥ 1200 px; STYLE_GUIDE §3–§6, §8, §10)
1. **`PageHeader`** "Cash" (sub-line "Cash flow"); actions **Update balances** (primary) and **Add account** (secondary).
2. **KPI tiles** (6 at span 4): **Total cash** (the only teal figure; hint "Offsets $X not included" when offsets exist) · **Last period saved** ($; the hint carries the rate and month, "37.5% of income · Aug 2026"; no delta arrow) · **Saved per month** (12-month average, adjusted) · **<FY2026–27 | 2026> savings rate** (weighted; hint "N periods") · **3-month trend** ("−1.5 points / month" with an arrow and "Decreasing"; null → "—" "Needs two recorded periods") · **Emergency fund** ("Covered" or "Short by $X" status badge, the target, and what counts, from `emergencyFund.loansIncluded`/`offsetsIncluded`: "Total cash except loans you've made (credit cards and other accounts count)" (D59: `loansIncluded` is false) or "Total cash", + ", plus offsets" when D56 is on).
3. **`SectionBar` "Accounts"** (primary): one `ColumnTable` per kind group that has accounts, in the order Bank accounts · Credit cards · Loans you've made · Other · Offset accounts (not in Total cash); each group has a subtotal row (white bold, no teal). The group tables share column min-widths so their columns line up. Columns: Account · Balance · As of · Source ("Workbook"/"App", muted) · Actions (Edit, History); no Kind column (the group heading says it). A row whose `countsForEmergencyFund` is false carries a muted "Not in the emergency fund" marker. Under the groups a `KeyValueTable`: Total cash, Available cash (total − loans), Emergency-fund cash. Negative balances follow §6.1 (stop tint on any kind: money owed).
   - **Update balances (D58):** one `<form>` wraps every group table; the shared **As of** `DateField` (default today, max tomorrow), an optional shared **Note** (applied to every changed row) and Save/Cancel sit once, under the "Accounts" `SectionBar`; every Balance cell becomes a `MoneyField` (`allowNegative`, `labelHidden`, accessible name "Balance, <account>"); Enter saves; Save sends the changed rows only (`PUT /api/cash/balances`); Cancel restores; the provisional period updates after save. When the chosen as-of is before a changed row's `balanceAsOf`, that row shows an inline note "Older than the latest balance (dd/mm/yyyy): added to the history only." Changing an imported account's balance shows the workbook callout (§6.8).
   - **Account form** (create/edit): Name, Kind (`Select`: Bank account, Credit card, Loan you've made, Other), Offset (`Switch`, "Offset account: kept out of Total cash"), Note; create adds Opening balance + As of. A kind-only change on a workbook account shows a note callout "Changing only the kind keeps re-import available" instead of the workbook callout.
   - **History:** a `ChartCard` "Balance history" with an account `Select` (default: the account with most entries), a one-series `LineChart`, and the table view (As of, Balance, Note, Source, Delete). The last entry of an account has no Delete (409 otherwise).
4. **`SectionBar` "Savings"** (supporting/teal):
   - A `Segmented` switch **Adjusted | Raw (as the sheet)**; the table and charts follow it.
   - **Savings table** (`ColumnTable`, newest first): Period (`Aug 2026`; the provisional row reads "Sep 2026" with a `StatusBadge` "Provisional"; the first row "Baseline") · Cash · Cash gain · Added investments · Adjustment · Savings · Income · Savings rate · Spend · Note · Actions (**Details** on every row but the baseline; **Adjust** on closed rows only; **Note** on the baseline and closed rows; the provisional row has Details only, because its month can change before it is recorded, §2.3). A rate above 100 % or below 0 % shows a check badge "Check" linked by `aria-describedby` to a visible foot note: "Check: a one-off inflow or outflow usually causes a rate above 100 % or below 0 %; add an adjustment."
   - **Details** opens an inline `Card` under the table with a `KeyValueTable` of the period's parts, the same on desktop and phone: trades, other assets, super, mortgage principal, property deposit (= Added investments); salary, side income, cash dividends, other dividends (= Income).
   - **Adjustment form** (inline `Card`): Amount (`MoneyField`, `allowNegative`, hint "A one-off inflow that isn't income, such as an asset sale or a loan repaid. It is taken out of savings."), Note (required); Save / Remove. Callout note: "Adjustments are kept when you re-import the workbook."
   - **Note form:** one `TextField` (500 chars); saving empty text removes the note.
   - `orphanAdjustments` → a `Callout note` "An adjustment for Jul 2025 has no recorded period" with Remove.
   - **Charts** (three `ChartCard`s, Chart | Table): Cash value history (bars, one series), Savings history (stacked bars), Savings rate (`LineChart` with the trend series, legend "Savings rate", "3-month trend").
   - Foot notes: "The first recorded month is the baseline." · "Recording a month arrives in Stage 5; until then the current period stays provisional." · when `staticUntilStage4`: "Other assets, super and the mortgage use the imported figures until Stage 4."
5. **`SectionBar` "Goals"** (supporting):
   - **Cash target** and **End-of-year cash goal** (`Meter`s with a `KeyValueTable`: target, projected at <30 June 2027 | 31 Dec 2026>, a surplus/gap per month over the months left, "7 months to go · Mar 2028" or "Reached" or "Not saving at the moment"). Both measure **available cash** (D59): the meter's label is "Available cash" and a muted line under the pair says "Available cash is total cash minus loans you've made. The projections add your average monthly cash saved."
   - **Savings goals (D55, D59):** a list of `Card`s in waterfall order, each with a `Meter` (allocated / target), the ETA ("About Mar 2027 at $X a month toward goals"), "On track" / "Behind" status badges when a target date exists and the required monthly amount; actions Edit, Delete, Move up, Move down. **Add goal** opens the form (Name, Target, Target date optional, Note). A line under the list, from `goals.cashBasis`: `'available'` (D59): "Saved toward goals: $X = cash above the emergency fund, excluding loans you've made, + N% of investments."; `'total'`: "… = total cash above the emergency fund + N% of investments.". The share is edited in the page settings.
6. **`SectionBar` "Settings for this page"** (reference/violet): a `KeyValueTable` + Edit form for Year basis (Financial year / Calendar year), Count mortgage principal as savings, Offsets count toward the emergency fund, Cash savings target, End-of-year cash goal, Share of investments counted toward goals. Workbook keys show the workbook callout on edit (§6.8); the year basis does not.

### 6.4 Side Income page
1. **`PageHeader`** "Side Income"; actions **Add deposit** (primary), **Add stream** (secondary).
2. **KPI tiles** (6 at span 4): **This FY so far** (the teal figure) · Average per period this FY · Projected this FY · 365-day average · Lifetime · **In the budget** (the value is a link to the Budget page: "Included: $X a month" or "Not included").
3. A `Callout note` (D49): "Only interest from loans you've made counts as side income. A principal repayment moves money between your accounts, so it is not income."
4. **`SectionBar` "Deposits"** (primary): filters (Stream, FY); `ColumnTable` Date · Stream · Amount · Period · Note · Source · Actions (Edit, Delete); newest first; the caption shows the count.
5. **Deposit form:** Stream (`Select`), Date (default today), Amount (`MoneyField`, `allowNegative` for a reversal; zero rejected), Note.
6. **`SectionBar` "By period"** (supporting): `ChartCard` "Side income by period" (stacked bars by stream, legend) with the table view; the periods table: Period (the provisional badge in this cell) · Dates (`16/03/2021 – 15/04/2021` for runs on 15/03 and 15/04: a later period starts the day after the previous run) · one column per stream · Total (white bold, no teal) · Note (editable on recorded periods only; the provisional row has no Note action, §2.3). Deposits outside every period: a muted line "Before the first recorded month: $X".
7. **`SectionBar` "Streams"** (reference): name, deposits, lifetime; Rename, Archive (hidden from the deposit form), Delete (only with no deposits).

### 6.5 Budget page
1. **`PageHeader`** "Budget"; actions **Add item** (primary), **Add yearly expense** (secondary).
2. **KPI tiles** (6 at span 4): Monthly income (hint "Net pay × <weekly | fortnightly | …> factor" + " + side income" when D53 is on) · Planned spend · **Left over each month** (teal) · Emergency fund (hint "N months of spending, rounded up to $1,000" or "Set by you"; null → "—" with "Set pay and budget settings above") · Planned savings rate (automatic rows) · Actual spend (6-month average, adjusted; "—" with "Needs recorded months" when null; when negative a check badge and the hint "Savings exceeded income in some months; add one-off adjustments on the Cash page").
3. **`SectionBar` "Income and settings"** (supporting): `KeyValueTable` of pay frequency, net pay, pay day, job start date, include side income (with the 365-day figure), emergency-fund months and override, automatic investment split, use the budget for the amount to invest; **Edit** opens a form (the workbook callout applies, §6.8). `missing` → a `Callout note` listing the setting labels.
4. **`SectionBar` "Budget items"** (primary), two `ColumnTable`s with the columns Item · Category · Account · Monthly · % of income · Weekly · Yearly · Actions, so each total equals its visible rows:
   - **Spending:** the items and the "Yearly expenses (automatic)" row, in display order; total row "Planned spend" (no teal).
   - **Leftover split:** "Investment savings (automatic | manual)", "Cash savings (automatic)" and an "Unallocated (rounding)" line (`summary.unallocatedCents`; shown only when non-zero); total row "Left over" (the page's one teal table cell, §6.1).
   - The automatic rows carry a muted "Automatic" pill; savings lines get a "Savings" pill.
   - **Item form:** Name, Monthly, Category (`TextField` with `list` → a `datalist` of existing categories), Account (`Select` of every cash account, "No account"). An imported row with a stale account name shows a check badge "Account not found: choose one".
   - **Automatic rows:** Edit sets Category and Account; with the split **off**, the investment row's Edit also takes **Amount per month** (D54) with the hint "The rest of the leftover goes to cash savings"; an amount above the leftover shows a `Callout important` "The cash savings row is negative".
   - With the split **on**: a line "Split: 60% investments / 40% cash (target cash 15%, normal)" (from `investShareRatio`, `cashShareRatio`, `cashTargetRatio`, `aggressiveness`); below the emergency fund: `Callout important` "Cash is below the emergency fund, so the whole leftover goes to cash."
   - Reorder: Move up / Move down on items and the yearly row.
5. **`SectionBar` "Yearly expenses"** (supporting): Name · Year cost · Monthly; the fund row "Set aside each month (rounded up to $5)" (white bold, no teal); Edit/Delete; add form (Name, Year cost).
6. **`SectionBar` "Payday transfers (<pay frequency>)"** (supporting): Account · Per pay · Monthly; stale names show the check badge; the unassigned line; the total per pay vs the net pay ("$X of $Y each pay"; the total row white bold, no teal).
7. **Charts** (`Grid` 6/6 then 12): donut "By item" and donut "By category" (`DonutChart`, no target ring, centre "Monthly" with the total), bar pair "Planned vs actual spend" with the Adjusted | Raw switch.

### 6.6 Dividends page
1. **`PageHeader`** "Dividends"; actions **Add dividend** (primary) and **Check Yahoo** (secondary), following the Prices page pattern (`PricesPage.tsx`): in mode off the button is **hidden** and a `Callout note` says "Yahoo suggestions are off (market data is switched off)"; in fake mode a "Test data" `Pill` sits beside it; "Checking…" while running. Freshness under the header with `formatTimeOrDate`: "Yahoo checked 23/09/2026 · 4 holdings" (a time when today). After a check a `LiveRegion` callout shows the summary ("Checked N holdings: M suggestions") or, on failure or a partial run, a `Callout do-not` with `events.lastError` or the summary's failed/skipped counts.
2. **KPI tiles** (6 at span 4): **This FY** (teal) · Projected this FY (hint "From N days of the FY") · Last 12 months · Last FY · All time · Reinvested this FY.
3. **`SectionBar` "Suggestions from Yahoo"** (primary; shown whenever the mode is not off and a check has run, `events.lastRefreshAt` set): rows Holding · Ex-date · Units then · Per unit · Estimated amount · Expected paid · Status (`StatusBadge` "Due" check; "Upcoming" as a muted `Pill` (na)) · Actions. **Due** rows offer **Confirm** and **Dismiss**; **Upcoming** rows show "Expected about dd/mm/yyyy" and offer **Dismiss** only. Confirm opens the dividend form **inline under that suggestion's row**, pre-filled (holding, ex-date, payment date = the expected date, net = the estimate, reinvested = the holding's DRP; the price at ex-date field left **empty** with the cached close in its hint, "Yahoo close before the ex-date: $X; left blank, it is filled from Yahoo", so the server stores it with `priceAtExManual = false`) with the note "Estimated from Yahoo; enter the amount that reached your account." With nothing due or upcoming the section says "No missing dividends found (checked dd/mm/yyyy)". Dismissed suggestions sit in a closed `<details>` "Dismissed (n)" with Restore (always reachable while the section shows). A `Callout note`: "Suggestions cover ASX listings in AUD. Amounts are before any withholding; franking is not tracked."
4. **`SectionBar` "Ledger"** (reference/violet): filters (Holding, Kind, FY; `?holding=` preselects); `ColumnTable` Paid · Holding · Kind · Ex-date · Net · Reinvested · Price at ex-date · Units then · Yield · Source · Actions. Unlinked rows show the typed ticker with a check badge "Not linked".
5. **Dividend form:** Holding (`Select`, options ordered by kind and labelled with it, "ETF · ASX:ABC"), Payment date, Ex-date (optional; "Needed for the yield"), Net amount, Reinvested (Yes / No / Unknown), Price at ex-date (optional; hint "Filled from Yahoo when left blank and an ex-date is known"), Note.
6. **`SectionBar` "By financial year"** (supporting): `ChartCard` (grouped bars by kind per FY, series order per §5) + table FY · ETFs · Stocks · Managed funds · Crypto staking · Total (the five FYs ending with this one, zero rows included, plus older FYs with payments), with the all-time total row (white bold, no teal).
7. **`SectionBar` "Last 12 months"** (supporting): stacked monthly bars + table.
8. **`SectionBar` "This FY by holding"** (supporting): Holding · Net this FY · Payments · Frequency · DRP · Yield (12 months, annualised) · Months to +1 unit · Advice (`StatusBadge`: "Switch DRP on" check, "Switch DRP off" check, "Keep" go; "—" when unknown). A `Callout note` explains the 6-month rule. Unlinked this FY: a muted line.

### 6.7 Changes to the Stage 2 pages
- **Next-buy card:** the foot line becomes "From your budget" linking to `/budget`; `IMPORTED_BUDGET_NOTE` and the deferred callout are removed; the parcel row reads "Every N months · $X" and, when `cashDeficitMonths > plan.months`, "Every M months while cash tops up to its target (normally every N months)" (the countdown uses max(N, M), §2.12); the `split_off` status line text becomes "Automatic investment split is off and the investment amount is $0" with "Set an amount on the Budget page" (a link) (D54). `MISSING_INPUTS_FOOTER` becomes: pay and budget settings and budget items are set on the Budget page (a link); everything else in the workbook, or on the Settings page in Stage 5.
- **Holding detail:** the dividends table keeps reading `HoldingDetailResponse.dividends`; its note becomes a link "Edit on the Dividends page" (`/dividends?holding=<id>`).
- **Import page:** the D34 blocked message adds "Savings goals, one-off adjustments and dismissed suggestions are kept by a re-import."

### 6.8 Forms (shared rules; Stage 2 §6.6 patterns)
- Inline `Card` forms, one open at a time; focus the first field on open and return it on close; Save disabled while pristine or pending (`aria-busy`); API `VALIDATION_ERROR` issues mapped by path; `IMPORT_IN_PROGRESS` → `Callout do-not` "An import is running; try again shortly"; 409s → `Callout do-not` with the server message.
- **Workbook rows** (`origin = 'import'`) and **workbook settings** (`isWorkbookSetting`): the form shows `Callout important` "This came from the workbook. Saving (or deleting) it counts as an app edit: re-importing the workbook will then be blocked." Exceptions: an account kind-only change, adjustments, goals, dismissals and the year basis (a note instead: "Kept when you re-import").
- **New app rows:** while `hasAppData` is false (the `['import']` runs query), every create form that writes an import-owned row (account, balance update, deposit, stream, budget item, yearly expense, dividend, a confirmed suggestion) shows a one-line `Callout note` "Saving adds app data: re-importing the workbook will then be blocked." (not on goals or adjustments, which are overlays).
- Delete confirms in the row's Actions cell ("Delete? [Delete] [Cancel]", focus on Cancel, Escape cancels), as Stage 2.
- Money fields use `MoneyField`; percent fields use `ratioFromPercentText`/`percentTextFromRatio`; dates `DateField` (max tomorrow where the schema says so).

### 6.9 Phone (375 px; STYLE_GUIDE §3, D31)
- One column; tiles stack; forms one field per row; buttons full width; **no page-level horizontal scroll**; tables scroll in their containers with the first column sticky.
- Status-first column orders (every desktop column appears; badges stay in their first-column cell):
  - accounts (per group): Account, Balance, As of, Actions, Source
  - savings: Period (with its Provisional/Baseline badge), Savings rate, Savings, Cash gain, Cash, Added, Income, Spend, Adjustment, Note, Actions
  - deposits: Date, Amount, Stream, Note, Actions, Period, Source
  - side-income periods: Period (with the provisional badge), Total, streams…, Dates, Note
  - budget spending and leftover split: Item, Monthly, Account, Category, % of income, Weekly, Yearly, Actions
  - yearly expenses: Name, Monthly, Year cost, Actions
  - transfers: Account, Per pay, Monthly
  - ledger: Paid, Holding, Net, Reinvested, Kind, Ex-date, Yield, Units then, Price at ex-date, Source, Actions
  - suggestions: Holding, Status, Estimated amount, Expected paid, Ex-date, Actions, Units then, Per unit
  - FY table: FY, Total, then kinds
  - holdings this FY: Holding, Advice, Net this FY, Payments, Months to +1 unit, Yield, Frequency, DRP

### 6.10 States
- **Loading / error:** `Loading` "Loading cash…", `LoadError` "Could not load the cash page" with Retry (each page).
- **Empty:** Cash with no accounts → `Callout note` "No cash accounts yet. Add one, or import the workbook on the Import page." · no snapshots → the Savings section shows "Savings start after the first recorded month. Import the workbook for past months; recording arrives in Stage 5." · no savings goals → "No goals yet. Add one to track saving toward it." · Side Income with no streams → "Add a stream to start logging deposits" · no deposits → "No side income yet" · Budget with no items → "No budget items yet" · Dividends with none → "No dividends yet".
- **Null figures:** the year savings-rate tile null (early in a year) → "—" with "No recorded months in <FY2026–27 | 2026> yet"; the emergency-fund target null (Cash and Budget) → "—" with "Set pay and budget settings on the Budget page".
- **Provisional:** the provisional row and live chart points (§5).
- **Stale:** `goals.stalePriceCount > 0` or `goals.unpricedCount > 0` → the goals line adds "Investments use stale prices" or "N holdings without a price are left out"; events older than 7 days → "Yahoo last checked 12 days ago"; market off → §6.6 item 1.
- **After a mutation:** a `LiveRegion` announces "Balance saved", "Deposit added", "Budget item saved", "Dividend added", "Suggestion dismissed", "Goal saved", "Settings saved".

---

## 7. Roles, tasks and FILE OWNERSHIP

### 7.0 Rules (all agents; Stage 2 §7.0 carried over)
- **Ownership:** edit only files you own (§7.1). Need a change elsewhere? Report it; the coordinator routes it. Never work around a contract gap in another owner's file.
- **Frozen contracts:** §2.2, §3.1–3.4, §4 (endpoints, schemas, DTO fields, codes), §4.6's interface. Internal modules are free; changing frozen names, fields or signatures needs the coordinator's approval and a Scaffold note.
- **No installs** after the Scaffolder; a missing package → stop and report.
- **Stubs** the Scaffolder creates become the named owner's files; replace them in place.
- **Scoped runs** while others work (§1.4); keep your files compiling at every step.
- **Privacy:**
  - Never paste owner values (from the workbook, an owner import's API, `docs/private/`) into a tracked file, test, fixture, comment or doc. Run `pnpm guard:all` before you finish.
  - A guard hit on a value you believe is generic means **change your value**. Never edit `docs/private/guard-terms.txt`; report the hit.
  - **No snapshot files**; assert explicit fields.
  - Anything printed from an owner import (symbols, account names, notes, check ids, API bodies) stays in git-ignored `artifacts/` or `docs/private/`; reports give counts and template cell refs only.
  - **Golden tests** hold template cell addresses and rules only (§9).
  - **Yahoo:** tests mock `fetchImpl`; no test touches the network. Live probes (the Verifier's #12 only) use generic well-known symbols or the owner's own scratch import, never more than one refresh per run.
- **Coordinator pre-step** (before the Scaffolder): stop any running dev server (a `tsx watch` server on `data/` would hot-reload onto in-progress code and could apply the draft migration); back up `data/finance.db*` to a git-ignored `data/backups/pre-stage3-<date>/`; append the terms of `docs/private/stage-3-private.md` §8 to `docs/private/guard-terms.txt`; re-run `pnpm guard:all` (it must stay clean).

### 7.1 Ownership table (every new or changed Stage 3 file has exactly one owner)
| Owner | Files |
|---|---|
| **scaffolder** | **Schema:** `packages/schema/**` (enums, tables, `db/index.ts`, rows + parity, records, settings, `dto/cashflow.ts`, errors, the `dto/investments.ts` timing additions, `fixtures/cashflow.ts`, coverage, `sampleDtos.ts`, `testing/{seed,dump}.ts`, index exports, schema tests). **Engine contract:** `packages/engine/src/types.ts`; `packages/engine/src/index.ts` (stubs + the `engine` value + `CASHFLOW_ENGINE_IMPLEMENTED`; → engine). **Migration:** `apps/server/migrations/**` (`0003_*` + meta). **Tests the migration or schema change breaks:** `apps/server/test/{migrations,app,db,backup,records-routes}.test.ts` (→ server-api after scaffolding), `packages/schema/test/**`. **Importer flag:** `packages/importer/src/testing/index.ts` (only `IMPORTER_STAGE3_IMPLEMENTED = false`; → importer). **Config:** `eslint.config.js` (§2.1 rules). **Server stubs:** `apps/server/src/routes/{cash,sideIncome,budget,dividends,settings}.ts` (501; → server-api), `apps/server/src/app.ts` (registrations, optional `dividendEvents`, the shared `Cooldowns` wiring in `defaultServices`; → server-api), `apps/server/src/records/index.ts` (the minimum for the new entities; → server-api), `apps/server/src/market/dividends/index.ts` (the frozen §4.6 interface, options type, factories and an off-mode implementation; → market-events), `apps/server/src/market/service.ts` (only the optional `cooldowns` option; → market-events). **Compile and expectation fixes the contract forces** (minimal edits only, each listed in the Scaffold notes; → the file's owner afterwards): `apps/server/test/investments/helpers.ts` (neutral fakes for the 13 new `EngineApi` members), `apps/server/src/investments/timing.ts` (`cashDeficitMonths: null`), `apps/server/test/investments/{builders,integration,routes}.test.ts` (the new timing field; the seeded cash totals with the loan account), `packages/engine/test/api.test.ts` (the member list), `apps/web/src/pages/investments/display.ts` (only if the widened `budget.source` breaks a typed map), and any other file the typecheck or `pnpm test` names for the same reason. **Web stubs:** `apps/web/src/router.tsx` typed routes, `apps/web/src/pages/{cash,sideIncome,budget,dividends}/*Page.tsx` (→ web). **e2e:** `e2e/ui-core.spec.ts` (only `/budget` → `/super` in the short-page test; → Integrator). |
| **engine** | `packages/engine/**` except `src/types.ts`: `src/index.ts` after scaffolding, every module, `test/**` incl. `test/golden/**` (the Stage 2 goldens stay unchanged, D61) and `test/purity.test.ts`. |
| **server-api** | **Source (after scaffolding):** `apps/server/src/cashflow/**`, `src/routes/{cash,sideIncome,budget,dividends,settings}.ts` (incl. the suggestion refresh, dismiss and restore routes, which use only the §4.6 interface and the `dividend_events`/`job_runs` tables), `src/app.ts`, `src/investments/**` (the live timing chain, loader and context), `src/db/queries/{domain,settings}.ts`, `src/records/index.ts`. **Post-scaffold owner of `packages/schema/**`** (DTO, fixture or seed fixes another agent reports; each needs the coordinator's OK and a Scaffold note; the seed's entries removal is pre-approved). **Tests:** `apps/server/test/cashflow/**`, `test/golden/cashflow.golden.test.ts`, `test/golden/investments.golden.test.ts` (only where the live chain changes an assertion), `test/investments/**` (only where the live chain changes an assertion), `test/{migrations,app,db,backup,records-routes}.test.ts` (after the Scaffolder; e.g. when the seed's entries removal breaks the Stage 1 upgrade test). **Docs:** `README.md` (the Stage 3 APIs, D34 overlays, the dividends job), `docs/ARCHITECTURE.md` (the finance context, the dividend-events service). |
| **market-events** | **Source (after scaffolding):** `apps/server/src/market/dividends/**` (the service, the job, targets, the Yahoo request, `parseYahooDividends`, writes, status), `src/market/providers/{yahoo,fake}.ts` (the events parser hooks and fake events only), `src/market/service.ts` (only the optional shared `cooldowns`). **Tests:** `apps/server/test/market/dividends*.test.ts`. Works against the frozen §4.6 interface; never edits routes, `app.ts` or the page builders (report a gap instead). |
| **importer** | `packages/importer/**` except the Scaffolder's flag line: `src/{writer,reconcile,extract,model,process}.ts`, `src/testing/**` (the synthetic workbook when a test needs it; the flag after scaffolding), `test/**`. |
| **web** (phase A) | `apps/web/src/**` (router after scaffolding, `api/**`, the four page folders, `pages/cashflow/**`, `pages/investments/{NextBuyCard,HoldingDetailPage,display}.ts(x)` and their tests, `pages/import/ImportPage.tsx` copy, `app.css`), `apps/web/test/**` (supplementary fixtures under `test/fixtures/**`), `packages/ui/src/core/content/Meter.tsx` + its CSS, test and index export, the additive props of §6.1 in `packages/ui/src/core/forms/{Field,MoneyField,TextField}.tsx` and `forms.test.tsx` (nothing else in `packages/ui`), drafts of `e2e/{cashflow.spec.ts,cashflow-states.spec.ts,cashflow-mutations.spec.ts,cashflow-support.ts}`. |
| **integrator** (phase B) | Takes over web's files and the e2e drafts, plus `e2e/{ui-core.spec.ts,records.spec.ts,import.setup.ts,investments-support.ts,support.ts}` and `playwright.config.ts` (the `cashflow-mutations` project). After engine, server-api, market-events and importer report done, their files pass to the Integrator for integration fixes only (each listed in its report). |
| coordinator | `PLAN.md` · `docs/HANDOFF.md` · `docs/DECISIONS.md` · `docs/STAGE_PROCESS.md` · `docs/stages/**` (implementers append only to "Scaffold notes") · `CLAUDE.md` · `docs/style/**` · `docs/private/**` · `reference/**` |

### 7.2 Scaffolder (alone; done-check before hand-over)
1. **Schema** per §3.2–3.3 and §3.6: enums, tables, `db/index.ts`, rows + parity, records (+ the records fixtures), settings (key, label, `EDITABLE_SETTING_KEYS`, `isWorkbookSetting`), `dto/cashflow.ts`, errors, the timing DTO additions, fixtures (`cashflow.ts`, `investmentPageTiming` update, coverage), seed and dump. **Tests:** every request schema (bounds, strictness, `''` → null, unique ids, `exDate ≤ paymentDate`, the not-editable key message, the date bound with an injected `now`), fixture coverage, every fixture parsing where a schema exists, the seed's new rows.
2. **Migration** `0003_stage3_cashflow` (§3.1): generate, append the data statements, `git diff --exit-code` on `0000`–`0002`. Tests: a fresh DB reaches `COMMITTED_MIGRATION_COUNT` (4) with every table; **a 0002 database with data** (the Stage 2 raw-SQL approach: a migrated in-memory DB, drop the new tables, stop at 0002, then insert **its own raw rows**, independent of the seed: cash accounts with balances and as-of dates, and `side_income_entries` for two streams including a zero amount (skipped), a null period end (dated at the month end), a period end after the latest `balance_as_of` (dated at that as-of) and an `app`-origin row; upgrade) converts: one balance entry per account with its balance, as-of, origin and sheet ref; one deposit per non-zero entry with the expected date, origin and sheet ref; `side_income_entries` empty; `hasAppData` unchanged.
3. **Engine skeleton:** `types.ts` complete (§2.2, incl. the additive Stage 2 changes); `index.ts` stubs, `engine` value, `CASHFLOW_ENGINE_IMPLEMENTED = false`, `yearWindow` may be real; the type-level test that `engine` satisfies `EngineApi`. The compile and expectation fixes the contract forces in Stage 2 files (§7.1 Scaffolder row; each listed in the Scaffold notes).
4. **ESLint** engine rules (§2.1).
5. **Server stubs:** the five route files answer 501 `NOT_IMPLEMENTED` for every §4.2 route (a local `sendNotImplemented`), `no-store`; `app.ts` registers them with `{ prefix: '/api', database, config, market, dividendEvents, now, engine }`; `AppServices.dividendEvents?` + the off fallback; `market/dividends/index.ts` (the frozen §4.6 interface, options, `createDividendEventsService` returning the off service until market-events replaces it, `createOffDividendEventsService`); the optional `cooldowns` option in `market/service.ts` and one shared `Cooldowns` in `defaultServices`; `records/index.ts` loads the new entities and the re-pointed `side-income`.
6. **Web stubs:** the four typed routes; each page renders `PageHeader` with its h1 and a `Callout note` "Arrives with the Stage 3 web work"; `e2e/ui-core.spec.ts` swaps `/budget` for `/super` in the short-page test.
7. **Importer flag** line.
8. **Done-check** (all green): `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` (≥ the 1878 Stage 2 tests + new), `pnpm build`, `pnpm guard:all`; `PORT=3070 WEB_PORT=5170 DATA_DIR=artifacts/stage3/scaffolder/data pnpm e2e e2e/smoke.spec.ts e2e/ui-core.spec.ts` passes (delete the folder first); `/api/health` → `migrations: 4`; `DATA_DIR=artifacts/stage3/scaffolder/data pnpm seed:dev --yes` exits 0; ports free afterwards. Append "Scaffold notes" with every deviation.

### 7.3 engine
1. `periods.ts` (§2.3: windows, the provisional rule, `yearWindow`, DATEDIF months) with boundary tests (a mid-month first snapshot, a gap month, the provisional month when a snapshot already has `isoMonthOf(asOf)`, no snapshots).
2. `cash.ts` (§2.4): every kind, offsets on/off, loans left out of available cash, `loansCountForEmergencyFund` on/off (the server uses off, D59); `monthlyPayCents` for every pay frequency (the same factors as `budgetInvestment`, one shared table) and nulls.
3. `savings.ts` (§2.5): a hand-worked three-snapshot example; the first period; the provisional period; a property purchase; mortgage principal on/off; other assets in and out of windows; side income and dividends by window; reinvested/unknown dividends (raw vs adjusted income); an adjustment (and one on the first period, ignored); zero income; null cash.
4. `kpis.ts` (§2.6): FY and calendar windows; the job-start floor; closed-only averages; the weighted year rate; the trend (2 and 3 points, one date, a flat line); EOY with 0 months left; the projections and the cash target on the **adjusted** average (an adjustment changes them) and from `currentCashCents` (a smaller current cash, as available cash with loans, moves the arrival later and the EOY projection down while the rate is unchanged, D59); the cash target's three statuses, incl. `reached` while not saving (§11 fix 24); the 185-day spend window.
5. `goals.ts` (§2.7): the waterfall (reached, partial, zero), the investment share, below the emergency fund, no progress, target dates (on track, behind, required per month).
6. `sideIncome.ts` (§2.8): the first period's calendar-month window, deposits before/after, FY by deposit date vs periods by start, FY-to-date excluding deposits after `asOf`, the 365-day boundary, a negative deposit.
7. `budget.ts` (§2.9): move `budgetInvestment` here (or keep it in `timing.ts`) and share it; the savings-line display flag (a Savings item stays in the emergency-fund basis, D61); D54 manual amounts (0, below, above the leftover) and `unallocatedCents` (incl. negative); every pay frequency's transfers; stale-name groups; unassigned rows; categories; a missing auto row; `budgetInvestInputOf` round trip; the Stage 2 `budgetInvestment` tests still pass (update only the D54 expectations, listed in the report; the EF basis is unchanged, D61).
8. `dividends.ts` (§2.10) and `suggestions.ts` (§2.11): FY rows with gaps (always the five FYs ending with `asOf`'s, plus older FYs with payments), the rolling window across a year end, advice boundaries (5.9 vs 6 months, DRP unknown), unlinked rows; suggestions matched by ex-date and by the no-ex-date rule (the next quarter is not matched), dismissed, upcoming vs due, the lag median, non-AUD skipped, units ≤ 0 dropped.
9. `cashDeficitMonths` + `investCountdown` with `cashDeficitMonths` (§2.12); `compressCashflow` and `compressSeries` with a year basis (FY and calendar yearly groups and labels; `compressSeries` without the argument unchanged) (§2.13).
10. **Goldens** (§9): `test/golden/cashflow.golden.test.ts` (+ adapter helpers) with `describeWithLocalWorkbook`, printing counts per area and reason only; the Stage 2 golden is not changed (its D3 comparison stays as built, §9.3 rule 9, D61).
11. Purity hardening (§2.1).
12. Set `CASHFLOW_ENGINE_IMPLEMENTED = true` only after the full unit suite (goldens included) passes.

### 7.4 server-api
1. **Context and loaders** (§4.5) with unit tests on a fake engine: the input table row by row (the live salary through `monthlyPayCents`, super for the provisional month, AUD-only other assets, mortgage sums, the EF-test cash to both consumers, the two constants `LOANS_COUNT_FOR_EMERGENCY_FUND` (`false`) and `GOALS_CASH_BASIS` (`'available'`) reaching the engine and the DTO, and available cash as the KPIs' `currentCashCents` while the savings engine's live cash stays total cash (D59): a test with a `loan_receivable` account asserts all of these).
2. **Page builders** for `/api/cash`, `/api/side-income`, `/api/budget`, `/api/dividends`; DTO mapping tests field by field against hand-built engine results; the type-level DTO assignability test (§4.5).
3. **Mutations** (§4.5, §3.4) for every endpoint: origin rules (the kind-only exception; no-op saves), the marker keyed on `sheet_ref`, the 409s, the import lock, balance upserts and recomputation, dividend price auto-fill, the recorded-period 400s (an adjustment on the provisional or first period, a note on the provisional month; an orphan adjustment can still be deleted), settings PATCH (both key classes).
4. **Live timing chain** (§4.5): the Stage 2 investments tests keep passing; new tests for `live_budget`, `cashDeficitMonths` in the countdown and `deferred: []`.
5. **`hasAppData`** (§3.3, §3.4) tests: an app-only setting → false; a workbook setting → true; an overlay → false; a kind-only account edit → false; every import-owned entity → true.
6. **Suggestion routes** with a fake `DividendEventsService`: refresh (503 in off, the summary and status mapping), dismiss/restore (`dismissed_at` set and cleared, 404 for an unknown event), the page's `events` status from `job_runs` and `dividend_events` (≤ 200 chars, no URLs).
7. **Integration tests** gated by `CASHFLOW_ENGINE_IMPLEMENTED`: the seed (and the synthetic workbook when `IMPORTER_STAGE3_IMPLEMENTED`) builds all four pages; a create/update/delete round trip per entity leaves `dumpDomainTables` identical except `app_meta`.
8. **Server golden** (§9.4), gated by `CASHFLOW_ENGINE_IMPLEMENTED && IMPORTER_STAGE3_IMPLEMENTED` and `describeWithLocalWorkbook`, `{ timeout: 120_000 }`.
9. Remove the seed's `side_income_entries` rows once the loader reads deposits (Scaffold note); keep every Stage 1–2 test green.
10. **Docs:** README and `docs/ARCHITECTURE.md` (generic only).
11. **Done means the gated suites ran** (as Stage 2 §7.4 step 9): report "blocked on engine/importer" with everything else green if they have not landed.

### 7.5 market-events (the dividend-events market data; tests only, no server needed)
1. `parseYahooDividends` (§4.6): local dates under daylight saving and standard time, the close before the ex-date across a weekend and a holiday, the first bar being the ex-date, null closes, non-finite or ≤ 0 amounts, `GBp`, `chart.error`.
2. The service and job: targets (kinds, provider, symbol, a trade), the identity check, upserts with `dismissed_at` never touched, a 429/403 stop starting the **shared** cool-down (a price-service cool-down also stops a dividends run), waiting while the `prices` job runs, the run deadline (`partial`), off mode (`MarketDataDisabledError`), registration in `live`/`fake` with interval 0 when `PRICE_REFRESH_MINUTES` is 0 (no timer; a manual run still writes a `job_runs` row), joining a run in flight, the fake provider's deterministic events. All with a mocked `fetchImpl` and a fake clock; no network.
3. Replace the Scaffolder's `createDividendEventsService` stub in place; keep the frozen §4.6 signatures. Report done with `pnpm vitest run --project server test/market`, typecheck, lint and `pnpm guard:all`.

### 7.6 importer
1. §3.5 changes 1–6, each with tests: the synthetic workbook's side income becomes deposits (non-zero cells only, dates at F, the live row's at the as-of, the note stays a period note); one balance entry per account; the kind kept across a re-import (by a unique name; by sheet ref and name when names repeat; a row inserted above keeps the kind; a renamed account gets `bank` and adds the info line); C28 typed vs formula; the settings gap (an `app` row of a workbook key the workbook does not provide, e.g. `budget.emergencyFundOverrideCents` while D3 is the formula default, is deleted by a committed import and `hasAppData` becomes false; one the workbook provides is overwritten; an app-only key is untouched); the reconciliation's re-pointed checks.
2. The idempotency contract still holds (two imports → identical dumps, ids included).
3. The importer golden (`test/golden.test.ts`) still reconciles the owner workbook with zero unexplained lines; update only the counts it prints.
4. Set `IMPORTER_STAGE3_IMPLEMENTED = true` after the suite passes; report counts only.

### 7.7 web (phase A — parallel; no running API needed)
1. API layer (§6.2), display helpers (`pages/cashflow/display.ts`: period labels, rate text and badges, trend text, FY/calendar labels, advice and status words, transfer headings), the `Meter` component and the additive field props (§6.1).
2. The four pages (§6.3–6.6), the Stage 2 changes (§6.7), forms (§6.8), phone orders (§6.9), states (§6.10).
3. **Unit tests** with mocked fetch on `@joinr/schema/fixtures` (+ supplementary fixtures): every fixture state renders; totals equal the Σ of visible rows (incl. both budget tables and the unallocated line); the Adjusted | Raw switch; the provisional and baseline rows (their allowed actions) and Details; the rate > 100 % badge and its visible explanation; the negative-figure colours of §6.1; update-balances mode (only changed rows sent, the shared date and note, the older-than-latest row note, the hidden labels' accessible names); the kind-only note vs the workbook callout; the new-app-row note while `hasAppData` is false; the EF tile and goals line following `loansIncluded` and `cashBasis`; goals (reorder, meters incl. over 100 %, ETA text, the stale/unpriced line, none yet); side-income periods and outside deposits; budget auto rows (D54 amount, negative cash row warning, stale account badge); transfers per frequency heading; dividends suggestions (Confirm only on due rows, the inline pre-fill with an empty price, dismiss/restore, none found, the check summary and error callouts, off and fake modes), advice badges, the `?holding=` filter; the next-buy card copy (`live_budget`, cash-deficit months, `split_off` text, the missing-inputs footer); the null and empty states of §6.10; phone column orders via `matchMedia`; every form's pristine/pending Save and error mapping.
4. `RootLayout.test.tsx` and `router.test.tsx` updates if needed.
5. **Draft** the e2e files (§7.8); report "phase A done" with typecheck, lint and unit results.

### 7.8 Integrator (phase B — starts when engine, server-api, market-events and importer report done)
1. Run the stack on 5185/3185 (fresh `artifacts/stage3/integrator/data`, `MARKET_DATA_MODE=fake`, synthetic import); fix integration defects in web files (other owners' files for integration fixes only, listed).
2. **`e2e/cashflow-support.ts`:** `E2E_NOTE` reuse; `cleanupCashflowRows(request)` removes rows whose note (accounts, deposits, dividends, entries, adjustments) or name (budget items, yearly expenses, streams, goals) starts with `E2E_NOTE`; `mockCashflowPage(page, route, fixture)` like `mockInvestmentPage`. `e2e/import.setup.ts` calls it before the import; `investments-support.ts`'s cleanup is kept.
3. **`e2e/cashflow.spec.ts`** (desktop + phone, read-only): each page's h1, KPI tiles, the main table rows, charts render (`svg` or the empty message), no page horizontal scroll, no console errors, screenshots; the dividends page after `POST /api/dividends/suggestions/refresh` (fake mode) shows suggestions for the synthetic ETFs.
4. **`e2e/cashflow-states.spec.ts`** (both projects, `mockCashflowPage`): screenshots at 1440 and 375 of every fixture state of §3.6; asserts the h1, no console errors and no page scroll.
5. **`e2e/cashflow-mutations.spec.ts`** in a new project **`cashflow-mutations`** (desktop viewport, `testMatch: /cashflow-mutations\.spec\.ts/`, `dependencies: ['mutations']`, so it runs after `trades.spec.ts`); `desktop` and `phone` add it to `testIgnore`. Every row carries `E2E_NOTE`:
   1. Cash: add an account (opening balance) → Total cash changes; Update balances with a new as-of → the provisional period's cash gain changes; delete the extra entry; change an imported account's kind only → `GET /api/import/runs` → `hasAppData === false`; restore the kind.
   2. Add an adjustment on a closed period → the adjusted rate changes and `hasAppData` stays false; remove it. Add and delete a goal (still false).
   3. Side Income: add a deposit dated today → the provisional period and FY-to-date change; delete it.
   4. Budget: add an item → planned spend and the transfers change; add and remove a yearly expense → the fund row changes; delete the item.
   5. Dividends: refresh suggestions (fake), confirm one → the ledger row has the ex-date and the suggestion disappears; delete it; dismiss one → `hasAppData` false; restore.
   6. `afterAll` → cleanup; afterwards `hasAppData === false`. The spec never edits a **workbook setting** (that would leave an `app` settings row, §3.3), and every row it creates is an app row it deletes, which writes no marker. D54 and the settings forms are covered by unit tests, `cashflow-states.spec.ts` and Verifier #9.
6. `e2e/ui-core.spec.ts` (the Scaffolder's swap stays) and `e2e/records.spec.ts` (20 record pages: `test.setTimeout(90_000)`).
7. Screenshots under `artifacts/screenshots/{desktop,phone}/cashflow-*.png`. Run the full e2e suite on your ports (the `mutations` and `cashflow-mutations` projects must run and pass; skipped counts as failed), then write the final report.

### 7.9 Reviewers (report findings; do not edit)
- **spec-correctness:** the engine vs spec 02 and this plan; D49–D62 applied; every §11 fix present except fix 7 (vetoed, D61: the emergency-fund basis must still include the savings lines) and nothing else changed; run the goldens and check every §9.2 area is compared or skipped only for a §9.3 reason, with the counts in `docs/private/stage-3-private.md` §3; check the owner-import expectations of the private §5 through the API on `artifacts/stage3/review-spec/data` (`MARKET_DATA_MODE=off`); no owner values in tracked files.
- **style-ux:** screenshots at 1440 and 375 of the four pages, every form, every fixture state and the Stage 2 next-buy card; STYLE_GUIDE §1–§10 and D6, D7, D17–D20, D31, D33 (one teal figure per page, status never colour-only, red only for losses and money owed, §8 formats incl. `FY2026–27` and U+2212, no page scroll at 375, status-first tables, chart slots, the `Meter`).
- **code-quality/security:** validation at every write boundary; error leakage; `IMMEDIATE` transactions and rollback; the D34 marker and overlay semantics; the settings rule; the migration's data statements; the Yahoo client (timeouts, abort, rate limits, the cool-down shared with the price job, the run deadline, no URL or body in errors, time-zone handling); decimal use; engine purity (lint + purity test); test isolation (no network, temp DBs, no reads of the corrections file outside goldens, no snapshot files); gating flags never faked. A **scratch numeric scan** (`artifacts/stage3/review-code/`, found/not found per file) of the tracked diff against every number with ≥ 4 significant digits in `docs/private/stage-3-private.md`; leave it for the Verifier.

### 7.10 Fixer and Verifier
- **Fixer:** applies the verified findings across owners; contract changes only with the coordinator's approval (Scaffold note); re-runs the affected checks.
- **Verifier:** runs §10 on 5195/3195 with per-item `DATA_DIR`s under `artifacts/stage3/verifier/` (never `data/`); reports pass or fail with evidence; never commits; no owner values in tracked files.

---

## 8. Ports & environment
**No new environment variables.** `PRICE_REFRESH_MINUTES=0` also keeps the dividends job's timer off; the job is still registered in `live`/`fake`, so the refresh route works (§4.6). Playwright keeps `MARKET_DATA_MODE=fake`, `PRICE_REFRESH_MINUTES=0`, `IMPORT_CORRECTIONS_FILE=none`.

| Agent | WEB_PORT | PORT | DATA_DIR |
|---|---|---|---|
| default / owner / `.claude/launch.json` | 5173 | 3001 | `data` (never used by agents) |
| Scaffolder | 5170 | 3070 | `artifacts/stage3/scaffolder/data` |
| engine, market-events, importer | — (tests only; the importer may run the CLI into `artifacts/stage3/importer/data`) | — | — |
| server-api | 5183 | 3183 | `artifacts/stage3/server-api/data` |
| web (phase A) | 5184 | 3184 | `artifacts/stage3/web/data` |
| Integrator | 5185 | 3185 | `artifacts/stage3/integrator/data` |
| Reviewers spec / style / code | 5191 / 5192 / 5193 | 3191 / 3192 / 3193 | `artifacts/stage3/review-{spec,style,code}/data` |
| Fixer | 5194 | 3194 | `artifacts/stage3/fixer/data` |
| Verifier | 5195 | 3195 | `artifacts/stage3/verifier/{e2e,owner,live,prod}` |

- **Dev-server lessons (HANDOFF):** stop the owner's `pnpm dev` before agent work (a `tsx watch` server on `data/` hot-reloads onto in-progress code and can apply a draft migration); under the Claude preview the server gets `PORT=5173` and listens on 127.0.0.1:5173 beside Vite on ::1:5173; confirm ports are free before and after (stage-0 §11 commands); e2e can fail with `net::ERR_NETWORK_CHANGED` when VPN/Tailscale adapters change (re-run).
- Git Bash: `PORT=3185 WEB_PORT=5185 DATA_DIR=artifacts/stage3/integrator/data MARKET_DATA_MODE=fake pnpm dev`. PowerShell: `$env:PORT='3185'; $env:WEB_PORT='5185'; $env:DATA_DIR='artifacts/stage3/integrator/data'; $env:MARKET_DATA_MODE='fake'; pnpm dev`.
- Owner import into a scratch dir: `DATA_DIR=artifacts/stage3/<role>/data pnpm import:workbook --yes`.
- Unit tests use OS temp dirs or `:memory:`; never `data/`.

---

## 9. Golden values & tests (read at runtime; nothing committed)

### 9.1 The sheet-faithful adapter (`packages/engine/test/golden/`)
It reads the local workbook inside `describeWithLocalWorkbook` and builds engine inputs **the way the sheet computed them** (no corrections file; the Stage 2 adapter's ledgers and helpers are reused).
- **As-of** = `Net Worth!E52` (every TODAY()-dependent cell is compared at this date); **last run** = `Net Worth!C51`.
- **Snapshots:** `History` rows from 3 with a date in A: frozen rows (no formula in B) → `SavingsSnapshotInput` from N, R, W, Y, AB, AD (cents, half away from zero, as the importer rounds); the live row (formulas) → `live` = { cash: `Cash!C13`, salary: `History!W` of the live row, super: `History!R` of the live row, property Y, AB, AD of the live row }.
- **Trades:** the four ledgers, all instruments, uncorrected (they reproduce History E/I/M/AI).
- **Other-asset purchases:** `Other Assets` rows with a date in G and currency AUD (or blank): `(H − |L|) × J`.
- **Side-income deposits:** `Side Income` non-zero numeric G/H cells of rows with a date in F, dated `min(F, E52)` (the importer's rule, §3.5 item 1).
- **Dividends:** `Dividends!A4:F500` (E "No" → false, "Yes" → true, blank → null); links as the Stage 2 adapter (exact ticker, the sheet's semantics).
- **Settings:** SheetOptions IDs **41** (include mortgage principal), **2** (pay day), **3**, **13**, **30** by the column-P ID lookup, reading column L for these non-secret IDs only (never IDs 1 and 29; never printed); `Budget!D2` (job start), `Budget!B3`/`B4`/`D4`/`F4`, `Cash!C26` (EOY goal), `Cash!C31` (cash target); `allocation.cash` from `Net Worth!D41`.
- **Cash-deficit inputs (H12):** `cashCents` = `Cash!C13`; `liquidTotalCents` = the Σ of the Stage 2 golden's recomputed class values (`recomputedClassValues`, Stage 2 §9.3 rule 1, with the cash class = `Cash!C13`); `avgMonthlySavingsCents` = the closed-row `C20` recomputation (rule 3).
- **Budget rows:** `Budget` rows 8 → the `Cash Savings -` row (names, C, F account text, G category; the auto rows by their labels); yearly expenses `E32:F60`.
- **Cash accounts:** `Cash!A2:E12` up to the terminator, every account `bank` (the sheet has no kinds), offset from E. So in the workbook available cash equals total cash (`Cash!C13`), and the KPIs' `currentCashCents` (available cash, D59) is `Cash!C13`, exactly what the sheet's `C24`–`C34` use: the sheet-faithful goldens are unaffected by D59.
- **Holdings for the dividends table:** units from each tab's held-units column (Stocks G, ETFs F, MF E, Crypto D), frequency and DRP as the Stage 2 adapter reads them (placeholders → null).
- **Events:** none (the workbook has no Yahoo events); suggestions are unit-tested only.
- **Golden-only helpers** (`cashflowFormulas.ts`): the sheet's KPI formulas over the sheet's own columns, parameterised by "include the live row" and the year basis, used for the recomputed expectations of §9.3.

### 9.2 Cells compared (template references; each read at runtime)
| Area | Cells | Engine output |
|---|---|---|
| **Cash history, per History row** | `Cash!J`, `K`, `L`, `M`, `N`, `P` (rows from 4; row 3 per rule 1; the live row per rule 2) | period `cashGainCents`, `cashGainRatio`, `addedInvestmentsCents`, `raw.savingsRatio`, `raw.savingsCents`, `raw.spendCents` |
| **Cash KPI panel** | `C17`, `C18`, `C19`, `C20`, `C21`, `C22`, `C24`, `C25`, `C26`, `C27`, `C30`, `C31`, `C32`, `C33`, `C34`, `C37`, `C38`, `C39`, `C41`, `C42`, `C43` | `cashKpis` (calendar basis, as the sheet) via rules 3–5 |
| **Side Income** | `C3`, `C4`, `C5`, `C6`, `C7`; per row `E`, `F`, `I` (the live row per rule 2) | `computeSideIncome` periods and KPIs (rules 6–7) |
| **Budget** | `B2`, `F2`, `D3` (rule 9), `J4`, `L7`, `L9`, `C24`, `C28`, `C29`, `L11`, `M4` (rule 3); per item row `B`, `D`, `E`; `A35:B…` (B2 and what follows it per rule 14) | `computeBudget` |
| **Dividends** | per row `H`, `I` (rule 10); `K4:P8` per FY label (K4 the oldest: the engine's `byFinancialYear` row of that FY; labels and values), `L11:P11` (the Σ of those five rows); `K30:K41` dates and `L30:P41`; `K45:R…` rows and `M89` | `computeDividends` |
| **SheetOptions** | `H12` (rule 13), `H27` (rule 6), `H28`, `H30` | `cashDeficitMonths`, side income, dividends KPIs |
| **Stage 2 goldens** | unchanged (D61: `Budget!D3` keeps the sheet's basis) | — |

### 9.3 Cells the sheet itself broke, and fixed definitions: rules detected at runtime (no row numbers hard-coded)
1. **The first History row** (the earliest date): its `J`, `K`, `L`, `M`, `N`, `P` are skipped, reason `first_period` (the baseline; the sheet shows "-", 0 or a manual seed).
2. **The live row** (a History row with formulas in B): compared with the provisional period at `E52` when no trade, other-asset purchase, deposit or dividend is dated in `(E52, EOMONTH(E52)]` (the sheet's live window runs to the month end); otherwise skipped, reason `live_window`. **The Side Income live row** (the row whose `F` is after `C51`) follows the same condition: its `E` and `I` are compared with the provisional side-income period's `start` and `totalCents`; its `F` (the month end, while the engine's `end` is the as-of) is skipped, reason `live_window`. **Server golden only:** the provisional period is also skipped (`live_window`) when the live `History!AC` (mortgage interest and fees) is non-zero, because the server's principal paid has no interest or fees before Stage 4 (§4.5).
3. **KPIs that include the live row** (`C17`, `C18`, `C19`, `C20`, `C21`, `C22`, `C24`, `C25`, `C27`, `C30`, `C33`, `C37`, `C39`, `C42`, `C43`, `Budget!M4`): compared with expectations **recomputed from the sheet's own columns over the rows dated ≤ `C51`** (closed rows; §11 fix 14), counted `recomputed`; `C25` is recomputed as the closed-row `C24` ≥ `C26`, and `C30` with the §11 fix 24 precedence (`reached` first). The cached cell is compared exactly only when no live row exists.
4. **`C27`** is recomputed dividing by the months left (§11 fix 2) and **`C38`** as Σ N / Σ income over the year's closed rows (income = W + side income + dividends as rule 8 decides; §11 fix 15); both `recomputed`.
5. **`C41` (and `C40`)** are skipped when C41's formula regresses a range that does not start at the savings-rate column (detected from the formula text and the row-2 header "Savings Rate"), reason `broken_formula`; the engine's `trendPerMonth` is compared instead with the slope recomputed from the sheet's M and H over the last three closed rows (`recomputed`).
6. **Side Income `C3`, `C5`, `C6` and `SheetOptions!H27`** include the live row (unfilled, counted as 0): the expectation is **recomputed over the closed rows** (the live row excluded; a blank closed row counts as 0, as the engine's empty closed period does) (§11 fix 5), `recomputed`; exact when there is no live row.
7. **Side Income `C4`** is compared exactly unless a filled row straddles the FY start (`E < FY start ≤ F`), then recomputed by deposit date (§11 fix 6).
8. **Dividends in the savings-rate income:** when every dividend row in a window has `E = "No"`, `M`/`P` compare with `raw`; the `adjusted` income adds reinvested and blank rows (§11 fix 12) and is asserted against a recomputation. The KPI cells built on the adjusted income (`C38`, `C39`, the `C41` trend and the year income) are likewise `recomputed` from the adjusted income when such a row falls in their windows. Counted `recomputed` only when such rows exist.
9. **`Budget!D3`** is **compared as cached**: the engine's basis is the sheet's (every item row, savings lines included, plus the yearly fund; §11 fix 7 vetoed, D61). The one remaining difference is the Stage 2 range fix: when the last item row (the row above the investment-savings row, which the sheet's `SUM(C8:C26)` leaves out) holds a non-zero amount, the expectation is recomputed over every item row (Stage 2 §11 fix 15), `recomputed`. The Stage 2 golden is unchanged.
10. **Dividends `H`/`I` of a row with a blank ex-date** (the sheet shows 0 and 0): skipped, reason `no_ex_date` (the engine returns null). Rows linked only the D28 way are compared with the sheet's non-link semantics, as the Stage 2 adapter does.
11. **Never compared:** `Cash!B15` (the next-invest date lives on the ETFs page), the sparkline cells (`C28`, `C35`, `C52`, `Budget!K2`, `L2`), the house-deposit block `C45:C52` (replaced by goals, D55: `replaced_by_goals`), `Dividends!G` (typed input), `Cash!O` (projected cash; always equals I).
12. Every skip and adjusted comparison is counted per reason; each golden test prints `compared: n · skipped: {first_period, live_window, broken_formula, no_ex_date, replaced_by_goals, never} · recomputed: n` per area (rules 1–14). The spec reviewer checks the counts against the private §3.
13. **`SheetOptions!H12`:** "-" ↔ null is exact. A numeric H12 (or the IFERROR `0` when the engine returns null because the average savings is ≤ 0) is **recomputed** with the fixed formula (§11 fix 16) over the §9.1 cash-deficit inputs and the closed-row `C20` (§11 fix 14), `recomputed`.
14. **`Budget!D4` = "Yes"** (side income in the budget): `B2` includes `Side Income!C6`, whose cached value counts the unfilled row (rule 6); `B2` is recomputed with the fixed `C6`, and `F2`, `L7`, `L9`, `L11`, `C28`, `C29` and the per-item `B` are derived from it, all `recomputed` (the Stage 2 golden's `b2Expected` rule). With "No", compared as cached.

### 9.4 Server golden (`apps/server/test/golden/cashflow.golden.test.ts`)
- Setup: a temp DB; `importWorkbook` of the local workbook with **corrections off**; `buildApp` with market `off` and `now` = `E52` at 12:00 local.
- Via `app.inject`:
  - `GET /api/cash`: `totals.totalCashCents` = `Cash!C13`; every closed period's cash gain, added investments and raw savings/rate/spend = the Cash rows (rule 1 for the first); the provisional period = the live row (rule 2, incl. its server-only `AC` condition); the KPIs (FY basis, the default) = expectations recomputed with the FY window by the golden helpers (the import gives every account kind `bank`, so `totals.availableCashCents` = `Cash!C13` and the cash target and EOY expectations use it, D59); `goals.cashBasis` = `'available'`. (Corrections are off here; with the corrections file on, a corrected trade date can move added investments between two periods, which the Verifier's #7 accounts for.)
  - `GET /api/side-income`: `C4`, `C7`, the filled rows' `I` per period; `C3`/`C6` by rule 6.
  - `GET /api/budget`: `B2`, `F2`, `J4`, `L7`, `L9`, `C24`, `C28`, `C29`, `L11`, `D3` (rule 9), the item rows' B/D/E, the transfers `A35:B` (rule 14 when `D4` is "Yes").
  - `GET /api/dividends`: `K4:P8` per FY label as §9.2 (all five FYs), `L11:P11`, `L30:P41` at `E52`, `M89`, `H28`, `H30`.
  - `GET /api/investments/etf`: `timing.cashDeficitMonths` null when `H12` is "-" (rule 13 otherwise); `timing.monthlyInvestCents` still = the recomputed `SheetOptions!H2` (Stage 2 §9.3 rule 6).
- Print counts only.

### 9.5 Tolerances
Cached formula results keep 10 significant digits; every comparison allows `max(listed, 1e-9 × |sheet value|)`.
| Quantity | Tolerance |
|---|---|
| Money per period, row or KPI (cents vs the sheet × 100, half away from zero) | ≤ 1 cent (the planning prototype's worst drift from cents inputs was under 1 cent) |
| Money sums over n periods (C21, C42, C43, the FY sums) | ≤ max(1, n) cents |
| Savings rate, cash gain %, income shares, yields | `max(1e-6, 1e-5 × |v|)` (ratios recomputed from stored cents move by up to ~5e-6; the Stage 1 lesson) |
| Trend per month, weighted year rates | 1e-6 absolute |
| Dates, texts, months, counts, statuses | exact |

---

## 10. Acceptance tests (the Verifier runs every item)
**Run order and isolation:** never `data/`; confirm 5195/3195 are free and delete each item's `DATA_DIR` first; stop servers between groups. Order: **1–5 → 6 (e2e) → 7–11 (owner copy) → 12 (live) → 13 (prod) → 14–16.**

| # | Check | How |
|---|---|---|
| 1 | Install and static checks | `pnpm install` (no prompts), `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`: exit 0 |
| 2 | Unit tests | `pnpm test` green: ≥ 1878 + new; `CASHFLOW_ENGINE_IMPLEMENTED` and `IMPORTER_STAGE3_IMPLEMENTED` true; the gated server suites **ran** |
| 3 | Migrations | `git diff --exit-code` on `0000`–`0002`; fresh → 4; a 0002 DB with data upgrades and converts (§7.2 step 2); `/api/health` → `migrations: 4` |
| 4 | Engine goldens | `pnpm vitest run --project engine test/golden --reporter=verbose`: every §9.2 area compared; counts per reason match the private §3 (compare privately) |
| 5 | Server golden | `pnpm vitest run --project server test/golden --reporter=verbose` ran and passed |
| 6 | e2e | `PORT=3195 WEB_PORT=5195 DATA_DIR=artifacts/stage3/verifier/e2e pnpm e2e`: setup, every Stage 0–2 spec, `cashflow`, `cashflow-states` on desktop and phone; `mutations` and `cashflow-mutations` ran and passed |
| 7 | Owner data, API | `DATA_DIR=artifacts/stage3/verifier/owner pnpm import:workbook --yes` (corrections auto, as the owner's database), `MARKET_DATA_MODE=off`; the four GETs match the private §5 (date-independent figures; date-dependent ones only present or null as §5 says). A corrected trade date legitimately moves added investments (and so savings, rate and spend) between two closed periods; the private §5 lists those periods' expected values under corrections. Scratch script prints pass/fail only |
| 8 | Cash CRUD + D34 | on #7: baseline dump; a kind-only edit of an imported account → `hasAppData` false and survives `pnpm import:workbook --yes` (kind kept); a balance update → `hasAppData` true; add/delete an app account round-trips the dump; delete an imported entry that is not an account's last → marker; `--yes --replace-app-data` restores the baseline (pricing timestamps ignored) |
| 9 | Overlays and settings | on a fresh #7 import: an adjustment (on a closed period; the provisional month → 400), a goal and a dismissal keep `hasAppData` false and survive a re-import; PATCH `savings.yearBasis` → false; PATCH `budget.includeSideIncome` → true; PATCH `budget.emergencyFundOverrideCents` (a key this workbook does not provide while `D3` is the formula default) → true; `--yes --replace-app-data` → the override row is gone, `budget.includeSideIncome` is back to `import`, and `hasAppData` is false again (the §3.3 rule 3 gap closed) |
| 10 | Side income, budget, dividends CRUD | on #7: create/update/delete one of each (deposit, stream, item, auto row D54 amount, yearly expense, dividend with the price auto-fill from a seeded event) → pages recompute; deletes of imported rows write the marker; 409s for an account in use, a stream in use and an account's last entry |
| 11 | Pages at 1440 and 375 | on #7: `/cash`, `/side-income`, `/budget`, `/dividends` and every form open; h1, no console errors, no page scroll; screenshots under `artifacts/screenshots/{desktop,phone}/` |
| 12 | Live Yahoo (one run) | stop #7; `MARKET_DATA_MODE=live` on `artifacts/stage3/verifier/live` with the owner import; one `POST /api/dividends/suggestions/refresh` → a `succeeded` or `partial` job run; local ex-dates never fall on a weekend by the UTC slip; counts recorded privately |
| 13 | Prod bundle | `pnpm build`; `PORT=3195 DATA_DIR=artifacts/stage3/verifier/prod IMPORT_CORRECTIONS_FILE=none pnpm start`; deep links `/cash`, `/budget` serve HTML; synthetic import; the four GETs → 200 |
| 14 | Privacy | `pnpm guard:all` exits 0 (with the Stage 3 terms); re-run the code reviewer's numeric scan on the final tracked diff: nothing found; no snapshot files |
| 15 | Engine purity | `pnpm exec eslint packages/engine --max-warnings=0` and `test/purity.test.ts` (the new bans active; comments not scanned) |
| 16 | PLAN acceptance | the savings-engine goldens on the imported snapshots pass (#4, #5); every §11 fix except the vetoed fix 7 (D61) is applied and listed in the close notes; CRUD updates totals (#8, #10); D34 behaves as §3.3–3.4 (#8, #9) |

**Demo frames** (D62: the owner's real `data/`, after a **fresh backup** taken for the demo; migration 0003 converts it on the first start). **Re-import-safe actions only** (D62), exactly four: set the loan account kinds, add an adjustment, add a goal, dismiss a suggestion. Everything else is viewing only; `hasAppData` must still be false at the end.
0. With every server stopped, right before the demo start (the §7.0 pre-step backup is older): back up `data/finance.db*` to a new git-ignored `data/backups/pre-stage3-demo-<date>/`.
1. **Cash:** the accounts by kind; **set the loan accounts' kind** to "Loan you've made" (a kind-only edit: import-safe) and watch Total cash stay put while available cash, the emergency-fund tile, the cash target and end-of-year meters and the ETFs next-buy card follow available cash (D59, §11 fix 20; private §7); the savings table with the provisional period and the raw view; **add an adjustment** on a past closed period and watch that period's adjusted savings rate and spend, the 12-month saved per month, and the cash projections (predicted cash per year, the end-of-year projection and gap, the cash-target months and arrival) change. The 3-month rate and trend move only for one of the last three closed periods, and the year rate only for a closed period in the current FY; **add a goal** and read its "saved toward goals" line (available cash above the emergency fund + the investment share, D59).
2. **Side Income:** the imported deposits by period and the averages, as imported (D60: the past loan principal repayments inside them stay).
3. **Budget:** the items, the split, the emergency fund (the sheet's basis, D61), the transfers (viewing only; edits block re-import).
4. **Dividends:** "Check Yahoo" (live) → suggestions (AUD listings, the 14-day expected payment gap, the 90-day match window: D62); **dismiss one**. No Confirm (it creates an app row and blocks re-import).
5. Phone views of Cash and Budget.

---

## 11. Template bug fixes applied in Stage 3 (owner can veto)
The owner has answered four of these in the plan review: **fix 20 confirmed and widened (D59), fixes 12 and 15 accepted, fix 7 vetoed (D61)**. Fix 10's suggestion rules are owner-confirmed (D62). The others stay vetoable at the demo. Numbering is stable (fix 7 keeps its number).

1. **The 3-month savings trend** is the slope of the savings rate against the date over the last three recorded periods, per month. The sheet's `C41` regressed the wrong columns (stale INDIRECT letters) and showed garbage; `C40` read it.
2. **The end-of-year gap per month** divides by the months left in the year, not by 12 (`C27`).
3. **The house-deposit tracker becomes savings goals** (D55): several goals filled in order, progress from available cash (total cash minus loans you've made, D59) above the emergency fund plus a share of investments (the share is kept even while cash is below the fund), the ETA from the monthly savings that feed the goals. No hard-coded 65 % (`C50`/`C51`).
4. **Year basis:** the Cash year figures use the Australian FY by default, with a calendar-year setting (D52). The sheet used the calendar year there and the FY elsewhere.
5. **Side-income averages ignore the unfilled current period** (`C3`, `C5`/`H27`, `C6`): only recorded periods count. (Stage 2 fix 20, carried into the deposit model.)
6. **FY-to-date side income** sums deposits dated in the FY, bounded by the FY end (`C4` used 1 January of the following year).
7. ~~The emergency fund leaves savings lines out of its basis.~~ **Vetoed by the owner (D61):** the emergency fund keeps the sheet's `D3` basis, savings lines (the EF top-up itself) included; not applied.
8. **Budget accounts:** every cash account can be chosen for a budget row (the template's dropdown stopped short of the last rows); rows link to accounts by id, and a stale name is flagged for relinking.
9. **The amount to invest reads the investment row** (D40, applied in Stage 2; now from the live budget).
10. **Price at the ex-date** is the last close before the ex-date on the exchange's own calendar, never "ex-date − 2 calendar days" (which could land on a weekend); non-AUD listings are not suggested (the template's GBX branch never converted GBP), and a typed price stays authoritative. The suggestion rules (AUD listings only, the 14-day default payment gap, the 90-day match window for payments without an ex-date) are owner-confirmed (D62).
11. **The Capital Gains FY reference** to an empty merged cell is gone with Capital Gains (D2); FYs come from the dates.
12. **Every dividend counts as income** in the savings rate. The sheet counted only rows marked "not reinvested", while reinvested units still counted as savings through the DRP buy. **Accepted by the owner (D61).**
13. **Savings rates above 100 %** are corrected by the per-period one-off adjustment (D51); the app shows adjusted figures, with the sheet's raw figures one switch away.
14. **The current period is provisional:** averages, year sums and trends use recorded periods only. The sheet mixed its live row into `C17`–`C20`, `C37`, `C39` and the Budget's actual spend (`M4`).
15. **The year savings rate is income-weighted** (Σ savings ÷ Σ income), not a simple mean of monthly rates (`C38`; the Net Worth gauge in Stage 5 follows). **Accepted by the owner (D61).**
16. **The cash-deficit wait** sizes the cash shortfall on the liquid-asset total the percentages come from; the sheet multiplied it by the cash balance (`SheetOptions!H12`).
17. **Payday transfers** list rows without an account as "Not assigned" instead of dropping them silently.
18. **The first recorded month is the baseline:** no savings figures and no added investments (the sheet's first row mixed two windows and counted other-asset purchases past its date, overlapping the next period).
19. **Monthly spend is income − savings,** defined whenever there is income (the sheet's `N × (1/M − 1)` failed when the rate was 0 or "-").
20. **Loans you have made count only in Total Cash, net worth and the savings engine** (D59, owner-confirmed; widens the D49 proposal): money lent out is not available to fall back on or to spend on a goal. **Available cash** (total cash minus `loan_receivable` accounts) drives all four uses: (a) the emergency-fund test (the tile, the cash-first advice and the budget's 100 %-to-cash rule); (b) the savings goals' "saved so far" (fix 3); (c) the cash savings target (`C30`–`C34`: progress, months to target, arrival); (d) the end-of-year cash goal (`C24`–`C27`: projection, on target, gap per month). The monthly rate behind (c) and (d) stays the average total-cash gain (§2.6). Total Cash, net worth (and its cash class, so the cash-deficit wait) and the savings figures still include loans (D49). With little other cash this switches the budget to "cash first" and pushes the cash goals out; the owner accepted that (D59). One server constant each (`LOANS_COUNT_FOR_EMERGENCY_FUND = false`, `GOALS_CASH_BASIS = 'available'`, §4.5).
21. **Offsets can count toward the emergency fund** (D56): the setting now works; the sheet's copy had no effect.
22. **The per-holding FY dividend table** is bounded by the FY end (the sheet's list had no upper bound) and groups by holding, not ticker text (D28).
23. **The annualised dividend yield** averages the payments that have a yield; the sheet averaged payments with no units as 0.
24. **The cash target shows "Reached"** whenever cash (available cash, fix 20) is at or above the target, even while the average cash gain is zero or negative (the sheet's `C30` showed "Neg. Savings Rate" first).
25. **Cash projections leave out adjusted one-offs:** the predicted cash per year, the end-of-year projection and gap, and the cash-target ETA use the average cash gain after the D51 adjustments (the sheet has no adjustments; the Cash page's raw view keeps the sheet's figures for the table and charts).

Decisions applied (not fixes): D49 loan accounts, D50 Yahoo suggestions only, D51 adjustments, D52 FY default, D53 one include-side-income setting, D54 manual investment amount, D55 goals, D56 offsets, D57 dated deposits, D58 balance history, D59 available cash for the emergency fund and the cash goals, D60 past side income as imported, D61 the savings-rate answers (fixes 12, 15 accepted; fix 7 vetoed), D62 the demo on real data and the Yahoo suggestion values.

---

## 12. Risks & fallbacks
| Risk | Status / fallback |
|---|---|
| Yahoo's chart API is unofficial; the events block may change or be rate-limited | A cache with `fetched_at`; suggestions only (D50); manual entry always works; a 429 stops the run (`partial`); the daily timer runs at most once a day; the fake provider keeps e2e offline. |
| Dividend events coverage for ASX listings (missing events, adjusted amounts) | The owner confirms or edits every suggestion; amounts are labelled estimates before withholding; a missing event means no suggestion, never a wrong row. |
| Historical close gaps (holidays, the first bar, null closes) | "Last close before the ex-date" skips gaps; the fetch starts 14 days before the first trade; no close → null price → null yield (shown as "—"). |
| Time zones | Exchange-local dates via `Intl` with `exchangeTimezoneName` (verified: the UTC date slips a day under daylight saving); server `asOf` = local date of `now()` (Stage 7 sets `TZ`); the engine never reads a time zone. |
| Savings figures depend on snapshots | No snapshots → empty states; one snapshot → the baseline only; the provisional period needs a snapshot to compare with. |
| Provisional month collides with a recorded month | The §2.3 month rule; Stage 5's recorder owns the real fix. |
| The migration's data conversion on the owner's DB | Tested on a 0002 DB with data; the pre-step backup; converted rows keep `origin`, so re-import stays allowed. |
| D34 surprises (a Stage 3 edit blocks re-import) | Callouts on workbook rows and settings; overlays and the kind-only edit are import-safe; the Import page explains what a re-import keeps. |
| Leaving loans out of the emergency-fund test and the cash goals (D59) flips the owner's timing to cash first and pushes the cash goals out once the loans are reclassified | Owner-confirmed (D59), so not a surprise: the demo shows it (private §7), and every page says what counts (§6.3). Loans still count until the owner sets their kind (a kind-only, import-safe edit). The choice stays one server constant each (`LOANS_COUNT_FOR_EMERGENCY_FUND`, `GOALS_CASH_BASIS`); the engine contract, DTOs and web copy already follow them. |
| One agent carrying too much (routes, context, timing chain and market data) | The dividend-events market data is its own implementer (market-events) behind the frozen §4.6 interface; the Scaffolder stubs an off-mode service so server-api never waits for it. |
| Rounding drift vs cached cells | Cents per period, rounding once; tolerances sized from the planning prototype (§9.5). |
| Engine cost per request (all engines on every page) | Small data; memoised per request; profile if a page exceeds 100 ms (memoise by a data version in `app_meta`, not built now). |
| Parallel work on shared tables (seed, loader, importer) | Dual-written seed until server-api switches; the importer flag gates dependent tests; server-api reports done only after gated suites ran. |
| Two mutating e2e projects | `cashflow-mutations` depends on `mutations`, so they never overlap; each cleans up by `E2E_NOTE`; the Verifier starts from an empty `DATA_DIR`. |
| Stale dev servers on `data/` | The coordinator pre-step stops them; agents use `artifacts/stage3/*`. |

---

## 13. Every agent: final report checklist
- Files created or changed (all inside your ownership; Scaffold notes appended; Integrator cross-area edits listed).
- Commands run with pass/fail: typecheck, lint, format:check, your scoped tests, your e2e specs on your ports, `pnpm guard:all`.
- Engine, server-api, the spec reviewer and the Verifier: golden counts per area (compared / skipped by reason / recomputed). **No owner values, symbols, names or notes** in anything that could be committed.
- Screenshot paths under `artifacts/screenshots/` (UI roles) and the STYLE_GUIDE §10 self-check.
- Contract gaps or cross-owner requests (not worked around).
- Ports free and no background processes left.
- Nothing committed or pushed; no owner data in any tracked file.

---

## Scaffold notes

_Scaffolder appends here (append-only): where the skeleton differs from, or adds to, the plan above. The implementers, the Integrator and the Fixer append contract clarifications here too._

### 2026-09-25 - Scaffolder

The done-check passed: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` (112 files, 2059+ tests; the Stage 2 baseline was 1878), `pnpm build`, `pnpm guard:all`; `PORT=3070 WEB_PORT=5170 DATA_DIR=artifacts/stage3/scaffolder/data pnpm e2e e2e/smoke.spec.ts e2e/ui-core.spec.ts` (65 passed, 8 project skips) on a fresh folder; `/api/health` → `migrations: 4`; `seed:dev --yes` into that folder exits 0; ports 3070/5170 free afterwards. `git diff --exit-code` on the `0000`–`0002` SQL and snapshot files is clean. No `pnpm install` was needed (no dependency or lockfile change).

**Migration `0003_stage3_cashflow`**
- Generated by drizzle-kit (`db:generate --name stage3_cashflow`): the five tables, `meta/0003_snapshot.json` and the journal entry. Index names: `cash_balance_entries_account_idx`, `side_income_deposits_date_idx`, `side_income_deposits_stream_idx`; the unique indexes take drizzle's generated names; `dividend_events` has a composite primary key.
- A header comment (in the first statement chunk, so the migrator never sees an empty statement) says the three data statements at the end were appended by hand; each carries a short SQL comment. The statements are §3.1's, verbatim.
- Tests (`apps/server/test/migrations.test.ts`): a fresh DB has the five tables; the Stage 1 upgrade test strips the Stage 3 tables from its seed dump and now expects the converted rows (`expectedConversion`, a JS mirror of the SQL); a new "0002 with data" pair inserts its own raw rows (a zero amount skipped, a null period end dated at the month end of a leap February, an end after the latest `balance_as_of` dated at that as-of, an account with no `balance_as_of` → today's UTC date, an `app` entry kept as an `app` deposit) and checks `hasAppData` false (import rows only) and true (the app row); FK cascades and the unique keys of the new tables.

**Schema (`@joinr/schema`)**
- Enums, tables, `db/index.ts`, `DOMAIN_TABLES_DELETE_ORDER` (as §3.2), `DUMPED_TABLES` (+ `cash_balance_entries`, `side_income_deposits`), rows + parity (type and runtime), errors (three codes appended), `JOB_NAMES` = `['prices', 'dividends']`.
- **Additive exports** (no frozen name changed): `isEditableSettingKey(value)`; in `dto/cashflow.ts` the parsed/body types (`CashAccountUpdate`, `CashAccountCreate`, `CashBalancesInput`, `SavingsAdjustmentInput`, `SavingsGoalInput`, `DepositInput`, `IncomeStreamInput`, `BudgetItemInput`, `BudgetAutoRowInput`, `YearlyExpenseInput`, `DividendInput`, `DividendInputBody`, `SettingsPatch`), `MAX_GOAL_DATE` (`2200-12-31`) and `SETTINGS_PATCH_MAX_KEYS` (20). Every `make*Schema(now)` defaults `now` to the real clock.
- **Request-schema messages** (server 400s read `path: message`): `is required`, `must be at most N characters`, `must be whole cents`, `is too large` (|x| > `CASHFLOW_MONEY_MAX`), `must not be zero`, `must not be negative`, `must be greater than zero`, the trade-date trio for dates (`must be a date written YYYY-MM-DD` · `must be on or after 01/01/1900` · `must not be after tomorrow`), `entries: an account appears twice`, `entries: must list at least one account` / `at most 200 accounts`, `ids: an id appears twice`, `exDate: after the payment date`, goal dates `must be between 01/01/1900 and 31/12/2200`. `settingsPatchSchema` is a transform over `strictObject({ values: record })`: `values: must hold 1 to 20 settings`, `values.<key>: not editable here`, and a bad value reports its `settingValueSchema` issue under `values.<key>`. `reorderSchema` checks uniqueness only; "every id exactly once" is the route's set check.
- **Settings:** `savings.yearBasis` appended (source null, default `fy`); the `goals.houseDepositInvestmentShare` label changed; `EDITABLE_SETTING_KEYS` as §3.3 (Budget's nine first, then the Cash page's six).
- **Records:** `side-income` now lists deposits with columns `date · stream · amount · note · sheetRef` (default sort date desc). New entities: `cash-balance-entries` (label "Cash balance history"), `savings-adjustments`, `savings-goals` (default sort `sortOrder`), `dividend-events` (label "Dividend events (Yahoo)"; row id `<instrumentId>:<exDate>`; `dismissed` = `dismissed_at` set). `apps/server/src/records/index.ts` has full loaders for all four and the re-pointed `side-income` (not only the minimum); the records fixtures have rows for each.
- **Seed (§3.6):** a fourth account "Loan to a friend" (`loan_receivable`, $3,000, `Cash!A5`); five balance entries (one per account at the as-of plus the everyday account at 31/07/2026); three deposits (the two non-zero period entries at their period ends, plus $200 for stream 2 on 20/08/2026, after the last snapshot); the `side_income_entries` rows stay (server-api removes them, pre-approved). `clearSeededTables` also clears the two overlay tables (events cascade from instruments). The seed's stored import report now says 4 cash accounts and a $28,000 cash total. `packages/schema/test/db.test.ts` asserts the new rows and that overlays/events stay empty.
- **Fixtures (`fixtures/cashflow.ts`, from `@joinr/schema/fixtures`)**: literals written by `artifacts/stage3/scaffolder/fixture-gen.ts` (git-ignored), which applies the §2 rules (and the real Stage 2 `budgetInvestment` plus the §2.9 D54 step) to generic inputs; `packages/schema/test/cashflow-fixtures.test.ts` re-checks sums, orders, windows, statuses, the §6.5 table totals, coverage and request bodies built from the fixtures. As-of 24/09/2026 (= the investment fixtures'). States as §3.6 (`cashPages` 8, `sideIncomePages` 3, `budgetPages` 7, `dividendsPages` 7) plus the six mutation examples and the five `apiErrors`. Each state is a spread of its group's first state plus the top-level keys that differ. Knowing choices where the contract is silent (owners may refine):
  - `emergencyFund.shortfallCents` = max(0, target − EF-test cash): 0 when covered, null without a target.
  - Accounts: kind order, offsets last, then `sortOrder`; entries `asOf` desc, then id desc.
  - `earlyYear` has only a baseline month (Jul 2026) plus the provisional period: with the anchor-based year window (§2.6), a year with a closed period is never empty otherwise. `missingSettings` uses the calendar basis and three equal rates, so every `KpiTrend` is covered.
  - `SideIncomePeriodDto.byStream` lists only streams with deposits in that period (ascending id); the side-income chart's `byStream` has every stream (0 when none), keyed `String(id)`; a side-income chart point's `date` is the period end.
  - Budget transfers group every row (items and the three auto rows); a row with neither an account id nor a name is unassigned; `unallocatedCents` counts a null investment or cash row as 0; weekly = round(monthly ÷ 4.34523783659).
  - Suggestions: an even count of lags takes the rounded mean of the two middle ones (the fixtures only have equal middles). The dividend form's `holdings` list is in kind order, then id.
  - `settings.origins`: `import` for a stored workbook value, `app` for an edited one, null when never stored.
- **`investmentPageTiming`:** every investment page fixture now has `budget.source: 'live_budget'` and `cashDeficitMonths: null`; the new `cash_deficit` state waits 5 months against the plan's 3 (a 150-day countdown; cash 12.6 % against a 15 % target because of a large other-assets value). `below_emergency_fund` no longer lists `deferred` (Stage 3 never defers). `FIXTURE_COVERAGE` gains the six lists.

**Engine contract (`@joinr/engine`)**
- `types.ts` has every §2.2 type, the additive Stage 2 changes (`cashCents` doc, `InvestCountdownFn.cashDeficitMonths?`, `CompressSeriesFn`'s optional `yearBasis`) and named aliases for the 13 new functions (`CashTotalsFn` … `YearWindowFn`); `EngineApi` has 27 members.
- `index.ts`: stubs throwing `engine: not implemented`, `CASHFLOW_ENGINE_IMPLEMENTED: boolean = false`, the `engine` value (`satisfies EngineApi`) with the 13 members; `yearWindow` is real.
- `test/api.test.ts` (→ engine): the member list, `toEqualTypeOf` for the 13 new functions, `yearWindow` cases and a stub-throw test under `skipIf(CASHFLOW_ENGINE_IMPLEMENTED)`. **`compressSeries` and `investCountdown` are asserted with `toExtend`, not `toEqualTypeOf`,** because their Stage 2 implementations do not take the new optional inputs yet; the engine owner restores `toEqualTypeOf` once they do.
- ESLint: the §2.1 selectors are in the engine block; a probe file confirmed all ten patterns error and `getUTC*` does not. The current engine source passes.

**Server stubs**
- The five route files answer 501 `NOT_IMPLEMENTED` (`no-store`) for every §4.2 route; the period-notes and savings-goals routes live in `routes/cash.ts`. Each exports `<Name>RouteOptions` = `{ database, config, market, dividendEvents, now?, engine? }`; `app.ts` registers all five with one shared options object.
- `market/dividends/index.ts`: the frozen interface, options type and factories; `createDividendEventsService` returns the off service (status `mode: 'off'`) in every mode until market-events replaces it.
- **Shared cool-downs:** `MarketDataServiceOptions.cooldowns?` in `market/service.ts`. Because the frozen `createMarketDataService` (`market/index.ts`, not a Scaffolder file) does not take it, `defaultServices` calls `createService` (the same function it wraps) with one `Cooldowns` instance and passes the same instance to `createDividendEventsService`. `offServices` passes `createOffDividendEventsService()`; `buildApp` falls back to it when a factory omits `dividendEvents`.

**Compile and expectation fixes the contract forced (→ each file's owner)**
- `apps/server/src/investments/timing.ts`: `cashDeficitMonths: null` (source and `deferred` unchanged until server-api wires the live chain).
- `apps/server/test/investments/helpers.ts`: neutral fakes for the 13 members (`cashTotals` sums by the §2.4 rules; `budgetInvestInputOf` maps as §2.9; the rest return empty or null results; `yearWindow` is the real one); `neutralBudgetInvest()` exported.
- `apps/server/test/investments/builders.test.ts`: the seeded cash sum includes the loan account ($3,000; the Stage 2 loader sums non-offset accounts) and the timing literal has `cashDeficitMonths: null`.
- `apps/server/test/records-routes.test.ts`: overlays and events are not seeded, so the tests add one of each (`seedWithOverlays`); 4 cash accounts; a test for the Stage 3 entities.
- `apps/web/src/pages/investments/InvestmentPage.test.tsx`: the below-emergency-fund test no longer expects the Stage 2 deferred-wait note (the fixture no longer defers).
- `packages/schema/test/{db,investment-fixtures,registries,rows-parity}.test.ts` updated; new `cashflow-schemas.test.ts` and `cashflow-fixtures.test.ts`.

**Web stubs**
- Typed routes `/cash`, `/side-income`, `/budget`, `/dividends` (`validateSearch`: a positive-int `holding`, anything else dropped; passed to `DividendsPage` as `holding?: number`). `POSITIVE_INT_RE` moved to the top of `router.tsx`. Each page renders `PageHeader` (subtitle "Cash flow") and the note "Arrives with the Stage 3 web work."
- `router.test.tsx`'s "renders a placeholder page" test at `/budget` still passes (it checks the h1 only); web may retitle it. `e2e/ui-core.spec.ts` short-page test uses `/super` instead of `/budget`.

**Importer flag:** `IMPORTER_STAGE3_IMPLEMENTED: boolean = false` in `packages/importer/src/testing/index.ts`.

**Privacy:** two generic fixture inputs happened to match private guard terms; the inputs were changed (no guard-term edit). Note the one known flake: `tools/privacy-guard/test/main.test.ts` can fail with a Windows `EPERM` while removing its temp repo (seen once in the pre-work baseline, unrelated to Stage 3).

### 2026-09-25 - importer

§3.5 changes 1–6 are in; `IMPORTER_STAGE3_IMPLEMENTED = true`. No frozen name, field or signature changed; everything below is internal to `@joinr/importer` or report content.
- **Deposits (D57):** `extractSideIncome` returns `deposits` (model type `SideIncomeDepositRow`: `periodEnd`, `depositDate = min(F, as-of)`, non-zero `amountCents`); a numeric cell that rounds to 0 cents writes nothing. The Stage 1 per-month dedupe (`dedupeSideIncome` and its `income.period.<month>.<n>` unexplained line) is gone: two rows in one month are simply two sets of dated deposits. `side_income_entries` is never written.
- **Report lines (ids other roles may read):** `counts.cash-balance-entries` (expected = the Cash rows, actual = entries; `report.counts['cash-balance-entries']`); `counts.side-income` is now labelled "Side income deposits" and expects the non-zero numeric G/H cells; `income.stream.<n>`/`income.total` sum deposits. Two info lines appear only when needed: `income.datedAtAsOf` (section `income`, unit `count`, `actual` = deposits dated at the as-of; no amounts) and `cash.kindsNotCarried` (section `cash`, unit `count`, `expected` = N, the reason lists the account names). Both use `reasonCode: null` (no new `REASON_CODES`).
- **Kinds (D49):** `carryAccountKinds(stored, next)` in `src/process.ts` (pure; names compared trimmed); the writer reads the stored kinds before the replace-all delete. An app-created non-bank account removed by a `--replace-app-data` import is listed in `cash.kindsNotCarried` too.
- **C28 (D54):** `budgetMonthlyCents(ctx, kind, row)` in `src/extract.ts`; a typed numeric-text C28 is parsed (with the usual numeric-text info line).
- **Settings gap (§3.3 rule 3):** the writer's settings step deletes `origin = 'app'` rows of keys with `isWorkbookSetting` true that the workbook does not provide; `import` rows of such keys are left as Stage 1 left them (see the importer report).
- **Synthetic workbook unchanged** (its clean import now writes 7 deposits of its 9 numeric cells and 4 balance entries); tests put a live-row amount in via `mutate`.

### 2026-09-25 - market-events

§4.6 is in: `createDividendEventsService` (replaced in place) registers the `dividends` job in `live` and `fake`, and `off` still returns `createOffDividendEventsService()`. The frozen interface, options type and both factory signatures are unchanged. `market/service.ts` keeps the Scaffolder's optional `cooldowns` as it is. Nothing outside my files changed.
- **Modules:** `market/dividends/parse.ts` (`parseYahooDividends`, pure, plus the local-date helpers), `client.ts` (the Yahoo client and the fake client, one target per call), `run.ts` (target selection, the fetch loop with spacing, concurrency 2 and the shared cool-down, and the single IMMEDIATE write transaction). `index.ts` holds the service and the job.
- **Additive exports:**
  - `dividends/index.ts`: `DIVIDENDS_JOB`, `DIVIDENDS_INITIAL_DELAY_MS` (60 s), `DIVIDENDS_INTERVAL_MS` (24 h), `PRICES_WAIT_POLL_MS` (1 s); it also re-exports `parseYahooDividends` and its types.
  - `providers/yahoo.ts`: `yahooDividendsUrl(symbol, period1, period2)`, `YAHOO_SUFFIX_TIME_ZONES`, `timeZoneFromSymbol`; `currencyFromSymbol` is now exported.
  - `providers/fake.ts`: `fakeDividendEvents(symbol, now)`, `fakeDividendAmount`, `FAKE_DIVIDEND_MONTHS`, `FakeDividendEvent`.
- **Where the contract is silent, I chose these rules:**
  - **Local dates:** `meta.exchangeTimezoneName`, then `meta.gmtoffset`, then the zone of the symbol's suffix (`.AX` → Australia/Sydney). If none of these is usable, the target fails with "No exchange time zone in response"; a response with no events still succeeds. Two Yahoo events on the same local ex-date are added together.
  - **Fake events:** they use the target's provider symbol (the same symbol `fakePrice` uses in the price job), UTC calendar dates, and a close date on the weekday before the ex-date. `source = 'fake'`.
  - **Refresh behaviour:** a refresh only upserts. Events Yahoo no longer lists stay cached, and `dismissed_at` is never written.
  - **Counts and job status:**
    - A holding deleted or renamed mid-run counts as `skipped` but leaves the run `succeeded`.
    - The status is `succeeded` when nothing failed or was interrupted, `failed` when every attempted target failed and nothing was interrupted, and `partial` otherwise. That includes a rate limit, a run that started during the cool-down, the deadline and shutdown.
    - A target that throws, for example because of an unreadable trade date, fails with "Unexpected error" and the run continues.
  - **`job_runs.error` texts:** these are short, with no URLs or bodies, and are what server-api shows as `lastError`: "Run deadline reached", "Run aborted", "Rate limited by Yahoo; the remaining holdings were skipped", "Yahoo is cooling down after a rate limit; holdings were skipped", and "N of M holdings failed: <first error>". `detail` holds `requested, ok, failed, skipped, events, source, rateLimited, cooling, waitedForPrices, deadlineHit, durationMs`.
  - **`status().lastRefreshAt`:** the last `succeeded` or `partial` run, as for prices.
- **Tests:** `apps/server/test/market/dividends-parse.test.ts` and `dividends-service.test.ts` (43 tests). They use a mocked `fetchImpl` and injected clocks (the prices wait uses Vitest fake timers for `setTimeout` only); there are no snapshots and no network.

### 2026-09-25 - server-api

§4.2–4.5 and §7.4 are in. No frozen name, field, signature or endpoint changed; the route files keep their `<Name>RouteOptions` types.
- **Modules (`apps/server/src/cashflow/`):**
  - `context.ts` holds `createFinanceContext`, `FinanceContext` and `financeDeps(opts)`. `investments/context.ts` re-exports them under the Stage 2 names (`createInvestmentsContext`, `InvestmentsContext`, `InvestmentsDeps`), so the investment pages and the four cash-flow pages share one loader (`investments/load.ts`: one read transaction, now also holding the Stage 3 rows, the settings origins and the last `dividends` job run) and one memo. The memo covers `computeInvestments` ×4, `cashTotals`, `computeSideIncome`, `computeSavings`, `cashKpis`, `computeBudget`, `budgetInvestInputOf`, `budgetInvestment` and `computeDividends`.
  - `inputs.ts` (the §4.5 input table), `cash.ts`, `sideIncome.ts`, `budget.ts`, `dividends.ts` (page builders and DTO mappers), `mutations/*` and `responses.ts` (a mutation's DTO rebuilt from a fresh context).
  - `constants.ts` holds `LOANS_COUNT_FOR_EMERGENCY_FUND = false`, `GOALS_CASH_BASIS = 'available'`, `BUDGET_PAGE_SETTING_KEYS` and `CASH_PAGE_SETTING_KEYS` (the first nine editable keys and the rest), and the automatic rows' default names.
- **Timing (§4.5):** `buildTiming` now reads the live chain and sends `source: 'live_budget'`, `deferred: []` and `cashDeficitMonths`. `timing.ts` still exports `lastStockOrEtfBuy` and `lastSnapshotCashShare`, which now live in `cashflow/inputs.ts`. The Stage 2 `sideIncomePeriodsOf` and `lastDayOfMonth` loader helpers are gone.
- **Seed (pre-approved):** `seedGenericData` no longer writes `side_income_entries`. `packages/schema/test/db.test.ts` expects none. The Stage 1 upgrade test in `apps/server/test/migrations.test.ts` inserts its own generic period entries, so the 0003 conversion is still covered.
- **`hasAppData` (§3.3 rule 2):** a `settings` row counts only when `origin = 'app'` and the key is a workbook setting. An unknown key never counts. The Stage 1 test in `apps/server/test/db.test.ts` was updated to match.
- **Gating:** the investment pages now call the Stage 3 engine. So `apps/server/test/investments/integration.test.ts` and the investments server golden are also gated on `CASHFLOW_ENGINE_IMPLEMENTED`, and the golden's `SheetOptions!H2` check additionally needs `IMPORTER_STAGE3_IMPLEMENTED` (it reads the dated deposits).
- **Where the contract is silent, I chose these rules:**
  - **Settings PATCH response:** the slice holds the keys of the page, or pages, whose keys the body named.
  - **Dividend price at the ex-date:**
    - `priceAtEx: null` is treated like omitted.
    - A typed price equal to the stored one keeps the stored `priceAtExManual` flag, so a form that echoes the price back is a no-op.
    - On an update, an omitted price with no cached close keeps a stored price that was not typed (a workbook formula's cached value), as long as the holding and ex-date are unchanged.
    - When the holding is unchanged, the ticker text and holding kind stay as stored.
  - **Budget rows:**
    - "No account" on a row that is already unlinked keeps its typed account text, which stays visible in the transfers.
    - A linked row compares by account id, so a renamed account is not a change.
    - A reorder hands out the listed rows' existing sort orders in the new order. Rows whose order changes become `origin app`, because a re-import would undo the order.
    - `PUT /budget/auto/auto_invest` without `manualMonthlyCents` keeps the stored amount; `null` clears it.
    - A missing automatic row is created with the template's label as its name.
  - **Dismissing** an already-dismissed event keeps the first time.
  - **Recorded periods:**
    - The adjustment route accepts a closed period's month: every snapshot month except the earliest run date's.
    - The note route accepts any snapshot month.
  - **Cash page:**
    - `emergencyFund.targetCents` is `computeBudget().invest.emergencyFundCents`.
    - `staticUntilStage4` is true while other assets, super entries, a property or a mortgage exist.
  - **Budget page:** `accounts` lists every account in the Cash page order, offsets included (last).
  - **Dividends page:** `events.lastError` is the latest `dividends` run's error with URLs removed, whitespace collapsed and at most 200 characters.
- **Tests:**
  - `apps/server/test/cashflow/` holds these files:
    - `context.test.ts`, `pages.test.ts`, `dto-types.test.ts`
    - `cash-routes.test.ts`, `income-budget-routes.test.ts`
    - `lock-and-reads.test.ts`, which covers the import lock and `hasAppData`
    - `suggestions.test.ts`, which uses a fake `DividendEventsService`
    - `integration.test.ts`, gated
  - `apps/server/test/golden/cashflow.golden.test.ts` is gated and prints counts only.
  - With both flags true, `pnpm vitest run --project server` ran 39 files and 554 tests with none skipped. That includes the cash-flow integration, the Stage 2 investments integration and both server goldens against the local workbook.

### 2026-09-25 - engine

§2 is in and `CASHFLOW_ENGINE_IMPLEMENTED = true` (the full engine suite ran with the goldens, none skipped). No frozen name, field or signature changed; `types.ts` is untouched. `compressSeries` and `investCountdown` now take their optional Stage 3 inputs, so `test/api.test.ts` checks them with `toEqualTypeOf` again, and the stub test is gone.
- **Modules:** `periods.ts` (windows, the provisional month, `yearWindow`, DATEDIF months, chart grouping), `cash.ts` (`cashTotals`, `monthlyPayCents` and the one pay-factor table), `savings.ts`, `kpis.ts` (with the trend fit the charts reuse), `goals.ts`, `sideIncome.ts`, `budget.ts` (`budgetInvestment` moved here from `timing.ts`, with the D54 step 9, beside `computeBudget` and `budgetInvestInputOf`), `dividends.ts` (the Stage 2 per-payment rule now lives here and `computeInvestments` imports it), `suggestions.ts`, `charts.ts`; `timing.ts` gains `cashDeficitMonths`. Internal helpers are exported from their modules only, not from the package root.
- **D54 test updates (Stage 2 `timing.test.ts`):** the split-off test now expects the typed `auto_invest` amount (and keeps the old expectation for an untyped row); the D46 chain test passes an untyped `auto_invest` row so it still reaches `split_off`. Nothing else in the Stage 2 tests or goldens changed; the Stage 2 golden tallies are identical.
- **Where the contract is silent, I chose these rules:**
  - **Windows:** a dated input after `asOf` belongs to no period, closed windows included. An adjustment attaches to closed periods only, so one on the provisional month is ignored like one on the baseline (the server's orphan list should include it).
  - **Rounding:** averages, projections and ratios use unrounded values and round once (a period's unrounded savings is its ratio × income). So C22 = round(mean × 12), not the rounded mean × 12. Year and chart-group rates count only periods with a savings figure and are null when Σ income ≤ 0.
  - **KPIs:** `avgWindow` is null when no closed period is in the window; `spend6mPeriods` counts the closed periods in the 185-day window. `cashTarget` is null for a target ≤ 0; `reached` and `no_savings` have no months or arrival.
  - **Goals:** `remainingCents` = target − allocated; a reached goal has no `monthsToGo`, `eta` or `requiredPerMonthCents`.
  - **Side income:** `byStream` lists streams with deposits (ascending id); `depositIds` are in date order, then id; with no snapshots every deposit up to `asOf` is `beforeFirstCents`.
  - **Budget:** a missing automatic row is appended in `BUDGET_AUTO_KINDS` order (no account, so unassigned); per pay is 0 without a pay frequency (`perPayTotalCents` null); a stale account name groups by its trimmed text; `byCategory` groups trimmed categories (`''` is none); `plannedSavingsRatio` is null when either automatic row is null; `unallocatedCents` comes from the rounded cents so the leftover table adds up.
  - **Dividends:** a payment is linked when its instrument is a holding of the payment's kind (the Stage 2 rule), so the rows equal `computeInvestments`' rows; `unlinkedThisFyCents` covers every other payment this FY. `byFinancialYear` also keeps a later FY that has a payment (one dated 1 July entered on 30 June), so its rows always add up to `allTimeCents`; the five FYs ending with asOf's are always there. `projectedFyCents` is 0, not null, with no payment this FY.
  - **Suggestions:** the no-ex-date match looks at every event of the instrument for "the latest on or before the payment"; an even number of lags takes the rounded mean of the two middle ones; a close ≤ 0 gives no yield.
  - **Charts:** the yearly unit groups by `yearWindow(date, basis)` and monthly and quarterly units by the period month (so `compressSeries` without the basis is the Stage 2 grouping); a monthly point's rates equal its period's own rates.
  - **Countdown:** `investCountdown` throws `RangeError` for a `cashDeficitMonths` that is not a whole number ≥ 0.
- **Goldens:** `test/golden/cashflow.golden.test.ts`, with `cashflowAdapter.ts`, `cashflowFormulas.ts` (the recomputed KPI and side-income formulas) and `cashflowTally.ts` (the §9.3 reasons; compared and recomputed counted apart). On the local workbook every area passes and every count equals the private §3 table.
- **Purity:** `test/purity.test.ts` scans every `src` file for the Stage 2 and Stage 3 lists after a string-, template- and regex-aware comment strip, with one-line detection samples and comment non-hits.

### 2026-09-25 - web (phase A)

§6 is in: the API layer, the four pages, the Stage 2 changes of §6.7, the forms, phone orders and states, with unit tests against the `@joinr/schema` fixtures and mocked fetch, and drafts of the four e2e files. No frozen name, field or signature changed.
- **`packages/ui` (additive, §6.1):**
  - `Meter` (`core/content/Meter.tsx`, `meter.css`, `Meter.test.tsx`) exported from `core/index.ts` together with the small helpers `meterStatus` and `meterFill` and the types `MeterProps` and `MeterStatus`. `aria-valuemin`, `aria-valuemax` and `aria-valuenow` are in dollars (cents ÷ 100). The value text is "$X of $Y", and above the target it reads "$X of $Y. Over by $Z". The status word is "Reached", "Over by $X" or "Short by $X".
  - `meter.css` is imported by one added line in `core/core.css`. That line is outside the literal "Meter + its CSS" wording but is its CSS wiring.
  - `labelHidden?: boolean` on `FieldFrame` and `MoneyField` (a `jf-visually-hidden` label that still names the input), and `list?: string` on `TextField`, each with tests in `forms.test.tsx`.
- **API layer:** `apiSend` also takes `PATCH`, for the settings route. `hooks.ts` gains the four page queries (60 s while visible; Dividends polls every 2 s while a check runs), one hook per §4.2 mutation, and `invalidateAfterCashflowChange`. The import, price, trade/instrument and instrument-delete invalidations also cover the four new keys. The suggestion refresh posts no body and refreshes the pages whether it succeeds or fails.
- **Shared web modules:** `pages/cashflow/` holds `display.ts` (labels, rate, trend and advice words), `cells.tsx`, `forms.tsx` (the inline form card, callouts and the delete confirm), `formState.ts` (one editor at a time, error mapping and column order), `settingsDraft.ts` and `SettingsSection.tsx`.
- **Where the contract is silent, I chose these rules:**
  - **Settings forms** send only the keys whose parsed value changed. The workbook callout shows while the form is pristine, when the form holds any workbook key, and after that whenever a changed key is a workbook key. The year basis alone shows the import-safe note instead.
  - **An unset key** shows its registry default ("Financial year (default)") or what the app then uses ("Not set: counted (Yes)").
  - **Account delete** lives in the account's edit form (the row actions are Edit and History, §6.3). It is disabled while `budgetRowCount > 0`, and a 409 still shows the server's message.
  - **Balance history** is always shown under the accounts. A row's History button chooses the account.
  - **Update balances:** a cleared balance field counts as unchanged.
  - **Suggestions:** the confirm form sits inline under its suggestion's row. The suggestions table splits around it, and a second table titled "(continued)" holds the rows after it. A confirmed suggestion can be saved as pre-filled, so it is never pristine.
  - **Dividends:**
    - A dividend whose price was filled from Yahoo edits with an empty price field, so saving keeps it filled rather than typed. A typed price is pre-filled.
    - The previous check's `events.lastError` shows on load as "Last check had a problem".
  - **Dividend chart cards** are titled "Per financial year by kind" and "Per month by kind", so their names do not repeat the section bars. The series order and colours follow §5, and the legend keeps the kind order through a custom legend on `EChart` and `barOption`.
  - **Next-buy parcel line (§6.7):** "Every N months · $X". While `cashDeficitMonths > plan.months` it reads "Every M months while cash tops up to its target (normally every N months) · $X". The foot line reads "From the imported budget" if a server ever sends `imported_budget`.
  - **Wide tables:** the savings and budget row actions sit two to a line at 768 px and wider (`jf-app-row-actions--pairs`), so every cash-flow table fits the 1152 px content area at 1440 px. On a phone they stay on one line and scroll with the table.
- **Tests:** `pages/cash`, `pages/sideIncome`, `pages/budget` and `pages/dividends` each have a page test. `pages/cashflow/display.test.ts` covers the helpers, the settings drafts and the budget lines. `api/hooks.test.tsx`, `router.test.tsx` (the placeholder test now visits `/super`; new h1 tests cover the four pages), and the §6.7 updates to the investment and import tests are also in. The helpers are in `apps/web/test/cashflow.ts`. The Dividends tests fake only `Date`.
- **e2e drafts:** `cashflow-support.ts`, `cashflow.spec.ts`, `cashflow-states.spec.ts` and `cashflow-mutations.spec.ts`. `cashflow-states.spec.ts` passed 58 of 58 (desktop and phone, `--no-deps`) against a fixture-backed scratch API on my ports. The other two need the real stack, and the `cashflow-mutations` project is not yet in `playwright.config.ts`; both are for the Integrator.

### 2026-09-25 - Integrator

Phase B (§7.8) is done. Both flags are `true`, and the gated server suites and all six golden files ran (none skipped). No frozen name, field or signature changed.
- **Integration fixes in other owners' files** (all small, each with a test):
  - `apps/server/src/cashflow/cash.ts` (server-api), from the engine's report: an adjustment attaches to a period only when the period is `closed`, and `orphanAdjustments` lists every adjustment whose month is not a closed period's month. That now includes one on the provisional month (possible after a re-import drops a recorded month). Before, such an adjustment showed on the provisional row, changed no figure (the engine ignores it, §2.3) and could not be removed from the orphan callout. `apps/server/test/cashflow/pages.test.ts` seeds one and expects it among the orphans.
  - `packages/schema/src/dto/cashflow.ts`: only the doc comment of `CashPageResponse.orphanAdjustments`, to match. The field is unchanged.
- **Web fixes (Integrator-owned):**
  - **Goal delete and orphan removal announced nothing in a browser.** `useCashflowMutation`'s `onSuccess` awaits the refetch, the refetch drops the row, and the goal card or orphan callout (which own their delete hook) unmount. TanStack Query then skips the callbacks passed to `mutate()`. `GoalsSection.tsx` and `SavingsSection.tsx` now use `mutateAsync().then(…)`, so the page (which stays mounted) announces "Goal deleted" and "Adjustment removed". The other row deletes hold their hook at section level and were not affected. The `cashflow-mutations` e2e found it; the unit tests now drop the row on refetch, but jsdom does not reproduce the race, so the e2e is the regression check.
  - `budget/TransfersSection.tsx`: without a pay frequency, the per-pay cells show "—" instead of $0 (the engine sends `perPayCents` 0 with a null `perPayTotalCents`).
- **e2e:**
  - `playwright.config.ts` has the `cashflow-mutations` project (desktop viewport, `dependencies: ['mutations']`), and `desktop`/`phone` ignore that spec.
  - `import.setup.ts` calls `cleanupCashflowRows` before `cleanupE2eRows`. `records.spec.ts` gives the all-tables test 90 s.
  - `cashflow.spec.ts` compares the table captions and row counts with the API (accounts, savings, deposits, periods, transfers, ledger). It also requires a provisional period and a fake suggestion for each synthetic ETF.
  - `cashflow-mutations.spec.ts`: the kind-only step uses "Loan you've made" and checks D59 end to end (Total cash unchanged; available cash down by the balance; `origin` still `import`). A `finally` restores the kind through the API, because a re-import carries a stored kind over (D49). The provisional period's cash gain must move by exactly the balance change.
- **Not changed (no Stage 3 owner):** `apps/server/src/cli/import.ts` `ENTITY_LABELS` has no label for `cash-balance-entries`, so the CLI's "Rows:" line prints the raw id (the importer's report).

### 2026-09-26 - Fixer (round 1)

The 24 confirmed review findings (SPEC-1–3, STYLE-1–12, 14, 17, 18, CODE-1–6) are applied across owners, each with a test. No frozen name, field, signature or endpoint was renamed or removed; the additive changes below are the coordinator's pre-approved ones.

**Contract additions (additive)**
- `@joinr/schema` `dto/cashflow.ts`: `settingsPatchSchema` now enforces write bounds after `settingValueSchema(key)` parses a value (CODE-2): a ratio within its registry min..max (`values.<key>: must be between 0 and 1`), money up to `CASHFLOW_MONEY_MAX` (`is too large`), and an integer with no registry maximum up to the new exported **`SETTINGS_INTEGER_MAX` = 1200** (`must be at most 1200`; `budget.emergencyFundMonths` is the only such editable key). `settingValueSchema` is unchanged (the importer and the DB reader stay lenient). The web's `parseDraft` mirrors the bounds ("Enter an amount up to $100,000,000", "Enter a whole number from 0 to 1200").
- `@joinr/schema` `dto/investments.ts`: new exported **`makeEntryDateSchema(now)`** (CODE-6), the one entry-date rule (a real date, ≥ 01/01/1900, ≤ tomorrow). `makeTradeInputSchema`'s `tradeDate` and `makeCashflowDateSchema` (name, signature and doc kept) both use it; the duplicate `localIsoDate`/`localTomorrow` in `dto/cashflow.ts` are gone. The inferred trade types are unchanged.
- `apps/web/src/pages/cash/cashEditor.ts`: `isFormOpen(editor)` (STYLE-11); `cashText.ts`: `endedAnchorMonth(page)` (STYLE-7).

**Removed dead code (CODE-5):** `apps/server/src/investments/timing.ts` no longer re-exports `lastSnapshotCashShare`/`lastStockOrEtfBuy` (they live in `cashflow/inputs.ts`) and no longer exports the unused `classValues(ctx)` wrapper; `apps/web/src/pages/cashflow/display.ts` drops `MINUS_SIGN`. `SuggestionsSection` now uses `SUGGESTION_STATUS_WORDS`.

**Behaviour and copy**
- **Budget (SPEC-1, STYLE-1, STYLE-2, STYLE-10):** the "Cash first" callout shows only when the engine really sends the whole leftover to cash: below the fund **and** the automatic split on (`!investManual`) **and** `budget.useForInvestAmount` true. The server's `belowEmergencyFund` flag and the Cash page tile still use the bare test. Its words, and the next-buy hint for `below_emergency_fund`, now name the basis ("the cash that counts toward the emergency fund … Loans you've made don't count"), true under D59 without reading the flags. The tile hints say "in Income and settings below" (that section is under the tiles). Row actions sit as explicit pairs (Edit · Delete / Move up · Move down), one pair per line at ≥ 768 px, on one line on a phone.
- **Cash (STYLE-3, 6, 7, 8, 11, 12):** the cash target distinguishes "Needs recorded months" from "Cash isn't growing at the moment (average cash gain $X a month)"; a goal without averages reads "No ETA yet: needs recorded months" and shows no On track / Behind badge; a goal whose target date has passed reads "The target date (…) has passed; $X still to go". The Emergency fund tile's hint starts "Target. Counts …". When the page's as-of is on or after the anchor year's end, the year-rate tile adds "the year of the last recorded month (Mon YYYY)" and the end-of-year card says it projects from that month (the §2.6 rule is unchanged). The year-rate tile carries the Check badge and its reason outside 0–100 %. The read-only Details card no longer locks the other row actions (opening a form replaces it). Update balances shows the workbook callout **or** the new-app-data note, never both. Savings row actions: Details, then Adjust · Note (the narrower pairing; the finding's Details · Adjust / Note made the savings table 20 px wider than the 1152 px content area at 1440 px on the synthetic data), with the Note column's desktop minimum at 104 px (phone 120); every cash-flow table fits at 1440 px again, rows take at most two lines, and no page scrolls sideways at 1440, 768 or 375 px (measured on the synthetic import).
- **Dividends (STYLE-4, 5, 9, 14, 18; CODE-1):** yields use the one-decimal default. The price source reads Typed, **Workbook** (an import row's formula price) or Yahoo; the edit form's price hint follows ("From the workbook: $X. Left blank, Yahoo's close replaces it when one is known"). `?holding=` scrolls the ledger into view once and focuses its Holding filter (the heading when there is no filter), and a meta line "Showing <symbol> in the ledger below" appears when the filter was accepted. After a failed or partial check, "none found" reads "No suggestions yet: the last check stopped early, …". **CODE-1:** `DividendForm` saves with `mutateAsync().then(…)` (the Integrator's GoalsSection pattern), and the confirm form sits at a fixed place in `SuggestionsSection` (outside the empty/non-empty branch), so confirming the last due suggestion closes the form and announces "Dividend added", and a later Restore brings no stale form back.
- **Shared (STYLE-17, STYLE-18):** an unstored enum/boolean setting's select shows its registry default as the placeholder ("Financial year (default)"). Side-income period dates are mono and right-aligned; words inside numeric cells ("Expected about", the adjustment note, the price source) use the body face (new `.jf-app-text-value--whole` keeps short words on one line). `app.css`: `.jf-app-row-actions__pair`, and `.jf-app-row-actions--pairs` now stacks explicit pairs (column) at ≥ 768 px instead of wrapping at 12rem (the table layout squeezed that column to one button per line).
- **CLI (CODE-4):** the "Rows:" line labels `cash balance entries` and `side income deposits`.
- **Engine purity (CODE-3):** ESLint also bans the multi-argument `new Date(y, m, d)`, a date-time string or template literal passed to `new Date`, and `localeCompare` / `toDateString` / `toTimeString`; `test/purity.test.ts` mirrors them (0 hits on the current source).
- **Server golden (SPEC-2):** Cash C22, C24, C27, Side Income C5 and SheetOptions H27 compare at the §9.5 1 cent; Budget F2 and L9 at 1 cent, or 12 cents only in the rule-14 recompute branch (the expectation's side-income mean is the API's rounded `avg365Cents`). The tallies are unchanged.
- **Docs (SPEC-3):** §10 demo frame 1 now names what an adjustment on a past closed period moves (the 3-month rate and trend move only for one of the last three closed periods; the year rate only for a closed period in the current FY). The private companion's §7 item 6 needs the same rewording by the coordinator.

**e2e:** `e2e/cashflow-mutations.spec.ts` gains "confirming the last active suggestion closes the form; a restore brings no stale form back" (dismisses the other suggestions through the API, confirms the last in the UI while holding back the import-runs refetch by 1.5 s so the dividends refetch renders before the save settles, then restores one in the UI; a `finally` deletes the dividend and restores every suggestion it dismissed). With the CODE-1 fix temporarily reverted the test fails ("Dividend added" never shows); with the fix it passes.

## Stage close notes (coordinator)

**Outcome (2026-09-26).** The flow ran in three workflows plus one amendment step:
1. Planner → 3 plan critics → reviser.
2. The owner answered the plan-review questions (D59–D62), and a plan amender applied them.
3. Scaffolder → engine, server-api, market-events, importer and web phase A in parallel → Integrator.
4. 3 reviewers → per-reviewer adversarial triage → Fixer → Verifier. The first attempt stopped at a session limit before any agent reported, and a clean re-run completed.

The owner approved the demo on the real database after a fresh backup (D62).
- **Final state:**
  - typecheck, lint, format:check, build and `guard:all` are green. The guard has 1856 private terms.
  - **2507 unit tests** pass (141 files) with none skipped. All six golden files ran: engine cash flow, history and investments, importer, and server cash flow and investments.
  - **e2e: 244 passed, 11 skipped** by viewport design. The `mutations` and `cashflow-mutations` projects ran.
  - The Verifier passed all 16 items of §10. The owner-import API checks matched the private companion in full, including the D59 reclassification and the D34 matrix.
- **Plan review:** the critics raised 56 findings; 52 were applied, 4 applied in part and none rejected. The owner answered the review's questions as D59–D62.
- **Code review:** 27 findings. Triage confirmed and fixed 24, deferred 2 to Stage 6 and refuted 1. None needed an owner decision.
- **Demo:**
  - Migration 0003 converted the owner database on the first start.
  - The two loans were set to "Loan you've made", a kind-only edit, so `hasAppData` stayed false.
  - Yahoo's first automatic check found 12 suggestions.
  - The owner skipped the demo adjustment and dismissal and adds a savings goal themselves.
  - All §11 fixes except fix 7 were accepted (D63). The cash-deficit wait stays on Total Cash (D64). Stale budget account names wait for the cutover (D65).

**Demo fix (coordinator).** Between 768 and 1199 px, the account tables' fixed column grid left the Account column about 80 px wide, and names broke mid-word. The reviewers had checked 1440 and 375 px only. `apps/web/src/app.css` now has a compact grid for that range (Balance 10.5 rem, As of 7 rem, Source 6 rem, Actions 8 rem, actions stacked). The Account column measures 201–392 px from 768 to 1199 px; 1440 px and the phone layout are unchanged, and Update balances still fits. A new e2e test in `e2e/cashflow.spec.ts` (desktop project) checks the column width and that no name word splits at 800, 1024 and 1199 px. It fails without the fix.

**Clarifications accepted by the coordinator:**
- The dividends FY table also keeps an FY after the as-of FY when a payment falls in it, so the table always adds up to the all-time total (engine report).
- An adjustment on the provisional month is an orphan: it attaches to closed periods only, and the orphan list lets it be removed (Integrator).

**Deferred (with target stage):**
- **Stage 4:** other assets, super and the mortgage feed the provisional period from the imported figures (`staticUntilStage4`); other-asset purchases in a foreign currency are skipped until Stage 4 adds FX.
- **Stage 5:**
  - An `origin = 'import'` settings row is kept on re-import when the workbook stops providing that key (settings gap rule 3 covers app rows only). Decide it with the Settings page.
  - Recording a month (the provisional period stays provisional until then).
- **Stage 6 polish:**
  - STYLE-13: the Dividends page with no holdings hides "Add dividend" without saying why.
  - STYLE-15: the side-income chart's empty states (no recorded period, or no streams).
  - The web bundle's chunk-size warning (route-level code splitting).
- **Backlog (importer):** a side-income amount typed as text writes a deposit but is missed by the count check. It is not triggered by the owner's workbook.
- **Stage 7:** fix the budget rows' stale account names at cutover (D65).

**Lessons carried forward:**
- Run the stack from the repo root. A relative `DATA_DIR` started from `apps/server` resolved outside the repo once; the Verifier caught and removed it.
- Check the in-between width (768–1199 px) as well as 1440 and 375 px; the Browser pane itself is about 800–1024 px wide.
- A custom select in the Browser pane needs a real click after `form_input` before React sees the value.

## Plan review log (2026-09-25)

Three critics (spec, feasibility, UX/privacy) reviewed this plan and the private companion. The plan reviser verified each finding against the code, the specs, the decisions and the local workbook (scratch under `artifacts/stage3/plan-reviser/`, plus re-runs of the critics' probes), then applied it, applied it in part, or rejected it. Findings are numbered in the order received; the critic's id is in brackets (three critics used the id PRIV-1). The open owner question (the savings goals' cash base, item 4) and the review questions put to the owner are **answered: D59–D62** (applied as items 57–60; no question is open).

| # | Finding (generic) | Outcome |
|---|---|---|
| 1 [SPEC-1] | The Side Income golden compared the live row's period end, which the plan's provisional period (ending at the as-of) cannot match; no rule covered that row | **Applied:** §9.3 rule 2 covers the Side Income live row (start and total compared with the provisional period; its end skipped, `live_window`); private §3 counts updated |
| 2 [SPEC-2] | The dividends FY rows could hold fewer than the sheet's five FYs, their order contradicted "the last five rows", and the row-11 totals had no defined five | **Applied:** `byFinancialYear` always holds the as-of FY and the four before it (zero rows kept) plus older FYs with payments; the first five rows, reversed, are the sheet's FY block; row 11 sums those five; both goldens compare per FY label (§2.2, §2.10, §9.2, §9.4) |
| 3 [SPEC-3] | The owner-import check used the corrections file, which moves one trade between two closed periods, yet expected every closed period to match the sheet | **Applied:** the private §5 lists both periods' expected values under corrections and why the KPIs do not move; #7 says a corrected trade date legitimately moves added investments (probes re-run) |
| 4 [SPEC-4] | The goals' cash base left out loans you've made, beyond the decision (total cash minus the emergency fund) and beyond the vetoable fix's scope (the emergency-fund test only); the contract could not follow a veto | **Applied in part:** the goals follow the decision as written by default (total cash); the contract is neutral (`goalsCashCents`, a server constant, `goals.cashBasis` in the DTO, copy that follows it); §11 fix 20 now covers the emergency-fund test only. **Owner question** raised (default: total cash); answered by D59 (available cash), item 57 |
| 5 [SPEC-5] | The cash projections (per year, end of year, gap per month, cash-target ETA) used the raw average cash gain, so an adjusted one-off kept being extrapolated | **Applied:** they use the adjusted average (§2.2, §2.6), listed as §11 fix 25; no raw variants (the raw switch drives the table and charts; the goldens feed no adjustments) |
| 6 [PRIV-1] | Two UI examples reproduced owner-derived values (a date range, a cash-target result); the date range also broke the period-start rule | **Applied:** generic examples (§6.3, §6.4); the date range now starts the day after the previous run |
| 7 [SPEC-6] | The side-income average rule dropped blank closed rows (the engine averages them as 0) and kept a filled live row; the include-side-income budget case had no rule | **Applied:** rule 6 recomputes over the closed rows with blanks as 0; new rule 14 recomputes the monthly income and what follows it when side income is included (§9.3) |
| 8 [SPEC-7] | The on-target cell depends on the live row but was compared as cached | **Applied:** added to rule 3 (recomputed from the closed-row projection); private counts moved |
| 9 [SPEC-8] | A numeric cash-deficit wait could not match the sheet, and the golden's cash and liquid-total inputs were unnamed | **Applied:** §9.1 names the inputs (the Stage 2 recomputed class values); new rule 13 recomputes a numeric value (and the error-branch zero); "-" ↔ null stays exact |
| 10 [SPEC-9] | KPI cells built on adjusted income had no raw variant, so a reinvested or blank dividend row would break their goldens with no rule | **Applied:** rule 8 extends to the year rate, the 3-period rate, the trend and the year income (`recomputed` when such a row is in their window) |
| 11 [SPEC-10] | The live row's imported deposits were dated at its month end, after the as-of, and FY-to-date had no as-of bound | **Applied:** the importer, the migration and the golden adapter date them at min(period end, as-of) (an info line when it happens); FY-to-date counts deposits dated ≤ as-of (§2.8, §3.1, §3.5, §9.1) |
| 12 [SPEC-11] | The private rolling-12 validity date was a month late | **Applied** in the private §5 |
| 13 [SPEC-12] | The sheet shows "not saving" before "reached" for the cash target; the emergency-fund basis is positional in the sheet, so the golden rule and the engine could disagree | **Applied:** the "reached first" order is §11 fix 24 and used by rule 3; rule 9 recomputes on the engine's basis whenever it differs from the sheet's positional sum (narrowed by item 59: with fix 7 vetoed only the Stage 2 last-row case remains) |
| 14 [SPEC-13] | Adjustments keyed by month could be saved on the provisional period, whose month can change, and silently orphan | **Applied:** adjustments on closed periods only, notes on recorded periods only; the server answers 400; the web hides the actions (§2.3, §3.4, §4.2, §4.5, §6.3) |
| 15 [SPEC-14] | The server's live principal paid ignored mortgage interest and fees, unlike the sheet | **Applied:** the rule is payments minus interest and fees (none before Stage 4); the server golden skips the provisional period when the live interest cell is non-zero (§4.5, §9.3 rule 2) |
| 16 [SPEC-15] | The yearly chart unit grouped by calendar year, against the FY default | **Applied:** `compressCashflow` takes the year basis; `compressSeries` gains an optional one (default calendar, so Stage 2 charts are unchanged until Stage 5); the side-income chart uses the FY (§1.5, §2.2, §2.13, §5) |
| 17 [FEAS-1] | The Scaffolder's done-check needed edits to Stage 2 files owned by others (the engine fakes, the timing DTO literal, expectation tests, the member list, the seeded cash totals) | **Applied (blocker):** the Scaffolder row lists these minimal compile and expectation fixes, plus any other the typecheck or tests name for the same reason, each in the Scaffold notes (§7.1, §7.2) |
| 18 [FEAS-2] | The dividends job was registered only with a refresh interval, so the refresh route failed in tests and e2e | **Applied:** registered in live and fake modes always, with interval 0 when the refresh minutes are 0 (§4.2, §4.6, §8) |
| 19 [FEAS-3] | Same as item 3 | **Applied** (item 3) |
| 20 [FEAS-4] | Same as item 2 | **Applied** (item 2) |
| 21 [FEAS-5] | A veto of the loans-out emergency-fund fix would need a frozen signature change | **Applied:** `cashTotals` takes `loansCountForEmergencyFund`; the server passes one constant; the DTO reports it and the copy follows (§2.2, §2.4, §4.4, §4.5) |
| 22 [FEAS-6] | The web copy needed stale/unpriced counts and the target cash share and aggressiveness, which no DTO carried | **Applied:** `goals.unpricedCount`, `goals.stalePriceCount`, `summary.cashTargetRatio`, `summary.aggressiveness`; fixtures carry them (§3.6, §4.4) |
| 23 [FEAS-7] | The migration's conversion test depended on seed rows that another agent later removes | **Applied:** the test inserts its own raw rows (a zero amount, a null end, an end after the as-of, an app row); server-api owns the migration tests after scaffolding (§7.1, §7.2) |
| 24 [FEAS-8] | One server agent carried routes, context, timing chain and the market data; web carried four pages | **Applied in part:** a fifth implementer, market-events, owns the dividend-events service behind the frozen interface (the Scaffolder stubs an off service); the build workflow has 7 agents. The web split is rejected: the four pages share the hooks, helpers and form patterns, a split would need another internal contract, and Stage 2's single web agent carried a comparable load |
| 25 [FEAS-9] | The provisional salary needed the engine's private pay factors | **Applied:** a frozen `monthlyPayCents` sharing one factor table with the budget (§2.2, §4.5, §7.3) |
| 26 [FEAS-10] | The purity scan read comments, so ordinary words would fail it | **Applied:** comments stripped, call-shaped patterns, a test that a comment is not a hit (§2.1) |
| 27 [FEAS-11] | The dividends job did not share the price job's rate-limit cool-down or have a deadline | **Applied:** one shared cool-down (an optional price-service option), a wait while prices refresh, the price job's run deadline (§4.6) |
| 28 [FEAS-12] | A DTO referenced an engine type, which the schema package cannot import; two DTOs were "field for field" only | **Applied:** every DTO declared explicitly; a server-side type-level assignability test (§3.2, §4.4, §4.5) |
| 29 [FEAS-13] | The settings-gap acceptance check passed without the new rule | **Applied:** #9 and the importer tests also edit a key the workbook does not provide and check it is removed by a forced re-import (§7.6, §10) |
| 30 [FEAS-14] | Same as item 14 | **Applied** (item 14) |
| 31 [FEAS-15] | An account's kind was carried over only when its row-based ref and name both matched, so an inserted row reset a reclassified loan silently | **Applied:** match by a unique name, else ref and name; an info line lists kinds that could not be carried over (§3.5, §7.6) |
| 32 [FEAS-16] | Trade and instrument changes did not refresh the new pages | **Applied:** the Stage 2 investment invalidation covers the four new keys (§6.2) |
| 33 [FEAS-17] | Ownership nits: a double-owned test, an unowned server golden and e2e helper; the UI test project missing | **Applied** (§1.4, §7.1) |
| 34 [PRIV-1] | Example copy matched owner-derived values; the guard cannot catch dates | **Applied:** generic examples (§6.3–§6.5); the distinctive run dates join the private guard terms (month-end dates skipped as generic) |
| 35 [PRIV-1] | The period date example used two real owner dates and broke the start rule | **Applied** (item 6) |
| 36 [PRIV-3] | The guard-term list missed display, API and cents forms of several page figures and amounts inside imported notes | **Applied in part:** 43 of the 45 proposed forms appended (two round amounts skipped as too generic), plus the corrected-period and goals figures and the dates (95 terms); the guard passes with the combined list. The term-generator script was not extended; the terms are listed directly |
| 37 [UX-1] | The emergency-fund tile described what counts inaccurately and never used the per-account flag | **Applied:** the copy follows the two flags; accounts left out carry a muted marker; the goals line follows its own basis (§6.3) |
| 38 [UX-2] | The budget table needed two totals that the table component cannot show, and neither total equalled its rows | **Applied:** a spending table and a leftover-split table with an "unallocated (rounding)" line from a new engine and DTO field; the teal cell is the leftover total (§2.2, §2.9, §4.4, §6.5) |
| 39 [UX-3] | Adjust and Note on the baseline and provisional rows lead to lost records | **Applied in part:** no Adjust on the baseline; the provisional row has Details only; the server refuses both (item 14). Orphaned notes are not added to the callout: a note can no longer be saved on an unrecorded month |
| 40 [UX-4] | Parts, the check-badge reason and the off-mode reason were hover or title only | **Applied:** a Details action with an inline card on every device; a visible foot note linked to the badge; the off mode per item 50 (§6.3) |
| 41 [UX-5] | The inline balance editor could not hide field labels and its layout was unspecified | **Applied:** web may add a hidden-label prop (tested, noted); one form around every group with the shared date, note and Save under the section bar; shared column widths; no kind column inside a group (§6.1, §6.3, §7.1) |
| 42 [UX-6] | Which negative figures are red was unspecified | **Applied:** red only for negative savings or rates and negative balances of any kind; flows in body text; tests assert both (§6.1) |
| 43 [UX-7] | Dismissed suggestions could become unreachable; no "none found", error or result feedback; the confirm form's place was unspecified | **Applied:** the section shows whenever a check has run, with "none found", summary and error callouts, and the confirm form inline under its row (§6.6) |
| 44 [UX-8] | Same as item 22 | **Applied** (item 22) |
| 45 [UX-9] | Several specified controls needed component features that do not exist | **Applied:** a datalist prop on the text field (web-owned, tested); fallbacks for the rest: kind-labelled holding options, a muted pill for upcoming, the rate in a tile hint, the link in a tile value (§6.1, §6.3–§6.6) |
| 46 [UX-10] | Phone column orders left out desktop columns | **Applied:** every column listed; badges stay in the first cell (§6.9) |
| 47 [UX-11] | Teal was unspecified for several total rows | **Applied:** one choice per page in §6.1 (only the budget leftover total is teal) |
| 48 [UX-12] | Two chart colours that must never touch could be adjacent in the dividend stacks | **Applied:** a series order that keeps the usual middle series between them; colours and legend order unchanged (§5) |
| 49 [UX-13] | The next-buy cadence text gave the wrong interval; the missing-inputs footer was out of date | **Applied** (§6.7) |
| 50 [UX-14] | The Yahoo check button did not follow the Prices refresh pattern and showed a time without a date | **Applied** (§6.6) |
| 51 [UX-15] | Confirming a suggestion flagged the price as typed and offered confirm before payment | **Applied:** price left blank with the close in the hint; confirm on due rows only (§6.6) |
| 52 [UX-16] | A balance dated before the latest entry looked like a no-op save; no note field | **Applied:** an inline row note and one optional shared note (§6.3) |
| 53 [UX-17] | The meter's accessibility was incomplete, over-target values were undefined, and one listed use had no placement | **Applied:** min/max/value text, clamping with the true figure, an over-by status; the emergency fund stays a tile (§6.1) |
| 54 [UX-18] | Creating rows blocks re-import silently | **Applied:** a one-line note on create forms while no app data exists (§6.8) |
| 55 [UX-19] | Several empty and null states had no copy | **Applied:** copy for each, plus fixture states (§3.6, §6.5, §6.10) |
| 56 [PRIV-2] | Two examples copied owner results or settings | **Applied** (items 6 and 34) |
| 57 | Owner decision D59: loans you've made count only in Total Cash, net worth and the savings engine; the emergency-fund test, the goals' "saved so far", the cash savings target and the end-of-year cash goal use available cash | **Applied:** `GOALS_CASH_BASIS = 'available'`; the KPIs' `currentCashCents` is available cash while the monthly rate stays the average total-cash gain (snapshots record total cash only; stated in §2.6); §11 fix 20 widened to the four uses; every "pending owner confirmation" marker removed; the golden adapter unaffected (every workbook account is a bank account, so available = total); private expectations and demo figures recomputed (§1.1, §2.2, §2.4, §2.6, §2.7, §2.9, §3.6, §4.4, §4.5, §6.3, §7.3, §7.4, §9.1, §9.4, §10, §11, §12) |
| 58 | Owner decision D60: past side income that includes loan principal repayments stays as imported | **Applied:** stated in §1.5 (nothing edits an imported deposit's amount), the demo frames and the private notes; re-import stays available |
| 59 | Owner decision D61: fixes 12 (every dividend is income) and 15 (income-weighted year rate) accepted; fix 7 (savings lines out of the emergency-fund basis) vetoed | **Applied:** fixes 12 and 15 marked accepted; fix 7 kept as a one-line veto note (numbering stable); step 5 of `budgetInvestment` unchanged (the sheet's basis, the Stage 2 range fix still applies); the planned `savingsLine?` item flag on `BudgetInvestInput` dropped (the row-level `savingsLine` stays a display flag); `emergencyFundBasisCents` = the planned spend; golden rule 9 compares `Budget!D3` as cached and the Stage 2 golden is unchanged; private counts, expectations and demo figures updated (the emergency fund itself does not change on the owner data) (§2.2, §2.9, §7.1, §7.3, §7.9, §9.2, §9.3, §10, §11) |
| 60 | Owner decision D62: the demo runs on the real database after a fresh backup, with re-import-safe actions only (loan kinds, an adjustment, a goal, a dismissal); Yahoo suggestions cover AUD listings, a 14-day expected payment gap and a 90-day match window | **Applied:** demo frames rewritten (a fresh backup step, exactly those four actions, no Confirm); the three suggestion values marked owner-confirmed (§2.11, §10, §11 fix 10) |
