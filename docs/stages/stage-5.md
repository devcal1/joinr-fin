# Stage 5 — History, Net Worth dashboard & Settings: build plan

_Planner output, 2026-09-26. Inputs: PLAN.md (Architecture, Stage 5, Stages 6–7 for deferrals), docs/HANDOFF.md (the state at the end of Stage 4, the Stage 5 next step and the deferred items), docs/STAGE_PROCESS.md, docs/DECISIONS.md (D81–D88 are the Stage 5 kickoff answers, D89–D95 the owner's answers to the plan-review questions; D2, D29, D34, D37, D41, D51, D52, D56, D58, D59, D61, D66–D79 still bind), docs/stages/stage-4.md in full (structure, frozen-contract style, Scaffold notes, close notes and their "Deferred" list, the plan review log; §2.8 the seam `assetsSnapshotColumns`), docs/stages/stage-3.md (the savings engine, the provisional period and its month rule, `EDITABLE_SETTING_KEYS`, the D34 settings gap rules), spec 01 (History, Net Worth, WorkingSheet/`compressTable`, SheetOptions: the source of truth), specs 02–04 for the snapshot columns, docs/style/STYLE_GUIDE.md, the Stage 0–4 code, and the local workbook (read with the workspace's SheetJS through `@joinr/importer`'s reader in scratch scripts under `artifacts/stage5/planner/`)._

> **This repo is PUBLIC.** Nothing from `reference/` (except `reference/brand/`) or `docs/private/` may be copied into any other file: no amounts, balances, net worth figures, savings rates, allocation shares, salaries or tax figures, no holdings, funds, lenders, accounts, properties, notes or businesses the owner has, no addresses, IPs, emails, Drive ids. Code, tests, seeds, fixtures and committed docs use only generic values ("Example Super Fund", "Example property", round numbers). The owner-specific facts for this stage are in **`docs/private/stage-5-private.md`** (git-ignored): the engine, server-api, recorder and importer implementers, the spec reviewer, the code reviewer and the Verifier read it; nobody copies from it.
>
> **Golden tests never contain owner values:** they read every expected value from the local workbook at runtime and skip when it is absent (§9). **No snapshot files** (`toMatchSnapshot` & co.). The guard also blocks any committed path with a folder segment named `data`.

**Flow:** Coordinator pre-step (guard terms incl. rounded forms, a `data/` backup, §7.0) → **Scaffolder** (alone; must pass its done-check, §7.2) → 5 implementers in parallel (**engine**, **server-api**, **recorder** (the month-end scheduler with an injectable clock, the start-up catch-up and the record mutex), **importer** (D87 and the schema follow-ups), **web phase A**) → **Integrator** (web phase B + e2e; starts when engine, server-api, recorder and importer have reported done, §7.8) → Reviewers in parallel (**spec-correctness**, **style-ux**, **code-quality/security**) → per-reviewer triage → **Fixer** → **Verifier**. At most 10 agents per workflow: the build workflow has 7 (Scaffolder, 5 implementers, Integrator), the review workflow 6 (3 reviewers, triage, Fixer, Verifier). **Nobody commits or pushes.** The coordinator commits at stage close with the owner's OK (D10).

**Golden values:** template cell references only (§9); the values are read from the workbook at runtime. The live History row and every TODAY()-dependent cell are compared at the workbook's as-of (`Net Worth!E52`), which the adapter reads from the workbook. Cells whose app definition differs by decision (D52, D61, D83, D88) or by a §11 fix are compared through a sheet-faithful variant where one exists, otherwise skipped with a counted reason (§9.3). **Template bug fixes applied in Stage 5:** §11 (vetoable at the plan review or the demo).

**Verified by the Planner against the workbook (2026-09-26, scratch scripts).** With the workbook's cached values and its as-of dates (`Net Worth!E52`, `C51`):
- **History derived columns:** on every frozen row, `D`, `H`, `L`, `P`, `T`, `AE`, `AH` = `IFERROR(gain / (value − gain), 0)` of their own row, `Z` = `X + AB`, and from the second row `O` = `N − N_prev` (the first row's `O` is a typed seed); every one reproduces from the raw doubles. **From the imported integer cents** (the database the app will check), the same rules reproduce every cell under the §2.5 tolerances (a ratio `r` matches when `|r × (v − g) − g| ≤ 1 + |r|` cents; `O` and `Z` within 1 cent).
- **The rolling net-worth table** `Net Worth!K2:T` is an array over History: `L` = `B + F + J + N + AF + AJ` (blank when the date is after `EOMONTH(TODAY(), 0)`), `M` = `Q`, `N` = `−|U| − |AB|`, `O` = `X`, `P` = `L + M + N + O`, `Q` = `ΔP`, `R` = `ΔL`, `S` = `Cash!M`, `T` = `L` while data exists (else `T_prev + I1/12`), `U` = the Cash spend notes. Every frozen row's `L`–`R`, `T` reproduces; `P` computed from the imported cents is within 1 cent of the cached value on every row. The live row's `L` can carry a tab's broken cached total (the Stage 2 `broken_total` rule), so it is not compared.
- **WorkingSheet** holds three `compressTable` blocks the charts read: the History block `E:AO` (`End` for values, gains and ratios; `Sum` for the four movement columns, `R` and `W`), the Cash block `BA:BI` (`End` cash, `Sum` gain, added and savings, `Average` gain %, rate and spend; `BH` is `#ERROR!`), and the Net Worth block `BN:BW` (`End` for everything except `Sum` for `BT`/`BU` and `Average` for `BV`). With the workbook's own `H60`/`H61` (monthly, 12) each group is one month, so every frozen group equals its History / rolling-table row. Labels are full month names (e.g. "March 2024"); quarterly and yearly label formats cannot be observed.
- **Net Worth `B2:E23`:** `C4:C11` link the tab totals, `D4:D11` the tab gains (`D8` = `Cash!C17`, the latest cash change), `E5:E13` = `IFERROR(D/(C − D), 0)`, `C12` = `ΣC4:C11`, `C13` = `C12 − C10`, `D15` = `C12 + E23` (net worth), `D16` = `ΣC4:C9` (liquid), row 20 = LiabilitiesDebts, row 21 = `−|ΣProperty!D28:O28|`, `|F11|`, `−|F10|`, row 22 a spare manual row, `E23` = `ΣE20:E22`; `I1` = `Cash!C20 × 12` (a dollar amount labelled a rate); `C20` = `AVERAGEIFS(Cash!N, H ≥ MAX(C51 − 365, Budget!D2))` has no upper date bound, so it includes the live row (the plan review's SPEC-1: the golden compares `I1` through a closed-row recomputation, §9.3 rule 8). `WorkingSheet!C4:C11` (the distribution pie) = the class totals with Property = `F7 + F10` (net equity).
- **The sheet's gauge** reads `Cash!C38` = `AVERAGEIFS(M, H, ≥ 1 Jan of YEAR(C51), < 1 Jan of the next year)`: a simple mean of monthly rates over the **calendar** year of the last run.
- **SheetOptions `A61:B67`** holds a stale 2019–20 ATO table referenced by no formula; `L28` (ID 26, "Tax Bracket") is the marginal rate the app stores as `tax.marginalRate`.
- **ATO figures** (§3.3; recorded 2026-09-26 from web-search summaries of ato.gov.au and adviser pages, because the ATO site refuses automated fetches): resident rates for 2024–25 and 2025–26 are nil to $18,200, 16 % to $45,000, 30 % to $135,000, 37 % to $190,000, 45 % above; **from 1 July 2026 the 16 % rate is 15 %** and **from 1 July 2027 14 %** (legislated by the 2025 cost-of-living tax cuts; the thresholds are unchanged); the Medicare levy is 2 %, with a low-income reduction: no levy up to the singles threshold ($27,222 for 2024–25; **$28,011 for 2025–26**, a 2.9 % increase legislated retrospectively to 1 July 2025) and 10 cents per dollar above it until the full 2 % applies (the shade-in ends at threshold × 1.25). The 2026–27 threshold had not been announced when checked. The low income tax offset (LITO, not built) is $700 up to $37,500, less 5 cents per dollar to $45,000 and 1.5 cents per dollar to $66,667 (search summaries of ato.gov.au "Low income tax offset" and adviser pages, rechecked 2026-09-26 at the plan review); the suggestion says it is not included when the income is in that phase-out range (§2.10).

Details, including counts per rule and the owner's figures, are in `docs/private/stage-5-private.md` §0–§3.

---

## 1. Overview & flow

### 1.1 What Stage 5 delivers
1. **`@joinr/engine`** (pure TypeScript, §2), additions:
   - **The snapshot composer:** every History column `B`–`AK` for the live period (or a month being recorded) from the Stage 2–4 results and the seam, plus the Stage 5 extras (D88): the offset-account total, the linked offsets, cash in debit and the super measured-through date.
   - **Snapshot checks:** the derived columns (gain %, cash gain, equity) and the movement columns recomputed from stored figures and the trade ledger, per snapshot (the PLAN acceptance "recomputing the migrated snapshots reproduces the stored values").
   - **Net worth:** the breakdown of any snapshot, the dashboard figures (KPIs, assets and liabilities, the distribution, the savings-rate gauge, the liquid allocation), the rolling table with a projection, and a linear trend.
   - **Aggregation:** `aggregateSnapshots` groups snapshots monthly, quarterly or by year (the FY by default, D52) with a mode per column, replacing WorkingSheet and `compressTable`.
   - **Recording rules:** which month a record fills, which months are recordable, and which are due for the scheduler (D81, D82).
   - **The tax suggestion** (D85): the resident bracket, the Medicare levy and a suggested marginal rate for the gross salary.
   - **Super (D88a):** closed periods measure their gain between measured-through dates, so SG and contributions after a month's measured balance date carry into the next month.
2. **Schema** (§3): migration `0005_stage5_history` (snapshot extras, the correction audit table, an identity trigger), `SNAPSHOT_SOURCES` gains `late`, the `snapshot` job, one app-only setting (`history.autoRecord`), every setting editable except the server-written cap FY (D86, D91: the workbook settings the app does not use included), the setting groups, the ATO tables, request schemas, DTOs, error codes, fixtures and seed updates.
3. **Server** (§4): `/api/net-worth`, `/api/history` (record, correct, delete the latest), the aggregation API `/api/history/series`, `GET /api/settings`, the live snapshot composed from the finance context, the D88 figures fed back into the savings and super engines, and the D34 rules for recorded months.
4. **Recorder** (§4.6): the month-end auto-record (D81) with an injectable clock, the start-up catch-up (D82), the auto-record switch (setting or `AUTO_RECORD`, off by default, D84), one record at a time and the interplay with the price job and the import lock.
5. **Importer** (§3.5): the D87 settings reset; the new snapshot columns stay null on migrated rows.
6. **Web** (§6): the Net Worth dashboard with the brand hero band, the History page (record, look-back, correct, delete the latest, audit trail, consistency check), the Settings page grouped by area, the pages' links to their Settings group, and the feature toggles in the navigation.
7. **Golden tests** (§9): engine goldens over History, the rolling table, WorkingSheet and Net Worth; a server golden that goes import → DB → API → record.

### 1.2 Workspace changes (no new packages)
```
packages/schema/     + db tables (history.ts: snapshot columns, snapshot_audit), enums, settings (1 key, groups,
                       editable keys), src/history.ts (column modes, correctable columns, record constants),
                       src/tax.ts (ATO tables), src/dto/history.ts, src/dto/settings.ts, dto/errors.ts, dto/status.ts
                       (additive), dto/cashflow.ts (staticUntilStage4 dropped, SETTINGS_PATCH_MAX_KEYS), fixtures/history.ts
                       (+ cashflow.ts), coverage, sampleDtos, testing/{seed,dump}.ts
packages/engine/     + src/{snapshot,netWorth,aggregate,trend,recording,tax}.ts; super.ts (D88a), periods.ts (the
                       provisional month, §11 fix 9; `groupOf` yearly by the period month, §11 fix 20), kpis.ts (the
                       savings year by the period month, §11 fix 20); types.ts additions; test/** (+ test/golden/history.networth.*)
packages/importer/   writer.ts (D87; the preference keys, §3.3, D95), reconcile.ts (report line); tests
                       (incl. the Scaffolder's fixes to test/{stage3-upgrade.ts,migration-equivalence.test.ts,golden.test.ts})
packages/ui/         BarChart overlays, trend line, dashed legend key and total label; DonutChart/Datum optional
                       `color` and DonutChart `maxSegments` (web-owned, §6.1; D93)
apps/server/         + migrations/0005_stage5_history.sql (+ meta), src/history/**, src/settings/**,
                       src/routes/{history,netWorth}.ts; edits: app.ts, index.ts, config.ts, routes/{settings,status}.ts,
                       cashflow/{context,inputs,cash,responses,constants}.ts, assets/{inputs,super}.ts, db/queries/domain.ts,
                       records/index.ts, investments/charts.ts (FY yearly groups, §11 fix 5)
apps/web/            + src/pages/{netWorth,history,settings}/**; edits: pages/NetWorthPage.tsx (removed), router, nav,
                       RootLayout, pages/cashflow/SettingsSection.tsx (the Settings link), the Stage 3–4 page texts
e2e/                 + networth.spec.ts, history.spec.ts, settings.spec.ts, history-states.spec.ts,
                       history-mutations.spec.ts, history-support.ts; edits: ui-core.spec.ts, import.setup.ts, records.spec.ts,
                       brand.spec.ts (the Stage 0 sample hero check moves to the real dashboard)
playwright.config.ts + the `history-mutations` project
```

### 1.3 Dependencies (no third-party additions)
No package changes anywhere. Least-squares trends use `JoinrDecimal`; floats stay confined to XIRR. pnpm 11 rules are unchanged: `allowBuilds` untouched, never `pnpm approve-builds`. **Only the Scaffolder may run `pnpm install`** (it should not need to). Implementers never edit a dependency list or the lockfile; stop and report instead.

### 1.4 Scripts
No new root scripts. Scoped commands used in this plan:
- `pnpm vitest run --project engine` (unit + golden) and `--project engine test/golden`
- `pnpm vitest run --project server test/history`, `test/recorder`, `test/settings`, `test/golden`, `test/cashflow`, `test/assets`
- `pnpm vitest run --project importer`
- `pnpm vitest run --project schema`
- `pnpm vitest run --project web src/pages/netWorth src/pages/history src/pages/settings src/layout`
- `pnpm vitest run --project ui`

### 1.5 Not in Stage 5 (deferred; the UI says so where it matters)
- **Stage 6:** the FIRE planner (its settings are editable in Settings now, labelled "Used by the FIRE planner (Stage 6)"; D68's exclusion of the primary residence happens there); the polish items carried from Stages 3–4 (STYLE-5, 6, 7, 11, 13, 15, CODE-9, the chunk-size warning, guard hardening for numbers with separators); loading skeletons and the keyboard and number-format audits; the node-line motif on the History timeline (optional).
- **Stage 7:** turning auto-record on at the cutover (D84); the container's time zone (`TZ`, §12); nightly backups and the `backup` job.
- **Not built:** LiabilitiesDebts and Capital Gains (D2: History `U` and `V` are recorded as 0; a loan without a property counts nowhere); email, calendar and version notices (the sheet's post-record steps, spec 01 §1.2 steps 7–8); the investment-order price back-fill (spec 01 §1.2 step 9); editing a snapshot's run date or month (delete the latest and record again); correcting movement columns (they are recomputed from trades, §2.5); the couple tax calculator (SheetOptions `G46:H50`); LITO, HELP, the Medicare levy surcharge and family thresholds in the tax suggestion (§2.10; the hint says "The low income tax offset is not included" when the income is in its phase-out range); a price history for the live snapshot at a past date (look-back records current values, as the sheet did).

---

## 2. Engine spec (`@joinr/engine`)

### 2.1 Conventions (all engine code; Stage 2 §2.1, Stage 3 §2.1 and Stage 4 §2.1 still apply)
| Concern | Rule |
|---|---|
| Purity | No I/O, no clock, no randomness, no timers, no host time zone or locale. `asOf` and `today` are always inputs. The Stage 3 ESLint rules and `test/purity.test.ts` cover the new modules unchanged. |
| Imports | `@joinr/schema` **root** only (enums, decimal helpers, `addMonthsIso`, `isoMonthOf`, the §3.2 history constants and the §3.3 tax tables). |
| Arithmetic | `JoinrDecimal` for money, ratios and the trend's least squares; floats only inside XIRR (unchanged). |
| Boundaries | Money in and out as integer cents; ratios as decimal strings with 12 significant digits; dates `IsoDate`, months `IsoMonth`. |
| Rounding | Compute in decimals, round **once** at each output, half away from zero. A snapshot column is its own rounded figure; a breakdown total is the Σ of its rounded parts (so the table adds up); ratios come from the rounded cents they describe (a snapshot's gain % is `gain ÷ (value − gain)` of its stored cents, so a recomputation always matches, §2.5). |
| Sheet ratios | A History ratio column is `IFERROR(g ÷ (v − g), 0)`: `'0'` when the denominator is 0 or either figure is null (the sheet stored 0), so recorded and migrated rows share one rule. Dashboard ratios (change %, shares) are null instead when undefined. |
| Nulls | A figure that cannot be computed is null (never 0) unless the sheet column stores 0 by rule (`U`, `V`, the ratios above). A null inside a sum counts 0 for the net-worth breakdown (the sheet's `""` behaves as 0 in its sums), and the breakdown says which parts were null. |
| Errors | Data problems give nulls or flags; `RangeError` only for programmer errors (malformed decimals or dates, a count below 1). |

### 2.2 Public API (FROZEN — additions to `packages/engine/src/types.ts` + `src/index.ts`)
The Scaffolder appends every type below to `types.ts`, adds a stub throwing `new Error('engine: not implemented')` for every new function to `index.ts`, adds the new members to `EngineApi` and the `engine` value, and adds `HISTORY_ENGINE_IMPLEMENTED = false` (the engine owner sets it `true` only after its full Stage 5 unit suite, goldens included, passes). It gates the server's Stage 5 integration, route and golden tests **and**, because the shared finance context then feeds the D88 figures into `computeSavings` and `computeSuper`, the Stage 2–4 real-engine server suites (`test/cashflow/integration.test.ts`, `test/investments/integration.test.ts`, `test/assets/integration.test.ts`, and the three server goldens; §7.4). `ENGINE_IMPLEMENTED`, `CASHFLOW_ENGINE_IMPLEMENTED` and `ASSETS_ENGINE_IMPLEMENTED` stay `true`. Names, fields and signatures below do not change; internal modules are free. The compile and expectation fixes these additions force in Stage 2–4 files are the Scaffolder's (§7.1).

```ts
import type {
  ChartDateUnit, DecimalString, InstrumentKind, IsoDate, IsoMonth, NetWorthClass, NetWorthLiability,
  SnapshotCheckColumn, SnapshotSource, YearBasis,
} from '@joinr/schema';

// ─── Stage 3–4 types changed additively ─────────────────────────────────────────────────────────
// SuperInput.snapshots[] gains:  measuredThrough?: IsoDate | null   // D88a: the month's measured balance date (null/absent → runDate)
// SuperResult gains:             measuredThrough?: IsoDate | null   // the provisional period's D79 cut-off (null: no provisional
//                                                                   //   period, or no open fund has a balance by asOf)
// (SavingsSnapshotInput.offsetCents keeps its type; the server now passes stored figures, §4.5.)

// ─── Snapshot figures (§2.3): one History row plus the Stage 5 extras; camelCase of the snapshots table ──
export interface SnapshotFigures {
  stocksValueCents: Cents | null; stocksGainCents: Cents | null; stocksGainRatio: DecimalString | null;
  stocksMovementsCents: Cents | null;                                        // B, C, D, E
  etfValueCents: Cents | null; etfGainCents: Cents | null; etfGainRatio: DecimalString | null;
  etfMovementsCents: Cents | null;                                           // F, G, H, I
  cryptoValueCents: Cents | null; cryptoGainCents: Cents | null; cryptoGainRatio: DecimalString | null;
  cryptoMovementsCents: Cents | null;                                        // J, K, L, M
  cashValueCents: Cents | null; cashGainCents: Cents | null; cashIncreaseRatio: DecimalString | null;   // N, O, P
  superValueCents: Cents | null; superContribCents: Cents | null; superGainCents: Cents | null;
  superGainRatio: DecimalString | null;                                      // Q, R, S, T
  liabilitiesBalanceCents: Cents | null; liabilitiesPaidCents: Cents | null; // U, V (0 when recorded: D2)
  salaryMonthlyCents: Cents | null;                                          // W
  propertyValueCents: Cents | null; propertyPurchaseCents: Cents | null; propertyEquityCents: Cents | null;
  propertyGainCents: Cents | null; mortgageBalanceCents: Cents | null; mortgageInterestFeesCents: Cents | null;
  mortgagePrincipalPaidCents: Cents | null; propertyGainRatio: DecimalString | null;   // X … AE
  mfValueCents: Cents | null; mfGainCents: Cents | null; mfGainRatio: DecimalString | null;
  mfMovementsCents: Cents | null;                                            // AF, AG, AH, AI
  otherValueCents: Cents | null; otherGainCents: Cents | null;               // AJ, AK
  // Stage 5 extras (migration 0005; null on migrated rows, §3.1)
  offsetCents: Cents | null;          // D88b: Σ every offset account at the run date (cashTotals.offsetCents)
  mortgageOffsetCents: Cents | null;  // the offsets linked to property loans (already inside propertyEquityCents)
  cashDebtCents: Cents | null;        // Σ non-offset accounts with a negative balance (≤ 0; already inside cashValueCents)
  superMeasuredThrough: IsoDate | null;  // D88a: the D79 cut-off when the month was recorded
}
export interface EngineSnapshot extends SnapshotFigures {
  periodMonth: IsoMonth; runDate: IsoDate; source: SnapshotSource;           // 'migrated' | 'recorded' | 'lookback' | 'late'
}

// ─── The composer (§2.4) ────────────────────────────────────────────────────────────────────────
export interface ComposeSnapshotInput {
  periodMonth: IsoMonth;
  runDate: IsoDate;                                    // the date the results below were computed at (asOf)
  previous: { runDate: IsoDate; cashValueCents: Cents | null } | null;   // the latest snapshot before this one (run-date order)
  investments: Readonly<Record<InstrumentKind, InvestmentsResult>>;
  trades: Readonly<Record<InstrumentKind, readonly EngineTrade[]>>;       // every trade of the kind (movements)
  cash: CashTotalsResult;
  cashAccounts: readonly EngineCashAccount[];
  salaryMonthlyCents: Cents | null;                    // monthlyPayCents(the current pay settings)
  assets: AssetsSnapshotColumns;                       // the Stage 4 seam at runDate
  superMeasuredThrough: IsoDate | null;                // SuperResult.measuredThrough at runDate
}

// ─── Checks (§2.5) ──────────────────────────────────────────────────────────────────────────────
export interface DerivedSnapshotColumns {
  stocksGainRatio: DecimalString; etfGainRatio: DecimalString; cryptoGainRatio: DecimalString;
  cashGainCents: Cents | null; cashIncreaseRatio: DecimalString; superGainRatio: DecimalString;
  propertyEquityCents: Cents | null; propertyGainRatio: DecimalString; mfGainRatio: DecimalString;
}
export interface SnapshotDifference {
  column: SnapshotCheckColumn;                          // §3.2: the 9 derived + the 4 movement columns
  kind: 'derived' | 'movement';
  storedCents: Cents | null; recomputedCents: Cents | null;              // money columns
  storedRatio: DecimalString | null; recomputedRatio: DecimalString | null;   // ratio columns
}
export interface SnapshotCheckResult {
  checked: number; matched: number;                    // cells
  rows: { periodMonth: IsoMonth; runDate: IsoDate; source: SnapshotSource; checked: number;
    differences: SnapshotDifference[] }[];             // run-date order, every snapshot
}

// ─── Net worth (§2.6) ───────────────────────────────────────────────────────────────────────────
export interface NetWorthBreakdown {
  liquidCents: Cents;          // Net Worth L / D16: B + F + J + N + AF + AJ (cash net of accounts in debit)
  superCents: Cents;           // Q
  propertyCents: Cents;        // X (gross value)
  liabilitiesCents: Cents;     // −|U| − |AB| (≤ 0; the gross mortgage, as the sheet's N)
  offsetsCents: Cents;         // offsetCents ?? 0: every offset account (§2.6: linked ones net the mortgage)
  netWorthCents: Cents;        // liquid + super + property + liabilities + offsets (the sheet's P + offsets)
  missing: (keyof SnapshotFigures)[];                   // the value columns that were null and counted 0
}
export interface NetWorthClassRow { key: NetWorthClass; valueCents: Cents; gainCents: Cents | null;
  gainRatio: DecimalString | null }                    // gain % = gain ÷ (value − gain); null when undefined
export interface NetWorthLiabilityRow { key: NetWorthLiability; balanceCents: Cents;    // ≥ 0, the amount owed
  grossCents: Cents; offsetCents: Cents }              // mortgages: gross |AB| and the linked offsets applied (§2.6 step 3);
                                                       //   cash_debit and other_debts: offset 0
export interface NetWorthChange { base: { periodMonth: IsoMonth; runDate: IsoDate; netWorthCents: Cents } | null;
  cents: Cents | null; ratio: DecimalString | null }   // live − base; ratio = cents ÷ |base| (null when base is 0)
export interface DistributionSlice { key: NetWorthClass; valueCents: Cents; ratio: DecimalString }
export interface NetWorthDashboardInput {
  asOf: IsoDate;
  live: SnapshotFigures;                               // composeSnapshot at asOf
  liveMonth: IsoMonth;                                 // the provisional period's month (nextRecordMonth)
  snapshots: readonly EngineSnapshot[];
  property: PropertiesResult;                          // display only (the per-loan lines); every figure comes from `live` (§2.6)
  cashAccounts: readonly EngineCashAccount[];
  kpis: CashKpisResult;                                // the year savings rate (D52 basis) and the averages
  plannedSavingsRatio: DecimalString | null;           // BudgetResult.plannedSavingsRatio (the gauge's target tick)
  considerNext: ConsiderNextResult;                    // the liquid allocation (Net Worth B36:E45)
}
export interface NetWorthDashboardResult {
  breakdown: NetWorthBreakdown;                        // of `live`
  assetsCents: Cents; liabilitiesCents: Cents;         // assets − liabilities = breakdown.netWorthCents
  classes: NetWorthClassRow[];                         // NET_WORTH_CLASSES order, every class (0 kept)
  liabilities: NetWorthLiabilityRow[];                 // NET_WORTH_LIABILITIES order, every kind (0 kept)
  assetsExSuperCents: Cents;                           // C13 (assets − super)
  sinceLastRecord: NetWorthChange;                     // base: the latest snapshot with runDate < asOf (§2.6 step 4)
  thisYear: NetWorthChange & { year: YearWindow };     // base: the latest snapshot whose periodMonth ends before year.start
  distribution: { values: { key: NetWorthClass; valueCents: Cents }[];   // every class's net value before the drop
                                                       //   (NET_WORTH_STACK_ORDER, 0 and negatives kept; the table view)
    slices: DistributionSlice[];                       // every net value > 0 (up to 8, no fold; D93), in
                                                       //   NET_WORTH_STACK_ORDER (§2.6 step 6)
    excluded: { key: NetWorthClass; valueCents: Cents }[];     // net values < 0 (not drawable)
    drawnCents: Cents };                               // Σ slices (the donut's centre, §5)
  savingsRate: { ratio: DecimalString | null; rawRatio: DecimalString | null; year: YearWindow; periods: number;
    targetRatio: DecimalString | null };               // cashKpis.yearSavingsRatio (D83, D52, D61)
  averageSavings: { monthCents: Cents | null; yearCents: Cents | null; periods: number };   // I1 fixed (§11 fix 7)
  allocation: ConsiderNextResult;                      // passed through (the web shows it with the targets)
}
export interface RollingNetWorthRow {
  periodMonth: IsoMonth; runDate: IsoDate | null;      // projected rows: null
  status: 'recorded' | 'live' | 'projected';
  source: SnapshotSource | null;                       // recorded rows only
  breakdown: NetWorthBreakdown | null;                 // projected rows: null
  growthCents: Cents | null; liquidGrowthCents: Cents | null;   // Q, R (vs the previous row)
  savingsRatio: DecimalString | null; rawSavingsRatio: DecimalString | null;   // S: the savings period's adjusted / raw ratio
  projectedLiquidCents: Cents | null;                  // T: liquid while data exists, then the projection
}
export interface RollingNetWorthInput {
  snapshots: readonly EngineSnapshot[];
  live: { periodMonth: IsoMonth; runDate: IsoDate; figures: SnapshotFigures } | null;
  savings: readonly SavingsPeriod[];                   // computeSavings(...).periods (matched by periodMonth)
  projection: { monthlyCents: Cents | null; months: number };   // avg monthly savings (adjusted) and the horizon
}

// ─── Aggregation (§2.7) ─────────────────────────────────────────────────────────────────────────
export interface SnapshotSeriesRow { periodMonth: IsoMonth; runDate: IsoDate; live: boolean; figures: SnapshotFigures }
export interface SnapshotGroup {
  label: string; period: IsoMonth; date: IsoDate; live: boolean; rows: number;
  figures: SnapshotFigures;                            // per SNAPSHOT_COLUMN_MODES; ratios recomputed from the group's cents
  netWorth: NetWorthBreakdown;                         // of `figures` (the group's last row)
  growthCents: Cents | null; liquidGrowthCents: Cents | null;   // Σ over the group's rows (vs each row's previous row)
}

// ─── Trend (§2.8) ───────────────────────────────────────────────────────────────────────────────
export interface TrendResult { fittedCents: (Cents | null)[];     // one per input point (null where the input is null)
  slopePerMonthCents: Cents | null;                    // slope per day × 365.25 ÷ 12
  points: number }                                     // non-null points used

// ─── Recording rules (§2.9) ─────────────────────────────────────────────────────────────────────
export interface RecordingDue { periodMonth: IsoMonth; source: 'recorded' | 'late' }
export interface RecordingPlan {
  due: RecordingDue[];                                 // ascending
  blocked: { periodMonth: IsoMonth; missing: IsoMonth[] } | null;   // the current month is due by the clock but an
}                                                      //   earlier recordable month is missing and not due (§2.9; D94)

// ─── Tax suggestion (§2.10) ─────────────────────────────────────────────────────────────────────
export interface MarginalRateSuggestion {
  financialYear: number;                               // asOf's FY (start year)
  tableFinancialYear: number;                          // the table used (the nearest earlier one past the end)
  tableCurrent: boolean;                               // false when asOf's FY is after the last table
  incomeCents: Cents;
  bracket: { thresholdCents: Cents; toCents: Cents | null; ratio: DecimalString };   // the band holding the income:
                                                       //   thresholdCents < income ≤ toCents (display adds $1 to the threshold)
  bracketRatio: DecimalString;
  medicare: { thresholdCents: Cents; thresholdFinancialYear: number; ratio: DecimalString;   // the marginal levy rate:
    band: 'none' | 'shade_in' | 'full' };             //   0, 0.1 (shade-in) or 0.02
  suggestedRatio: DecimalString;                       // bracket + medicare.ratio: the "suggested" rate (D90; the
                                                       //   bracket alone, `bracketRatio`, is offered too)
  incomeTaxCents: Cents; medicareLevyCents: Cents;     // on incomeCents, for the hint
  litoPhaseOut: boolean;                               // LITO_PHASE_OUT_FROM < income ≤ LITO_PHASE_OUT_TO: the hint says
}                                                      //   the offset (not built) would add to the true marginal rate

// ─── Functions (FROZEN signatures) ─────────────────────────────────────────────────────────────
export function composeSnapshot(input: ComposeSnapshotInput): SnapshotFigures;
export function deriveSnapshotColumns(i: { figures: SnapshotFigures;
  previousCashValueCents: Cents | null | undefined }): DerivedSnapshotColumns;   // undefined: no previous snapshot
export function checkSnapshots(i: { snapshots: readonly EngineSnapshot[];
  trades: Readonly<Record<InstrumentKind, readonly EngineTrade[]>> }): SnapshotCheckResult;
export function netWorthOf(figures: SnapshotFigures): NetWorthBreakdown;
export function netWorthDashboard(input: NetWorthDashboardInput): NetWorthDashboardResult;
export function rollingNetWorth(input: RollingNetWorthInput): RollingNetWorthRow[];
export function aggregateSnapshots(i: { rows: readonly SnapshotSeriesRow[]; unit: ChartDateUnit;
  count: number | null; yearBasis: YearBasis }): SnapshotGroup[];
export function linearTrend(points: readonly { date: IsoDate; valueCents: Cents | null }[]): TrendResult;
export function nextRecordMonth(snapshots: readonly { periodMonth: IsoMonth }[], today: IsoDate): IsoMonth;
export function recordableMonths(snapshots: readonly { periodMonth: IsoMonth }[], today: IsoDate): IsoMonth[];
export function recordingsDue(i: { snapshots: readonly { periodMonth: IsoMonth }[]; today: IsoDate;
  recordTimeReached: boolean;                          // the server's clock says the record hour has passed (§4.6)
  autoRecordSince: IsoDate | null }): RecordingPlan;   // null → { due: [], blocked: null } (auto-record off)
export function suggestMarginalRate(i: { incomeCents: Cents | null; asOf: IsoDate }): MarginalRateSuggestion | null;
export const HISTORY_ENGINE_IMPLEMENTED: boolean;      // Scaffolder: false; engine sets true (§7.3)
// EngineApi gains: composeSnapshot, deriveSnapshotColumns, checkSnapshots, netWorthOf, netWorthDashboard,
// rollingNetWorth, aggregateSnapshots, linearTrend, nextRecordMonth, recordableMonths, recordingsDue,
// suggestMarginalRate (12; named *Fn aliases, as Stages 2–4). The `engine` value gains the same members.
```

### 2.3 Shared rules
- **Snapshot order** is the Stage 3 `sortByRunDate` (run date, then period month): late months recorded together share a run date and keep their month order (§2.9). Windows are Stage 3's `(run_{i−1}, run_i]`.
- **The previous snapshot** of a figure set is the latest snapshot before it in that order (for `O`, `P`, the movements' window and the rolling growth).
- **Money columns** are rounded cents; a null counts 0 inside the breakdown sums (the sheet's blank cells behave as 0 in `L`/`P`), and `NetWorthBreakdown.missing` names them so the web can say "Crypto not recorded this month".
- **Years:** `yearWindow(date, basis)` (Stage 3): the gauge and "This FY" follow `savings.yearBasis` (D52: FY by default; calendar by the setting), every yearly chart group follows it too (D52), labelled `FY2025–26` or `2026`.
- **A snapshot belongs to its period month's year, not its run date's (D29; §11 fix 20).** Every year decision on snapshots or savings periods uses `yearWindow(monthEndOf(periodMonth), basis)`: `groupOf`'s yearly unit (so `aggregateSnapshots`, the Stage 3 `compressCashflow` and the Stage 4 chart groups all key years on the period, as months and quarters already do), the Stage 3 year KPIs in `kpis.ts` (the year is that of the last recorded period's month; a period counts in the year its month ends in), and the "This FY" base (§2.6 step 4). Run dates still bound every window (movements, flows, the 365-day average). So June recorded late on 1 July stays in June's FY everywhere. On imported data every period month is its run date's month, so every Stage 2–4 golden is unchanged; Stage 2's `compressSeries` points already have period = the date's month.

### 2.4 The composer (`composeSnapshot`; spec 01 §2.3)
For the input's `runDate` (the as-of the results were computed at):
1. **Investments** per kind (`stock` → B–E, `etf` → F–I, `crypto` → J–M, `managed_fund` → AF–AI): value = `summary.valueCents`; gain = `summary.totalReturnCents` (D41: History `C` is the tab's total return, `Stocks!E17`); gain ratio = the sheet ratio of those cents (§2.1); movements = `netPurchases` of the kind's trades over the window `(previous.runDate, runDate]`, or `(runDate − 1 month, runDate]` without a previous snapshot (the Stage 1 movement rule, `purchaseWindows`). Every trade counts (D37: the retirement tag is dropped).
2. **Cash:** `N` = `cash.totalCashCents` (non-offset accounts, loans you've made included, D49, D59); `O` = `N − previous.cashValueCents` when both exist, else null; `P` = the sheet ratio of `O` and `N`.
3. **Super, property, other assets** = the seam (`AssetsSnapshotColumns`): `Q`, `R` (the D71 net-pay cost of contributions in `(lastRun, runDate]`), `S` (null when the provisional period is not updated), `T`; `X`, `Y`, `Z` (net of linked offsets, D67), `AA`, `AB` (≤ 0), `AC`, `AD`, `AE`; `AJ`, `AK`.
4. **`U` = 0, `V` = 0** (LiabilitiesDebts is not rebuilt, D2; a loan without a property counts nowhere).
5. **`W`** = `salaryMonthlyCents` (the pay settings in force when recorded; the sheet froze `W` too).
6. **Extras (D88):** `offsetCents` = `cash.offsetCents` (0 without an offset account); `mortgageOffsetCents` = `assets.mortgageOffsetCents`; `cashDebtCents` = Σ `min(0, balance)` of non-offset accounts (≤ 0); `superMeasuredThrough` = the input.
7. The result is deterministic for its inputs; the server composes the live row and every recorded month through it (§4.5), so a recorded month equals the live figures shown just before recording **when no price changed in between** (market off, or no refresh result): the record refreshes prices first (§4.6), so with live prices the recorded row can differ from the preview. The server tests and goldens assert the equality with the market off (§7.4, §9.4).

### 2.5 Checks (`deriveSnapshotColumns`, `checkSnapshots`; the PLAN acceptance)
- **Derived columns** from a figure set and its previous cash: `D`, `H`, `L`, `P`, `T`, `AE`, `AH` = the sheet ratio of their own row's gain and value cents; `O` = `N − previous N` (null for the first snapshot, or when either is null); `Z` = `X + AB + (mortgageOffsetCents ?? 0)` (D67: equity is net of linked offsets; migrated rows have none, so `Z = X + AB` as the sheet). The server uses `deriveSnapshotColumns` for every write (a record and a correction), so stored derived columns always agree with their stored inputs.
- **`checkSnapshots`** compares, for every snapshot, each derived column with the recomputation (`kind 'derived'`), and each movement column (`E`, `I`, `M`, `AI`) with `netPurchases` of the given trades over the snapshot's window (`kind 'movement'`; the first snapshot's window is `(runDate − 1 month, runDate]`, as the importer's movement rule). **Match rules** (the stored figures are cents, so ratios are checked against their own cents): a ratio `r` of gain `g` and value `v` matches when `v − g = 0` and `r = 0`, or when `|r × (v − g) − g| ≤ 1 + |r|` (cents); `O`, `Z` and each movement match within 1 cent; a null stored cell matches a null recomputation only. `checked` counts every compared cell; `matched` those that matched.
- A movement difference is expected after a trade dated inside a recorded window is edited in the app or changed by an import correction (D27); the History page reports it separately, as information, and never counts it as a month that fails to reproduce (§6.4 item 7). A derived difference never is expected (a test asserts none after any record or correction).

### 2.6 Net worth (`netWorthOf`, `netWorthDashboard`, `rollingNetWorth`)
1. **`netWorthOf(f)`:** `liquid = B + F + J + N + AF + AJ`; `super = Q`; `property = X`; `liabilities = −|U| − |AB|`; `offsets = offsetCents ?? 0`; `netWorth = liquid + super + property + liabilities + offsets`. With `linked = mortgageOffsetCents ?? 0` (the **uncapped** Σ of the offsets linked to property loans, as stored and as inside `Z`) this equals `liquid + Q + Z + (offsets − linked) − |U|` (D67: linked offsets net the mortgage inside equity; unlinked ones, and offsets linked to a loan without a property, are cash-like and count in full); for a migrated row (no offsets) it is the sheet's `P` (verified to 1 cent on every frozen row).
2. **Every dashboard figure comes from `live`** (a `SnapshotFigures`), never from the current `PropertiesResult`, so the page adds up for any figure set, including a migrated snapshot shown when there is no provisional period (§4.5). `property` supplies only the per-loan display lines. Let `applied = min(linked, |AB|)` (the linked offsets that actually net the mortgages, capped in aggregate; per-loan capping is display only).
   **Classes** (`NET_WORTH_CLASSES`, the dashboard's assets): `etf`, `stock`, `managed_fund`, `crypto` = value and gain (total return) of the figures; `cash` = `N − cashDebtCents` (the positive balances; gain null: cash has no gain, §11 fix 17); `offsets` = `offsets − applied` (unlinked offsets, offsets linked to a loan without a property, and any excess over the mortgages); `other_assets` = `AJ`, `AK`; `super` = `Q`, `S` (the provisional gain; null when not updated); `property` = `X`, `AA` (gross value, as `Net Worth!C11`). No total gain is computed (the sheet's `D12`/`D13` summed the cash change and a super gain the app does not have; §9.3 rule 7).
3. **Liabilities** (`NET_WORTH_LIABILITIES`): `mortgages` = `|AB| − applied` (gross `|AB|`, offset `applied`); `cash_debit` = `|cashDebtCents ?? 0|` (accounts in debit; the PLAN's "negative-balance cash accounts"); `other_debts` = `|U|` (LiabilitiesDebts, not rebuilt: only an imported month can hold it, D2). `assetsCents` = Σ classes; `liabilitiesCents` = Σ liabilities; **`assetsCents − liabilitiesCents = breakdown.netWorthCents`** holds by construction for every figure set (an engine test asserts it on every case, including a loan without a property, excess offsets and a non-zero `U`; it is a test invariant, never a runtime throw; §11 fixes 1–2). `assetsExSuperCents = assets − super` (C13).
4. **Changes:** `sinceLastRecord` against `netWorthOf` of **the latest snapshot with `runDate < asOf`** (normally the latest snapshot; when a month was recorded today, the one before it, so "Recorded today" still shows a change); `thisYear` against the latest snapshot whose `monthEndOf(periodMonth) < year.start` (`year = yearWindow(asOf, kpis.year.basis)`; the period rule of §2.3; none → base null, cents null). `ratio = cents ÷ |base|` (null when the base is 0).
5. **Savings rate (gauge):** `ratio = kpis.yearSavingsRatio` (adjusted, income-weighted over the year's closed periods; D61, D52), `rawRatio = kpis.yearSavingsRawRatio`, `year = kpis.year`, `periods = kpis.yearPeriods`, `targetRatio = plannedSavingsRatio`. **Average savings:** `monthCents = kpis.avgSavingsCents`, `yearCents = × 12` (the sheet's `I1`, §11 fix 7), `periods = kpis.avgWindow?.periods ?? 0`.
6. **Distribution** (the sheet's pie, `WorkingSheet!C4:C11`, net values): `values` lists every class in **`NET_WORTH_STACK_ORDER`** (§3.2: `stock`, `etf`, `crypto`, `cash`, `managed_fund`, `other_assets`, `super`, `property`): the four investment values; `cash` = `N + offsets − linked` (net cash plus the offsets not inside equity, with the uncapped `linked` of step 1, so Σ values = `netWorth + |U|`); `other_assets`; `super`; `property` = `Z` (net equity; the sheet's `F7 + F10`). Slices: values ≤ 0 are left out (`excluded` lists the negative ones; §11 fix 3); **every other class is a slice (up to eight; no "Other classes" fold, D93**, which overrides STYLE_GUIDE §6.1's six-slice rule for this chart); the slices are drawn in `NET_WORTH_STACK_ORDER` (not by value, so a class keeps its place and colour, §5). `ratio = value ÷ drawnCents` (`drawnCents` = Σ slices).
7. **`rollingNetWorth`** (the sheet's `K:U`): one row per snapshot in order (`status 'recorded'`), then the live row (`'live'`, when given), then `projection.months` projected rows (`'projected'`, months after the live month, only when `projection.monthlyCents` is not null): `breakdown = netWorthOf`; `growthCents = ΔnetWorth`, `liquidGrowthCents = Δliquid` against the previous row (null for the first); `savingsRatio`/`rawSavingsRatio` = the savings period of the same month (`adjusted`/`raw` ratio; null for the first period or none); `projectedLiquidCents` = `liquid` on recorded and live rows, then `last + k × monthlyCents` (the sheet's `T` fixed, §11 fix 8).

### 2.7 Aggregation (`aggregateSnapshots`; spec 01 §4, replacing `compressTable`)
- Groups like `compressSeries` (Stage 3 §2.13) through the shared `groupOf`: monthly by period month, calendar quarters (`Q3 2026`), years by `yearWindow(monthEndOf(periodMonth), yearBasis)` (`FY2025–26` or `2026`; the period rule of §2.3, so a June recorded on 1 July stays in June's FY; an engine test covers exactly that); the last `count` groups (null → 12 monthly, 8 quarterly, all yearly); a group takes its last row's period, date and `live`.
- **Modes per column** (`SNAPSHOT_COLUMN_MODES`, §3.2): values, gains, balances, the cumulative mortgage columns (`AC`, `AD`) and the extras are `end` (the group's last row); flows are `sum` (the four movement columns, `R`, `W`, and **`O`, cash gain, §11 fix 4**; a sum of nulls is null); ratio columns are recomputed from the group's aggregated cents (the end row's gain and value, so they equal the end row's own ratios; `P` from the summed `O` and the end `N`). `growthCents`/`liquidGrowthCents` are Σ of the rows' growths (the sheet's `BT`/`BU` sums).
- The savings chart keeps the Stage 3 `compressCashflow` (income-weighted rates, §11 fix 4); the Net Worth dashboard passes the same unit, count and year basis to both.
- With one row per group (monthly), every group equals its row (the WorkingSheet golden, §9.2).

### 2.8 Trend (`linearTrend`)
Ordinary least squares of value (cents, decimals) on the day number of the date over the non-null points; `fittedCents[i]` = the line at point *i*'s date (null where the input is null; all null with fewer than 2 points or a single distinct date); `slopePerMonthCents` = slope per day × 365.25 ÷ 12, rounded once. The dashboard fits the **displayed** groups (the live group included), as a sheet trendline fits the chart's points (§5).

### 2.9 Recording rules (`nextRecordMonth`, `recordableMonths`, `recordingsDue`; D81, D82)
- **`nextRecordMonth`** = the month after the latest snapshot's month, or `isoMonthOf(today)` without snapshots. **The provisional period's month** (Stage 3 `provisionalMonth`) becomes the same rule (§11 fix 9): a missed month is labelled as the month it would be recorded as, instead of jumping to the calendar month; with no gap the two rules agree (the Stage 3 and 4 goldens are unchanged).
- **`recordableMonths`** = every month from `nextRecordMonth` through `isoMonthOf(today)` in order; empty when the latest snapshot's month is the current month or later. Only these can be recorded (a month before the latest snapshot can never be filled later: its run date would sort after later months).
- **`recordingsDue`** (the scheduler's plan; `autoRecordSince` null → `{ due: [], blocked: null }`): each recordable month `m` whose last day is before `today` and on or after `autoRecordSince` → `{ m, 'late' }` (D82: missed while auto-record was on); plus the current month when `today` is its last day and `recordTimeReached` → `{ m, 'recorded' }`. **Nothing is due while an earlier recordable month is missing without being due** (one that ended before `autoRecordSince`, so it sorts before every month that would be due): then `due = []` and `blocked = { periodMonth: the first month that would have been due, missing: [those months] }` (**D94**, the owner's answer to plan review SPEC-3; `blocked` is null whenever nothing would be due anyway): auto-record never turns a missing month into a permanent gap; the owner records the missing month (look-back) or records the current month alone on the History page, whose form warns that the earlier month becomes a gap (§6.4). Months that ended before `autoRecordSince` are never caught up automatically (turning auto-record on does not back-fill the past). `due` is ascending.
- **Run dates:** every month recorded in one action gets the same run date (today, D82 "keeps the real run date"); `sortByRunDate`'s month tie-break keeps them in order, so the later months have empty windows (no movements, no cash gain). The year savings rate stays right (income-weighted over the year); the monthly figures of such months read low, and the History page marks them "Recorded late" (§12).

### 2.10 Tax suggestion (`suggestMarginalRate`; D85)
- `incomeCents` null or < 0 → null. `financialYear = yearWindow(asOf, 'fy').year`; the table = `RESIDENT_TAX_TABLES[fy]`, else the latest table before `fy` (`tableCurrent: false`: the web says "Check the ATO rates for FY2028–29"), else the earliest table.
- **Bracket:** the band with `thresholdCents < income ≤ toCents` in cents (`toCents` = the next band's threshold, null for the top band; an income of 0 is in the first band), so an income with cents between a threshold and threshold + $1 still has a band; the ATO's "$45,001 – $135,000" wording is display only (threshold + $1). `incomeTaxCents` = Σ over every band of `rate × max(0, min(income, to ?? income) − threshold)`, rounded once (no offsets: LITO and the rest are not built, §1.5). `litoPhaseOut` = `LITO_PHASE_OUT_FROM_CENTS < income ≤ LITO_PHASE_OUT_TO_CENTS` ($37,500 and $66,667, §3.2): in that range the offset's withdrawal (5 or 1.5 cents per dollar) adds to the true marginal rate, which the suggestion leaves out; the hint says so (§6.5).
- **Medicare levy** (singles; family thresholds not built): `threshold = MEDICARE_LOW_INCOME_THRESHOLDS[fy]` or the latest earlier one (`thresholdFinancialYear` says which); income ≤ threshold → band `none` (ratio 0, levy 0); income ≤ threshold × 1.25 → `shade_in` (ratio 0.1, levy = 0.1 × (income − threshold)); else `full` (ratio 0.02, levy = 0.02 × income). Rounded once.
- `suggestedRatio = bracketRatio + medicare.ratio` (e.g. 0.37 + 0.02 = 0.39): **the bracket plus the levy is the "suggested" rate, and the bracket alone is offered beside it (D90)**. The engine never writes a setting; the server returns the suggestion and the web applies it only on the owner's click (D85).

### 2.11 Super: measured-through dates (`computeSuper`; D88a)
- `SuperInput.snapshots[i].measuredThrough` (null/absent → its run date) is the D79 cut-off the month was recorded with. For a **closed** valuation period, the flows that make up its gain (`gainFlows`: SG to the fund, member contributions to the fund) are those dated in `(m_{gainFrom}, m_i]`, where `m` is each period's measured-through date, instead of `(run_{gainFrom}, run_i]`. **The measured-through dates are clamped non-decreasing:** each valuation point uses the effective date `m'_i = min(run_i, max(m_i ?? run_i, m'_{previous valuation point}))` at both ends of every window, so a stored date on or before the previous one (a balance entry deleted or back-dated, a fund un-archived) gives an empty window instead of re-counting SG (a test covers it). Transfers in still follow the run-date window (they sit on balance entries, as Stage 4). So SG and contributions after a month's measured balance date are left out of that month's gain and counted in the next one (carried). The `flows` of a period (the savings side) keep the run-date window (D79: the savings rate counts contributions up to the run date).
- **The provisional period** keeps Stage 4's rule, measured up to the oldest latest balance among open funds (D79; the one-date rule across funds stays, D88); its `gainFrom` side now starts at the previous valuation point's effective measured-through date. `SuperResult.measuredThrough` reports that cut-off (null without a provisional period), and the composer stores it with a recorded month.
- **Migrated rows** have no measured-through date (null → the run date), so every Stage 4 figure on imported data is unchanged (the Stage 4 goldens still pass).
- The Stage 4 date rules for new funds and transfers in (stage-4.md §4.5 step 5) are **kept** (revisited, D88): a recorded month's stored `Q` never held a fund created later, so an opening balance or a transfer dated on or before the last run date would still read as a loss in a closed period. They now apply to every snapshot, recorded or migrated; back-dating a fund means correcting the recorded months (§4.5).

---

## 3. Data model (`@joinr/schema`, migration `0005_stage5_history`)

### 3.1 Migration (append-only; stage-1 §2.1 evolution rule)
Generated with `pnpm --filter @joinr/server db:generate --name stage5_history`; the hand-written statements below are appended after a `--> statement-breakpoint` (the file keeps a header comment saying so). `git diff --exit-code` on every `0000`–`0004` SQL and snapshot file. **The generated SQL must hold only `CREATE TABLE`, `CREATE INDEX` and `ALTER TABLE … ADD` statements** (no `__new_` recreate, no `PRAGMA foreign_keys`); if drizzle-kit wants a recreate, change the schema, never hand-edit it.

New columns on `snapshots` (`ALTER TABLE … ADD`, all nullable except `revision`):
| Column | Type | Meaning |
|---|---|---|
| `offset_cents` | integer | D88b: Σ every offset account at the run date. **Null on migrated rows** (not recorded; §3.1 note) |
| `mortgage_offset_cents` | integer | the offsets linked to property loans (inside `property_equity_cents`, D67); null on migrated rows (read as 0) |
| `cash_debt_cents` | integer | Σ non-offset accounts in debit (≤ 0, inside `cash_value_cents`); null on migrated rows (read as 0) |
| `super_measured_through` | text (IsoDate) | D88a: the D79 cut-off when recorded; null on migrated rows (read as the run date) |
| `note` | text | the record note (≤ 200) |
| `revision` | integer not null default 0 | the number of corrections applied (§4.5) |

New table `snapshot_audit` (a log; **no FK**, so it outlives a deleted or re-imported month; **no provenance**, never app data):
| Column | Type | Meaning |
|---|---|---|
| `id` | integer primary key | |
| `period_month` | text not null | the month acted on |
| `snapshot_id` | integer | the row at the time (null after a delete) |
| `action` | text not null (`SNAPSHOT_AUDIT_ACTIONS`) | `record` · `correct` · `delete` |
| `trigger` | text not null (`RECORD_TRIGGERS`) | `manual` · `schedule` · `startup` |
| `at` | text not null | ISO timestamp (UTC) |
| `changes_json` | text | `{ column: { before, after } }` for a correction (the derived follow-ups included, also on the next month's row, keyed `"<periodMonth>.<column>"`) |
| `snapshot_json` | text | the full row after a record, before a delete |
| `note` | text | the owner's reason (required for a correction) |
| `detail_json` | text | record context (`RecordDetail`, §4.4): `{ pricesAsOf, marketMode, pricesRefreshed, pricesAgeMs, jobRunId }` |
Index `snapshot_audit_period_idx (period_month)`.

**Appended statement (hand-written):** the identity of a snapshot never changes; corrections change figures only.
```sql
CREATE TRIGGER `snapshots_identity_immutable` BEFORE UPDATE OF `run_date`, `period_month`, `source`, `recorded_at` ON `snapshots`
BEGIN SELECT RAISE(ABORT, 'snapshot identity is immutable'); END;
```
The importer's replace-all deletes and inserts snapshots (no UPDATE), so it is unaffected. No data statement is needed: migrated rows keep every imported value; the new columns stay null.

**D88 reading:** D88 says migrated months keep "an offset figure of 0". The stored column is **null** on migrated rows, with the same effect for every migrated period (no Δ offsets between them), because a null lets the server keep Stage 4's workbook-offset rule at the seam between the last migrated month and the first recorded one (stage-4.md §2.9: a workbook-flagged offset account's balance was never in the stored cash, so it must not read as money moved; a stored 0 would count it as savings in the first recorded month). The rule is §4.5's. The web shows a null offset figure as "—" with "Not recorded (imported month)".

`COMMITTED_MIGRATION_COUNT` becomes 6; `/api/health` → `migrations: 6`. The converted database keeps `hasAppData` unchanged (no row changes origin).

### 3.2 Schema module changes (Scaffolder)
- **`enums.ts`** (append only; each with its type):
  ```ts
  SNAPSHOT_SOURCES        += 'late'                                       // D82: caught up at start-up or wake-up
  JOB_NAMES               += 'snapshot'
  SNAPSHOT_AUDIT_ACTIONS   = ['record', 'correct', 'delete']              // SnapshotAuditAction
  RECORD_TRIGGERS          = ['manual', 'schedule', 'startup']            // RecordTrigger
  NET_WORTH_CLASSES        = ['etf', 'stock', 'managed_fund', 'crypto', 'cash', 'offsets', 'other_assets', 'super',
                              'property']                                 // NetWorthClass (no folded class: D93)
  NET_WORTH_LIABILITIES    = ['mortgages', 'cash_debit', 'other_debts']   // NetWorthLiability (other_debts: History U)
  SNAPSHOT_CHECK_COLUMNS   = ['stocksGainRatio', 'etfGainRatio', 'cryptoGainRatio', 'cashGainCents', 'cashIncreaseRatio',
                              'superGainRatio', 'propertyEquityCents', 'propertyGainRatio', 'mfGainRatio',
                              'stocksMovementsCents', 'etfMovementsCents', 'cryptoMovementsCents', 'mfMovementsCents']
  ```
- **`src/history.ts`** (new, exported from the root; generic constants):
  ```ts
  export const SNAPSHOT_VALUE_COLUMNS: readonly (keyof SnapshotFiguresShape)[];   // B…AK + the four extras, table order
  export const SNAPSHOT_COLUMN_MODES: Readonly<Record<SnapshotFigureKey, 'end' | 'sum' | 'ratio'>>;   // §2.7
  export const CORRECTABLE_SNAPSHOT_COLUMNS = [                           // §4.5: primary figures only
    'stocksValueCents', 'stocksGainCents', 'etfValueCents', 'etfGainCents', 'cryptoValueCents', 'cryptoGainCents',
    'cashValueCents', 'superValueCents', 'superContribCents', 'superGainCents', 'salaryMonthlyCents',
    'propertyValueCents', 'propertyPurchaseCents', 'propertyGainCents', 'mortgageBalanceCents',
    'mortgageInterestFeesCents', 'mortgagePrincipalPaidCents', 'mfValueCents', 'mfGainCents', 'otherValueCents',
    'otherGainCents', 'offsetCents', 'mortgageOffsetCents', 'cashDebtCents'] as const;   // CorrectableSnapshotColumn
  export const SNAPSHOT_COLUMN_LABELS: Readonly<Record<SnapshotFigureKey, { label: string; historyColumn: string | null }>>;
  export const RECORD_MONTHS_MAX = 24;                    // months one record request may name
  export const NET_WORTH_PROJECTION_MONTHS = 12;          // the rolling table's projected rows (§2.6 step 7)
  export const SNAPSHOT_RECORD_HOUR = 23;                 // local hour on the month's last day (§4.6; D89)
  export const NET_WORTH_STACK_ORDER = ['stock', 'etf', 'crypto', 'cash', 'managed_fund', 'other_assets', 'super',
    'property'] as const;                                 // every stacked chart, the donut and the legends (§5)
  export const NET_WORTH_CLASS_SLOTS = { stock: 2, etf: 5, crypto: 1, cash: 4, managed_fund: 3, other_assets: 8,
    super: 6, property: 7 } as const;                     // CHART_PALETTE slot per class (§5; validated per stack order
                                                          //   and for the eight-slice donut, D93)
  export const SNAPSHOT_OFFSET_EXTRAS = ['offsetCents', 'mortgageOffsetCents', 'cashDebtCents'] as const;
                                                          // correctable on non-migrated rows only (§4.3)
  export function monthEndOf(month: IsoMonth): IsoDate;   // pure; tested
  export type FeatureKey = /* the 11 'features.*' setting keys */;
  ```
  `SnapshotFiguresShape` is a schema-side interface identical to the engine's `SnapshotFigures` (the engine type is declared `extends`-compatible; a type-level test asserts both directions, as Stage 3 did for DTOs). Labels follow the History headers in plain words ("Stocks value", "Stock movements", "Cash change", "Super contributions (take-home cost)", "Monthly salary", "Mortgage principal paid", "Offset accounts", "Linked offsets", "Accounts in debit", "Super measured to").
- **`src/tax.ts`** (new, root; public ATO figures recorded 2026-09-26, §3.3):
  ```ts
  export const RESIDENT_TAX_TABLES: Readonly<Record<number, readonly { thresholdCents: number; ratio: string }[]>> = {
    2024: [{ thresholdCents: 0, ratio: '0' }, { thresholdCents: 1_820_000, ratio: '0.16' }, { thresholdCents: 4_500_000, ratio: '0.3' },
           { thresholdCents: 13_500_000, ratio: '0.37' }, { thresholdCents: 19_000_000, ratio: '0.45' }],
    2025: /* the same as 2024 */,
    2026: /* as 2024 with '0.15' for the second band */,
    2027: /* as 2024 with '0.14' for the second band */ };   // FY start year → bands; a band applies above its threshold
  export const MEDICARE_LEVY_RATIO = '0.02';
  export const MEDICARE_SHADE_IN_RATIO = '0.1';
  export const MEDICARE_SHADE_IN_FACTOR = '1.25';         // the shade-in ends at threshold × 1.25
  export const MEDICARE_LOW_INCOME_THRESHOLDS: Readonly<Record<number, number>> = { 2024: 2_722_200, 2025: 2_801_100 };   // singles, cents
  export const LITO_PHASE_OUT_FROM_CENTS = 3_750_000;     // the low income tax offset (not built) phases out above this
  export const LITO_PHASE_OUT_TO_CENTS = 6_666_700;       //   and reaches 0 here (5 c/$ to $45,000, then 1.5 c/$)
  export const TAX_RATES_CHECKED_ON = '2026-09-26';
  ```
- **Tables:** the new columns and `snapshotAudit` in `db/tables/history.ts`; `db/index.ts` exports it. `DOMAIN_TABLES_DELETE_ORDER` is unchanged (`snapshot_audit` is not in it: an import never deletes the log). `testing/dump.ts`: `DUMPED_TABLES` unchanged (the log is not dumped; the new snapshot columns are dumped with the row).
- **`rows.ts`:** `newSnapshotSchema` gains the six columns (the extras ≥ / ≤ bounds: `offset_cents ≥ 0`, `mortgage_offset_cents ≥ 0`, `cash_debt_cents ≤ 0`); `newSnapshotAuditSchema` + the type-level and runtime parity tests.
- **`records.ts`:** `snapshots` gains `offset:money linkedOffsets:money cashInDebit:money superMeasuredTo:date revision:integer note:text`; a new entity `'snapshot-audit'` (group History): `at:timestamp period:month action:text trigger:text note:text` (default sort at desc).
- **`settings.ts`:** §3.3.
- **`dto/history.ts`** and **`dto/settings.ts`** (§4.3–4.4) exported from the root, every DTO declared field by field; they reuse the Stage 3 `YearWindowDto` and `CashChartPointDto` from `dto/cashflow.ts` (never redeclared: the root's `export *` would make a duplicate name ambiguous); the module-private `optionalText` and `signedCents` of `dto/assets.ts` move to a shared exported `dto/fields.ts` (dto/assets.ts imports them, unchanged behaviour); `SettingGroupId` is the union of the `SETTING_GROUPS` ids (§3.3); **`dto/errors.ts`** gains four codes (§4.1); **`dto/status.ts`** (additive, optional fields so the Stage 1 fixtures compile): `AppStatus.features?: Partial<Record<FeatureKey, boolean>>` and `AppStatus.history?: { autoRecord: boolean; nextRecordAt: string | null }`; **`dto/cashflow.ts`:** `CashPageResponse.staticUntilStage4` is **removed** (stage-4.md said Stage 5 may drop it; the Scaffolder removes every writer and reader: server, fixtures, web), `SETTINGS_PATCH_MAX_KEYS` rises from 30 to 64.
- **Registry labels (D86, one label per key):** the Scaffolder rewrites the `SETTINGS` labels to the words the Stage 3–4 pages use (e.g. `pay.dayOfMonth` "Pay day (day of the month)", `savings.yearBasis` "Year basis", `savings.includeMortgagePrincipal` "Count mortgage principal as savings") and the feature switches to "Show the Cash page" … ("Show the Super page" for `features.retirement`); the web then drops its per-page label maps, so a page and the Settings page always name a field the same way (§6.5 item 11; a schema test asserts every key has a distinct non-empty label).
- **Schema tests the changes touch:** `registries.test.ts` (the editable key count and order, §3.3), the cash-flow fixture and schema tests (`staticUntilStage4` gone; every editable key in one PATCH within the new maximum), `db.test.ts`, `rows-parity.test.ts`.
- **Fixtures and seed:** §3.6.

### 3.3 Settings (D84–D87)
- **New key** (appended to `SETTING_KEYS` and `SETTINGS`; app-only, `source: null`, so editing it never blocks a re-import; `SettingCategory` gains `'history'`):

  | Key | Label | Type | Default | Readers use |
  |---|---|---|---|---|
  | `history.autoRecord` | "Record each month automatically on its last day" | boolean | `false` (D84) | the recorder, unless `AUTO_RECORD` is set (§4.6) |

- **Setting groups** (`SETTING_GROUPS`, new export; display order, each key in exactly one group; anchors `/settings#<id>`; a schema test asserts the partition):

  | Group id | Label | Keys |
  |---|---|---|
  | `pay` | Pay and tax | `pay.frequency`, `pay.netPayCents`, `pay.dayOfMonth`, `pay.grossAnnualSalaryCents`, `pay.jobStartDate`, `tax.marginalRate` (+ the tax suggestion, §6.5) |
  | `budget` | Budget | `budget.useForInvestAmount`, `budget.autoInvestSplit`, `budget.includeSideIncome`, `budget.emergencyFundMonths`, `budget.emergencyFundOverrideCents` |
  | `cash` | Cash and savings | `savings.yearBasis`, `savings.includeMortgagePrincipal`, `goals.cashSavingsTargetCents`, `goals.eoyCashGoalCents`, `goals.houseDepositInvestmentShare`, `property.offsetsIncludeEmergencyFund` |
  | `allocation` | Allocation targets | `allocation.etf`, `allocation.stock`, `allocation.crypto`, `allocation.cash`, `allocation.managedFund`, `allocation.otherAssets` |
  | `investing` | Investing | `investing.defaultBrokerageCents`, `investing.allocationAggressiveness`, `investing.etfLimit`, `returns.cashInterestRate`, `returns.marketReturn`, `crypto.feeRate` |
  | `super` | Super | `super.sgRate`, `super.contributionsTaxRate`, `super.concessionalCapCents`, `super.concessionalCapFy` (not editable: `lockedBy 'server'`, shown read-only beside the cap), `super.importedContributionType` |
  | `assets` | Other assets | `otherAssets.stalePriceDays` |
  | `history` | History and charts | `history.autoRecord`, `charts.dateUnit`, `charts.unitCount` |
  | `features` | Pages | `features.*` (11 keys) |
  | `fire` | FIRE (used from Stage 6) | `fire.*` (6 keys) |
  | `unused` | Kept from the workbook (editable, not used by the app; D91) | `goals.housePriceTargetCents`, `goals.houseDepositRatio`, `goals.houseSavingsPerYearCents`, `investing.parcelFrequencyMonths`, `investing.parcelAmountCents`, `savings.includeRetirementContributions` |

- **`EDITABLE_SETTING_KEYS`** (D86: every setting the app uses): the Stage 3–4 twenty-two keys first, unchanged in order (the Budget nine, the Cash six, the Stage 4 seven), then appended in registry order every other key **except** `super.concessionalCapFy` (server-written, Stage 4), the six `unused` keys included (**D91**: editable although nothing reads them (D55 replaced the house-deposit tracker, the parcel plan is computed by the engine (Stage 2), D37 dropped the retirement tag); they are workbook keys, so editing one blocks a re-import, D34), and finally `history.autoRecord`. That is **60 editable keys** of 61 (`SETTINGS_PATCH_MAX_KEYS` 64 still holds them all in one PATCH). The Stage 4 page constants (`SUPER_PAGE_SETTING_KEYS` …) are unchanged; each page's settings section links to its group (§6.6).
- **Features (the sheet's First Time Setup toggles):** a `false` feature hides its pages from the navigation (`features.cash` → Cash; `etfs`, `stocks`, `managedFunds`, `crypto` → their pages; `budget`; `sideIncome`; `otherAssets`; `property`; `retirement` → Super; `fire` → FIRE; Dividends hides only when ETFs, Stocks and Managed Funds are all off, the sheet's rule); a hidden page still opens from a link and shows `Callout note` "This page is switched off in Settings (Pages)". Nothing else changes: every figure still counts in net worth (§11 fix 13).
- **Statutory figures** (`src/tax.ts`, §3.2), recorded 2026-09-26 from web-search summaries of ato.gov.au ("Tax rates – Australian resident", "Medicare levy reduction for low-income earners") and adviser pages, because the ATO site refuses automated fetches: the bands of the verified facts above; the Medicare low-income threshold 2025–26 of $28,011 (up 2.9 % from $27,222, retrospective to 1 July 2025); 2026–27 not yet announced, so the 2025–26 threshold is used with the note "The 2026–27 Medicare threshold is not out yet; using 2025–26's". The Settings page shows "ATO rates checked 26/09/2026".
- **The Stage 3 settings rules** (no-op saves write nothing; `hasAppData` counts only workbook keys with `origin = 'app'`; a forced import deletes app rows of workbook keys it does not provide) are unchanged; **D87 adds rule 4 (§3.5).**
- **The groups hold 61 keys** (pay 6, budget 5, cash 6, allocation 6, investing 6, super 5, assets 1, history 3, features 11, fire 6, unused 6); the schema test asserts they partition `SETTING_KEYS`.
- `settingsPatchSchema` bounds apply to every newly editable key: ratios within the registry min–max, money ≤ `CASHFLOW_MONEY_MAX`, integers within their registry bounds or `SETTINGS_INTEGER_MAX`; a PATCH of `allocation.*` is accepted even when the targets do not add up to 100 % (the page warns, §6.5). **Write-only bounds** (a new `SETTING_WRITE_BOUNDS` table read by `settingWriteBoundIssue`; the registry and `settingValueSchema` stay unchanged, so an imported value outside them still imports and D87 is unaffected): `charts.unitCount` 1–240 (the `count` query's range); `returns.cashInterestRate`, `returns.marketReturn` and `fire.inflationRate` −1 to 1; `fire.withdrawalRate` 0 to 1 (the four ratios with no registry bounds). A schema test covers each. **The six `unused` keys (D91) need no write-only bound:** the registry bounds them already (`goals.houseDepositRatio` 0–1; the three money keys ≥ 0, ≤ `CASHFLOW_MONEY_MAX`; `investing.parcelFrequencyMonths` 0 to `SETTINGS_INTEGER_MAX`; the switch a boolean); a schema test PATCHes each at its bounds and one step past them.
- **Preference keys (D95, the owner's answer to plan review UX-20):** `charts.dateUnit`, `charts.unitCount` and the 11 `features.*` keys are display choices, listed in a new `PREFERENCE_SETTING_KEYS`. An app edit of one never counts toward `hasAppData` (so hiding a page or changing the default chart view before the cutover does not block a re-import, D84), and a re-import **keeps** the app value (the importer skips writing a preference key whose stored row has `origin 'app'`, with an info line `settings.keptAppPreference`, count only; D87 still resets an import-origin row the workbook no longer provides). The Settings page shows "Kept when you re-import" on these two groups instead of the workbook callout; `SettingDto.preference` says so. The dashboard's view switch stays view-only (the query, §4.5); the saved default is changed on the Settings page.

### 3.4 Origin rules and D34 for the Stage 5 entities
**Principle (Stages 3–4):** `hasAppData` is true when a re-import would undo or lose something entered in the app.

| Entity | Create | Update | Delete | Counts as app data |
|---|---|---|---|---|
| Recorded month (`recorded`, `lookback`, `late`) | `origin app`, `recorded_at` = the record time; audit `record` | a correction: figures only, `revision + 1`, audit `correct` | **the latest snapshot only**, and never a migrated one (D92); audit `delete` (the full row); no marker (no `sheet_ref`) | **yes** (D34, D84: recorded months block a re-import) |
| Migrated month | (the import) | a correction turns it `origin app` (the workbook callout says so) | refused (409 `SNAPSHOT_NOT_DELETABLE`; D92) | once corrected |
| `snapshot_audit` | log | — | never | **no** |
| `app_meta` recorder keys (§4.6) | state | state | — | **no** |
| `history.autoRecord` | — | app-only setting | — | **no** |
| Newly editable workbook settings (the six `unused` keys included, D91) | — | `origin app` (§3.3) | — | yes (as before), **except** the preference keys (`charts.*`, `features.*`; D95, §3.3) |

`hasAppData` scans `snapshots` through `DOMAIN_TABLES_DELETE_ORDER` already, so a recorded month counts with no code change (a test asserts it). Its settings rule gains one exclusion: app rows of `PREFERENCE_SETTING_KEYS` never count (server-api, `db/queries/domain.ts`, D95). A committed CLI import with `--replace-app-data` deletes recorded months with every other app row, after its usual backup (D34); the audit log stays.

### 3.5 Importer changes (importer owner)
1. **D87 (settings rule 4):** after writing the workbook's settings, a settings row with **`origin = 'import'`** whose key this workbook does **not** provide is deleted, so the setting reads its registry default (the workbook stopped providing it: a blank cell, an invalid value, or a template formula for an "only when typed" key). App rows keep the Stage 3 rules (app-only keys are never touched; an app row of a workbook key the workbook does not provide is removed by a forced import, rule 3). The report adds an **info** line `settings.resetToDefault` (count only, `refs.entity: settings`) when any row was reset. The dry run reports the same line without writing. **Preference keys (D95, §3.3):** a key in `PREFERENCE_SETTING_KEYS` whose stored row has `origin 'app'` is not overwritten by the workbook's value; an info line `settings.keptAppPreference` (count only) reports it (also in the dry run).
2. **Snapshots:** unchanged (source `migrated`, the new columns null). The reconciliation's existing snapshot checks are unchanged.
3. **Idempotency:** the same workbook imported twice gives identical dumps (ids included); a workbook with a setting cell blanked, imported over a first import, leaves that key unset (default) and the report's line (a test through `mutate`).
4. **Migration equivalence** (the Stage 4 pattern: the Stage 5 importer's Drizzle inserts name every column, so it cannot write into a 0004 schema): rebuild the 0004 shape from the Stage 5 import dump **without the six new snapshot columns**, insert it with raw `INSERT`s into a database stopped at 0004, upgrade to 0005, and compare with the Stage 5 import's dump without ids (the new columns null and `revision 0` both ways); also the faulty duplicate-month variant. The Stage 4 helper `test/stage3-upgrade.ts` strips the six columns from `snapshots` in `stage3Shape` too (a Scaffolder compile fix, §7.1), so the 0003 → latest equivalence test and the importer golden keep passing.
5. `IMPORTER_STAGE5_IMPLEMENTED` (`@joinr/importer/testing`; Scaffolder: false) is set true only after the importer's own suite passes with the changes above.

### 3.6 Seed and fixtures (Scaffolder)
- **`seedGenericData`** stays import-only (`origin import`, **no `app` rows**, so the Stage 1 import-route tests still get 201): its three snapshots keep null extras. A second helper **`seedRecordedMonth(db, { periodMonth, runDate })`** (testing only) inserts one `recorded` snapshot with generic figures, `origin app`, the four extras set and one audit row, for server and web tests of recorded months.
- **`src/fixtures/history.ts`** (from `@joinr/schema/fixtures`; typed with `satisfies`, generic values, internally consistent, produced by a scratch script that applies the §2 rules):
  - `netWorthPages`: `populated` (migrated and recorded months, the live row, every class non-zero, one account in debit, one linked offset and one unlinked offset, a mortgage, the gauge with a target, the rolling table with 12 projected rows, a distribution with all eight drawable classes positive so the donut draws eight slices (D93), trends on every chart), `negativeEquity` (a property worth less than its mortgage: the slice excluded and listed), `noSnapshots` (live figures only: changes null, charts show the live point, the rolling table one live row), `noSavings` (no closed period in the year: the gauge "—"), `quarterly` and `yearly` (the same data grouped, FY labels), `calendarYear` (`savings.yearBasis` = calendar), `recordedToday` (no provisional period: the latest snapshot shown with the change against the one before it, no live group), `otherDebts` (a migrated month with a non-zero `U`: the `other_debts` liability and the chart's "Other debts" series), `autoRecordOffNoAppData` (the current month's last day passed unrecorded, auto-record off, `hasAppData` false: the Note callout of §6.3 item 3).
  - `historyPages`: `populated` (migrated months, a recorded month, a `late` pair sharing a run date, a `lookback` month, a corrected month with revision 1 and its audit entries, the live row, recordable months with a missing month, auto-record on with a next run, a consistency result with one movement difference), `autoRecordOff`, `envLocked` (`AUTO_RECORD` set), `noSnapshots`, `nothingToRecord` (the current month already recorded), `recordInProgress`, `autoRecordBlocked` (auto-record on, the current month's record time passed, an earlier month missing: `recorder.blocked` set).
  - `settingsPages`: `populated` (every group, the `unused` group editable (D91); workbook, app and preference origins; the tax suggestion in the `full` Medicare band; allocation targets adding to 100 %), `taxShadeIn` and `taxNoLevy` (the other two Medicare bands, §6.5 item 3), `taxLito` (an income in the LITO phase-out range), `unbalanced` (targets adding to 102 %), `noSalary` (no suggestion), `envLocked`, `featuresOff` (two pages hidden).
  - Mutation examples: `recordResponse`, `correctionResponse`, `deleteSnapshotResponse`, `settingsPatchResponse` (updated).
  - `apiErrors` gains `snapshotExists`, `snapshotNotLatest`, `snapshotNotDeletable`, `recordInProgress`, `historyValidation`.
  - **`fixtures/cashflow.ts`:** `staticUntilStage4` removed everywhere.
  - `FIXTURE_COVERAGE` gains `snapshotSources`, `netWorthClasses`, `netWorthLiabilities`, `snapshotAuditActions`, `recordTriggers`, `settingGroups`.
- Records fixtures (`sampleDtos.ts`): the `snapshots` page gains the new columns; one page for `snapshot-audit`.

---

## 4. API contract (FROZEN)

All routes are under `/api`, JSON, `cache-control: no-store`, with the Stage 0 error shape; bodies, params and queries validated with `parseWith` (400 `VALIDATION_ERROR`, `path: issue; …`). Money is integer cents; decimals are strings; dates `YYYY-MM-DD`; months `YYYY-MM`.

### 4.1 Error codes (`API_ERROR_CODES` gains four)
`SNAPSHOT_EXISTS` **409** ("Mar 2027 is already recorded (31/03/2027). Correct it instead.") · `SNAPSHOT_NOT_LATEST` **409** ("Only the latest recorded month can be deleted") · `SNAPSHOT_NOT_DELETABLE` **409** ("Imported months can be corrected but not deleted"; both D92) · `RECORD_IN_PROGRESS` **409** ("A month is being recorded; try again in a moment"). Reused: `NOT_FOUND` 404, `VALIDATION_ERROR` 400, `IMPORT_IN_PROGRESS` 409.

### 4.2 Endpoints
| Method & path | Request | 2xx | Errors |
|---|---|---|---|
| `GET /api/net-worth` | query `netWorthQuerySchema` (`unit?`, `count?`: a view-only override of the chart settings) | 200 `NetWorthPageResponse` | 400 |
| `GET /api/history` | — | 200 `HistoryPageResponse` | |
| `GET /api/history/series` | query `historySeriesQuerySchema` (`unit?`, `count?`) | 200 `HistorySeriesResponse` (the aggregation API) | 400 |
| `POST /api/history/record` | `recordRequestSchema` | **201** `RecordResponse` | 400 (a month not recordable) · 409 `SNAPSHOT_EXISTS` · 409 `RECORD_IN_PROGRESS` · 409 `IMPORT_IN_PROGRESS` |
| `PUT /api/history/snapshots/:periodMonth` | `snapshotCorrectionSchema` | 200 `CorrectionResponse` | 400 · 404 · 409 `RECORD_IN_PROGRESS` |
| `DELETE /api/history/snapshots/:periodMonth` | — | 200 `DeleteSnapshotResponse` | 404 · 409 `SNAPSHOT_NOT_LATEST` · 409 `SNAPSHOT_NOT_DELETABLE` · 409 `RECORD_IN_PROGRESS` |
| `GET /api/settings` | — | 200 `SettingsPageResponse` | |
| `PATCH /api/settings` | (Stage 3) every editable key of §3.3 | 200 `SettingsPatchResponse` (unchanged shape) | 400 |
| `GET /api/cash` | (Stage 3) | `staticUntilStage4` removed (§3.2) | |
| `GET /api/status` | (Stage 1) | additive `features`, `history` (§3.2) | |
| `GET /api/health` | (Stage 0) | `db.migrations` becomes **6** | |

Every mutation above answers **409 `IMPORT_IN_PROGRESS`** first while the upload import holds the import lock: the record route through the recorder (§4.6 item 6), and the `PUT`/`DELETE` routes **before** entering `withLock` (so they never wait behind a record while an import runs). **The recorder never holds the import lock** (§4.6 item 6): an upload import is not refused while a record waits for prices, the Stage 2–4 mutations never see a record as an import, and a record re-checks the lock synchronously just before its synchronous write. `:periodMonth` uses `IsoMonthSchema`.

### 4.3 Request schemas (`dto/history.ts`, `dto/settings.ts`)
```ts
export const netWorthQuerySchema = z.strictObject({ unit: z.enum(CHART_DATE_UNITS).optional(),
  count: z.coerce.number().int().min(1).max(240).optional() });
export const historySeriesQuerySchema = netWorthQuerySchema;
export function makeRecordRequestSchema(now) {                      // recordRequestSchema = make…()
  return z.strictObject({
    periodMonths: z.array(IsoMonthSchema).min(1).max(RECORD_MONTHS_MAX),   // + unique ('periodMonths: a month appears twice');
                                                                    //   each ≤ the as-of month ('periodMonths.N: after this month')
    note: optionalText(200) });                                     // '' → null
}   // server rule (§4.5): every month must be recordable (recordableMonths)
export const snapshotCorrectionSchema = z.strictObject({
  values: z.record(z.enum(CORRECTABLE_SNAPSHOT_COLUMNS), signedCents.nullable())   // 1–24 columns; null clears the cell
    .refine(nonEmpty, 'values: name at least one figure'),          // + per-column bounds: offset ≥ 0, linked offsets ≥ 0,
                                                                    //   in debit ≤ 0, mortgage balance ≤ 0 (the stored sign;
                                                                    //   the web negates the positive "owed" figures, §6.4)
  note: z.string().trim().min(1, 'note: say why').max(200) });
// Server rules on top (§4.5, need the row): the SNAPSHOT_OFFSET_EXTRAS are refused on a migrated row (400
// 'values.offsetCents: not recorded for imported months') and cannot be null on any other row (400 'values.X: required').
// Each factory's default export binds the real clock (as dto/cashflow.ts); parsed types are exported alongside.
```

### 4.4 DTOs (`dto/history.ts`, `dto/settings.ts`, frozen field lists)
```ts
// ─── Shared ───
export interface SnapshotFiguresDto { /* every SnapshotFigures field, Cents → number (§2.2) */ }
export interface NetWorthBreakdownDto { liquidCents: number; superCents: number; propertyCents: number;
  liabilitiesCents: number; offsetsCents: number; netWorthCents: number; missing: string[] }
export interface SnapshotDto {
  id: number; periodMonth: IsoMonth; runDate: IsoDate; source: SnapshotSource; recordedAt: string | null;
  origin: Origin; sheetRef: string | null; note: string | null; revision: number;
  figures: SnapshotFiguresDto; netWorth: NetWorthBreakdownDto;
  late: boolean;                                   // source 'late' or 'lookback' (the "Recorded late" badge)
  sharedRunDate: boolean;                          // another month has the same run date (§2.9)
  savingsRatio: DecimalString | null;              // the period's adjusted rate (the savings engine)
  check: { checked: number; differences: SnapshotDifferenceDto[] };   // §2.5 for this row
  deletable: boolean;                              // the latest and not migrated
}
export interface SnapshotDifferenceDto { column: SnapshotCheckColumn; kind: 'derived' | 'movement';
  storedCents: number | null; recomputedCents: number | null; storedRatio: DecimalString | null;
  recomputedRatio: DecimalString | null }
export interface SnapshotAuditDto { id: number; periodMonth: IsoMonth; action: SnapshotAuditAction; trigger: RecordTrigger;
  at: string; note: string | null;
  changes: { key: string; before: number | string | null; after: number | string | null }[];   // "column" or "YYYY-MM.column"
  detail: { pricesAsOf: string | null; marketMode: MarketDataMode | null; pricesRefreshed: boolean | null } | null }
export interface RecorderStatusDto {
  autoRecord: { enabled: boolean; source: 'setting' | 'env' };   // env: AUTO_RECORD is set (the switch is locked)
  since: IsoDate | null;                           // the date auto-record was last switched on (catch-up floor, §2.9)
  recordHour: number;                              // SNAPSHOT_RECORD_HOUR
  nextRunAt: string | null;                        // the next month-end record time (local, ISO with offset), null when off
  running: boolean;
  lastRun: JobRunSummary | null;                   // the scheduler's `snapshot` job
  blocked: { periodMonth: IsoMonth; missing: IsoMonth[] } | null;   // recordingsDue().blocked now (§2.9; D94)
}
// The recorder's TypeScript types (§4.6): RecorderStatus = RecorderStatusDto; RecordDetail = { pricesAsOf: string | null;
//   marketMode: MarketDataMode; pricesRefreshed: boolean; pricesAgeMs: number | null; jobRunId: number | null }.

// ─── History ───
export interface HistoryPageResponse {
  asOf: IsoDate; generatedAt: IsoTimestamp; hasAppData: boolean;
  snapshots: SnapshotDto[];                        // newest first (run-date order reversed)
  live: { periodMonth: IsoMonth; runDate: IsoDate; figures: SnapshotFiguresDto; netWorth: NetWorthBreakdownDto;
    pricesAsOf: string | null; unpricedCount: number; stalePriceCount: number } | null;   // null when asOf ≤ the last run
  record: { nextMonth: IsoMonth; recordable: IsoMonth[];         // §2.9
    defaultMonths: IsoMonth[];                     // §6.4: ended months; else the current month
    missing: IsoMonth[];                           // recordable months that have ended
    gaps: IsoMonth[] };                            // months between the first and the latest snapshot with no snapshot (never recordable)
  recorder: RecorderStatusDto;
  consistency: { checked: number; matched: number; migratedChecked: number; migratedMatched: number;
    movementDifferences: number; derivedDifferences: number;   // Σ of the rows' checks (cells)
    migratedMonths: number; derivedMatchedMonths: number;  // imported months whose stored figures all reproduce (§6.4 item 7)
    movementMonths: IsoMonth[] };                  // months with a movement difference (information, never a failure)
  audit: SnapshotAuditDto[];                       // newest first, at most 200
  charts: { unit: ChartDateUnit; count: number | null; groups: SnapshotGroupDto[] };   // the "What you own" chart (§5)
}
export interface SnapshotGroupDto { label: string; period: IsoMonth; date: IsoDate; live: boolean; rows: number;
  figures: SnapshotFiguresDto; netWorth: NetWorthBreakdownDto; growthCents: number | null; liquidGrowthCents: number | null }
export interface HistorySeriesResponse { unit: ChartDateUnit; count: number | null; yearBasis: YearBasis;
  groups: SnapshotGroupDto[]; modes: Record<string, 'end' | 'sum' | 'ratio'> }
export interface RecordResponse { recorded: SnapshotDto[]; hasAppData: boolean }   // ascending month order
export interface CorrectionResponse { snapshot: SnapshotDto; next: SnapshotDto | null; audit: SnapshotAuditDto }
export interface DeleteSnapshotResponse { periodMonth: IsoMonth; audit: SnapshotAuditDto; hasAppData: boolean }

// ─── Net worth ───
export interface NetWorthPageResponse {
  asOf: IsoDate; generatedAt: IsoTimestamp; lastRun: IsoDate | null; liveMonth: IsoMonth;
  hasAppData: boolean;                             // the callout choice of §6.3 item 3 (D84)
  recordable: IsoMonth[];                          // recordableMonths (the Record month action shows when non-empty)
  recordedToday: boolean;                          // no provisional period: `live` is the latest snapshot (§4.5)
  live: { figures: SnapshotFiguresDto; netWorth: NetWorthBreakdownDto };
  assetsCents: number; liabilitiesCents: number; assetsExSuperCents: number;
  classes: { key: NetWorthClass; valueCents: number; gainCents: number | null; gainRatio: DecimalString | null }[];
  liabilities: { key: NetWorthLiability; balanceCents: number; grossCents: number; offsetCents: number }[];
  sinceLastRecord: NetWorthChangeDto; thisYear: NetWorthChangeDto & { year: YearWindowDto };
  distribution: { values: { key: NetWorthClass; valueCents: number }[];
    slices: { key: NetWorthClass; valueCents: number; ratio: DecimalString }[];   // up to 8, no fold (D93)
    excluded: { key: NetWorthClass; valueCents: number }[]; drawnCents: number };
  savingsRate: { ratio: DecimalString | null; rawRatio: DecimalString | null; year: YearWindowDto; periods: number;
    targetRatio: DecimalString | null };
  averageSavings: { monthCents: number | null; yearCents: number | null; periods: number };
  allocation: { assetClass: AssetClass | null; reason: ConsiderReason; rows: ConsiderNextRowDto[];
    targetSumRatio: DecimalString | null };        // Σ allocation.* (the Settings warning, §6.5)
  prices: { unpricedCount: number; stalePriceCount: number; lastRefreshAt: string | null; mode: MarketDataMode };
  recorder: RecorderStatusDto;
  rolling: RollingNetWorthRowDto[];                // oldest first: recorded, live, projected (the web shows newest first by default)
  charts: {
    unit: ChartDateUnit; count: number | null; yearBasis: YearBasis;
    groups: SnapshotGroupDto[];                    // historical net worth, liquid assets and the tracker read these
    savings: CashChartPointDto[];                  // compressCashflow (the Stage 3 DTO, reused)
    trends: { liquid: TrendDto; tracker: TrendDto };   // fitted per group, in `groups` order
  };
  notes: { periodMonth: IsoMonth; text: string }[];    // the spend notes (the rolling table's U)
}
export interface NetWorthChangeDto { base: { periodMonth: IsoMonth; runDate: IsoDate; netWorthCents: number } | null;
  cents: number | null; ratio: DecimalString | null }
export interface RollingNetWorthRowDto { periodMonth: IsoMonth; runDate: IsoDate | null;
  status: 'recorded' | 'live' | 'projected'; source: SnapshotSource | null; netWorth: NetWorthBreakdownDto | null;
  growthCents: number | null; liquidGrowthCents: number | null; savingsRatio: DecimalString | null;
  rawSavingsRatio: DecimalString | null; projectedLiquidCents: number | null }
export interface TrendDto { fittedCents: (number | null)[]; slopePerMonthCents: number | null; points: number }
// YearWindowDto and CashChartPointDto: the Stage 3 declarations in dto/cashflow.ts (imported, never redeclared).

// ─── Settings ───
export interface SettingDto {
  key: SettingKey; label: string; group: SettingGroupId; type: SettingType; enumValues: string[] | null;
  min: number | null; max: number | null; defaultValue: SettingValue | null;
  value: SettingValue | null; origin: Origin | null;   // null origin: never stored (the default applies)
  workbook: boolean;                               // isWorkbookSetting and not a preference key: editing it blocks a re-import (D34)
  editable: boolean;                               // in EDITABLE_SETTING_KEYS (every key but super.concessionalCapFy; D91)
  lockedBy: 'env' | 'server' | null;               // env: AUTO_RECORD; server: super.concessionalCapFy
  preference: boolean;                             // in PREFERENCE_SETTING_KEYS: kept on re-import, never app data (§3.3; D95)
  usedOn: string[];                                // page ids that read it (the web links back, §6.5; [] for the unused keys)
}
export interface MarginalRateSuggestionDto { /* every MarginalRateSuggestion field, Cents → number */;
  checkedOn: IsoDate; currentRatio: DecimalString | null;          // tax.marginalRate now
  matches: 'suggested' | 'bracket' | null }        // the current rate equals one of the two figures (D90)
export interface SettingsPageResponse {
  asOf: IsoDate; generatedAt: IsoTimestamp; hasAppData: boolean;
  groups: { id: SettingGroupId; label: string; keys: SettingKey[] }[];
  settings: SettingDto[];                          // registry order
  taxSuggestion: MarginalRateSuggestionDto | null; // null without a gross salary
  allocationSumRatio: DecimalString | null;        // Σ allocation.* set values (null when none is set)
  recorder: RecorderStatusDto;
}
```
server-api adds a type-level test that `SnapshotFigures`, `NetWorthBreakdown`, `SnapshotGroup`, `RollingNetWorthRow`, `TrendResult` and `MarginalRateSuggestion` are assignable to their DTOs (Cents → number), and that `SnapshotFiguresShape` (schema) and `SnapshotFigures` (engine) are mutually assignable.

### 4.5 Server behaviour (server-api; `apps/server/src/history/**`, `apps/server/src/settings/**`, the routes)
**One request context.** The Stage 3–4 `FinanceContext` gains `snapshots()` (the `EngineSnapshot` rows in run-date order), `composeLive()` (`composeSnapshot` at `asOf` for `nextRecordMonth`, null when `asOf ≤ lastRun`), `netWorth()` (`netWorthDashboard`), `rolling()` and `check()` (`checkSnapshots`), each computed once per request. Every figure comes from the engine; the server adds display fields only (names, notes, origins, audit rows).

**Engine inputs built by the server** (`apps/server/src/history/inputs.ts`, each unit-tested):
| Input | Source |
|---|---|
| `EngineSnapshot` | `snapshots` rows, every column; `source`; the new columns as stored (null on migrated rows) |
| `ComposeSnapshotInput` | `investments` = `ctx.compute(kind)` for the four kinds; `trades` = the context's trade rows by kind (`EngineTrade`); `cash` = `ctx.cashTotals()`; `cashAccounts` = the accounts at their current balances; `salaryMonthlyCents` = `monthlyPayCents(pay settings)` (as the savings live input); `assets` = `ctx.assetsSnapshot()`; `superMeasuredThrough` = `ctx.superResult().measuredThrough ?? null`; `previous` = the latest snapshot |
| **Savings: `SavingsSnapshotInput.offsetCents`** (D88b, the Stage 4 rule generalised) | a snapshot with a stored `offset_cents` (every non-migrated snapshot has one: §4.3) → that figure; **the last migrated month** (the latest snapshot with `source 'migrated'`; migrated months always sort before recorded ones, since recorded months block a re-import) → the Stage 4 derivation at its run date (Σ today's offset accounts' latest balance entries on or before it, with the workbook-flag exception, stage-4.md §2.9), so the first recorded month's Δ offsets is exact; every earlier migrated month → null (Δ 0 between migrated months). The seam is defined by source, not by a null value, and a correction can never set or clear an offset figure on a migrated row (§4.3), so no correction moves it. With no offset account and no stored figure, everything stays null. |
| **Super: `SuperInput.snapshots[].measuredThrough`** | `super_measured_through` (null on migrated rows) |
| `NetWorthDashboardInput` | `live` = `composeLive()` (or, when `asOf ≤ lastRun`, the latest snapshot's figures so the page still shows today's position: see "No provisional period" below); `plannedSavingsRatio` = `ctx.budget().plannedSavingsRatio`; `considerNext` from the Stage 2 timing chain (`ctx.budgetInvest()` … as the investment pages) |
| `RollingNetWorthInput` | the snapshots; `live`; `savings` = `ctx.savings().periods`; `projection` = `{ monthlyCents: kpis.avgSavingsCents, months: NET_WORTH_PROJECTION_MONTHS }` |
| charts | `unit ?? charts.dateUnit ?? 'monthly'`, `count ?? charts.unitCount ?? null`, `yearBasis` = `savings.yearBasis ?? 'fy'` (the query overrides the settings for this response only; nothing is saved) |

**No provisional period** (the month was recorded today, or `asOf = lastRun`): `live` is null in the History response; the Net Worth response sets `recordedToday: true`, passes the latest snapshot's figures as `live` and shows them as "Recorded today"; the engine's base rule (the latest snapshot with `runDate < asOf`, §2.6 step 4) gives the change against the snapshot before it, and no chart group is live.

**Recording** (`writeRecordedMonths`, `apps/server/src/history/record.ts`, **frozen signature**, synchronous, called only by the recorder's mutex, §4.6):
```ts
export function writeRecordedMonths(deps: FinanceDeps, req: { periodMonths: readonly IsoMonth[]; source: 'recorded' | 'lookback' | 'late';
  trigger: RecordTrigger; note: string | null; now: Date; detail: RecordDetail }): RecordedMonth[];
// RecordedMonth = { id: number; periodMonth: IsoMonth; auditId: number }; throws ApiError for the §4.1/400 cases
```
1. One `BEGIN IMMEDIATE` transaction. Re-check (400) that each month is in `recordableMonths(snapshots, today)` (`today` = the server-local date of `now`) and (409 `SNAPSHOT_EXISTS`) that none is recorded, **in ascending month order**.
2. Per month: build a fresh finance context **inside the transaction** (reads see the months written before it), `composeSnapshot` for that month at `asOf = today`, then `deriveSnapshotColumns` (so the stored derived columns agree by construction) and insert with `run_date = today`, `recorded_at = now` (UTC ISO), `origin 'app'`, `source` = `recorded` for the current month, else `lookback` (manual) or `late` (scheduler catch-up), `note`, `revision 0`; one audit `record` row with `snapshot_json` and `detail_json`.
3. Commit; return the rows. **Idempotency:** `period_month` is unique, so a month can never be recorded twice; a scheduled record of a month already recorded (by hand earlier that day) is a no-op with detail `already_recorded` (§4.6).

**Corrections** (`PUT /api/history/snapshots/:periodMonth`; the import-lock check first, then the recorder's mutex): 404 when missing; the `SNAPSHOT_OFFSET_EXTRAS` rules (400 on a migrated row; null refused on any other row); one IMMEDIATE transaction: apply the named columns (null clears a cell; values equal to the stored ones are dropped; nothing left → 200 with no audit row and no revision change), recompute `deriveSnapshotColumns` for this row and for the **next** snapshot (its `O`, `P` follow a corrected `N`), bump `revision` on the corrected row only, set `origin 'app'` on it (a migrated row stops matching the workbook: the web's callout, §6.4), and write one audit `correct` row with every before/after (the next row's keyed `"YYYY-MM.column"`) and the note. The identity trigger (§3.1) makes a run-date or month change impossible at the database level.

**Deletes** (`DELETE …/:periodMonth`; D92: the latest app-recorded month only, audited; the import-lock check first, then the mutex): 404 when missing; 409 `SNAPSHOT_NOT_DELETABLE` for `source 'migrated'`; 409 `SNAPSHOT_NOT_LATEST` unless it is the latest in run-date order (for months sharing a run date, the latest month); delete in one transaction with an audit `delete` row (`snapshot_json`). No marker (no `sheet_ref`). A deleted month becomes recordable again.

**The recorder's live state** reaches the pages through `app.recorder.status()` (§4.6); the History and Net Worth responses include it.

**Settings** (`apps/server/src/settings/**`): `GET /api/settings` builds `SettingsPageResponse` from the registry, the stored rows (`readSettings`), `SETTING_GROUPS`, `EDITABLE_SETTING_KEYS`, `suggestMarginalRate({ incomeCents: pay.grossAnnualSalaryCents, asOf })` and the recorder status; `usedOn` comes from a server constant `SETTING_READERS` (page ids per key; unit-tested against the page setting-key constants). `PATCH /api/settings` (Stage 3 route, extended keys): unchanged rules; after commit, when `history.autoRecord` is among the written keys, it calls `app.recorder.settingsChanged()`; the response slice is `settingsResponse` for the named keys: every page slice holding a named key **plus the named keys themselves** (a key on no page, e.g. `features.*`, `fire.*`, `charts.*`, `history.autoRecord`, is still returned; server-api changes `cashflow/responses.ts` and its test). Writing `history.autoRecord` while `AUTO_RECORD` is set → 400 `values.history.autoRecord: set by the server's AUTO_RECORD`.

**Status:** `GET /api/status` adds `features` (every `features.*` value, default true) and `history` (`{ autoRecord, nextRecordAt }` from the recorder).

**Cash page:** the "Recording a month arrives in Stage 5" texts are replaced (web, §6.7); `staticUntilStage4` is gone (§3.2).

**Stage 2 charts (§11 fix 5):** `investments/charts.ts` passes `yearBasis 'fy'` to `compressSeries`, so every yearly chart group is a financial year (D52).

**Cross-cutting (server-api):**
- `records/index.ts`: the new snapshot columns and the `snapshot-audit` entity.
- `db/queries/domain.ts`: `hasAppData` already scans `snapshots`; its settings rule skips `PREFERENCE_SETTING_KEYS` (D95, §3.3); tests that a recorded month makes it true and deleting it makes it false again, and that an app edit of `features.crypto` leaves it false.
- **Consistency:** single user, last write wins, except that every snapshot write goes through the recorder's mutex. A CLI import beside a running server can replace rows; a later correction naming a vanished month gets 404.

### 4.6 The recorder (recorder owner; `apps/server/src/history/recorder.ts`)
**Frozen interface** (the Scaffolder stubs it; `buildApp` constructs it and decorates `app.recorder`; `index.ts` calls `app.recorder.start()` after `app.scheduler.start()`; `preClose` awaits `app.recorder.stop()` before the scheduler stops, and `stop()` aborts its own wait first, item 8):
```ts
export interface SnapshotRecorder {
  start(): void;                                   // registers the `snapshot` job, schedules the start-up catch-up and the timer
  stop(): Promise<void>;                           // aborts an in-flight price wait, clears the timer, waits for the attempt
  record(req: { periodMonths: readonly IsoMonth[]; note: string | null }): Promise<RecordedMonth[]>;   // manual (routes)
  withLock<T>(fn: () => T): Promise<T>;            // corrections and deletes run inside the same mutex
  settingsChanged(): void;                         // re-reads the switch, stamps `since`, re-plans
  status(): RecorderStatus;                        // = RecorderStatusDto (§4.4)
}
export function createSnapshotRecorder(deps: { database: AppDatabase; config: Config; market: MarketDataService;
  scheduler: Scheduler; engine: EngineApi; log: FastifyBaseLogger; now?: () => Date; clock?: Clock }): SnapshotRecorder;
// BuildAppOptions gains (additive, a Scaffold note): recorderClock?: Clock. buildApp passes its own `now` and
// `recorderClock ?? systemClock` to createSnapshotRecorder.
```
Constants (`recorder.ts`): `SNAPSHOT_STARTUP_DELAY_MS = 60_000` (after the price job's first run), `SNAPSHOT_WAKE_MAX_MS = 6 × 3_600_000` (the timer never sleeps longer: `setTimeout`'s limit and DST changes), `SNAPSHOT_RETRY_MS = 15 × 60_000`, `SNAPSHOT_LOCK_WAIT_MS = 30_000`, `SNAPSHOT_PRICE_WAIT_MS = 120_000`, `SNAPSHOT_PRICE_FRESH_MS = 5 × 60_000` (prices refreshed this recently are not refreshed again).

1. **The switch:** effective = `config.autoRecord` when not null (the `AUTO_RECORD` env, `true|false|1|0|yes|no`; `source 'env'`), else the setting `history.autoRecord ?? false` (`source 'setting'`). Default off (D84). NODE_ENV=test: null (the setting decides; default off).
2. **`since`** (`app_meta` key `snapshot.autoRecordSince`, an IsoDate): written with today's local date whenever the effective switch goes from off to on (at start-up with `AUTO_RECORD=true` and no stored date, or through `settingsChanged`), deleted when it goes off. It is the floor of the catch-up (`recordingsDue.autoRecordSince`, §2.9), so switching auto-record on never back-fills the past.
3. **The job:** the scheduler job `snapshot` (`intervalMs: 0`: manual-only in the scheduler; the recorder's own timer decides when). Every automatic attempt runs through `scheduler.run('snapshot', trigger)` so it writes one `job_runs` row (`schedule` or `startup`); nothing is written when nothing is due. The job's `detail`: `{ due: IsoMonth[], recorded: IsoMonth[], skipped: { month, reason: 'already_recorded' | 'import_in_progress' | 'earlier_month_missing' | 'stopped' }[], pricesRefreshed: boolean, pricesAsOf }`; status `succeeded` (recorded or nothing left), `partial` (some months skipped, or blocked), `failed` (an error or a stop; an error is retried after `SNAPSHOT_RETRY_MS`, a stop at the next start).
4. **Time (one source):** the recorder's `now` is `deps.now ?? (() => clock.now())`, and every date and hour decision (today, `recordTimeReached`, `since`, `recorded_at`, `nextRunAt`, the `writeRecordedMonths` call) reads it; only the timers use `clock` (default `systemClock`). The routes, the finance context and `makeRecordRequestSchema(now)` use the same `now` that `buildApp` passes, so a manual record, the History live row and the month bound agree under an injected clock (a server test records under an injected `now` and compares the row with the live row).
   **Planning** (a pure helper `planNext(now: Date, state)` in `recorder.ts`, unit-tested with fixed dates): `today` = the local date of `now()`; `recordTimeReached` = local hour ≥ `SNAPSHOT_RECORD_HOUR` on the month's last day; `plan = engine.recordingsDue({ snapshots, today, recordTimeReached, autoRecordSince: effective ? since : null })`. The timer wakes at the earliest of: now (when `plan.due` is non-empty), the next month-end at `SNAPSHOT_RECORD_HOUR` local, now + `SNAPSHOT_WAKE_MAX_MS`; after a failure, now + `SNAPSHOT_RETRY_MS`. **`nextRunAt`** (the status) is the next month-end record time while the switch is on. **The record hour is 23:00 (D89)**, late enough to catch balance updates made on the evening of the last day; it is clear of the April and October DST changes (at 02:00–03:00). An attempt at 23:00 that fails is retried at 23:15, 23:30 and 23:45; the first wake-up after midnight sees the month as ended and records it `late` (D82), as the start-up catch-up would. **The months and the source are re-derived from `now` after the price wait** (with the import-lock re-check of item 6.3, before the synchronous write), so an attempt that crosses midnight records the ended month as `late` with the new day's run date; the period rule (§2.3) keeps it in its own month and year. **Blocked (D94, §2.9):** when `plan.blocked` is set, the first wake-up that sees it runs one `snapshot` job (`partial`, skipped `{ month, reason: 'earlier_month_missing' }`); later wake-ups do not repeat it while the last `snapshot` run already names that month as blocked. `status().blocked` carries it to the History and Net Worth callouts (§6.3 item 3, §6.4 item 2).
5. **Start-up catch-up (D82):** `start()` schedules the first check after `SNAPSHOT_STARTUP_DELAY_MS` with trigger `startup`; every missed month since `since` is recorded then, with today's run date and values, source `late`; later wake-ups catch up the same way (a record that failed at 23:00 and on every retry before midnight is caught up after midnight as `late`).
6. **A record attempt** (automatic or manual), inside the mutex (one at a time; a second caller waits up to `SNAPSHOT_LOCK_WAIT_MS`, then 409 `RECORD_IN_PROGRESS`). **The recorder never acquires the import lock** (it is process-wide, and every Stage 2–4 mutation answers 409 "An import is running" while it is held):
   1. `importLock.held` → automatic: skip (`import_in_progress`, retried after `SNAPSHOT_RETRY_MS`); manual: 409 `IMPORT_IN_PROGRESS`.
   2. **Fresh prices first** (the sheet records at click time with live GOOGLEFINANCE values): through `market.refresh({ trigger })` (the service's own path: it joins a run in flight and resets its run options); `MarketDataDisabledError` (market off) → no refresh; `market.status().lastRefreshAt` within `SNAPSHOT_PRICE_FRESH_MS` → no refresh (the start-up catch-up reuses the price job's first run; at 23:00 the hourly price job may be running or have just run, and the record joins that run or reuses it, so there is never a second refresh). For ASX holdings the 23:00 prices are the day's closing prices. The wait is bounded by `SNAPSHOT_PRICE_WAIT_MS` and races the recorder's own `AbortSignal` (item 8). A failed or timed-out refresh still records with the cached prices; `detail_json` notes `pricesRefreshed: false` and the prices' age (`pricesAsOf` = the market's last refresh time). Manual records refresh too (the web shows one pending text, "Refreshing prices and recording…", §6.4).
   3. **Synchronously from here:** re-check `importLock.held` (an upload may have started during the wait: automatic → skip as in step 1; manual → 409 `IMPORT_IN_PROGRESS`), for an automatic attempt re-derive the months and the source from `now` (item 4: a month that has ended by now is `late`), then `writeRecordedMonths` (§4.5) with the months, the source and the trigger; re-plan. Nothing awaits between the re-check and the write, and the upload route re-checks `hasAppData` after its own awaits, so an import and a record never interleave.
7. **Clock injection:** tests drive the timers with a fake `clock` (fake timers or a hand-rolled `Clock`) and pass the matching `now`, so a month end, a DST change, a server off across two month ends, a blocked month, and a failure followed by a retry are all simulated (§7.5).
8. **`stop()`** aborts the recorder's own `AbortController` (the price wait of step 6.2 races it), clears the timer and awaits the attempt, so a stop during a price wait resolves at once instead of holding `preClose` for up to `SNAPSHOT_PRICE_WAIT_MS` (the index's forced exit is 10 s). An aborted attempt writes nothing: a scheduled one ends `failed` (skipped `stopped`) and is caught up at the next start (D82); a manual one rejects with 503 (`INTERNAL_SERVER_ERROR`, "The server is stopping; nothing was recorded"). The `preClose` order stays recorder, then scheduler.
9. **Logging:** one info line per automatic attempt (months, source, trigger); never figures.
10. **D34 interplay:** a recorded month is app data (§3.4). With `hasAppData` false and the switch off, the History page's record form says so before the first record (§6.4); the owner's database stays re-importable until the first record (D84). `AUTO_RECORD` is not set in `.claude/launch.json`, the Playwright config or the Dockerfile (Stage 7 decides).

---

## 5. Chart data
| Chart (page) | Source | Per group | Live point | Mode |
|---|---|---|---|---|
| Historical net worth (Net Worth; D83) | `charts.groups`, stacked in `NET_WORTH_STACK_ORDER`: Stocks `B`, ETFs `F`, Crypto `J`, **Cash** `N + offsetCents − linked` (net cash, so accounts in debit stay inside it, plus the offsets not inside equity; on imported months simply `N`, so the series is continuous), Managed funds `AF`, Other assets `AJ`, Super `Q`, Property equity `Z` (net of the mortgage and linked offsets; may be negative); **Other debts** `U` (≤ 0, grey, drawn only when a displayed group has one: History `U` of an imported month); positives up and negatives down (ECharts `stackStrategy 'samesign'`). The stack adds up to net worth for every group; the tooltip and the table name the total **"Net worth"** (the `totalLabel` prop, §6.1). Caption: "Property equity is net of the mortgage and linked offsets; cash is net of accounts in debit." | end | yes | end |
| Savings and savings rate (Net Worth; D83) | `charts.savings` (Stage 3 `compressCashflow`): savings bars (adjusted; negative bars below zero) and the savings-rate line (income-weighted per group) on a **right-hand % axis** (§6.1: the one second-axis exception) | sum; rate Σ savings ÷ Σ income | yes | sum |
| Liquid assets (Net Worth; D83) | `groups[].netWorth.liquidCents` (excludes super and property) bars + `trends.liquid` dashed line; caption "Trend: +$X a month" from `slopePerMonthCents` | end | yes | end |
| Savings tracker (Net Worth; D83) | stacked Stocks, ETFs, Crypto, Cash, Managed funds (the first five of `NET_WORTH_STACK_ORDER`, **the same Cash definition** as the historical chart) + `trends.tracker` (fitted to the stack's total) dashed | end | yes | end |
| Distribution (Net Worth) | `distribution.slices` donut in `NET_WORTH_STACK_ORDER` (not by value), **every positive class its own slice, up to eight, no "Other classes" fold (D93; `DonutChart maxSegments={8}`, §6.1)**, each slice coloured by its class (`Datum.color`, §6.1); no target ring (targets exist for the liquid classes only, shown in the allocation table); the table view lists `distribution.values` (every class). Centre: **"Net worth"** with the figure when `excluded` is empty and `drawnCents = netWorthCents`; otherwise **"Assets shown"** with `drawnCents` and a foot note "Net worth $X after <excluded, other debts> (−$Y)" | — | live | — |
| Savings rate this FY (Net Worth; D83) | `savingsRate` gauge 0–100 % with the planned rate as the target tick; the true figure even when outside the range | — | — | — |
| What you own over time (History) | `charts.groups` stacked area in **the same `NET_WORTH_STACK_ORDER`, colours and Cash definition** as the historical net-worth chart (Other debts below zero) | end | yes | end |

- Unit and count: the query (`?unit=&count=`, the page's view switch, not saved) else `charts.dateUnit ?? 'monthly'` and `charts.unitCount ?? null` (12 / 8 / all); yearly groups follow `savings.yearBasis` (FY by default, `FY2025–26`; D52) and the period rule of §2.3. Every chart on a page uses the same unit and count, so the bars line up. **Titles and the first table column follow the unit:** "Net worth by month / by quarter / by year", first column "Period".
- The live group's label ends in " (live)", and the chart card says "The last bar is live: today's prices and balances." **only when a group is live** (`groups.some(g => g.live)`; none when the month was recorded today). There is no current-month zero.
- **Colour** (STYLE_GUIDE §6.1; colour follows the entity across the page's charts): each class has a fixed slot, `NET_WORTH_CLASS_SLOTS` (§3.2): Stocks 2, ETFs 5, Crypto 1, Cash 4, Managed funds 3, Other assets 8, Super 6, Property equity 7; **Other debts** "Other" grey (the ninth series, always below zero). The assignment is not slot order: slot order stacked in this order puts violet (2) next to fuchsia (4) whenever Crypto is empty, and fuchsia (4) next to purple (6) or orange (3) next to amber (5) in other one-empty cases (CVD ΔE 3.5–6.4). The chosen map was searched over every assignment with the palette validator's maths (`palette.test.ts`: OKLab ΔE under Machado 2009 protanopia/deuteranopia): in `NET_WORTH_STACK_ORDER`, every adjacent pair **and every pair that becomes adjacent when any one class is empty** has CVD ΔE ≥ 10.4 and normal-vision ΔE ≥ 16.8 (targets 8 and 15); grey next to Property equity 11.1. **The eight-slice donut (D93)** is a ring, so the check also wraps (re-run by the plan amender with the same maths, `artifacts/stage5/plan-amender/palette-d93*.mjs`): every adjacent pair, the wrap pair included (Property equity next to Stocks: 30.5), has CVD ΔE ≥ 10.4 and normal-vision ΔE ≥ 24.3; every pair that becomes adjacent when one class is empty meets the targets **except two**: with Stocks empty, ETFs meet Property equity (CVD 7.3, normal 24.9); with Property equity empty (or negative, so excluded), Super meets Stocks (normal 13.9, CVD 9.9). No arrangement does better: an exhaustive search over every cyclic order of the eight slots finds that each order whose adjacent pairs all pass has at least two failing one-empty cases, and the 48 maps that also keep the stacked charts' thresholds all fail in exactly these two cases, the kept map with the highest worst-case CVD of them. So the map is kept; the donut's 1° pad angle (the surface gap), the legend and the table view carry the two near misses. The legends list series in stack order. The savings tracker uses the same slots for its five classes. Single-series charts (liquid assets, savings bars) use slot 1; the savings-rate line slot 2. **Trend lines** are 2 px dashed "Other" grey, named "Trend" in the legend (a dashed legend key) and the table (a reference line, not a series). The web test re-runs the validator maths on the stack order and on every order with one class removed, and on the donut's ring (the wrap included) with the two documented exceptions held to floors of CVD 7 and normal 13.5 (§7.7), and the style reviewer confirms the STYLE_GUIDE §6.1 note is updated at stage close, including the D93 exception (the Distribution donut draws up to eight slices, with the two near-miss pairs above) (the coordinator owns the guide).
- Negative bars (a savings loss, other debts, negative equity or net cash) carry their sign and value in the tooltip and the table (U+2212 minus); the gain/loss colours are not used in these categorical charts (STYLE_GUIDE §6.1).
- A web test asserts each chart's series colours follow `NET_WORTH_CLASS_SLOTS`, that a class keeps its colour across the four Net Worth charts, the donut and the History chart, and that no two classes in the stack order (with any one class empty), nor in the donut's ring (with any one class empty, the two documented exceptions aside), are a pair below the thresholds above.

---

## 6. Web spec (`apps/web`)

### 6.1 Routes, files and shared rules
- Typed routes replace the placeholders: `/` → `NetWorthPage` (the Stage 0 sample page `pages/NetWorthPage.tsx` is removed), `/history` → `HistoryPage`, `/settings` → `SettingsPage`. `pages.ts` is unchanged. Files: `src/pages/netWorth/**`, `src/pages/history/**`, `src/pages/settings/**`; shared display helpers in `src/pages/history/display.ts` (the class and liability labels, column labels from `SNAPSHOT_COLUMN_LABELS`, month and run-date words). No folder named `data`.
- **Markers: one registry.** The History markers (Imported, Recorded, Recorded late, Corrected, Live, Projected) are added to the Stage 4 `MARKERS` / `Marker` / `FirstCell` (`pages/assets/display.ts`, `pages/assets/markers.tsx`; web-owned in Stage 5), not a second registry: `recorded` → `StatusBadge recorded` "Recorded"; `late`/`lookback` → `StatusBadge recorded` "Recorded late" (a finished record, not a pending one; the tooltip and Details say "automatically at start-up" or "by you"); imported → `Pill` "Imported"; corrected → `Pill` "Corrected"; the current period → `StatusBadge pending` with the Stage 3–4 word: **"Live (provisional)"** on its first mention on a page, "Live" after that; projected → `Pill` tone `na` "Projected" (a projection is not a status).
- **`packages/ui` chart additions** (additive, web-owned, with tests and a Scaffold note each; the Stage 4 `Meter` precedent):
  - `BarChart`: `overlays?: { name: string; values: (number | null)[]; axis?: 'value' | 'secondary'; dashed?: boolean; color?: string }[]` (line series drawn over the bars), `secondaryAxisFormatter?: ValueFormatter` (a right-hand axis, only when an overlay asks for it), negative stacking with `stackStrategy 'samesign'` when `stacked`, and `totalLabel?: string` (the stacked tooltip's and table's total row name; default "Total"; the dashboard passes "Net worth"). `ChartLegendItem.key` gains `'dashed-line'`, used for dashed overlays (the trend).
  - `Datum` gains an optional `color` and `DonutChart` honours it (default `seriesColor(i)` unchanged), so a slice keeps its class's colour whatever else is drawn (§5). `DonutChartProps` gains an optional **`maxSegments`** (default `DONUT_MAX_SEGMENTS`, 6, so every other donut still folds into "Other"; clamped to `CHART_PALETTE.length`, 8) read by `donutSlices` and the legend; the Distribution donut passes 8 (D93, overriding the six-slice rule for that chart only). A ui test: eight data with `maxSegments={8}` draw eight slices and no "Other"; the default still folds the seventh. `AreaChart` stacked (Stage 0) serves the History chart with explicit series colours; `GaugeChart` (Stage 0) is used as it is (the gauge's `target` tick).
  - **The savings-rate line is the one chart with a second axis** (an explicit exception, like Stage 4's rate formats: the two measures have different units; the axis is labelled "Savings rate" and the table view shows both columns).
- **Colour of figures** (D33; STYLE_GUIDE §8): the stop tint only for a **loss or a fall** (a negative gain, a negative change in net worth, a negative savings figure, negative equity) and a negative cash balance; liabilities are shown as positive "owed" figures in body text **and in forms** (§6.4 item 5). Web tests assert both treatments.
- **Teal:** one key figure per page: Net Worth "Net worth" (the hero tile), History "Latest recorded" net worth (the status card), Settings none. Table totals are white bold with no teal.
- **Rates:** the Stage 4 `formatRate` (up to 2 dp, trailing zeros dropped) for the marginal-rate suggestion and the tax bands only; every other percentage keeps one decimal.
- **Times:** 24-hour `formatDate` + `formatTime` ("31/03/2027 at 23:00"), as the rest of the app. A server time (`nextRunAt`, an ISO string with the server's offset) is shown in **that offset's wall time**, not the browser's time zone; when the offset differs from the browser's, the text adds "(server time)". Texts about the record hour are built from `recorder.recordHour`.
- **Hash targets** (`/settings#<group>`, `/history#record`): after the page's query resolves, the page scrolls to the target once and focuses its heading (`tabIndex -1`); the router alone cannot, because the target does not exist while loading. Tests for `/settings#pay` and `/history#record`.

### 6.2 API layer (`src/api/hooks.ts` additions)
- Query keys `['net-worth', unit, count]`, `['history']`, `['history-series', unit, count]`, `['settings']`; the Net Worth and History pages refetch every 60 s while visible (the recorder status moves). **The two keyed queries use `placeholderData: keepPreviousData`**: a view-switch change keeps the hero, tables and controls mounted, the charts get `loading={isPlaceholderData}` (they dim, STYLE_GUIDE §6.2), and the `LiveRegion` announces the new view ("Showing quarterly, last 8"). A web test asserts that switching the unit never renders the Loading line.
- One mutation hook per §4.2 mutation. **Record, correct and delete** invalidate `['net-worth']`, `['history']`, `['history-series']`, `['cash']`, `['super']`, `['property']`, `['other-assets']`, `['investments']`, `['budget']`, `['dividends']`, `['side-income']`, `['records']`, `['import']` and `['status']` (`invalidateAfterHistoryChange`: a recorded month closes every page's provisional period). A **settings save** (from the Settings page or a page's own form) invalidates every page key plus `['settings']` and `['status']` (settings feed every page). The Stage 2–4 invalidation helpers also cover `['net-worth']` and `['history']`.
- Value imports from `@joinr/schema` root only (enums, the request-schema factories, `SETTING_GROUPS`, `settingDef`, `isWorkbookSetting`, the §3.2 constants); DTO types with `import type`.

### 6.3 Net Worth page (desktop ≥ 1200 px; STYLE_GUIDE §3–§8, §7.2 hero)
1. **`PageHeader`** "Net worth" (sub-line "Overview"); actions **Record month** (secondary; a link to `/history#record`, shown while `recordable` is non-empty) and **History** (a link).
2. **Hero band** (`HeroBand height="compact"`, 140–200 px on desktop; below 1200 px it grows to fit its stacked tiles, D18; KPI figures on `--surface` cards, never on the glow): four tiles at span 3 (tablet span 3 of 6, phone one column). **Each tile has at most one line under its figure** (the band stays ≤ 200 px at 1440; an e2e check): the delta line when there is a change, else the hint. `StatTile` draws the arrow, so the text carries no literal ▲/▼.
   - **Net worth** — the key figure (teal), whole dollars; hint "Live · 14/03/2027" (or "Recorded today").
   - **Since <Feb 2027>** — `sinceLastRecord.cents` with sign; delta "2.4% up since 28/02/2027" / "0.8% down since 28/02/2027" (go/stop tint + arrow + word, STYLE_GUIDE §5); "—" with the hint "No recorded month yet".
   - **This FY** (or "This year" with the calendar basis) — `thisYear.cents`; delta "3.1% up since 29/06/2026"; "—" with the hint "No month recorded before 1 July".
   - **Liquid assets** — `live.netWorth.liquidCents`, hint "Excludes super and property".
3. **Callouts** (under the hero):
   - no snapshots → `Callout note` "No months recorded yet. Changes and history start after the first recorded month; record one on the History page."
   - the last day of `liveMonth` has passed with the month unrecorded and auto-record off: while `hasAppData` is false → **`Callout note`** "Feb 2027 is not recorded in the app. Recording adds app data and blocks re-importing the workbook: keep using the workbook until the cutover, or record it on the History page." (D84); once `hasAppData` is true → `Callout important` "Feb 2027 has not been recorded. Record it on the History page." (a link).
   - `recorder.blocked` set (auto-record on; D94, §2.9) → `Callout important` "Auto-record is waiting: Jan 2027 is not recorded. Record it, or record Feb 2027 alone (Jan 2027 then becomes a gap), on the History page."
   - prices unpriced or stale → `Callout important` "N holdings have no current price, so net worth may be understated." (the Stage 2 wording); market off → `Callout note` "Market data is off: values use the last known prices."
4. **`SectionBar` "Where it stands"** (primary):
   - `Card` (span 6, **tablet span 6**) **"Assets and liabilities"**: `ColumnTable` Item · Value · Gain · Gain % — the nine classes (`offsets` only when non-zero; `cash` Gain "—"), the Total assets row (white bold; value only), then Liabilities: "Mortgages" (net balance; a muted line "Gross $X less linked offsets $Y" when offsets exist, the per-loan lines from `property`), "Accounts in debit" and "Other debts (imported)" (each only when non-zero), the Total liabilities row, and **Net worth** (white bold). A foot note: "Property is at its full value; the mortgage is a liability. Offsets linked to a loan reduce it. Cash shows the accounts in credit; accounts in debit are a liability." (The charts net them, §5.) Liquid assets and "Assets excluding super" sit in a two-row `KeyValueTable` below.
   - `ChartCard` (span 6, tablet span 3) **"Distribution"**: the donut (§5; one slice per positive class, up to eight, no "Other classes", D93) with the legend in stack order and the table view (Class · Value · Share, every class from `distribution.values`; a zero class reads "—" for its share); `excluded` → `Callout note` "Property equity is negative (−$X) and is left out of the chart."; the centre label per §5.
   - `ChartCard` (span 6, tablet span 3) **"Savings rate FY2026–27"**: the gauge (the true figure below it, "Income-weighted over N recorded months"; the target tick "Budget plan 20%" when set; "—" with "No recorded month this FY yet"), and a `KeyValueTable`: Average savings a month · a year (`averageSavings`, "over the last N months", §11 fix 7).
   - `Card` (span 6, **tablet span 6**) **"Liquid allocation"**: `ColumnTable` Class · Current · Target · Difference (the `allocation.rows`; a negative difference reads "Under by N%", positive "Over by N%", status not colour-only), total row with `targetSumRatio` ("Targets add up to 102%: edit them in Settings" when not 100 %); a line "Consider next: ETFs (most under target)" or "Cash first: below the emergency fund" (the Stage 2 words); link "Targets in Settings" → `/settings#allocation`.
5. **`SectionBar` "Over time"** (supporting): a `Segmented` Monthly | Quarterly | Yearly (the view switch; default from the settings; a muted "Default set in Settings" link) and a count `Select` (6, 12, 24, All) applied to every chart below; the controls stay mounted while a new view loads (§6.2); `ChartCard`s (Chart | Table), titles from the unit (§5):
   - **"Net worth by month"** (span 12, the stacked bars; the table lists every series and the "Net worth" total per group);
   - **"Savings and savings rate"** (span 12; bars + the rate line on the right axis; table: Period · Savings · Income · Rate);
   - **"Liquid assets"** (span 6, tablet span 6; bars + trend; caption "Trend: +$X a month") and **"Savings tracker"** (span 6, tablet span 6; stacked + trend; caption as well).
6. **`SectionBar` "Rolling net worth"** (supporting): `ColumnTable` Month · Liquid assets · Super · Property · Liabilities · Offsets (only when any row has offsets) · Net worth · Change · Liquid change · Savings rate · Note — **newest first** by default: the projected rows in a closed `<details>` above the table ("Projection: 12 more months at $X a month (your average savings)", muted figures, only Month and Projected liquid assets, the rest "—", marker "Projected"), then the live row (marker "Live (provisional)"), then the recorded months (recorded-late rows "Recorded late"; migrated rows no badge). A toggle "Oldest first (as the sheet)" reverses it, remembered per browser with the Stage 2 storage helper. Notes are the Cash spend notes (Stage 3).
7. **States:** `Loading` "Loading net worth…" (first load only); `LoadError` with Retry; no data at all (no import, no accounts) → the brand `BrandScreen` empty variant "Import the workbook or add accounts to see your net worth" with links; null figures "—" with the reason; `recordedToday` → the hero hint "Recorded today" and no live group.

### 6.4 History page
1. **`PageHeader`** "History" (sub-line "Overview"); primary action **Record month**. **A lead paragraph** under it: "Recording a month freezes its figures. Later edits to trades, balances or prices don't change a recorded month; to change one, use Correct (you type the figures, and every change is logged below). The live row is today's provisional position."
2. **Status card** (span 12, `Card`): Latest recorded (the teal figure: its net worth, "Feb 2027 · recorded 28/02/2027"); **Auto-record**: "On · next 31/03/2027 at 23:00" (§6.1 times) / "Off" with a link "Change in Settings" (`/settings#history`) / "On (set by the server)" when env-locked; Last automatic run (the job's status and time, "Recorded Jan 2027 late at start-up" / "Nothing due" / "Failed: <error>" / "Waiting: Jan 2027 is not recorded" when blocked); Missing months ("Jan 2027 and Feb 2027 are not recorded" with **Record them now**, which opens the record form with those months ticked and focuses it; it never records directly); Gaps ("Oct 2026 was never recorded; months before the latest recorded month cannot be filled").
3. **Record form** (inline `Card`, id `record`, opened by the action or `/history#record`); one line repeats the lead: "Recording freezes these figures; later edits won't change them."
   - **Months:** a `fieldset` with the legend "Months to record" and a checkbox per recordable month (month words), ticked by default per `defaultMonths` (every recordable month that has ended; otherwise the current month); an unticked earlier month shows "Leaving Jan 2027 out makes it a permanent gap". **Whenever a ticked month has ended**: "Jan 2027 will be recorded with today's (14/03/2027) values and date, not its month-end figures." Two or more ticked add: "The months are recorded together; the later ones will show no change (recorded late)." The current month before its last day → "Recording before the month ends closes Mar 2027 now; the rest of the month counts toward Apr 2027."
   - **Preview** (`KeyValueTable`): the live net worth, liquid assets, cash, super, property equity and the prices' age ("Prices from 14:32 today; they are refreshed before recording, so the recorded figures can differ slightly").
   - **Note** (optional, 200). The **new-app-data note** while `hasAppData` is false (D34/D84): "Recording a month adds app data: re-importing the workbook will then be blocked." (the Stage 3–4 wording); when `hasAppData` is true, nothing.
   - **Record** (primary; one pending text "Refreshing prices and recording…"); success → `LiveRegion` "Recorded Mar 2027" and the form closes; 409s and the import lock → `Callout do-not` with the message.
4. **Live row** (a `Card` above the table while `live` exists): "Mar 2027 — Live (provisional)" with net worth, liquid, and "Not recorded yet: auto-record on 31/03/2027 at 23:00" or "Record it with Record month".
5. **`SectionBar` "Recorded months"** (primary): `ColumnTable` Month · Recorded · Source · Net worth · Liquid assets · Cash · Super · Property equity · Savings rate · Actions — newest first; **Source** markers from the one registry (§6.1); a corrected row adds "Corrected" with the revision count; `sharedRunDate` adds a muted "Recorded together with Feb 2027". Actions: **Details**, **Correct**, and **Delete** on the deletable row only (the latest month recorded in the app; imported months never, D92; inline confirm: "Delete Feb 2027? It becomes recordable again; the audit trail keeps a copy.").
   - **Details** and **Correct** open as a `Card` **directly after the table** (the Stage 4 editor pattern; `ColumnTable` has no row expansion): focus moves to the card's heading, `LiveRegion` announces it, and closing returns focus to the row's button.
   - **Details:** `KeyValueTable`s grouped as the History headers — Investments (per class value, gain, gain %, movements), Cash (value, change, change %, accounts in debit, offset accounts, linked offsets), Super (value, contributions, gain, gain %, measured to), Property (value, purchase, equity, gain, gain %, mortgage owed, interest and fees, principal paid), Other assets (value, gain), Pay (monthly salary), Untracked loans (U, V, "not rebuilt"). Owed figures (mortgage, accounts in debit, U) show as **positive "owed" amounts** without the stop tint. A null shows "—" with "Not recorded (imported month)" for the extras. The row's check: "Every stored figure reproduces" or the differences table (Column · Stored · Recomputed · Why). The month's audit entries.
   - **Correct form:** one `MoneyField` per `CORRECTABLE_SNAPSHOT_COLUMNS` column in the same groups, prefilled; **"Mortgage owed" and "Accounts in debit (owed)" are entered as positive amounts** and negated before sending (validation messages use the positive wording); a changed field shows its old value muted ("was $X"); on a **migrated** row the three offset extras are read-only "Not recorded (imported month)" (the server refuses them, §4.3); the derived columns listed read-only "Recalculated when you save: gain %, cash change, equity (and next month's cash change)"; the line "This replaces the stored figures; it does not recalculate from your current data."; **Reason** (required); a migrated row shows the workbook callout ("This came from the workbook. Saving a correction counts as an app edit: re-importing the workbook will then be blocked."), a recorded row the note "Corrections are kept in the audit trail". Save sends only the changed columns; success → `LiveRegion` "Correction saved". Web tests: the owed sign round trip and the read-only extras.
6. **`SectionBar` "What you own over time"** (supporting): the stacked area `ChartCard` (§5) with the view switch as §6.3 item 5.
7. **`SectionBar` "Consistency check"** (reference): the headline counts derived figures only: "Every stored figure reproduces (12 of 12 imported months)" from `consistency.derivedMatchedMonths` / `migratedMonths` (the PLAN acceptance); **movement differences are information, never counted as failures**: "2 months' movements differ from today's trades: a trade dated in that month was edited or corrected after it was recorded. Nothing to do; the recorded figure stands." with the list (`movementMonths`); a `Callout important` only for a derived difference, which is never expected: "A stored figure of Nov 2026 does not match its recomputation. Please report it." (no action: a correction of any figure re-derives the row anyway).
8. **`SectionBar` "Audit trail"** (reference): `ColumnTable` When · Month · Action · By (You / Scheduled / At start-up) · Changes (a compact "Cash $X → $Y" list, "+N more" expanding) · Note; newest first, 200 rows.

### 6.5 Settings page
1. **`PageHeader`** "Settings" (sub-line "App"); an in-page index of the groups (a `Stack` of anchor links; on phone a collapsed `<details>` "Jump to" holding the same links, never a navigating select).
2. **One `SectionBar` per group** (reference, violet; id = the group id for `/settings#<id>`, focused after load per §6.1), each with a `Card` form: a field per key by type (`MoneyField`, a percent field for ratios through `ratioFromPercentText`, `NumberField` for integers, `Switch` for booleans, `Select` for enums with the registry values in words, `DateField` for dates), labelled with the registry label (the same words the pages use, §3.2); each field's hint shows its default ("Default: FY") and, for workbook keys, "From the workbook" or "Changed in the app"; a group **Save** (disabled while pristine or pending) sends only the changed keys; errors mapped by path. **Callouts** follow Stage 4 §6.7's one-or-the-other rule: a form that changes a workbook key shows the workbook callout ("Saving counts as an app edit: re-importing the workbook will then be blocked."); app-only keys (`savings.yearBasis`, the `super.*` and `otherAssets.*` Stage 4 keys, `history.autoRecord`) and the preference keys (`charts.*`, `features.*`; D95, §3.3) carry the import-safe note "Kept when you re-import".
3. **Pay and tax:** the **tax suggestion** card under the marginal-rate field (D85; the bracket plus the levy is the "suggested" figure and the first button, the bracket alone the second, D90), worded by the Medicare band:
   - `full`: "For a gross salary of $X in FY2026–27: the 37% bracket plus the 2% Medicare levy = **39%**"; buttons **Use 39%** and **Use 37% (without the levy)**.
   - `shade_in`: "the 16% bracket plus the Medicare levy shade-in (10c per dollar between $X and $Y) = **26%**; the full 2% applies above $Y"; the same two buttons.
   - `none`: "the 16% bracket; no Medicare levy below $X" and one button **Use 16%**.
   - With `litoPhaseOut`: "The low income tax offset is not included: between $37,500 and $66,667 it adds up to 5 points to your true marginal rate."
   The bands table (Band · Rate, `formatRate`) collapsed, "ATO rates checked 26/09/2026", the Medicare note when the threshold is the previous year's; a button fills the field (the form still needs Save; nothing is written without it); when the current rate already equals one, the button reads "In use". Hidden without a gross salary ("Set your gross salary to see a suggestion"). The suggestion never changes the stored rate on its own (D85). A fixture and a web test per band.
4. **Allocation targets:** the sum line "Targets add up to 100%" (go) or "Targets add up to 102%: they should total 100%" (check tint, the sheet's `I17`), live as the fields change.
5. **History and charts:** the **auto-record switch** ("Record each month automatically on its last day at 23:00, server time", built from `recorder.recordHour`; D89) with the D84 note while `hasAppData` is false: "Recorded months are app data: once a month is recorded, re-importing the workbook is blocked. Leave this off until you stop using the workbook (Stage 7)."; env-locked → disabled with "Set by the server (AUTO_RECORD)". The chart unit and count (preference keys: "Kept when you re-import"; D95, §3.3).
6. **Pages:** a `Switch` per feature ("Show the Crypto page"), with the note "Hidden pages still count in your net worth." (preference keys, as item 5).
7. **FIRE (used from Stage 6):** the six keys editable, with the group note.
8. **Kept from the workbook (D91):** the six unused keys as an ordinary **editable** group (house price target, house deposit target, house savings target per year, the investment parcel frequency and amount, the retirement-contributions switch), last in the page, with the group note "The app does not use these; they are kept so the workbook's settings stay complete." and the usual workbook callout on the form ("Saving counts as an app edit: re-importing the workbook will then be blocked.", D34). Each field's used-on line reads "Not used by the app" instead of page links.
9. **Links back (D86):** each field lists the pages that use it ("Used on Budget, Cash") as links (`usedOn`).
10. **The pages' in-context forms** (Stage 3–4 `SettingsSection`, `pages/cashflow/SettingsSection.tsx`) derive their Settings links **from `SETTING_GROUPS` for the keys they show** (no single `groupId`): e.g. Budget "In Settings: Pay and tax · Budget", Cash "In Settings: Cash and savings", Super "In Settings: Pay and tax · Super", Property "In Settings: Cash and savings", Other Assets "In Settings: Other assets". The investment pages' next-buy "missing settings" footer links the group of each missing key. On the **Super page**, next to `tax.marginalRate`, a short line from `['settings']`'s `taxSuggestion`: "Suggested 39% for your salary (see Settings: Pay and tax)" (example; hidden without a suggestion). Both edit the same values (D86); a save on either invalidates both.
11. **One label per key:** the pages' own label maps (`BUDGET_SETTING_LABELS`, `CASH_SETTING_LABELS`, …) are removed in favour of the registry labels (§3.2); page-specific hints stay. A web test asserts every editable key renders the same label on its page and on the Settings page.

### 6.6 Navigation, header and footer
- **Features (§3.3):** `layout/nav.ts` hides the pages whose feature is off (from `AppStatus.features`; missing → shown); Dividends hides when ETFs, Stocks and Managed Funds are all off. A hidden page opened by a link shows `Callout note` "This page is switched off in Settings (Pages)" with a link.
- **Header freshness** (Stage 1): "Snapshot Feb 2027" also says "· auto" when auto-record is on (`AppStatus.history`).

### 6.7 Text updates on the Stage 3–4 pages (web)
Every user-facing "Stage 5" text becomes a present-tense line with a link; the six known places:
- `pages/cash/SavingsSection.tsx` (two texts: "…recording arrives in Stage 5." and "Recording a month arrives in Stage 5; …") → "Savings start after the first recorded month. Import the workbook for past months, or record a month on the History page." and "The current period stays provisional until the month is recorded (History)."
- `pages/cash/GoalsSection.tsx` (the text split across JSX lines: "…recording a month arrives in Stage 5.") → "Projected from the last recorded month (<month>)."
- `pages/assets/display.ts` (two texts: "…(Stage 5 records months)." and "…until a month is recorded (Stage 5).") → "History starts after the first recorded month." and "The current period stays provisional until the month is recorded (History)."
- `pages/investments/display.ts` and `pages/investments/NextBuyCard.tsx` (the next-buy footer "…on the Settings page in Stage 5.") → "Set them in Settings (Pay and tax, Budget, Allocation targets)", with one link per missing key's group (§6.5 item 10).
The Cash page's `STAGE4_NOTE` leftovers and any `staticUntilStage4` reader are gone. A web test renders every page with its fixtures and asserts that no page shows the text "Stage 5" (Stage 6 and 7 mentions stay allowed).

### 6.8 Phone (375 px; STYLE_GUIDE §3, D31) and the 768–1199 px range
- One column; hero tiles stack; forms one field per row; buttons full width; **no page-level horizontal scroll**; tables scroll inside their containers with the first column sticky.
- **Status-first column orders** (every desktop column appears; the row markers render under the first cell on phone, as Stage 4 UX-4):
  - assets and liabilities: Item, Value, Gain, Gain %
  - liquid allocation: Class, Difference, Current, Target
  - rolling net worth (newest first): Month, Net worth, Change, Liquid assets, Savings rate, Super, Property, Liabilities, Offsets, Liquid change, Note
  - recorded months: Month, Net worth, Source, Actions, Recorded, Liquid assets, Cash, Super, Property equity, Savings rate
  - audit trail: When, Month, Action, Changes, By, Note
  - consistency differences: Month, Column, Stored, Recomputed, Why
- **768–1199 px** (the Browser pane's width): the wide tables (rolling net worth, recorded months, audit trail) use the Stage 4 compact grid (`pages/assets/layout.ts`'s rule reused): the first column keeps at least 200 px and no word breaks mid-word. The assets-and-liabilities and liquid-allocation cards and the Liquid assets and Savings tracker charts take the full tablet width (`spanTablet={6}`); the donut and the gauge stay at 3 of 6. The Integrator's e2e checks this at 800, 1024 and 1199 px on every Stage 5 table whose first column holds a name or month, including **no inner scroll on the assets-and-liabilities table at 1024 px**.
- **1440 px:** the assets-and-liabilities, allocation, consistency and settings tables fit the 1152 px content area without inner scroll; the rolling net worth (11 columns) and recorded months (10) may scroll with the first column sticky. The e2e asserts which, and that the hero band is ≤ 200 px tall.

### 6.9 States
- **Loading / error:** `Loading` "Loading net worth…" / "Loading history…" / "Loading settings…", `LoadError` with Retry.
- **Empty:** no snapshots (§6.3 item 3; History: "No months recorded yet. Import the workbook for past months, or record this month."); nothing recordable → the Record action disabled with "Mar 2027 is already recorded; the next month to record is Apr 2027".
- **Null figures:** "—" with the reason (not recorded (imported month), no recorded month this year, no gross salary, no average yet).
- **Stale:** prices stale or unpriced (§6.3 item 3); the record preview shows the prices' age.
- **Recorded late / imported / corrected / live / projected** markers (§6.4, §6.3).
- **Record in progress** (`recorder.running`): the Record action shows "Recording…" disabled; the status card says "Recording now".
- **After a mutation:** a `LiveRegion` announces "Recorded Mar 2027", "Recorded Feb 2027 and Mar 2027", "Correction saved", "Mar 2027 deleted", "Settings saved".

---

## 7. Roles, tasks and FILE OWNERSHIP

### 7.0 Rules (all agents; Stages 3–4 §7.0 carried over)
- **Ownership:** edit only files you own (§7.1). Need a change elsewhere? Report it; the coordinator routes it. Never work around a contract gap in another owner's file.
- **Frozen contracts:** §2.2, §3.1–3.4, §4 (endpoints, schemas, DTO fields, codes), §4.5's `writeRecordedMonths` and §4.6's `SnapshotRecorder`. Internal modules are free; changing frozen names, fields or signatures needs the coordinator's approval and a Scaffold note.
- **No installs** after the Scaffolder; a missing package → stop and report.
- **Stubs** the Scaffolder creates become the named owner's files; replace them in place.
- **Scoped runs** while others work (§1.4); keep your files compiling at every step.
- **Privacy:**
  - Never paste owner values (from the workbook, an owner import's API, `docs/private/`) into a tracked file, test, fixture, comment or doc. Run `pnpm guard:all` before you finish.
  - A guard hit on a value you believe is generic means **change your value**. Never edit `docs/private/guard-terms.txt`; report the hit.
  - **No snapshot files**; assert explicit fields.
  - Anything printed from an owner import (net worth figures, class values, notes, audit bodies, API bodies) stays in git-ignored `artifacts/` or `docs/private/`; reports give counts and template cell refs only.
  - **Golden tests** hold template cell addresses and rules only (§9).
- **Never on `data/`:** no agent records a month, corrects a snapshot or switches auto-record on against the owner's `data/` database (D84). Every server an agent starts uses its own `DATA_DIR` (§8) and **never sets `AUTO_RECORD`** except inside recorder tests with a temp database.
- **Coordinator pre-step** (before the Scaffolder): stop any running dev server (a `tsx watch` server on `data/` would hot-reload onto in-progress code and could apply the draft migration); back up `data/finance.db*` to a git-ignored `data/backups/pre-stage5-<date>/`; append the terms of `docs/private/stage-5-private.md` §8, §8.1 and §8.2 to `docs/private/guard-terms.txt`; re-run `pnpm guard:all` (it must stay clean). The owner's answers to the plan-review questions (D89–D95) are applied in this plan (the Plan review log's "Owner answers").

### 7.1 Ownership table (every new or changed Stage 5 file has exactly one owner)
| Owner | Files |
|---|---|
| **scaffolder** | **Schema:** `packages/schema/**` (enums, tables, `db/index.ts`, rows + parity, records (+ records fixtures), settings (the key, `SETTING_GROUPS`, `EDITABLE_SETTING_KEYS`, category, the registry labels, `SETTING_WRITE_BOUNDS`, `PREFERENCE_SETTING_KEYS`), `src/history.ts`, `src/tax.ts`, `dto/history.ts`, `dto/settings.ts`, `dto/fields.ts` (the shared `optionalText`/`signedCents`, with `dto/assets.ts` importing them), errors, the `dto/status.ts` additive fields, the `dto/cashflow.ts` removal and max-keys change, fixtures (`history.ts`, the `cashflow.ts` update, coverage, `sampleDtos.ts`), `testing/{seed,dump}.ts` (`seedRecordedMonth`), index exports, schema tests). **Engine contract:** `packages/engine/src/types.ts`; `packages/engine/src/index.ts` (stubs + the `engine` value + `HISTORY_ENGINE_IMPLEMENTED`; → engine). **Migration:** `apps/server/migrations/**` (`0005_*` + meta). **Tests the migration or schema change breaks:** `apps/server/test/{migrations,app,db,backup,records-routes}.test.ts` (→ server-api after scaffolding), `packages/schema/test/**`. **Importer flag:** `packages/importer/src/testing/index.ts` (only `IMPORTER_STAGE5_IMPLEMENTED = false`; → importer). **Server stubs:** `apps/server/src/routes/{history,netWorth}.ts` (501; → server-api), the `GET /settings` stub in `apps/server/src/routes/settings.ts` (→ server-api), `apps/server/src/history/record.ts` (the frozen `writeRecordedMonths` throwing 501; → server-api), `apps/server/src/history/recorder.ts` (the frozen `SnapshotRecorder` with a no-op `start`/`stop`, `record` → 501, `withLock` running `fn`, `status` off; → recorder), `apps/server/src/app.ts` (registrations, `app.recorder` decoration with `now` and the new optional `BuildAppOptions.recorderClock`, the `preClose` order; → server-api), `apps/server/src/index.ts` (the `app.recorder.start()` call; → recorder), `apps/server/src/config.ts` (`AUTO_RECORD` → `config.autoRecord: boolean \| null`, with its test; → recorder), `apps/server/src/records/index.ts` (the minimum for the new columns and entity; → server-api). **Compile and expectation fixes the contract forces** (minimal edits only, each listed in the Scaffold notes; → the file's owner afterwards): `apps/server/test/investments/helpers.ts` (neutral fakes for the 12 new `EngineApi` members), `packages/engine/test/api.test.ts` (the member list), every `staticUntilStage4` writer or reader (`apps/server/src/cashflow/cash.ts`, server tests, `apps/web/src/pages/cash/**` and its tests; → server-api / web), `apps/server/test/migrations.test.ts` (the upgrade tests' expected dumps gain the 0005 columns; → server-api), `apps/server/test/investments/builders.test.ts` (its raw `UPDATE snapshots SET period_month, run_date` hits the identity trigger: rewrite as `DELETE` + `INSERT` of the row with the wanted month and date; → server-api), `apps/server/test/assets/settings-notes.test.ts` (the editable-key count only; server-api then rewrites the page-coverage assertions: page keys ⊆ editable, and the named-keys slice rule of §4.5), `packages/importer/test/{stage3-upgrade.ts,migration-equivalence.test.ts,golden.test.ts}` (`stage3Shape` strips the six new `snapshots` columns, §3.5 item 4; → importer), the Stage 3–4 tests that assert a registry label (→ their owners), and any other file the typecheck or `pnpm test` names for the same reason. **Web stubs:** `apps/web/src/router.tsx` typed routes, `apps/web/src/pages/{netWorth,history,settings}/*Page.tsx` (→ web). **e2e:** `e2e/ui-core.spec.ts` (only the short-page test's route list: `/history` leaves it, becoming `['/fire']`; → Integrator). |
| **engine** | `packages/engine/**` except `src/types.ts`: `src/index.ts` after scaffolding, every module (new: `snapshot.ts`, `netWorth.ts`, `aggregate.ts`, `trend.ts`, `recording.ts`, `tax.ts`; changed: `super.ts` (§2.11), `periods.ts` (§2.9 / §11 fix 9; `groupOf` yearly by the period month, §11 fix 20), `kpis.ts` (the savings year by the period month, §11 fix 20)), `test/**` incl. `test/golden/**` (new `history.networth.*`; the Stage 2–4 goldens unchanged) and `test/purity.test.ts`. |
| **server-api** | **Source (after scaffolding):** `apps/server/src/history/**` except `recorder.ts` (inputs, pages, `record.ts`, corrections, deletes, responses, constants), `apps/server/src/settings/**`, `src/routes/{history,netWorth,settings,status}.ts`, `src/app.ts`, `src/cashflow/{context,inputs,cash,responses,constants}.ts` (the D88 savings inputs, the settings slices), `src/cashflow/mutations/settings.ts` (`patchSettings`: the extended keys, the `AUTO_RECORD` lock on `history.autoRecord`), `src/assets/{inputs,super}.ts` (the measured-through input), `src/investments/charts.ts` (the FY yearly unit), `src/db/queries/domain.ts`, `src/records/index.ts`. **Post-scaffold owner of `packages/schema/**`** (DTO, fixture or seed fixes another agent reports; each needs the coordinator's OK and a Scaffold note). **Tests:** `apps/server/test/history/**`, `test/settings/**`, `test/golden/history.golden.test.ts`, the gate lines of the Stage 2–4 real-engine suites (§7.4 step 8), `test/cashflow/**`, `test/assets/**` and `test/investments/**` where the D88 inputs change an assertion, `test/{migrations,app,db,backup,records-routes,status-routes}.test.ts` (after the Scaffolder; `status-routes` for the additive `features` and `history` fields), `test/investments/builders.test.ts` and `test/assets/settings-notes.test.ts` after the Scaffolder's fixes. **Docs:** `README.md` (the Stage 5 APIs, `AUTO_RECORD`, the D34 rule for recorded months), `docs/ARCHITECTURE.md` (the recorder, the snapshot model, the aggregation API). |
| **recorder** | `apps/server/src/history/recorder.ts` (after scaffolding), `apps/server/src/index.ts` (the `start()` call only), `apps/server/src/config.ts` (the `AUTO_RECORD` variable only). **Tests:** `apps/server/test/recorder/**` (fake clock; temp databases; a fake `writeRecordedMonths` through a module seam for the timing tests, the real one for the end-to-end tests once server-api lands), `apps/server/test/config.test.ts` (the new variable only). Works against the frozen interfaces; never edits routes or the page builders (report a gap instead). |
| **importer** | `packages/importer/**` except the Scaffolder's flag line: `src/{writer,reconcile,process}.ts` (D87, the preference keys and their report lines), `src/testing/**` (the synthetic workbook only through `mutate` in tests; the flag after scaffolding), `test/**`. |
| **web** (phase A) | `apps/web/src/**` (router after scaffolding, `api/**`, `pages/{netWorth,history,settings}/**`, `pages/cashflow/SettingsSection.tsx` (the derived group links, the registry labels), `pages/assets/{display.ts,markers.tsx}` (the one marker registry, §6.1), the pages' label maps removed (§6.5 item 11), `layout/{nav,RootLayout,freshness}.ts(x)` (features, the auto marker), the §6.7 text edits in `pages/{cash,budget,sideIncome,otherAssets,super,property,investments}/**` and their tests, `app.css`; removing `pages/NetWorthPage.tsx`), `apps/web/test/**`, additive `packages/ui` chart props with tests (each in a Scaffold note: the `BarChart` overlays, `totalLabel`, the `dashed-line` legend key, `Datum.color` and `maxSegments` in `DonutChart`), drafts of `e2e/{networth,history,settings,history-states,history-mutations}.spec.ts` and `e2e/history-support.ts`. |
| **integrator** (phase B) | Takes over web's files and the e2e drafts, plus `e2e/{ui-core.spec.ts,records.spec.ts,import.setup.ts,support.ts,brand.spec.ts}` (`brand.spec.ts`: the Stage 0 sample-hero test moves onto the real dashboard, keeping the 140–200 px and node-line checks) and `playwright.config.ts` (the `history-mutations` project). After engine, server-api, recorder and importer report done, their files pass to the Integrator for integration fixes only (each listed in its report). |
| coordinator | `PLAN.md` · `docs/HANDOFF.md` · `docs/DECISIONS.md` · `docs/STAGE_PROCESS.md` · `docs/stages/**` (implementers append only to "Scaffold notes") · `CLAUDE.md` · `docs/style/**` · `docs/private/**` · `reference/**` · `.claude/launch.json` |

### 7.2 Scaffolder (alone; done-check before hand-over)
1. **Schema** per §3.2–3.3 and §3.6: enums, tables, `db/index.ts`, rows + parity, records (+ fixtures), settings (the key, the category, `SETTING_GROUPS` with the partition test, `EDITABLE_SETTING_KEYS` = 60 keys with the Stage 3–4 order kept (the six `unused` keys included, D91), `SETTINGS_PATCH_MAX_KEYS` = 64), `src/history.ts` (with `monthEndOf` tests), `src/tax.ts` (shape tests: bands ascending, the 2026 and 2027 second-band rates, the thresholds), `dto/history.ts`, `dto/settings.ts`, errors, `dto/status.ts`, the `staticUntilStage4` removal everywhere, fixtures, seed (`seedRecordedMonth`) and dump. **Tests:** every request schema (bounds, strictness, `''` → null, unique months, the month bound with an injected `now`, the correctable columns and their sign bounds, the required reason, the query coercion), fixture coverage, every fixture parsing where a schema exists and adding up (assets − liabilities = net worth; Σ drawn slices = 1 within 1e-9; rolling growth = Δ net worth; a group's figures equal its last row's for `end` columns), the settings-key tests (60 editable = every key but `super.concessionalCapFy`, 61 keys, groups partition every key with `super.concessionalCapFy` in `super`; every key has a distinct non-empty label; the `SETTING_WRITE_BOUNDS` cases; the six `unused` keys accepted by `settingsPatchSchema` at their registry bounds and refused one step past them (D91); every editable key in one PATCH (60 ≤ 64); `PREFERENCE_SETTING_KEYS` = the 2 `charts.*` + 11 `features.*` keys), `src/tax.ts` (the LITO constants), `src/history.ts` (`NET_WORTH_STACK_ORDER` holds the eight drawable classes; `NET_WORTH_CLASS_SLOTS` is a bijection onto slots 1–8; `NET_WORTH_CLASSES` has no folded class, D93; `SNAPSHOT_RECORD_HOUR` = 23, D89).
2. **Migration** `0005_stage5_history` (§3.1): generate, check for no recreate, append the trigger, `git diff --exit-code` on `0000`–`0004`. Tests: a fresh DB reaches 6 with every column and the audit table; **a 0004 database with data** (a migrated in-memory DB stopped at 0004 with its own raw snapshots, then upgraded) keeps every snapshot value, has null extras and `revision 0`, and `hasAppData` is unchanged; the trigger aborts an update of `run_date`, `period_month`, `source` and `recorded_at` and allows a figure update; the Stage 0–3 upgrade tests' expected dumps gain the new columns.
3. **Engine skeleton:** `types.ts` complete (§2.2, incl. the additive Stage 3–4 changes); `index.ts` stubs, `engine` value, `HISTORY_ENGINE_IMPLEMENTED = false`; the type-level test that `engine` satisfies `EngineApi` and that `SnapshotFigures` and the schema's `SnapshotFiguresShape` are mutually assignable. The compile and expectation fixes of §7.1.
4. **Server stubs:** `routes/{history,netWorth}.ts` answer 501 `NOT_IMPLEMENTED` for every §4.2 route (`no-store`), registered in `app.ts` with the cash-flow options object; `GET /settings` 501; `history/record.ts` and `history/recorder.ts` with their frozen signatures; `app.recorder` decorated (built in `buildApp` from the services, the engine, `now` and `recorderClock ?? systemClock`, §4.6); `preClose` awaits `app.recorder.stop()` then `scheduler.stop()`; `config.ts` parses `AUTO_RECORD` (with tests); `records/index.ts` loads the new columns and entity.
5. **Web stubs:** the three typed routes; each page renders `PageHeader` with its h1 and a `Callout note` "Arrives with the web work"; `e2e/ui-core.spec.ts`'s short-page list becomes `['/fire']`.
6. **Importer flag** line.
7. **Done-check** (all green): `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` (≥ the 3207 Stage 4 tests + new), `pnpm build`, `pnpm guard:all`; `PORT=3270 WEB_PORT=5270 DATA_DIR=artifacts/stage5/scaffolder/data pnpm e2e e2e/smoke.spec.ts e2e/ui-core.spec.ts` passes (delete the folder first); `/api/health` → `migrations: 6`; `DATA_DIR=artifacts/stage5/scaffolder/data pnpm seed:dev --yes` exits 0; ports free afterwards. Append "Scaffold notes" with every deviation.

### 7.3 engine
1. `snapshot.ts` (§2.4, §2.5): the composer's mapping for every column (a hand-built input with every Stage 2–4 result; the four movement windows with and without a previous snapshot; `O` and `P` with and without a previous cash; `U`, `V` 0; the extras incl. an account in debit and an offset account); `deriveSnapshotColumns` (the sheet ratio's zero-denominator and null cases, `Z` with linked offsets, `O` without a previous row); `checkSnapshots` (every match rule at its boundary: a ratio off by more than `(1 + |r|)` cents, `O`/`Z` 1 vs 2 cents, a movement changed by a later trade, a null against a figure).
2. `netWorth.ts` (§2.6): `netWorthOf` (nulls counted 0 and named; offsets); the dashboard's classes and liabilities with linked, unlinked and excess offsets, accounts in debit, two mortgages, an offset linked to a loan without a property (counted in full as `offsets`), a non-zero `U` (`other_debts`), every figure from `live` (a `property` result that disagrees with the figures changes nothing but the display lines); **assets − liabilities = net worth** on every case (a test invariant); the changes (no snapshots, one snapshot, a month recorded today: the base is the one before, the year base before and after 1 July, **a June snapshot recorded on 1 July stays the FY base of the new year**, a calendar basis, a zero base); the distribution (`values` before the drop with Σ = net worth + |U|, negatives excluded, **eight positive classes give eight slices, no fold (D93)**, a zero class left out, slices in `NET_WORTH_STACK_ORDER`, `drawnCents`, ratios summing to 1); the gauge and averages passed through; `rollingNetWorth` (growths, the savings ratio by month, the projection rows only with an average, null projection without one).
3. `aggregate.ts` (§2.7) and `periods.ts`/`kpis.ts` (§2.3, §11 fix 20): a June month recorded on 1 July groups under June's FY (yearly), June's quarter and `Jun` (monthly), in `aggregateSnapshots`, `compressCashflow` and the year KPIs; the Stage 2–4 chart and KPI tests unchanged; monthly (one row per group equals the row), quarterly and FY yearly groups (`end`, `sum` incl. the cash gain, ratios recomputed from the group's cents, growth sums), the count default per unit, the live flag, a calendar year basis.
4. `trend.ts` (§2.8): a hand-worked line (three points), nulls, one point, equal dates, the slope per month.
5. `recording.ts` (§2.9): `nextRecordMonth` (no snapshots, the latest in the current month, a year boundary), `recordableMonths` (gaps after the latest, none), `recordingsDue` (the last day before and after the record time (23:00, D89, through `recordTimeReached`), two missed months, a month before `since` never due **and blocking every later month** (`blocked` names the first month that would be due; null when nothing would be due), `since` null, December → January); the provisional month rule changed in `periods.ts` with the Stage 3 boundary tests updated (a gap month now labels the next month to record).
6. `tax.ts` (§2.10): hand-worked cases at every band edge **and 50 cents above it**, for FY2024–25, FY2026–27 (15 %) and FY2027–28 (14 %), an FY after the last table (`tableCurrent: false`), the Medicare bands (none, shade-in, full) at and around the threshold and threshold × 1.25, the 2026–27 threshold falling back to 2025–26's, `litoPhaseOut` at $37,500 and $66,667 and one cent above each, null and negative income.
7. `super.ts` (§2.11): a recorded month with a measured-through date before its run date carries the later SG and contributions into the next month's gain (the two gains add up to the same total as without the carry); null measured dates reproduce Stage 4 exactly (the Stage 4 super tests and goldens unchanged); `SuperResult.measuredThrough` for the provisional period (updated, not updated, no provisional period); a stored measured-through date before the previous valuation's (the clamp: no SG counted twice).
8. **Goldens** (§9): `test/golden/history.networth.golden.test.ts` (+ `historyAdapter.ts`, `historyFormulas.ts` for the sheet-faithful helpers, `historyTally.ts`) with `describeWithLocalWorkbook`, printing counts per area and reason only; the Stage 2–4 goldens unchanged.
9. Purity: the new modules pass `test/purity.test.ts` and ESLint unchanged.
10. Set `HISTORY_ENGINE_IMPLEMENTED = true` only after the full unit suite (goldens included) passes.

### 7.4 server-api
1. **Context and inputs** (§4.5) with unit tests on a fake engine: every input row (the snapshots with their extras; the composer input; the savings offset rule: stored figures, the last migrated month's Stage 4 derivation, earlier nulls, no offset account at all; the measured-through input; the chart unit and count from the query over the settings; the year basis).
2. **Page builders** for `/api/net-worth`, `/api/history`, `/api/history/series`, `/api/settings`; DTO mapping tests field by field against hand-built engine results; the type-level assignability tests (§4.4); `SETTING_READERS` against the page constants.
3. **`writeRecordedMonths`** (§4.5): one month, two months sharing a run date (the second with empty windows), the source per case, `recordableMonths` refusals (a gap month, a future month), `SNAPSHOT_EXISTS`, the stored derived columns equal `deriveSnapshotColumns`, the audit row, `origin 'app'`, and **the recorded row equals the live row composed just before** (the same injected `now`, market off). With a fake engine: the context rebuilt inside the transaction per month.
4. **Corrections and deletes:** the changed-columns-only rule, no-op corrections, the next row's `O`/`P`, the revision, `origin 'app'` on a migrated row, the audit before/after, the trigger (a direct SQL update of `run_date` fails), delete only the latest non-migrated row, the deleted month recordable again; the offset extras refused on a migrated row and null refused on a recorded row (the savings seam unchanged by any correction); the `PUT`/`DELETE` import-lock check before the mutex.
5. **Settings:** `GET /api/settings` (groups, origins, `editable` (true for every key but `super.concessionalCapFy`, the six `unused` keys included with `usedOn` [], D91), `lockedBy`, the tax suggestion with and without a salary, `matches`, the allocation sum); PATCH of every editable key (bounds incl. the write-only bounds, the env lock on `history.autoRecord`, `settingsChanged()` called only when that key is written; the response returns every named key, including keys on no page).
6. **`hasAppData`:** a recorded month → true; deleting it → false; a correction of a migrated month → true; the audit log and the recorder's `app_meta` keys → false; `history.autoRecord` → false; a preference key (`features.crypto`, `charts.dateUnit`) → false (D95); an app edit of an `unused` key (`goals.housePriceTargetCents`) → true (a workbook key, D91).
7. **Integration tests** gated by `HISTORY_ENGINE_IMPLEMENTED`: the seed and the synthetic workbook (when `IMPORTER_STAGE5_IMPLEMENTED`) build every Stage 5 response (incl. `recordedToday` after a record: `sinceLastRecord` against the snapshot before); record → correct → delete round trip leaves `dumpDomainTables` identical except `app_meta`; after a record, the Cash, Super and Property pages have no provisional period that day and the recorded month's savings period equals the provisional period shown before (savings, income, rate).
8. **Gating** (the Stage 4 FEAS-1 precedent, pre-authorised): the moment the finance context feeds the D88 inputs, server-api adds `&& HISTORY_ENGINE_IMPLEMENTED` to the gates of `test/cashflow/integration.test.ts`, `test/investments/integration.test.ts`, `test/assets/integration.test.ts` and the three Stage 2–4 server goldens (a Scaffold note). Every ungated suite stays green at server-api's done-check; the gated ones must have **run and passed** once the flag is true (the Integrator confirms, §7.8; the Verifier, §10 #2).
9. **Server golden** (§9.4), gated by `HISTORY_ENGINE_IMPLEMENTED && IMPORTER_STAGE5_IMPLEMENTED` and `describeWithLocalWorkbook`, `{ timeout: 180_000 }`.
10. **Docs:** README and `docs/ARCHITECTURE.md` (generic only).
11. **Done means the gated suites ran**: report "blocked on engine/importer" with everything else green if they have not landed.

### 7.5 recorder (tests only, no server needed)
1. `config.ts`: `AUTO_RECORD` values (`true`, `1`, `yes`, `false`, `0`, `no`, blank → null, an invalid value → `ConfigError`).
2. `recorder.ts` with a **fake clock** (hand-rolled `Clock` or Vitest fake timers with `now` injected) and temp databases: the switch (setting, env, env locking the setting), `since` written on and cleared off (start-up with the env on and no stored date; `settingsChanged`), `planNext` at fixed local times (the month's last day at 22:59 and 23:00, D89; the day before at 23:30 (not due); the timer never longer than 6 h; a DST change in April and October with `TZ=Australia/Sydney` set for that test file), **a scheduled record at the month end** (one `job_runs` row `schedule`, one snapshot `recorded`), **the start-up catch-up** after a simulated outage across two month ends (two `late` months sharing the run date, trigger `startup`), a month before `since` never caught up, nothing due → no `job_runs` row, a failure then a retry after 15 min, **failures at 23:00, 23:15, 23:30 and 23:45 followed by the first wake-up after midnight recording the month `late`** with the 1st as its run date, **an attempt whose price wait crosses midnight** (started at 23:59; the months and source re-derived after the wait: `late`, the new day's run date, the month still in its own FY), the import lock held → skipped and retried, a manual record while a scheduled one runs (the second waits, then `SNAPSHOT_EXISTS` or success), `RECORD_IN_PROGRESS` after the wait, the price refresh through `market.refresh` awaited before the write (a fake market; a timeout still records with `pricesRefreshed: false`; a refresh within 5 min is reused), market off (`MarketDataDisabledError`) → no refresh, **the import lock is never held by the recorder** (a Stage 3 mutation succeeds during a record's price wait) and an upload that starts during the wait makes the record skip (automatic) or answer 409 (manual), **`stop()` during the price wait resolves within one fake-clock tick** and writes nothing (`failed`, skipped `stopped`), a blocked plan (D94: one `partial` run with `earlier_month_missing`, not repeated at the next wake-up; `status().blocked`), the hourly price job running at 23:00 (the record joins it; one refresh), one time source (`now` for dates, `clock` for timers), `withLock` serialising a correction behind a record.
3. The status (`nextRunAt` local with offset; `lastRun` from the scheduler).
4. Report done with `pnpm vitest run --project server test/recorder test/config.test.ts`, typecheck, lint and `pnpm guard:all`. The end-to-end cases that need the real `writeRecordedMonths` are gated on `HISTORY_ENGINE_IMPLEMENTED` and on server-api's implementation (report "blocked on server-api" until it lands).

### 7.6 importer
1. §3.5 items 1–4, each with tests on the synthetic workbook (through `mutate` for the cases it lacks: a setting cell blanked, an "only when typed" override back to its formula, an invalid enum text): an import-origin row reset to the default with the info line; app rows of workbook keys following the Stage 3 rule 3; app-only keys untouched; an app row of a preference key kept on re-import with its info line (D95); an app row of an `unused` key follows the Stage 3 workbook-key rules unchanged (D91: it counts as app data, so it blocks an unforced re-import); the dry run's line; idempotency; the migration equivalence with 0005.
2. The importer golden (`test/golden.test.ts`) still reconciles the owner workbook with zero unexplained lines; update only the counts it prints.
3. Set `IMPORTER_STAGE5_IMPLEMENTED = true` after the suite passes; report counts only.

### 7.7 web (phase A — parallel; no running API needed)
1. API layer (§6.2, `keepPreviousData` on the keyed queries), display helpers (`pages/history/display.ts`: class and liability labels, column labels, month words; the markers in the Stage 4 registry), the `packages/ui` additions (§6.1: `BarChart` overlays, `totalLabel`, the dashed legend key, `Datum.color`, `DonutChart maxSegments`; with tests and a Scaffold note each).
2. The three pages (§6.3–§6.5), the Settings links (§6.5 item 10), the navigation features and the header marker (§6.6), the §6.7 text updates, phone orders and the 768–1199 px grids (§6.8), states (§6.9).
3. **Unit tests** with mocked fetch on `@joinr/schema/fixtures` (+ supplementary fixtures): every fixture state renders; assets − liabilities = net worth on screen; the hero tiles' deltas (arrow, word, tint); the distribution's eight slices with no "Other" (D93), a zero class left out, and the exclusion note; the gauge's "—" and target; the allocation's sum warning; the view switch (unit and count sent as the query, nothing saved, **no Loading line while switching**); chart colours per `NET_WORTH_CLASS_SLOTS`, constant across every chart and the donut, and the validator maths on the stack order with any one class empty and on the donut's ring with the wrap and any one class empty, the two documented exceptions held to their floors (§5); chart titles from the unit and the live caption only with a live group; the donut's centre label ("Net worth" / "Assets shown" with the negativeEquity fixture); the callouts of §6.3 item 3 (Note while `hasAppData` is false, Important after; blocked); the trend caption; the rolling table's live, late and projected markers and the offsets column only when needed; the History lead text; the record form (the fieldset legend, default months, the gap warning, the values line for any ended month, the shared-date note, the early-record note, the D34 note only while `hasAppData` is false, the one pending text, the 409 messages; Record them now opens and focuses the form); the correct form (changed columns only, "was $X", owed figures entered positive and sent negative, the extras read-only on a migrated row, the workbook callout on a migrated row vs the audit note on a recorded one, the required reason); Details and Correct as a card after the table with focus moved and returned; delete only on the deletable row with its confirm; details grouped with the "Not recorded" nulls; the consistency panel (derived headline, movements as information); the audit list; 24-hour times in the server's offset; the hash targets focused after load; the Settings groups (every type of field, origins, the one-or-the-other callout rule, the preference groups' note, the tax suggestion per Medicare band and the LITO line, its buttons filling the field without saving, "In use", the "suggested" label on the bracket-plus-levy button (D90), the env lock, the features note, the "Kept from the workbook" group editable with the workbook callout and "Not used by the app" (D91), the used-on links, the record-hour texts reading 23:00 from `recordHour` (D89)); the pages' Settings links derived from the groups of their keys (Budget: Pay and tax · Budget) and the Super page's suggestion line; one label per key on every page and in Settings; no page shows "Stage 5" (§6.7); the rolling table newest first with its toggle; nav hiding and the switched-off callout; phone column orders and markers in the first cell via `matchMedia`; every form's pristine/pending Save and error mapping.
4. `RootLayout.test.tsx` and `router.test.tsx` updates (no placeholder route left but `/fire`).
5. **Draft** the e2e files (§7.8); report "phase A done" with typecheck, lint and unit results.

### 7.8 Integrator (phase B — starts when engine, server-api, recorder and importer report done)
1. Run the stack on 5285/3285 (fresh `artifacts/stage5/integrator/data`, `MARKET_DATA_MODE=fake`, synthetic import, **`AUTO_RECORD` unset**); fix integration defects in web files (other owners' files for integration fixes only, listed).
2. **`e2e/history-support.ts`:** `mockHistoryPage(page, route, fixture)` (as `mockAssetsPage`), `cleanupHistoryRows(request)` (deletes any recorded month whose note starts with `E2E_NOTE`, latest first; `import.setup.ts` calls it before the import).
3. **`e2e/networth.spec.ts`, `history.spec.ts`, `settings.spec.ts`** (desktop + phone, read-only): each page's h1, the hero tiles, the main tables against the API (captions and counts; assets − liabilities = net worth), charts render (`svg` or the empty message), the view switch, no page scroll, no console errors, screenshots; the Settings anchors (`/settings#super` scrolls to its group and focuses its heading after load) and a page's Settings link lands on its group; **the 768–1199 px check** (desktop project; §6.8 tables and spans, no inner scroll on the assets table at 1024); **the 1440 px check** (incl. the hero band ≤ 200 px); `e2e/brand.spec.ts`'s hero test moved onto the real dashboard (the region name, four tiles, the node line above the tiles, 140–200 px).
4. **`e2e/history-states.spec.ts`** (both projects, `mockHistoryPage`): screenshots at 1440 and 375 of every fixture state of §3.6; asserts the h1, no console errors and no page scroll.
5. **`e2e/history-mutations.spec.ts`** in a new project **`history-mutations`** (desktop viewport, `testMatch: /history-mutations\.spec\.ts/`, `dependencies: ['assets-mutations']`); `desktop` and `phone` add it to `testIgnore`. Every row carries `E2E_NOTE`:
   1. Record the **current month only** (the last entry of `recordable`) from the History page's form → `GET /api/import/runs` → `hasAppData === true`; the Net Worth page's rolling table shows it recorded; the Cash page has no provisional period today.
   2. Correct its cash value with a reason → the row shows "Corrected", the audit trail has the entry, the net worth moved by the difference.
   3. Delete it (the latest) → `hasAppData === false`; the month is recordable again; the audit trail keeps three entries.
   4. Settings: PATCH `savings.yearBasis` to `calendar` from the Settings page → the Net Worth gauge says "This year"; restore `fy`. The spec never switches auto-record on and never edits a workbook setting.
   5. `afterAll` → cleanup; afterwards `hasAppData === false`.
6. `e2e/ui-core.spec.ts` (the Scaffolder's list stays) and `e2e/records.spec.ts` (the `snapshot-audit` page: 28 record pages; `test.setTimeout(120_000)`).
7. Screenshots under `artifacts/screenshots/{desktop,phone}/{networth,history,settings}-*.png`. Run the full e2e suite on your ports (`mutations`, `cashflow-mutations`, `assets-mutations` and `history-mutations` must run and pass; skipped counts as failed), then `pnpm test` once more and confirm the gated suites of §7.4 step 8 **ran** (not skipped); write the final report.

### 7.9 Reviewers (report findings; do not edit)
- **spec-correctness:** the engines vs spec 01 and this plan; D81–D88 applied; every §11 fix present and nothing else changed; run the goldens and check every §9.2 area is compared or skipped only for a §9.3 reason, with the counts in `docs/private/stage-5-private.md` §3; check the owner-import expectations of the private §5 through the API on `artifacts/stage5/review-spec/data` (`MARKET_DATA_MODE=off`); the Stage 2–4 figures unchanged on the owner import; record a month on that scratch copy with a fixed clock and check it equals the live row; no owner values in tracked files.
- **style-ux:** screenshots at 1440, 1024 and 375 of the three pages, every form, every fixture state and the pages' Settings links; STYLE_GUIDE §1–§10 and D6, D7, D17–D20, D31, D33 (one teal figure per page, the hero per §7.2 with figures on surface cards, status never colour-only, red only for losses and falls, §8 formats incl. `FY2026–27` and "Mar 2027", U+2212, no page scroll at 375, status-first tables, chart slots per `NET_WORTH_CLASS_SLOTS` and constant per class, the second-axis exception only on the savings chart, trend lines grey dashed).
- **code-quality/security:** validation at every write boundary; the recorder (the mutex, the import lock, timers on the injectable clock, `stop()`, no unbounded waits, failures retried, never two records of a month); `IMMEDIATE` transactions and rollback; the identity trigger; corrections' audit completeness; the D34 rules; error leakage (no figures in logs or error messages); engine purity; test isolation (fake clocks, temp DBs, no network, no snapshot files, never `data/`); gating flags never faked. A **scratch numeric scan** (`artifacts/stage5/review-code/`, found/not found per file) of the tracked diff against every number with ≥ 4 significant digits in `docs/private/stage-5-private.md`; leave it for the Verifier.

### 7.10 Fixer and Verifier
- **Fixer:** applies the verified findings across owners; contract changes only with the coordinator's approval (Scaffold note); re-runs the affected checks.
- **Verifier:** runs §10 on 5295/3295 with per-item `DATA_DIR`s under `artifacts/stage5/verifier/` (never `data/`); reports pass or fail with evidence; never commits; no owner values in tracked files.

---

## 8. Ports & environment
**One new environment variable:** `AUTO_RECORD` (`true|false|1|0|yes|no`; unset = the `history.autoRecord` setting decides; default off, D84). Never set it in `.claude/launch.json`, the Playwright config, the Dockerfile or any agent command except recorder tests. `PRICE_REFRESH_MINUTES=0` keeps the price job's timer off (a record still refreshes prices through `scheduler.run('prices')` unless the market is off). Playwright keeps `MARKET_DATA_MODE=fake`, `PRICE_REFRESH_MINUTES=0`, `IMPORT_CORRECTIONS_FILE=none`.

| Agent | WEB_PORT | PORT | DATA_DIR |
|---|---|---|---|
| default / owner / `.claude/launch.json` | 5173 | 3001 | `data` (never used by agents) |
| Scaffolder | 5270 | 3270 | `artifacts/stage5/scaffolder/data` |
| engine, recorder, importer | — (tests only; the importer may run the CLI into `artifacts/stage5/importer/data`) | — | — |
| server-api | 5283 | 3283 | `artifacts/stage5/server-api/data` |
| web (phase A) | 5284 | 3284 | `artifacts/stage5/web/data` |
| Integrator | 5285 | 3285 | `artifacts/stage5/integrator/data` |
| Reviewers spec / style / code | 5291 / 5292 / 5293 | 3291 / 3292 / 3293 | `artifacts/stage5/review-{spec,style,code}/data` |
| Fixer | 5294 | 3294 | `artifacts/stage5/fixer/data` |
| Verifier | 5295 | 3295 | `artifacts/stage5/verifier/{e2e,owner,clock,prod}` |

- **Dev-server lessons (HANDOFF):** stop the owner's `pnpm dev` before agent work (a `tsx watch` server on `data/` hot-reloads onto in-progress code and can apply a draft migration); under the Claude preview the server gets `PORT=5173` and listens on 127.0.0.1:5173 beside Vite on ::1:5173, with a cold start of up to ~30 s after Vite is ready; confirm ports are free before and after; servers on other ports may belong to other projects on this PC (check the command line before stopping one); e2e can fail with `net::ERR_NETWORK_CHANGED` (re-run only the desktop and phone projects with `--last-failed --no-deps`, then the four mutating projects one at a time in chain order). **Run every command from the repo root** (a relative `DATA_DIR` resolves against it).
- Git Bash: `PORT=3285 WEB_PORT=5285 DATA_DIR=artifacts/stage5/integrator/data MARKET_DATA_MODE=fake pnpm dev` (set `MSYS_NO_PATHCONV=1` when an environment value is a path). PowerShell: `$env:PORT='3285'; $env:WEB_PORT='5285'; $env:DATA_DIR='artifacts/stage5/integrator/data'; $env:MARKET_DATA_MODE='fake'; pnpm dev`.
- Owner import into a scratch dir: `DATA_DIR=artifacts/stage5/<role>/data pnpm import:workbook --yes`.
- **Time zone:** the recorder uses the server's local date and hour. Tests that depend on it set `process.env.TZ` in their own file (Vitest workers honour it when set before the first `Date`); the Stage 7 compose file sets `TZ` for the container (§12).
- The Browser pane is about 800–1024 px wide; check that range as well as 1440 and 375 px. A custom select needs a real click after `form_input` before React sees the value.
- Unit tests use OS temp dirs or `:memory:`; never `data/`.

---

## 9. Golden values & tests (read at runtime; nothing committed)

### 9.1 The sheet-faithful adapter (`packages/engine/test/golden/historyAdapter.ts`)
It reads the local workbook inside `describeWithLocalWorkbook` and reuses the Stage 2–4 adapters (no corrections file).
- **As-of** = `Net Worth!E52`; **last run** = `Net Worth!C51`; **snapshots** = the frozen History rows (no formula in `B`) with every column `B`–`AK` in cents (money: half away from zero) or as 12-significant-digit ratios, exactly as the importer stores them, `source 'migrated'`, the extras null; the one-per-month rule of the importer (a second row in a month counts `never`). The live row (formulas) separately, in the sheet's doubles.
- **Trades by kind:** the Stage 2 adapter's `TABS` trades (all instruments, the D37 tag ignored).
- **Savings periods:** the Stage 3 cash-flow adapter's `computeSavings` input and result (raw figures are the sheet's `Cash!M`).
- **The live composition:** `composeSnapshot` at `E52` with the Stage 2 adapter's `computeInvestments` results per kind, the Stage 3 adapter's cash totals and accounts, `monthlyPayCents` of the SheetOptions pay settings (IDs 7 and 8 by the column-P lookup; never IDs 1 and 29; never printed), and the Stage 4 adapter's seam (`assetsSnapshotColumns` of the three sheet-faithful results).
- **Chart settings:** `H60` → the unit (Monthly/Quarterly/Yearly), `H61` → the count; the golden also runs every unit (§9.3 rule 6).
- **Golden-only helpers** (`historyFormulas.ts`): the sheet's `IFERROR(g/(v−g), 0)`, the rolling table's `L`–`T` over History rows (doubles), `compressTable` with its `End`/`Sum`/`Average` modes over History rows (for the recomputed quarterly and yearly checks), and `C38` (the calendar mean) for the adapter check.

### 9.2 Cells compared (template references; each read at runtime)
| Area | Cells | Engine output |
|---|---|---|
| **History derived columns** | every frozen row's `D`, `H`, `L`, `P`, `T`, `Z`, `AE`, `AH`, and `O` from the second kept row (rule 1) | `checkSnapshots` (derived: no differences) and `deriveSnapshotColumns` vs the sheet's cells |
| **History movements** | every frozen row's `E`, `I`, `M`, `AI` (rule 2) | `checkSnapshots` (movement) |
| **Rolling net worth** | `Net Worth!K2:T` for every frozen row: `L`, `M`, `N`, `O`, `P`, and `Q`, `R`, `S` (raw), `T` from the second row (rules 3, 4) | `rollingNetWorth` (`breakdown`, growths, `rawSavingsRatio`, `projectedLiquidCents`) |
| **WorkingSheet History block** | `E3:AO` rows for frozen groups (rule 5) | `aggregateSnapshots(H60, H61)` groups' figures |
| **WorkingSheet Net Worth block** | `BO:BW` rows for frozen groups (rule 5) | the groups' `netWorth`, growths, the savings chart's raw rate (`BV`), `BW` = liquid |
| **Other units** | the same blocks recomputed quarterly and yearly from History with the sheet's modes (rule 6) | `aggregateSnapshots` (`end` and movement `sum` columns only) |
| **Net Worth arithmetic** | `C12`, `C13`, `E5:E11` except `E8`, `D15`, `D16` and `WorkingSheet!C4:C11`, fed the sheet's own class cells (rule 7) | `netWorthOf`, `netWorthDashboard` (assets, `assetsExSuperCents`, classes' ratios, `distribution.values`) |
| **`I1`** | `Net Worth!I1` through its closed-row recomputation (rule 8) | `kpis.avgSavingsRawCents × 12` |
| **The live composition** | the live History row `B`–`AK` and `Net Worth!C4:D11` (rules 9–11) | `composeSnapshot` at `E52` |
| **Stage 2–4 goldens** | unchanged (the super goldens with null measured dates, §2.11) | — |

### 9.3 Rules detected at runtime (no row numbers hard-coded)
1. **Derived columns** use the §2.5 match rules on the stored cents; each cell is also compared with the sheet's cached cell at the §9.5 tolerances. The first kept row's `O` is a typed seed in the sheet (`first_period`, skipped).
2. **Movements:** the first kept row's window is `(runDate − 1 month, runDate]` (the importer's rule, which the Stage 2 History golden already matched); counted compared. A row whose window holds a trade the corrections file changes cannot occur (corrections off).
3. **The rolling table's live row** (the row whose `K` equals the live History date) carries the sheet's broken ETF and crypto totals (the Stage 2 `broken_total` detection: a tab total of 0 with a non-zero gain, or a Stage 2 `§9.3` broken cell): skipped `live_row`. Its `T` projection and `S` are skipped with it.
4. **`S`** is the sheet's raw rate (`Cash!M`); compared with `rawSavingsRatio` (the Stage 3 goldens already compare `Cash!M` with the raw figures). `T` equals `L` on every row with data (the sheet's projection never shows): compared with `projectedLiquidCents`.
5. **WorkingSheet blocks:** a group is compared when its last row is frozen (the live group: `live_row`); labels are not compared (the sheet writes full month names such as "March 2024", the app "Mar 2024"; counted `label_format`, not a failure). `BH` (`#ERROR!`) is `never`. `BV` (an average of monthly rates) equals the group's own rate when the group has one row; with more rows it is `defined_by_decision` (D61: income-weighted). The sheet's `End` on the cash gain column (`S` in the block) equals the app's `sum` for one-row groups only; with more rows `fixed_definition` (§11 fix 4).
6. **Other units** (the workbook's `H60` is one unit): the golden recomputes quarterly and FY-yearly groups from the History rows with the sheet's modes and compares the app's `end` and movement `sum` columns (`recomputed`); the cash gain, the ratios and the rates are `fixed_definition` or `defined_by_decision` as rule 5. The sheet's yearly unit is the calendar year; the app's FY groups are compared with a calendar-year recomputation only when the basis is `calendar` (the golden runs both bases; FY `recomputed`).
7. **Net Worth arithmetic** is checked with a `SnapshotFigures` built from the sheet's own `C4:C11`/`D4:D11` (so a broken tab total does not matter): `C12` = Σ classes; `D15` = `C12 + E23` = the breakdown's net worth when `E20:E22` hold only the mortgage (`E20` = 0 and the spare row blank; else `not_rebuilt`, D2); the pie `C4:C11` = `distribution.values` (every class before the drop; a negative `C11` → `negative_equity`, recomputed); `E5:E11` = the sheet ratio of the class rows. `E4` (`ETFs!F17`, the tab's own cost-based ratio) is `never`. `E8` (the cash "gain %", 0 in the sheet) is `fixed_definition` (the app's cash class has no gain, §11 fix 17). `D12`, `D13`, `E12`, `E13` (total gains and their ratios) are not compared: the app computes no total gain (the sheet's sum includes the cash change and a super gain the app does not have, §2.6 step 2), counted `fixed_definition`.
8. **`I1`** = `Cash!C20 × 12`, and `C20` has no upper date bound, so it averages the live row too (Stage 3 §9.3 rule 3; the Stage 3 average uses closed periods only, stage-3 §11 fix 14). The helper recomputes `C20` from `Cash!N` over the rows dated ≤ `C51` with the sheet's floor (`H ≥ MAX(C51 − 365, Budget!D2)`) and compares that × 12 with `kpis.avgSavingsRawCents × 12`, counted `recomputed` (reason `closed_rows`); the cached `I1` is compared exactly only when no live row exists (the app shows the adjusted figure, §11 fix 7).
9. **The live composition** (`composeSnapshot` at `E52` vs the live History row): `B`–`D`, `F`–`H`, `J`–`L`, `AF`–`AH` compared, except a class the Stage 2 goldens mark broken (`broken_total`); `E`, `I`, `M`, `AI` over `(C51, E52]` compared when nothing is dated in `(E52, EOMONTH(E52)]`, else `live_window`; `N`, `O`, `P` compared; `Q`, `R`, `X`–`AB`, `AD`, `AE`, `AJ`, `AK` compared (the Stage 4 seam); `S`, `T` and `AC` `defined_by_decision` (D69, D66); `U`, `V` compared when the sheet's are 0, else `not_rebuilt` (D2); `W` compared.
10. **`Net Worth!C4:D11`** compared with the composed figures (the same broken-total rule): `C8` (= `Cash!C13`, net Total Cash) with `live.cashValueCents` (`N`), not with the dashboard's cash class (positive balances, §11 fix 2); the other values and gains with the classes; `D8` (the latest cash change) is `fixed_definition` (the app's cash row has no gain, §11 fix 17); `D10` (= `Super!B11`, the sheet's reported gain) is `defined_by_decision` (D69: the app's super gain is the provisional `S`, null when balances are not updated), as rule 9's `S`.
11. **`C38`** (the sheet's gauge) is recomputed by the helper from the savings periods (the calendar mean) to validate the adapter (not counted); the app's gauge uses the FY income-weighted rate, which the Stage 3 goldens cover (`defined_by_decision`).
12. Every skip and recompute is counted per reason; each golden test prints `compared: n · skipped: {live_row, first_period, never, label_format, defined_by_decision, fixed_definition, not_rebuilt, broken_total, live_window} · recomputed: n (by reason: negative_equity, other_unit, fy_basis, closed_rows)` per area. The spec reviewer checks the counts against the private §3.

### 9.4 Server golden (`apps/server/test/golden/history.golden.test.ts`)
- Setup: a temp DB; `importWorkbook` of the local workbook with **corrections off**; `buildApp` with market `off`, `now` = `E52` at 12:00 local, and `recorderClock` a **fake clock** (auto-record off; the recorder's dates come from the same `now`, §4.6 item 4).
- Via `app.inject`:
  - `GET /api/history`: `consistency.migratedMatched === migratedChecked`, `derivedMatchedMonths === migratedMonths`, `derivedDifferences === 0`, `movementDifferences === 0` (the PLAN acceptance); `record.nextMonth` = the month after the last History row's; `live` present.
  - `GET /api/net-worth`: every migrated row's `netWorth.netWorthCents` = `Net Worth!P` (rule 3's rows; ≤ max(1, ⌈n/2⌉) cents with n = 9 parts), `liquidCents` = `L`, growths = `Q`, `R`; the rolling live row present; `assetsCents − liabilitiesCents = live.netWorth.netWorthCents`; the classes' values equal `/api/investments/:kind`, `/api/cash`, `/api/other-assets`, `/api/super`, `/api/property` figures (cross-API consistency); `charts.groups` monthly = the WorkingSheet History block's frozen groups (cents).
  - `GET /api/history/series?unit=quarterly` and `yearly`: the groups' `end` columns equal the last row of each group.
  - `POST /api/history/record` `{ periodMonths: [nextMonth], note: null }` → 201 (`note` is required and nullable, §4.3); the recorded row's figures equal the `live` figures fetched just before (every column; market off, so no price moves); `GET /api/net-worth` then has `recordedToday: true` and `sinceLastRecord.base` = the month before; `hasAppData === true`; a second record of that month → 409 `SNAPSHOT_EXISTS`; `GET /api/cash` has no provisional period (as-of = the run date) and its last closed period equals the provisional period fetched before (savings, income, rate); `DELETE` it → `hasAppData === false`.
- Print counts only.

### 9.5 Tolerances
Cached formula results keep 10 significant digits; every comparison allows `max(listed, 1e-9 × |sheet value|)`.
| Quantity | Tolerance |
|---|---|
| Money per cell (cents vs the sheet × 100, half away from zero) | ≤ 1 cent |
| A total that is the Σ of n once-rounded parts (`L`, `P`, `C12`, `C13`, `D15`, `D16`, a group's net worth) | ≤ max(1, ⌈n/2⌉) cents |
| A difference of two such totals (`Q`, `R`, growths) | ≤ max(1, n) cents |
| A ratio recomputed from stored cents (the derived columns) | the §2.5 match rule; against the sheet's cached ratio `max(1e-9, 1e-9 × |v|)` when recomputed from the sheet's doubles |
| Ratios from unrounded decimals (the golden helpers) | `max(1e-9, 1e-9 × |v|)` |
| Dates, months, counts, statuses | exact |

---

## 10. Acceptance tests (the Verifier runs every item)
**Run order and isolation:** never `data/`; confirm 5295/3295 are free and delete each item's `DATA_DIR` first; stop servers between groups; **`AUTO_RECORD` unset everywhere except #9**. Order: **1–5 → 6 (e2e) → 7–8 (owner copy) → 9 (clock) → 10 (prod) → 11–14.**

| # | Check | How |
|---|---|---|
| 1 | Install and static checks | `pnpm install` (no prompts), `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`: exit 0 |
| 2 | Unit tests | `pnpm test` green: ≥ 3207 + new; `HISTORY_ENGINE_IMPLEMENTED` and `IMPORTER_STAGE5_IMPLEMENTED` true; the gated server suites **ran**, including the Stage 2–4 real-engine suites and goldens gated in §7.4 step 8 (`--reporter=verbose` shows them run, not skipped) |
| 3 | Migrations | `git diff --exit-code` on `0000`–`0004`; `0005` holds no table recreate; fresh → 6; a 0004 DB with data upgrades unchanged; the identity trigger refuses a run-date update; `/api/health` → `migrations: 6` |
| 4 | Engine goldens | `pnpm vitest run --project engine test/golden --reporter=verbose`: every §9.2 area compared; counts per reason match the private §3 (compare privately); the Stage 2–4 golden tallies unchanged |
| 5 | Server goldens | `pnpm vitest run --project server test/golden --reporter=verbose`: the history golden and the Stage 2–4 goldens ran and passed (**the PLAN acceptance: recomputing the migrated snapshots reproduces the stored values**) |
| 6 | e2e | `PORT=3295 WEB_PORT=5295 DATA_DIR=artifacts/stage5/verifier/e2e pnpm e2e`: setup, every Stage 0–4 spec, `networth`, `history`, `settings` and `history-states` on desktop and phone, the 768–1199 px and 1440 px checks; `mutations`, `cashflow-mutations`, `assets-mutations` and `history-mutations` ran and passed |
| 7 | Owner data, API | `DATA_DIR=artifacts/stage5/verifier/owner pnpm import:workbook --yes` (corrections auto, as the owner's database), `MARKET_DATA_MODE=off`, a fixed `now` is not available to `pnpm start`, so compare only the date-independent figures of the private §5 through `GET /api/net-worth`, `/api/history`, `/api/settings` (the rolling table's migrated rows, the consistency counts, the tax suggestion, the settings groups and origins); scratch script prints pass/fail only |
| 8 | Record, correct, delete + D34 on the owner copy | on #7: baseline dump; `POST /api/history/record` for `record.nextMonth` → the row equals the live figures fetched just before; `hasAppData` true; the upload re-import → 409 `IMPORT_APP_DATA_EXISTS`; a second record → 409 `SNAPSHOT_EXISTS`; correct one figure with a reason → revision 1, audit entry, the next month untouched (none yet); a correction of a migrated month → `origin app`; delete the migrated month → 409 `SNAPSHOT_NOT_DELETABLE`; delete the recorded month → 200; `--yes --replace-app-data` restores the baseline (the corrected migrated month back to `origin import`; the audit log kept) |
| 9 | **Scheduled record with a simulated clock** (PLAN acceptance) | `pnpm vitest run --project server test/recorder --reporter=verbose`: the month-end record, the start-up catch-up across two missed months (`late`, one run date), `since` as the catch-up floor, the env lock, the retry, the import-lock skip, the mutex, all on the fake clock with temp DBs; plus one live probe: `AUTO_RECORD=true` on a copy of #7 with `PORT=3295` and the system clock → `/api/status` shows `history.autoRecord: true` and a `nextRecordAt` on this month's last day at 23:00 local (D89); stop it (no record happens unless the probe runs on a month's last day after 23:00: then one `recorded` row is expected and is deleted afterwards) |
| 10 | Prod bundle | `pnpm build`; `PORT=3295 DATA_DIR=artifacts/stage5/verifier/prod IMPORT_CORRECTIONS_FILE=none pnpm start`; deep links `/`, `/history`, `/settings` serve HTML; synthetic import; the four GETs → 200; `preClose` stops the recorder before the scheduler (clean shutdown log) |
| 11 | Immutability (PLAN acceptance) | the server tests of §7.4 steps 3–4 ran: a recorded month is never overwritten (409), corrections change figures only with an audit row, the trigger refuses identity changes, and no route other than the correction endpoint updates a `snapshots` row (a test lists the routes that write the table) |
| 12 | Privacy | `pnpm guard:all` exits 0 (with the Stage 5 terms); re-run the code reviewer's numeric scan on the final tracked diff: nothing found (exact matches triaged by hand, the Stage 4 lesson); no snapshot files |
| 13 | Engine purity | `pnpm exec eslint packages/engine --max-warnings=0` and `test/purity.test.ts` |
| 14 | PLAN acceptance, whole | #5 (recompute), #11 (immutable), #9 (scheduled record, simulated clock); the dashboard's charts per D83 on the owner copy (#7 screenshots at 1440, 1024 and 375 under `artifacts/screenshots/`); every §11 fix applied and listed in the close notes |

**Demo frames** (D84): the owner's real `data/` is **backed up and never recorded**. The demo runs twice:
0. With every server stopped: back up `data/finance.db*` to a new git-ignored `data/backups/pre-stage5-demo-<date>/`; copy it to a scratch `data/demo-stage5/` (git-ignored; the coordinator adds a launch configuration with `DATA_DIR=data/demo-stage5`, auto-record unset).
1. **Real `data/`** (migration 0005 converts it on the first start; view-only, plus re-import-safe settings such as the year basis): the Net Worth dashboard end to end (hero, where it stands, the four charts with the view switch, the rolling table with the projection), the History page (the imported months, the consistency check "N of N reproduce", the live row), the Settings page (every group, the "Kept from the workbook" group editable but not saved here (D91: a save would block a re-import), the tax suggestion with the bracket-plus-levy figure marked "suggested" (D90), the auto-record text at 23:00 (D89), the pages' links back). `hasAppData` must still be false at the end.
2. **The scratch copy** (its launch configuration sets `MARKET_DATA_MODE=off`, so the recorded row equals the live row just shown; with live prices the record's refresh would move it slightly, §2.4 step 7): record the current month with Record month → the recorded row, `hasAppData` true, the Cash page's closed period; correct one figure (audit trail); delete it; switch auto-record on in Settings → the status card's next run; switch it off.
3. Phone views of Net Worth and History.

---

## 11. Template bug fixes applied in Stage 5 (owner can veto)
Numbering is stable. Fixes 1, 5, 6, 9, 11, 13, 14, 16 and 20 carry out kickoff decisions (fix 20: D29) or the PLAN scope and are listed so the owner sees each change; the others are proposals.
1. **Net worth counts every offset account.** Linked offsets net their mortgage (inside property equity, D67) and unlinked ones count as cash-like assets. The template counted offsets as mortgage payments (which kept them in net worth); your copy removed that, so an offset would drop out of net worth once it left Total Cash (D56).
2. **Accounts in debit are a liability** in the dashboard's assets-and-liabilities table (cash shows the positive balances), as the PLAN scope says; net worth is unchanged. The charts keep cash net of them (as the sheet), so the series stay continuous with the imported months, and say so in a caption.
3. **The distribution donut leaves out negative slices** (underwater property equity, overdrawn net cash) and names them. The sheet's pie could not show a negative slice. Every other class keeps its own slice (up to eight; no "Other classes" fold, D93).
4. **Quarterly and yearly groups sum the cash change** as the Net Worth and Cash chart blocks already did (the History chart block showed the last month's), and rates become income-weighted (D61) instead of averaged (the sheet's `Average`).
5. **Yearly chart groups are financial years everywhere** (D52), the Stage 2 investment charts included, which grouped calendar years. The year savings-rate basis setting still switches the Cash figures and the gauge (D52).
6. **The savings-rate gauge uses the FY (or the calendar year by the setting) and Σ savings ÷ Σ income** (D83, D52, D61), with the budget's planned rate as its target tick. The sheet averaged monthly rates over the calendar year of the last run.
7. **"Total savings rate / year" becomes "Average savings a year"**: a dollar figure (average monthly savings × 12, after D51 adjustments), labelled as such. The sheet's `I1` was a dollar amount labelled a rate.
8. **The rolling table projects liquid assets 12 months ahead** at your average monthly savings, marked Projected. The sheet's projection column only filled rows with no data, so it never showed.
9. **The provisional period is labelled the next month to record** (the month after the last recorded one), so a missed month keeps its name until it is recorded, and the Record form defaults to it. Stage 3 labelled it with the calendar month, so a missed month's figures were shown under the next month's name (the Stage 3 collision rule).
10. **Recording a month twice is refused** and changes are explicit, audited corrections; the latest month recorded in the app can be deleted (audited) and recorded again, imported months never (D92). The sheet's behaviour on a second press was unknown and edits left no trace.
11. **Missed months are caught up automatically** (D82) with today's values and date, marked "Recorded late"; months before the latest recorded one are shown as gaps. The sheet left stale blank rows. **Auto-record never creates a gap on its own** (D94): while a month from before auto-record was switched on is missing, it waits and asks you to record or skip it.
12. **A correction recalculates the dependent figures** (gain %, the cash change of that month and the next, equity), so a corrected month stays consistent with itself.
13. **Feature switches hide pages from the navigation** (the sheet's First Time Setup toggles hid tabs by script); hidden pages still count in net worth.
14. **Current ATO resident rates replace the stale 2019–20 table** (D85) and suggest a marginal rate with the Medicare levy (the bracket alone is offered too, D90); the rate you enter is never changed without your click.
15. **The Settings page warns when the allocation targets do not add up to 100 %** (the sheet's `I17`), on the Settings page and the dashboard's allocation card.
16. **Re-importing resets imported settings the workbook no longer provides** to the app default (D87).
17. **The cash row on the dashboard has no "gain".** The sheet's `D8` showed the latest month's cash change as the cash class's gain (and counted it in total gains); the change is shown on the History page instead.
18. **Recorded months store the figures later months need** (D88): the offset-account total (so later Δ-offset savings are exact), the linked offsets, the accounts in debit and the super measured-through date (so SG and contributions after a month's measured balance date count in the next month's gain, not as a loss in this one).
19. **The historical net-worth chart puts debts below zero and lets negative equity go below zero** (D83), with net property equity as the sheet; the sheet's stacked columns could not show a negative stack.
20. **A month recorded late stays in its own year** (D29): June recorded on 1 July counts in June's financial year in the yearly charts, the year savings rate and the "This FY" change. Grouping years by the run date would have moved it into the next year.

Decisions applied (not fixes): D81 month-end auto-record, D82 catch-up, D83 the chart set, D84 auto-record off before the cutover, D85 the tax brackets, D86 Settings grouped with the pages' forms kept, D87 the settings reset, D88 the stored Stage 4 figures; the owner's plan-review answers D89 the 23:00 record hour, D90 the suggested rate with the levy, D91 the unused workbook settings editable, D92 deleting the latest app-recorded month only, D93 every class in the donut, D94 auto-record waits for a missing month, D95 the chart and page switches as preferences.

---

## 12. Risks & fallbacks
| Risk | Status / fallback |
|---|---|
| **Recorded months block a re-import (D34)** before the Stage 7 cutover | Auto-record is off by default (D84); the record form and the switch say so while `hasAppData` is false; the demo records only on a scratch copy; a recorded month can be deleted (latest first) to restore re-import. |
| **Time zone and DST** (the recorder uses local time; a Docker container defaults to UTC) | The record hour (23:00, D89: clear of the 02:00–03:00 DST changes; a record crossing midnight becomes `late`, §4.6) and the month's last day use the server's local time; tests pin `TZ`; the timer never sleeps more than 6 h, so a DST change or a clock jump re-plans; Stage 7 sets `TZ` in the compose file (HANDOFF). |
| **The server is down on a month's last day** | D82 catch-up at start-up and at every wake-up (`late`); `since` stops it back-filling months from before auto-record was on; months that cannot be filled show as gaps. |
| **Several missed months recorded together share a run date** | The later months have empty windows and read as no change; the year rate stays right (income-weighted); they carry the "Recorded late" badge and "Recorded together with …" (§2.9). |
| **A record while prices are stale or the market is down** | The record refreshes prices first (bounded wait); on failure it records with cached prices and the audit says how old they were; the preview shows the prices' age. |
| **Two records at once** (a click and the scheduler; two tabs) | One mutex; `period_month` is unique; the second waits then gets `SNAPSHOT_EXISTS` or `RECORD_IN_PROGRESS`. |
| **An import during a record, or a record during an import** | The recorder never holds the import lock (so the other pages' saves keep working during a record); it checks the lock before and again, synchronously, after the price wait, right before its synchronous write; the upload re-checks `hasAppData` after its own awaits; the scheduler retries after 15 min. |
| **Auto-record meets a month missing from before it was switched on** (the likely Stage 7 cutover case) | Decided (D94, §2.9): it waits (a `partial` run, callouts on History and Net Worth) until the owner records or skips the month; nothing becomes a gap without the owner's action. |
| **Shutdown during a record's price wait** | The recorder aborts its own wait; nothing is written; a scheduled record is caught up at the next start (D82). |
| **Corrections break the History's integrity** | Figures only (the identity trigger), derived columns recomputed for the row and the next, a complete audit, the consistency check on the History page. |
| **The D88 offset reading** (null instead of 0 on migrated rows) | Same effect for migrated periods; keeps Stage 4's workbook-offset rule at the seam; no effect until an offset account exists. |
| **The super carry (D88a) changes a recorded month's gain after the fact** | Only the split between months moves; a unit test asserts the two gains add up to the uncarried total; migrated months are unchanged (null dates). |
| **Nine chart series vs eight palette slots** | Liabilities take the "Other" grey (STYLE_GUIDE §6.1's ninth-series rule) and always sit below zero; every chart has a legend and a table view. |
| **The second axis on the savings chart** | One documented exception (§6.1), the table view shows both columns. |
| **The tax table ages** (a new FY, a new Medicare threshold) | `tableCurrent` and the threshold's FY are shown ("Check the ATO rates for FY20xx–yy"); the owner's rate is never overwritten (D85); the tables are checked each July (D85). |
| **Newly editable workbook settings** (the six unused ones included, D91) make more edits block a re-import | The workbook callout on every workbook key (Stage 4 §6.7), the unused group too; app-only and preference keys (D95) say "Kept when you re-import". |
| **Engine cost per request** (the dashboard composes everything) | One memoised context per request; profile if `/api/net-worth` exceeds 150 ms on the owner copy. |
| **Four mutating e2e projects** | Chained dependencies (`mutations` → `cashflow-mutations` → `assets-mutations` → `history-mutations`); the history spec deletes what it records; the Verifier starts from an empty `DATA_DIR`. |
| **The e2e record test depends on today's date** (the synthetic workbook's last month vs today) | The test records the last recordable month (always the current month) and deletes it; gaps before it are left alone. |
| **Stale dev servers on `data/`** | The coordinator pre-step stops them; agents use `artifacts/stage5/*`; nobody sets `AUTO_RECORD`. |

---

## 13. Every agent: final report checklist
- Files created or changed (all inside your ownership; Scaffold notes appended; Integrator cross-area edits listed).
- Commands run with pass/fail: typecheck, lint, format:check, your scoped tests, your e2e specs on your ports, `pnpm guard:all`.
- Engine, server-api, the spec reviewer and the Verifier: golden counts per area (compared / skipped by reason / recomputed). **No owner values, names or notes** in anything that could be committed.
- Screenshot paths under `artifacts/screenshots/` (UI roles) and the STYLE_GUIDE §10 self-check.
- Contract gaps or cross-owner requests (not worked around).
- Ports free, no background processes left, **no `AUTO_RECORD` set and no month recorded on `data/`**.
- Nothing committed or pushed; no owner data in any tracked file.

---

## Scaffold notes

_Scaffolder appends here (append-only, inside this section, above the Plan review log): where the skeleton differs from, or adds to, the plan above. The implementers, the Integrator and the Fixer append contract clarifications here too._

### 2026-09-27 - Scaffolder

The done-check passed: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` (172 files, 3314 tests; the Stage 4 baseline was 170 files, 3207 tests), `pnpm build`, `pnpm guard:all` (clean); `PORT=3270 WEB_PORT=5270 DATA_DIR=artifacts/stage5/scaffolder/data pnpm e2e e2e/smoke.spec.ts e2e/ui-core.spec.ts` on a fresh folder (65 passed, 8 project skips); `/api/health` → `migrations: 6`; `DATA_DIR=artifacts/stage5/scaffolder/data pnpm seed:dev --yes` exits 0; ports 3270/5270 free afterwards. `git diff --exit-code` on the `0000`–`0004` SQL and snapshot files is clean. No `pnpm install` (no dependency or lockfile change). Several generic fixture values first matched private guard terms; the values were changed (no guard-term edit).

**Contract change (frozen name, needs the coordinator's OK):** §3.2's `SNAPSHOT_VALUE_COLUMNS` in `src/history.ts` is exported as **`SNAPSHOT_FIGURE_COLUMNS`**. The root already exports `SNAPSHOT_VALUE_COLUMNS` from `records.ts` (the records registry's 36 History columns with `dbColumn`/`id`/`label`/`type`, used by the importer's extract and reconcile and by the server's record loader); the root's `export *` made the two names ambiguous. Same content as §3.2 (the 36 History columns B…AK in table order, then the four extras); every other §3.2 name is as planned.

**Migration `0005_stage5_history`**
- Generated by drizzle-kit (`db:generate --name stage5_history`): `CREATE TABLE snapshot_audit`, `CREATE INDEX snapshot_audit_period_idx` and six `ALTER TABLE snapshots ADD` (no recreate, no `PRAGMA`), `meta/0005_snapshot.json` and the journal entry. A header comment in the first chunk says the trigger was appended by hand; the §3.1 trigger follows a statement breakpoint, verbatim.
- Tests (`apps/server/test/migrations.test.ts`): a fresh DB has the columns, the audit table, its index and the trigger; a statement-shape check of 0005 (generated statements only `CREATE TABLE`/`INDEX`/`ALTER TABLE … ADD`, then the trigger; no data statement); a 0004 database with its own raw snapshots (import rows, with and without an app row) upgraded to 0005 keeps every value, gets null extras and `revision 0`, an empty audit log and an unchanged `hasAppData`; the trigger refuses an update of `run_date`, `period_month`, `source` and `recorded_at` and allows a figure update and a delete; the Stage 1 upgrade test's expected dump gains the six columns (the Stage 1 seed dump drops them first).

**Schema (`@joinr/schema`)**
- Enums (§3.2) appended; `JOB_NAMES` gains `snapshot`. Tables: the six `snapshots` columns and `snapshotAudit` in `db/tables/history.ts`; `DOMAIN_TABLES_DELETE_ORDER` and `DUMPED_TABLES` unchanged (comments updated).
- **Rows:** `newSnapshotSchema` gains the six columns (`offsetCents ≥ 0`, `mortgageOffsetCents ≥ 0`, `cashDebtCents ≤ 0`, `superMeasuredThrough` an IsoDate, `note` ≤ 200, `revision` an integer ≥ 0, optional); `newSnapshotAuditSchema` (+ `NewSnapshotAudit`) with the type-level and runtime parity tests.
- **Records:** `snapshots` gains `offset` "Offset accounts", `linkedOffsets` "Linked offsets", `cashInDebit` "Accounts in debit", `superMeasuredTo` "Super measured to" (date), `revision` "Corrections" (integer), `note` "Note"; entity `snapshot-audit` "Snapshot audit" (History group; `at` "When", `period`, `action`, `trigger`, `note`; default sort `at` desc). `apps/server/src/records/index.ts` has the full loaders for both (not only the minimum).
- **Settings (§3.3):** `history.autoRecord` (category `history`, app-only, default `false`); `EDITABLE_SETTING_KEYS` = 60 (the Stage 3–4 22 in their order, then every other key in registry order except `super.concessionalCapFy`, then `history.autoRecord`); `SETTING_GROUPS` (`as const`) with `SettingGroupId` and an additive `settingGroupOf(key)`; `PREFERENCE_SETTING_KEYS` (+ `PreferenceSettingKey`, `isPreferenceSettingKey`); `SETTING_WRITE_BOUNDS: Partial<Record<EditableSettingKey, { min; max }>>`, read first by `settingWriteBoundIssue` (message `must be between <min> and <max>`); `SETTINGS_PATCH_MAX_KEYS` = 64.
- **Registry labels (D86)** now carry the pages' words: `Pay day (day of the month)`, `Use the budget for the amount to invest`, `Share of investments counted toward goals`, `Emergency fund (months of spending)`, `Count mortgage principal as savings`, `Offsets count toward the emergency fund`, `Include side income`, `Year basis`, `A price is stale after (days)`, `Your employer’s SG rate`, `Contributions tax`, the eleven `Show the <Page> page` switches (`features.retirement` → `Show the Super page`). Keys no page edited got plain words the web may refine: `charts.dateUnit` "Chart grouping", `charts.unitCount` "Groups shown in charts", `savings.includeRetirementContributions` "Count retirement contributions as savings". The pages' own label maps are still there (web removes them, §6.5 item 11).
- **`src/history.ts`** as §3.2 (with the rename above), plus the additive `SnapshotFigureKey`, `CorrectableSnapshotColumn`, `SnapshotOffsetExtra`, `NetWorthStackClass`; `FeatureKey = Extract<SettingKey, 'features.${string}'>`; `monthEndOf` throws `RangeError` for a malformed month. `SNAPSHOT_COLUMN_MODES`: `sum` for E, I, M, AI, O, R, W; `ratio` for the seven ratio columns; `end` for everything else (V included; the sheet's block sums only the movements, R and W).
- **`src/tax.ts`** as §3.2, plus the `TaxBand` type.
- **`dto/fields.ts`** exports `optionalText` and `signedCents` (±`CASHFLOW_MONEY_MAX`); `dto/assets.ts` imports them (same behaviour). Not re-exported from the root (generic names); `dto/history.ts` imports them.
- **`dto/history.ts`**, **`dto/settings.ts`**: every §4.3–4.4 schema and DTO, field by field; additive exports `CHART_COUNT_MAX` (240), `CORRECTION_COLUMNS_MAX`, `CORRECTION_SIGN_BOUNDS`, the parsed/body types (`NetWorthQuery`, `HistorySeriesQuery`, `RecordRequest`, `RecordRequestBody`, `SnapshotCorrection`, `SnapshotCorrectionBody`). `snapshotCorrectionSchema` uses `z.partialRecord` (Zod 4's `z.record` with an enum key is exhaustive). **Messages** (server 400s read `path: message`): `periodMonths: must list at least one month` / `must list at most 24 months` / `a month appears twice`, `periodMonths.N: after this month`, `note: must be at most 200 characters`, `values: name at least one figure`, `values.<column>: must not be negative` / `must not be positive`, `note: say why`; an unknown or non-correctable column fails the key schema. The record month bound compares with the local month of `now()`.
- **Errors, status, cash flow:** the four codes; `AppStatus.features?`, `AppStatus.history?`; `CashPageResponse.staticUntilStage4` removed (every writer and reader: `cashflow/cash.ts`, `fixtures/cashflow.ts`, the server tests now assert the field is absent, a web test title).
- **Seed (§3.6):** `clearSeededTables` also clears `snapshot_audit`. `seedRecordedMonth(db, { periodMonth, runDate })` (exported from `@joinr/schema/testing`) inserts one `recorded` app month with generic figures, the four extras (offsets $15,000, $10,000 of them linked; an account $300 in debit; super measured four days before the run date), U = V = 0, derived columns by the §2.5 rules against the latest snapshot on or before its run date, and one audit `record` row (`manual`, `snapshot_json`, a market-off `detail_json`); returns `{ snapshotId, auditId }`.
- **Fixtures (`fixtures/history.ts`)** are literals written by `artifacts/stage5/scaffolder/fixture-gen.ts` (git-ignored), which applies the §2 rules to generic inputs; `test/history-fixtures.test.ts` re-checks them. States exactly as §3.6 (`netWorthPages` 10, `historyPages` 7, `settingsPages` 8) plus the mutation examples `recordResponse`, `correctionResponse`, `deleteSnapshotResponse` and **`autoRecordPatchResponse`** (the Cash-slice `settingsPatchResponse` in `fixtures/cashflow.ts` already fits the named-keys rule and is unchanged). `HISTORY_FIXTURE_AS_OF` = 24/09/2026. Choices where the contract is silent (owners may refine):
  - `NetWorthBreakdown.missing` lists null value columns among B, F, J, N, AF, AJ, Q, X, U, AB (never `offsetCents`, which is null on every imported month).
  - A generic savings model feeds the savings ratios, the gauge, the averages (the 365 days before the last run) and `charts.savings` (`adjustmentCents` 0, `trendRatio` null); two months sharing a run date give the later one an empty window (0 added, 0 income).
  - The allocation rows use N as the cash class value, targets 50/20/5/15/5/5 %, `reason 'most_underweight'`.
  - A trend with one point: `fittedCents [null]`, slope null, `points 1`.
  - Settings `usedOn` uses a guessed page map (server-api's `SETTING_READERS` decides); a key never stored has `value null`, `origin null`; `hasAppData` = any workbook, non-preference key with origin `app`.
  - `historyPages.populated`: imported Oct 2025–Mar 2026 (Jan corrected with origin `app`, Feb with one movement difference), Apr and May recorded `late` at start-up on 02/06/2026, Jun `recorded` and corrected, Jul `lookback`, Aug missing (recorded then deleted in the audit, so all three actions appear) and live; `nothingToRecord` has Aug and Sep recorded today (no live row); `autoRecordBlocked` is as of 30/09/2026.
  - `FIXTURE_COVERAGE` gains the six §3.6 lists (classes and liabilities counted where non-zero somewhere).
  - `sampleDtos.ts`: the snapshots page gains a `recorded` row with the extras and the six new cells on every row; a `snapshot-audit` page; two settings rows take the new labels; `apiErrors` gains the five Stage 5 bodies.

**Engine contract (`@joinr/engine`)**
- `types.ts`: every §2.2 type, the two additive Stage 4 fields, and named aliases for the twelve functions (`ComposeSnapshotFn`, `DeriveSnapshotColumnsFn`, `CheckSnapshotsFn`, `NetWorthOfFn`, `NetWorthDashboardFn`, `RollingNetWorthFn`, `AggregateSnapshotsFn`, `LinearTrendFn`, `NextRecordMonthFn`, `RecordableMonthsFn`, `RecordingsDueFn`, `SuggestMarginalRateFn`); `EngineApi` has 45 members.
- `index.ts`: twelve `export const` stubs typed with their aliases, all throwing `engine: not implemented`; `HISTORY_ENGINE_IMPLEMENTED: boolean = false`; the `engine` value has 45 members.
- `test/api.test.ts` (→ engine): the member list, `toEqualTypeOf` for the twelve, the flag, `SnapshotFigures` ⇄ `SnapshotFiguresShape` both ways, and a stub-throw test under `skipIf(HISTORY_ENGINE_IMPLEMENTED)` (remove it with the flag).

**Server stubs**
- `routes/{history,netWorth}.ts` answer 501 `NOT_IMPLEMENTED` ("`<METHOD> <path>` arrives with the Stage 5 server work", `no-store`) for the six §4.2 routes; `GET /settings` likewise in `routes/settings.ts`. Each exports `<Name>RouteOptions` (the cash-flow options object); `app.ts` registers them with it.
- `history/record.ts`: the frozen `writeRecordedMonths` (throws 501), plus **`RecordDetail`** and **`RecordedMonth`** declared there. `history/recorder.ts`: the frozen `SnapshotRecorder`/`createSnapshotRecorder`, `RecorderStatus = RecorderStatusDto`, the six §4.6 constants, re-exports of `RecordDetail`/`RecordedMonth`; the stub's `start`/`stop`/`settingsChanged` do nothing, `record` throws 501, `withLock` runs `fn`, `status` is off (`source 'setting'`, `recordHour` 23).
- `app.ts`: `app.recorder` decorated (built from the services, `engine ?? the real engine`, `now`, `recorderClock ?? systemClock`); `BuildAppOptions.recorderClock?: Clock` (additive); `preClose` awaits `recorder.stop()` then `scheduler.stop()`. `index.ts` calls `app.recorder.start()` after `app.scheduler.start()`.
- `config.ts`: `AUTO_RECORD` (`true|false|1|0|yes|no`, blank = unset) → `config.autoRecord: boolean | null`; **always null under `NODE_ENV=test`** (my reading of §4.6 item 1; the recorder owner may change it), an invalid value is a `ConfigError`. `test/helpers.ts`'s `testConfig` sets `autoRecord: null`; `config.test.ts` covers the values.
- `test/app.test.ts`: the seven stubs answer 501 with `no-store`; the recorder is decorated and stopped before the scheduler.

**Compile and expectation fixes the contract forced (→ each file's owner)**
- `apps/server/test/investments/helpers.ts`: neutral fakes for the twelve (null figures, zero breakdowns, every class and liability at 0, the gauge from `kpis`, `nextRecordMonth` = today's month, nothing recordable or due, no suggestion).
- `apps/server/test/investments/builders.test.ts`: the raw month/date `UPDATE` became a temp-table copy, `DELETE` and `INSERT` of the row.
- `apps/server/test/assets/settings-notes.test.ts`: the editable-key count (60) and the page-coverage and PATCH-all assertions restricted to the first 22 keys (server-api rewrites them, §4.5).
- `apps/server/test/cashflow/income-budget-routes.test.ts` and `packages/schema/test/cashflow-schemas.test.ts`: the "not editable" example is now `super.concessionalCapFy`; the max-keys test is 64.
- `apps/server/test/records-routes.test.ts`: the seed adds one recorded month (`seedRecordedMonth`); counts for `snapshots` (4) and `snapshot-audit` (1).
- `apps/server/test/{assets/integration,assets/pages,cashflow/pages,golden/assets.golden}.test.ts`: `staticUntilStage4` asserted absent.
- `packages/importer/test/stage3-upgrade.ts`: `stage3Shape` drops the six new `snapshots` columns (the migration-equivalence test and the importer golden pass).
- Label assertions: `apps/web/src/pages/{budget/BudgetPage,investments/InvestmentPage}.test.tsx`, `investments/display.test.ts` (`Emergency fund (months of spending)`); `apps/web/src/pages/records/RecordsEntityPage.test.tsx` (45 snapshot columns); `packages/schema/test/{registries,db,rows-parity}.test.ts` updated; new `history-schemas.test.ts` and `history-fixtures.test.ts`.

**Web stubs:** typed routes `/` (`pages/netWorth/NetWorthPage.tsx`, h1 "Net worth", subtitle "Overview"), `/history` (`pages/history/HistoryPage.tsx`) and `/settings` (`pages/settings/SettingsPage.tsx`), each with the note "Arrives with the web work."; `pages.ts` unchanged. `pages/NetWorthPage.tsx` (the Stage 0 sample) and its test are left for web to remove. `e2e/ui-core.spec.ts`'s short-page list is `['/fire']`.

**Importer flag:** `IMPORTER_STAGE5_IMPLEMENTED: boolean = false`.

**For the owners (not worked around):**
- `e2e/brand.spec.ts`'s Stage 0 sample-hero test now meets the stub dashboard at `/` and will fail until the Integrator moves it onto the real dashboard (§7.8 step 3; not part of this done-check).
- `e2e/records.spec.ts`: 28 record pages now (Integrator, §7.8 step 6).
- server-api: `settingsResponse` still returns page slices only (a PATCH of a key on no page answers an empty slice until the named-keys rule, §4.5); `hasAppData`'s preference-key rule (D95); `SETTING_READERS`; the page-coverage assertions in `settings-notes.test.ts`.
- web: `router.test.tsx`'s "placeholder" test still targets `/history` (it checks the h1 only, so it passes).

### 2026-09-27 - importer

§3.5 items 1–5 done; `IMPORTER_STAGE5_IMPLEMENTED = true`. No contract change (no schema, enum or reason-code edit); every change is in `packages/importer/**`.

- **`writer.ts`** (`writeSettings`): after writing the workbook's settings, every row of a workbook key the workbook did not provide is handled by origin: `import` → deleted (D87; the key reads its registry default), `app` → deleted as before (Stage 3 rule 3), except a `PREFERENCE_SETTING_KEYS` app row, which is kept (D95). A provided preference key whose stored row is `app` is not overwritten (the value, `updatedAt` and `origin` stay). App-only and unknown keys are never touched, whatever their origin (e.g. the server-written `super.concessionalCapFy`). `WriteResult` gains `settingsResetToDefault` and `keptAppPreferences` (keys, sorted; internal to the importer). `settingKeys` still lists every provided key, kept preferences included, so `counts.settings` and the settings count check are unchanged.
- **`reconcile.ts`:** two count-only info lines in section `settings`, emitted only when the count is > 0: `settings.resetToDefault` (`unit 'count'`, `actual` = rows reset, `reasonCode null`, `refs { decision: 'D87', entity: 'settings' }`) and `settings.keptAppPreference` (the same shape, `D95`). The dry run reports both (the writes happen inside the rolled-back transaction). **Deviation (additive):** the per-key value check of a kept preference whose app value differs from the workbook is `info` with `refs { decision: 'D95', entity: 'settings' }` and the reason "Kept the value set in the app (a display preference)" instead of `unexplained` (otherwise a kept preference would fail every re-import); `expected`/`actual` stay the workbook and stored values, as for every settings line. No new `REASON_CODES` entry (that would be a schema change).
- **Reading of D95 where §3.5 is silent:** an app row of a preference key the workbook does **not** provide (e.g. `charts.unitCount`, an "only when typed" key whose cell holds the template formula) is also kept (rule 3 would otherwise delete it, contradicting "a re-import keeps the app value") and counts toward `settings.keptAppPreference`; an app value equal to the workbook's is kept as an app row too (it never counts as app data). An **import-origin** preference row the workbook stops providing is reset (D87), as §3.5 says.
- **Tests:** new `test/import.settings.test.ts` (20 tests on the synthetic workbook through `mutate`: a blanked SheetOptions cell, an "only when typed" override back to its formula, an invalid enum text, an import-origin preference row blanked, the counts, the dry run for both lines, rule 3 and the provided-key replacement unchanged, an app row of an `unused` key following the workbook-key rules (D91), app-only keys untouched, every preference key kept, both lines together, idempotency incl. a blanked cell imported twice and a kept preference across repeats). `test/stage3-upgrade.ts` generalised (`stage4MigrationsDir`, `stage4Shape`, `upgradeFrom`, `STAGE5_SNAPSHOT_COLUMNS`; `upgradeFromStage3` kept as an alias); `test/migration-equivalence.test.ts` gains the 0004 → 0005 equivalence (clean, unchanged live totals, the faulty duplicate-month variant, one-snapshot-per-month either way, a not-vacuous check). `test/golden.test.ts` gains two tests: no Stage 5 settings line on a fresh import or its repeat, and the 0004 → 0005 equivalence on the local workbook. The golden still reconciles with 0 unexplained lines; it prints no counts, so nothing to update.
- **For server-api:** until `hasAppData` applies the D95 exclusion, an app edit of a preference key still blocks the upload route (the importer itself now keeps such rows).

### 2026-09-27 - recorder

`apps/server/src/history/recorder.ts` replaces the stub in place; `config.ts` and `index.ts` are unchanged (the Scaffolder's `AUTO_RECORD` parsing and the `start()` call already match §4.6). No frozen name, field or signature changed.

- **Additive exports** (internal, not frozen): `createSnapshotRecorderWith(deps, { writeMonths })` (the §7.1 module seam; `createSnapshotRecorder` passes the real `writeRecordedMonths`), `SnapshotRecorderDeps`, `SnapshotRecorderSeams`, the pure helpers `planNext`, `nextMonthEndRecordTime`, `recordTimeReachedAt`, `localIsoWithOffset`, and `PlanState`, `PlanNextResult`, `SnapshotJobDetail`, `SnapshotSkipReason`, `AUTO_RECORD_SINCE_META_KEY` (`snapshot.autoRecordSince`), `RECORD_IN_PROGRESS_MESSAGE`, `RECORDER_STOPPING_MESSAGE`.
- **The `source` argument of `writeRecordedMonths`** (a contract clarification; server-api's `recordSourceOf` reads it the same way): it names the source of the ended months, and the writer always stores the current month as `recorded`. The recorder passes `late` for an automatic attempt with any late month (else `recorded`), and for a manual record `recorded` when every month is the current month, else `lookback`.
- **Retry:** a failed attempt, or one skipped for the import lock, stores a retry time (the attempt's end + `SNAPSHOT_RETRY_MS`); nothing runs before it, and the first wake-up at or after it runs. A mutex wait that times out in an automatic attempt ends the job `failed` (retried the same way).
- **`pricesRefreshed`** is true when the refresh finished within the wait or when prices refreshed within `SNAPSHOT_PRICE_FRESH_MS` were reused; false for market off, a failed refresh or a timeout. `pricesAgeMs` = now − `pricesAsOf` (the market's last refresh).
- **`already_recorded`** skips (a month recorded by hand while the automatic attempt waited) do not make a run `partial`; `import_in_progress` and `earlier_month_missing` do; `stopped` ends it `failed` with error `stopped`. A blocked plan (D94) is reported by a run that does no price refresh.
- **Manual records** check the import lock before waiting for the mutex and again inside it (before and after the price wait); after `stop()` they reject with 503 at once.
- **Timers:** no timer while the effective switch is off (the start-up check still runs once and does nothing); `status().blocked` is computed only while the switch is on; `nextRunAt` is this month's 23:00 on the last day until it passes, then next month's.
- **Tests** (`apps/server/test/recorder/`, `TZ=Australia/Sydney` pinned per file): `planning.test.ts` (pure planning, DST in April and October, and a parity check of the tests' reference `recordingsDue` against the engine's, run whenever the engine's function is implemented), `recorder.test.ts` (fake timers, in-memory databases, the fake writer), `end-to-end.test.ts` (the real `writeRecordedMonths` and engine, market off; gated on `HISTORY_ENGINE_IMPLEMENTED` and on the writer not being the 501 stub). `config.test.ts` gains invalid `AUTO_RECORD` values and trimming.

### 2026-09-27 - engine

`HISTORY_ENGINE_IMPLEMENTED = true` after the full engine suite (goldens included) passed: `pnpm vitest run --project engine` 34 files, 444 tests (Stage 4 end: 27 files, 364). No frozen contract changed (`types.ts` untouched).

**Modules:** new `snapshot.ts` (`composeSnapshot`, `deriveSnapshotColumns`, `checkSnapshots`), `netWorth.ts` (`netWorthOf`, `netWorthDashboard`, `rollingNetWorth`), `aggregate.ts`, `trend.ts`, `recording.ts`, `tax.ts`; changed `periods.ts` (`nextRecordMonth`; the provisional month is the next month to record, §11 fix 9; `groupOf`'s yearly unit keys on the period month's last day, §11 fix 20), `kpis.ts` (the year is that of the last recorded period's month; a period counts in the year its month ends in), `super.ts` (D88a measured-through dates, `SuperResult.measuredThrough`), `index.ts` (stubs replaced). The Scaffolder's stub-throw test in `test/api.test.ts` is removed with the flag.

**Readings where the plan is silent (deviations to review):**
- `composeSnapshot` writes every derived column through `deriveSnapshotColumns` (ratios from the rounded cents, `Z = X + AB + linked offsets`), so T is `'0'` when the super gain is null, and a composed row always equals its own derivation.
- `deriveSnapshotColumns`: Z is null only when X and AB are both null (one null counts 0, the sheet's blank).
- `checkSnapshots`: the first snapshot's O is a seed and is not checked or counted (§9.3 rule 1; a row checks 13 cells, the first 12). A ratio whose gain or value is null matches a stored `0` or null (the sheet stored 0, or the cell was blank); a null ratio against figures is a difference. Differences are listed in `SNAPSHOT_CHECK_COLUMNS` order.
- `nextRecordMonth` uses the greatest period month (the run-date-latest one on consistent data), so a record can never name a month at or before an existing one.
- `recordingsDue`: the current month is due on its last day with `recordTimeReached` whatever `since` says (the plan's literal rule).
- `suggestMarginalRate`: `tableCurrent` = the table's FY equals asOf's FY (also false for an FY before the earliest table, which uses the earliest; the Medicare threshold likewise).
- `computeSuper` (D88a): `SuperPeriod.gainFrom` stays the previous valuation point's run date (the transfers-in window); SG and contributions run between the effective measured-through dates; a closed valuation period's measured end (the annualised `through`) is its effective date (its run date when null, so Stage 4 is unchanged). `SuperResult.measuredThrough` = the D79 cut-off whenever there is a provisional period and an open fund has a balance on or before asOf, updated or not (null otherwise).
- `cashKpis`: `anchor` stays the last run date and `monthsToYearEnd` counts from it; only the year choice and the in-year test use the period month.
- `netWorthOf.missing` names null value columns among B, F, J, N, Q, U, X, AB, AF, AJ (table order), as the Scaffolder's fixtures. `netWorthDashboard` reads a positive stored `cashDebtCents` as 0 (the identity holds by construction for any input).
- `rollingNetWorth`: projected months follow the last data row (the live row, else the latest snapshot); nothing without data rows; the savings ratios are matched by period month.
- `aggregateSnapshots` sorts the rows by run date (`sortByRunDate`); a row's growth is against the row before it in the whole input, so a first displayed group carries its row's growth (the sheet's `BT`).
- Internal exports used by tests only: `sheetRatio`, `ratioMatches`, `RATIO_CHECKS` (snapshot.ts), `nextRecordMonth` (periods.ts).

**Goldens** (`test/golden/history.networth.golden.test.ts` + `historyAdapter.ts`, `historyFormulas.ts`, `historyTally.ts`): every §9.2 area compared; the Stage 2–4 golden tallies unchanged. Choices: the tally adds the recompute reason `retirement_tagged` (Stage 4 rule 16 for the seam's Q/R; 0 on the local workbook); the rolling table's first row counts its four "-" cells as `first_period`; the rolling `S` and the block's `BV` use the Stage 3 savings-rate tolerance max(1e-6, 1e-5 × |v|) (§9.5 lists no rate); the History block's 37th cell per group is its label's month (exact), the label text counted `label_format`; the live row's totals use the Stage 2 summary tolerance over the tab's watch rows.

**For other owners (not worked around):**
- server-api: `apps/server/test/history/integration.test.ts` "builds every Stage 5 page on the seed" now runs (the flag) and fails on `derivedDifferences === 0`: the Stage 1 `seedGenericData` snapshots carry hand-typed ratios that do not follow `g ÷ (v − g)` (stocks, ETF, crypto and super gain % on every month, the cash change % on the third), so the check reports 13 derived differences. The seed values (schema testing) or the assertion need changing.
- Everyone: the provisional month rule (§11 fix 9) and the period-month year rule (§11 fix 20) are live in the engine; no Stage 2–4 engine, server or web test changed result.

### 2026-09-27 - server-api

§7.4 steps 1–11 done; every server suite ran with `HISTORY_ENGINE_IMPLEMENTED` and `IMPORTER_STAGE5_IMPLEMENTED` true (66 files, 952 tests, none skipped; the Stage 2–4 real-engine suites and the four server goldens included). **No frozen name, field or signature changed**; the Scaffolder's `SNAPSHOT_FIGURE_COLUMNS` rename is used as is. No `packages/schema` edit.

**Source.** `history/{inputs,dto,snapshots,pages,record,mutations,responses,audit,constants}.ts`, `settings/{page,readers}.ts`, the routes `{history,netWorth,settings,status}.ts`, and edits to `cashflow/{context,inputs,responses}.ts`, `cashflow/mutations/settings.ts`, `assets/inputs.ts`, `investments/charts.ts` and `db/queries/domain.ts`. `app.ts`, `records/index.ts`, `cashflow/{cash,constants}.ts` and `assets/super.ts` needed no change beyond the Scaffolder's.
- **FinanceContext** gains (all memoised) `salaryMonthly`, `snapshots`, `lastRun`, `liveMonth`, `recordable`, `composeInput(month)`, `compose(month)`, `composeLive`, `dashboardFigures` (the live figures, else the latest snapshot's), `considerNext` (the investment pages' chain: the six classes' targets, the emergency-fund test cash, `budgetInvest().emergencyFundCents`), `netWorth`, `rolling`, `check`.
- **Savings offsets (D88b):** a non-migrated snapshot passes its stored `offset_cents`; the last migrated month (by source) the Stage 4 `offsetCentsAt` derivation when an offset account exists; earlier migrated months null. **Addition:** the live input passes `cashTotals().offsetCents` when an offset account exists **or** any snapshot stores an offset figure (`liveOffsetsKnown`), so money leaving the last offset account (or a flag switched off) still reads against the stored figure. **Super (D88a):** `SuperInput.snapshots[].measuredThrough` = `super_measured_through`.
- **`writeRecordedMonths`:** checks (ascending, before any write) SNAPSHOT_EXISTS (409, "Mar 2027 is already recorded (31/03/2027). Correct it instead.") then `recordableMonths` (400 `periodMonths.N: cannot be recorded (only months after the latest recorded month, up to this month)`, N = the request index); the source is `recorded` for the current month, else `late` when the request says `late`, else `lookback` (`recordSourceOf`; the recorder's note reads it the same way). `snapshot_json` is the inserted row as Drizzle returns it (camelCase, id included, as `seedRecordedMonth`); the record note is stored on the audit row too.
- **Corrections:** the named columns equal to the stored value are dropped; all nine derived columns of the corrected row are rewritten from `deriveSnapshotColumns` (the audit lists only those that changed); **the next row gets only O and P** (`cashGainCents`, `cashIncreaseRatio`), and only when the corrected row's cash value changed, so an imported next row's other stored ratios are never rewritten; the next row keeps its origin and revision. **Deviation (frozen DTO, no field change):** a correction that changes nothing writes no audit row, so `CorrectionResponse.audit` is an unsaved entry with `id 0`, `changes []`, the reason and the current time. 404 message "Mar 2027 is not recorded". Extras: 400 `values.offsetCents: not recorded for imported months` / `values.cashDebtCents: required`.
- **Deletes:** 404 → 409 SNAPSHOT_NOT_DELETABLE (migrated) → 409 SNAPSHOT_NOT_LATEST; the delete audit row has `snapshot_id` null (§3.1 "null after a delete") and the full row in `snapshot_json`; earlier audit rows are never updated.
- **Routes:** every mutation checks the import lock first (the record route too, before parsing, then the recorder again); corrections and deletes run inside `app.recorder.withLock`. `GET /history` and `/net-worth` read `app.recorder.status()` and `hasAppData`.
- **Page choices where the DTO is silent:** `live.pricesAsOf` and `prices.lastRefreshAt` = the market's `lastRefreshAt`; `unpricedCount`/`stalePriceCount` = Σ of the four kinds' summaries; `record.gaps` = months between the first and the latest snapshot month without one; `record.missing` = recordable months whose last day is before asOf; `notes` = the `spend` period notes, oldest first; the History chart uses the settings' unit and count (no query); the tracker trend fits Σ B + F + J + (N + offsets − linked offsets) + AF per group (null when all five are null); `consistency.matched` per row = checked − differences.
- **Settings:** `SETTING_READERS` (page ids of `apps/web` `PAGES`; every page setting-key constant checked against it; [] for the unused, feature and FIRE keys); `usedOn` is in `PAGES` order. The engine is not asked for a tax suggestion without a gross salary (the answer is null either way). `matches` compares decimals by value. `lockedBy` is `env` for `history.autoRecord` only while `config.autoRecord` is not null.
- **`PATCH /api/settings`:** `patchSettings` now returns `{ keys, written }` (internal); `history.autoRecord` named while `AUTO_RECORD` is set → 400 `values.history.autoRecord: set by the server's AUTO_RECORD` (the whole PATCH refused); `app.recorder.settingsChanged()` only when that key was actually written (changed). The response slice is the named pages' slices plus the named keys (page slices first, in their order).
- **`GET /api/status`:** `features` always (every `features.*`, stored value else true); `history` from `app.recorder.status()` when the app has a recorder (a bare status plugin in a test has none, so the field is left out).
- **`hasAppData`:** app rows of `PREFERENCE_SETTING_KEYS` never count (D95). **Investment charts:** `compressSeries(…, 'fy')` (§11 fix 5).

**Tests.** New `test/history/{helpers,inputs,context,dto,record,mutations,pages,has-app-data,immutability,integration}.test.ts` (+ `helpers.ts`) and `test/settings/settings.test.ts`, `test/golden/history.golden.test.ts`; updated `test/{app,status-routes}.test.ts`, `test/assets/settings-notes.test.ts` (page keys ⊆ editable, the named-keys rule), `test/investments/builders.test.ts` (the FY argument). `test/history/immutability.test.ts` is the §10 #11 list: only `history/mutations.ts` updates or deletes a `snapshots` row and only `history/record.ts` inserts one (a static scan of `src/`). The seed's migrated months carry hand-typed ratios, so the seed integration test asserts the consistency sums, not zero derived differences (the synthetic workbook and the golden assert reproduction).
- **Gating (§7.4 step 8):** `&& HISTORY_ENGINE_IMPLEMENTED` added to `test/{cashflow,investments,assets}/integration.test.ts` and the three Stage 2–4 server goldens; all ran and passed once the flag turned true (they also passed with my D88 inputs on the Stage 4 engine before the flag).
- **Server golden (§9.4):** consistency (migrated) 155 cells compared; rolling table `L`, `P`, `Q`, `R` 46 compared (first_period 1, live_row 1); cross-API classes 8; WorkingSheet History block (monthly, all 30 money columns) 319 (live_row 1); quarterly 130 and yearly 52 `end` cells; the recorded month's 40 figures equal the live row. The golden reads the block's groups through `/api/history/series?unit=monthly&count=240` (matched by the label's month), not the imported chart settings.

**Docs:** `README.md` (the Stage 5 routes, `AUTO_RECORD`, recording, correcting and deleting, the D34 rule, health `migrations: 6`, the status line) and `docs/ARCHITECTURE.md` (a History, net worth and settings section with the D34 table, the module rows, the `preClose` order).

**For other owners (not worked around):**
- Scaffolder/coordinator (`packages/schema` fixtures, post-scaffold owner server-api, needs the coordinator's OK): `fixtures/history.ts`' `settingsPages` `usedOn` guesses differ from `SETTING_READERS` (e.g. the investment pages on the pay and budget keys, `history` on `savings.yearBasis`). Not changed: cosmetic for the web tests; say if they should match.
- web: `CorrectionResponse.audit.id === 0` means "nothing changed" (no audit row). `lint` and `format:check` currently fail only in web/ui files in progress (`pages/settings/**`, `pages/history/WhatYouOwn.tsx`, `packages/ui/src/charts/**`).

### 2026-09-27 - web (phase A)

Phase A done: the three pages, the API layer, the `packages/ui` additions, the navigation features, the header marker, the Settings links, the §6.7 texts and the e2e drafts. No frozen contract changed; no schema, server or engine file touched.

**`packages/ui` additions (additive, web-owned, §6.1; each with tests in `charts/options/stage5.test.ts` and `charts/stage5-components.test.tsx`)**
- `BarChart`: `overlays?: BarOverlay[]` (`{ name, values, axis?: 'value' | 'secondary', dashed?, color? }`, line series over the bars, `z` 3, an overlay without a colour takes the next palette slot), `secondaryAxisFormatter?` (a right-hand axis named after its overlay, no gridlines of its own, only when an overlay asks for it), `stackStrategy: 'samesign'` on every stacked bar series, `totalLabel?` (default "Total"). With overlays the tooltip is one per category (trigger `axis`, every bar and line); without, it stays the Stage 0 item tooltip. `BarOverlay` is exported.
- `ChartLegendItem.key` gains `'dashed-line'` (CSS: a masked two-dash stroke); `barLegend` keys dashed overlays with it and solid ones with `'line'`.
- `Datum.color?` (a safe hex/rgb colour, else the slot) honoured by `donutSlices`/`donutOption`/`donutLegend`; `DonutChartProps.maxSegments?` (default `DONUT_MAX_SEGMENTS`, clamped 1–8 by the new `donutMaxSegments`). Eight data with `maxSegments={8}` draw eight slices, no "Other"; the default still folds the seventh.
- `AreaChart` is used unchanged for the History chart (ECharts' default stack strategy is already `samesign`).

**Web**
- API (`api/hooks.ts`): keys `['net-worth', unit, count]`, `['history']`, `['history-series', unit, count]`, `['settings']` (the view parts are `null` when not overridden); `ChartView`; `useNetWorthPage(view)` and `useHistorySeries(view, { enabled })` with `placeholderData: keepPreviousData`; `useHistoryPage` and `useNetWorthPage` refetch every 60 s while visible; `useSettingsPage`; `useRecordMonths`, `useCorrectSnapshot`, `useDeleteSnapshot` with `invalidateAfterHistoryChange`; `usePatchSettings` now uses `invalidateAfterSettingsChange` (every page key, `['settings']`, `['status']`; **not `['prices']`**: the prices page reads no setting, and the existing Stage 3 test keeps "prices are not moved"); every Stage 2–4 helper also invalidates the overview keys. "All" in the count Select is sent as `count=240` (`CHART_COUNT_MAX`): the query has no form for the saved setting's null, and 240 groups is every group the API allows.
- Markers (§6.1): `recorded`, `recordedLate`, `imported`, `corrected`, `live`, `projected` added to the Stage 4 `MARKERS`; `LIVE_FIRST_LABEL` "Live (provisional)" is passed as the label on a page's first mention.
- Pages under `pages/netWorth/**`, `pages/history/**`, `pages/settings/**` (shared helpers in `pages/history/display.ts` and `charts.ts`, words in `historyText.ts`, `netWorthText.ts`, `settingsForm.ts`, the correction model in `correctDraft.ts`, `useHashTarget.ts`, `LinkButton.tsx`, `ViewSwitch.tsx`, `HistoryLinkText.tsx`, `SettingsLinks.tsx` + `groupLinks.ts`).
- `pages/NetWorthPage.tsx` and its test removed; `router.test.tsx`'s placeholder test targets `/fire`, and the three Stage 5 routes are tested with the API down.
- Navigation (`layout/nav.ts`): `navFor(features)`, `pageSwitchedOff`, `PAGE_FEATURES` (Super ← `features.retirement`), empty groups dropped; `RootLayout` shows "This page is switched off in Settings (Pages)." with a link to `/settings#features` above a switched-off page; `freshness.ts` appends " · auto" to the header while `AppStatus.history.autoRecord` is true (the footer is unchanged).
- `SettingsSection`: the `labels` prop is removed (one label per key, the registry's; the five pages' label maps are gone) and every section ends with "In Settings: …", one link per group of its keys. The Super page shows `TaxSuggestionLine` beside the marginal rate (it reads `['settings']`).
- §6.7 texts: the six places are present tense; "History page" / "(History)" in them is a link. The next-buy footer is now "Set them in Settings (Pay and tax, Budget)." (one link per missing setting's group), then "Budget items are set on the Budget page." and "Monthly snapshots are recorded on the History page." when those inputs are missing. `MISSING_INPUTS_FOOTER` is replaced by `MISSING_INPUTS_LEAD` and `MISSING_SNAPSHOTS`.
- `settingsDraft.ts` `ENUM_LABELS` gains `charts.dateUnit` and `investing.allocationAggressiveness`.

**Choices where the plan is silent (reviewers may refine)**
- A class with nothing in any displayed group is left out of the stacked charts and their legends (colours stay per class); "Other debts" appears only when a displayed group has a U below zero.
- The Settings page's group Save reads "Save" with the accessible name "Save <group>" (the long group names overflowed a phone's full-width button). A year setting (`fire.birthYear`) is a plain text field (a NumberField grouped it as "1,990"). A boolean with no stored value shows its default in the switch; a toggle writes a value.
- The tax buttons: "Use 32% (suggested)" and "Use 30% (without the levy)" (D90); a button whose rate is already in the field reads "In use" and keeps its note ("In use (suggested)"). A note is shown when the tax table or the Medicare threshold is an earlier year's.
- The History live card is titled "<month>: today's position" with the "Live (provisional)" marker under it; a corrected row shows "Corrected" and "N correction(s)"; the last automatic run adds its start time. A correction answered with an unsaved audit entry (`audit.id === 0`, server-api's note) is announced "Nothing changed" instead of "Correction saved".
- The recorded-months table keeps its Actions column sticky at the right from 1200 px (the Stage 4 assets-table rule), so Delete never sits off-screen while the 10 columns scroll.
- The assets-and-liabilities subtotals ("Total assets", "Liabilities", "Total liabilities") are white bold body rows; "Net worth" is the table's total row, with no teal cell.

**Gaps reported, not worked around**
- §6.3 item 4's "per-loan lines from `property`" under Mortgages: `NetWorthPageResponse.liabilities` has only the gross and linked-offset figures, so the page shows "Gross $X less linked offsets $Y" and no per-loan lines (it would need a `['property']` query or a DTO field; server-api / coordinator).

**e2e drafts (not run; the Integrator owns and finishes them):** `e2e/history-support.ts` (`mockHistoryPage`, `cleanupHistoryRows` deleting E2E_NOTE months latest first, the width/fit/scroll table lists, `heroHeight`), `networth.spec.ts`, `history.spec.ts`, `settings.spec.ts`, `history-states.spec.ts`, `history-mutations.spec.ts` (skips outside the `history-mutations` project; the Integrator adds the project and `import.setup.ts`'s `cleanupHistoryRows` call).

**Checks (phase A):** `pnpm typecheck` clean; `eslint apps/web packages/ui e2e --max-warnings=0` clean; `prettier --check .` clean; `pnpm vitest run --project web --project ui` 71 files, 1461 tests passed; `pnpm --filter @joinr/web build` OK (the known chunk-size warning); `pnpm guard:all` OK. Fixture screenshots (the API mocked in the browser, no server) under `artifacts/screenshots/{desktop,tablet,phone}/`: hero band 196 px at 1440; no page-level horizontal scroll at 1440, 1024 or 375; no console errors.

### 2026-09-27 - Integrator

Phase B done: the stack ran on 5285/3285 (`artifacts/stage5/integrator/data`, `MARKET_DATA_MODE=fake`, `PRICE_REFRESH_MINUTES=0`, synthetic import, `AUTO_RECORD` unset), the e2e drafts are finished and pass, and the full e2e suite passed with the four mutating projects run in chain order. No frozen contract changed.

**Integration defects fixed (web files, now the Integrator's)**
- `pages/history/useHashTarget.ts`: `/history#record` lost the heading's focus to the form's first field (the form's own mount effect runs after the hook, and React's StrictMode replays it). The heading is now focused after the commit (`setTimeout 0`, only while it is still connected).
- `pages/history/RecordForm.tsx` and `RecordedMonths.tsx`: recording the last recordable month empties `recordable` in the refetch that runs before the mutation settles, which unmounted the form, so `mutate`'s per-call `onSuccess` never ran and "Recorded <month>" was never announced. Both now use `mutateAsync(...).then(...)`, so the page announces the result whatever unmounted (the delete had the same exposure when the only recorded month is deleted). A web test holds the POST, forces the refetch that unmounts the form, then releases it; it fails with the old code.
- `pages/history/AuditTrail.tsx`: the audit trail's first column now keeps 200 px from 768 to 1199 px (`layout.firstMin(150)`, §6.8); it was 164–168 px.
- `pages/netWorth/netWorthText.ts`: `allocationDifferenceText` read `deltaRatio` as target − current; the frozen Stage 2 `ConsiderNextRow.deltaRatio` (engine `timing.ts`, the Stage 2 fixtures) is **current − target**, so the real API's rows read inverted ("Under by" for an overweight class). Negative is now "Under by". A web test pins the sign and checks every fixture row.
- `pages/history/charts.ts` and `display.ts`: in the stacked charts a 0 in "Other debts" (always the live group, D2) was stacked by ECharts' `samesign` rule on top of the positive classes, drawing the grey line up to the total. The chart series now draws Other debts only where it is below zero (the table keeps 0), and `otherDebtsCents` returns 0 rather than −0. Test: `pages/history/charts.test.ts`.

**Cross-owner integration fix (reported for the coordinator's OK)**
- `packages/schema/src/fixtures/history.ts` (server-api's post-scaffold file): the 36 `allocation.rows[].deltaRatio` values were target − current; each is negated to current − target, the Stage 2 convention the engine and server produce. Values only; no field, type or schema changed. The web test above checks every fixture row against the rule.

**e2e (the drafts finished)**
- `playwright.config.ts`: the `history-mutations` project (1440 × 900, `dependencies: ['assets-mutations']`), and `history-mutations.spec.ts` added to `MUTATING_SPECS`, so desktop and phone ignore it.
- `e2e/import.setup.ts`: `cleanupHistoryRows` runs first, before the assets, cash-flow and trade cleanups.
- `e2e/brand.spec.ts`: the Stage 0 sample-hero test now runs on the real dashboard (the "Net worth summary" region, four tiles, the node line above them, 140–200 px on desktop, no "Sample figures" text).
- `e2e/records.spec.ts`: 28 record pages (with `snapshot-audit`), timeout 120 s.
- `e2e/ui-core.spec.ts`: the short-page test matches the placeholder's note by its text. The synthetic workbook switches the FIRE page off, so the Stage 5 "Page switched off" note also appears on `/fire` (the page still fits the viewport).
- `history-mutations.spec.ts`:
  - The audit assertions count only entries above the newest id before the run, because the audit trail outlives a deleted month and earlier runs, and a re-import keeps it.
  - It adds the on-screen checks of §7.8 step 5: the hero "Recorded today", the recorded month's rolling row not live, and the audit trail's first row showing the correction and its reason.
  - The gauge must read "Savings rate <year>" under the calendar basis and "Savings rate FY…" again after the restore.
- `networth.spec.ts`: the rolling table's row count against the API (recorded + live), and the collapsed projection table's count.
- `history-states.spec.ts`: the tax-band loop goes through `about:blank` between states (a hash-only `goto` did not reload, so every state showed the first fixture), and it asserts each state's buttons (two with a levy, one without, none without a salary).

**Open for the Fixer / coordinator**
- The web phase A gap stands: no per-loan mortgage lines on Net Worth (§6.3 item 4; the DTO has only gross and linked-offset totals).
- The Settings fixtures' `usedOn` still differ from the server's `SETTING_READERS` (server-api's note). Wording only; the real page shows the server's list.

**Checks:**
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build` (the known chunk-size warning) and `pnpm guard:all` are clean.
- `pnpm vitest run`: 206 files and 3787 tests pass, none skipped. The gated suites of §7.4 step 8, the history goldens, the history integration and the recorder end-to-end tests ran.
- e2e: 424 tests, 24 of them skipped by project design (desktop-only or phone-only).
  - The runs lost random read-only tests to `net::ERR_NETWORK_CHANGED`, confirmed in their traces.
  - Those were re-run with `--project=desktop --project=phone --last-failed --no-deps` until they passed.
  - The mutating projects then ran one at a time in chain order: `mutations` 3, `cashflow-mutations` 7, `assets-mutations` 3, `history-mutations` 4, all passing.

### 2026-09-27 - Fixer (round 1)

Applied the triaged findings across owners. **Contract changes (additive, recorded here for the coordinator's OK):** SPEC-1 `NetWorthPageResponse.mortgageLoans?`, CODE-3 `HttpError`'s `expose` option, STYLE-5 `GaugeChartProps.targetLabel?`. Nothing else frozen changed; `makeRecordRequestSchema` is unchanged (SPEC-4).

- **SPEC-1 / STYLE-2 / CODE-2 (one fix, SPEC-1's shape):** `packages/schema/src/dto/history.ts` gains `MortgageLoanLineDto` (`loanId`, `name`, `propertyName`, `balanceCents`, `grossCents`, `offsetCents`) and the optional `NetWorthPageResponse.mortgageLoans`. `apps/server/src/history/pages.ts` builds it (`mortgageLoanLines`) from `loanDtos(ctx.data, ctx.property())`: the loans with a property (History AB), page order, each loan's linked offsets capped at its balance (`offsetCents − excessOffsetCents`, at most the gross), `balanceCents = gross − offset`. Display only; every table figure stays from `live`. The lines are sent only when Σ `grossCents` equals the `mortgages` row's, else `[]` (a month recorded today or a stored snapshot need not match today's loans). Fixtures: two generic loans in `populated` and every state built from it ("Example home loan", "Example investment loan", on "Example property"), one in `negativeEquity`; Σ gross and Σ offset equal the row's. `AssetsCard` shows one muted line per loan under Mortgages ("<name> (<property>): $net (gross $X less offsets $Y)", the offset part only when > 0; `mortgageLoanText` in `netWorthText.ts`), after the existing gross and offsets line. Tests: `apps/server/test/history/mortgage-lines.test.ts` (real engine on the seed: two property loans with one offset larger than its loan, the car loan left out, the mismatch guard), `packages/schema/test/history-fixtures.test.ts` (the sums), `NetWorthPage.test.tsx` (the lines; none when the field is absent or empty).
- **SPEC-2 / STYLE-3 / CODE-4:** every `settingsPages` state's `usedOn` now equals `settingReaders(key)` (`PAGES` order; 488 entries). The git-ignored fixture generator (`artifacts/stage5/scaffolder/fixture-gen.ts`, now run with `FIXTURE_OUT=<path>`) imports `settingReaders` and first ports the Integrator's hand fix (allocation `deltaRatio` = current − target; the consider-next class is the most negative), which reproduces the tracked file exactly. New `apps/server/test/settings/fixtures-used-on.test.ts` pins every state and key. No web test or e2e asserted the old guessed links.
- **SPEC-3 / CODE-1 (§4.5 "Corrections", reworded here):** `correctSnapshot` recomputes a derived column only when one of its inputs is corrected (the ratio pairs as the engine's `RATIO_CHECKS`; Z from X, AB and the linked offsets; O from N; P from O and N); every other derived column keeps its stored value byte for byte and is not in the audit. **The first snapshot's O is a typed seed:** never nulled; a corrected N shifts it by the same amount (the change from the month before the history) and P is the sheet ratio of the new O and N; a null stored O stays null; N corrected to null keeps O (P is '0'). Every later row keeps the O/P recomputation against the previous row, and the next-row O/P update is unchanged. Where CODE-1's triage test (b) kept O unchanged on a corrected N, SPEC-3's shift was applied (the seed keeps its meaning); the engine's check never compares the first O either way. Tests in `mutations.test.ts` (on a consistent copy of the seed; the real engine's `checkSnapshots` reports no derived difference after each): an unrelated first-month correction keeps O and P and audits only the figure and its ratio; a corrected first-month N shifts O and moves the next month; N to null; a null seed; a migrated middle month's hand-typed ratio stays byte-identical after an unrelated correction; a corrected mortgage recomputes Z only.
- **SPEC-4 (documentation):** the record body always carries `note` (null allowed), per the frozen §4.3 `optionalText(200)`: the `{ periodMonths: [nextMonth] }` of §9.4 and §10 #8 means `{ periodMonths: [nextMonth], note: null }`. A route test in `mutations.test.ts` pins it (no `note`: 400 `VALIDATION_ERROR` naming `note`; `note: null`: 201). §9.4 itself is left to the coordinator.
- **CODE-3:** `HttpError` takes an optional fourth argument `{ expose?: boolean }` (`readonly expose`, default false); the error handler answers an exposed 5xx with its own code and message and logs it at warn with no figures; every other 5xx stays generic. The recorder's stopping error is exposed. Tests: `app.test.ts` (an exposed 503 and an unexposed 500) and `apps/server/test/history/record-stop.test.ts` (a manual record waiting on a refresh that never settles, then `app.recorder.stop()`: 503 `INTERNAL_SERVER_ERROR` "The server is stopping; nothing was recorded", nothing written).
- **CODE-5:** two generic generator inputs nudged by a few dollars (the monthly super contribution and the savings model's added amount) and the fixtures regenerated; the reviewer's numeric scan no longer reports the stage-5-private and stage-4-private hits it listed (counts only; no new private line in the found list). The web tests' formatted figures follow.
- **CODE-6:** `record.test.ts` (the second month's composition throws: neither month nor an audit row is written) and `mutations.test.ts` (the next row's derivation throws: both rows and the audit log unchanged, 500).
- **CODE-7:** `apps/web/vitest.config.ts` sets `testTimeout: 15_000`.
- **STYLE-1:** the recorded months' Actions cell uses the Stage 4 pairs (Details · Correct, then Delete), and the Month column's desktop minimum is 120 px (150 on phone, 200 on a tablet), so with a Delete row the table fits the 1152 px area at 1440 px (the sticky rule stays). e2e `history.spec.ts` checks at 1440 px (populated fixture) that no figure header meets the Actions header and that Delete sits inside the table; a web test checks the two pairs.
- **STYLE-4:** the month cell no longer repeats the markers (the Source column shows them on every width); the phone test is renamed and checks both cells.
- **STYLE-5:** additive `GaugeChartProps.targetLabel?` (default "Target"; a ui test); the gauge reads "Budget plan 30.0%" and the separate "Budget plan 30%" line is gone; the averages note takes the body face (`.jf-app-meta--prose`).
- **STYLE-6:** the projected liquid figure is muted (`jf-app-muted`; the dashes already were).
- **STYLE-7:** History shows an Important "Auto-record is waiting" callout while `recorder.blocked` is set (the Net Worth words without ", on the History page"; one shared `blockedWaitingText`), with "Record it now" / "Record them now" opening the record form with the missing months ticked (it never records).
- **STYLE-8:** the tax suggestion comes in parts (`taxSuggestionParts`; `taxSuggestionText` joins them): the suggested rate in `<strong class="jf-app-strong">`, the FY label in `.jf-app-nowrap`, the buttons in `.jf-app-tax-actions` (full width below 768 px).
- **STYLE-9:** the correct form's group legends use `.jf-app-fieldset__legend` (13.5 px bold uppercase, white) with a hairline between groups.
- **STYLE-10:** `LIVE_AREA_NOTE` ("The last point is live…") under the History area chart and `LIVE_TABLE_NOTE` ("The period marked (live) uses today's prices and balances.") under every table view; the Net Worth bar charts keep the §5 bar wording.
- **STYLE-11 (a §6.1 exception, audit pairs only):** `changePairText` shows a ratio change that one decimal hides at up to two decimals (`formatRate`), then three.
- **STYLE-12:** the assets table's figure headers are `nowrap`; e2e checks the populated and negativeEquity fixtures at 1440 and 1024 px (no inner scroll, each figure header on one line).
- **Not applied:** STYLE-13 (the STYLE_GUIDE §6.1 D93 note is the coordinator's, at stage close).

## Stage close notes (coordinator)

**Outcome (2026-09-27).** The flow ran in three workflows plus two single-agent steps:
1. Planner → 3 plan critics (spec, UX, feasibility/privacy) → reviser.
2. The owner answered the seven plan-review questions (D89–D95; three differ from the proposed defaults: 23:00, the unused workbook settings editable, every donut class). A plan amender applied them; the coordinator ran the pre-step (the `data/` backup and the §8, §8.1 and §8.2 guard terms).
3. Scaffolder → engine, server-api, recorder, importer and web phase A in parallel → Integrator.
4. 3 reviewers → per-reviewer triage → Fixer → Verifier.
5. Coordinator follow-ups: the STYLE_GUIDE §6.1 note for D93 (STYLE-13), the §9.4 record-body wording (SPEC-4), a steadier Net Worth hero e2e test, and the demo fix below.

The owner approved the demo and accepted all 20 §11 fixes (D96).
- **Final state:**
  - typecheck, lint, format:check, build and `guard:all` are green. The guard has 4596 private terms.
  - **3834 unit tests** pass (209 files) with none skipped. Every gated suite ran: the cashflow, investments and assets integration suites, the four server goldens (history included: the migrated snapshots reproduce), the engine goldens and the importer golden, and the recorder's end-to-end cases.
  - **e2e:** every test passed after the allowed re-run of the `net::ERR_NETWORK_CHANGED` failures; the skips are by viewport design. The `mutations`, `cashflow-mutations`, `assets-mutations` and `history-mutations` projects ran in chain order.
  - The Verifier passed every §10 item (1–14), including the owner-import API checks against the private companion.
- **Plan review:** the critics raised 46 findings; 44 were applied, 2 applied in part and none rejected. Two needed the owner (answered as D94 and D95).
- **Code review:** 24 findings (SPEC 4, STYLE 13, CODE 7, including the two build hand-overs: per-loan mortgage lines and the Settings fixtures' `usedOn`). Triage sent all 24 to the Fixer (each with a test); none deferred, refuted or raised to the owner.
- **Coordinator approvals during the build:** the Scaffolder's rename of §3.2's `SNAPSHOT_VALUE_COLUMNS` to `SNAPSHOT_FIGURE_COLUMNS` (a root-export clash with `records.ts`); the Integrator's sign fix of the allocation `deltaRatio` fixture values; an additive per-loan mortgage field on the Net Worth response (SPEC-1).
- **Demo:**
  - Part 1 on the real `data/` (view only): migration 0005 applied on the first start; 12 of 12 imported months reproduce, with the two expected movement differences (Feb and May 2026); `hasAppData` stayed false and auto-record off.
  - Part 2 on a scratch copy (`data/demo-stage5`, market off, since removed): record Sep 2026 (the recorded row equalled the preview), correct its cash with a reason (dependent figures recalculated, audit entry), delete it (recordable again, `hasAppData` false, the audit trail kept three entries), auto-record on (next 30/09/2026 at 23:00) and off, never counting as app data.

**Demo fix (coordinator).** The Settings field "Groups shown in charts" (`charts.unitCount`, default null) showed a blank box with no hint. `fieldHint` now says "Blank = automatic: 12 months, 8 quarters or every year" for it; `SettingsPage.test.tsx` checks the description.

**e2e fix (coordinator).** `e2e/networth.spec.ts`'s hero test compared the page with an API response fetched before the page loaded; the post-import price refresh could land in between (seen twice by the Fixer and the Verifier). It now fetches and loads again until both agree (`toPass`, 30 s).

**Deferred (with target stage):**
- **Stage 6 polish:**
  - Carried from Stage 4: STYLE-5, STYLE-6, STYLE-7, STYLE-11, CODE-9 and the guard hardening for numbers written with `_` or thousands separators.
  - Carried from Stage 3: STYLE-13, STYLE-15 and the chunk-size warning (route-level code splitting).
  - The e2e `net::ERR_NETWORK_CHANGED` flakes are heavier than in Stage 4 (9–31 per full run); consider retries for the read-only projects.
- **Stage 7 cutover:**
  - Set `TZ` (the owner's zone) in the compose file: the recorder's 23:00 is server-local (D89).
  - After the fresh import, switch auto-record on (D84); if a month is missing from before it was switched on, record it (look-back) or record the current month alone (D94).
  - Carried from Stage 4: correct the mortgage payment and compounding in the sheet before the export (D76); optionally date the undated items (D73); the budget rows' stale account names (D65).
- **Stays as decided:** D79's one-date rule across super funds (D88).

**Lessons carried forward:**
- Walking the demo's settings groups found a field whose blank default had no hint; a null default needs words, not an empty box.
- An e2e test that compares an API figure with the page must fetch and load together (or retry), because background jobs (the price refresh) move live figures.
- The Chrome window can report 0 px wide when minimised; ask the owner to restore it before screenshots.

## Plan review log (2026-09-26)

Three critics (spec, UX, feasibility/privacy) reviewed this plan and the private companion. The plan reviser verified each finding against the code, the specs, the decisions and the local workbook (scratch under `artifacts/stage5/plan-reviser/`: a palette search with the `palette.test.ts` maths, a guard-term generator for the History cells and group sums, and re-runs of the critics' probes), then applied it, applied it in part, or rejected it. Findings are listed in the order received, with the critic's id; the owner-specific consequences (recomputed golden counts, demo expectations, guard terms) are in the private companion. None was rejected; two were applied in part (SPEC-6, UX-7). Three consistency fixes were made while revising: §2.6 steps 1–6 were rewritten once so the table, the charts and the donut share one netting rule (Σ class values = net worth + |U|); the blocked state has one recorder field and one callout per page; the record preview admits the price refresh. **Two needed the owner's decision** and were applied provisionally as the recommended default: auto-record waits instead of leaving a gap (SPEC-3), and the chart and page switches as re-import-safe preference keys (UX-20); the owner has since decided both as proposed (D94, D95; "Owner answers" below). The LITO phase-out range was rechecked from web-search summaries of the ATO page (the site refuses automated fetches).

| # [critic id] | Finding (generic) | Outcome |
|---|---|---|
| 1 [SPEC-1] | The golden compared the sheet's yearly average savings with the app's closed-period average, but the sheet's average includes the live row | **Applied:** the helper recomputes the sheet's average over closed rows with the sheet's floor and compares that × 12, counted `recomputed` (`closed_rows`); private counts updated (header, §9.2, §9.3 rules 8 and 12) |
| 2 [SPEC-2] | The golden compared the sheet's net cash with the dashboard's positive-balance cash class, and the sheet's reported super gain with the app's provisional gain | **Applied:** net cash is compared with the composed `N`; the super gain is `defined_by_decision` (D69); private counts re-derived (§9.3 rule 10) |
| 3 [SPEC-3] | Month-end auto-record could record the current month while an earlier month (from before auto-record was on) was missing, silently making it a permanent gap | **Applied; decided by the owner as proposed (D94)** (option: wait): `recordingsDue` returns a plan with `blocked`; nothing is due while such a month is missing; the recorder logs one `partial` run (`earlier_month_missing`), the status carries `blocked`, and the History and Net Worth callouts ask the owner to record or skip it; tests in engine and recorder (§2.2, §2.9, §4.4, §4.6, §6.3, §6.4, §7.3, §7.5, §11 fix 11, §12) |
| 4 [SPEC-4] | Yearly groups followed the run date while months and quarters followed the period, so a June recorded on 1 July moved into the next FY and stopped being the FY base | **Applied:** one period rule (D29): `groupOf`'s yearly unit, the Stage 3 year KPIs and the "This FY" base use the period month's end; run dates still bound windows; tests with a June recorded on 1 July; Stage 2–4 goldens unchanged (imported period months equal their run months) (§1.2, §2.2, §2.3, §2.6, §2.7, §7.1, §7.3, §11 fix 20) |
| 5 [SPEC-5] | Some compared cells had no engine output (total gains), the cash gain % conflicted with a fix, and the pre-fold distribution was not observable | **Applied (drop, not add):** no total gain is computed (the sheet's includes figures the app does not have), so those four cells are not compared (`fixed_definition`); the cash gain % is `fixed_definition`; `distribution.values` exposes every class before the fold (also the donut's table view) (§2.2, §2.6, §4.4, §9.2, §9.3 rule 7) |
| 6 [SPEC-6] | The bracket lookup missed incomes with cents just above a threshold, the tax sum lacked a floor for higher bands, and LITO was silently left out | **Applied in part:** bands by `threshold < income ≤ next` in cents, tax Σ rate × max(0, …); LITO is not added to the suggestion (still not built) but `litoPhaseOut` makes the hint say so in its range; the LITO range verified from search summaries (header, §1.5, §2.2, §2.10, §3.2, §6.5, §7.3) |
| 7 [SPEC-7] | With a month recorded today, "since last record" compared the snapshot with itself | **Applied:** the base is the latest snapshot with a run date before the as-of; `recordedToday` in the response; fixture and tests (§2.2, §2.6, §3.6, §4.4, §4.5, §9.4) |
| 8 [SPEC-8] | The super carry could count SG twice if a stored measured-through date went backwards | **Applied:** effective dates are clamped non-decreasing and ≤ the run date; a test (§2.11, §7.3) |
| 9 [SPEC-9] | A correction could set or clear an offset figure and move the savings seam silently | **Applied:** the offset extras are refused on imported months and cannot be null on recorded ones; the seam is the latest imported month by source (§3.2, §4.3, §4.5, §7.4) |
| 10 [SPEC-10] | The setting groups held 60 of 61 keys | **Applied:** the server-written cap FY is listed in the Super group (not editable); the count is stated (§3.3, §7.2) |
| 11 [SPEC-11] | An offset linked to a loan without a property counted differently in the dashboard and in net worth, breaking the identity | **Applied** (with item 40): every figure comes from the snapshot; the offsets class is total offsets less the linked offsets applied to the mortgages; the uncapped linked sum is named (§2.6) |
| 12 [SPEC-12] | "A recorded month equals the preview" holds only when prices do not move, yet a record refreshes prices | **Applied:** the claim and the tests are scoped to market off or no price change; the demo copy runs with market data off; the preview says the figures can differ slightly (§2.4, §6.4, §9.4, §10) |
| 13 [SPEC-13] | Two fix descriptions misstated the sheet (offsets and the quarterly cash change) | **Applied:** both reworded (§11 fixes 1 and 4) |
| 14 [UX-1] | The donut coloured slices by position, and the slot plan put a known colour-blind-unsafe pair next to each other whenever one class was empty | **Applied:** a fixed class-to-slot map found by searching every assignment with the validator's maths (every adjacent and one-empty pair ≥ 10.4 CVD ΔE, ≥ 16.8 normal), one stack order for every chart and the donut, `Datum.color` as a web-owned ui addition, legends in stack order, web tests re-running the maths (§3.2, §5, §6.1, §7.7) |
| 15 [UX-2] | The chart's "liabilities" and the table's disagreed by the whole mortgage, and cash was defined three ways | **Applied:** the charts use one cash (net cash plus unlinked offsets, continuous with imported months) and an "Other debts" series only for History U; the stacked total is labelled "Net worth"; captions explain the netting; the table keeps the debit split (§5, §6.3, §11 fix 2) |
| 16 [UX-3] | Before the cutover the dashboard would nag every month to record, the one action that blocks re-import | **Applied:** a Note with the D84 context while there is no app data, Important after; `hasAppData` and `recordable` in the response (§4.4, §6.3) |
| 17 [UX-4] | Every view-switch click unmounted the dashboard behind a loading line | **Applied:** `keepPreviousData`, dimmed charts, mounted controls, a live-region announcement and a test (§6.2, §6.3) |
| 18 [UX-5] | The correction form asked for owed amounts in the stored negative sign and allowed offset extras on imported months | **Applied:** owed figures entered and shown positive, negated on send; the extras read-only on imported months (with item 9) (§6.1, §6.4) |
| 19 [UX-6] | Nothing told the owner that recording freezes a month and that Correct does not recalculate | **Applied:** a lead paragraph, a line in the record form and one in the correct form (§6.4) |
| 20 [UX-7] | The consistency headline counted expected movement differences as failures, and "Correct the month" could not fix a derived difference | **Applied in part:** the headline counts derived figures only, movements are information; a derived difference says "report it" (no recalculate action: never expected, and any correction re-derives anyway); new consistency fields (§2.5, §4.4, §6.4) |
| 21 [UX-8] | A page form linked to one Settings group while its keys spanned two, and the tax suggestion was invisible from the Super page | **Applied:** links derived from the groups of the form's keys; the next-buy footer links per missing key; a suggestion line on the Super page (§6.5, §6.7) |
| 22 [UX-9] | The same setting had different labels on a page and in Settings | **Applied:** the registry labels take the pages' words (feature switches "Show the X page"); the pages' label maps go; tests (§3.2, §6.5, §7.1) |
| 23 [UX-10] | The hero tiles would make the band taller than 200 px | **Applied:** the compact band, one line under each figure, no literal arrows, an e2e height check (§6.3, §6.8, §7.8) |
| 24 [UX-11] | Four cards were half width in the 768–1199 px range, forcing inner scroll | **Applied:** full tablet width for the two tables and the two trend charts; e2e at 1024 px (§6.3, §6.8) |
| 25 [UX-12] | Times were 12-hour, formatted in the browser's zone, and the record hour was hard-coded | **Applied:** 24-hour times in the server's offset with "(server time)" when it differs; texts from `recordHour` (§6.1, §6.4, §6.5) |
| 26 [UX-13] | A two-step pending text had no signal, "Record them now" could skip the form, and the values warning missed single late months | **Applied:** one pending text; the button opens the form; the values line for any ended month (§4.6, §6.4) |
| 27 [UX-14] | The tax suggestion's wording was wrong for the shade-in and no-levy bands | **Applied:** wording and buttons per band, fixtures and tests for each (§3.6, §6.5) |
| 28 [UX-15] | The current period had two names, "Recorded late" looked pending, "Projected" was a status, and a second marker registry was planned | **Applied:** "Live (provisional)" then "Live", "Recorded late" as a recorded badge, "Projected" a pill, the Stage 4 registry reused (§6.1, §6.3, §6.4) |
| 29 [UX-16] | Chart titles were fixed to months, the live caption could show with no live group, and the dashed trend and total label were not supported | **Applied:** titles and first column from the unit, the caption only with a live group, a dashed legend key and a `totalLabel` prop (§5, §6.1, §6.3) |
| 30 [UX-17] | Several user-facing "Stage 5" texts were missed by the listed phrasings | **Applied:** all six places listed with their new text; a web test that no page shows "Stage 5" (§6.7, §7.7) |
| 31 [UX-18] | Hash links landed at the top, the phone jump select changed context, the month checkboxes had no group label, and inline row details had no component | **Applied:** scroll and focus after load, a `<details>` jump list, a fieldset, detail cards after the table with focus handling (§6.1, §6.4, §6.5) |
| 32 [UX-19] | The donut's centre said "Net worth" even when its slices summed to something else | **Applied:** "Assets shown" with the drawn total and a foot note when anything is left out; `drawnCents` (§2.2, §4.4, §5) |
| 33 [UX-20] | Chart and page switches are workbook keys, so toggling them before the cutover would block a re-import | **Applied; decided by the owner as proposed (D95)** (option: preference keys): they never count as app data and a re-import keeps the app value, with an importer info line; the fallback wording was removed once decided (§3.3, §3.4, §3.5, §4.4, §4.5, §6.5, §7.4, §7.6) |
| 34 [UX-21] | The rolling table defaulted to oldest first, unlike every other history table | **Applied:** newest first with the projection above, an "Oldest first (as the sheet)" toggle remembered per browser (§4.4, §6.3, §6.8) |
| 35 [FEAS-1] | Holding the process-wide import lock through the price wait made every other page's saves fail with a misleading import message, and contradicted the correction flow | **Applied:** the recorder never takes the import lock; it checks it before and, synchronously, after the price wait; the history PUT/DELETE check it before the mutex (§4.2, §4.6, §7.5, §12) |
| 36 [FEAS-2] | A shutdown during the price wait could exceed the forced-exit timeout | **Applied:** the recorder aborts its own wait on stop; an aborted attempt writes nothing (a scheduled one is caught up at the next start, a manual one gets 503); a fake-clock test (§4.6, §7.5, §12) |
| 37 [FEAS-3] | The recorder had two time sources and the server golden could not inject a clock | **Applied:** `now` for every date decision, `clock` for timers; `BuildAppOptions.recorderClock`; a test under an injected `now` (§4.6, §7.1, §7.2, §9.4) |
| 38 [FEAS-4] | The new snapshot columns break the importer's upgrade-equivalence helper, and the planned 0004 import cannot be written | **Applied:** the helper strips the new columns (a Scaffolder fix to importer tests); the equivalence test follows the Stage 4 rebuild pattern (§1.2, §3.5, §7.1) |
| 39 [FEAS-5] | The Stage 0 hero e2e, the status route test and the settings mutation module had no owner | **Applied:** the brand spec to the Integrator (moved onto the real dashboard), the other two to server-api (§1.2, §7.1, §7.8) |
| 40 [FEAS-6] | Two existing server tests break on the identity trigger and the new editable-key count | **Applied:** both named as Scaffolder fixes handed to server-api, which also defines the named-keys slice rule (§4.5, §7.1) |
| 41 [FEAS-7] | Frozen contracts named a non-existent DTO, would redeclare an existing one, used private helpers and left four types undefined | **Applied:** the existing DTOs reused, the helpers moved to a shared module, the four types defined (§3.2, §4.4, §4.6) |
| 42 [FEAS-8] | The cap FY was in no group, one bound had no mechanism, and four ratios had no write bounds | **Applied** (with item 10): write-only bounds in a new table, so imports and D87 are unaffected (§3.3, §7.2) |
| 43 [FEAS-9] | The dashboard's identity mixed snapshot figures with current loans and had no row for History U | **Applied** (with item 11): every figure from the snapshot, an `other_debts` liability, the identity a test invariant (§2.2, §2.6, §3.2, §7.3) |
| 44 [FEAS-10] | The recorder bypassed the market service's refresh and forced a second refresh at start-up | **Applied:** `market.refresh`, market-off handled by its error, a 5-minute freshness reuse (§4.6, §7.5) |
| 45 [PRIV-1] | The guard terms missed most per-column History values and the group sums Stage 5 is first to print | **Applied:** the private companion's term block gains every History money cell of the imported rows in all printed forms, the quarterly, FY and calendar-year sums of the flow columns and growths, the owner-derived tax component and the small liability's 2-dp form; false positives checked; the combined guard passes |
| 46 [PRIV-2] | Several public examples mirrored the owner's timeline and portfolio shape | **Applied:** neutral months and dates in every example, a neutral fold example and label (header, §4.1, §6.3–§6.6, §6.9, §7.9, §9.3) |

### Owner answers (2026-09-27)

The owner answered the plan-review questions; the plan amender applied them (scratch under `artifacts/stage5/plan-amender/`: the eight-slice donut palette check and the §8.2 guard-term generator). Every provisional mark in the plan now names its decision.

| Decision | Answer | What changed |
|---|---|---|
| D89 | Auto-record runs at **23:00** server-local on the month's last day (not 18:00) | `SNAPSHOT_RECORD_HOUR` = 23; every time example and the Settings switch text read 23:00; the recorder re-derives the months and source after the price wait (an attempt crossing midnight is `late`), joins the hourly price job at 23:00, and its tests use 22:59/23:00, the 23:00–23:45 retries and a midnight crossing (§3.2, §4.6, §6.1, §6.4, §6.5, §7.2, §7.3, §7.5, §10 #9, §12) |
| D90 | The suggested rate is the bracket plus the 2 % Medicare levy; the bracket alone is offered too | The provisional default stands; the D90 reference and a neutral example added (§2.2, §2.10, §4.4, §6.5, §7.7, §11 fix 14) |
| D91 | The six workbook settings the app does not use are **editable** in their own group with the workbook callout | `EDITABLE_SETTING_KEYS` 54 → **60** of 61 (only the server-written cap FY is not editable); `SETTINGS_PATCH_MAX_KEYS` 64 unchanged; the registry bounds cover them (no new write-only bound); schema, server, importer and web tests; the Settings group is an editable form with "Not used by the app" (§1.1, §3.3, §3.4, §3.6, §4.4, §6.5, §7.2, §7.4, §7.6, §7.7, §10 demo, §12) |
| D92 | Only the latest app-recorded month can be deleted (audited); imported months never | The provisional rule stands; D92 referenced (§3.4, §4.1, §4.5, §6.4, §11 fix 10) |
| D93 | The asset-distribution donut shows **every class** (up to eight slices, no "Other classes" fold) | `folded`, `'other_classes'` and `DISTRIBUTION_MAX_SLICES` removed; a web-owned `DonutChart maxSegments` prop (the donut passes 8); negative slices are still excluded (§11 fix 3); the slot map re-verified on the ring (every adjacent pair incl. the wrap ≥ 10.4 CVD / 24.3 normal; two one-empty near misses, which no arrangement of the eight slots avoids, so the map is kept); fixture, engine and web tests (§1.2, §2.2, §2.6, §3.2, §3.6, §4.4, §5, §6.1, §6.3, §7.1, §7.3, §7.7, §9.3, §11) |
| D94 | Auto-record waits and asks when an earlier month is missing | The provisional default stands; marked decided (§2.2, §2.9, §4.4, §4.6, §6.3, §7.5, §11 fix 11, §12) |
| D95 | The chart view and page switches are preference keys | The provisional default stands; marked decided and the fallback wording removed (§1.2, §3.3, §3.4, §3.5, §4.4, §4.5, §6.5, §7.4, §7.6) |
