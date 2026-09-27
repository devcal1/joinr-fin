# Stage 6 — FIRE planner & polish: build plan

_Planner output, 2026-09-27. Inputs: PLAN.md (Architecture, Stage 6, Stage 7 for deferrals), docs/HANDOFF.md (the state at the end of Stage 5, the Stage 6 next step and the deferred items), docs/STAGE_PROCESS.md, docs/DECISIONS.md (D97–D104 are the Stage 6 kickoff answers; D5, D34, D51, D52, D59, D61, D68, D69–D71, D75, D79, D85, D86, D95 and the rest still bind), docs/stages/stage-5.md in full (structure, frozen-contract style, file ownership, agent flow, goldens, close notes and their "Deferred" list, the plan review log), the Stage 3 and Stage 4 close notes (STYLE-5, 6, 7, 11, 13, 15, CODE-9, the chunk-size warning, the guard-separator gap), spec 04 §5 (FIRE: the behavioural source of truth) with specs 01–02 where FIRE reads Net Worth, Cash and the savings engine, docs/style/STYLE_GUIDE.md (§6, §7.2 node-line motif, §8 formats), the Stage 0–5 code (engine `savings.ts`, `kpis.ts`, `super.ts`, `netWorth.ts`, `snapshot.ts`; schema `settings.ts`; the server's finance context, settings page and import paths; the web router, query states and the ui chart wrappers), and the local workbook (read with the workspace's SheetJS through `@joinr/importer`'s reader in scratch scripts under `artifacts/stage6/planner/`)._

> **This repo is PUBLIC.** Nothing from `reference/` (except `reference/brand/`) or `docs/private/` may be copied into any other file: no amounts, balances, net worth or pre-super figures, spend, savings, super contributions, growth or real rates, FIRE years or ages, birth years, salaries, no holdings, funds, lenders, accounts, properties or notes the owner has, no addresses, IPs, emails, Drive ids. Code, tests, seeds, fixtures and committed docs use only generic values ("Example Super Fund", round numbers such as the hand-worked example in §10.1). The owner-specific facts for this stage are in **`docs/private/stage-6-private.md`** (git-ignored): the engine and server-api implementers, the spec reviewer, the code reviewer and the Verifier read it; nobody copies from it.
>
> **Golden tests never contain owner values:** they read every expected value from the local workbook at runtime and skip when it is absent (§9). **No snapshot files** (`toMatchSnapshot` & co.). The guard also blocks any committed path with a folder segment named `data`.

**Flow:** Coordinator pre-step (guard terms incl. rounded forms, a `data/` backup, §7.0) → **Scaffolder** (alone; must pass its done-check, §7.2) → 6 implementers in parallel (**engine** (the FIRE engine and its goldens), **server-api** (`/api/fire`, the D98 one-off, the preference keys), **web-fire** (the FIRE page, the what-if panel, the progression chart and its ui additions), **web-polish-ui** (the `packages/ui` core and chart fixes and the styleguide gallery), **web-polish-pages** (the polish pass on every other page, the router and route-level code splitting), **tooling** (the privacy-guard hardening, e2e retries, the cross-page audit e2e drafts, CODE-9)) → **Integrator** (phase B + e2e; starts when engine, server-api and tooling have reported done, §7.8) → Reviewers in parallel (**spec-correctness**, **style-ux**, **code-quality/security**) → per-reviewer triage → **Fixer** → **Verifier**. At most 10 agents per workflow: the build workflow has 8 (Scaffolder, 6 implementers, Integrator), the review workflow 6 (3 reviewers, triage, Fixer, Verifier). **Nobody commits or pushes.** The coordinator commits at stage close with the owner's OK (D10).

**Golden values:** template cell references only (§9); the values are read from the workbook at runtime. The FIRE tab's cached outputs **can be meaningless on real data** (spec 04 §5.6: on a workbook whose derived spend is negative every output inverts; the owner's case is in the private §3), so the goldens check the app's **sheet mode** (`fireSheet`, the template's formulas reproduced exactly from the workbook's own cached inputs) against every cached output cell, and the app's **raw input path** (`deriveFireInputs` raw figures) against `E47`/`E48` recomputed over closed rows; the corrected model is proven by unit tests and the hand-worked example (§10.1). **Template bug fixes applied in Stage 6:** §11 (vetoable at the plan review or the demo).

