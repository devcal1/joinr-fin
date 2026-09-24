# Stage 1 — Data model, importer & market data: build plan

_Planner output, 2026-09-24. Inputs: PLAN.md (Architecture, Stage 1), docs/HANDOFF.md, docs/DECISIONS.md (D10, D11, D14, D17–D29), docs/stages/stage-0.md, the four functional specs, the per-sheet dumps and the workbook itself (read with SheetJS 0.20.3 in a scratch install)._

> **This repo is PUBLIC.** Nothing from `reference/` (except `reference/brand/`) or `docs/private/` may be copied into any other file: no amounts, no tickers, coins or funds the owner holds, no account, bank, fund or business names, addresses, IPs, emails, Drive ids. Code, tests, seeds, fixtures and committed docs use only generic values: `ASX:ABC`, `ASX:XYZ`, `EXAMPLEFUND`, "Example Bank – Everyday", "Example Super", round numbers. **BTC and ETH are the only crypto examples allowed.** The owner-specific facts for this stage are in **`docs/private/stage-1-private.md`** (git-ignored); the importer implementer and the spec reviewer read it, nobody copies from it.
>
> **The guard also blocks any committed path with a folder segment named `data`** (e.g. `apps/web/src/pages/data/`). Use `records`, `browse`, `import`, `prices`.

**Flow:** Coordinator pre-step (guard terms, §7.0) → Scaffolder (alone; must pass its done-check) → 4 Implementers in parallel (**importer**, **market-data**, **server-api**, **web phase A**) → **Integration: web phase B** (starts only when importer, market-data and server-api have reported done; §7.6) → Reviewers in parallel (**spec-correctness**, **style-ux**, **code-quality/security**) → Fixer → Verifier. **Nobody commits or pushes.** The coordinator commits at stage close with the owner's OK (D10).

**Golden values:** read at runtime from the local workbook (§9); none are committed. **Template bug fixes applied in Stage 1:** §11 (vetoable).

---

## 1. Overview & flow

### 1.1 What Stage 1 delivers
1. `@joinr/schema`: the Drizzle schema (§2) for everything the workbook import writes plus the price cache and job log, hand-written Zod row/DTO schemas, the settings registry, the record-browser registry, pricing helpers, decimal/date helpers, shared test helpers and typed DTO fixtures for UI tests. Migration `0001` (append-only; `0000` untouched). **Not complete for Stages 2–6:** later stages add tables/columns under the §2.1 evolution rule. Known additions: a per-period one-off inflow adjustment (Stage 3), property valuation history, per-fund super balance history with reported gain, and an offset-account → loan link (Stage 4).
2. `@joinr/importer`: reads the workbook bytes (SheetJS), extracts every in-scope tab, applies owner corrections (D27), excludes feed rows (D22/D23), flags suspect rows (D26), re-keys dividends (D28), replaces the imported data in **one transaction**, and produces a **reconciliation report** with zero unexplained differences on the owner's workbook. Callable from a **CLI** (`pnpm import:workbook`) and from an **upload endpoint**; both call the same `importWorkbook()`.
3. Price service (server): Yahoo chart + CoinGecko providers, FX and bullion series (D23/D25), a price cache with fresh/stale/failed status, manual overrides, a scheduled refresh on a small reusable scheduler, and routes.
4. Server API: record browser, import runs + report, status; wiring.
5. Web: a **Records** nav group with a generic read-only data browser, the import page with the report viewer, and the prices page. Phone width (375 px) works.

### 1.2 Workspace changes (no new packages)
```
packages/schema/     @joinr/schema    tables (src/db/**), Zod + DTOs + registries (src/**), testing helpers (src/testing/**),
                                      typed DTO fixtures for UI tests (src/fixtures/**)
packages/importer/   @joinr/importer  reader, extractors, corrections, reconciliation, writer; testing/ (synthetic + local workbook)
apps/server/         @joinr/server    + src/market/**, src/scheduler/**, src/routes/{records,import,status,prices}.ts, src/cli/import.ts
apps/web/            @joinr/web       + src/api/**, src/pages/{records,import,prices}/**
reference/import-corrections.json     (git-ignored; owner corrections, D27)
```

### 1.3 Dependencies (checked 2026-09-24 with `pnpm view` and a scratch pnpm 11.23 workspace)

| Package | Spec | Where | Notes |
|---|---|---|---|
| xlsx (SheetJS) | `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` | importer deps | **Decision:** depend on the maintained tarball, not npm `xlsx` (stale 0.18.5 with advisories). Verified in a scratch pnpm 11.23 workspace: installs, lockfile records `resolution: {integrity: sha512-…, tarball: …}`, **no** `allowBuilds` prompt, **no** `minimumReleaseAge` exclusion needed. Stage 7's Docker build (`pnpm fetch`) downloads it from cdn.sheetjs.com, like the registry packages. Fallback in §12. Not listed in `apps/server` deps: esbuild **bundles** it into `dist/server.js` (the Verifier proves the prod bundle imports a workbook). |
| drizzle-orm | `^0.45.3` | schema, importer (already in server) | |
| zod | `^4.6.5` | schema, importer (already in server) | |
| decimal.js | `^10.6.0` | schema, importer, server (already in ui) | |
| better-sqlite3 + @types/better-sqlite3 | `^13.0.3` / `^9.6.0` | schema **dev**, importer **dev** (server already has them) | test DBs only; `allowBuilds: better-sqlite3: false` stays |
| @joinr/schema | `workspace:*` | importer, server, web | web imports **types and plain constants only** from the root export (never `@joinr/schema/db`) |
| @joinr/importer | `workspace:*` | server | |

**Not added:** `@fastify/multipart` (10.1.2 available) — the upload is a raw `application/octet-stream` body with a route-scoped content-type parser (fewer deps). No drizzle-zod (zod 4 compatibility unverified; Zod schemas are hand-written with a type-level parity test).

**pnpm 11 rules (unchanged from Stage 0):** keep `allowBuilds: { better-sqlite3: false, esbuild: true }`; keep any `minimumReleaseAgeExclude` lines pnpm writes; never run `pnpm approve-builds`; **only the Scaffolder installs**. Implementers never edit a package.json dependency list or the lockfile — stop and report.

### 1.4 Scripts
Root `package.json` (Scaffolder adds; cmd.exe-safe):
```json
"import:workbook": "tsx apps/server/src/cli/import.ts",
"seed:dev": "tsx apps/server/scripts/seed-dev.ts",
"db:generate": "pnpm --filter @joinr/server db:generate"
```
- **Never name a root script `import`:** `pnpm import` is a pnpm built-in (it generates `pnpm-lock.yaml` from an npm/yarn lockfile) and never runs a script of that name.
- `pnpm import:workbook [file.xlsx] [--dry-run] [--yes] [--corrections <file> | --no-corrections] [--json]` (§4.10). Root cwd, so relative paths resolve against the repo root.
- `pnpm seed:dev` replaces the domain data in `DATA_DIR` with the generic seed (§7.2), for UI work without the importer. When `DATA_DIR` already holds domain data or a real import run it exits 3 asking for `--yes`; with `--yes` it takes a pre-import backup first.
- Existing scripts unchanged. Vitest project names unchanged (`web`, `server`, `ui`, `engine`, `schema`, `importer`, `privacy-guard`).

---

## 2. Data model (`@joinr/schema`)

### 2.1 Conventions (all tables)
| Concern | Rule |
|---|---|
| Keys | `id integer primary key` **without** AUTOINCREMENT (Drizzle `integer('id').primaryKey()`). After a delete-all, SQLite restarts ids at 1, which makes re-imports byte-identical (§4.8). |
| Money | `*_cents integer` (signed where the sheet is signed). JSON DTOs carry integer cents. |
| Quantities, prices, ratios | `text` decimal strings, normalised: no exponent, `.` separator, leading `-` for negatives, no trailing zeros (`"0.00012345"`, `"12.3456789012"`, `"0.056"`). Arithmetic with decimal.js only. Percentages are stored as **ratios** (`0.056` = 5.6 %). |
| Dates | `text` `YYYY-MM-DD` (`IsoDate`); months `YYYY-MM` (`IsoMonth`); timestamps `text` ISO-8601 UTC with `Z`. Display `dd/mm/yyyy` (STYLE_GUIDE §8). FY = 1 July – 30 June (use `financialYearOf` from `@joinr/ui` in the web; `financialYearOfIso` from schema on the server). |
| Booleans | `integer({ mode: 'boolean' })`. |
| Enums | `text({ enum: [...] })` for typing; **no SQL CHECK constraints** (SQLite cannot alter them and Stages 2–6 extend the lists). Every write boundary (importer, API) validates with the Zod schemas. |
| Provenance | `origin text not null default 'app'` (`'import' \| 'app'`); `sheet_ref text` = `"<Tab>!<A1 of the row's key cell>"`, e.g. `"ETFs!A31"`, `"Property!D15"` (null for app rows). |
| Review flags | `review_flags text` = JSON array of `ReviewFlag` codes, null when none (§4.6). |
| JSON columns | `text` holding JSON (`*_json`). |
| FKs | Declared with `references()`; `PRAGMA foreign_keys=ON` (Stage 0 connection pragma). Deletion behaviour given per FK. |
| Evolution | Stages 2–6 only **add** tables or nullable/defaulted columns via new migrations. Never edit `0000`/`0001`. |

### 2.2 Package layout (Scaffolder writes all of it)
```
packages/schema/src/
  index.ts        root export: enums, primitives, decimal, dates, pricing, settings, records, rows (Zod), dto/*, errors
                  (must NOT import drizzle-orm — the web imports this entry)
  enums.ts        every enum tuple below (as const) + types
  primitives.ts   IsoDateSchema, IsoMonthSchema, IsoTimestampSchema, DecimalStringSchema, PositiveDecimalSchema(maxDp), CentsSchema
  decimal.ts      normaliseDecimal, decimalFromNumber (12 significant digits), centsFromNumber, centsFromDecimal, sumDecimals,
                  compareDecimals, isPositiveDecimal, multiplyToCents(units, price)
  dates.ts        excelSerialToIsoDate, isoMonthOf, addMonthsIso (EDATE semantics: clamp day), compareIso, financialYearOfIso,
                  previousWeekdayStart (for freshness; see §5.6)
  pricing.ts      derivePriceSource, YAHOO_EXCHANGE_SUFFIXES, COINGECKO_KNOWN_IDS, BULLION_FEEDS, MARKET_SERIES
  settings.ts     SETTINGS registry, SheetOptions ID map, NOT_IMPORTED map
  records.ts      RECORD_ENTITIES registry (ids, labels, groups, column metadata)
  rows.ts         Zod insert schemas new<Entity>Schema for every table (+ compile-time parity with Drizzle $inferInsert)
  corrections.ts  CorrectionsFileSchema (§4.5), CorrectionsSetting, correctionsSettingFromEnv (§3.4 step 4)
  limits.ts       UPLOAD_LIMIT_BYTES = 25 * 1024 * 1024 (26,214,400 bytes; the only definition of the upload limit)
  dto/records.ts, dto/import.ts, dto/report.ts, dto/prices.ts, dto/status.ts, dto/errors.ts
  db/index.ts     export * from './tables/*'; JoinrDb type; DOMAIN_TABLES_DELETE_ORDER
  db/tables/*.ts  Drizzle tables (import only drizzle-orm and ../../enums — drizzle-kit loads these files)
  testing/        testDb.ts (createTestDb), seed.ts (seedGenericData), dump.ts (dumpDomainTables)
  fixtures/       sampleDtos.ts: typed, generic DTO objects for UI tests (no drizzle, no sqlite, no node imports):
                  RecordsIndexResponse; one RecordsPageResponse per RECORD_ENTITY_IDS entry; ImportRunsResponse
                  (empty and populated); ImportRunDetail succeeded (checks of every CheckStatus and unit), dry run,
                  failed, running; PricesResponse (one item per PriceStatus, series, each MarketDataMode);
                  RefreshResponse; AppStatus (empty and populated)
package.json exports: ".": "./src/index.ts", "./db": "./src/db/index.ts", "./testing": "./src/testing/index.ts",
  "./fixtures": "./src/fixtures/index.ts"; "sideEffects": false
```
`export type JoinrDb = BetterSQLite3Database<typeof tables>` (from `drizzle-orm/better-sqlite3`). `apps/server/src/db/schema.ts` becomes `export * from '@joinr/schema/db';` and the server's `Db` type aliases `JoinrDb`.

### 2.3 Enums (`enums.ts`, frozen; each as `const X = [...] as const` + `type`)
```ts
INSTRUMENT_KINDS    = ['stock', 'etf', 'managed_fund', 'crypto']
ORIGINS             = ['import', 'app']
PRICE_PROVIDERS     = ['yahoo', 'coingecko', 'none']
SYMBOL_ORIGINS      = ['derived', 'search', 'user']
MANUAL_ORIGINS      = ['import', 'user']
PRICE_SOURCES       = ['yahoo', 'coingecko', 'fake', 'sheet']            // where a cached price came from
FETCH_STATUSES      = ['ok', 'error', 'never']
PRICE_STATUSES      = ['fresh', 'stale', 'failed', 'manual', 'none']     // computed, never stored
MARKET_DATA_MODES   = ['live', 'fake', 'off']
REVIEW_FLAGS        = ['out_of_order', 'price_outlier', 'oversell', 'future_date', 'non_positive_price', 'zero_units',
                       'unmatched_ticker', 'unmatched_account']
CASH_ACCOUNT_KINDS  = ['bank', 'credit_card', 'loan_receivable', 'other']
BUDGET_ITEM_KINDS   = ['item', 'auto_yearly', 'auto_invest', 'auto_cash']
PERIOD_NOTE_KINDS   = ['spend', 'super_option', 'side_income']
SUPER_ENTRY_KINDS   = ['voluntary_contribution', 'reported_gain']
OTHER_ASSET_PRICE_SOURCES = ['manual', 'bullion']
METALS              = ['silver', 'gold']
UNITS_OF_MEASURE    = ['each', 'oz']
PAYMENT_FREQUENCIES = ['weekly', 'fortnightly', 'monthly']
SNAPSHOT_SOURCES    = ['migrated', 'recorded', 'lookback']
RUN_STATUSES        = ['running', 'succeeded', 'failed']
IMPORT_TRIGGERS     = ['cli', 'upload']
JOB_STATUSES        = ['running', 'succeeded', 'partial', 'failed']
JOB_TRIGGERS        = ['schedule', 'startup', 'manual', 'import']
JOB_NAMES           = ['prices']                                          // Stage 5 adds 'snapshot', Stage 7 'backup'
CHECK_STATUSES      = ['match', 'explained', 'unexplained', 'suspect', 'info']
REPORT_SECTIONS     = ['workbook', 'counts', 'holdings', 'ledgers', 'movements', 'dividends', 'cash', 'income', 'budget',
                       'other_assets', 'super', 'property', 'snapshots', 'net_worth', 'settings', 'exclusions',
                       'corrections', 'suspects']
REASON_CODES        = ['correction', 'correction_unmatched', 'exclusion_d22', 'exclusion_d23', 'feed_row',
                       'secret_not_imported', 'setting_not_imported', 'obsolete_setting', 'feature_dropped',
                       'sheet_error_value', 'sheet_bug', 'first_snapshot_window', 'live_row_skipped', 'blank_row',
                       'suspect_row', 'dividend_rekeyed', 'unmatched_dividend', 'unmatched_account', 'rounding',
                       'derived_later_stage', 'template_mismatch', 'unsupported_value',
                       'placeholder_slot', 'unnamed_row', 'formula_default', 'derived_input']
// placeholder_slot: an unused template slot (e.g. empty Property columns) skipped; unnamed_row: a row with a blank
// key cell that still holds other typed content (e.g. a Budget category) skipped; formula_default: an "only when
// typed" override cell holds the template's default formula, so nothing is stored; derived_input: an input cell
// holds a formula instead of a typed value and was imported as its cached result (e.g. Property row 30).
PAY_FREQUENCIES     = ['monthly', 'four_weekly', 'fortnightly', 'weekly', 'twice_monthly']
ALLOCATION_AGGRESSIVENESS = ['light', 'normal', 'aggressive']
CHART_DATE_UNITS    = ['monthly', 'quarterly', 'yearly']
```

### 2.4 Tables (Drizzle, `packages/schema/src/db/tables/*.ts`)
Column notation: `name type [not null] [default] — note`. Unless stated, every entity table also has `origin`, `sheet_ref` (§2.1).

**`app_meta`** (moved verbatim from Stage 0; migration `0000` unchanged): `key text pk`, `value text not null`, `updated_at text not null`.

**`settings`** — spec 01 §5 (typed key/value; registry in §2.5)
- `key text pk` · `value_json text not null` (JSON: integer cents, decimal string, integer, boolean, enum string, IsoDate) · `updated_at text not null` · `origin text not null`.

**`instruments`** — spec 03 §1.2, §2, §3, §4 (watch tables + ledger-only instruments)
- `id` · `kind text not null` (INSTRUMENT_KINDS) · `symbol text not null` — exactly as in the sheet (`ASX:ABC`, `EXAMPLEFUND`, `BTC`) · `exchange text` (`ASX` from `ASX:ABC`; null otherwise) · `code text not null` (part after `:`, else the whole symbol; used for D28 re-keying) · `name text` · `quote_currency text not null default 'AUD'` · `is_watched bool not null default true` (false = only in the ledger, e.g. an exited ETF) · `sort_order integer not null` · `target_ratio text` · `sector text` · `is_retirement bool not null default false` (sheet sector exactly `Retirement`) · `location text` · `mgmt_fee_ratio text` · `region_us_ratio text` · `region_asia_ratio text` · `region_aus_ratio text` · `region_other_ratio text` · `dividend_freq_months integer` · `drp bool` (null = unknown) · `note text` · `origin` · `sheet_ref`.
- `unique(kind, symbol)`; `index(code)`.

**`price_sources`** — per-instrument pricing configuration (1:1)
- `instrument_id integer pk → instruments.id on delete cascade` · `provider text not null` (PRICE_PROVIDERS) · `provider_symbol text` (`ABC.AX`, `bitcoin`; null = unresolved) · `symbol_origin text not null` (SYMBOL_ORIGINS) · `manual_price text` (AUD) · `manual_price_as_of text` (IsoDate) · `manual_origin text` (MANUAL_ORIGINS) · `manual_note text` · `updated_at text not null`.

**`prices`** — latest price cache per instrument (1:1)
- `instrument_id integer pk → instruments.id on delete cascade` · `price text` (last good AUD price) · `native_price text` · `native_currency text` · `fx_rate text` (AUD per native unit applied) · `as_of text` (market time of the good price, timestamp; `sheet` rows use the workbook as-of date at `T00:00:00Z`) · `fetched_at text` · `source text` (PRICE_SOURCES) · `last_attempt_at text` · `last_status text not null default 'never'` (FETCH_STATUSES) · `last_error text` (≤ 200 chars) · `consecutive_failures integer not null default 0`.

**`market_quotes`** — latest value per market series (FX, bullion; D23/D25)
- `series_id text pk` (`AUDUSD`, `SI_USD_OZ`, `GC_USD_OZ`, `XAG_AUD_OZ`, `XAU_AUD_OZ`, dynamic `FX_<CCY>AUD`) · `value text` · `unit text not null` · `as_of text` · `fetched_at text` · `source text` · `last_attempt_at text` · `last_status text not null default 'never'` · `last_error text` · `consecutive_failures integer not null default 0`.

