# Architecture

How Joinr Finance is put together. [`PLAN.md`](../PLAN.md) gives the reasons behind each choice; this page describes the result. The stage plans in [`docs/stages/`](stages/) hold the task-level detail.

## Runtime

```
 Browser (any PC or phone, over the home network or a VPN)
        │   the Umbrel app proxy adds the Umbrel login (deployed)
        ▼
 ┌──────────── one Docker container ─────────────────────────────┐
 │  Node 24 · Fastify                                            │
 │   ├─ /api/*        JSON API ──► engine (pure TypeScript)      │
 │   ├─ everything    the built React SPA (static files)         │
 │   ├─ SQLite (better-sqlite3 + Drizzle) ◄── DATA_DIR volume    │
 │   ├─ price service + cache, job scheduler (Stage 1)           │
 │   └─ month-end snapshots (5), nightly backups (7)             │
 └───────────────────────────────────────────────────────────────┘
 DATA_DIR → the app's data folder on the server: finance.db, backups/, devices/

 Android phone app (Stage 9) ──► /api/mobile/* only (a paired key; the one path without
                                  the Umbrel login on the Umbrel)
```

- The app is one process with one database file.
- The server and the database sit on the same machine, so SQLite never runs over a network filesystem.
- There is no login in the app. When deployed, the Umbrel app proxy puts the Umbrel login in front of it, except `/api/mobile/` (the phone app, see [The phone app](#the-phone-app)), where the app checks a paired device key itself. In local development there is no login.
- A cross-site write guard refuses writes that a browser sends from another site or another port (see [Security](#security)).

## Packages

A pnpm workspace with three kinds of member.

```
apps/web ─────────► @joinr/ui, @joinr/schema (types and plain constants only, never /db)
apps/server ──────► @joinr/engine, @joinr/importer, @joinr/schema
packages/engine   ► @joinr/schema (root entry only; @joinr/importer for golden tests only)
packages/importer ► @joinr/schema, xlsx (SheetJS)
packages/schema   ► drizzle-orm, zod, decimal.js     (the root entry has no drizzle import)
tools/privacy-guard  (standalone, Node built-ins only)
tools/deploy         (not a workspace package: plain .mjs scripts, Node built-ins only)
apps/android         (not a workspace package: Gradle, Kotlin; reads the schema's fixtures as JSON copies)
```

| Package | Role |
|---|---|
| `@joinr/web` | React 19 + Vite SPA. Code-based TanStack Router routes and TanStack Query. There is one route per page, plus `/styleguide` (the component gallery) and `/preview/screen/:variant` (the brand screens). |
| `@joinr/server` | Fastify API, SQLite access and migrations. In production it also serves the SPA. |
| `@joinr/ui` | Design tokens, global CSS, layout and content components, brand components and chart wrappers. It is split into `core`, `brand` and `charts`. |
| `@joinr/engine` | Pure calculation functions: from Stage 2 the investments (FIFO parcels, realised gains by financial year, holding metrics, XIRR, allocation, contributions history, the investment timing); from Stage 3 cash, savings, budget, side income and dividends; from Stage 4 other assets, super, property and loans (with an amortisation schedule) and the live History columns; from Stage 5 the snapshots and the net-worth dashboard; from Stage 6 the FIRE planner (the inputs derived from the other results, the corrected projection, and the template's formulas in a sheet mode for the golden tests). No I/O and no clock: every "today" is an `asOf` input, and ESLint bans `Date.now()`, `new Date()` and node imports in its sources. It imports only the `@joinr/schema` root, so it could run in the browser; today only the server calls it. |
| `@joinr/schema` | The shared data contract. The root entry holds enums, Zod schemas, API DTO types, the settings and record-browser registries, and pricing, decimal and date helpers; `/db` holds the Drizzle tables; `/testing` the in-memory test database, the generic seed and a table dump; `/fixtures` typed sample DTOs for UI tests. |
| `@joinr/importer` | Reads a workbook export (SheetJS) into the database in one transaction and produces a reconciliation report. `/testing` builds a generic synthetic workbook for tests. |
| `@joinr/privacy-guard` | The pre-commit check that keeps private material out of this public repo. |

Internal packages are **TypeScript source with no build step**:
- Their `exports` point at `src/index.ts`.
- Vite, Vitest, tsx and esbuild compile them directly.
- Module resolution is `Bundler` everywhere, so imports have no file extensions.

## Request flow

**Development** (`pnpm dev`) runs two processes.

```
browser ──► Vite :5173 ──(/api proxy)──► Fastify :3001 ──► SQLite (DATA_DIR)
             └─ serves the SPA with hot reload
```

- Vite serves the app and proxies `/api` to the server (`PORT`, or `API_TARGET`).
- The server runs under `tsx watch` and restarts when its sources change.

**Production** (`pnpm build && pnpm start`, or the Docker image) runs one process.

```
browser ──► Fastify :3001 ─┬─ /api/*            API routes
                           ├─ /assets/*, files  static files from WEB_DIST_DIR
                           └─ other GET/HEAD    index.html (the client router takes over)
```

## Server

The start-up sequence is in `apps/server/src/index.ts`:

1. **Config.** `loadConfig(env)` validates every variable with Zod and resolves paths. It reports all invalid variables in one error, then the server exits with code 1.
2. **Database.** `openDatabase(DATA_DIR)` creates the folder, opens `finance.db` and sets these pragmas:
   - `journal_mode=WAL`
   - `foreign_keys=ON`
   - `busy_timeout=5000`
   - `synchronous=NORMAL`
3. **Migrations.** `migrateWithBackup` (`backups/migrate.ts`) refuses to start on a database a newer version migrated (more applied migrations than this build knows; exit 1, nothing written), takes a verified `pre-migrate` backup when migrations are pending on an existing database, then `runMigrations` applies them in one transaction. A second run is a no-op.
4. **Bookkeeping.** The server records `created_at` once and `last_started_at` on every start, in `app_meta`.
5. **Stale runs.** `markInterruptedRuns` marks import and job runs left `running` by a crash or restart as `failed` (`interrupted`).
6. **App.** `buildApp({ config, db, services: defaultServices })` builds the Fastify instance. It has no side effects at import. Before it registers the routes it runs the one-off settings upgrades (`fire/upgrade.ts`, `applySettingUpgrades`; see [FIRE](#fire)). The services factory receives the app's own logger and builds the scheduler and the market data service; the app is decorated with both (`app.scheduler`, `app.market`). Tests omit `services` and get `offServices`: market data off, no timers.
7. **Listen.** It logs `Joinr Finance listening on http://HOST:PORT`, then starts the scheduler, the month-end recorder and the backup service. Fastify's `onListen` hook writes the running marker (`app_meta` `server.running_since`), which the restore and import CLIs read; `onClose` deletes it.

Shutdown:
- The first `SIGINT`, `SIGTERM` or `SIGBREAK` runs `app.close()`. A `preClose` hook stops the backup service (waiting for a copy in flight), the snapshot recorder (it aborts its own price wait), then the scheduler (aborting and awaiting an in-flight price run), then an `onClose` hook deletes the running marker and closes SQLite.
- A second signal, or a 10-second timeout, forces the exit.

| Module | Responsibility |
|---|---|
| `config.ts`, `paths.ts` | Environment validation. Finds the repo root (the folder with `pnpm-workspace.yaml`), the migrations folder and the web build. |
| `db/database.ts`, `db/schema.ts`, `db/meta.ts` | The connection, migrations, the `app_meta` table and its helpers. |
| `app.ts` | Fastify setup: the services, security and `cache-control` headers, the error handler, routes, SPA serving and the not-found handling. |
| `db/backup.ts` | Pre-import backups, through the verified copy of `backups/copy.ts` (newest 10 kept). |
| `backups/` | Backups (Stage 7): file names and their instants (`names.ts`), retention (`retention.ts`, pure), the verified copy (`copy.ts`), the listing (`list.ts`), the nightly service and its job (`service.ts`), start-up safety (`migrate.ts`) and restore (`restore.ts`). |
| `security.ts` | The cross-site write guard (an `onRequest` hook, registered first). |
| `routes/backups.ts` | `GET /api/backups`, `POST /api/backups`, `GET /api/backups/:name`. |
| `db/queries/*` | Shared queries: held units per instrument, "has imported data" and "has app data" (with the D34 deletion marker), stale-run cleanup, import-run DTOs, and the typed settings reader (`readSettings`: each value parsed with its registry schema; an invalid one reads as null with a warning that never logs the value). |
| `records/` | The record browser: one loader per registry entity, serialised to the registry's columns. |
| `routes/health.ts` | `GET /api/health`. |
| `routes/status.ts` | `GET /api/status` (header freshness). |
| `routes/records.ts` | `GET /api/records`, `GET /api/records/:entity`. |
| `routes/import.ts` | `POST /api/import` and the import runs. |
| `routes/prices.ts` | Prices, refresh, manual overrides, price sources, market series. |
| `routes/investments.ts` | The investment pages, the trade ledger, holding detail, and trade and holding changes. |
| `routes/{cash,sideIncome,budget,dividends,settings}.ts` | The cash-flow pages and their changes (Stage 3), the dividend suggestions and the settings PATCH. |
| `routes/{otherAssets,super,property}.ts` | The Other Assets, Super and Property pages and their changes (Stage 4). |
| `routes/{netWorth,history}.ts`, `GET /api/settings` | The Net Worth dashboard, the History page, the aggregation API, record, correct and delete (Stage 5), and the Settings page. |
| `routes/fire.ts` | The FIRE page (`GET /api/fire`, with a what-if query) and "Use the workbook's figure" (Stage 6). |
| `assets/` | The Stage 4 engine inputs (`inputs.ts`), the page builders (`otherAssets.ts`, `super.ts`, `property.ts`), the mutations (`mutations/`), the responses and the pages' settings keys (`constants.ts`). |
| `investments/` | Loads every finance row in one read transaction (`load.ts`), maps engine results to the investment DTOs (`page.ts`, `trades.ts`, `detail.ts`, `charts.ts`, `timing.ts`, `mappers.ts`), and runs the trade and holding mutations (`mutations.ts`). |
| `cashflow/` | The finance context (`context.ts`: one request's rows, prices and memoised engine results), the engine inputs (`inputs.ts`), the page builders (`cash.ts`, `sideIncome.ts`, `budget.ts`, `dividends.ts`), the mutations (`mutations/`), the responses and the owner-confirmed constants (`constants.ts`). |
| `history/` | The Stage 5 engine inputs (`inputs.ts`), the page builders (`pages.ts`, `snapshots.ts`), the DTO mappers (`dto.ts`), the month writer (`record.ts`, `writeRecordedMonths`), corrections and deletes (`mutations.ts`), the audit log (`audit.ts`), the responses and the month-end recorder (`recorder.ts`). |
| `settings/` | The Settings page (`page.ts`) and the pages that read each setting (`readers.ts`, `SETTING_READERS`). |
| `fire/` | The Stage 6 input resolution (`inputs.ts`), the page builder and DTO mappers (`page.ts`), the one-off access-age upgrade and its marker (`upgrade.ts`), the notices (`notices.ts`) and "Use the workbook's figure" (`workbook.ts`). |
| `market/dividends/` | The dividend-events service: Yahoo chart events and closes cached in `dividend_events` by a daily `dividends` job. |
| `market/` | The price service: providers (Yahoo chart, CoinGecko, fake), FX and bullion series, the refresh job, price status. The price and dividend-events services share one set of provider cool-downs. |
| `scheduler/` | A small generic job scheduler that logs every run in `job_runs`. |
| `cli/import.ts`, `cli/restore.ts` | `pnpm import:workbook` and `pnpm restore:backup`; in the image `node dist/cli/import.js` and `node dist/cli/restore.js`. |
| `errors.ts` | The JSON error shape, `HttpError` and `parseWith` (Zod validation, `400 VALIDATION_ERROR`). |
| `web.ts` | Static SPA serving and cache rules. |
| `version.ts` | The app version, baked in at build time or read from the root `package.json` in development. |

**API conventions.**
- JSON everywhere under `/api`.
- Every `/api` response, errors included, carries `Cache-Control: no-store`.
- Request bodies, queries and params are validated with the Zod schemas from `@joinr/schema`. The DTO types come from there too, so the server and the web share one contract.
- Errors are `{ "error": { "code", "message" } }`. `code` is a stable, upper-snake identifier such as `NOT_FOUND`, `VALIDATION_ERROR` or `IMPORT_CONFIRM_REQUIRED`.
- A `5xx` message is always generic. The full error goes to the log only.
- Responses never include file paths or environment values.
- Every response carries `X-Content-Type-Options: nosniff` and `Referrer-Policy: same-origin`.

**SPA serving** (production, or `SERVE_WEB=true`):
- A route is registered for each file in the build.
- `/assets/*` is content-hashed by Vite, so it is served with `Cache-Control: public, max-age=31536000, immutable`.
- Everything else, including `index.html`, is served with `no-cache`.
- The not-found handler:

  | Request | Response |
  |---|---|
  | `/api` or `/api/*`, also spelled `//api/…`, `/API/…` or `/api%2F…` | JSON 404 |
  | Any method other than GET or HEAD | JSON 404 |
  | `/assets/*`, or a last segment with a static-file extension (`.js`, `.css`, `.png`, `.woff2`, …) | Plain-text 404. A missing script must never receive `index.html`. |
  | Anything else, including a dotted route parameter such as `/stocks/ABC.AX` | `index.html` |

- If the build is missing, the server refuses to start and says how to fix it.

## Workbook import

One function, `importWorkbook(db, { bytes, … })` in `@joinr/importer`, serves both entry points: the CLI (`pnpm import:workbook`) and `POST /api/import`.

```
.xlsx bytes ──► read (SheetJS) ──► extract each tab (pure) ──► corrections ──► exclusions,
                                                                             suspect flags,
                                                                             dividend re-keying
        ┌──────────────────────── one SQLite transaction ─────────────────────────┐
  ──►   │ delete imported rows · upsert instruments · price sources and seeded     │
        │ prices · insert rows in sheet order · settings · reconcile (read back)   │
        └──────────── dry run: roll back · otherwise: commit ─────────────────────┘
  ──► import_runs row (status, totals, report JSON)
```

- **Replace-all, idempotent.** An import replaces the imported tables. Ids restart at 1 after the delete (no AUTOINCREMENT), so importing the same bytes twice gives identical tables. Instruments are upserted by kind and symbol, which keeps price sources and manual prices set in the app.
- **Reconciliation report.** Every check compares a sheet value (a tab total, held units, a History row, a count) with the value read back from the database inside the transaction. Each check is `match`, `explained` (with a reason code and, where relevant, a decision reference), `suspect`, `info` or `unexplained`. The target is zero unexplained.
- **Corrections** are owner-approved data fixes kept outside the repo (`import-corrections.json` in `DATA_DIR`, or in `reference/` on the development PC; `IMPORT_CORRECTIONS_FILE` overrides). Each applied correction is listed in the report.
- **Upload route.** The body is the raw `.xlsx` (25 MiB limit; a route-scoped parser accepts only `application/octet-stream` and the xlsx MIME type). One import runs at a time. While app-entered data exists (`origin = 'app'` in a domain table or `instruments`, a workbook setting edited in the app, or the deletion marker of a workbook row deleted in the app; `hasAppData()`), a real import answers `409 IMPORT_APP_DATA_EXISTS` before the confirm check (and again right before importing), with no backup and no run row; dry runs still run, and only the CLI overrides, with `--yes --replace-app-data` (D34). When data exists, a real import needs `confirmReplace=true` and takes a `VACUUM INTO` backup first. A committed import tells the price service to refresh soon.
- A crash mid-import leaves the data untouched (the transaction rolls back), and the next start marks the run `failed`.

## Investments

```
GET /api/investments/:kind
  price service: effective price per instrument (manual wins) ─┐
  one read transaction: instruments, trades, dividends,        ├─► engine.computeInvestments × 4 kinds
    settings, snapshots, budget, cash, other assets ───────────┘      (memoised per request)
  ─► timing: budgetInvestment ─► parcelOptimiser ─► investCountdown · considerNext ─► nextBuyHint
  ─► charts: snapshot values + contributionsAt / netPurchases ─► compressSeries
  ─► DTOs (the server adds only display fields: symbol, name, price info, default fees, settings)
```

- **The engine owns every figure.** The server loads rows, passes the fee authority fields straight through (a `fee_rate` wins over `fee_cents`), takes `asOf` as the server-local date of the injected clock, and maps the results. Money is integer cents; units, prices and ratios are decimal strings.
- **Unpriced holdings** are flagged and left out of every total; stale prices are used and flagged. A price that would value a position beyond safe-integer cents counts as no price, so one absurd price cannot fail every investment page.
- **Ledger flags** are the stored review flags plus a live `oversell`; a stored `oversell` is ignored, because the engine's FIFO (buys before sells on a date) decides it and an imported one can go stale.
- **Timing** reads the live data (Stage 3): `budgetInvestInputOf` of the same budget input the Budget page uses, the live cash balances (the emergency-fund test cash for the cash-first advice and the budget's 100 %-to-cash rule), the closed side-income periods and the months cash needs to reach its target share (`cashDeficitMonths`, SheetOptions H12; the countdown waits the longer of that and the parcel plan). Nothing is deferred any more. Missing inputs are listed by key, never guessed.
- **Charts** take market value and gain from the snapshots and recompute contributions and net purchases from the trades, so in-app trades and exited holdings count. A live point is added for the current month when no snapshot exists for it.
- **Tests** inject a fake engine through `buildApp({ engine })`; the tests that need real FIFO results run only once the engine reports itself implemented.

**Trade and holding changes.** Each runs in one `BEGIN IMMEDIATE` transaction:
1. `409 IMPORT_IN_PROGRESS` while an upload import holds the import lock, before anything else.
2. Validate (`400` with field paths; the per-kind rules and the units × price ceiling come from `@joinr/schema`, shared with the web form), then load the row (`404`).
3. Amount-mode trades become units with `unitsFromAmount` (rounded down per kind). A new trade takes the next `seq` of its kind.
4. **Oversell check:** the engine runs on that one instrument's trades before and after the change; if more units are oversold after, the transaction rolls back with `422 TRADE_OVERSELL`. An imported ledger that already oversold stays editable as long as a change does not make it worse.
5. Write with the origin rules below, commit, then tell the price service when a holding started or stopped being held (and after every holding change).
6. Answer with the row recomputed by the engine.

**Origin rules and D34.**

| Change | Effect |
|---|---|
| Create a trade or holding | `origin = 'app'`, no `sheet_ref`. |
| Update a trade | `origin = 'app'`; `sheet_ref`, `correction_id` and `seq` kept; review flags cleared (`oversell` is live). |
| Update a holding | `origin = 'app'` only when a column the importer writes changes, compared after normalising both sides, so a no-op save never flips it. The default fee is app-only: changing only it keeps `origin`. |
| Delete a row with a `sheet_ref` | The `app_meta` key `app_edits.deleted_import_rows` records it (a count and the time), in the same transaction. |
| Delete a row created in the app | Nothing is recorded. |

`hasAppData()` is true while any `origin = 'app'` row or that marker exists, so the upload import refuses (`409 IMPORT_APP_DATA_EXISTS`). The upload checks again, synchronously, right before importing (the corrections file is read in between). A committed CLI import with `--yes --replace-app-data` clears the marker; a dry run leaves it.

**Id reuse.** Instrument ids have no AUTOINCREMENT, so a deleted id can be reused. The price refresh therefore writes a price only when the instrument still has the kind and symbol it had when the run chose it.

## Cash flow and income

```
GET /api/cash · /api/side-income · /api/budget · /api/dividends (and the investment pages' timing)
  price service ─┐
  one read transaction: instruments, trades, dividends, settings (+ origins), snapshots, cash
    accounts and balance entries, budget rows, yearly expenses, streams, deposits, period notes,
    adjustments, goals, super entries, properties, loans, other assets, dividend events, the
    last dividends job run ──────────────────────────────────────────────────────────────┐
  FinanceContext (memoised per request) ◄──────────────────────────────────────────────┘
    computeInvestments ×4 · cashTotals · computeSideIncome · computeSavings · cashKpis
    · computeBudget / budgetInvestInputOf · computeDividends
  ─► page builders ─► DTOs (the server adds names, symbols, origins, notes and counts)
```

- **One context.** `createFinanceContext` reads the prices first, then every row in one read transaction, and computes each engine result at most once per request. The investment routes use the same context, so the next-buy timing reads the live budget and cash.
- **Owner-confirmed constants** (D59) live in `cashflow/constants.ts`: `LOANS_COUNT_FOR_EMERGENCY_FUND = false` (loans you've made are left out of the emergency-fund test) and `GOALS_CASH_BASIS = 'available'` (the savings goals start from available cash). The DTOs report both, so the web copy follows a change.
- **Engine inputs** (`cashflow/inputs.ts`): the snapshots' stored cash, super, salary, property and mortgage columns (the latest snapshot also carries the offset accounts' balances at its run date); the provisional period's live values (Total Cash, the current pay through `monthlyPayCents`, and from Stage 4 the super, property, mortgage and offset parts taken from the assets engines' results); every trade, other-asset purchase or sale (the assets engine's dated flows), deposit and dividend; the adjustments; the budget rows in sort order with the linked account's name.
- **Mutations** run in one `BEGIN IMMEDIATE` transaction each, answer `409 IMPORT_IN_PROGRESS` first while an upload import runs, compare "changed" after normalising both sides (so a no-op save never flips `origin`), write the deletion marker for a workbook row, and answer with the row's DTO rebuilt from a fresh context.
- **Balance history (D58):** a balance save upserts `(account, as_of)`; the account's `balance_cents`/`balance_as_of` are a copy of its latest entry, kept in step on every save and delete.
- **Recorded periods:** an adjustment is accepted only on a closed period's month (every snapshot month but the first), a period note on any snapshot month; the provisional month's label can still change.

**D34 in Stage 3.**

| Kind of data | Counts as app data |
|---|---|
| Import-owned rows (accounts, balance entries, deposits, streams, notes, budget rows, yearly expenses, dividends) created or changed in the app | Yes (`origin = 'app'`), except an account's kind-only change, which the importer keeps |
| A workbook row deleted in the app | Yes (the deletion marker) |
| A setting whose registry `source` is set (a workbook setting) edited in the app | Yes |
| An app-only setting (`savings.yearBasis`) | No |
| Savings adjustments and goals, the dividend-events cache and its dismissed flags (overlays) | No: an import never touches them, so a re-import keeps them |

**Dividend events.** `market/dividends/` implements the frozen `DividendEventsService` (`refresh`, `status`). In mode `live` or `fake` it registers a `dividends` job (daily when `PRICE_REFRESH_MINUTES` > 0, manual otherwise) that fetches Yahoo chart events and daily closes for the stocks, ETFs and managed funds with trades, converts timestamps to the exchange's local date, and upserts `dividend_events` without touching `dismissed_at`. It waits while the price job runs and shares its rate-limit cool-down. The page reads the cache: the engine turns events into suggestions (due, upcoming, dismissed) and the server adds the status, the cache counts and the last run's error (URLs removed, at most 200 characters).

## Other assets, super and property

```
GET /api/other-assets · /api/super · /api/property (and every page that reads the finance context)
  price service: prices and the market series (bullion spot, FX) ─┐
  the same read transaction, plus the price and sale logs, super funds and balance logs,       │
    SG statements, valuations, loan balance logs and offset links ───────────────────────────┐ │
  FinanceContext (memoised per request) ◄──────────────────────────────────────────────────┘ ◄┘
    computeOtherAssets · computeSuper · computeProperty (amortise inside) · assetsSnapshotColumns
  ─► page builders ─► DTOs (the server adds names, notes, origins, counts and the market tiles)
  ─► the Cash page's provisional savings period and the other-assets class value
```

- **Engine inputs** (`assets/inputs.ts`, pure and unit-tested row by row):
  - Other assets: a hand-priced item takes its latest price entry on or before the as-of date; a bullion item takes the metal's spot series × its ounces per unit, with its last known price as the fallback; a foreign item takes the live FX rate (USD from AUD/USD, other currencies from their `FX_<CCY>AUD` series, UK pence from the pound ÷ 100) and the rate on its purchase date. An undated item uses the first recorded month's date, marked assumed; the date is never written to the row.
  - Super: the funds with their balance logs (a transfer in from outside the tracked funds is not a gain), the member contributions (dated by their entry date, else the first day of the month), the SG statement months and the pay, tax and super settings with their defaults.
  - Property: the properties with their valuations; the loans with their start fields, their balance logs and their linked offset accounts that are still flagged Offset.
- **The live savings input** comes from the engine results only: the super contributions' take-home cost since the latest snapshot, the property and mortgage parts, the offset balances and the other-asset purchases and sales. The other-assets class value on the investment pages is the engine's total, at live spot and FX.
- **The History seam.** `assetsSnapshotColumns` gives the live History figures for super, property, the mortgage and other assets. Stage 5 records them with each month.
- **Logs and copies.** Prices, fund balances, valuations and loan balances are logs keyed by (parent, date). Each save upserts its entry, then sets the parent's denormalised copy (the latest entry), and each delete recomputes it. A fund, a property and a loan keep at least one entry (`409 LAST_BALANCE_ENTRY`). A loan's start date and balance give the first point of its log; no start entry is stored.
- **Mutations** follow the Stage 3 order: `409 IMPORT_IN_PROGRESS` first, then validation, load (`404`), the cross-row rules (`422 SALE_OVERSELL`, `409 FUND_IN_USE`, `409 PROPERTY_HAS_LOAN`, a 400 for a bullion item in a price save, a month after this one, an account that is not an offset), one `BEGIN IMMEDIATE` transaction, and a response rebuilt from a fresh context. A change to an item's currency or purchase date, or a bullion item, tells the price service to run, so it fetches the rate on the purchase date and the spot.
- **Offsets (D67).** A loan's offset links are replaced as a set; an account linked to another loan moves. Turning an account's Offset flag off on the Cash page removes its link in the same transaction, and deleting the account cascades it.

**D34 in Stage 4.**

| Kind of data | Counts as app data |
|---|---|
| Import-owned rows created or changed in the app: items, price entries, sales, funds, fund balances, contributions, option notes, properties, valuations, loans, loan balances and offset links | Yes (`origin = 'app'`) |
| A workbook row deleted in the app | Yes (the deletion marker) |
| Choosing the fund that receives employer SG (the flag alone) | No: the fund keeps its origin, and the importer carries the flag across a re-import by fund name |
| SG statement months (an overlay) and the market series history (a cache) | No |
| The app-only settings (stale-price days, your employer's SG rate, contributions tax, the cap override and its financial year, how imported contributions are read) | No |
| The workbook's salary, marginal tax rate and job start date edited in the app | Yes |

## History, net worth and settings

```
GET /api/net-worth · /api/history · /api/history/series · /api/settings
  FinanceContext (the same memoised request context as every page)
    snapshots() (run-date order) ─► nextRecordMonth · recordableMonths
    composeLive(): composeSnapshot(the four investment results, every trade by kind, cash totals
                   and accounts, monthly pay, the Stage 4 seam, the super measured-through date)
                   at asOf; null when a month was recorded today (no provisional period)
    netWorth(): netWorthDashboard · rolling(): rollingNetWorth · check(): checkSnapshots
  ─► aggregateSnapshots (the aggregation API: end, sum or a recomputed ratio per column)
     · compressCashflow · linearTrend (the displayed groups)
  ─► page builders ─► DTOs (+ the audit trail, the recorder's status, notes and origins)

POST /api/history/record ─► import-lock check ─► recorder.record (mutex, price refresh)
  ─► writeRecordedMonths: one BEGIN IMMEDIATE transaction; per month (ascending) a fresh context
     inside it, composeSnapshot at today, deriveSnapshotColumns, insert + audit "record"
PUT / DELETE /api/history/snapshots/:month ─► import-lock check ─► recorder.withLock
  ─► correct (figures only; the row and the next row's cash change re-derived; revision + 1;
     audit "correct") or delete (the latest app-recorded month only; audit "delete")
```

- **The snapshot model.** A `snapshots` row is one History row (B…AK) plus four Stage 5 figures (Σ offset accounts, the offsets linked to mortgages, accounts in debit, the super measured-through date), its source (`migrated`, `recorded`, `lookback`, `late`), a note and a correction count. A trigger refuses any change of a row's run date, month, source or recorded time; the audit log (`snapshot_audit`, no foreign key) keeps every record, correction (before and after, the next month's follow-ups keyed `YYYY-MM.column`) and delete (the full row). The stored derived columns come from `deriveSnapshotColumns` (a correction recomputes only those whose inputs changed; the first month's cash change is a typed seed, shifted by a corrected cash balance, never cleared), so they agree with their inputs; the History page's consistency check recomputes them, and the movement columns from the trades, for every month.
- **Recorded figures feed later periods.** The savings engine reads each recorded month's stored offset figure (the last imported month keeps the Stage 4 derivation at its run date, earlier imported months none), and the super engine each month's measured-through date, so contributions after a month's measured balance date count in the next month.
- **The recorder** (`history/recorder.ts`) owns the one-at-a-time mutex that every snapshot write goes through, the month-end timer on an injectable clock (23:00 server time on the month's last day; it never sleeps more than 6 hours), the start-up catch-up (missed months recorded `late` with today's date, never before auto-record was switched on) and the `snapshot` job's `job_runs` rows. It refreshes prices before a record and never holds the import lock: it checks the lock before the price wait and again, synchronously, right before the write.
- **The aggregation API** (`GET /api/history/series`) groups the months by month, quarter or year (the financial year by default; a month belongs to its period month's year, so June recorded on 1 July stays in June's year) and answers each column's mode. The Net Worth and History charts read the same groups.
- **Settings** (`settings/**`): `GET /api/settings` lists every registry key with its group, stored value and origin, whether it is editable and whether saving it blocks a re-import, the pages that read it (`SETTING_READERS`), and the engine's marginal-rate suggestion for the gross salary. `PATCH /api/settings` writes every editable key; `history.autoRecord` is locked while `AUTO_RECORD` is set, and a written switch tells the recorder to re-read it.

**D34 in Stage 5.**

| Kind of data | Counts as app data |
|---|---|
| A recorded month (`recorded`, `lookback`, `late`) | Yes; deleting it (latest first) clears it again |
| A correction of an imported month | Yes (the row becomes `origin = 'app'`) |
| The audit log and the recorder's `app_meta` state | No |
| `history.autoRecord` (app-only) and the display choices (`charts.*`, `features.*`; a re-import keeps them) | No |
| The workbook settings the app does not use, edited in the app | Yes |

## FIRE

```
GET /api/fire[?spend=&withdrawalRate=&inflationRate=&marketReturn=&accessAge=&extraSavings=]
  FinanceContext.fireDerived(): deriveFireInputs(dashboardFigures, netWorth().classes and
    .liabilities, property(), savings().periods, kpis(), superResult())   (once per request)
  fire/inputs.ts: each input from the query (what-if) → the stored setting (the super
    contribution: an app-origin row only) → the derived figure → the registry default → missing
  ─► projectFire(the resolved inputs + the derivation)   ─► DTOs
  ─► while a what-if is active: projectFire(the saved inputs) ─► the baseline summary
POST /api/fire/use-workbook-contribution ─► import-lock check ─► one IMMEDIATE transaction:
  the import-origin super contribution row becomes origin 'app' (value unchanged)
```

- **The engine does the maths.** `deriveFireInputs` turns the Stage 3–5 results into the FIRE inputs (pre-super net worth and the debts inside it, the yearly spend and savings from the closed periods of the 12-month window, the super contribution over the last 12 whole months, the growth weights); `projectFire` is the corrected model (the exact real rate, the bridge to the access age, super top-ups, the year-by-year path in today's dollars, milestones and status); `fireSheet` reproduces the template's formulas for the golden tests only. The server resolves the inputs and maps the DTOs; a what-if runs the projection on the query's values and saves nothing.
- **The one-off access-age upgrade** (`applySettingUpgrades(database, now)`): once per database, an import-origin `fire.preservationAge` of 65 becomes 60 with origin `app`, and an `app_meta` marker (`fire.accessAgeReplaced`, `{ from, to, at }`) records it. It runs in one IMMEDIATE transaction when `buildApp` starts (so a CLI import made while the server was down is upgraded) and after every committed import in the upload route and the CLI, never after a dry run; it logs one line with the key and the ages. With no marker and no imported 65 it does nothing, so a later import of 65 is still replaced. The marker drives the note on the FIRE page and the Settings field while the stored age is still 60.
- **Settings.** The eight `fire.*` keys are display preferences (D103): an app edit never counts as app data and a re-import keeps it, so the upgrade and every FIRE save keep `data/` re-importable. `SettingDto.notice` carries the access-age note and, on an imported super contribution, the note that the FIRE page uses the derived figure. `SETTING_READERS` names FIRE on its own keys and on every other key its derivation reads.

| Kind of data | Counts as app data |
|---|---|
| Any `fire.*` setting (a Settings save, the FIRE page's Save, Use the workbook's figure, Use the derived figure) | No (preference) |
| The upgraded access age and the `app_meta` marker | No |
| `returns.marketReturn`, `returns.cashInterestRate` (never written by the FIRE page) | Yes, as before |

## Price service and scheduler

```
scheduler ──(every PRICE_REFRESH_MINUTES, or "Refresh now")──► prices job
  prices job: series (AUD/USD, silver, gold) ─► instruments by provider ─► FX to AUD
              (incl. the currencies other assets use) ─► purchase-date FX backfill
              ─► one write transaction (prices, market_quotes, market_quote_history) ─► job_runs row
```

- **Providers:** the Yahoo chart API for listed securities, futures and FX; CoinGecko for crypto; a deterministic `fake` provider for tests and demos (`MARKET_DATA_MODE=fake`). `off` never fetches. Every request has a 10-second timeout, and a run has a 90-second deadline.
- **Resilience:** a failed fetch keeps the last good price, repeated failures back off, and a rate-limited provider cools down. A manual price always wins over a fetched one.
- **Status** is computed, never stored: `fresh`, `stale`, `failed`, `manual` or `none`. Prices seeded from the workbook show as stale until the first refresh.
- **Bullion** is priced from the built-in series (silver and gold per ounce in AUD), not from holdings.
- **Other assets (Stage 4):** the job also refreshes the FX rate of every currency an other asset uses, and fills a foreign item's rate on its purchase date from the day's close (at most 10 items a run, each pair tried at most once a day, never over a rate typed in the app). The series written each run are kept as one row per series per day in `market_quote_history`, which draws the spot price charts.
- **Day data (Stage 9):** every Yahoo fetch except a managed fund's is a one-day, five-minute chart, which brings the price, the previous close (`chartPreviousClose`) and today's regular-session bars in one call, with the old five-day daily chart as the fallback; managed funds keep the daily chart and take their day from its last two prices; the bullion inputs (`AUDUSD` and the gold and silver futures) use a two-day chart so their bars reach back to 00:00 Melbourne. CoinGecko adds a per-coin day chart. Each instrument's latest session (its date and zone, previous close and bars) is a 1:1 cache row in `day_quotes`; bullion's day since midnight (the AUD spot and the futures) is in `series_day_quotes`; `market_quotes` keeps each FX series' previous close. A fetch for an older session never replaces a newer row, the same session merges, and a fetched price never goes backwards.
- **The `intraday` job (Stage 9):** its own timer on the 5-minute marks (+20 s) runs the ASX holdings every 5 minutes on weekdays 10:00–16:25, crypto every 15 minutes around the clock, and bullion every 15 minutes from Monday 06:00 to Saturday 10:00, each as a "lite" refresh of just those targets (a failure there writes nothing and never advances the backoff), then the crypto day charts. The scopes come from the slot the timer aimed at, never the wall clock; the hourly `prices` job waits for an in-flight intraday run, so Yahoo is never asked twice at once. `INTRADAY_REFRESH=false` turns it off.
- **The `closes` job (Stage 10):** the daily price history the phone's periods are measured from. It runs daily at 16:52 server-local (every bar dated yesterday in its own zone is final by then, and :52 is off the 15-minute grid of the intraday slots), once `CLOSES_STARTUP_DELAY_MS` (about 2 minutes) after each start, and, when a run ended with targets left, up to 6 follow-ups a day at xx:07, xx:22, xx:37 or xx:52. Its targets, read at the start of each run, are the held instruments priced by Yahoo or CoinGecko, the FX series of held foreign listings, `AUDUSD` and the gold or silver futures in use. A target with no stored closes is backfilled from about 10 days before its earliest trade (Yahoo's `period1`/`period2` daily chart, never `range=`, which downgrades to monthly bars; CoinGecko's keyless API reaches back 365 days at most), then topped up with the last 10 days; Yahoo bars dated today or on a weekend are dropped, and split events are stored. After the fetches it derives the AUD bullion spot per Melbourne date (and captures the exact 00:00 Melbourne value from then on). It pauses before every request while `prices`, `intraday` or `dividends` runs, keeps CoinGecko calls 15 s apart and away from the intraday crypto slots, shares the providers' cool-downs, and writes one IMMEDIATE transaction per target after re-checking that the instrument and its price source are unchanged. `prices` awaits an in-flight closes run. `CLOSES_REFRESH=false` stops its timers (the job stays registered); the stored closes stay and are never deleted, except that a price-source change deletes that instrument's closes and splits.
- **Scheduler:** generic and reusable (Stage 3 adds the `dividends` job, Stage 5 the month-end snapshot job, Stage 7 the `backup` job, Stage 8 `nas-copy`, Stage 9 `intraday`, Stage 10 `closes`). There are no overlapping runs per job, a manual run joins one already in flight, and every run is logged in `job_runs` (the newest 500 per job are kept).

## Data

```
DATA_DIR/
  finance.db          the SQLite database (WAL mode; -wal and -shm files sit beside it while it is open)
  backups/            verified copies: <kind>-YYYYMMDD-HHmmss±HHMM.db (see Backups and restore)
  import-corrections.json   optional: the owner's import corrections (on the server)
  secrets/            optional: the NAS copy's two files (Stage 8)
  devices/            devices.json: the paired phones, key hashes only (Stage 9; folder 0700, file 0600)
```

- **Money** is stored as integer cents. **Quantities and prices** are decimal strings, handled with decimal.js (crypto needs about 8 dp).
- Dates display as `dd/mm/yyyy`. The financial year runs from 1 July to 30 June.
- **Migrations:**
  - `drizzle-kit generate` writes SQL and a snapshot into `apps/server/migrations/`, and both are committed.
  - The server applies them at start-up.
  - Migrations are append-only: never edit one that has shipped.
  - The schema lives in `packages/schema` (Stage 1), and the migrations folder stays with the server. Later stages only add tables or nullable/defaulted columns.
- **Provenance.** Imported rows carry `origin = 'import'` and a `sheet_ref` such as `ETFs!A31`. Rows the importer finds questionable carry review flags. Rows created or edited in the app carry `origin = 'app'` (see [Investments](#investments) for the rules).
- **Snapshots** (imported from History in Stage 1, recorded by the app from Stage 5) are immutable rows. Corrections are explicit edits, never silent recalculation.
- **Price-history caches (Stage 10, migration 0007):** `instrument_closes` (one close per instrument per date, with its currency and source), `instrument_splits` (Yahoo's split events) and `series_closes` (FX, `AUDUSD`, the futures and the derived AUD bullion spot per date). They are caches, not app data: they never count for "has app data", the records browser never lists them, and only the `closes` job fills them. They are separate from `market_quote_history` (Stage 4), which keeps the last value seen on each Melbourne date and is left exactly as it was.

## Backups and restore

```
BackupService (own timer on the injectable clock)
  ├─ at 02:30 server-local (the October gap: 03:30; the April repeat: the first 02:30)
  ├─ ~2 min after start: one catch-up if the last slot passed while the server was down
  └─ "Back up now" (POST /api/backups)
        └─► scheduler job "backup" (job_runs row: trigger, status, detail)
              └─► writeVerifiedBackup: space check → VACUUM INTO .<name>.partial (bound parameter)
                    → make the copy self-consistent → integrity_check + migration count → fsync
                    → rename to <name> → fsync the folder → prune that kind's set
```

- **One flat folder**, `<DATA_DIR>/backups/`, of immutable, self-describing files named `<kind>-YYYYMMDD-HHmmss±HHMM.db` in server-local time with its offset, so the two 02:30s of the April change get different names and every name sorts and parses to one instant. Stage 1 pre-import names without an offset still list and prune. Anything not matching the name rule (a hand-made folder, a stray file) is never listed, pruned or deleted. The weekly copy to the NAS reads the same folder through the same lister (see [Copy to the NAS](#copy-to-the-nas)).
- **The copy** is a consistent snapshot (`VACUUM INTO`, synchronous). On a second connection to the temporary file it is switched to `journal_mode = DELETE` (one self-contained file), the running marker is removed, its own `backup` run is marked `succeeded` and any other `running` row `failed`/`interrupted`, so a restored copy never shows its own backup as failed. It is kept only if `integrity_check` is `ok` and the migration count matches. A failed copy never prunes anything.
- **Retention** (pure, grouped by the date written in the name, so it does not depend on the process zone): nightly, the newest copy of each of the 14 newest dates that have one, plus the newest copy of each of the last 12 calendar months; manual 10, pre-import 10, pre-restore 5, pre-migrate 5. A file dated more than a day in the future is never pruned and never settles a slot.
- **The due rule:** a slot is settled by a nightly file dated from the slot to ten minutes after now, by a succeeded run recording that slot (the empty-database skip), or by three failed attempts. Failures retry after 15 minutes; an import in progress skips (and retries) without counting as an attempt. The job returns one of three category messages, never a path or raw SQLite text.
- **Stale:** schedule on, domain data present, and no nightly or manual copy (or, before the first, no committed import) in 48 hours: `/api/status` `backups.stale` and a callout on every page.
- **Restore** (`backups/restore.ts`, `cli/restore.ts`) runs with the server stopped: validate the candidate (header, integrity, a Joinr database of the same migration lineage, not newer than this build; a path candidate is validated as a temporary copy) → refuse if the running marker is set (`--force` skips it) or another process holds the database → a `pre-restore` copy of the live database (or, with `--force`, the damaged live files moved to a hidden `.unverified-pre-restore-*` folder) → stage `.finance.db.restoring` → atomic rename over `finance.db` → post-check → the `restore.last` marker. Every read before `--yes` is read-only.
- **Start-up safety:** `migrateWithBackup` (see [Server](#server)).

## Copy to the NAS

```
NasCopyService (apps/server/src/nascopy; own timer, capped at a 1-hour wake)
  ├─ Sunday 03:00 server-local (calendar arithmetic: the DST weeks are 167 h and 169 h)
  ├─ ~5 min after start: one catch-up when the last Sunday's slot is not settled
  ├─ retries +1 h, +2 h, +4 h for transient reasons only (4 attempts per slot)
  └─ "Copy to NAS now" (POST /api/backups/nas-copy → 202; the page follows lastRun.id)
        └─► scheduler job "nas-copy" (job_runs row; never throws)
              └─► await backups.whenIdle() → read <DATA_DIR>/secrets/{nas-url,nas-password}
                    → rsync --list-only (the NAS)  → plan: missing or wrong-sized names, newest first
                    → rsync <sources…> <url>/ (one run) → rsync --list-only again → prove each size
```

- **Transport (D126, D127):** an rsync **daemon** account on the NAS, allowed on one module (one folder) only, not SSH: the account can reach nothing else on the NAS, and a leaked password is worth one folder of backups. The protocol is plaintext; the address is the NAS's **Tailscale IP** (tailnet names do not resolve inside the container), so the transfer rides inside WireGuard. The app's private bridge reaches the tailnet through the host's routing.
- **The configuration** is two one-line files in `<DATA_DIR>/secrets/`, both or neither (`off`, `partial`, `invalid`, `ready`), read afresh at every run, status request and timer wake, so placing them needs no restart. The app only reads them. The owner places them with `pnpm umbrel:nas-secrets` over SSH, the values on SSH's standard input, the password first (so the app never sees an address without its password), each staged to a hidden `.new` file at mode 600 and checked before the commit. The manifest's `backupIgnore` keeps them out of umbrelOS's own Backups.
- **The password's path:** file → one local in `copy.ts` → the rsync child's environment (`RSYNC_PASSWORD`). The child's environment is built from scratch (`PATH`, `LC_ALL=C`, the password; no `HOME`, so no `~/.popt` alias can add a flag; the image fails its build if `/etc/popt` exists), `shell: false`, the password never in argv, a file, a log, a `job_runs` row, a DTO or an error. A control character in it refuses the copy before any spawn. Spawn errors are rebuilt from their `code` only (Node's own carry the argv).
- **Only adds:** the only flags are `--times --contimeout=10 --timeout=120` (plus `--list-only` for the listings). No delete, recursion, in-place, append or partial flag: rsync writes each file to a hidden temporary on the NAS and renames it when complete, so an interrupted copy leaves no half file under a backup's name, and a wrong-sized namesake is replaced the same way (D130). A source scan and a behavioural test pin the flags; the smoke's scratch daemon refuses the forbidden ones.
- **The proof:** after the send, a second listing must show every intended name at the size recorded in the plan; a name that vanished here meanwhile (a retention prune) is not counted. Listings are parsed strictly (regular-file lines only, the whole remainder as the name, the backup name rule), so a foreign or hidden file on the NAS is never counted or touched. A truncated listing is never read as "missing".
- **Outcomes** are fixed sentences keyed by a reason (`auth`, `unknown_module`, `refused`, `unreachable`, `timeout`, `broken`, `nas_io`, `not_verified`, `readback_failed`, `no_rsync`, `stopped`, `other` and the four configuration reasons), classified from rsync's exit code and a few fixed stderr patterns; nothing rsync printed is ever repeated. **The refusal lock:** after `auth`, `unknown_module` or `refused`, neither the timer nor the button tries again until `nas-url` or `nas-password` has a newer modification time (placing the files again), so the NAS's brute-force protection is never provoked by the app.
- **Stale:** no success for 8 days while ready (or 8 days after the first real attempt): `/api/status` `nasCopy` and a callout on every page, which also shows when the copy is half set up, unusable or locked.
- **Shutdown:** `preClose` stops the copy first; rsync gets SIGTERM, then SIGKILL 2 s later, and the service waits at most 4 s, inside the server's 10-second exit budget. The run is recorded `stopped` and is not an attempt; the next start catches up.
- **rsync in the image:** installed from Debian bookworm in the runtime stage (the build prints the upstream version and the Debian revision). The dev PC has none; the real binary is exercised only by the smoke on the Umbrel (`pnpm umbrel:smoke nas`: the image's own rsync as a scratch daemon on a private Docker network, never the real NAS).

## The phone app

```
Android app (apps/android: Kotlin, Compose, Glance widgets, WorkManager every 30 min)
  │  Authorization: Bearer <key>  and  X-Joinr-Key: <key>     (plain HTTP inside Tailscale)
  ▼
app_proxy :4932 ── PROXY_AUTH_WHITELIST "/api/mobile/*" ──► app:3001
  /api/mobile plugin (onRequest: the key check; a root onRoute hook refuses any other
  │                   /api/mobile route at start-up)
  ├─ GET  /api/mobile/today   ─► the today builder ─► engine computeDayChange (pure)
  ├─ GET  /api/mobile/periods ─► the periods builder (the stored daily closes) ─► engine computePeriods (pure)
  ├─ GET  /api/mobile/device
  ├─ POST /api/mobile/pair    (no key; the open code, 5 minutes, in memory only)
  └─ anything else            ─► 405 MOBILE_READ_ONLY
/api/phone/* (Settings → Phone, behind the Umbrel login): open or cancel a code, list, remove
```

- **The device store** (`<DATA_DIR>/devices/devices.json`) is not in the database: a database restore swaps the whole file, so keys kept there would come back after their phone was removed, and they would travel to the NAS. It holds a SHA-256 of each 256-bit key (a fast hash is right for random keys), loaded once into memory and rewritten atomically and synchronously on every change. A failed write refuses a pairing (503) but never a removal: the removal applies in memory at once and is retried until saved. An unreadable file is set aside, never deleted. umbrelOS Backups skip the folder.
- **The key** appears once, in the 201 body of the pairing exchange, and then lives only in the phone's encrypted store; it is never logged or stored in clear, and no DTO carries a key hash. Unknown keys are rate-limited; a valid key never is.
- **Pairing** needs a 10-character code (50 bits, Crockford base32) the owner opens in Settings → Phone: valid 5 minutes, cancelled after 5 wrong codes, 20 attempts per 10 minutes while open, compared in constant time and consumed before any `await`. The QR code holds `joinrfinance://pair?v=1&u=<origin>&c=<code>`; the web and the app parse it with the same rule and the same table of cases.
- **The day figures** are one pure engine function (`computeDayChange`): per holding in AUD cents including the currency move, from each holding's latest session (crypto and bullion from 00:00 Melbourne), lots bought in the session from their trade price, hand-priced, stale and unpriced holdings without a figure, and totals that are exact sums. The values (`valueCents`, units) are the web pages' own, so the phone and the web always agree.
- **The period figures (Stage 10)** are a second pure engine function (`computePeriods`, `packages/engine/src/periodChange.ts`), for 1W, 2W (7 and 14 days) and 1M to 12M (calendar months, the day clamped), all seven in one answer so the chips switch instantly and offline. Per holding: units held at the start count from the start close (the close of the start date, or the last one at most 10 days before it, converted to AUD at that date's FX close), units bought within the period from their purchase price, units sold within it count nothing; a holding with no start close, a split inside the period or a price older than the start has no figure for its start units, and the total is marked partial. **ALL** is unrealised plus realised as the web's holdings pages compute them (the same engine results), with the fully sold instruments as one "Sold holdings" figure; its line draws today's holdings only and ends at their unrealised gain. The period lines are drawn from the daily closes; the last point of each 1W–12M line is its total. The engine works on dates only; the server turns every instant into a date in the right zone. `/api/mobile/today` is unchanged, so an older app and the widgets keep working.
- **Traversal:** the app matches raw paths and never normalises dot segments, so `/api/mobile/../backups` is a 404 or a 405, never another route (tested over a real socket: `inject` normalises the URL and would hide it). Whether the proxy normalises before matching is proved live before pairing (the runbook's proxy probes), with a compose-only rollback.

## Security

- **No login in the app.** On the Umbrel, the app proxy puts Umbrel's login in front of every path, the backup downloads included, except the phone API: `PROXY_AUTH_WHITELIST: "/api/mobile/*"` (from 1.2.0), where every route checks a paired key and nothing writes but the pairing exchange (see [The phone app](#the-phone-app)).
- **Cross-site write guard** (`security.ts`, an `onRequest` hook on `/api/*` for `POST`, `PUT`, `PATCH`, `DELETE`; "under `/api`" is decided on the route Fastify matched and on the percent-decoded path, never the raw URL, since the router decodes `/%61pi/…` to an `/api` route). The browser sends the Umbrel login cookie to every port of the same host, so a page served by another app could otherwise post to this one. With `Sec-Fetch-Site` present, only `same-origin` and `none` pass. **Browsers send Fetch Metadata only to trustworthy origins (HTTPS or localhost)**, and the app is reached over plain HTTP, so in production the `Origin` header decides: it must match the request's `Host`, its `X-Forwarded-Host` (and port), or `PUBLIC_PORT` (set to the manifest port, because whether the app proxy keeps `Host` could not be checked offline). On `PUBLIC_PORT` the `Origin`'s host must still be the host the browser used: `X-Forwarded-Host`'s host when the proxy sends one, else `Host`'s when `Host` is still on `PUBLIC_PORT`. Only when the proxy rewrites `Host` and sends no `X-Forwarded-Host` does the port alone decide (an accepted residual risk: a page on another host served from port 4932; the server logs this case once at start of use, with the `Host` it saw). Outside production a loopback `Origin` also passes (the Vite proxy rewrites `Host`). `Origin: null` is refused. Requests with neither header (curl, the CLIs, `app.inject`) pass. A refusal is `403 CROSS_SITE_REQUEST`, logged with the three header values only.
- **Downloads** accept only names matching the backup rule (at most 64 characters, no separators or dot segments after decoding), `lstat` a regular file (not a symlink) whose real parent is the backups folder, and answer with `attachment`, `nosniff` and `no-store`.
- **Network isolation on the Umbrel.** Every Umbrel app's default network is the shared `umbrel_main_network`, so any container of any installed app could otherwise call the API directly with no session. The store compose puts the app on a private `finance` bridge that only the app proxy joins (the bridge keeps internet egress for market data). If the proxy ever cannot reach the app over it (a 502 at install), the fallback is a compose-only release without the two `networks` blocks, and the risk above is then accepted and documented in the runbook.

## Deployment

```
dev PC (Windows)                                    Umbrel (umbrelOS, x86_64)
 pnpm umbrel:release                                ~/joinr-build/<version>-<tree12>/  (newest 3 kept)
  ├─ git tree (clean HEAD, or a temporary index)    docker build → 127.0.0.1:4930/joinr-finance:<v>
  ├─ privacy guard (the same file set)      ─ssh─►  docker push → the Joinr Registry app (loopback)
  ├─ git archive | ssh … tar -x                     umbreld pulls it at Install / Update
  └─ tag@digest + version: into the local           tenon-joinr-finance_app_1 on the "finance" bridge
     store clone (never committed)                  app_proxy on :4932 (Umbrel login) → app:3001
```

- **Why a registry on the Umbrel:** umbreld pulls every compose image at install and at update, so an image that exists only after a local `docker build` cannot install. Docker treats `127.0.0.0/8` as an insecure (HTTP) registry, so a loopback registry needs no TLS and is unreachable from outside the host. It runs as its own store app (`tenon-joinr-registry`), on its own private Docker network rather than the shared `umbrel_main_network` (so other apps' containers cannot reach its unauthenticated API), because umbreld removes every non-app container at each start, and an Update clicked while the registry is down stops the app and bumps its manifest before the pull fails. A plain `joinr-registry` container (`JOINR_REGISTRY_MODE=container`) is the documented fallback.
- **The image:** `node:24.x-bookworm-slim` pinned by index digest; labels carry the version and the git tree id; build-time checks run both CLIs and assert the `Australia/Melbourne` zone (the app would otherwise record at the wrong hour); the runtime installs `rsync` from Debian for the copy to the NAS; the build stage caps Node's heap (the build shares the Umbrel with other services, and the release script refuses to build with less than 2.5 GiB free).
- **Versions:** one source of truth, the root `package.json` `version` (`/api/health`, the footer, Settings → About, the image tag, the store manifest). The release refuses an existing tag unless the same tree built it (`--reuse-existing`), and refuses a new digest under an unchanged manifest version. Rollback is a new version that pins the older digest, plus a restore of the `pre-migrate` copy when the newer version migrated.
- **The data folder** is `${APP_DATA_DIR}/data` on the Umbrel (D113), created as uid 1000 from the store's `data/` skeleton at install. An update never touches it; an uninstall deletes it without asking. The manifest's `backupIgnore` makes umbrelOS's own Backups skip the live database's shared-memory file, every hidden temporary, `data/secrets` (the NAS copy's password) and `data/devices` (the paired phones' key hashes, so an Umbrel-level restore never brings back a removed phone).
- **Operations** (`tools/deploy`, [`docs/deploy/RUNBOOK.md`](deploy/RUNBOOK.md)): every remote step is one `ssh -o BatchMode=yes <host> -- '<command>'`; every value placed in a command is validated and single-quoted; the remote home is resolved once and never written down; restore reads the image and `TZ` from the app-data compose with `yq` (Umbrel's Stop and Restart remove the container), runs the CLI by image ID in a one-off `--network none` container, and never starts a container umbreld stopped.

## Styling

- Plain CSS with custom properties. There is no Tailwind, CSS-in-JS or CSS Modules.
- There is one stylesheet entry, `@joinr/ui/styles.css`. It declares the cascade layers `base, core, brand, charts`, and the web app adds `app` after them. Each area writes only its own layer.
- Classes are global, BEM-style and prefixed by owner:

  | Prefix | Area |
  |---|---|
  | `jf-*` | core |
  | `jf-brand-*` | brand |
  | `jf-chart-*` | charts |
  | `jf-app-*` | the web app |

- Element selectors appear only in the base layer. Components never import CSS.
- Design tokens (colours, spacing, radii, fonts, type scale) are CSS variables in `core/tokens.css`. They are mirrored in `core/tokens.ts` for ECharts, and a test keeps the two in step.
- Breakpoints:

  | Width | Layout |
  |---|---|
  | ≤ 767.98 px (phone) | 1 column |
  | 768 px and up (tablet) | 6 columns |
  | 1200 px and up (desktop) | 12 columns |
  | below 1024 px | the sidebar becomes a drawer |

- Glows and shadows appear only in brand moments.
- The visual rules are in [`docs/style/STYLE_GUIDE.md`](style/STYLE_GUIDE.md).

## Testing

| Layer | Tool | Where |
|---|---|---|
| Pure logic (formatters, config, rules, engine) | Vitest, node environment | `*.test.ts` next to the code, or in `test/` |
| Components | Vitest + Testing Library, jsdom | `packages/ui`, `apps/web` |
| Server | Vitest + Fastify `inject`, with a temp `DATA_DIR` per test | `apps/server/test` |
| Privacy guard | Vitest; the integration tests run the real hook in a temporary git repo | `tools/privacy-guard/test` |
| Deploy scripts | Vitest (project `deploy`, a `.mjs` config) with a fake command runner; static checks of the Dockerfile and the store folders; one real-spawn test | `tools/deploy/test` |
| End to end | Playwright at 1440 px and 375 px, installed Chrome | `e2e/` |
| Importer | Vitest against an in-memory database and the generic synthetic workbook (no network, corrections off) | `packages/importer`, `apps/server/test` |
| Golden values | Vitest. Expected values are read at runtime from the local workbook, and the tests skip when it is absent. | importer (Stage 1), engine and the investments API (Stage 2 on), the cash-flow API (Stage 3), the other assets, super and property APIs (Stage 4) |

Each app, package and tool is a Vitest project, and the root `vitest.config.ts` runs them all.

## Build outputs

| Command | Output |
|---|---|
| `pnpm --filter @joinr/web build` | `apps/web/dist/`: `index.html`, hashed `assets/`, `favicon.svg` |
| `pnpm --filter @joinr/server build` | `apps/server/dist/server.js`, `dist/cli/import.js`, `dist/cli/restore.js` + source maps (details below) |
| `docker build .` | `/app`, laid out below |

The server bundle:
- It is made by esbuild: ESM, `node24`.
- Workspace code is bundled in.
- Every third-party dependency listed in the server's `package.json` stays external and loads from `node_modules`. SheetJS (`xlsx`) is a dependency of the importer only, so it is bundled in.

The image's `/app` holds:
- `dist/server.js` and the two CLIs in `dist/cli/`
- `migrations/`
- `web/` (the SPA)
- `node_modules/`, with production dependencies only

Paths resolve relative to the server's own file, so the same bundle works from `apps/server` in the repo and from `/app` in the image.

## Privacy by design

- The owner's workbook, specs and notes stay in git-ignored folders on the development PC.
- The pre-commit guard blocks those paths and any value that looks private: IP addresses, emails, Drive links, phone numbers, ABNs and a local list of private terms. See the README's [Privacy](../README.md#privacy) section.
- Tests assemble "secret-looking" sample values at runtime, so no test file contains one.
- Demo, gallery and test data use obviously generic names and figures.
