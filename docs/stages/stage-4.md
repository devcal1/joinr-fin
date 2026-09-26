# Stage 4 — Other Assets, Super & Property: build plan

_Planner output, 2026-09-26. Inputs: PLAN.md (Architecture, Stage 4, Stages 5–6 for deferrals), docs/HANDOFF.md, docs/DECISIONS.md (D2, D5, D23, D25, D29, D34, D37, D49, D51, D56, D58, D59, D66–D73 are the Stage 4 kickoff answers), docs/STAGE_PROCESS.md, docs/stages/stage-3.md in full (structure, frozen-contract style, Scaffold notes, close notes, plan review log) and the data-model, importer and price-service parts of stage-1.md, spec 04 §0–§3 and §7 (the source of truth), spec 01 (Net Worth C9–C11, D9–D11, C21–E21, C51, E52; History Q–T, X–AE, AJ–AK; compressTable), spec 02 (Cash!L), the Stage 1–3 code, and the local workbook (read with the workspace's SheetJS through `@joinr/importer`'s reader in scratch scripts under `artifacts/stage4/planner/`)._

> **This repo is PUBLIC.** Nothing from `reference/` (except `reference/brand/`) or `docs/private/` may be copied into any other file: no amounts, balances, prices, rates or dates of purchase, no items, funds, lenders, accounts or businesses the owner has, no addresses, IPs, emails, Drive ids. Code, tests, seeds, fixtures and committed docs use only generic values: `EXAMPLEFUND`, "Example Super Fund", "Example Property", "Example watch", "Sealed box", "Silver bar", round numbers. The owner-specific facts for this stage are in **`docs/private/stage-4-private.md`** (git-ignored): the engine, server-api, market-data and importer implementers, the spec reviewer, the code reviewer and the Verifier read it; nobody copies from it.
>
> **Golden tests never contain owner values:** they read every expected value from the local workbook at runtime and skip when it is absent (§9). **No snapshot files** (`toMatchSnapshot` & co.). The guard also blocks any committed path with a folder segment named `data`.

**Flow:** Coordinator pre-step (guard terms incl. rounded forms, a `data/` backup, §7.0) → **Scaffolder** (alone; must pass its done-check, §7.2) → 5 implementers in parallel (**engine**, **server-api**, **market-data** (FX, the purchase-date FX backfill and the series history), **importer**, **web phase A**) → **Integrator** (web phase B + e2e; starts when engine, server-api, market-data and importer have reported done, §7.8) → Reviewers in parallel (**spec-correctness**, **style-ux**, **code-quality/security**) → per-reviewer triage → **Fixer** → **Verifier**. At most 10 agents per workflow: the build workflow has 7 (Scaffolder, 5 implementers, Integrator), the review workflow 6 (3 reviewers, triage, Fixer, Verifier). **Nobody commits or pushes.** The coordinator commits at stage close with the owner's OK (D10).

**Golden values:** template cell references only (§9); the values are read from the workbook at runtime. TODAY()-dependent cells (Other Assets `R`, Property rows 23, 33 and 35) are compared at the workbook's as-of (`Net Worth!E52`), which the adapter reads from the workbook. Cells whose app definition differs by decision (D66, D69, D71, D73) or by a §11 fix are compared through a sheet-faithful variant where one exists, otherwise skipped with a counted reason (§9.3). **Template bug fixes applied in Stage 4:** §11 (vetoable at the plan review or the demo).