**`trades`** — spec 03 §1.3 (Stocks/ETFs/MF/Crypto ledgers)
- `id` · `instrument_id integer not null → instruments.id on delete cascade` · `trade_date text not null` · `units text not null` (signed; negative = sell) · `price text not null` (AUD per unit) · `fee_cents integer not null default 0` (brokerage or crypto fee, rounded half away from zero) · `fee_rate text` (crypto % fee ratio when the sheet fee was the % formula) · `seq integer not null` (1-based row order within the tab's ledger; FIFO tie-break) · `review_flags text` · `correction_id text` · `note text` · `origin` · `sheet_ref`.
- `index(instrument_id, trade_date, seq)`.
- **Fee authority (Stage 2 must follow):** when `fee_rate` is set, the fee is `|fee_rate × units × price|` computed in decimal (the template's `E = ABS(rate × G)` with `G = C × D`); `fee_cents` is then only a rounded display value and is never summed for cost base or gain. When `fee_rate` is null, `fee_cents` is exact. The `ledgers.fees.crypto` check uses the same rule (Σ unrounded rate fees, rounded once).

**`dividends`** — spec 02 §4 (D28)
- `id` · `instrument_id integer → instruments.id on delete set null` (null = unmatched) · `ticker text not null` (as typed) · `holding_kind text not null` (INSTRUMENT_KINDS, from the sheet's Holding Type) · `payment_date text not null` · `ex_date text` · `reinvested bool` (null = blank) · `net_amount_cents integer not null` · `price_at_ex text` · `price_at_ex_manual bool not null default false` · `review_flags text` · `correction_id text` · `note text` · `origin` · `sheet_ref`.
- `index(instrument_id)`, `index(payment_date)`.

**`cash_accounts`** — spec 02 §1.2
- `id` · `name text not null` · `kind text not null default 'bank'` (the importer always writes `bank`; Stage 3 reclassifies) · `currency text not null default 'AUD'` · `balance_cents integer not null` · `balance_as_of text` · `is_offset bool not null default false` · `archived bool not null default false` · `sort_order integer not null` · `note text` · `origin` · `sheet_ref`.

**`budget_items`** — spec 02 §3.2
- `id` · `name text not null` · `kind text not null` (BUDGET_ITEM_KINDS) · `monthly_cents integer` (null for `auto_*`; Stage 3 derives them) · `category text` (trimmed) · `account_name text` (as typed) · `cash_account_id integer → cash_accounts.id on delete set null` · `sort_order integer not null` · `review_flags text` · `origin` · `sheet_ref`. `index(cash_account_id)`.

**`yearly_expenses`** — spec 02 §3.2: `id` · `name text not null` · `annual_cents integer not null` · `sort_order integer not null` · `origin` · `sheet_ref`.

**`income_streams`** — spec 02 §2.2: `id` · `name text not null` · `sort_order integer not null` · `archived bool not null default false` · `origin` · `sheet_ref`.

**`side_income_entries`** — spec 02 §2: `id` · `stream_id integer not null → income_streams.id on delete cascade` · `period_month text not null` · `period_start text` · `period_end text` · `amount_cents integer not null` · `origin` · `sheet_ref`. `unique(period_month, stream_id)`.

**`period_notes`** — spend notes (Cash Q), super option notes (Super F), side-income notes (Side Income J)
- `id` · `period_month text not null` · `kind text not null` (PERIOD_NOTE_KINDS) · `note text not null` · `origin` · `sheet_ref`. `unique(period_month, kind)`.

**`snapshots`** — spec 01 §2.3, D29 (one row per History row; signs exactly as the sheet)
- `id` · `run_date text not null` · `period_month text not null unique` · `source text not null` (SNAPSHOT_SOURCES) · `recorded_at text` (null for migrated) · `origin` · `sheet_ref`, then (all nullable; `_cents` integer, `_ratio` text):

| History col | Column | History col | Column |
|---|---|---|---|
| B | `stocks_value_cents` | U | `liabilities_balance_cents` |
| C | `stocks_gain_cents` | V | `liabilities_paid_cents` |
| D | `stocks_gain_ratio` | W | `salary_monthly_cents` |
| E | `stocks_movements_cents` | X | `property_value_cents` |
| F | `etf_value_cents` | Y | `property_purchase_cents` |
| G | `etf_gain_cents` | Z | `property_equity_cents` |
| H | `etf_gain_ratio` | AA | `property_gain_cents` |
| I | `etf_movements_cents` | AB | `mortgage_balance_cents` |
| J | `crypto_value_cents` | AC | `mortgage_interest_fees_cents` |
| K | `crypto_gain_cents` | AD | `mortgage_principal_paid_cents` |
| L | `crypto_gain_ratio` | AE | `property_gain_ratio` |
| M | `crypto_movements_cents` | AF | `mf_value_cents` |
| N | `cash_value_cents` | AG | `mf_gain_cents` |
| O | `cash_gain_cents` | AH | `mf_gain_ratio` |
| P | `cash_increase_ratio` | AI | `mf_movements_cents` |
| Q | `super_value_cents` | AJ | `other_value_cents` |
| R | `super_contrib_cents` | AK | `other_gain_cents` |
| S | `super_gain_cents` | | |
| T | `super_gain_ratio` | | |

Stage 5 reproduces derived columns (ratios, equity, cash gain) from the primitives and compares with these stored values.
- **Precision:** History money carries sub-cent float values; it is rounded to integer cents at import (half away from zero). Ratio columns are stored as imported (12 significant digits) and stay the source of truth. Because the money inputs lost their sub-cent part, a ratio recomputed from stored cents differs from the stored ratio by up to ~5e-6 on this template's data. **Stage 5 recompute tests must use ≤ 1 cent for money and ~1e-5 relative for ratios**, never the 1e-9 import tolerance.

**`other_assets`** — spec 04 §1 (room for Stage 4 bullion)
- `id` · `description text not null` · `url text` (cell hyperlink, or the description when it is a URL) · `purchase_date text` · `units text not null` · `sold_units text not null default '0'` · `currency text not null default 'AUD'` · `unit_cost text` · `unit_price text` (last known unit price in `currency`) · `unit_price_as_of text` · `price_source text not null default 'manual'` (OTHER_ASSET_PRICE_SOURCES) · `metal text` (METALS) · `unit_of_measure text not null default 'each'` · `oz_per_unit text` · `sort_order integer not null` · `note text` · `origin` · `sheet_ref`.

**`super_funds`** — spec 04 §2: `id` · `name text not null` · `balance_cents integer not null` · `balance_as_of text` · `sort_order integer not null` · `archived bool not null default false` · `origin` · `sheet_ref`.

**`super_entries`** — super contributions and reported gains per period (spec 04 §2.2)
- `id` · `period_month text not null` · `kind text not null` (SUPER_ENTRY_KINDS) · `fund_id integer → super_funds.id on delete set null` · `entry_date text` · `amount_cents integer not null` · `note text` · `origin` · `sheet_ref`. `index(period_month)`.

**`properties`** — spec 04 §3: `id` · `name text not null` · `purchase_date text` · `is_primary_residence bool not null default false` · `purchase_value_cents integer not null default 0` · `current_value_cents integer not null default 0` · `valuation_date text` · `net_rent_to_date_cents integer not null default 0` · `sort_order integer not null` · `archived bool not null default false` · `note text` · `origin` · `sheet_ref`.

**`loans`** — mortgages (Property) and other loans (LiabilitiesDebts); **balances stored positive** (spec 04 §3.7)
- `id` · `property_id integer → properties.id on delete set null` · `name text not null` · `lender text` · `start_date text` · `interest_periods_per_year integer` · `annual_rate text` · `payment_cents integer` · `payment_frequency text not null default 'monthly'` · `start_balance_cents integer` · `current_balance_cents integer not null` · `balance_as_of text` · `payments_paid_cents integer` · `payments_paid_derived bool not null default false` (true when the sheet's "payments paid" cell was a formula such as start − current, i.e. principal reduction only with interest not tracked; Stage 4's repayments work keys on it) · `sort_order integer not null` · `archived bool not null default false` · `note text` · `origin` · `sheet_ref`. `index(property_id)`.

**`import_runs`**
- `id` · `started_at text not null` · `finished_at text` · `status text not null` (RUN_STATUSES) · `dry_run bool not null default false` · `trigger text not null` (IMPORT_TRIGGERS) · `file_name text not null` (basename only) · `file_sha256 text not null` · `file_size integer not null` · `workbook_as_of text` · `corrections_name text` (basename) · `corrections_sha256 text` · `importer_version text not null` · `totals_json text` · `report_json text` · `error_code text` · `error text`. `index(started_at)`.

**`job_runs`** — scheduler log (Stage 5 snapshots and Stage 7 backups reuse it)
- `id` · `job text not null` · `trigger text not null` (JOB_TRIGGERS) · `started_at text not null` · `finished_at text` · `status text not null` (JOB_STATUSES) · `detail_json text` · `error text`. `index(job, started_at)`.

`DOMAIN_TABLES_DELETE_ORDER` (exported): `dividends, trades, side_income_entries, income_streams, period_notes, budget_items, yearly_expenses, cash_accounts, snapshots, super_entries, super_funds, loans, properties, other_assets` (instruments are upserted, §4.8).

### 2.5 Settings registry (`settings.ts`)
```ts
export type SettingType = 'money' | 'ratio' | 'integer' | 'boolean' | 'enum' | 'date';
export type SettingCategory = 'pay' | 'budget' | 'goals' | 'allocation' | 'returns' | 'investing' | 'crypto' | 'savings'
  | 'property' | 'charts' | 'features' | 'fire';
export interface SettingDef {
  key: SettingKey; label: string; category: SettingCategory; type: SettingType;
  enumValues?: readonly string[]; min?: number; max?: number;
  source: { tab: 'SheetOptions'; id: number; sheetLabel: string } | { tab: string; cell: string } | null;
  defaultValue: SettingValue | null;
}
export const SETTINGS: readonly SettingDef[];        // key order = display order
export const settingValueSchema: (key: SettingKey) => z.ZodType;
export const SHEET_OPTIONS_NOT_IMPORTED: Readonly<Record<number,
  { sheetLabel: string; reasonCode: ReasonCode; reason: string; decision?: string; secret?: true }>>;
export const SHEET_OPTIONS_VALIDATED: Readonly<Record<number, { sheetLabel: string; expected: 'AUD' }>>; // IDs 22, 39
export function normaliseSheetLabel(label: string): string;
```
SheetOptions IDs are read from column P (stable across template versions, spec 01 §5.1); the setting row is wherever that ID sits.
- **`sheetLabel`** is the template's column-K label for that ID, copied **from the workbook's K column** (generic template text, not owner data), never from the spec tables (the specs normalise dashes). Every ID 1–44 has exactly one `sheetLabel` across `SETTINGS`, `SHEET_OPTIONS_NOT_IMPORTED` and `SHEET_OPTIONS_VALIDATED`.
- **`normaliseSheetLabel`:** lower-case; map `–`/`—` to `-`; collapse `/\s+/` (incl. newlines) to one space; trim; strip one trailing `:`. The importer compares `normaliseSheetLabel(K)` with `normaliseSheetLabel(sheetLabel)`. Unit tests: a label with an internal newline and a parenthesised suffix, a label with a trailing colon, a hyphen vs an en dash, extra spaces.

| Key | Source | Type |
|---|---|---|
| `pay.dayOfMonth` | SheetOptions ID 2 | integer 0–28 |
| `budget.useForInvestAmount` | ID 3 | boolean |
| `pay.grossAnnualSalaryCents` | ID 4 | money |
| `goals.housePriceTargetCents` | ID 5 | money |
| `goals.cashSavingsTargetCents` | ID 6 | money |
| `pay.frequency` | ID 7 (`Monthly`, `4-weeks`, `2-weeks`, `Weekly`, `Twice Monthly` → PAY_FREQUENCIES) | enum |
| `pay.netPayCents` | ID 8 | money (per pay) |
| `pay.jobStartDate` | ID 9 | date |
| `returns.cashInterestRate` | ID 11 | ratio |
| `investing.defaultBrokerageCents` | ID 12 | money |
| `investing.allocationAggressiveness` | ID 13 | enum |
| `allocation.etf` / `.stock` / `.crypto` / `.cash` | IDs 15 / 16 / 17 / 18 | ratio |
| `goals.houseSavingsPerYearCents` | ID 21 | money |
| `allocation.managedFund` | ID 23 | ratio |
| `goals.eoyCashGoalCents` | ID 24 | money |
| `returns.marketReturn` | ID 25 | ratio |
| `tax.marginalRate` | ID 26 | ratio |
| `goals.houseDepositRatio` | ID 27 | ratio |
| `goals.houseDepositInvestmentShare` | ID 28 | ratio |
| `budget.emergencyFundMonths` | ID 30 | integer ≥ 0 |
| `budget.autoInvestSplit` | ID 33 | boolean |
| `crypto.feeRate` | ID 38 | ratio |
| `savings.includeMortgagePrincipal` | ID 41 | boolean |
| `allocation.otherAssets` | ID 42 | ratio |
| `savings.includeRetirementContributions` | ID 43 | boolean |
| `property.offsetsIncludeEmergencyFund` | ID 44 | boolean |
| `investing.parcelFrequencyMonths` | SheetOptions `H13` (script-written static) | integer |
| `investing.parcelAmountCents` | SheetOptions `H19` (script-written static) | money |
| `investing.etfLimit` | ETFs `L18` | integer |
| `budget.includeSideIncome` | Budget `D4` | boolean |
| `budget.emergencyFundOverrideCents` | Budget `D3` **only when typed** (no formula) | money |
| `charts.dateUnit` | Net Worth `H60` | enum |
| `charts.unitCount` | Net Worth `H61` **only when typed** (formula = auto → not written) | integer ≥ 1 |
| `features.cash` `.etfs` `.stocks` `.managedFunds` `.fire` `.budget` `.crypto` `.otherAssets` `.property` `.sideIncome` `.retirement` | First Time Setup toggles (C28:C33, E28:E33 minus Capital Gains and Liabilities) | boolean |
| `fire.birthYear` `fire.superContributionPerYearCents` `fire.inflationRate` `fire.withdrawalRate` `fire.preservationAge` | FIRE `E6` `E7` `E8` `E9` `E10` | integer / money / ratio / ratio / integer |
| `fire.yearlySpendOverrideCents` | FIRE `E48` **only when typed** | money |

**"Only when typed" overrides** (`budget.emergencyFundOverrideCents`, `charts.unitCount`, `fire.yearlySpendOverrideCents`): a typed number → stored and checked (`match`); a formula (the template default) → **nothing stored** and one `info` line (`formula_default`, "Default formula; no override") with `expected`/`actual`/`diff` null — no value comparison; blank → nothing stored, `info`.

**Secrets (IDs 1 and 29, `secret: true`):** the extractor never reads the value cell (column L) for these IDs — it reads only P and K. Their report lines carry `label` = the sheet label only and `expected`/`actual`/`diff` = **null**; the value is never passed to the check builder, a logger, an error message or any table. The existing test that scans every text column of every table (incl. `import_runs.report_json`) for the synthetic placeholder values stays.

**Not imported** (`SHEET_OPTIONS_NOT_IMPORTED`, each still gets a report line): ID 1 email → `secret_not_imported` (D24, PII); ID 29 CoinMarketCap key → `secret_not_imported` (D24; see Secrets above); ID 10 → `setting_not_imported` ("no formula consumer; Budget D4 is the effective switch", spec 01 §5.2); IDs 14, 31 → `feature_dropped` (email/calendar reminders); ID 32 → `feature_dropped` (version check); IDs 19, 20 → `obsolete_setting`; IDs 34–37 → `feature_dropped` (Capital Gains tab, D2); ID 40 → `feature_dropped` (D24). IDs 22 (base currency) and 39 (salary currency) are **validated** to be `AUD` (D25): `match` if AUD, `unexplained` (`unsupported_value`) otherwise; they are not stored.

### 2.6 Record-browser registry (`records.ts`, frozen)
```ts
export const RECORD_ENTITY_IDS = ['instruments', 'trades', 'dividends', 'cash-accounts', 'budget-items', 'yearly-expenses',
  'income-streams', 'side-income', 'period-notes', 'snapshots', 'other-assets', 'super-funds', 'super-entries',
  'properties', 'loans', 'settings'] as const;
export type RecordGroupId = 'investments' | 'cashflow' | 'assets' | 'history' | 'settings';
export type RecordColumnType = 'text' | 'integer' | 'money' | 'quantity' | 'price' | 'ratio' | 'date' | 'month'
  | 'timestamp' | 'boolean' | 'flags' | 'setting';
export interface RecordColumn { id: string; label: string; type: RecordColumnType }
export interface RecordEntityMeta { id: RecordEntityId; label: string; group: RecordGroupId; columns: RecordColumn[];
  defaultSort: { columnId: string; desc?: boolean } }
export const RECORD_ENTITIES: Readonly<Record<RecordEntityId, RecordEntityMeta>>;
```
Columns (id:type; labels are Sentence case in the registry):
- **instruments** (Investments): `kind:text symbol:text name:text currency:text watched:boolean heldUnits:quantity targetRatio:ratio sector:text retirement:boolean mgmtFeeRatio:ratio location:text regionUs:ratio regionAsia:ratio regionAus:ratio regionOther:ratio dividendFreqMonths:integer drp:boolean provider:text providerSymbol:text origin:text`
- **trades** (Investments): `date:date symbol:text kind:text units:quantity price:price orderValue:money fee:money feeRate:ratio seq:integer flags:flags correction:text sheetRef:text` (orderValue = units × price rounded to cents)
- **dividends** (Cash flow): `paymentDate:date ticker:text symbol:text kind:text exDate:date reinvested:boolean netAmount:money priceAtEx:price flags:flags sheetRef:text`
- **cash-accounts** (Cash flow): `name:text kind:text currency:text balance:money offset:boolean balanceAsOf:date sheetRef:text`
- **budget-items** (Cash flow): `name:text kind:text monthly:money category:text account:text linkedAccount:text flags:flags`
- **yearly-expenses** (Cash flow): `name:text annual:money`
- **income-streams** (Cash flow): `name:text archived:boolean`
- **side-income** (Cash flow): `period:month stream:text start:date end:date amount:money`
- **period-notes** (History): `period:month kind:text note:text`
- **snapshots** (History): `runDate:date period:month source:text` + the 36 value columns of §2.4 (ids camelCase of the column names without `_cents`/`_ratio` suffix change: e.g. `stocksValue:money`, `stocksGainRatio:ratio`)
- **other-assets** (Assets): `description:text url:text purchaseDate:date units:quantity soldUnits:quantity currency:text unitCost:price unitPrice:price priceSource:text metal:text unitOfMeasure:text value:money`
- **super-funds** (Assets): `name:text balance:money balanceAsOf:date`
- **super-entries** (Assets): `period:month kind:text fund:text amount:money`
- **properties** (Assets): `name:text purchaseDate:date primaryResidence:boolean purchaseValue:money currentValue:money netRent:money`
- **loans** (Assets): `name:text property:text startDate:date annualRate:ratio periodsPerYear:integer payment:money startBalance:money currentBalance:money paymentsPaid:money paymentsPaidDerived:boolean`
- **settings** (Settings): `key:text label:text category:text value:setting updatedAt:timestamp`

### 2.7 Pricing helpers (`pricing.ts`, frozen, pure)
```ts
export const YAHOO_EXCHANGE_SUFFIXES: Readonly<Record<string, string>> =
  { ASX: '.AX', NZE: '.NZ', LON: '.L', TSE: '.TO', NYSE: '', NASDAQ: '', NYSEARCA: '', NYSEAMERICAN: '', BATS: '' };
export const COINGECKO_KNOWN_IDS: Readonly<Record<string, string>> = { BTC: 'bitcoin', ETH: 'ethereum' }; // nothing else, ever
export const BULLION_FEEDS: Readonly<Record<string, 'silver' | 'gold'>> = { 'SI=F': 'silver', 'GC=F': 'gold' };
export const MARKET_SERIES: Readonly<Record<'AUDUSD' | 'SI_USD_OZ' | 'GC_USD_OZ' | 'XAG_AUD_OZ' | 'XAU_AUD_OZ',
  { label: string; unit: string; yahoo?: string; derivedFrom?: [string, string] }>>;
  // AUDUSD: 'AUDUSD=X' (USD per AUD); SI_USD_OZ: 'SI=F'; GC_USD_OZ: 'GC=F';
  // XAG_AUD_OZ = SI_USD_OZ / AUDUSD; XAU_AUD_OZ = GC_USD_OZ / AUDUSD
export function derivePriceSource(i: { kind: InstrumentKind; symbol: string; exchange: string | null; code: string }):
  { provider: PriceProvider; providerSymbol: string | null };
```
Rules: stock/ETF with a known exchange → `yahoo`, `${code}${suffix}`; unknown or missing exchange → `none`. Managed fund → `yahoo` with the id as-is only when it looks like a Yahoo symbol (`/^[A-Z0-9^.\-]+(\.[A-Z]{1,3}|=F|=X)$/` or `/^0P[0-9A-Z]{8}/`), else `none` (manual). Crypto → `coingecko` with `COINGECKO_KNOWN_IDS[symbol]` or `null` (resolved at refresh, §5.5).

---

## 3. API contract (FROZEN)

All routes under `/api`, JSON unless stated. DTO types and request schemas come from `@joinr/schema`. Errors use the Stage 0 shape `{ error: { code, message } }` through the existing error handler; 5xx messages stay generic. Request bodies/queries are validated with the Zod schemas via `parseWith(schema, value)` (added to `apps/server/src/errors.ts` by the Scaffolder; throws `HttpError(400, <issues>, 'VALIDATION_ERROR')`). Every response sets `cache-control: no-store`.

### 3.1 Error codes (`dto/errors.ts`: `API_ERROR_CODES`, `ApiErrorBody`)
`NOT_FOUND` 404 · `VALIDATION_ERROR` 400 · `IMPORT_CONFIRM_REQUIRED` 409 · `IMPORT_IN_PROGRESS` 409 · `INVALID_WORKBOOK` 422 · `INVALID_CORRECTIONS` 422 · `PAYLOAD_TOO_LARGE` 413 (Fastify body limit) · `UNSUPPORTED_MEDIA_TYPE` 415 (Fastify) · `MARKET_DATA_DISABLED` 503 · `INTERNAL_SERVER_ERROR` 500.

### 3.2 Endpoints

| Method & path | Owner | Request | 2xx response | Errors |
|---|---|---|---|---|
| `GET /api/records` | server-api | — | 200 `RecordsIndexResponse` | |
| `GET /api/records/:entity` | server-api | `entity ∈ RECORD_ENTITY_IDS` | 200 `RecordsPageResponse` (all rows, cap 5 000, registry `defaultSort`) | 404 unknown entity |
| `POST /api/import` | server-api | raw body = xlsx bytes; `Content-Type: application/octet-stream` or `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`; header `X-File-Name` (URI-encoded; sanitised to a basename ≤ 200 chars); query `importQuerySchema` `{ dryRun?: 'true'\|'false'; confirmReplace?: 'true'\|'false' }`; body limit `UPLOAD_LIMIT_BYTES` (25 MiB = 26,214,400 bytes; `@joinr/schema`) | **201** `ImportRunDetail` (committed) · **200** `ImportRunDetail` (dry run) | 400 empty body · 409 `IMPORT_CONFIRM_REQUIRED` (domain data exists, not a dry run, no `confirmReplace=true`) · 409 `IMPORT_IN_PROGRESS` · 413 · 415 · 422 `INVALID_WORKBOOK` / `INVALID_CORRECTIONS` (run recorded as failed; body includes the message) · 500 |
| `GET /api/import/runs` | server-api | — | 200 `ImportRunsResponse` (newest first, ≤ 50) | |
| `GET /api/import/runs/:id` | server-api | positive int | 200 `ImportRunDetail` | 400 · 404 |
| `GET /api/status` | server-api | — | 200 `AppStatus` | |
| `GET /api/prices` | market-data | — | 200 `PricesResponse` | |
| `POST /api/prices/refresh` | market-data | `refreshRequestSchema` `{ instrumentIds?: number[] (≤ 500); force?: boolean }` (empty body allowed) | 200 `RefreshResponse` (awaits the run; joins an in-flight run) | 400 · 503 `MARKET_DATA_DISABLED` (mode `off`) |
| `PUT /api/prices/:instrumentId/manual` | market-data | `manualPriceInputSchema` `{ price: decimal > 0, ≤ 8 dp, ≤ 1e9; asOf: IsoDate, not after tomorrow; note?: string ≤ 200 }` | 200 `PriceItem` | 400 · 404 |
| `DELETE /api/prices/:instrumentId/manual` | market-data | — | 200 `PriceItem` | 404 |
| `PUT /api/prices/:instrumentId/source` | market-data | `priceSourceInputSchema` `{ provider: PriceProvider; providerSymbol: string (1–64, /^[A-Za-z0-9.^=\-_:]+$/) \| null }`, symbol required unless provider `none` | 200 `PriceItem` (sets `symbol_origin='user'`) | 400 · 404 |
| `GET /api/market/series` | market-data | — | 200 `MarketSeriesResponse` | |
| `GET /api/health` | (Stage 0) | — | unchanged; `db.migrations` becomes 2 | |

### 3.3 DTOs (`dto/*.ts`, frozen field lists)
```ts
// records
export type RecordCell = string | number | boolean | string[] | null;   // money = integer cents; decimals = strings
export interface RecordRow { id: string; cells: Record<string, RecordCell>; valueType?: SettingType } // valueType: settings rows
export interface RecordEntitySummary { id: RecordEntityId; label: string; group: RecordGroupId; count: number }
export interface RecordsIndexResponse { entities: RecordEntitySummary[] }                // registry order
export interface RecordsPageResponse { entity: RecordEntitySummary; columns: RecordColumn[]; rows: RecordRow[] }

// import
export interface ImportRunSummary {
  id: number; startedAt: string; finishedAt: string | null; status: RunStatus; dryRun: boolean; trigger: ImportTrigger;
  fileName: string; fileSha256: string; fileSizeBytes: number; workbookAsOf: string | null; correctionsName: string | null;
  totals: Record<CheckStatus, number> | null; error: { code: string; message: string } | null;
}
export interface ImportRunDetail extends ImportRunSummary { report: ReconciliationReport | null }
export interface ImportRunsResponse { runs: ImportRunSummary[]; hasImportedData: boolean; inProgress: boolean }

// report
export interface ReconciliationReport {
  version: 1; generatedAt: string;
  workbook: { fileName: string; sha256: string; sizeBytes: number; asOf: string | null; templateVersion: string | null };
  corrections: { name: string | null; sha256: string | null; entries: number; applied: number };
  counts: Partial<Record<RecordEntityId, number>>;          // rows written per entity
  totals: Record<CheckStatus, number>;
  checks: ReconciliationCheck[];
}
export interface ReconciliationCheck {
  id: string;                 // stable across runs, e.g. 'holdings.units.etf.ASX:ABC', 'movements.2026-02.crypto'
  section: ReportSection; label: string; sheetRef: string | null;
  unit: 'count' | 'cents' | 'units' | 'ratio' | 'date' | 'text' | 'none';
  expected: string | number | null;    // sheet side
  actual: string | number | null;      // app side (read back from the DB inside the import transaction)
  diff: string | number | null;
  status: CheckStatus; reasonCode: ReasonCode | null; reason: string | null;
  refs: { decision?: string; correctionId?: string; entity?: RecordEntityId; recordId?: number; flags?: ReviewFlag[] } | null;
}

// prices
export interface PriceItem {
  instrumentId: number; kind: InstrumentKind; symbol: string; name: string | null;
  watched: boolean; held: boolean; heldUnits: string;
  provider: PriceProvider; providerSymbol: string | null; symbolOrigin: SymbolOrigin;
  status: PriceStatus;
  price: string | null;                                   // effective AUD price: manual wins, else last good fetched
  priceSource: 'manual' | PriceSource | null;
  asOf: string | null;                                    // of the effective price
  fetched: { price: string; nativePrice: string | null; nativeCurrency: string | null; fxRate: string | null;
             asOf: string; fetchedAt: string; source: PriceSource } | null;
  manual: { price: string; asOf: string; note: string | null; origin: ManualOrigin } | null;
  lastAttemptAt: string | null; lastError: string | null; consecutiveFailures: number;
}
export interface MarketQuoteItem { seriesId: string; label: string; value: string | null; unit: string; asOf: string | null;
  fetchedAt: string | null; source: string | null; status: 'fresh' | 'stale' | 'failed' | 'none'; lastError: string | null }
export interface JobRunSummary { id: number; job: string; trigger: JobTrigger; startedAt: string; finishedAt: string | null;
  status: JobStatus; detail: Record<string, unknown> | null; error: string | null }
export interface PricesResponse { mode: MarketDataMode; refreshIntervalMinutes: number; running: boolean;
  lastRun: JobRunSummary | null; nextRefreshAt: string | null; items: PriceItem[]; series: MarketQuoteItem[] }
export interface RefreshSummary { jobRunId: number | null; requested: number; ok: number; failed: number; skipped: number;
  durationMs: number }
export interface RefreshResponse { summary: RefreshSummary; prices: PricesResponse }
export interface MarketSeriesResponse { series: MarketQuoteItem[] }

// status
export interface AppStatus {
  prices: { mode: MarketDataMode; lastRefreshAt: string | null; running: boolean };
  snapshots: { count: number; latestPeriod: string | null };
  import: { lastRunAt: string | null; lastStatus: RunStatus | null; hasImportedData: boolean };
}
```
`PriceItem` ordering: held first, then kind order (INSTRUMENT_KINDS), then instrument `sort_order`.

### 3.4 Import route behaviour (server-api)
1. Route-scoped `addContentTypeParser(['application/octet-stream', XLSX_MIME], { parseAs: 'buffer', bodyLimit: UPLOAD_LIMIT_BYTES })` (the route's `bodyLimit` uses the same constant).
2. Reject a second import while one runs (module-level flag) → 409 `IMPORT_IN_PROGRESS`.
3. `hasDomainData(db)` (Scaffolder helper) and not dry run and `confirmReplace !== 'true'` → 409 `IMPORT_CONFIRM_REQUIRED`.
4. Corrections: `resolveCorrectionsPath({ setting: config.importCorrections, dataDir: config.dataDir, repoRoot: config.repoRoot })` (importer export). `setting` is a `CorrectionsSetting` (§4.1): `{ kind: 'off' }` (env `IMPORT_CORRECTIONS_FILE=none`) → none; `{ kind: 'file', path }` (any other value; relative → repo root) → that path (missing file → 422 `INVALID_CORRECTIONS`); `{ kind: 'auto' }` (unset) → `<DATA_DIR>/import-corrections.json` if present → `<repoRoot>/reference/import-corrections.json` if `repoRoot` is non-null and the file exists → none. Read + `parseCorrectionsFile` (422 `INVALID_CORRECTIONS` on failure). `config.repoRoot` is the folder holding `pnpm-workspace.yaml` (`findRepoRoot(SERVER_DIR) ?? null`; **null in the Docker image**, and null in `testConfig()`); it is not the `ConfigBase` folder used to resolve relative paths, which still falls back to `process.cwd()`.
   - **Synthetic workbooks must never meet the owner's corrections file:** `playwright.config.ts` and every synthetic-upload command set `IMPORT_CORRECTIONS_FILE=none` (§7.2 step 7, §10). The owner's own workbook uploaded through a dev server (acceptance #8) uses `auto`, so it gets the same corrections as the CLI.
5. Not a dry run and domain data exists → `backupBeforeImport(database, config.dataDir)` (Scaffolder helper: `VACUUM INTO <DATA_DIR>/backups/pre-import-YYYYMMDD-HHmmss.db`, keeps the newest 10).
6. `importWorkbook(db, { bytes, fileName, trigger: 'upload', corrections, correctionsSource, dryRun })` (sync).
7. Committed and succeeded → `market.notifyInstrumentsChanged()`.
8. Respond with `ImportRunDetail` read back from `import_runs`.
The route receives the importer through its plugin options (`{ database, config, market, importer = { importWorkbook, parseCorrectionsFile, resolveCorrectionsPath } }`) so tests can inject fakes.

---

## 4. Importer spec (`@joinr/importer`)

### 4.1 Public API (frozen; `packages/importer/src/index.ts`)
```ts
export const IMPORTER_VERSION: string;                         // '1.0.0'
export interface ImportOptions {
  bytes: Uint8Array; fileName: string; trigger: ImportTrigger;
  corrections?: CorrectionsFile | null; correctionsSource?: { name: string; sha256: string } | null;
  dryRun?: boolean; now?: () => Date;
}
export interface ImportResult { runId: number; status: 'succeeded' | 'failed'; dryRun: boolean;
  report: ReconciliationReport | null; errorCode: string | null; error: string | null }
export function importWorkbook(db: JoinrDb, options: ImportOptions): ImportResult;       // synchronous; never throws for
                                                                                          // workbook problems (returns failed)
export class WorkbookFormatError extends Error { readonly code = 'INVALID_WORKBOOK' }
export class CorrectionsError extends Error { readonly code = 'INVALID_CORRECTIONS' }
export function parseCorrectionsFile(json: string): CorrectionsFile;                     // throws CorrectionsError
export type { CorrectionsSetting } from '@joinr/schema';  // defined in schema corrections.ts (server config uses it too):
  // { kind: 'auto' } | { kind: 'off' } | { kind: 'file'; path: string }
export { correctionsSettingFromEnv } from '@joinr/schema'; // (value: string | undefined) =>
  // undefined/'' → auto · 'none' → off · else { kind: 'file', path: value } — the caller resolves a relative
  // path (config: against the repo root). Pure string logic: no node imports (the web imports the schema root).
export function resolveCorrectionsPath(o: { setting: CorrectionsSetting; dataDir: string; repoRoot: string | null }): string | null;
export type WorkbookLocation = { kind: 'found'; path: string } | { kind: 'none' } | { kind: 'multiple'; paths: string[] };
export function findWorkbookInDir(dir: string): WorkbookLocation;                        // *.xlsx, not recursive, ignores ~$ lock files
export function readWorkbook(bytes: Uint8Array): WorkbookReader;                         // reused by Stage 2+ golden tests
export interface CellInfo { t: 'n' | 's' | 'b' | 'e' | 'z'; v: number | string | boolean | null; formula: string | null; link: string | null }
export interface WorkbookReader {
  sheetNames: readonly string[]; has(sheet: string): boolean; cell(sheet: string, addr: string): CellInfo | null;
  number(sheet: string, addr: string): number | null; text(sheet: string, addr: string): string | null;
  date(sheet: string, addr: string): IsoDate | null; bool(sheet: string, addr: string): boolean | null;
  isBlank(sheet: string, addr: string): boolean; isErrorValue(sheet: string, addr: string): boolean; lastRow(sheet: string): number;
}
// '@joinr/importer/testing'
export function buildSyntheticWorkbook(opts?: SyntheticWorkbookOptions): Uint8Array;
export const SYNTHETIC_WORKBOOK_IMPLEMENTED: boolean;          // Scaffolder stub: false; importer sets true
export const IMPORTER_IMPLEMENTED: boolean;                    // Scaffolder stub: false; importer sets true only after
                                                               // its own clean-synthetic-workbook import test passes
export const LOCAL_WORKBOOK_PATH: string | null;              // <repo>/reference/*.xlsx when exactly one exists
export function describeWithLocalWorkbook(name: string, fn: (path: string) => void): void;   // describe.skip when absent
export function readLocalWorkbookBytes(): Uint8Array | null;
```

### 4.2 Parsing rules (verified on the workbook with SheetJS 0.20.3)
1. `XLSX.read(bytes, { type: 'array', cellFormula: true, cellDates: false, cellNF: false, cellText: false, cellStyles: false })`. The 1.8 MB workbook parses in ≈ 0.5 s; the **History** sheet parses fine (exceljs fails on it).
2. **Numbers** arrive as raw IEEE doubles in `v` (currency and percent formats are display-only; never read `w`). Float noise is common (e.g. a ledger units cell holds `-2.5000000000000004`, History values like `1234.5000000000002`).
   - Money → cents: `new Decimal(v).times(100).toDecimalPlaces(0, ROUND_HALF_UP)` (decimal.js takes the shortest round-trip string; half away from zero). Integer-safe check.
   - Quantities, prices, ratios → `decimalFromNumber(v)`: 12 significant digits (ROUND_HALF_EVEN), trailing zeros stripped. Tolerance for unit comparisons 1e-8.
3. **Dates** are numeric serials in the 1900 system (`Workbook.WBProps.date1904 === false`, asserted; if true use the 1904 epoch). ISO = UTC `1899-12-30 + floor(serial)` days. Never construct dates from strings with `new Date()`; never use `cellDates`. Text dates are accepted only as `d/m/yyyy`.
4. **Booleans** arrive as `t:'b'` (Cash offset column). `Yes`/`No` strings map case-insensitively after trim.
5. **Blank** = missing cell or a string that is empty after trim (formula blanks are exported as `""`).
6. **Error values** are exported as **strings** (`#VALUE!`, `#ERROR!`, and generally `/^#(?:[A-Z0-9\/]+[!?]|N\/A)$/`) or `t:'e'` → "sheet error value" (null + report reason `sheet_error_value`).
7. **Sentinel strings → null:** `-`, `—`, `Loading..`, `Loading...`, `No Price`, `No Watch Price`, `Please Enter`, `Enter Freq`, `Enter DRP`, `Manually enter`, `Update CGT`, `API Key Needed`, `Old Sheet`, `Accept Disclaimer`.
8. **Formulas** (`cellFormula`) are used only to tell typed values from formula results (manual prices, overrides) and to follow the bullion link (§4.4). Google-only functions are wrapped as `__xludf.DUMMYFUNCTION("…", cached)`; never evaluate formulas.
   - **Google spill ranges:** a Google Sheets array formula that spills is exported with the formula on the anchor cell only (no `F` range), and the spilled members arrive as **plain values with no formula** — indistinguishable from typed values. (Excel-style array ranges carry `F` on every member, e.g. `Cash!H3:H300`; those are fine.) Therefore a numeric cell without a formula counts as **typed** only when it is **not inside a known spill range**. Known spill ranges (layout constants, template v2.15): **`Crypto!B2:B7` and `Crypto!C2:C7`** (spec 03 §4: "B2 and C2 are single array formulas spilling down"). Any value there is a formula result, never a manual price or override.
9. No numbers stored as text were found in input columns. If a numeric input column holds text like `$1,234.50` or `12%`, parse it and add an `info` check.
10. **Merged cells:** values sit in the top-left cell only; the importer reads only anchor cells, never merged ranges.
11. **Hyperlinks:** `cell.l.Target`.
12. Required sheets: `Net Worth`, `Cash`, `Stocks`, `Managed Funds`, `ETFs`, `Crypto`, `Other Assets`, `Side Income`, `Super`, `Budget`, `Property`, `SheetOptions`, `Dividends`, `History`. Optional: `LiabilitiesDebts`, `Capital Gains`, `First Time Setup`, the FIRE tab (name starts with `FIRE`). Missing required sheet or a header anchor that does not match → `WorkbookFormatError` (import fails, no data written). Template version = `Net Worth!C46`; other than 2.15.x → `info`.

### 4.3 Sheet-by-sheet mapping (template v2.15.x anchors; column letters are template-generic)
"Watch rows" run from row 2 down to the row before the first column-A cell that starts with `Insert further rows` or `ℹ️`; blank-key rows are skipped. "Ledger rows" run from the row after the header to the sheet's last row; blank-key rows are skipped (counted as `blank_row` info).

| Tab | Anchor(s) | Rows | Columns → fields |
|---|---|---|---|
| **Stocks** watch | `A1`=`Ticker` | 2 → | A `symbol` (must contain `:`) · B `name` (cached text unless placeholder) · C `quote_currency` · D price (§4.4) · G held units (**check**) · P `target_ratio` · R `sector`/`is_retirement` · S `dividend_freq_months` · T `drp` |
| Stocks ledger | `A22`=`Ticker`, `B22`=`Purchase Date` | 23 → | A symbol · B `trade_date` · C `units` · D `price` · E `fee_cents` · G order value (**check**) |
| Stocks totals | | | `E16` value (**check**); `E17` gain (`info`, `derived_later_stage`: gains need the Stage 2 FIFO engine) |
| **ETFs** watch | `A1`=`Tick` | 2 → | A symbol · B name · C currency · D price · F held units (**check**) · O target · Q `mgmt_fee_ratio` · R `location` · S/T/U/V region US/Asia/Aus/Other · W sector · X freq · Y DRP · `L18` → `investing.etfLimit` |
| ETFs ledger | `A22`=`Ticker`, `B22`=`Order Date` | 23 → | A B C D E as Stocks · G order value (**check**) |
| ETFs totals | | | `F15` value (**check**); `F16` gain (`info`, `derived_later_stage`) |
| **Managed Funds** watch | `A1`=`Fund ID` | 2 → | A symbol · B name · C currency · D price · E invested units (**check**) · N target · P fee · Q location · R/S/T/U regions · V sector · X freq (text `Monthly`/`Quarterly`/`Half-yearly`/`Yearly` → 1/3/6/12; other text → null + info) · Y DRP |
| MF ledger | `A22`=`Fund ID` | 23 → | A B C D (no brokerage: `fee_cents` 0) · F order value (**check**) |
| MF totals | | | `B16` value (**check**); `H16` gain (`info`, `derived_later_stage`) |
| **Crypto** watch | `A1`=`Ticker Code` | 2 → | A symbol (coin symbol; name null; currency AUD) · B AUD price (§4.4; **spill range**, §4.2 rule 8) · C USD price (ignored) · D held units (**check**) · M target · O freq · P DRP |
| Crypto ledger | `A16`=`Ticker Code` | 17 → | A B C D · E fee: store `fee_cents` = round(cached E); when E is a formula, `fee_rate` = SheetOptions ID 38 value (fee authority: §2.4 trades) · G order value (**check**) |
| Crypto totals | | | `E9` value (**check**); `E10` gain (`info`, `derived_later_stage`) |
| **Dividends** | `A3`=`Payment Date` | 4 → 500 | A `payment_date` · B `ticker` · C `holding_kind` (`ETF`→etf, `Stocks`→stock, `Managed Fund`→managed_fund, `Crypto`→crypto) · D `ex_date` · E `reinvested` · F `net_amount_cents` · G price: typed number → `price_at_ex` + `price_at_ex_manual=true`; numeric formula result → `price_at_ex`; else null. FY table `K4:P8` (**checks**) |
| **Cash** | `A1`=`Bank` | 2 → row before `ℹ️` | A `name` · B `currency` (blank → AUD) · C `balance_cents` · E `is_offset`; `C13` total (**check**). Spend notes: `Q3:Q800` non-blank, period = month of the same-row date in `H` → `period_notes(kind='spend')` |
| **Side Income** | `F1`=`Date` | 2 → 799 where F is a date | `G1`/`H1` → two `income_streams` (blank header → "Side income 1/2") · E `period_start` · F `period_end` (period = month of F) · G/H numeric cells (incl. 0) → `side_income_entries` · J → `period_notes(kind='side_income')`. Rows with both amounts blank and no note are skipped (`info`). `C7` lifetime total (**check**) |
| **Budget** | `A7`=`ITEM` | 8 → the row whose A starts with `Cash Savings -` | A `name` (blank → skipped; when the row still holds a typed category in G or a non-zero C → one `info` line `unnamed_row`) · C `monthly_cents` (items; blank → 0) · F `account_name` → `cash_account_id` by exact trimmed name (exactly one match) · G `category` (trimmed). Kind: A starts with `Yearly Expenses - Automatic` → `auto_yearly`; `Investment Savings -` → `auto_invest`; `Cash Savings -` → `auto_cash`; else `item`. `D4` → setting; `D3` override only if typed (formula → `info` `formula_default`, §2.5). Yearly expenses: `E31`=`Yearly Expenses`, rows 32–60 with a name and numeric `F`. `J4`, `C24` (**checks**) |
| **Other Assets** | `F2`=`Description` | 3 → 500, F non-blank | F `description` (+ `url` from the hyperlink, or the text itself when it starts with `http`) · G `purchase_date` · H `units` · I `currency` · J `unit_cost` · K `unit_price` (§4.4 bullion link) · L `sold_units` (blank → 0). `unit_price_as_of` = workbook as-of. `D3`, `D4` (**checks**) |
| **Super** | `A1`=`Super Accounts` | `A2:B7` non-blank A | funds (`balance_as_of` = workbook as-of). `B8:B10` auto lines (retirement-tagged holdings; check only). `B11` → `super_entries(reported_gain)` and `B16` → `super_entries(voluntary_contribution)` for the period = month of EDATE(`Net Worth!C51`, 1) (fallback: workbook as-of month); a zero `B11` is not written. Notes `F3:F300` with dates in `E` → `period_notes(kind='super_option')`. `B12` total (**check**) |
| **Property** | `C15`=`Update below monthly` | slots D…O | Slot imported when purchase/current value ≠ 0, a mortgage balance ≠ 0 or row 16 holds a date (the **import predicate**); other slots are template placeholders (`Property n`, `-`, `No`, 0) → skipped, one aggregated `info` line `property.placeholderSlots` (`placeholder_slot`, count). Row 15 → `name`; 16 `purchase_date`; 17 `is_primary_residence`; 18 `purchase_value_cents`; 19 `current_value_cents`; 20 `net_rent_to_date_cents`. Loan when row 28 or 29 ≠ 0: name `"<property> mortgage"`, 24 `start_date`, 25 `interest_periods_per_year`, 26 `annual_rate`, 27 `payment_cents` (monthly), 28/29 `start/current_balance_cents` = **abs**, 30 `payments_paid_cents` = abs of the cached value (null if blank). **Row 30 holding a formula** (e.g. start − current, i.e. principal reduction only) → still imported (so `property.paid` matches) with `payments_paid_derived = true` and an `info` line `property.paymentsPaidDerived.<sheetRef>` (`derived_input`, "Payments paid is derived from the balances; interest is not tracked"). `valuation_date`/`balance_as_of` = workbook as-of. `F6`, `F7`, `F10`, `F11` (**checks**) |
| **LiabilitiesDebts** (optional) | `B11`=`Name:` | columns C…F (+ G) | A column with a non-zero row 16/17 → `loans` (no property): 11 name, 12 start, 13 periods, 14 rate, 15 payment, 16/17 balances (abs), 18 paid. Column G is skipped when G11 ends with `Capital Gains - Future Tax` (D2, `info`), otherwise treated like C…F. When G is skipped and `G17 ≠ 0` (the template's CGT "future tax" estimate, included in `D3` and hence `Net Worth!E20/E23`), emit `liabilities.cgtSlot` = `explained` `feature_dropped` (D2) with the amount, and exclude it from `netWorth.liabilities` (§4.9) |
| **History** | `A2`=`Month` | 3 → 300 with a date in A | **Header check:** the row-2 labels of all 36 mapped columns B…AK must match the mapping's expected template labels (copied from the workbook's row 2; generic; compared with `normaliseSheetLabel`) else `WorkbookFormatError` naming the column (a header anchor, §4.2 rule 12: a shifted mapping would silently corrupt every snapshot); on success the report carries `workbook.historyHeaders` = `match`. **Frozen** rows (no formula in `B`) → `snapshots` (`source='migrated'`, `run_date` = A, `period_month` = month of A, columns per §2.4). Rows with formulas are live rows → skipped (`info`, `live_row_skipped`). Two frozen rows in one month → keep the later run date, report the other as `unexplained` |
| **Net Worth** | | | `E52` = workbook as-of date (fallback: import date) · `C51` last run · `H60`/`H61` settings (`H61` formula → `info` `formula_default`) · row 22 spare liability → a `loans` row when non-zero · `C4:C11`, `C12`, `D15`, `E23`, `K2:P…` (**checks**); `D4:D11` gains (`info`, `derived_later_stage`) |
| **SheetOptions** | `K2`=`Setting`, `P2`=`ID` | rows 3 → 60 | column P id → registry (§2.5); `normaliseSheetLabel(K)` must equal `normaliseSheetLabel(sheetLabel)` for that ID, else `unexplained` `template_mismatch`. Column L is **not read** for secret IDs (§2.5). `H13`, `H19` static values |
| **First Time Setup** | | `B28:C33`, `D28:E33` | label → `features.*` (Yes/No) |
| **FIRE** (optional) | | `E6:E10`, `E48` | settings (§2.5); `E48` formula → `info` `formula_default` |
| **Capital Gains** (optional, not rebuilt) | `Z8`=`ETF Rows` | `AA8:AA11` | ledger row counts per tab (**checks only**) |

### 4.4 Instruments, prices and exclusions
- **Instrument set per kind:** watch rows, then ledger-only symbols (first appearance order) with `is_watched=false`. A watch row with 0 units and no trades is still imported as a watched instrument unless excluded below.
- **Price cell (D, or B for Crypto):** numeric **with** a formula, **or numeric inside a known spill range** (§4.2 rule 8: every Crypto watch B value) → seed `prices` (`source='sheet'`, `as_of` = workbook as-of, `last_status='ok'`) **only if the instrument has no `prices` row with a price yet** (a failure-only row is filled in; its fetch bookkeeping is kept). Numeric **without** a formula and outside a spill range (typed) → manual price (`manual_origin='import'`, `manual_price_as_of` = workbook as-of). A Crypto B value is **never** a manual price (otherwise a cutover export whose crypto prices resolved would pin stale sheet prices over CoinGecko, undoing D24). Error value / sentinel / blank → nothing (`sheet_error_value` info when the instrument is held). A price formula that references another tab (e.g. `='Managed Funds'!D5`) is recorded as `info` and ignored.
- **`price_sources`:** created with `derivePriceSource()` and `symbol_origin='derived'` when absent. On re-import: provider fields are refreshed only while `symbol_origin='derived'`; `search`/`user` values are kept. The manual price is (re)written only when absent or `manual_origin='import'` (cleared again if the sheet no longer has a typed price); `user` overrides are kept.
- **D23 exclusion (bullion feeds):** a Managed Funds watch row whose id is a key of `BULLION_FEEDS`, with 0 units and no ledger rows, is **not** an instrument. Report: `exclusions` check, `explained`, `exclusion_d23`, decision `D23`, expected = the sheet's cached AUD price (info only).
- **D22 exclusion (duplicate feed row):** a Managed Funds watch row with 0 units and no ledger rows whose id equals the `code` of an ETFs or Stocks watch row → not imported; the listed instrument keeps `derivePriceSource()` (e.g. `ABC.AX`). `explained`, `exclusion_d22`, `D22`.
- **Other feed rows:** any other Managed Funds watch row with 0 units, no ledger rows and an id ending `=F` or `=X` → not imported, `explained`, `feed_row`.
- **Bullion link (Other Assets K):** follow same-sheet single-cell references (`=K19`, depth ≤ 600, cycle-safe) to a formula `'Managed Funds'!D<r>`; if `Managed Funds!A<r>` is a `BULLION_FEEDS` key → `price_source='bullion'`, `metal`, `unit_of_measure='oz'`, `oz_per_unit='1'` (the template's convention: units are troy ounces), `unit_price` = cached K. Any other formula or a typed value → `manual`.

### 4.5 Corrections (D27)
- **Location** (git-ignored): `reference/import-corrections.json` on the dev PC; `<DATA_DIR>/import-corrections.json` on the NAS (Stage 7 copies it). Resolution order in §3.4 step 4 (`IMPORT_CORRECTIONS_FILE=none` switches corrections off); CLI flags override (`--corrections <file>`, `--no-corrections`).
- **Synthetic imports run without the owner's corrections** (they would match nothing and turn `correction_unmatched` into an unexplained line): e2e sets `IMPORT_CORRECTIONS_FILE=none`; CLI tests pass `--no-corrections` or an explicit synthetic corrections file; server tests use `testConfig()` (`importCorrections: { kind: 'off' }`, `repoRoot: null`; resolution tests override it with temp folders). **No test may read `reference/import-corrections.json` except the golden test.**
- **Format** (`CorrectionsFileSchema`, strict):
```json
{
  "version": 1,
  "corrections": [
    {
      "id": "C1",
      "target": "trade",
      "match": { "sheet": "Crypto", "row": 30, "symbol": "ETH", "date": "2025-11-03", "units": "0.5" },
      "set": { "date": "2025-03-11" },
      "reason": "Owner-confirmed day/month swap",
      "approvedOn": "2025-12-01"
    }
  ]
}
```
  (Example values are synthetic.) `target: 'trade'` — `match: { sheet: 'Stocks'|'ETFs'|'Managed Funds'|'Crypto'; row?: int; symbol; date: IsoDate; units?: decimal; price?: decimal }`, `set: { date?; units?; price?; feeCents? }` or `"action": "skip"` instead of `set`. `target: 'dividend'` — `match: { row?: int; ticker; paymentDate; netAmountCents?: int }`, `set: { paymentDate?; ticker?; exDate?; netAmountCents?; reinvested?: boolean | null }` or `"action": "skip"`. `id` unique; `reason` required.
- **Application:** after extraction, before exclusions/suspects/writes. A correction must match **exactly one** extracted row (all given match fields equal; decimals compared numerically). Applied → the row carries `correction_id`; report `corrections` check `explained` (`correction`). Zero or several matches → `unexplained` (`correction_unmatched`) and nothing changes.
- Unit tests use synthetic corrections only.

### 4.6 Suspect rows (D26; imported as-is, flagged)
Evaluated per tab ledger after corrections, in sheet row order. Flags go to `review_flags` and each flagged row gets a `suspects` check with status `suspect`.
- `out_of_order`: row *i* with `date[i] < date[i-1]` or `date[i] > date[i+1]` while its neighbours are in order (`date[i-1] ≤ date[i+1]`); for the first/last row use the one neighbour plus the next/previous pair.
- `price_outlier`: instrument with ≥ 3 trades and `price / median(other trades' prices)` > 4 or < 0.25.
- `oversell`: running units in (date, seq) order drop below −1e-9.
- `future_date`: after the workbook as-of date.
- `non_positive_price` / `zero_units`.
- Dividends: `unmatched_ticker` (§4.7). Budget items: `unmatched_account` (no or several cash accounts with that exact name).

### 4.7 Dividend re-keying (D28)
For each dividend row, among instruments of `holding_kind`: (1) exact `symbol` match → linked, `match`; (2) the ticker has no `:` and exactly one instrument's `code` equals it (case-insensitive) → linked, check `explained` `dividend_rekeyed` (D28); (3) otherwise `instrument_id = null`, flag `unmatched_ticker`, check `suspect` `unmatched_dividend`.

### 4.8 Write & replace semantics (one transaction; idempotent)
1. Parse and extract everything **before** the transaction (pure; no DB).
2. Insert the `import_runs` row (`running`) outside the domain transaction.
3. `db.transaction(tx => …)` (synchronous):
   1. Delete all rows of `DOMAIN_TABLES_DELETE_ORDER` (replace-all: app-created rows in those tables go too; the UI and CLI warn, require confirmation, and a pre-import backup is taken).
   2. Upsert instruments by `(kind, symbol)` in canonical order (kinds in `INSTRUMENT_KINDS` order; watch order, then ledger-only). Update only changed columns. Delete instruments no longer present (cascades `price_sources`, `prices`).
   3. `price_sources` / `prices` seeding per §4.4.
   4. Insert children in sheet order: cash accounts, budget items, yearly expenses, income streams, side income, period notes, trades, dividends, snapshots, other assets, super funds, super entries, properties, loans.
   5. Settings: upsert each imported key **only when `value_json` differs** (`updated_at` = run start). Keys the workbook does not provide are left alone.
   6. Reconcile (§4.9), reading the "actual" side back from `tx`.
   7. Dry run → roll back (`tx.rollback()`); else commit.
4. Update the run row: `succeeded` + `totals_json` + `report_json` (dry runs too), or `failed` + `error_code` + `error` (message only; no stack, no paths).
- **Idempotency contract:** importing the same bytes with the same corrections twice leaves every domain table (plus `settings`, `price_sources`, `prices`) **identical in every column**, ids included, and yields the same check ids/statuses/values. `import_runs` and `job_runs` are excluded.
- A crash mid-import leaves the domain untouched (transaction); server start marks stale `running` import/job runs as `failed` (`interrupted`).

### 4.9 Reconciliation report (every check; acceptance = zero `unexplained`)
Tolerances: units 1e-8; money = sum of rounded cents vs rounded sheet total, `|diff| ≤ max(1, ⌈n/2⌉)` cents for a sum over *n* cells (`match`; larger → mismatch); ratios 1e-9. A mismatch becomes `explained` only through a listed reason; otherwise `unexplained`. When corrections touched a check's inputs, recompute it **without** corrections: if that matches the sheet, the difference is `explained` (`correction`, with the ids).

| Section | Check id pattern | Expected (sheet) | Actual (app) | Explained cases |
|---|---|---|---|---|
| workbook | `workbook.template`, `workbook.asOf`, `workbook.date1904`, `workbook.historyHeaders` | C46, E52, History row 2 | parsed | template ≠ 2.15.x → `info` |
| counts | `counts.<entity>` (per kind for instruments/trades, per kind for period notes) | the **sheet key-row count** defined per entity in the table below | rows written | only the listed exclusions (D22/D23/feed) for instruments; nothing else |
| holdings | `holdings.units.<kind>.<symbol>` | cached held units (Stocks G, ETFs F, MF E, Crypto D) | Σ `trades.units` | — |
| holdings | `holdings.value.<kind>` | tab total (E16, F15, B16, E9) | Σ cached units × cached price over rows with a numeric price | a held row with an error/sentinel price zeroes the sheet total → `sheet_error_value` (template bug fixed by per-instrument prices) |
| holdings | `holdings.gain.<kind>` | tab gain cell (E17, F16, H16, E10) | null | always `info` `derived_later_stage` (Stage 2 FIFO goldens) |
| holdings | `holdings.price.<kind>.<symbol>` (held rows) | cached price | seeded/manual/none | error value, sentinel or blank (e.g. an array formula whose spill was not exported) → `explained` `sheet_error_value` ("priced by the price service") |
| ledgers | `ledgers.orderValue.<kind>`, `ledgers.fees.<kind>` | Σ order-value column, Σ brokerage/fee column | Σ units×price (cents), Σ `fee_cents` (rows with `fee_rate`: Σ \|fee_rate × units × price\| in decimal, rounded once — §2.4 fee authority) | rounding within tolerance = `match` |
| movements | `movements.<period>.<class>` for class ∈ stocks(E), etf(I), crypto(M), mf(AI), every frozen snapshot | History cell | Σ units×price of trades in (previous run date, this run date], excluding `is_retirement`; first snapshot window (EDATE(first, −1), first] | correction moved a trade across windows → `correction`; first row differs → `first_snapshot_window` |
| dividends | `dividends.fy.<fy>.<kind>` for K4:K8 | L…O cells | Σ `net_amount_cents` by payment date in [1 Jul, 1 Jul) | — |
| dividends | `dividends.link.<sheetRow>` | ticker | linked symbol | `dividend_rekeyed`; unmatched → `suspect` |
| cash | `cash.total` | C13 | Σ non-offset `balance_cents` | — |
| income | `income.stream.<n>`, `income.total` | Σ G / Σ H, C7 | Σ entries | — |
| budget | `budget.yearlyFund` | C24 | ROUNDUP(Σ annual / 60) × 5 dollars | — |
| budget | `budget.plannedSpend` | J4 | Σ `item` monthly + computed C24 | — |
| budget | `budget.account.<sheetRow>` | account name | linked account | unmatched → `suspect` (`unmatched_account`) |
| other_assets | `otherAssets.value`, `otherAssets.gain` | D3, D4 | Σ remaining × `unit_price`; minus Σ remaining × `unit_cost` (AUD rows) | non-AUD rows → `info` (FX not checked) |
| super | `super.total`, `super.contribution`, `super.gain` | B12 − (B8+B9+B10), B16, B11 | Σ fund balances, entries | auto lines ≠ 0 → `info` (retirement-tagged holdings) |
| property | `property.purchase`, `.value`, `.mortgage`, `.paid` | F6, F7, \|F10\|, F11 | Σ properties / loans | — |
| property | `property.paymentsPaidDerived.<sheetRef>`, `property.placeholderSlots` | — | — | `info` (`derived_input`, `placeholder_slot`) |
| snapshots | `snapshots.order`, `snapshots.period.<period>` | dates strictly increasing, one per month | stored | duplicate month → `unexplained` |
| snapshots | `snapshots.values.<period>` (one per frozen row) | all 36 History cells of that row | the 36 stored columns **read back from `tx`** | per column: money `|Δ| ≤ 1` cent vs the rounded sheet value; ratios `|Δ| ≤ 1e-9` vs the 12-significant-digit value; sign preserved; blank ↔ null. Any failing column → `unexplained`, `reason` lists the column letters (no values) |
| net_worth | `netWorth.rolling.<period>.assets` / `.total` (Net Worth K:P rows for frozen snapshots) | L, P | recomputed from stored snapshot cents: L = B+F+J+N+AF+AJ; P = L+Q−\|U\|−\|AB\|+X | — |
| net_worth | `netWorth.cash`, `.super`, `.property`, `.otherAssets` | C8, C10, C11, C9 | imported totals | — |
| net_worth | `netWorth.liabilities` | E23, **plus \|LiabilitiesDebts!G17\| when column G was skipped** (D2) | −Σ loan current balances | the G slot itself is reported by `liabilities.cgtSlot` (`explained`, `feature_dropped`, D2) when ≠ 0 |
| net_worth | `netWorth.totalAssets`, `netWorth.total` | C12, D15 | Σ app-side `holdings.value.*` + cash + other assets + super + property; minus liabilities for the total | diff equal (within tolerance) to the summed diffs of `holdings.value.*` checks explained by `sheet_error_value` → `explained` `sheet_error_value` |
| net_worth | `netWorth.gain.<class>` | D4:D11 | null | `info` `derived_later_stage` |
| settings | `settings.sheetOptions.<id>` (all 44), `settings.<key>` for the other sources | cell value — **except secret IDs (1, 29): `expected`/`actual`/`diff` null, label = sheet label only** | stored value / "not imported" | `secret_not_imported`, `setting_not_imported`, `feature_dropped`, `obsolete_setting` (with decision refs); "only when typed" overrides holding the default formula → `info` `formula_default`, no value comparison |
| exclusions | `exclusions.<sheetRef>` | — | — | `exclusion_d22`, `exclusion_d23`, `feed_row` |
| corrections | `corrections.<id>` | original value | corrected value | `correction` / unmatched → `unexplained` |
| suspects | `suspects.<entity>.<sheetRef>` | — | flags | status `suspect` |
| (any) | `*.skipped.<sheetRef>` | — | — | `live_row_skipped`, `blank_row`, `unnamed_row` → `info` |

**Sheet key-row counts (`counts.*` expected side).** A row counts when its **key cell** is non-blank (§4.2 rule 5); other non-blank cells (a `FALSE` checkbox, a category, a `0`) never make a row count. The expected side is computed by the reconciler from the reader, independently of the extractors.

| Entity | Expected (sheet) |
|---|---|
| `instruments.<kind>` | watch rows with a non-blank A (row 2 → terminator) **+ distinct ledger symbols not in the watch table** (ledger-only instruments). Actual = instruments written; a shortfall equal to the D22/D23/feed exclusions of that kind → `explained` (reason lists the exclusion codes and counts) |
| `trades.<kind>` | ledger rows with a non-blank A; also compared with `Capital Gains!AA8:AA11` when that sheet exists |
| `dividends` | rows 4 → 500 with a non-blank payment date (A) |
| `cash-accounts` | Cash rows 2 → the row before `ℹ️` with a non-blank A |
| `budget-items` | Budget rows 8 → the `Cash Savings -` row with a non-blank A |
| `yearly-expenses` | rows 32 → 60 with a non-blank name and a numeric amount |
| `income-streams` | 2 (the two stream columns) |
| `side-income` | numeric G/H cells (incl. 0) on rows with a date in F |
| `period-notes.<kind>` | non-blank note cells with a date on the same row (Cash Q/H, Super F/E, Side Income J/F) |
| `snapshots` | History rows with a date in A **and no formula in B** (live rows are reported separately as `info`) |
| `other-assets` | Other Assets rows 3 → 500 with a non-blank F |
| `super-funds` | `Super!A2:A7` non-blank |
| `super-entries` | number of non-zero cells among `Super!B11`, `B16` |
| `properties` | Property slots D…O meeting the §4.3 import predicate |
| `loans` | property slots with row 28 or 29 ≠ 0 + LiabilitiesDebts columns with a non-zero row 16/17 (excluding a skipped G) + a non-zero Net Worth row 22 |
| `settings` | registry keys whose source cell is present and yields a value (formula-default overrides and secrets excluded) |

Report `totals` counts every status. The report is stored in `import_runs.report_json` and shown in the app; it is never written to a committed file.

### 4.10 CLI (`apps/server/src/cli/import.ts`, importer owner)
- `pnpm import:workbook [file.xlsx] [--dry-run] [--yes] [--corrections <file> | --no-corrections] [--json]` (the usage text the CLI prints uses this exact command; never `pnpm import`, a pnpm built-in).
- The module exports `main(argv: string[], io?: { stdout; stderr; env; cwd }): Promise<number>` (returns the exit code) and calls it only when run directly (`import.meta.url` = the entry file), so tests call `main()` in-process instead of spawning `tsx`.
- Corrections: `--corrections <file>` → `{ kind: 'file' }`; `--no-corrections` → `{ kind: 'off' }`; neither → the config's `importCorrections` (env `IMPORT_CORRECTIONS_FILE`, default `auto`).
- Workbook: the argument, else `findWorkbookInDir(<repoRoot>/reference)`; none → exit 2 "No .xlsx in reference/; pass a path"; several → exit 2 listing basenames. **Never a hard-coded filename.**
- `loadConfig()` for `DATA_DIR` (same rules as the server), `openDatabase`, `runMigrations`.
- Existing domain data and no `--yes` (and not `--dry-run`) → exit 3 "This replaces the imported data; re-run with --yes". With `--yes`: `backupBeforeImport` first.
- Prints: file, as-of date, rows per entity, totals per status, every `unexplained` and `suspect` check label, the run id and "Open /import in the app for the full report". `--json` prints `ImportResult` instead.
- Exit codes: 0 succeeded with 0 unexplained · 4 succeeded with unexplained > 0 · 1 failed · 2 usage/config/corrections error · 3 confirmation required.
- Safe with the server running (WAL + busy timeout); the server picks up the new data on its next request.

---

## 5. Price service spec (`apps/server/src/market/**`, `src/scheduler/**`, `src/routes/prices.ts`)

### 5.1 Frozen interfaces (Scaffolder writes `market/types.ts` and `scheduler/types.ts`)
```ts
export interface Clock { now(): Date; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void }
export interface MarketDataService {
  refresh(opts?: { instrumentIds?: number[]; force?: boolean; trigger?: JobTrigger }): Promise<RefreshSummary>; // throws MarketDataDisabledError in mode 'off'
  getPrices(): PricesResponse;
  getSeries(): MarketQuoteItem[];
  setManualPrice(instrumentId: number, input: ManualPriceInput): PriceItem;   // throws HttpError(404) when unknown
  clearManualPrice(instrumentId: number): PriceItem;
  setPriceSource(instrumentId: number, input: PriceSourceInput): PriceItem;
  notifyInstrumentsChanged(): void;           // schedules a refresh in ~5 s (mode live/fake), coalesced
  status(): { mode: MarketDataMode; running: boolean; lastRefreshAt: string | null; nextRefreshAt: string | null };
}
export class MarketDataDisabledError extends Error { readonly code = 'MARKET_DATA_DISABLED' }
export function createMarketDataService(o: { db: JoinrDb; config: Pick<Config, 'marketDataMode' | 'priceRefreshMinutes'>;
  log: FastifyBaseLogger; scheduler: Scheduler; fetchImpl?: typeof fetch; clock?: Clock }): MarketDataService;
export const pricesRoutes: FastifyPluginAsync<{ market: MarketDataService }>;   // registered with prefix '/api'

// scheduler/types.ts
export interface JobContext { signal: AbortSignal; trigger: JobTrigger; now: () => Date; log: FastifyBaseLogger }
export interface JobResult { status: 'succeeded' | 'partial' | 'failed'; detail?: Record<string, unknown>; error?: string }
export interface JobDefinition { name: JobName; intervalMs: number /* 0 = manual only */; initialDelayMs?: number;
  run(ctx: JobContext): Promise<JobResult> }
export interface Scheduler {
  register(job: JobDefinition): void; start(): void; stop(): Promise<void>;
  run(name: JobName, trigger?: JobTrigger): Promise<{ jobRunId: number; result: JobResult }>; // joins an in-flight run
  isRunning(name: JobName): boolean; nextRunAt(name: JobName): Date | null; lastRun(name: JobName): JobRunSummary | null;
}
export function createScheduler(o: { db: JoinrDb; log: FastifyBaseLogger; clock?: Clock }): Scheduler;

// app.ts (frozen wiring)
export interface AppServices { scheduler: Scheduler; market: MarketDataService }
export interface ServiceDeps { database: AppDatabase; log: FastifyBaseLogger; config: Config }
export type ServicesFactory = (deps: ServiceDeps) => AppServices;
// BuildAppOptions keeps its Stage 0 fields (config, db: AppDatabase, version?, now?) and gains:
//   services?: ServicesFactory
export function defaultServices(deps: ServiceDeps): AppServices; // createScheduler + createMarketDataService (config mode)
export function offServices(deps: ServiceDeps): AppServices;     // default when `services` is omitted (tests): mode 'off', no timers
```
Wiring (server-api owns `index.ts`/`app.ts`, the Scaffolder writes it first): the logger exists only inside `buildApp` (`Fastify({ logger })`; pino is not a direct dependency of the server and must not be imported), so **`buildApp` builds the services** by calling `options.services ?? offServices` with `{ database: db, log: app.log, config }`, decorates `app.market` / `app.scheduler`, and registers the routes with them. `index.ts` calls `buildApp({ config, db, services: defaultServices })`, then `listen`, then `app.scheduler.start()`. Shutdown: `buildApp` registers **`app.addHook('preClose', () => scheduler.stop())`** (before the existing DB-closing `onClose`), so an in-flight price run is aborted and awaited before the database closes. No hook is added after `ready()`/`listen()`.

### 5.2 Providers (`market/providers/*.ts`; all take an injected `fetchImpl`)
```ts
export interface QuoteRequest { key: string; symbol: string }
export interface Quote { key: string; price: string; currency: string; asOf: string }
export interface QuoteFailure { key: string; error: string; retryable: boolean; rateLimited?: boolean }
export interface PriceProviderClient { id: 'yahoo' | 'coingecko' | 'fake';
  fetchQuotes(reqs: QuoteRequest[], signal: AbortSignal): Promise<{ quotes: Quote[]; failures: QuoteFailure[] }> }
```
- **Yahoo chart:** `GET https://query1.finance.yahoo.com/v8/finance/chart/{encodeURIComponent(symbol)}?range=5d&interval=1d` with a fixed browser-like `User-Agent` and `Accept: application/json`; per-request timeout 10 s (`AbortSignal.timeout` combined with the run signal); concurrency 2; 250 ms spacing. Parse `chart.result[0].meta`: `regularMarketPrice` (finite > 0), `currency`, `regularMarketTime` (unix s → ISO). Fallback price: last non-null `indicators.quote[0].close` with its timestamp. `chart.error` / 404 → "Symbol not found"; 429/403 → `rateLimited`; 5xx/timeout → retryable. Symbols: `ABC.AX` (ASX), futures `SI=F`/`GC=F`, FX `AUDUSD=X`, `<CCY>AUD=X`.
- **Every provider request** (Yahoo, CoinGecko `/simple/price` and `/search`, FX) uses `AbortSignal.any([AbortSignal.timeout(10_000), runSignal])`; no request can outlive 10 s.
- **CoinGecko:** one batched `GET https://api.coingecko.com/api/v3/simple/price?ids=<comma ids>&vs_currencies=aud&include_last_updated_at=true` (≤ 100 ids per call); missing id → failure "Unknown CoinGecko id". Id resolution: `GET /api/v3/search?query=<SYMBOL>` → among `coins` with `symbol` equal (case-insensitive), pick the lowest non-null `market_cap_rank`; persist `provider_symbol` with `symbol_origin='search'`; ≤ 5 searches per run, 2 s apart; no match → failure "No CoinGecko match for <SYMBOL>". The owner can overwrite the id (`PUT …/source`, `symbol_origin='user'`). **No coin ids other than BTC/ETH in committed code.**
- **Fake** (`MARKET_DATA_MODE=fake`; e2e, demos without network): deterministic — AUD price = `1 + (fnv1a(symbol) % 99900) / 100`; `SI=F`/`GC=F` in USD; `AUDUSD=X` = `0.65`; search returns `symbol.toLowerCase()`; `asOf` = clock now.
- Unit tests mock `fetchImpl` with generic JSON shaped like the real responses. A server-test setup file makes the global `fetch` throw.

### 5.3 FX and bullion (D23, D25)
- Each run fetches the built-in series first: `AUDUSD=X`, `SI=F`, `GC=F`; derives `XAG_AUD_OZ` = SI / AUDUSD and `XAU_AUD_OZ` = GC / AUDUSD (`source='derived'`, `as_of` = the older input's). Stage 4 reads these for bullion other assets.
- Instrument conversion to AUD: `AUD` → as is; `USD` → ÷ AUDUSD; `GBp`/`GBX` → ÷ 100 then GBP; any other `<CCY>` → × `FX_<CCY>AUD` (Yahoo `<CCY>AUD=X`), fetched on demand in the same run. Missing FX → failure "No FX rate for <CCY>". Store `native_price`, `native_currency`, `fx_rate`.

### 5.4 Refresh algorithm (job `prices`)
1. Mode `off` → `MarketDataDisabledError`. A run in flight → join it.
2. Load instruments, `price_sources`, `prices`, held units (`heldUnitsByInstrument`, Scaffolder helper; held = units > 0).
3. Targets = (`held` or `is_watched`) and provider ≠ `none` (or the requested ids). Without `force`, skip instruments in backoff: `consecutive_failures ≥ 3` and `now − last_attempt_at < min(2^(n−3) h, 24 h)`. Manual "Refresh now" sends `force: true` (ignores backoff, not provider cool-down).
4. Resolve missing CoinGecko ids (§5.2). 5. Series, then instruments by provider, then extra FX. 6. Convert. 
7. Write everything in **one synchronous transaction**; upsert `prices` only for instruments that still exist (an import may have replaced them); success → `price`, `as_of`, `fetched_at`, `source`, `last_status='ok'`, `consecutive_failures=0`, `last_error=null`; failure → `last_status='error'`, `last_error`, `consecutive_failures+1`, keep the last good price. Rate-limited requests are counted as skipped, not failures.
8. Provider cool-down on 429/403: skip that provider until `Retry-After` or 15 min (in memory).
8a. **Run deadline 90 s** (`RUN_DEADLINE_MS`, injectable for tests): when it passes, pending requests are aborted, instruments not yet fetched are counted as `skipped`, and whatever succeeded is still written (step 7). `POST /api/prices/refresh` therefore returns within ~90 s.
9. `job_runs` result: `succeeded` (no failures), `partial`, or `failed` (all failed / fatal), with `detail = { requested, ok, failed, skipped, byProvider }`.

### 5.5 Scheduler
- `PRICE_REFRESH_MINUTES` (default 60; **0 in `NODE_ENV=test`**; 0 disables the timer but manual refresh works). First scheduled run 15 s after `start()`, then every interval (setTimeout chain, `unref()`). No overlapping runs per job; `run()` joins. `stop()` clears timers, aborts the run signal and awaits it. Every run writes `job_runs`; keep the newest 500 rows per job. Injectable `Clock` for tests (fake timers).
- Stage 5 (month-end snapshot) and Stage 7 (backups) register further jobs; nothing in the scheduler is price-specific.

### 5.6 Status (computed per item, never stored)
```
manual set                     → age(manual_price_as_of) ≤ 31 days ? 'manual' : 'stale'
no good price                  → last_status = 'error' ? 'failed' : 'none'
source = 'sheet'               → 'stale'        ("From workbook dd/mm/yyyy")
fresh(as_of)                   → 'fresh'
otherwise                      → last_status = 'error' ? 'failed' : 'stale'
fresh(as_of): crypto → now − as_of ≤ 3 h;  Yahoo instruments and series → as_of ≥ previousWeekdayStart(now)
previousWeekdayStart(now) = 00:00 local on the most recent Mon–Fri strictly before today (Mon → Fri, Sat/Sun → Fri)
```
Public holidays are ignored (a holiday shows `stale` for a day; documented). **"Every held instrument gets a price or is visibly flagged"** = for every held instrument, `status ∈ {fresh, manual}` or the UI shows a `stale`/`failed`/`none` badge with the reason (`lastError`, "No price source", "From workbook").

---

## 6. Web spec (`apps/web`)

### 6.1 Routes and nav
- `pages.ts`: `NavGroupId` gains `'records'` (label "Records"), placed between Planning and Settings. New `PageDef`s (stage 1): `{ id: 'records', path: '/records', title: 'Records' }`, `{ id: 'import', path: '/import', title: 'Import' }`, `{ id: 'prices', path: '/prices', title: 'Prices' }`. `pageForPath` also matches sub-routes by prefix (`/records/trades` → Records; `/import/runs/7` → Import).
- Icons (lucide, verified present): Records `Table2`, Import `FileSpreadsheet`, Prices `BadgeDollarSign`.
- Router: `/records` (index), `/records/$entity` (`beforeLoad` rejects ids outside `RECORD_ENTITY_IDS` with `notFound()`), `/import`, `/import/runs/$runId` (positive int), `/prices`. Each page renders `PageHeader` with an `h1` equal to its title (the smoke spec asserts it) and works on an empty database.
- No folder named `data` anywhere: `src/api/`, `src/pages/records/`, `src/pages/import/`, `src/pages/prices/`.

### 6.2 API layer (`src/api/`)
- `client.ts`: `apiGet<T>(path)`, `apiSend<T>(method, path, body?)`, `apiUpload<T>(path, file, query)`; non-2xx → `ApiError { status, code, message }` from `ApiErrorBody`.
- `hooks.ts` (TanStack Query) with keys `['records']`, `['records', id]`, `['import', 'runs']`, `['import', 'run', id]`, `['prices']`, `['status']`. Import success invalidates records, import, prices, status; price mutations invalidate prices + status. `usePrices` refetches every 60 s while the page is visible.
- DTO types are imported with `import type` from `@joinr/schema`; only plain constants (e.g. `RECORD_ENTITY_IDS`) are value imports.

### 6.3 Records (read-only data browser; one generic table)
- `/records`: `PageHeader` "Records" (sub-line "Imported data, read-only"), then per group a `SectionBar` (supporting) and a `Card` with a list of entity links + counts (`KeyValueTable`, numeric). Empty DB → `Callout note`: "Nothing imported yet. Run an import." with a link to `/import`.
- `/records/$entity`: `PageHeader` "Records" with subtitle = entity label; an entity switcher (`Select` on phone, link list on desktop); a `ColumnTable` built from `RecordsPageResponse.columns`: first column sticky, numeric types right-aligned mono, sortable columns, caption = entity label, `emptyMessage` "No rows in this table."
- Cell renderers by `RecordColumnType`: `money` → `<Amount cents/>`; `quantity` → `formatQuantity(v, { maxDp: 8 })`; `price` → `formatPrice(v, { maxDp: 8 })`; `ratio` → `formatPercent(Number(v), { dp: 2 })`; `date` → `formatDate`; `month` → `formatMonth`; `timestamp` → `dd/mm/yyyy HH:mm`; `boolean` → "Yes"/"No"; `flags` → one `StatusBadge status="check"` per flag with a readable label ("Out of order", "Price outlier", …); `setting` → formatted by the row's `valueType`; null → "—" muted.

### 6.4 Import (`/import`, `/import/runs/$runId`)
- `/import`: `PageHeader` "Import" (sub-line "Bring in the workbook export"). Card "Import a workbook": file picker (`jf-app-file`, accepts `.xlsx`), buttons **Preview** (dry run, secondary) and **Import** (primary). When `hasImportedData`: `Callout important` "Importing replaces the investments, cash, budget, income, assets and history you imported before. A backup is taken first." plus a required `Checkbox` "Replace the imported data". Busy state: button `aria-busy`, disabled. Result: summary tiles + link to the run. Errors → `Callout do-not` with the API message.
- Runs table (`ColumnTable`): Started (dd/mm/yyyy HH:mm), File, Kind (`Pill` "Dry run"/"Import"), Status (`StatusBadge`: succeeded → `go` "Succeeded", failed → `stop` "Failed", running → `pending` "Running"), Unexplained (numeric; the key figure when > 0), Suspect, Explained, Match; row links to the report.
- `/import/runs/$runId`: `PageHeader` "Import" with subtitle "Run #n · <file>". `Grid` of `StatTile`s: Checks, Match, Explained, Suspect, **Unexplained** (`keyFigure`). Filters (`Cluster` of `Button`s with `aria-pressed`): All · Unexplained · Suspect · Explained · Match · Info; plus a section `Select`. Checks grouped by section (`SectionBar` + `ColumnTable`: Check, Sheet ref, Expected, Actual, Diff, Status, Reason). Status mapping: match → `go` "Match"; explained → `recorded` "Explained"; suspect → `check` "Suspect"; unexplained → `stop` "Unexplained"; info → `Pill tone="na"` "Info". Expected/Actual/Diff formatted by `unit` (cents → Amount, units → quantity, ratio → percent, date → dd/mm/yyyy). Failed run → `Callout do-not` with the error.

### 6.5 Prices (`/prices`)
- `PageHeader` "Prices", actions: **Refresh now** (`RefreshCw`, `aria-busy` while running; hidden/disabled with a note in mode `off`). Freshness line: "Refreshed 14:32 · next 15:32" or "Not refreshed yet"; mode `fake` shows `Pill` "Test prices".
- `Switch` "Held only" (default on). `ColumnTable`: Instrument (symbol + muted name), Kind (`Pill`), Held units, Price (`formatPrice`), Source ("Yahoo", "CoinGecko", "Manual", "From workbook"), As of (dd/mm/yyyy HH:mm), Status (`StatusBadge`: fresh → `fresh`; stale → `stale`; failed → `failed`; none → `failed` "No price"; manual → `go` "Manual"), Last error (muted), Actions (`Button` ghost "Set price", "Source").
- Set price: inline `Card` form — `NumberField` price (maxDp 8, required), `DateField` as-of (default today), `TextField` note; Save / Clear manual price. Source: `Select` provider + `TextField` symbol ("CoinGecko id" hint for crypto). Validation errors from the API show under the fields.
- Card "Market series" (`KeyValueTable`): AUD/USD, silver AUD/oz, gold AUD/oz (+ raw USD futures), each with its status badge and as-of.
- Refresh result → `Callout note` "Refreshed 18 prices; 1 failed."

### 6.6 Header freshness (RootLayout)
From `GET /api/status`: freshness "Prices 14:32 · Snapshot Aug 2026" (price time today → `HH:mm`, else `dd/mm/yyyy`); no prices → "No prices yet"; no snapshots → "No snapshots yet" (so an empty DB still reads "No prices yet · No snapshots yet"). While loading or when `/api/status` fails, show the empty text (never an error in the header). Footer right: "Last snapshot Aug 2026 · Prices 14:32" (or "—").

### 6.7 Layout rules
STYLE_GUIDE §8 formats everywhere (money `$12,480.00` in tables, U+2212 negatives in the stop tint, 1-dp percentages in tiles, dd/mm/yyyy). Status never colour-only. At 375 px: one column, tables scroll inside their container, filter buttons wrap, forms stack, **no page-level horizontal scroll**. App CSS only in `app.css` with `jf-app-*` classes.

---

## 7. Roles, tasks and FILE OWNERSHIP

### 7.0 Rules (all agents)
- Edit **only** files you own (§7.1). Need a change elsewhere? Report it; the coordinator routes it. Do not work around a contract gap by editing another owner's file.
- **Contracts in §2, §3, §4.1, §5.1 are frozen.** Adding internal modules in your own area is fine; changing frozen names, fields or signatures is not.
- **No installs** after the Scaffolder (lockfile collisions). Missing package → stop and report.
- Stubs the Scaffolder creates become the named owner's files; replace them in place.
- Run only your own scope while others work: `pnpm vitest run --project importer`, `pnpm vitest run --project server apps/server/test/market`, `pnpm exec eslint packages/importer --max-warnings=0`, `pnpm --filter @joinr/web typecheck`. Keep your files compiling at every step.
- **Privacy:** never paste owner values (from the workbook, the report, the CLI output or `docs/private/`) into a tracked file, test, fixture, comment or commit-ready doc. Run `pnpm guard:all` before you finish.
  - **No snapshot files:** tests never use `toMatchSnapshot`/`toMatchInlineSnapshot`/`toMatchFileSnapshot` (they would write report or workbook values into tracked `__snapshots__`). Assert explicit fields instead.
  - **Check ids can be private:** ids such as `holdings.units.<kind>.<SYMBOL>` embed the owner's symbols when the report comes from the owner's workbook. In anything that may reach a committed doc (final reports, Scaffold/Stage close notes, HANDOFF), give counts per section/status, or sheetRefs, never symbol-bearing ids.
  - **Coordinator pre-step (before the Scaffolder starts):** add the distinctive Stage 1 owner values listed in `docs/private/stage-1-private.md` §11 to `docs/private/guard-terms.txt` in both dollar and integer-cents forms, then re-run `pnpm guard:all` (must stay clean). The guard's term list otherwise holds names only and would not catch a hard-coded owner amount.

### 7.1 Ownership table (every new or changed Stage 1 file has exactly one owner)

| Owner | Files |
|---|---|
| **scaffolder** | `package.json` (scripts + devDeps) · `pnpm-lock.yaml` · `pnpm-workspace.yaml` · every `package.json` dependency/exports field · `playwright.config.ts` · `packages/schema/**` · `apps/server/drizzle.config.ts` · `apps/server/migrations/**` (new `0001_*` + `meta/`) · `apps/server/src/db/{schema.ts,database.ts,backup.ts}` · `apps/server/src/db/queries/{holdings.ts,domain.ts}` · `apps/server/src/{market,scheduler}/types.ts` · `apps/server/scripts/seed-dev.ts` · `apps/server/test/{helpers.ts,setup.ts}` · `apps/server/vitest.config.ts` · `apps/server/test/{db.test.ts,backup.test.ts,holdings.test.ts,migrations.test.ts}` · `packages/importer/{package.json,tsconfig.json,vitest.config.ts}` · `packages/importer/test/setup.ts` · `packages/importer/src/testing/localWorkbook.ts` |
| **importer** | `packages/importer/**` except the Scaffolder files above (incl. `src/index.ts`, `src/testing/{index.ts,syntheticWorkbook.ts}`, all tests and golden tests) · `apps/server/src/cli/import.ts` · `apps/server/test/cli-import.test.ts` |
| **market-data** | `apps/server/src/market/**` except `types.ts` · `apps/server/src/scheduler/**` except `types.ts` · `apps/server/src/routes/prices.ts` · `apps/server/test/market/**` · `apps/server/test/scheduler/**` · `apps/server/test/prices-routes.test.ts` |
| **server-api** | (after scaffolding) `apps/server/src/{app.ts,index.ts,config.ts,errors.ts,paths.ts,web.ts,version.ts}` · `apps/server/src/routes/{records.ts,import.ts,status.ts,health.ts}` · `apps/server/src/records/**` · `apps/server/src/db/queries/**` except the two Scaffolder files · `apps/server/src/db/meta.ts` · `apps/server/test/{app.test.ts,config.test.ts,web.test.ts,version.test.ts,records-routes.test.ts,import-routes.test.ts,import-routes.integration.test.ts,status-routes.test.ts}` · `apps/server/scripts/build.mjs` · `apps/server/package.json` scripts field · `README.md` · `docs/ARCHITECTURE.md` · `Dockerfile` · `.dockerignore` · `docker-compose.yml` |
| **web** | `apps/web/src/**` (incl. `pages.ts`, `router.tsx`, `layout/**`, `app.css`, their tests, after scaffolding) · `apps/web/test/**` · `e2e/{records,import,prices}.spec.ts` · `e2e/records-support.ts` · `e2e/import.setup.ts` (after scaffolding) · the freshness assertion in `e2e/ui-core.spec.ts` |
| coordinator | `PLAN.md` · `docs/HANDOFF.md` · `docs/DECISIONS.md` · `docs/STAGE_PROCESS.md` · `docs/stages/**` (implementers may append only to "Scaffold notes") · `CLAUDE.md` · `docs/style/**` · `docs/private/**` · `reference/import-corrections.json` |

### 7.2 Scaffolder (alone; done-check before hand-over)
1. **Dependencies** (§1.3): edit the package.json files, then `pnpm install` (no errors, no new build-approval prompts; keep pnpm-written `minimumReleaseAgeExclude` lines). `@joinr/importer` exports `".": "./src/index.ts"`, `"./testing": "./src/testing/index.ts"`; `@joinr/schema` exports `.`, `./db`, `./testing`, `"sideEffects": false`.
2. **`packages/schema`** complete per §2 (tables, enums, primitives, decimal, dates, pricing, settings, records, rows, corrections, dto, errors, testing):
   - `testing/testDb.ts`: `createTestDb(): { sqlite; db: JoinrDb; close(): void }` — `:memory:`, pragmas as `openDatabase`, migrations from `<repo>/apps/server/migrations` (path from `import.meta.url`).
   - `testing/seed.ts`: `seedGenericData(db)` — generic rows in **every** table (2–3 instruments per kind with generic symbols, trades incl. a sell and a flagged row, a linked and an unmatched dividend, cash accounts, budget items + yearly expenses, 2 streams + entries, notes, 3 snapshots, other assets incl. a bullion row, super, a property + loan, settings, one `prices` row per status, series, one import run with a small report, one job run). Idempotent (clears first).
   - `testing/dump.ts`: `dumpDomainTables(db)` → deterministic JSON of all domain tables + `settings`/`price_sources`/`prices` (for idempotency tests).
   - `fixtures/sampleDtos.ts` (§2.2): typed with the frozen DTOs (`satisfies`), generic values only, consistent with each other (ids, counts, statuses). The web builds phase A on these, so they must cover every state its pages render. A schema test type-checks and Zod-validates what has a schema.
   - `limits.ts` (`UPLOAD_LIMIT_BYTES`) and `normaliseSheetLabel` (+ tests, §2.5).
   - `sheetLabel`s: read `SheetOptions!K3:K46` and `P3:P46` (and History `B2:AK2` for the importer's header constants, if you prepare them) with a scratch SheetJS script under `artifacts/scaffolder/` (the install recipe in the stage context). **Read only K and P, never column L** (values, incl. an email and an API key). Copy the label text exactly (it is generic template text).
   - Tests: decimal/date helpers (float-noise normalisation, half-away-from-zero cents, EDATE clamping, FY boundaries, `previousWeekdayStart` across weekends), registry integrity (unique keys; SheetOptions IDs 1–44 each in exactly one of `SETTINGS`, `SHEET_OPTIONS_NOT_IMPORTED`, `SHEET_OPTIONS_VALIDATED`, each with a non-empty `sheetLabel`; secret IDs 1 and 29 flagged `secret: true`), record registry (unique column ids per entity; every entity has a table), `derivePriceSource` cases, corrections schema, Zod ↔ Drizzle insert parity (type-level test).
3. **Migration:** `drizzle.config.ts` `schema: '../../packages/schema/src/db/tables/*.ts'`; `pnpm --filter @joinr/server db:generate --name stage1_core` → `0001_stage1_core.sql` + meta. Verify `git diff --exit-code apps/server/migrations/0000_app_meta.sql apps/server/migrations/meta/0000_snapshot.json`. Tests: fresh DB applies 2 migrations; a DB migrated to `0000` only upgrades cleanly; FKs cascade as specified.
4. **Server scaffolding:** `db/schema.ts` → re-export; `Db` = `JoinrDb`; `db/backup.ts` (`backupBeforeImport(database, dataDir, now?)`, `VACUUM INTO`, keep 10) + test; `db/queries/holdings.ts` (`heldUnitsByInstrument(db): Map<number, string>` via decimal.js) + test; `db/queries/domain.ts` (`hasDomainData(db)`, `markInterruptedRuns(db, now)`) + test.
   - `config.ts` additions (+ tests): `PRICE_REFRESH_MINUTES` (int 0–1440; default 60, 0 when `NODE_ENV=test`), `MARKET_DATA_MODE` (`live|fake|off`; default `live`, `off` when test), `IMPORT_CORRECTIONS_FILE` (unset → `auto`; `none` → `off`; other → file path, relative → repo root; parsed with `correctionsSettingFromEnv` from `@joinr/schema`, so config never loads the importer). `Config` gains `priceRefreshMinutes`, `marketDataMode`, `importCorrections: CorrectionsSetting`, `repoRoot: string | null` (`paths.ts`: `ConfigBase` gains `workspaceRoot: string | null` = `findRepoRoot(SERVER_DIR) ?? null`; `Config.repoRoot` = that, **never** the `process.cwd()` fallback). Update `test/helpers.ts` `testConfig()` (mode `off`, 0 min, `{ kind: 'off' }`, `repoRoot: null`).
   - `errors.ts`: `parseWith(schema, value)`; `ApiErrorBody` re-exported from `@joinr/schema`.
   - Stubs with frozen signatures: `market/types.ts` (real, §5.1), `market/index.ts` (`createMarketDataService` returning a mode-`off` service whose methods throw "not implemented" except `status()`), `scheduler/types.ts` (real), `scheduler/index.ts` (`createScheduler` minimal: register/run/stop without timers), `routes/{prices,records,import,status}.ts` (every route answers 501 `NOT_IMPLEMENTED` in the standard error shape), `cli/import.ts` (prints "not implemented", exit 1).
   - `app.ts`: the frozen services wiring of §5.1 (`BuildAppOptions.services?`, `defaultServices`, `offServices`, services built from `app.log`, `preClose` → `scheduler.stop()`); registers `recordsRoutes`, `importRoutes`, `statusRoutes`, `pricesRoutes` with prefix `/api` (options `{ database, config, market }` / `{ market }`). `index.ts`: `markInterruptedRuns` after migrations, `buildApp({ …, services: defaultServices })`, `app.scheduler.start()` after listen. A test proves `app.close()` stops the scheduler before the DB closes.
   - `test/setup.ts` (fetch guard) wired in `apps/server/vitest.config.ts` and `packages/importer/vitest.config.ts` (`setupFiles`). `packages/importer/vitest.config.ts` also sets `testTimeout: 30_000` (golden and CLI tests set their own longer timeouts, §7.3).
   - `scripts/seed-dev.ts` (`pnpm seed:dev`: loadConfig → open → migrate → `seedGenericData`).
5. **Importer skeleton:** `src/index.ts` with every §4.1 export (functions throw `new Error('importer: not implemented')`; `findWorkbookInDir`/`resolveCorrectionsPath` may be real); `src/testing/index.ts`; `src/testing/localWorkbook.ts` real (`LOCAL_WORKBOOK_PATH` = the single `*.xlsx` in `<repo>/reference`, else null; `describeWithLocalWorkbook` = `describe.skipIf(!path)`); `src/testing/syntheticWorkbook.ts` stub (`SYNTHETIC_WORKBOOK_IMPLEMENTED = false`, `IMPORTER_IMPLEMENTED = false`, `buildSyntheticWorkbook` throws; both flags live in this file because it imports only `xlsx`, so Playwright can read them too).
6. **Web scaffolding:** `pages.ts` (+ `pages.test.ts`) with the `records` group and 3 PageDefs; `nav.ts` icons. The existing router maps them to `PlaceholderPage`, which satisfies the smoke spec until the web owner replaces them.
7. `playwright.config.ts`:
   - `webServer.env` adds `MARKET_DATA_MODE: process.env.MARKET_DATA_MODE ?? 'fake'`, `PRICE_REFRESH_MINUTES: process.env.PRICE_REFRESH_MINUTES ?? '0'` and **`IMPORT_CORRECTIONS_FILE: process.env.IMPORT_CORRECTIONS_FILE ?? 'none'`** (the synthetic workbook must never meet the owner's corrections file).
   - A **`setup` project** (`testMatch: /.*\.setup\.ts/`) that `desktop` and `phone` depend on (`dependencies: ['setup']`); `desktop`/`phone` get `testIgnore: /.*\.setup\.ts/`. Stub `e2e/import.setup.ts`: one test that imports the synthetic workbook via `POST /api/import?confirmReplace=true`, skipped while `!SYNTHETIC_WORKBOOK_IMPLEMENTED || !IMPORTER_IMPLEMENTED` (read from `packages/importer/src/testing/syntheticWorkbook.ts` directly). The web owner takes the file over.
   - Keep `reuseExistingServer: true` (the Verifier checks the port is free first, §10).
8. Root scripts (§1.4). Confirm `git check-ignore reference/import-corrections.json` prints the path.
9. **Done-check:** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` (≥ 670 existing + new), `pnpm build`, `pnpm guard:all` all green; `PORT=3070 WEB_PORT=5170 DATA_DIR=artifacts/scaffolder/data pnpm e2e e2e/smoke.spec.ts` passes; `/api/health` shows `migrations: 2`; `DATA_DIR=artifacts/scaffolder/data pnpm seed:dev` exits 0 and a schema test proves `seedGenericData` fills every table; ports 5170/3070 free afterwards. Append "Scaffold notes" (below) with every deviation.

### 7.3 importer
1. `buildSyntheticWorkbook(opts)` **first** (others consume it), then set `SYNTHETIC_WORKBOOK_IMPLEMENTED = true`. Set `IMPORTER_IMPLEMENTED = true` **only after** your own clean-synthetic-workbook import test passes (it gates the server integration test and the e2e setup).
   - **SheetJS refuses to write a sheet named `History`** (a reserved Excel name: `book_append_sheet` and `XLSX.write`'s `check_wb` both throw "Sheet name cannot be 'History'"; no option disables it). Write that sheet under a temporary name (e.g. `HistoryTmp`), then post-process the bytes with the bundled `XLSX.CFB`: `CFB.read(bytes, { type: 'array' })` → find the entry whose full path ends with `xl/workbook.xml` → replace `name="HistoryTmp"` with `name="History"` → `CFB.write(zip, { fileType: 'zip', type: 'array' })`. No new dependency. `opts.mutate` runs **before** the rename (it sees the temporary name; export a `SYNTHETIC_HISTORY_TMP` constant or a `historySheet(wb)` helper). A test asserts `readWorkbook(buildSyntheticWorkbook()).sheetNames` includes `History` with cells, formulas and cached values intact. Reading a real `History` sheet is unaffected (the check is write-only). Template-v2.15 layout with every sheet/anchor of §4.3, generic data only (`ASX:ABC`, `ASX:XYZ`, `ASX:DEF`, an exited `ASX:OLD`, `EXAMPLEFUND`, BTC, ETH; "Example Bank – Everyday"). Cached cells (held units, totals, History, Net Worth rolling rows, Capital Gains counts, SheetOptions IDs 1–44 with `InsertHere` as the API-key placeholder and an `example.com` email) are **consistent**, so the clean workbook reconciles with zero unexplained. It must cover: blank rows inside tables, float-noise numbers, formula-blank `""` cells, `#VALUE!`/`#ERROR!` strings, sentinels (`-`, `Enter Freq`), a text dividend frequency, a typed manual price, a D22-style duplicate feed row, `SI=F`/`GC=F` feed rows, bullion-linked other assets (K formula chain), a hyperlink description, a ledger-only instrument, a live History row, a dividend needing re-keying, a stale budget account name, an unnamed Budget row with a category, placeholder Property slots, a Property row-30 formula, a formula-default override (Budget `D3`), SheetOptions labels with an internal newline and a trailing colon. `opts.variant: 'clean' | 'faulty'` (faulty: out-of-order row, price outlier, oversell, unmatched dividend, a units mismatch, a movement mismatch, a duplicate snapshot month) and `opts.mutate?(wb)` for edge tests. Formulas are written as `{ t, v, f }` so the reader sees them.
2. Reader (§4.2) + extractors per tab (§4.3) into a pure sheet model; layout constants in one module.
3. Corrections, exclusions, suspects, re-keying (§4.4–4.7).
4. Writer with replace semantics (§4.8) and the reconciliation checks (§4.9); `importWorkbook` orchestration and `import_runs` bookkeeping.
5. CLI (§4.10).
6. Tests (synthetic only, no network): clean → 0 unexplained and expected counts; each faulty case → the expected status/reason; idempotent re-import (`dumpDomainTables` equal, ids included); dry run leaves `dumpDomainTables` unchanged but records the run; corrections applied / unmatched / invalid file; D22/D23/feed exclusions; bullion link; dividend re-keying; settings mapping incl. never storing the secret or email (assert the placeholder string appears in no table: scan every text column); price seeding rules and re-import preservation of `user` overrides and `search` ids; reader rules (float noise, serial dates, error strings, blanks); **spill rule**: a mutate case putting a numeric `Crypto!B3` with no formula (and a numeric `B2` formula) → the coin gets a seeded `sheet` price and **no** manual price; label normalisation (newline, trailing colon, dash variants) → `match`; a mutate case with non-zero `LiabilitiesDebts!G17` → `liabilities.cgtSlot` `explained` and `netWorth.liabilities` still reconciles; formula-default overrides → `info`, nothing stored; `snapshots.values.*` all `match` on the clean workbook and a mutate case that swaps two History value columns → the header check fails the import; per-entity `counts.*` all `match`/`explained` on the clean workbook; CLI exit codes via in-process `main(argv)` (temp DATA_DIR, synthetic file, **`--no-corrections` or a synthetic corrections file** — never the auto fallback), with at most one spawned `tsx` smoke test (`{ timeout: 60_000 }`).
7. **Golden** (`test/golden.test.ts`, `describeWithLocalWorkbook`, `{ timeout: 120_000 }` on the describe): import the local workbook with `reference/import-corrections.json` when present → `totals.unexplained === 0`; counts equal the workbook's own count cells (Capital Gains AA8:AA11, History frozen rows); every held watch row's units check `match`; **every `snapshots.values.<period>` check `match`** (all 36 columns, expected values read from the workbook at runtime); idempotent second import; report stable. **No owner values in the test file** — expectations come from the workbook at runtime; no snapshot files (§7.0).
8. Run the CLI on the local workbook with `DATA_DIR=artifacts/importer/data` and compare with `docs/private/stage-1-private.md`. Import of the real workbook < 5 s.

### 7.4 market-data
1. Providers (yahoo, coingecko, fake) + tests with mocked `fetchImpl` (success, missing price, `chart.error`, 404, 429 with `Retry-After`, timeout via aborted signal, malformed JSON).
2. FX/series/bullion derivation; status/freshness pure functions (clock injected: Monday/Saturday/Sunday cases, crypto 3 h, manual 31 days, sheet source).
3. Service (§5.4): targets, backoff, cool-down, CoinGecko id resolution + persistence, one write transaction, instruments deleted mid-run, manual override set/clear/precedence, source edit, `notifyInstrumentsChanged` coalescing, `getPrices` ordering and held units.
4. Scheduler (generic) + `job_runs` persistence; fake-timer tests: interval, initial delay, no overlap, `run()` joins, `stop()` aborts and waits, interval 0.
5. `routes/prices.ts` + route tests (`app.inject`, `seedGenericData`), incl. 400/404/503 shapes.
6. Live smoke (network allowed in a **scratch script only**, not in tests): call the Yahoo provider for a public ASX ETF symbol, `AUDUSD=X`, `SI=F`, and CoinGecko for BTC/ETH; record the observed shapes in your final report.

### 7.5 server-api
1. Records: registry-driven queries/serialisation (`src/records/**`), `GET /api/records` and `/:entity` + tests with `seedGenericData` (every entity returns its registry columns; money as integer cents; decimals as strings; unknown entity 404).
2. Import routes (§3.4): content-type parser, `UPLOAD_LIMIT_BYTES` limit (test: `UPLOAD_LIMIT_BYTES + 1` bytes → 413, exactly the limit → not 413), 409/413/415/422 paths, lock, confirm, dry run, corrections resolution (`off`/`file`/`auto` with temp folders), backup, `notifyInstrumentsChanged`, `ImportRunsResponse`. Unit tests inject a fake importer. `import-routes.integration.test.ts` uses the real importer and `buildSyntheticWorkbook()` and is wrapped in `describe.skipIf(!SYNTHETIC_WORKBOOK_IMPLEMENTED || !IMPORTER_IMPLEMENTED)` (the Verifier confirms it ran). Never edit the gate or the flags to make your suite green mid-stage.
3. `GET /api/status`; stale-run cleanup at start-up (`markInterruptedRuns`).
4. Finalise `app.ts`/`index.ts` wiring; keep Stage 0 behaviour (health, SPA fallback, JSON 404s, security headers).
5. Docs: README (new scripts, env vars, import workflow, corrections file location, price modes) and `docs/ARCHITECTURE.md` (package graph incl. schema/importer, import flow, price service, scheduler). Generic only.

### 7.6 web (two phases)
The API routes are 501 stubs until server-api, importer and market-data finish, so the web works in two phases.

**Phase A (parallel with the other implementers; no running API needed):**
1. API layer (§6.2); pages (§6.3–6.5); header freshness (§6.6); router and nav (§6.1).
2. Unit tests with mocked fetch built on **`@joinr/schema/fixtures`** (`sampleDtos`): loading, empty, error and data states; cell renderers per column type; report filters; manual price form validation; freshness text. Missing fixture states → report to the coordinator (Scaffolder-owned file), do not invent DTO shapes.
3. Update `RootLayout.test.tsx` and the freshness assertion in `e2e/ui-core.spec.ts` (accept `No prices yet · No snapshots yet` **or** a live line).
4. Write (do not yet rely on) the e2e files below. Report "phase A done" with typecheck/lint/unit results.

**Phase B (integration; the coordinator starts it once importer, market-data and server-api have reported done):**
5. e2e (`MARKET_DATA_MODE=fake`, `IMPORT_CORRECTIONS_FILE=none` (Playwright default), own ports):
   - `e2e/records-support.ts`: `importSyntheticWorkbook(request)` posts `buildSyntheticWorkbook()` with `confirmReplace=true`; `ensureImported(request)` imports only when `GET /api/import/runs` says `hasImportedData: false` (polls on 409 `IMPORT_IN_PROGRESS`), so a spec run on its own still works. Import from `../packages/importer/src/testing/syntheticWorkbook` directly — **not** the `testing` index, which pulls in Vitest.
   - `e2e/import.setup.ts` (the `setup` project, §7.2 step 7): imports the synthetic workbook once before `desktop` and `phone` run.
   - **Shared-state rule:** `desktop` and `phone` run the same specs concurrently against one server and one `DATA_DIR`. Steps that **mutate** data (the page's Import button, manual price set/clear, source edits) run **only in `desktop`** (`test.skip(testInfo.project.name !== 'desktop', 'mutates shared data')`); `phone` runs read-only views and screenshots. Never assume a data state another file might change: tick the "Replace the imported data" checkbox **when it is present**; assert on the synthetic workbook's generic values only.
   - `records.spec.ts`: `/records` lists groups with counts → open Trades, Snapshots, Settings → rows visible, no page horizontal scroll (both projects), screenshots.
   - `import.spec.ts`: (desktop) upload via the page with `setInputFiles` (buffer) → Preview → report shows "Unexplained 0" → Import (tick the checkbox if shown) → run listed → report filters (Suspect shows rows); (both) open the latest run's report read-only → screenshots at 1440 and 375.
   - `prices.spec.ts`: (desktop) Refresh now → held rows show "Fresh"; set a manual price → "Manual"; clear it; (both) series card visible; screenshots.
6. Screenshots under `artifacts/screenshots/{desktop,phone}/`, the full e2e suite on your ports, then the final report (§13).

### 7.7 Reviewers (report findings; do not edit)
- **spec-correctness:** importer mapping vs the specs and `docs/private/stage-1-private.md`; run `DATA_DIR=artifacts/review-spec/data pnpm import:workbook --dry-run` on the local workbook and check every expected check/suspect/exclusion/correction; D22–D29 applied; idempotency; price/FX/bullion rules; settings registry vs SheetOptions; golden tests read values at runtime; **no owner values in tracked files**.
- **style-ux:** screenshots at 1440 and 375 (records index + three entities, import page, report page, prices page, header freshness) vs STYLE_GUIDE §1–§10 and D6/D7/D17–D20: one accent, uppercase letter-spaced labels, mono right-aligned numbers, status words + icons, §8 formats, no page scroll at 375, empty/error states.
- **code-quality/security:** upload handling (limits, content types, file name sanitising, zip-bomb exposure), error leakage (no paths/SQL/stack), transactions and FKs, replace semantics + backup, provider timeouts/abort/cool-down, URL building (`encodeURIComponent`, fixed hosts only — no SSRF via symbols), secrets never read into logs or storage, logging of personal values (none at info level), scheduler shutdown, test isolation (temp dirs, no network, no test reading `reference/import-corrections.json` except the golden test, no snapshot files), dependency pinning (SheetJS tarball integrity), and a **scratch scan** (script under `artifacts/review-code/`, output yes/no per file only) of the tracked diff against every number with ≥ 4 significant digits in `docs/private/stage-1-private.md`, in dollar and cents forms.

### 7.8 Fixer and Verifier
- **Fixer:** applies verified findings across owners (the only agent allowed to touch several areas), keeps contracts unless the coordinator approves a change, re-runs the affected checks, reports each finding's outcome.
- **Verifier:** runs §10 on ports 5195/3195 with the per-item `DATA_DIR`s of §10 (never the default `data/`) and reports pass/fail with evidence (commands, exit codes, totals, screenshot paths). It never commits and never prints owner values into any tracked file.

---

## 8. Ports & environment

**New environment variables** (server `config.ts`; all optional):

| Var | Default | Notes |
|---|---|---|
| `PRICE_REFRESH_MINUTES` | `60` (`0` when `NODE_ENV=test`) | 0 disables the timer; manual refresh still works. Integer 0–1440. |
| `MARKET_DATA_MODE` | `live` (`off` when `NODE_ENV=test`) | `fake` = deterministic offline prices (e2e, demos without network); `off` = no fetching, refresh returns 503. |
| `IMPORT_CORRECTIONS_FILE` | unset (`auto`) | Path to the corrections JSON (relative → repo root), or **`none`** to switch corrections off. Unset → `<DATA_DIR>/import-corrections.json` → `<repo>/reference/import-corrections.json` (dev checkout only) → none. |

Playwright passes `MARKET_DATA_MODE=fake`, `PRICE_REFRESH_MINUTES=0` and `IMPORT_CORRECTIONS_FILE=none` to its `pnpm dev` unless overridden. The owner's `.claude/launch.json` (`pnpm dev`) stays live, so the demo shows real prices.

**Port assignments (always set via env; always strict):**

| Agent | WEB_PORT | PORT | DATA_DIR |
|---|---|---|---|
| default / owner / `.claude/launch.json` | 5173 | 3001 | `data` |
| Scaffolder | 5170 | 3070 | `artifacts/scaffolder/data` |
| importer | 5181 | 3181 | `artifacts/importer/data` |
| market-data | 5182 | 3182 | `artifacts/market-data/data` |
| server-api | 5183 | 3183 | `artifacts/server-api/data` |
| web | 5184 | 3184 | `artifacts/web/data` |
| Reviewer spec-correctness | 5191 | 3191 | `artifacts/review-spec/data` |
| Reviewer style-ux | 5192 | 3192 | `artifacts/review-style/data` |
| Reviewer code-quality | 5193 | 3193 | `artifacts/review-code/data` |
| Fixer | 5194 | 3194 | `artifacts/fixer/data` |
| Verifier | 5195 | 3195 | `artifacts/verifier/{e2e,cli,upload,live,prod}` (one per §10 item group) |

- Git Bash: `PORT=3184 WEB_PORT=5184 DATA_DIR=artifacts/web/data MARKET_DATA_MODE=fake pnpm dev`.
- PowerShell: `$env:PORT='3184'; $env:WEB_PORT='5184'; $env:DATA_DIR='artifacts/web/data'; $env:MARKET_DATA_MODE='fake'; pnpm dev`.
- CLI: `DATA_DIR=artifacts/importer/data pnpm import:workbook --yes` (Git Bash).
- Unit tests use OS temp dirs or `:memory:`; never `data/`.
- Stop your servers when done and confirm the ports are free (commands in stage-0.md §11).

---

## 9. Golden values & tests

### 9.1 Golden / reconciliation targets (template cells; values come from the local workbook at runtime)
- Held units per watch row: `Stocks!G2:G12`, `ETFs!F2:F11`, `Managed Funds!E2:E11`, `Crypto!D2:D7`.
- Ledger row counts: `Capital Gains!AA8:AA11`; order-value and fee columns of each ledger.
- Tab totals (Stage 1 checks): `Stocks!E16`, `ETFs!F15`, `Managed Funds!B16`, `Crypto!E9`, `Cash!C13`, `Side Income!C7`, `Budget!J4`/`C24`, `Other Assets!D3:D4`, `Super!B11:B12`/`B16`, `Property!F6:F7`/`F10:F11`, `Dividends!K4:P8`.
- Tab gains `Stocks!E17`, `ETFs!F16`, `Managed Funds!H16`, `Crypto!E10` and `Net Worth!D4:D11`: reported as `info` in Stage 1; **Stage 2** FIFO goldens.
- History frozen rows (all 36 value columns, `snapshots.values.*`) and `Net Worth!K:P` rolling rows for those dates; movement columns E/I/M/AI.
- `Net Worth!C4:C11`, `C12`, `D15`, `E23`, `E52` (as-of), `C51` (last run).
- Stage 2+ golden tests reuse `@joinr/importer/testing` (`describeWithLocalWorkbook`, `readLocalWorkbookBytes`) and `readWorkbook()` to read cached cells.

### 9.2 Shared helpers
- `LOCAL_WORKBOOK_PATH` / `describeWithLocalWorkbook(name, fn)`: glob `<repo>/reference/*.xlsx` (not recursive; ignore `~$*`). Exactly one → run; none → `describe.skip` with the reason in the title; several → skip and name the files in the title. **Never a hard-coded filename.**
- `buildSyntheticWorkbook()` gives the importer, the server integration test and e2e the same generic workbook, so CI-less runs without the private file still cover the importer end to end. `syntheticWorkbook.ts` imports only `xlsx` (no Vitest, no `@joinr/*`), so Playwright can load it; it also exports `SYNTHETIC_WORKBOOK_IMPLEMENTED` and `IMPORTER_IMPLEMENTED`. It writes the `History` sheet under a temporary name and renames it with `XLSX.CFB` (SheetJS will not write a sheet called `History`; §7.3 step 1).
- `createTestDb()`, `seedGenericData()`, `dumpDomainTables()` (`@joinr/schema/testing`).
- No network in unit tests (fetch guard); providers are tested with mocked `fetchImpl`.

---

## 10. Acceptance tests (the Verifier runs every item)

**Run order and isolation.** Never use the default `data/` (the owner's working database). Before any item that starts a server, confirm ports 5195 and 3195 are free (Playwright's `reuseExistingServer: true` would silently reuse a live-mode server with the wrong env and data), and stop every server you started before the next group. Order: **1, 2, 4 → 3 (e2e) → 5, 6, 7, 15 (CLI) → 8, 10, 12 (upload/UI) → 9, 11 (live) → 13 (prod) → 14**.

| # | Check | How |
|---|---|---|
| 1 | Install and static checks | `pnpm install` (no prompts), `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build` — all exit 0 |
| 2 | Unit tests | `pnpm test` green; ≥ 670 Stage 0 tests still pass plus the new ones; the importer integration test in server **ran** (not skipped); the golden suite ran (the local workbook is present on this PC) |
| 3 | e2e | ports free first; `PORT=3195 WEB_PORT=5195 DATA_DIR=artifacts/verifier/e2e pnpm e2e` (Playwright defaults: fake prices, `IMPORT_CORRECTIONS_FILE=none`) — `setup` + all Stage 0 specs + `records`/`import`/`prices` pass on desktop and phone (skips only where Stage 0 skipped by design, plus the documented desktop-only mutating steps) |
| 4 | Migrations append-only | `git diff --exit-code` on `0000_app_meta.sql` and `meta/0000_snapshot.json`; a fresh DB and a Stage 0 DB both reach 2 migrations; `/api/health` → `migrations: 2` |
| 5 | Import CLI on the owner's workbook | `DATA_DIR=artifacts/verifier/cli pnpm import:workbook --yes` → exit 0; totals: **unexplained = 0**; the suspect, exclusion, correction and re-key lines match `docs/private/stage-1-private.md` |
| 6 | Idempotent re-import | `DATA_DIR=artifacts/verifier/cli pnpm import:workbook --yes` again → identical `dumpDomainTables` (golden idempotency test + a before/after dump via a scratch script in `artifacts/verifier/`) and identical report checks |
| 7 | Dry run | `DATA_DIR=artifacts/verifier/cli pnpm import:workbook --dry-run` leaves the dump unchanged and records a dry-run row |
| 8 | Upload path | dev server `PORT=3195 WEB_PORT=5195 DATA_DIR=artifacts/verifier/upload MARKET_DATA_MODE=fake pnpm dev` (corrections `auto`, so the owner's file applies): `POST /api/import?confirmReplace=true` with the workbook bytes → 201 with the same totals as #5; `POST` without confirmation on a populated DB → 409; a non-xlsx body → 422; a body of `UPLOAD_LIMIT_BYTES + 1` bytes (26,214,401) → 413 |
| 9 | Prices (live) | stop the #8 server; `PORT=3195 WEB_PORT=5195 DATA_DIR=artifacts/verifier/live MARKET_DATA_MODE=live pnpm dev`, import the owner's workbook, then `POST /api/prices/refresh` → every held instrument has `status ∈ {fresh, manual}` or a visible `stale`/`failed`/`none` badge with a reason on `/prices`; series `AUDUSD`, `XAG_AUD_OZ`, `XAU_AUD_OZ` have values or show failed with an error. Record how many symbols failed (and their sheetRefs, privately) |
| 10 | Manual override | on the #8 server: set and clear through the UI and the API; precedence and status as §5.6 |
| 11 | Scheduler | unit tests (fake timers) green; the #9 setup with `PRICE_REFRESH_MINUTES=1` writes a `job_runs` row within ~75 s and never overlaps |
| 12 | Pages at 1440 and 375 | on the #8 server: `/records`, `/records/<each entity>`, `/import`, `/import/runs/<id>`, `/prices` render with an h1, no console errors and **no page-level horizontal scroll**; screenshots under `artifacts/screenshots/{desktop,phone}/` (owner data on screen: screenshots stay in git-ignored `artifacts/`) |
| 13 | Prod bundle | stop all dev servers; `pnpm build` then `PORT=3195 DATA_DIR=artifacts/verifier/prod IMPORT_CORRECTIONS_FILE=none pnpm start`: deep links `/records/trades`, `/import`, `/prices` serve HTML; `POST /api/import` with the **synthetic** workbook works from `dist/server.js` (SheetJS bundled) with 0 unexplained |
| 14 | Privacy | `pnpm guard:all` exit 0 (the guard terms include the Stage 1 owner values, §7.0 pre-step); the code-quality reviewer's numeric scratch scan found nothing; no snapshot files in the diff; the corrections file is git-ignored |
| 15 | Secrets never stored | after #5, no table in `artifacts/verifier/cli` contains the SheetOptions email or API-key values (scratch script scanning every text column incl. `import_runs.report_json`; prints only "found/not found") |

**Demo frames** for the owner: CLI output of the import; the report page (totals, suspects, corrections); the records index and a ledger table; the prices page before and after "Refresh now"; phone views of the report and prices.

---

## 11. Template bug fixes applied in Stage 1 (owner can veto)
1. **Failed prices fixed at the source:** each instrument is priced on its own (Yahoo for listed securities, CoinGecko for crypto, manual override otherwise), so one bad price can no longer zero a whole tab (the sheet's IFERROR-over-SUMIF collapse, spec 03 §7.1–7.2). The gold ETF uses its own listing (D22); crypto uses CoinGecko (D24). Stage 2 uses these prices for the totals.
2. **Dividends linked by instrument id** (D28) instead of the exact ticker string; unmatched rows are flagged, not silently dropped.
3. **Exited holdings keep their history:** an instrument that is only in the ledger is imported (not watched), so its trades still count in contributions and movements (spec 03 §1.8 side effect).
4. **Bullion priced from built-in series** (D23) instead of pseudo-holdings in Managed Funds.
5. **Placeholders and text in numeric fields** (`Enter Freq`, `Enter DRP`, `-`, a text dividend frequency) become nulls or months instead of text.
6. **Loan balances stored positive** with the loan as a liability (spec 04 §3.7); snapshots keep the sheet's signs for faithful reproduction.
7. **Snapshot period month is explicit** (D29), removing the exact-date matching quirk (spec 01 §5.4 H43).
8. **Secrets not stored** (D24): the CoinMarketCap key and the email are never imported.
9. **Budget accounts linked to cash accounts by id** where names match; stale dropdown names are flagged.
10. Data corrections (D27) and suspect flags (D26) are owner data decisions, not template fixes; they are listed in the report.

---

## 12. Risks & fallbacks

| Risk | Status / fallback |
|---|---|
| Yahoo chart API is unofficial and may block or change | Browser-like UA, 10 s timeouts, concurrency 2, cool-down on 429/403, per-instrument backoff, last good price kept and shown stale, manual override always available. The provider interface allows a second provider later (e.g. a paid EOD API) without touching callers. |
| CoinGecko public-API rate limits (≈ 5–15 calls/min) | One batched `/simple/price` call per run; ≤ 5 `/search` calls per run, 2 s apart, results persisted; cool-down on 429. |
| CoinGecko `/search` picks the wrong coin for an ambiguous symbol | Highest market-cap match is a default, visible as `symbolOrigin: 'search'` on the prices page and editable (`symbolOrigin: 'user'`); the reviewer checks the resolved ids. |
| SheetJS from a tarball URL | Verified with pnpm 11.23 (integrity in the lockfile). If cdn.sheetjs.com is unreachable from the NAS in Stage 7: vendor `vendor/xlsx-0.20.3.tgz` (2.4 MB, Apache-2.0) and depend on `file:` — a one-line change, flagged to the coordinator first. |
| esbuild bundling SheetJS into the server | The Verifier's #13 proves it; fallback: add `xlsx` to `apps/server` dependencies (external). |
| drizzle-kit on Windows / loading schema from another package | Stage 0 generated 0000 on this PC. Table files import only `drizzle-orm` and a plain enums module; the Scaffolder verifies `db:generate` and records deviations. |
| pnpm `minimumReleaseAge` | Keep whatever exclusions pnpm writes; the tarball dependency is not subject to it (verified). |
| Replace-all import deletes app-entered rows | Required confirmation (`--yes` / `confirmReplace`), a UI warning, and an automatic pre-import `VACUUM INTO` backup (newest 10 kept). |
| Import blocks the event loop (~1 s) | Acceptable for a single-user app; one import at a time. |
| CLI import while the server runs | SQLite WAL + 5 s busy timeout; the price refresh skips instruments deleted mid-run. |
| Ambiguous suspect heuristics | Suspect rows are imported unchanged (D26) and only flagged; thresholds are constants with tests. |
| Timezones | Dates never go through `new Date(string)`; serial dates use UTC arithmetic; freshness uses server-local weekdays (Stage 7 sets `TZ`). |
| Private data leaking into commits | The guard (paths, terms, emails, IPs), generic fixtures, runtime-read golden values, and the reviewer's explicit privacy pass. |
| Parallel e2e files mutating one DATA_DIR | `desktop` and `phone` run the same files concurrently against one server, so serial mode alone does not help. A `setup` project imports once; mutating steps run only in `desktop`; specs never assume a data state (checkbox ticked when present); imports are idempotent and deterministic (same ids) and keep `user` manual prices (§7.6). |
| SheetJS cannot write a sheet named `History` | Synthetic workbook writes a temporary name and renames it in `xl/workbook.xml` via the bundled `XLSX.CFB` (verified). Reading is unaffected. |
| `pnpm import` is a pnpm built-in | The script is `import:workbook`; never add a root script named after a pnpm command. |
| The owner's corrections file leaking into synthetic runs | `IMPORT_CORRECTIONS_FILE=none` in Playwright and synthetic commands; `testConfig()` uses `off`; CLI tests pass `--no-corrections`. |
| Google spill ranges look like typed values | Known spill ranges are layout constants (§4.2 rule 8); a cutover export with resolved crypto prices seeds sheet prices, never manual ones. |
| Crypto dust / tiny units | Units are decimal strings (8 dp display), held = units > 0 with decimal comparison. |

---

## 13. Every agent: final report checklist
- Files created or changed (all inside your ownership; list any Scaffold-notes entries you appended).
- Commands run with pass/fail: typecheck, lint, format:check, tests for your scope, your e2e specs on your ports, `pnpm guard:all`.
- For importer / spec reviewer / Verifier: the import totals (match / explained / unexplained / suspect / info) and, per section, the count of non-`match` checks by status and reason code. Check ids that embed an owner symbol (`holdings.*.<SYMBOL>`, `dividends.link.*` targets) are **private**: list them only in a git-ignored file under `artifacts/` (or `docs/private/`), and refer to them by sheetRef or count in the report itself. **No owner values or symbols** in anything that could be committed.
- Screenshot paths under `artifacts/screenshots/` (UI roles).
- STYLE_GUIDE §10 self-check (UI roles).
- Contract gaps or cross-owner requests (do not work around them).
- Confirmation that your ports are free and no background processes remain.
- Nothing committed or pushed; nothing added to `docs/`/`reference/` outside your ownership; no owner data in any tracked file.

---

## Scaffold notes

_Scaffolder appends here (append-only): where the skeleton differs from, or adds to, the plan above._

**Scaffolder, 2026-09-24.** Done-check green (typecheck, lint, format:check, 781 unit tests, build, guard:all, smoke e2e on 5170/3070, `/api/health` → `migrations: 2`, `pnpm seed:dev` exit 0). Deviations and additions (none changes a frozen name, field or signature):

*Dependencies and migration*
- Installed as §1.3; `pnpm-workspace.yaml` unchanged (no new build approvals, no new `minimumReleaseAgeExclude` lines). The lockfile records the SheetJS tarball with its integrity.
- Table files import `drizzle-orm`, `../../enums` **and their siblings** (`tables/common.ts` holds the `id`/provenance column builders; FK targets are imported from sibling files). drizzle-kit loads the glob without trouble. `0001_stage1_core.sql` + `meta/0001_snapshot.json` generated; `0000` files unchanged (`git diff --exit-code` clean).
- `@joinr/schema/db` also exports `tables` (the Drizzle schema object; `JoinrDb = BetterSQLite3Database<typeof tables>`) and `TableRow`/`TableInsert` type helpers. `job_runs.job` is plain text (typed `string`), as §2.4 says.

*`@joinr/schema` root*
- Extra exports: `JoinrDecimal` (decimal.js clone: precision 50, half away from zero, no exponent), `NORMALISED_DECIMAL_RE`, `IMPORT_SIGNIFICANT_DIGITS`; `IsoDate`/`IsoMonth`/`IsoTimestamp`/`DecimalString` (plain string aliases) and `is…String` predicates; `looksLikeYahooSymbol`, `MARKET_SERIES_IDS`, `MarketSeriesDef`; `parseReviewFlags`/`serialiseReviewFlags`/`ReviewFlagsJsonSchema` (an empty flag list is stored as null, so the JSON must be a non-empty array); `RECORDS_PAGE_CAP` (5000) and `IMPORT_RUNS_LIST_CAP` (50) in `limits.ts`.
- `PositiveDecimalSchema(maxDp, max?)` takes user input (`"12.50"`, `".5"`, trimmed; no sign or exponent) and outputs the normalised string. `DecimalStringSchema` accepts only the normalised form.
- Zod insert schemas are **strict** objects. `price_sources.instrument_id` and `prices.instrument_id` are required in Zod although Drizzle's insert type makes an integer primary key optional; the type-level parity test (`test/rows-parity.test.ts`) accounts for exactly that and nothing else.
- Settings registry: `SettingDef` gains optional `onlyWhenTyped: true` (the three §2.5 overrides). Extra exports: `SETTING_KEYS`, `settingDef`, `isSettingKey`, `SETTING_BY_SHEET_OPTIONS_ID`, `SHEET_OPTIONS_IDS` (1–44), `FIRE_TAB_PREFIX` (`'FIRE'`; FIRE sources use `tab: 'FIRE'` and the importer finds the tab by that prefix), `PAY_FREQUENCY_SHEET_VALUES` and `ALLOCATION_AGGRESSIVENESS_SHEET_VALUES` (sheet text → enum). `tax.marginalRate` has category `pay` (the `SettingCategory` union has no `tax`). Default values are null except `features.*` (true) and `charts.dateUnit` (`monthly`); no owner values. First Time Setup cells: C28 cash, C29 etfs, C30 stocks, C31 managedFunds, C32 fire, C33 budget, E28 crypto, E29 otherAssets, E30 property, E32 sideIncome, E33 retirement (E31 is Liabilities, skipped; Capital Gains sits on row 34, outside the range). `sheetLabel`s were copied from the template's K column with a scratch script that read only K and P.
- Record registry extras: `RECORD_GROUPS` (labels, display order), `RECORD_ENTITY_TABLES` (entity → SQL table), `SNAPSHOT_VALUE_COLUMNS` (History column letter → DB column → record column id/label/type, B…AK), `isRecordEntityId`. Default sorts: dated entities newest first; the others by name/description/kind/key.
- DTO extras: `ReconciliationReportSchema`, `ReconciliationCheckSchema`, `CheckTotalsSchema`, `CHECK_UNITS`, `totalsOf`, `emptyCheckTotals`; `XLSX_MIME`, `IMPORT_CONTENT_TYPES`, `IMPORT_FILE_NAME_HEADER` (`x-file-name`); `makeManualPriceInputSchema(now)` ("not after tomorrow" uses the local calendar date at parse time; `manualPriceInputSchema` = the real clock), `PROVIDER_SYMBOL_RE`; `isApiErrorBody`; `MarketQuoteStatus`; `ImportQuery`, `RefreshRequest`. `importQuerySchema` ignores unknown query keys; `refreshRequestSchema` is strict (the route passes `body ?? {}`).
- Corrections: `approvedOn` is optional; `set` must change at least one field and cannot be combined with `action: 'skip'`; `LEDGER_SHEETS` exported. `correctionsSettingFromEnv` trims and treats `none` case-insensitively.

*`@joinr/schema/testing` and `/fixtures`*
- `createTestDb()` also exports `MIGRATIONS_DIR`. `seedGenericData(db, { now? })` returns `{ instrumentIds, importRunId, jobRunId }`, writes one `app_meta` row (key `seed`) so every table has a row, and clears first (`clearSeededTables`). Its price inputs (relative to `now`) give: fresh ASX:ABC and BTC, stale ASX:XYZ (from the workbook) and ETH (old fetch), failed ASX:DEF, manual EXAMPLEFUND, none ASX:OLD and EXAMPLEFUND2. `dumpDomainTables` returns `{ [table]: rows[] }` (raw SQL rows, key order); `dumpDomainTablesJson` returns the same as a string; `DUMPED_TABLES` lists them.
- Fixtures (`sampleDtos.ts`): `recordsIndex`, `recordsIndexEmpty`, `recordsPages` (one per entity, cells cover every registry column, nulls and flags included, settings rows of every value type), `recordsPageEmpty`; `sampleReport` (every CheckStatus and unit), `sampleDryRunReport` (0 unexplained); `importRunSucceeded` (#3), `importRunDryRun` (#2), `importRunFailed` (#1, INVALID_WORKBOOK), `importRunRunning` (#4), `importRunDetails`, `importRunsEmpty`, `importRunsPopulated`, `importRunsInProgress`; `priceItems` (every PriceStatus, incl. a failed item that keeps a last good USD price, a stale user manual price, `search`/`user` symbol origins), `marketSeries`, `marketSeriesEmpty`, `lastPriceRun`, `pricesLive`, `pricesRunning`, `pricesFake`, `pricesOff`, `pricesEmpty`, `pricesByMode`, `refreshResponse`, `marketSeriesResponse`, `priceItemManualSet`; `appStatusEmpty`, `appStatusPopulated`; `apiErrors` (one body per error the pages show); `FIXTURE_NOW`, `FIXTURE_WORKBOOK_AS_OF`, `FIXTURE_COVERAGE`.

*Server*
- `MarketDataDisabledError` also carries `statusCode = 503`. The Fastify error handler turns every 5xx into a generic message, so `routes/prices.ts` must answer 503 `MARKET_DATA_DISABLED` itself.
- `Clock` lives in `scheduler/types.ts` and is re-exported from `market/types.ts`; `MarketDataStatus` is the `status()` return type. The scheduler stub (`scheduler/index.ts`) already registers, runs (joining an in-flight run), writes `job_runs` rows and stops (abort + await); `start()` is a no-op and `nextRunAt()` returns null; it exports `systemClock`. The market stub's `notifyInstrumentsChanged()` is a **no-op** (not a throw) so the import route can call it before market-data lands; `refresh()` rejects; the others throw.
- `errors.ts` also exports `formatIssues` and `sendNotImplemented` (the stubs' 501 body: `NOT_IMPLEMENTED`, "Not implemented yet"). Route option interfaces: `RecordsRouteOptions`, `StatusRouteOptions`, `ImportRouteOptions` (with `importer?: ImporterApi`), `PricesRouteOptions`.
- `config.ts` also exports `TEST_DEFAULTS` and `MAX_PRICE_REFRESH_MINUTES`; a `file` corrections path is made absolute at load time (relative → `ConfigBase.repoRoot`, which falls back to cwd outside a workspace). `Config.repoRoot` = `ConfigBase.workspaceRoot` (null outside a workspace).
- `backupBeforeImport` adds `-2`, `-3`, … when a backup already exists for that second; `prunePreImportBackups` and `preImportBackupName` (local time) are exported. `markInterruptedRuns` sets import runs to `failed` with `error_code` `INTERRUPTED` and `error` `interrupted` (job runs: `error` `interrupted`) and returns the counts. `hasDomainData` also counts instruments. `holdings.ts` also exports `isHeld`; instruments without trades are absent from the map.
- `cli/import.ts` stub exports `main(argv, io?)` and a `CliIo` type (`stdout`/`stderr` with `write`, `env`, `cwd`).
- `test/app.test.ts`: the route-registration test checks only that the router does not answer "No route for", so it keeps passing once the stubs are replaced.

*Importer skeleton*
- `parseCorrectionsFile` is already real (JSON + `CorrectionsFileSchema`, throws `CorrectionsError`), as are `findWorkbookInDir` and `resolveCorrectionsPath`; `CORRECTIONS_FILE_NAME` exported; `packageName` kept (existing test). `localWorkbook.ts` also exports `REFERENCE_DIR` and `LOCAL_WORKBOOK_LOCATION`; a skipped `describeWithLocalWorkbook` contains one placeholder test and names the reason in its title. `syntheticWorkbook.ts` exports `SYNTHETIC_HISTORY_TMP = 'HistoryTmp'`. History header constants were not prepared (optional; the importer copies them).

*Web and e2e*
- `pageForPath` matches sub-routes by prefix for every page except `/` (so `/stocks/<symbol>` also resolves to Stocks). `RootLayout.test.tsx` nav-link count 16 → 19. The three new pages render `PlaceholderPage` until the web owner replaces them.
- `playwright.config.ts` as §7.2 step 7; `e2e/import.setup.ts` stub skips while either importer flag is false.

**Fixer, 2026-09-24 (review findings).** Contract clarifications and additions:
- §4.4 price seeding: a `prices` row that holds no price (failure-only) is filled in with the workbook price (`source='sheet'`); its `last_attempt_at`/`last_status`/`last_error`/`consecutive_failures` are kept.
- §4.9 `holdings.price.*`: the actual side is always read back from the database. When a kept fetched price or a kept user manual price differs from the workbook price the check is `info` (no reason code) with the diff, never `match`; a kept row with no price is `info`. `holdings.value.*` is explained as `sheet_error_value` only when the sheet total is 0 (the IFERROR collapse). The Other Assets gain leaves out rows without a unit cost and rows with units ≤ 0, as the template does.
- §4.2 reader: `readWorkbook`/`openWorkbook` pre-scan the zip before SheetJS (zip magic required; at most 2000 entries; no ZIP64 or encrypted entries; stored/deflate only; declared uncompressed total ≤ 256 MiB; each entry inflated with a hard cap at its declared size). Anything else is `WorkbookFormatError` → 422 `INVALID_WORKBOOK`. The fallback as-of date (Net Worth!E52 blank) is the server-local calendar date.
- Check labels use month names (`Dec 2025`) and plain words for exclusion reasons; check ids are unchanged.
- Server: the refresh write transaction and `upsertSource` use `BEGIN IMMEDIATE`; `RETRY_AFTER_MAX_MS` (24 h) caps a provider's `Retry-After` cool-down; `sendNotImplemented` was removed (no callers). `pnpm seed:dev` asks for `--yes` (exit 3) when `DATA_DIR` already holds data and backs up first.

## Stage close notes (coordinator)

**Outcome (2026-09-24).** Flow as planned: Planner → 2 plan critics → reviser; Scaffolder → 4 implementers → integrator → web phase B; 3 reviewers → adversarial triage → Fixer → Verifier; then one demo-feedback round (2 implementers → reviewer-fixer → Verifier).
- The Verifier passed all 15 acceptance items of §10. Final state: typecheck, lint, format:check, build and `guard:all` green; **1271 unit tests** (golden and server-integration suites run, not skipped); **e2e 109 passed, 10 skipped by design**.
- The owner's workbook imports with **0 unexplained** checks, idempotently, through the CLI, the upload route and the prod bundle. Totals and every suspect, exclusion, correction and re-key line are recorded privately (`docs/private/stage-1-private.md`, `artifacts/`).
- Live prices: every held instrument is priced (fresh or manual); all five FX/bullion series are fresh.

**Review.** 47 findings; the triage agent confirmed 29, refuted 3, deferred 6 and returned 9 as owner decisions. All 29 were fixed. They included three privacy blockers (owner float-noise examples had been copied into this plan, some code comments and tests, and the synthetic History seed), all replaced with synthetic values. The guard's private term list gained the Stage 1 owner amounts, so a hard-coded owner figure now fails `guard:all`.

**Fixed during the demo (coordinator).**
- Yahoo sometimes returns a degraded chart `meta` for a thinly traded ASX ETF (no currency, `regularMarketTime` 0, a wrong `regularMarketPrice`). `parseYahooChart` now trusts the meta price only with a valid market time, otherwise uses the last daily close, and infers the currency from a known exchange suffix (`.AX` AUD, `.NZ` NZD, `.TO` CAD) when it is missing. Tests added.
- The report shows review flags as words ("Out of order, Price outlier"), and the blocked-import message names the full CLI override (`--yes --replace-app-data`).

**Owner decisions at the demo:** D30–D35 (`docs/DECISIONS.md`): all nine §11 fixes kept; status-first phone tables; the report opens on "Needs attention"; sells and movements in body text, an amber "Needs review" run badge and violet Records bars; re-import blocked once app-entered data exists (409 `IMPORT_APP_DATA_EXISTS`, CLI `--replace-app-data`); the settings table shows the label first.

**Contract changes after the Scaffold notes** (all additive): `IMPORT_APP_DATA_EXISTS` in `API_ERROR_CODES`; `ImportRunsResponse.hasAppData`; `hasAppData(db)` in `apps/server/src/db/queries/domain.ts`; the CLI flag `--replace-app-data`; the importer rewrites a setting whose origin is not `import` when the workbook supplies that key.

**Deferred (with target stage):**
- Stage 4: the template's default Property row-30 formula adds offset balances rather than being principal-only; revisit `payments_paid_derived` semantics with the Stage 4 repayments work.
- Stage 5: settings value checks prove read-back rather than the parse; First Time Setup toggles are read from fixed cells without a label check. **D34 gap:** an app-entered setting for a key the workbook does not supply keeps `origin='app'`, so `hasAppData` stays true even after `--replace-app-data`. Decide with the Settings page whether such settings should count as app data.
- Stage 6 polish: an overflow cue on wide tables; the report subtitle uppercases the file name; the Import page's runs table hides Status at 375 px; route-level code splitting (bundle size).
- Stage 7: the pre-import backup is taken before the workbook is validated, so repeated rejected uploads can prune older backups; revisit with the backup policy.

## Plan review log (2026-09-24)

Two critics (spec-coverage, feasibility) reviewed this plan and the private companion; the plan reviser verified each finding against the workbook (scratch SheetJS scripts), the code and quick probes, then applied or rejected it. Findings are numbered in the order received.

| # | Finding (generic) | Outcome |
|---|---|---|
| F1 | Google spill members of the crypto price column arrive as plain numbers and would be imported as manual prices in a cutover export | **Applied:** known-spill-range rule (§4.2 rule 8, §4.4), synthetic test case |
| F2 | `counts.*` expectations undefined for ledger-only instruments, placeholder slots, zero cells and unnamed rows | **Applied:** per-entity key-row count table (§4.9), new info codes `placeholder_slot`/`unnamed_row`; private counts lines for every entity |
| F3 | SheetOptions label check fails on real labels (newline, trailing colon, hyphen vs en dash) | **Applied:** `sheetLabel` copied from the workbook, `normaliseSheetLabel`, tests (§2.5, §4.3) |
| F4 | 26 of 36 History columns never compared with the DB; a mapping shift would pass | **Applied:** `snapshots.values.<period>` read-back check, History header check (fails the import on a shift), golden assertion (§4.3, §4.9, §7.3) |
| F5 | Gain cells marked as checks but not checkable before Stage 2; headline totals unreconciled | **Applied:** gains → `info` `derived_later_stage`; `netWorth.totalAssets`/`netWorth.total` added (§4.3, §4.9, §9.1) |
| F6 | The skipped CGT liabilities slot is included in the sheet's liabilities total | **Applied:** expected adds the slot; `liabilities.cgtSlot` explained (D2); synthetic case (§4.3, §4.9) |
| F7 | Formula-default overrides had no defined status; secret settings could reach `report_json` | **Applied:** `formula_default` info with no comparison; secret IDs never read, null expected/actual (§2.5, §4.9) |
| F8 | Crypto fee authority (rounded cents vs rate) undefined | **Applied:** fee authority rule in §2.4; crypto fee check uses it |
| F9 | Snapshot money rounded to cents makes 1e-9 ratio recompute impossible in Stage 5 | **Applied:** precision note and Stage 5 tolerances (§2.4) |
| F10 | "Complete schema for Stages 1–6" overstated | **Applied (reworded):** §1.1 lists the known later additions; no speculative tables added now |
| F11 | A formula "payments paid" cell is indistinguishable from a typed total | **Applied:** `loans.payments_paid_derived` + `derived_input` info (§2.4, §4.3) |
| F12 | `pnpm import` is a pnpm built-in; the script would never run | **Applied (blocker):** script renamed `import:workbook` everywhere (verified with `pnpm help import`) |
| F13 | The dev-checkout corrections fallback applies owner corrections to synthetic imports (e2e/CLI/prod) | **Applied (blocker):** `CorrectionsSetting` with `IMPORT_CORRECTIONS_FILE=none`, Playwright default `none`, `testConfig()` off, CLI tests `--no-corrections`, `repoRoot` null semantics defined, no snapshot files |
| F14 | SheetJS refuses to write a sheet named `History` | **Applied:** temp name + `XLSX.CFB` rename (verified the throw locally) (§7.3, §9.2) |
| F15 | Web cannot run e2e or screenshots while routes are 501 stubs | **Applied:** web phase A on `@joinr/schema/fixtures`, phase B integration after the other three report done (§1 flow, §7.6) |
| F16 | Desktop and phone projects race on one DATA_DIR | **Applied:** `setup` project, desktop-only mutating steps, state-agnostic specs (§7.2, §7.6, §12) |
| F17 | Guard does not catch owner amounts; symbol-bearing check ids could reach committed docs | **Applied:** coordinator pre-step adds value terms (private list), reviewer numeric scan, check-id privacy rule (§7.0, §7.7, §13) |
| F18 | Verifier items default to the owner's `data/` and may reuse a wrong-env server | **Applied:** per-item DATA_DIRs, port-free checks, run order (§10) |
| F19 | Server integration test gate flips before the importer works | **Applied:** `IMPORTER_IMPLEMENTED` flag, gate on both (§4.1, §7.5) |
| F20 | Services need a logger that exists only inside `buildApp`; shutdown order | **Applied in part:** services factory built from `app.log`, scheduler stopped in `preClose`. The ordering claim was not reproduced (Fastify 5 runs `onClose` hooks last-in-first-out), but `preClose` makes the order explicit (§5.1) |
| F21 | Upload limit written as both MB and MiB; the 413 test would get 422 | **Applied:** `UPLOAD_LIMIT_BYTES` constant; tests send limit + 1 (§3.2, §3.4, §10) |
| F22 | Default 5 s Vitest timeout too short for golden/CLI tests | **Applied:** importer `testTimeout` 30 s, golden 120 s, CLI in-process `main(argv)` (§4.10, §7.2, §7.3) |
| F23 | CoinGecko requests had no timeout; refresh could hang | **Applied:** per-request 10 s timeout for every provider + 90 s run deadline (§5.2, §5.4) |

Rejected: none outright. F10 was applied as a rewording rather than new tables (Stages 3–4 kickoffs decide those shapes). F20's shutdown-order premise was incorrect, but the fix was applied because it makes the order independent of hook-registration details.