**Verified by the Planner against the workbook and the code (2026-09-27, scratch scripts):**
- **The FIRE tab's formulas reproduce exactly.** A re-implementation of the tab (Sheets `PV`/`FV`/`PMT`/`IPMT`/`PPMT`/`NPER` with type 0, `ROUNDUP` away from zero, `IFERROR` → `"-"`, text sorting above numbers, the grid's row rules) fed only the cached inputs `E6`–`E10`, `E45`–`E49`, `SheetOptions!L6` (the salary `E64` uses) and TODAY = `Net Worth!E52` reproduces **every** populated output cell (the count: private §1): `D2`, `V3`, `E52`–`E57`, `E60`–`E64`, `C15:E16` and the grid `G4:X…` (one row per year from the as-of year to access + 1); the row-4 cells `I4:K4` and `O4` have no formula in the template (`no_formula`). Details: the private §1–§2.
- **The inputs recompute from their sources:** `E45` = `Net Worth!D16 + E23 + Σ Property!row19` where row 17 = "No"; `E49` = the sheet's cash/ETF/stock/MF blend of `Net Worth!C4:C8` with `SheetOptions!L13`/`L27`; `E47`/`E48` = the averages of `Cash!N`/`Cash!P` over the rows dated after `C51 − 365`/`C51 − 366` × 12 — **the window includes the live History row** (as Stage 5 found for `I1`). Over the closed rows only, with the baseline row excluded, `E48` equals the app's raw adjusted-spend mean × 12 and `E47` the Stage 3 `avgSavingsRawCents × 12` on the owner database (within cents).
- **The app has every input it needs:** net worth and its classes (`netWorthDashboard`), the primary residence flag and values (`PropertiesResult.properties[].isPrimaryResidence`), the savings periods with their income, adjusted savings, spend and the voluntary-super part (`SavingsPeriod.added.superCents`, the D71 take-home cost), the 12-month averaging window (`CashKpisResult.avgWindow`), and the super engine's SG months (`SuperResult.sgMonths[].fundReceivesCents`) and member contributions (`contributions[].fundReceivesCents`, after contributions tax). `fire.*` settings exist (six workbook keys, `FIRE_TAB_PREFIX` cells `E6`–`E10`, `E48`), are editable since Stage 5 and sit in the Settings group `fire`; `features.fire` already hides the page; `/fire` is the last placeholder route.
- **The workbook's `E7` ("Total Yearly Super Contribution") is a typed figure**, so under D99's "the setting overrides when set" an import would always override the derived figure; the plan treats an import-origin value as a reference only (§3.3, owner question 1).
- **The synthetic workbook** (e2e, server tests) has access age 60 and the FIRE page switched off (`features.fire` false): the D98 one-off does not fire on it, and the e2e opens `/fire` directly (the page renders with the "switched off" note, Stage 5 §3.3).
- **The web bundle is one 1.69 MB chunk** (`pnpm build`'s chunk-size warning); Vite 8.3 (Rolldown 1.2) supports `build.rolldownOptions.output.codeSplitting.groups`, and TanStack Router `lazyRouteComponent`.

Details, including the owner's figures and what the corrected engine gives on them, are in `docs/private/stage-6-private.md` §0–§5.

---

## 1. Overview & flow

### 1.1 What Stage 6 delivers
1. **`@joinr/engine`** (pure TypeScript, §2), additions:
   - **`deriveFireInputs`:** the FIRE inputs from the Stage 3–5 results: pre-super net worth (D68) and the debts inside it (held fixed in dollars, §2.5), the yearly spend from the corrected savings engine (D97: negative months count as $0), the pre-super savings a year (capped at income in those months, voluntary super excluded), the super contribution a year from the super engine (D99), the growth weights (D102), and the sheet-faithful raw figures beside them.
   - **`projectFire`:** the corrected FIRE model (§2.5): exact real rate, the bridge to access age, the super at access sized by the withdrawal rate, super top-ups from the FIRE pot, the FIRE year (before or after access), the year-by-year grid in today's dollars, the needed-vs-projected helper, KPIs, milestones and status states.
   - **`fireSheet`:** the template's formulas exactly (sheet mode, §2.6), for the goldens and comparison.
2. **Schema** (§3): two new app-only FIRE keys (the what-if's market return and extra savings), every `fire.*` key a preference (D103), the access-age default 60 (D98), FIRE constants, the `GET /api/fire` query and DTOs, fixtures for every FIRE state.
3. **Server** (§4): `GET /api/fire` (saved settings, or a what-if query that saves nothing, D100), `POST /api/fire/use-workbook-contribution` (owner question 1), the finance context's `fireDerived()`, the **D98 one-off** (the imported 65 becomes 60 once, as a preference, so `data/` stays re-importable), the Settings notices.
4. **Web** (§6): the FIRE page (KPI tiles, the milestone line (node-line motif) and the progression chart with a needed-vs-projected view (D101), the what-if panel (D100), how it is worked out, year by year, every state), and **the polish pass** on every page (§6.9): loading skeletons, empty and error states, the phone-width audit, keyboard access, the number-format audit, STYLE-5, 6, 7, 11, 13, 15 and route-level code splitting (D104).
5. **Tooling** (§8.2): the privacy guard catches numbers written with `,` thousands separators or `_` digit separators; retries for the read-only e2e projects; a cross-page audit e2e; **CODE-9** (shared server date and sum helpers, §4.5).
6. **Golden tests** (§9): the sheet mode against every cached FIRE output cell, the raw input path against `E45`–`E49`, and a server golden (import → the D98 one-off → `GET /api/fire`).

### 1.2 Workspace changes (no new packages)
```
packages/schema/     settings.ts (2 keys, defaults, labels, groups, EDITABLE 62, PREFERENCE +8, write bounds),
                     + src/fire.ts (constants, enums), + src/dto/fire.ts (query, DTOs), dto/settings.ts (SettingDto.notice),
                     fixtures/fire.ts (+ coverage, index), testing/seed.ts (generic fire.* settings), schema tests
packages/engine/     + src/fire.ts (deriveFireInputs, projectFire), + src/fireSheet.ts (fireSheet); types.ts additions;
                     index.ts (+ FIRE_ENGINE_IMPLEMENTED); test/** (+ fire.test.ts, fireSheet.test.ts, fire.handworked.test.ts,
                     test/golden/fire.golden.test.ts + fireAdapter.ts + fireFormulas.ts + fireTally.ts)
packages/ui/         charts: LineChart `markers` (web-fire; `Series.dashed` exists since Stage 5); echarts.ts registers
                     MarkLineComponent (Scaffolder); brand: + MilestoneLine + milestone.css (web-fire); core: StatTile
                     `footer` slot (Scaffolder contract), + Skeleton, KeyValueTable (STYLE-6, 7), ColumnTable sticky header
                     (STYLE-11); charts: all-zero empty state, `compactAxisFormatter` (STYLE-5), ChartCard table width
                     (STYLE-11) (web-polish-ui)
apps/server/         + src/fire/{inputs,page,upgrade,workbook}.ts, + src/routes/fire.ts (server-api), + src/lib/{dates,sums}.ts
                     (CODE-9, tooling); edits: app.ts, cashflow/context.ts, settings/{page,readers}.ts, routes/import.ts,
                     cli/import.ts (server-api), and the CODE-9 call sites (assets/**, investments/**, market/**; tooling)
apps/web/            + src/pages/fire/** (+ fire.css); edits: router.tsx (lazy routes), api/hooks.ts, components/QueryStates.tsx
                     (PageSkeleton), every page folder (polish), vite.config.ts (codeSplitting), layout/**; PlaceholderPage removed
packages/importer/   + test/fire-preferences.test.ts (the D103 keep rule on fire.*; server-api)
tools/privacy-guard/ rules.ts, scan.ts (separator normalisation), tests
e2e/                 + fire.spec.ts, fire-states.spec.ts, fire-mutations.spec.ts, fire-support.ts, polish.spec.ts,
                     audit-support.ts; edits: ui-core.spec.ts (no placeholder route left), import.spec.ts (no retry on
                     its mutating test)
playwright.config.ts retries 2 on desktop and phone; + the `fire-mutations` project
```

### 1.3 Dependencies (no third-party additions)
No package changes anywhere: the FIRE maths uses `JoinrDecimal` (integer powers; no floats, no logarithms: the FIRE year is found by stepping years, §2.5); the lazy routes use TanStack Router's `lazyRouteComponent`; code splitting uses Vite 8's own options; skeletons are CSS. pnpm 11 rules unchanged: `allowBuilds` untouched, never `pnpm approve-builds`. **Only the Scaffolder may run `pnpm install`** (it should not need to). Implementers never edit a dependency list or the lockfile; stop and report instead.

### 1.4 Scripts
No new root scripts. Scoped commands used in this plan:
- `pnpm vitest run --project engine` and `--project engine test/golden`
- `pnpm vitest run --project server test/fire test/settings test/golden test/lib`
- `pnpm vitest run --project schema`
- `pnpm vitest run --project web src/pages/fire` and `--project web` (the polish suites)
- `pnpm vitest run --project ui`
- `pnpm vitest run --project privacy-guard` (the guard's own suite; the project name as in `vitest.config.ts`)

### 1.5 Not in Stage 6 (deferred; the UI says so where it matters)
- **Stage 7:** the fresh Drive export and import (the D98 one-off then runs on the new database, §3.4), switching auto-record on, `TZ`, backups, the Umbrel packaging.
- **Not built:** tax on super withdrawals, the Age Pension, transition-to-retirement, the transfer balance cap, contribution caps inside the projection (the Super page's cap meter stays the tool), a separate return for super, sequence-of-returns or Monte Carlo risk, named saved scenarios (D100: none), a per-year spend schedule (a paid-off mortgage, children), couples (the sheet's note "use the younger partner" stays a hint), the statutory preservation-age table for people born before 1 July 1964 (the hint says 60 applies from that date; the field stays editable), a "compare with the workbook" panel (the sheet mode is engine-only, §2.6), sparklines and P/E (D45).

---

## 2. Engine spec (`@joinr/engine`)

### 2.1 Conventions (all engine code; Stages 2–5 §2.1 still apply)
| Concern | Rule |
|---|---|
| Purity | No I/O, no clock, no randomness, no host time zone or locale. `asOf` is always an input. The Stage 3 ESLint rules and `test/purity.test.ts` cover `fire.ts` and `fireSheet.ts` unchanged. |
| Imports | `@joinr/schema` **root** only (enums, decimal helpers, the §3.2 FIRE constants). |
| Arithmetic | `JoinrDecimal` for money, rates and every power (`(1+r)^t` with integer `t` via `pow`); no logarithms (the model steps whole years). `fireSheet` also computes in `JoinrDecimal` and returns JS numbers (`toNumber()`), because it emulates a spreadsheet's doubles and is compared at 1e-9 relative. |
| Boundaries | Money in and out as integer cents; ratios as decimal strings with 12 significant digits; years and ages as integers. |
| Rounding | Compute in decimals, carry unrounded balances from year to year, round **once** at each output, half away from zero. A row's printed figures add up within 1 cent per column (an engine test). |
| Nulls and states | Missing inputs give `status 'needs_input'` with the list; a figure that cannot be computed is null. `RangeError` only for programmer errors (malformed decimals or dates). |
| Time | Years are whole and run from the as-of date: row `t` covers the year from the `t`-th anniversary of `asOf` and is **labelled** `YEAR(asOf) + t` (the calendar year that anniversary falls in; the template's `YEAR(TODAY())` rows); the age in row `t` = `YEAR(asOf) + t − birthYear` (the sheet's `E52` rule; only a birth year is known, so `n` and the age step on 1 January while no balance moves: accepted and tested). **D52 (FY by default) does not apply**: FIRE rows are anniversary years labelled by calendar year. Balances are at the **start** of each row's year; each year's savings, spend, contributions, top-ups and withdrawals are **end-of-year** flows (the sheet's type-0 annuities; the page says "Balances at each anniversary of today; the year's saving and spending are counted at its end"). |

### 2.2 Public API (FROZEN — additions to `packages/engine/src/types.ts` + `src/index.ts`)
The Scaffolder appends every type below to `types.ts`, adds a stub throwing `new Error('engine: not implemented')` for each new function to `index.ts`, adds the members to `EngineApi` and the `engine` value, and adds `FIRE_ENGINE_IMPLEMENTED = false` (the engine owner sets it `true` only after its full Stage 6 unit suite, goldens included, passes). It gates the server's FIRE integration, route and golden tests. The earlier flags stay `true`. Names, fields and signatures below do not change; internal modules are free.

```ts
import type { DecimalString, FireGrowthWeightKey, FireMilestoneKind, FireMissingInput, FirePhase, FireStatus,
  IsoDate, IsoMonth } from '@joinr/schema';

// ─── Derivation (§2.4) ──────────────────────────────────────────────────────────────────────────
export interface FireDeriveInput {
  asOf: IsoDate;
  figures: SnapshotFigures;                          // ctx.dashboardFigures() (the live position)
  classes: readonly NetWorthClassRow[];              // netWorthDashboard(...).classes (the growth weights)
  liabilities: readonly NetWorthLiabilityRow[];      // netWorthDashboard(...).liabilities (the debts, §2.4 step 1)
  property: PropertiesResult;                        // computeProperty(...) (primary residence, D68; its loans' gross balances)
  savings: readonly SavingsPeriod[];                 // computeSavings(...).periods
  kpis: CashKpisResult;                              // its avgWindow is the 12-month window (§2.4 step 2)
  superResult: SuperResult;                          // sgMonths and contributions (D99)
}
export interface FirePeriodRow {                     // one closed savings period in the window
  periodMonth: IsoMonth; runDate: IsoDate;
  incomeCents: Cents;                                // adjusted income (D61)
  spendCents: Cents;                                 // adjusted spend (income − adjusted savings; may be < 0)
  countedSpendCents: Cents;                          // max(0, spend) (D97)
  superNetPayCents: Cents;                           // added.superCents (voluntary super, take-home cost, D71)
  countedSavingsCents: Cents;                        // income − counted spend − superNetPay (may be < 0)
  floored: boolean;                                  // spend < 0 (counted as $0; savings capped at income)
}
export interface FireDerived {
  preSuper: {
    netWorthCents: Cents;                            // netWorthOf(figures).netWorthCents
    superCents: Cents;                               // netWorthOf(figures).superCents (History Q)
    primaryResidenceCents: Cents;                    // Σ primary residences' values (D68: excluded)
    primaryResidenceDebtCents: Cents;                // Σ their debt net of linked offsets (shown; kept in, §2.4 step 1)
    primaryResidenceLoanGrossCents: Cents;           // Σ the gross balances of the loans on a primary residence
    preSuperCents: Cents;                            // net worth − super − primary residence value (the sheet's E45 rule)
    debtCents: Cents;                                // L ≥ 0: Σ liabilities[].balanceCents (the debts inside preSuper)
    preSuperExHomeLoanCents: Cents;                  // preSuper + primaryResidenceLoanGross (the alternative, shown only)
  };
  window: { from: IsoDate; through: IsoDate; periods: number } | null;   // closed periods used (null: none);
                                                     // through = the last period's run date (shown; stale note §6.3)
  rows: FirePeriodRow[];                             // run-date order
  spend: { yearlyCents: Cents | null; flooredPeriods: number;
    rawYearlyCents: Cents | null };                  // D97 figure; raw = the sheet's E48 rule on the same periods
  savings: { yearlyCents: Cents | null; cappedPeriods: number; superExcludedCents: Cents;
    rawYearlyCents: Cents | null };                  // P (§2.4 step 3); raw = the sheet's E47 rule
  superContribution: { yearlyCents: Cents; sgCents: Cents; memberCents: Cents;
    fromMonth: IsoMonth; toMonth: IsoMonth;          // the 12 whole months before asOf's month
    sgSource: 'estimate' | 'statement' | 'mixed' | 'none'; contributions: number };   // D99
  growth: { weights: { key: FireGrowthWeightKey; valueCents: Cents; rate: 'cash' | 'market' }[];
    cashWeightCents: Cents; marketWeightCents: Cents };   // D102 (§2.4 step 5)
}

// ─── Projection (§2.5) ──────────────────────────────────────────────────────────────────────────
export interface FireProjectionInput {
  asOf: IsoDate;
  birthYear: number | null;
  accessAge: number | null;                          // fire.preservationAge (D98) or the what-if
  inflationRatio: DecimalString | null;
  withdrawalRatio: DecimalString | null;
  preSuperCents: Cents;                              // A0 (net: assets − debts)
  preSuperDebtCents: Cents;                          // L ≥ 0, the debts inside A0 (held fixed in dollars, §2.5 step 3)
  superCents: Cents;                                 // B0
  savingsPerYearCents: Cents | null;                 // P (derived; null → 0 with a flag)
  extraSavingsPerYearCents: Cents;                   // X (signed; P + X is floored at 0)
  superContributionPerYearCents: Cents;              // C (derived, or the setting / what-if)
  yearlySpendCents: Cents | null;                    // S (derived, or the setting / what-if)
  growth: { cashWeightCents: Cents; marketWeightCents: Cents;
    cashInterestRatio: DecimalString | null; marketReturnRatio: DecimalString | null };
  horizonAge?: number;                               // default FIRE_HORIZON_AGE (100)
}
export interface FireRow {
  t: number; year: number; age: number; phase: FirePhase;
  preSuper: { startCents: Cents; growthCents: Cents; savedCents: Cents; spentCents: Cents; topUpCents: Cents; endCents: Cents };
  super: { startCents: Cents; growthCents: Cents; contributedCents: Cents; topUpCents: Cents; withdrawnCents: Cents; endCents: Cents };
  helper: { neededCents: Cents; projectedCents: Cents; gapCents: Cents } | null;   // V, W, X fixed (§2.5 step 3); null without spend
}   // preSuper.growthCents includes the debts' fall in today's dollars (§2.5 step 6); preSuper.spentCents after access is
    // the part of S drawn from pre-super once super is exhausted
export interface FireMilestone { kind: FireMilestoneKind; t: number; year: number; age: number }
export interface FireProjection {
  status: FireStatus;                                // 'needs_input' | 'spend_needed' | 'fire' | 'on_track' | 'not_reachable'
  missing: FireMissingInput[];                       // needs_input only
  ageNow: number | null;
  accessYear: number | null; yearsToAccess: number | null;   // n = accessAge − ageNow (≤ 0: access age reached)
  rates: { nominalRatio: DecimalString; inflationRatio: DecimalString; realRatio: DecimalString;
    simpleRealRatio: DecimalString } | null;         // D102: real = (1+g)/(1+i) − 1; simple = g − i (shown for comparison)
  savingsPerYearCents: Cents;                        // max(0, P + X) as used
  noSavingsHistory: boolean;                         // P was null (no closed period)
  target: { superAtAccessCents: Cents;               // S ÷ withdrawal rate (E60 fixed)
    superAtFireStartCents: Cents | null } | null;    // the self-sustaining super at FIRE start (E62 fixed)
  fire: { yearsToGo: number; year: number; age: number; afterAccess: boolean; bridgeYears: number } | null;
  topUps: { years: number; perYearCents: Cents; lastCents: Cents; totalCents: Cents; level: boolean;
    endYear: number } | null;                        // null: no top-up needed
  preSuper: { currentCents: Cents; neededAtFireCents: Cents | null; projectedAtFireCents: Cents | null;
    progressRatio: DecimalString | null };           // current ÷ needed, clamped 0–1
  super: { currentCents: Cents; neededAtAccessCents: Cents | null; projectedAtAccessCents: Cents | null;
    neededAtFireCents: Cents | null; progressRatio: DecimalString | null };   // current ÷ needed at access, clamped
  milestones: FireMilestone[];                       // in time order; kinds absent when not applicable
  rows: FireRow[];
}

// ─── Sheet mode (§2.6) ──────────────────────────────────────────────────────────────────────────
export type FireSheetValue = number | string;        // '' = blank, '-' = the IFERROR text, other texts verbatim
export interface FireSheetInput {
  today: IsoDate;                                    // TODAY() (Net Worth!E52 in the goldens)
  birthYear: number; superContributionPerYear: number; inflation: number; withdrawalRate: number;
  accessAge: number;                                 // E6, E7 (dollars), E8, E9, E10
  preSuper: number; superBalance: number;            // E45, E46 (dollars)
  savings: number | string;                          // E47 (or its "Neg. Savings Rate" text)
  spend: number; growth: number;                     // E48 (dollars), E49
  salary: number | null;                             // SheetOptions!L6 (E64's PMT; the D99 bug)
  disclaimerAccepted: boolean;                       // SheetOptions!B49 = "Yes"
}
export type FireSheetCell = 'D2' | 'V3' | 'E52' | 'E53' | 'E54' | 'E55' | 'E56' | 'E57' | 'E60' | 'E61' | 'E62'
  | 'E63' | 'E64' | 'C15' | 'D15' | 'E15' | 'C16' | 'D16' | 'E16';
export type FireSheetColumn = 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M' | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S' | 'T'
  | 'V' | 'W' | 'X';
export interface FireSheetResult {
  cells: Record<FireSheetCell, FireSheetValue>;      // E57 and G as calendar years (numbers)
  rows: Record<FireSheetColumn, FireSheetValue>[];   // row 4 first, one per grid year
}

// ─── Functions (FROZEN signatures) ─────────────────────────────────────────────────────────────
export function deriveFireInputs(input: FireDeriveInput): FireDerived;
export function projectFire(input: FireProjectionInput): FireProjection;
export function fireSheet(input: FireSheetInput): FireSheetResult;
export const FIRE_ENGINE_IMPLEMENTED: boolean;       // Scaffolder: false; engine sets true (§7.3)
// EngineApi gains deriveFireInputs, projectFire, fireSheet (3; *Fn aliases as Stages 2–5); so does `engine`.
```

### 2.3 Sheet formula → app definition (spec 04 §5.3)
Notation: `g` nominal growth, `i` inflation, `r` real rate, `S` yearly spend, `P` pre-super savings a year, `X` extra savings (what-if or setting), `C` super contribution a year, `A0` pre-super net worth, `B0` super, `wr` withdrawal rate, `n` years to access, `k` the FIRE year index, `q(t) = (1+r)^t`, `s(t) = (q(t) − 1)/r` (future value of t end-of-year payments of 1; `t` when r = 0), `a(t) = (1 − q(−t))/r` (present value of t end-of-year payments of 1; `t` when r = 0; 0 for t ≤ 0).

| Sheet | Template definition | App definition | Where | Fix |
|---|---|---|---|---|
| `E6`, `E8`, `E9` | inputs | `fire.birthYear`, `fire.inflationRate`, `fire.withdrawalRate` (what-if overrides the last two) | §3.3 | — |
| `E10` | input (65 imported) | `fire.preservationAge`, default **60**; the imported 65 replaced once (D98) | §3.4 | 9 |
| `E7` | input: super contribution a year | **derived** from the super engine: SG + member contributions as the fund receives them, 12 whole months (D99); the setting (app-set) overrides | §2.4 step 4 | 10, 21 |
| `E45` | `D16 + E23 + Σ investment property` (home value out, home loan in) | `A0 = net worth − super − primary residence value` (same rule, with offsets and every class); its debts `L` are split out and held fixed in dollars (owner question 2) | §2.4 step 1 | 12, 22 |
| `E46` | `Net Worth!C10` | History `Q` of the live figures | §2.4 step 1 | — |
| `E47` | `MAX(avg Cash!N (live row incl.) × 12, 0)`, or the text "Neg. Savings Rate" | `P` = mean over the closed periods of (income − counted spend − voluntary super) × 12, floored at 0 | §2.4 step 3 | 7, 11, 18 |
| `E48` | `avg Cash!P × 12` (live row incl.; negative months included) | `S` = mean of max(0, adjusted spend) × 12 (D97); the setting (or what-if) wins | §2.4 step 2 | 6, 18 |
| `E49` | cash at `L13` and ETFs + stocks + MF at `L27`, weighted by value | every counted asset: cash and unlinked offsets at the cash rate; ETFs, stocks, MF, crypto, other assets, investment property and super at the market return (D102) | §2.4 step 5 | 8 |
| `r` | `E49 − E8` | `(1+g)/(1+i) − 1` | §2.5 step 1 | 4 |
| `E52` | `E10 − (YEAR(TODAY()) − E6)` | `n = accessAge − (YEAR(asOf) − birthYear)` | §2.5 step 1 | — |
| `V` | `PV(r, n−h, −S)·(1+r) − S` (the pot for n−h−1 years) | `needed(t) = S·a(n−t) + shortfall(t)/q(n−t)` for `t < n` (the bridge plus the super shortfall at access); `target − B(t)` (signed) for `t ≥ n`; the helper line shows `max(0, needed)` | §2.5 step 3 | 5, 13 |
| `W` | `FV(r, h, −E47, −E45)` (the net figure compounds at `r`, debts included) | `projected(t) = (A0 + L)·q(t) − L·(1+i)^−t + max(0, P+X)·s(t)` (assets grow at `r`; debts stay fixed in dollars) | §2.5 step 3 | 22 |
| `X` | `V − W` | `gap(t) = needed(t) − projected(t)` | §2.5 step 3 | — |
| `V3` | `E52 − COUNTIF(X > S)` (bridge years) | bridge years = `max(0, n − k)` with `k` the first year `gap ≤ 0` | §2.5 step 4 | 5 |
| `E53`, `E54` | `PV(r, V3, −S)` / `PV(r, E52, −S)` | `neededAtFire = needed(k)`; `needed(0)` is shown as "needed to stop today" | §2.5 step 5 | 5 |
| `E55`, `C15:E15` | `E53 − E45` or "You're FIRE"; progress `C/(D+C)` | pre-super KPI: current, needed at FIRE start, progress = current ÷ needed clamped 0–100 % | §2.5 step 7 | 19 |
| `E56`, `E57` | `ROUNDUP(NPER(r, E47, E45, −E53))`, `DATE(YEAR+E56,1,1)` | `k` (whole years, stepped), FIRE year = `YEAR(asOf) + k` | §2.5 step 4 | 5 |
| `E60` | `S / E9` | `target = S ÷ wr` (super needed at access, today's dollars) | §2.5 step 2 | — |
| `E61` | `FV(r, E56, −E7, −E46)` or "You're FIRE" when `E46 > E60` | `B(k) = B0·q(k) + C·s(k)` (super at FIRE start) | §2.5 step 3 | 14 |
| `E62` | `PV(r, E52 − E56 − 2, 0, −E60)` | `target ÷ q(max(0, n−k))` (self-sustaining super at FIRE start) | §2.5 step 7 | 3 |
| `E63` | `E62 − E61` or 0 (both at FIRE start) | the super shortfall valued at FIRE start, `shortfall(k) ÷ q(bridge(k))` (`shortfall(k)` itself is valued at access) | §2.5 step 3 | — |
| `E64` | `ROUNDUP(NPER(r, salary, E61, −E62))` | top-up years `m` of `C` a year from FIRE start (last partial), or a level top-up over the bridge | §2.5 step 6 | 1 |
| `D2` | "N Years to go" = `E56 + E64`, "You're FIRE" when `E46 > E60`, "Accept Sheet Disclaimer" | status + "N years to go · FIRE in YYYY"; FIRE only when the whole plan is funded now | §2.5 step 8 | 13, 14, 15 |
| `I:K` | `PMT/IPMT/PPMT` to hit E53 in E56 years | accumulation rows: `end = start·(1+r) + P + X` | §2.5 step 6 | 17 |
| `L:M` | drawdown, `M4` at nominal `E49` | drawdown rows at `r` everywhere | §2.5 step 6 | 2 |
| `P:R`, `S`, `T` | top-ups (PMT/IPMT/PPMT with E64), growth only, super balance | top-up, drawdown and access rows; super `end = start·(1+r) + contributions + top-up − withdrawals` | §2.5 step 6 | 1, 17 |
| grid span | current year to the access year + 1 | to `max(n, k) + 1`, capped at the horizon age; FIRE after access is shown | §2.5 step 6 | 16 |

### 2.4 Derivation (`deriveFireInputs`)
1. **Pre-super net worth (D68, the sheet's `E45` rule).** `b = netWorthOf(figures)`; `primary` = the properties with `isPrimaryResidence`; `primaryResidenceCents = Σ primary.valueCents`; `primaryResidenceDebtCents = Σ primary.debtCents` (net of linked offsets, D67); `primaryResidenceLoanGrossCents = Σ property.loans[].balanceCents` over the loans whose `propertyId` is a primary residence; `preSuperCents = b.netWorthCents − b.superCents − primaryResidenceCents`. **The home's value is left out and its loan stays in** (the template's rule, noted as intentional in the sheet): the savings engine counts mortgage principal as savings (D51), so repaying the loan moves money into this figure and the model needs the loan cleared from the FIRE pot. **The debts are split out** (owner question 2): `debtCents` (`L`) = `Σ liabilities[].balanceCents` (the mortgages net of linked offsets, accounts in debit, other debts: every liability of the dashboard, whose `assets − liabilities` is net worth, so `A0 + L` are the pre-super assets); §2.5 grows the assets and holds the debts fixed in dollars (their interest is in the spend, their principal repayments in the savings). The alternative (`preSuperExHomeLoanCents = preSuperCents + primaryResidenceLoanGrossCents`: the loan left out, the linked offset cash kept) is shown on the page for context only. Investment properties count at their value with their loans; accounts in debit and History `U` stay in (they are in net worth).
2. **The window.** The closed savings periods with `runDate ≥ kpis.avgWindow.from` (the Stage 3 12-month window: from `max(anchor − 365 days, job start)`, the anchor being the last recorded run date, so with auto-record off it can lag the as-of date; the baseline period has no figures and drops out), each with a non-null adjusted spend; `window = null` when none; `window.through` = the last period's run date (the page shows it and notes a stale window, §6.3). Only closed periods count (the sheet's averages include the live row; §11 fix 18).
3. **Spend and savings per period** (`rows`): `income` = adjusted income; `spend` = adjusted spend (`income − adjusted savings`, from the unrounded savings as `kpis.ts` does); `countedSpend = max(0, spend)` (**D97**); `superNetPay = added.superCents`; `countedSavings = income − countedSpend − superNetPay`; `floored = spend < 0`. In a floored month the savings are therefore capped at the income (the money beyond it came from elsewhere: a sale, a loan, a deposit; D51 adjustments remain the precise tool) and spend + savings = income in every month (owner question 4). **Yearly figures** are means of the **unrounded** per-period values (as `kpis.ts` does), rounded once: `spend.yearlyCents = mean(countedSpend) × 12` and `savings.yearlyCents = max(0, mean(countedSavings) × 12)`; both null when `window` is null; the rows' cents are for display only. `superExcludedCents = Σ superNetPay × 12 ÷ periods` (the part left out, shown). **Raw figures** (the sheet's rules on the same periods and the **unadjusted** `SavingsPeriod.raw` figures, so they match the sheet even after a D51 adjustment; for the goldens and comparison): `spend.rawYearlyCents = mean(unroundedSpend(p.raw)) × 12` (negatives kept); `savings.rawYearlyCents = max(0, mean(unroundedSavings(p.raw)) × 12)` (voluntary super kept, uncapped); each rounded once. A test with a D51 adjustment in the window shows raw ≠ adjusted.
4. **Super contribution a year (D99).** The 12 whole calendar months before `asOf`'s month (`fromMonth` … `toMonth`): `sgCents = Σ sgMonths[m].fundReceivesCents` for those months (earned month; after contributions tax; statement months as entered); `memberCents = Σ contributions.fundReceivesCents` dated in those months (salary sacrifice after contributions tax, after-tax amounts in full; D71, D75's imported reading); `yearlyCents = sgCents + memberCents`. `sgSource` summarises the months' sources. The super engine's `sgMonths` always reaches back 12 months (it covers the previous and the current FY).
5. **Growth weights (D102).** From `classes` (the dashboard's): `cash` and `offsets` at the cash rate; `etf`, `stock`, `managed_fund`, `crypto`, `other_assets` and `super` at the market return; `investment_property` = Σ non-primary property values at the market return; the primary residence and every liability are not weighted. Values ≤ 0 are left out. `cashWeightCents`/`marketWeightCents` are the sums. The rates themselves are applied in `projectFire` (so the what-if can change the market return, D100). **Super is weighted at the market return** because FIRE counts it and grows both buckets at one rate, as the template does (owner question 3).

### 2.5 The corrected model (`projectFire`)
1. **Inputs and states.** `missing` lists, in this order: `birthYear` (null, or the current age `YEAR(asOf) − birthYear` is < 0 or ≥ `horizonAge`), `accessAge` (null, or ≥ `horizonAge`), `inflationRate`, `withdrawalRate` (null or ≤ 0, or the target S ÷ wr beyond the safe-integer cents range), `marketReturn` (null while `marketWeightCents > 0`, or both weights 0 and neither rate set), `cashInterestRate` (null while `cashWeightCents > 0`), `rates` (`1 + g ≤ 0` or `1 + i ≤ 0`, or any projected figure beyond the safe-integer cents range). Any → `status 'needs_input'`, `rows []`, every projected figure null (the current pre-super and super figures stay). Each guard has a test. Otherwise `g = (cashWeight·cashRate + marketWeight·marketReturn) ÷ (cashWeight + marketWeight)` (both weights 0 → `g = marketReturn`, or the cash rate when that is the only rate given), `r = (1+g)/(1+i) − 1` (**exact**, D102), `simpleRealRatio = g − i` (shown only), `ageNow = YEAR(asOf) − birthYear`, `n = accessAge − ageNow`, `accessYear = YEAR(asOf) + n`. `P' = max(0, (P ?? 0) + X)`; `noSavingsHistory = P === null`.
2. **Spend.** `S` null or ≤ 0 → `status 'spend_needed'` ("Yearly spend needed", the sheet's words): the rows show the accumulation path only (§step 6 with `k` = none; helper null), `fire`, `target`, `topUps` null, milestones `today` and `access`. Otherwise `target = S ÷ wr` (`E60`).
3. **Paths and the helper** (whole years `t ≥ 0`):
   - `L(t) = L·(1+i)^−t` (the debts inside pre-super: fixed in dollars, so they shrink in today's dollars; their interest is already in `S` and their principal repayments in `P`, D51);
   - `projected(t) = (A0 + L)·q(t) − L(t) + P'·s(t)` (pre-super, still working; `W` fixed: the assets grow at `r`, the debts do not; with `L = 0` this is the template's `A0·q(t) + P'·s(t)`) (**provisional, owner question 2**);
   - `B(t) = B0·q(t) + C·s(t)` (super, still working);
   - `bridge(t) = max(0, n − t)`; `shortfall(t) = max(0, target − B(t)·q(bridge(t)))` (the super missing at access if work stops at `t`, valued at access);
   - for `t < n`: `needed(t) = S·a(bridge(t)) + shortfall(t) ÷ q(bridge(t))` (`V` fixed: the bridge's spend to access, **n − t full years**, plus the present value of the super shortfall, which the FIRE pot tops up; super above the target does not help the bridge, hence the floor inside `shortfall`);
   - for `t ≥ n`: `needed(t) = target − B(t)` (**signed**): both buckets are accessible and the combined wealth `projected(t) + B(t)` must meet the withdrawal rule, so super above the target can cover pre-super debts;
   - `gap(t) = needed(t) − projected(t)` (`X`). The helper's displayed `neededCents` is `max(0, needed(t))` (never negative, §10 #10); `gapCents` is computed from the signed value.
   With one real rate for both buckets, topping super up from the pot and keeping the money in the pot until access cost the same, so `needed` does not depend on the top-up schedule (step 6 only lays it out).
4. **The FIRE year.** `k` = the first `t` in `0 … horizonAge − ageNow` with `projected(t) ≥ needed(t)` (the signed `needed`; stepped year by year, never `NPER`). `k = 0` → `status 'fire'` ("You're FIRE"); `k` found → `'on_track'`; none → `'not_reachable'`. `fire = { yearsToGo: k, year: YEAR(asOf) + k, age: ageNow + k, afterAccess: k > n, bridgeYears: max(0, n − k) }`.
5. **KPIs at FIRE start** (`k` found): `preSuper.neededAtFireCents = max(0, needed(k))`, `projectedAtFireCents = projected(k)`; `super.projectedAtAccessCents` = **the plan path's super at the start of row `max(n, 0)`** (step 6): `max(B(k)·q(bridge(k)), target)` when `k < n` (top-ups close any shortfall); `B(n)` when `k ≥ n` (still accumulating to access; below the target when the pre-super pot covers the rest under the combined rule); the current super when `n ≤ 0`. `super.neededAtAccessCents = target`; `target.superAtFireStartCents = super.neededAtFireCents = target ÷ q(bridge(k))` (`E62` without the "− 2"; shown in "How it's worked out"). "Needed to stop today" = `max(0, needed(0))`.
6. **The plan path (the rows).** Rows `t = 0 … end`, `end = max(n, k) + 1` (the sheet's span to access + 1; later when FIRE is after access), capped at `horizonAge − ageNow`; for `not_reachable` and `spend_needed`, `end = max(n, 0) + 1` (capped likewise) with every row accumulating. Start `A = A0`, `B = B0`; each row: super `growth = start × r`; pre-super `growth = (start + L(t))·r + L(t)·i ÷ (1+i)` (the assets' return plus the debts' fall in today's dollars; with `L = 0` it is `start × r`); then by phase:
   - `accumulation` (`t < k`): pre-super `saved = P'`; super `contributed = C`.
   - FIRE starts at `k`. **Top-ups** (only when `k < n` and `shortfall(k) > 0`): with `D = shortfall(k)` and `N = n − k`: if `C > 0` and `C·s(N) ≥ D`, pay `C` at the end of each year from `k` until the paid amounts grown to access reach `D`; the last payment is the part that closes it exactly (`lastCents`), so `m` = the number of payments; else a **level** top-up `T = D ÷ s(N)` in each of the `N` bridge years (`level: true`). Top-up years have phase `top_up` (pre-super `spent = S`, `topUp = payment`; super `topUp = payment`); later bridge years `drawdown` (`spent = S`). `topUps.endYear = YEAR(asOf) + k + m`. **No lump at `k = n`:** when FIRE starts at access with `B(n) < target`, there is no top-up; the pre-super pot covers the difference under the combined rule of step 3.
   - `access` (`t ≥ n` and `t ≥ k`, `k ≤ n`) and `retired` (`t ≥ k > n`: FIRE after access; rows `n ≤ t < k` stay `accumulation`): **the draw order** is super first: super `withdrawn = min(S, start + growth)` (never below 0), and pre-super `spent` = the rest of `S` (0 while super lasts). With one real rate the order changes only which bucket shows the spending, not the combined wealth; pre-super keeps growing (any surplus left at access is a buffer).
   - `end = start + growth + saved − spent − topUp` (pre-super) and `start + growth + contributed + topUp − withdrawn` (super); the next row starts from the unrounded end.
   The helper on every row is `max(0, needed(t))`, `projected(t)`, `gap(t)` (the chart's needed-vs-projected view); null when `S` is not set.
7. **Progress.** `preSuper.progressRatio = clamp(A0 ÷ max(0, needed(k)), 0, 1)`; `super.progressRatio = clamp(B0 ÷ target, 0, 1)` (the Super tile's meter measures against the need at access, §6.3); null when the denominator is null or ≤ 0 (the page shows the true figures beside the meters).
8. **Milestones** (D101): `today` (t = 0); `fire_start` (t = k, when `k > 0`); `top_ups_end` (t = k + m, when top-ups exist); `access` (t = n, when `n > 0`); sorted by `t` (ties keep the kind order above). For `'fire'` the FIRE node sits on today and is omitted; for `not_reachable` and `spend_needed` only `today` and `access`. **Colour is by position, not kind** (STYLE_GUIDE §7.2's fixed spectrum order): the web merges milestones with the same `t` into one node (both labels) and colours the distinct nodes in time order from `FIRE_MILESTONE_TONE_ORDER` (1st teal, 2nd violet, 3rd fuchsia, 4th orange); the label carries the kind. Tests: the `afterAccess` and `fireAtAccess` fixtures keep teal → violet → fuchsia → orange along the line.

### 2.6 Sheet mode (`fireSheet`; spec 04 §5.3, verified on every populated output cell)
A literal re-implementation of the template for the goldens (§9) and a future comparison panel (§1.5); the server does not call it.
- **Sheets semantics:** `FV(r,n,p,v) = −(v·(1+r)^n + p·((1+r)^n − 1)/r)`; `PV(r,n,p,f) = −(f + p·((1+r)^n − 1)/r)/(1+r)^n`; `PMT(r,n,v,f) = −(v·(1+r)^n + f)·r/((1+r)^n − 1)`; `NPER(r,p,v,f) = ln((p − f·r)/(p + v·r))/ln(1+r)` (an error when the argument is not positive or the result is not finite; `ln` via `JoinrDecimal.ln`); `IPMT(r,per,n,v,f) = FV(r, per−1, PMT(r,n,v,f), v)·r` (per 1: `−v·r`; per outside 1…n: an error); `PPMT = PMT − IPMT`; r = 0 limits; `ROUNDUP` away from zero; `IFERROR(x, "-")`; comparisons with a text operand: text sorts above every number; `"" ` for blank formula results.
- **Cells** (as the template's formulas in spec 04 §5.3 and the dump; `E47` may be text, then every downstream cell is `"-"` or the IF branch the sheet takes): `E52`; the grid; `V3 = E52 − count(X > E48)` over the grid rows; `E53`, `E54`; `E55`; `E56` (`"Accept Disclaimer"` unless accepted; `IFERROR` → `"-"`); `E57` (year); `E60`; `E61`; `E62` (with the "− 2"); `E63`; `E64` (with the **salary** as the payment, `IF(E61 >= E60, 0, …)` under the text ordering); `D2`; `C15 = E45`, `D15 = E55`, `E15 = IFERROR(C15/(D15+C15), "-")`, `C16 = E46`, `D16 = E63`, `E16` likewise.
- **Grid** (row 4 = h 0): `G` = `YEAR(today) + h` while `G(prev) − 1 < E6 + E10`; `H = h`; `I`/`J`/`K` (h ≥ 1, while `L(prev)` is blank and `G ≤ E57`: `PMT(r, E56, E45, −E53)`, `IPMT(r, h, E56, −E45, E53)`, `PPMT(r, h, E56, E45, −E53)`); `L` (`E53` at `G = E57`; then `L(prev) − E48 + M(prev)` while `G ≤ E6 + E10`); `M = L × E49` on row 4 (**nominal**) and `L × r` below; `N` (row 4 `E45`; `N(prev) + K` while accumulating; else `L`); `O` (years after `E57`); `P`/`Q`/`R` (years after `E57` up to `YEAR(E57) + ROUNDUP(E64)`: `PMT(r, E64, E61, −E62)`, `IPMT(r, O, E64, −E61, E62)`, `PPMT(r, O, E64, E61, −E62)`); `S` (`T(prev) × r` from `YEAR(E57) + ROUNDDOWN(E64)` to access + 1 while `P` is blank; row 4 reads the blank header above as 0); `T` (`E61` at `G = E57`; else `T(prev) + R + S` when `P` or `S` is set); `V`, `W`, `X` as §2.3. Every cell passes through the column's `IFERROR` as the template does.
- A reference implementation in doubles, verified against the workbook, is in the git-ignored `artifacts/stage6/planner/sheet_fire.ts` (it reads the workbook and prints counts; it holds no owner value). The engine owner may read it; nothing is copied from the workbook.

---

## 3. Data model (`@joinr/schema`; no migration)

### 3.1 No migration
Stage 6 adds no table or column: the new settings are rows of the existing `settings` table, and the D98 marker is an `app_meta` row. `COMMITTED_MIGRATION_COUNT` stays **6**; `/api/health` → `migrations: 6`; `git diff --exit-code` on every migration file.

### 3.2 Schema module changes (Scaffolder)
- **`src/fire.ts`** (new, exported from the root; generic constants):
  ```ts
  export const FIRE_STATUSES = ['needs_input', 'spend_needed', 'fire', 'on_track', 'not_reachable'] as const;   // FireStatus
  export const FIRE_MISSING_INPUTS = ['birthYear', 'accessAge', 'inflationRate', 'withdrawalRate', 'marketReturn',
    'cashInterestRate', 'rates'] as const;                                                   // FireMissingInput
  export const FIRE_PHASES = ['accumulation', 'top_up', 'drawdown', 'access', 'retired'] as const;   // FirePhase
  export const FIRE_MILESTONE_KINDS = ['today', 'fire_start', 'top_ups_end', 'access'] as const;      // FireMilestoneKind
  export const FIRE_GROWTH_WEIGHT_KEYS = ['cash', 'offsets', 'etf', 'stock', 'managed_fund', 'crypto', 'other_assets',
    'investment_property', 'super'] as const;                                                // FireGrowthWeightKey
  export const FIRE_INPUT_SOURCES = ['setting', 'derived', 'what_if', 'default', 'missing'] as const;   // FireInputSource
  export const FIRE_MILESTONE_TONE_ORDER = ['teal', 'violet', 'fuchsia', 'orange'] as const;  // node colours by position (D101, §2.5 step 8)
  export const FIRE_PHASE_WORDS = { accumulation: 'Saving', top_up: 'Drawing down, topping up super',
    drawdown: 'Drawing down', access: 'Living on super', retired: 'Living on super' } as const;   // one map for the page (UX-24)
  export const FIRE_FIELD_LABELS = { spend: 'Yearly spend', withdrawalRate: 'Withdrawal rate', inflationRate: 'Inflation rate',
    marketReturn: 'Market return', accessAge: 'Access age', extraSavings: 'Extra savings a year' } as const;
                                                             // the what-if labels; the Settings labels (§3.3) share the base words
  export const FIRE_WINDOW_STALE_DAYS = 45;                  // the months-used window ends this long before asOf → a note (§6.3)
  export const FIRE_HORIZON_AGE = 100;
  export const FIRE_DEFAULT_ACCESS_AGE = 60;                                                 // D98
  export const FIRE_REPLACED_ACCESS_AGE = 65;                                                // D98: the imported value replaced once
  export const FIRE_ACCESS_AGE_META_KEY = 'fire.accessAgeReplaced';                          // app_meta (§3.4)
  export const FIRE_EXTRA_SAVINGS_MAX_CENTS = 1_000_000_000;                                 // ± (write bound and query)
  export const FIRE_WHAT_IF_FIELDS = { spend: 'fire.yearlySpendOverrideCents', withdrawalRate: 'fire.withdrawalRate',
    inflationRate: 'fire.inflationRate', marketReturn: 'fire.marketReturn', accessAge: 'fire.preservationAge',
    extraSavings: 'fire.extraSavingsPerYearCents' } as const;                                // query field → the key Save writes
  ```
- **`settings.ts`** (§3.3): the two keys appended to `SETTING_KEYS` and `SETTINGS`; registry defaults and labels; `EDITABLE_SETTING_KEYS` 62; `PREFERENCE_SETTING_KEYS` 21; `SETTING_WRITE_BOUNDS` +2; the `fire` group.
- **`dto/fire.ts`** (§4.3–4.4), exported from the root; **`dto/settings.ts`:** `SettingDto` gains `notice: string | null` (additive; every builder sets it, null by default).
- **Fixtures** `src/fixtures/fire.ts` (§3.6); `FIXTURE_COVERAGE` gains `fireStatuses`, `firePhases`, `fireMilestoneKinds`, `fireInputSources`.
- **`dto/cashflow.ts`:** none (the new route reuses `SettingsPatchResponse`).
- **`testing/seed.ts`:** `seedGenericData` adds generic import-origin `fire.*` rows (birth year 1990, access age 60, inflation `0.025`, withdrawal `0.04`) and `returns.cashInterestRate` `0.04`, `returns.marketReturn` `0.07`, so seeded servers reach `on_track`; a helper **`seedFireReplacedAge(db)`** (testing only) writes an import-origin `fire.preservationAge` 65 for the D98 tests.
- **Schema tests the changes touch:** `registries.test.ts` (the key count 63, editable 62, preference 21, groups partition 63), the settings-schema bounds tests, fixture parsing and coverage, the query schema.

### 3.3 Settings (D97–D100, D103)
- **New keys** (appended to `SETTING_KEYS` and `SETTINGS` after `history.autoRecord`; app-only, `source: null`; category `fire`):

  | Key | Label | Type | Default | Read by |
  |---|---|---|---|---|
  | `fire.marketReturn` | "Market return for FIRE" | ratio | null (→ `returns.marketReturn`) | the growth blend (D102), what-if "Return" (D100) |
  | `fire.extraSavingsPerYearCents` | "Extra savings a year" | money (signed; no registry min) | null (→ 0) | `X` (§2.5 step 1), what-if "Extra savings" (D100) |

- **Changed registry entries:** `fire.preservationAge` label "Access age (preservation age)", **default 60** (D98; the registry min–max 0–120 unchanged); `fire.yearlySpendOverrideCents` label "Yearly spend (override)"; `fire.superContributionPerYearCents` label "Super contribution a year (override)"; `fire.inflationRate` "Inflation rate"; `fire.withdrawalRate` "Withdrawal rate"; `fire.marketReturn` "Market return for FIRE"; `fire.extraSavingsPerYearCents` "Extra savings a year". Labels share their base words with `FIRE_FIELD_LABELS` (§3.2, §6.4) so the FIRE page and Settings name a field the same way (Stage 5 §6.5 item 11); a schema test checks each Settings label starts with its what-if label's words.
- **Group `fire`** (label "FIRE"; display order): `fire.birthYear`, `fire.preservationAge`, `fire.inflationRate`, `fire.withdrawalRate`, `fire.yearlySpendOverrideCents`, `fire.superContributionPerYearCents`, `fire.marketReturn`, `fire.extraSavingsPerYearCents`. The groups hold **63 keys**.
- **`EDITABLE_SETTING_KEYS`** = the Stage 5 sixty, then the two new keys: **62** of 63 (`SETTINGS_PATCH_MAX_KEYS` 64 still holds them all).
- **`SETTING_WRITE_BOUNDS`** += `fire.marketReturn` −1 to 1, `fire.extraSavingsPerYearCents` ±`FIRE_EXTRA_SAVINGS_MAX_CENTS` and `fire.preservationAge` 0 to 99 (`FIRE_HORIZON_AGE − 1`: the engine needs the access age before the horizon; the registry's 0–120 stays, so an imported value still imports and shows as a missing access age; triage SPEC-2).
- **Preferences (D103):** `PREFERENCE_SETTING_KEYS` gains the **eight** `fire.*` keys (21 in all). An app edit of one never counts toward `hasAppData`, a re-import keeps the app value (the Stage 5 importer rule, no importer change), and the Settings page's FIRE group shows "Kept when you re-import". The two new keys are app-only anyway; listing them keeps the group's note uniform.
- **Overrides (D97, D99) and the workbook's figures:**
  - **Spend:** `fire.yearlySpendOverrideCents` set (either origin; the workbook's `E48` is only-when-typed, so a stored import value was typed on purpose) → it wins; else the derived figure (§2.4 step 3).
  - **Super contribution (owner question 1; applied provisionally):** only an **app-origin** `fire.superContributionPerYearCents` overrides. An import-origin value (the workbook's `E7` is always typed, so it would otherwise always hide the D99 figure) is shown as "The workbook's figure" with a **Use the workbook's figure** button. A PATCH cannot do this (it skips an unchanged value and keeps its origin, by design), so the button calls `POST /api/fire/use-workbook-contribution` (§4.2), which flips that row to `origin 'app'` with its value unchanged; a server test: import row → the POST → `inputs.superContribution.source 'setting'`. The Settings field's notice says so (§4.5).
  - **Market return:** `fire.marketReturn` set → it is the market return in the blend; else `returns.marketReturn` (the Investing group's workbook key, never written by the FIRE page).
  - **Extra savings:** `fire.extraSavingsPerYearCents ?? 0`.

### 3.4 The D98 one-off (the imported 65 becomes 60 once, `data/` stays re-importable)
`applySettingUpgrades(database: AppDatabase, now: Date): SettingUpgrade[]` (`apps/server/src/fire/upgrade.ts`, **frozen**, synchronous, one `IMMEDIATE` transaction; `SettingUpgrade = { key: 'fire.preservationAge'; from: number; to: number; at: string }`):
1. `app_meta[FIRE_ACCESS_AGE_META_KEY]` present → nothing (**once per database**).
2. The `fire.preservationAge` row exists with `origin 'import'` and value `FIRE_REPLACED_ACCESS_AGE` (65) → update it to `FIRE_DEFAULT_ACCESS_AGE` (60) with `origin 'app'` and `updated_at = now`, and write the marker `{ from: 65, to: 60, at }` (UTC ISO). Returns the one upgrade; one info log line (key and ages only).
3. Anything else (no row: a fresh database before its import; another value; an app row) → nothing, and no marker, so a later import of 65 is still replaced.

**Called:** by `buildApp` once after the database is ready (so a CLI import made while the server was down is upgraded at the next start), and right after a committed import in the upload route and in the CLI (`routes/import.ts`, `cli/import.ts`), never for a dry run.

**Why this keeps `data/` re-importable (D34, D103):** the upgraded row is an app row of a **preference** key, which `hasAppData` ignores; a later import keeps it (the Stage 5 D95 rule, report line `settings.keptAppPreference`); the marker is `app_meta` (never app data). A forced `--replace-app-data` import keeps preference rows too, and the marker stops a second replacement. If the owner later sets 65 on purpose it is an app row and stays. **The note** ("Access age changed from 65 (the workbook) to 60 on 27 September 2026: 60 is the preservation age for anyone born after 30 June 1964; 65 is when super is released unconditionally.") is shown on the FIRE page and as the Settings field's notice while the marker exists and the stored value is still 60 (§4.5); the date is the marker's, in the prose form of STYLE_GUIDE §8 (`d MMMM yyyy`).

### 3.5 Origin rules and D34 for Stage 6
| Entity | Create / update | Counts as app data |
|---|---|---|
| Any `fire.*` setting (a Settings save, the FIRE page's Save, Use the workbook's figure, Use the derived figure) | `origin 'app'` | **no** (preference, D103) |
| The D98 upgrade row and the `app_meta` marker | server | **no** |
| `returns.marketReturn`, `returns.cashInterestRate` | unchanged (the FIRE page never writes them) | yes (workbook keys, as before) |

`hasAppData` needs no code change (its settings rule already skips `PREFERENCE_SETTING_KEYS`); server-api adds the tests (§7.4).

### 3.6 Fixtures (Scaffolder; `src/fixtures/fire.ts`, `satisfies`, generic values, internally consistent)
**How they are made:** the Scaffolder runs the git-ignored prototype `artifacts/stage6/plan-reviser/model2.ts` (a pure function in doubles with no imports and no owner data: the §2.5 model after the plan review; `example2.ts` beside it reproduces §10.1) from a scratch script, rounds each output once to cents, and records **each fixture's projection inputs** in the fixture file (`fireFixtureInputs: Record<keyof typeof firePages, FireProjectionInput-shaped JSON>`). server-api adds a test (gated by `FIRE_ENGINE_IMPLEMENTED`) that `projectFire` on each recorded input reproduces its fixture's rows and KPIs within 1 cent (§7.4), so the fixtures cannot drift from the engine.

`firePages`: `onTrack` (the hand-worked example of §10.1: FIRE in year 1, 3 top-up years with a partial last, every milestone), `fireNow` (`status 'fire'`), `afterAccess` (FIRE after access; `retired` rows), `fireAtAccess` (`k = n`: two milestones in one year, one merged node), `notReachable`, `spendNeeded` (no closed period, no override; accumulation rows only), `needsInput` (birth year and withdrawal rate missing), `needsInputRates` (the market and cash rates missing: the `#investing` links), `spendOverride` (spend `source 'setting'`), `superContributionOverride` (an app-set super contribution, `source 'setting'`), `marketReturnFire` (`marketReturn.settingKey 'fire.marketReturn'`), `whatIf` (query applied: `whatIfActive`, a `baseline` summary that differs), `whatIfStatusChange` (a what-if that turns `on_track` into `not_reachable`), `levelTopUps` (C = 0: level top-ups), `noTopUps`, `accessReached` (n ≤ 0: no access milestone), `negativePreSuper` (a debt larger than the liquid assets: `A0 < 0`, `L > 0`, U+2212 figures), `superZero` (no super yet), `longHorizon` (about 75 rows: a young birth year), `shortWindow` (3 closed months: the small-count warning), `staleWindow` (`window.through` more than 45 days before `asOf`), `upgradedAge` (the D98 note), `workbookContribution` (an import-origin super contribution shown as the workbook's figure, the derived one used), `noSavingsHistory`, `empty` (`isEmpty: true`: no import, no accounts), `featureOff` (`featureOn: false`). Mutation example: `fireSettingsPatchResponse`. `apiErrors` gains `fireValidation` (a 400 for an out-of-range query); the web tests build the what-if failure state (`whatIfError`: a 500 on the second GET) from the Stage 0 error fixtures.

---

## 4. API contract (FROZEN)

All routes under `/api`, JSON, `cache-control: no-store`, the Stage 0 error shape; queries validated with `parseWith` (400 `VALIDATION_ERROR`, `path: issue; …`). Money is integer cents; decimals are strings; dates `YYYY-MM-DD`.

### 4.1 Error codes
None new. `VALIDATION_ERROR` 400 for the query.

### 4.2 Endpoints
| Method & path | Request | 2xx | Errors |
|---|---|---|---|
| `GET /api/fire` | query `fireQuerySchema` (every field optional: a what-if, never saved, D100) | 200 `FirePageResponse` | 400 |
| `POST /api/fire/use-workbook-contribution` | no body | 200 `SettingsPatchResponse` (the import-origin `fire.superContributionPerYearCents` row, if any, becomes `origin 'app'` with its value unchanged; idempotent: no import row → nothing written, 200) | — |
| `PATCH /api/settings` | (Stage 3) the `fire.*` keys incl. the two new ones | 200 `SettingsPatchResponse` (unchanged shape) | 400 |
| `GET /api/settings` | (Stage 5) | `SettingDto.notice` additive | |
| `GET /api/health` | (Stage 0) | `db.migrations` stays **6** | |

"Save as my settings" is a `PATCH /api/settings` of the changed fields' keys (`FIRE_WHAT_IF_FIELDS`); "Use the workbook's figure" is the POST above; "Use the derived figure" PATCHes the override key (`fire.yearlySpendOverrideCents` or `fire.superContributionPerYearCents`) to null.

### 4.3 Query schema (`dto/fire.ts`)
```ts
export const fireQuerySchema = z.strictObject({
  spend: z.coerce.number().int().min(0).max(CASHFLOW_MONEY_MAX).optional(),                 // cents a year
  withdrawalRate: ratioQuery({ gt: 0, max: 1 }).optional(),                                  // decimal string, e.g. '0.04'
  inflationRate: ratioQuery({ gt: -1, max: 1 }).optional(),
  marketReturn: ratioQuery({ gt: -1, max: 1 }).optional(),
  accessAge: z.coerce.number().int().min(30).max(100).optional(),
  extraSavings: z.coerce.number().int().min(-FIRE_EXTRA_SAVINGS_MAX_CENTS).max(FIRE_EXTRA_SAVINGS_MAX_CENTS).optional(),
});   // ratioQuery: a normalised decimal string within the bounds (messages 'must be above 0' …); FireQuery = z.infer
```

### 4.4 DTOs (`dto/fire.ts`, frozen field lists; engine `Cents` → `number`)
```ts
export interface FireMoneyInputDto { cents: number | null; source: FireInputSource; savedCents: number | null;
  derivedCents: number | null }                       // savedCents: the stored setting; derivedCents: §2.4 (null if none)
export interface FireRatioInputDto { ratio: DecimalString | null; source: FireInputSource; savedRatio: DecimalString | null }
export interface FireIntegerInputDto { value: number | null; source: FireInputSource; savedValue: number | null }
export interface FireInputsDto {
  birthYear: FireIntegerInputDto;
  accessAge: FireIntegerInputDto & { replaced: { from: number; to: number; at: string } | null };   // D98 note
  inflationRate: FireRatioInputDto;
  withdrawalRate: FireRatioInputDto;
  marketReturn: FireRatioInputDto & { settingKey: 'fire.marketReturn' | 'returns.marketReturn' };   // whose value is in use
  cashInterestRate: FireRatioInputDto;                                  // returns.cashInterestRate (read only here)
  yearlySpend: FireMoneyInputDto;                                       // D97
  superContribution: FireMoneyInputDto & { workbookCents: number | null };   // D99; owner question 1
  extraSavings: FireMoneyInputDto;
}
export interface FirePeriodRowDto { /* every FirePeriodRow field, Cents → number */ }
export interface FireDerivedDto { /* every FireDerived field, Cents → number; rows: FirePeriodRowDto[] */ }
export interface FireRowDto { /* every FireRow field */ }
export interface FireProjectionDto { /* every FireProjection field; rows: FireRowDto[] */ }
export interface FireSummaryDto { status: FireStatus; fireYear: number | null; yearsToGo: number | null;
  fireAge: number | null; afterAccess: boolean | null; neededAtFireCents: number | null;
  superNeededAtAccessCents: number | null; superProjectedAtAccessCents: number | null;
  yearlySpendCents: number | null }         // every tile's "Saved:" line reads from here (§6.3)
export interface FirePageResponse {
  asOf: IsoDate;
  isEmpty: boolean;                         // net worth 0, super 0 and no closed period: the empty state (§6.3 item 8)
  whatIfActive: boolean;                    // any query field given
  inputs: FireInputsDto;
  derived: FireDerivedDto;
  projection: FireProjectionDto;
  baseline: FireSummaryDto | null;          // the saved settings' summary while a what-if is active
  featureOn: boolean;                       // features.fire ?? true
  hasAppData: boolean;                      // for the "Saving never blocks a re-import" line (D103)
}
```
server-api adds a type-level test that `FireDerived`, `FirePeriodRow`, `FireRow`, `FireProjection` are assignable to their DTOs (Cents → number).

### 4.5 Server behaviour (server-api; `apps/server/src/fire/**`, `routes/fire.ts`)
**One request context.** `FinanceContext` gains `fireDerived(): FireDerived` (memoised; `deriveFireInputs` of `dashboardFigures()`, `netWorth().classes`, `netWorth().liabilities`, `property()`, `savings().periods`, `kpis()`, `superResult()`).

**The clock.** Every date decision uses the app's injected `now` (`buildApp({ now })`, as Stage 5); there is no clock environment variable. Every server FIRE test passes a fixed `now` (the D99 window, the age and `n` all move with it).

**Resolving the inputs** (`apps/server/src/fire/inputs.ts`, each rule unit-tested): read the settings with their origins; for each field the value is the query's when given (`source 'what_if'`), else the stored setting (`'setting'`; for the super contribution only an app-origin row, §3.3), else the derived figure (`'derived'`: spend, super contribution), else the registry default (`'default'`: access age 60, extra savings 0), else null (`'missing'`). `marketReturn`: query → `fire.marketReturn` → `returns.marketReturn` (`settingKey` says which). `cashInterestRate`: `returns.cashInterestRate`. `accessAge.replaced` from the marker while the stored value is still `to`. Then `projectFire` with `preSuperCents`, `preSuperDebtCents = derived.preSuper.debtCents`, `superCents`, `savingsPerYearCents = derived.savings.yearlyCents`, the weights, and the resolved values. `isEmpty` = `derived.preSuper.netWorthCents === 0 && derived.preSuper.superCents === 0 && derived.window === null`.

**Baseline:** when `whatIfActive`, a second `projectFire` with the saved values gives `baseline` (every `FireSummaryDto` field).

**Settings page:** `SETTING_READERS` maps the eight `fire.*` keys to `['fire']` and adds `'fire'` to the readers of every other setting the FIRE derivation reads (`returns.cashInterestRate`, `returns.marketReturn`, `super.sgRate`, `super.contributionsTaxRate`, `pay.grossAnnualSalaryCents`, `pay.jobStartDate`; server-api lists any further key it finds `deriveFireInputs` depends on); `SettingDto.notice` is set for `fire.preservationAge` (the D98 note, §3.4) and for an import-origin `fire.superContributionPerYearCents` ("From the workbook. The FIRE page uses your super contributions from the last 12 months unless you set a figure here."); null otherwise. The `fire` group's preference note replaces "FIRE (used from Stage 6)".

**Imports:** `routes/import.ts` and `cli/import.ts` call `applySettingUpgrades` after a committed import (not a dry run); `buildApp` calls it once at build.

**Use the workbook's figure** (`apps/server/src/fire/workbook.ts`, the route in `routes/fire.ts`): one `IMMEDIATE` transaction; when the `fire.superContributionPerYearCents` row has `origin 'import'`, set `origin 'app'` and `updated_at = now` (value unchanged); answer the settings slice and `hasAppData` as a PATCH does. Tests: import row → POST → `GET /api/fire` `source 'setting'`, `workbookCents` null; a second POST writes nothing; no row → 200, nothing written; `hasAppData` stays false (D103).

**CODE-9 (server-wide; tooling, §7.1):** new `apps/server/src/lib/dates.ts` (`localIsoDate(d)`, `addDaysIso(date, days)`, `isoDayBefore(date)`, re-exporting `monthEndOf` from the schema) and `lib/sums.ts` (`sumDecimalStrings` = the schema's `sumDecimals`, `sumCents(values)` with a safe-integer check); the duplicates in `investments/format.ts` (`localIsoDate`), `market/fxHistory.ts` (`localIsoDate`, `addDaysIso`), `market/providers/fake.ts` (`localIso`, `isoDayBefore`), `assets/responses.ts` (`monthEnd`), `assets/otherAssets.ts` (`sumDecimals`) and `assets/mutations/common.ts` (`sumDecimal`) become imports of the shared helpers (their public exports stay as re-exports where tests import them); behaviour unchanged (each caller's tests still pass; `lib/*` unit tests at month, year and DST boundaries).

---

## 5. Chart data (the FIRE page)
| Chart | Source | Series | Markers |
|---|---|---|---|
| **Balances** (view 1 of "Your path by year", D101) | `projection.rows` | Pre-super (`rows[].preSuper.startCents`) slot 1; Super (`rows[].super.startCents`) slot 6 (`NET_WORTH_CLASS_SLOTS.super`, so super keeps its colour across the app) | the milestones (§2.5 step 8) |
| **Needed vs projected** (view 2, D101; the sheet's V/W/X, needed floored at 0 for display) | `rows[].helper` | "Projected pre-super" slot 1 (the same entity colour); "Needed to stop that year" slot 3, **dashed** (a target line) | the milestones; the FIRE node sits where the lines cross |

- **Card title** "Your path by year" for both views, with a view subtitle ("Balances" / "Needed vs projected") and a one-line `ariaLabel` summary per view ("Pre-super and super balances from 2030 to 2036; FIRE in 2031." / "Needed and projected pre-super by year; projected first covers needed in 2031.").
- **Categories** are the row years (`2031`, the calendar year of each anniversary, §2.1), and the value is the balance **at each anniversary of today** (the balance you have from that date; the last row shows the end state), in today's dollars. **Axis** ticks use the compact formatter through the shared `compactAxisFormatter` (§6.9 C); **tooltips** use the full-dollar formatter (the app convention, as `SavingsCharts.tsx`); the table view shows two decimals.
- **Markers (node-line motif, STYLE_GUIDE §7.2):** a vertical 1 px **dashed `--text-muted`** line at each milestone year (a `--hairline` line would be invisible against the gridlines), with the node's filled dot in a lane **above** the plot area (so the dots never sit on a series line) in its spectrum colour **by position** (§2.5 step 8: 1st teal, 2nd violet, 3rd fuchsia, 4th orange; full-strength brand colours, no glow inside the chart) and an 11 px `--text-secondary` label ("FIRE 2031"). Two milestones in the same year share one line and one node with both labels. Labels are anchored inside the plot (the first to the right of its line, the last to the left); **below 768 px, or when two labels would sit closer than 64 px, the chart shows the dots only** and the MilestoneLine above the chart carries the words. The crosshair tooltip names the year's milestone ("FIRE starts"). The same nodes, in the same order and colours, form the **MilestoneLine** (§6.3). Markers are ECharts `markLine`s, so `MarkLineComponent` is registered in `echarts.ts` (Scaffolder, §7.2).
- Negative balances (a pre-super pot that starts negative) are drawn below zero with their sign in the tooltip and table (U+2212); no gain/loss colours in these categorical charts.
- **Colour check:** slot 1 vs slot 6 and slot 1 vs slot 3 meet the palette's pair thresholds (the web test re-runs the validator maths, §7.5).
- **Table view** (ChartCard Chart | Table): Year · Age · Phase · Milestone · Pre-super · Super (view 1); Year · Milestone · Needed · Projected · Short by / Ahead by (view 2; `gap > 0` "Short by $X", `≤ 0` "Ahead by $X"). The Milestone column holds the same `Pill` words as the year-by-year table ("FIRE", "Top-ups end", "Access"); each table has a caption naming the view and "in today's dollars, at each anniversary of today".

---

## 6. Web spec (`apps/web`)

### 6.1 Routes, files and shared rules
- **`/fire`** → `FirePage` (`src/pages/fire/**`), a typed route (the Scaffolder replaces the placeholder). After Stage 6 no placeholder route remains: web-polish-pages removes `PlaceholderPage` and `placeholderFor` (and their tests), and the Integrator empties `e2e/ui-core.spec.ts`'s short-page list.
- **FIRE page styles** live in `apps/web/src/pages/fire/fire.css` (imported by `FirePage.tsx`; class names `jf-app-fire-*`; created empty by the Scaffolder, owned by web-fire): the what-if layout and result strip, the slider, the tile footers, the row highlight. `app.css` stays web-polish-pages'.
- **Lazy routes (D104, web-polish-pages):** every page route's component loads through `lazyRouteComponent(() => import('./pages/…'))` except the root layout, `NotFoundPage` and `ErrorPage`. The router calls a route component with no props, so the in-file wrappers that pass props or read route APIs (`investmentPageFor(kind)`, `holdingDetailFor(kind)`, `DividendsRoute`, `RecordsEntityRoute`, `ImportRunRoute`, `ScreenPreviewRoute`) move into small route modules that are themselves lazy (one per investment kind, or a module that reads its params and search through `getRouteApi`). Each lazy route has a **no-props pending wrapper** rendering `PageSkeleton` with **that route's layout** (the same layout the page's own first-load skeleton uses, so a cold navigation never swaps skeleton shapes; a web test compares the two per route) and the router's `defaultPendingMs` 150 / `defaultPendingMinMs` 300 (no flash on fast loads). On a missing chunk, `lazyRouteComponent` reloads the page once (its sessionStorage flag) before an error reaches `ErrorPage`; that is expected.
- **Teal:** one key figure per page: FIRE "Years to FIRE" (the first tile).
- **Rates:** one decimal (`7.4%`) everywhere on the FIRE page, including the real rate and the withdrawal rate; the exact decimal string is in the tooltip of "How it's worked out". **Input fields** show a saved rate at its stored precision until edited (up to 2 dp as a percentage, e.g. `3.75`; the ratio keeps 4 dp), so a saved value never reads as a what-if.
- **Years and ages** are plain integers (`2031`, `age 56`); FIRE is always "in 2031", never a date. Dates in prose use the long form (`27 September 2026`, STYLE_GUIDE §8).
- **Colour of figures:** the stop tint only for a shortfall ("Short by"), a negative pre-super net worth and a negative savings figure; "Ahead by" is body text (not the go tint: it is not a gain).

### 6.2 API layer (`src/api/hooks.ts` additions; web-fire)
- `useFire(query: FireQuery | null)`: key `['fire', query ?? {}]`, `placeholderData: keepPreviousData` (the what-if keeps the page mounted), refetch every 60 s while visible (as Net Worth). The query string is built only from the fields that differ from the saved values (compared as normalised decimal strings through `JoinrDecimal`, never floats or display text).
- **While a what-if loads** (`isPlaceholderData`): the results region (tiles, MilestoneLine, chart, tables) has `aria-busy="true"` and dims (the charts get `loading`), and the result strip (§6.4) reads "Updating…". **On a what-if failure** the page keeps the previous figures under a `Callout important` "Couldn't recompute: <message>. The figures shown are for your previous inputs." with **Try again**.
- `useUseWorkbookContribution()` (the POST, §4.2) beside the settings mutation.
- **Invalidation:** a settings save and the POST invalidate `['fire']` (the settings mutation already invalidates every page key); `invalidateAfterHistoryChange` and the Stage 2–4 invalidation helpers add `['fire']` (every input moves with trades, balances, super and property).
- Value imports from `@joinr/schema` root only (`fireQuerySchema`, the §3.2 constants, `FIRE_WHAT_IF_FIELDS`); DTO types with `import type`.

### 6.3 FIRE page (desktop ≥ 1200 px)
**Layout at ≥ 1200 px:** the header and callouts span 12; then a **results column (span 8)** holding the tiles (2 × 2), the MilestoneLine and the chart, beside the **what-if card (span 4)**, sticky below the header (`position: sticky; top` under the app header) so every slider move is seen next to its results; "How it's worked out" and "Year by year" span 12 below. At 768–1199 px and on phone the what-if card follows the chart at full width, and its **result strip** (§6.4) stays sticky at the top of the card.

1. **`PageHeader`** "FIRE" (sub-line "Planning"); action **Settings** (a link to `/settings#fire`).
2. **Callouts** (under the header): **status callouts first, then notes; at most two at once**; a note that does not fit moves into "How it's worked out" (its text and any button there); the foot disclaimer is not counted.
   - `featureOn` false → `Callout note` "This page is switched off in Settings (Pages)" (Stage 5 wording) with the link.
   - `needs_input` → `Callout important` "Set these to see your FIRE date: birth year, withdrawal rate." with each missing input linking to its what-if field (focused) or to `/settings#fire`; the market and cash rates link to `/settings#investing`.
   - `spend_needed` → `Callout important` "Yearly spend needed. Your recorded months show no spending to base it on; set a yearly spend in the what-if panel and save it." (the sheet's words first).
   - Notes, in this order: `inputs.accessAge.replaced` → `Callout note` with the §3.4 note; a stale window (`window.through` more than `FIRE_WINDOW_STALE_DAYS` before `asOf`) → `Callout note` "Your savings figures run to 31 December 2029; record the months since then to bring them up to date." (link to History); `superContribution.workbookCents` set and `source 'derived'` → `Callout note` "The workbook's super contribution a year was $X. This page uses $Y from your super contributions in the last 12 months." (its button lives in the super contribution row, item 6).
   - Always, at the page foot: `Callout note` "A projection in today's dollars from your settings and recent months, not financial advice." (fix 15: no disclaimer gate).
3. **KPI tiles** (`StatTile`, 2 × 2 in the results column; tablet 3 of 6; phone one column). Each tile has **one text line under its figure plus, where listed, a meter** in `StatTile`'s `footer` slot (a Scaffolder contract, §6.5); when `whatIfActive` a second muted line "Saved: …" is added from `baseline` (the hint stays):
   - **Years to FIRE** (teal): `on_track` "1 year" / "N years", line "FIRE in 2031 · age 56" (example words; after access: "FIRE in 2041 · age 62 · after your access age (60)"); `fire` "You're FIRE" (the sheet's words; ✅ replaced by a `StatusBadge go` "FIRE"); `not_reachable` "Not by 100", line "At these settings"; `spend_needed` "—", line "Set a yearly spend"; `needs_input` "—", line "Missing: birth year, withdrawal rate". Saved line: "Saved: FIRE in 2033 · age 58" (or the saved status in words).
   - **Pre-super needed at FIRE start** (`preSuper.neededAtFireCents`, whole dollars), line "You have $X" (stop tint when negative), `Meter` of `progressRatio`; "—" with "No FIRE year at these settings" when `fire` is null. Saved line: the baseline's `neededAtFireCents`.
   - **Super needed at access** (`super.neededAtAccessCents`): a `Meter` with `valueCents` = the current super, `targetCents` = `neededAtAccessCents` and the projection marker `markerCents` = `super.projectedAtAccessCents`, `markerLabel` "Projected at 60" (the Meter's existing marker); line "You have $X". The self-sustaining super at FIRE start (`neededAtFireCents`) is in "How it's worked out", not here. "—" when `target` is null. Saved line: the baseline's `superNeededAtAccessCents` and `superProjectedAtAccessCents`.
   - **Yearly spend** (`inputs.yearlySpend.cents`), line with the source: "From your last N months" (with "only N months recorded" when N < 6) / "Your setting" / "What-if". Saved line: the baseline's `yearlySpendCents`.
   When `whatIfActive`, a `StatusBadge pending` "What-if (not saved)" sits above the tiles.
4. **`SectionBar` "Your path"** (primary):
   - **MilestoneLine** (results column; `@joinr/ui` brand component, §6.5): the node line with up to four nodes placed by year between today and the last row's year, colours by position (§2.5 step 8), each labelled under the line ("Today · 2030 · 55", "FIRE · 2031 · 56", "Top-ups end · 2034 · 59", "Access · 2035 · 60"; for `fire` the today node reads "Today · You're FIRE"); the phase words between nodes from `FIRE_PHASE_WORDS`. Vertical (nodes top to bottom) when **its container** is narrower than 768 px (a container query). It is decorative for the eye and duplicated as a visually-hidden ordered list for screen readers.
   - **`ChartCard` "Your path by year"** with a `Segmented` view switch **Balances | Needed vs projected** (D101) in its actions; §5; caption "In today's dollars, at each anniversary of today; the year's saving and spending are counted at its end." / "Needed: what the FIRE pot must hold to stop that year (spend to your access age plus any super shortfall). Projected: your pre-super net worth if you keep saving."
5. **`SectionBar` "What if"** (supporting; D100): a `Card` (§6.4), placed per the layout above.
6. **`SectionBar` "How it's worked out"** (reference, violet): `KeyValueTable`s (numbers mono and left-aligned inside the table, STYLE-7, §6.9 E):
   - **You now:** Net worth · less Super · less Your home (value) · **Pre-super net worth** (with "Includes your debts (−$X, of which your home loan −$Y), held fixed in dollars; your home's value is left out." and the muted alternative "Without the home loan: $Z", owner question 2) · Super.
   - **Each year:** Savings a year ("Average over N recorded months (to 28 February 2030) × 12; M months capped at income; voluntary super contributions ($Z a year) count in super, not here") · Extra savings · **Super contribution a year** ("SG $A + your contributions $B, Mar 2029 – Feb 2030, after contributions tax" / "Your setting" / "The workbook's figure"), with **Use the workbook's figure** (the POST) while `workbookCents` is set and the source is `derived`, and **Use the derived figure** (PATCH null) when the source is `setting` · Yearly spend ("Average over N months × 12; K months with no net spending counted as $0" or "Your setting"/"What-if", with **Use the derived figure** when an override is in use) · Super needed at FIRE start (self-sustaining: "$683,843 at FIRE start grows to the $800,000 needed at 60").
   - **Rates:** Growth ("Cash $30,000 at 5.1%, everything else $720,000 at 6.1% → 6.1% a year") · Market return with its source ("(your FIRE return)" linking to `/settings#fire`, or "(from Investing settings)" linking to `/settings#investing`, from `marketReturn.settingKey`) · Inflation · **Real growth** ("6.1% and 2.0% inflation → 4.0% after inflation (not 4.1%)": the exact rate, fix 4; "(not X)" only when the one-decimal texts differ, otherwise both at two decimals, "4.00% (not 4.08%)") · Withdrawal rate ("Super needed at access = spend ÷ 5.0%").
   - **The months used** (`<details>` closed): `ColumnTable` Month · Income · Spend · Counted spend · Counted savings (a floored month shows "Counted as $0" with a `Pill` "Capped").
   - Notes moved here by the callout cap (item 2).
7. **`SectionBar` "Year by year"** (reference): `ColumnTable` Year · Age · Phase · Pre-super (start) · Saved · Spent · Top-up · Pre-super growth · Pre-super (end) · Super (start) · Contributions + top-ups · Super growth · Withdrawn · Super (end); outflows (Spent, Top-up in the pre-super columns, Withdrawn) carry U+2212 and the caption says "Growth includes your debts' fall in today's dollars; outflows are shown with −"; the milestone years carry the matching `Pill` ("FIRE", "Top-ups end", "Access"); phase words from `FIRE_PHASE_WORDS`; the FIRE row and the access row are marked (sheet's highlight); newest last.
8. **States:** §6.9 (skeleton, error). **Empty:** `isEmpty` → the Net Worth empty screen's pattern (`BrandScreen fullViewport={false}`, its wording adapted: "Import the workbook or add accounts to plan FIRE", with the same links); fixture `empty`.

### 6.4 The what-if panel (D100)
- **Result strip** at the top of the card (sticky inside it below 1200 px): "FIRE in 2032 · age 57 · Saved: 2033" (or the status in words; "Updating…" while fetching, §6.2). The `LiveRegion` (polite) announces the same text after each recompute; "FIRE settings saved" after Save; "What-if cleared" after Reset; a failed Save is announced through `LiveRegion` `alert`.
- **Fields** (labels from `FIRE_FIELD_LABELS`; laid out **2 per row at ≥ 768 px** of the card's width, one per row below; each a labelled number field with a paired native `<input type="range">` under it): **Yearly spend** ($; slider 0 – max($200,000, 2 × the current) step $500), **Withdrawal rate** (%; slider 2–8 % step 0.1), **Inflation rate** (%; 0–8 % step 0.1), **Market return** (%; 0–12 % step 0.1), **Access age** (55–75 step 1), **Extra savings a year** ($, signed; slider −$50,000 to +$100,000 step $1,000). **Each slider's range extends to include the current value** (e.g. a negative inflation, an access age of 50, a withdrawal rate of 9 %). The number fields accept any value inside the query bounds (§4.3); out-of-range input shows the field error and sends nothing.
- **The field is the source of truth; the slider only reports user input.** A value off the slider's step (a derived spend of $41,237) is shown as is and starts no what-if; moving the slider snaps to its step. A cleared field reverts to the value in use on blur and sends nothing.
- **Sliders:** `accent-color: var(--teal)`, a 4 px `--raised` track, the teal focus ring, a 44 px hit area below 768 px (in `fire.css`); `aria-labelledby` the field's label and `aria-valuetext` in §8 format ("4.0%", "$42,500 a year", "age 60"). Arrows step; Page Up/Down move 10 steps and Home/End go to the ends, **handled explicitly** in the component (browsers differ); jsdom has no range keys, so the unit tests call the handler and the Chromium e2e presses the keys.
- Each field starts at the value in use (saved setting, else derived, else default) and shows "Saved: X" (muted) once changed; a field that equals its saved value (normalised decimal compare) sends nothing. **When the saved or derived values change** (the 60 s refetch, a Settings save elsewhere): untouched fields follow the new values, touched fields keep theirs.
- **Live recompute:** changes are debounced 250 ms, then `useFire(query)`; the results keep their place (§6.2).
- **Enter never saves.** The panel is not a submitting form: Enter in a field commits the field (as `useDraftInput`) and recomputes at once; **Save** and **Reset** are `type="button"`. A test: Enter in each field sends one GET and no PATCH.
- **Save as my settings** (primary; enabled when anything differs): above the buttons, a summary of what will be saved ("Saves: yearly spend $42,000 · access age 62"), plus, when spend is included, "Your spend will stay at $42,000 until you choose Use the derived figure." and, when the return is included, "Sets a return for FIRE only; the Investing return is unchanged." Save PATCHes the changed fields' keys (`FIRE_WHAT_IF_FIELDS`); success → the what-if clears, the page shows the saved plan, **focus moves to the "What if" heading** (`tabIndex={-1}`); failure → the what-if is kept, the error is announced and shown under the buttons. The panel carries the note "Saving never blocks re-importing the workbook." (D103; every key is a preference).
- **Reset** (secondary; enabled only when a field differs from its value in use): back to the saved values, no request; focus moves to the "What if" heading.
- **Use the workbook's figure / Use the derived figure** (item 6): after success focus moves to the row's value (`tabIndex={-1}`), since the button itself disappears.
- **Validation errors** from the server map to the field by path.

### 6.5 ui additions (additive, each with tests and a Scaffold note)
- **`LineChart`/`AreaChart` (web-fire):** `markers?: { index: number; label: string; tone: HeroNodeTone }[]` drawn as ECharts `markLine`s per §5 (dashed `--text-muted` line, the dot lane above the plot, labels inside the plot, dots only below 768 px or when crowded). `Series.dashed` already exists (Stage 5; its `dashed-line` legend key too). The Scaffolder adds the prop type, the pass-through in `ChartComponents.tsx` (ignored until web-fire implements `options/line.ts`) and registers `MarkLineComponent` in `packages/ui/src/charts/echarts.ts`; web-fire adds a ui render test that a marker's SVG line and label exist.
- **`MilestoneLine` (web-fire)** (`packages/ui/src/brand/MilestoneLine.tsx`, exported from the brand barrel): props `nodes: { key: string; tone: HeroNodeTone; position: number /* 0–1 */; label: string; sublabel?: string }[]`, `segments?: { from: number; to: number; label: string }[]`, `orientation?: 'auto' | 'horizontal' | 'vertical'` (auto: vertical when **its container** is narrower than 768 px, a container query), `ariaLabel`. A 1 px `--hairline` line; nodes are 10 px dots in the node's brand colour (the caller passes them in the fixed spectrum order; **no glow**: this is a data display, not the hero); labels in text tokens; colliding labels (nodes closer than 64 px) stack. Its css lives in `brand/milestone.css`, which the Scaffolder creates empty and `@import`s from `brand/brand.css` (the ui package wires every stylesheet through that chain).
- **`StatTile.footer?: ReactNode` (Scaffolder contract, then web-polish-ui's file):** rendered under the hint, for a meter and the "Saved:" line; web-fire only passes it.

### 6.6 Phone (375 px) and the 768–1199 px range (FIRE page)
- One column; tiles stack; the milestone line vertical; the what-if fields one per row with the slider full width and the result strip sticky; buttons full width; **no horizontal page scroll**.
- **Status-first orders:** Year by year: Year, Phase, Pre-super (end), Super (end), Age, Pre-super (start), Saved, Spent, Top-up, Pre-super growth, Super (start), Contributions + top-ups, Super growth, Withdrawn; the months used: Month, Counted spend, Spend, Income, Counted savings.
- **768–1199 px:** the year-by-year table scrolls inside its container with Year sticky (14 columns); the months-used table and the how-it's-worked-out tables fit without inner scroll at 1024 px; the tiles take 3 of 6 columns; the what-if card is full width after the chart.

### 6.7 Settings page (web-polish-pages)
- The FIRE group: title "FIRE", the preference note "Kept when you re-import", used-on links to FIRE; `SettingDto.notice` renders as a muted line under the field (the D98 note; the workbook contribution note).

### 6.8 Text updates
Every user-facing "Stage 6" text becomes present tense ("Used by the FIRE planner (Stage 6)" in Settings; the placeholder page is gone). A web test renders every page with its fixtures and asserts no page shows "Stage 6" (the Stage 5 `noStage5.test.tsx` extended; "Stage 7" stays allowed).

### 6.9 The polish pass (D104; web-polish-ui for `packages/ui`, web-polish-pages for `apps/web`, unless marked; every item has a check)
**Phase A page lists exclude `/fire`:** while web-fire builds the page, the shared page-wide tests (`states.test.tsx`, `formatAudit.test.tsx`, the no-"Stage 6" test, the router's lazy-route test) list every page except FIRE; web-fire covers FIRE's skeleton, error and format checks in its own `pages/fire/**` tests; the Integrator adds FIRE to the shared lists in phase B.

**A. Loading skeletons.** `@joinr/ui` gains `Skeleton` (`variant: 'text' | 'tile' | 'card' | 'table' | 'chart'`, `lines?`; `--surface` blocks with a 1.2 s opacity pulse, none under `prefers-reduced-motion`; `aria-hidden`). The web's **`PageSkeleton`** (`components/QueryStates.tsx`; props `label`, `layout: 'dashboard' | 'table' | 'form'`) renders the page header area, four tile blocks and two card blocks (dashboard), a table block (table) or field blocks (form), plus the existing visually-hidden `role="status"` label ("Loading net worth…"). **Every data page** uses it for the first load instead of the bare `Loading` line (18 call sites today: Budget, Cash, Dividends, History, Import (2), Holding detail, Investments (2), Net Worth, Other Assets, Prices, Property, Records (2), Settings, Side Income, Super) and FIRE (web-fire). The lazy routes' pending wrappers use the same layout per route (§6.1). Refetches keep dimming, never skeleton (STYLE_GUIDE §6.2). *Check:* a web test renders every page with a never-resolving fetch and asserts the skeleton and its status label, and no `jf-app-loading` line; `Skeleton` ui tests (reduced motion: no animation).
**B. Error states.** Every page shows `LoadError` with **Try again** on a failed first load, and a failed refetch keeps the last data with a `Callout important` "Couldn't refresh: <message>. Showing the figures from 14:32." (instead of replacing the page). **`LoadError` moves from the `do-not` tone to `important`** (STYLE_GUIDE §5 keeps "Do not" for destructive actions), its tests updated. *Check:* a web test renders every page with a 500 response (and with a 500 after a first success) and asserts both.
**C. Empty states.** A page with no data at all shows one plain sentence and the next action (link), never an empty table skeleton or a $0 chart:
   - **Dividends with no holdings (STYLE-13):** the Add dividend button stays visible but disabled with the reason beside it: "Add a holding on the ETFs, Stocks or Managed Funds page first; each dividend belongs to a holding." (links).
   - **Side income chart (STYLE-15):** no recorded period → "Side income is grouped by recorded month; it appears after the first recorded month." ; no streams → "No side income yet. Add a deposit to start."
   - **All-zero charts (STYLE-5, web-polish-ui):** a chart whose every value is 0 or null shows its `emptyMessage` (default "Nothing to chart yet.") instead of one $0 point. **Distinct tick labels:** a shared `compactAxisFormatter(extent: readonly [number, number])` in `packages/ui/src/charts/format.ts` returns a compact formatter whose precision keeps adjacent ticks distinct for that axis extent (the Scaffolder adds it as a stub returning `compactMoneyFormatter`; web-polish-ui implements it); `options/bar.ts` (web-polish-ui) and `options/line.ts` (web-fire) call it for money axes.
   *Check:* ui tests (all-zero bar, line, area and stacked charts → empty message; a 0–$4 range has distinct labels); web tests for the Dividends and Side Income fixtures.
**D. Phone-width audit (375 px).** Every route (the 18 in `PAGES` plus holding detail, import run, records entity, styleguide) on the synthetic import, plus the `firePages` fixtures (mocked): no page-level **horizontal** scroll (`scrollWidth ≤ 375`), tables scroll inside with the first column sticky, form submit buttons at least 0.9 × the form's width, fields and tiles sharing one left edge (one per row, stacked). **STYLE-6:** `KeyValueTable` labels never split a word (`overflow-wrap: normal; word-break: normal; hyphens: manual`); **below 480 px of the table's container** (a container query) each row stacks, the label strip above the value, both full width (the fixed two-column layout cannot fit a long uppercase label at 375 px). **STYLE-11:** a chart's table view inside a half-width card either fits or scrolls with its sticky first column **below** the header row (header cells `z-index` above body cells, the sticky header cell opaque `--raised`), so the sticky column never shows through or under the next header. *Check:* ui tests (the longest registry label in a 343 px container stacks and does not overflow); the `polish.spec.ts` e2e (§7.7) visits every route at 375 and at 1024 and asserts no horizontal page scroll, no split words in KV labels (each label's `scrollWidth ≤ clientWidth` and computed `word-break: normal`), the button and left-edge rules at 375, and for every table scroller, after scrolling it 40 px: `document.elementFromPoint` just inside the sticky header cell returns that cell, its computed background alpha is 1, and just below the header row in the first column it returns a body cell (header cells stack above body sticky cells).
**E. Alignment (STYLE-7).** `KeyValueTable` values are left-aligned in every row; numbers inside a value use the monospaced tabular figures (`Amount` or `.jf-num`), so phrase rows and number rows share one edge. `KeyValueItem.numeric` keeps meaning "mono", and inside a KV the value's alignment is `text-align: inherit` (a rule scoped to KV values; `.jf-num` elsewhere stays right-aligned). **This is an exception to STYLE_GUIDE §10's "numbers right-aligned"**: the coordinator adds it to STYLE_GUIDE §5 and §10 at stage close. *Check:* a ui test asserts the value cell's computed `text-align: left` for both kinds; the loan card fixture renders with no right-aligned value.
**F. Keyboard access.** The skip link (exists) and: every interactive control is reachable in DOM order with a visible `:focus-visible` ring (the teal 2 px outline) — `Segmented`, the Chart | Table toggle, `<details>` summaries, sliders, sort buttons, inline Edit/Delete buttons; **Escape** closes inline editors, confirms and the phone nav drawer, returning focus to the opener; no keyboard trap; forms submit with Enter, **except the FIRE what-if** (Enter recomputes, §6.4); a control that disappears after use moves focus to a stated target (§6.4). *Check:* web tests per shared control (Tab order, Escape closes and restores focus) and the `polish.spec.ts` e2e that enters `main` through the skip link and tabs through **every focusable element in `main`** (capped at 60), then a Shift+Tab pass, asserting each has a visible outline (computed `outline-style` not `none`, or a box-shadow ring) and that focus never leaves the document; on FIRE it asserts the view switch, the Chart | Table toggle, every slider and field, Save, Reset and the `<details>` summary are reached.
**G. Number-format audit (STYLE_GUIDE §8).** A web test (`src/pages/formatAudit.test.tsx`) renders every page with every fixture and scans the visible text for: an ASCII hyphen-minus before a digit or `$` in a figure (`/(^|[\s(])-\$?\d/`; the minus is U+2212); ISO dates (`/\b\d{4}-\d{2}-\d{2}\b/`); `NaN`, `undefined`, `Infinity`, `[object`; money with one decimal (`/\$\d[\d,]*\.\d(?!\d)/`); a percentage with two or more decimals outside the documented `formatRate` places (the tax bands, the marginal-rate suggestion and FIRE's real-rate comparison, §6.3); `$-`; a year written `FY2026-27` with a hyphen instead of the en dash. Each hit fails with the page, fixture and text. *Check:* the test itself; the Verifier runs it.
**H. Route-level code splitting.** §6.1 lazy routes and Vite's `build.rolldownOptions.output.codeSplitting.groups` with explicit priorities and **separator-agnostic** tests (Windows paths): `zrender` (`/[\\/]zrender[\\/]/`), `echarts` (`/[\\/]echarts[\\/]/`), `react` (`react`, `react-dom`, `scheduler`), `tanstack` (`@tanstack/*`); zrender gets its own group because echarts and zrender together exceed 500 kB. *Check:* `pnpm build` prints no chunk-size warning (every chunk < 500 kB **minified**); the app entry chunk (`index-*.js`) size is recorded with a target of < 300 kB minified (a miss is reported with the chunk list, not a failure); if echarts alone still exceeds 500 kB, the limit is raised for that chunk only with a recorded reason (a Scaffold note); the prod bundle (Verifier §10 #11) serves every route by deep link and after client navigation (no 404 on a chunk); a web test asserts `router.tsx` statically imports no module under `src/pages/<folder>/` except `NotFoundPage` and `ErrorPage` (`pages.ts`, the route registry, and `layout/**` are allowed).
**I. Other pages' polish is limited to A–H.** No behaviour change on any Stage 1–5 page; every existing test keeps passing (updated only where it asserted the old loading line, the `LoadError` tone or the old placeholder).

---

## 7. Roles, tasks and FILE OWNERSHIP

### 7.0 Rules (all agents; Stages 3–5 §7.0 carried over)
- **Ownership:** edit only files you own (§7.1). Need a change elsewhere? Report it; the coordinator routes it. Never work around a contract gap in another owner's file.
- **Frozen contracts:** §2.2, §3.2–3.4 (keys, constants, the upgrade function), §4 (endpoints, query schema, DTO fields). Internal modules are free; changing frozen names, fields or signatures needs the coordinator's approval and a Scaffold note.
- **No installs** after the Scaffolder; a missing package → stop and report.
- **Stubs** the Scaffolder creates become the named owner's files; replace them in place.
- **Scoped runs** while others work (§1.4); keep your files compiling at every step.
- **Privacy:**
  - Never paste owner values (from the workbook, an owner import's API, `docs/private/`) into a tracked file, test, fixture, comment or doc. Run `pnpm guard:all` before you finish.
  - A guard hit on a value you believe is generic means **change your value**. Never edit `docs/private/guard-terms.txt`; report the hit.
  - **No snapshot files**; assert explicit fields.
  - Anything printed from an owner import (FIRE figures, years, ages, rates, API bodies) stays in git-ignored `artifacts/` or `docs/private/`; reports give counts and template cell refs only.
  - **Golden tests** hold template cell addresses and rules only (§9).
- **Never on `data/`:** no agent starts a server on `data/` (its first start would run the D98 one-off, which is re-import-safe but is the owner's to see at the demo). Every server an agent starts uses its own `DATA_DIR` (§8); `AUTO_RECORD` is never set.
- **Coordinator pre-step** (before the Scaffolder): stop any running dev server; back up `data/finance.db*` to a git-ignored `data/backups/pre-stage6-<date>/` (done 2026-09-27); append the terms of `docs/private/stage-6-private.md` §8 and §8.1 to `docs/private/guard-terms.txt`; re-run `pnpm guard:all` (it must stay clean). Apply the owner's answers to §14's questions (the Plan review log).

### 7.1 Ownership table (every new or changed Stage 6 file has exactly one owner)
| Owner | Files |
|---|---|
| **scaffolder** | **Schema:** `packages/schema/**` (`src/fire.ts`, `settings.ts` (keys, defaults, labels, groups, editable, preferences, write bounds), `dto/fire.ts`, `dto/settings.ts` (`notice`), `index.ts` exports, `fixtures/{fire,coverage,index,sampleDtos}.ts`, `testing/seed.ts` (the fire rows, `seedFireReplacedAge`), schema tests). **Engine contract:** `packages/engine/src/types.ts`; `packages/engine/src/index.ts` (stubs + `engine` + `FIRE_ENGINE_IMPLEMENTED`; → engine). **Server stubs:** `apps/server/src/routes/fire.ts` (both routes 501; → server-api), `apps/server/src/fire/{inputs,page,upgrade,workbook}.ts` (the frozen `applySettingUpgrades` as a no-op; → server-api), `apps/server/src/app.ts` (the route registration and the `applySettingUpgrades` call; → server-api), `apps/server/src/cashflow/context.ts` (`fireDerived` member stub; → server-api). **ui contract:** `packages/ui/src/charts/types.ts` (`markers`; → web-fire); the pass-through lines in `packages/ui/src/charts/ChartComponents.tsx`, the `MarkLineComponent` registration in `packages/ui/src/charts/echarts.ts`, the `compactAxisFormatter` stub in `packages/ui/src/charts/format.ts`, `StatTile`'s `footer` slot (rendered under the hint) and the `Skeleton` stub + barrel export (all → web-polish-ui); `packages/ui/src/brand/MilestoneLine.tsx` stub, the `brand/index.ts` export and an empty `brand/milestone.css` (→ web-fire) with its `@import` line in `brand/brand.css` (→ web-polish-ui). **Web stubs:** `apps/web/src/router.tsx` (the typed `/fire` route to `pages/fire/FirePage.tsx`; → web-polish-pages), `apps/web/src/pages/fire/FirePage.tsx` and an empty `pages/fire/fire.css` imported by it (→ web-fire), `apps/web/src/components/QueryStates.tsx` (`PageSkeleton` rendering the `Loading` line; → web-polish-pages). **Pre-emptive guard fix:** the two generic numbers in the styleguide gallery (`apps/web/src/pages/styleguide/CoreSection.tsx`, `ChartsSection.tsx`) that equal an existing private term once their `_` separators are removed become other generic numbers (FEAS-3; the private §8.1 names them), so tooling's hardened guard starts clean. **Compile and expectation fixes the contract forces** (each in the Scaffold notes; → the file's owner afterwards): `apps/server/src/settings/readers.ts` (the two new keys, `[]` until server-api fills them), `apps/server/test/investments/helpers.ts` and every other `EngineApi` fake (neutral fakes for the 3 new members), `packages/engine/test/api.test.ts`, the registry-count, `fire.preservationAge`-default and FIRE-group-label assertions in server and importer tests, `apps/web/src/router.test.tsx` (`/fire` typed). |
| **engine** | `packages/engine/**` except `src/types.ts`: `src/index.ts` after scaffolding, `src/fire.ts`, `src/fireSheet.ts`, `test/{fire,fireSheet,fire.handworked}.test.ts`, `test/golden/{fire.golden.test.ts,fireAdapter.ts,fireFormulas.ts,fireTally.ts}`, `test/purity.test.ts` (the new modules). |
| **server-api** | `apps/server/src/fire/**`, `src/routes/fire.ts`, `src/app.ts`, `src/cashflow/context.ts` (`fireDerived`), `src/settings/{page,readers}.ts` (notices, readers), `src/routes/import.ts` and `src/cli/import.ts` (the upgrade call). **Post-scaffold owner of `packages/schema/**`** (fixes another agent reports; each needs the coordinator's OK and a Scaffold note). **Tests:** `apps/server/test/**` except `test/lib/**` and the CODE-9 call sites' own tests (tooling) — in particular `test/fire/**` (incl. the fixture-consistency test, §3.6), `test/settings/**`, `test/golden/fire.golden.test.ts`, `test/{app,import-routes,cli-import,db}.test.ts` where the upgrade call or the counts change them, the `EngineApi` fakes after scaffolding; `packages/importer/test/**` after scaffolding (the registry counts) incl. the new `fire-preferences.test.ts` (the D103 keep rule on `fire.*`, a second import keeps an app `fire.*` row with the info line). **Docs:** `README.md` (`/api/fire`, the POST, the D98 one-off), `docs/ARCHITECTURE.md` (the FIRE engine, the upgrade hook). |
| **web-fire** | `apps/web/src/pages/fire/**` (+ `fire.css`, + tests), `apps/web/src/api/hooks.ts` (`useFire`, the POST mutation, the invalidation additions; + its tests), `packages/ui/src/charts/{options/line.ts,types.ts}` (+ tests), `packages/ui/src/brand/{MilestoneLine.tsx,milestone.css,index.ts}` (+ tests), drafts of `e2e/{fire.spec.ts,fire-states.spec.ts,fire-mutations.spec.ts,fire-support.ts}`. |
| **web-polish-ui** | `packages/ui/src/core/**` (`Skeleton`, `StatTile` after scaffolding, `KeyValueTable` (STYLE-6, 7), `ColumnTable` (STYLE-11), the focus ring, `content.css`), `packages/ui/src/charts/**` except `options/line.ts` and `types.ts` (`ChartComponents.tsx`, `ChartCard.tsx`, `EChart.tsx`, `echarts.ts`, `format.ts` (`compactAxisFormatter`), `options/{common,bar,donut,gauge}.ts`, `charts.css`; STYLE-5, STYLE-11), `packages/ui/src/brand/brand.css`, `packages/ui/src/index.ts`, and the styleguide gallery entries for `Skeleton`, `MilestoneLine` and the tile footer (`apps/web/src/pages/styleguide/**`). |
| **web-polish-pages** | `apps/web/src/**` except `pages/fire/**`, `pages/styleguide/**` and `api/hooks.ts`: `router.tsx` (lazy routes, route modules, pending wrappers), `components/**` (`PageSkeleton`, `LoadError`'s tone, the refetch-error callout), every other page folder (§6.9 A–G, the Settings FIRE group and notices §6.7, the text updates §6.8), `layout/**`, `app.css`, `pages/PlaceholderPage*` (removed), the new `src/pages/formatAudit.test.tsx`, `src/pages/states.test.tsx`, `src/pages/noStage5.test.tsx` (→ extended to Stage 6); `apps/web/vite.config.ts`. |
| **tooling** | `tools/privacy-guard/**` (separator hardening + tests), `playwright.config.ts` (retries 2 on `desktop` and `phone`; the `fire-mutations` project after `history-mutations`; `desktop`/`phone` ignore `fire-mutations.spec.ts`), drafts of `e2e/{polish.spec.ts,audit-support.ts}`, the `retries: 0` line on `e2e/import.spec.ts`'s mutating test. **CODE-9:** `apps/server/src/lib/**`, `apps/server/test/lib/**`, and the call sites of §4.5 (`investments/format.ts`, `market/fxHistory.ts`, `market/providers/fake.ts`, `assets/responses.ts`, `assets/otherAssets.ts`, `assets/mutations/common.ts`) with any file importing their moved helpers and those files' own tests (none of them is a server-api file; a clash is reported, not worked around). |
| **integrator** (phase B) | Takes over web-fire's and tooling's e2e drafts and `playwright.config.ts`, plus **every other `e2e/**` file** for integration fixes (skeletons, lazy routes, the Settings FIRE group label, the placeholder removal: each edit listed in its report), incl. `e2e/{ui-core.spec.ts,import.setup.ts,support.ts}`; after engine, server-api and tooling report done, their files pass to the Integrator for integration fixes only (each listed in its report). Web and ui files stay with web-fire, web-polish-ui and web-polish-pages until they report done; then the Integrator may fix integration defects in them (listed) and adds `/fire` to the shared page lists (§6.9). |
| coordinator | `PLAN.md` · `docs/HANDOFF.md` · `docs/DECISIONS.md` · `docs/STAGE_PROCESS.md` · `docs/stages/**` (implementers append only to "Scaffold notes") · `CLAUDE.md` · `docs/style/**` (the STYLE_GUIDE §7.2 note on the MilestoneLine and colour by position, §6.2 skeletons, the §5/§10 KV alignment exception of §6.9 E) · `docs/private/**` · `reference/**` · `.claude/launch.json` |

### 7.2 Scaffolder (alone; done-check before hand-over)
1. **Schema** per §3.2–3.3 and §3.6: `src/fire.ts`; `settings.ts` (the two keys, the defaults and labels, the `fire` group of 8, `EDITABLE_SETTING_KEYS` = 62 with the Stage 5 order kept and the two appended, `PREFERENCE_SETTING_KEYS` = 21, the write bounds); `dto/fire.ts` (the query schema, every DTO field by field); `SettingDto.notice` (every existing builder and fixture sets it to null); fixtures (every `firePages` state internally consistent, produced from `artifacts/stage6/plan-reviser/model2.ts` with the recorded inputs, §3.6; the hand-worked example's figures for `onTrack`), coverage, seed. **Tests:** the query schema (every bound, strictness, coercion, the ratio strings), the registries (63 keys, 62 editable, 21 preferences, the groups partition 63, distinct labels, `fire.preservationAge` default 60, the new keys app-only, the labels sharing `FIRE_FIELD_LABELS`' words), the write bounds (each new key at its bounds and one step past), fixture parsing and adding up (each row: end = start + flows within 1 cent; milestones in time order; `whatIf` has a baseline; every fixture has recorded inputs).
2. **Engine skeleton:** `types.ts` complete (§2.2); `index.ts` stubs, `engine`, `FIRE_ENGINE_IMPLEMENTED = false`; the type-level test that `engine` satisfies `EngineApi`; the compile fixes (§7.1).
3. **Server stubs:** `routes/fire.ts` answers 501 `NOT_IMPLEMENTED` (`no-store`) on both routes, registered in `app.ts` with the cash-flow options; `fire/upgrade.ts` with the frozen signature (a no-op returning `[]`), called by `buildApp`; `context.ts` `fireDerived` throwing 501 until implemented; `settings/readers.ts` compiling with the two new keys.
4. **ui and web stubs:** the `markers` prop type and pass-through, `MarkLineComponent` registered, the `compactAxisFormatter` stub, `StatTile.footer`, `MilestoneLine` and `Skeleton` stubs (render nothing but their `aria` label / an empty `div`), the empty `milestone.css` imported from `brand.css`, `PageSkeleton` (renders `Loading`), the typed `/fire` route to a `FirePage` rendering `PageHeader` "FIRE" and a `Callout note` "Arrives with the web work", with the empty `fire.css` imported; the two styleguide numbers changed (§7.1).
5. **Done-check** (all green): `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` (≥ the 3834 Stage 5 tests + new), `pnpm build`, `pnpm guard:all`; `PORT=3370 WEB_PORT=5370 DATA_DIR=artifacts/stage6/scaffolder/data pnpm e2e e2e/smoke.spec.ts e2e/ui-core.spec.ts` passes on a fresh folder (the short-page list still `['/fire']`: the stub is short); `/api/health` → `migrations: 6`; `DATA_DIR=artifacts/stage6/scaffolder/data pnpm seed:dev --yes` exits 0; ports free afterwards. Append "Scaffold notes" with every deviation.

### 7.3 engine
1. `fire.ts` — **`deriveFireInputs`** (§2.4): pre-super with one and two primary residences, an investment property, linked and unlinked offsets, accounts in debit (net worth − super − home value; `debtCents` = Σ liabilities; the alternative adds back the **gross** home loan, so a linked offset's cash stays: a test with a linked offset); the window (none, the baseline dropped, the job-start floor, the live period never counted, `through`); spend and savings per period (a negative-spend month floored and its savings capped at income; voluntary super excluded; income-weighted nothing: plain means of unrounded values, rounded once), the raw figures from `SavingsPeriod.raw` (negatives kept, super kept; **a D51 adjustment in the window makes raw ≠ adjusted**); the super contribution over the 12 whole months before `asOf`'s month at a month start, mid-month and in July (the FY boundary), statement and estimate SG, salary-sacrifice and after-tax contributions, contributions outside the months ignored; the growth weights (values ≤ 0 left out, the primary residence never weighted, super at the market rate).
2. **`projectFire`** (§2.5): every `missing` entry and its order, incl. the guards (a birth year after the as-of year, a current age ≥ the horizon, an access age ≥ the horizon, both weights 0 with no rate); `spend_needed` (null, 0, negative); `r` exact vs simple (a test that `(1.0608)/(1.02) − 1 = 0.04` exactly); `r = 0`; `needed`/`projected`/`gap` against hand values; **the debts** (with `L > 0` and a negative `A0`, raising the market return never lowers `projected(t)` through the debt term; `L = 0` reproduces the template's `W`); **the combined rule after access** (`n ≤ 0`, `B0 = 2 × target`, `A0 < 0`, `P = 0` → `fire`; the displayed `needed` never negative); `k = 0` (`fire`), `k` before access with top-ups at `C` and a partial last payment (the §10.1 example), level top-ups (`C = 0`, and `C` too small), no top-ups, `k = n` with `B(n) ≥ target` and with `B(n) < target` (**no lump**: super at access = `B(n)`, the pre-super pot covers the rest, no `top_up` row), FIRE after access (`retired` rows), `n ≤ 0` (access reached), `not_reachable` at the horizon; the rows (every phase, the span `max(n, k) + 1`, each row adding up within 1 cent, the super reaching the target at access within 1 cent when top-ups are used, the draw order after access: super first, pre-super once super is exhausted); KPIs and progress clamps; milestones (order, ties, omissions); `extraSavings` negative flooring `P + X` at 0; the time rules (31 December → 1 January of the same balances: `n` and the ages step by one, §2.1).
3. `fireSheet.ts` (§2.6): the Sheets functions at hand values (Excel/Sheets documentation examples re-derived by hand in the test comments), `ROUNDUP` signs, `IFERROR` texts, the text-above-number ordering, the disclaimer text, `E47` as text; the grid's branches the workbook does not exercise (accumulation `I:K` with `E56 > 0`, top-ups `P:R` with `E64 > 0`, growth `S`) on generic positive inputs, cross-checked with the row identity `N(t) = N(t−1) + K(t)` and `T(t) = T(t−1) + R(t) + S(t)`.
4. `fire.handworked.test.ts`: §10.1 figure by figure (every row of the table, every KPI, both views of the helper, the growth blend with super weighted).
5. **Goldens** (§9): `test/golden/fire.golden.test.ts` (+ `fireAdapter.ts`, `fireFormulas.ts` for the closed-row and sheet-cell recomputations, `fireTally.ts`) with `describeWithLocalWorkbook`, printing counts per area and reason only.
6. Purity: the new modules pass `test/purity.test.ts` and ESLint unchanged.
7. Set `FIRE_ENGINE_IMPLEMENTED = true` only after the full unit suite (goldens included) passes.

### 7.4 server-api
1. **Inputs** (§4.5) with unit tests on a fake engine: every field's source order (query → setting → derived → default → missing), the app-origin-only rule for the super contribution (an import row is `workbookCents`), the market return's `settingKey`, the D98 `replaced` block (present while the value is 60, gone after the owner changes it), the baseline only when a query is given (every `FireSummaryDto` field), `isEmpty`, `preSuperDebtCents` passed through.
2. **`GET /api/fire`**: DTO mapping field by field against hand-built engine results; the type-level assignability tests; 400s for every query bound; `featureOn`; `hasAppData`. **`POST /api/fire/use-workbook-contribution`** (§4.5): import row → POST → `source 'setting'`; idempotent; no row → nothing written; `hasAppData` false.
3. **`applySettingUpgrades`** (§3.4): 65 import → 60 app + marker; a second call → nothing; no row → nothing and no marker, then an import of 65 → replaced; 64 or 66 → nothing; an app row of 65 → nothing; `hasAppData` false before and after; a re-import after the upgrade keeps 60 (`settings.keptAppPreference` in the report) and does not replace again; a forced `--replace-app-data` import keeps it; the dry run never upgrades; the upload route and the CLI call it after a committed import; `buildApp` calls it at start.
4. **Settings:** `SETTING_READERS` for the eight keys and `'fire'` on the other keys FIRE reads (§4.5); `notice` for the two cases; the FIRE group's preference flag; PATCH of the two new keys at their bounds; a PATCH of any `fire.*` key leaves `hasAppData` false (D103); `features.fire` false keeps `/api/fire` answering.
5. **The fixture-consistency test** (§3.6), gated by `FIRE_ENGINE_IMPLEMENTED`: `projectFire` on each `fireFixtureInputs` entry reproduces its `firePages` projection within 1 cent; a mismatch is reported to the coordinator (the fixture is the Scaffolder's contract; server-api fixes it as the post-scaffold schema owner with a Scaffold note).
6. **Integration tests** gated by `FIRE_ENGINE_IMPLEMENTED`, **each with a fixed `now`**: the seed reaches `on_track`; the synthetic workbook (access age 60, the page switched off) builds a full response; a what-if query changes the projection and saves nothing (settings table dump unchanged); PATCH then GET shows the saved plan.
7. **Server golden** (§9.4), gated by `FIRE_ENGINE_IMPLEMENTED` and `describeWithLocalWorkbook`, `{ timeout: 180_000 }`.
8. **Docs:** README and `docs/ARCHITECTURE.md` (generic only).
9. **Done means the gated suites ran**: report "blocked on engine" with everything else green if it has not landed.

### 7.5 web-fire (phase A — parallel; no running API needed)
1. `useFire`, the POST mutation and the invalidations (§6.2), the ui additions (§6.5) with tests and a Scaffold note each; `options/line.ts` calls `compactAxisFormatter` for money axes (§6.9 C).
2. The FIRE page (§6.3), the what-if panel (§6.4), phone and tablet (§6.6), the page's states (§6.9 A–C through `PageSkeleton` and `LoadError`), its styles in `fire.css`.
3. **Unit tests** with mocked fetch on `@joinr/schema/fixtures`: every `firePages` state renders (tiles with their lines, meters and "Saved:" lines, callouts in order and the two-callout cap, milestone nodes present or omitted, merged at `k = n`, coloured by position teal → violet → fuchsia → orange in `onTrack`, `afterAccess` and `fireAtAccess`, the chart views, the tables with their Milestone columns); the teal key figure only on the first tile; the page's own skeleton, first-load error, refetch error and format checks (§6.9 A, B, G; FIRE is out of the shared lists until phase B); the what-if (field and slider in sync, off-step values, a saved `0.0375` showing no what-if, sliders' ranges extended to the current value, keyboard steps through the handler, debounce: one request per burst, only changed fields in the query, "Saved: X", **Enter sends one GET and no PATCH**, Save PATCHes only the changed keys with the right key names, the save summary texts, Reset sends nothing and is disabled when nothing differs, untouched fields following a refetch, server errors mapped to fields, no Loading line while recomputing, `aria-busy` and "Updating…", the `whatIfError` callout, the LiveRegion texts); focus after Save, Reset, Use the workbook's figure and Use the derived figure (`document.activeElement`); "Use the workbook's figure" (the POST) and "Use the derived figure" (PATCH null) bodies; chart colours (slot 1 pre-super, slot 6 super, slot 3 dashed needed) and the validator maths on those pairs; markers' labels and positions, dots only when narrow; the needed-vs-projected table words ("Short by" in the stop tint, "Ahead by" in body text); the phone orders via `matchMedia`; the §8 formats (one-decimal rates, the real-rate "(not X)" rule, U+2212, long prose dates).
4. **Draft** `e2e/fire.spec.ts` (desktop + phone, read-only: h1, tiles against `/api/fire`, both chart views render, the what-if changes the tiles and saves nothing, the slider keys (arrows, Page Up/Down, Home/End) in Chromium, no horizontal page scroll, no console errors, screenshots), `e2e/fire-states.spec.ts` (`mockFirePage` for every fixture at 1440, 1024 and 375), `e2e/fire-mutations.spec.ts` (writes only the two app-only keys and keys it can set back to null: Save as my settings with extra savings and the FIRE market return → `GET /api/import/runs` `hasAppData === false` (D103) → `afterAll` sets both app-only keys back to null; assertions read `/api/fire` rather than fixed sources), `e2e/fire-support.ts`.

### 7.6 web-polish-ui and web-polish-pages (phase A — parallel)
**web-polish-ui** (`packages/ui` and the styleguide gallery):
1. The ui core and charts fixes (§6.9 A, C, D, E; STYLE-5 incl. `compactAxisFormatter` and its use in `options/bar.ts`, STYLE-6's stacking below 480 px, STYLE-7, STYLE-11) with ui tests and a Scaffold note each; the focus ring on every custom control; `StatTile.footer` finished and tested.
2. The styleguide gallery entries (`Skeleton`, `MilestoneLine`, the tile footer).
3. Report to the coordinator any ui change a page needs.

**web-polish-pages** (`apps/web` except FIRE, the styleguide and `hooks.ts`):
1. `PageSkeleton`, `LoadError`'s tone and the refetch-error callout; every page switched (§6.9 A, B); the empty states (C), keyboard (F), the Settings FIRE group and notices (§6.7), the text updates (§6.8).
2. Lazy routes, the route modules and per-route pending wrappers, and code splitting (§6.1, §6.9 H); `PlaceholderPage` removed.
3. **Tests:** `states.test.tsx` (skeleton, first-load error, refetch error for every page except FIRE in phase A), `formatAudit.test.tsx` (§6.9 G, FIRE excluded in phase A), the router tests (no static page imports; the pending wrapper's layout equals the page's skeleton layout per route), keyboard tests per shared control, the extended no-"Stage 6" test, every existing web test green (updated only for the loading line, the `LoadError` tone and the placeholder).
4. Report `pnpm build` output (chunk list and minified sizes) in the Scaffold notes.

### 7.7 tooling
1. **Guard hardening** (§8.2): tests with generic terms only (a digits-only term `12345678` caught as `12_345_678` and `12,345,678`; a digits-only decimal term `123456.78` caught as `123,456.78` and `123_456.78`; **a term that itself contains a separator** (e.g. `4,321`) still matches only as written and **never** matches its plain digits (`4321`, such as a port or a year); no false positive on `1, 234` (a list), `v1.2.3`, `0x12_34`, dates, or a comma inside a longer number that does not group by thousands). Before landing, the `--all` run over the tracked tree must stay clean with the current terms file **and** the Stage 6 terms (the Scaffolder has already changed the two styleguide numbers, §7.1); any other hit is reported to the coordinator, never worked around.
2. **Playwright:** `retries: 2` on `desktop` and `phone` (the `net::ERR_NETWORK_CHANGED` flakes; mutating projects keep 0 retries: a retried mutation could double a write), and `test.describe.configure({ retries: 0 })` on `e2e/import.spec.ts`'s desktop-only committed re-import (it mutates shared data inside a retried project); the `fire-mutations` project; a comment explaining both.
3. **Draft `e2e/polish.spec.ts`** (desktop + phone): every route of §6.9 D at the project's width and at 1024 px (desktop project): no horizontal page scroll, the KV-label, button-width, left-edge and sticky-header checks, the keyboard walk (F), no console errors; and `e2e/audit-support.ts` (the route list from `PAGES` plus the detail routes with ids found through the API).
4. **CODE-9** (§4.5): `lib/dates.ts`, `lib/sums.ts` with tests (month ends, leap days, year ends, the DST days of April and October with `TZ=Australia/Sydney` in that test file, safe-integer overflow), the call sites switched, every existing server test green (`pnpm vitest run --project server`).

### 7.8 Integrator (phase B — starts when engine, server-api and tooling report done; web-fire, web-polish-ui and web-polish-pages report "phase A done")
1. Run the stack on 5385/3385 (fresh `artifacts/stage6/integrator/data`, `MARKET_DATA_MODE=fake`, synthetic import); fix integration defects (other owners' files for integration fixes only, listed); add `/fire` to the shared page lists (§6.9).
2. The e2e files (§7.5 step 4, §7.7 step 3) and any other `e2e/**` file the polish changes break (listed); `e2e/ui-core.spec.ts`'s short-page list becomes empty (the test is kept for its other checks or removed with a note if it only held that list); `import.setup.ts` untouched unless the D98 hook changes its expectations. **Delete the `DATA_DIR` before every full e2e run** (the Verifier does the same), so a reused folder cannot carry app-origin FIRE rows into `fire.spec`.
3. **The prod bundle check:** `pnpm build` (no chunk warning), `pnpm start` on 3385 with a fresh data dir, deep links to every route and client navigation between them (no chunk 404).
4. Run the full e2e suite on your ports (`mutations`, `cashflow-mutations`, `assets-mutations`, `history-mutations` and `fire-mutations` must run and pass; skipped counts as failed; read-only flakes may pass on retry and are listed), then `pnpm test` once more and confirm the gated suites **ran** (not skipped); screenshots under `artifacts/screenshots/{desktop,phone}/fire-*.png` and `polish-*.png`; write the final report.

### 7.9 Reviewers (report findings; do not edit)
- **spec-correctness:** the engine vs spec 04 §5 and this plan; D97–D104 and D68 applied; every §11 fix present and nothing else changed; the hand-worked example reproduced; run the goldens and check every §9.2 area is compared or skipped only for a §9.3 reason, with the counts in `docs/private/stage-6-private.md` **§2.1**; check the owner expectations of the private §4 on `artifacts/stage6/review-spec/data` (a copy of the pre-Stage-6 backup, `MARKET_DATA_MODE=off`) **through a git-ignored scratch script** (`artifacts/stage6/review-spec/`) that builds the app with `buildApp({ now: () => <the private §4 instant> })` and calls `GET /api/fire` with `app.inject`, printing pass/fail only (the wall clock would move the D99 window, the age and `n`); the D98 one-off at its first start (the log line: a `pnpm start` is fine for that alone); the Stage 2–5 figures unchanged; no owner values in tracked files.
- **style-ux:** screenshots at 1440, 1024 and 375 of the FIRE page (every fixture state, the what-if in use, both chart views) and of every other page (the polish items A–H); STYLE_GUIDE §1–§10 and D6, D7, D17–D20, D31, D33, D101 (one teal figure per page, the node-line motif in the fixed spectrum order by position with no glow in the chart, status never colour-only, red only for shortfalls and negatives, §8 formats, no horizontal page scroll at 375, status-first tables, the focus ring visible everywhere, skeletons never on refetch, the what-if results visible while a slider moves).
- **code-quality/security:** query validation and bounds; the upgrade's and the POST's transactions, idempotency and their D34/D103 effects; no figures in logs; engine purity and decimal-only maths; the guard hardening's false-positive tests (incl. a term with a separator never matching its plain digits); the lazy-route error paths (a failed chunk load reloads once, then shows `ErrorPage`, never a blank screen); test isolation (temp DBs, fixed `now`, no network, no snapshot files, never `data/`); gating flags never faked. A **scratch numeric scan** (`artifacts/stage6/review-code/`, found/not found per file, with `,` and `_` separators removed from both sides) of the tracked diff against every number with ≥ 4 significant digits in `docs/private/stage-6-private.md`; leave it for the Verifier.

### 7.10 Fixer and Verifier
- **Fixer:** applies the verified findings across owners; contract changes only with the coordinator's approval (Scaffold note); re-runs the affected checks.
- **Verifier:** runs §10 on 5396/3396 with per-item `DATA_DIR`s under `artifacts/stage6/verifier/` (never `data/`); reports pass or fail with evidence; never commits; no owner values in tracked files.

---

## 8. Ports, environment and tooling

### 8.1 Ports & environment
No new environment variable. Playwright keeps `MARKET_DATA_MODE=fake`, `PRICE_REFRESH_MINUTES=0`, `IMPORT_CORRECTIONS_FILE=none`; `AUTO_RECORD` is never set.

| Agent | WEB_PORT | PORT | DATA_DIR |
|---|---|---|---|
| default / owner / `.claude/launch.json` | 5173 | 3001 | `data` (never used by agents) |
| Scaffolder | 5370 | 3370 | `artifacts/stage6/scaffolder/data` |
| engine, web-polish-ui, tooling | — (tests only; tooling's e2e drafts run on 5387/3387, `artifacts/stage6/tooling/data`) | — | — |
| server-api | 5383 | 3383 | `artifacts/stage6/server-api/data` |
| web-fire | 5384 | 3384 | `artifacts/stage6/web-fire/data` |
| web-polish-pages | 5386 | 3386 | `artifacts/stage6/web-polish-pages/data` |
| Integrator | 5385 | 3385 | `artifacts/stage6/integrator/data` |
| Reviewers spec / style / code | 5391 / 5392 / 5393 | 3391 / 3392 / 3393 | `artifacts/stage6/review-{spec,style,code}/data` |
| Fixer | 5394 | 3394 | `artifacts/stage6/fixer/data` |
| Verifier | 5396 | 3396 | `artifacts/stage6/verifier/{e2e,owner,prod}` |

- **Dev-server lessons (HANDOFF):** stop the owner's `pnpm dev` before agent work; under the Claude preview the server gets the preview port on 127.0.0.1 beside Vite on ::1, with a cold start of up to ~30 s; confirm ports are free before and after; servers on other ports may belong to other projects on this PC (check the command line before stopping one). **Run every command from the repo root.** Under Git Bash set `MSYS_NO_PATHCONV=1` when an environment value is a path.
- **An owner-data copy for reviewers:** copy `data/backups/pre-stage6-<date>/finance.db*` (never `data/` itself) into the reviewer's `DATA_DIR`; its first start runs the D98 one-off there.
- The Browser pane is about 800–1024 px wide; check that range as well as 1440 and 375 px. A range input needs `form_input` or keyboard arrows; a custom select a real click after `form_input`.
- Unit tests use OS temp dirs or `:memory:`; never `data/`.

### 8.2 Tooling (D104)
- **Guard hardening** (`tools/privacy-guard/src/rules.ts`, `scan.ts`): **digits-only** private terms (matching `^-?\d+(\.\d+)?$`) also match numbers written with separators. The scanner finds, per file, only the text runs that **contain** a separator grouping — a thousands grouping `\d{1,3}(,\d{3})+(\.\d+)?` or a digit-separator run `\d+(_\d+)+(\.\d+)?` — removes their `,`/`_` and matches the result against the digits-only terms with the same alphanumeric boundaries (an index map keeps the original positions); findings report the original location and the term's line, as today. Runs without a separator are matched exactly as today (the existing matcher), and **a term that itself contains a separator is never turned into a plain form**: it keeps matching only as written, so such a term never hits a port, a year or a count written plainly. A plain comma list (`1, 234`), version strings, hex literals and non-grouping commas are untouched. The Stage 4 scratch `guard-separators.mjs` is the reference for what it must catch; the critic's simulation (`artifacts/stage6/critic-feas/simguard.mjs`) for what it must not.
- **e2e retries:** §7.7 step 2. The HANDOFF re-run recipe stays for the rare run that still fails after retries.

---

## 9. Golden values & tests (read at runtime; nothing committed)

### 9.1 The adapter (`packages/engine/test/golden/fireAdapter.ts`)
Reads the local workbook inside `describeWithLocalWorkbook` (no corrections file) and reuses the Stage 3 cash-flow adapter.
- **The FIRE tab:** the sheet whose name starts with `FIRE_TAB_PREFIX`; inputs `E6`–`E10`, `E45`–`E49` (cached values; `E47` may be text); outputs `D2`, `V3`, `E52`–`E57`, `E60`–`E64`, `C15:E16`; the grid `G4:X` down to the last row with a year in `G`. **TODAY** = `Net Worth!E52`. **Salary** = SheetOptions ID 4 through the column-P lookup (never IDs 1 or 29); **disclaimer** = `SheetOptions!B49 = "Yes"`.
- **Sources for the inputs:** `Cash!H`/`N`/`P` rows, `Net Worth!C51` (last run), `C4:C8`, `C10`, `D16`, `E23`, `Property!D17:O17`/`D19:O19`, SheetOptions IDs 11 and 25 (`L13`, `L27`).
- **The app's raw path:** `deriveFireInputs` on the Stage 3 adapter's savings periods and cash KPIs (and neutral stand-ins for the figures, classes, properties and super, which the raw savings and spend do not read).
- **Golden-only helpers** (`fireFormulas.ts`): the sheet's `E45` from its cells; the sheet's `E49` blend; `E47`/`E48` over the rows dated after `C51 − 365`/`− 366`, both over **all** rows (the sheet's own, to validate the helper) and over the **closed** rows without the baseline row (the app's window).

### 9.2 Cells compared (template references; each read at runtime)
| Area | Cells | Engine output |
|---|---|---|
| **A. Sheet mode — headline and forecasts** | `D2`, `V3`, `E52`, `E53`, `E54`, `E55`, `E56`, `E57` (year), `E60`, `E61`, `E62`, `E63`, `E64` | `fireSheet(inputs).cells` |
| **B. Sheet mode — KPI table** | `C15`, `D15`, `E15`, `C16`, `D16`, `E16` | `fireSheet(...).cells` |
| **C. Sheet mode — the grid** | every grid row's `G`–`T`, `V`–`X` | `fireSheet(...).rows` |
| **D. Raw input path** | `E47`, `E48` (rules 3, 4) | `deriveFireInputs(...).savings.rawYearlyCents`, `.spend.rawYearlyCents` |
| **E. Sheet inputs from their sources** | `E45`, `E46`, `E49` (rule 5) | the helpers (adapter validation; `E46` against the Stage 4 super total at `E52`) |

### 9.3 Rules detected at runtime (no row numbers hard-coded)
1. **Values:** numbers within the §9.5 tolerances; texts exactly (`"You're FIRE! ✅"`, `"-"`, `""`, `"… Years to go"`); dates (`E57`, `G`) as calendar years; a cell holding an error value compares with the sheet mode's `"-"` only where the template wraps it in `IFERROR`.
2. **`no_formula`:** grid cells without a formula are skipped and counted (detected at runtime, no addresses in the test). **`E64`** is a `DUMMYFUNCTION` wrapper (its `GOOGLEFINANCE` branch): its cached value is compared with the sheet mode computed with the salary; if the cached value is itself an error it is `never`.
3. **`E48`:** the helper over all rows must equal the cached `E48` (adapter check, not counted); the app's `spend.rawYearlyCents` is compared with the helper over the **closed** rows without the baseline, counted `recomputed` (reason `closed_rows`: the sheet's window includes the live row, §11 fix 18).
4. **`E47`:** as rule 3 with `savings.rawYearlyCents`, always compared with the closed-row helper `MAX(mean_closed × 12, 0)` (counted `recomputed`, `closed_rows`): `Cash!C20` covers the sheet's own window, live row included, so a negative `C20` says nothing about the closed-row mean. When the cached `E47` is the text, only the all-rows adapter check is skipped (reason `text_input`, not counted).
5. **`E45`, `E49`:** the helpers from the sheet's own cells equal the cached cells (the sheet's broken tab totals, Stage 2 `broken_total`, flow through both sides unchanged); `E46` equals `Net Worth!C10` and the Stage 4 adapter's super total at `E52`. Counted `recomputed` (reason `sheet_cells`).
6. **The corrected model is not compared with cached cells:** `projectFire` is not compared with any cached cell (`defined_by_decision`: D97–D102 change every input and the model; spec 04 §5.6). The engine golden runs it once as an invariant check (not counted) on inputs taken from the sheet: `birthYear` = `E6`, `inflationRatio` = `E8`, `withdrawalRatio` = `E9`, `accessAge` = `E10` (all cached), `preSuperCents` = `E45` × 100, `preSuperDebtCents` = 0, `superCents` = `E46` × 100, `superContributionPerYearCents` = `E7` × 100, `savingsPerYearCents` = `derived.savings.yearlyCents` and `yearlySpendCents` = `derived.spend.yearlyCents` from the closed-row derivation, weights cash 0 / market 1 with `marketReturnRatio` = `E49`, `asOf` = `E52`; it asserts a status other than `needs_input`, rows that add up and a displayed `needed` never negative. The server golden (§9.4) covers the app-derived path.
7. Every skip and recompute is counted per reason; each golden prints `compared: n · skipped: {no_formula, never} · recomputed: n (by reason: closed_rows, sheet_cells)` per area. The spec reviewer checks the counts against the private **§2.1**; reports and close notes say only "matches private §2.1", never the counts.

### 9.4 Server golden (`apps/server/test/golden/fire.golden.test.ts`)
- Setup: a temp DB; `importWorkbook` of the local workbook with **corrections off**; `applySettingUpgrades` (as the route does after an import); `buildApp` with market `off` and `now` = `E52` at 12:00 local.
- Via `app.inject`:
  - `GET /api/settings`: `fire.preservationAge` = 60 with `origin 'app'` and a `notice` when the workbook's `E10` is 65 (D98), else `E10` with no notice; `fire.birthYear` = `E6`, the inflation and withdrawal rates = `E8`, `E9`; `hasAppData === false`.
  - `GET /api/fire`: `inputs.superContribution.workbookCents` = `E7` × 100 and `source 'derived'` (owner question 1's default); `inputs.accessAge.replaced` present exactly when `E10` was 65; `derived.spend.rawYearlyCents` and `derived.savings.rawYearlyCents` = the closed-row helpers (§9.3 rules 3–4); `projection.status` is not `needs_input`; every row adds up within 1 cent; `whatIfActive === false`.
  - `GET /api/fire?accessAge=65` → `whatIfActive`, `baseline` present, and the settings table dump unchanged afterwards (nothing saved).
  - Re-import the same workbook (not forced) → 201 (`hasAppData` false), the report has `settings.keptAppPreference`, `fire.preservationAge` still 60; a second `applySettingUpgrades` returns `[]`.
- Print counts only.

### 9.5 Tolerances
Cached formula results keep 10 significant digits; every comparison allows `max(listed, 1e-9 × |sheet value|)`.
| Quantity | Tolerance |
|---|---|
| Sheet mode, any number (dollars) | `max(1e-6, 1e-9 × |v|)` |
| Raw path yearly figures (cents vs the helper × 100) | ≤ 12 cents (a once-rounded monthly mean × 12) |
| Helpers vs cached cells (`E45`, `E47`, `E48`, `E49`) | `max(1e-6, 1e-9 × |v|)` |
| Years, counts, texts | exact |

---

## 10. Acceptance tests (the Verifier runs every item)
**Run order and isolation:** never `data/`; confirm 5396/3396 are free and delete each item's `DATA_DIR` first; stop servers between groups. Order: **1–5 → 6 (e2e) → 7–8 (owner copy) → 9–11 → 12–15.**

| # | Check | How |
|---|---|---|
| 1 | Install and static checks | `pnpm install` (no prompts), `pnpm typecheck`, `pnpm lint`, `pnpm format:check`: exit 0 |
| 2 | Unit tests | `pnpm test` green: ≥ 3834 + new; `FIRE_ENGINE_IMPLEMENTED` true; the gated server suites **ran** (`--reporter=verbose`) |
| 3 | No migration | `git diff --exit-code` on `apps/server/migrations/**`; `/api/health` → `migrations: 6` |
| 4 | Engine goldens | `pnpm vitest run --project engine test/golden --reporter=verbose`: every §9.2 area compared; counts per reason match the private §2.1 (compare privately; the report says only "matches private §2.1"); the Stage 2–5 golden tallies unchanged |
| 5 | Server goldens | `pnpm vitest run --project server test/golden --reporter=verbose`: the FIRE golden and the Stage 2–5 goldens ran and passed |
| 6 | e2e | `PORT=3396 WEB_PORT=5396 DATA_DIR=artifacts/stage6/verifier/e2e pnpm e2e`: setup, every Stage 0–5 spec, `fire`, `fire-states`, `polish` on desktop and phone; `mutations`, `cashflow-mutations`, `assets-mutations`, `history-mutations`, `fire-mutations` ran and passed; list any read-only test that needed a retry |
| 7 | Owner data, API | copy `data/backups/pre-stage6-<date>/finance.db*` to `artifacts/stage6/verifier/owner`; start with `MARKET_DATA_MODE=off` on 3396 **only** to see the first start's one upgrade line, then stop. The figures are checked by a git-ignored scratch script (`artifacts/stage6/verifier/owner-check.ts`) on a second fresh copy: `buildApp({ now: () => <the private §4 instant> })` with market off, `app.inject` of `GET /api/settings` (60 with the notice) and `GET /api/fire` (the figures of the private §4: the derived spend, savings, super contribution, their month counts, the pre-super net worth and debts, the growth weights, `status` and the projection), printing pass/fail only. The wall clock would move the D99 window, the age and `n`. The private §4 figures are computed from the spend in whole cents, as the engine receives it. |
| 8 | D103 / D34 on the owner copy | on #7: `hasAppData` false; `PATCH /api/settings` of every `fire.*` key (then restore) → still false; the upload re-import dry run → allowed; restart → no second upgrade line |
| 9 | Hand-worked example (PLAN acceptance) | `pnpm vitest run --project engine test/fire.handworked.test.ts --reporter=verbose`: every figure of §10.1 |
| 10 | FIRE sane on real data (PLAN acceptance) | #7's scratch response (fixed `now`): FIRE year after the as-of year or `fire`, never a negative needed figure, spend and savings positive, the needed-vs-projected lines cross at the FIRE year, rows add up; screenshots at 1440, 1024 and 375 under `artifacts/screenshots/` (git-ignored) |
| 11 | Prod bundle and code splitting | `pnpm build`: no chunk-size warning (every chunk < 500 kB minified, or the one recorded exception, §6.9 H), the chunk list and the entry chunk's size recorded; `PORT=3396 DATA_DIR=artifacts/stage6/verifier/prod IMPORT_CORRECTIONS_FILE=none pnpm start`; deep links to every route serve HTML; client navigation across every page loads its chunk (no 404) |
| 12 | Polish checks | the web `states`, `formatAudit`, keyboard and ui tests ran (in #2); the `polish` e2e ran (in #6) with no horizontal page scroll at 375 on any route |
| 13 | Privacy | `pnpm guard:all` exits 0 (with the Stage 6 terms); the guard's separator tests pass; re-run the code reviewer's numeric scan on the final tracked diff: nothing found (exact matches triaged by hand); no snapshot files |
| 14 | Engine purity | `pnpm exec eslint packages/engine --max-warnings=0` and `test/purity.test.ts` |
| 15 | PLAN acceptance, whole | #9 (hand-worked example), #10 (sane on real data), the phone-width audit (#12), every §11 fix applied and listed in the close notes |

### 10.1 The hand-worked example (generic round numbers; `fire.handworked.test.ts` and the `onTrack` fixture)
**Inputs.** As-of 15/03/2030; birth year 1975 → age 55; access age 60 → **n = 5**. Pre-super **A0 = $150,000** (cash $30,000 and investments $120,000; no debts, **L = 0**); super **B0 = $600,000**. Savings **P = $30,000** a year, **X = 0**; super contribution **C = $20,000**; spend **S = $40,000**; inflation **i = 2 %**; withdrawal rate **wr = 5 %**. The test calls `projectFire` directly with the growth weights of §2.4 step 5 (super weighted at the market return): `cashWeightCents` 3,000,000 at `cashInterestRatio` `0.0512` and `marketWeightCents` 72,000,000 (investments $120,000 + super $600,000) at `marketReturnRatio` `0.0612`.

**Derivations (the §2.4 rules on generic periods; `deriveFireInputs` tests).**
- *Spend (D97):* twelve closed monthly periods with adjusted spend $3,750 (ten months), $2,500 and −$6,000 (a one-off sale counted as savings). Counted: ten × $3,750 + $2,500 + $0 = $40,000; mean × 12 = **$40,000** (with no D51 adjustment in the window, the sheet's rule on the raw figures, negatives kept, gives $34,000).
- *Savings:* income $6,000 in each month except $6,400 in the floored one; voluntary super $200 a month. Counted savings = income − counted spend − voluntary super: $2,050 (ten months), $3,300, and $6,200 in the floored month (capped at its income: its adjusted savings were $12,400) → Σ $30,000, mean $2,500 × 12 = **$30,000**; voluntary super left out $2,400 a year (with no D51 adjustment, the sheet's rule, uncapped and with super, gives $38,400).
- *Super contribution (D99):* SG $850 a month received by the fund (12 % of a $100,000 salary is $1,000, less 15 % contributions tax) → $10,200; after-tax contributions $9,800 → **C = $20,000**.
- *Growth (D102):* `g = (30,000 × 0.0512 + 720,000 × 0.0612) ÷ 750,000 = (1,536 + 44,064) ÷ 750,000 = 0.0608`. Real: `r = 1.0608 ÷ 1.02 − 1 = 0.04` exactly (1.02 × 1.04 = 1.0608). The template's `g − i` would give 0.0408.
- *Target:* super needed at access = `S ÷ wr` = 40,000 ÷ 0.05 = **$800,000**.

**Factors at r = 4 %:** q(1) 1.04 · q(2) 1.0816 · q(3) 1.124864 · q(4) 1.16985856 · q(5) 1.2166529024; a(4) = (1 − 1/1.16985856) ÷ 0.04 = 3.629895224; a(5) = 4.451822331; s(1) 1 · s(2) 2.04 · s(3) 3.1216.

**Year 0 (stop now?).** B(0)·q(5) = 600,000 × 1.2166529024 = 729,991.74 → shortfall 70,008.26; needed(0) = 40,000 × 4.451822331 + 70,008.26 ÷ 1.2166529024 = 178,072.89 + 57,541.69 = **$235,614.58** > projected(0) = $150,000 (gap $85,614.58). Not yet.
**Year 1.** projected(1) = 150,000 × 1.04 + 30,000 = **$186,000**. B(1) = 600,000 × 1.04 + 20,000 = 644,000; × q(4) = 753,388.91 → shortfall **$46,611.09**; needed(1) = 40,000 × 3.629895224 + 46,611.09 ÷ 1.16985856 = 145,195.81 + 39,843.35 = **$185,039.16** ≤ $186,000 → **k = 1**: FIRE in **2031** at **56**, bridge **4 years**, status `on_track`, gap −$960.84 ("Ahead by $960.84").
**Top-ups.** D = $46,611.09 over N = 4 years; C·s(4) = 20,000 × 4.246464 = 84,929.28 ≥ D, so pay C from FIRE start: the payment at the end of 2031 grows 3 years to 22,497.28, the one at the end of 2032 two years to 21,632.00 (together 44,129.28); the third closes the rest, 2,481.81 ÷ 1.04 = **$2,386.35**. **m = 3** (2031–2033), total $42,386.35; top-ups end **2034**.

**Rows** (balances at each anniversary of the as-of date, labelled by calendar year; flows at the year's end):

| t | Year | Age | Phase | Pre-super start | Growth | Saved | Spent | Top-up | Pre-super end | Super start | Growth | Contrib. + top-up | Withdrawn | Super end |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 2030 | 55 | accumulation | 150,000.00 | 6,000.00 | 30,000.00 | 0 | 0 | 186,000.00 | 600,000.00 | 24,000.00 | 20,000.00 | 0 | 644,000.00 |
| 1 | 2031 | 56 | top_up | 186,000.00 | 7,440.00 | 0 | 40,000.00 | 20,000.00 | 133,440.00 | 644,000.00 | 25,760.00 | 20,000.00 | 0 | 689,760.00 |
| 2 | 2032 | 57 | top_up | 133,440.00 | 5,337.60 | 0 | 40,000.00 | 20,000.00 | 78,777.60 | 689,760.00 | 27,590.40 | 20,000.00 | 0 | 737,350.40 |
| 3 | 2033 | 58 | top_up | 78,777.60 | 3,151.10 | 0 | 40,000.00 | 2,386.35 | 39,542.35 | 737,350.40 | 29,494.02 | 2,386.35 | 0 | 769,230.77 |
| 4 | 2034 | 59 | drawdown | 39,542.35 | 1,581.69 | 0 | 40,000.00 | 0 | 1,124.04 | 769,230.77 | 30,769.23 | 0 | 0 | 800,000.00 |
| 5 | 2035 | 60 | access | 1,124.04 | 44.96 | 0 | 0 | 0 | 1,169.01 | 800,000.00 | 32,000.00 | 0 | 40,000.00 | 792,000.00 |
| 6 | 2036 | 61 | access | 1,169.01 | 46.76 | 0 | 0 | 0 | 1,215.77 | 792,000.00 | 31,680.00 | 0 | 40,000.00 | 783,680.00 |

Checks: the super reaches exactly the $800,000 target at access (2035); the pre-super pot is left with the year-1 surplus grown to access, 960.84 × 1.16985856 = **$1,124.04**; each row adds up (e.g. 2033: 78,777.60 + 3,151.10 − 40,000 − 2,386.35 = 39,542.35).

**KPIs.** Years to FIRE **1** (2031, age 56); pre-super needed at FIRE start **$185,039.16**, progress 150,000 ÷ 185,039.16 = **81.1 %**; super needed at access **$800,000**, projected **$800,000.00**, super progress 600,000 ÷ 800,000 = **75.0 %** (the Super tile's meter); self-sustaining super at FIRE start = 800,000 ÷ 1.16985856 = **$683,843.35** (shown in "How it's worked out"; the template's "− 2" would use q(2): $739,644.97); needed to stop today **$235,614.58**. **Milestones:** today 2030 (1st node, teal) · FIRE start 2031 (2nd, violet) · top-ups end 2034 (3rd, fuchsia) · access 2035 (4th, orange). **Needed vs projected:** 2030 needed 235,614.58 vs projected 150,000.00 (short by 85,614.58); 2031 185,039.16 vs 186,000.00 (ahead by 960.84); 2032 132,440.73 vs 223,440.00; 2033 77,738.36 vs 262,377.60; 2034 38,461.54 vs 302,872.70; 2035 and 2036 0.00 vs 344,987.61 and 388,787.12.

**Status cases from the same inputs** (each a unit test): S = 0 → `spend_needed`; birth year null → `needs_input ['birthYear']`; A0 = $300,000 → `fire` (needed(0) $235,614.58 ≤ $300,000); C = 0 → FIRE in year 2 with **level** top-ups of $22,427.04 for the 3 bridge years (T = D ÷ s(N)); B0 = $1,000,000 → FIRE in year 1 with no top-ups (B(1)·q(4) above the target; needed(1) = S·a(4)); P = 0 and A0 = $0 → FIRE **at** access (year 5: B(5) = $838,318.19 ≥ $800,000); P = 0, A0 = $0 and B0 = $500,000 → FIRE **after** access (year 7, age 62: B(7) = $815,931.78; rows 0–6 `accumulation`, 7–8 `retired`); P = 0, C = 0 and A0 = $60,000 → FIRE **at** access with super **below** the target (year 5: no top-up and no lump, super at access $729,991.74, the pre-super $72,999.17 covers the $70,008.26 difference under the combined rule); **debts:** A0 = −$50,000 with L = $200,000 → projected(1) = 150,000 × 1.04 − 200,000 ÷ 1.02 + 30,000 = **about −$10.08k** (the exact cents are asserted in `fire.handworked.test.ts`) (the template's rule would give −$22,000), and projected(3) rises with the market return ($67,836.93 at g = 5 %, $84,991.67 at g = 8 %); **the combined rule:** age 62 (n = −2), B0 = $1,600,000, A0 = −$100,000 with L = $250,000, P = 0 → `fire` (super at twice the target covers the debt).

### 10.2 Demo frames
**D103: every FIRE action is re-import-safe**: the owner's `data/` is **backed up** (done: `data/backups/pre-stage6-2026-09-27/`) and is the demo database.
0. Stop every server. (Optional) copy the backup's `finance.db*` to a scratch `data/demo-stage6/` for the what-if save demo; the coordinator adds a launch configuration with `DATA_DIR=data/demo-stage6`.
1. **Real `data/`** (its first Stage 6 start runs the D98 one-off: the log line, `hasAppData` stays false): the FIRE page end to end (the tiles, the D98 note, the workbook contribution note, the milestone line, both chart views, how it is worked out with the months used, year by year); the what-if (spend, withdrawal rate, access age 65 vs 60, extra savings, return) recomputing live with the "Saved:" line and the baseline; **Save as my settings** once (re-import-safe, D103), then Reset and save back if wanted; the Settings FIRE group ("Kept when you re-import", the notices). `hasAppData` must still be false at the end.
2. **The polish pass:** every page at phone width (the Browser pane's device emulation at 375), a slow first load (skeletons), keyboard through Net Worth and FIRE (focus rings, Escape), the Dividends and Side Income empty states on the scratch copy or the fixtures gallery, `pnpm build` without the chunk warning.

---

## 11. Template bug fixes applied in Stage 6 (owner can veto)
Numbering is stable. Fixes 1, 4, 6, 8, 9 and 10 carry out kickoff decisions (D99, D102, D97, D102, D98, D99) and are listed so the owner sees each change; the others are proposals.
1. **Super top-ups use the super contribution, not the whole salary** (`E64`, D99), and are sized to the super shortfall at access: `C` a year from FIRE start (the last payment partial), or a level amount over the bridge when `C` is too small.
2. **Every drawdown year grows at the real rate.** The template's first drawdown year (`M4`) used the nominal growth rate.
3. **The self-sustaining super at FIRE start uses the exact years to access** (`E62`): the template subtracted an unexplained 2 years, overstating it.
4. **The real rate is exact:** (1 + growth) ÷ (1 + inflation) − 1 (D102), not growth − inflation.
5. **The FIRE year is the first year your projected pre-super net worth covers what it must hold**, stepped year by year: the bridge's spend for the full years to access plus any super shortfall. The template counted years whose shortfall exceeded one year's spend (`COUNTIF(X > S)`), valued the pot for one year fewer than the bridge (`V`'s "− S"), and then solved `NPER` against a pot sized for the counted years. The app counts each year's spending at its end, as it counts savings (the page says so).
6. **Months with negative spend count as $0** (D97), and a spend of $0 or less stops the projection with "Yearly spend needed" instead of inverting every figure.
7. **Savings are floored at $0 and capped at income in the same months** (so savings + spend = income each month), instead of the template's "Neg. Savings Rate" text that broke every calculation and uncapped savings that counted deposits and sales as saving.
8. **The growth rate weights every asset FIRE counts** (D102): cash and unlinked offsets at the cash rate; ETFs, stocks, managed funds, crypto, other assets, investment property and super at the market return. The template ignored crypto and other assets.
9. **Access age defaults to 60** (D98), the preservation age for anyone born after 30 June 1964; the imported 65 is replaced once, with a note, and stays editable.
10. **The super contribution a year is derived from your super contributions** (SG and your own, as the fund receives them, last 12 months; D99); a figure you set in the app overrides it.
11. **Voluntary super contributions count once**, in super: the template's savings figure (`Cash!N`) also counted them as pre-super savings.
12. **Pre-super net worth follows the app's net worth** (net worth − super − your home's value; every class at its live value and every offset account as Stage 5 counts them, Stage 5 fix 1): the template read the Net Worth tab's liquid total, which dropped an offset account once it left Total Cash.
13. **"Years to go" is the years to FIRE start.** The template added the super top-up years (`E56 + E64`) although the top-ups happen after FIRE starts.
14. **"You're FIRE" only when the whole plan is funded today** (the bridge and the super at access). The template said so whenever the super balance alone exceeded spend ÷ withdrawal rate, even with nothing for the bridge.
15. **No "Accept disclaimer" gate:** a standing note that the figures are a projection in today's dollars, not advice.
16. **FIRE after the access age is shown** (both buckets then count against the withdrawal rule, up to age 100), instead of a grid that stopped at access + 1 and could not reach it.
17. **One consistent year-by-year path** (start-of-year balances, end-of-year savings, spend, contributions and top-ups) replaces the template's `PMT`/`IPMT`/`PPMT` columns and their sign games.
18. **Spend and savings average the recorded (closed) months only**, from the Stage 3 12-month window: the template's averages included the current, unfinished month.
19. **Progress is current ÷ needed, clamped to 0–100 %** with the true figures beside it: the template's `C ÷ (D + C)` failed on text and negative figures.
20. **The needed-vs-projected helper is a chart view** (D101); the template kept it in hidden columns.
21. **An imported super contribution is shown as the workbook's figure, not an override** (owner question 1): the workbook's cell is always typed, so it would otherwise always hide fix 10; "Use the workbook's figure" adopts it.
22. **Debts in the FIRE pot stay fixed in dollars** (owner question 2; provisional): the template compounded the whole net pre-super figure at the growth rate, so a home loan grew like an investment (and a higher return made a negative pot worse), although its interest is already in the spend and its principal repayments in the savings. The app grows the pre-super assets and holds the debts at their balance, which shrinks in today's dollars with inflation.
23. **After the access age, super and the pre-super pot count together** against the withdrawal rule (super above the target can cover pre-super debts), and FIRE exactly at the access age leaves any super shortfall to the pre-super pot instead of an unexplained lump.

Decisions applied (not fixes): D68 the home out of FIRE with its loan kept in (the template's own rule, owner question 2; its treatment in time is fix 22), D100 the what-if panel, D101 the node-line chart, D103 FIRE settings as preferences, D104 the polish scope.

---

## 12. Risks & fallbacks
| Risk | Status / fallback |
|---|---|
| **One-off inflows or a property deposit in the window** distort spend and savings | D97 floors spend; fix 7 caps savings at income in the same months; D51 adjustments remain the precise tool (after the cutover: they are app data, D34); the what-if's extra savings (signed) and spend correct it without saving; the page lists the months used. |
| **The D98 one-off writes to `data/` on its first start** | It is a preference row plus an `app_meta` marker: `hasAppData` stays false and a re-import keeps it (§3.4); the demo shows it; the pre-Stage-6 backup exists. |
| **The workbook's super contribution vs the derived one** (owner question 1) | The derived figure is used; the workbook's is shown with "Use the workbook's figure" (a POST that flips its origin, §4.2); the provisional rule is one server function (§4.5) if the owner decides otherwise. |
| **A home loan larger than the liquid assets** makes the FIRE pot start negative (owner question 2) | The loan stays in (the template's rule, D68) but is held fixed in dollars (fix 22), so a negative pot is not compounded like an investment; the combined rule after access lets surplus super cover it (fix 23); the page shows the figure without the loan for context; the treatment is one switch in `projectFire`/`deriveFireInputs` if the owner decides otherwise. |
| **One real rate for super and pre-super** | As the template; super is weighted in the blend at the market return (owner question 3); a separate super return is deferred (§1.5). |
| **Spreadsheet emulation drifts** (the sheet mode) | Every populated output cell verified with the planner's reference; the golden counts per area are in the private §2.1; branches the workbook does not exercise have unit tests with identities. |
| **FIRE figures move with the clock** (the D99 window, the age, `n`) | Every server FIRE test and every owner-data check injects a fixed `now` (§4.5, §7.9, §10 #7); the page shows the months used and notes a stale window. |
| **Lazy routes break deep links or offline chunks** | The prod-bundle check (§10 #11); `ErrorPage` on a failed chunk load; `defaultPendingMs` avoids flicker. |
| **Guard hardening false positives** | Only thousands groupings and `_` digit runs are normalised; tests for lists, versions, hex, dates; `--all` must stay clean before the change lands. |
| **e2e retries hide a real failure** | Retries only on the read-only projects; the Integrator and the Verifier list every test that passed on a retry; a test failing on every retry fails the run. |
| **The what-if hammers the server** (every slider move) | 250 ms debounce, `keepPreviousData`, one context per request; profile `/api/fire` on the owner copy (target < 150 ms). |
| **Stale dev servers on `data/`** | The coordinator pre-step stops them; agents use `artifacts/stage6/*`. |

---

## 13. Every agent: final report checklist
- Files created or changed (all inside your ownership; Scaffold notes appended; Integrator cross-area edits listed).
- Commands run with pass/fail: typecheck, lint, format:check, your scoped tests, your e2e specs on your ports, `pnpm guard:all`.
- Engine, server-api, the spec reviewer and the Verifier: golden counts per area (compared / skipped by reason / recomputed) **in the git-ignored report only**; anything that could be committed says "matches private §2.1", never the counts (row counts reveal the owner's age). **No owner values, names or notes** in anything that could be committed.
- Screenshot paths under `artifacts/screenshots/` (UI roles) and the STYLE_GUIDE §10 self-check.
- Contract gaps or cross-owner requests (not worked around).
- Ports free, no background processes left, **no server started on `data/`**.
- Nothing committed or pushed; no owner data in any tracked file.

---

## 14. Questions for the owner (plan review; answered 2026-09-27: every default confirmed, D105–D108)
1. **The workbook's super contribution a year** (`E7`) is a figure typed into the workbook; D99 says a set figure overrides the derived one, so an import would always override it. Should (a) only a figure set in the app override, with the workbook's shown beside the derived one and a "Use the workbook's figure" button, or (b) the imported figure override as D99 reads literally? *Default (applied): (a).* The private §6 compares the two.
2. **Debts, including the home loan, in FIRE** (D68 left the loan's treatment open; the plan review found the template compounds a net debt like an investment): (a) keep the loan in and hold every debt fixed in dollars (it shrinks with inflation; its interest is already in the spend) — fix 22; (b) keep the loan in and compound the net figure at the growth rate, exactly as the template; (c) leave the home loan out (then the repayments made after FIRE are not in the spend)? *Default (applied): (a), with the figure without the loan shown for context.* The private §6 gives the FIRE year under each.
3. **Super in the growth blend** (D102 "every asset FIRE counts"): weight super at the market return (one real rate for both buckets, as the template), or blend only the pre-super assets? *Default (applied): include super.*
4. **Savings in the months with negative spend** (D97 counts their spend as $0): cap those months' savings at their income, so a deposit or sale does not count as saving? *Default (applied): yes (fix 7).*

---

## Scaffold notes

_Scaffolder appends here (append-only, inside this section, above the Stage close notes): where the skeleton differs from, or adds to, the plan above. The implementers, the Integrator and the Fixer append contract clarifications here too._

### Scaffolder (2026-09-27)
**Schema (additions beyond §3.2–§4.4, all additive):**
- `src/fire.ts` also exports the union types (`FireStatus`, `FireMissingInput`, `FirePhase`, `FireMilestoneKind`, `FireGrowthWeightKey`, `FireInputSource`, `FireMilestoneTone`, `FireWhatIfField`); `FIRE_PHASE_WORDS` `satisfies Record<FirePhase, string>`, `FIRE_WHAT_IF_FIELDS` `satisfies Record<FireWhatIfField, EditableSettingKey>`.
- `dto/fire.ts` also exports `ratioQuery(bounds)` (a plain signed decimal, at most 30 characters, normalised; messages `must be above X` / `must be at least X` / `must be at most X`), `FIRE_QUERY_ACCESS_AGE_MIN` 30 / `_MAX` 99 (= `FIRE_HORIZON_AGE − 1`; triage SPEC-2, was 100), and named sub-DTOs `FireAccessAgeReplacedDto`, `FireGrowthWeightDto`, `FireMilestoneDto`. The other DTOs are field by field as §4.4 (`FireDerivedDto`, `FirePeriodRowDto`, `FireRowDto`, `FireProjectionDto` mirror the engine types, Cents → number).
- `fire.extraSavingsPerYearCents`: registry `defaultValue` null (signed money, no registry min); the server resolves it to 0 with source `'default'` (§4.5).
- Settings fixtures (`fixtures/history.ts`, every `settingsPages` state): 63 keys, the new labels, the `fire` group "FIRE" with its eight keys in display order, every `fire.*` row `preference: true` / `workbook: false`, `fire.preservationAge` `defaultValue` 60, the two new keys unset, and `notice: null` on every `SettingDto`. **server-api:** the `fire.*` rows' `usedOn` stay `[]` to match `settings/readers.ts`; when you map `SETTING_READERS` (§4.5), update these fixtures too (`apps/server/test/settings/fixtures-used-on.test.ts` checks them).
- `testing/seed.ts`: the generic rows of §3.2 (import origin) and `seedFireReplacedAge(db, updatedAt?)` (exported from `@joinr/schema/testing`; upserts an import-origin 65).
- `apiErrors.fireValidation` carries the query schema's real message for `{ withdrawalRate: '0', accessAge: '101' }` (a schema test keeps them equal).

**FIRE fixtures (`fixtures/fire.ts`, §3.6).** Generated by the git-ignored `artifacts/stage6/scaffolder/gen-fire-fixtures.ts` from `artifacts/stage6/plan-reviser/model2.ts` (doubles, rounded once to cents, half away from zero); as-of 15/03/2030 for all; `onTrack` = §10.1 (a schema test checks its figures). `fireFixtureInputs` is typed by `FireFixtureProjectionInput` (the schema's mirror of the engine's `FireProjectionInput`, Cents → number); `fireInputSourcesOf(inputs)` is exported beside `FIXTURE_COVERAGE`. Readings the engine and server-api should confirm (the gated consistency test, §7.4 step 5, will flag any difference):
1. `needs_input`: `ageNow` is set when the birth year is valid, `accessYear`/`yearsToAccess` when the birth year and access age are both valid; `rates`, `target`, `fire`, `topUps` null; `savingsPerYearCents` = max(0, P + X); `milestones` `[]`; only the two `currentCents` set.
2. `spend_needed` and `not_reachable`: `super.projectedAtAccessCents` = the accumulating path's super at the start of row max(n, 0) (model2's rule), not null; `not_reachable` has `target = { superAtAccessCents, superAtFireStartCents: null }`, `spend_needed` `target: null`.
3. Ratios are 12 significant digits (`g` from the weights, `real` exact); `progressRatio` likewise.
4. `status 'fire'` with a super shortfall has top-up rows from t = 0 (`fireNow`).
5. Inputs DTO: `superContribution.savedCents` is the **app-origin** stored value only (an import row shows as `workbookCents`); `marketReturn.savedRatio` = `fire.marketReturn` ?? `returns.marketReturn` and `settingKey` names the saved key; `extraSavings.derivedCents` null; `yearlySpend.source` `'missing'` with no override and no window.
6. `derived.window.from` = `through` − 365 days; SG/member splits are generic.
7. **`longHorizon`** writes its years as `LONG_HORIZON_YEAR + t` (a const in the file): every run of about 75 calendar years in the plausible range contains private guard terms, so literal years failed `pnpm guard:all`. The values are the same numbers; coordinator FYI.

**Engine.** The three stubs are function declarations in `src/index.ts` throwing `engine: not implemented` (the engine owner moves them into `fire.ts` / `fireSheet.ts`); `test/api.test.ts` checks the members, signatures and flag, and a stub test that returns early once `FIRE_ENGINE_IMPLEMENTED` is true.

**Server stubs.** `routes/fire.ts` answers 501 `NOT_IMPLEMENTED` (an exposed `HttpError`, `no-store`) on both routes, registered after `historyRoutes` with the cash-flow options. `fire/upgrade.ts` is the frozen no-op; `buildApp` calls `applySettingUpgrades(db, (now ?? () => new Date())())` before the error handler and routes. `fire/page.ts` (`buildFirePage(ctx, query, { hasAppData })`) and `fire/workbook.ts` (`useWorkbookContribution(deps)`) throw 501; `fire/inputs.ts` is an empty module (their internal signatures are server-api's to change). `context.ts` `fireDerived()` throws 501. `settings/page.ts` sets `notice: null`; `readers.ts` maps the two new keys to `[]`. Neutral fakes `neutralFireDerived`, `neutralFireProjection`, `neutralFireSheet` are exported from `test/investments/helpers.ts` (every other fake engine builds on it).

**ui stubs.** `LineChartMarker` (exported from the charts barrel) and `LineChartProps.markers` (AreaChart inherits it), passed to `lineOption`/`areaOption` and ignored there until web-fire; `MarkLineComponent` registered; `compactAxisFormatter(extent)` exported from the charts barrel (returns `compactMoneyFormatter`); `StatTile.footer` renders in `div.jf-stat-tile__footer` under the hint (no CSS yet); `Skeleton` (`div.jf-skeleton.jf-skeleton--<variant>`, `aria-hidden`; `SkeletonProps`, `SkeletonVariant` exported from core); `MilestoneLine` renders `div.jf-milestone-line` with `role="group"` and its `aria-label` (`MilestoneLineNode`, `MilestoneLineSegment`, `MilestoneLineProps` exported from brand); `brand/milestone.css` is empty and `@import`ed at the top of `brand.css` (web-fire: wrap its rules in `@layer brand`).

**Web stubs.** `FirePage` renders `PageHeader` "FIRE" (subtitle "Planning") and a `Callout note` **"FIRE arrives in Stage 6 with the web work."** (deviation: the plan's "Arrives with the web work" fails `e2e/ui-core.spec.ts`'s short-page test, which filters the note on "arrives in Stage"; that file is the Integrator's). `router.tsx` has a typed `fireRoute` (`/app/fire`); the placeholder machinery stays (its route list is now empty) for web-polish-pages to remove. `PageSkeleton({ label, layout })` renders the `Loading` line. `pages/fire/fire.css` is empty.

**Expectation fixes the contract forced** (now the owners' files): `packages/engine/test/api.test.ts`; `packages/schema/test/{registries,history-schemas}.test.ts` (Stage 3–5 counts read as "then Stage 6 appends"); `packages/importer/test/import.settings.test.ts` (the "keeps every preference key" test gives each type a valid value and counts `keptAppPreference` over the **workbook** preference keys: the two app-only keys have no workbook row to keep against, 19 of 21); `apps/server/test/{app.test.ts,history/integration.test.ts}` (63 settings), `test/assets/settings-notes.test.ts` (62 editable), `test/investments/builders.test.ts` (the seed's two returns now reach the timing inputs, and `missing` no longer lists them); `apps/web/src/router.test.tsx` (`/fire` typed), `apps/web/src/pages/settings/SettingsPage.test.tsx` (the group label "FIRE"; the "Used by the FIRE planner (Stage 6)." note is unchanged, web-polish-pages owns it, §6.7–6.8).

**Styleguide (FEAS-3).** The number the private §8.1 names appears in both gallery files (CoreSection's sample holding `costCents`, ChartsSection's last three salary months); it is now another round generic number in all four places, and a scratch scan of both files finds no separator-written number equal to a term.

**Guard FYI (tooling, coordinator).** A rough scratch scan (`artifacts/stage6/scaffolder/sepcheck.ts`: every `,`/`_`-grouped number with the separators removed, matched against the terms file; prints locations only) also flags `apps/web/src/pages/import/ImportRunPage.test.tsx` lines 277–278, `apps/web/src/pages/import/checks.test.tsx` line 29 (a `$x,xxx.00` figure) and `docs/stages/stage-6.md` line 805. None is a Scaffolder file; check them against the hardened matcher before it lands.

**Done-check (2026-09-27):** typecheck, lint, format:check green; `pnpm test` 211 files / 4010 tests green (Stage 5: 3834); `pnpm build` exit 0 (the one-chunk warning remains until §6.9 H); `pnpm guard:all` OK; `e2e/smoke.spec.ts` + `e2e/ui-core.spec.ts` on 5370/3370 with a fresh `artifacts/stage6/scaffolder/data`: 65 passed, 8 skipped (project-conditional); `/api/health` → `migrations: 6`; `pnpm seed:dev --yes` exit 0; `/api/fire` and the POST → 501 `no-store`; ports free afterwards.

### web-polish-ui (2026-09-27)
- **`Skeleton` (§6.9 A):** variants as planned; `lines` = text lines (default 3) or table rows (default 5); **additive `height?: number`** (px; card default 160, chart plot default 280, the charts' default height) so `PageSkeleton` and the pending wrappers can match a page's footprint. Markup is `div.jf-skeleton.jf-skeleton--<variant>[data-variant]` with inner `span.jf-skeleton__bar` etc., `aria-hidden`, no text. `--surface` blocks with `--raised` inner bars (a text skeleton inside a `.jf-card` steps its bars up to `--raised`); a 1.2 s opacity pulse (`jf-skeleton-pulse`), `animation: none` under reduced motion.
- **`StatTile.footer` (§6.5):** `div.jf-stat-tile__footer` under the hint, the tile's last child; flex column, `margin-top: auto` (meters line up across a row of tiles), muted 12 px text (`--text-muted`) for the "Saved:" line.
- **STYLE-6 / STYLE-7 (`KeyValueTable`, §6.9 D, E):** labels `overflow-wrap: normal; word-break: normal; hyphens: manual`; `.jf-kv` is a size container (`container-type: inline-size`) and below 480 px of its width the table, rows, label and value become full-width blocks (label strip above value; the `colgroup` hidden). Every value is left-aligned: `.jf-kv__table` sets `text-align: left`, `.jf-kv__value--num` (still mono, tabular) and `.jf-kv__value .jf-num` use `text-align: inherit`. **Coordinator:** the STYLE_GUIDE §5/§10 exception as planned. **Integrator/web-polish-pages FYI:** a KV inside a shrink-to-fit parent (an `auto` grid track, a non-stretching flex item, inline-block) now contributes no min-content width (size containment); none found in `apps/web` today.
- **STYLE-11 (`ColumnTable`, ChartCard):** with a sticky first column every header cell is `position: relative; z-index: 2`, the sticky header cell `z-index: 3` with an explicit opaque `--raised`, body sticky cells stay `z-index: 1`. Checked in real Chrome on a static page (scratch `artifacts/stage6/web-polish-ui/probe.*`): after scrolling 40 px, `elementFromPoint` inside the sticky header cell returns it (background `rgb(38, 39, 53)`, alpha 1) and just below it returns the body cell. In a ChartCard's **table view** header labels may wrap between words (`white-space: normal`, `word-break: normal`), so more tables fit a half-width card; elsewhere headers stay on one line.
- **STYLE-5 (§6.9 C):** `hasSeriesData` now means "a finite, **non-zero** value" (line, area and stacked charts); `BarChart` uses the new `hasBarData` (bars or any overlay non-zero, `options/bar.ts`). `compactAxisFormatter(extent)` estimates the finest ECharts tick step (≈ 10 ticks, rounded down to 1/2/5 × 10ⁿ) and shows the decimals that step needs in each figure's unit (`$1.2k`, `$1.22M`); sub-dollar steps show cents with two decimals (`$0.50`, never `$0.5`); zero and float noise print `$0`; U+2212 negatives; a flat or non-finite extent falls back sensibly. New shared helpers in `options/common.ts`: `valueExtent(rows, stacked?)` (covers zero; per-category positive/negative sums when stacked) and `axisFormatterFor(formatter, extent)` (swaps **only** `compactMoneyFormatter` for the axis-aware one, so every page keeps passing `compactMoneyFormatter` unchanged). `barOption` applies it to the primary axis (bars incl. stacked totals + primary overlays) and separately to the secondary axis; tooltips keep the full formatters. **web-fire:** `options/line.ts` can use the same two helpers (`axisFormatterFor(p.axisFormatter ?? format, valueExtent(values, isStacked))`).
- **Focus (§6.9 F):** the base `:focus-visible` ring already covers every ui control; a ui test fails on any ui stylesheet rule that removes a focus outline outside two documented exceptions (`.jf-input__control` → the frame's `.jf-input:focus-within` ring; `.jf-shell__main:focus`, a programmatic target). **tooling/Integrator (polish.spec keyboard walk):** a focused `.jf-input__control` has `outline: none` by design: check the ring on its `.jf-input` ancestor; a focused checkbox/switch input is visually hidden, its ring is on the next sibling (`.jf-check__box` / `.jf-switch__track`).
- **Test harness:** `packages/ui/src/core/testing/cssHarness.ts` (test-only, not exported) loads the real stylesheets into jsdom flattened (jsdom parses but never applies rules inside `@layer`/`@media`/`@container`), with simulated container width, viewport width and reduced motion. jsdom never applies `:focus`/`:focus-visible` rules in computed styles, so the focus tests match the ring selectors instead.
- **Styleguide gallery:** new items `StatTile/footer`, `Skeleton`, `KeyValueTable/narrow` (Core) and `MilestoneLine` (Brand; renders web-fire's component, the stub until it lands; sample nodes from the §10.1 generic example, segments from `FIRE_PHASE_WORDS`' words); the KeyValueTable note updated.

### engine (2026-09-27)
- **Landed:** `src/fire.ts` (`deriveFireInputs`, `projectFire`) and `src/fireSheet.ts` (`fireSheet`); the `index.ts` stubs are gone and `FIRE_ENGINE_IMPLEMENTED = true` (set after the full engine suite, goldens included, passed). `projectFire` on every `fireFixtureInputs` entry reproduces its `firePages` projection **exactly** (0-cent differences, scratch check), and server-api's gated fixture-consistency test passes. The Scaffolder's fixture readings 1–4 are confirmed.
- **Readings of §2.4:** the rows are the `closed` periods with `runDate ≥ kpis.avgWindow.from` whose adjusted figures have a spend (income > 0); `window.from` = `kpis.avgWindow.from`; `floored` = spend < 0 and `cappedPeriods` = `flooredPeriods`; `superExcludedCents` is 0 without a window; the raw figures skip a period whose **raw** figures have no spend; `debtCents` = Σ |`liabilities[].balanceCents`|; `sgSource` ignores `'none'` months (only `'none'` or no month → `'none'`; statement and estimate → `'mixed'`); the weights are listed in `FIRE_GROWTH_WEIGHT_KEYS` order, values ≤ 0 omitted, `investment_property` = Σ non-primary `property.properties[].valueCents`.
- **Readings of §2.5:** negative weights count as 0; a negative super contribution counts as 0; `preSuperDebtCents` is used as |L|; the top-up search allows a 1e-12-dollar slack so a payment that closes the shortfall exactly is not split into a second, near-zero one; `super.projectedAtAccessCents` is the plan path's unrounded super at the start of row `max(n, 0)` (equal to `max(B(k)·q(bridge(k)), target)` within rounding); `needs_input` still reports `savingsPerYearCents` and `noSavingsHistory`. Every row figure is rounded once on its own, so a row adds up within 1 cent (tested).
- **Sheet mode:** a small Sheets value model (numbers as decimals, texts, "" counting 0 in arithmetic, a truly empty cell for the blank header `T3`, errors that propagate until an `IFERROR`; lazy `IF`, `AND`/`OR` evaluating every argument). Cells the template leaves without `IFERROR` (`O`, `V`–`X`, `E55`, `E60`) return the error code (`'#VALUE!'`, `'#NUM!'`, `'#DIV/0!'`) as their text; a blank salary pays 0 in `E64`'s `NPER`; `NPER` is cut to 30 significant digits before `ROUNDUP` (ln noise at 50 digits); `DATE` adds 1900 below year 1900 and errors from 10000. `sheetFunctions` is an internal export of `fireSheet.ts` for the unit tests (not on the public API).
- **Goldens:** `test/golden/fire.golden.test.ts` (+ `fireAdapter.ts`, `fireFormulas.ts`, `fireTally.ts`): every §9.2 area compared or recomputed, counts **match private §2.1**. The row count of the grid and the closed-window period count are adapter checks (not counted). Area D's closed-row helper uses the sheet's window (dated after `C51 − 365`/`366`), rows dated ≤ `C51`, the first Cash row (the baseline) excluded.
- **Guard (coordinator):** the hardened `pnpm guard:all` now reports 4 findings, none in engine files: `docs/stages/stage-6.md` line 805 (the §10.1 status-case line), `apps/web/src/pages/import/ImportRunPage.test.tsx` 277–278 and `apps/web/src/pages/import/checks.test.tsx` 29 (the Scaffolder's FYI). One engine test title that repeated a §10.1 figure written with separators was reworded.

### server-api (2026-09-27)
**Internal signatures (non-frozen).** `buildFirePage(ctx, query, { hasAppData, marker })` (the route reads the D98 marker with `readAccessAgeMarker(db)`); `fire/inputs.ts` exports `savedFireSettings`, `resolveFireInputs({ saved, derived, query, marker })`, `isWhatIf`, `projectionInputOf(asOf, derived, inputs)`; `fire/upgrade.ts` adds `readAccessAgeMarker`, `accessAgeReplaced(marker, storedAge)`, `logSettingUpgrades(log, upgrades)` beside the frozen `applySettingUpgrades`; new `fire/notices.ts` (`accessAgeNotice`, `WORKBOOK_CONTRIBUTION_NOTICE`, `fireSettingNotice`, `proseDate`); `fire/workbook.ts` `adoptWorkbookContribution` + `useWorkbookContribution(deps, log)`; `settingDto(def, { …, replaced })`.

**Contract clarifications (the tests pin each):**
- `accessAge.replaced` follows the **stored** value (a what-if `accessAge` does not hide the note); the Settings notice uses the same rule, so setting 60 again in the app shows the note again while the marker exists.
- `marketReturn.settingKey` names the **saved** key (`fire.marketReturn` when set, else `returns.marketReturn`) during a what-if too; `savedRatio` = `fire.marketReturn ?? returns.marketReturn`.
- `superContribution` is never `missing`/`default`: with no app-origin row it is `derived` (the derived figure is always a number, 0 included). `extraSavings` without a setting is `{ cents: 0, source: 'default' }`. Access age falls back to the registry default (60, `default`); ratios have no registry default (`missing`).
- `POST /api/fire/use-workbook-contribution` refuses `409 IMPORT_IN_PROGRESS` while an upload import runs (as every mutation, incl. the settings PATCH), ignores any body, and answers the one-key slice (`{ values: { key: v|null }, origins: { key: 'app'|null } }`) and `hasAppData`.
- **Upgrade clocks:** `buildApp`'s start-up call uses the injected `now`; the upload route's call uses the import route's own clock (buildApp still registers `importRoutes` without `now`, as in Stages 1–5, so backup names are unchanged); the CLI uses the wall clock. The CLI prints one line per upgrade ("Access age changed from 65 (the workbook) to 60 (D98, once)"), on stderr with `--json` so stdout stays pure JSON. The server logs one info line (`{ key, from, to }`).
- **`SETTING_READERS`:** the eight `fire.*` keys → `['fire']`; `'fire'` added to `returns.cashInterestRate`, `returns.marketReturn`, `super.sgRate`, `super.contributionsTaxRate`, `super.importedContributionType` (D75's reading of the member contributions), `pay.grossAnnualSalaryCents`, `pay.jobStartDate` and `savings.includeMortgagePrincipal` (it shapes the closed periods' spend and savings). As the post-scaffold schema owner I updated the `settingsPages` fixtures' `usedOn` to match (the Scaffolder's routed follow-up; `fixtures-used-on.test.ts` green).
- **Fixtures confirmed:** `projectionInputOf` on each `firePages` state's own `inputs` + `derived` reproduces its `fireFixtureInputs` entry exactly (26 of 26, ungated), and with the engine landed `projectFire` reproduces all 26 projections within 1 cent (gated test green). The Scaffolder's readings 1–6 hold.

**Routed (not changed):** the `settingsPages` fixtures keep `notice: null` on the import-origin `fire.superContributionPerYearCents` row of the Stage 5 states, where the real server now answers the workbook notice; a fixture that carries it (for web-polish-pages' §6.7 test) needs the coordinator's OK.

### web-polish-pages (2026-09-27)
- **Page states (§6.9 A–B).** `components/QueryStates.tsx`: `PageSkeleton({ label, layout, header? })` renders `div[data-skeleton-layout]` (`aria-busy`) with a visually hidden `role="status"` label and `Skeleton` blocks (dashboard: 4 tiles in `.jf-app-tiles` + 2 cards; table: a table; form: 6 field blocks). **Additive `header?: boolean`**: the lazy routes' pending wrappers draw the header area too (the page's own skeleton sits under its real `PageHeader`). New `QueryStates({ query, loading, layout, errorTitle })` renders the skeleton on the first load, `LoadError` when it failed, `RefreshError` above the kept figures when a refetch failed, nothing otherwise; all 18 call sites use it. `LoadError` is now `Callout important`. The refetch callout's **title** is "Couldn't refresh" and its body "<message>. Showing the figures from 14:32." (the date is added when the figures are from an earlier day; `components/queryStateText.ts`), with Try again. `ImportPage` / `RecordsIndexPage` / `RecordsEntityPage` render from `data` instead of `isSuccess`, so a failed refetch keeps the table.
- **Lazy routes (§6.1, §6.9 H).** `router.tsx` statically imports only `ErrorPage`, `NotFoundPage`, `RootLayout`, `pages.ts`, `routes/params.ts` and `routes/pending.tsx`; every other component is `lazyRouteComponent`. Route modules in `src/routes/`: `investments.tsx` (one component per kind), `holdingDetail.tsx`, `dividends.tsx`, `recordsEntity.tsx`, `importRun.tsx`, `screenPreview.tsx` (params and search through `getRouteApi`). `routes/pending.tsx` holds `ROUTE_SKELETONS` (route path → label + layout) and `pendingFor(path)`; `/fire` is set to `dashboard` — **web-fire / Integrator:** FirePage's own skeleton must use `layout="dashboard"` (the router test compares them once FIRE joins `PAGE_CASES`). `defaultPendingMs` 150, `defaultPendingMinMs` 300. `PlaceholderPage` and `placeholderFor` removed; `pages.ts` keeps `stage` / `STAGE_TITLES` (its own test).
- **Test harness (outside the §7.1 list, forced by the lazy routes):** `apps/web/test/renderApp.tsx` gains `preloadRoutes()` and awaits it at module load (top-level await), so a page test's first `findBy*` does not wait on a cold dynamic import under the full suite; before, the static imports paid the same cost at import time. The router test preloads too; its static-import test checks the laziness.
- **Shared page lists (§6.9, phase A without FIRE):** `src/pages/pageCases.ts` (test support, not imported by the app): every data page with its h1, skeleton label/layout, error title, primary GET route and every fixture state (records entities at their own paths via `paths`). `states.test.tsx`, `formatAudit.test.tsx`, `noStage5.test.tsx` (now also "Stage 6") and the router's pending-layout test iterate it. **Integrator (phase B):** add a FIRE case there (`GET /api/fire`, every `firePages` state).
- **Format audit (§6.9 G).** `formatAudit.test.tsx` exports `FORMAT_RULES` / `formatHits`. Two-decimal percentages are skipped only inside `[data-format-audit="rate-dp"]` (`RATE_DP_PLACE` in `src/formatting.ts`). **Marked places beyond the three §6.9 G lists (coordinator/reviewers to confirm):** the management fee (`RatioCell dp={2}`, Stage 2: "0.07% does not read 0.1%"), raw record values (records cells, Stage 1), import reconciliation ratios (`checks.tsx`), and History audit pairs (`changePairText`, Stage 5 Fixer STYLE-11). The tax bands and the suggestion render one decimal on every current fixture, so they carry no marker yet. No other hit on any fixture.
- **Empty states (§6.9 C).** Dividends with no holdings: a disabled "Add dividend" with the reason beside it (`aria-describedby`, links to ETFs, Stocks, Managed Funds). Side income chart (`sideIncome/periodsText.ts`): no non-live point → "Side income is grouped by recorded month; it appears after the first recorded month."; else no stream **or no deposit** → "No side income yet. Add a deposit to start." (reading "no streams" as "no stream data": with no stream at all the page's "No streams" callout still says to add a stream first).
- **Keyboard (§6.9 F).** `components/keyboard.ts` `escapeCancels(onCancel, disabled)`: Escape cancels `InlineForm` (every add/edit card form), `SharedEntryForm`, the cash balances form, `TradeForm`, `HoldingForm`, `ManualPriceForm`, `PriceSourceForm` (as their Cancel does; the pages already return focus to the opener). Delete confirms already stopped Escape; the phone drawer's Escape is AppShell's. Tests: `components/keyboard.test.tsx`.
- **Settings (§6.7–6.8).** A setting's `notice` renders as a `jf-app-meta` line under its field (`data-testid="notice-<key>"`), before the used-on links; the FIRE group note reads "Used by the FIRE planner; its what-if panel can save them too."; Property's primary-residence note drops "(Stage 6)". The FIRE group shows the Import-safe "Kept when you re-import." callout (preference keys).
- **Phone (§6.9 D).** `.jf-app-tiles` (Import, Import run, the skeleton) now stacks one per row below 768 px (the polish e2e's left-edge check failed on `/import/runs/1` at 375 px with two across).
- **Guard.** `ImportRunPage.test.tsx` derives the ETF-value figure from the `sampleReport` fixture instead of writing it; `checks.test.tsx` uses another round figure. The one remaining `pnpm guard:all` finding is `docs/stages/stage-6.md` line 805 (coordinator).
- **Build (§6.9 H, `vite.config.ts` + `src/codeSplitting.ts`):** groups zrender (40), echarts (30), react/react-dom/scheduler (20), @tanstack (10), separator-agnostic, tested in `src/codeSplitting.test.ts`. `pnpm --filter @joinr/web build`: no chunk-size warning; 92 JS chunks; largest echarts 409.91 kB, react 218.83 kB, entry `index-*.js` 199.89 kB (target < 300 kB met), zrender 181.98 kB, tanstack 157.24 kB; pages 1–52 kB (PropertyPage 51.65, SuperPage 50.19, FirePage 41.87); CSS 66.85 kB + FirePage 4.35 kB.

### tooling (2026-09-27)
- **Guard hardening (§8.2).** Implemented in `tools/privacy-guard/src/rules.ts` only (`TermMatcher` gains a second pass; `scan.ts` needed no change: its findings come from the matcher). New export `normaliseSeparatorRuns(text)` (the normalised text plus an offset map). A separator run is `\d{1,3}(,\d{3})+` or `\d+(_\d+)+`, optionally `.\d+`, not preceded by a letter, digit, `_`, `.` or `,` and not followed by a letter, digit, `_` or another `,digit`/`.digit`; digits-only terms (`^-?\d+(\.\d+)?$`) are matched on the normalised text with the existing boundaries, and a hit is kept only when a separator was removed inside it (so plain hits are never reported twice). A leading `-` before a run stays, so a negative term matches with its sign. **Consequence of "the same boundaries":** as the exact matcher already does for plain text, a digits-only integer term also matches the whole-dollar part of a separator-written decimal (`$1,234.56` hits a term `1234`).
- **Before landing, `guard:all` with the current terms:** 4 hits appeared, all in files tooling does not own: `apps/web/src/pages/import/ImportRunPage.test.tsx` (2) and `checks.test.tsx` (1) (a `$x,xxx.00` figure; since changed by their owner, no longer hit), and **`docs/stages/stage-6.md` §10.1 line 805** (a separator-written figure of the hand-worked "debts" case whose whole-dollar part equals a private term; coordinator's file). That last hit is the only one left: `pnpm guard:all` exits 1 until the coordinator rewords it (e.g. rounds it or writes it differently); the terms file is untouched.
- **Playwright.** `retries: 2` on `desktop` and `phone` only (`READ_ONLY_RETRIES`, with the comment); setup and every mutating project keep 0. `fire-mutations` project after `history-mutations`, and `fire-mutations.spec.ts` added to `MUTATING_SPECS`. `e2e/import.spec.ts`: the committed re-import test is wrapped in `test.describe('committed re-import')` with `test.describe.configure({ retries: 0 })` (its title path gains that level).
- **`e2e/polish.spec.ts` + `e2e/audit-support.ts` (drafts for the Integrator).** Routes: `PAGES` + the first holding detail found through `/api/investments/<kind>` + the latest committed import run + `/records/trades` + the style guide. "Loaded" = an h1, no `role="status"` "Loading…" in `main` outside a `[data-gallery-item]` (the style guide shows sample skeletons), network idle. Every ChartCard is switched to its table view before the checks, so chart tables are audited. The sticky-table check needs the first header cell to be `position: sticky` whenever a table scrolls sideways. Keyboard walk (desktop only): focus after the skip link may land on main **or inside it** (Settings and History focus their h1); focus on `body` after the last control is the walk leaving the page (one more Tab wraps to the skip link) and ends the walk, otherwise it counts as lost focus; a ring counts on the control (outline or box-shadow), on an ancestor frame matching `:focus-within` with an outline (`.jf-input`), or on the next sibling's outline (checkbox/switch box). FIRE: the listed controls must be reached, except a button that is disabled (Save and Reset before any change). FIRE fixtures (`firePages`, mocked `GET /api/fire`) run on the phone project only.
- **Draft run (5387/3387, `artifacts/stage6/tooling/data`, 27 Sep):** polish + import on desktop and phone: 95 passed, 49 skipped (the keyboard tests on phone and the FIRE-fixture tests on desktop, by design), **1 failed, a real finding**: `/import/runs/<id>` at 375 px lays its five stat tiles out two per row (left edges 16 and 194 px), against §6.9 D's "one per row" (web-polish-pages / Integrator).
- **CODE-9.** `apps/server/src/lib/dates.ts` (`localIsoDate`, `addDaysIso`, `isoDayBefore`, `monthEndOf` re-exported from the schema) and `lib/sums.ts` (`sumDecimalStrings` = the schema's `sumDecimals`, strict; **additive** `sumValidDecimals` / `sumValidDecimalStrings`, which leave a malformed stored value out, because the two server copies did that and the schema's version throws; `sumCents` with safe-integer checks on every value and on the running total). Call sites: `investments/format.ts` and `market/fxHistory.ts` re-export the shared helpers (the server-api files and tests that import them there are unchanged); `market/providers/fake.ts`, `assets/responses.ts`, `assets/otherAssets.ts` (its unused `sumDecimals` export removed), and `assets/mutations/otherAssets.ts` import from `lib/` (`sumDecimal` removed from `assets/mutations/common.ts`). One visible difference: the fake FX client's malformed-`period2` RangeError now says `addDaysIso: bad input …` (no test reads it).

### web-fire (2026-09-27)
- **`Series.dashed` did not exist** (§5, §6.5 said it did since Stage 5; only `BarOverlay.dashed` does). Added to `charts/types.ts` (line and area charts only; bars ignore it): a 2px dashed stroke and a `dashed-line` legend key (`lineLegend`).
- **`LineChartMarker` (additive):** `labelHidden?` (dots only; the caller sets it) and `tooltip?` (the crosshair's words for that year, default `label`). **Markers in `options/line.ts`:** the vertical 1px dashed `--text-muted` line and its label are an ECharts markLine on the first series (labels anchored inside: first `left`, last `right`, others centred); a markLine's end symbol takes the line's colour, so **the dots are a separate point-only series** (`MILESTONE_DOTS_SERIES` "Milestones", silent, no tooltip, not in the legend) placed at the top of the value axis, which gets headroom (`markerAxisMax`, 14 % of the range; the max tick label hidden) so the dots sit in a lane above every value; grid top 34 px for the labels.
- **STYLE-5 in `line.ts`:** an axis given `compactMoneyFormatter` is replaced by `compactAxisFormatter([min, max])` of the plotted values (0 included; stacked sums for stacked areas), so no caller changes.
- **"Below 768 px" for the chart's markers** is read as the viewport (`MEDIA.phone`): the results column is about 700–760 px wide at 1440, so a chart-width rule would never show labels on desktop. Crowding (dots only) is measured on the chart's width: two nodes closer than 64 px, or their estimated label boxes overlapping.
- **MilestoneLine:** the component implements `orientation: 'auto'` as contracted (container query at 768 px), but the FIRE page passes `vertical` on a phone and `horizontal` otherwise, for the same reason (the line's container at 1440 is under 768 px and would turn vertical on desktop). Label stacking uses a ResizeObserver width (640 px assumed before measuring). `milestoneLabelRows`, `MILESTONE_LABEL_GAP`, `MILESTONE_ASSUMED_WIDTH` are exported from the module (not the barrel). `milestone.css` is in `@layer brand`, no glow (a ui test reads it).
- **hooks.ts:** `queryKeys.fire` / `firePage(query)`, `FIRE_POLL_MS`, `useFire`, `useUseWorkbookContribution`. `['fire']` joins `OVERVIEW_PAGE_KEYS`, so every existing invalidation helper (settings, history, trades, cash flow, assets, prices, imports) refreshes FIRE. `useFire` has `staleTime` 60 s so Reset and a repeated what-if reuse the cached response (§6.4 "Reset sends nothing"); every input change still invalidates it.
- **Page decisions:** the results/what-if split (8 + 4 of 12, the card sticky at ≥ 1200 px) is a `fire.css` grid (`GridItem` has no span 8); the what-if fields go two per row from a 736 px content box (768 px card). The `featureOn: false` callout is left out when the layout already shows its switched-off note (same text, `SWITCHED_OFF_NOTE`), so it never appears twice. The refetch-error and what-if-failure callouts are FIRE's own ("Couldn’t refresh: … Showing the figures from 14:32." / "Couldn’t recompute: …"); web-polish-pages may swap the first for the shared one. The needs-input links: birth year → `/settings#fire`; access age, inflation and withdrawal rate focus their what-if field; the market and cash rates → `/settings#investing`. Two milestones in one year read "FIRE · Access". Texts use the curly apostrophe (`You’re FIRE`, `How it’s worked out`), as the rest of the app; the e2e drafts match. The "How it’s worked out" tables show money at two decimals (tables rule), figures inside phrases monospaced (`jf-app-fire-figure`); their alignment is web-polish-ui's (STYLE-7).
- **e2e drafts (Integrator):** `fire-support.ts` (`mockFirePage` per query, `firePage`, `fireSettings`, `resetFireAppOnlyKeys`), `fire-states.spec.ts` (every fixture at 1440/1024 and 375, then the what-if, both views, the months used), `fire.spec.ts` (read-only; skips like the other synthetic-import specs), `fire-mutations.spec.ts`. `fire-states` ran green on 5384/3384 with `--no-deps` (54 passed, desktop + phone; mocked `/api/fire`); `fire.spec` and `fire-mutations` need the real API (not run in phase A).

### Integrator (2026-09-27)
- **Shared page lists (§6.9):** FIRE joined `apps/web/src/pages/pageCases.ts` (`GET /api/fire`, every `firePages` state, skeleton "Loading FIRE…" `dashboard`, error "Could not load FIRE"), so `states`, `formatAudit`, `noStage5` and the router's pending-layout test now cover it; their header comments updated.
- **Integration fixes in web-fire's files:** `FirePage.tsx`'s failed refetch of the saved plan now renders the shared `RefreshError` ("Couldn't refresh", §6.9 B; the shared states test requires it); the what-if failure keeps FIRE's own "What-if not updated" callout (§6.2). `FirePage.test.tsx` updated to match. `WorkedOut.tsx`: the real-rate comparison carries `RATE_DP_PLACE` (it is one of §6.9 G's documented two-decimal places; the format audit flagged it on `notReachable` and `marketReturnFire`).
- **web-polish-pages' `vite.config.ts`:** imports `./src/codeSplitting.ts` with its extension (Vite 8 warned that the extensionless import is unsupported by the native config loader; `allowImportingTsExtensions` is on). `pnpm build` now prints no warning at all.
- **e2e:** `ui-core.spec.ts`'s short-page test removed with a note (it held only the `['/fire']` placeholder list); the skip-link test waits for the lazily loaded h1 before its first Tab (it failed on every retry otherwise). `audit-support.ts`: `isFireStub` removed; `polish.spec.ts` runs the FIRE control check on the real API (the page renders every control under its switched-off note); `FIRE_KEYBOARD_TARGETS` confirmed against the page (the desktop FIRE walk passed). **New `e2e/warmup.setup.ts`** (setup project; read-only) opens every lazy route once before desktop and phone run, and **`playwright.config.ts` sets `expect.timeout` 10 s**: with lazy routes a cold dev server delivered a page's modules after the load event, so the first test to open each page failed its 5 s h1 wait (about 20 first-attempt failures and a failed no-retry import test in the first run). `import.setup.ts` untouched.
- **Prod bundle (§7.8 step 3):** `pnpm build` with no warning (92 JS chunks; largest echarts 409.91 kB, react 218.83 kB, entry `index-*.js` 199.89 kB, zrender 181.98 kB, tanstack 157.24 kB, FirePage 41.83 kB); `pnpm start` on 3385 with a fresh data dir: 22 deep links served HTML and rendered an h1, client navigation through all 19 sidebar pages loaded every chunk, no 4xx on an asset and no page error.

### Fixer (2026-09-27)
- **SPEC-1 + CODE-1 (one fix; `packages/engine/src/fire.ts`):** the step-1 return is a local `needsInput(missing)` (same shape). After step 1 every Dec→cents conversion of the success path (rows, helper, target, top-ups, the pre-super/super KPIs) goes through a local converter that checks `isSafeCents` and, on a figure beyond the safe-integer cents range, sets an `overflow` flag and returns 0 (it never throws); the result is then `needs_input ['rates']`. A target `S ÷ wr` beyond the range returns `needs_input ['withdrawalRate']` first (the spend is bounded, so only the rate can cause it). CODE-1's suggested sentinel-exception design was not used: SPEC-1's flag gives the same result with no throw at all; the `FireMissingInput` union, the DTO, the query schema and `SETTING_WRITE_BOUNDS` are unchanged. §2.5 step 1 now says so (`rates`: "or any projected figure beyond the safe-integer cents range"; `withdrawalRate`: "or the target S ÷ wr beyond that range"). `fireText.ts` `MISSING_WORDS.rates` → "workable growth and inflation rates". Tests: `packages/engine/test/fire.test.ts` (long horizon: growth −0.9, inflation −0.9 and −0.5 → `rates`; wr 1e-10 → `withdrawalRate`; the −0.5 growth control stays `not_reachable`; the `onTrack` fixture's (−0.99, 1) and (1, −0.99) pairs; a young birth year at 100 % growth); `apps/server/test/fire/integration.test.ts` (real engine: `?marketReturn=-0.9`, a saved inflation −0.9, `?withdrawalRate=0.0000000001`, `?inflationRate=-0.99&marketReturn=1`, the saved pair then `GET` and `?spend=1000000`: all 200 with `needs_input`).
- **SPEC-2:** `FIRE_QUERY_ACCESS_AGE_MAX = FIRE_HORIZON_AGE − 1` (99); `SETTING_WRITE_BOUNDS['fire.preservationAge']` 0–99 (registry 0–120 unchanged, §3.3); the `fireValidation` sample error reads `<=99`; the Scaffolder note above updated. Tests: schema (query 99/100, write bound 99/100), `routes.test.ts` (accepted `accessAge=99`, rejected `accessAge=100`, PATCH 100 → 400), the what-if age message "from 30 to 99".
- **SPEC-3 (private only, no tracked values):** §10 #7 says the private §4 figures are computed from the spend in whole cents. The private §4.5 and §6 figures downstream of `S ÷ wr` were recomputed (`artifacts/stage6/fixer/owner3.ts`) and the spec reviewer's owner check, with the updated expectations (`artifacts/stage6/fixer/owner-check.ts`, a fresh copy of the pre-Stage-6 backup), passes 58 of 58. **Coordinator:** the changed private figures may need adding to the guard terms.
- **SPEC-4:** `apps/server/test/golden/fire.golden.test.ts`: both the sheet's closed-row helper and ours must be non-null (null on both sides now fails); the server goldens pass with the local workbook.
- **STYLE-1/2:** the result strip is sticky at every width (`top: spectrum-h + shell-header-h + space-2`, `fire.css`); the side card's top adds `--spectrum-h`. `--shell-header-h` is 88px below 768 px (`tokens.css`), and the phone `scroll-padding-top` reads the token (`base.css`, the same 100 px). Tests: `packages/ui/src/core/headerOffset.test.tsx`; `e2e/fire-states.spec.ts` (strip below the header, in the viewport and on top at the last slider: 1440×900 and 1280×800 desktop, 375 phone).
- **STYLE-3:** inside the dimmed results column the chart's own refreshing dim is cancelled (`fire.css`); `loading` is still passed. e2e: while a what-if is held, the plot's opacity product settles at 0.6 and the chart has `jf-chart--refreshing`.
- **STYLE-4:** the slider's native look is reset (`appearance: none`) with a 16 px teal thumb (2 px `--surface` border) centred on the 4 px `--raised` track. e2e: `appearance` is `none`; close-ups at 1440 and 375 in `artifacts/stage6/fixer/`.
- **STYLE-5:** `Meter` marks a negative value `jf-meter__value--negative` (`--stop-tint`, meter.css). Tests: `Meter.test.tsx`, `FirePage.test.tsx` (`negativePreSuper`).
- **STYLE-6:** `WorkedOut.tsx` shows every figure at two decimals (`money`), including the words "counted as $0.00" in its tables and the months-used cell. Test: every `$` figure in the "How it's worked out" tables has two decimals.
- **STYLE-7:** `MilestoneLine` measures each horizontal segment (`useLayoutEffect` on width and segments) and marks one whose words overflow `data-fits="false"` (hidden whole; no ellipsis). Tests: `MilestoneLine.test.tsx`; the e2e states check that no visible segment is clipped.
- **STYLE-8:** a slider with no value carries `data-unset` (thumb hidden, track at 0.6); it stays enabled. Tests: `WhatIfPanel.test.tsx`.
- **CODE-2:** `intQuery(min, max)` (`dto/fire.ts`): a JS integer or a strict whole-number string; used for `spend`, `accessAge`, `extraSavings` and `netWorthQuerySchema.count`. Tests: schema, `routes.test.ts`, `history/pages.test.ts`.
- **CODE-3:** the upload route and the CLI catch a failed `applySettingUpgrades` after a committed import (a warn line with the code / one stderr line); the run is answered (201, exit 0) and the price refresh still scheduled. Tests: `fire/import-upgrade.test.ts` (a partial mock throwing `SQLITE_BUSY`).
- **CODE-4 (§8.2 guard):** a comma grouping and an underscore run have their own boundaries (a list or CSV comma next to an underscore run no longer hides it), and a separator-containing term (`4,321`) also matches its other separator forms (`4_321`), never its plain digits. Tests: `tools/privacy-guard/test/rules.test.ts`; `pnpm guard:all` finds nothing new.
- **CODE-5:** `playwright.config.ts`: `setup` runs `import.setup.ts` only (0 retries); a new read-only `warmup` project (`warmup.setup.ts`, after `setup`, `READ_ONLY_RETRIES`); desktop and phone depend on both. **Integrator/Verifier:** list any warmup test that needed a retry too.
- **CODE-6:** `apps/web/src/lazyChunk.test.tsx`: the app router's `defaultErrorComponent` is `ErrorPage`; a missing chunk sets the one-reload key and shows no error screen; with the key set it shows ErrorPage; any other import error shows ErrorPage and sets no key.

## Stage close notes (coordinator)

**Outcome (2026-09-27).** The flow ran in three workflows plus coordinator steps:
1. Planner → 3 plan critics (spec, UX, feasibility/privacy) → reviser. The owner confirmed all four §14 defaults (D105–D108), so the plan needed no change. The coordinator ran the pre-step: the `data/` backup and the §8 and §8.1 guard terms.
2. Scaffolder → engine, server-api, web-fire, web-polish-ui, web-polish-pages and tooling in parallel → Integrator (8 agents).
3. 3 reviewers → per-reviewer triage → Fixer → Verifier (8 agents).
4. Coordinator follow-ups:
   - reworded the §10.1 figure, which the hardened guard caught in its separator form;
   - added the STYLE_GUIDE notes of §7.1 (KV values left-aligned, skeletons, node-line colour by position);
   - ruled on the build's routed items (the imported super-contribution notice in the settings fixtures, the extra two-decimal places, `apps/web/test/renderApp.tsx`);
   - added 59 more guard terms for the 17 recomputed private figures (SPEC-3).
5. The demo, then the owner's density feedback (below).

The owner approved the demo and accepted all 23 §11 fixes (D110).

- **Final state:**
  - typecheck, lint, format:check, build and `guard:all` (8023 private terms) are green. The build has no chunk warning, and the entry chunk is about 200 kB.
  - **5063 unit tests** pass, with every gated suite and golden running. The density change added no tests, and the full suite was re-run after it.
  - e2e: the Verifier's full run passed with retries (550 passed, 12 flaky, skips by viewport design), and all five mutating projects ran in chain order.
  - After the density change, the layout-sensitive specs passed again: Net Worth, polish, charts, assets, FIRE, history, cash flow, investments and ui-core.
- **Plan review:** 68 findings (16 spec, 36 UX, 16 feasibility/privacy). 64 were applied, 4 in part and none rejected. Four went to the owner (D105–D108).
- **Code review:** 19 findings (SPEC 4, STYLE 8, CODE 7). 18 were fixed with tests and CODE-7 was deferred. SPEC-1's proposed tightening of the query and write bounds was not taken: the engine guard is the fix, so every allowed value answers `needs_input` instead of overflowing.
- **Demo on the real `data/`:**
  - The first start applied the D98 one-off once (65 → 60, one log line), and `hasAppData` stayed false.
  - The FIRE figures matched the private §4 (FIRE year and age).
  - A what-if (access age 65) recomputed live with the four-node milestone line. Reset restored the saved values, and nothing was saved.
  - At phone width there is no sideways scroll.

**Density (owner feedback at the demo, D109, D110).**
- **`@joinr/ui`:**
  - Table cells are 3 × 8 px (headers 6 × 8) at 1.35 line height, so a row is about 24 px (from about 36). Key–value rows match.
  - Cards and stat tiles pad 12 px, callouts 8 × 12 px and section bars 6 × 12 px.
  - The page flow is 16 px, the page header is tighter and badges use 1.35 lines.
  - The default chart height is 240 px.
  - The compact hero band's node line sits at 26 px (110 px minimum).
- **`apps/web`:**
  - From 768 px, buttons inside tables are 22 px, and stacked cell figures sit without a gap.
  - The rolling table's rate and Check badge share one line.
- **Net Worth:** the assets table sits beside the allocation, the donut and the gauge, and the four "Over time" charts form a 2 × 2 grid.
- **Tried and reverted:** one-line price, fee and result cells, and wider notes. They pushed the Crypto, Managed Funds, Cash and Other Assets tables past the content area.
- **Result:** no page scrolls sideways and no table is wider than before. STYLE_GUIDE §3 records the rule.

| Page at 1440 px | Before | After |
|---|---|---|
| Net Worth | 4139 px | 2749 px |
| Stocks | 3798 px | 3089 px |
| Cash | 4880 px | 3961 px |
| History | 2664 px | 2092 px |
| Super | 6350 px | 5116 px |

**Deferred (with target stage):**
- **Stage 7 cleanup:**
  - CODE-7: adopt `sumCents` at the three server cents-summing sites (`cashflow/cash.ts`, `history/pages.ts`, `investments/timing.ts`) and decide the overflow behaviour, or drop `sumDecimalStrings`/`sumCents`.
  - Drop `STAGE_TITLES` and `PAGES.stage` if they are still unused.
- **Optional:** narrower what-if input ranges (SPEC-1's bounds), only if the owner wants them.
- **Stage 7 cutover (carried):**
  - Set `TZ` in the compose file (D89).
  - After the fresh import, switch auto-record on (D84) and record or skip any missing month (D94).
  - Correct the mortgage payment and compounding in the sheet before the export (D76).
  - Optionally date the undated items (D73).
  - Fix the budget rows' stale account names (D65).
- **Known behaviour:** writing a FIRE setting back through the API or the page records it with origin `app`. A restore cannot bring back the workbook origin, so the super contribution then reads "Your setting" (D103, D105). This has no effect on `hasAppData`.

**Lessons carried forward:**
- The hardened guard also checks the coordinator's own plan text. Write worked-example figures without separators, or round them.
- A density change needs an overflow check on every page, of each table's inner scroll width as well as the page's. A one-line cell that saves height can push a wide table past the content area.
- The Claude Browser pane's emulated viewports crop screenshots. For a page-wide review, take Playwright full-page shots against the dev server.

## Plan review log (2026-09-27)

Three critics (spec, UX, feasibility/privacy) reviewed this plan and the private companion. The plan reviser verified each finding against the code, the specs, the decisions and the local workbook (scratch under `artifacts/stage6/plan-reviser/`: `model2.ts`, the §2.5 model after this review in doubles with no owner data, and `example2.ts`/`cases.ts`, which reproduce §10.1 and the new status cases; a run of the revised model on a copy of the owner database with a fixed clock; a guard-term generator for the new figures; re-runs of the critics' probes), then applied it, applied it in part, or rejected it. Findings are listed in the order received, with the critic's id; the owner-specific consequences (the recomputed projection, the owner-question figures, the demo expectations, the guard terms) are in the private companion. None was rejected; four were applied in part (SPEC-3, SPEC-16, UX-14, FEAS-6). Consistency fixes made while revising: the super meter now measures against the need at access, so `super.progressRatio` and the §10.1 KPI changed with it; `FIRE_MILESTONE_TONES` became `FIRE_MILESTONE_TONE_ORDER`; the web-polish role split into two owners and CODE-9 moved to tooling, so every section naming an owner was updated (§1.2, §6, §7, §8.1). **One finding needed the owner's decision** (SPEC-2, the debts in the FIRE pot): it is applied provisionally as fix 22 and folded into §14 question 2; questions 1, 3 and 4 remain open as the Planner wrote them.

| # [critic id] | Finding (generic) | Outcome |
|---|---|---|
| 1 [SPEC-1] | Grid row counts and total cell counts in the committed plan let a reader derive the owner's birth year | **Applied:** no row range, row count or cell total in any committed line (header, §2.6, §9.3 rules 2 and 7, §12, §13); reports say "matches private §2.1"; the counts stay in the private §1–§2.1 |
| 2 [SPEC-2] | A negative pre-super pot compounded at the asset return, so a loan grew like an investment and a higher return made the path worse | **Applied provisionally (owner question 2):** `L` (the debts inside pre-super) is split out and held fixed in dollars, `projected(t) = (A0 + L)·q(t) − L·(1+i)^−t + P'·s(t)`; `FireDerived.preSuper.debtCents`, `FireProjectionInput.preSuperDebtCents`, the row growth rule, a monotonicity test and generic cases in §10.1; fix 22 (§2.2–§2.5, §4.5, §7.3, §11, §14) |
| 3 [SPEC-3] | After access the floor on `needed` forced the pre-super pot to be non-negative even when super far exceeded the target | **Applied in part:** the test after access is the signed `target − B(t)` (displayed floored), with the critic's `fire` case; the draw order after access is super first, pre-super once super is exhausted (the proposed "pre-super whenever super is below the target" would switch buckets whenever the real return is below the withdrawal rate, and with one rate the order does not change combined wealth); fix 23 (§2.3, §2.5, §7.3, §10.1) |
| 4 [SPEC-4] | Three rules disagreed on FIRE exactly at the access age with super below the target | **Applied:** no lump; super at access is the plan path's super at the access row (`B(n)` here) and the pre-super pot covers the rest; §7.3 reworded, a generic case in §10.1 (§2.5 steps 5–6) |
| 5 [SPEC-5] | Rows start from today's balances but were described as 1 January balances; the window's staleness was invisible | **Applied (whole anniversary years):** rows are the years from each anniversary of the as-of date, labelled by calendar year; D52 does not apply (stated); a 31 Dec → 1 Jan test; the window's through-date shown and a note after 45 days (§2.1, §2.4, §3.2, §5, §6.3, §7.3) |
| 6 [SPEC-6] | Owner-data acceptance checks and seeded tests depended on the wall clock | **Applied:** the Verifier and the spec reviewer check the private §4 through a git-ignored `buildApp({ now })` + `app.inject` script; `pnpm start` only for the upgrade log line; every server FIRE test passes a fixed `now` (§4.5, §7.4, §7.9, §10 #7, #10, §12) |
| 7 [SPEC-7] | "Raw" figures could mean adjusted-with-floor-undone or the unadjusted sheet figures; rounding order unstated | **Applied:** raw = means of `SavingsPeriod.raw` unrounded values; yearly figures from unrounded values, rounded once; §10.1 wording "with no D51 adjustment"; a test with an adjustment (§2.4 step 3, §7.3, §10.1) |
| 8 [SPEC-8] | The hand-worked example left super out of the growth blend, contradicting the default | **Applied:** cash $30,000 at 5.12 % and $720,000 (investments and super) at 6.12 % still give 6.08 % and r = 4 %; every other figure unchanged; the §6.3 example words follow (§6.3, §10.1) |
| 9 [SPEC-9] | The STYLE-11 geometric check fails on every correct sticky table | **Applied:** `elementFromPoint` inside the sticky header cell, its opaque background, and header cells stacking above body sticky cells (§6.9 D) |
| 10 [SPEC-10] | The "without the home loan" figure added back the net debt and so dropped linked offset cash | **Applied:** the gross primary-residence loan balances are added back; `FireDeriveInput.property` is the whole `PropertiesResult`; a linked-offset test (§2.2, §2.4, §7.3) |
| 11 [SPEC-11] | Birth years, access ages and empty weights allowed by the settings bounds gave undefined results | **Applied:** `missing` gains the three guards, one test each (§2.5 step 1, §7.3) |
| 12 [SPEC-12] | The savings golden compared with 0 when the sheet's savings cell was text, though the closed-row mean can be positive | **Applied:** always the closed-row helper; the text case skips only the adapter check (`text_input`, not counted) (§9.3 rule 4) |
| 13 [SPEC-13] | The engine golden's corrected-model invariant had no defined inputs | **Applied:** the inputs are listed cell by cell (§9.3 rule 6) |
| 14 [SPEC-14] | Wrong private section for the counts, a month range inconsistent with the example date, and `E63` valued at the wrong time | **Applied:** private §2.1; "Mar 2029 – Feb 2030"; `E63` maps to `shortfall(k) ÷ q(bridge(k))` (§2.3, §6.3, §7.9, §9.3, §10 #4, §12) |
| 15 [SPEC-15] | Fixed colours per milestone kind break the spectrum order when FIRE is after access | **Applied (with UX-9):** colour by position, the label carries the kind, same-year milestones merge into one node; tests on `afterAccess` and `fireAtAccess` (§2.5 step 8, §3.2, §5, §6.3) |
| 16 [SPEC-16] | Spending at the end of each year is slightly optimistic and the convention was unstated | **Applied in part:** the end-of-year convention (as savings, and the §10.1 arithmetic) is kept, stated in §2.1, §11 fix 5 and on the page; switching to start-of-year was not taken (it would move every example figure for a small effect) |
| 17 [UX-1] | The what-if results were off screen while its inputs moved | **Applied:** at ≥ 1200 px a span-8 results column beside a sticky span-4 what-if card; a sticky result strip in the card below that; fields 2 per row from 768 px (§6.3, §6.4, §6.6) |
| 18 [UX-2] | Enter in a what-if field would have saved settings | **Applied:** Enter commits and recomputes; Save and Reset are `type="button"`; a test; the keyboard rule's exception (§6.4, §6.9 F) |
| 19 [UX-3] | web-fire owned no stylesheet | **Applied:** `pages/fire/fire.css` (`jf-app-fire-*`), created empty by the Scaffolder (§6.1, §7.1) |
| 20 [UX-4] | Chart markers need `MarkLineComponent`, which was not registered and sat in another owner's file | **Applied:** the Scaffolder registers it; a render test (§6.5, §7.1, §7.2) |
| 21 [UX-5] | `StatTile` had no slot for a meter | **Applied (with FEAS-11):** a `footer` slot as a Scaffolder contract; the rule is one text line plus a meter (§6.3, §6.5) |
| 22 [UX-6] | Rate precision and slider steps created what-ifs nobody made; slider ranges excluded valid values | **Applied:** saved precision kept, decimal-string compares, the field as the source of truth, ranges extended to the current value; tests (§6.1, §6.2, §6.4) |
| 23 [UX-7] | Stale figures looked current while recomputing or after a failure | **Applied:** `aria-busy`, dimming, "Updating…", a what-if error callout, a failed-Save announcement (§6.2, §6.4) |
| 24 [UX-8] | The STYLE-6 fix could not pass its own check at 375 px | **Applied:** KV rows stack below 480 px of container width; a ui test with the longest label (§6.9 D) |
| 25 [UX-9] | As SPEC-15, plus two milestones in one year | **Applied** (with item 15) |
| 26 [UX-10] | Hairline markers were invisible, labels collided and dots clashed with the series | **Applied:** dashed `--text-muted` lines, a dot lane above the plot, labels inside, dots only when narrow or crowded, the milestone in the crosshair tooltip (§5, §6.5) |
| 27 [UX-11] | The chart's table views left out the milestones | **Applied:** a Milestone column and captions (§5) |
| 28 [UX-12] | The baseline DTO could not fill every tile's "Saved:" line | **Applied:** `FireSummaryDto` gains the super and spend figures; the hint stays and a "Saved:" line is added (§4.4, §6.3) |
| 29 [UX-13] | The FIRE empty state had no predicate or fixture | **Applied:** `FirePageResponse.isEmpty` and an `empty` fixture, the Net Worth empty-screen pattern (§3.6, §4.4, §4.5, §6.3) |
| 30 [UX-14] | Fixtures were missing for several states the page draws | **Applied in part:** eleven fixtures added; the what-if failure is built in the web tests from the error fixtures rather than as a page fixture (§3.6) |
| 31 [UX-15] | The Super tile's figure and meter measured against different targets | **Applied:** the meter measures current super against the need at access with the projection marker; the self-sustaining figure moved to "How it's worked out"; `super.progressRatio` redefined (§2.2, §2.5 step 7, §6.3, §10.1) |
| 32 [UX-16] | The callout cap had no drop rule and an app-set super contribution could not be reverted on the page | **Applied:** status callouts first, dropped notes move into "How it's worked out"; both buttons live in the super contribution row (§6.3) |
| 33 [UX-17] | Focus was lost after controls that disappear once used | **Applied:** stated focus targets and `document.activeElement` tests (§6.4, §7.5) |
| 34 [UX-18] | "Save as my settings" did not say what it would fix in place | **Applied:** a save summary with the spend and return consequences; tests (§6.4) |
| 35 [UX-19] | Range sliders had no style, accessible name, value text or defined key handling | **Applied:** teal accent and track, `aria-labelledby`/`aria-valuetext`, explicit Page Up/Down and Home/End handling tested in unit and Chromium e2e, a cleared field reverts (§6.4, §7.5) |
| 36 [UX-20] | The keyboard e2e walk mostly tested the navigation | **Applied:** it starts in `main` through the skip link, walks every focusable there (capped at 60) both ways, and lists FIRE's controls (§6.9 F) |
| 37 [UX-21] | Parts of the phone audit had no check and "no page scroll" was ambiguous | **Applied:** scoped to the synthetic import plus the FIRE fixtures; button-width and left-edge assertions; "no horizontal page scroll" (§6.6, §6.9 D) |
| 38 [UX-22] | Left-aligned KV numbers contradicted the style guide | **Applied:** `numeric` stays mono, KV values inherit left alignment; the coordinator records the exception in STYLE_GUIDE §5 and §10 (§6.9 E, §7.1) |
| 39 [UX-23] | A broken section reference and labels that differed between the page and Settings | **Applied:** the reference points to §6.4; one `FIRE_FIELD_LABELS` map with shared base words and a test (§3.2, §3.3) |
| 40 [UX-24] | Phase words disagreed between the line and the table | **Applied:** one `FIRE_PHASE_WORDS` map (§3.2, §6.3) |
| 41 [UX-25] | Ambiguous year-table headers and unsigned outflows | **Applied:** "Pre-super growth", "Super growth", "Contributions + top-ups", U+2212 on outflows and a caption (§6.3, §6.6) |
| 42 [UX-26] | Tooltips used the compact formatter, unlike the other charts | **Applied:** compact for axes only, full dollars in tooltips (§5) |
| 43 [UX-27] | The real-rate comparison could print the same figure twice | **Applied:** "(not X)" only when the texts differ, otherwise two decimals; allowed by the format audit (§6.3, §6.9 G) |
| 44 [UX-28] | A prose date was written dd/mm/yyyy | **Applied:** the long form (§3.4, §6.1) |
| 45 [UX-29] | Two different skeletons showed in a row on a cold navigation | **Applied:** per-route pending wrappers with the page's layout; a test (§6.1, §6.9 A) |
| 46 [UX-30] | The FIRE state e2e skipped 1024 px and the milestone line's breakpoint basis was unstated | **Applied:** 1024 px added; a container query (§6.3, §6.5, §7.5) |
| 47 [UX-31] | Tile hints lost information in edge states | **Applied:** the after-access year, "Today · You're FIRE", a small-count note, and each status's tile content (§6.3) |
| 48 [UX-32] | The market return's source was never shown | **Applied:** "(your FIRE return)" or "(from Investing settings)" with the matching link (§6.3) |
| 49 [UX-33] | The chart card's title did not follow the view | **Applied:** "Your path by year" with a view subtitle and a per-view `ariaLabel` summary (§5, §6.3) |
| 50 [UX-34] | The code-splitting budget might be unreachable | **Applied (with FEAS-4)** |
| 51 [UX-35] | First-load and refetch errors used different tones | **Applied:** `LoadError` moves to `important`, tests updated (§6.9 B) |
| 52 [UX-36] | What-if fields did not say how they follow new saved values | **Applied:** untouched fields follow, touched keep theirs; Reset enabled only when something differs (§6.4) |
| 53 [FEAS-1] | As SPEC-1, and the birth year was not a guard term | **Applied (with item 1):** the birth year is added to the private §8.1 terms (no tracked file holds it) |
| 54 [FEAS-2] | "Use it" could not work through PATCH, which skips unchanged values and keeps their origin | **Applied:** a dedicated, idempotent `POST /api/fire/use-workbook-contribution` flips the row's origin; server tests (§3.3, §4.2, §4.5, §6.2, §7.4) |
| 55 [FEAS-3] | Normalising terms that already contain separators would hit ports and years, and two styleguide numbers equal a term | **Applied:** only runs that contain a separator are normalised, and only digits-only terms are matched against them; tests that a term with a separator never matches its plain digits; the Scaffolder changes the two styleguide numbers first (§7.1, §7.7, §8.2) |
| 56 [FEAS-4] | One echarts+zrender group exceeds 500 kB, the entry budget was unreachable as worded, and the group tests must match Windows paths | **Applied:** separate groups with separator-agnostic tests and priorities; < 500 kB minified per chunk is the check; the entry size is a recorded target; a recorded exception route for echarts (§6.9 H, §10 #11) |
| 57 [FEAS-5] | In-file route wrappers pass props, which lazy route components cannot receive | **Applied:** wrappers move to lazy route modules or `getRouteApi`; no-props pending wrappers; the static-import test reworded; one reload before `ErrorPage` is expected (§6.1, §6.9 H, §7.9) |
| 58 [FEAS-6] | Marker registration, the dashed legend key and the milestone stylesheet sat in unowned or other owners' files | **Applied in part:** `Series.dashed` and its legend key already exist (Stage 5), so nothing is added there; the Scaffolder registers `MarkLineComponent` and creates `milestone.css` with its `@import` (§1.2, §6.5, §7.1) |
| 59 [FEAS-7] | The STYLE-5 tick fix for line charts lived in web-fire's file | **Applied:** a shared `compactAxisFormatter` stubbed by the Scaffolder, implemented by web-polish-ui, called from both chart option files (§6.9 C, §7.1) |
| 60 [FEAS-8] | The settings readers map would break at scaffold, some tests had no owner, and FIRE's other inputs were not mapped | **Applied:** `readers.ts` and the default/label assertions are Scaffolder compile fixes; server and importer tests pass to server-api; `'fire'` added to the readers of every setting FIRE reads (§4.5, §7.1) |
| 61 [FEAS-9] | web-polish was far larger than any other agent | **Applied:** split into web-polish-ui and web-polish-pages; CODE-9 moved to tooling; the build workflow has 8 agents (header, §7) |
| 62 [FEAS-10] | Page-wide tests would churn against the FIRE page while it was built | **Applied:** phase A lists exclude `/fire`; web-fire tests FIRE's states itself; the Integrator adds it in phase B (§6.9, §7.5, §7.6, §7.8) |
| 63 [FEAS-11] | As UX-5 | **Applied** (with item 21) |
| 64 [FEAS-12] | The Scaffolder had to re-implement the model for the fixtures and nothing checked them against the engine | **Applied:** fixtures come from the git-ignored `model2.ts` with recorded inputs; a gated server test reproduces each within 1 cent (§3.6, §7.2, §7.4) |
| 65 [FEAS-13] | The FIRE mutation e2e could not restore import origins, and a retried project would retry a mutating import test | **Applied:** it writes only keys it can set back to null and asserts through `/api/fire`; `DATA_DIR`s are deleted before full runs; `retries: 0` on the mutating import test (§7.5, §7.7, §7.8) |
| 66 [FEAS-14] | Owner-specific qualitative facts appeared in the committed plan | **Applied:** generic wording throughout (header, §9.3, §12, §14) |
| 67 [FEAS-15] | Guard terms missed compact chart forms, the birth year and some monthly forms | **Applied:** compact forms are added with their suffix (the guard's boundaries would never match a bare "NNN.N" before "k"), with the birth year and the missing forms, in the private §8.1 |
| 68 [FEAS-16] | Existing e2e specs had no Stage 6 owner | **Applied:** the Integrator owns every `e2e/**` file for integration fixes, each listed (§7.1, §7.8) |

### Owner answers (2026-09-27)
The owner confirmed every §14 default: (1) only an app-set super contribution overrides, the workbook figure is offered with a button (D105); (2) debts stay in, fixed in dollars, fix 22 (D106); (3) super counts in the growth blend (D107); (4) savings capped at income in negative-spend months, fix 7 (D108). No plan change was needed.
