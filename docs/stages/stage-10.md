# Stage 10 — Phone app: period selector: build plan

_Planner output, 2026-10-03. Inputs: PLAN.md (Stages 9–10), docs/HANDOFF.md, docs/DECISIONS.md (D10, D11, D95, D109, D136 and D137–D159 still bind; **D156 and D158 set the stage; D160–D165 are the Stage 10 kickoff answers** and refine them: D161 replaces D156's "all is the unrealised gain"; **D166–D170 are the plan-review answers**, applied in the Owner review revision at the end), docs/stages/stage-9.md (the form, and the record of the Stage 9 code this stage builds on), docs/style/STYLE_GUIDE.md, the code scout's report and the data-source probe report (both under the git-ignored `artifacts/stage10/`), and the Stage 9 code (`packages/engine/src/{dayChange,investments,otherAssets,types,num}.ts`, `packages/schema/src/{dates,enums,mobile}.ts`, `apps/server/src/market/{refresh,fxHistory,history,service}.ts`, `market/providers/{yahoo,coingecko,exchangeTime,http}.ts`, `market/dividends/**`, `mobile/{today,bullion}.ts`, `routes/mobile.ts`, `config.ts`; `apps/android/app/build.gradle.kts`, `App.kt`, `net/{ApiClient,ApiError,Dto}.kt`, `model/TodayModel.kt`, `store/Repository.kt`; `tools/deploy/smoke.mjs`; `packages/schema/test/mobile-rules.test.ts`; `apps/server/test/golden/{investments,mobile}.golden.test.ts`; `packages/schema/src/testing/seed.ts`)._

> **This repo is PUBLIC.** Nothing from `reference/` (except `reference/brand/`), `docs/private/` or `artifacts/` may be copied into any other file: no amounts, holdings, tickers or coin ids the owner holds, account names, **no IP addresses (only loopback and the RFC 5737 documentation ranges), no host or tailnet names other than the SSH alias `umbrel`**, no phone model, no personal paths, emails or Drive ids, and no probe body (they carry live prices). Fixtures and tests use the existing generic symbols (`ASX:ABC`, `ASX:XYZ`, `ASX:DEF`, `ASX:MNO`, `ASX:OLD` (the seed's sold instrument), `ASX:EXA`, `ASX:EXB`, `EXAMPLEFUND`, `EXAMPLEFUND2`, `BTC`, `ETH`, `NYSE:EXUS`, `0PEXAMPLE1`) and dates in **2030** (server DST tests may use the 2030–2031 change dates). The owner-specific facts for this stage are in **`docs/private/stage-10-private.md`** (git-ignored): the coordinator, the code-quality reviewer and the Verifier read it; nobody copies from it. **The store repository is public too.**
>
> **No agent commits or pushes, and no agent touches the Umbrel.** deploy writes the store's manifest into the local clone **uncommitted**. Agents never run `ssh`, `scp` or `docker` against a remote host, never install an APK on a real phone (adb: `-s emulator-NNNN` only), and never create or read the owner's signing keystore. Every live step (§11) is the coordinator's, with the owner's OK.

**Flow:** Coordinator pre-step (guard terms, confirm no dev server, §10.0) → **server-market step 0** alone (the contract of §2–§4: the period rules as a pure engine module, constants, enums, DTOs, the three cache tables and migration 0007, the close readers, fixtures and their JSON copies for the Android tests; ≈ 1 agent-step) → **4 implementers in parallel**: **server-market** (the `closes` job: Yahoo and CoinGecko daily history, FX and bullion series, the derived spot, splits, the fake histories), **server-api** (the periods builder and `GET /api/mobile/periods`, bullion widened for ALL, the equality and golden tests), **deploy** (smoke, version, docs, the store notes; light), **android** (`apps/android`) → **phase B** for android (the emulator smoke against a real server) once server-market and server-api report done → Reviewers in parallel (**spec-correctness**, **style-ux** (Android), **code-quality/security**) → per-reviewer triage → **Fixer** → **Verifier** → **coordinator live smoke on the Umbrel** (§11 step S) → **release 1.3.0, the proxy probe of the new path, the signed APK 1.1.0, the demo on the owner's phone** (§11). Build workflow: 5 agent-steps (server-market ×2, server-api, deploy, android); review workflow: 6 (3 reviewers, triage, Fixer, Verifier).

**Golden values:** one new golden (§12 #4), in `apps/server/test/golden/mobile.golden.test.ts` (gated, skipped when the local workbook is absent; the Stage 2 `investments.golden.test.ts` reader, corrections off, its §9.3 rules and adjustments): **Σ `realisedCents` over every `HoldingResult` of the four kinds (held `ok`, held `unpriced` and the instruments in the Sold figure alike; the engine's figures, so an unpriced holding's realised gain, which the ALL total leaves out (§2.3), is still compared) equals the workbook's Capital Gains V summed over every financial year** (tolerance one cent per disposal, as that test), and **each held, priced holding's ALL unrealised part equals the workbook's total-return cell minus its dividends cell** (with that test's partial-lot-fee and D28 re-link adjustments, and its unpriced and no-prices skip rules). Counts only are printed. The 1W–12M figures have **no golden**: the workbook keeps no price history. The Stage 1–9 goldens must pass unchanged. **Template bug fixes:** none. **Behaviour changes** (vetoable at the plan review or the demo): §15.

**Verified by the Planner (2026-10-03; the code at `d9ae564`; the scouts' saved reports; nothing written to the repo but this file, nothing to the Umbrel):**
- **No instrument price history exists.** `day_quotes` is 1:1 (the latest session, replaced each session). The only daily store is `market_quote_history` (Stage 4), and `writeSeriesHistory` (`market/fxHistory.ts`) upserts **every OK series of every run, lite intraday runs included, under the server-local date of its `asOf`** ("the last value seen on each Melbourne date"). Exchange-dated closes (London FX dates, New York futures dates) written into the same `(series_id, date)` keys would be overwritten by the next refresh and would change the Other Assets spot charts that read it (`cashflow/context.ts`). **Stage 10 therefore stores closes in new tables (§3) and leaves `market_quote_history` exactly as it is.**
- **`parseYahooCloses`** (`providers/yahoo.ts`) dates each bar in `meta.exchangeTimezoneName` (else `gmtoffset`, else the symbol suffix), one close per date, oldest first; it **keeps weekend bars and today's live bar** (the probe saw a Saturday `AUDUSD=X` bar carrying the live quote), so the closes job filters (§5.2). `createYahooFxClosesClient` is bound to `<CCY>AUD=X` URLs; Stage 10 adds a sibling client for any symbol and leaves the Stage 4 FX client untouched.
- **The engine already has everything ALL needs.** `computeInvestments` returns a `HoldingResult` for **every** instrument of a kind (held, watching, exited) with `realisedCents` (Σ disposals, all time, FIFO, sell brokerage deducted, buy brokerage pro rata in the cost) and `unrealisedCents` (Σ remaining lots `(P − price) × remaining − fee × remaining ÷ units`; 0 when no lot remains and a price exists; null when unpriced); `lots` holds a `LotResult` for every buy lot (fully sold ones with `remainingUnits '0'`), `price` = AUD per unit **without** the fee, `feeCents` = the whole buy fee; `disposals` carry `sellDate` and `gainCents`. `summary.realisedCents` sums every instrument of the kind. Bullion rows (`OtherAssetResult`) carry `gainCents` (value − cost, both rounded), `realisedCents` (Σ non-null sale results) and `sales[]` with `saleDate` and `realisedCents`; the bought units are `units − legacySoldUnits`. **`mobile/bullion.ts` `bullionInputs` drops rows with no remaining units**, so ALL needs a sibling that keeps them (§6.3).
- **`addMonthsIso`** (`@joinr/schema` `dates.ts`) is EDATE: it clamps the day (`2031-03-31` − 1 month → `2031-02-28`). The engine may not call `Intl` or read the process zone (ESLint and `purity.test.ts`), so the period rules work on **dates**; every instant (a crypto midnight, a Yahoo bar's local date) is turned into a date on the server.
- **`routes/mobile.ts`**: a keyed GET needs its URL in `KEYED_URLS` (today `{'/api/mobile/today', '/api/mobile/device'}`), a `declare(['GET','HEAD'], …)` for the root deny-by-default guard, and the route; the catch-all answers 405 for every other method. The store whitelist `/api/mobile/*` already covers any one-segment path, so **no store compose change**.
- **Android:** `ErrorMapping.map` turns a 404 into `ServerTooOld` **only for paths ending `/today`, `/device` and `/pair`** (both the JSON and the HTML branch), and any `apiVersion > 1` into `AppTooOld`; `ApiJson` has `ignoreUnknownKeys = true` and `explicitNulls = false`. So `/today` must stay byte-compatible and **`apiVersion` stays 1** (APK 1.0.2 keeps working against 1.3.0), and the new path needs its own 404 rule. `Services`/`Graph` (`App.kt`) is the process-wide singleton; `versionCode = 3`, `versionName = "1.0.2"`. The widgets and the worker read only `MobileTodayResponse` through `Repository.refresh()` and the shared `model/TodayModel.kt` functions (`toneOf`, `dayTone`, `statusWord`, `spokenHolding`, `widgetAgeLine`, `biggestMoves`, `bestAndWorst`, `sortHoldings` + `SortOrder`).
- **Tests that pin the end of a list:** `mobile-rules.test.ts` asserts `JOB_NAMES.at(-1) === 'intraday'` (appending `closes` breaks it: server-market updates it) and `API_ERROR_CODES.slice(-9)` equals the Stage 9 codes (**Stage 10 adds no error code**, so it stays green). `job_runs.job` is plain text: no migration for a job name. `tools/deploy/smoke.mjs` `EXPECTED_MIGRATIONS = 7` (used three times) → 8.
- **The shared seed** (`testing/seed.ts`) trades from 2024–2025 and has a **fully sold `ASX:OLD`** (bought 2024-03-01, sold 2025-02-03): fake mode and e2e get a "Sold holdings" row for free; its reset must clear `series_closes` (no foreign key; `instrument_closes` and `instrument_splits` go with the instruments' cascade).
- **The probes (generic symbols; probe report):** Yahoo `range=max` silently downgrades to monthly or quarterly bars even with `interval=1d`; `period1=<unix>&period2=<unix>&interval=1d` returns the full daily history in one call (11 544 bars, 1.3 MB, no paging); bars are stamped at the session start **in the exchange zone** (ASX 10:00 Sydney = 23:00Z the day before in AEDT); `close` is **split-adjusted retroactively and not dividend-adjusted** (`adjclose` is both); `events=split` returns `{date, numerator, denominator, splitRatio}`; nulls occur (an ASX gap day, FX on 25 Dec, 1 Jan and Easter, US holidays in futures and a Morningstar fund). CoinGecko's keyless `market_chart`: 2–90 days → hourly points on the hour, more → daily points at 00:00 UTC; `days=365` reaches back to 00:00Z of today − 364; anything older answers **HTTP 401 with `error_code` 10012**; a burst got 429 with `Retry-After: 60`; calls 15 s apart all succeeded; one call took **17 s** (the server's default timeout is 10 s). No 429 from Yahoo in 50 calls 1.5 s apart.

Details (the owner's coverage, earliest dates and call budget, the live specifics) are in `docs/private/stage-10-private.md`.

---

## 1. Overview & flow

### 1.1 What Stage 10 delivers
1. **Daily closes on the server** (§3, §5): three new cache tables (`instrument_closes`, `instrument_splits`, `series_closes`; migration **0007**) and a once-a-day **`closes` job** that backfills and tops up the daily closes of every held listed instrument and fund (Yahoo), every held coin (CoinGecko, AUD), the FX series of held foreign listings, `AUDUSD` and the gold or silver futures, the **derived AUD bullion spot** per Melbourne date, and the Yahoo split events. Kill switch `CLOSES_REFRESH`.
2. **The period rules** (§2, FROZEN): one pure engine module, `periodChange.ts`, for **1W · 2W · 1M · 3M · 6M · 12M · ALL** (D158): units held at the start count from the start close, units bought within the period from their purchase price, units sold within it count nothing (D160); ALL = unrealised + realised as the web computes them, sold instruments included, % of the cost of every unit ever bought (D161), with a "Sold holdings" figure (D162); a holding with no start close shows "—" for the units it held at the start, which are left out of a total marked partial, while its units bought within the period still count from their purchase price (D165); totals that are exact sums; period lines from daily closes whose last point is the total (D164), except ALL's line, which draws today's holdings only and ends at their unrealised gain (D167).
3. **The phone API** (§4, §6): **`GET /api/mobile/periods`**, all seven periods in one keyed, read-only answer. **`/api/mobile/today` is unchanged** (1D is the Stage 9 figure, D158), and so is everything the widgets read.
4. **The Android app 1.1.0** (§9): a scrollable chip row **1D · 1W · 2W · 1M · 3M · 6M · 12M · ALL** under the header (D163: held while the process lives, 1D on a cold start); period figures in the header, cards, LIST, MOVERS and the holding detail; the period line with a dashed zero line, card sparklines against the dashed start close; the "Sold holdings" row under ALL; the partial note; per-period loading, caching and offline states. **Widgets and the worker are not touched** (D156).
5. **Deploy** (§7): **release 1.3.0** through the Stage 7 path (migration 0007, so the update takes the verified pre-update backup), smoke probes for the new path and the job, the RUNBOOK, the store's release notes. No store compose change. No web change (§8).

### 1.2 Workspace changes
```
packages/schema/   src/mobile.ts (period and closes constants), enums.ts (JOB_NAMES + 'closes'; PERIOD_STATUSES; CLOSE_SOURCES),
                   src/dto/mobile.ts (+ the periods DTOs; the Stage 9 DTOs untouched), db/tables/instruments.ts (+ instrumentCloses,
                   instrumentSplits, seriesCloses), db/index.ts, rows.ts (row schemas for the parity test), index.ts,
                   testing/{seed.ts (reset clears series_closes), dump.ts (caches never dumped)},
                   fixtures/{mobile.ts (+ mobilePeriods, ANDROID_FIXTURE_FILES += 4), index.ts, coverage.ts}; tests
packages/engine/   + src/periodChange.ts (periodStartDate, computePeriods), index.ts exports, tests (P1–P19, P21–P23, A1–A11, fixtures; P20 is a server test)
                   (dayChange.ts is NOT changed)
apps/server/       + migrations/0007_stage10_closes.sql (+ meta journal/snapshot)
                   + db/queries/closes.ts (readers, FROZEN)
                   market/: + closes/{targets.ts,history.ts,coins.ts,derive.ts,run.ts,schedule.ts,index.ts},
                   providers/{yahoo.ts (history URL, split parser, history client), coingecko.ts (history call), fake.ts (fake
                   histories), types.ts}, service.ts (create the closes job; a source change clears the instrument's closes);
                   config.ts (CLOSES_REFRESH)
                   mobile/: + periods.ts (the builder), + inputs.ts (the shared engine-input loader), bullion.ts (+ periodBullionInputs);
                   routes/mobile.ts (+ GET /mobile/periods); test/** (new + touched); test/helpers.ts (closesRefresh: false)
apps/android/      model/PeriodModel.kt (new), net/{ApiClient,ApiError,Dto}.kt, store/{Repository,Stores}.kt (PeriodsCache),
                   ui/{AppUi,MainViewModel}.kt, App.kt (the selected period in Graph), ui/today/{TodayScreen,TodayTables,
                   PeriodChips (new)}.kt, ui/detail/DetailScreen.kt, app/build.gradle.kts (4 / 1.1.0), tests;
                   widget/** and work/** UNCHANGED
tools/deploy/      smoke.mjs (migrations 8, the daily-history egress, the periods probe, the corpus, the closes job) + tests;
                   test/store.test.mjs (the 1.3.0 notes)
root               package.json (version 1.3.0), playwright.config.ts (CLOSES_REFRESH=false)
docs/              deploy/RUNBOOK.md, README.md, docs/ARCHITECTURE.md
../tenon-umbrel-store/ (LOCAL CLONE, UNCOMMITTED) tenon-joinr-finance/umbrel-app.yml (releaseNotes; `version:` by umbrel:release)
```

### 1.3 Dependencies
None. No npm, lockfile or Gradle dependency changes (the Stage 9 pins cover everything; `decimal.js` is already in the engine). No download is needed.

### 1.4 Scripts
No new script. Scoped commands: `pnpm vitest run --project engine test/periodChange`; `--project schema`; `--project server test/market test/mobile test/migrations.test.ts test/golden`; `--project deploy`; `pnpm android:{test,lint,debug,release,fixtures}`. The Stage 7 tooling note stands: `node node_modules/vitest/vitest.mjs run …` skips pnpm 11's dependency check.

---

## 2. The period rules (FROZEN; `packages/engine/src/periodChange.ts`)

### 2.1 Terms
- **Periods.** `MOBILE_PERIODS = 1D 1W 2W 1M 3M 6M 12M ALL` (D158). **1D is the Stage 9 day figure, served by `/api/mobile/today` and computed by `computeDayChange`, unchanged** (stage-9.md §2). This module computes the other seven, `SERVER_PERIODS = 1W 2W 1M 3M 6M 12M ALL`.
- **localDate** — the server's date (Melbourne), exactly as `/today` uses it.
- **Start date S** (1W–12M; a calendar date in the server's zone): `periodStartDate(localDate, period)` = 1W: `localDate − 7 days`; 2W: `− 14 days`; 1M, 3M, 6M, 12M: `addMonthsIso(localDate, −1 / −3 / −6 / −12)` (EDATE: the day is clamped to the month's length). ALL has no start (null).
- **The start close.** A period measures from **the close of S**: for each holding, **the last stored close dated on or before S** in that holding's own date system (below), **at most `PERIOD_START_MAX_GAP_DAYS` (10) calendar days before S**. On a weekend or a public holiday that is the previous trading day's close; for a fund with a missing NAV the last NAV before it. Its date is `b` (`startCloseDate`).
- **Date systems (what "the close of date D" is):**
  - **Yahoo listings and funds:** the regular session's last price of the trading day dated D **in the exchange's zone** (Yahoo's daily bar; a fund's NAV dated D). Only weekday bars dated before today in that zone are ever stored (§5.2).
  - **Crypto (D142):** the coin's AUD price at **00:00 Melbourne on D + 1** (the end of the Melbourne day D) — the same instant Stage 9 uses as the next day's base, so a crypto 1W measures from the end of the day seven days ago exactly as 1D measures from the end of yesterday. Taken from CoinGecko points: the last point at or before that instant and not more than 36 hours before it (§5.3).
  - **Bullion (D153):** the AUD spot (futures USD/oz ÷ `AUDUSD`) at **00:00 Melbourne on D + 1**, like crypto. From 1.3.0 on, the job keeps the exact value from the Stage 9 midnight base (`series_day_quotes`, source `midnight`); for earlier dates (the backfill) it is **derived** from the futures' New York daily close and `AUDUSD`'s London daily close of the same date (≈ 07:00–09:00 Melbourne on D + 1; an accepted approximation, §15 item 9).
  - **FX:** `AUDUSD` and `FX_<CCY>AUD` closes are London-dated Yahoo daily closes.
- **B (the start close in AUD):** `closeNative(b) × audPerUnit(b′)` where `audPerUnit` is the instrument's AUD-per-native-unit series (§2.8: 1 for AUD; USD = 1 ÷ `AUDUSD`; GBp/GBX = `FX_GBPAUD` ÷ 100; others `FX_<CCY>AUD`) at its last close on or before `b`, itself at most 10 days before `b`. So **B includes the currency at the start** and P (today's AUD price) includes today's, so a foreign holding's figure includes the currency move (D143). Crypto and bullion closes are AUD (factor 1).
- **P** — the holding's AUD price now, **exactly the engine's** (`HoldingResult.price`: a hand price wins, else the last good fetched price) — the same P as `/today` and the web. **Bullion:** P is the metal's spot per ounce exactly as Stage 9 takes it (the spot, else the first priced row's `unitPriceAud ÷ ozPerUnit`); units are ounces; `valueCents` is Σ the rows' engine `valueCents`. **A stale or hand price still gives a period figure** (the period then runs to that price; the card keeps the price's status word, §9.4) **as long as the price is not older than the period's start** (rule 3 of §2.2); a holding with no price has none (§15 item 4).
- **The price's date `p`** (`priceDate`; 1W–12M only): the date of P's as-of in the holding's own date system, computed by the server (a fetched Yahoo price: its as-of in the exchange zone; a coin, the bullion spot and a hand price: the server's zone; a hand price uses its `manualPriceAsOf`). `null` (no as-of known) → the check of §2.2 rule 3 is skipped.
- **Held holding** — as `/today` (stage-9.md §2.1): an instrument of the four kinds with `openUnits > 0`, or one bullion holding per metal with at least one held bullion row. The periods answer lists **the same holdings with the same keys** as `/today` for the same data.
- **Lot classes for 1W–12M** (each remaining FIFO lot of a held holding, against S; `tradeDate` is a plain date):
  - `tradeDate ≤ S` → **start lot** (held at the start), measured from B;
  - `S < tradeDate ≤ localDate` → **within lot** (bought in the period), measured from its **purchase price `LotResult.price`, without the buy fee** (as Stage 9's lots bought in the session; §15 item 3);
  - `tradeDate > localDate` (a future-dated entry) → **later**: adds 0 and is outside the base (as stage-9.md M15/M23).
  - `startUnits`, `newUnits`, `laterUnits` = Σ remaining units of each class. FIFO means the remaining lots are the newest ones, so "units held now that were held at S" is exactly the start lots; **units sold within the period are gone** and count nothing, whatever lot they came from (D160).
  - **Bullion rows as lots** (stage-9.md §2.1): each held row is one lot of `remainingUnits × ozPerUnit` ounces at `unitCostAud ÷ ozPerUnit` per ounce, dated `purchaseDate`. **A row without a purchase date is a start lot in every period** (held since before any start). **A within row whose cost or purchase FX is unknown is counted as a start lot** (in `startUnits`, measured from B, as Stage 9 treats it "as old"), so a metal with such a row and no B is `no_start` by rule 4 of §2.2 rather than undefined.
- **Split** — a Yahoo split event (`instrument_splits`) of the holding's instrument. Yahoo's closes are split-adjusted and the app has no split model, so a figure that compares a price from before a split with one after it would be wrong by the ratio (§14). Only such a comparison is refused (§2.2 rule 2): units bought after the split are measured from their own purchase price and never read a pre-split close.

### 2.2 1W–12M, per holding (`status`, in this order)
1. P null, or `valueCents` null → **`unpriced`**: no figure.
2. **`split`** ("—"; the app says SPLIT; no figure at all) when a split is dated in `(b, localDate]` and `startUnits > 0` (`b` = the start close's date, or S when no start close is found), **or** a split is dated in `(tradeDate, localDate]` of some within lot. A holding whose every remaining unit was bought on or after the last split date is computed normally (P21).
3. **Price older than the start:** `p` (§2.1) is not null and is earlier than `b` (when `startUnits > 0` and a start close is found), else earlier than S → **`no_start`** with **no figure at all** (`cents` null, within lots included: P predates every within lot), counted in `missing` (P22).
4. `startUnits > 0` and B unknown (no close on or before S within 10 days; a non-AUD instrument without an FX close on or before `b` within 10 days; or B ≤ 0) → **`no_start`** (D165): the units held at the start have no figure ("—") and are left out of the total; **the units bought within the period still count from their purchase price** (D165): `cents = centsOf(Σ within lots remaining × (P − lot price))` (null when the holding has no within lot), `newCostCents = centsOf(Σ within lots remaining × lot price)`, `ratio = cents ÷ newCostCents` (null when ≤ 0); `startClose`, `startCloseDate`, `changePerUnit`, `priceRatio` null. The holding counts in `missing` (so the total is partial) whether or not it has within lots (P10).
5. Otherwise **`ok`**:
   - `period = startUnits × (P − B) + Σ within lots remaining × (P − lot price)`; **`cents = centsOf(period)`** (one rounding per holding, half away from zero, never −0).
   - `laterCents = centsOf(laterUnits × P)`; **`ratio = cents ÷ (valueCents − cents − laterCents)`** (the change over the value at the start, with within lots at cost; null when that base ≤ 0).
   - `newCostCents = centsOf(Σ within lots remaining × lot price)` (null when there is no within lot).
   - When `startUnits > 0`: `startClose = B`, `startCloseDate = b`, `changePerUnit = P − B`, `priceRatio = (P − B) ÷ B`; otherwise those are null (a holding bought entirely within the period needs no start close and is `ok` even with no stored closes at all).
- A holding with no stored closes (a hand-priced fund, an instrument whose provider is `none`) is therefore `no_start` when it was held at S (its in-period buys still counted) and `ok` (from its purchase price) when it was bought within the period.

### 2.3 ALL, per holding (D161, D162)
- **Instruments:** `cents = unrealisedCents + realisedCents` of the engine's `HoldingResult` (the very figures the web's holdings pages show: FIFO, brokerage in the cost base, sell brokerage deducted; **dividends never**). `unrealisedCents` null on a held holding → **`unpriced`** ("—", left out). `costEverCents = centsOf(Σ over every lot of the instrument, held and sold, units × price + Σ feeCents ÷ 100)` (one rounding per holding). `ratio = cents ÷ costEverCents` (null when ≤ 0).
- **Bullion (per metal):** `cents = Σ held rows' gainCents + Σ all of that metal's rows' realisedCents` (the Other Assets page's own cells: value − cost, and each sale's proceeds − cost). Any **held** row with a price but `gainCents` null (unknown cost or purchase FX) → **`no_cost`** ("—", left out). `costEverCents = Σ rows centsOf(boughtUnits × unitCostAud)` over the rows with a known cost (`boughtUnits = units − legacySoldUnits`: the workbook's legacy sold units have no proceeds and no realised figure, so their cost stays out too).
- **The "Sold holdings" figure** (key `SOLD_HOLDINGS_KEY = 'sold'`): every instrument of the four kinds that is **not held** (`openUnits = 0`: `exited` or `watching`) and has at least one lot, plus every metal with bullion rows but **no held row**: `cents = Σ their realisedCents`, `costEverCents = Σ their costEverCents`, `ratio = cents ÷ costEverCents`, `soldCount` = how many instruments and metals. Shown only when `soldCount > 0`. A partly sold, still held instrument keeps its realised gain on its own card (D162).
- ALL ignores splits (the engine's figures are the web's) and has no start; `startUnits`, `newUnits` are '0' and the 1W–12M fields null. `unrealisedCents`, `realisedCents` and `costEverCents` are given on each ALL figure.

### 2.4 Totals (every period)
- **1W–12M:** `cents = Σ cents` of `ok` holdings **+ Σ the non-null `cents` of `no_start` holdings (their bought-within part, §2.2 rule 4)** (null when no figure has cents); `baseCents = Σ (valueCents − cents − laterCents)` of `ok` holdings + Σ `newCostCents` of those `no_start` holdings; `ratio = cents ÷ baseCents` (null when `baseCents ≤ 0`).
- **ALL:** `cents = Σ cents` of `ok` holdings **+ the Sold holdings cents**; `baseCents = Σ costEverCents` of the same; `ratio = cents ÷ baseCents`; `unrealisedCents = Σ` the `ok` holdings' unrealised parts (**the ALL line's last point**, §2.6); `realisedCents = Σ` their realised parts + the Sold holdings cents (so `unrealised + realised = cents`; `realisedCents` is how far the ALL figure sits from the line's end).
- `up`, `down`, `flat`: `ok` holdings by the sign of `cents` (the Sold row never counts); `missing`: held holdings that are not `ok`; `holdings`: all held; **`partial = missing > 0`** (D165's note).
- **Every figure adds up to the total**: the total is never rounded separately. Ratios are `ratioString` (12 significant digits, half up, normalised; `packages/engine/src/num.ts`).

### 2.5 The period line (1W–12M; D164)
- **Drawn holdings:** `ok` holdings with at least one stored close dated in `[b, localDate)` (for a holding without start units: dated on or after its first within lot). **Flat holdings:** `ok` holdings with none: they contribute **their own `cents` at every point** (as Stage 9's daily-priced fund contributes its day figure throughout). **A `no_start` holding with non-null `cents`** (its bought-within part) is in the line exactly as a holding without start units (`startUnits` taken as 0): drawn when it has a close dated on or after its first within lot, else flat. Other holdings that are not `ok` are not in the line (they are not in the total).
- **Grid (dates):** `S`, then every date `d` with `S < d < localDate` on which **any** drawn holding has a stored close, then `localDate`.
- **Value at a grid date `d < localDate`**, per drawn holding, `C(d) = closeNative(last ≤ d) × audPerUnit(last ≤ that close's date)`: `centsOf(startUnits × (C(d) − B) + Σ within lots with a close dated ≥ their tradeDate and ≤ d: remaining × (C(d) − lot price))` (a within lot adds 0 until a close dated on or after its trade date exists; at `d = S` every drawn holding adds exactly 0). The point is the sum over drawn holdings plus every flat holding's `cents`.
- **At `localDate`** every holding contributes its own `cents`, so **the last point is exactly `totals.cents`** by construction.
- `null` when no holding is drawn. `downsample(points, LINE_MAX_POINTS)` (120; first and last kept; the Stage 9 rule copied, `dayChange.ts` is not imported for it).
- **Per holding (cards and detail):** for each drawn holding, `line.base` = B when `startUnits > 0`, else the units-weighted average purchase price of its within lots (`priceString`); `line.points` = `[d, C(d)]` for each of its close dates in `[b, localDate)` (from its first within lot's date when it has no start units), then `[localDate, P]`; downsampled to `PERIOD_HOLDING_POINTS` (40). Flat and non-`ok` holdings: `line` null.

### 2.6 The ALL line (D161, D164, D167)
**Today's holdings only, with no step on sale dates (D167).** The line is the **unrealised gain of the lots held now**, over time; realised gains (a held holding's own disposals, its bullion sales and the Sold holdings) are never in it. **Its last point is exactly `totals.unrealisedCents`** (Σ the `ok` holdings' unrealised parts, §2.4), **not** the ALL figure: the ALL figure (`totals.cents`) sits above or below it by `totals.realisedCents`. How the app shows that difference is in §9.4.
- **Drawn holdings:** `ok` holdings whose stored closes reach back to their earliest remaining lot (the first stored close is dated at most 10 days after that lot's trade date) and whose instrument has **no split dated after that lot's trade date** (the §2.2 rule 2 window); for bullion, every held row has a purchase date and a known cost. **Flat:** every other `ok` holding (no closes, a hand price, closes too short, a coin held longer than CoinGecko's 365-day reach before 1.3.0): **its unrealised part** (`unrealisedCents`; bullion: Σ held rows' `gainCents`) at every point. Holdings that are not `ok` and the Sold holdings are not in the line.
- **Value at a date `d < localDate`**, per drawn instrument: `centsOf(Σ remaining lots with tradeDate ≤ d: (a close dated ≥ tradeDate and ≤ d exists ? remaining × (C(d) − price) : 0) − fee × remaining ÷ units)` — the unrealised gain of today's lots as at d (brokerage in, as the web). Per drawn metal: `centsOf(Σ held rows with purchaseDate ≤ d: rowOz × (spot(d) − cost per oz))`. No disposal or sale term: units sold before today are not today's holdings. The point is the sum over drawn holdings plus every flat holding's unrealised part.
- **Grid:** from `F` = the earliest of the drawn holdings' earliest remaining-lot dates (a disposal or sale never sets `F` or adds a grid date); then every date in `(F, localDate)` on which a drawn holding has a close; then `localDate`, where every `ok` holding contributes its own unrealised part, so **the last point is exactly `totals.unrealisedCents`** by construction.
- `null` when no holding is drawn (so `null` in `noHistory` and `soldOnly`, §3.6). Downsampled to `LINE_MAX_POINTS`. Per drawn holding, `line.base` = the engine's `averagePrice` (fees excluded; bullion: the rows' average cost per ounce) and `line.points` its `C(d)` from its earliest remaining lot, then `[localDate, P]`, downsampled to 40.

### 2.7 Worked examples (the engine tests reproduce each; AUD unless stated; `localDate` Thursday 12/09/2030 unless stated)
**Calendar (C):**
| # | localDate | 1W | 2W | 1M | 3M | 6M | 12M |
|---|---|---|---|---|---|---|---|
| C1 | Thu 2030-09-12 | 2030-09-05 | 2030-08-29 | 2030-08-12 | 2030-06-12 | 2030-03-12 | 2029-09-12 |
| C2 | Mon 2031-03-31 | 2031-03-24 | 2031-03-17 | **2031-02-28** | 2030-12-31 | **2030-09-30** | 2030-03-31 |
| C3 | Sun 2032-02-29 | 2032-02-22 | 2032-02-15 | 2032-01-29 | 2031-11-29 | 2031-08-29 | **2031-02-28** |

C4 (weekend start): localDate Sat 2030-09-14, 1W S = Sat 2030-09-07: an ASX holding's start close is **Fri 2030-09-06**'s; a coin's is the price at 00:00 Sun 08/09 Melbourne; C5 (gap): the last ASX close is 11 days before S → `no_start`.

**1W–12M (P):**
| # | Case | Inputs | Result |
|---|---|---|---|
| P1 | Held throughout | `ASX:ABC` 100 units bought 2030-01-10 at 40.00 (fee 10.00); 1W; close 2030-09-05 = 50.00; P 50.50 | `ok`; cents **5000**; value 505000; ratio 0.01; startClose 50.00 (2030-09-05); changePerUnit 0.5; priceRatio 0.01 |
| P2 | Bought within | P1 + 20 bought 2030-09-09 at 49.00 (fee 9.50, not used) | 100 × 0.50 + 20 × 1.50 → **8000**; value 606000; base 598000; ratio 0.0133779264214; startUnits 100, newUnits 20 |
| P3 | Sold within (D160) | lots 60 @ 40.00 (2030-02-01) and 40 @ 45.00 (2030-03-01); sold 40 on 2030-09-10 at 52.00 (FIFO from the first lot); close(S) 50.00; P 50.50 | 60 remaining start units × 0.50 → **3000**; ratio 0.01; the sale's gain is not counted |
| P4 | Weekend start | localDate Sat 2030-09-14; ABC 100 units; closes Thu 09-05 49.00, Fri 09-06 49.50; P 50.00 | B 49.50 (2030-09-06); **5000** |
| P5 | Foreign listing (D143) | `NYSE:EXUS` 20 units bought 2030-05-01; 1M (S 2030-08-12); EXUS NY close 2030-08-12 = 100.00 USD; `AUDUSD` London close 2030-08-12 = 0.6400 (audPerUnit 1.5625); P = 155.384615384615 | B **156.25**; cents **−1731**; value 310769; base 312500; ratio −0.0055392; changePerUnit −0.865384615385; priceRatio −0.00553846153846 |
| P6 | Crypto (D142) | `BTC` 0.5 bought 2030-02-01; 2W (S 2030-08-29); the price at 00:00 Melbourne 30/08 (= 2030-08-29T14:00Z) 150000.00 is the close of 2030-08-29; P 164000.00 | **700000**; ratio 0.0933333333333 |
| P7 | Bullion (D153) | silver: 10 oz bought 2030-01-20 at 40.00/oz, 5 oz bought 2030-09-02 at 52.00/oz; 1M; `XAG_AUD_OZ` close 2030-08-12 = 50.00; P 55.00 | 10 × 5 + 5 × 3 → **6500**; value 82500; base 76000; ratio 0.0855263157895 |
| P8 | Bullion row without a date | P7 + 2 oz with no purchase date at 30.00/oz | the 2 oz are start units: + 2 × 5 → **7500** |
| P9 | Fund NAV gap | `0PEXAMPLE1` 1000 units bought 2030-01-15; 1W; NAVs Wed 09-04 1.4900, Thu 09-05 none, Fri 09-06 1.5000; P 1.5150 | B 1.4900 (2030-09-04); **2500** |
| P10 | No start close (D165) | `EXAMPLEFUND2` (hand price 2.10 dated 2030-09-11, no closes) 500 units since 2030-01-01 + 100 bought Mon 2030-09-09 at 2.00; 1W | `no_start`; the 500 start units "—"; **the 100 new units count**: 100 × (2.10 − 2.00) → cents **1000**; newCostCents 20000; ratio 0.05; startUnits 500, newUnits 100; missing 1; partial |
| P11 | Bought within, no closes | `ASX:MNO` 50 bought 2030-09-09 at 10.00, no stored close; P 10.40; 1W | `ok`, **2000**, startClose null, line null (flat) |
| P12 | Split (§14) | `ASX:XYZ` held since 2030-01-02 with a 2:1 split dated 2030-09-10 | 1W, 2W, …, 12M: `split`, no figure; ALL: the engine's figure |
| P13 | Totals | 1W over P1 (5000, base 500000), P11 (2000, base 50000) and P10 (1000, base = its newCostCents 20000) | cents **8000**; base **570000**; ratio **0.0140350877193**; up 2 (P10 is not `ok`: never in up/down/flat); missing 1; holdings 3; partial |
| P14 | Line | P13; ABC closes 09-05 50.00, 09-06 50.20, 09-09 49.80, 09-10 50.10, 09-11 50.30; MNO closes 09-09 10.10, 09-10 10.20, 09-11 10.30 (MNO now drawn, not flat); P10 has no closes (flat: its 1000 at every point) | points `[09-05, 1000]`, `[09-06, 3000]`, `[09-09, −500]`, `[09-10, 3000]`, `[09-11, 5500]`, `[09-12, 8000]`; ABC's line base 50.00, points 50.00 … 50.30, then 50.50; MNO's base 10.00 (its purchase price) |
| P15 | Future-dated lot | P1 + 10 dated 2030-09-20 | adds 0: **5000**; laterUnits 10; value 555500; base 555500 − 5000 − 50500 = 500000; ratio 0.01 |
| P16 | FX close too old | P5 with the last `AUDUSD` close 11 days before `b` | `no_start` |
| P17 | Stale price | P1 with P's status `stale` (its as-of 2030-09-10, after b) | `ok`, **5000** (the figure runs to that price; the app shows STALE) |
| P18 | Rounding | three holdings of 0.005 each | each 1 cent; total **3** |
| P19 | Within row, unknown cost | P7 + a 1 oz row bought 2030-09-03 with no cost | counted as a start lot (§2.1), measured from B: + 1 × 5 → **7000**; startUnits **11**, newUnits 5 |
| P20 | Crypto across DST | the close of Sat 2030-10-05 is the price at 14:00Z on 2030-10-05 (00:00 Sun 06/10, still AEST); the close of Sun 2030-10-06 is at 13:00Z on 2030-10-06 (AEDT) | (server-side, §5.3; engine sees dates only) |
| P21 | Bought after a split | `ASX:MNO`, 1W (S 2030-09-05); a 2:1 split dated Mon 2030-09-09; 50 units bought Tue 2030-09-10 at 10.00; P 10.40 | not `split` (no remaining unit predates the split): `ok`, **2000**; the same with a further 10 units bought Fri 2030-09-06 at 19.00 → `split` (that lot spans the split) |
| P22 | Price older than the start | P1 with a hand price 50.50 dated 2030-08-01 | 1W (b 2030-09-05): `no_start`, cents null (rule 3), missing 1; 3M (S 2030-06-12, a close of 45.00 that day): `ok`, 100 × 5.50 → **55000** |
| P23 | Within row, unknown cost, no B | P19 with no `XAG_AUD_OZ` close on or before S within 10 days | `no_start` (rule 4); the 5 oz bought within still count: 5 × 3 → cents **1500**; newCostCents 26000; missing 1 |

**ALL (A):**
| # | Case | Inputs | Result |
|---|---|---|---|
| A1 | Held, partly sold | ABC as P3: lots 60 @ 40.00 fee 10.00, 40 @ 45.00 fee 10.00; sold 40 at 52.00 fee 10.00; P 50.50 | realised 2070 − 1606.666… = 463.333… → **46333**; unrealised 210 − 3.333… + 220 − 10 = 416.666… → **41667**; cents **88000**; costEver 4220.00 → 422000; ratio 0.208530805687 |
| A2 | Fully sold | `ASX:OLD` 100 @ 20.00 fee 10.00 (Mon 2030-01-07), sold 100 @ 25.00 fee 10.00 (Mon 2030-06-03) | not held → Sold holdings: **48000**, costEver 201000 |
| A3 | Bullion, a sale | silver rows: 10 oz @ 40.00 (400.00), 5 oz @ 52.00 (260.00) held; 4 oz @ 45.00 (180.00) sold for 220.00; spot 55.00 | gains 15000 + 1500, realised 4000 → **20500**; costEver 84000; ratio 0.244047619048 |
| A4 | A metal no longer held | gold: one 1 oz row at 3000.00, sold for 3100.00 | Sold holdings + **10000** (costEver 300000) |
| A5 | Totals | A1 + A3 + Sold (A2 + A4) | cents 88000 + 20500 + 58000 = **166500**; base 1007000; ratio 0.165342601787; unrealised 41667 + 16500 = 58167; realised 46333 + 4000 + 58000 = 108333; the Sold figure ratio 0.115768463074; soldCount 2 |
| A6 | Hand-priced fund | `EXAMPLEFUND2`: no closes, hand price | `ok` (as the web: unrealised from the hand price + realised); flat in the line |
| A7 | Unpriced | a held stock with no price | `unpriced`; its realised is left out with it; partial |
| A8 | Bullion without a cost | a held silver row with no unit cost | `no_cost` for the metal; partial |
| A9 | Line | ABC: one lot 60 @ 40.00 fee 10.00 bought Mon 2030-02-04; closes 02-04 41.00, 02-05 42.00; localDate Wed 2030-02-06, P 43.00 | `[02-04, 5000]`, `[02-05, 11000]`, `[02-06, 17000]` (= unrealised; no sale, so also the ALL total) |
| A10 | Line with sales (D167) | A9's ABC (no closes after 02-05) + OLD (A2: sold Mon 2030-06-03, realised 48000); localDate Thu 2030-09-12, P 43.00 | F = **2030-02-04** (ABC's lot; a sale never sets F); points `[02-04, 5000]`, `[02-05, 11000]`, `[09-12, 17000]`: **no step and no point at 2030-06-03** (OLD is not in the line); last point **17000** = `totals.unrealisedCents`; the ALL total **65000** = 17000 + `totals.realisedCents` 48000 |
| A11 | Realised of a held holding (D167) | A5's data, with ABC (A1) drawn | the ALL line ends at **58167** (`totals.unrealisedCents`: A1's 41667 + A3's held gains 16500), **108333** (`totals.realisedCents`: A1's 46333, A3's 4000 and the Sold 58000) below the ALL total 166500 |

The engine tests also run the 1W–12M examples with `localDate` on both DST change days of 2030–2031 (`process.env.TZ = 'UTC'` in that file: the engine never reads a zone), C1–C5 through `periodStartDate`, and the fixture-consistency test (§3.6).

### 2.8 The functions (FROZEN signatures; pure, decimal.js)
```ts
export type ServerPeriod = (typeof SERVER_PERIODS)[number];
/** S for 1W–12M (§2.1); null for ALL. */
export function periodStartDate(localDate: IsoDate, period: ServerPeriod): IsoDate | null;

export type DatedValues = ReadonlyArray<readonly [IsoDate, DecimalString]>;   // ascending, unique dates
export interface PeriodCloseSeries {
  currency: string;                     // the closes' native currency (instrument_closes.currency)
  closes: DatedValues;                  // native closes in the instrument's date system (§2.1)
  /** AUD per native unit by date (§2.1); null for AUD (factor 1). Built by the server from series_closes. */
  audPerUnit: DatedValues | null;
  splits: readonly IsoDate[];
}
export interface PeriodBullionRowInput {
  asset: OtherAssetResult;              // held AND sold rows
  ozPerUnit: DecimalString;
  purchaseDate: IsoDate | null;
  unitCostAud: DecimalString | null;    // per unit of the row (unitCost × purchase FX); null → unknown
  boughtUnits: DecimalString;           // units − legacySoldUnits
}
export interface PeriodBullionInput {
  metal: Metal;
  rows: readonly PeriodBullionRowInput[];   // every bullion row priced with this metal
  price: DecimalString | null;          // P per ounce, exactly as /today's bullion holding (§2.1)
  priceDate: IsoDate | null;            // p (§2.1): the spot's as-of date in the server's zone
  closes: DatedValues;                  // XAG_AUD_OZ / XAU_AUD_OZ by Melbourne date
}
export interface PeriodChangeInput {
  localDate: IsoDate;
  holdings: readonly HoldingResult[];   // EVERY instrument of the four kinds (held, watching, exited)
  kinds: ReadonlyMap<number, InstrumentKind>;
  lots: readonly LotResult[];           // every lot, fully sold ones included
  // no disposals: the ALL figure takes realisedCents from HoldingResult and the ALL line has no sale steps (D167)
  closes: ReadonlyMap<number, PeriodCloseSeries>;   // by instrument id; absent → no closes
  priceDates: ReadonlyMap<number, IsoDate | null>;  // p (§2.1) by instrument id; absent or null → no check
  bullion: readonly PeriodBullionInput[];           // one per metal with any bullion row (silver, then gold)
}
export const PERIOD_ENGINE_VERSION = 1;
export function computePeriods(input: PeriodChangeInput): PeriodsResult;     // SERVER_PERIODS order
// PeriodsResult = { periods: PeriodResult[] }; PeriodResult = { period, startDate, totals, line, figures }
// with figures in input order (instruments, then bullion), then the Sold figure (ALL only, when soldCount > 0);
// each figure carries exactly the §4.2 `MobilePeriodFigureDto` fields (`laterUnits` and `newCostCents` included).
// Lines are already downsampled; a line's last point is totals.cents (1W–12M) or totals.unrealisedCents (ALL, D167).
```
Inside the module, instruments and bullion run one internal shape (as `dayChange.ts` does); helpers it needs from `dayChange.ts` (`downsample`, the bullion P) are re-implemented locally or taken from `num.ts`: **`dayChange.ts` is not edited** (§12 #5).

---

## 3. Data model, migration 0007, constants — FROZEN

### 3.1 `instrument_closes` (new; `packages/schema/src/db/tables/instruments.ts`)
| Column | Type | Meaning |
|---|---|---|
| `instrument_id` | integer NOT NULL, FK `instruments.id` ON DELETE CASCADE | |
| `date` | text NOT NULL | `YYYY-MM-DD` in the instrument's date system (§2.1): the exchange's zone for Yahoo, the server's zone for crypto |
| `close` | text NOT NULL | native decimal (≤ 12 significant digits), > 0 |
| `currency` | text NOT NULL | as the provider reports it (`AUD`, `USD`, `GBp`) |
| `source` | text NOT NULL | `CLOSE_SOURCES`: `yahoo`, `coingecko` or `fake` |
| `fetched_at` | text NOT NULL | UTC ISO |
PK `(instrument_id, date)`.

### 3.2 `instrument_splits` (new)
`instrument_id` (FK cascade), `date` (the split's date in the exchange zone), `numerator` text, `denominator` text, `fetched_at`; PK `(instrument_id, date)`.

### 3.3 `series_closes` (new)
`series_id` text NOT NULL, `date` text NOT NULL, `value` text NOT NULL, `source` text NOT NULL (`yahoo`, `derived`, `midnight`, `fake`), `fetched_at`; PK `(series_id, date)`; no foreign key. Rows: `AUDUSD` (USD per AUD; London dates), `FX_<CCY>AUD` (AUD per unit; London dates), `SI_USD_OZ`, `GC_USD_OZ` (New York dates), `XAG_AUD_OZ`, `XAU_AUD_OZ` (Melbourne dates; `derived` or `midnight`). **A `midnight` row is never replaced by a `derived` one** (§5.5).

**All three are caches** exactly like `day_quotes` (stage-9.md §3.1): no provenance; never app data (`hasAppData`/`hasDomainData` unchanged); not in `DOMAIN_TABLES_DELETE_ORDER` (instruments are upserted by an import, so a re-import keeps them); never dumped (`testing/dump.ts`); the seed's reset clears `series_closes`. **Never deleted** except by the cascade or a price-source change of that instrument (§5.6). Size: about 250 rows per series per year (crypto 365), a few tens of KB per series-year. **`market_quote_history` is unchanged** (it stays the Melbourne "last value seen" history the Other Assets charts read).

### 3.4 Migration 0007
`apps/server/migrations/0007_stage10_closes.sql` (generated with `pnpm --filter @joinr/server db:generate --name stage10_closes`, journal entry 7, snapshot 0007): the three `CREATE TABLE`s only. So 1.3.0 is a migrating update: the Stage 7 start-up takes the verified **pre-update backup**, and 1.2.0 refuses a database migrated by 0007 (going back means restoring that backup).

### 3.5 Constants (`packages/schema/src/mobile.ts`), enums and codes
```ts
export const MOBILE_PERIODS = ['1D', '1W', '2W', '1M', '3M', '6M', '12M', 'ALL'] as const;
export const SERVER_PERIODS = ['1W', '2W', '1M', '3M', '6M', '12M', 'ALL'] as const;   // what /periods answers
export const PERIOD_SPANS = { '1W': { days: 7 }, '2W': { days: 14 }, '1M': { months: 1 }, '3M': { months: 3 },
                              '6M': { months: 6 }, '12M': { months: 12 } } as const;
export const PERIOD_START_MAX_GAP_DAYS = 10;      // the start close, and its FX close, at most this many days earlier
export const PERIOD_HOLDING_POINTS = 40;          // a holding's period line (cards, detail)
export const SOLD_HOLDINGS_KEY = 'sold';          // never collides with 'i<id>' or 'bullion-<metal>'
export const CLOSES_RUN_AT = { hour: 16, minute: 52 } as const;   // server-local, daily; off the 15-minute intraday grid (§5.7)
export const CLOSES_SLOT_MINUTE_OFFSET = 7;       // follow-ups snap to xx:07, xx:22, xx:37, xx:52 (minute % 15 === 7)
export const CLOSES_COIN_SLOT_GUARD_MS = 45_000;  // no CoinGecko history call this close before an intraday crypto slot fires
export const CLOSES_STARTUP_DELAY_MS = 120_000;
export const CLOSES_RUN_DEADLINE_MS = 10 * 60_000;
export const CLOSES_FOLLOW_UP_MS = 30 * 60_000;   // a run that left work (deadline, cool-down) schedules one more
export const CLOSES_FOLLOW_UPS_MAX = 6;           // per server-local day
export const CLOSES_LEAD_DAYS = 10;               // history starts this many days before the earliest trade
export const CLOSES_TOPUP_OVERLAP_DAYS = 10;      // a top-up re-reads (and rewrites) this many days
export const CLOSES_YAHOO_SPACING_MS = 1_500;
export const CLOSES_COIN_SPACING_MS = 15_000;
export const CLOSES_REQUEST_TIMEOUT_MS = 30_000;
export const COINGECKO_HISTORY_DAYS = 364;        // the keyless API's reach (probe: older → 401, error_code 10012)
export const COINGECKO_HOURLY_DAYS = 90;          // up to this, market_chart answers hourly points
export const CLOSES_COIN_POINT_MAX_AGE_MS = 36 * 60 * 60_000;   // hourly points: last point at most this old
export const CLOSES_COIN_DAILY_WINDOW_MS = 14 * 60 * 60_000;    // daily points: the nearest point within ± this (§5.3)
export const CLOSES_BULLION_UNDATED_DAYS = 380;   // history depth for a held bullion row without a purchase date
export const CLOSES_STALE_NOTE_DAYS = 6;          // the app's "Price history to dd/mm" note when closesThrough is more than this before localDate
export const PERIODS_ANSWER_BUDGET_BYTES = 350_000;   // the §6.6 size test (30 synthetic holdings)
```
- `enums.ts`: `JOB_NAMES` += **`'closes'`** (appended; `mobile-rules.test.ts` updated to `at(-1) === 'closes'` and `at(-2) === 'intraday'`); **`PERIOD_STATUSES = ['ok','no_start','split','unpriced','no_cost']`**; `CLOSE_SOURCES = ['yahoo','coingecko','derived','midnight','fake']`; types `MobilePeriod`, `ServerPeriod`, `PeriodStatus`.
- **No new error code** (`/periods` uses the Stage 9 key errors; `API_ERROR_CODES.slice(-9)` stays green).

### 3.6 Fixtures (`packages/schema/src/fixtures/mobile.ts`; `satisfies`; generic; internally consistent)
- **`mobilePeriods`** (`MOBILE_FIXTURE_NOW`, Thursday 12/09/2030 15:20 Melbourne; the **same holdings and keys as `mobileToday.open`**, so the app can show both):
  - `open`: all seven periods; ABC (held throughout, a buy within 1W: P2's shape), XYZ (`split` in 1W–12M), DEF, MNO (bought within 1W, flat), EXUS (USD, P5's shape in 1M), `0PEXAMPLE1` (NAV gap), EXAMPLEFUND2 (`no_start` in 1W–12M with a buy within 1W, so P10's shape: its bought-in part counted, the figure partial (D166); `ok` in ALL), BTC, ETH, EXA (stale price, counted), EXB (`unpriced`), SILVER (P7's shape; A3 under ALL); under ALL a **Sold holdings** figure (`ASX:OLD` and a gold metal no longer held, soldCount 2) and a held holding with a realised part (DEF, partly sold before the 12M start, so 1W–12M are untouched), so `totals.realisedCents` ≠ 0; partial totals; lines for every period, **ALL's from today's holdings only (no point on OLD's or the gold row's sale date unless a drawn holding has a close that day), ending at `totals.unrealisedCents`** (D167).
  - `noHistory` (1.3.0 just installed, no closes yet): every held-at-start holding `no_start`, bought-within ones `ok` and flat, lines null except where drawn; ALL complete (its figures need no closes); **ALL's line null** (nothing is drawn, §2.6).
  - `soldOnly` (no held holding, OLD sold): 1W–12M totals `cents` null, `holdings` 0; ALL = the Sold figure alone, `totals.unrealisedCents` 0, **its line null** (no held holding, D167).
  - `empty` (nothing ever bought): every period's totals null/0, lines null, no Sold figure.
- **Android copies:** `ANDROID_FIXTURE_FILES` += `periods-open.json`, `periods-no-history.json`, `periods-sold-only.json`, `periods-empty.json` (the Stage 9 exporter and drift test, unchanged in form; `pnpm android:fixtures`).
- **Consistency** (engine test `periodChangeFixtures.test.ts`): in every period of every fixture the totals equal the sums of the `ok` figures (plus the Sold figure under ALL), `unrealised + realised = cents` under ALL, the last line point equals `totals.cents` (1W–12M) or **`totals.unrealisedCents` (ALL, D167)**, no ALL line point is dated on a sale date unless a drawn holding has a close that day, every `ok` 1W–12M figure follows §2.2 from its own fields within a cent (`cents` = `centsOf(startUnits × (P − startClose) + newUnits × P) − newCostCents`, the first term 0 when `startUnits` is 0, `ratio` = `cents ÷ (valueCents − cents − centsOf(laterUnits × P))`, with P the holding's price), every `no_start` figure with cents has `ratio = cents ÷ newCostCents`, the holdings' keys equal `mobileToday.open`'s, and `valueCents` equals `mobileToday.open.totals.valueCents`.

---

## 4. API contract (FROZEN)

All JSON, the Stage 0 error shape, `cache-control: no-store` (the mobile hook). Decimals are strings; money is integer cents; dates `YYYY-MM-DD`.

### 4.1 Endpoint
| Method & path | Auth | 2xx | Errors |
|---|---|---|---|
| `GET /api/mobile/periods` (and `HEAD`) | device key | 200 `MobilePeriodsResponse` | 401 ×3, 429 (Stage 9 §4.2) |
| `POST/PUT/PATCH/DELETE/OPTIONS /api/mobile/periods` | — | — | 405 `MOBILE_READ_ONLY` (the existing catch-all) |

**Why one endpoint for all seven periods, one segment deep, with no query string:** the chips must switch instantly (D163's quick selector) and offline from one cached answer; the Stage 9 rule "every mobile path is one segment below `/api/mobile/`, no query string anywhere" keeps the whitelist glob's reading irrelevant; and a separate path leaves `/today` (and so APK 1.0.2 and the widgets) byte-for-byte unchanged. Expected cost: one finance context (as `/today`) plus indexed reads of the closes; the answer is **about 200–230 KB for about 25 holdings** (≈ 1.2 KB per figure with its 40-point line × 7 periods, plus seven portfolio lines of ≤ 120 points; the server does not compress). So the app fetches it only when a period other than 1D needs it (§9.3), and a server test holds the answer for the §6.4 synthetic 30-holding dataset under **`PERIODS_ANSWER_BUDGET_BYTES` = 350 000**.

### 4.2 DTOs (`packages/schema/src/dto/mobile.ts`, additive; the Stage 9 types are untouched)
```ts
export interface MobilePeriodHoldingDto {          // one per held holding, /today's order and keys
  key: string; instrumentId: number | null; kind: MobileHoldingKind;
  code: string; symbol: string; name: string | null; items: number | null;
  units: DecimalString; priceStatus: PriceStatus; price: DecimalString | null; priceAsOf: string | null;
  valueCents: Cents | null; weightRatio: DecimalString | null;
}
export interface MobilePeriodFigureDto {
  key: string;                                     // a holding's key, or SOLD_HOLDINGS_KEY (ALL only)
  status: PeriodStatus;
  cents: Cents | null; ratio: DecimalString | null;
  // 1W–12M (null under ALL)
  startClose: DecimalString | null; startCloseDate: IsoDate | null;   // B in AUD (bullion: per oz) and b
  changePerUnit: DecimalString | null; priceRatio: DecimalString | null;
  startUnits: DecimalString; newUnits: DecimalString; laterUnits: DecimalString;   // '0' when none
  newCostCents: Cents | null;                      // centsOf(Σ within lots remaining × lot price); null when no within lot
  // ALL (null for 1W–12M)
  unrealisedCents: Cents | null; realisedCents: Cents | null; costEverCents: Cents | null;   // the detail's ALL rows (§9.5)
  soldCount: number | null;                        // the Sold figure only
  line: { base: DecimalString | null; points: Array<[IsoDate, DecimalString]> } | null;   // AUD; ≤ PERIOD_HOLDING_POINTS
}
export interface MobilePeriodLineDto { from: IsoDate; to: IsoDate; points: Array<[IsoDate, Cents]> } // ≤ LINE_MAX_POINTS; last dated localDate = totals.cents (1W–12M) or totals.unrealisedCents (ALL, D167)
export interface MobilePeriodDto {
  period: ServerPeriod;
  startDate: IsoDate | null;                       // S; null for ALL
  totals: { cents: Cents | null; ratio: DecimalString | null; baseCents: Cents | null;
            up: number; down: number; flat: number; missing: number; holdings: number; partial: boolean;
            unrealisedCents: Cents | null; realisedCents: Cents | null };
            // the last two: ALL only (null for 1W–12M). unrealisedCents = the ALL line's last point (D167);
            // realisedCents = the ALL figure minus that point. Kept for the line's caption and spoken summary (§9.4),
            // no longer for a header row (D168: the row stays VAL · INVESTED · GAIN).
  line: MobilePeriodLineDto | null;
  figures: MobilePeriodFigureDto[];                // one per held holding (holdings order), then the Sold figure (ALL)
}
export interface MobilePeriodsResponse {
  apiVersion: 1;                                   // stays 1 (§9.3)
  serverVersion: string; generatedAt: string; timeZone: string; localDate: IsoDate;
  closesThrough: IsoDate | null;                   // the OLDEST of the per-series newest stored closes over the held holdings'
                                                   // close series and the FX/spot series they need (§5.1 targets only); null when none
  valueCents: Cents;                               // = /today's totals.valueCents for the same prices
  holdings: MobilePeriodHoldingDto[];
  periods: MobilePeriodDto[];                      // SERVER_PERIODS order, always seven
}
```
- Every figure exists for every held holding in every period (status says whether it has a value); the Sold figure appears only under ALL and only when `soldCount > 0`.
- The holdings' order is `/today`'s `compareHoldings` (value desc, unpriced last, then code); `weightRatio` as `/today`.

### 4.3 Messages
No new sentence on the server. The app's own sentence for a 404 on `/periods` (§9.6).

---

## 5. Server spec — the daily closes (server-market)

### 5.1 Targets (`market/closes/targets.ts`; read-only on the database; at the start of each run)
- **Instruments:** every held instrument (Σ trade units > 0, the `intradayTargets` rule) whose **effective price source** is `yahoo` (stock, ETF, managed fund: the provider symbol, e.g. `XXX.AX`, `0P…`) or `coingecko` (crypto, the resolved id). Hand-priced instruments with no provider and unresolved coins are not targets (their periods are `no_start` when held at the start). A hand price **over** a provider keeps the provider's closes (P is the hand price, §2.1).
  - `needFrom` = the instrument's **earliest trade date − `CLOSES_LEAD_DAYS`** (every remaining lot is at or after it, so every period's start close and the ALL line are covered). Crypto: `max(that, localDate − COINGECKO_HISTORY_DAYS)`.
- **Series:** `AUDUSD` when any held instrument is quoted in USD or any bullion row is held; `FX_<CCY>AUD` for each other non-AUD currency of a held instrument (from `prices.native_currency`; `GBp`/`GBX` → `GBP`); `SI_USD_OZ`/`GC_USD_OZ` for each metal with a held bullion row. `needFrom` = the earliest `needFrom` of what depends on it (a held bullion row: its purchase date − 10 days; **no purchase date: `localDate − CLOSES_BULLION_UNDATED_DAYS`**) **minus `PERIOD_START_MAX_GAP_DAYS`** (an FX or futures close may lie up to 10 days before the start close it converts, §2.1 B).
- **Backfill, top-up or skip**, per target (coverage judged against what the provider has, so a listing younger than the first trade is not re-downloaded every day):
  - `coveredFrom` = Yahoo: `max(earliest trade date, firstTradeDate)` where `firstTradeDate` is the listing date the history client returns (`meta.firstTradeDate` as an exchange-zone date; the probe found it for every class), remembered per target from the last backfill (in memory; absent → the earliest trade date); crypto: `max(earliest trade, localDate − 364)`; series: their `needFrom`.
  - **backfill** when the target has no stored close, or its earliest stored close is later than `coveredFrom` **and** it has not been tried today (the in-memory once-a-day memory, as `FxBackfillAttempts`); **a backfill that succeeded is complete** for this process even when its first bar is later than `coveredFrom` (a feed that starts after the first trade).
  - **skip** when it has **no stored close and was already tried today** (nothing to top up from; counted in `detail.skipped`); a restart may try it once more (one call).
  - otherwise **top-up**.

### 5.2 Yahoo history (`providers/yahoo.ts`; `market/closes/history.ts`)
- `yahooHistoryUrl(symbol, period1, period2)` → `…/v8/finance/chart/<sym>?period1=<unix>&period2=<unix>&interval=1d&events=split` (**never `range=max`**: it downgrades to monthly bars). Backfill: `period1` = `needFrom` at 00:00 UTC, `period2` = now. Top-up: `period1` = the last stored date − `CLOSES_TOPUP_OVERLAP_DAYS`.
- `createYahooHistoryClient` (a sibling of the Stage 4 FX-closes client, which is not changed): any symbol, spacing `CLOSES_YAHOO_SPACING_MS` from the previous start, timeout `CLOSES_REQUEST_TIMEOUT_MS`, the browser User-Agent; returns `{ closes, splits, timeZone, currency, firstTradeDate }` (`currency` = `meta.currency`, else `currencyFromSymbol` (`exchangeTime.ts`), else the target's `prices.native_currency`: it fills `instrument_closes.currency`, which §5.9 compares; `firstTradeDate` = `meta.firstTradeDate` as a date in the exchange zone, or null); errors `rate_limited` (429/403, with `Retry-After`) / `failed` / `skipped`.
- Closes from **`parseYahooCloses`** (unchanged: `close`, not `adjclose`, so dividends are not counted (D161) and an ex-dividend drop shows as a price move; nulls skipped). **Then filtered (FROZEN):** keep a close only when its date is a **weekday** and **earlier than today's date in the same zone** (`localDateResolver(meta)` applied to now). This drops the live partial bar, the weekend FX bar and today's session. A gap (an exchange holiday, a missing NAV) is left as a gap: readers take the last close on or before a date.
- `parseYahooSplits(body)` (new, pure): `events.splits` → `{ date (exchange zone), numerator, denominator }` (both finite > 0, ratio ≠ 1); a body without `events` → none.
- Series symbols: `AUDUSD=X` → `AUDUSD`; `SI=F` → `SI_USD_OZ`; `GC=F` → `GC_USD_OZ`; `fxYahooSymbol(ccy)` (`<CCY>AUD=X`) → `FX_<CCY>AUD`.

### 5.3 CoinGecko history (`providers/coingecko.ts`; `market/closes/coins.ts`)
- `fetchHistory(id, days, daily: boolean, signal)` → `GET …/coins/<id>/market_chart?vs_currency=aud&days=<n>[&interval=daily]`, timeout `CLOSES_REQUEST_TIMEOUT_MS` (a call took 17 s in the probe), the provider's headers; 429/403 → `rate_limited` (honour `Retry-After`); **a 401 → `beyond_reach` only when the requested `days` > 365, otherwise `failed`** (no body sniffing: the shared `providers/http.ts` `getJson` drains and discards every non-2xx body, and stays unchanged for every provider). The job never asks for more than `days=365` (`COINGECKO_HISTORY_DAYS + 1`), so `beyond_reach` is a guard, not a path.
- **Backfill:** `days=365&interval=daily` (points at 00:00 UTC), then `days=90` (hourly), so the last 90 days are exact and older dates approximate. **Top-up:** `days = min(90, localDate − last stored date + 3)` (hourly); a gap over 87 days → the backfill path.
- `coinClosesFrom(points, timeZone, fromDate, localDate, daily: boolean)` (pure; the zone is a parameter, dates via `@joinr/schema` `startOfDayInZone`): for each Melbourne date `D` from `fromDate` to `localDate − 1`, with `T = startOfDayInZone(D + 1)`: **hourly** points → `close(D)` = the last point with `t ≤ T` and `t > T − CLOSES_COIN_POINT_MAX_AGE_MS` (exactly the 00:00 Melbourne price: offsets are whole hours, the Stage 9 base instant); **daily** points → the point **nearest to `T` within ± `CLOSES_COIN_DAILY_WINDOW_MS`** (ties → the earlier), which is the 00:00Z point of the UTC date D + 1 (10:00–11:00 Melbourne on D + 1, ≈ 10–11 hours late; §15 item 9); none → no row. The daily rule makes the first point of a `days=365` answer (00:00Z of UTC-today − 364) the close of the date before it, so **the 12M start close of a coin held for over a year exists from the first backfill** except on a 366-day span (across a 29 February) when the run falls after 10:00–11:00 Melbourne (§14). The backfill's hourly `days=90` answer is written after the daily one and wins on the dates both cover. Tested on 2030-10-05/06 (the October change), 2031-04-05/06 (the April change, the 25-hour day) and with the process in UTC.
- Coins are fetched **sequentially, `CLOSES_COIN_SPACING_MS` apart**.

### 5.4 The fake (`providers/fake.ts`; e2e and agents)
Deterministic per symbol and date, never the network: **Yahoo-style history** for any window: weekday bars in the symbol's zone (the Stage 9 fake's zones), dated before today there; `close(d) = prev × 0.9996^n × (1 + w)` (multiplicative, so it stays > 0 over any window) where `prev` is **the fake day's `previousClose` for that symbol**, `n` = weekdays between `d` and the weekday before the fake session, `w = ((fnv1a(symbol + ':' + d) % 401) − 200) ÷ 40000`, and **the close of the weekday before the fake session equals `prev` exactly** (`w` is taken as 0 at `n = 0`) (so the fake 1D base and the period closes agree); no splits except for a symbol listed in a test. **CoinGecko-style history:** hourly or daily points by the real rules (including a **401 for `days > 365`**, daily points at 00:00 UTC), anchored so the point at 00:00 Melbourne today equals the fake day's base. **FX:** `AUDUSD` = `FAKE_AUDUSD` on every date (no move); `FX_<CCY>AUD` as the Stage 4 fake. **Futures:** as Yahoo-style, anchored to their fake previous close.

### 5.5 Derived bullion spot and the midnight capture (`market/closes/derive.ts`, pure + write)
- After the series fetches, for each metal in use and every **weekday** date `d ≥ needFrom` up to `localDate − 1`: `spot(d) = roundDerived(F(last ≤ d) ÷ X(last ≤ d))` with `F` the futures' close and `X` the `AUDUSD` close, each at most 10 days before `d` (else no row); written as `XAx_AUD_OZ` with source `derived` **unless a `midnight` row exists for `d`** (never replaced).
- **Midnight capture:** when `series_day_quotes` has the AUD spot's row for `session_date = localDate` with a `previous_close`, write `XAx_AUD_OZ` for `localDate − 1` with that value and source `midnight` (it is the spot at 00:00 Melbourne on `localDate`, i.e. the close of the day before, D153). The daily 16:52 run always finds today's row when the intraday job ran since midnight.
- Crypto needs no capture: hourly CoinGecko points sit on Melbourne midnights.

### 5.6 Writes
- Fetch outside the database; **one IMMEDIATE transaction per target** at the end of its fetch (so a deadline keeps the work done): upsert by primary key (incoming wins on the same date; a `derived` row never overwrites a `midnight` one); splits upserted; `fetched_at` = the run's clock. Nothing is deleted.
- **Identity and source check, inside each target's IMMEDIATE transaction:** the instrument still exists with the captured `kind` and `symbol` (the Stage 9 identity check, `refresh.ts`, which compares only those two) **and** its effective source, re-read in the same transaction (the `price_sources` row, else `derivePriceSource`), still has the `provider` and `providerSymbol` captured when the run selected it; otherwise nothing is written for that target (a `setPriceSource` during the fetch must never let the old symbol's closes back in).
- **A real price-source change** (`market/service.ts` `setPriceSource`, the Stage 9 Fixer rule that already deletes the `day_quotes` row) also deletes that instrument's `instrument_closes` and `instrument_splits` rows; the next run backfills the new symbol.

### 5.7 The `closes` job (`market/closes/{run,schedule,index}.ts`)
- **Registered by the market service** (as `intraday`), `{ name: 'closes', intervalMs: 0 }`, **always in modes `live` and `fake`**; only its **timers** depend on `config.closesRefresh` (exactly the intraday pattern, `market/service.ts`), so `scheduler.run('closes')` never answers "Unknown job". Timers: **daily at `CLOSES_RUN_AT` (16:52 server-local)**, one **start-up run** after `CLOSES_STARTUP_DELAY_MS` (this is the 1.3.0 backfill; **a restart re-runs the job**, the RUNBOOK's way to run it by hand, since no route calls `scheduler.run('closes')`), and, when a run ended with targets left (deadline or cool-down), one **follow-up** after at least `CLOSES_FOLLOW_UP_MS`, **snapped forward to the next minute with `minute % 15 === CLOSES_SLOT_MINUTE_OFFSET`** (xx:07, xx:22, xx:37, xx:52; at most `CLOSES_FOLLOW_UPS_MAX` a day). `MarketDataService.stop()` clears its timers. **Why 16:52:** every bar dated yesterday in its own zone is final by then (New York's previous day ends by 16:00 Melbourne in AEDT, London's by 11:00), today's ASX bar is excluded by rule (§5.2) and is stored the next day; and **:52 is off the 15-minute grid** on which the intraday crypto and bullion slots fire (`intraday/schedule.ts`, at mark + `INTRADAY_SLOT_OFFSET_MS`), so the daily run never starts inside an intraday burst.
- **Before every request** (not only at the start) it **pauses while `prices`, `intraday` or `dividends` runs** (`scheduler.isRunning`, bounded by the deadline), so a job that starts mid-run overlaps at most the one closes request already in flight. **Before each CoinGecko call** it also waits while the next intraday crypto slot fires within `CLOSES_COIN_SLOT_GUARD_MS`, then until that intraday run has finished, plus `CLOSES_COIN_SPACING_MS`. **The `prices` job awaits an in-flight `closes` run** as it awaits `intraday` (bounded by `CLOSES_RUN_DEADLINE_MS`). The intraday job is not changed. It shares **`Cooldowns`** (a Yahoo 429/403 starts the shared 15-minute pause; a CoinGecko 429 honours `Retry-After`) and stops fetching from a cooling provider for the rest of the run.
- Order per run: series (FX, `AUDUSD`, futures), instruments (Yahoo), coins (CoinGecko), then the derived spot and the midnight capture. Deadline `CLOSES_RUN_DEADLINE_MS`.
- `detail = { yahoo: { ok, failed, skipped }, coingecko: { ok, failed, skipped, beyondReach }, backfills, topUps, rows, splits, derived, midnight, left }`; status by the Stage 4 rules over its own counts.
- **Call budget:** each run ≈ N Yahoo instruments + F FX series + `AUDUSD` + the futures in use (≈ N + 3 + F calls, `CLOSES_YAHOO_SPACING_MS` apart) and K CoinGecko calls (2 per coin in a backfill), 15 s apart: about (N + 3 + F) × 1.5 s + K × 15 s. Once a day (plus a start-up run per restart), against Stage 9's thousands of intraday calls.

### 5.8 Configuration (`config.ts`)
`CLOSES_REFRESH` (`true|false|1|0|yes|no`) → `Config.closesRefresh`; default **true**, **false under `NODE_ENV=test`** (`TEST_DEFAULTS`); an explicit value is honoured under test. **The live kill switch:** `CLOSES_REFRESH: "false"` in the app service's environment (a compose-only release) stops all history fetching; the stored closes stay and periods keep working from them (start closes age out, so holdings turn `no_start` over time). `apps/server/test/helpers.ts` `testConfig` gains `closesRefresh: false`.

### 5.9 Readers (`apps/server/src/db/queries/closes.ts`; FROZEN; step 0)
```ts
export function loadInstrumentCloses(db, ids: readonly number[], from: IsoDate): Map<number, { currency: string; closes: Array<[IsoDate, DecimalString]> }>;
export function loadInstrumentSplits(db, ids: readonly number[]): Map<number, IsoDate[]>;
export function loadSeriesCloses(db, seriesIds: readonly string[], from: IsoDate): Map<string, Array<[IsoDate, DecimalString]>>;
export function closesThrough(db, ids: readonly number[], seriesIds: readonly string[]): IsoDate | null;   // min over the ids and series of each one's newest date; one with no row → ignored
```
Ascending dates; a row whose currency differs from the newest row's is skipped (a listing that changed currency).

### 5.10 Server tests (server-market; injected `fetchImpl`, fake clocks, temp dirs; never the network, never `data/`)
- **Time zone:** each file touching local time starts with `process.env.TZ = 'Australia/Melbourne'` and passes the zone explicitly (the Stage 9 rule and its guard assertion).
- Hand-made Yahoo bodies shaped like the probes (made-up `EXA.AX`, `EXUS`, `0PEXAMPLE1`, `AUDUSD=X`, `GC=F`): bars stamped 23:00Z in AEDT dated the next day in Sydney; a Saturday live `AUDUSD=X` bar dropped; today's bar dropped; nulls skipped (an ASX gap day, a fund's US-holiday nulls); `events.splits` parsed (4:1, 1:10 consolidation), no `events` → none; a `chart.error` → failed; the URL never contains `range=`.
- Yahoo: `currency` from `meta.currency` (an `EXUS` body in USD, a `GBp` body), else `currencyFromSymbol`; `firstTradeDate` parsed in the exchange zone, null when absent.
- CoinGecko: daily and hourly bodies → `coinClosesFrom` on both DST changes and the 25-hour day (daily: the 00:00Z point of D + 1 is the close of D; the first point of a `days=365` body gives the 12M start close of a non-leap span); a 401 for `days=365` → `failed`, for `days > 365` → `beyond_reach` (no failure); 429 + `Retry-After` → cool-down; a 20-second answer within the 30-second timeout.
- Targets: held only; hand-priced none; crypto `needFrom` capped at 364 days; backfill, top-up or skip (no rows → backfill; earliest after `max(earliest trade, firstTradeDate)` → backfill once; a listing younger than the lot (its first bar = `firstTradeDate`) → top-up; a successful backfill whose first bar is after the earliest trade → top-up for the rest of the process; no rows and tried today → skip); once a day; FX and futures `needFrom` 10 days before their dependants'.
- Derived spot (weekdays, 10-day staleness, never over `midnight`); the midnight capture; the identity check; a source change deletes the closes and splits; **a `setPriceSource` during a run's fetch → no `instrument_closes` row for that instrument afterwards**.
- Job: 16:52 slots across 2030-10-06 and 2031-04-06; follow-ups snapped to xx:07/22/37/52; the start-up run; follow-ups (max 6); pauses before a request while `prices`/`intraday`/`dividends` runs, **including an intraday run that starts mid-run**; **a closes run at 16:52 never overlaps a fake intraday crypto slot**, and a coin call due within 45 s of a slot waits for it; `prices` awaits an in-flight closes run; registered with the flag off (`scheduler.run('closes')` works, no timer armed); deadline keeps finished targets; `CLOSES_REFRESH=false`; `stop()`.
- The fake: deterministic; the close of the weekday before the session equals the fake previous close; **every close > 0 over a 15-year window**; 401 for `days > 365`.
- Migration 0007: the SQL shape (`migrations.test.ts` pattern) and an upgrade from a database with data (rows kept). `JOB_NAMES` ends `…, 'intraday', 'closes'`.

---

## 6. Server spec — the periods API (server-api)

### 6.1 Route (`routes/mobile.ts`)
`'/api/mobile/periods'` added to `KEYED_URLS`; `declare(['GET', 'HEAD'], '/mobile/periods')`; `app.get('/mobile/periods', …)` → `buildMobilePeriods`. The catch-all keeps answering 405 for other methods; the root deny-by-default guard and the route-set test gain the path.

### 6.2 The shared input loader (`mobile/inputs.ts`)
Steps 1–3 of the today builder (stage-9.md §6.5: the finance context, `compute(kind)` for the four kinds, the kinds map, the fetched prices, the bullion groups) may be factored into `loadMobileInputs` **only if `today.test.ts`, `equality-leaks.test.ts` and every other Stage 9 server test pass without an edit to their expectations**; `/today`'s output is unchanged byte for byte. Otherwise the periods builder calls the context directly.

### 6.3 Bullion for periods (`mobile/bullion.ts`, + `periodBullionInputs`)
A sibling of `bullionInputs` (which is not changed): every bullion row of every metal with **any** row (held or sold), with `boughtUnits = units − legacySoldUnits`, `unitCostAud` (`unitCostAudOf`), `purchaseDate`, the engine's `OtherAssetResult`, and `price` = the P `/today` uses for that metal.

### 6.4 The builder (`mobile/periods.ts`)
1. The engine inputs (§6.2): **every** `HoldingResult` and every `LotResult` of the four kinds (no `DisposalResult`s: §2.8, D167).
2. Closes: `loadInstrumentCloses` for the held instruments from `min(the 12M start, their earliest remaining lot) − 10 days`; `loadInstrumentSplits`; `loadSeriesCloses` for `AUDUSD` and the needed `FX_<CCY>AUD` from **that window − `PERIOD_START_MAX_GAP_DAYS`** (S − 20 days for 12M: an FX close may lie 10 days before a start close that lies 10 days before S), and `XAx_AUD_OZ` from the instruments' window. Each instrument's `audPerUnit` series: AUD → null; USD → `1 ÷ AUDUSD` per date (`roundDerived`); `GBp`/`GBX` → `FX_GBPAUD ÷ 100`; others `FX_<CCY>AUD` (the `convertToAud` rules applied date by date).
3. `priceDates` (§2.1 `p`): each held instrument's price as-of as a date (a fetched Yahoo price in its exchange zone through the Stage 9 `localDateResolver` rules; a coin and a hand price (`manualPriceAsOf`) in the server's zone; null when unknown); bullion: the spot's as-of date. Then `computePeriods` (§2.8); then the DTO: `holdings` (code, symbol, name, items, units, price, priceStatus, priceAsOf, valueCents, weightRatio exactly as `/today` builds them), `periods`, `valueCents` (Σ held priced), `closesThrough`, `localDate`, `timeZone`, `generatedAt`, `serverVersion`, `apiVersion: 1`.
4. **The `features.*` page switches are ignored** (D95, as `/today`).
5. Budget: < 1 s on the Umbrel for 30 holdings × 3 years of closes (a test with a synthetic dataset asserts < 2 s on this PC).

### 6.5 Equality with the web and with Stage 9 (the acceptance)
A server test seeds the synthetic import (the seed's sold `ASX:OLD` included), **adds `NYSE:EXUS` (USD) with `AUDUSD` closes, a `0PEXAMPLE1` fund, a partial sell of a held instrument, a sold gold row and a partly sold silver row**, plants prices and closes, then compares `GET /api/mobile/periods` with `GET /api/investments/{stock,etf,managed_fund,crypto}`, `GET /api/other-assets` and `GET /api/mobile/today` from the **same app instance and clock**:
- **ALL:** each held holding's figure = its web `unrealisedCents + realisedCents`; each bullion figure = Σ that metal's held rows' `gainCents` + Σ its rows' `realisedCents`; the Sold figure = Σ `realisedCents` of the web's non-held holdings + the realised of metals with no held row; **the ALL total = Σ over the four kinds of `summary.unrealisedCents + summary.realisedCents` + Σ the bullion rows' gains (held) and realised (all)** (no unpriced or no-cost holding in this test).
- **Values:** every holding's `valueCents`, `units` and the response's `valueCents` equal `/today`'s.
- **1W–12M:** P1–P19 and P21–P23 end to end through the route with planted closes, splits and FX.
- **1D unchanged:** `/today` for the same data is byte-identical with and without stored closes.
- Cash accounts and a hand-priced other asset change nothing in the periods answer.

### 6.6 Server tests (server-api)
The equality test (§6.5); every fixture shape; partial totals; the empty and sold-only cases; a coin past CoinGecko's reach (flat in the ALL line); keys (missing, invalid, revoked) on `/periods`; read-only (every method → 405); **the traversal corpus over a real socket gains `/api/mobile/periods/../backups`, `/api/mobile/periods%2f..%2fbackups`, `/api/mobile/periods/..;/status`** (only 401/404/405); the route set; leaks (the log, every body: no key, hash or code); the golden (§12 #4); the performance budget (§6.4); **the answer-size budget** (`PERIODS_ANSWER_BUDGET_BYTES` for the synthetic 30-holding dataset); a hand price dated before a 1W start → `no_start` with no figure (P22) through the route.

---

## 7. Deploy & plumbing (deploy)

### 7.1 Version and release path
Root `package.json` **1.3.0**; release through the Stage 7 path (`pnpm umbrel:release`; the store's `version:` written by it). Migration 0007 → the update takes the **pre-update backup** (Stage 7). No compose change: the whitelist already covers `/api/mobile/periods`.

### 7.2 The smoke (`tools/deploy/smoke.mjs`; the coordinator's §11 step S)
- `EXPECTED_MIGRATIONS = 8` (all three uses).
- `check`: two egress probes added — Yahoo daily history (`AUDUSD=X` with `period1`/`period2`/`interval=1d`) and CoinGecko `market_chart?…&days=365&interval=daily` (a generic coin); any HTTP response counts as reachable for CoinGecko (it may answer 429), 200 for Yahoo.
- `mobile` (the secret script stays one host-side shell script; the key on stdin, never in argv): after `today`, **`GET /api/mobile/periods` → 200 and the shape (`apiVersion=1 periods=7 holdings=N`)**, `POST /api/mobile/periods` → 405; the public traversal corpus gains the periods paths of §6.6; after the seeded restart, poll (≤ 240 s, read-only, through the existing read-only `node:sqlite` `DB_COUNTS_JS`) for a finished `closes` row in `job_runs`: **PASS** when `instrument_closes` has rows for the seeded listed instruments and for the seeded coin; when the run's `detail_json` shows CoinGecko `rate_limited` or skipped (the live 1.2.0 app shares the Umbrel's IP), the coin part is printed as a separate **non-fatal** line ("closes: CoinGecko rate-limited; re-run `smoke mobile` after 2 min"), not a FAIL; the listed instruments' rows stay a PASS/FAIL check (the smoke container runs with its defaults, so `CLOSES_REFRESH` is on). `report()` gains this one non-fatal `NOTE` tag (it does not count as a failure; `--dry-run` unchanged).
- Tests in `tools/deploy/test/smoke-mobile.test.mjs` and `status-smoke.test.mjs` updated; `--dry-run` prints `<redacted>` for every secret expansion (unchanged rule).

### 7.3 Store (local clone, uncommitted)
`../tenon-umbrel-store/tenon-joinr-finance/umbrel-app.yml` `releaseNotes` for 1.3.0: the phone app's period selector (1W to ALL), the daily price history the server now keeps (a daily job; Yahoo and CoinGecko), the migration and its automatic backup. Nothing else changes; `store.test.mjs` checks the 1.3.0 notes where it checked 1.2.0's.

### 7.4 Plumbing and docs
- `playwright.config.ts`: `CLOSES_REFRESH=false` in the web server env (beside `INTRADAY_REFRESH=false`).
- **RUNBOOK:** the `closes` job (what it fetches, when, the call budget, the start-up backfill after an update), **the kill switch** (`CLOSES_REFRESH: "false"`, compose-only) and what keeps working; **a downgrade below 1.3.0 means restoring the pre-update backup**; the APK 1.1.0 (build, certificate digest check, install with `--user 0`); **a restart re-runs the job** (its start-up run; there is no button or route); troubleshooting ("—" on a holding: no price history for the start; "SPLIT"; "Periods need Joinr Finance 1.3.0"; **"Price history to dd/mm" under the chips**: `closesThrough` is stale, so some series has stopped updating (a renamed or delisted symbol, Yahoo blocking the history path, the kill switch): check with the read-only count query (`docker exec … node -e` with `node:sqlite` read-only: counts and the newest date per series, no values), then restart).
- **README / ARCHITECTURE:** the period selector, `/api/mobile/periods`, the three caches, the `closes` job.

---

## 8. Web
**No web change.** Settings → Phone is unaffected (the new path uses the same device key); no page lists job runs generically (the `closes` job, like `intraday`, appears nowhere in `apps/web`); there is no new setting (the selector lives in the app; the kill switch is an environment variable); the holdings pages already show unrealised and realised, and ALL reuses their engine. The e2e suite runs unchanged as a regression (§12 #9).

---

## 9. Android spec (android; `apps/android/**`)

### 9.1 Version and boundaries
- `versionCode = 4`, `versionName = "1.1.0"` (`app/build.gradle.kts`); no dependency change.
- **Unchanged (FROZEN for this stage):** `widget/**`, `work/**`, `Repository.refresh()`'s behaviour, `MobileTodayResponse` handling, and the signatures and behaviour of `toneOf`, `dayTone`, `dayDollarsTone`, `statusWord`, `spokenHolding`, `widgetAgeLine`, `biggestMoves`, `bestAndWorst`, `sortHoldings`, `SortOrder` (its constants and stored names), `Format`, `Tone`. Every existing test passes without an edit to its expectations **and without an edit to its file**: the new members of `MobileApi` and `AppActions` have default bodies (`suspend fun periods(origin: String, key: String): ApiResult<MobilePeriodsResponse> = ApiResult.Err(ApiError.ServerTooOld)`, `fun selectPeriod(p: Period) = Unit`) and the new `Repository`/`Graph` constructor parameters have defaults, so `StoreTest`'s `FakeApi`, `TestHost` and the direct `Repository` constructions compile untouched. **Under 1D the Today screen is exactly the Stage 9 screen** (the D155 row included).

### 9.2 State (`ui/AppUi.kt`, `MainViewModel.kt`, `App.kt`)
- `enum class Period(val chip: String, val label: String, val spoken: String)` in `model/PeriodModel.kt`: `ONE_DAY("1D","TODAY","today")`, `ONE_WEEK("1W","1 WEEK","1 week")`, `TWO_WEEKS("2W","2 WEEKS","2 weeks")`, `ONE_MONTH("1M","1 MONTH","1 month")`, `THREE_MONTHS("3M","3 MONTHS","3 months")`, `SIX_MONTHS("6M","6 MONTHS","6 months")`, `TWELVE_MONTHS("12M","12 MONTHS","12 months")`, `ALL("ALL","ALL TIME","all time")`; the server key is the chip text.
- **D163:** the selected period lives in the process-wide `Graph` (`App.kt`) as a `MutableStateFlow<Period>` starting at `ONE_DAY`: it survives backing out of the activity, the lock, rotation and switching to Settings while the process lives, and **a cold start (a new process) is always 1D**. Never in `Prefs`, `rememberSaveable` or a bundle.
- `AppUiState` += `period`, `periods: MobilePeriodsResponse?`, `periodsFetchedAtMs`, `periodsLoading`, `periodsError`; `AppActions` += `selectPeriod(p)` (and `None`). **`periodsError` is kept apart from `AppData.error` / `AppUiState.error`**: it never feeds `todayNotices`, never dims the screen and its `sentence` is never displayed (the app shows its own §9.6 lines).
- **The VM's trigger:** the VM collects `repository.data`; whenever `fetchedAtMs` moves forward with `error == null` (any source: the app's runs and the worker's alike) **while the activity is started** (`onStart`/`onStop` set a `visible` flag) **and the selected period is not 1D**, it calls `repository.periods(force = true)` (single-flight through its mutex, so overlapping triggers merge into one request). Worker refreshes while the app is in the background fetch nothing.

### 9.3 Network and storage (`net`, `store`)
- `MobileApi.periods(origin, key)`; `PATH_PERIODS = "/api/mobile/periods"`; the same headers, client and timeouts (read 20 s); `apiVersion > 1` → `AppTooOld` (the server sends 1).
- `ErrorMapping`: **a 404 on a path ending `/periods` → `ServerTooOld`** (both branches; its built-in "update to 1.2.0" sentence is never shown for `/periods`: see `periodsError` in §9.2); everything else as Stage 9.
- DTO mirrors of §4.2 (`DatedPricePointsSerializer`, `DatedCentsPointsSerializer` for `[date, value]` pairs; decimals as `String` → `BigDecimal`).
- `Repository.periods(force: Boolean)`: its own mutex (never `refresh()`'s); fetch → `PeriodsCache` (an encrypted file through the same `Box`, beside `TodayCache`) → state. `clearAll` (unpair, revoked) also clears `PeriodsCache`, **and so does `pair()`** (inside its lock, with the periods state); each `PeriodsCache` entry stores the pairing's origin and device id, and an entry whose origin or device id differs from the current pairing is ignored and deleted on `load()`; a `/periods` `ServerTooOld` drops the cached answer. **The worker and the widgets never call it.**
- **When it is fetched** (the answer is ≈ 200 KB, §4.1, so never for 1D alone): (a) the VM trigger of §9.2 (a successful today refresh while a non-1D chip is selected and the app is visible: app open, pull to refresh, the refresh button and the 30-minute worker); (b) when a non-1D chip is selected and the cached answer is absent, older than `PERIODS_MAX_AGE_MS = 30 min`, or older than the last successful today fetch (the chip still switches at once from the cache, with the refresh indicator); (c) on open under 1D only when the cached answer is absent or older than `PERIODS_MAX_AGE_MS` (a warm cache for the first chip tap). A 401 `DEVICE_KEY_REVOKED` takes the Stage 9 revoked path.

### 9.4 The Today screen under a period (design D; `ui/today/**`)
- **Chip row (D163):** directly under the header, **fixed** (it does not scroll away with the content), above the pull-to-refresh content: a **`Row(Modifier.horizontalScroll(state).selectableGroup())` of eight static chips** (not a `LazyRow`: every chip is composed, so tests find all eight and TalkBack's collection info comes from the group, as the Stage 9 bottom bar), 16 dp side padding, **4 dp gaps**, row height 44 dp; each chip 30 dp tall, **8 dp side padding**, min 40 dp wide, radius 15 dp, label 12 sp bold, letter-spaced 0.08 em, monospaced figures; **selected:** teal (`#17C8A0`) label, a 1 dp teal border and a 12 % teal wash; unselected: `textSecondary` on `surface` with a 1 dp `hairline` border. Touch targets ≥ 48 dp (`minimumInteractiveComponentSize`). The selected chip is scrolled into view. A `selectableGroup` whose chips have `Role.Tab`, the spoken name and the selected state ("1 week, tab, selected, 2 of 8"). Never a sideways page scroll (only the row scrolls). **Measured:** chips ≈ 40, 40, 40, 40, 40, 40, 42, 42 dp + 7 × 4 dp ≈ 352 dp, + 32 dp padding ≈ 384 dp, so at 411 dp × 1.0 (the owner's width) every chip, ALL included, is fully visible; the row scrolls only at 360 dp or at a large font scale.
- **"Price history to dd/mm"** (secondary text, one line under the chip row, non-1D only): shown when `closesThrough` is more than `CLOSES_STALE_NOTE_DAYS` (6) days before `localDate` (6 rides out the Easter and Christmas closures).
- **The figure block:** label `<PERIOD LABEL> · EXCL. CASH` (`1 WEEK · EXCL. CASH`; ALL: `ALL TIME · EXCL. CASH`); the figure (34 sp, whole dollars, sign, go/stop tint, **one line: `maxLines = 1`, `softWrap = false`**) = `totals.cents`; when the figure and the %/counts column do not fit side by side, the %/counts column moves under the figure (the D155 row's `InlineOrUnder` rule, `TodayScreen.kt`); a layout that fits is the Stage 9 layout, so 1D is unchanged; the % with ▲/▼ (2 dp) = `totals.ratio`; under it `Since dd/mm/yyyy` (S; ALL: `Since dd/mm/yyyy` of the line's `from`, or nothing); counts `4▲ 3▼`; **the partial note** when `totals.partial`: "Partial: N holdings have no figure for 1W" (N = `missing`; a `no_start` holding whose bought-in part is counted is among the N) (secondary text, with an info icon; TalkBack reads it after the figure). A null total → "—".
- **VAL · INVESTED · GAIN (D155, D168):** **the same three cells under every period, ALL included** (D168), but under a non-1D chip **VAL is the periods answer's `valueCents` and GAIN = that − INVESTED** (INVESTED from `/today`: costs do not move with prices), so one screen shows one price snapshot; the D155 rules for unknown figures are unchanged (any null cost → INVESTED and GAIN "—"; an unpriced holding → GAIN "—"). **Under ALL, GAIN is still value − invested** (the unrealised gain on today's cost), so it is **not** the big ALL figure (which adds the realised gains and the Sold holdings); it matches the ALL line's last point (`totals.unrealisedCents`) to within a cent per holding (the engine rounds value, cost and unrealised separately). No `UNREALISED` or `REALISED` cell anywhere in the header. Under a non-1D chip the "Figures from …" note follows `periodsFetchedAtMs` and the refresh indicator shows `refreshing || periodsLoading`.
- **The period line:** the `PortfolioLineChart` with `totals.cents` points by **index** (equal spacing per point, so weekends without crypto take no width), the dashed zero line, chart teal, the 14 % wash; the chart gets `times` = the point indices `0 … n−1` with `from`/`to` null (`Spark.geometry` then spaces by index); labels under it: the date of `points[0]`, **the date of `points[size / 2]`** (not a time midpoint) and "Today" (`dd/mm`; ALL: `dd/mm/yyyy`); a spoken summary "Change over 1 week since Thursday 5 September, up 1.27 percent, 7,000 dollars; partial, 1 holding has no figure". `line` null → the chart area shows "No price history for this period yet." (secondary text, same height). **Under ALL (D167)** the line is today's holdings' unrealised gain and ends at `totals.unrealisedCents`, not at the big figure; **the difference is labelled once, in a caption** (secondary text, one line, `maxLines = 1` with an ellipsis, under the date labels): `Line: today's holdings, unrealised · realised +$480 not drawn` (the realised part = `totals.realisedCents`, sign and whole dollars; when it is 0 the caption is just `Line: today's holdings, unrealised`); there is no step, marker or second line for sales. The ALL spoken summary: "All-time line of today's holdings, unrealised gain, ending up 170 dollars; realised gains of 480 dollars are in the all-time total but not in the line". (Figures as A10: line end 17000, realised 48000.) With nothing held and only a Sold figure (`soldOnly`), the ALL chart area shows "Nothing is held now." instead (same height, no caption).
- **CARDS:** the same card; under a period: the price (from `holdings`), the change line `▲ 0.50 (1.00%)` = `changePerUnit (priceRatio)` when `startClose` is known, `BOUGHT IN 1W ▲ 1.33%` (position `ratio`) when `startUnits` is 0, under ALL `▲ 20.85% ALL TIME` (the ratio on the cost of everything bought); the sparkline = the figure's `line` against its dashed `base` (the start close; ALL: the average cost); the footer label = the chip text (`1W`, `ALL`) and the figure's cents. Non-`ok`: "—" with `NO HISTORY` (`no_start`), `SPLIT` (`split`), `NO PRICE` (`unpriced`), `NO COST` (`no_cost`); **a `no_start` figure with cents** (D165: units bought in the period) shows those cents and `BOUGHT IN 1W ▲ 5.00% · PARTIAL` (`ratio` on `newCostCents`) with `NO HISTORY` under the price (D166). An `ok` figure on a stale or hand price keeps the Stage 9 `STALE · dd/mm` / `HAND PRICE` word under the price. **Under ALL a one-line row under the grid:** "Sold holdings: +$580 · 2 sold" (the Sold figure; not a card; §15 item 8). **The Sold line and the LIST/MOVERS SOLD rows are not clickable** (no `Role.Button`, no `onOpen`) and carry their own merged `contentDescription`, e.g. "Sold holdings, 2 instruments, all-time gain plus 580 dollars, up 11.58 percent" (never `spokenHolding`).
- **LIST:** columns unchanged (SYM · LAST · CHG% · CHG$ · VALUE); CHG% = the figure's `ratio`, CHG$ = its cents; non-`ok` rows "—" with the status word under the code (a `no_start` row with cents shows them, with `NO HISTORY`); **under ALL a "SOLD" row** before the total (SYM `SOLD`, small text `2 SOLD`, LAST and VALUE "—", its % and $); the total row = the period totals and `valueCents`. Measured column widths as Stage 9 (ALL figures can have seven digits).
- **MOVERS:** every figure with cents (`ok`, a `no_start` bought-in part, and the Sold figure under ALL, labelled `SOLD`) as bars scaled to the largest |cents|; footer "No figure for 1W: N" (N = `missing`).
- **Sort:** `SortOrder` unchanged; under a period DAY $ and DAY % sort by the figure's cents and ratio (nulls last, ties by code), VALUE by value; the shown label is period-aware through a function (`1W $`, `1W %`, `ALL $`), never by renaming the enum. The Sold row is always last before the total.
- **Loading:** the first time a non-1D chip is shown with no answer: skeleton blocks for the figure, the line and the cards (Stage 9 state 0a); a refresh dims the current render.
- **States:** Unreachable → the cached periods stay, dimmed, with "Figures from 14:10 (2 h ago)" (as Today); `ServerTooOld` → under the chips, for every non-1D chip: "Periods need Joinr Finance 1.3.0 or later on the Umbrel." (1D works as before); other errors one line with Retry; `noHistory`-like answers show the "—" cards and the partial note. **Empty branches by period** (the Stage 9 branch tests `today.holdings.isEmpty()` and would hide the Sold figure): under 1D, the Stage 9 empty branch unchanged; under ALL, the empty branch ("No holdings yet…") only when `periods.holdings` is empty **and** there is no Sold figure; with only a Sold figure (`soldOnly`) the figure block, the chart area with "Nothing is held now." (the ALL line draws today's holdings only, D167), the tabs, the SOLD row in LIST and MOVERS and the Sold line in CARDS show; under 1W–12M with nothing held but sales recorded (a Sold figure under ALL), the figure block and the note "Nothing is held now." (never the "Add trades" sentence); `empty` (nothing ever bought) → the Stage 9 empty sentence under every period.

### 9.5 The holding detail (D169)
Under a non-1D period the detail follows it: the large chart shows the figure's `line` (dashed base, dates under it, drag to read date and AUD price, announced for TalkBack); the day block (Day $, Day %, Previous close, Session, New today) is replaced by: `<1W> change` ($, %), `Start close` (B and `dd/mm/yyyy`), `Change per unit` (and %), `Held at start` (units), `Bought in 1W` (units, "measured from purchase price"); under ALL: `Unrealised`, `Realised`, `All-time gain` ($, %), `Cost of everything bought`. The position rows (Units, Value, Weight, Cost, Unrealised gain, Average price, Price as at) stay, **except that under ALL the position `Unrealised gain` row is dropped** (ALL's own `Unrealised` row replaces it, from the same answer). Under a non-1D period: the chart's tone follows the sign of the period figure (not `dayTone`); a null `line` shows "No price history for this period yet."; axis labels `dd/mm` (ALL `dd/mm/yyyy`), not `Times.hm`; the drag readout is `dd/mm/yyyy · $x.xx` in AUD (period lines are AUD, §4.2). Under 1D the detail is the Stage 9 screen. **A detail opened from a widget tap shows 1D** (the widgets are daily, D156) **without changing the held period** (D169).

### 9.6 Sentences
- `ServerTooOld` on `/periods`: "Periods need Joinr Finance 1.3.0 or later on the Umbrel."
- Partial: "Partial: N holding(s) have no figure for <period>." Line missing: "No price history for this period yet." ALL line caption (D167): "Line: today's holdings, unrealised" + " · realised ±$N not drawn" when `totals.realisedCents` ≠ 0. Stale history: "Price history to dd/mm." Nothing held (1W–12M; and ALL's chart area in `soldOnly`): "Nothing is held now."
- Status words: `NO HISTORY`, `SPLIT`, `NO PRICE`, `NO COST`; the Sold row: `Sold holdings`.

### 9.7 Tests (JVM, Robolectric `@Config(sdk = [35])`, as Stage 9)
`PeriodModelTest` (figure accessors, period sort, mover rows with the Sold row, totals and labels, the partial text, the change-line variants, the header row under every period (`VAL · INVESTED · GAIN`, ALL included, D168: VAL from the periods answer, GAIN = VAL − INVESTED, the D155 "—" rules), the ALL line caption with and without a realised part (D167)); `NetTest` (`/periods` 200 parses **every** periods fixture; 404 → `ServerTooOld`; HTML 404 → `ServerTooOld`; 401 revoked → clears both caches); `PeriodsStoreTest` (a new file; `StoreTest.kt` untouched: `PeriodsCache` with the fake `Box`; `clearAll`; **pair → periods cached → pair to another origin → no periods after `load()`**; a `/periods` `ServerTooOld` drops the cache); a state test (the period survives a new `MainViewModel` while `Graph` lives; a new `Graph` starts at 1D); **VM trigger tests** (a worker-style today update under 1W while visible → exactly one periods call; under 1D or not visible → none; two overlapping triggers → one request; the refresh indicator is `refreshing || periodsLoading` under 1W); **a `/periods` 404 under 1D shows no notice and no dimming; under 1W only the 1.3.0 line**; Compose UI tests: **all eight chip nodes exist**, selection, `Role.Tab` semantics and the row's `SelectableGroup` (1W reports collection item index 1 of 8 where Robolectric exposes `CollectionItemInfo`), **at `w411dp-h882dp` × 1.0 every chip lies fully inside the row; at `w360` × 1.3 ALL is reachable with `performScrollTo`**, **under 1D every Stage 9 Today test unchanged**, each period with the `open` fixture (cards, LIST with the SOLD row under ALL, MOVERS, the partial note, "—" cards and their words, the header row reading `VAL · INVESTED · GAIN` under ALL with no `UNREALISED`/`REALISED` node, the ALL line's last point equal to `totals.unrealisedCents` and its caption), loading, `ServerTooOld` under non-1D only, offline dimmed, `noHistory`, **`soldOnly` (the empty today fixture + `periods-sold-only.json`: under ALL the SOLD row, "Nothing is held now." in the chart area and no "Add trades" sentence; under 1W "Nothing is held now.")**, `empty`; the SOLD row and Sold line have no `OnClick` action and carry the merged description; the "Price history to dd/mm" note; the line's middle label = `points[size / 2]`'s date on an uneven grid; the detail under 1W and ALL (tone, no-line text, date labels, AUD readout, no duplicate unrealised row under ALL); a widget tap's detail under a held 1W shows 1D and leaves 1W held; **layout:** at `w360dp-h780dp-xxhdpi` and `w411dp-h882dp`, font scale 1.0 and 1.3, the first card row lies fully above the bottom bar with the chip row in place, no clipping of a seven-digit ALL figure **and `TextLayoutResult.lineCount == 1` for the big figure with a seven-digit ALL total at `w360` × 1.3 and `w411` × 1.3, and for a seven-digit negative GAIN in the header row under ALL, and the ALL line caption at one line** (`noClippedText` does not catch wrapping), the chip row scrolls without a page scroll; `w411dp-h914dp-420dpi` (the fractional-density LIST rule) for every period tab. **Widget and worker tests run unchanged.**

### 9.8 Phase B: the emulator smoke (android, then the Verifier)
On the private AVD, headless: a prod server on **3624** (fake data, the seed + `NYSE:EXUS` (USD) and `0PEXAMPLE1` with buys, a buy dated within the last week, the seed's sold `ASX:OLD`; **`CLOSES_REFRESH=true`**, wait for a `closes` run), `adb reverse`, the debug APK, pairing by the quoted deep link (Stage 9 §9.14); screencaps under `artifacts/screenshots/stage10/android/` of each chip × CARDS/LIST/MOVERS, the detail under 1W and ALL, the partial note, ALL's SOLD row; force-stop and relaunch → 1D; back out and reopen without killing the process → the period kept; stop the server → cached periods dimmed; the three widgets in the debug host unchanged (screencaps beside Stage 9's); `logcat` free of crashes and of `jfk_`. The release build (throwaway keystore under `artifacts/stage10/`) installs and launches.

---

## 10. Roles, tasks and FILE OWNERSHIP

### 10.0 Rules (all agents; Stage 9 §10.0 carried over)
- **Ownership:** edit only files you own (§10.1). Need a change elsewhere? Report it; the coordinator routes it.
- **Frozen contracts:** §2 (rules, examples, signatures), §3 (tables, constants, enums, fixtures' shapes), §4 (endpoint, DTOs), §5.2's filter rule, §5.9's readers, §9.1's unchanged list. A change needs the coordinator's approval and a Scaffold note.
- **No installs, no lockfile or Gradle dependency change.**
- **Never touch the Umbrel; never install on a real phone** (adb `-s emulator-NNNN` only; never `gradlew installDebug`); **never create, read or ask for the owner's keystore.** Throwaway keystores only under `artifacts/stage10/**`.
- **Never commit or push** (either repository).
- **Never on `data/`:** every server uses its own `DATA_DIR` (§10.6); `AUTO_RECORD` is never set; `INTRADAY_REFRESH=false` and `CLOSES_REFRESH=false` unless the item under test needs one on.
- **Test values only:** the Stage 9 fixture key and codes, the hosts `umbrel`, `127.0.0.1`, `example.test`, `umbrel.example-tailnet.ts.net`; the generic symbols of the header; no real ticker, coin id or fund id in a test or fixture (the probe's generic symbols included); **no probe body copied** (hand-made bodies from the probe shapes only).
- **Privacy:** `pnpm guard:all` before you finish; a guard hit on a value you believe generic → change your value; never edit `docs/private/guard-terms.txt`.
- **Scoped runs** while others work (§1.4); keep your files compiling at every step.
- **Coordinator pre-step** (before step 0): append the private §5 guard terms and re-run `pnpm guard:all` (clean); confirm no dev server runs and the ports of §10.6 are free; no `data/` backup is needed (no agent opens it).

### 10.1 Ownership table (every new or changed Stage 10 file has exactly one owner)
| Owner | Files |
|---|---|
| **server-market** | **Contract (step 0, then post-contract owner):** `packages/schema/src/{mobile.ts,enums.ts,index.ts,rows.ts}`, `src/dto/mobile.ts`, `src/db/tables/instruments.ts`, `src/db/index.ts`, `src/testing/{seed.ts,dump.ts}`, `src/fixtures/{mobile.ts,index.ts,coverage.ts}`, `packages/schema/scripts/exportMobileFixtures.ts` (only if needed), schema tests (`mobile-rules.test.ts` included), **`apps/android/app/src/test/resources/fixtures/**` (generated copies only)**; `packages/engine/src/{periodChange.ts,index.ts}` and engine tests; `apps/server/migrations/0007_*` and `migrations/meta/**`; `apps/server/src/db/queries/closes.ts`. **Market:** `apps/server/src/market/**`, `src/config.ts`, `apps/server/test/market/**`, `test/migrations.test.ts`, `test/config.test.ts`, `test/helpers.ts`, and any existing market suite the changes touch. |
| **server-api** | `apps/server/src/mobile/**`, `src/routes/mobile.ts`, `src/app.ts` (only if wiring needs it), `apps/server/test/mobile/**`, `test/routes/**` suites it touches, `apps/server/test/golden/mobile.golden.test.ts`. |
| **deploy** | `tools/deploy/**` (smoke and its tests, `store.test.mjs`), root `package.json` (version only), `playwright.config.ts`, `docs/deploy/RUNBOOK.md`, `README.md`, `docs/ARCHITECTURE.md`. **Outside the repo (local clone, uncommitted):** `../tenon-umbrel-store/tenon-joinr-finance/umbrel-app.yml` (`releaseNotes` only). |
| **android** | `apps/android/**` except the generated fixtures folder, `widget/**`, `work/**` and the font files. |
| coordinator | `PLAN.md` · `docs/HANDOFF.md` · `docs/DECISIONS.md` · `docs/STAGE_PROCESS.md` · `docs/stages/**` (implementers append only to "Scaffold notes") · `CLAUDE.md` · `docs/style/**` · `docs/private/**` · `reference/**` · `.claude/launch.json` · every live step · every commit and push. |

### 10.2 server-market
**Step 0 (alone):** §2.8 (`periodChange.ts` with P1–P19, P21–P23, A1–A11, C1–C5, the DST runs and the fixture-consistency test), §3 (the three tables, `db:generate` → `0007_stage10_closes.sql` with its journal entry, row schemas, the seed reset and dump exclusions, constants, enums, `JOB_NAMES` + its test), §4.2 DTOs, §3.6 fixtures and the four Android JSON copies (`pnpm android:fixtures`) with the drift test, §5.9 readers. Keep every project green: `pnpm typecheck`, `pnpm vitest run --project schema --project engine --project server`. Scaffold note "contract landed"; the workflow then starts the other three.
**Then:** 1. the Yahoo history URL, split parser and client with tests; 2. the CoinGecko history call and `coinClosesFrom`; 3. targets, backfill/top-up; 4. the derived spot and the midnight capture; 5. writes and the source-change deletion; 6. the job (timer, start-up, follow-ups, waits, deadline), `config.ts`, `stop()`; 7. the fake histories; 8. `pnpm vitest run --project server` green; a prod smoke on **3621** (`MARKET_DATA_MODE=fake CLOSES_REFRESH=true`): seed, wait ≤ 150 s, a `closes` row in `job_runs`, `instrument_closes` rows for the seeded listed instruments and coins, `series_closes` rows for `AUDUSD`, the futures and the derived spot.

### 10.3 server-api
After step 0: 1. `mobile/inputs.ts` (only under §6.2's condition), `bullion.ts` `periodBullionInputs`; 2. `mobile/periods.ts` with planted closes; 3. the route; 4. the equality test, the traversal additions, leaks, the golden, the performance test; 5. a prod smoke on **3622**: seed, pair with curl (no Origin), `GET /api/mobile/periods` with the key → 200, seven periods, the ALL total equal to the web's sums, `POST` → 405, revoke → 401.

### 10.4 deploy (phase A only)
§7: smoke (with `--dry-run` checked by eye) and its tests, the store notes and test, the version, `playwright.config.ts`, the docs; `pnpm --project deploy` green; `pnpm guard:all` and the store privacy check.

### 10.5 android (phase A in parallel; phase B after server-market and server-api report done)
**Phase A:** §9.1–§9.7 against the JSON fixtures and MockWebServer; design D (the Stage 9 mock-ups at `artifacts/stage9/design/`, read as data) and the §9.4 measurements; `pnpm android:test`, `android:lint`, `android:debug` green; a release build with a throwaway keystore under `artifacts/stage10/android/`. **Phase B:** §9.8 on **3624**.

### 10.6 Reviewers, Fixer, Verifier; ports and environment
- **spec-correctness:** §2 against D158 and D160–D165 and the probe facts: every example and two of your own (a sale and a buy of the same holding inside one period; a future-dated lot under 12M), the calendar (EDATE, weekends, the 10-day gap), FX at the start, crypto and bullion midnights (D142, D153), the ALL equality with the web, the Sold figure, the partial rules, the lines' last points, §5's filter (no live bar, no weekend bar, no today bar), the CoinGecko reach, the 16:52 timing across DST and its distance from the intraday slots, the never-replace-midnight rule, the API field by field, and **`/today` unchanged**.
- **style-ux:** the Android screens from phase B and the Compose test renders: STYLE_GUIDE §1–§10, design D, the chip row (sizes, states, touch targets, TalkBack), every period on CARDS/LIST/MOVERS and the detail, the partial note, the SOLD row, seven-digit figures at 360 dp × 1.3, the line's date labels, density; the widgets unchanged.
- **code-quality/security:** the new route under the whitelist (key check, read-only, the deny-by-default guard, the traversal corpus over a socket); no key or code in logs or bodies; the job's resource bounds (deadline, spacing, cool-downs, once-a-day backfill, no unbounded memory); SQL through Drizzle; the caches' exclusions (never app data, never dumped); `widget/**` and `work/**` untouched (`git diff --stat`); every tracked and store file for owner data (a scratch scan under `artifacts/stage10/review-code/` against the private §5 terms).
- **Fixer:** applies the verified findings across owners; contract changes only with the coordinator's approval.
- **Verifier:** runs §12 with per-item `DATA_DIR`s under `artifacts/stage10/verifier/`.

| Agent | WEB_PORT | PORT | DATA_DIR |
|---|---|---|---|
| default / owner / `.claude/launch.json` | 5173 | 3001 | `data` (never used by agents) |
| server-market | — | 3621 | `artifacts/stage10/server-market/prod` |
| server-api | — | 3622 | `artifacts/stage10/server-api/prod` |
| deploy | 5623 | 3623 | `artifacts/stage10/deploy/data` |
| android (phase B) | — | 3624 | `artifacts/stage10/android/prod` |
| Reviewers spec / style / code | 5631 / 5626 / 5627 | 3631 / 3626 / 3627 | `artifacts/stage10/review-{spec,style,code}/data` |
| Fixer | 5628 | 3628 | `artifacts/stage10/fixer/data` |
| Verifier | 5629 | 3629 | `artifacts/stage10/verifier/{e2e,prod,android}` |

Every agent prod run sets `IMPORT_CORRECTIONS_FILE=none MARKET_DATA_MODE=fake PRICE_REFRESH_MINUTES=0 NIGHTLY_BACKUPS=false WEEKLY_NAS_COPY=false INTRADAY_REFRESH=false CLOSES_REFRESH=false` unless the item under test needs one on. Stage 7–9 lessons: stop the owner's `pnpm dev`; confirm ports are free before and after; run from the repo root; `MSYS_NO_PATHCONV=1` under Git Bash for path values; one emulator at a time; `gradlew --stop` after a release build; re-check `adb reverse --list` before pairing.

---

## 11. The coordinator's live runbook
Every write on the Umbrel needs the owner's OK in chat first; remote writes run `--dry-run` first. The owner's specifics are in the private §1–§4.

**Pre-flight:** 0. HANDOFF's carry-overs (the first scheduled NAS copy, the September auto-record, the optional Monday bullion probe). The Verifier's report is green; `pnpm check`, `pnpm build`, `pnpm guard:all` green locally; `ssh umbrel true`; `pnpm umbrel:status` healthy (1.2.0, migrations 7).

**Step S — the live smoke (owner OK: an rc image and tag, a scratch container and folder):**
1. `pnpm umbrel:release --allow-dirty --skip-store --prerelease rc.1` → `joinr-finance:1.3.0-rc.1`.
2. `pnpm umbrel:smoke start --image …:1.3.0-rc.1` → `check` (migrations **8**, the daily-history egress) → `mobile` (§7.2: periods 200 and shape, 405, the corpus, a `closes` run and closes rows). 3. `pnpm umbrel:smoke remove`. Record the outcome in the private §6.

**Release and update:**
4. `pnpm umbrel:release --allow-dirty` (1.3.0); copy version, tree, `HEAD`, digest into the private §6.
5. **Store push** (owner OK): `git -C ../tenon-umbrel-store diff` (image line, `version`, `releaseNotes` only); the store privacy check; commit `1.3.0 - Joinr Finance, the phone period selector`; push.
6. **Update** (the owner clicks) after "Safe to click Update". Then: `/api/health` 1.3.0 and migrations **8**; a **pre-update backup** listed in Settings → Backups; Settings → Phone still lists the paired phone; the Stage 7–9 parts unchanged; **APK 1.0.2 on the phone still shows Today and its widgets update** (the backward-compatibility check).
7. After about 3 minutes: the start-up `closes` run Succeeded (Settings has no job list: check with a read-only count over `docker exec` (owner OK), or by the periods themselves in step 11).

**The proxy, live (read-only, no Umbrel session; owner OK):**
8. `curl -s -i http://umbrel:4932/api/mobile/periods` → 401 JSON `DEVICE_KEY_MISSING`; `-X POST` → 405 JSON; `curl --path-as-is` for `/api/mobile/periods/../status` and `/api/mobile/periods/..;/status` → the login redirect or an app 401/404/405 only, never data. Each status line in the private §6.

**The APK:**
9. `JOINR_ANDROID_SIGNING=<the private path> pnpm android:release` (1.1.0): the APK's SHA-256 and **the certificate digest, which must equal the recorded one** (Stage 9 private §8); record both in the private §6.
10. With the owner's OK, the owner turns on wireless debugging and the coordinator installs **`adb -s <phone> install -r --user 0 <apk>`** (the private §4); never `installDebug`.

**The demo (PLAN acceptance):**
11. **Chips:** 1D is the Stage 9 screen; each of 1W … 12M: the figure, the %, `Since …`, the line, cards, LIST, MOVERS; the owner's hand-priced fund shows "—" and the **partial** note in 1W–12M (private §2).
12. **ALL:** compare the total with the web: Σ over the four investment pages of (unrealised + realised) plus the Other Assets bullion rows' gains and realised; the SOLD row in LIST and MOVERS (private §2: one sold ETF); **the header row still reads `VAL · INVESTED · GAIN`** (D168) with the same INVESTED as under 1D; **the ALL line has no step on the sold ETF's sale date and ends at the held holdings' unrealised gain** (D167), which matches the header's GAIN within a cent per holding, and the caption's realised figure = the big ALL figure − that end (the SOLD row plus the held holdings' realised parts).
13. **Detail** under 1W and ALL; **cold start** (swipe the app away) → 1D; back out and reopen → the period kept.
14. **Widgets** unchanged (daily figures, ages); **offline** (Tailscale off) → cached periods dimmed; back on → refresh.
15. **Leaks, live:** the Stage 9 needles over both containers' logs → all 0.

**Close:** HANDOFF, PLAN status and **PLAN.md's Stage 10 text corrected** ("ALL is the unrealised gain" → D161: unrealised + realised, the Sold holdings row), DECISIONS (the §17 answers, the demo), the Stage close notes here; commit locally with the owner's OK; push only if the owner asks (D10).

---

## 12. Acceptance tests (the Verifier runs every item)
**Isolation:** never `data/`; never the Umbrel or a real phone; ports 5629/3629 free; delete each item's `DATA_DIR` first. Order: 1–5 → 6–8 (prod) → 9 (e2e) → 10–11 (Android) → 12–15.

| # | Check | How |
|---|---|---|
| 1 | Install and static checks | `pnpm install --frozen-lockfile` (no lockfile diff); `pnpm typecheck`, `pnpm lint`, `pnpm format:check` exit 0 |
| 2 | Unit tests | `pnpm test` green (≥ the Stage 9 count + new); gated suites and goldens **ran** (`--reporter=verbose`) |
| 3 | Targeted suites | `--project engine test/periodChange` (P1–P19, P21–P23, A1–A11, C1–C5 by name; the DST runs; fixture consistency); `--project server test/market test/mobile test/migrations.test.ts` (history parsing and filters, CoinGecko midnights and reach, targets, derived spot, midnight capture, the job's schedule, **the equality test**, the traversal corpus over a socket with the periods paths, leaks, performance); `--project schema` (enums, drift); `--project deploy` |
| 4 | Golden | `mobile.golden.test.ts` ran (not skipped), compared Σ `realisedCents` of every `HoldingResult` (held priced, held unpriced and sold) with Capital Gains V and the held, priced holdings' unrealised parts with the workbook's cells (the Stage 2 skip rules applied), printed counts only |
| 5 | Migration and frozen code | `0007_stage10_closes.sql` = the three tables only; `git diff --stat` shows **no change** to `packages/engine/src/dayChange.ts`, `apps/android/app/src/main/java/com/tenon/joinrfinance/{widget,work}/**`; the `/today` byte-identical test (§6.5) ran and passed |
| 6 | Prod build, the endpoint | `pnpm build`; prod on 3629 (seeded, fake); pair; `GET /api/mobile/periods` → 200, `apiVersion` 1, seven periods, totals = sums, last line points = `totals.cents` (1W–12M) and `totals.unrealisedCents` (ALL, D167; the seeded `ASX:OLD` adds no step on its sale date), `valueCents` = `/today`'s; `POST`/`PUT`/`PATCH`/`DELETE` → 405; no key → 401 MISSING; revoke → 401 REVOKED |
| 7 | Traversal (prod, raw socket) | the §6.6 corpus with the periods paths: no 200 from a non-mobile route, no SPA |
| 8 | Closes job (prod) | prod with `CLOSES_REFRESH=true`: within 150 s a `closes` row; `instrument_closes` for the seeded listed instruments and coins, `series_closes` for `AUDUSD`, the futures and `XAx_AUD_OZ`; no row dated today or on a weekend for a Yahoo series; then `/periods` shows `ok` figures with start closes (a seeded coin's **12M** figure may be `no_start` only on a 366-day span across a 29 February, §14); **restart the server: its start-up run is a top-up (`detail.backfills` 0)**; with `CLOSES_REFRESH=false` the job is still registered (no timer armed) |
| 9 | e2e | `PORT=3629 WEB_PORT=5629 DATA_DIR=artifacts/stage10/verifier/e2e pnpm e2e`: every Stage 0–9 spec green (list any retried read-only test) |
| 10 | Android build and tests | `pnpm android:test` (every §9.7 test by name; the Stage 9 tests unchanged), `android:lint`, `android:debug`; `JOINR_ANDROID_SIGNING` unset → `android:release` refuses; a throwaway → a signed 1.1.0 APK |
| 11 | Emulator smoke | §9.8 end to end on 3629 (chips, every period on the three tabs, the detail, the SOLD row, the partial note, the header row `VAL · INVESTED · GAIN` under ALL (D168), the ALL line's caption (D167), cold start → 1D, back-out keeps the period, offline dimmed, widgets unchanged, no crash and no `jfk_`); the release APK installs and launches |
| 12 | Store folder | the store test ran; `git -C ../tenon-umbrel-store status` shows only `umbrel-app.yml` changed, nothing committed; the compose unchanged |
| 13 | Plumbing | `git status` shows no build output; the new tables are not in the records browser: `DUMPED_TABLES` (`testing/dump.ts`) contains none of the three; not app data: after a closes run, delete all domain data **and the instruments** (a direct delete in a test, leaving only `series_closes` rows), then `hasAppData` and `hasDomainData` are false |
| 14 | Privacy | `pnpm guard:all` (with the Stage 10 terms); the store guard; the code reviewer's scan on the final diff: no owner ticker, coin id, amount, IP, host, phone model or personal path; no probe body in any tracked file |
| 15 | Docs | the RUNBOOK's closes-job, kill-switch, downgrade and APK 1.1.0 sections; README mentions the period selector |

**PLAN acceptance, live (§11):** the period figures follow D160–D165 (#3, step 11), ALL equals the web's lifetime gains (#3, step 12), the widgets stay daily (#5, step 14), the phone path stays read-only and keyed (#6, #7, step 8), no owner data in the repo (#14).

---

## 13. Every agent: final report checklist
- Files created or changed (all inside your ownership; Scaffold notes appended; deploy lists the store-clone file separately and confirms nothing was committed there).
- Commands run with pass/fail: typecheck, lint, format:check, your scoped tests (android: `android:test`, `android:lint`, the builds), your smoke or emulator steps on your ports, `pnpm guard:all`.
- No `ssh`, `scp` or `docker` against any host; no server on `data/`; no real phone; only throwaway keystores under `artifacts/stage10/`; no probe body copied.
- Screenshot paths under `artifacts/screenshots/stage10/` (android, style-ux) and the STYLE_GUIDE §10 self-check.
- Contract gaps or cross-owner requests (not worked around).
- Ports free, emulators stopped, `gradlew --stop` run, no background processes left.
- Nothing committed or pushed; no owner data, IPs, host names (other than `umbrel`), phone models or personal paths in any tracked or store file.

---

## 14. Risks & fallbacks
| Risk | Status / fallback |
|---|---|
| **A stock split or consolidation** (Yahoo's closes are split-adjusted; trades are not; the app has no split model) | Split events are stored; a period containing one shows `split` "—" and the ALL line draws that holding flat; ALL's figure is the web's (which is wrong after a split until the owner records it, as today). The owner has no split-like trades (private §2). A split model is a later stage. |
| **Yahoo's daily answer carries a live or partial bar** (weekend FX, today's session) | §5.2's filter keeps only weekday bars dated before today in their zone; the top-up rewrites the last 10 days, so a late correction replaces a stored value. |
| **CoinGecko refuses history older than 365 days** (401 / 10012) and throttles bursts | Backfill within reach; stored history grows past 365 days from 1.3.0 on (never deleted); with the daily-point rule of §5.3 the first backfill stores the close of `localDate − 365`, so a coin held longer before 1.3.0 is `ok` in 1W–12M from the first run, **except 12M on a 366-day span (across a 29 February) when the run falls after 10:00–11:00 Melbourne: "—" for that one day** (stored closes are never deleted, so it clears the next day); it is drawn flat in the ALL line; calls 15 s apart, timeout 30 s, `Retry-After` honoured. |
| **Crypto and bullion closes before 1.3.0 are approximate** (00:00 UTC points beyond 90 days; NY futures ÷ London FX instead of 00:00 Melbourne) | Hours, not days, off; only 6M/12M starts and the early part of long lines are affected, and only until the exact values accumulate (hourly top-ups; the midnight capture). §15 item 9. |
| **A series stops updating silently** (a renamed or delisted symbol, Yahoo blocking the history path) | `closesThrough` is the oldest per-series newest close (§4.2), so one failing series shows; the app prints "Price history to dd/mm" under the chips past 6 days; the RUNBOOK's troubleshooting entry. |
| **A fund's NAV gaps and lag** | The start close is the last NAV within 10 days; the line forward-fills. A hand-priced fund has no history: `no_start` in 1W–12M, flat in ALL. |
| **The futures roll** (`GC=F`/`SI=F` are front-month series) | A roll inside a period moves the derived spot by the contract spread (as Stage 9 accepts for the day). Rare. |
| **The first start of 1.3.0 has no closes for about two minutes** | Periods show "—" and the partial note until the start-up backfill finishes (the `noHistory` fixture); the app refetches on refresh. |
| **Rate limits and the intraday bursts** (Yahoo; CoinGecko's 429 after about five calls in 25 s, `Retry-After` 60, a shared cool-down that also stops Stage 9's 1D crypto) | One call per series per day, 1.5 s apart; the daily run at 16:52, off the 15-minute intraday grid, follow-ups at xx:07/22/37/52; a pause before every request while `prices`/`intraday`/`dividends` runs; no CoinGecko call within 45 s of an intraday crypto slot; `prices` awaits an in-flight closes run; a 429 starts the shared cool-down and a follow-up run; the kill switch (§5.8). |
| **A big answer on a slow link** | ≈ 200–230 KB uncompressed for about 25 holdings (§4.1); fetched only while a non-1D chip needs it (or a stale cache on open), cached, single-flight; the 20 s read timeout; a server size-budget test (`PERIODS_ANSWER_BUDGET_BYTES`). |
| **APK 1.0.2 against 1.3.0** | `/today` unchanged and `apiVersion` 1: the old app and its widgets keep working (§11 step 6 checks it). APK 1.1.0 against 1.2.0: `/periods` 404 → "Periods need 1.3.0"; 1D works. |
| **Downgrade** | 1.2.0 refuses the database after 0007: restore the pre-update backup (RUNBOOK). |
| **Two "gain" figures under ALL** | The header row stays `VAL · INVESTED · GAIN` (D168), so under ALL its GAIN (value − invested) differs from the big ALL figure by the realised gains. Mitigated by labels: the big figure reads `ALL TIME · EXCL. CASH`, the ALL line ends at the GAIN figure, within a cent per holding (D167), and its caption names the realised part not drawn (§9.4). |
| **The chip row costs 44 dp of Today's height** | The layout tests keep the first card row above the bar at 360 × 780 × 1.3; fallback (Fixer, no re-plan): the chips move into the scrolling list as its first item. |
| **DST** (the October and April changes) | The engine works on dates; the server's midnights come from `startOfDayInZone`; the 16:52 timer on server-local wall time; all tested on both change days. |

---

## 15. Behaviour changes in Stage 10 (owner can veto)
Numbering is stable. No template fixes this stage.
1. **The server keeps a daily price history** of every held listed instrument, fund and coin, the FX series they need, `AUDUSD`, the futures and the AUD bullion spot, from about ten days before each one's first trade (coins: at most a year back), never deleted. A new **`closes` job** runs every day at 16:52 and at start-up (one Yahoo call per series and one CoinGecko call per coin a day, spaced).
2. **1W and 2W are 7 and 14 calendar days; 1M–12M are calendar months with the day clamped** (on 31 March, 1M starts on 28 or 29 February); the figure is measured from the close of the start date or, when that is not a trading day, the last close before it (at most 10 days earlier).
3. **Units bought within a period count from their purchase price without brokerage** (as 1D); ALL includes brokerage (the web's figures).
4. **A stale or hand price still gives a period figure** (the period runs to that price; the card keeps its STALE or HAND PRICE word) **unless the price is older than the period's start close** (then "—", counted in the partial note); a holding with no price has none. (1D is unchanged: no day figure on a stale price.)
5. **A holding held at the start without a stored close** (D165): the units it held at the start are "—" and left out; **its units bought in the period still count from their purchase price**, and the card shows that part marked PARTIAL, so cards, LIST and MOVERS add up to the total; the total says "Partial" (D166).
6. **A period that contains a stock split shows "—" ("SPLIT")** for a holding whose units straddle it; units all bought after the split still get a figure.
7. **The header row stays VAL · INVESTED · GAIN under every period, ALL included** (D168). Under 1W–12M and ALL, VAL and GAIN come from the periods answer (item 16); GAIN is value − invested as today, so under ALL it is the unrealised gain on today's cost and differs from the big ALL figure by the realised gains.
8. **Under ALL, CARDS shows one "Sold holdings" line under the grid** (D162 asks for the row in LIST and MOVERS; the line keeps the cards adding up too).
9. **Crypto's and bullion's closes before 1.3.0 are approximate:** coin closes older than 90 days use CoinGecko's 00:00 UTC point of the next day (≈ 10–11 hours after midnight Melbourne); bullion closes before 1.3.0 are the New York futures close ÷ the London `AUDUSD` close of the same date (≈ 07:00–09:00 Melbourne the next morning). From 1.3.0 on they are the exact midnight values (D142, D153).
10. **An ex-dividend price drop shows as a loss** in a period figure (dividends are not counted, D161; the price is not dividend-adjusted).
11. **The holding detail follows the selected period** (D169).
12. **The period line spaces its points evenly by date** (a weekend without crypto takes no width); a holding without price history adds its figure flat, as Stage 9's daily fund does.
13. **The ALL line shows today's holdings only, with no step on sale dates** (D167): the unrealised gain of the units held now, over time. It ends at their unrealised gain (`totals.unrealisedCents`, which matches the header's GAIN within a cent per holding), not at the ALL figure; a one-line caption under it names the realised part that is in the ALL figure but not drawn.
14. **The selected period is forgotten when Android ends the app's process** (D163: a cold start is 1D), not when you back out of the app.
15. **Version 1.3.0 with migration 0007** (the update takes the automatic pre-update backup); the phone app 1.1.0.
16. **Under 1W–12M and ALL the header's VAL and GAIN come from the periods answer** (the same price snapshot as the big figure and the cards); INVESTED still from Today.
17. **A detail opened from a widget shows the day (1D)**, whatever period is selected in the app, and the app's selected period is left as it was (D169).
18. **"Price history to dd/mm" appears under the chips** when the server's stored closes are more than six days old.
19. **The phone fetches the period figures only when a period other than 1D is selected** (or, on opening, when its saved copy is over 30 minutes old), since the answer is about 200 KB.

Decisions applied (not changes): D158 (the eight periods), D160 (the change in today's holdings), D161 (ALL = unrealised + realised, % of everything bought, no dividends), D162 (the Sold holdings row), D163 (the chip row; process memory; 1D on a cold start), D164 (daily-close lines; 1D intraday), D165 ("—" for the start units, in-period buys still counted, partial), D156 (widgets stay daily); from the plan review: D166 (item 5), D167 (item 13), D168 (item 7), D169 (items 11, 17), D170 (every other item of this list accepted).

---

## 16. Not in Stage 10
- **Widgets for periods** (D156: widgets stay daily) and any change to the worker.
- **A split model** (recording splits, adjusting units and trade prices).
- **Dividends in any period figure** (D161) and total-return views on the phone.
- **Period figures on the web** (the web keeps its holdings pages and monthly charts).
- **History screens, net worth, cash, super, property or FIRE on the phone**; any write from the phone.
- **Price history for hand-priced instruments** (the web keeps one price per instrument).
- **Exact midnight crypto and bullion values before 1.3.0** (CoinGecko's keyless API has no hourly data beyond 90 days).
- **The post-cutover data fixes** (D76, D73, D65), the JSON export (D121), HTTPS, an in-app updater (D145).

---

## 17. Questions for the owner (plan review)
**All five answered on 03/10/2026** (D166–D169); each answer is marked below and applied throughout (the Owner review revision at the end). §15 was accepted with no veto (D170). Questions 2 and 3 were answered against the default.

Only genuine choices; everything else has a decided default (vetoable, §15). Decided without asking: one answer for all seven periods; the 10-day start-close gap; purchase price without brokerage for units bought in a period; stale prices counted unless older than the start; splits shown as "—" only for units that straddle them; the daily 16:52 job; one price snapshot per screen; evenly spaced line points; the detail's period rows; version 1.3.0 and APK 1.1.0.

1. **How the card shows D165** (decided: the units held at the start have no figure and are left out; units bought within the period still count from their purchase price). For a holding with no start close that was also bought within the period (your hand-priced fund, if you buy more of it): (a) **the card shows the bought-in units' gain marked "PARTIAL"** (cards, LIST and MOVERS add up to the total); or (b) the card shows "—" while the total still counts the bought-in gain (the parts then do not add up). *Default: (a).* **Answered (a) (D166).**
2. **The ALL line.** D164 draws lines "from the daily closes of today's holdings", but D161's ALL figure also holds realised gains (sold units and sold instruments). (a) **Today's holdings' gain over time plus a step on each sale date** by the realised gain, so the line ends at the ALL figure; or (b) today's holdings only: the line ends at their unrealised gain, and the ALL figure sits above or below its last point by the realised total. *Default: (a).* **Answered (b) (D167): today's holdings only, no step on sale dates;** the line ends at `totals.unrealisedCents` and a caption names the realised part not drawn (§2.6, §9.4).
3. **The header row under ALL.** Today it reads VAL · INVESTED · GAIN (D155: GAIN is the unrealised gain on today's cost), while the big ALL figure is unrealised + realised. (a) **Under ALL it reads VAL · UNREALISED · REALISED** (the two add up to the big figure); (b) it stays VAL · INVESTED · GAIN under every period. *Default: (a).* **Answered (b) (D168): VAL · INVESTED · GAIN for every period, ALL included** (GAIN = value − invested, as today; §9.4).
4. **The holding detail under a period.** (a) **It follows the selected period:** the chart is the holding's line for that period and the day rows become the period's (start close, held at start, bought in the period; under ALL unrealised, realised and cost of everything bought); (b) it stays the 1D detail whatever the chip. *Default: (a).* **Answered (a) (D169).**
5. **A holding detail opened from a widget.** The widgets show the day's figures. (a) **The detail opens on the day (1D) view** and the app's selected period is left as it was; or (b) it opens on whatever period is selected in the app. *Default: (a).* **Answered (a) (D169).**

---

## Scaffold notes
_(implementers append here: date, owner, what and why)_

**2026-10-03, server-market, step 0: contract landed.** §2.8 `packages/engine/src/periodChange.ts` (`periodStartDate`, `computePeriods`, `PERIOD_ENGINE_VERSION`; exported beside `EngineApi`, `dayChange.ts` untouched) with P1–P19, P21–P23, A1–A11, C1–C5, the DST runs and `periodChangeFixtures.test.ts`; §3 tables, `0007_stage10_closes.sql` (drizzle-kit, journal entry 7, snapshot 0007; the three CREATE TABLEs only, header comment added), row schemas, seed reset (`series_closes`), dump/delete-order comments, constants, enums, `JOB_NAMES` + `'closes'`; §4.2 DTOs; §3.6 `mobilePeriods` + the four Android JSON copies; §5.9 readers (`apps/server/src/db/queries/closes.ts`, they also accept a transaction). Also added now: the 0007 shape/fresh/upgrade tests in `test/migrations.test.ts` and reader tests in `test/market/closes-readers.test.ts`. Contract notes (no frozen signature changed):
- `MobilePeriod`/`ServerPeriod` live in `enums.ts` as types over `mobile.ts`'s `MOBILE_PERIODS`/`SERVER_PERIODS` (a type-only import; the constants stay in `mobile.ts`). The engine re-exports `ServerPeriod`; its results are the DTO shapes (`PeriodFigureResult = MobilePeriodFigureDto`, `PeriodResult = MobilePeriodDto`). **Figures come in input order** (held instruments in `holdings` order, then bullion in `bullion` order, then `sold`): server-api orders them as the DTO's holdings (the fixtures are).
- Readings of §2 where the text was silent: (a) a rule-4 `no_start` figure with cents that is drawn (a close since its first in-period buy) carries its own `line` (base = the in-period buys' average price), as it is drawn in the portfolio line; §2.5's "non-ok: line null" is read as the figures without cents. (b) ALL line: an `ok` holding with no stored close dated in [its earliest remaining lot, localDate) is flat, not drawn (else its whole unrealised part appears as a jump at the last point). (c) 1W–12M `startUnits`/`newUnits`/`laterUnits` are given for every status; `newCostCents` for `ok` and rule-4 `no_start` only; non-`ok` ALL figures still carry `realisedCents` and `costEverCents` (`unrealisedCents` null). (d) Bullion ALL: P or value null → `unpriced`; a held row without a gain → `no_cost` when it has a price, `unpriced` when not. (e) The Sold figure: status `ok`, `unrealisedCents` 0, `realisedCents` = `cents`. (f) Line values are `priceString` (12 significant digits) except the last point, which is P exactly; `startClose`/`changePerUnit` are exact decimals. (g) A line's C(d) converts with the last FX close on or before that close's date at any age (B keeps the 10-day rule); the grid uses each drawn holding's in-window closes only.
- Fixtures: `open` mirrors `mobileToday.open` (keys, values, positions) plus `ASX:OLD` (id 17) and a sold gold row; closes stop at 10/09 (`closesThrough` 2030-09-10). **No fixture has a `no_cost` figure** (§3.6 lists none; the coverage test covers every other status): android builds its own NO COST case. The values were drawn with the privacy guard as an oracle (re-drawn on a hit; nothing printed); `pnpm guard:all` is clean.

**2026-10-03, deploy: §7 done (no frozen contract touched).** Version 1.3.0; `playwright.config.ts` `CLOSES_REFRESH=false`; smoke `EXPECTED_MIGRATIONS = 8`. Readings: (a) §7.2 asks for closes rows "for the seeded listed instruments", but the Stage 9 `mobile` probe seeds only a coin, so it now also seeds one **listed** holding through the API (`SEED_LISTED_INSTRUMENT`, `ASX:TLS` (swapped from the first choice at the owner's request, live review), made-up units and price; a real, widely held listing because the smoke hits live Yahoo; guard-clean); (b) the Yahoo history egress probe sends the server's browser-like User-Agent (Yahoo refuses bare clients) and must answer 200; (c) the coin part is a NOTE only when the newest finished `closes` run's `detail_json`/`error` mention a rate limit, 429 or cool-down, or `coingecko.skipped > 0` (only a boolean leaves the container); no coin rows otherwise is a FAIL; (d) the host script also checks the revoked key on `/periods` (401) beside `/today`. The closes poll runs ≤ 240 s from the restart, after the intraday poll.

**2026-10-03, server-api: periods API landed.** `mobile/inputs.ts` (`loadMobileInputs`; `/today` now `buildMobileTodayFrom(loadMobileInputs(o))`, its Stage 9 suites unedited and green), `bullion.ts` `periodBullionInputs`, `mobile/periods.ts`, `GET/HEAD /api/mobile/periods` (keyed, declared, read-only catch-all unchanged). No contract changed. Readings: (a) the holdings are built from `/today`'s own answer on the same inputs (keys, order, values, prices exactly `/today`'s), and the bullion P is that answer's metal price, p its `priceAsOf` as a server-zone date; (b) the closes window also reaches back to the earliest held bullion row's purchase date (else a metal's ALL line could never be drawn); (c) p of a fetched listing uses the stored day row's zone, else the provider symbol's suffix zone, else the server's; a coin and a hand price the server's zone; (d) `closesThrough` covers the held instruments with a yahoo/coingecko provider, their FX series, and `AUDUSD` + `XAx_AUD_OZ` per held metal (the spot the periods read, rather than the futures); (e) an instrument with splits but no closes is passed with an empty series so rule 2 still applies.

**2026-10-03, server-market, the closes job landed (§5, §10.2 items 1–8).** `market/closes/{targets,history,coins,derive,writes,run,schedule,index}.ts` (`writes.ts` added for the per-target IMMEDIATE writes), `providers/{yahoo,coingecko,fake,types}.ts`, `service.ts`, `config.ts` (`CLOSES_REFRESH`), `test/helpers.ts`, `test/config.test.ts`, seven new `test/market/closes-*.test.ts` + `closesHelpers.ts`. No frozen contract changed. Readings and choices where §5 was silent or would misbehave:
- **Series coverage:** a series' `coveredFrom` is its dependants' earliest needFrom (= its `needFrom` + 10), not `needFrom` itself: the extra 10 days are look-back slack, and a `needFrom` on a weekend or holiday would otherwise re-backfill the series on every restart (§12 #8 expects a top-up).
- **Once a day:** a backfill counts as tried only when it got an answer (ok or failed); a 429 or the deadline does not use up the day's try (else a first-run 429 left a target empty until tomorrow, and follow-ups were useless).
- **Currency:** the history client returns `meta.currency`, else the suffix's, else null; the run falls back to `prices.native_currency`; none at all → a failure (no row). A currency first seen in this run's answers gets its FX series in the same run (a second series pass).
- **No deadlock:** `prices` awaits an in-flight closes run first (then intraday); while it waits, the closes run pauses only for `intraday` (not `prices`, nor `dividends`, which waits for `prices`). The coin-slot guard applies only while the intraday slot timer is on (INTRADAY_REFRESH).
- **Coins:** a backfill's daily closes are computed from the earliest trade − 10 (not capped at 364), so the close of localDate − 365 (the 12M start) is stored; a backfill is complete once its daily answer arrived.
- **Timers:** the daily 16:52 timer wakes at most hourly (`INTRADAY_WAKE_MAX_MS`, as intraday); follow-ups are counted per server-local date of their fire time; a manual run that leaves work also arms a follow-up when the timers are on.
- **Fake:** the session's own date, once before today, closes at the fake price; a fund's session is its NAV day (`YahooHistoryRequest.daily`, read by the fake only); CoinGecko points after 00:00 today carry the base, the last point the price.
- **detail:** exactly §5.7's keys; a CoinGecko 429 shows as `coingecko.skipped > 0` with `left > 0` (no separate rate-limited count); `error` is set only for the deadline or a shutdown. Derived spot rows are rewritten only when new or changed.

**2026-10-03, android, phase A: §9.1–§9.7 landed (no frozen contract touched).** New: `model/PeriodModel.kt`, `ui/today/{PeriodChips,PeriodContent}.kt`. Changed: `net/{ApiClient,ApiError,Dto}.kt`, `store/{Repository,Stores}.kt` (`PeriodsCache`, `periods(force)`, `periodsData`), `App.kt` (`Graph.period`, `periodsCache`), `ui/{AppUi,MainViewModel}.kt`, `MainActivity.kt` (visibility, `selectPeriod`), `ui/today/{TodayScreen,TodayTables}.kt`, `ui/detail/DetailScreen.kt`, `ui/nav/JoinrApp.kt`, `ui/components/Icons.kt` (an info icon), `app/build.gradle.kts` (4 / 1.1.0). `widget/**`, `work/**` and every Stage 9 test file untouched. Readings: (a) **chip touch targets:** `minimumInteractiveComponentSize` would make each chip's layout 48 dp wide and push ALL off a 411 dp screen (against §9.4's measurement), so the 48 dp target comes from Compose's hit-test expansion (`minimumTouchTargetSize`) on the 40 × 30 dp chip; a test taps 5 dp above a chip; (b) `Repository.periods` is single-flight by sharing the in-flight result (a plain mutex would queue a second request); it has its own lock and takes the Today lock only to clear on a revoke; an answer fetched for a pairing replaced mid-fetch is dropped; (c) on open, a non-1D chip fetches only when no answer is cached (the Today refresh's VM trigger does the rest, so an open costs one request, not two); (d) `Since dd/mm/yyyy` is set in Arimo, not mono (mono pushed ALL's block into the stacked layout at 360 dp × 1.3); the figure block's fallback lays %, `Since` and the counts in one row under the figure; the header row's GAIN drops under VAL · INVESTED only when the three cannot share the width (seven-digit figures at 360 dp × 1.3); both keep the Stage 9 layout whenever it fits; (e) the ALL caption may ellipsise at a large font (§9.4 allows it), so the period layout checks skip that one node; (f) under a period, a periods error other than 404 shows "The period figures could not be updated." with Retry (and the cached answer's age) when Today itself is fine; (g) the Sold rows are `mergeDescendants` nodes with their own description and no click. A throwaway-signed 1.1.0 APK is under `artifacts/stage10/android/` (moved out of `dist/`).

**2026-10-03, android, phase B: the emulator smoke (§9.8; no frozen contract touched).** The private AVD (`emulator-5554` only) against a prod bundle on **3624** (`artifacts/stage10/android/prod`, fake data, `CLOSES_REFRESH=true`, `INTRADAY_REFRESH=true`; the seed + `NYSE:EXUS` (USD) and `0PEXAMPLE1` added through the API, a fund buy and an ABC buy dated within the last week, the seed's `ASX:OLD` sale given a gain and a partial XYZ sale inside 6M so the Sold figure and the ALL caption's realised part are non-zero). The start-up `closes` run succeeded (9 backfills, every listed instrument, both coins, `AUDUSD`, the silver futures and the derived spot). Passed: deep-link pairing; all eight chips visible at 411 dp; every period on CARDS/LIST/MOVERS; the partial note (the hand-priced fund, `NO HISTORY`); `BOUGHT IN 1W`; the header row `VAL · INVESTED · GAIN` under every period; ALL = GAIN + the realised part, with the caption and the SOLD row/line; the detail under 1W (drag readout `dd/mm/yyyy · $x.xx`) and ALL (no position `Unrealised gain` row); a widget tap opens a 1D detail and leaves 1W held; back-out and reopen keeps the period (same process); force-stop → 1D; server stopped → the cached periods dimmed with "Figures from …"; the widgets daily and unchanged; logcat with no crash and 0 × `jfk_`/`Bearer `/`X-Joinr-Key`/`pair?v=`; 7 `/periods` requests in the server log. The release APK (throwaway key) installs and launches, then was uninstalled. Screencaps: `artifacts/screenshots/stage10/android/`. **Fixed:** a figure that rounds to `$0` (a coin up 40 cents) showed a grey `▲ 0.97 (0.85%)` change line and a grey sparkline on its card, unlike the 1D card (Stage 9 tints those by `dayTone`, the raw sign). New `periodMarkTone` (`PeriodModel.kt`, the raw sign) for the card's change line and sparkline and the detail's period chart; the dollar figures keep `periodTone` (no colour without a shown sign); a `PeriodModelTest` case. **Fake-data artefacts, not the app:** the seed's costs are far below the fake prices, so ALL percentages are in the thousands and the ALL line steps up on buy dates; coins held longer than 365 days are flat in ALL (no card sparkline), as §2.6 says.

**2026-10-03, Fixer: the review findings (no frozen contract changed).** Android: (U1) `PeriodChips` no longer uses a `BringIntoViewRequester` (asked at the first layout it did nothing, so a held ALL stayed cut off at 360 dp × 1.3 when Today was composed afresh); it waits until the row is measured and the content and every chip have been placed once, then scrolls the least amount that shows the selected chip with its 16 dp edge (`chipScrollTarget`): at once on the first composition, animated after a tap. The layout check now compares the chips' **unclipped** bounds. (U2, U4) `periodChangeLine` binds its groups with no-break spaces (`BOUGHT IN 1W`, the arrowed %, `ALL TIME`, `· PARTIAL`) and joins them with ordinary spaces, so a narrow card wraps between groups only; the card's change line allows 3 lines (ellipsis as a last resort; the card grows); the §9.4 texts read the same. (U3) CARDS' Sold line sets its words in Arimo with the money and the count in mono spans (STYLE_GUIDE §2) and may take a second line; `soldLineText` is unchanged. (Q3) `Repository.fetchPeriods` commits under the Today lock (the pairing re-check, the cache write and the state update; the ServerTooOld and error branches too); the fetch itself stays off it, so an unpair or a re-pairing can no longer be overwritten by the old pairing's answer. Deploy: (Q1) `smoke mobile` reads the newest `closes` run id before the restart (`CLOSES_BASE_JS`, read-only) and its counts (`closesCountsJs(afterId)`) consider only the runs after it; the poll ends when such a run has finished (not on listed rows), so an earlier run never answers for the start-up run and a re-run can turn the coin NOTE into a PASS. (Q2) The coin NOTE now comes only from the run's structured counts, `coingecko.skipped > 0` with no `failed` (the run stores no error text for a 429; the old text match could only misfire on a count containing 429): this replaces reading (c) of the deploy note.

## Stage close notes (2026-10-04)
**Released (D171); the demo on the owner's phone was not yet reported.** Joinr Finance **1.3.0** is live on the Umbrel (migration 0007, a verified pre-migrate backup taken by the update); the owner's phone runs the signed **APK 1.1.0** (versionCode 4; the Stage 9 certificate).

- **Kickoff and plan review:** D160–D165 at kickoff; a planning workflow (code scout, data-source probe scout, planner, three plan reviewers with 31 findings, revision); the owner's plan-review answers D166–D170 (two changed from the proposals: the ALL line shows today's holdings only, D167; the header row stays VAL · INVESTED · GAIN under ALL, D168), applied in the Owner review revision.
- **Build:** server-market step 0 (the contract), then server-market (the `closes` job), server-api (`GET /api/mobile/periods`), deploy and android in parallel, then the android emulator smoke (one fix: a period figure that rounds to $0 keeps its sign colour).
- **Review:** three reviewers (spec: none; style-ux: 4; code-quality: 3), per-reviewer triage (7 verified, 0 rejected), the Fixer (all 7 fixed with tests), the Verifier: 14 of 15 §12 items PASS; item 12 (the store clone) was blocked by a permission and checked by the coordinator (only `umbrel-app.yml` changed, compose untouched, nothing committed). Totals: 7252 tests passed (4 platform skips), e2e 668 passed with 17 flaky web specs passing on retry, Android 212.
- **Live (§11):** the smoke listing became `ASX:TLS` at the owner's request; rc smoke `check` 13/13 and `mobile` 26/26; release 1.3.0 and store commit `a711611`; the owner's Update; the proxy probes of `/api/mobile/periods` without a session (401, 405; `..`, `..;` and `%2f` forms 404/405; no data); APK 1.1.0 installed over 1.0.2 with `--user 0`. Records in `docs/private/stage-10-private.md`.
- **Not done live:** the demo checklist (§11 steps 11–14), the APK 1.0.2 compatibility check after the update (the phone was upgraded straight away; `/today` is byte-identical by test), and the read-only count of the first `closes` run.
- **Accepted limits:** coins held longer than 365 days are flat under ALL (CoinGecko's keyless reach); crypto and bullion closes before 1.3.0 are approximate (§15 item 9); a split inside a period shows "—"; ex-dividend drops show as losses.

## Plan review log

_Planner revision, 2026-10-03: 31 review findings (4 major, 27 minor; lenses correctness, server-ops, android-ux), each checked against the code at `d9ae564` (`market/intraday/{schedule,service}.ts`, `market/{service,refresh}.ts`, `market/providers/{http,yahoo,exchangeTime}.ts`, `scheduler/index.ts`, `engine/src/types.ts`, `test/golden/investments.golden.test.ts`, `tools/deploy/smoke.mjs`, Android `MainViewModel.kt`, `store/Repository.kt`, `ui/today/TodayScreen.kt`, `net/{ApiClient,ApiError}.kt`, `ui/AppUi.kt`, the tests' `FakeApi` and `TestHost`) and the probe report (`meta.firstTradeDate` present for every class; CoinGecko's daily points at 00:00Z). All accepted: three with corrections (C1, with owner question 1 reworded; C5; S10's threshold), two in part (S1, A6's first remedy), two merged (S7 into C9, A10 into A1). Nothing rejected outright; the rejected part is S1's "intraday skips its Yahoo scopes while closes runs" (it would cost Stage 9 1D slots; the off-grid time and the per-request pause bound the overlap to one request). The worked examples P10, P13, P14, P19, A2, A9 and A10 were recomputed and P21–P23 added. One finding (A8's widget-tap part) became owner question 5; owner question 1 now confirms how D165 is shown rather than re-opening it._

| # | Sev. | Finding (short) | Disposition |
|---|---|---|---|
| C1 | major | The plan leaves a no-start holding's in-period buys out, against D165, and re-asks it as question 1 | **Accepted with a correction.** D165 (DECISIONS) verified. §2.2 rule 4: start units "—", within lots counted (`cents`, `newCostCents`, `ratio` on that cost), counted in `missing`; §2.4 totals and §2.5 line include that part; recomputed P10 (**1000**, base 20000, ratio 0.05; buy moved to Mon 09-09), P13 (**8000**, base **570000**, ratio **0.0140350877193**, up 2, missing 1, holdings 3), P14 (every point + 1000: 1000, 3000, −500, 3000, 5500, 8000); §9.4 cards/LIST/MOVERS; §15 item 5; Q1 reworded to the card's presentation (default: the bought-in part marked PARTIAL, so parts add up). |
| C2 | minor | A9/A2/A10 put ASX closes and trades on weekends | **Accepted.** Weekdays verified (02-02 Sat, 02-03 Sun, 01-05 Sat, 06-01 Sat). A9: lot Mon 02-04, closes 02-04/02-05, localDate Wed 02-06 (5000 / 11000 / 17000); A2: 01-07 and 06-03; A10: F 02-04, step at 06-03. |
| C3 | minor | The fixture-consistency rule cannot be checked from the DTO; "§4.3 fields" is wrong | **Accepted.** `laterUnits` and `newCostCents` added to `MobilePeriodFigureDto`; the rule restated within a cent (§3.6); §2.8 now points at §4.2. |
| C4 | minor | The split rule refuses figures it could compute and keys on S, not b | **Accepted.** §2.2 rule 2: `(b, localDate]` with start units (b = S when none found), or `(tradeDate, localDate]` of a within lot; the ALL line's split window aligned; P21 (2000; a straddling lot → `split`). |
| C5 | minor | A hand or stale price older than the start close spans backwards | **Accepted with a correction.** Verified `manualPriceAsOf` exists and `HoldingResult` carries no as-of. `priceDates` / `priceDate` added to the engine input (§2.1, §2.8, §6.4); rule 3: `p` earlier than b (S when no start close) → `no_start` with no figure at all (the within lots too, since P predates them); P17 dated, P22 added; §15 item 4. |
| C6 | minor | A within bullion row with unknown cost and no start rows has no defined status | **Accepted.** Such a row is a start lot (§2.1), so rule 4 applies; P19 startUnits 11 (cents 7000 unchanged); P23 (no B: 1500 from the dated rows). |
| C7 | minor | The FX window is 10 days short at the earliest start | **Accepted.** Loader window for `AUDUSD`/`FX_<CCY>AUD` − 10 days (§6.4); series `needFrom` − 10 days (§5.1); a targets test. |
| C8 | minor | The golden's "realised part of the ALL total" fails when a held holding is unpriced | **Accepted.** Verified the existing golden's unpriced and no-prices rules. Σ `realisedCents` of every `HoldingResult`; unrealised only for held, priced holdings with those skip rules (header, §12 #4). |
| C9 | minor | Daily CoinGecko points are taken 13–14 h early, and the 12M start is unreachable on day one | **Accepted; S7 merged.** Daily points: the nearest point within ± 14 h of 00:00 Melbourne D + 1 (`CLOSES_COIN_DAILY_WINDOW_MS`), i.e. the 00:00Z point of D + 1 (§5.3), so the first `days=365` point is the close of L − 365; the residual 29 February case in §14 and §12 #8; §15 item 9 (≈ 10–11 h late). |
| S1 | major | The 16:45 run lands on an intraday crypto slot; the one-time wait does not protect it | **Accepted in part.** Verified `scopesForSlot` (crypto on every quarter), the 20 s offset, and that only `prices` awaits intraday. `CLOSES_RUN_AT` 16:52, follow-ups snapped to xx:07/22/37/52, a pause before every request, the 45-s CoinGecko slot guard, `prices` awaits an in-flight closes run, the "never exceeds 2" claim removed, the tests (§3.5, §5.7, §5.10, §14). **Rejected:** intraday skipping its Yahoo scopes while closes runs (it would drop Stage 9 1D slots; the remaining overlap is one in-flight request). |
| S2 | minor | The Stage 9 identity check does not cover a price-source change mid-run | **Accepted.** Verified `refresh.ts` compares kind and symbol only. The transaction re-reads the effective source and compares provider and provider symbol (§5.6); a mid-run `setPriceSource` test (§5.10). |
| S3 | minor | `getJson` discards non-2xx bodies, so the 10012 sniff cannot be built | **Accepted, option (b).** Verified `http.ts`. A 401 is `beyond_reach` only when `days` > 365, else `failed`; `getJson` unchanged; tests (§5.3, §5.10). |
| S4 | minor | The backfill rule re-downloads young listings every day; no path for "no rows, tried today" | **Accepted.** Verified `firstTradeDate` in the probe report. `coveredFrom` = max(earliest trade, `firstTradeDate`); a successful backfill is complete; no rows + tried today → skip (§5.1, §5.2); tests match the rule (§5.10). |
| S5 | minor | The history client returns no currency for the NOT NULL column | **Accepted.** Verified `parseYahooCloses` never reads `meta.currency`. `currency` (meta, else `currencyFromSymbol`, else `native_currency`) added (§5.2); parse tests (§5.10). |
| S6 | minor | Conditional registration contradicts "a manual run works"; no route triggers a run | **Accepted.** Verified the intraday pattern and `Unknown job`. Always registered in live/fake, timers only with the flag (§5.7); §12 #8 uses a restart; the RUNBOOK says a restart re-runs the job (§7.4). |
| S7 | minor | A coin held over a year is `no_start` for 12M on install day | **Merged into C9** (fixed by the daily-point rule except across a 29 February; §14 and §12 #8 corrected). |
| S8 | minor | The fake history formula goes ≤ 0 over long windows | **Accepted.** Multiplicative drift `prev × 0.9996^n × (1 + w)`, `w` = 0 at n = 0 (§5.4); a 15-year > 0 test (§5.10). |
| S9 | minor | The smoke's coin-closes check fails on a CoinGecko 429 from the shared IP | **Accepted.** Verified `report()` is PASS/FAIL only. Listed instruments stay PASS/FAIL; the coin part a non-fatal `NOTE` when `detail_json` shows rate-limited or skipped, read through `DB_COUNTS_JS` (§7.2). |
| S10 | minor | Nothing reports the closes job; `closesThrough` masks one failing series | **Accepted with a correction.** `closesThrough` = the oldest per-series newest close (§4.2, §5.9); the app's "Price history to dd/mm" note at **more than 6 days** (not 4: the Easter and Christmas closures reach 5) (`CLOSES_STALE_NOTE_DAYS`, §9.4, §9.6); a RUNBOOK entry (§7.4); §14 row; §15 item 18. |
| S11 | minor | The "not app data" check cannot fail on a seeded database | **Accepted.** Verified `domain.ts` iterates instruments. Delete the domain data and instruments, then assert both flags false; `DUMPED_TABLES` checked (§12 #13). |
| A1 | major | No hook for "after an app refresh"; the screen mixes two snapshots | **Accepted.** Verified `runOnce` (KEEP) returns before the fetch and the VM copies every `repository.data` change. The VM trigger on `fetchedAtMs` moving forward while visible under a non-1D chip (§9.2); VAL and GAIN from the periods answer, the age note and spinner follow it (§9.4); tests (§9.7); §15 item 16. |
| A2 | major | ALL starts off-screen at 411 dp; a LazyRow breaks the tests and "2 of 8" | **Accepted.** A scrolling `Row` with `selectableGroup`, 8 dp chip padding and 4 dp gaps (≈ 384 dp, fits 411 dp × 1.0); the measurements and tests (§9.4, §9.7). |
| A3 | major | A six- or seven-digit figure wraps; the layout helper cannot see wrapping | **Accepted.** Verified the figure `Text` has no `maxLines` and `noClippedText` checks no line count. One line, the `InlineOrUnder` fallback, `lineCount == 1` assertions (§9.4, §9.7). |
| A4 | major | Under ALL with only sold holdings the Stage 9 empty branch hides the Sold figure | **Accepted.** Verified the `today.holdings.isEmpty()` branch. Empty branches by period, "Nothing is held now." for 1W–12M, tests (§9.4, §9.6, §9.7). |
| A5 | minor | Re-pairing leaves the old server's periods cached | **Accepted.** Verified `pair()` clears only `TodayCache`. `pair()` clears `PeriodsCache`; entries keyed by origin and device id; ServerTooOld drops it; a store test (§9.3, §9.7). |
| A6 | minor | `ServerTooOld`'s own sentence says "1.2.0" and could reach Today's notices | **Accepted, second remedy.** `periodsError` kept apart from the shared error, its sentence never shown (no new sealed subclass, so no Stage 9 `when` changes); tests (§9.2, §9.3, §9.7). |
| A7 | minor | The SOLD row's tap and TalkBack text are unspecified | **Accepted.** Not clickable, its own merged description, a no-`OnClick` test (§9.4, §9.7). |
| A8 | minor | The detail under a period keeps 1D tone, texts, labels and readout; a widget tap opens in the held period | **Accepted; the widget-tap part is owner question 5.** Tone by the period figure, the no-line text, date labels, the AUD readout, the position "Unrealised gain" row dropped under ALL; default: a widget tap opens 1D without changing the held period (§9.5, §15 item 17). |
| A9 | minor | New abstract members force edits to Stage 9 test fakes | **Accepted.** Default bodies and default constructor parameters; the new store tests in a new file (§9.1, §9.7). |
| A10 | minor | The answer is ≈ 200 KB, not 50–150 KB, and is fetched on every open | **Accepted, option (a); merged with A1.** The estimate corrected (§4.1, §14); fetched only for a non-1D chip or a stale cache on open (§9.3); a server size-budget test (`PERIODS_ANSWER_BUDGET_BYTES`, §6.6); §15 item 19. |
| A11 | minor | The middle label would come from time while points are spaced by index | **Accepted.** Verified the time-midpoint label code. Index `times`, `from`/`to` null, the middle label from `points[size / 2]`; an uneven-grid test (§9.4, §9.7). |

### Owner review revision (2026-10-03)

_Planner revision after the owner answered §17 (D166–D169) and accepted §15 (D170). Questions 1, 4 and 5 were answered as proposed (marked only); questions 2 and 3 were answered against the default and change the plan as below. Nothing written to the repo but this plan (and the private companion), nothing to the Umbrel; PLAN.md is corrected by the coordinator at the close._

| # | Answer / finding | Change |
|---|---|---|
| R1 | D166: the bought-in part of a no-start holding shows on its card marked PARTIAL (Q1, as proposed) | Marked answered (§17); §9.4 and §15 item 5 cite D166 (cards, LIST and MOVERS add up to the total); §3.6 `open` names it. No rule changed. |
| R2 | D167: the ALL line shows today's holdings only, no step on sale dates (Q2, **changed**) | §2.6 rewritten: the line is the unrealised gain of today's remaining lots over time; drawn holdings as before, flat holdings contribute their unrealised part (not their `cents`); no disposal, sale or Sold-holdings term; `F` and the grid from the drawn holdings' lots and closes only; **the last point is exactly `totals.unrealisedCents`**, and the ALL figure sits `totals.realisedCents` away from it; null when nothing is drawn. §2.4 says so. Examples: A9 unchanged (5000, 11000, 17000); **A10 recomputed** (points 5000, 11000, 17000; no point at OLD's 2030-06-03 sale; last 17000 = unrealised; total 65000 = 17000 + 48000); **A11 added** (A5's line ends at 58167, 108333 below 166500); A1–A10 → A1–A11 in §1.2, §10.2, §12 #3. |
| R3 | D167: what the app labels | §9.4: one caption under the ALL line, `Line: today's holdings, unrealised · realised +$N not drawn` (just the first half when `totals.realisedCents` is 0), no step, marker or second line; the ALL spoken summary; `soldOnly` under ALL shows "Nothing is held now." in the chart area (§9.4 states, §9.6, §9.7). |
| R4 | D167: step data in the contract | §2.8: `disposals` removed from `PeriodChangeInput` (only the steps used them; the ALL figure takes `realisedCents` from `HoldingResult`), and the lines' last points stated; §6.4 step 1 no longer loads `DisposalResult`s. §4.2: `MobilePeriodLineDto`'s last point is `totals.cents` (1W–12M) or `totals.unrealisedCents` (ALL); no DTO field carried steps, so none is removed. §3.6: `open` gains a held holding with a realised part (DEF, sold before the 12M start) and its ALL line ends at `totals.unrealisedCents`; `noHistory`'s and `soldOnly`'s ALL lines are null; the consistency test checks the ALL last point and that no ALL point is dated on a sale date without a drawn close. §12 #6 and #11, §15 item 13, §11 step 12 rewritten. |
| R5 | D168: the header row stays VAL · INVESTED · GAIN for every period, ALL included (Q3, **changed**) | §9.4: the `VAL · UNREALISED · REALISED` row removed; under any non-1D chip VAL from the periods answer, GAIN = VAL − INVESTED, the D155 "—" rules unchanged; under ALL GAIN is not the big figure but matches the ALL line's end within a cent per holding. §9.7 tests (header row under every period, no `UNREALISED`/`REALISED` node, a seven-digit negative GAIN on one line); §11 step 12's "adds up" check replaced (the row reads VAL · INVESTED · GAIN; the line has no step on the sold ETF's sale and ends at GAIN; caption = big figure − line end); §12 #11; §14's "two gain figures" row; §15 items 7 and 16. **Fields kept:** `totals.unrealisedCents`/`realisedCents` (now the ALL line's end and the caption's figure) and the figure-level `unrealisedCents`/`realisedCents`/`costEverCents` (the detail's ALL rows, §9.5). |
| R6 | D169: the detail follows the period; a widget-opened detail shows 1D (Q4, Q5, as proposed) | Marked answered (§17); §9.5 and §15 items 11 and 17 cite D169. No rule changed. |
| R7 | D170: §15 accepted, no veto | §15's "Decisions applied" line lists D166–D170. |
| R8 | Consistency pass (UNREALISED, REALISED, step, sale date, owner question) | §1.1 item 2 (ALL's line), the header's input line (D166–D170); the private companion's §2 (no step on the sold ETF's sale) and §4 (the ALL demo check). The Plan review log above keeps its historical wording. |