**Verified by the Planner against the workbook (2026-09-26, scratch scripts).** With the workbook's cached values and its as-of dates (`Net Worth!E52`, `C51`):
- **Other Assets:** every cached `M`, `N`, `O`, `P`, `Q` of every row, `R` of every row at `E52` (including the undated rows' near-zero values, which come from `TODAY() − 0`), `D3`, `D4` and `D5` reproduce; cached results keep 10 significant digits, so a few gain cells can differ from a float recomputation by under 1e-8 (§9.5). The hidden history block `Y:AC` reproduces: `Z` is `SUMIFS(N, G, "<"&date)` (strictly before the snapshot date, undated rows never counted), `AA`/`AB` copy History `AJ`/`AK`, and the current-month row is blank (the chart's zero artefact). A purchase can fall on a snapshot run date, where the sheet's `Z` (`<`) and its savings window (`≤`) disagree (§11 fix 13).
- **Super:** `B12` = `SUM(B2:B10)`, the history block `E:J` equals History `A, R, Q, S, T` on every row, `T` = `IFERROR(S/(Q−S), 0)` on every row, the live row takes `B12`, `B16` and `B11`, and `B19` = `SLOPE(J, E) × 365` reproduces (all three are 0 when the reported-gain cells are left blank).
- **Property:** `F6`–`F12` (including `F12`'s negative sign), per property `21`–`23` and `31`–`35` at `E52` (`X35` through `NPER` and `EDATE`, `X33` through `CUMIPMT` over whole years), and every cell of the hidden history block `Z:AF` reproduce. With a principal-only formula in row 30, `X31` (interest) is 0 by construction. In "sheet mode" (payment frequency = compounding frequency, payment × 12 ÷ frequency) a real amortisation loop needs exactly `⌈NPER⌉` payments and its first period's interest equals `X32` to the cent.
- **History:** on every row `T` = `S/(Q−S)`, `Z` = `X + AB`, `AE` = `AA/(X−AA)` (each with the sheet's IFERROR 0), and the live row takes `Net Worth!C9`, `D9`, `C10`, `D10`, `C11`, `D11`, `Property!F6`, `−|F10|`, `|ΣD31:O31|` and `|F11 − |AC||`; `Net Worth!C21` (`−|ΣD28:O28|`) reproduces, and `D21`/`E21` are `|F11|` and `−|F10|` (formula aliases).
- **Cash!L parts from these tabs:** dated other-asset purchases per snapshot window (`N` by `G` in `(prev, this]`; the first row's window is its calendar month), super `R`, the mortgage principal `ΔAD` and the property deposit `ΔY + ΔAB` reproduce per window, and with the app's rules (below) the provisional period's parts equal the live row's.
- **The app's principal paid equals History `AD`:** for payments entered as positive amounts, `AD = |F11 − |AC|| = |start| − |current|` whenever the used slots' row-31 interest sums to ≥ 0 (the template default and a principal-only formula both do), so the start − current rule (D66) reproduces every `AD`, and the Stage 3 server golden's interest condition narrows to that case (§9.3 rule 12).
- **ATO figures** (§3.3, recorded 2026-09-26 from ato.gov.au search results; the pages themselves refused automated fetches): super guarantee **12 %** from 1 July 2025 (the last legislated step; still 12 % in 2026–27; 11 % in 2023–24 and 11.5 % in 2024–25); general concessional contributions cap **$30,000** for 2024–25 and 2025–26 and **$32,500** from 1 July 2026 (AWOTE indexation); non-concessional cap $130,000 for 2026–27; from 1 July 2026 employers pay SG each payday ("Payday Super"). A contribution counts toward the cap of the financial year in which the fund **receives** it; the last quarterly SG payment (April–June 2026) is due by 28 July 2026, so it counts in FY2026–27 (plan review, search summaries of the ATO "Payday Super: how to manage super during the changeover" and "Concessional contributions cap" pages, 2026-09-26).

Details, including which cells the sheet itself broke and how many rows each runtime rule catches, are in `docs/private/stage-4-private.md` §1–§3.

**Plan review (2026-09-26):** three critics' 60 findings were verified and applied, applied in part or rejected (the Plan review log at the end). The owner answered the review's questions on 2026-09-26 by accepting every proposed default (D74–D78); nothing is pending. The §11 fixes stay vetoable at the demo.

---

## 1. Overview & flow

### 1.1 What Stage 4 delivers
1. **`@joinr/engine`** (pure TypeScript, §2), additions:
   - **Other assets** (D72, D73): cost of the remaining units (at the FX rate on the purchase date), value (hand-priced with an as-of date and a stale rule, or bullion from spot × oz per unit), gain $ and %, a CAGR with the D73 assumed date, sales with a realised gain, the cost-held line for the history chart, and the dated flows the savings engine takes.
   - **Super** (D69–D71): the per-fund balance log (with transfers in that are not gains), the SG estimate per month (the statutory rate of each FY) with statement overrides, typed contributions (salary sacrifice or after-tax; imported entries interpreted by a setting), the net-pay cost vs the amount the fund receives, a derived gain per period, a chained Modified Dietz return, and the concessional cap meter per financial year (SG counted in the FY the fund receives it).
   - **Property and loans** (D66–D68): valuation history, gain (net rent included) and CAGR, equity and LVR net of linked offsets, the D66 balance log with derived repayments and interest per entry (the loan's start fields give its first point), and a real amortisation schedule on the loan's payment dates (separate payment and compounding frequencies) with and without the offset.
   - **The Stage 5 seam:** `assetsSnapshotColumns` yields the live History `Q`–`T`, `X`–`AE` and `AJ`–`AK` from the three results, and each result carries the savings engine's live parts, replacing `staticUntilStage4`.
   - **Savings engine additions:** offset balances (Δ offsets count as savings, §11 fix 7) and sales as negative added investments (§11 fix 16).
2. **Schema** (§3): migration `0004_stage4_assets` (other-asset price history and sales, the FX rate at purchase, super balance entries, SG overrides (an overlay), property valuations, loan balance entries, loan offset links, the market series history; the conversion of existing rows), six app-only setting keys (one written by the server), the statutory super tables and the payment-date helper, request schemas, DTOs, error codes, fixtures and seed updates.
3. **Server** (§4): the Other Assets, Super and Property APIs with CRUD and the D34 origin rules; the finance context extended with the three engines; the provisional savings period fed live by them; bullion and FX from the price service.
4. **Market data** (§4.6): FX for the currencies other assets use, the FX close on a purchase date fetched once and stored, and a daily series history (bullion spot, FX) for the price charts.
5. **Importer** (§3.5): price, balance, valuation and loan entries; super contributions from the History rows; the FX rate at purchase from the sheet's cached cost; the SG fund carried across a re-import.
6. **Web** (§6): the `/other-assets`, `/super` and `/property` pages with forms, charts and phone layouts; the Cash page shows an offset account's linked loan and the new savings part.
7. **Golden tests** (§9): engine goldens fed sheet-faithful inputs, and a server golden that goes import → DB → API.

### 1.2 Workspace changes (no new packages)
```
packages/schema/     + db tables (assets.ts, instruments.ts), rows, records, enums, settings (6 keys, SettingCategory
                       'super' | 'assets', EDITABLE_SETTING_KEYS), src/assets.ts (the statutory super tables, Stage 4 constants,
                       paymentDatesBetween), src/dto/assets.ts, dto/errors.ts, dto/cashflow.ts (additive fields,
                       SETTINGS_PATCH_MAX_KEYS), fixtures/assets.ts (+ cashflow.ts updates), coverage, sampleDtos, testing/{seed,dump}.ts
packages/engine/     + src/{otherAssets,super,property,amortise,assetsSnapshot}.ts, savings.ts (offsets, sales),
                       types.ts additions, test/** (+ test/golden/assets.*)
packages/importer/   extract.ts, model.ts, writer.ts, process.ts, reconcile.ts; tests
packages/ui/         Meter: additive cap props (web-owned, §6.1)
apps/server/         + migrations/0004_stage4_assets.sql (+ meta), src/assets/**, src/routes/{otherAssets,super,property}.ts,
                       src/market/{fxHistory,history}.ts; edits: app.ts, cashflow/{context,inputs,cash,constants,responses}.ts,
                       cashflow/mutations/cash.ts (offset flag off clears a link; note kinds), investments/load.ts, records/index.ts,
                       cli/import.ts (labels), market/{refresh,service}.ts, market/providers/{yahoo,fake,types}.ts, db/queries/domain.ts
apps/web/            + src/pages/{otherAssets,super,property,assets}/**, api additions, typed routes;
                       edits: pages/cash/{AccountForm,SavingsSection}.tsx (linked loan, offsets part, the Stage 4 note)
e2e/                 + assets.spec.ts, assets-states.spec.ts, assets-mutations.spec.ts, assets-support.ts;
                       edits: ui-core.spec.ts, records.spec.ts, import.setup.ts
playwright.config.ts + the `assets-mutations` project
```

### 1.3 Dependencies (no third-party additions)
No package changes anywhere. Non-integer powers (CAGR, the periodic rate from the compounding frequency, the Modified Dietz chain annualised) use decimal.js `pow` through `JoinrDecimal` (it supports non-integer exponents); floats stay confined to XIRR. pnpm 11 rules are unchanged: `allowBuilds` untouched, never `pnpm approve-builds`. **Only the Scaffolder may run `pnpm install`** (it should not need to). Implementers never edit a dependency list or the lockfile; stop and report instead.

### 1.4 Scripts
No new root scripts. Scoped commands used in this plan:
- `pnpm vitest run --project engine` (unit + golden) and `--project engine test/golden`
- `pnpm vitest run --project server test/assets`, `--project server test/market`, `--project server test/golden`, `--project server test/cashflow`
- `pnpm vitest run --project importer`
- `pnpm vitest run --project schema`
- `pnpm vitest run --project web src/pages/otherAssets src/pages/super src/pages/property src/pages/assets src/pages/cash`

### 1.5 Not in Stage 4 (deferred; the UI says so where it matters)
- **Stage 5:**
  - Recording snapshots. Stage 4 exposes the live History figures (`assetsSnapshotColumns`, §2.8); Stage 5 records them (and decides how a snapshot stores the offsets, §2.8). The pages say "The current period stays provisional until a month is recorded (Stage 5)."
  - The Net Worth dashboard (liabilities = mortgages net of their linked offsets + negative-balance cash accounts, PLAN.md Scope) and the monthly/quarterly/yearly aggregation API.
  - The Settings page. Stage 4 pages edit only the settings they use (§3.3).
- **Stage 6:** the FIRE planner, including the D68 exclusion of the primary residence (the Property page says "FIRE (Stage 6) leaves the primary residence out"); the polish pass (loading skeletons, the keyboard and number-format audits).
- **Not built:** LiabilitiesDebts and Capital Gains (D2): a loan with no property is listed as "not tracked" and counts nowhere; retirement-tagged holdings (D37); a price feed for collectibles (D72: hand-priced); Division 293, carry-forward concessional caps, the transfer balance cap and preservation rules; the SG maximum contribution base; CGT on property, stamp duty, LMI, depreciation and negative gearing; a history of interest-rate changes (the schedule uses the current rate) and of the regular repayment (a changed repayment re-estimates every entry without entered repayments, §2.6; D76); a salary history (past months' SG estimates use today's salary: enter statement figures where it changed); an employer that paid SG before its quarterly due date (before 1 July 2026 the cap meter counts SG at its due date, §2.5); SG to more than one fund at a time (§2.5); multi-currency cash accounts (D25).

---

## 2. Engine spec (`@joinr/engine`)

### 2.1 Conventions (all engine code; Stage 2 §2.1 and Stage 3 §2.1 still apply)
| Concern | Rule |
|---|---|
| Purity | No I/O, no clock, no randomness, no timers, no host time zone or locale. `asOf` is always an input. The Stage 3 ESLint rules and `test/purity.test.ts` cover the new modules unchanged. |
| Imports | `@joinr/schema` **root** only (enums, decimal helpers, `addMonthsIso`, `financialYearOfIso`, the statutory super table of §3.3). |
| Arithmetic | `JoinrDecimal` for money, units, prices, rates and ratios. **Non-integer powers** (CAGR, the periodic rate of a compounding frequency, an annualised chain) use `JoinrDecimal.pow`; floats only inside XIRR (unchanged). |
| Boundaries | Money in and out as integer cents; units, prices, FX rates and ounces as normalised decimal strings; ratios with 12 significant digits; dates as `IsoDate`, months as `IsoMonth`. |
| Rounding | Compute in decimals, round **once** at each output, half away from zero. A row's money figures are rounded per row; a **table total is the Σ of its rows' rounded cents** (so the page's totals add up); **ratios and averages come from unrounded decimals** (a total's gain ratio is Σ unrounded gain ÷ Σ unrounded cost). |
| Nulls | A figure that cannot be computed is null (never 0) and the row carries a flag saying why (§2.4–§2.6). A null inside a sum is left out of it; a sum with no values is 0 where the sheet shows 0, null where noted. |
| Errors | Data problems give nulls or flags; `RangeError` only for programmer errors (malformed decimals or dates, a non-positive `stalePriceDays`). |

### 2.2 Public API (FROZEN — additions to `packages/engine/src/types.ts` + `src/index.ts`)
The Scaffolder appends every type below to `types.ts`, adds a stub throwing `new Error('engine: not implemented')` for every new function to `index.ts` (`amortise` may be real), adds the new members to `EngineApi` and the `engine` value, and adds `ASSETS_ENGINE_IMPLEMENTED = false` (the engine owner sets it `true` only after its full Stage 4 unit suite, goldens included, passes). It gates the server's Stage 4 integration, route and golden tests **and**, because the shared finance context then reads the other-assets class value and the provisional savings input from the new engine calls, the four Stage 2–3 real-engine server suites (`test/cashflow/integration.test.ts`, `test/investments/integration.test.ts`, `test/golden/cashflow.golden.test.ts`, `test/golden/investments.golden.test.ts`; §7.4). The stubs keep throwing: no fallback path to the Stage 3 static inputs is built. `ENGINE_IMPLEMENTED` and `CASHFLOW_ENGINE_IMPLEMENTED` stay `true`. Names, fields and signatures below do not change; internal modules are free. The compile and expectation fixes these additions force in Stage 2–3 files (the server's fake engine, the engine's API member and savings tests, fixtures that build a `SavingsPeriod`) are the Scaffolder's (§7.1).

```ts
import type {
  ChartDateUnit, DecimalString, IsoDate, IsoMonth, LoanEntryFlag, LoanFlag, Metal, OtherAssetFlag,
  PaymentFrequency, PriceStatus, SavingsPeriodStatus, SuperCapStatus, SuperContributionType, SuperFlag,
} from '@joinr/schema';

// ─── Stage 3 types changed additively ──────────────────────────────────────────────────────────
// SavingsSnapshotInput gains: offsetCents?: Cents | null   // Σ offset accounts at the run date (Stage 4: the latest snapshot only, §2.9)
// SavingsLiveInput gains:     offsetCents?: Cents | null   // Σ offset accounts now (§2.9)
// SavingsPeriod.added gains:  offsetsCents: Cents          // Δ offsets; 0 unless both sides are non-null (§2.9, §11 fix 7)
// SavingsInput.otherAssetPurchases (unchanged type) now carries sales as negative amounts (§2.4, §11 fix 16)

// ─── Other assets (§2.4) ───────────────────────────────────────────────────────────────────────
export interface EngineOtherAssetSale { id: number; saleDate: IsoDate; units: DecimalString; proceedsCents: Cents }
export type EngineOtherAssetPricing =
  | { source: 'manual'; unitPrice: DecimalString | null;      // the latest price entry, in the asset's currency
      priceAsOf: IsoDate | null }
  | { source: 'bullion'; metal: Metal; ozPerUnit: DecimalString;
      spot: { audPerOz: DecimalString; asOf: IsoDate; fresh: boolean } | null;   // XAG/XAU_AUD_OZ (§4.5); null = no value
      fallbackUnitPrice: DecimalString | null;                 // the row's last known AUD unit price (the import's cached price)
      fallbackAsOf: IsoDate | null };
export interface EngineOtherAsset {
  id: number;
  purchaseDate: IsoDate | null;                                // null → the D73 assumed date
  units: DecimalString;                                        // bought (template H)
  legacySoldUnits: DecimalString;                              // the workbook's sold units (L): no proceeds known
  unitCost: DecimalString | null;                              // per unit, in `currency` (J)
  currency: string;                                            // 'AUD', an ISO 4217 code, or 'GBX' (UK pence)
  purchaseFxRate: DecimalString | null;                        // AUD per 1 unit of `currency` at purchase; ignored for AUD
  pricing: EngineOtherAssetPricing;
  sales: readonly EngineOtherAssetSale[];
}
export interface OtherAssetsInput {
  asOf: IsoDate;
  assets: readonly EngineOtherAsset[];                         // display order
  fxRates: Readonly<Record<string, DecimalString>>;           // live AUD per 1 unit by currency code ('GBX' = GBP ÷ 100); AUD implicit
  assumedDate: IsoDate | null;                                 // D73: the first snapshot's run date; null without snapshots
  stalePriceDays: number;                                      // otherAssets.stalePriceDays ?? 90 (whole days ≥ 1)
  snapshots: readonly { periodMonth: IsoMonth; runDate: IsoDate; otherValueCents: Cents | null;
    otherGainCents: Cents | null }[];                         // History AJ, AK (chart history)
  chart: { unit: ChartDateUnit; count: number | null };
}
export interface OtherAssetSaleResult { id: number; saleDate: IsoDate; units: DecimalString; proceedsCents: Cents;
  costCents: Cents | null; realisedCents: Cents | null }     // cost of the units sold (at purchase FX); proceeds − cost
export interface OtherAssetResult {
  id: number;
  remainingUnits: DecimalString;                               // M = units − legacy sold − Σ sales (never below 0; 'oversold')
  costCents: Cents | null;                                     // N = remaining × unit cost × purchase FX
  unitPriceAud: DecimalString | null;                          // today's AUD price per unit
  valueCents: Cents | null;                                    // O = remaining × unitPriceAud
  gainCents: Cents | null;                                     // P = value − cost (both rounded: the row adds up)
  gainRatio: DecimalString | null;                             // Q = unrounded gain ÷ unrounded cost
  cagrRatio: DecimalString | null;                             // R fixed: (value ÷ cost)^(365.25 ÷ heldDays) − 1
  effectiveDate: IsoDate | null;                               // purchaseDate ?? assumedDate
  dateAssumed: boolean;                                        // D73
  heldDays: number | null;                                     // asOf − effectiveDate
  priceStatus: PriceStatus;                                    // §2.4 table
  priceAsOf: IsoDate | null;
  sales: OtherAssetSaleResult[];                               // sale date order
  realisedCents: Cents;                                        // Σ non-null realised
  flags: OtherAssetFlag[];
}
export interface OtherAssetsChartPoint { label: string; period: IsoMonth; date: IsoDate; live: boolean;
  costCents: Cents | null; valueCents: Cents | null; gainCents: Cents | null; gainRatio: DecimalString | null }
export interface OtherAssetsResult {
  assets: OtherAssetResult[];                                  // input order
  totals: {
    valueCents: Cents;                                         // D3 = Σ row values
    costCents: Cents; gainCents: Cents;                        // over rows with both a value and a cost; D4 = Σ gains
    gainRatio: DecimalString | null;                           // D5 = Σ unrounded gains ÷ Σ unrounded costs (those rows)
    realisedCents: Cents; proceedsCents: Cents;
    unpricedCount: number; staleCount: number; assumedDateCount: number;
    fxMissingCount: number;                                    // flag purchase_fx_missing (the cost is unknown)
    liveFxMissingCount: number;                                // flag live_fx_missing (the value is unknown)
  };
  savingsFlows: { assetId: number; date: IsoDate; amountCents: Cents; kind: 'purchase' | 'sale' }[];  // date, asset, id order
  chart: OtherAssetsChartPoint[];
  snapshot: { otherValueCents: Cents; otherGainCents: Cents }; // History AJ, AK (= totals)
}

// ─── Super (§2.5) ──────────────────────────────────────────────────────────────────────────────
export interface EngineSuperFund { id: number; receivesSg: boolean; archived: boolean;
  balances: readonly { id: number; asOf: IsoDate; balanceCents: Cents;
    transferInCents: Cents | null }[] }                        // money moved in from outside the tracked funds (not a gain)
export interface EngineSuperContribution { id: number; fundId: number | null; date: IsoDate;
  kind: 'voluntary_contribution' | 'salary_sacrifice' | 'after_tax'; amountCents: Cents }
export interface SuperInput {
  asOf: IsoDate;
  snapshots: readonly { periodMonth: IsoMonth; runDate: IsoDate; superValueCents: Cents | null }[];   // History Q
  funds: readonly EngineSuperFund[];
  contributions: readonly EngineSuperContribution[];          // member contributions (never SG)
  sgOverrides: readonly { periodMonth: IsoMonth; grossCents: Cents }[];   // statement figures (before contributions tax)
  grossAnnualSalaryCents: Cents | null;                        // pay.grossAnnualSalaryCents
  jobStartDate: IsoDate | null;                                // pay.jobStartDate
  sgRatio: DecimalString | null;                               // super.sgRate: your employer's rate for every month;
                                                               //   null → SUPER_SG_RATES for each month's FY (§3.2)
  contributionsTaxRatio: DecimalString;                        // super.contributionsTaxRate ?? SUPER_CONTRIBUTIONS_TAX_DEFAULT
  marginalTaxRatio: DecimalString | null;                      // tax.marginalRate
  importedContributionType: SuperContributionType;             // super.importedContributionType ?? 'salary_sacrifice'
  concessionalCapOverride: { cents: Cents; financialYear: number } | null;   // super.concessionalCapCents + …CapFy (§3.3)
  chart: { unit: ChartDateUnit; count: number | null };
}
export interface SuperContributionResult {
  id: number; fundId: number | null; date: IsoDate; kind: EngineSuperContribution['kind']; amountCents: Cents;
  estimate: boolean;                                           // an imported (untyped) entry read through importedContributionType
  preTaxCents: Cents | null;                                   // the concessional amount (salary sacrifice, typed or read)
  fundReceivesCents: Cents;                                    // after contributions tax where it applies
  netPayCostCents: Cents | null;                               // what it cost in take-home pay (the savings rate); null: §2.5
  concessional: boolean;
}
export interface SuperSgMonth { month: IsoMonth;               // the month the SG was earned (as on a payslip)
  source: 'statement' | 'estimate' | 'none';
  grossCents: Cents; fundReceivesCents: Cents; fundId: number | null;
  capFinancialYear: number }                                   // the FY whose cap counts it (§2.5 step 7)
export interface SuperFlows { sgGrossCents: Cents; sgFundCents: Cents; memberFundCents: Cents;
  memberNetPayCents: Cents; concessionalCents: Cents; nonConcessionalCents: Cents;
  transferInCents: Cents }                                     // Σ balance entries' transfers in (not gains)
export interface SuperPeriod {
  periodMonth: IsoMonth; runDate: IsoDate; after: IsoDate | null; through: IsoDate;   // the Stage 3 windows (§2.3)
  status: SavingsPeriodStatus;                                 // 'first' | 'closed' | 'provisional'
  valueCents: Cents | null;                                    // Q (provisional: Σ latest fund balances)
  notUpdated: boolean;                                         // not a valuation point: its flows move to the next period
  flows: SuperFlows | null;                                    // the window's flows (null for the baseline)
  gainFrom: IsoDate | null;                                    // the previous valuation point (start of the merged window)
  changeCents: Cents | null;                                   // value − the value at gainFrom (valuation periods)
  gainFlows: SuperFlows | null;                                // the flows over (gainFrom, through] (= flows when not merged)
  gainCents: Cents | null;                                     // D69: change − gainFlows' sgFund, memberFund, transferIn
  gainRatio: DecimalString | null;                             // History T = gain ÷ (value − gain)
  returnRatio: DecimalString | null;                           // Modified Dietz for the merged window
}
export interface SuperFundResult {
  id: number; receivesSg: boolean; archived: boolean; balanceCents: Cents | null; balanceAsOf: IsoDate | null;
  entries: { id: number; asOf: IsoDate; balanceCents: Cents; transferInCents: Cents | null;
    flowsCents: Cents | null; gainCents: Cents | null }[];  // asOf order
}
export interface SuperCapYear {
  financialYear: number; start: IsoDate; end: IsoDate;         // [start, end), the FY start year
  complete: boolean;                                           // asOf ≥ end
  capCents: Cents; capSource: 'statutory' | 'setting';
  sgGrossCents: Cents; sgFundCents: Cents;                     // SG counted in this FY so far (§2.5 step 7)
  sgSource: 'estimate' | 'statement' | 'mixed' | 'none';
  salarySacrificeCents: Cents; importedEstimateCents: Cents;
  totalCents: Cents; projectedCents: Cents; ratio: DecimalString; projectedRatio: DecimalString; status: SuperCapStatus;
  nonConcessionalCents: Cents;
  memberCents: Cents;                                          // Σ pre-tax salary sacrifice (typed or read) + after-tax amounts
  memberFundCents: Cents; memberNetPayCents: Cents;            // what the fund receives; the take-home cost (nulls count 0)
  estimateCount: number;                                       // untyped (imported) contributions dated in the FY
}
export interface SuperChartPoint { label: string; period: IsoMonth; date: IsoDate; live: boolean;
  valueCents: Cents | null; gainCents: Cents | null; returnRatio: DecimalString | null;
  memberNetPayCents: Cents | null; memberFundCents: Cents | null; sgFundCents: Cents | null }
export interface SuperResult {
  totalCents: Cents;                                           // Super!B12: Σ non-archived funds' latest balances ≤ asOf
  funds: SuperFundResult[];
  contributions: SuperContributionResult[];                    // date desc, then id desc
  sgMonths: SuperSgMonth[];                                    // every month the previous or the current FY's cap counts, up to asOf's
  periods: SuperPeriod[];                                      // run-date order; the provisional last
  annualised: { cumulativeRatio: DecimalString | null; returnRatio: DecimalString | null;
    from: IsoDate | null; through: IsoDate | null; days: number | null };
  capYears: SuperCapYear[];                                    // [asOf's FY, the FY before]
  chart: SuperChartPoint[];
  snapshot: { superValueCents: Cents; superContribCents: Cents;           // History Q, R
    superGainCents: Cents | null; superGainRatio: DecimalString | null };  // History S, T (provisional)
  flags: SuperFlag[];
}

// ─── Property and loans (§2.6, §2.7) ───────────────────────────────────────────────────────────
export interface EngineProperty { id: number; purchaseDate: IsoDate | null; isPrimaryResidence: boolean;
  purchaseValueCents: Cents; netRentToDateCents: Cents;
  valuations: readonly { id: number; asOf: IsoDate; valueCents: Cents }[] }
export interface EngineLoanEntry { id: number; asOf: IsoDate; balanceCents: Cents; repaymentsCents: Cents | null }  // typed or null
export interface EngineLoan {
  id: number; propertyId: number | null;
  startDate: IsoDate | null; startBalanceCents: Cents | null;  // both set and before the first entry → the log's start point (§2.6)
  annualRate: DecimalString | null; compoundingPerYear: number | null;
  paymentCents: Cents | null; paymentFrequency: PaymentFrequency;
  entries: readonly EngineLoanEntry[];
  offsets: readonly { accountId: number; balanceCents: Cents }[];   // linked offset accounts' current balances (D67)
}
export interface PropertyInput {
  asOf: IsoDate;
  properties: readonly EngineProperty[]; loans: readonly EngineLoan[];
  snapshots: readonly { periodMonth: IsoMonth; runDate: IsoDate; propertyValueCents: Cents | null;
    propertyPurchaseCents: Cents | null; mortgageBalanceCents: Cents | null;
    mortgageInterestFeesCents: Cents | null; mortgagePrincipalPaidCents: Cents | null }[];   // History X, Y, AB, AC, AD
  chart: { unit: ChartDateUnit; count: number | null };
}
export interface AmortisationInput { balanceCents: Cents; annualRate: DecimalString; compoundingPerYear: number;
  paymentCents: Cents; paymentFrequency: PaymentFrequency; offsetCents: Cents;
  anchorDate: IsoDate;                                         // the payment grid's anchor (§2.3)
  balanceDate: IsoDate }                                       // the balance's date: the first payment is the first grid date after it
export interface AmortisationResult {
  periodicRatio: DecimalString;                                // (1 + r/m)^(m/p) − 1
  firstPaymentDate: IsoDate;                                   // the first grid date after balanceDate
  firstPeriodInterestCents: Cents;                             // max(0, balance − offset) × periodic ratio
  payments: number | null; payoffDate: IsoDate | null; totalInterestCents: Cents | null;
  points: { date: IsoDate; balanceCents: Cents; interestCents: Cents }[];   // yearly, cumulative interest
  flag: 'payment_below_interest' | 'never_repaid' | null;
}
export interface LoanEntryResult { id: number | null;        // null = the loan's start point (its start fields)
  start: boolean; asOf: IsoDate; balanceCents: Cents;
  paymentsCounted: number | null; repaymentsCents: Cents | null; repaymentsTyped: boolean;
  principalCents: Cents | null; interestFeesCents: Cents | null;
  cumulativePrincipalCents: Cents | null; cumulativeInterestFeesCents: Cents; flags: LoanEntryFlag[] }
export interface LoanResult {
  id: number; propertyId: number | null;
  balanceCents: Cents; balanceAsOf: IsoDate;                   // the latest entry ≤ asOf
  startBalanceCents: Cents;                                    // startBalance ?? the first entry's balance
  paymentAnchorDate: IsoDate;                                  // startDate ?? the first entry's date (§2.3)
  offsetCents: Cents; netBalanceCents: Cents; excessOffsetCents: Cents;   // max(0, b − o), max(0, o − b)
  entries: LoanEntryResult[];                                  // asOf order
  repaymentsCents: Cents; principalPaidCents: Cents; interestFeesCents: Cents;   // cumulative (D66)
  nextPeriodInterestCents: Cents | null;
  schedule: AmortisationResult | null;                         // with the linked offsets
  scheduleWithoutOffset: AmortisationResult | null;            // only when offsetCents > 0
  interestSavedCents: Cents | null; monthsSaved: number | null;
  flags: LoanFlag[];
}
export interface PropertyResultRow {
  id: number; isPrimaryResidence: boolean;
  valueCents: Cents; valuationDate: IsoDate;                   // the latest valuation ≤ asOf
  purchaseValueCents: Cents; netRentCents: Cents;
  gainCents: Cents; gainRatio: DecimalString | null;          // X21, X22
  cagrRatio: DecimalString | null; heldDays: number | null;    // X23 fixed
  loanIds: number[];
  debtCents: Cents; equityCents: Cents; lvrRatio: DecimalString | null;   // net of linked offsets (D67)
}
export interface PropertyChartPoint { label: string; period: IsoMonth; date: IsoDate; live: boolean;
  valueCents: Cents | null; purchaseCents: Cents | null; mortgageCents: Cents | null; equityCents: Cents | null;
  lvrRatio: DecimalString | null; interestFeesCents: Cents | null; principalPaidCents: Cents | null }
export interface PropertiesResult {
  properties: PropertyResultRow[];                             // input order
  loans: LoanResult[];                                         // every loan; totals count those with a property
  totals: {
    purchaseCents: Cents; valueCents: Cents; gainCents: Cents; gainRatio: DecimalString | null;   // F6, F7, F8, F9
    mortgageCents: Cents; offsetCents: Cents; netMortgageCents: Cents;                             // |F10| gross, net
    principalPaidCents: Cents; interestFeesCents: Cents; repaymentsCents: Cents;                   // F11 (D66), AC, …
    startBalanceCents: Cents;                                                                      // Net Worth C21
    lvrRatio: DecimalString | null; equityCents: Cents;                                            // F12 fixed, Z net
  };
  chart: PropertyChartPoint[];
  snapshot: { propertyValueCents: Cents; propertyPurchaseCents: Cents; propertyEquityCents: Cents;
    propertyGainCents: Cents; mortgageBalanceCents: Cents; mortgageInterestFeesCents: Cents;
    mortgagePrincipalPaidCents: Cents; propertyGainRatio: DecimalString; mortgageOffsetCents: Cents };  // X, Y, Z, AA, AB, AC, AD, AE
  savingsLive: { propertyPurchaseCents: Cents | null; mortgageBalanceCents: Cents | null;
    mortgagePrincipalPaidCents: Cents | null };               // the Stage 3 SavingsLiveInput parts (§2.8)
}

// ─── The Stage 5 seam (§2.8) ────────────────────────────────────────────────────────────────────
export interface AssetsSnapshotColumns {
  superValueCents: Cents; superContribCents: Cents; superGainCents: Cents | null; superGainRatio: DecimalString | null;
  propertyValueCents: Cents; propertyPurchaseCents: Cents; propertyEquityCents: Cents; propertyGainCents: Cents;
  mortgageBalanceCents: Cents; mortgageInterestFeesCents: Cents; mortgagePrincipalPaidCents: Cents;
  propertyGainRatio: DecimalString; otherValueCents: Cents; otherGainCents: Cents;
  mortgageOffsetCents: Cents;                                  // no History column yet: Stage 5 decides how to store it
}

// ─── Functions (FROZEN signatures) ─────────────────────────────────────────────────────────────
export function computeOtherAssets(input: OtherAssetsInput): OtherAssetsResult;
export function otherAssetsCostHeldAt(i: { assets: readonly EngineOtherAsset[]; assumedDate: IsoDate | null;
  dates: readonly IsoDate[] }): Cents[];                     // the chart's cost line (the sheet's Z, fixed), one per date
export function computeSuper(input: SuperInput): SuperResult;
export function computeProperty(input: PropertyInput): PropertiesResult;
export function amortise(input: AmortisationInput): AmortisationResult;
export function assetsSnapshotColumns(i: { otherAssets: OtherAssetsResult; super: SuperResult;
  property: PropertiesResult }): AssetsSnapshotColumns;
export const ASSETS_ENGINE_IMPLEMENTED: boolean;             // Scaffolder: false; engine sets true (§7.3)
// EngineApi gains: computeOtherAssets, otherAssetsCostHeldAt, computeSuper, computeProperty, amortise,
// assetsSnapshotColumns (6; named *Fn aliases, as Stages 2–3). The `engine` value gains the same members.
```

### 2.3 Shared rules
- **Snapshot windows** are Stage 3's (`periodWindows`, stage-3 §2.3): snapshots in run-date order, the first is the baseline (`status 'first'`), period *i* ≥ 1 is `(run_{i−1}, run_i]`, the provisional period `(lastRun, asOf]` exists when at least one snapshot exists and `asOf > lastRun`, with the Stage 3 month rule. Every dated flow (a purchase, a sale, a contribution) is bucketed by the half-open window; anything dated after `asOf` belongs to no period.
- **Financial years:** `yearWindow(date, 'fy')` (`[1 July, 1 July)`, `year` = the start year). The concessional cap and every Stage 4 yearly chart unit use the FY (D52: FY everywhere except the Cash year figures' setting).
- **Days:** `heldDays = dayNumber(asOf) − dayNumber(date)`. Annualising exponent `365.25 ÷ days` (the sheet's RRI convention).
- **Month days:** a month's amount spread over its days is `amount × (days of the month inside the window) ÷ (days in the month)`, computed per month in decimals and rounded once per output.
- **Payment dates** (§2.6, §2.7): one grid per loan, anchored at the loan's start date (null → its first entry's date; `LoanResult.paymentAnchorDate`); monthly payments fall on `addMonthsIso(anchor, k)` (EDATE clamping, always from the anchor, never chained), fortnightly on `anchor + 14k` days, weekly on `anchor + 7k` days, `k ≥ 1`. The balance log counts payments on this grid and the schedule makes its payments on it. `PAYMENTS_PER_YEAR = { weekly: 52, fortnightly: 26, monthly: 12 }` and the pure helper **`paymentDatesBetween(anchor, frequency, after, through): IsoDate[]`** (the grid dates in `(after, through]`) live in `@joinr/schema` root (§3.2), so the engine and the web's placeholder (§6.5) count the same dates.
- **The D73 assumed date** is the first snapshot's run date. It is an **input**, never written to any row; the result says `dateAssumed: true`. Without snapshots there is no assumed date: an undated asset then has no CAGR and is left out of the cost-held line.
- **The latest entry** of a log (a price, a fund balance, a valuation, a loan balance) at a date `d` is the latest entry dated on or before `d`. For `asOf` itself, when every entry is later (an entry may be dated tomorrow), the earliest entry is used, so a fresh entry never makes a figure vanish.

### 2.4 Other assets (`computeOtherAssets`, `otherAssetsCostHeldAt`; D72, D73; spec 04 §1.3)
1. **Units:** `remaining = units − legacySoldUnits − Σ sale units` (decimals). Below 0 → `remaining = 0` and flag `oversold` (the server refuses such a sale; only imported data can do it). `legacySoldUnits > 0` → flag `legacy_sold` (sold in the workbook without proceeds: the cost shrinks pro rata as the sheet did, no realised gain).
2. **Remaining ≤ 0** (sold out or `units ≤ 0`): cost, value, gain, ratios and CAGR are null (the sheet leaves N–R blank); the row still reports its sales and realised gain.
3. **Purchase FX:** `AUD` → 1. Otherwise `purchaseFxRate` (AUD per unit; `GBX` rows store the per-penny rate). Null → cost null and flag `purchase_fx_missing` (the cost is unknown).
4. **Cost** `N = remaining × unitCost × purchaseFx` (cents, rounded once). `unitCost` null → flag `no_cost`.
5. **Today's AUD price per unit** and `priceStatus` (`stalePriceDays` = N):

   | Pricing | Unit price (AUD) | Status |
   |---|---|---|
   | manual, price null | null (flag `unpriced`) | `none` |
   | manual, price present | `unitPrice × fx` (`fx` = 1 for AUD, else `fxRates[currency]`; missing → null + `live_fx_missing`: the value is unknown) | `manual` when `asOf − priceAsOf ≤ N` days, else `stale` (flag `stale_price`); `priceAsOf` null → `stale` |
   | bullion, spot present | `spot.audPerOz × ozPerUnit` | `fresh` when `spot.fresh`, else `stale` (flag `stale_price`) |
   | bullion, no spot, fallback present | `fallbackUnitPrice` | `stale` (flags `stale_price`, `spot_unavailable`) |
   | bullion, neither | null (flag `unpriced`) | `none` |

   `priceAsOf` is the manual entry's date, the spot's date or the fallback's date (null when unpriced).
6. **Value** `O = remaining × unitPriceAud` (cents); **gain** `P = valueCents − costCents` when both exist; **gain ratio** `Q` = unrounded (value − cost) ÷ unrounded cost (cost > 0).
7. **CAGR** (R fixed, §11 fixes 11–12): `effectiveDate = purchaseDate ?? assumedDate`, `heldDays = asOf − effectiveDate`; `cagr = (value ÷ cost)^(365.25 ÷ heldDays) − 1` from unrounded AUD value and cost, so it includes FX; null when `heldDays ≤ 0`, cost ≤ 0, value null or no effective date. For an AUD row with a real date this equals the sheet's `RRI((TODAY() − G)/365.25, J, K)` (value ÷ cost = K ÷ J). An undated row uses the assumed date (`dateAssumed: true`, flag `no_purchase_date`). The web shows "—" under 90 days held (the Stage 2 display rule; the engine keeps the value).
8. **Sales** (D72): each sale's cost = `units × unitCost × purchaseFx` (null when either is unknown); realised = `proceeds − cost`. `realisedCents` = Σ non-null realised.
9. **Savings flows** (the Stage 3 `otherAssetPurchases`, §2.8, §2.9): per asset with a **real** purchase date and a known cost and FX, one `purchase` flow at the purchase date = `(units − legacySoldUnits) × unitCost × purchaseFx` (the full purchase: later sales are their own flows); per sale one `sale` flow at the sale date = `−proceedsCents`. **Undated assets never produce a flow:** their assumed date is the first snapshot's run date, which lies in the baseline window, where added investments are not computed (stage-3 §2.3, §11 fix 18), so a D73 date can never create a contribution in a non-baseline period; leaving them out keeps it so even if the first snapshot changes. An asset with a missing purchase-date FX rate gives no purchase flow and counts in `totals.fxMissingCount` (the Other Assets page's FX callout says so, §6.3); a missing live rate never affects the flow. One with no unit cost gives none either (flag `no_cost`).
10. **Totals:** `valueCents` = Σ row values; `costCents`, `gainCents` = Σ over rows with both; `gainRatio` = Σ unrounded gains ÷ Σ unrounded costs over those rows (D5; the sheet's `D4/(D3−D4)` equals it when every valued row has a cost); the counts (`staleCount` = manual prices older than N days only: a bullion spot problem shows on the spot tile, not here; `unpricedCount`, `assumedDateCount`, `fxMissingCount` (`purchase_fx_missing`), `liveFxMissingCount` (`live_fx_missing`) as the flags); `snapshot` = `{ otherValueCents: valueCents, otherGainCents: gainCents }` (History AJ, AK).
11. **`otherAssetsCostHeldAt`** (the history chart's cost line; the sheet's `Z` fixed, §11 fix 13): for each date `d`, Σ over assets whose effective date (the real date, else the assumed date; neither → left out) is **≤ d** of `(units − legacySold − Σ sales dated ≤ d) × unitCost × purchaseFx` (unknown cost or FX → left out), in decimals, rounded once per date. The sheet's `Z` uses `<` and leaves undated rows out; §9.3 compares through both differences.
12. **Chart** (§2.10): one point per snapshot (cost = `otherAssetsCostHeldAt(runDate)`, value and gain = the stored AJ and AK, gain ratio = `gain ÷ (value − gain)` as History AC) plus the live point at `asOf` (cost = `otherAssetsCostHeldAt(asOf)`, value and gain = the totals); `live` on that point. There is no current-month zero (§11 fix 14).

### 2.5 Super (`computeSuper`; D69–D71; spec 04 §2.3)
1. **Fund balances:** a fund's balance at date `d` = its latest entry at `d` (§2.3; null before its first entry). `totalCents` = Σ over non-archived funds of their balance at `asOf` (null → 0) (`Super!B12`). A fund can be archived only once its latest balance is 0 (the server refuses otherwise, §4.5), so archiving never moves the total. A balance entry's `transferInCents` is money moved in from outside the tracked funds (a fund created in the app has its opening balance as a transfer in unless it is marked a rollover from a fund on the page, §4.5); it is a flow, never a gain. A rollover between two tracked funds needs no transfer: the old fund's closing 0 and the new fund's balance cancel out.
2. **Contributions** (D71), per entry, with `ctax = contributionsTaxRatio`, `m = marginalTaxRatio`:

   | Kind | Pre-tax (concessional) | Fund receives | Net-pay cost (savings rate) |
   |---|---|---|---|
   | `salary_sacrifice` (typed pre-tax) | `A` | `A × (1 − ctax)` | `A × (1 − m)`; null when `m` is null (flag `no_marginal_rate`) |
   | `after_tax` | — (non-concessional `A`) | `A` | `A` |
   | `voluntary_contribution` (imported, untyped; `estimate: true`) read as `salary_sacrifice` | `A ÷ (1 − m)` (`m` null → `A`, flag `no_marginal_rate`) | pre-tax × `(1 − ctax)` | `A` (as imported, D71) |
   | the same read as `after_tax` | — (non-concessional `A`) | `A` | `A` |

   Any untyped entry sets the flag `imported_estimates`. `importedContributionType` decides the reading for every untyped entry at once (an app-only setting, so changing it never blocks a re-import, §3.3). **Imported months keep their net-pay cost for the savings rate** (D71); only the gains split and the cap use the reading, and every such figure is labelled an estimate.
3. **Employer SG** (D69) per calendar month `m` (the month it was **earned**, as a payslip shows it) up to `asOf`'s month:
   - `source 'statement'` when overrides exist for `m`: `grossCents = Σ` overrides of `m` (a statement month is the SG for the month earned);
   - else `'none'` (0) when `grossAnnualSalaryCents` is null (flag `no_salary`) or `jobStartDate` is after the month's last day;
   - else `'estimate'`: `grossAnnualSalaryCents × rate ÷ 12` (rounded once per month), where `rate` = `sgRatio` when set (your employer's rate, every month) else `SUPER_SG_RATES[the month's FY]` (§3.2: 11 % in FY2023–24, 11.5 % in FY2024–25, 12 % from FY2025–26; an FY outside the table uses its nearest entry).
   - `capFinancialYear`: the FY whose cap counts the month (step 7).
   - `fundReceivesCents = gross × (1 − ctax)`; `fundId` = the fund with `receivesSg` (none → null and flag `no_sg_fund` while any month has SG).
   - SG never enters the savings rate (it is not paid from take-home pay; the sheet never counted it).
   - Inside a window, SG is spread by month days (§2.3): `SG(a, b] = Σ_m gross_m × days(m ∩ (a, b]) ÷ daysIn(m)`, days after `asOf` excluded.
4. **Periods** (the Stage 3 windows): the baseline carries only its value. For a closed period, `valueCents` = the snapshot's Q; for the provisional period, `totalCents`.
   - **Not updated:** a closed period whose value equals the previous period's value to the cent is not a valuation point (the owner did not update the balance): `notUpdated: true`, gain, ratios null, and its flows move into the next period's merged window. The provisional period is `notUpdated` when its value equals the last snapshot's, or when any non-archived fund has no balance entry dated inside `(lastRun, asOf]`; either way the result carries the flag `balances_not_updated`.
   - **Flows** of a window: `sgGrossCents`, `sgFundCents` (SG × (1 − ctax), rounded once for the window), `memberFundCents` (Σ the rounded fund-receives of contributions dated in the window: each contribution is a row), `memberNetPayCents` (Σ net-pay costs; null ones count 0), `concessionalCents`, `nonConcessionalCents`, `transferInCents` (Σ `transferInCents` of balance entries dated in the window).
   - **Gain** (D69) for a valuation period, over the merged window `(gainFrom, through]` (`gainFrom` = the previous valuation point's run date): `changeCents = value − value at gainFrom`; `gainFlows` = the flows over the merged window (the SG part rounded once over it); `gainCents = changeCents − gainFlows.sgFundCents − gainFlows.memberFundCents − gainFlows.transferInCents`, so the periods table adds up to the cent (§6.4). **The provisional period is measured only up to the latest balances (D79):** its `gainFlows` count SG and contributions only up to the oldest latest balance (on or before `asOf`) among the non-archived funds, which the not-updated rule puts inside `(lastRun, asOf]` whenever the period is a valuation point, and transfers in up to `asOf` (their entries are part of the value), while its `flows` (the savings side) still run to `asOf`; later SG and contributions wait for the next balance update (Stage 5 carries them when it records months).
   - `gainRatio = gain ÷ (value − gain)` (History T); `returnRatio` (Modified Dietz) `= gain ÷ (startValue + ½ × (sgFund + memberFund + transferIn))`; both from the unrounded gain (the change less the unrounded SG part and the rows' fund-receives); null when a denominator ≤ 0.
   - A fund added or archived never makes a gain: its opening balance is a transfer in (step 1), and an archived fund holds 0.
5. **Annualised return** (D69, §11 fix 21): chain the valuation periods that have a `returnRatio` (the provisional one included when it is not `notUpdated`): `cumulativeRatio = Π(1 + r) − 1`; `from` = the first snapshot's run date, `through` = the last chained period's end (the provisional one's measured end, D79), `days = through − from`; `returnRatio = (1 + cumulative)^(365.25 ÷ days) − 1` when `days ≥ 1`. The web shows "—" when `days < 90`. The sheet's `SLOPE(gain %, date) × 365` (`B19`) is not produced.
6. **Funds:** per fund, its entries in `asOf` order with, from the second entry on, `flowsCents` = the SG it receives (when `receivesSg`) + the contributions with its `fundId` (and those with no fund when it receives SG) dated in `(previous asOf, asOf]` + the entry's `transferInCents`, and `gainCents = Δbalance − flowsCents` (a first entry has neither).
7. **Concessional cap meter** (D70), for `asOf`'s FY and the FY before. **SG counts in the FY the fund receives it** (the ATO rule): SG earned before 1 July 2026 (`PAYDAY_SUPER_START`) is taken as received on its quarterly due date, the 28th day after its quarter ends (`SG_QUARTER_DUE_DAYS`; April–June 2026 → 28 July 2026, so FY2026–27 also counts that quarter); SG earned from 1 July 2026 counts in the month earned (Payday Super). Statements follow the same rule (they are keyed by the month earned). The gains keep the earned-month spread of step 3. *(Owner confirmed, D75.)*
   - `sgGrossCents`, `sgFundCents` = Σ the SG months counted in the FY whose receipt date is ≤ `asOf` (Payday Super's current month spread by days, §2.3; a quarter counts whole on its due date), each month's rounded figure; `sgSource` from those months (`none` when there are none); `salarySacrificeCents` = Σ the rounded pre-tax of typed entries dated in the FY ≤ `asOf`; `importedEstimateCents` = Σ the rounded pre-tax of untyped entries read as salary sacrifice; `totalCents` = their sum; `nonConcessionalCents` = Σ after-tax amounts (typed or read); `memberCents`, `memberFundCents`, `memberNetPayCents`, `estimateCount` over the same entries (Σ of the rows, so the page adds up).
   - `capCents`: `concessionalCapOverride.cents` for the FY it was set for (`capSource 'setting'`, whichever of the two rows that is), else `SUPER_CONCESSIONAL_CAPS[fy]` (`'statutory'`); an FY past the table uses its last entry.
   - `projectedCents`: a complete FY → `totalCents`; otherwise every SG month the FY counts (statements where given, estimates otherwise; FY2026–27 has 15: April–June 2026 and July 2026–June 2027) + the member concessional contributions so far + (those so far ÷ months elapsed) × months left, where months elapsed counts the FY's months up to and including `asOf`'s month (1–12) and months left = 12 − months elapsed (computed in decimals, rounded once).
   - `ratio = totalCents ÷ capCents`, `projectedRatio = projectedCents ÷ capCents`; `status`: `over` when `totalCents > capCents` or `projectedCents > capCents`; `near` when `projectedCents ≥ SUPER_CAP_WARNING_RATIO × capCents` (0.9); else `under`. No carry-forward (D70).
8. **Snapshot** (History Q–T for the live row, §2.8): `superValueCents = totalCents`; `superContribCents` = Σ net-pay costs of contributions dated in `(lastRun, asOf]` (all of them when no snapshot exists) — the provisional R, which the savings engine takes; `superGainCents` = the provisional period's gain (null when `notUpdated`); `superGainRatio` its `gainRatio`.
9. **Chart** (§2.10): one point per period (the baseline and the provisional included): value `end`; gain, member net pay, member to the fund and SG to the fund `sum` over a group (null when all are null); `returnRatio` = the chained `Π(1 + r) − 1` of the group's valuation periods (null when none).

### 2.6 Property and loans (`computeProperty`; D66–D68; spec 04 §3.3)
1. **Property value** = its latest valuation at `asOf` (§2.3; the server keeps at least one). `gain = value + netRent − purchaseValue` (X21); `gainRatio = gain ÷ purchaseValue` (X22; null when the purchase value is 0); **CAGR** (X23 fixed, §11 fix 8) = `((value + netRent) ÷ purchaseValue)^(365.25 ÷ heldDays) − 1`, `heldDays = asOf − purchaseDate`; null without a purchase date, when `heldDays ≤ 0` or the purchase value ≤ 0 (the web shows "—" under 90 days held).
2. **Loan balance** = its latest entry at `asOf` (§2.3; at least one stored entry exists). `startBalanceCents = startBalance ?? the first entry's balance`. `offsetCents` = Σ linked offsets (D67); `netBalanceCents = max(0, balance − offset)`; `excessOffsetCents = max(0, offset − balance)`. `paymentAnchorDate` = `startDate ?? the first stored entry's date`.
3. **Balance log** (D66). **The start point:** when `startDate` and `startBalanceCents` are both set and `startDate` is before the first stored entry, the log begins with a point built from them (`id: null`, `start: true`); no start entry is ever stored, so a loan created in the app and an imported loan with the same fields give the same log, and editing the start fields updates it. Points in `asOf` order; for point *k* ≥ 1 (the first has no repayments):
   - `paymentsCounted` = `paymentDatesBetween(anchor, frequency, asOf_{k−1}, asOf_k).length` (§2.3);
   - default repayments = `paymentsCounted × paymentCents` with the loan's **current** regular payment (null when the payment is null), so changing the repayment re-estimates every entry without entered repayments (the loan form says so, §6.5; a payment history is not built, §1.5; D76); `repaymentsCents` = the typed figure when the entry has one (`repaymentsTyped: true`), else the default;
   - `principalCents = balance_{k−1} − balance_k`; `interestFeesCents = repayments − principal` (null when repayments are null);
   - flags: `repayments_below_principal` when `interestFeesCents < 0` (the default understated the repayments: an extra payment), `balance_increased` when `principalCents < 0` (a redraw or capitalised costs).
   - Cumulative: `cumulativeInterestFeesCents` = Σ non-null interest so far; `cumulativePrincipalCents = startBalanceCents − balance_k`.
4. **Loan totals:** `repaymentsCents` = Σ non-null repayments; `interestFeesCents` = Σ non-null interest and fees (History AC); `principalPaidCents = startBalanceCents − balanceCents` (History AD; the "payments paid" of the sheet becomes principal only, with interest shown separately; offsets are never counted, D67).
5. **Schedule** (§2.7) from the latest entry, on the loan's payment grid: `amortise({ balance, annualRate, compoundingPerYear, paymentCents, paymentFrequency, offsetCents, anchorDate: paymentAnchorDate, balanceDate: balanceAsOf })` (the balance is taken as the balance after the last grid payment on or before its date, so the first scheduled payment is the next grid date and its interest is a full period's); `scheduleWithoutOffset` with `offsetCents: 0` only when the offset is positive; `interestSavedCents` = without − with total interest; `monthsSaved` = whole months between the two payoff dates (DATEDIF "M"). No schedule and a flag when the rate (`no_rate`), the compounding frequency (`no_compounding`) or the payment (`no_payment`) is missing; the schedule's flag is copied to the loan's flags. `nextPeriodInterestCents` = the schedule's first-period interest, the interest in the repayment on `schedule.firstPaymentDate` (X32 fixed, §11 fix 4).
6. **A loan without a property** is returned with flag `no_property` and counted in no total (LiabilitiesDebts is not rebuilt, D2).
7. **Per property:** `loanIds` = its loans; `debtCents` = Σ their net balances; `equityCents = value − Σ balances + Σ offsets`; `lvrRatio = debtCents ÷ value` (null when the value is 0) — positive and net of offsets (§11 fix 5).
8. **Totals** (property loans only): `purchaseCents` (F6), `valueCents` (F7), `gainCents` (F8), `gainRatio` (F9 = F8 ÷ F6, null when F6 = 0), `mortgageCents` (gross |F10|), `offsetCents`, `netMortgageCents`, `principalPaidCents` (F11 under D66), `interestFeesCents`, `repaymentsCents`, `startBalanceCents` (Net Worth C21), `lvrRatio` = net mortgage ÷ value (F12 fixed), `equityCents` = value − gross mortgage + offsets.
9. **Snapshot** (History X–AE for the live row): X = `valueCents`, Y = `purchaseCents`, Z = `equityCents` (the sheet's `X + AB`, plus linked offsets, D67), AA = `gainCents`, AB = `−mortgageCents` (gross, ≤ 0, as the sheet), AC = `interestFeesCents`, AD = `principalPaidCents`, AE = `AA ÷ (X − AA)` (0 when `X − AA = 0`, the sheet's IFERROR), `mortgageOffsetCents = offsetCents`. With no property every figure is 0 (the sheet's live row shows 0).
10. **Savings live parts** (§2.8): `propertyPurchaseCents` = `purchaseCents` (null without a property); `mortgageBalanceCents` = `−mortgageCents` (null without a property loan); `mortgagePrincipalPaidCents` = `principalPaidCents` (null without a property loan).
11. **Chart** (§2.10): per snapshot the stored X, Y, |AB|, Z, AC, AD and LVR = `|AB| ÷ X` (gross: snapshots hold no offsets; null when X = 0); the live point from the totals (net LVR). All `end`.

### 2.7 Amortisation (`amortise`; D66, §11 fixes 2–4)
- `p = PAYMENTS_PER_YEAR[paymentFrequency]`, `m = compoundingPerYear` (> 0), `r = annualRate`; **periodic ratio** `i = (1 + r/m)^(m/p) − 1` (exactly `r/m` when `m = p`; 0 when `r = 0`).
- Payments fall on the §2.3 grid of `anchorDate`: the first is the first grid date after `balanceDate` (`firstPaymentDate`), then every grid date after it (monthly dates are `addMonthsIso(anchorDate, k)`, never chained). In each period: `interest = max(0, B − offset) × i`; `B ← B + interest − P`; the final payment is `B_prev + interest` (so the balance ends at 0). Computed in decimals, rounded once per output. `payoffDate` = the grid date of the last payment.
- `firstPeriodInterestCents` = the first period's interest (a full period, the balance being the balance after the last grid payment).
- `payment_below_interest`: `P ≤` the first period's interest while `B − offset > 0` → `payments`, `payoffDate`, `totalInterestCents` null, `points` empty.
- `never_repaid`: still owing after `100 × p` payments → the same nulls.
- `offset ≥ balance` → no interest; payments = `⌈B ÷ P⌉`.
- `points`: the starting balance at `balanceDate`, then the balance and cumulative interest after every `p`-th payment (12 monthly, 26 fortnightly or 52 weekly) at its date, and at payoff.
- **Sheet mode** (goldens only, §9.1): with `paymentFrequency` equal to the compounding frequency (12, 26 or 52) and `paymentCents` = the sheet's monthly payment × 12 ÷ frequency × 100 **rounded half away from zero to whole cents**, `payments = ⌈NPER⌉` with NPER computed from that same rounded payment, and `firstPeriodInterestCents` = X32.

### 2.8 The Stage 5 seam and the live savings input
- **`assetsSnapshotColumns`** merges the three results' `snapshot` objects into the History columns' names (camelCase of the `snapshots` table: Q `superValueCents` … AK `otherGainCents`) plus `mortgageOffsetCents`. Stage 5's recorder calls it (with the other calculators) to compose the live snapshot; Stage 4's pages and goldens use it for the live row.
- **The live savings input** (replacing `staticUntilStage4`, stage-3 §4.5), built by the server from the engine results only:
  - `superContribCents` = `super.snapshot.superContribCents` (D71 net-pay cost of contributions dated in the provisional window);
  - `propertyPurchaseCents`, `mortgageBalanceCents`, `mortgagePrincipalPaidCents` = `property.savingsLive`;
  - `offsetCents` = Σ offset accounts (`cashTotals().offsetCents`) when any offset account exists, else null; the latest snapshot's `offsetCents` as §2.9 says;
  - `otherAssetPurchases` = `otherAssets.savingsFlows` as `{ date, amountCents }` (FX-converted purchases at the purchase-date rate, sales negative; undated and FX-missing assets left out).
- The closed periods keep reading their stored History values (N, R, W, Y, AB, AD); only the dated flows (trades, other-asset flows, deposits, dividends) are recomputed, as in Stage 3.

### 2.9 Savings engine changes (`computeSavings`; additive)
- **Offsets** (§11 fix 7): step 3 gains `offsetsCents = offset_i − offset_{i−1}` when both are non-null, else 0, added to `addedInvestmentsCents` and reported in `added.offsetsCents`. Money moved into an offset account leaves Total Cash (D56) but stays saved; without this term it would read as spending. **Only the provisional period gets a Δ offset in Stage 4:** the server passes `offsetCents` for the **latest** snapshot only (the Σ of today's offset accounts' latest balance entries on or before its run date; an account with no entry by then counts 0 when it was created or flagged Offset in the app, and its imported balance (its earliest entry) when the workbook flagged it Offset and the flag is untouched (`origin 'import'`), because the workbook already kept that balance out of the stored cash (History N), so it is not money moved; Fixer round 1) and the current Σ for the live input; every earlier snapshot passes null, so closed periods keep 0 (their stored cash came from the workbook, whose composition the app cannot know, and recomputing them under today's Offset flags would count a newly flagged account twice). With no offset account, everything is null and nothing changes. Stage 5 stores an offset figure with each recorded month and passes it for those snapshots. **Known limit:** flagging an account that already has balance history as Offset moves its balance out of Total Cash while the last snapshot's stored cash still holds it, so the provisional period reads that balance as spending until the next month is recorded; the Cash page says so when the flag is switched on (§6.6). Renaming (or changing the note of) a workbook-flagged offset account makes it `origin 'app'`, so an account with no entry on or before the last run then counts 0 again and the provisional period reads its imported balance as money moved into the offset.
- **Other-asset flows** keep their Stage 3 bucketing; the list may now hold negative amounts (sales, §2.4 step 9).
- Nothing else in §2.5 of Stage 3 changes; the Stage 3 figures and goldens stay the same (an input without offsets or sales gives identical figures). The Stage 3 unit tests that compare whole `added` objects gain `offsetsCents: 0` (the Scaffolder's expectation fix, §7.1).

### 2.10 Charts
- Each compute function returns its chart already grouped like `compressSeries` (stage-3 §2.13): monthly by period month, calendar quarters, and years by `yearWindow(date, 'fy')` labelled `FY2025–26`; the last `count` groups (null → 12 / 8 / all); a group takes its last point's period and date and `live` when that point is live. Stocks (values, balances, cost held, equity, LVR) use the group's last point (`end`); flows (gains, contributions, SG) are sums; returns chain (§2.5 step 9).
- Raw series (no grouping) go straight to the DTOs: per-item price entries, the bullion spot history (§4.6), per-fund balance entries, property valuations, loan log entries and the schedule's yearly points.

---

## 3. Data model (`@joinr/schema`, migration `0004_stage4_assets`)

### 3.1 Migration (append-only; stage-1 §2.1 evolution rule)
Generated with `pnpm --filter @joinr/server db:generate --name stage4_assets`, then the data statements below are appended by hand after a `--> statement-breakpoint` (the file keeps a header comment saying so). `git diff --exit-code` on every `0000`–`0003` SQL and snapshot file. **The generated SQL must hold only `CREATE TABLE`, `CREATE INDEX` and `ALTER TABLE … ADD` statements:** no `__new_` table recreate and no `PRAGMA foreign_keys` (a recreate of `cash_accounts` or `loans` would run their cascades). If drizzle-kit wants one, change the schema (a new table instead of a foreign-key column), never hand-edit the recreate.

New tables (Drizzle; every one has `origin` + `sheet_ref` unless stated):
| Table | Columns | Keys and FKs |
|---|---|---|
| `other_asset_prices` (D72) | `id` · `other_asset_id integer not null` · `as_of text not null` · `unit_price text not null` (≥ 0, in the asset's currency) · `note text` · provenance | `unique(other_asset_id, as_of)`, `index(other_asset_id)`; FK → `other_assets.id` **on delete cascade** |
| `other_asset_sales` (D72) | `id` · `other_asset_id integer not null` · `sale_date text not null` · `units text not null` (> 0) · `proceeds_cents integer not null` (≥ 0, AUD received) · `note text` · provenance | `index(other_asset_id)`; FK → `other_assets.id` on delete cascade |
| `super_balance_entries` (D69) | `id` · `fund_id integer not null` · `as_of text not null` · `balance_cents integer not null` (≥ 0) · `transfer_in_cents integer` (null = none; ≥ 0: money moved in from outside the tracked funds, §2.5) · `note text` · provenance | `unique(fund_id, as_of)`, `index(fund_id)`; FK → `super_funds.id` on delete cascade |
| `super_sg_overrides` (D69; **overlay**) | `id` · `period_month text not null` · `gross_cents integer not null` (≥ 0, before contributions tax) · `note text` · provenance | `unique(period_month)` |
| `property_valuations` | `id` · `property_id integer not null` · `as_of text not null` · `value_cents integer not null` (≥ 0) · `note text` · provenance | `unique(property_id, as_of)`, `index(property_id)`; FK → `properties.id` on delete cascade |
| `loan_balance_entries` (D66) | `id` · `loan_id integer not null` · `as_of text not null` · `balance_cents integer not null` (≥ 0) · `repayments_cents integer` (null = the default; ≥ 0) · `note text` · provenance (no start entries: the loan's start fields give the log's start point, §2.6) | `unique(loan_id, as_of)`, `index(loan_id)`; FK → `loans.id` on delete cascade |
| `loan_offset_links` (D67) | `account_id integer primary key` · `loan_id integer not null` · provenance | `index(loan_id)`; FKs → `cash_accounts.id` and `loans.id`, both **on delete cascade** (an account links to at most one loan) |
| `market_quote_history` (cache; **no provenance**) | `series_id text not null` · `date text not null` · `value text not null` · `source text not null` · `fetched_at text not null` | `primary key(series_id, date)` |

New columns (`ALTER TABLE … ADD`, nullable or defaulted):
- `other_assets.purchase_fx_rate text` (AUD per 1 unit of the currency at purchase; `GBX` rows hold the per-penny rate), `other_assets.purchase_fx_source text` (`FX_RATE_SOURCES`), `other_assets.purchase_fx_date text` (the close date the rate comes from).
- `super_funds.receives_sg integer not null default false` (the fund that receives employer SG; at most one, §4.5).
- No other column changes: the transfer-in amount lives on the new `super_balance_entries`, and an app-created fund's rollover choice is written as its opening entry's `transfer_in_cents` (§4.5).

The appended **data statements** convert a database that already holds imported data (each derived row keeps its parent's `origin`; the entries keep the parent's `sheet_ref`, the History-derived contributions get `History!R<row>`):
```sql
INSERT INTO `other_asset_prices` (`other_asset_id`, `as_of`, `unit_price`, `note`, `origin`, `sheet_ref`)
  SELECT `id`, COALESCE(`unit_price_as_of`, date('now')), `unit_price`, NULL, `origin`, `sheet_ref`
  FROM `other_assets` WHERE `price_source` = 'manual' AND `unit_price` IS NOT NULL AND `unit_price` NOT LIKE '-%' ORDER BY `id`;
--> statement-breakpoint
UPDATE `super_entries`
  SET `entry_date` = MIN(date(`period_month` || '-01', '+1 month', '-1 day'),
                         COALESCE((SELECT `workbook_as_of` FROM `import_runs`
                                     WHERE `status` = 'succeeded' AND `dry_run` = 0 AND `workbook_as_of` IS NOT NULL
                                     ORDER BY `started_at` DESC LIMIT 1),
                                  (SELECT MAX(`balance_as_of`) FROM `super_funds`),
                                  (SELECT MAX(`balance_as_of`) FROM `cash_accounts`), '9999-12-31'))
  WHERE `kind` = 'voluntary_contribution' AND `entry_date` IS NULL;
--> statement-breakpoint
INSERT INTO `super_balance_entries` (`fund_id`, `as_of`, `balance_cents`, `transfer_in_cents`, `note`, `origin`, `sheet_ref`)
  SELECT f.`id`,
         CASE WHEN (SELECT SUM(`balance_cents`) FROM `super_funds` WHERE `archived` = 0)
                   = (SELECT `super_value_cents` FROM `snapshots` ORDER BY `run_date` DESC LIMIT 1)
              THEN (SELECT `run_date` FROM `snapshots` ORDER BY `run_date` DESC LIMIT 1)
              ELSE COALESCE(f.`balance_as_of`, date('now')) END,
         f.`balance_cents`, NULL, NULL, f.`origin`, f.`sheet_ref`
  FROM `super_funds` f ORDER BY f.`id`;
--> statement-breakpoint
UPDATE `super_funds` SET `balance_as_of` =
  (SELECT MAX(e.`as_of`) FROM `super_balance_entries` e WHERE e.`fund_id` = `super_funds`.`id`);
--> statement-breakpoint
INSERT INTO `super_entries` (`period_month`, `kind`, `fund_id`, `entry_date`, `amount_cents`, `note`, `origin`, `sheet_ref`)
  SELECT s.`period_month`, 'voluntary_contribution', NULL, s.`run_date`, s.`super_contrib_cents`, NULL, s.`origin`,
         'History!R' || substr(s.`sheet_ref`, 10)
  FROM `snapshots` s
  WHERE s.`source` = 'migrated' AND s.`sheet_ref` LIKE 'History!A%'
    AND s.`super_contrib_cents` IS NOT NULL AND s.`super_contrib_cents` <> 0
    AND NOT EXISTS (SELECT 1 FROM `super_entries` e WHERE e.`sheet_ref` = 'History!R' || substr(s.`sheet_ref`, 10))
  ORDER BY s.`run_date`;
--> statement-breakpoint
INSERT INTO `property_valuations` (`property_id`, `as_of`, `value_cents`, `note`, `origin`, `sheet_ref`)
  SELECT `id`, COALESCE(`valuation_date`, date('now')), `current_value_cents`, NULL, `origin`, `sheet_ref`
  FROM `properties` ORDER BY `id`;
--> statement-breakpoint
INSERT INTO `loan_balance_entries` (`loan_id`, `as_of`, `balance_cents`, `repayments_cents`, `note`, `origin`, `sheet_ref`)
  SELECT l.`id`,
         CASE WHEN l.`property_id` IS NOT NULL
                   AND (SELECT SUM(`current_balance_cents`) FROM `loans` WHERE `property_id` IS NOT NULL)
                       = -(SELECT `mortgage_balance_cents` FROM `snapshots` ORDER BY `run_date` DESC LIMIT 1)
                   AND (l.`start_date` IS NULL
                        OR l.`start_date` < (SELECT `run_date` FROM `snapshots` ORDER BY `run_date` DESC LIMIT 1))
              THEN (SELECT `run_date` FROM `snapshots` ORDER BY `run_date` DESC LIMIT 1)
              ELSE COALESCE(l.`balance_as_of`, date('now')) END,
         l.`current_balance_cents`, NULL, NULL, l.`origin`, l.`sheet_ref`
  FROM `loans` l ORDER BY l.`id`;
--> statement-breakpoint
UPDATE `loans` SET `balance_as_of` =
  (SELECT MAX(e.`as_of`) FROM `loan_balance_entries` e WHERE e.`loan_id` = `loans`.`id`);
```
- **The contribution date runs first:** the imported contribution of the live month is dated at `min(month end, workbook as-of)` (the importer's rule, §3.5 item 2), the workbook as-of being the latest applied import run's `workbook_as_of` (falling back to the latest fund, then cash-account, balance date), so it falls in the provisional window. The History-derived contributions are dated at their snapshot's run date, so each lands in its own period; they come from the kept snapshots (one per month), the same rows the importer uses (§3.5 item 2).
- **Balances unchanged since the last snapshot are dated at its run date** (the importer's rule, §3.5 items 2 and 4): when Σ of the funds' balances equals the latest snapshot's Q, every fund's entry is dated at that snapshot's run date, else at its `balance_as_of`; likewise the property loans' current entries when Σ of their balances equals the latest snapshot's |AB|. So the provisional period counts a balance as updated only when it was updated after the last snapshot, and no payment date after it is counted against an unchanged balance. The funds' and loans' `balance_as_of` then follow their entry (the denormalised copy, §4.5).
- A loan gets one entry, its current balance; its start date and balance stay on the loan and give the log's start point (§2.6). No History-derived loan or valuation entries: the History columns hold totals across properties.
- `other_asset_sales`, `super_sg_overrides`, `loan_offset_links` and `market_quote_history` start empty.
- The converted rows keep `origin` and `sheet_ref`, so a database with no app rows still has `hasAppData = false` after the upgrade. `COMMITTED_MIGRATION_COUNT` becomes 5; `/api/health` → `migrations: 5`.

### 3.2 Schema module changes (Scaffolder)
- **`enums.ts`** (append only; each with its type):
  ```ts
  SUPER_ENTRY_KINDS        += 'salary_sacrifice', 'after_tax'          // typed member contributions (D71)
  SUPER_CONTRIBUTION_TYPES  = ['salary_sacrifice', 'after_tax']         // SuperContributionType
  FX_RATE_SOURCES           = ['import', 'market', 'user']              // FxRateSource
  OTHER_ASSET_FLAGS         = ['no_purchase_date', 'no_cost', 'purchase_fx_missing', 'live_fx_missing', 'unpriced',
                               'stale_price', 'spot_unavailable', 'legacy_sold', 'oversold']   // OtherAssetFlag
  SUPER_FLAGS               = ['no_salary', 'no_sg_fund', 'no_marginal_rate', 'balances_not_updated',
                               'imported_estimates']                                       // SuperFlag
  SUPER_CAP_STATUSES        = ['under', 'near', 'over']                                    // SuperCapStatus
  LOAN_FLAGS                = ['no_property', 'no_rate', 'no_compounding', 'no_payment',
                               'payment_below_interest', 'never_repaid']                   // LoanFlag
  LOAN_ENTRY_FLAGS          = ['repayments_below_principal', 'balance_increased']           // LoanEntryFlag
  EDITABLE_NOTE_KINDS      += 'super_option'                                              // the investment-option log (D69)
  ```
- **`src/assets.ts`** (new, exported from the root): the statutory super tables, the Stage 4 constants (public ATO figures, recorded 2026-09-26; §3.3) and the payment-date helper:
  ```ts
  export const SUPER_CONCESSIONAL_CAPS: Readonly<Record<number, number>> =   // FY start year → cents
    { 2021: 2_750_000, 2022: 2_750_000, 2023: 2_750_000, 2024: 3_000_000, 2025: 3_000_000, 2026: 3_250_000 };
  export const SUPER_SG_RATES: Readonly<Record<number, string>> =           // FY start year → the statutory SG rate
    { 2021: '0.1', 2022: '0.105', 2023: '0.11', 2024: '0.115', 2025: '0.12' };   // an FY after the table: its last entry
  export const SUPER_SG_RATE_DEFAULT = '0.12';            // from 1 July 2025 (the form's placeholder)
  export const PAYDAY_SUPER_START = '2026-07-01';         // SG earned from here counts in the month earned (§2.5 step 7)
  export const SG_QUARTER_DUE_DAYS = 28;                  // before it: a quarter's SG is due 28 days after the quarter ends
  export const SUPER_CONTRIBUTIONS_TAX_DEFAULT = '0.15';
  export const SUPER_CAP_WARNING_RATIO = '0.9';
  export const SUPER_RATES_CHECKED_ON = '2026-09-26';
  export const PAYMENTS_PER_YEAR = { weekly: 52, fortnightly: 26, monthly: 12 } as const satisfies Record<PaymentFrequency, number>;
  export function paymentDatesBetween(anchor: IsoDate, frequency: PaymentFrequency, after: IsoDate,
    through: IsoDate): IsoDate[];                         // the §2.3 grid dates in (after, through], date order
  export const COMPOUNDING_CHOICES = [12, 26, 52, 365] as const;      // the loan form's choices; the engine takes any integer ≥ 1
  export const OTHER_ASSET_STALE_DAYS_DEFAULT = 90;
  export const ANNUALISED_MIN_DAYS = 90;                  // the web shows "—" under this many days held (Stage 2 rule)
  export function isOtherAssetCurrency(code: string): boolean;         // /^[A-Z]{3}$/ or 'GBX'
  ```
  `paymentDatesBetween` is pure (no clock) and unit-tested by the Scaffolder (month-end clamping from the anchor, fortnightly, weekly, an anchor after `after`, an empty range); the engine imports it (the purity rules allow `@joinr/schema` root).
- **Tables:** the seven new domain tables in `db/tables/assets.ts`, `market_quote_history` in `db/tables/instruments.ts` beside `market_quotes`, the new columns; `db/index.ts` exports them. **`DOMAIN_TABLES_DELETE_ORDER`** becomes `loan_offset_links, dividends, trades, side_income_deposits, side_income_entries, income_streams, period_notes, budget_items, yearly_expenses, cash_balance_entries, cash_accounts, snapshots, super_balance_entries, super_entries, super_funds, loan_balance_entries, loans, property_valuations, properties, other_asset_sales, other_asset_prices, other_assets` (children first; the links go first because they reference accounts and loans). `super_sg_overrides` and `market_quote_history` are **not** in it (§3.4).
- **`rows.ts`:** `newOtherAssetPriceSchema`, `newOtherAssetSaleSchema`, `newSuperBalanceEntrySchema`, `newSuperSgOverrideSchema`, `newPropertyValuationSchema`, `newLoanBalanceEntrySchema`, `newLoanOffsetLinkSchema`, `newMarketQuoteHistorySchema` + the type-level and runtime parity tests; the existing other-asset and super-fund schemas gain the new columns.
- **`records.ts`:** `RECORD_ENTITY_IDS` appends `'other-asset-prices'`, `'other-asset-sales'`, `'super-balance-entries'`, `'super-sg-overrides'`, `'property-valuations'`, `'loan-balance-entries'`, `'loan-offset-links'` (group Assets):
  - `other-asset-prices`: `asset:text asOf:date unitPrice:price currency:text note:text sheetRef:text` (default sort asOf desc)
  - `other-asset-sales`: `asset:text date:date units:quantity proceeds:money note:text` (date desc)
  - `super-balance-entries`: `fund:text asOf:date balance:money transferIn:money note:text sheetRef:text` (asOf desc)
  - `super-sg-overrides`: `period:month gross:money note:text` (period desc)
  - `property-valuations`: `property:text asOf:date value:money note:text sheetRef:text` (asOf desc)
  - `loan-balance-entries`: `loan:text asOf:date balance:money repayments:money note:text sheetRef:text` (asOf desc)
  - `loan-offset-links`: `account:text loan:text` (account)
  - Appended columns (additive): `other-assets` + `purchaseFxRate:price purchaseFxSource:text`; `super-funds` + `receivesSg:boolean`; `super-entries` + `date:date`.
- **`settings.ts`:** §3.3.
- **`dto/assets.ts`** (§4.3–4.4) exported from the root, every DTO declared field by field; **`dto/errors.ts`** gains three codes (§4.1); **`dto/cashflow.ts`** (additive): `SavingsPeriodDto.added` gains `offsetsCents: number`; `CashAccountDto` gains `linkedLoan: { id: number; name: string } | null`; `CashPageResponse.staticUntilStage4` stays in the contract and is always `false` from Stage 4 (the doc comment says so; Stage 5 may drop it); **`SETTINGS_PATCH_MAX_KEYS` rises from 20 to 30** (22 keys become editable, §3.3).
- **Schema tests the key list changes:** `registries.test.ts` (22 editable keys, the Budget nine first), `cashflow-fixtures.test.ts` (its Cash keys become the six Stage 3 keys, `slice(9, 15)`, no longer `slice(9)`), `cashflow-schemas.test.ts` (every editable key in one PATCH within the new maximum).
- **`testing/dump.ts`:** `DUMPED_TABLES` adds `other_asset_prices`, `other_asset_sales`, `super_balance_entries`, `property_valuations`, `loan_balance_entries`, `loan_offset_links` (overlays and caches are not dumped).
- **Fixtures and seed:** §3.6.

### 3.3 Settings: the new keys, the statutory figures and the editable keys
- **New keys** (appended to `SETTING_KEYS` and `SETTINGS`; all app-only, `source: null`, so editing them never blocks a re-import; `SettingCategory` gains `'super'` and `'assets'`):

  | Key | Label | Type | Default | Readers use |
  |---|---|---|---|---|
  | `otherAssets.stalePriceDays` | "Other assets: a price is stale after (days)" | integer 1–3650 | `90` (D77) | `?? OTHER_ASSET_STALE_DAYS_DEFAULT` |
  | `super.sgRate` | "Your employer's SG rate (blank: the legal minimum)" | ratio 0–1 | `null` | set → every month; null → `SUPER_SG_RATES` by the month's FY (§2.5 step 3) |
  | `super.contributionsTaxRate` | "Super contributions tax" | ratio 0–1 | `'0.15'` | `?? SUPER_CONTRIBUTIONS_TAX_DEFAULT` |
  | `super.concessionalCapCents` | "Concessional cap override (this financial year only)" | money | `null` | with `super.concessionalCapFy`: `concessionalCapOverride` (§2.5 step 7) |
  | `super.concessionalCapFy` | (not shown; the FY the override was set for) | integer (an FY start year) | `null` | **not editable**: the settings PATCH writes it whenever it writes `super.concessionalCapCents` (as-of's FY; null when the cap is cleared) |
  | `super.importedContributionType` | "Imported contributions are" | enum `SUPER_CONTRIBUTION_TYPES` | `'salary_sacrifice'` (D75) | `?? 'salary_sacrifice'` |
- **Statutory figures** (`src/assets.ts`), recorded 2026-09-26 from ato.gov.au search results (the ATO pages refused automated fetches; the summaries quote the "Concessional contributions cap", "Contributions caps" and "Super guarantee" pages): SG 10 % (2021–22), 10.5 % (2022–23), 11 % (2023–24), 11.5 % (2024–25), 12 % from 1 July 2025 and in 2026–27; concessional cap $27,500 (2021–22 to 2023–24), $30,000 (2024–25, 2025–26), $32,500 from 1 July 2026; a contribution counts in the FY the fund receives it, and the April–June 2026 quarter's SG is due by 28 July 2026 (Payday Super starts 1 July 2026). The Super page shows "ATO figures checked 26/09/2026" beside them; an FY after the table uses its last entry and says "check the ATO cap for FY20xx–yy".
- **`EDITABLE_SETTING_KEYS`** appends: `pay.grossAnnualSalaryCents` and `tax.marginalRate` (workbook keys: editing them blocks a re-import, D34) and the five editable keys above (app-only; `super.concessionalCapFy` is registered but not editable), 22 in all. Pages and their keys (server constants, §4.5):
  - Super: `pay.grossAnnualSalaryCents`, `tax.marginalRate`, `pay.jobStartDate` (also on the Budget page), `super.sgRate`, `super.contributionsTaxRate`, `super.concessionalCapCents`, `super.importedContributionType`.
  - Other Assets: `otherAssets.stalePriceDays`.
  - Property: `savings.includeMortgagePrincipal`, `property.offsetsIncludeEmergencyFund` (also on the Cash page).
  - The Stage 3 `CASH_PAGE_SETTING_KEYS` becomes an **explicit list of its six keys** (it was derived as "every editable key not on the Budget page", which would pull in the new keys; a Scaffolder forced fix in `apps/server/src/cashflow/constants.ts`). `settingsResponse` (`cashflow/responses.ts`, server-api) returns the slice of every page (Budget, Cash, Super, Other Assets, Property) whose keys the body named.
- The Stage 3 settings rules (no-op saves write nothing; `hasAppData` counts only workbook keys with `origin = 'app'`; a forced import deletes app rows of workbook keys it does not provide) are unchanged. The `settingsPatchSchema` bounds apply (ratios within the registry's min–max, money ≤ `CASHFLOW_MONEY_MAX`, `otherAssets.stalePriceDays` within 1–3650).

### 3.4 Origin rules and D34 for every new editable entity
**Principle (Stage 3):** `hasAppData` is true when a re-import would undo or lose something entered in the app. Import-owned tables (in `DOMAIN_TABLES_DELETE_ORDER`) count their `origin = 'app'` rows; **overlays** an import never touches (`super_sg_overrides`, like the Stage 3 adjustments and goals) and caches (`market_quote_history`) never count, and a re-import keeps them.

| Entity | Create | Update | Delete | Counts as app data |
|---|---|---|---|---|
| Other asset | `origin app` (+ its first price entry, `app`, for a manual asset with a price) | `origin app` (any field); the FX backfill (§4.6) writes `purchase_fx_*` without touching `origin` | cascades prices and sales; marker when `sheet_ref` is set | app rows, marker |
| Price entry | a price save writes or replaces the entry for `(asset, asOf)` with `origin app`; the asset's `unit_price`/`unit_price_as_of` become the latest entry's (a denormalised copy that keeps the asset's `origin`) | same | allowed (an asset may be unpriced); marker when `sheet_ref` set; the asset's copy is recomputed | app rows, marker |
| Sale | `origin app` (422 `SALE_OVERSELL` past the remaining units) | `origin app` (same check) | allowed | yes |
| Super fund | `origin app` + its opening balance entry (`app`; `transfer_in_cents` = the opening balance unless the fund is marked a rollover from a fund on the page) | **`receivesSg` only → `origin` kept** (the importer carries it by fund name, §3.5); name or archived → `origin app`; archiving needs a latest balance of 0 (400); setting a fund clears the flag on the others (their `origin` kept) | 409 `FUND_IN_USE` while contributions reference it; cascades entries; marker | app rows, marker |
| Super balance entry | upsert `(fund, asOf)` → `app` (with its transfer in, if typed); the fund's `balance_cents`/`balance_as_of` follow its latest entry | same (an omitted `transferInCents` keeps the stored figure; null clears it) | 409 `LAST_BALANCE_ENTRY` for a fund's only entry; marker | app rows, marker |
| Super contribution | `origin app` (typed kinds only) | `origin app` (an imported entry edited becomes typed and `app`) | marker when `sheet_ref` set | yes |
| SG override (month) | overlay | overlay | overlay | **no** |
| Super option note | `origin app` (any month up to `asOf`'s) | `origin app` | `''` deletes; marker when `sheet_ref` set | yes |
| Property | `origin app` + its opening valuation (`app`) | `origin app` | 409 `PROPERTY_HAS_LOAN` while a loan references it; cascades valuations; marker | app rows, marker |
| Valuation | upsert `(property, asOf)` → `app`; the property's `current_value_cents`/`valuation_date` follow its latest entry | same | 409 `LAST_BALANCE_ENTRY` for the only one; marker | app rows, marker |
| Loan | `origin app` + its current balance entry (`app`; no start entry: the start fields give the start point, §2.6) | `origin app` (changing the start fields or the repayment re-derives the log; nothing else is written) | cascades entries and offset links; marker | app rows, marker |
| Loan balance entry | upsert `(loan, asOf)` → `app`; the loan's `current_balance_cents`/`balance_as_of` follow its latest entry | balance, repayments or note → `app` | 409 `LAST_BALANCE_ENTRY` for the only one; marker | app rows, marker |
| Offset link | the link rows (`origin app`) | replaced as a set | removed; turning an account's Offset flag off removes its link | yes (a re-import would lose them) |
| Settings | — | §3.3 | — | workbook keys only |

### 3.5 Importer changes (importer owner)
1. **Other assets (D72):** one `other_asset_prices` row per **manual** row with a numeric `K` (`as_of` = the workbook as-of, `sheet_ref` = the row's). For a **non-AUD** row with numeric `N`, `M` and `J` (`M × J ≠ 0`): `purchase_fx_rate = N ÷ (M × J)` (12 significant digits; the sheet's historical close on `G`), `purchase_fx_source = 'import'`, `purchase_fx_date = G`; otherwise the three stay null (the FX backfill fills them, §4.6). Everything else as Stage 1.
2. **Super (D69, D71):** one `super_balance_entries` row per fund (the fund's `sheet_ref`; `transfer_in_cents` null), dated at the **last run date (`C51`) when the live total `B12` equals the last frozen History row's `Q`** (nothing was updated since that snapshot), else at the workbook as-of; the fund's `balance_as_of` is the same date. The `B16` entry (`voluntary_contribution`) gets `entry_date = min(last day of its period month, workbook as-of)`. **History-derived contributions:** one `voluntary_contribution` entry per **imported snapshot** (the frozen History rows after the one-per-month rule, the same rows the migration reads) with a non-zero `R`: `period_month` = the row's period, `entry_date` = its run date, `amount_cents` = `R` in cents, `fund_id` null, `sheet_ref` = `History!R<row>`. **D37:** when `SheetOptions!L45` ("Retirement - Contributions in Savings Rate", read by its column-P ID) is "Yes", a row's `R` also holds that window's buys of Retirement-tagged holdings (spec 04 §2); the derived entry is `R` minus those buys, recomputed from the imported trades and the imported retirement tag (never below 0; 0 → no entry), with an **info** line `super.contributions.retirementExcluded` (count only). `B11` stays a `reported_gain` entry (kept for the record; the app derives gains, D69).
3. **SG fund kept across a re-import:** before the replace-all delete, read which fund has `receives_sg`; after inserting, the new fund with the **same name when that name is unique** among both old and new funds (else the same `sheet_ref` and name) gets the flag (D49's rule for account kinds). A flag that matched no fund adds an **info** line `super.sgFundNotCarried` ("The fund that receives SG could not be carried over; choose it again on the Super page"; count only).
4. **Property (D66):** one `property_valuations` row per property (`as_of` = the workbook as-of); per loan **one** entry, its current balance with the loan's `sheet_ref`, dated at the last run date (`C51`) when the loan has a property, Σ of the property loans' current balances equals the last frozen History row's `|AB|` and the start date (if any) is before `C51`, else at the workbook as-of; the loan's `balance_as_of` is the same date. No start entry is written: the loan's start date and start balance give the log's start point (§2.6). `payment_frequency` stays `monthly` (the sheet's "$/month" convention; the owner can change it in the app), `interest_periods_per_year` is the sheet's frequency (the compounding frequency).
5. **Reconciliation:**
   - `counts` adds `other-asset-prices` (expected = manual rows with a numeric K), `super-balance-entries` (= funds), `property-valuations` (= properties), `loan-balance-entries` (= loans), all `match` on the owner and synthetic workbooks;
   - `counts.super-entries` expects the non-zero `B11`/`B16` cells **plus** the imported snapshots with a non-zero derived contribution;
   - `super.contribution` compares `B16` with the entry whose `sheet_ref` is `Super!B16` (not every voluntary entry);
   - new `super.contributions.history`: Σ `R` of the imported snapshots (less the D37 retirement buys) vs Σ the History-derived entries (money; `match`);
   - `otherAssets.value`/`.gain` for a **non-AUD** row: the live rate is the sheet's own `O ÷ (M × K)` (as the golden adapter, §9.1), so value and gain are checked against `O` and `P`; a new `otherAssets.cost` check compares `N` with the cost through the imported purchase rate. A row without a cached `O` (or `M × K = 0`) stays `info`.
   - The CLI import summary (`apps/server/src/cli/import.ts`, `ENTITY_LABELS` only; importer-owned) labels the four new counted entities ("other-asset prices", "super balance entries", "property valuations", "loan balance entries").
6. The same workbook imported twice gives identical dumps (ids included), and a fresh import equals a migrated Stage 3 import of the same workbook in every converted row (§7.6).
7. `IMPORTER_STAGE4_IMPLEMENTED` (`@joinr/importer/testing`; Scaffolder: false) is set true only after the importer's own suite passes with the changes above.

### 3.6 Seed and fixtures (Scaffolder)
- **`seedGenericData`** (generic values, `origin import`, **no `app` rows**, so the Stage 1 import-route tests still get 201):
  - "Example watch" (manual): two price entries, an earlier one and one at the seed as-of equal to its `unit_price`, so a price chart has two points; the bullion row has none.
  - "Example Super": `receives_sg` true; two balance entries (an earlier one and one at the as-of equal to `balance_cents`); the `Super!B16` entry gets its `entry_date`; one History-derived contribution per seeded snapshot (`History!R3`–`R5`).
  - "Example property": two valuations (an earlier one and the as-of equal to `current_value_cents`); each seeded loan keeps its start date and start balance (the log's start point) and gets two stored entries (an earlier one and the current), so the log shows three points.
  - No sales, SG overrides, offset links or series history. The seed test asserts the new rows.
- **`src/fixtures/assets.ts`** (from `@joinr/schema/fixtures`; typed with `satisfies`, generic values, internally consistent, produced by a scratch script that applies the §2 rules):
  - `otherAssetsPages`: `populated` (a fresh manual AUD asset, a stale one, a USD asset with a market FX rate at purchase, a bullion asset on a fresh spot, one on a stale spot, an undated asset with the assumed date, a legacy-sold asset, an asset with a sale and a realised gain, an unpriced one, an item whose description is a long generic URL (`https://example.com/…`), a `GBX` asset without a purchase rate (`purchase_fx_missing`) and a USD asset without a live rate (`live_fx_missing`)), `empty`, `noSnapshots` (an undated asset with no assumed date), `marketOff` (bullion on its fallback, no FX).
  - `superPages`: `populated` (two funds, one receiving SG, an app-created fund whose opening balance is a transfer in, typed salary-sacrifice and after-tax contributions, imported estimates, a statement month, periods covering the baseline, closed, not updated (merged into the next) and provisional, the cap `near` with the transition-year SG quarter), `empty`, `noSalary`, `noSgFund`, `noMarginalRate`, `overCap`, `capOverride` (an override for the current FY, and one set for the FY before), `notUpdated` (the provisional period not updated), `noSnapshots`.
  - `propertyPages`: `populated` (a property, a mortgage with its start point and three stored entries including a typed repayment and a `repayments_below_principal` entry, a linked offset, schedules with and without the offset), `noLoan`, `empty`, `paymentBelowInterest`, `noRate`, `unlinkedOffset` (an offset account linked to no loan), `loanWithoutProperty`, `twoLoans` (two mortgages with different payoff dates).
  - Mutation examples: `otherAssetMutationResponse`, `otherAssetPricesResponse`, `superFundMutationResponse`, `superBalancesResponse`, `superContributionMutationResponse`, `sgOverrideResponse`, `propertyMutationResponse`, `valuationsResponse`, `loanMutationResponse`, `loanBalancesResponse`, `loanOffsetsResponse`.
  - `apiErrors` gains `fundInUse`, `propertyHasLoan`, `saleOversell`, `assetsValidation`.
  - **`fixtures/cashflow.ts`** updates: every period's `added.offsetsCents` (0, and one non-zero in `cashPages.populated`), every account's `linkedLoan` (the populated offset account linked to "Example property mortgage"), `staticUntilStage4: false`.
  - `FIXTURE_COVERAGE` gains `otherAssetFlags`, `otherAssetPriceStatuses`, `superFlags`, `superCapStatuses`, `loanFlags`, `loanEntryFlags`, `fxRateSources`.
- Records fixtures (`sampleDtos.ts`): one page per new entity.

---

## 4. API contract (FROZEN)

All routes are under `/api`, JSON, `cache-control: no-store`, with the Stage 0 error shape; bodies, params and queries validated with `parseWith` (400 `VALIDATION_ERROR`, `path: issue; …`). Money is integer cents; decimals are strings; dates `YYYY-MM-DD`.

### 4.1 Error codes (`API_ERROR_CODES` gains three)
`FUND_IN_USE` **409** ("This fund has N contributions; move or delete them first") · `PROPERTY_HAS_LOAN` **409** ("This property has N loans; delete them first") · `SALE_OVERSELL` **422** ("Only N units are left to sell"). Reused: `LAST_BALANCE_ENTRY` 409 with the entity's message ("A fund keeps at least one balance", "A property keeps at least one valuation", "A loan keeps at least one balance"), `NOT_FOUND` 404, `VALIDATION_ERROR` 400, `IMPORT_IN_PROGRESS` 409.

### 4.2 Endpoints
| Method & path | Request | 2xx | Errors |
|---|---|---|---|
| `GET /api/other-assets` | — | 200 `OtherAssetsPageResponse` | |
| `POST /api/other-assets` | `otherAssetCreateSchema` | **201** `OtherAssetMutationResponse` | 400 |
| `PUT /api/other-assets/:id` | `otherAssetUpdateSchema` | 200 `OtherAssetMutationResponse` | 400 · 404 |
| `DELETE /api/other-assets/:id` | — | 200 `DeletedResponse` | 404 |
| `POST /api/other-assets/reorder` | `reorderSchema` (every asset id exactly once) | 200 `{ ids }` | 400 |
| `PUT /api/other-assets/prices` | `otherAssetPricesInputSchema` | 200 `OtherAssetPricesResponse` | 400 (incl. `entries.N.assetId: priced from spot` for a bullion asset) · 404 (an asset) |
| `DELETE /api/other-assets/price-entries/:id` | — | 200 `OtherAssetMutationResponse` | 404 |
| `POST /api/other-assets/:id/sales` | `otherAssetSaleInputSchema` | **201** `OtherAssetMutationResponse` | 400 · 404 · 422 `SALE_OVERSELL` |
| `PUT /api/other-assets/sales/:id` | `otherAssetSaleInputSchema` | 200 `OtherAssetMutationResponse` | 400 · 404 · 422 `SALE_OVERSELL` |
| `DELETE /api/other-assets/sales/:id` | — | 200 `OtherAssetMutationResponse` | 404 |
| `GET /api/super` | — | 200 `SuperPageResponse` | |
| `POST /api/super/funds` | `superFundCreateSchema` | **201** `SuperFundMutationResponse` | 400 |
| `PUT /api/super/funds/:id` | `superFundUpdateSchema` | 200 `SuperFundMutationResponse` | 400 (incl. `archived: enter a closing balance of $0 first`) · 404 |
| `DELETE /api/super/funds/:id` | — | 200 `DeletedResponse` | 404 · 409 `FUND_IN_USE` |
| `PUT /api/super/balances` | `superBalancesInputSchema` (also edits one entry: its fund and date again) | 200 `SuperBalancesResponse` | 400 (incl. an app fund's transfer in on or before the last run; an archived fund's non-zero latest balance) · 404 (a fund) |
| `DELETE /api/super/balance-entries/:id` | — | 200 `SuperFundMutationResponse` | 400 (an archived fund left non-zero) · 404 · 409 `LAST_BALANCE_ENTRY` |
| `POST /api/super/contributions` | `superContributionInputSchema` | **201** `SuperContributionMutationResponse` | 400 · 404 (a fund) |
| `PUT /api/super/contributions/:id` | `superContributionInputSchema` | 200 `SuperContributionMutationResponse` | 400 · 404 |
| `DELETE /api/super/contributions/:id` | — | 200 `DeletedResponse` | 404 |
| `PUT /api/super/sg/:periodMonth` | `sgOverrideInputSchema` | 200 `SgOverrideResponse` | 400 (incl. `periodMonth: after this month`; `periodMonth: must be on or after 01/1900`, Fixer round 1) |
| `DELETE /api/super/sg/:periodMonth` | — | 200 `{ periodMonth }` | 400 (before 01/1900) · 404 |
| `PUT /api/period-notes/super_option/:periodMonth` | `periodNoteInputSchema` (Stage 3 route; `super_option` appended to `EDITABLE_NOTE_KINDS`) | 200 `PeriodNoteResponse` | 400 (a month after the as-of month; `spend` and `side_income` keep their recorded-period rule) |
| `GET /api/property` | — | 200 `PropertyPageResponse` | |
| `POST /api/property/properties` | `propertyCreateSchema` | **201** `PropertyMutationResponse` | 400 |
| `PUT /api/property/properties/:id` | `propertyUpdateSchema` | 200 `PropertyMutationResponse` | 400 · 404 |
| `DELETE /api/property/properties/:id` | — | 200 `DeletedResponse` | 404 · 409 `PROPERTY_HAS_LOAN` |
| `PUT /api/property/valuations` | `valuationsInputSchema` | 200 `ValuationsResponse` | 400 · 404 (a property) |
| `DELETE /api/property/valuation-entries/:id` | — | 200 `PropertyMutationResponse` | 404 · 409 `LAST_BALANCE_ENTRY` |
| `POST /api/property/loans` | `loanCreateSchema` | **201** `LoanMutationResponse` | 400 · 404 (the property) |
| `PUT /api/property/loans/:id` | `loanUpdateSchema` | 200 `LoanMutationResponse` | 400 · 404 |
| `DELETE /api/property/loans/:id` | — | 200 `DeletedResponse` | 404 |
| `PUT /api/property/loan-balances` | `loanBalancesInputSchema` | 200 `LoanBalancesResponse` | 400 · 404 (a loan) |
| `PUT /api/property/loan-balance-entries/:id` | `loanBalanceEntryUpdateSchema` | 200 `LoanMutationResponse` | 400 · 404 |
| `DELETE /api/property/loan-balance-entries/:id` | — | 200 `LoanMutationResponse` | 404 · 409 `LAST_BALANCE_ENTRY` |
| `PUT /api/property/loans/:id/offsets` | `loanOffsetsInputSchema` | 200 `LoanOffsetsResponse` | 400 (incl. `accountIds: N is not an offset account`) · 404 |
| `PATCH /api/settings` | (Stage 3) | the new keys of §3.3 | 400 |
| `GET /api/cash` | (Stage 3) | additive fields (§3.2) | |
| `GET /api/health` | (Stage 0) | `db.migrations` becomes **5** | |

Every mutation above answers **409 `IMPORT_IN_PROGRESS`** first while the upload import holds the import lock. `:id` params use `idParamsSchema`; `:periodMonth` uses `IsoMonthSchema`.

### 4.3 Request schemas (`dto/assets.ts`)
```ts
export const ASSETS_MONEY_MAX = CASHFLOW_MONEY_MAX;                       // cents
// local helpers as dto/cashflow.ts: name(max), optionalText(max) ('' → null), cents0 = int 0…ASSETS_MONEY_MAX,
// signedCents = int ±ASSETS_MONEY_MAX, posInt = int > 0, a non-negative decimal (≥ 0, ≤ 18 dp, ≤ 15 significant digits),
// optionalUrl = trimmed, ≤ 500 chars, must start http:// or https:// ('' → null)
const currency = z.string().trim().toUpperCase().refine(isOtherAssetCurrency, { error: 'must be a 3-letter currency code or GBX' });

export function makeOtherAssetUpdateSchema(now) {                           // otherAssetUpdateSchema = make…()
  return z.strictObject({
    description: name(200), url: optionalUrl, note: optionalText(200),
    purchaseDate: makeEntryDateSchema(now).nullable(),
    units: tradeDecimalSchema(1e9), currency, unitCost: nonNegativeDecimal(1e9).nullable(),
    purchaseFxRate: tradeDecimalSchema(1e6).nullable(),                    // AUD per unit; typed → source 'user'
    priceSource: z.enum(OTHER_ASSET_PRICE_SOURCES), metal: z.enum(METALS).nullable(),
    ozPerUnit: tradeDecimalSchema(1e6).nullable(),
  })  // + refine: bullion → metal and ozPerUnit required and currency AUD ('currency: bullion is priced in AUD');
      //   manual → metal and ozPerUnit null; AUD → purchaseFxRate null ('purchaseFxRate: only for a foreign currency')
}
export function makeOtherAssetCreateSchema(now) {
  return makeOtherAssetUpdateSchema(now).extend({                          // + the same refines
    price: z.strictObject({ unitPrice: nonNegativeDecimal(1e9), asOf: makeEntryDateSchema(now) }).nullable() });
}   // price: manual only ('price: bullion is priced from spot')
export function makeOtherAssetPricesInputSchema(now) {
  return z.strictObject({ asOf: makeEntryDateSchema(now),
    entries: z.array(z.strictObject({ assetId: posInt, unitPrice: nonNegativeDecimal(1e9),
      note: optionalText(200).optional() })).min(1).max(500) });           // + unique ids ('entries: an asset appears twice')
}
export function makeOtherAssetSaleInputSchema(now) {
  return z.strictObject({ saleDate: makeEntryDateSchema(now), units: tradeDecimalSchema(1e9),
    proceedsCents: cents0, note: optionalText(200) });
}
export const superFundUpdateSchema = z.strictObject({ name: name(80), receivesSg: z.boolean(), archived: z.boolean() });
export function makeSuperFundCreateSchema(now) {
  return z.strictObject({ name: name(80), receivesSg: z.boolean(), openingBalanceCents: cents0,
    asOf: makeEntryDateSchema(now),
    openingIsRollover: z.boolean() });   // false → the opening balance is a transfer in (not a gain); true → moved from a fund on the page
}   // server rule (§4.5 step 5): a non-rollover opening balance > 0 is dated after the last recorded month
export function makeSuperBalancesInputSchema(now) {
  return z.strictObject({ asOf: makeEntryDateSchema(now),
    entries: z.array(z.strictObject({ fundId: posInt, balanceCents: cents0,
      transferInCents: cents0.nullable().optional(),                        // omitted keeps a stored figure; null clears it
      note: optionalText(200).optional() }))
      .min(1).max(50) });                                                  // + unique ids ('entries: a fund appears twice')
}
export function makeSuperContributionInputSchema(now) {
  return z.strictObject({ fundId: posInt.nullable(), date: makeEntryDateSchema(now),
    kind: z.enum(SUPER_CONTRIBUTION_TYPES), amountCents: z.number().int().positive().max(ASSETS_MONEY_MAX),
    note: optionalText(200) });                                            // salary sacrifice: the pre-tax amount (D71)
}
export const sgOverrideInputSchema = z.strictObject({ grossCents: cents0, note: optionalText(200) });
export function makePropertyUpdateSchema(now) {
  return z.strictObject({ name: name(80), purchaseDate: makeEntryDateSchema(now).nullable(),
    isPrimaryResidence: z.boolean(), purchaseValueCents: cents0, netRentToDateCents: signedCents,
    note: optionalText(200) });                                            // net rent may be negative (§11 fix 9)
}
export function makePropertyCreateSchema(now) {
  return makePropertyUpdateSchema(now).extend({ valueCents: cents0, asOf: makeEntryDateSchema(now) });
}
export function makeValuationsInputSchema(now) {
  return z.strictObject({ asOf: makeEntryDateSchema(now),
    entries: z.array(z.strictObject({ propertyId: posInt, valueCents: cents0, note: optionalText(200).optional() }))
      .min(1).max(50) });                                                  // + unique ids
}
export function makeLoanUpdateSchema(now) {
  return z.strictObject({ propertyId: posInt, name: name(80), lender: optionalText(80),
    startDate: makeEntryDateSchema(now).nullable(), startBalanceCents: cents0.nullable(),
    annualRate: ratioInputSchema(1).nullable(), compoundingPerYear: z.number().int().min(1).max(365).nullable(),
    paymentCents: cents0.nullable(), paymentFrequency: z.enum(PAYMENT_FREQUENCIES), note: optionalText(200) });
}
export function makeLoanCreateSchema(now) {
  return makeLoanUpdateSchema(now).extend({ balanceCents: cents0, asOf: makeEntryDateSchema(now) });
}
export function makeLoanBalancesInputSchema(now) {
  return z.strictObject({ asOf: makeEntryDateSchema(now),
    entries: z.array(z.strictObject({ loanId: posInt, balanceCents: cents0,
      repaymentsCents: cents0.nullable().optional(), note: optionalText(200).optional() })).min(1).max(50) });   // + unique ids
}
export const loanBalanceEntryUpdateSchema = z.strictObject({ balanceCents: cents0,
  repaymentsCents: cents0.nullable(), note: optionalText(200) });          // the entry's date is fixed (delete and re-add to move it)
export const loanOffsetsInputSchema = z.strictObject({ accountIds: z.array(posInt).max(20) });   // + unique ids
// Each factory's default export binds the real clock (as dto/cashflow.ts); parsed types are exported alongside.
```

### 4.4 DTOs (`dto/assets.ts`, frozen field lists)
```ts
// ─── Other assets ───
export interface OtherAssetDto {
  id: number; description: string; url: string | null; note: string | null;
  purchaseDate: IsoDate | null; effectiveDate: IsoDate | null; dateAssumed: boolean; heldDays: number | null;
  units: DecimalString; legacySoldUnits: DecimalString; soldUnits: DecimalString; remainingUnits: DecimalString;
  currency: string; unitCost: DecimalString | null;
  purchaseFxRate: DecimalString | null; purchaseFxSource: FxRateSource | null; purchaseFxDate: IsoDate | null;
  priceSource: OtherAssetPriceSource; metal: Metal | null; ozPerUnit: DecimalString | null; unitOfMeasure: UnitOfMeasure;
  unitPrice: DecimalString | null;                // manual: the latest entry (asset currency); bullion: null
  priceAsOf: IsoDate | null; unitPriceAud: DecimalString | null; priceStatus: PriceStatus;
  costCents: number | null; valueCents: number | null; gainCents: number | null; gainRatio: DecimalString | null;
  cagrRatio: DecimalString | null; realisedCents: number; saleCount: number; priceEntryCount: number;
  flags: OtherAssetFlag[]; sortOrder: number; origin: Origin; sheetRef: string | null;
}
export interface OtherAssetPriceEntryDto { id: number; assetId: number; asOf: IsoDate; unitPrice: DecimalString;
  currency: string; note: string | null; origin: Origin; sheetRef: string | null }
export interface OtherAssetSaleDto { id: number; assetId: number; saleDate: IsoDate; units: DecimalString;
  proceedsCents: number; costCents: number | null; realisedCents: number | null; note: string | null; origin: Origin }
export interface OtherAssetsTotalsDto { valueCents: number; costCents: number; gainCents: number;
  gainRatio: DecimalString | null; realisedCents: number; proceedsCents: number; unpricedCount: number;
  staleCount: number; assumedDateCount: number; fxMissingCount: number; liveFxMissingCount: number }
export interface SpotDto { metal: Metal; audPerOz: DecimalString | null; asOf: string | null; status: MarketQuoteStatus }
export interface FxRateDto { currency: string; audPerUnit: DecimalString | null; asOf: string | null; status: MarketQuoteStatus }
export interface OtherAssetsChartPointDto { label: string; period: IsoMonth; date: IsoDate; live: boolean;
  costCents: number | null; valueCents: number | null; gainCents: number | null; gainRatio: DecimalString | null }
export interface OtherAssetsPageResponse {
  asOf: IsoDate; generatedAt: IsoTimestamp;
  assets: OtherAssetDto[];                          // sort order
  priceEntries: OtherAssetPriceEntryDto[];          // asOf desc, then id desc
  sales: OtherAssetSaleDto[];                       // sale date desc, then id desc
  totals: OtherAssetsTotalsDto;
  assumedDate: IsoDate | null;                      // D73
  spot: SpotDto[];                                  // silver, then gold (always both)
  fx: FxRateDto[];                                  // the foreign currencies the assets use
  spotHistory: { metal: Metal; points: { date: IsoDate; audPerOz: DecimalString }[] }[];   // the metals in use
  market: { mode: MarketDataMode; lastRefreshAt: string | null };
  charts: { unit: ChartDateUnit; count: number | null; points: OtherAssetsChartPointDto[] };
  settings: SettingsSliceDto;                       // otherAssets.stalePriceDays
}
export interface OtherAssetMutationResponse { asset: OtherAssetDto }
export interface OtherAssetPricesResponse { assets: OtherAssetDto[] }

// ─── Super ───
export interface SuperFundDto { id: number; name: string; receivesSg: boolean; archived: boolean;
  balanceCents: number | null; balanceAsOf: IsoDate | null; entryCount: number; contributionCount: number;
  sortOrder: number; origin: Origin; sheetRef: string | null }
export interface SuperBalanceEntryDto { id: number; fundId: number; asOf: IsoDate; balanceCents: number;
  transferInCents: number | null; flowsCents: number | null; gainCents: number | null; note: string | null;
  origin: Origin; sheetRef: string | null }
export interface SuperContributionDto {
  id: number; fundId: number | null; fundName: string | null; date: IsoDate;
  kind: 'voluntary_contribution' | 'salary_sacrifice' | 'after_tax'; amountCents: number;
  estimate: boolean; preTaxCents: number | null; fundReceivesCents: number; netPayCostCents: number | null;
  concessional: boolean;
  periodMonth: IsoMonth | null; provisional: boolean;                      // the savings period it falls in
  note: string | null; origin: Origin; sheetRef: string | null;
}
export interface SuperSgMonthDto { month: IsoMonth; source: 'statement' | 'estimate' | 'none'; grossCents: number;
  fundReceivesCents: number; fundId: number | null; capFinancialYear: number;
  note: string | null }                                                     // note: the statement override's
export interface SuperFlowsDto { sgGrossCents: number; sgFundCents: number; memberFundCents: number;
  memberNetPayCents: number; concessionalCents: number; nonConcessionalCents: number; transferInCents: number }
export interface SuperPeriodDto { periodMonth: IsoMonth; runDate: IsoDate; after: IsoDate | null; through: IsoDate;
  status: SavingsPeriodStatus; valueCents: number | null; notUpdated: boolean; flows: SuperFlowsDto | null;
  gainFrom: IsoDate | null; changeCents: number | null; gainFlows: SuperFlowsDto | null;
  gainCents: number | null; gainRatio: DecimalString | null; returnRatio: DecimalString | null;
  note: PeriodNoteDto | null }                                              // the super_option note of that month
export interface SuperCapYearDto { financialYear: number; start: IsoDate; end: IsoDate; complete: boolean;
  capCents: number; capSource: 'statutory' | 'setting'; sgGrossCents: number; sgFundCents: number;
  sgSource: 'estimate' | 'statement' | 'mixed' | 'none'; salarySacrificeCents: number;
  importedEstimateCents: number; totalCents: number; projectedCents: number; ratio: DecimalString;
  projectedRatio: DecimalString; status: SuperCapStatus; nonConcessionalCents: number;
  memberCents: number; memberFundCents: number; memberNetPayCents: number; estimateCount: number }
export interface SuperChartPointDto { label: string; period: IsoMonth; date: IsoDate; live: boolean;
  valueCents: number | null; gainCents: number | null; returnRatio: DecimalString | null;
  memberNetPayCents: number | null; memberFundCents: number | null; sgFundCents: number | null }
export interface SuperPageResponse {
  asOf: IsoDate; generatedAt: IsoTimestamp; lastRun: IsoDate | null;
  totalCents: number;
  funds: SuperFundDto[];                            // sort order, archived last
  balanceEntries: SuperBalanceEntryDto[];           // asOf desc
  contributions: SuperContributionDto[];            // date desc, then id desc
  sgMonths: SuperSgMonthDto[];                      // month desc
  periods: SuperPeriodDto[];                        // newest first (the provisional first)
  notes: PeriodNoteDto[];                           // every super_option note, month desc
  annualised: { cumulativeRatio: DecimalString | null; returnRatio: DecimalString | null;
    from: IsoDate | null; through: IsoDate | null; days: number | null };
  capYears: SuperCapYearDto[];                      // this FY, then the one before
  capOverride: { cents: number; financialYear: number } | null;            // §3.3 (shown with its FY)
  statutory: { sgRatio: DecimalString;              // the SG rate in use for the as-of month (setting or statutory)
    contributionsTaxRatio: DecimalString; checkedOn: IsoDate; paydaySuperStart: IsoDate;
    caps: { financialYear: number; capCents: number }[];                   // the §3.2 tables
    sgRates: { financialYear: number; ratio: DecimalString }[] };
  flags: SuperFlag[];
  charts: { unit: ChartDateUnit; count: number | null; points: SuperChartPointDto[] };
  settings: SettingsSliceDto;                       // the Super page's keys (§3.3)
}
export interface SuperFundMutationResponse { fund: SuperFundDto }
export interface SuperBalancesResponse { funds: SuperFundDto[] }
export interface SuperContributionMutationResponse { contribution: SuperContributionDto }
export interface SgOverrideResponse { month: SuperSgMonthDto }

// ─── Property ───
export interface PropertyDto { id: number; name: string; purchaseDate: IsoDate | null; isPrimaryResidence: boolean;
  purchaseValueCents: number; valueCents: number; valuationDate: IsoDate; netRentToDateCents: number;
  gainCents: number; gainRatio: DecimalString | null; cagrRatio: DecimalString | null; heldDays: number | null;
  debtCents: number; equityCents: number; lvrRatio: DecimalString | null; loanIds: number[];
  valuationCount: number; note: string | null; sortOrder: number; origin: Origin; sheetRef: string | null }
export interface PropertyValuationDto { id: number; propertyId: number; asOf: IsoDate; valueCents: number;
  note: string | null; origin: Origin; sheetRef: string | null }
export interface AmortisationDto { periodicRatio: DecimalString; firstPaymentDate: IsoDate; firstPeriodInterestCents: number;
  payments: number | null; payoffDate: IsoDate | null; totalInterestCents: number | null;
  points: { date: IsoDate; balanceCents: number; interestCents: number }[];
  flag: 'payment_below_interest' | 'never_repaid' | null }
export interface LoanBalanceEntryDto { id: number | null; start: boolean;   // null id: the start point (no Edit/Delete)
  loanId: number; asOf: IsoDate; balanceCents: number;
  paymentsCounted: number | null; repaymentsCents: number | null; repaymentsTyped: boolean;
  principalCents: number | null; interestFeesCents: number | null; cumulativePrincipalCents: number | null;
  cumulativeInterestFeesCents: number; flags: LoanEntryFlag[]; note: string | null; origin: Origin;
  sheetRef: string | null }
export interface LoanDto {
  id: number; propertyId: number | null; propertyName: string | null; name: string; lender: string | null;
  startDate: IsoDate | null; startBalanceCents: number | null; annualRate: DecimalString | null;
  compoundingPerYear: number | null; paymentCents: number | null; paymentFrequency: PaymentFrequency;
  paymentAnchorDate: IsoDate;                       // the payment grid's anchor (§2.3; the web's estimate placeholder)
  balanceCents: number; balanceAsOf: IsoDate;
  offsetCents: number; netBalanceCents: number; excessOffsetCents: number; offsetAccountIds: number[];
  repaymentsCents: number; principalPaidCents: number; interestFeesCents: number;
  nextPeriodInterestCents: number | null;
  schedule: AmortisationDto | null; scheduleWithoutOffset: AmortisationDto | null;
  interestSavedCents: number | null; monthsSaved: number | null;
  imported: { paymentsPaidCents: number | null; paymentsPaidDerived: boolean } | null;   // the workbook's figure (display)
  flags: LoanFlag[]; entryCount: number; note: string | null; sortOrder: number; origin: Origin;
  sheetRef: string | null;
}
export interface OffsetAccountDto { id: number; name: string; balanceCents: number; balanceAsOf: IsoDate | null;
  linkedLoanId: number | null }
export interface PropertyTotalsDto { purchaseCents: number; valueCents: number; gainCents: number;
  gainRatio: DecimalString | null; mortgageCents: number; offsetCents: number; netMortgageCents: number;
  principalPaidCents: number; interestFeesCents: number; repaymentsCents: number; startBalanceCents: number;
  lvrRatio: DecimalString | null; equityCents: number }
export interface PropertyChartPointDto { label: string; period: IsoMonth; date: IsoDate; live: boolean;
  valueCents: number | null; purchaseCents: number | null; mortgageCents: number | null; equityCents: number | null;
  lvrRatio: DecimalString | null; interestFeesCents: number | null; principalPaidCents: number | null }
export interface PropertyPageResponse {
  asOf: IsoDate; generatedAt: IsoTimestamp; lastRun: IsoDate | null;
  properties: PropertyDto[];                        // sort order
  valuations: PropertyValuationDto[];               // asOf desc
  loans: LoanDto[];                                 // mortgages by property order, then loans without a property
  loanEntries: LoanBalanceEntryDto[];               // asOf desc; each loan's start point included (id null)
  offsetAccounts: OffsetAccountDto[];               // every account flagged Offset (D56)
  totals: PropertyTotalsDto;
  charts: { unit: ChartDateUnit; count: number | null; points: PropertyChartPointDto[] };
  settings: SettingsSliceDto;                       // savings.includeMortgagePrincipal, property.offsetsIncludeEmergencyFund
}
export interface PropertyMutationResponse { property: PropertyDto }
export interface ValuationsResponse { properties: PropertyDto[] }
export interface LoanMutationResponse { loan: LoanDto }
export interface LoanBalancesResponse { loans: LoanDto[] }
export interface LoanOffsetsResponse { loan: LoanDto; offsetAccounts: OffsetAccountDto[] }
```
`DeletedResponse` and `PeriodNoteDto`/`PeriodNoteResponse`/`SettingsSliceDto` are reused. server-api adds a type-level test that `OtherAssetsChartPoint`, `SuperFlows`, `SuperCapYear`, `SuperChartPoint`, `AmortisationResult`, `PropertiesResult['totals']` and `PropertyChartPoint` are assignable to their DTOs (Cents → number).

### 4.5 Server behaviour (server-api; `apps/server/src/assets/**`, the routes)
**One request context.** The Stage 3 `FinanceContext` (one read transaction, prices first, memoised engine calls) gains `otherAssets()`, `superResult()`, `property()` and `assetsSnapshot()` (= `engine.assetsSnapshotColumns` of the three), each computed once per request; the loader also reads the Stage 4 tables and the offset links; the market series come from `market.getSeries()` before the transaction (as prices). The server adds only display fields (names, notes, origins, counts); every figure comes from the engine.

**Engine inputs built by the server** (`apps/server/src/assets/inputs.ts`, each row unit-tested):
| Input | Source |
|---|---|
| `EngineOtherAsset` | `other_assets` in `sort_order`, then id: `legacySoldUnits = sold_units`; manual pricing = the latest `other_asset_prices` entry at `asOf` (the §2.3 rule; none → price null); bullion pricing = `XAG_AUD_OZ` (silver) or `XAU_AUD_OZ` (gold) from `market.getSeries()` (`value`, the as-of's local date, `fresh` = status `fresh`; no value → null) with the row's `unit_price`/`unit_price_as_of` as the fallback; the sales |
| `fxRates` | `USD` → 1 ÷ `AUDUSD` (12 significant digits); another code `C` → `FX_<C>AUD`; `GBX` → `FX_GBPAUD` ÷ 100; every stored value is used, stale or not (the DTO's `fx` list shows the status) |
| `assumedDate` | the earliest snapshot's run date (null without snapshots) |
| `SuperInput` | funds (sort order) with their `super_balance_entries` (incl. `transfer_in_cents`); contributions = `super_entries` of kinds `voluntary_contribution`, `salary_sacrifice`, `after_tax` (date = `entry_date`, else the first day of `period_month`); `super_sg_overrides`; `pay.grossAnnualSalaryCents`, `pay.jobStartDate`, `tax.marginalRate` and the §3.3 keys with their defaults (`sgRatio` null while `super.sgRate` is unset; `concessionalCapOverride` from `super.concessionalCapCents` + `super.concessionalCapFy`, null unless both are set) |
| `PropertyInput` | properties with their valuations; loans with their start fields, their stored entries and `offsets` = the linked accounts (via `loan_offset_links`) that are still flagged Offset, at their current balance |
| snapshots | the `snapshots` rows' History columns each engine names |
| charts | `charts.dateUnit ?? 'monthly'`, `charts.unitCount ?? null` |
| the live savings input (§2.8) | `super.snapshot.superContribCents`, `property.savingsLive`, `offsetCents` = `cashTotals().offsetCents` when any offset account exists (else null); the **latest** snapshot's `offsetCents` = Σ today's offset accounts' latest `cash_balance_entries` on or before its run date (none by then: 0, or the earliest entry for an `origin 'import'` offset account, §2.9), every earlier snapshot null (all null when no offset account exists; §2.9); `otherAssetPurchases` = `otherAssets.savingsFlows` |
| class values | `other_assets` = `otherAssets().totals.valueCents` (live spot and FX), replacing Stage 3's stored-price sum |

`staticUntilStage4` is always `false`; `apps/server/src/cashflow/inputs.ts` loses `provisionalSuperContribCents`, `liveSavingsInput`'s static parts, `otherAssetPurchases` and `otherAssetsValueCents` (moved to the engine calls above; the records page keeps its own display helper).

**Mutations** (one synchronous `BEGIN IMMEDIATE` transaction each; Stage 3's order):
0. `importLock.held` → 409 `IMPORT_IN_PROGRESS`, before parsing an `:id`.
1. Parse (400); load the target (404); cross-row rules (400): a bullion asset in a price save; a sale or an update that leaves fewer than 0 units → **422** `SALE_OVERSELL`; a contribution's fund that does not exist → 404; an SG month after the as-of month; an offset id that is not an offset account; a loan's property that does not exist → 404.
2. Write with the §3.4 origin rules; a delete of a row with a `sheet_ref` calls `markImportRowDeleted`. Compare "changed" after normalising both sides (trim, `''` → null, decimals normalised), so a no-op save never flips `origin`.
3. Entry saves upsert `(parent, as_of)` and then set the parent's denormalised copy (`other_assets.unit_price`/`unit_price_as_of` for manual assets, `super_funds.balance_cents`/`balance_as_of`, `properties.current_value_cents`/`valuation_date`, `loans.current_balance_cents`/`balance_as_of`) from its latest entry; deleting an entry recomputes it. A loan balance save with `repaymentsCents` omitted keeps a stored entry's figure; `null` clears it (back to the default).
4. **Other assets:** a create with a price writes the first entry. **Purchase FX on an update:** when the currency or the purchase date changes, a `purchaseFxRate` equal to the stored one counts as not typed (the form echoed it): `purchase_fx_*` are cleared and re-fetched; a different typed rate → `purchase_fx_source 'user'`, `purchase_fx_date` = the purchase date. When neither changes, an echoed rate keeps the stored rate and source, and a different one is `user` as above. (The web form also blanks "FX at purchase" when the currency or the date changes, §6.3.) After any create or update of a non-AUD asset with a purchase date and no rate, or of a bullion asset, call `market.notifyInstrumentsChanged()` (the price job then fetches FX and fills the rate, §4.6).
5. **Super funds:** `receivesSg: true` clears the flag on every other fund (their `origin` kept). A `receivesSg`-only change keeps the fund's `origin` (§3.4). A create writes the opening entry with `transfer_in_cents` = the opening balance unless `openingIsRollover` (§2.5 step 1). **Dates (Fixer round 1):** a non-rollover opening balance > 0 dated on or before the last recorded month's run date is refused (400 `asOf: date the opening balance after dd/mm/yyyy (the last recorded month), or mark it a rollover`): a closed period's value is the stored History Q, which never held the new fund, so its transfer in would read as a loss there and as a gain in the provisional period. `PUT /api/super/balances` refuses the same way a new or changed `transferInCents` > 0 dated on or before the last run on a fund created in the app (`sheet_ref` null; 400 `entries.N.transferInCents: …`); an imported fund keeps its closed-window transfers (its money was in the sheet's Q). Stage 5 revisits this once recorded months hold app funds. `archived: true` needs the fund's latest balance to be 0 (400 `archived: enter a closing balance of $0 first`), and while a fund is archived its latest balance stays 0: a balance save or an entry delete that would leave it non-zero is refused (400, rolled back).
6. **Contributions:** `period_month = isoMonthOf(date)`, `entry_date = date`; editing an imported entry turns it into the typed kind (`origin app`).
7. **SG overrides:** upsert by the month earned (overlay rows are written `origin app` but never scanned, §3.4).
   - **Settings:** a PATCH that writes `super.concessionalCapCents` also writes `super.concessionalCapFy` (the as-of's FY start year; null when the cap is cleared); the response slice follows §3.3.
   - **Period notes** (the Stage 3 route, `cashflow/cash.ts` and `cashflow/mutations/cash.ts`): `periodNoteDto` returns every `EditableNoteKind` (it returned null for any kind but `spend` and `side_income`); `putPeriodNote` keeps the recorded-period rule for `spend` and `side_income` and lets `super_option` take any month up to the as-of month (400 `periodMonth: after this month`).
   - **Loans:** a create writes one stored entry (its current balance at `asOf`); no start entry is written or maintained (§2.6).
8. **Offsets:** `PUT …/offsets` replaces the loan's links with the listed accounts (an account linked to another loan moves); an account whose Offset flag is turned off on the Cash page loses its link in the same transaction (the Stage 3 account update gains this step).
9. Commit, then respond with the DTO recomputed from a fresh context (201 or 200). DELETE → `{ id }`.

**Constants** (`apps/server/src/assets/constants.ts`): `SUPER_PAGE_SETTING_KEYS`, `OTHER_ASSETS_PAGE_SETTING_KEYS`, `PROPERTY_PAGE_SETTING_KEYS` (§3.3).

**Cross-cutting (server-api):**
- `db/queries/domain.ts`: `hasAppData` scans the new import-owned tables through `DOMAIN_TABLES_DELETE_ORDER` (automatic); `super_sg_overrides` and `market_quote_history` are never scanned.
- `records/index.ts`: the seven new entities and the appended columns.
- The type-level DTO assignability test (§4.4).
- **Consistency:** single user, last write wins (as Stages 2–3). A CLI import beside the server can replace rows; a later mutation naming a vanished row gets 404. The FX backfill writes only rows whose currency, purchase date and null rate are unchanged since it chose them.

### 4.6 Market data (market-data; `apps/server/src/market/**`)
The frozen `MarketDataService` interface (Stage 1 §5.1) is unchanged. Additions inside the `prices` job (`market/refresh.ts`, `market/fxHistory.ts`):
1. **FX for other assets:** step 5c's `crossNeeded` also gets the currencies of `other_assets` rows (`GBX` → `GBP`; `AUD` and `USD` excluded: USD uses `AUDUSD`), so `FX_<CCY>AUD` is refreshed every run while an asset uses it.
2. **Purchase-date FX backfill** (after the instruments; at most `FX_BACKFILL_MAX_PER_RUN = 10` assets per run): assets with a non-AUD currency, a purchase date, a null `purchase_fx_rate` and a source other than `user`, **least recently attempted first** (never attempted first, then id order). **The client** (frozen, FEAS-3): `Providers` (`market/refresh.ts`) gains an **optional** member `fxCloses?: FxClosesClient` with `fetchCloses(ccy: string, period1: IsoDate, period2: IsoDate, signal: AbortSignal): Promise<{ date: IsoDate; close: DecimalString }[]>` (the type in `market/providers/types.ts`); `createYahooFxClosesClient({ fetchImpl, sleep, now, timeoutMs, spacingMs })` in `providers/yahoo.ts` and `createFakeFxClosesClient({ now })` in `providers/fake.ts` (the Stage 3 events-client pattern), built in `service.ts` `buildProviders` (fake mode → the fake client; live → the Yahoo one). When the member is absent (the existing test literals), the backfill is skipped, so every Stage 1–3 `Providers` literal still compiles and behaves as before. **Retries** (FEAS-9): an in-memory attempt time per (currency, date), like `Cooldowns`; a pair is retried at most once a day, and a pair attempted within that day counts `skipped`, not `failed`, so one unreachable date cannot keep every run `partial` or starve the assets behind it. One Yahoo request per distinct (currency, date): `GET https://query1.finance.yahoo.com/v8/finance/chart/{CCY}AUD=X?period1={unix(date − 10 days)}&period2={unix(date + 1 day)}&interval=1d` (`GBX` → `GBPAUD=X`), with the provider's spacing, timeout and User-Agent, the shared Yahoo cool-down and the run deadline. `parseYahooCloses(body)` (pure, in `market/providers/yahoo.ts`) returns the daily closes with local dates in `meta.exchangeTimezoneName` (the Stage 3 resolver, `gmtoffset` fallback). The rate is the last close dated on or before the purchase date (none → the asset stays unfilled, counted `failed`). The write sets `purchase_fx_rate` (÷ 100 for `GBX`, 12 significant digits), `purchase_fx_source 'market'` and `purchase_fx_date` = the close's date, **only** when the row still has the same currency and purchase date and a null rate, without touching `origin`; the fetched closes are upserted into `market_quote_history` as `FX_<CCY>AUD`.
3. **Series history:** in the job's write transaction, every series written `ok` this run upserts `market_quote_history(series_id, date, value, source, fetched_at)` with `date` = the server-local calendar date of the series' as-of (one row per series per day; a later run that day replaces it).
4. **Fake mode:** the backfill uses `fakeFxClose(ccy)` = `1 ÷ FAKE_AUDUSD` for USD, else `fakePrice('<CCY>AUD=X')` (the live fake's own cross rate), dated at the purchase date; no network. **Off mode:** nothing runs; rates stay null and the page offers a typed rate.
5. The job's `detail` gains `fxBackfill: { requested, filled, failed, skipped }`; a backfill failure alone makes the run `partial` (`service.ts` `jobStatus` counts `fxBackfill.failed` beside the instrument and series failures; the Stage 1 status rules otherwise).
6. **Read helper** (frozen; the Scaffolder stubs it returning `{}`): `readQuoteHistory(db: JoinrDb, seriesIds: readonly string[], fromDate: IsoDate): Record<string, { date: IsoDate; value: DecimalString }[]>` in `market/history.ts` (date order). server-api uses it for the bullion spot charts, from one year before `asOf` (or the earliest bullion purchase date, whichever is later).

---

## 5. Chart data
| Chart (page) | Source | Per group | Live point | Mode |
|---|---|---|---|---|
| Cost and value (Other Assets) | engine `chart`: cost held (≤ the date, D73) and value (stored AJ; live: the totals) | last point | the as-of point | end |
| Gain (Other Assets) | stored AK; live: the totals; gain % = gain ÷ (value − gain) as History AC | last point | yes | end |
| Price history (Other Assets, one item) | manual: its price entries (asset currency); bullion: `spotHistory` × oz per unit (AUD) | raw points | — | — |
| Super value (Super) | engine `chart`: Q per period (provisional: Σ latest balances) | last point | provisional | end |
| Gains (Super) | derived gains (not-updated periods merge forward and show no bar) | sum | provisional (when updated) | sum |
| Return (Super) | chained `returnRatio` of the group's valuation periods | chain | provisional | — |
| Into the fund (Super) | SG to the fund and your contributions to the fund, stacked (parts of the money the fund received) | sum | provisional | sum |
| Fund balance history (Super) | the chosen fund's balance entries | raw points | — | — |
| Concessional cap (Super) | `capYears` (a `Meter` per FY) | — | — | — |
| Value and purchase price (Property) | engine `chart`: X and Y per snapshot; live: the totals | last point | yes | end |
| Loan to value (Property) | per snapshot `|AB| ÷ X` (gross: snapshots hold no offsets); live: net of offsets (foot note when offsets exist, §6.5) | last point | yes | end |
| Loan balance (Property, one loan) | its log points (the start point included): the balance, one line | raw points | — | — |
| Repaid so far (Property, one loan) | its log points: cumulative principal and cumulative interest and fees, a stacked area (parts of the cumulative repayments) | raw points | — | — |
| Payoff projection (Property, one loan) | the schedule's yearly points, with and without the offset | raw points | — | — |

- Unit and count come from `charts.dateUnit ?? 'monthly'` and `charts.unitCount ?? null`; the yearly unit is the FY (`FY2025–26`), as §2.10.
- The live point's label ends in " (live)" and the card says "The last point is live: it uses today's prices and balances." (Stage 2 §5 pattern). There is no current-month zero (§11 fix 14).
- **Colour** (STYLE_GUIDE §6.1: slots in order, never reused within a chart; the legend lists series in slot order): single series slot 1. Cost and value: Value slot 1, Cost slot 2 (legend "Value, Cost"). Value and purchase price: Value slot 1, Purchase price slot 2. Payoff projection: "With your offset" slot 1, "Without the offset" slot 2. Repaid so far: Principal slot 1, Interest and fees slot 2. Into the fund: SG slot 1, yours slot 2. Two series are never stacked when they are not parts of one total (§11 fix 15), and no chart uses a second axis. Gains follow the Stage 2 gain charts (a negative bar below zero with its sign and value in the tooltip and table). A web test asserts each chart's series colours are distinct and in slot order.

---

## 6. Web spec (`apps/web`)

### 6.1 Routes and files
- Typed routes replace the three placeholders: `/other-assets` → `OtherAssetsPage`, `/super` → `SuperPage`, `/property` → `PropertyPage`. `pages.ts` is unchanged.
- Files: `src/pages/otherAssets/**`, `src/pages/super/**`, `src/pages/property/**`, shared helpers in `src/pages/assets/**` (entry-log editors with a shared as-of date, the Assumed / Estimate / Stale / Spot badges, rate and frequency words, the FX line). Reuse `pages/cashflow/**` (forms, callouts, settings drafts, row delete) and the Stage 1 `PriceBadges`. No folder named `data`.
- **Colour of figures** (D33; STYLE_GUIDE §8): the stop tint only for a **loss** (a negative gain, a negative realised gain, a negative super gain) and a negative cash balance. Balances owed on a loan are shown as positive "balance" figures in body text; interest and fees, contributions and SG are flows in body text. Web tests assert both treatments.
- **Teal:** one key figure per page: Other Assets "Current value", Super "Total super", Property "Equity" (the tile). Table totals are white bold with no teal.
- `packages/ui` **`Meter`** (UX-1): the Stage 3 meter speaks for a savings target ("Short by", "Reached", a teal fill), which misreads a cap. Web adds, additively with tests and a Scaffold note (Stage 3 precedent): `kind?: 'target' | 'cap'` (default `'target'`, the Stage 3 texts unchanged; `'cap'` → "$X left under the cap", "At the cap", "Over the cap by $X"), `markerCents?: number` with `markerLabel?: string` (a white tick across the track, as the gauge's target tick, for the projection; its figure is also in the text line, never tick-only), and `tone?: 'go' | 'check' | 'stop'` (the fill for under / near / over, with the status word). Unit tests cover the three statuses and the tick. Any other prop a component needs follows the same rule.
- **Status markers** (UX-12; `pages/assets/display.ts`, defined once): **Assumed** and **Estimate** → `StatusBadge` `pending` with those words (one word, "Estimate", everywhere: imported contributions, SG months, default loan repayments); **Statement** → `StatusBadge` `recorded`; a typed loan repayment → no badge (a muted "Entered" line only in the log's Details); an unpriced item → `Pill` `na` "No price yet" (not the red "No price" of the price pages). When every row of a column shares a marker (every SG month an estimate), the column header carries one foot-noted marker instead of a badge per row. Other Assets rows never show the green "Manual" badge (hand pricing is the normal state); they show Stale, Spot and Last known only.
- **Rates** (UX-15, an explicit exception to STYLE_GUIDE §8's one decimal): interest rates, the SG and contributions-tax rates and the marginal tax rate show up to 2 dp with trailing zeros dropped (5.89 %, 12 %, 15 %, 11.5 %), as lenders and the ATO quote them; every other percentage keeps one decimal. One helper (`formatRate` in `pages/assets/display.ts`), unit-tested; the style reviewer checks it is used only for those rates.

### 6.2 API layer (`src/api/hooks.ts` additions)
- Query keys `['other-assets']`, `['super']`, `['property']`; each page refetches every 60 s while visible.
- One mutation hook per endpoint of §4.2. **Every Stage 4 mutation** invalidates `['other-assets']`, `['super']`, `['property']`, `['cash']` (the provisional savings period), `['budget']` and `['investments']` (the other-assets class value), `['records']`, `['import']` and `['status']` (`invalidateAfterAssetsChange`). Stage 3's `invalidateAfterCashflowChange` also covers the three new keys (an offset flag or balance moves the property figures), and so do the price-refresh and import invalidations (bullion spot, FX).
- Value imports from `@joinr/schema` root only (enums, the request-schema factories, `settingDef`, `isWorkbookSetting`, the §3.2 constants and `paymentDatesBetween`); DTO types with `import type`.

### 6.3 Other Assets page (desktop ≥ 1200 px; STYLE_GUIDE §3–§6, §8, §10)
1. **`PageHeader`** "Other Assets" (sub-line "Assets"); actions **Update prices** (primary) and **Add asset** (secondary).
2. **KPI tiles** (6 at span 4): **Current value** (the teal figure; hint "N items · M without a price") · **Gain** (dollars; hint "8.5 % on cost", the gain ratio with its word) · **Cost** (hint "Undated items count from dd/mm/yyyy (assumed)" when any) · **Realised on sales** ("No sales yet" when none) · **Bullion spot** (always shown: "Silver $X/oz · Gold $Y/oz" and the as-of date, a Stale badge when stale, "Spot unavailable: last known prices" when missing; hint "You hold N oz of silver" per metal held, or "No bullion held") · **Prices to update** ("N older than D days" or "All prices current").
3. **Callouts:** assumed dates (D73) → `Callout note` "N items have no purchase date. Their return and the cost line count from the first recorded month (dd/mm/yyyy), marked Assumed. Add a purchase date to replace it."; purchase FX missing (`fxMissingCount`) → `Callout important` "N items need the exchange rate on their purchase date. It is fetched from Yahoo on the next price refresh, or type it in the item's form."; live FX missing (`liveFxMissingCount`, market on) → `Callout note` "N foreign items have no current exchange rate yet, so they show no value until the next price refresh."; market off → `Callout note` "Market data is off: bullion uses its last known price and foreign items are unvalued." (it replaces the live-FX callout).
4. **`SectionBar` "Assets"** (primary): `ColumnTable` Item · Bought · Units · Unit cost · Price · Cost · Value · Gain · Gain % · Return / yr · Actions (UX-13: Cost is the AUD cost of the remaining units, so Value − Cost = Gain on every row). The item cell holds the item's name and, for bullion, a `Pill` "Silver · 1 oz each"; a legacy sale shows a muted "N sold in the workbook". **Names and links** (UX-5, `display.ts`): an item's `url` makes its name a link (opens in a new tab, `rel="noopener noreferrer"`, accessible name "<name> (valuation source)"); when the description itself is a URL, the shown name is the host and path without the scheme or "www.", ellipsised at 48 characters ("example.com/items/1"), the full URL only in the link's accessible name and `title`, and the link is not repeated. The same short name is used in accessible names ("Price, <short name>") and in selects; the stored description never changes (a rename is an app edit, D34). Units show the unit of measure ("10 oz", "1"). Bought shows the date, or the Assumed marker with the date. Unit cost shows its currency when not AUD and a muted FX line "1 USD = A$1.5381 on dd/mm/yyyy" (GBX: "1 GBP = A$1.9012", the stored per-penny rate × 100). Price shows the AUD price per unit, its as-of date and a badge (Stale, Spot, Last known; unpriced: "No price yet"). Return / yr shows "—" with "Held under 90 days" under 90 days held, and the Assumed marker beside an assumed date. Total row: Cost, Value and Gain (white bold). Row actions: **Edit**, **Sell**, **Price history**, and **Mark current** on a stale manual row (saves the latest price again at today's date, UX-6).
   - **Update prices (D72):** one `<form>` wraps the table; a shared **As of** `DateField` (default today, max tomorrow) and an optional shared **Note** sit under the section bar; every manual row's Price cell becomes a decimal field (the price per unit in the item's currency, with the currency as a suffix on non-AUD rows, `labelHidden`, accessible name "Price, <short name>") and a **Still current** checkbox (UX-6: ticked, the row's unchanged price is saved at the shared as-of, which clears Stale); bullion rows show "Spot" (read-only); Save sends the rows whose price changed or whose Still current box is ticked; a row older than its latest entry notes "Older than the latest price (dd/mm/yyyy): added to the history only".
   - **Asset form** (inline `Card`): Description; Valuation source (a URL); Purchase date (optional; hint "Leave blank if unknown: the first recorded month is assumed"); Units; Currency (`Select` AUD, USD, EUR, GBP, GBX (UK pence), NZD, JPY, CAD, CHF, HKD, SGD, **plus the stored code when it is another one**); Unit cost (in the currency); **FX at purchase** (foreign currencies only; hint "AUD per 1 USD on the purchase date. Left blank, it is fetched from Yahoo."; for GBX the field asks "AUD per 1 GBP" and the form divides by 100 before saving; **blanked when the currency or the purchase date changes**, §4.5 step 4); **Priced by** (`Segmented` "My valuation" | "Bullion spot"; choosing Bullion spot sets Currency to AUD and disables it and hides FX at purchase and the price fields); for bullion Metal (Silver, Gold) and Oz per unit; for a new manual item Current price and As of; Note. **Delete** sits in the edit form (UX-17: the Stage 3 pattern, an inline confirm; a workbook row shows the workbook callout).
   - **Sale form** (inline under the row): Sale date, Units (at most the remaining units), Proceeds received (AUD), Note; the row's realised gain appears after saving. A 422 shows "Only N units are left to sell".
   - **Price history** (UX-18): a `ChartCard` "Price history" with an item `Select` (default: the item with the most entries): manual items show their entries (a line in the item's currency) and a table (As of, Price, Note, Source, Delete); bullion items show the spot history × oz per unit with the note "Priced from the silver spot price (AUD per ounce) × 1 oz" and the empty state "Spot history starts with the first price refresh". The row action selects the item, scrolls the card into view, moves focus to its heading (`tabIndex −1`) and announces "Showing <short name> price history" in the `LiveRegion`.
   - **Sales** (shown when any): `ColumnTable` Date · Item · Units · Proceeds · Cost · Realised gain · Note · Actions (Edit, Delete).
5. **`SectionBar` "Value over time"** (supporting; UX-18): `ChartCard` "Cost and value" (two lines with an area wash, not stacked; legend Value, Cost) and `ChartCard` "Gain", each with its table view; foot note "Cost counts items from their purchase date; undated items from the first recorded month (assumed)."
6. **`SectionBar` "Settings for this page"** (reference): "A price is stale after D days" (an app-only key: the note "Kept when you re-import").

### 6.4 Super page
1. **`PageHeader`** "Super"; actions **Update balances** (primary), **Add contribution** and **Add fund** (secondary).
2. **KPI tiles** (6 at span 4): **Total super** (teal; hint "N funds · dd/mm/yyyy") · **Latest gain** (the latest valuation period's gain and return, hint "Jun 2026", the provisional period "Sep 2026 · to dd/mm/yyyy" with its measured end (D79); when the provisional period is not updated: the last closed one, with "Update your balances to see this month's gain") · **Return per year** (annualised, hint "since Jul 2024 · N days"; "—" with "Needs 90 days of history") · **Contributed this FY** (UX-8: `memberCents`, the amounts as on your payslip or bank statement; hint "Fund receives $X · take-home cost $Y"; the Estimate marker when `estimateCount > 0`) · **Employer SG this FY** (`sgGrossCents` of this FY's cap year; hint "To the fund $Z · Estimated / From statements / Partly from statements"; in FY2026–27 also "includes Apr–Jun 2026, paid in July") · **Concessional cap** (UX-1: "N % used · projected M % by 30 June", `ratio` and `projectedRatio`, with a `StatusBadge` Under / Near / Over that follows the projection, so the badge and the figures agree).
3. **Callouts** (from `flags`): `no_salary` → `Callout important` "Set your gross salary in Settings for this page to estimate employer SG."; `no_sg_fund` → `Callout note` "Choose the fund that receives employer SG." with an inline **Select** of the funds and a **Save** button (UX-24: it sends only `receivesSg`, so it carries the import-safe note "Choosing the SG fund keeps re-import available"); `no_marginal_rate` → `Callout important` (UX-9) "Set your marginal tax rate in Settings for this page: salary-sacrifice contributions are left out of your savings rate until then, and imported contributions are not grossed up."; `imported_estimates` → `Callout note` "N imported contributions have no type: counted as <salary sacrifice, grossed up at your marginal tax rate | after-tax>. Change this in Settings for this page."; `balances_not_updated` → `Callout note` "Balances have not been updated since the last recorded month, so this month's gain is not shown yet."
4. **`SectionBar` "Funds"** (primary): the section header carries the same SG-fund **Select + Save** (UX-24). `ColumnTable` Fund · Balance · As of · Receives SG · Source · Actions (Edit, Balance history); total row. **Update balances** as §6.3 (one balance field per fund, the shared As of and Note). **Fund form:** Name, Receives employer SG (`Switch`, "Only one fund at a time: choosing it here clears the others"), Archived (edit only; disabled with "Enter a closing balance of $0 first (after a rollover)" unless the latest balance is 0); create adds Opening balance, As of and **Moved from a fund on this page (a rollover)** (`Switch`, off by default; hint "Off: the opening balance is money you already had, not a gain"); with the switch off and an opening balance above 0, As of must be after the last recorded month ("Date the opening balance after dd/mm/yyyy (the last recorded month), or mark it a rollover.", the server's §4.5 rule). **Delete** sits in the edit form (UX-17), disabled with "This fund has N contributions; move or delete them first" while it has any (the 409 still shows). The SG switch alone on a workbook fund shows the note "Choosing the SG fund keeps re-import available" instead of the workbook callout (§6.7). **Balance history** (UX-18; the action scrolls to the card, focuses its heading and announces it): a `ChartCard` "Balance history" with a fund `Select` and a table As of · Balance · Change · Flows in · Transfer in · Gain · Note · Source · Actions (Edit: Balance, Transfer in (hint "Money moved in from a fund not on this page; not a gain"), Note; Delete, not on the last entry).
5. **`SectionBar` "Contributions"** (supporting):
   - **Cap meters** (D70): a `Meter` (`kind 'cap'`, §6.1) "Concessional contributions FY2026–27" (value = so far, target = the cap, the projection as the marker, the tone from `status`; the figures line reads "so far (includes estimates)" when `importedEstimateCents > 0`), a `KeyValueTable` (Employer SG (counted when the fund receives it), Salary sacrifice, Imported (estimate), Projected by 30 June with its percentage, Non-concessional this FY, Cap with its source "ATO figure for FY2026–27, checked 26/09/2026" or "Set by you for FY2026–27"); in FY2026–27 a note "Includes the April–June 2026 quarter's SG, due by 28 July 2026 (the switch to Payday Super): the ATO counts a contribution in the year your fund receives it."; before 1 July 2026 a note "SG is counted at its quarterly due date; if your employer paid earlier, some may belong to the year before." `near` → `Callout important` "On track for N % of the concessional cap by 30 June. Contributions over the cap are taxed at your marginal rate."; `over` → the same callout with "over the cap". The previous FY sits in a closed `<details>`. With a cap override for another FY (`capOverride.financialYear` ≠ this FY): the note "Your FY2025–26 cap override no longer applies; this year uses the ATO figure."
   - **Contributions table** (UX-23): Date · Fund · Type (`Pill` Salary sacrifice / After-tax / Imported, plus the Estimate marker on imported rows) · Pre-tax (`preTaxCents`; after-tax rows "—") · Fund receives · Take-home cost ("—" with "No marginal rate" when null) · Toward the cap (Concessional, or "Non-concessional" for after-tax rows) · Period (a Provisional badge) · Note · Actions (Edit, Delete).
   - **Contribution form:** Type (`Segmented` Salary sacrifice | After-tax), Date (hint "The date your fund received it, for the cap"), Fund (`Select`, "Not assigned"), Amount (label "Pre-tax amount, as on your payslip" or "Amount paid from your take-home pay"), Note; a hint names the rates in use ("Take-home cost at your 37% marginal rate; the fund receives it less 15% contributions tax"; without a marginal rate: "Set your marginal tax rate to see the take-home cost"). Editing an imported entry asks for its type and pre-tax amount, pre-filled with the current reading (the `preTaxCents` for salary sacrifice, the amount for after-tax) and a muted line "Imported as $X take-home cost".
   - **Employer SG table:** Month (earned) · Source (Estimate / Statement markers, or "None") · Before tax · Fund receives · Fund · Cap year (the `capFinancialYear` label) · Actions (Enter statement / Edit / Remove). The **statement form:** Employer contribution before tax for the month it was earned (as on your payslip), Note; the note "Statement figures are kept when you re-import".
6. **`SectionBar` "Performance"** (supporting): the periods table (newest first) Period (Provisional / Baseline / Not updated badges; a merged row adds "since dd/mm/yyyy" from `gainFrom`) · Value · Change (`changeCents`) · Employer SG (to fund) (`gainFlows.sgFundCents`) · Your contributions (to fund) (`gainFlows.memberFundCents`) · Transfers in (shown only when any) · Gain · Return · Option note · Actions (Note). Every valuation row adds up: Change − SG − yours − transfers = Gain (UX-11; a web test checks it on every row); a not-updated row shows its own window's flows muted with "Merged into the next month". Charts "Super value", "Gains", "Return" and "Into the fund" (`ChartCard`s, Chart | Table). Foot notes: "Gains are derived: the change in balance minus employer SG and your contributions after contributions tax, and minus money moved in from outside. A month whose balance was not updated is merged into the next." · "Return per year chains each period's Modified Dietz return." **Investment option notes** (D69): every `super_option` note by month in a small list with Edit; the note form takes a month (up to this month) and the text (500 chars; empty removes it).
7. **`SectionBar` "Settings for this page"** (reference): Gross annual salary, Marginal tax rate, Job start date (workbook keys: the workbook callout), Your employer's SG rate (placeholder "Legal minimum 12", beside the field's % suffix; Fixer round 1), Contributions tax, Concessional cap override (this financial year only; placeholder "ATO 32,500", beside the field's $ prefix), Imported contributions are (app-only keys: the import-safe note).

### 6.5 Property page
1. **`PageHeader`** "Property"; actions **Update balances** (primary, UX-22: every loan's balance with a shared As of and Note, and optional repayments per row; `PUT /api/property/loan-balances`), **Update values**, **Add property** and **Add loan** (secondary).
2. **KPI tiles** (6 at span 4): **Equity** (teal; net of offsets) · **Property value** (hint "Valued dd/mm/yyyy") · **Mortgage** (the net balance; hint "Offsets $X · balance $Y" only when offsets exist) · **Loan to value** · **Principal paid** (hint "Interest and fees $X, estimated") · **Paid off** ("Mar 2051", hint "In 24 years 6 months"; with an offset "N months sooner with your offset"; with several loans the latest payoff and "N loans"; "—" with the flag's words otherwise).
3. **Callouts:** while any log entry uses the default repayments → `Callout note` "Interest and fees are estimated from your repayments: the regular payment × the payments due. Enter the actual repayments on an entry to replace the estimate."; an offset account linked to no loan → `Callout note` with a **Link** action; a loan without a property → `Callout note` "N loans are not linked to a property. The app tracks mortgages only."; `payment_below_interest` → `Callout important` "The repayment does not cover the interest, so this loan never pays off at this rate."; `no_rate` / `no_payment` / `no_compounding` → `Callout note` naming the missing field.
4. **`SectionBar` "Properties"** (primary): a `Card` per property (span 12 for one, 6 each for more) with a `KeyValueTable`: Purchased · Primary residence (Yes with the note "Counted in net worth; the FIRE planner (Stage 6) leaves it out", D68) · Purchase price · Value (as of) · Net rent to date · Gain (with %) · Annualised gain ("—" under 90 days held) · Mortgage (net) · Equity · Loan to value; actions **Edit**, **Valuations** (UX-18: a valuation chart and table; the action scrolls to it, focuses its heading and announces it). **Update values** (a page action) shows one value field per property with the shared As of and Note. **Property form:** Name, Purchase date, Primary residence (`Switch`), Purchase price, Net rent to date (hint "Rent less costs, to date; may be negative"), Note; create adds Current value and As of. **Delete** sits in the edit form (UX-17), disabled with "This property has N loans; delete them first" while it has any.
5. **`SectionBar` "Mortgages"** (primary): a `Card` per loan:
   - `KeyValueTable`: Property · Lender · Started (date and balance) · Interest rate ("6.00% a year, compounding monthly", `formatRate`) · Repayment ("$X fortnightly") · Balance (as of) · Offset accounts (the linked names and total; **Link accounts**) · Net balance · Principal paid · Interest and fees (estimated) · **Next repayment's interest** (UX-21: `nextPeriodInterestCents`, hint "on dd/mm/yyyy, from the balance at dd/mm/yyyy" from `schedule.firstPaymentDate` and `balanceAsOf`) · Paid off (with the offset) · Total interest to come · Without the offset (payoff, interest) and Interest saved (only with an offset) · Imported "payments paid" (muted: "The workbook's figure: $X, principal only" when `paymentsPaidDerived`, else "The workbook's figure: $X, as entered in the workbook").
   - **Balance log:** `ColumnTable` As of · Balance · Payments · Repayments (the Estimate marker on a default figure) · Principal · Interest and fees · Note · Source · Actions (Edit, Delete; the last stored entry has no Delete). The start point (from the loan's start fields) is the first row, labelled "Loan start", with no actions (edit it in the loan form). A `repayments_below_principal` row carries a check badge "Check" (in the As of cell) linked to the visible foot note "The estimated repayments are below the principal repaid: enter the actual repayments for that period."; `balance_increased` → the note "Balance went up (a redraw or added costs)" in the same cell.
   - **Update balance** (a loan action, for one entry): As of, Balance, Repayments (optional; placeholder "Estimated X (N payments)", without the "$" the money field already shows (Fixer round 1), computed by the web from `paymentDatesBetween(paymentAnchorDate, frequency, the previous point's date, As of)` × the regular payment, UX-7; the same helper the engine uses, so the placeholder equals the saved estimate), Note. **Edit entry:** Balance, Repayments (empty → the estimate), Note.
   - **Loan form:** Property (`Select`), Name, Lender, Start date, Start balance, Interest rate (%), Interest compounds (`Select` Monthly, Fortnightly, Weekly, Daily, **plus the stored value when it is another one**, "4 times a year"), Repayment amount, Repayment frequency (`Select` Weekly, Fortnightly, Monthly), Note; create adds Current balance and As of. Changing the repayment amount or frequency shows "Changing the repayment re-estimates every entry without entered repayments. Enter the actual repayments on past entries to keep them." (SPEC-15; D76). **Delete** sits in the edit form (UX-17).
   - **Offsets form:** a checkbox per offset account (name and balance); with none: "Mark an account as an offset on the Cash page first" (a link).
   - Charts (UX-3): `ChartCard` "Loan balance" (one line), `ChartCard` "Repaid so far" (principal and interest and fees, stacked) and `ChartCard` "Payoff projection" (§5).
6. **`SectionBar` "Value over time"** (supporting; UX-18): `ChartCard` "Value and purchase price" and `ChartCard` "Loan to value"; foot note "Past points come from your recorded months; the last point is live." and, when offsets exist, "Past points are before offsets; the live point is net of your offsets." (UX-21).
7. **`SectionBar` "Settings for this page"** (reference): Count mortgage principal as savings, Offsets count toward the emergency fund (workbook keys; also on the Cash page).

### 6.6 Cash page changes
- **Account form:** an offset account shows "Linked to <loan> (change it on the Property page)" or "Not linked to a loan: link it on the Property page"; turning Offset off on a linked account shows "This also removes its link to <loan>". Turning Offset **on** for an account with balance history before the last recorded month shows (FEAS-12, §2.9) "Its balance leaves Total Cash now; until the next month is recorded, this month's savings read that as spending."
- **Savings Details card:** a line **Offsets** (`added.offsetsCents`) between Mortgage principal and Property deposit. The "Other assets, super and the mortgage use the imported figures until Stage 4" note and `STAGE4_NOTE` are removed (`staticUntilStage4` is always false).

### 6.7 Forms (shared rules; Stage 3 §6.8)
- Inline `Card` forms, one open at a time; focus the first field on open and return it on close; Save disabled while pristine or pending (`aria-busy`); API `VALIDATION_ERROR` issues mapped by path; `IMPORT_IN_PROGRESS` → `Callout do-not` "An import is running; try again shortly"; 409s and 422s → `Callout do-not` with the server message.
- **Workbook rows** (`origin = 'import'`) and **workbook settings**: `Callout important` "This came from the workbook. Saving (or deleting) it counts as an app edit: re-importing the workbook will then be blocked." Exceptions with the import-safe note ("Kept when you re-import") instead: the SG-fund switch alone (and the SG-fund select), SG statement months, and the five editable app-only settings.
- **New app rows:** while `hasAppData` is false, every create or update form that writes an import-owned row (an asset, a price update, a sale, a fund, a balance update, a contribution, an option note, a property, a valuation, a loan, a loan entry, an offset link) shows "Saving adds app data: re-importing the workbook will then be blocked." (not on SG statements or app-only settings).
- **One or the other, never both** (UX-19, the Stage 3 Fixer rule): a form that writes a workbook row shows the workbook callout only; otherwise, while `hasAppData` is false, it shows the new-app-data note. Web unit tests cover both and the absence of the pair.
- **Deletes** (UX-17): an entity (an asset, a fund, a property, a loan) is deleted from its Edit form with an inline confirm, disabled with its reason while the server would refuse (a fund with contributions, a property with loans; the 409 message still shows if it happens); log rows (price entries, balance entries, valuations, loan entries, sales, contributions) confirm in the row's Actions cell (Stage 2–3 pattern). Money fields use `MoneyField`; percentages `ratioFromPercentText`/`percentTextFromRatio`; unit prices, units, ounces and FX rates are decimal text fields (monospaced, right-aligned); dates `DateField` (max tomorrow where the schema says so).

### 6.8 Phone (375 px; STYLE_GUIDE §3, D31) and the 768–1199 px range
- One column; tiles stack; forms one field per row; buttons full width; **no page-level horizontal scroll**; tables scroll inside their containers with the first column sticky.
- Status-first column orders (every desktop column appears). **Badges move to the first cell on phone** (UX-4, D31; as the Stage 3 savings table does with Provisional and Baseline): each row's state markers (Assumed, Stale, Spot, Last known, No price yet, Estimate, Statement, Provisional, Baseline, Not updated, Check, Loan start) render under the name or date in the first cell; the desktop cells are unchanged. A phone test finds each marker inside the first cell.
  - assets: Item, Value, Gain, Price, Actions, Cost, Bought, Units, Unit cost, Gain %, Return / yr
  - price entries: As of, Price, Note, Source, Actions · sales: Date, Item, Realised gain, Proceeds, Units, Cost, Note, Actions
  - funds: Fund, Balance, As of, Actions, Receives SG, Source · fund history: As of, Balance, Gain, Change, Flows in, Transfer in, Note, Source, Actions
  - contributions: Date, Type, Pre-tax, Fund receives, Take-home cost, Fund, Toward the cap, Period, Note, Actions
  - SG months: Month, Source, Fund receives, Before tax, Fund, Cap year, Actions
  - super periods: Period, Gain, Value, Return, Change, Employer SG (to fund), Your contributions (to fund), Transfers in, Option note, Actions
  - valuations: As of, Value, Note, Source, Actions · loan log: As of, Balance, Interest and fees, Repayments, Principal, Payments, Note, Source, Actions
- **768–1199 px** (the Browser pane's width; the Stage 3 demo lesson): the wide tables use compact column grids so the first column keeps at least 200 px and no word breaks mid-word. The Integrator's e2e checks this at 800, 1024 and 1199 px on **every Stage 4 table whose first column holds a name or date** (assets with the synthetic URL-named item, sales, funds, fund history, contributions, SG months, super periods, valuations, loan log; UX-20).
- **1440 px** (UX-20, the Stage 3 review rule): the funds, fund history, SG months, sales, price entries, valuations, super periods and loan log tables fit the 1152 px content area without inner scroll; the assets and contributions tables (11 and 10 columns) may scroll inside their container with the first column sticky. The e2e asserts which.

### 6.9 States
- **Loading / error:** `Loading` "Loading other assets…" / "Loading super…" / "Loading property…", `LoadError` with Retry.
- **Empty:** no assets → "No other assets yet. Add one, or import the workbook on the Import page."; no funds → "No super funds yet."; no properties → "No properties yet."; a property without a loan → "No mortgage on this property."; no snapshots → the history sections say "History starts after the first recorded month (Stage 5 records months)."
- **Null figures:** "—" with the reason (held under 90 days, no purchase date and no recorded month, no cost, no purchase or live FX rate, not updated, no rate or payment, no marginal rate).
- **Stale:** manual prices past D days, a stale bullion spot or FX rate ("Spot 3 days old"), market off.
- **Estimate / assumed** (the §6.1 markers): imported contributions, SG months and default repayments (Estimate), undated items (Assumed).
- **After a mutation:** a `LiveRegion` announces "Asset saved", "Prices saved", "Sale recorded", "Balances saved", "Contribution saved", "Statement saved", "Values saved", "Loan saved", "Offsets linked", "Settings saved".

---

## 7. Roles, tasks and FILE OWNERSHIP

### 7.0 Rules (all agents; Stage 3 §7.0 carried over)
- **Ownership:** edit only files you own (§7.1). Need a change elsewhere? Report it; the coordinator routes it. Never work around a contract gap in another owner's file.
- **Frozen contracts:** §2.2, §3.1–3.4, §4 (endpoints, schemas, DTO fields, codes) and §4.6's read helper. Internal modules are free; changing frozen names, fields or signatures needs the coordinator's approval and a Scaffold note.
- **No installs** after the Scaffolder; a missing package → stop and report.
- **Stubs** the Scaffolder creates become the named owner's files; replace them in place.
- **Scoped runs** while others work (§1.4); keep your files compiling at every step.
- **Privacy:**
  - Never paste owner values (from the workbook, an owner import's API, `docs/private/`) into a tracked file, test, fixture, comment or doc. Run `pnpm guard:all` before you finish.
  - A guard hit on a value you believe is generic means **change your value**. Never edit `docs/private/guard-terms.txt`; report the hit.
  - **No snapshot files**; assert explicit fields.
  - Anything printed from an owner import (item descriptions, fund, lender or account names, notes, check ids, API bodies) stays in git-ignored `artifacts/` or `docs/private/`; reports give counts and template cell refs only.
  - **Golden tests** hold template cell addresses and rules only (§9).
  - **Yahoo:** tests mock `fetchImpl`; no test touches the network. Live probes (the Verifier's #12 only) use the owner's own scratch import or a scratch asset, never more than one refresh per run.
- **Coordinator pre-step** (before the Scaffolder): stop any running dev server (a `tsx watch` server on `data/` would hot-reload onto in-progress code and could apply the draft migration); back up `data/finance.db*` to a git-ignored `data/backups/pre-stage4-<date>/`; append the terms of `docs/private/stage-4-private.md` §8 to `docs/private/guard-terms.txt`; re-run `pnpm guard:all` (it must stay clean); **correct D71's wording in `docs/DECISIONS.md`** (SPEC-18: "the amount the fund receives for gains; the pre-tax amount toward the cap (D70)", not "for gains and the cap"); apply the owner's answers to the questions of the plan review before the Scaffolder starts (done 2026-09-26: every default accepted, D74–D78).

### 7.1 Ownership table (every new or changed Stage 4 file has exactly one owner)
| Owner | Files |
|---|---|
| **scaffolder** | **Schema:** `packages/schema/**` (enums, tables, `db/index.ts`, rows + parity, records (+ records fixtures), settings, `src/assets.ts`, `dto/assets.ts`, errors, the `dto/cashflow.ts` additive fields, fixtures (`assets.ts`, the `cashflow.ts` updates, coverage, `sampleDtos.ts`), `testing/{seed,dump}.ts`, index exports, schema tests). **Engine contract:** `packages/engine/src/types.ts`; `packages/engine/src/index.ts` (stubs + the `engine` value + `ASSETS_ENGINE_IMPLEMENTED`; → engine). **Migration:** `apps/server/migrations/**` (`0004_*` + meta). **Tests the migration or schema change breaks:** `apps/server/test/{migrations,app,db,backup,records-routes}.test.ts` (→ server-api after scaffolding), `packages/schema/test/**`. **Importer flag:** `packages/importer/src/testing/index.ts` (only `IMPORTER_STAGE4_IMPLEMENTED = false`; → importer). **Server stubs:** `apps/server/src/routes/{otherAssets,super,property}.ts` (501; → server-api), `apps/server/src/app.ts` (registrations; → server-api), `apps/server/src/records/index.ts` (the minimum for the new entities; → server-api), `apps/server/src/market/history.ts` (the frozen `readQuoteHistory` returning `{}`; → market-data). **Compile and expectation fixes the contract forces** (minimal edits only, each listed in the Scaffold notes; → the file's owner afterwards): `apps/server/test/investments/helpers.ts` (neutral fakes for the 6 new `EngineApi` members), `packages/engine/test/api.test.ts` (the member list), `packages/engine/test/savings.test.ts` (`offsetsCents: 0` in the whole-object `added` expectations; → engine), `packages/engine/src/savings.ts` (only `added.offsetsCents: 0` so the type holds; → engine), `apps/server/src/cashflow/cash.ts` (the two additive DTO fields: `offsetsCents` mapped, `linkedLoan: null`; → server-api), `apps/server/src/cashflow/constants.ts` (`CASH_PAGE_SETTING_KEYS` as the explicit list of its six keys, §3.3; → server-api), `apps/server/test/cashflow/cash-routes.test.ts` (the period-note kinds loop: `super_option` is no longer a 404; `other` still is; → server-api), `apps/server/test/cashflow/{income-budget-routes,pages}.test.ts` only if the key list still moves them (→ server-api), `apps/web/src/pages/cash/CashPage.test.tsx` (the Stage 4 note's expectation, gone with `staticUntilStage4: false`; → web), `apps/server/test/migrations.test.ts` (the Stage 0/1/2 upgrade tests' expected dumps gain the 0004 conversion; → server-api), and any other file the typecheck or `pnpm test` names for the same reason. **Web stubs:** `apps/web/src/router.tsx` typed routes, `apps/web/src/pages/{otherAssets,super,property}/*Page.tsx` (→ web). **e2e:** `e2e/ui-core.spec.ts` (only the short-page test's route `/super` → `/history`, FEAS-6: `/fire` is already listed; → Integrator). |
| **engine** | `packages/engine/**` except `src/types.ts`: `src/index.ts` after scaffolding, every module (new: `otherAssets.ts`, `super.ts`, `property.ts`, `amortise.ts`, `assetsSnapshot.ts`; `savings.ts` for §2.9), `test/**` incl. `test/golden/**` (new `assets.*`; the Stage 2–3 goldens unchanged) and `test/purity.test.ts`. |
| **server-api** | **Source (after scaffolding):** `apps/server/src/assets/**` (inputs, page builders, mutations, responses, constants), `src/routes/{otherAssets,super,property}.ts`, `src/app.ts`, `src/cashflow/{context,inputs,cash,constants,responses}.ts` (`responses.ts`: the settings slice of every named page, §3.3), `src/cashflow/mutations/{cash,common}.ts` (the offset-flag link removal; the note kinds and the `super_option` month rule, §4.5), `src/routes/cash.ts` (only if the period-note route needs it), `src/investments/load.ts` (the loader), `src/db/queries/domain.ts`, `src/records/index.ts`. **Post-scaffold owner of `packages/schema/**`** (DTO, fixture or seed fixes another agent reports; each needs the coordinator's OK and a Scaffold note). **Tests:** `apps/server/test/assets/**`, `test/golden/assets.golden.test.ts`, `test/golden/cashflow.golden.test.ts` (rule 12's narrowed interest condition, §9.3, and its gate line), `test/golden/investments.golden.test.ts` (**its gate line only**), `test/cashflow/**` and `test/investments/**` (where the live input or the class value changes an assertion, and the gate lines of `test/cashflow/integration.test.ts` and `test/investments/integration.test.ts`), `test/{migrations,app,db,backup,records-routes}.test.ts` (after the Scaffolder). **Pre-authorised gating (FEAS-1, the Stage 3 precedent):** the moment the finance context calls the new engine functions, server-api adds `&& ASSETS_ENGINE_IMPLEMENTED` to the gates of those four real-engine suites (a Scaffold note). **Docs:** `README.md` (the Stage 4 APIs, the D34 rules), `docs/ARCHITECTURE.md` (the assets engines, the series history). |
| **market-data** | **Source (after scaffolding):** `apps/server/src/market/{refresh,fxHistory,history}.ts`, `src/market/providers/{yahoo,fake}.ts` (`parseYahooCloses`, `createYahooFxClosesClient`, `createFakeFxClosesClient`, `fakeFxClose` only), `src/market/providers/types.ts` (only the `FxClosesClient` type), `src/market/service.ts` (only `buildProviders` for the FX-closes client, the job detail and `jobStatus`, §4.6). **Tests:** `apps/server/test/market/{fx-history,series-history,other-asset-fx}.test.ts`. Works against the frozen interfaces; never edits routes, `app.ts` or the page builders (report a gap instead). |
| **importer** | `packages/importer/**` except the Scaffolder's flag line: `src/{extract,model,writer,process,reconcile,layout}.ts`, `src/testing/**` (the synthetic workbook only through `mutate` in tests unless a fact must change; the flag after scaffolding), `test/**`; `apps/server/src/cli/import.ts` (**`ENTITY_LABELS` only**, FEAS-13). |
| **web** (phase A) | `apps/web/src/**` (router after scaffolding, `api/**`, `pages/{otherAssets,super,property,assets}/**`, `pages/cash/{AccountForm,SavingsSection}.tsx` and their tests, `app.css`), `apps/web/test/**`, additive `packages/ui` props with tests (each in a Scaffold note), drafts of `e2e/{assets.spec.ts,assets-states.spec.ts,assets-mutations.spec.ts,assets-support.ts}`. |
| **integrator** (phase B) | Takes over web's files and the e2e drafts, plus `e2e/{ui-core.spec.ts,records.spec.ts,import.setup.ts,support.ts,cashflow-support.ts}` and `playwright.config.ts` (the `assets-mutations` project). After engine, server-api, market-data and importer report done, their files pass to the Integrator for integration fixes only (each listed in its report). |
| coordinator | `PLAN.md` · `docs/HANDOFF.md` · `docs/DECISIONS.md` · `docs/STAGE_PROCESS.md` · `docs/stages/**` (implementers append only to "Scaffold notes") · `CLAUDE.md` · `docs/style/**` · `docs/private/**` · `reference/**` |

### 7.2 Scaffolder (alone; done-check before hand-over)
1. **Schema** per §3.2–3.3 and §3.6: enums, tables, `db/index.ts`, rows + parity, records (+ fixtures), settings (keys, categories, `EDITABLE_SETTING_KEYS`), `src/assets.ts`, `dto/assets.ts`, errors, the `dto/cashflow.ts` additive fields, fixtures (`assets.ts`, `cashflow.ts` updates, coverage), seed and dump. **Tests:** every request schema (bounds, strictness, `''` → null, unique ids, the bullion/manual/AUD refines, the date bound with an injected `now`, `isOtherAssetCurrency`), `paymentDatesBetween` (§3.2), fixture coverage, every fixture parsing where a schema exists and adding up (table totals = Σ rows; super periods: change − flows = gain), the seed's new rows, the statutory tables' shape, the settings-key tests of §3.2 (22 editable keys, the max-keys bound).
2. **Migration** `0004_stage4_assets` (§3.1): generate, check for no recreate, append the data statements, `git diff --exit-code` on `0000`–`0003`. Tests: a fresh DB reaches `COMMITTED_MIGRATION_COUNT` (5) with every table and column; **a 0003 database with data** (the Stage 3 approach: a migrated in-memory DB, drop the new tables and columns, stop at 0003, then insert **its own raw rows**: manual and bullion other assets with and without a price and as-of, two super funds (one with no `balance_as_of`), `voluntary_contribution` entries with and without an `entry_date` (a live-month one whose month end is after the workbook as-of), an `import_runs` row with a `workbook_as_of` (and a variant without one, falling back), migrated snapshots with zero and non-zero `super_contrib_cents` (and one whose derived entry already exists), a latest snapshot whose Q equals the funds' Σ and whose |AB| equals the property loans' Σ (entries dated at its run date) and a variant where neither does (entries at `balance_as_of`), properties with and without a valuation date, loans with a start before the last run, a start after it and no start, and a loan without a property; one `app` row of each; upgrade) converts exactly as §3.1 says (entries, dates, the denormalised `balance_as_of`, origins, sheet refs, no duplicate derived entries, no start entries) and `hasAppData` is unchanged; FK cascades and the unique keys of the new tables. The existing Stage 0/1/2 upgrade tests' expected dumps gain the 0004 conversion (FEAS-5).
3. **Engine skeleton:** `types.ts` complete (§2.2 incl. the additive Stage 3 changes); `index.ts` stubs, `engine` value, `ASSETS_ENGINE_IMPLEMENTED = false`; `amortise` may be real; the type-level test that `engine` satisfies `EngineApi`. The compile and expectation fixes of §7.1.
4. **Server stubs:** the three route files answer 501 `NOT_IMPLEMENTED` for every §4.2 route (`no-store`), registered in `app.ts` with the cash-flow options object; `market/history.ts` with the frozen `readQuoteHistory` returning `{}`; `records/index.ts` loads the new entities.
5. **Web stubs:** the three typed routes; each page renders `PageHeader` with its h1 and a `Callout note` "Arrives with the Stage 4 web work"; `e2e/ui-core.spec.ts` swaps `/super` for `/history` in the short-page test (the list becomes `['/fire', '/history']`; `/history` and `/settings` stay placeholders until Stage 5).
6. **Importer flag** line.
7. **Done-check** (all green): `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` (≥ the 2507 Stage 3 tests + new), `pnpm build`, `pnpm guard:all`; `PORT=3070 WEB_PORT=5170 DATA_DIR=artifacts/stage4/scaffolder/data pnpm e2e e2e/smoke.spec.ts e2e/ui-core.spec.ts` passes (delete the folder first); `/api/health` → `migrations: 5`; `DATA_DIR=artifacts/stage4/scaffolder/data pnpm seed:dev --yes` exits 0; ports free afterwards. Append "Scaffold notes" with every deviation.

### 7.3 engine
1. `otherAssets.ts` (§2.4): remaining units (legacy sold, sales, oversold), sold-out rows, every pricing and status branch (fresh and stale manual prices at the D boundary, spot fresh and stale, the fallback, unpriced), FX (a USD row, a `GBX` row, a missing live rate → `live_fx_missing` and a flow kept, a missing purchase rate → `purchase_fx_missing` and no flow, the two counts), gain and ratio from unrounded values, CAGR (a real date equal to the sheet's RRI for AUD; FX included for a foreign row; the assumed date; no date and no snapshots; `heldDays ≤ 0`), sales and realised gains, savings flows (purchases at the full bought units, sales negative, undated and FX-missing rows left out), totals as Σ rounded rows with the ratio from unrounded sums, `otherAssetsCostHeldAt` (≤ the date, the assumed date, sales before and after, unknown cost left out), the chart (snapshots plus the live point, groups).
2. `super.ts` (§2.5): balances at dates, contributions of every kind with and without a marginal rate and under both imported readings, SG months (estimate at the statutory rate of each FY and at a set employer rate, statement, none before the job start or without a salary), SG spread by month days across windows, periods (baseline, closed, a not-updated month merged into the next, the provisional period updated, not updated by equality and by a stale fund), `changeCents` − `gainFlows` = gain on every valuation period, T and Modified Dietz, transfers in (an app-created fund's opening balance: adding a fund leaves the gain unchanged; a rollover: the old fund's closing 0 and the new fund's balance give no gain), the annualised chain (under and over a year; fewer than 90 days), per-fund entry gains (the SG fund, unassigned contributions, a transfer), the cap years (SG counted when received: a quarter on its due date, the FY2026–27 transition quarter, Payday Super months by days; statutory caps and an override for this FY, for the FY before and for neither; a complete FY; the projection; `under`/`near`/`over` at 0.9; the member sums and `estimateCount`), the snapshot figures and flags, the chart.
3. `amortise.ts` and `property.ts` (§2.6, §2.7): the periodic ratio for every frequency pair (equal frequencies give `r/m` exactly), a zero rate, an offset below, equal to and above the balance, payment below interest, the 100-year cap, the anchored grid (the first payment is the first grid date after the balance date, month-end clamping from the anchor, fortnightly, weekly), the balance log (the start point from the start fields, none when the start is not before the first entry, typed and default repayments, both flags; a changed regular payment re-estimates default entries and leaves typed ones), cumulative figures, `startBalance` null, property CAGR, equity and LVR with and without offsets, totals with a loan without a property left out, snapshot figures (0s with no property), savings live parts (nulls), the chart; **sheet mode** reproduces a hand-computed NPER example with a whole-cent payment (`payments = ⌈NPER⌉` from that payment, the first interest = balance × r ÷ m).
4. `assetsSnapshot.ts` (§2.8) and the savings changes (§2.9): the column mapping; Δ offsets (both non-null, one null, none; the latest snapshot only), sales as negative flows; the Stage 3 savings figures unchanged (the whole-object `added` expectations carry `offsetsCents: 0`).
5. **Goldens** (§9): `test/golden/assets.golden.test.ts` (+ `assetsAdapter.ts`, `assetsFormulas.ts` for the sheet-faithful helpers) with `describeWithLocalWorkbook`, printing counts per area and reason only; the Stage 2–3 goldens unchanged.
6. Purity: the new modules pass `test/purity.test.ts` and ESLint unchanged.
7. Set `ASSETS_ENGINE_IMPLEMENTED = true` only after the full unit suite (goldens included) passes.

### 7.4 server-api
1. **Context and inputs** (§4.5) with unit tests on a fake engine: each input row (manual and bullion pricing from the series, the fallback, FX rates incl. USD from AUDUSD and GBX, the assumed date, contributions dated by `entry_date` or the period's first day, offsets only for linked accounts still flagged Offset, the latest snapshot's offset sum from balance entries and null for the others, the live savings input from the engine results, the other-assets class value, the cap override with its FY, `sgRatio` null while unset).
2. **Page builders** for `/api/other-assets`, `/api/super`, `/api/property`; DTO mapping tests field by field against hand-built engine results; the type-level assignability test (§4.4); `staticUntilStage4` false and the Cash page's additive fields.
3. **Mutations** (§4.5, §3.4) for every endpoint: origin rules (the SG-fund exception; no-op saves; echoed FX rates with and without a changed currency or date), denormalised copies after entry saves and deletes, the marker keyed on `sheet_ref`, the 409s and the 422, the import lock, the FX notify call, offset links (moving an account, removal when the Offset flag goes off), the note kinds (a saved `super_option` note is returned, not null) and the `super_option` month rule, a fund's opening transfer and rollover, the archive rule, balance entries' transfer in (omitted keeps, null clears), the cap FY written with the cap, the settings slice of every named page and a PATCH of all 22 editable keys, a loan create writing one entry.
4. **`hasAppData`** tests: an SG override, an app-only setting and the series history → false; an SG-fund-only edit → false; every import-owned entity (incl. a sale and an offset link) → true.
5. **Integration tests** gated by `ASSETS_ENGINE_IMPLEMENTED`: the seed (and the synthetic workbook when `IMPORTER_STAGE4_IMPLEMENTED`) builds all three pages and the Cash page; a create/update/delete round trip per entity leaves `dumpDomainTables` identical except `app_meta`; the provisional savings period moves by exactly a new contribution's net-pay cost and a new loan entry's principal.
6. **Server golden** (§9.4), gated by `ASSETS_ENGINE_IMPLEMENTED && IMPORTER_STAGE4_IMPLEMENTED` and `describeWithLocalWorkbook`, `{ timeout: 120_000 }`; the Stage 3 server golden updated per §9.3 rule 12 and still green.
7. **Gating** (SPEC-1, FEAS-1): the four Stage 2–3 real-engine suites gain `&& ASSETS_ENGINE_IMPLEMENTED` (§7.1). Every **ungated** Stage 2–3 server suite (the fake-engine `test/cashflow/**`, `test/investments/**` and the rest) stays green at server-api's done-check; the four gated ones and the Stage 4 gated suites must have **run and passed** once the engine flag is true (the Integrator confirms, §7.8; the Verifier, §10 #2).
8. **Docs:** README and `docs/ARCHITECTURE.md` (generic only).
9. **Done means the gated suites ran**: report "blocked on engine/importer" with everything else green if they have not landed.

### 7.5 market-data (tests only, no server needed)
1. `parseYahooCloses` (pure): local dates in the exchange time zone and the `gmtoffset` fallback, null closes, the last close on or before a date across a weekend and a holiday, `chart.error`, an empty result.
2. The price job additions (§4.6): other-asset currencies join the FX list (GBX → GBP; AUD and USD not fetched as cross rates); the FX-closes clients (Yahoo and fake; `buildProviders` builds them; a `Providers` literal without the member skips the backfill); the backfill (target selection least recently attempted first and the per-run cap, one request per (currency, date), the once-a-day retry with `skipped` counts, the shared cool-down and a 429 stopping the backfill, the run deadline, the identity check when the row changed mid-run, `origin` untouched, `user` rates never overwritten, GBX ÷ 100, the closes written to the history); the series history (one row per series per day, replaced later that day); fake mode (`fakeFxClose`, no network); off mode (nothing runs); the job detail counts and the `partial` status. All with a mocked `fetchImpl` and a fake clock.
3. `readQuoteHistory` (replace the stub in place; the frozen signature): date order, the from-date bound, unknown series → empty lists.
4. Report done with `pnpm vitest run --project server test/market`, typecheck, lint and `pnpm guard:all`.

### 7.6 importer
1. §3.5 changes 1–5, each with tests on the synthetic workbook (through `mutate` for cases it lacks: a USD row with cached `N`, `M` and `O`, a History `R` on frozen rows, two frozen rows in one month (the existing "faulty" variant), `L45` "Yes" with a Retirement-tagged buy in a window, a live total equal to the last frozen row's and one that differs, a loan with no start date): price entries for manual rows only; the FX rate at purchase from `N ÷ (M × J)`; fund balance entries and their date rule (`C51` or the as-of); History-derived contributions (the kept snapshots with a non-zero derived R only; a duplicate month yields one; the D37 exclusion and its info line; dates, periods, sheet refs); the B16 entry's date rule; the SG fund carried by a unique name, by sheet ref and name when names repeat, and the info line when it cannot be; valuations and loan entries (one per loan, its date rule, no start entries); the reconciliation's new and re-pointed checks (the non-AUD value, gain and cost checks); the CLI labels.
2. **Migration equivalence:** importing a workbook into a 0003 database and upgrading gives the same Stage 4 rows (ids aside) as importing it into a 0004 database (a test comparing the two dumps' converted tables without ids), including the synthetic "faulty" variant with two frozen rows in one month (SPEC-12, FEAS-7) and a variant whose live totals equal the last frozen row's (SPEC-16). The D37 exclusion is importer-only (the migration cannot see the trades' windows as the sheet did): the equivalence test uses workbooks without `L45` "Yes", and a note in the report says so.
3. The idempotency contract still holds (two imports → identical dumps, ids included).
4. The importer golden (`test/golden.test.ts`) still reconciles the owner workbook with zero unexplained lines; update only the counts it prints.
5. Set `IMPORTER_STAGE4_IMPLEMENTED = true` after the suite passes; report counts only.

### 7.7 web (phase A — parallel; no running API needed)
1. API layer (§6.2), display helpers (`pages/assets/display.ts`: frequency and compounding words, the payoff text, the §6.1 status markers, `formatRate`, the FX line, the short name of a URL-named item, cap status words), the `Meter` cap props in `packages/ui` (§6.1, with tests and a Scaffold note), the shared entry-log editors (§6.3–§6.5).
2. The three pages (§6.3–§6.5), the Cash page changes (§6.6), forms (§6.7), phone orders and the 768–1199 px grids (§6.8), states (§6.9).
3. **Unit tests** with mocked fetch on `@joinr/schema/fixtures` (+ supplementary fixtures): every fixture state renders; totals equal the Σ of visible rows; update-prices / update-balances / update-values modes (only changed rows sent, the shared date and note, the older-than-latest note, the bullion rows read-only); the asset form's refines (bullion fields, FX only for foreign currencies); the sale form and the 422; the SG switch's import-safe note vs the workbook callout; the contribution form's labels per type; SG statements; the cap meter texts and callouts; the periods table badges; option notes by month; the loan log with estimated and entered repayments and both check badges; the offsets form (none available, moving an account); the D66 and unlinked-offset callouts; the negative-figure colours (§6.1); "—" rules (under 90 days, not updated, no marginal rate); phone column orders and the markers in the first cell via `matchMedia`; every form's pristine/pending Save and error mapping; the one-or-the-other callout rule (§6.7); the Still current box and Mark current (a stale row saved unchanged at a new as-of clears Stale); the URL-named item's short name and single link; the FX field blanked on a currency or date change and GBX ÷ 100; the Meter's cap texts, tick and tones; the super periods adding up (change − flows = gain) and the merged-row line; the SG-fund select in the callout and the section header; the loan placeholder from `paymentDatesBetween`; the chart colours in slot order; the focus move and announcement of the history actions; the Cash page's linked-loan line, the Offset-on note and the Offsets detail line.
4. `RootLayout.test.tsx` and `router.test.tsx` updates if needed (the placeholder test moves to `/history`).
5. **Draft** the e2e files (§7.8); report "phase A done" with typecheck, lint and unit results.

### 7.8 Integrator (phase B — starts when engine, server-api, market-data and importer report done)
1. Run the stack on 5185/3185 (fresh `artifacts/stage4/integrator/data`, `MARKET_DATA_MODE=fake`, synthetic import); fix integration defects in web files (other owners' files for integration fixes only, listed).
2. **`e2e/assets-support.ts`:** `E2E_NOTE` reuse; `cleanupAssetsRows(request)` removes rows whose note or name starts with `E2E_NOTE` (assets, sales, price entries, funds, contributions, balance entries, SG statements, properties, valuations, loans, loan entries) and unlinks offsets it made; `mockAssetsPage(page, route, fixture)` like `mockCashflowPage`. `e2e/import.setup.ts` calls it before the import.
3. **`e2e/assets.spec.ts`** (desktop + phone, read-only): each page's h1, KPI tiles, the main table rows against the API (captions and counts), charts render (`svg` or the empty message), no page scroll, no console errors, screenshots; **the 768–1199 px check** (desktop project): at 800, 1024 and 1199 px the first column of every table §6.8 lists is at least 200 px wide and no word splits (the Stage 3 demo test's method; the synthetic URL-named item included); **the 1440 px check**: the tables §6.8 says must fit have no inner horizontal scroll.
4. **`e2e/assets-states.spec.ts`** (both projects, `mockAssetsPage`): screenshots at 1440 and 375 of every fixture state of §3.6; asserts the h1, no console errors and no page scroll.
5. **`e2e/assets-mutations.spec.ts`** in a new project **`assets-mutations`** (desktop viewport, `testMatch: /assets-mutations\.spec\.ts/`, `dependencies: ['cashflow-mutations']`); `desktop` and `phone` add it to `testIgnore`. Every row carries `E2E_NOTE`:
   1. Other assets: add a USD item with a purchase date and no rate → after `POST /api/prices/refresh` (fake) its FX at purchase is filled (`purchaseFxSource 'market'`) and its cost appears; update its price → the value changes; sell part → a realised gain and `remainingUnits` drop; a sale past the remaining units → the 422 message; delete it.
   2. Super: set the SG fund on an imported fund → `GET /api/import/runs` → `hasAppData === false`; restore it. Add an SG statement for this month → `hasAppData` still false; remove it. Add a salary-sacrifice contribution dated today → the Cash page's provisional period's super part moves by its net-pay cost; delete it.
   3. Property: add a loan balance entry dated today → a new log row with estimated repayments and the payoff changes; edit its repayments → interest and fees follow; delete it. Create an offset account (Cash), link it on the Property page → the net balance, LVR and payoff move; unlink and delete the account.
   4. `afterAll` → cleanup; afterwards `hasAppData === false`. The spec never edits a workbook setting; every row it creates is an app row it deletes (no marker).
6. `e2e/ui-core.spec.ts` (the Scaffolder's swap stays) and `e2e/records.spec.ts` (27 record pages: `test.setTimeout(120_000)`).
7. Screenshots under `artifacts/screenshots/{desktop,phone}/assets-*.png`. Run the full e2e suite on your ports (the `mutations`, `cashflow-mutations` and `assets-mutations` projects must run and pass; skipped counts as failed), then `pnpm test` once more and confirm the four Stage 2–3 real-engine suites gated in §7.4 step 7 **ran** (not skipped); write the final report.

### 7.9 Reviewers (report findings; do not edit)
- **spec-correctness:** the engines vs spec 04 §1–§3 and this plan; D66–D73 applied; every §11 fix present and nothing else changed; run the goldens and check every §9.2 area is compared or skipped only for a §9.3 reason, with the counts in `docs/private/stage-4-private.md` §3; check the owner-import expectations of the private §5 through the API on `artifacts/stage4/review-spec/data` (`MARKET_DATA_MODE=off`); the Stage 3 savings figures unchanged on the owner import; no owner values in tracked files.
- **style-ux:** screenshots at 1440, 1024 and 375 of the three pages, every form, every fixture state and the Cash page changes; STYLE_GUIDE §1–§10 and D6, D7, D17–D20, D31, D33 (one teal figure per page, status never colour-only, red only for losses and a negative cash balance, §8 formats incl. `FY2026–27`, rates and frequencies in words, U+2212, no page scroll at 375, status-first tables, chart slots, unstacked cost and value).
- **code-quality/security:** validation at every write boundary (decimals, currencies, URLs as plain text links with `rel="noopener noreferrer"`, never rendered as HTML); error leakage; `IMMEDIATE` transactions and rollback; denormalised copies; the D34 marker, the SG-fund exception and the overlay semantics; the migration's data statements and the no-recreate rule; the Yahoo FX backfill (timeouts, abort, the shared cool-down, the run deadline, the identity check, no URL or body in errors); decimal use and non-integer powers; engine purity; test isolation (no network, temp DBs, no snapshot files); gating flags never faked. A **scratch numeric scan** (`artifacts/stage4/review-code/`, found/not found per file) of the tracked diff against every number with ≥ 4 significant digits in `docs/private/stage-4-private.md`; leave it for the Verifier.

### 7.10 Fixer and Verifier
- **Fixer:** applies the verified findings across owners; contract changes only with the coordinator's approval (Scaffold note); re-runs the affected checks.
- **Verifier:** runs §10 on 5195/3195 with per-item `DATA_DIR`s under `artifacts/stage4/verifier/` (never `data/`); reports pass or fail with evidence; never commits; no owner values in tracked files.

---

## 8. Ports & environment
**No new environment variables.** `PRICE_REFRESH_MINUTES=0` keeps the price job's timer off (the FX backfill and series history run inside it; the refresh route still works). Playwright keeps `MARKET_DATA_MODE=fake`, `PRICE_REFRESH_MINUTES=0`, `IMPORT_CORRECTIONS_FILE=none`.

| Agent | WEB_PORT | PORT | DATA_DIR |
|---|---|---|---|
| default / owner / `.claude/launch.json` | 5173 | 3001 | `data` (never used by agents) |
| Scaffolder | 5170 | 3070 | `artifacts/stage4/scaffolder/data` |
| engine, market-data, importer | — (tests only; the importer may run the CLI into `artifacts/stage4/importer/data`) | — | — |
| server-api | 5183 | 3183 | `artifacts/stage4/server-api/data` |
| web (phase A) | 5184 | 3184 | `artifacts/stage4/web/data` |
| Integrator | 5185 | 3185 | `artifacts/stage4/integrator/data` |
| Reviewers spec / style / code | 5191 / 5192 / 5193 | 3191 / 3192 / 3193 | `artifacts/stage4/review-{spec,style,code}/data` |
| Fixer | 5194 | 3194 | `artifacts/stage4/fixer/data` |
| Verifier | 5195 | 3195 | `artifacts/stage4/verifier/{e2e,owner,live,prod}` |

- **Dev-server lessons (HANDOFF):** stop the owner's `pnpm dev` before agent work (a `tsx watch` server on `data/` hot-reloads onto in-progress code and can apply a draft migration); under the Claude preview the server gets `PORT=5173` and listens on 127.0.0.1:5173 beside Vite on ::1:5173, with a cold start of up to ~30 s after Vite is ready; confirm ports are free before and after; servers on other ports may belong to other projects on this PC (check the command line before stopping one); e2e can fail with `net::ERR_NETWORK_CHANGED` when VPN or Tailscale adapters change (re-run). **Run every command from the repo root** (a relative `DATA_DIR` resolves against it).
- Git Bash: `PORT=3185 WEB_PORT=5185 DATA_DIR=artifacts/stage4/integrator/data MARKET_DATA_MODE=fake pnpm dev` (set `MSYS_NO_PATHCONV=1` when an environment value is a path like `/super`). PowerShell: `$env:PORT='3185'; $env:WEB_PORT='5185'; $env:DATA_DIR='artifacts/stage4/integrator/data'; $env:MARKET_DATA_MODE='fake'; pnpm dev`.
- Owner import into a scratch dir: `DATA_DIR=artifacts/stage4/<role>/data pnpm import:workbook --yes`.
- The Browser pane is about 800–1024 px wide; check that range as well as 1440 and 375 px. A custom select needs a real click after `form_input` before React sees the value.
- Unit tests use OS temp dirs or `:memory:`; never `data/`.

---

## 9. Golden values & tests (read at runtime; nothing committed)

### 9.1 The sheet-faithful adapter (`packages/engine/test/golden/assetsAdapter.ts`)
It reads the local workbook inside `describeWithLocalWorkbook` and builds engine inputs **the way the sheet computed them** (no corrections file; the Stage 3 adapter's History reader is reused).
- **As-of** = `Net Worth!E52` (every TODAY()-dependent cell is compared at this date); **last run** = `Net Worth!C51`; **snapshots** = History rows from 3 with a date in `A`: frozen rows (no formula in `B`) with their `Q`, `R`, `X`, `Y`, `AB`, `AC`, `AD`, `AJ`, `AK` in cents; the live row (formulas) separately.
- **Charts** (SPEC-3): every compute function whose chart the goldens read gets `chart: { unit: 'monthly', count: <snapshots + 1> }`, so no snapshot's point is cut by the default 12 groups.
- **Entry dates:** fund entries and the loans' current entries follow the importer's rule (§3.5 items 2 and 4: `C51` when the live total equals the last frozen row's, else `E52`); none of the compared cells depends on it.
- **Other assets:** rows 3 → 500 with a non-blank `F`: `G` date, `H` units, `I` currency (blank → AUD), `J` unit cost, `K` price, `|L|` legacy sold units. A row whose `K` follows the Stage 1 bullion link is `bullion` (metal from the feed, `ozPerUnit '1'`, `spot` = { `K`, `E52`, fresh }, fallback `K`); every other row is `manual` with `K` as of `E52`. AUD rows need no rate; a non-AUD row's purchase rate is `N ÷ (M × J)` and its live rate `O ÷ (M × K)` (the sheet's own GOOGLEFINANCE results). `assumedDate` = the earliest History date; `stalePriceDays` = 90.
- **Super:** funds `A2:A7` with `B` balances as one entry each (dated as above); contributions: one `voluntary_contribution` per imported snapshot with a non-zero `R` (the one-per-month rule; the D37 exclusion of rule 14; dated at its run date) plus `B16` dated at `min(month end of EDATE(C51, 1), E52)` (the importer's rules, §3.5); salary = SheetOptions **ID 4**, job start **ID 9**, marginal rate **ID 26** (by the column-P ID lookup; never IDs 1 and 29; never printed); the SG and tax defaults; `importedContributionType 'salary_sacrifice'`; no statements.
- **Property:** slots D…O meeting the Stage 1 import predicate: `16` purchase date, `17` primary residence, `18` purchase, `19` value (one valuation at `E52`), `20` net rent; a loan when `28` or `29` ≠ 0: `24` start date, `25` compounding, `26` rate, `27` payment (`monthly`), `|28|` start balance (the engine's start point, §2.6), one stored entry = the current `|29|` (dated as above); no offsets.
- **Sheet mode** (for `X32` and `X35`; SPEC-4): a copy of each loan with `paymentFrequency` = the compounding frequency (only 12, 26 or 52) and `paymentCents` = `27` × 12 ÷ frequency × 100 rounded half away from zero; the `⌈NPER⌉` helper uses that same whole-cent payment.
- **Golden-only helpers** (`assetsFormulas.ts`): the sheet's `RRI`, `NPER`, `CUMIPMT`, `EDATE` and `Z` (`<`) formulas over the sheet's own cells, used to validate the adapter and for the recomputed expectations of §9.3; the cost line with `≤` and the D73 date for the recomputed checks.

### 9.2 Cells compared (template references; each read at runtime)
| Area | Cells | Engine output |
|---|---|---|
| **Other Assets rows** | per data row `M`, `N`, `O`, `P`, `Q` (rule 15); `R` (rules 1, 14) | `computeOtherAssets` `assets[]`: `remainingUnits`, `costCents`, `valueCents`, `gainCents`, `gainRatio`, `cagrRatio` |
| **Other Assets totals** | `D3`, `D4`, `D5` | `totals.valueCents`, `gainCents`, `gainRatio` |
| **Other Assets history** | `Y:AC` rows from 4 (rules 3–5) | `otherAssetsCostHeldAt`; the `chart` points (value, gain, gain %) |
| **Super** | `B12` (rule 16), `B16`; `B11`, `B19` (rule 6); `E:J` per History row (rules 2, 6, 7, 16) | `computeSuper`: `totalCents`, `snapshot.superContribCents`, `periods[]` |
| **Property** | `F6`–`F11` (`F9` by rule 15, `F11` by rule 6), `F12` (rule 8); `Net Worth!C21` (SPEC-6: compared with `−totals.startBalanceCents`; `D21` and `E21` are asserted equal to `F11` and `F10` as formula aliases, not counted); per property `21`, `22` (rule 15), `23` (rule 9), `31` (rule 6), `32` (rule 10), `33` (rule 9), `34`, `35` (rule 10) | `computeProperty` `totals`, `properties[]`, `loans[]`; `amortise` in sheet mode |
| **Property history** | `Z:AF` rows from 5 (rules 2, 6) | the `chart` points (date, value, purchase, LVR, balance, interest and fees, principal) |
| **History live row** | `Q`, `R`, `S`, `T`, `X`, `Y`, `Z`, `AA`, `AB`, `AC`, `AD`, `AE`, `AJ`, `AK` (rules 2, 6) | `assetsSnapshotColumns` |
| **Cash!L parts** | per window: the dated other-asset purchases (rule 11) | `otherAssets.savingsFlows` summed per window |
| **Stage 2–3 goldens** | unchanged (the Stage 3 server golden per rule 12) | — |

### 9.3 Cells the sheet itself broke, and definitions that differ: rules detected at runtime (no row numbers hard-coded)
1. **Other Assets `R` of a row with a blank `G`:** the sheet annualises over `TODAY() − 0` (about 126 years), so the cached value is meaningless and is not compared; the engine's CAGR is compared with the helper's recomputation from the assumed date (D73) instead, counted `recomputed` (reason `no_purchase_date`).
2. **Live rows:** the History live row's date (`EOMONTH`) is not the engine's provisional run date (`E52`): `Super!E` and `Property!Z` of that row are skipped (`live_window`); its values are compared with the live figures.
3. **Other Assets `Z`** is compared with `otherAssetsCostHeldAt` called with the **dated** assets only (as the sheet), except at a snapshot date equal to a purchase date, where the expectation is recomputed with `≤` (§11 fix 13; `boundary_purchase`, `recomputed`). The call with every asset (D73) is compared with the helper's recomputation at every snapshot date (`assumed_date`, `recomputed`) whenever an undated asset exists.
4. **The hidden history's current-month row** (the row whose date is the live History row's) is blank in the sheet (the chart's zero, §11 fix 14): its `Z`, `AA`, `AB`, `AC` are skipped (`current_month_blank`); the engine's live chart point is compared with `D3`/`D4` instead (already counted there).
5. **`AC` of the first history row** holds no formula: `never`.
6. **Decision differences:** `Super!B11`, `B19` and History `S`, `T` (the reported gain and its SLOPE vs the derived gain and the chained return, D69), `Property!X31` and the live History `AC` (interest: always 0 under a principal-only row 30, derived under D66) are skipped (`defined_by_decision`). **`F11`** (and the live `AD`) is compared with `principalPaidCents` when every used slot's row-30 cell is a formula referencing only rows 28 and 29 of its own column (principal only); otherwise (typed payments, or the template default adding offsets) it is skipped (`defined_by_decision`, D66/D67). Which case a workbook has is detected at runtime (the private §3 says which).
7. **Super `E:J`:** `E` (dates), `G` (R per period = the period's `memberNetPayCents` from the History-derived entries; the first row's by rule 11), `H` (Q) are compared on the frozen rows; the live row's `G` = `B16` and `H` = `B12`; `I` and `J` by rule 6.
8. **`Property!F12`** is negative in the sheet: when it is < 0, `−F12` is compared with `totals.lvrRatio` (`negative_lvr`, `recomputed`, §11 fix 5). In the Property history block, a sheet `AC` (LVR) of 0 on a row whose value `AA` is 0 (the IFERROR) matches the engine's null LVR (counted as compared).
9. **`X23`** (simple annualisation) and **`X33`** (CUMIPMT over whole years with the implied payment) are skipped (`fixed_definition`, §11 fixes 8 and 3); the helper recomputes both to validate the adapter (not counted).
10. **`X32` and `X35` through sheet mode:** `X32` is compared with the sheet-mode `firstPeriodInterestCents`; `X35` is skipped (`fixed_definition`, §11 fix 2), and in its place the sheet-mode `payments` is compared with `⌈NPER(X26/X25, −P, |X29|)⌉`, where `P` is the whole-cent payment of §9.1 (counted as compared, "X35 (NPER)"). A compounding frequency other than 12, 26 or 52 skips both (`sheet_mode_unavailable`).
11. **Cash!L parts:** per closed window (rows from 4) and the live window, the engine's other-asset flows vs Σ `N` by `G` in `(prev, this]`; row 3 (the first) is skipped (`first_period`); the live window is compared only when nothing is dated in `(E52, EOMONTH(E52)]`, else `live_window`. The super contributions per window are the Super area's `G` (rule 7), so they are not counted twice; the mortgage principal and the property deposit come from the stored History columns in closed periods and from the live row (the seam area) in the provisional one. **Super `G` of the first History row** (the baseline carries no flows) is skipped (`first_period`).
12. **The Stage 3 server golden:** rule 2's server-only condition ("skip the provisional period when the live History `AC` is non-zero") **narrows** (SPEC-5): the provisional principal paid is now start − current (D66), which equals History `AD = |F11 − |AC||` whenever the Σ of the used slots' row-31 cells is ≥ 0 (the template default and a principal-only row 30 both are); the provisional period is skipped (`defined_by_decision`) only when that Σ is negative (typed payments below the principal repaid). Nothing else in the Stage 3 goldens changes; they keep passing.
13. Every skip and recompute is counted per reason; each golden test prints `compared: n · skipped: {live_window, current_month_blank, never, defined_by_decision, fixed_definition, first_period, sheet_mode_unavailable, unpriced} · recomputed: n (by reason: no_purchase_date, boundary_purchase, assumed_date, negative_lvr, fx_included, retirement_tagged, unpriced)` per area. The spec reviewer checks the counts against the private §3.
14. **Other Assets `R` of a dated non-AUD row** (SPEC-5): the sheet's `RRI` compounds the native prices (`J` → `K`), the engine includes FX (§11 fix 12): the engine's CAGR is compared with the helper's `(O ÷ N)^(365.25 ÷ (E52 − G)) − 1` from the sheet's own AUD cells (`fx_included`, `recomputed`).
15. **Zero denominators** (SPEC-5): where the engine's denominator is 0 it returns null; the sheet shows an error (`Q` = `P/N` with `N` = 0 has no IFERROR), `IFERROR` 0 (`X22`, `F9`) or "-" (`F12` with `F7` = 0). Each of these matches the engine's null and is counted as compared (as rule 8 already does for the history LVR).
16. **D37, retirement-tagged holdings** (SPEC-5): when any of `Super!B8:B10` ≠ 0, `B12` (and the live `H`/`Q`) is compared with Σ `B2:B7` (`retirement_tagged`, `recomputed`); when `SheetOptions!L45` is "Yes" and a window holds buys of Retirement-tagged holdings, that row's `G`/`R` is compared with `R` less those buys (the importer's rule, §3.5 item 2; `retirement_tagged`, `recomputed`).
17. **`unpriced`: a hand-priced row with a blank `K`** (§11 fix 25; Fixer round 1): a manual (non-bullion) row whose `K` is blank is unpriced in the app ("No price yet"; the importer writes no price entry), while the sheet values it at `M × K` = 0 (`P` = −`N`, a 100 % loss in `D4` and `D5`). Its `valueCents`, `gainCents`, `gainRatio` and `cagrRatio` are expected null (counted skipped `unpriced`); `costCents` is still compared with `N`. `D4` and `D5` are compared with the sheet's totals recomputed without those rows (Σ `P` and Σ `P` ÷ Σ `N` over the other valued rows; `unpriced`, `recomputed`); `D3` is unchanged (the sheet's `O` is 0 there). Server golden only: the engine golden's sheet-faithful adapter keeps the sheet's 0 (§9.1).

### 9.4 Server golden (`apps/server/test/golden/assets.golden.test.ts`)
- Setup: a temp DB; `importWorkbook` of the local workbook with **corrections off**; `buildApp` with market `off` and `now` = `E52` at 12:00 local.
- Via `app.inject`:
  - `GET /api/other-assets`: per asset (matched by `sheetRef`) `costCents`, `valueCents`, `gainCents`, `gainRatio` (`N`, `O`, `P`, `Q`) and, for dated AUD rows, `cagrRatio` (`R`); `totals` (`D3`, `D4`, `D5`); `assumedDate` = the earliest History date. Bullion rows use their fallback (market off), which is the cached `K`, so they value as the sheet. A hand-priced row with a blank `K` follows §9.3 rule 17.
  - `GET /api/super`: `totalCents` = `B12`; the provisional period's `flows.memberNetPayCents` = `B16`; every closed period's `valueCents` = History `Q`; the contributions list holds the History-derived entries (count, Σ = Σ `R` of the imported snapshots, rule 16 applied).
  - `GET /api/property`: `totals` `F6`, `F7`, `F8`, `F9`, `mortgageCents` = `|F10|`, `principalPaidCents` = `F11` (rule 6), `lvrRatio` = `−F12` (rule 8), `startBalanceCents` = `|Net Worth!C21|`; per property `X21`, `X22`, `X34`; per loan `imported.paymentsPaidCents` = `|X30|`.
  - `GET /api/cash`: the provisional period's `added.superCents` = `B16`, its mortgage principal = the live `AD − AD_prev`, `added.otherAssetsCents` as the Stage 3 golden, `added.offsetsCents` 0; every closed period as in the Stage 3 golden.
- Print counts only.

### 9.5 Tolerances
Cached formula results keep 10 significant digits; every comparison allows `max(listed, 1e-9 × |sheet value|)`.
| Quantity | Tolerance |
|---|---|
| Money per row, period or KPI (cents vs the sheet × 100, half away from zero) | ≤ 1 cent |
| A total that is the Σ of n once-rounded rows (`D3`, `F6`–`F8`, the live History `AJ`, `X`, `Y`, `AA` that repeat them, and a window's other-asset flows in the Cash!L parts, n = the flows in the window) | ≤ max(1, ⌈n/2⌉) cents (a Σ of rounded rows can drift by a few cents) |
| A total of n rows' gains, each the difference of two rounded figures (`D4`, the live `AK`, the chart's live gain) | ≤ max(1, n) cents (SPEC-7: each row's gain carries two roundings) |
| Ratios the engine derives from stored History cents (the Other Assets history `AC`, the Property history `AC`) | `max(1e-9, 1e-9 × |v|)` against the ratio recomputed from the sheet's `AA`, `AB` (Property: `AD`, `AA`) rounded to cents first; the cached ratio itself can differ by about 1e-5 relative, because the stored values are cents |
| Ratios (gain %, CAGR, LVR, T, returns) from unrounded decimals | `max(1e-9, 1e-9 × |v|)` |
| Sheet-mode payments | exact |
| Dates, texts, months, counts, statuses | exact |

---

## 10. Acceptance tests (the Verifier runs every item)
**Run order and isolation:** never `data/`; confirm 5195/3195 are free and delete each item's `DATA_DIR` first; stop servers between groups. Order: **1–5 → 6 (e2e) → 7–11 (owner copy) → 12 (live) → 13 (prod) → 14–16.**

| # | Check | How |
|---|---|---|
| 1 | Install and static checks | `pnpm install` (no prompts), `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`: exit 0 |
| 2 | Unit tests | `pnpm test` green: ≥ 2507 + new; `ASSETS_ENGINE_IMPLEMENTED` and `IMPORTER_STAGE4_IMPLEMENTED` true; the gated server suites **ran**, including the four Stage 2–3 real-engine suites gated in §7.4 step 7 (`--reporter=verbose` shows them run, not skipped) |
| 3 | Migrations | `git diff --exit-code` on `0000`–`0003`; `0004` holds no table recreate; fresh → 5; a 0003 DB with data upgrades and converts (§7.2 step 2); `/api/health` → `migrations: 5` |
| 4 | Engine goldens | `pnpm vitest run --project engine test/golden --reporter=verbose`: every §9.2 area compared; counts per reason match the private §3 (compare privately); the Stage 2–3 golden tallies unchanged |
| 5 | Server goldens | `pnpm vitest run --project server test/golden --reporter=verbose`: the assets golden and the Stage 2–3 goldens ran and passed |
| 6 | e2e | `PORT=3195 WEB_PORT=5195 DATA_DIR=artifacts/stage4/verifier/e2e pnpm e2e`: setup, every Stage 0–3 spec, `assets` and `assets-states` on desktop and phone, the 768–1199 px check; `mutations`, `cashflow-mutations` and `assets-mutations` ran and passed |
| 7 | Owner data, API | `DATA_DIR=artifacts/stage4/verifier/owner pnpm import:workbook --yes` (corrections auto, as the owner's database), `MARKET_DATA_MODE=off`; `GET /api/other-assets`, `/api/super`, `/api/property` and `/api/cash` match the private §5 (date-independent figures; date-dependent ones present or null as §5 says). Scratch script prints pass/fail only |
| 8 | Other assets and property CRUD + D34 | on #7: baseline dump; a price update → `hasAppData` true; a sale; a loan balance entry with typed repayments; a valuation; delete an imported price entry → marker; the 409s (`PROPERTY_HAS_LOAN`, `LAST_BALANCE_ENTRY`) and the 422 (`SALE_OVERSELL`); an app asset created and deleted round-trips the dump; `--yes --replace-app-data` restores the baseline (pricing timestamps ignored) |
| 9 | Super, overlays and settings | on a fresh #7 import: choose the SG fund (the callout's select: flag only) → `hasAppData` false, and a re-import keeps the choice (carried by name); an SG statement → false, survives a re-import; PATCH the five editable app-only keys → false (a cap override writes its FY with it); a fund created in the app with an opening balance leaves every period's gain unchanged (a transfer in), then delete it; PATCH `pay.grossAnnualSalaryCents` → true; a contribution → true; `FUND_IN_USE` for a fund with contributions; `--yes --replace-app-data` restores the baseline with the SG fund carried and the statement kept |
| 10 | Offsets | on #7: create an offset cash account (an app edit) with the balance the private §5 "#10" block gives, link it to the mortgage → the net balance, LVR, equity, payoff, months saved and interest saved equal that block; the provisional savings period's `added.offsetsCents` equals it; unlink by turning Offset off → the link is gone; delete the account |
| 11 | Pages at 1440, 1024 and 375 | on #7: `/other-assets`, `/super`, `/property` and every form open; h1, no console errors, no page scroll; screenshots under `artifacts/screenshots/{desktop,phone}/` |
| 12 | Live Yahoo (one run) | stop #7; `MARKET_DATA_MODE=live` on `artifacts/stage4/verifier/live` with the owner import: one `POST /api/prices/refresh` → a `succeeded` or `partial` job run; the silver and gold AUD series have values and a history row for today; bullion items are valued from spot; then add one scratch USD item with a past purchase date and no rate, refresh once more → its purchase FX is filled from Yahoo (`market`); delete it; counts recorded privately |
| 13 | Prod bundle | `pnpm build`; `PORT=3195 DATA_DIR=artifacts/stage4/verifier/prod IMPORT_CORRECTIONS_FILE=none pnpm start`; deep links `/other-assets`, `/super`, `/property` serve HTML; synthetic import; the three GETs → 200 |
| 14 | Privacy | `pnpm guard:all` exits 0 (with the Stage 4 terms); re-run the code reviewer's numeric scan on the final tracked diff: nothing found; no snapshot files |
| 15 | Engine purity | `pnpm exec eslint packages/engine --max-warnings=0` and `test/purity.test.ts` |
| 16 | PLAN acceptance | the goldens pass (#4, #5); **the mortgage "payments paid" fix is applied**: on the owner import each mortgage shows principal paid = start − current (History `AD` unchanged), repayments = the regular payment × the payments due on the loan's payment grid, and interest and fees = repayments − principal (no longer 0), with the imported figure shown beside it; CRUD updates totals (#8–#10); D34 behaves as §3.4 (#8, #9); every §11 fix is applied and listed in the close notes |

**Demo frames** (the D44/D62 pattern; **D74**): the owner's real `data/` after a **fresh backup** taken right before the demo start; migration 0004 converts it on the first start. **Re-import-safe actions only:** choose the fund that receives SG (the callout's select), optionally set how imported contributions are read, the stale-price days and your employer's SG rate; everything else is viewing (no price, balance, loan or contribution edits, which would block re-import). `hasAppData` must still be false at the end.
0. With every server stopped: back up `data/finance.db*` to a new git-ignored `data/backups/pre-stage4-demo-<date>/`.
1. **Other Assets:** the items with their prices, the assumed-date badges on undated items, bullion at live spot, the cost and value chart without the current-month zero.
2. **Super:** the funds; choose the SG fund; the SG estimate and the concessional cap meter for this FY (with the April–June 2026 quarter counted in July) and last; the derived gains per period (merged where a balance was not updated) and the annualised return; the imported contributions marked as estimates (and the reading switch).
3. **Property:** the property, equity and LVR; the mortgage's balance log (the loan-start row, then the balance) with its estimated repayments and the interest and fees now visible (the D66 fix), the payoff date and total interest from the schedule on the loan's payment dates, the imported "payments paid" figure beside them.
4. **Cash:** the provisional period's parts now from the live engines (unchanged figures on the imported data).
5. Phone views of Super and Property.

---

## 11. Template bug fixes applied in Stage 4 (owner can veto)
Numbering is stable. Fixes 1, 6, 11, 16–24 carry out kickoff decisions and are listed so the owner sees each change; the others are proposals.
1. **Mortgage "payments paid" becomes a balance log with derived interest** (D66). A `start − current` override in row 30 made interest always $0; the template's default added offset balances to the payments.
2. **The payoff date comes from a real amortisation schedule** with separate payment and compounding frequencies, paid on the loan's own payment dates (anchored at its start). `X35` converted a monthly payment into compounding periods for `NPER` and truncated the months with `EDATE`.
3. **Total future interest comes from that schedule and your payment.** `X33` used `CUMIPMT` over whole years at the loan's implied payment, plus the interest to date.
4. **Interest per period is the next payment period's interest at the effective periodic rate.** `X32` divided the annual rate by the compounding frequency whatever the payment frequency.
5. **LVR is positive and net of linked offsets.** `F12` displayed it negative.
6. **Offsets are never "payments paid"** (D67): they lower the interest estimate, bring the payoff forward and net off the loan in equity, LVR and net worth.
7. **Money moved into an offset counts as savings** (Δ offsets in added investments, from the provisional period on; recorded months store the offset figure from Stage 5). Offsets stay out of Total Cash (D56), so without this a transfer into an offset reads as spending. (New; accepted, D78.)
8. **The property's annualised gain is a CAGR.** `X23` was simple: gain % ÷ days × 365.
9. **Net rent to date may be negative.** The sheet's validation forbade a net loss.
10. **The mortgage start date anchors the payment dates** that the default repayments count. `X24` was unused.
11. **Undated other assets use the first recorded month's date, marked Assumed** (D73). `R` annualised over `TODAY() − 0` and showed about 0 %/yr. (These annualised returns, which can be very large, are shown with the Assumed marker, D77.)
12. **An other asset's annualised return includes FX.** `R` compounded the native unit price only.
13. **The cost line counts purchases dated on a snapshot date** (≤, as the savings windows). The sheet's `Z` used <, so such a purchase was a savings contribution but missing from that month's cost line.
14. **The other-assets chart ends at the live value.** The hidden block's current-month row was blank and charted as 0.
15. **Cost and value are two unstacked lines.** The sheet's chart stacked value on top of cost.
16. **Sales record a date, units and proceeds with a realised gain** (D72), and a sale is a negative added investment in the savings engine, so the cash it brings is not counted as saved. The sheet shrank the cost base and lost the proceeds.
17. **Foreign-currency other assets are valued and counted:** the cost at the FX close on the purchase date, fetched once and stored (an import keeps the sheet's own rate), the value at today's rate. Stage 3 skipped them.
18. **Bullion is priced from the spot series × oz per unit with a metal field** (D23, D72), not a cell link to a Managed Funds feed row; gold works too.
19. **Hand-priced items carry an as-of date, a stale badge after 90 days (a setting; D77) and a price history** (D72); an unchanged price can be confirmed as still current.
20. **Super gains are derived** as the change in balance − employer SG − your contributions after contributions tax − money moved in from outside the tracked funds (D69), not an unentered "market gains" cell; a month whose balance was not updated merges into the next instead of reading as a loss; adding or archiving a fund never reads as a gain or a loss.
21. **The super annualised return chains Modified Dietz periods** (D69), replacing `SLOPE(gain %, date) × 365` (`B19`).
22. **Super investment-option notes are a per-month log** (D69), edited by month, never by row position.
23. **Voluntary contributions are entered pre-tax with a type** (D71): the savings rate keeps the take-home cost (the sheet's convention), gains use what the fund receives, the cap uses the pre-tax amount; imported months are labelled estimates and read through one setting.
24. **Employer SG is estimated at the statutory rate of each FY (or your employer's rate), with statement overrides** (D69), **and a concessional cap meter per FY** is added (D70), counting SG in the FY the fund receives it (the April–June 2026 quarter in FY2026–27; D75). The template had neither.
25. **An unpriced hand-priced item shows "No price yet"** and is left out of the value, cost and gain totals instead of counting as a 100 % loss (the sheet valued a blank price at 0). (Added by the Fixer, round 1; §9.3 rule 17.)

Decisions applied (not fixes): D66 the loan balance log, D67 offsets, D68 the primary residence in net worth (FIRE excludes it in Stage 6), D69 the super balance log, SG and derived gains, D70 the cap meter, D71 typed contributions, D72 other assets' prices, bullion and sales, D73 assumed dates.

---

## 12. Risks & fallbacks
| Risk | Status / fallback |
|---|---|
| Yahoo's chart API is unofficial; FX pairs or futures can fail or change | The last good series value stays (stale badge); bullion falls back to its last known price; a missing purchase FX leaves the item's cost unknown with a callout and a typed-rate field; the backfill is capped per run, shares the cool-down and the run deadline; fake mode keeps e2e offline. |
| Amortisation edge cases (payment below interest, a zero rate, an offset above the balance, very long loans) | Explicit flags and callouts; decimal arithmetic rounded once; the 100-year cap; hand-worked unit tests and the sheet-mode golden. |
| Default repayments misstate interest (extra payments, redraws, a changed repayment) | Every default is labelled Estimate; `repayments_below_principal` and `balance_increased` flag the obvious cases; typed repayments per entry replace the estimate; changing the regular repayment re-estimates the untyped entries and the loan form says so (§2.6). |
| SG timing (quarterly payments before 1 July 2026, Payday Super after) makes a month's gain swing | The gains spread each month's SG by the days it was earned and label it; statement months replace estimates; the annualised return chains over months, so timing mostly cancels. The cap meter counts SG when the fund receives it (§2.5 step 7), with a note for the transition year. |
| Flagging an existing account as Offset | Closed periods keep Δ offsets 0; the provisional period reads the moved balance as spending until the next month is recorded; the Cash page says so (§2.9, §6.6). |
| A fund added or rolled over | Opening balances of app-created funds are transfers in (not gains) unless marked a rollover; archiving needs a closing balance of 0 (§2.5). |
| Imported contributions have no type | One app-only setting reads them all (import-safe); the figures built on them carry an Estimate badge. |
| Extreme annualised figures (D73 assumed dates, short holds) | "Assumed" badges; "—" under 90 days held; entering a real date replaces the assumption. |
| One SG fund at a time | Documented; statement months still carry the total for any month. |
| The migration's data conversion on the owner's database | Tested on a 0003 database with data; the pre-step backup; converted rows keep `origin`; the no-recreate rule. |
| D34 surprises (a Stage 4 edit blocks re-import) | Callouts on workbook rows and settings; the SG fund, SG statements and app-only settings are import-safe; the demo uses those only. |
| Parallel work on the Stage 3 context and inputs | server-api owns them; the engine returns the savings live parts ready to map; the flags gate dependent tests, including the four Stage 2–3 real-engine suites once the context calls the new engine (§7.4 step 7), and the Integrator and Verifier confirm they ran. |
| Payment dates vs balance dates | One anchored grid for the log and the schedule (§2.3); imported balances unchanged since the last snapshot are dated at its run date, so no payment is counted against an unchanged balance (§3.5). |
| Rounding drift vs cached cells | One rounding per output; totals as Σ rows with the ⌈n/2⌉-cent tolerance (n cents for Σ of gains); ratios from unrounded sums. |
| Engine cost per request | Small data; memoised per request; profile if a page exceeds 100 ms. |
| Three mutating e2e projects | Chained dependencies (`mutations` → `cashflow-mutations` → `assets-mutations`); each cleans up by `E2E_NOTE`; the Verifier starts from an empty `DATA_DIR`. |
| Stale dev servers on `data/` | The coordinator pre-step stops them; agents use `artifacts/stage4/*`. |

---

## 13. Every agent: final report checklist
- Files created or changed (all inside your ownership; Scaffold notes appended; Integrator cross-area edits listed).
- Commands run with pass/fail: typecheck, lint, format:check, your scoped tests, your e2e specs on your ports, `pnpm guard:all`.
- Engine, server-api, the spec reviewer and the Verifier: golden counts per area (compared / skipped by reason / recomputed). **No owner values, item names, fund names or notes** in anything that could be committed.
- Screenshot paths under `artifacts/screenshots/` (UI roles) and the STYLE_GUIDE §10 self-check.
- Contract gaps or cross-owner requests (not worked around).
- Ports free and no background processes left.
- Nothing committed or pushed; no owner data in any tracked file.

---

## Scaffold notes

_Scaffolder appends here (append-only): where the skeleton differs from, or adds to, the plan above. The implementers, the Integrator and the Fixer append contract clarifications here too._

### 2026-09-26 - Scaffolder

The done-check passed: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` (143 files, 2632 tests; the Stage 3 baseline was 141 files, 2507 tests), `pnpm build`, `pnpm guard:all` (clean); `PORT=3070 WEB_PORT=5170 DATA_DIR=artifacts/stage4/scaffolder/data pnpm e2e e2e/smoke.spec.ts e2e/ui-core.spec.ts` on a fresh folder (65 passed, 8 project skips, as Stage 3); `/api/health` → `migrations: 5`; `seed:dev --yes` into that folder exits 0; ports 3070/5170 free afterwards. `git diff --exit-code` on the `0000`–`0003` SQL and snapshot files is clean. No `pnpm install` (no dependency or lockfile change). Two generic values first matched private guard terms; the values were changed (no guard-term edit).

**Migration `0004_stage4_assets`**
- Generated by drizzle-kit (`db:generate --name stage4_assets`): the eight tables, their indexes and four `ALTER TABLE … ADD` (no recreate, no `PRAGMA`), `meta/0004_snapshot.json` and the journal entry. Index names: `other_asset_prices_asset_idx`, `other_asset_sales_asset_idx`, `super_balance_entries_fund_idx`, `property_valuations_property_idx`, `loan_balance_entries_loan_idx`, `loan_offset_links_loan_idx`; the unique indexes take drizzle's generated names; `market_quote_history` has a composite primary key; `super_funds.receives_sg` is `integer DEFAULT false NOT NULL`.
- A header comment (in the first statement chunk) says the data statements were appended by hand; each carries a short SQL comment. The statements are §3.1's, verbatim, in its order.
- Tests (`apps/server/test/migrations.test.ts`): a fresh DB has the Stage 4 tables and columns; a statement-shape check of 0004 (no `__new_`, `PRAGMA` or `DROP`; only `CREATE TABLE`/`INDEX`, `ALTER TABLE … ADD`, `INSERT`, `UPDATE`); the Stage 1 upgrade test's expected dump gains the 0004 conversion through `expectedStage4Conversion` (a JS mirror of the SQL; the Stage 1 dump drops the Stage 4 tables and columns, the History-derived contributions and the contribution dates, which only Stage 4 writes); a new "0004 converts a Stage 3 database with data" pair with its own raw rows (§7.2 step 2: equal totals + a workbook as-of + one app row of each parent, and differing totals + the date fallback + import rows only; a later dry run and a failed run are ignored), asserting explicit rows and cross-checking the mirror; Stage 4 FK cascades and unique keys.

**Schema (`@joinr/schema`)**
- Enums, tables, `db/index.ts`, `DOMAIN_TABLES_DELETE_ORDER`, `DUMPED_TABLES`, errors and `SETTINGS_PATCH_MAX_KEYS` (30) as §3.2. `clearSeededTables` also clears `super_sg_overrides` and `market_quote_history`.
- **Rows:** `newLoanOffsetLinkSchema` requires `accountId` (the table is keyed by the account; the parity test uses a `KeyedByAccount` type, as `KeyedByInstrument`); the log rows bound money at ≥ 0, a hand price at ≥ 0 and sale units at > 0.
- **Records:** labels "Other asset prices", "Other asset sales", "Super balance history", "Super SG statements", "Property valuations", "Loan balance history", "Offset links"; the offset links' row id is the account id. Appended columns: "FX rate at purchase", "FX rate source", "Receives SG", "Date". `apps/server/src/records/index.ts` has full loaders for all seven (not only the minimum).
- **Settings:** `super.concessionalCapFy` is labelled "Concessional cap override: financial year" (integer 1900–2200, not editable).
- **`src/assets.ts`:** as §3.2; `paymentDatesBetween` throws `RangeError` for a malformed date.
- **`dto/assets.ts` additive exports** (no frozen name changed): the parsed/body types (`OtherAssetUpdate`, `OtherAssetUpdateBody`, `OtherAssetCreate`, `OtherAssetCreateBody`, `OtherAssetPricesInput`, `OtherAssetSaleInput`, `SuperFundUpdate`, `SuperFundCreate`, `SuperBalancesInput`, `SuperContributionInput`, `SgOverrideInput`, `PropertyUpdate`, `PropertyCreate`, `ValuationsInput`, `LoanUpdate`, `LoanCreate`, `LoanBalancesInput`, `LoanBalanceEntryUpdate`, `LoanOffsetsInput`) and every factory's real-clock schema (`otherAssetUpdateSchema`, `otherAssetCreateSchema`, `otherAssetPricesInputSchema`, `otherAssetSaleInputSchema`, `superFundCreateSchema`, `superBalancesInputSchema`, `superContributionInputSchema`, `propertyUpdateSchema`, `propertyCreateSchema`, `valuationsInputSchema`, `loanUpdateSchema`, `loanCreateSchema`, `loanBalancesInputSchema`). The create schemas repeat the update fields (a shared field shape) instead of `.extend()`, because Zod 4 refuses `.extend()` on a refined object; the fields and refines are §4.3's.
- **Request-schema messages** (server 400s read `path: message`): the Stage 3 set, plus `must be a 3-letter currency code or GBX`, `must start with http:// or https://`, `metal: is required for bullion`, `ozPerUnit: is required for bullion`, `currency: bullion is priced in AUD`, `metal: only for bullion`, `ozPerUnit: only for bullion`, `purchaseFxRate: only for a foreign currency`, `price: bullion is priced from spot`, `entries: an asset / a fund / a property / a loan appears twice`, `entries: must list at least one asset` (`… at most 500 assets`; funds, properties and loans at most 50), `accountIds: an account appears twice`, `must list at most 20 accounts`, `compoundingPerYear: must be at least 1 / at most 365`. A non-negative decimal field says `must be a number such as 12.5`.
- **Seed (§3.6):** the latest price, fund balance, valuation and loan entries are dated at the seed as-of (31/08/2026) and equal the parents' copies, as §3.6 says (not the importer's last-run rule); the earlier ones are 31/03/2026 (price), 31/05/2026 (fund, mortgage), 31/08/2025 (valuation) and 31/12/2025 (car loan); the `Super!B16` entry is dated at the as-of; three History-derived contributions (`History!R3`–`R5`) at the snapshots' run dates. No sales, SG statements, offset links or series history; every row keeps origin `import`.
- **Fixtures (`fixtures/assets.ts`)** are literals written by `artifacts/stage4/scaffolder/fixture-gen.ts` (git-ignored), which applies the §2 rules to generic inputs; `packages/schema/test/assets-fixtures.test.ts` re-checks sums, orders, windows, statuses, coverage and request bodies built from the fixtures. As-of 24/09/2026, recorded months Mar–Aug 2026, the provisional Sep 2026 (as the cash fixtures). Choices where the contract is silent (owners may refine):
  - **Other assets:** `populated` also has an item without a cost (`no_cost`) and a sold-out item oversold by its imported sold units (`oversold`, with a typed `user` purchase rate), for `FIXTURE_COVERAGE`; the item without a live rate is EUR, not USD (the page's USD item has a live rate, and a live rate is per currency); the EUR item's purchase rate is `import`. `SpotDto.asOf` and `FxRateDto.asOf` are market-quote timestamps; a bullion row's `priceAsOf` is the spot's local date. `FxRateDto` lists the assets' currencies in code order, `GBX` as itself.
  - **Super:** one extra state, `capOverrideLastFy` (the override set for the FY before), beside `capOverride` (this FY). `SuperFlows.concessionalCents` = Σ the pre-tax of the window's concessional member contributions (SG has its own fields); `nonConcessionalCents` = Σ after-tax amounts (typed or read). Per-fund entry flows count the SG fund's SG after contributions tax, spread by days, and give contributions with no fund to the SG fund. An imported entry's fund figure comes from the unrounded gross-up (so it can differ by 1 cent from the rounded pre-tax × 0.85). `gainFlows` equals `flows` when the window is not merged.
  - **Property:** a loan's start point takes the loan's origin, with a null note and sheet ref; a snapshot chart point's equity is `X + AB`; the live point uses the gross `mortgageCents` and the net LVR.
  - Chart labels are `Sep 2026` (the web adds " (live)", as Stage 3).
  - **`fixtures/cashflow.ts`:** `offsetsCents` is 0 everywhere except `cashPages.populated`'s provisional period ($500: the offset account's 31/08 entry is now $9,500 and an app entry on 15/09 brings it to $10,000, so its balance is unchanged; that period's added investments, savings, rate and spend and its chart point follow); the offset account (id 5) is linked to `{ id: 1, name: 'Example property mortgage' }` (= `propertyPages.populated`'s mortgage), every other account `linkedLoan: null`; `staticUntilStage4: false`.
  - `sampleDtos.ts`: a page per new entity (and a USD other asset and a salary-sacrifice super entry); `apiErrors` gains the four Stage 4 bodies.

**Engine contract (`@joinr/engine`)**
- `types.ts` has every §2.2 type, the additive Stage 3 changes, and named aliases for the six new functions (`ComputeOtherAssetsFn`, `OtherAssetsCostHeldAtFn`, `ComputeSuperFn`, `ComputePropertyFn`, `AmortiseFn`, `AssetsSnapshotColumnsFn`); `EngineApi` has 33 members.
- `index.ts`: the six functions are `const` stubs typed with their aliases, all throwing `engine: not implemented`; **`amortise` is a stub too** (left to the engine owner with its tests); `ASSETS_ENGINE_IMPLEMENTED: boolean = false`; the `engine` value has 33 members.
- `test/api.test.ts` (→ engine): the member list, `toEqualTypeOf` for the six, the flag, and a stub-throw test under `skipIf(ASSETS_ENGINE_IMPLEMENTED)` (remove it with the flag).
- `savings.ts` sets `added.offsetsCents: 0` (→ engine); `test/savings.test.ts`'s whole-object expectation gains it.

**Server stubs**
- `routes/{otherAssets,super,property}.ts` answer 501 `NOT_IMPLEMENTED` ("`<METHOD> <path>` arrives with the Stage 4 server work", `no-store`) for every §4.2 route, each with a local handler; each exports `<Name>RouteOptions` = `{ database, config, market, dividendEvents, now?, engine? }`; `app.ts` registers them with the cash-flow options object.
- `market/history.ts`: the frozen `readQuoteHistory(db, seriesIds, fromDate)` returning `{}`.

**Compile and expectation fixes the contract forced (→ each file's owner)**
- `apps/server/src/cashflow/cash.ts`: `offsetsCents` mapped; `linkedLoan: null` (server-api maps the link).
- `apps/server/src/cashflow/constants.ts`: `CASH_PAGE_SETTING_KEYS` is the explicit six (`as const satisfies`).
- `apps/server/test/investments/helpers.ts`: neutral fakes for the six (`computeOtherAssets` maps each input asset to an unpriced row, `computeSuper` maps the funds, `computeProperty` is empty, `amortise` has no flag, `assetsSnapshotColumns` merges the three snapshots).
- `apps/server/test/cashflow/cash-routes.test.ts`: `other` is still a 404; `super_option` is asserted not to be one. `apps/server/test/cashflow/pages.test.ts`: `linkedLoan` and `offsetsCents` in two whole-object expectations. `apps/server/test/records-routes.test.ts`: seeds a sale, an SG statement and an offset link; Stage 4 counts and a listing test.
- `apps/web/src/pages/cash/CashPage.test.tsx`: the Stage 4 note is asserted absent.
- `packages/schema/test/{db,registries,rows-parity,cashflow-schemas,cashflow-fixtures}.test.ts` updated; new `assets-schemas.test.ts` and `assets-fixtures.test.ts`.

**Web stubs:** typed routes `/other-assets`, `/super`, `/property`; each page renders `PageHeader` (subtitle "Assets") and the note "Arrives with the Stage 4 web work."; `router.test.tsx`'s placeholder test at `/super` still passes (it checks the h1 only). `e2e/ui-core.spec.ts`'s short-page list is `['/fire', '/history']`.

**Importer flag:** `IMPORTER_STAGE4_IMPLEMENTED: boolean = false`.

**For the owners (not worked around):** `cashflow/responses.ts`'s `settingsResponse` still returns only the Budget and Cash slices (server-api, §3.3); the Stage 3 `periodNoteDto` returns null for `super_option`, so a `super_option` PUT answers `{ note: null }` until server-api changes it (§4.5); `e2e/records.spec.ts` now has 27 record pages (Integrator, §7.8 step 6).

### 2026-09-26 - market-data

§4.6 is implemented in `market/{refresh,fxHistory,history,service}.ts` and `market/providers/{yahoo,fake,types}.ts`, with the tests in `apps/server/test/market/{fx-history,series-history,other-asset-fx}.test.ts` (53 tests; the whole `test/market` folder passes). No frozen name, field or signature changed.

**Additive contract items**
- `providers/types.ts`: next to the frozen `FxClosesClient`, the class `FxClosesError` (with `kind`: `'rate_limited' | 'skipped' | 'failed'`, plus `retryAfterMs`) and the type `FxClosesErrorKind`. `fetchCloses` rejects only with this error, so the backfill can tell a 429 (stop, and start the shared cool-down) from an aborted run (skipped) and from a failure. A malformed `period1`/`period2` is a programmer error and throws a `RangeError`.
- `providers/yahoo.ts` also exports `yahooFxPairSymbol`, `yahooFxClosesUrl`, `DailyClose`, `YahooClosesParse` and `YahooFxClosesOptions`. `parseYahooCloses(body)` returns `{ ok: true, closes } | { ok: false, error, retryable }` (the shape of the Stage 3 dividends parser).
- `RefreshOutcome.fxBackfill: { requested, filled, failed, skipped }` (internal to the job). The job detail gains `fxBackfill` beside `series`.
- The new module `market/fxHistory.ts` exports `FX_BACKFILL_MAX_PER_RUN` (10), `FX_BACKFILL_LOOKBACK_DAYS` (10), `FX_BACKFILL_RETRY_MS` (24 h), `FxBackfillAttempts`, `selectFxBackfillTargets`, `fetchFxBackfill`, `writeFxBackfill`, `writeSeriesHistory`, `lastCloseOnOrBefore`, `purchaseFxRateFrom`, `fxFetchCurrency`, `addDaysIso` and `localIsoDate`.

**Choices where §4.6 is silent**
- **Attempt times:** they live with the FX-closes client (a `WeakMap` keyed by the client, which `buildProviders` builds once per service). This keeps them across runs without widening `RefreshContext` or `createService`. A 429, the cool-down, the deadline or a shutdown does not use up the pair's daily attempt; a request error, or closes with none on or before the date, does. `force` does not bypass the once-a-day rule, so "Refresh now" cannot keep a run `partial`. A run restricted to `instrumentIds` still runs the backfill.
- **Cap and counts:** the cap takes the first 10 of the sorted candidates. A pair tried within the day sorts last, but it still counts toward the cap (and as `skipped`) when fewer than 10 other assets are waiting. `requested = filled + failed + skipped`. An asset whose row changed while its pair was being fetched counts as `skipped`: another currency or purchase date, a typed (`user`) rate, or a delete. The update's `WHERE` checks all of these, so the write is atomic.
- **Closes:** every fetched close is upserted as `FX_<CCY>AUD`, including the closes of a pair that failed for lack of a close on or before the date. Fetched closes are written before the day's series history, so today's history row holds this run's live value. The history `source` is `providers.yahoo.id` (`yahoo`, or `fake` in mode fake). Rates keep 12 significant digits; `GBX` stores the GBP close ÷ 100.
- **Job status:** a filled rate counts as a success. A run aborted with backfill assets still skipped is incomplete, as the Stage 1 rule treats skipped instruments.
- **Fake mode:** `fakeFxClose('USD')` = 1 ÷ `FAKE_AUDUSD` at 12 significant digits (`1.53846153846`). Any other code gives `fakePrice('<CCY>AUD=X')`, with `GBX` quoted as GBP. The fake client returns one close dated the day before `period2` (the purchase date), never after the clock's local date.
- **`readQuoteHistory`:** every requested id is a key (an unknown series gets `[]`); repeated ids collapse; `fromDate` is inclusive; a malformed `fromDate` throws `RangeError`.
- **Series history date:** the server-local calendar date of the series' `asOf` timestamp. Failed or skipped series are not written.
- `providers/yahoo.ts` imports `localDateResolver` from `market/dividends/parse.ts` (the Stage 3 resolver, as §4.6 asks). That module imports `yahoo.ts` back. Both sides use the other only inside functions, so the cycle is safe (the tests load it in both orders).

### 2026-09-26 - importer

§3.5 items 1–7 are implemented in `packages/importer/src/{extract,model,process,writer,reconcile,importWorkbook}.ts`, and `IMPORTER_STAGE4_IMPLEMENTED` is `true`. The CLI's `ENTITY_LABELS` gained the four new counted entities. The public `@joinr/importer` API is unchanged; every new export is internal to the package. Tests: the new `packages/importer/test/{import.assets,migration-equivalence}.test.ts`, with helpers in `test/{assets-helpers,stage3-upgrade}.ts`. The clean test's counts and the golden gained Stage 4 checks. The golden reads every rule from the workbook at runtime and also runs the migration-equivalence check on the local workbook.

**Synthetic workbook (additive, no fact changed):** each Other Assets row now has the template's cached `N`, `O` and `P` cells (with their formulas; every row is AUD). The new `otherAssets.cost` check needs them. `SYNTHETIC_FACTS`, `D3`, `D4` and every other value are unchanged.

**Choices where §3.5 is silent (the importer owns them)**
- **Price entries:** a manual row whose `K` is negative gets no price entry, because a price entry cannot be negative. The row still keeps its `unit_price`, and an info line `otherAssets.negativePrice.<ref>` reports it. `counts.other-asset-prices` expects manual rows whose `K` is a number ≥ 0 (numeric text counts, as the extractor reads it).
- **Purchase rate:** the rate is `N ÷ (M × J)` over the cached doubles, rounded to 12 significant digits (half even, like `decimalFromNumber`). The rate is kept only when it is positive. `purchase_fx_date` = `G` (null for an undated row). Only rows whose stored currency is not exactly `AUD` get one.
- **Last-run date rule:** the super rule compares `Super!B12` in cents with the latest kept snapshot's `Q` in cents. The loan rule compares the property loans' Σ current balance with `|AB|` of that snapshot and requires `start_date < C51` (a null start date qualifies). Both rules date entries at `C51` (`meta.lastRun`) and apply only when `C51` is set and not after the workbook as-of. Otherwise every entry stays at the as-of. On the synthetic and owner workbooks `C51` is the latest kept snapshot's run date, so this matches migration 0004, which uses that run date and Σ of the funds.
- **History contributions:** one per kept snapshot, in run-date order after the `Super!B11`/`B16` entries. Each uses `snapshots.super_contrib_cents` (R in cents), like the migration, so the ids match too. **D37:** the switch is SheetOptions ID 43 (the `savings.includeRetirementContributions` plan value). "Buys" are trades with units > 0 in Stocks, ETFs and Managed Funds holdings whose imported instrument is tagged Retirement, valued at units × price (the ledger's order value, no fee). They are summed over the windows the movement checks use: `(previous kept run date, run date]`, with the first window starting one month before its run date. The info line counts the rows whose amount differs from R. The reconciliation re-derives both sides independently: the switch comes from the sheet, and the buys come from the stored trades and tags.
- **SG fund:** D49's matcher is now shared (`matchStoredRows` in `process.ts`; `carryAccountKinds` is unchanged in behaviour). The flag is set only on the fund that continues the flagged stored fund. `super.sgFundNotCarried` (info, `unit: count`, `refs.entity: super-funds`) appears only when a flag was lost.
- **Reconciliation:**
  - `otherAssets.value` and `.gain` value a non-AUD row through `O ÷ (M × K)`, and its gain uses the imported purchase rate.
  - A non-AUD row without a numeric `O`, `M` or `K`, or with `M × K = 0`, is left out and turns a mismatch into `info` (the same applies to `netWorth.otherAssets` and the totals). Before, any non-AUD row did this.
  - `otherAssets.cost` compares Σ numeric `N` of the data rows (`sheetRef` `Other Assets!N3`) with Σ remaining × unit cost × purchase rate. A row with an unknown rate is left out on both sides.
  - `super.contributions.history` uses `sheetRef` `History!R3`.
  - The four new counts are `counts.other-asset-prices`, `counts.super-balance-entries`, `counts.property-valuations` and `counts.loan-balance-entries`, and `report.counts` has the same four keys.

**Migration equivalence (§7.6 step 2):** the Stage 3 database is rebuilt from the Stage 4 import. The rebuild drops the new tables and columns and the `History!R` entries, nulls `entry_date`, and dates the funds' and loans' `balance_as_of` at the as-of. The rows go into a database migrated to 0003, together with a succeeded import run, and are then upgraded through 0004. Four synthetic variants are compared without ids: the clean workbook, unchanged live totals, the faulty duplicate month, and the faulty workbook with unchanged totals. A tampering check shows that the comparison catches a difference. All variants have the D37 switch set to No, because the exclusion is importer-only. The synthetic workbook tags no holding Retirement in any case.

### 2026-09-26 - server-api

§4.5 and §7.4 steps 1–8 are implemented in `apps/server/src/assets/**`, the three route files, `app.ts`, `cashflow/{context,inputs,cash,constants,responses}.ts`, `cashflow/mutations/{cash,settings}.ts`, `investments/load.ts` and `records/index.ts`; `db/queries/domain.ts` needed no change (`hasAppData` scans the new import-owned tables through `DOMAIN_TABLES_DELETE_ORDER`). No frozen name, field or signature changed.

**Pre-authorised gating (FEAS-1, §7.1):** `test/cashflow/integration.test.ts`, `test/investments/integration.test.ts`, `test/golden/cashflow.golden.test.ts` and `test/golden/investments.golden.test.ts` gain `&& ASSETS_ENGINE_IMPLEMENTED` in their gates. The Stage 3 server golden's live-row rule is narrowed as §9.3 rule 12 says (a negative Σ of the used slots' row 31 skips the provisional period, `defined_by_decision`). The new gated suites are `test/assets/integration.test.ts` (`ASSETS_ENGINE_IMPLEMENTED`; its synthetic-import case also needs `IMPORTER_STAGE4_IMPLEMENTED`) and `test/golden/assets.golden.test.ts` (both flags and `describeWithLocalWorkbook`).

**Additive, server-internal**
- `FinanceContext` also exposes `series`, `otherAssetsInput()`, `superInput()`, `propertyInput()` and `spotHistory()` beside the four members §4.5 names. `InvestmentData` gains the eight Stage 4 row lists; properties and loans now load in `sort_order`, then id (they loaded by id).
- `cashflow/inputs.ts`: `savingsSnapshots(data)` (the latest snapshot's offset figure), `liveSavingsInput({ … })` now takes the engine results, `otherAssetFlows(result)`. `provisionalSuperContribCents`, `otherAssetPurchases`, `otherAssetsValueCents` and `staticUntilStage4()` are removed (§4.5).
- `cashAccountDto` takes an optional `linkedLoan`. The server test helper `startApp` takes an optional `services` factory (a spy on the price job's notify).

**Choices where the contract is silent**
- **Other assets:** an update that leaves fewer units than the workbook's sold units plus the recorded sales is `422 SALE_OVERSELL` ("The sales already use N units; keep at least that many"). A reorder makes each moved row `app` (a re-import would undo the order). `unit_of_measure` is `oz` for bullion at 1 oz per unit, otherwise `each`; an update keeps the stored one unless the price source changes. A price save at a date that already has an entry keeps an omitted note, and an unchanged entry is not rewritten. The SALE_OVERSELL message says "Only 1 unit is left" in the singular.
- **Super:** a new fund's opening balance of 0 stores no transfer in. `FUND_IN_USE` counts member contributions only; a reported-gain entry that names a deleted fund keeps its row with no fund (the FK's `set null`). The contribution routes answer 404 for a reported-gain id. The SG-override response for a month outside the two cap years' list is computed by the engine as of that month's end, so its figures still come from the engine.
- **Property:** a loan's `offsetAccountIds` lists only linked accounts still flagged Offset (the engine input's rule). `imported` is null for a loan made in the app. The start point in `loanEntries` takes the loan's origin, a null note and a null sheet ref (as the fixture). `loanEntries` are sorted asOf desc, then loans in page order, then a loan's stored entries before its start point.
- **Settings:** the slice lists every named page's keys once, in the order Budget, Cash, Super, Other Assets, Property. `super.concessionalCapFy` is written with `origin 'app'` and the FY of the server-local date of `now`. A PATCH that names `super.concessionalCapCents` writes the FY even when the cap figure is unchanged, so saving the override again in a new financial year applies it to that year (an unchanged FY is not rewritten).
- **Tiles:** `SpotDto.asOf` and `FxRateDto.asOf` are the market-quote timestamps; the FX tiles list the assets' currencies in code order, `GBX` as itself (as the fixture).

**The server golden (§9.4):** besides the §9.3 reasons it counts `market_off` (a non-AUD row's value, gain, gain % and return: the golden runs with the market off, so there is no live FX rate). Zero denominators are counted as compared (rule 15). With the D37 switch on, each History-derived entry is compared with `R` less its window's buys of Retirement-tagged Stocks, ETFs and Managed Funds holdings, read from the imported trades and tags (the importer's rule); a window that holds such buys counts as recomputed (`retirement_tagged`).

### 2026-09-26 - engine

§2.4–§2.10 are implemented in `packages/engine/src/{otherAssets,super,property,amortise,assetsSnapshot}.ts` (shared helpers in `assetsCommon.ts`) and `savings.ts` (§2.9). `ASSETS_ENGINE_IMPLEMENTED` is `true`. No frozen name, field or signature changed. The engine suite runs 27 files and 356 tests, goldens included, none skipped; the Stage 2–3 golden tallies are unchanged. The unit tests are `test/{otherAssets,super,property,amortise,assetsSnapshot}.test.ts` plus the §2.9 cases in `test/savings.test.ts`. `test/api.test.ts` no longer has the stub-throw test.

**Goldens (§9):** `test/golden/assets.golden.test.ts` is supported by three helper files:
- `assetsAdapter.ts` builds the sheet-faithful inputs.
- `assetsFormulas.ts` holds RRI, NPER, CUMIPMT, EDATE, DATEDIF and the two cost lines, computed over the sheet's own cells.
- `assetsTally.ts` holds the §9.3 skip and recompute reasons.

The six areas are those of §9.2, and each prints counts only; the counts equal the private companion's §3. Adapter checks confirm the helpers reproduce the cells the goldens skip (`X23`, `X33`, `X35`, the sheet's `Z`, `Net Worth!D21`/`E21`). A failed check fails the test but is not counted. The adapter follows the importer on three points:
- the one-per-month rule, for both the snapshots and the History-derived contributions (a second row in one month counts `never`);
- the last-run rule of §3.5 for the fund and loan entry dates;
- a blank hand price read as 0 (the sheet's `M × K`).

A git-ignored scratch check of the engine's app-only figures on the owner workbook against the private companion's §2 and §5 matched every figure.

**Readings where §2 is silent (engine-owned; reviewers may refine):**
- **Other assets:**
  - A sale of an undated item still gives its negative flow. "Undated assets never produce a flow" (step 9) is read as no *purchase* flow, because a sale's proceeds land in cash (§11 fix 16).
  - The cost line never counts negative units (step 11 with step 1's "never below 0"; the sheet's `N` is blank then too). The generic fixture `otherAssetsPages.populated` counts its oversold item's negative units, so its chart `costCents` sit below the engine's on every point (reported to server-api).
  - A sold-out or oversold item keeps its pricing and FX flags, so the counts include it. Its sales still need the purchase rate.
  - `unitPriceAud` is a computed price given to 12 significant digits, as Stage 2's prices are. The value uses the unrounded price.
  - `staleCount` counts manual rows whose status is `stale`, including a price with no date.
  - The live chart point is added even without a snapshot (labelled with the as-of month). With snapshots it takes the provisional month (Stage 3's rule).
- **Super:**
  - Flags come in `SUPER_FLAGS` order.
  - `no_marginal_rate` is raised only when a salary-sacrifice reading needs the rate; `no_salary` whenever the salary is null. A marginal rate of 1 or more is read as missing.
  - The SG fund is the non-archived fund with `receivesSg`.
  - A closed period whose Q is null is not a valuation point; it merges forward like a not-updated month.
  - Several override rows for one month add up.
  - A cap override of 0 is ignored, so the statutory cap applies.
- **Property:**
  - A loan's totals and schedule use the entries up to the balance in force at the as-of; a later entry stays in the log.
  - A zero balance gives a schedule of 0 payments, paid off at its balance date.
  - A property without a valuation, or a loan without an entry, is a programmer error (`RangeError`); the server always keeps at least one.

### 2026-09-26 - web

§6 is implemented in `apps/web/src/pages/{otherAssets,super,property,assets}/**`, the §6.2 hooks in `api/hooks.ts` (every §4.2 endpoint; `invalidateAfterAssetsChange`; the Stage 3, price and import invalidations also cover the three new keys), the Cash page changes in `pages/cash/{AccountForm,SavingsSection,CashPage,cashText}.ts(x)` and the styles in `app.css`. No frozen name, field or signature changed. Unit tests: `pages/{otherAssets,super,property}/*Page.test.tsx`, `pages/assets/display.test.ts`, `pages/otherAssets/assetDraft.test.ts`, `pages/property/propertyText.test.ts`, the Stage 4 cases in `pages/cash/CashPage.test.tsx`, `api/hooks.test.tsx` and `router.test.tsx` (the placeholder test moved to `/history`).

**Additive props (`packages/ui`, with tests):**
- `Meter`: `kind?: 'target' | 'cap'` (default `'target'`, the Stage 3 texts unchanged), `markerCents?` and `markerLabel?` (a white tick across the track; its figure is also in the figures line and the `aria-valuetext`), `tone?: 'go' | 'check' | 'stop'` (the fill; a cap also shows Under / Near / Over as a `StatusBadge`), and `valueLabel?` (words after the value, "so far"). The core index also exports `METER_TONE_WORDS`, `meterStatusText` and `MeterKind`.
- `Checkbox` and `Switch`: `labelSuffix?` (visually hidden words appended to the accessible name, "Still current, Example watch").
- `NumberField`: `labelHidden?` (as `MoneyField`'s, for the Price cells of Update prices).

**Additive, web-internal:** `SettingsSection` takes `placeholders` (the Super form's "Legal minimum: 12%" and "ATO: $32,500"); `AccountForm` takes `historyBeforeLastRun` (the FEAS-12 note), computed by `CashPage` from the account's balance entries on or before `lastRun`.

**Choices where §6 is silent (web-owned; reviewers may refine):**
- **Tables from 768 to 1199 px:** every assets table's first column takes `minWidth` 200 there (`pages/assets/layout.ts`, `useTableLayout`); the wide tables (assets, sales, funds, fund history, contributions, SG months, loan log) use 8 px cell padding and wrapping headers. A URL-named item's short name never wraps from 768 px (it wraps on a phone, where the sticky first column is capped at 11rem). A scratch Playwright probe with the fixtures found no page overflow, first columns of at least 200 px and no split words at 800, 1024 and 1199 px, and every "must fit" table without inner scroll at 1440 px (the assets table scrolls there, as allowed).
- **Other Assets:** the row actions sit as two pairs (Edit · Sell / Price history · Mark current), as the Stage 3 savings table's. Update prices sends a row whose price differs by value (`1800` and `1800.00` are the same) or whose Still current box is ticked. The price history's item Select lists every item; a bullion item's table lists the spot history × oz per unit.
- **Super:** the SG-fund picker is labelled "Fund that receives SG" in the callout and "SG fund" in the section bar. Editing an imported contribution allows Save as it stands (saving makes it typed). The option-note form offers this month and the 23 before it, plus any month that has a note or a period.
- **Property:** the balance log lists a loan's points oldest first, so the start point ("Loan start", no actions) is the first row; a loan's only stored entry has no Delete. When every stored entry's repayments are estimates, one foot-noted Estimate marker replaces the per-row badges (UX-12). The page's Update balances lists every loan (optional repayments per row; an empty field is left out of the body, so a new entry takes the estimate and an existing one keeps its figure); a loan card's Update balance does the same for one loan; Edit entry sends `repaymentsCents: null` when emptied (back to the estimate). The estimate placeholder counts `paymentDatesBetween(paymentAnchorDate, frequency, latest point before the date, date)` × the regular payment. The Payoff projection puts both schedules on one date axis: after a schedule's payoff its balance is 0; a date inside its range that only the other schedule has is "—" in the table and bridged by a straight line in the chart. The unlinked-offset callout's Link opens the offsets form of the first mortgage.
- **Cash (§6.6):** "Linked to <loan> (change it on the Property page)" / "Not linked to a loan: link it on the Property page." show while the account is an offset; switching Offset off on a linked account shows `Callout important` "This also removes its link to <loan>."; switching it on shows the FEAS-12 note when the account has a balance entry on or before the last recorded month.

**e2e drafts (for the Integrator, §7.8):** `e2e/assets-support.ts` (`ASSETS_PAGES`, `expectAssetsApi`, `cleanupAssetsRows`, `mockAssetsPage`, the 768–1199 and 1440 table lists and their helpers), `e2e/assets.spec.ts`, `e2e/assets-states.spec.ts` and `e2e/assets-mutations.spec.ts` (it skips outside an `assets-mutations` project, which the Integrator adds to `playwright.config.ts` with `dependencies: ['cashflow-mutations']`, and adds to the `desktop` and `phone` `testIgnore`). `e2e/import.setup.ts` should call `cleanupAssetsRows` before the import (§7.8 step 2). The drafts typecheck and lint, and ran green on the web agent's own stack (3184/5184, `seed:dev` generic data, fake market): `assets.spec.ts` and `assets-states.spec.ts` on desktop and phone (the 768–1199 and 1440 checks included), and `assets-mutations.spec.ts` under a scratch config naming its project (`hasAppData` false afterwards). They have not run on the synthetic import; one phone run hit a 30 s timeout on its first navigation to a page (a cold dev server) and passed on re-run.

### 2026-09-26 - integrator

Phase B (§7.8) ran on 3185/5185 with a fresh `artifacts/stage4/integrator/data`, `MARKET_DATA_MODE=fake` and the synthetic import. Both flags are true; the gated server suites (`test/assets/**`, the four Stage 2–3 real-engine suites, the three server goldens) and the engine and importer goldens ran, none skipped. No frozen name, field or signature changed.

**e2e (Integrator-owned):**
- `playwright.config.ts`: a new `assets-mutations` project (desktop viewport, `testMatch: /assets-mutations\.spec\.ts/`, `dependencies: ['cashflow-mutations']`), so the three mutating projects form one chain; `desktop` and `phone` ignore the setup and the three mutating specs through one `MUTATING_SPECS` list.
- `e2e/import.setup.ts` calls `cleanupAssetsRows` first, then the Stage 3 and Stage 2 clean-ups, then imports.
- `e2e/assets.spec.ts`: the 768–1199 px and 1440 px checks run twice, on the synthetic import (a table it lacks, such as sales, is left out) and on the `populated` fixtures through `mockAssetsPage`, where every listed table must be present, so sales and the URL-named item are always checked. The 768–1199 px check is one test per width (800, 1024, 1199), so a full parallel run stays inside the timeout. At 1440 px the assets and contributions tables, which may scroll, must keep a sticky first column (`SCROLL_AT_1440_TABLES` in `e2e/assets-support.ts`). These checks run in the `desktop` project only (the phone project skips them, as Stage 3's width checks).
- **Environment note:** on this PC (two VPN tunnels up) every full run lost about ten random read-only tests to `net::ERR_NETWORK_CHANGED` (Chrome aborting all in-flight requests at one or two moments per run; no OS address or route change was seen at those moments). Each such test passed on its one re-run, and the three mutating projects then ran in chain order and passed.
- `e2e/assets-mutations.spec.ts` also asserts the sale's realised gain (proceeds less the sold unit's cost) in the API and a row in the Sales table; the new contribution's type, date and a positive take-home cost (the synthetic workbook sets a marginal rate); and that linking the offset lowers the property's and the total loan to value and gives a positive interest saved.
- `e2e/records.spec.ts`: 27 record pages, `test.setTimeout(120_000)`, and the count asserted.

**Integration fixes in other owners' files (each listed in the Integrator's report):**
- **market-data, `apps/server/src/market/fxHistory.ts`:** only a (currency, date) pair that gave no rate (a request error, or no close on or before the date) now spends the day's attempt; a pair that gave a rate is forgotten (`FxBackfillAttempts.forget`, additive). Before, a filled pair also blocked the next asset with the same currency and purchase date (another item bought that day, or an item deleted and added again) until the next day: found when `assets-mutations` ran twice on one server. §4.6's once-a-day rule is about retries of pairs without a rate, so the rule itself is unchanged. New test in `apps/server/test/market/other-asset-fx.test.ts`.
- **schema fixture (server-api's post-scaffold file), `packages/schema/src/fixtures/assets.ts`:** `otherAssetsPages.populated`'s chart `costCents` rise by 29,000 cents on every point, as the engine owner reported: the oversold item's negative remaining units no longer count in the cost line (§2.4 steps 1 and 11, the engine's reading). No other fixture figure changed.

**Not changed (for the coordinator):** `apps/server/test/cli-import.test.ts` could assert the importer's four new `ENTITY_LABELS` (the importer's optional suggestion; the file has no Stage 4 owner, and the labels print correctly).

### 2026-09-26 - Fixer (round 1)

The 20 confirmed review findings were applied across owners. No frozen name, field or signature was renamed or removed; every contract change below is additive (pre-approved by the coordinator for this round). Each fix has tests.

**Contract and behaviour changes**
- **Offsets (SPEC-1, §2.9, §4.5):** `offsetCentsAt` (`apps/server/src/assets/inputs.ts`) counts an offset account with no entry on or before the latest run date at its **earliest entry's balance** when the account is `origin 'import'` (the workbook's Offset flag, untouched), and 0 otherwise (created or flagged Offset in the app). The seed's and the synthetic workbook's imported offset accounts now give a provisional Δ offsets of 0 right after an import. Known limit (added to §2.9): renaming a workbook-flagged offset account makes it `app`, so it counts 0 again.
- **Super dates (SPEC-2, §4.2, §4.5 step 5, §6.4):** `POST /api/super/funds` refuses (400 `asOf: date the opening balance after dd/mm/yyyy (the last recorded month), or mark it a rollover`) a non-rollover opening balance > 0 dated on or before the latest snapshot's run date. `PUT /api/super/balances` refuses (400 `entries.N.transferInCents: date a transfer in after dd/mm/yyyy (the last recorded month)`) a new or changed transfer in > 0 dated on or before the last run on a fund with `sheet_ref` null; an echoed, unchanged stored figure is allowed (so an entry's note can still be edited), and imported funds keep their closed-window transfers. Stage 5 should revisit this rule once recorded months hold app funds. `FundForm` takes an additive `lastRun` prop (from `SuperPageResponse.lastRun`) and shows the same error on As of.
- **Archived funds (CODE-4, §2.5 step 1):** while a fund is archived its latest balance stays 0: a balance save that would leave it non-zero (400 `entries.N.balanceCents: this fund is archived; unarchive it first`) or an entry delete that would (400 `archived: this fund is archived; unarchive it first`, exported as `ARCHIVED_ENTRY_DELETE`) rolls back. Older-dated entries and note-only edits stay allowed.
- **SG statement months (CODE-7):** `PUT` and `DELETE /api/super/sg/:periodMonth` answer 400 `periodMonth: must be on or after 01/1900` (exported `SG_MONTH_TOO_EARLY`) before `MIN_TRADE_DATE`'s month. The period-notes route is unchanged.
- **Joint bounds (CODE-1, `packages/schema/src/dto/assets.ts`, additive exports):** `OTHER_ASSET_OZ_MAX` (1e7), `productExceeds(parts, limit)` and `assetValueTooLarge(parts)` (true when the product × 100 is above `ORDER_VALUE_CENTS_MAX`; a null or unparsable part → false). `checkOtherAsset` adds `unitCost: units × unit cost is too large` (units × unit cost × the purchase FX rate, 1 for AUD) and, for bullion, `ozPerUnit: units × oz per unit is too large`; the create schema adds `price.unitPrice: units × price is too large`. The server adds `entries.N.unitPrice: too large for this item's units` to the prices PUT and `units: too large for this item's prices` to an update of a manual asset whose units (or price source) change, checked against the largest stored price entry, both before any write. The engine's per-row `RangeError` catch (optional) was not added: the bounds keep every figure inside safe cents.
- **Bullion switch (CODE-5):** an update from manual to bullion sets `unit_price`/`unit_price_as_of` null (never a bullion fallback); the manual price entries are kept, and a switch back restores the copy from them.
- **Migration 0004 (CODE-6, §3.1):** the first data statement skips a negative hand price (`AND unit_price NOT LIKE '-%'`), as the importer does; the JS mirror in `apps/server/test/migrations.test.ts`, the 0004 data test (a negative-price row) and the importer's migration-equivalence test (a negative-K variant, helper `withNegativeHandPrice` in `packages/importer/test/assets-helpers.ts`) follow. The migration was edited in place, not regenerated; scratch `DATA_DIR`s that applied the draft differ only for a database with a negative manual price (neither the synthetic nor the owner workbook has one).
- **Market import cycle (CODE-8):** the Yahoo suffix tables (`YAHOO_SUFFIX_CURRENCIES`, `YAHOO_SUFFIX_TIME_ZONES`, `currencyFromSymbol`, `timeZoneFromSymbol`) and the local-date resolver (`localDateResolver`, `localDateInZone`, `localDateWithOffset`, `LocalDateFn` and their private helpers) moved to the new `apps/server/src/market/providers/exchangeTime.ts`, which imports neither module. `providers/yahoo.ts` and `dividends/parse.ts` import from it and re-export the moved public names, so no import path changed and neither imports the other now (the market-data note's cycle is gone).
- **Goldens (SPEC-3):** §11 fix 25 and §9.3 rule 17 (`unpriced`) added; the server golden implements rule 17 (a manual row with a blank `K`: value, gain, ratios null, skipped `unpriced`; `D4`/`D5` recomputed without those rows). The engine golden's adapter keeps the sheet's 0 (comment only). The owner workbook has no such row, so the printed tallies are unchanged.
- **Privacy (PRIV-1):** `packages/engine/test/super.test.ts`'s rounding test uses a generic 400 take-home at 30 % (57,143 / 48,571 cents). The reviewer's suggested 250 at 37 % was not used: the code reviewer's numeric scan matched its 25,000 cents against a round figure in a private companion. The optional guard hardening (normalising `_` and `,` separators) was not done: it needs the coordinator's decision and allowlist entries.

**Web and UI (additive props, web-internal choices)**
- `Meter` (STYLE-1): `meterStatusText` takes an optional 5th parameter `markerCents`; a cap under its limit so far but projected over (or to) it reads "Projected over the cap by $X" ("Projected to reach the cap"); a cap's `aria-valuetext` starts with its status word ("Over. …"). The target kind's texts are unchanged.
- `Checkbox`/`Switch` `labelSuffix` (STYLE-9) is now the input's `aria-label` (label + suffix) instead of a visually hidden span inside the label (Chrome gave the name a stray space).
- History actions (STYLE-2): Price history, Balance history and Valuations announce in a new visually hidden `LiveRegion` "Page updates" on each page; the "Save result" region and its Saved callout are for saves only.
- Other Assets (STYLE-9, STYLE-10): in Update prices mode a hand-priced row's Price cell keeps its latest price date and markers under the field (desktop), "Still current" is in the body face, and bullion reads "Spot" in the body face. **Mark current moved into the Price cell** (a stale hand price, under its Stale marker); the Actions cell is Edit · Sell / Price history. The instruction to tighten the column widths until Sell fits at 1440 px could not work: the populated fixtures overflow the 1152 px content area by about 280 px (the URL-named item's short name stays on one line, and the Assumed badges and the FX line set their columns' widths), so from 1200 px the assets table's **Actions column is sticky at the right edge** (with a hairline while the table overflows), as the item column is at the left. Below 1200 px the table simply scrolls (two sticky columns would leave too little room). The e2e 1440 px test asserts a stale row's Mark current and Sell are inside the table's visible box.
- Super copy (STYLE-12, STYLE-13): every cap percentage uses `percentText` (one decimal: "33.0% used"); a negative Return per year is in the loss tint; the over-cap callout reads "Over the concessional cap by $X already. …" or "On track to go over the concessional cap by 30 June (N% of it). …"; a complete FY's meter reads "for the year"; the Employer SG tile's hint is "No SG this financial year" when no SG counted.
- Placeholders (STYLE-8): "Legal minimum 12", "ATO 32,500" and "Estimated 8,400.00 (3 payments)" (the fields already show %/$).
- Unmount-safe mutations (CODE-2, CODE-3): the loan delete (`LoanForm`), the SG-fund picker and the sales-table delete use `mutateAsync(...).then(...)`, the Stage 2–3 rule for a component its own refetch can unmount.
- 768–1199 px (STYLE-3): the Cap year and "No SG fund" cells are nowrap and the SG table's Fund column has a 120 px minimum; every Stage 4 note column (super periods, sales, contributions, fund history, loan log, valuations, price history) has a 120 px minimum at every width; the contributions table's "Toward the cap" words are nowrap. `e2e/assets-support.ts` gains `splitWordsInTable` (every body cell), called for every §6.8 table at 800, 1024 and 1199 px beside the first-column check.

### 2026-09-26 - Fixer (round 2)

D79 (review finding STYLE-4, the triage's option A): the provisional super gain is measured only up to the latest balances. No frozen name, field, signature or DTO changed; the web reads the measured end from the funds' existing `balanceAsOf`.

- **Engine (`packages/engine/src/super.ts`):** `balancesThrough` = the oldest latest balance (on or before `asOf`) among the non-archived funds (`asOf` when none has one). A provisional valuation period's `gainFlows` count SG (spread by days) and contributions over `(gainFrom, balancesThrough]` and transfers in over `(gainFrom, asOf]`: a transfer sits on a balance entry the value already holds, so leaving out one dated after another fund's older balance would show the whole transfer as a gain (D79 names SG and contributions only). The window's `flows`, `snapshot.superContribCents` (the savings engine's input) and the chart's flow series still run to `asOf`. Change − SG − yours − transfers = Gain still holds on every row; `gainRatio` and `returnRatio` use the same corrected flows; a not-updated provisional period and every closed period are unchanged. The annualised chain ends at the last chained period's measured end (`annualised.through`/`days` stop at `balancesThrough` when the provisional period is chained), so Return per year does not drift either. `flowsOver` takes an optional third parameter (the transfers' end). `types.ts`: the `gainFlows` doc comment says so.
- **Known limit (the single-date rule):** when the open funds' latest balances fall on different dates inside the provisional window (a fund opened on its own date, or one fund's balance updated later than another's; Update balances sends only the funds whose balance changed), the SG and contributions of the fund updated later, between the two dates, stay out of the gain until the next update, which overstates the gain for that stretch. A per-fund cut-off would remove this, but it has no single "to" date for the tile.
- **Engine tests (`packages/engine/test/super.test.ts`):** the provisional period's `gainFlows` now run to 15/07 (SG 58,065 / 49,355), its `flows` to the as-of; `annualised` through 15/07, 106 days. New `describe` "the provisional gain measured to the latest balances (D79)": a balance five weeks before the as-of gives no later SG or contributions in the gain (the same gain, ratios and flows as on 20/07 and on the balance date); the savings flows, `superContribCents` and the chart still run to the as-of; the oldest open fund's balance sets the end, an archived fund's does not, and every row adds up; a transfer dated after the oldest balance still counts; a not-updated provisional period and the closed periods are as before; the chain uses the corrected return and ends at the balance date. The transfer-in test dates the added fund with the latest balances (15/07), and the rollover test's emptied fund gets its 0 on the 15/07 update too (an older latest date would move the measured end).
- **Fixtures (`packages/schema/src/fixtures/assets.ts`):** the funds' latest balances are 20/09, four days before the as-of, so the provisional `gainFlows` SG becomes 106,667 / 90,667 (was 128,000 / 108,800) in populated, noSgFund, capOverride and capOverrideLastFy (spread from populated), noMarginalRate and overCap, with their gain, `gainRatio`, `returnRatio`, the live chart point's gain and return, and `annualised` (through 20/09, 173 days); noSalary (no SG) changes only `annualised` (through 20/09, 173 days, its return per year). Every super fixture was recomputed with `computeSuper` from its own rows and matches the engine field for field; notUpdated, empty and noSnapshots are unchanged. `packages/schema/test/assets-fixtures.test.ts`: the provisional row checks the D79 rule (member flows = the rows dated to the oldest open-fund balance, transfers to the as-of, SG ≤ the window's, `annualised.through` = that date) instead of `gainFlows = flows`; History T is checked from the gain within half a cent (the SG part is now fractional); the super states test asserts populated's balances predate the as-of.
- **Server test (`apps/server/test/assets/integration.test.ts`):** "a fund added after the last recorded month changes no period's gain" opens the temporary fund on the as-of (with the latest balances) instead of 15/08, which under D79 would move the measured end back.
- **Web:** `gainMeasuredTo(funds)` in `superText.ts` (the oldest `balanceAsOf` of the funds not archived, the engine's rule); the Latest gain tile's hint for the provisional period is "Sep 2026 · to 20/09/2026" (`formatDate`, STYLE_GUIDE §8); a closed period's hint is unchanged. `SuperPage.test.tsx`: the populated tiles ($293, "Sep 2026 · to 20/09/2026", 7.2%, "since Mar 2026 · 173 days"), a new test (the oldest open fund's date, an archived fund's older date ignored) and the not-updated case shows no "to" date.
- **Plan:** §2.5 step 4 (the Gain bullet) states the D79 rule; step 5's `through` is the provisional period's measured end; §6.4 item 2 gives the tile's "to dd/mm/yyyy" hint.
- **Goldens:** unchanged (the owner's provisional period is not updated, so its figures do not move); every printed golden tally is identical before and after.

## Stage close notes (coordinator)

**Outcome (2026-09-26).** The flow ran in three workflows plus two single-agent steps:
1. Planner → 3 plan critics → reviser.
2. The owner answered the plan-review questions by accepting every proposed default (D74–D78). The coordinator applied them to the plan (no amender was needed) and ran the pre-step.
3. Scaffolder → engine, server-api, market-data, importer and web phase A in parallel → Integrator.
4. 3 reviewers → per-reviewer adversarial triage → Fixer → Verifier.
5. Fixer round 2 for the owner's review decision D79.

The owner approved the demo on the real database after a fresh backup (D74) and accepted all 25 §11 fixes (D80).
- **Final state:**
  - typecheck, lint, format:check, build and `guard:all` are green. The guard has 3149 private terms.
  - **3207 unit tests** pass (170 files) with none skipped. Every golden file ran: engine assets, cash flow, history and investments; importer (plus the migration-equivalence test); server assets, cash flow and investments. The four Stage 2–3 real-engine suites re-gated on `ASSETS_ENGINE_IMPLEMENTED` ran.
  - **e2e:** every test passed after the one allowed re-run of the `net::ERR_NETWORK_CHANGED` failures; the skips are by viewport design. The `mutations`, `cashflow-mutations` and `assets-mutations` projects ran in chain order.
  - The Verifier passed every §10 item except the scratch numeric scan (#14); see the privacy note below. The owner-import API checks matched the private companion in full, the migration converted a copy of the pre-stage backup exactly as the private §6 says, and the D34 matrix passed.
- **Plan review:** the critics raised 60 findings; 52 were applied, 8 applied in part and none rejected. The owner's answers are D74–D78.
- **Code review:** 27 findings. Triage sent 20 to the Fixer (all fixed, each with a test), deferred 5, refuted 1 and raised 1 owner decision (STYLE-4, answered as D79 and applied by Fixer round 2).
- **Demo:**
  - Migration 0004 converted the owner database on the first start; `hasAppData` stayed false throughout.
  - The owner marked the SG fund from the callout's select (a flag-only, import-safe edit).
  - Other assets valued bullion at live spot; super, property and the Cash page's provisional period matched the private §7 figures.

**Demo fix (coordinator).** After the SG fund was saved from the `no_sg_fund` callout, the Funds section header's picker still showed "Choose a fund" until a reload: `SgFundPicker` copied the saved fund into local state once, at mount. It now follows the saved fund until the user picks another (`choice` is null until then, and reset after a save). The late-refetch test in `apps/web/src/pages/super/SuperPage.test.tsx` now also checks the header picker; it fails without the fix.

**Privacy note (§10 #14).** `pnpm guard:all` passes. The code reviewer's scratch numeric scan (every private number with ≥ 4 significant digits, matched as a word) found three exact matches in the change set. The coordinator checked each and all are coincidences, not copied owner values: a generic test amount equal to the digits after "0." in a private ratio, a fixture total that is the sum of the same object's round components, and a generic FX close equal to a Stage 2 figure. They were left unchanged. The rest of its hits were round figures, ports and constants.

**Clarifications accepted by the coordinator:**
- Fixer round 2 (D79): transfers in still run to the as-of (a transfer sits on a balance entry already inside the value), and the return per year also ends at the measured balance date.
- Fixer round 1: STYLE-10 moved Mark current into the Price cell and made the assets table's Actions column sticky from 1200 px; PRIV-1 used different round test inputs than suggested, because the suggested one hit the numeric scan.

**Deferred (with target stage):**
- **Stage 5:**
  - Recording months: carry the super flows after the measured balance date into the next period (D79), and store the offset figure in recorded months (§11 fix 7, D78). Compose the live snapshot from `assetsSnapshotColumns`.
  - D79's one-date rule: when open funds' latest balances fall on different dates, the later fund's SG and contributions between the two dates are left out until the next update. Consider a per-fund cut-off when months are recorded.
  - Carried from Stage 3: the import-origin settings row on re-import; recording a month.
- **Stage 6 polish:**
  - STYLE-5: an all-zero chart draws one $0 point with repeated axis labels instead of the empty state (the shared compact money formatter).
  - STYLE-6: the Stage 0 key–value label column splits long uppercase labels mid-word at 375 px.
  - STYLE-7: phrase rows and number rows mix alignment in the loan card's key–value table.
  - STYLE-11: some chart table views are wider than their half-width cards and scroll, with the sticky column over the next header.
  - CODE-9: small duplicated date and sum helpers across server modules.
  - Privacy guard hardening: numbers written with `_` separators or thousands commas in code comments slip past the term match (PRIV-1). The reviewer's scratch separator scan covers it for now.
  - Carried from Stage 3: STYLE-13, STYLE-15 and the chunk-size warning.
- **Stage 7 cutover:** correct the mortgage payment (and the compounding frequency, if needed) in the sheet before the fresh export (D76); optionally add purchase dates to undated items in the sheet (D73); the budget rows' stale account names (D65).

**Lessons carried forward:**
- Checking the demo action's side effects on the rest of the page found a stale-state bug that no reviewer saw: after an action in one place, check every other control that shows the same value.
- Playwright's `--last-failed` also re-runs the mutating tests that never ran, and with `--no-deps` they overlap. Re-run only the desktop and phone projects, then the mutating projects one at a time in chain order.
- A scratch numeric scan that matches digits after a decimal point reports coincidences; triage its exact matches by hand before changing test values.

## Plan review log (2026-09-26)

Three critics (spec, feasibility, UX/privacy) reviewed this plan and the private companion. The plan reviser verified each finding against the code, the specs, the decisions and the local workbook (scratch under `artifacts/stage4/plan-reviser/`, plus re-runs of the critics' probes: the amortisation and formula probes, the migration probe and the private-number scans), then applied it, applied it in part, or rejected it. Findings are numbered in the order received, with the critic's id in brackets; the owner-specific consequences (recomputed expectations, counts, guard terms) are in the private companion. None was rejected outright; eight were applied in part. Two consistency fixes were made while revising: the super "Into the fund" chart now stacks SG and your contributions as the fund received them (parts of one total), and the cap meter's imported part is the Σ of the rows' rounded pre-tax, so the page adds up. **Owner questions, answered 2026-09-26 (every proposed default accepted, D74–D78):** how the demo runs (real `data/` after a fresh backup, re-import-safe actions only); how imported contributions are read (salary sacrifice); the SG fund (chosen at the demo); the stale-price days (90); the mortgage's actual repayments (kept as an estimate); whether a changed repayment re-estimates past entries (yes); showing assumed-date annualised returns (yes, marked Assumed); §11 fix 7 (applied); and counting SG for the cap when the fund receives it (yes).

| # [critic id] | Finding (generic) | Outcome |
|---|---|---|
| 1 [SPEC-1] | Pointing the shared finance context at the new engine calls would turn the Stage 2–3 real-engine server suites red while the stubs throw, so server-api could not finish green | **Applied in part:** the four real-engine suites gain `ASSETS_ENGINE_IMPLEMENTED` in their gates (item 21), and §7.4 states that every ungated Stage 2–3 suite stays green at server-api's done-check and that the gated ones must have run once the flag is true. A fallback path to the Stage 3 static inputs, or stubs returning Stage 3 values, is rejected: dead code to delete later, and neutral stubs would hide wiring faults (§2.2, §7.1, §7.4, §7.8, §10 #2) |
| 2 [SPEC-2] | The balance log counted payments on a grid anchored at the loan start, while the schedule started a new grid at the balance date, so payoff and next-period interest disagreed with the log | **Applied:** one anchored grid; `amortise` takes `anchorDate` and `balanceDate` (the first payment is the first grid date after the balance) and reports `firstPaymentDate`; points yearly from the first payment; private expectations recomputed (§2.2, §2.3, §2.6, §2.7, §11 fix 2) |
| 3 [SPEC-3] | The golden adapter did not set the chart count, so the default 12 groups dropped the first snapshot and the history-area counts could not match | **Applied:** the adapter passes a monthly chart with a count of snapshots + 1 (§9.1) |
| 4 [SPEC-4] | Sheet mode needed a payment that is not whole cents; the rounding was unstated and the NPER check used the unrounded payment | **Applied:** the payment is rounded half away from zero to whole cents and the ⌈NPER⌉ helper uses the same payment; the private reference schedules were recomputed with whole-cent payments (§2.7, §9.1, §9.3 rule 10) |
| 5 [SPEC-5] | Several definition differences had no runtime rule: a dated foreign row's annualised return, zero denominators (error, IFERROR 0, "-"), retirement-tagged holdings in the super total and in History R, and the Stage 3 interest condition that holds only for a non-negative interest sum | **Applied:** new rules 14 (`fx_included`, recomputed from the sheet's own AUD cells), 15 (zero denominators match the engine's null), 16 (`retirement_tagged`: the total without the auto lines; R less the tagged buys, the importer's rule), and rule 12 narrowed to a negative interest sum; the importer excludes tagged buys with an info line; counts are 0 on the owner workbook (§3.5, §9.1–§9.3) |
| 6 [SPEC-6] | The Net Worth start-balance cell was claimed to reproduce but was in no golden area | **Applied:** compared with the negated start balance in the Property area (engine and server goldens); the two neighbouring cells are asserted as formula aliases, not counted; private counts updated (§9.2, §9.4) |
| 7 [SPEC-7] | The Σ-of-rounded-rows tolerance was unsafe for per-window flows and for sums of gains that carry two roundings per row | **Applied:** window flows use the Σ-of-n rule with n = the flows in the window; sums of gains allow n cents (§9.5) |
| 8 [SPEC-8] | One flag and one count covered both a missing purchase-date rate (cost unknown) and a missing live rate (value unknown), and the callout mislabelled the second | **Applied:** `purchase_fx_missing` and `live_fx_missing`, with `fxMissingCount` and a new `liveFxMissingCount`; the purchase-rate callout counts only the first, a separate note covers the live rate, and market-off replaces it (§2.2, §2.4, §3.2, §4.4, §6.3) |
| 9 [SPEC-9] | The cap meter counted SG in the month earned, but the ATO counts contributions in the year the fund receives them; the Payday Super transition year gets an extra quarter | **Applied in part (owner confirmed, D75):** the cap counts SG when received (a quarter on its due date before 1 July 2026, the month earned after), so the transition year includes the April–June 2026 quarter; the meter explains it. Statement months stay keyed by the month earned (as a payslip shows), not the month received as proposed, so estimates and statements share one model; the gains keep the earned-month spread. Verified from ATO and adviser search summaries (§2.2, §2.5 step 7, §3.2, §3.3, §6.4, §11 fix 24, §12) |
| 10 [SPEC-10] | The SG estimate applied today's rate to every past month; the maximum contribution base and salary history were not listed as not built | **Applied in part:** a statutory SG table by FY drives every month; the rate setting becomes "your employer's rate" applied to every month (not an override for one FY, since an employer's rate is not year-bound); the contribution base, salary history and early-paid SG join §1.5 (§1.5, §2.2, §2.5 step 3, §3.2, §3.3) |
| 11 [SPEC-11] | The cap override had no FY, so it silently carried into the next year | **Applied** (with item 43): a server-written companion key stores the override's FY; the override applies only to that FY's row, and the page says when it no longer applies (§2.2, §2.5, §3.3, §4.4, §4.5, §6.4) |
| 12 [SPEC-12] | The importer derived History contributions from every frozen row, the migration from the kept snapshots, so a duplicate month diverged | **Applied:** the importer uses the kept snapshots (one per month); tests with the synthetic duplicate-month variant (§3.5, §7.6) |
| 13 [SPEC-13] | The reconciliation said a foreign row is valued through the imported purchase rate, which gives the cost only | **Applied:** value and gain are checked through the sheet's own live rate, the cost through the imported purchase rate; rows without the cached value stay info (§3.5) |
| 14 [SPEC-14] | Imported loans got a start entry but app-created loans did not, and editing the start fields left a stale entry | **Applied in part (another way):** no start entry is ever stored; the engine builds the log's start point from the loan's start fields, so app-created and imported loans with the same fields give the same log and edits follow; the importer, migration, seed and counts drop the start entries (§2.2, §2.6, §3.1, §3.4, §3.5, §3.6, §4.4, §6.5) |
| 15 [SPEC-15] | Default repayments were recomputed from the current payment, so changing it rewrote every past estimate without saying so | **Applied in part (owner confirmed, D76):** re-estimating is the stated default, with a loan-form note, a Not built entry for a payment history and engine tests for both typed and default entries; per-entry stamped payments are the alternative offered to the owner (§1.5, §2.6, §6.5, §12) |
| 16 [SPEC-16] | Imported fund and loan balances unchanged since the last snapshot were dated at the workbook as-of, so a later partial update looked like a full one and a payment could be counted against an unchanged balance | **Applied:** the importer and the migration date them at the last run date when the live total equals the last frozen row's (funds by Σ, property loans by Σ), with tests; the denormalised dates follow (§3.1, §3.5, §7.2, §7.6, §9.1) |
| 17 [SPEC-17] | Adding a fund's opening balance, or archiving a fund, read as gain or loss in the period gain | **Applied in part:** balance entries carry a transfer-in amount (not a gain); an app-created fund's opening balance is a transfer unless marked a rollover; archiving needs a closing balance of 0; tests that adding a fund leaves the gain unchanged. A per-fund period gain is rejected: closed periods hold totals only, and imported funds dated after the last run would lose their gain (§2.2, §2.5, §3.1, §3.4, §4.3, §4.5, §6.4) |
| 18 [SPEC-18] | The uncommitted decision log said the fund-received amount counts toward the cap, contradicting D70 and the plan | **Applied in part:** the plan keeps the pre-tax amount toward the cap; correcting the decision log's wording is added to the coordinator pre-step (the reviser does not own that file) (§7.0) |
| 19 [SPEC-19] | A Stage 3 engine test compares whole period objects, so adding the offsets field breaks it | **Applied:** listed among the Scaffolder's expectation fixes; §7.3 now says the Stage 3 savings figures are unchanged (§2.9, §7.1, §7.3) |
| 20 [SPEC-20] | The offsets acceptance check had no expected values | **Applied:** the private companion gives the offset amount and every expected figure (net balance, LVR, equity, schedules, interest saved, months saved, the provisional offsets part), computed on the anchored grid with whole-cent payments (§10 #10) |
| 21 [FEAS-1] | Same issue as item 1; one affected golden had no owner | **Applied:** server-api is pre-authorised to gate the four suites (it owns their gate lines, including the investments golden's); §10 #2 and the Integrator confirm they ran (§7.1, §7.4, §7.8, §10) |
| 22 [FEAS-2] | Appending editable settings keys changed the derived Cash page key list, the settings response slice and the patch-size limit | **Applied:** the Cash page keys become an explicit list (a Scaffolder fix), the response slice covers every named page (server-api owns the responses file), the patch limit rises to 30, and the schema tests are listed (§3.2, §3.3, §7.1, §7.2) |
| 23 [FEAS-3] | The purchase-date FX backfill had no path to an HTTP client or the fake/live switch inside market-data's files | **Applied:** an optional FX-closes client on the providers object (Yahoo and fake implementations, built with the other providers); absent → the backfill is skipped, so existing literals compile; market-data owns the builder, job detail and status lines (§4.6, §7.1, §7.5) |
| 24 [FEAS-4] | Adding the option-note kind broke the Stage 3 note helper and a route test | **Applied:** the note helper returns every editable kind; the recorded-period rule stays for the Stage 3 kinds; the route test is a Scaffolder expectation fix (§4.5, §7.1) |
| 25 [FEAS-5] | The Scaffolder's forced-fix list missed several files its own changes break | **Applied:** the engine savings test, the Cash page test, the route test, the settings tests and the upgrade tests' expected dumps are listed, each handed back to its owner (§7.1, §7.2) |
| 26 [FEAS-6] | The e2e placeholder swap would duplicate a route already listed | **Applied:** the swap uses another Stage 5 placeholder route; the router test moves with it (§7.1, §7.2, §7.7) |
| 27 [FEAS-7] | The duplicate-month rule and the migration's contribution-date fallback broke import/upgrade equivalence | **Applied:** item 12's rule; the date falls back to the latest import run's workbook as-of, then fund and cash-account dates; equivalence tests on both variants (§3.1, §7.2, §7.6) |
| 28 [FEAS-8] | Same as item 8 | **Applied** (item 8) |
| 29 [FEAS-9] | The backfill had no retry policy, so a permanently missing close kept every run partial and starved later items | **Applied:** a per-(currency, date) attempt time, retried at most once a day, repeats counted skipped, least recently attempted first (§4.6, §7.5) |
| 30 [FEAS-10] | The web needed payment-date counting and yearly contribution sums that no DTO carried | **Applied:** a pure payment-date helper in the schema package shared by engine and web, the loan's anchor date in its DTO, and member sums per cap year (§2.2, §2.3, §3.2, §4.4, §6.2, §6.5) |
| 31 [FEAS-11] | The purchase-FX update rules contradicted each other for an echoed rate after a date or currency change | **Applied:** after such a change an echoed rate counts as not typed and is re-fetched; the form blanks the field (§4.5, §6.3) |
| 32 [FEAS-12] | Recomputing offset balances for closed periods under today's flags would double-count a newly flagged account | **Applied in part:** only the provisional period gets a Δ offset (the latest snapshot's figure from balance entries, earlier ones null; Stage 5 stores the figure); the remaining case (flagging an account with history) is documented and the Cash page warns when the flag is switched on (§2.8, §2.9, §4.5, §6.6, §12) |
| 33 [FEAS-13] | The CLI import summary would not label the new counted entities | **Applied:** the importer owns the labels map only (§3.5, §7.1) |
| 34 [UX-1] | The Stage 3 meter reads a cap as a savings target, has no projection marker, and the KPI mixed "so far" with a projected status | **Applied:** additive cap props (texts, a projection tick, tones) with tests; the KPI reads used and projected together; the meter marks estimates (§2.2, §4.4, §6.1, §6.4) |
| 35 [UX-2] | Two series shared a palette slot and a legend order did not follow the slots | **Applied:** slots in order per chart, legends in slot order, a web test on series colours (§5) |
| 36 [UX-3] | The mortgage history chart mixed a line with areas on one axis, which the chart components cannot draw and which flattened the small series | **Applied:** two cards, a balance line and a stacked "repaid so far" area; no second axis (§5, §6.5) |
| 37 [UX-4] | Phone column orders left the status badges off-screen | **Applied:** on phone every row's markers render in the first cell; a phone test checks each (§6.8) |
| 38 [UX-5] | A description that is itself a URL was shown raw as the item name and repeated as a link, breaking the first-column width rules | **Applied:** a short host-and-path name ellipsised, one link, the full URL only in accessible text; the stored description unchanged; a URL-named fixture row and the e2e width check (§3.6, §6.3, §6.8) |
| 39 [UX-6] | An unchanged hand price could not be marked current, so a stale badge stayed | **Applied:** a "Still current" box in the update mode and a "Mark current" row action, with a test (§6.3) |
| 40 [UX-7] | Same issue as item 30 (the new-entry estimate placeholder) | **Applied** (item 30) |
| 41 [UX-8] | Two Super tiles had no DTO fields and the contributions headline hid estimates | **Applied:** cap years carry the member sums, the SG to the fund, its source and an estimate count; the tiles show the pre-tax total with its hints and the estimate marker (§2.2, §4.4, §6.4) |
| 42 [UX-9] | A missing marginal rate silently removed contributions from the savings rate | **Applied:** a callout, "—" with its reason, form hint text and a fixture state (§3.6, §6.4, §6.9) |
| 43 [UX-10] | Same as item 11 | **Applied** (item 11) |
| 44 [UX-11] | The periods table's contribution columns did not say which figure they showed, and merged rows did not add up | **Applied:** periods carry the change and the flows over the merged window; the table shows the to-the-fund figures and adds up exactly (the gain is the change less the rounded flows); a web test checks every row (§2.2, §2.5, §4.4, §6.4) |
| 45 [PRIV-1] | The proposed guard terms held owner ratios at 10 significant digits, which never match the 12-digit API strings | **Applied:** the 12-digit forms (and missing 4-digit and percent forms) are appended to the private term block; the guard passes with the combined list |
| 46 [PRIV-2] | Several displayed forms of owner figures were missing from the guard terms | **Applied:** the missing whole-dollar, month-label, rate, 1-dp percent and derived-cents forms, plus every figure the review changed, are appended; one percent skipped earlier only for the lockfile is now kept |
| 47 [UX-12] | Status badges were used for non-states, the same idea had three forms, and unpriced collectibles got an alarming red badge | **Applied:** one definition of each marker (pending for Assumed and Estimate, recorded for Statement, a muted pill for no price), one word, column-level markers when every row shares one; no Manual badge on these rows (§6.1, §6.9) |
| 48 [UX-13] | The assets table had no per-row cost and no unit of measure | **Applied:** a cost column and total, units with their unit; phone order updated (§6.3, §6.8) |
| 49 [UX-14] | Several form details misled (the pence rate, the FX line's direction, the price currency, stored choices outside the lists, bullion currency) | **Applied:** the pence rate asked per pound and divided, a directional FX line, currency suffixes, stored values always offered, bullion locks the currency and hides the price and FX fields (§6.3, §6.5) |
| 50 [UX-15] | Two-decimal rates conflicted with the style guide's one-decimal percentages | **Applied:** an explicit, tested exception for interest, SG, contributions-tax and marginal rates only (§6.1) |
| 51 [UX-16] | Some tile rules left gaps or repeated figures | **Applied:** the bullion tile always shows (with the metals held or "No bullion held"), the gain hint shows the ratio, the mortgage hint only with offsets, several loans show the latest payoff (§6.3, §6.5) |
| 52 [UX-17] | The pages never said where entities are deleted | **Applied:** the Stage 3 pattern, delete in the edit form with its disabled reason; log rows confirm in their actions cell (§6.3–§6.5, §6.7) |
| 53 [UX-18] | "History" meant two things and the row actions gave no focus cue | **Applied:** renamed actions and section bars; the action scrolls, focuses the card heading and announces it (§6.3–§6.5) |
| 54 [UX-19] | Forms could show both the workbook callout and the new-app-data note | **Applied:** one or the other, never both, with tests (§6.7) |
| 55 [UX-20] | The mid-width check covered too few tables and no wide-screen rule was set | **Applied:** the check runs on every table whose first column holds a name or date; at 1440 px each table is either required to fit or allowed an inner scroll (§6.8, §7.8) |
| 56 [UX-21] | The LVR chart mixed gross and net points unexplained, and two labels misdescribed their figures | **Applied:** a foot note when offsets exist; "next repayment's interest" with its date; the imported-figure label follows how it was derived (§5, §6.5) |
| 57 [UX-22] | The Property page's primary action was the rarely used one | **Applied:** "Update balances" (every loan, a shared date) becomes the primary action (§6.5) |
| 58 [UX-23] | The contributions amount column mixed pre-tax and take-home figures and edits pre-filled the wrong one | **Applied:** a pre-tax column, "non-concessional" for after-tax rows, and edits pre-filled with the current reading and the imported figure shown (§6.4) |
| 59 [UX-24] | Choosing the SG fund, the demo's import-safe action, needed the full fund form | **Applied:** a fund select with Save in the callout and the section header, sending the flag only (§6.4, §6.7, §10) |
| 60 [PRIV-3] | The committed plan stated facts about the owner's workbook (which cells are blank, how many cells differ, a measured drift) | **Applied:** reworded generically; the observations moved to the private companion (header, §9.3 rule 6, §9.5, §11 fix 1). While revising, one example rate that matched an owner figure was also replaced |
