# Architecture

How Joinr Finance is put together. [`PLAN.md`](../PLAN.md) gives the reasons behind each choice; this page describes the result. The stage plans in [`docs/stages/`](stages/) hold the task-level detail.

## Runtime

```
 Browser (any PC or phone, over the home network or a VPN)
        │   the Umbrel app proxy adds the login when deployed (Stage 7)
        ▼
 ┌──────────── one Docker container ─────────────────────────────┐
 │  Node 24 · Fastify                                            │
 │   ├─ /api/*        JSON API ──► engine (pure TypeScript)      │
 │   ├─ everything    the built React SPA (static files)         │
 │   ├─ SQLite (better-sqlite3 + Drizzle) ◄── DATA_DIR volume    │
 │   ├─ price service + cache, job scheduler (Stage 1)           │
 │   └─ later: month-end snapshots (5), backups (7)              │
 └───────────────────────────────────────────────────────────────┘
 DATA_DIR → a folder on the server's storage: finance.db, backups/ (+ exports/ later)
```

- The app is one process with one database file.
- The server and the database sit on the same machine, so SQLite never runs over a network filesystem.
- There is no auth code in the app. When deployed, the Umbrel app proxy puts the Umbrel login in front of it. In local development there is no login.

## Packages

A pnpm workspace with three kinds of member.

```
apps/web ─────────► @joinr/ui, @joinr/schema (types and plain constants only, never /db)
apps/server ──────► @joinr/importer, @joinr/schema   (+ @joinr/engine from Stage 2)
packages/importer ► @joinr/schema, xlsx (SheetJS)
packages/schema   ► drizzle-orm, zod, decimal.js     (the root entry has no drizzle import)
tools/privacy-guard  (standalone, Node built-ins only)
```

| Package | Role |
|---|---|
| `@joinr/web` | React 19 + Vite SPA. Code-based TanStack Router routes and TanStack Query. There is one route per page, plus `/styleguide` (the component gallery) and `/preview/screen/:variant` (the brand screens). |
| `@joinr/server` | Fastify API, SQLite access and migrations. In production it also serves the SPA. |
| `@joinr/ui` | Design tokens, global CSS, layout and content components, brand components and chart wrappers. It is split into `core`, `brand` and `charts`. |
| `@joinr/engine` | Pure calculation functions (holdings, savings, FIRE). It has no I/O. Stage 2. |
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
3. **Migrations.** `runMigrations` applies pending SQL migrations in one transaction. A second run is a no-op.
4. **Bookkeeping.** The server records `created_at` once and `last_started_at` on every start, in `app_meta`.
5. **Stale runs.** `markInterruptedRuns` marks import and job runs left `running` by a crash or restart as `failed` (`interrupted`).
6. **App.** `buildApp({ config, db, services: defaultServices })` builds the Fastify instance. It has no side effects at import. The services factory receives the app's own logger and builds the scheduler and the market data service; the app is decorated with both (`app.scheduler`, `app.market`). Tests omit `services` and get `offServices`: market data off, no timers.
7. **Listen.** It logs `Joinr Finance listening on http://HOST:PORT`, then starts the scheduler.

Shutdown:
- The first `SIGINT`, `SIGTERM` or `SIGBREAK` runs `app.close()`. A `preClose` hook stops the scheduler first (aborting and awaiting an in-flight price run), then an `onClose` hook closes SQLite.
- A second signal, or a 10-second timeout, forces the exit.

| Module | Responsibility |
|---|---|
| `config.ts`, `paths.ts` | Environment validation. Finds the repo root (the folder with `pnpm-workspace.yaml`), the migrations folder and the web build. |
| `db/database.ts`, `db/schema.ts`, `db/meta.ts` | The connection, migrations, the `app_meta` table and its helpers. |
| `app.ts` | Fastify setup: the services, security and `cache-control` headers, the error handler, routes, SPA serving and the not-found handling. |
| `db/backup.ts` | Pre-import backups (`VACUUM INTO`, newest 10 kept). |
| `db/queries/*` | Shared queries: held units per instrument, "has imported data", stale-run cleanup, import-run DTOs. |
| `records/` | The record browser: one loader per registry entity, serialised to the registry's columns. |
| `routes/health.ts` | `GET /api/health`. |
| `routes/status.ts` | `GET /api/status` (header freshness). |
| `routes/records.ts` | `GET /api/records`, `GET /api/records/:entity`. |
| `routes/import.ts` | `POST /api/import` and the import runs. |
| `routes/prices.ts` | Prices, refresh, manual overrides, price sources, market series. |
| `market/` | The price service: providers (Yahoo chart, CoinGecko, fake), FX and bullion series, the refresh job, price status. |
| `scheduler/` | A small generic job scheduler that logs every run in `job_runs`. |
| `cli/import.ts` | `pnpm import:workbook`. |
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
- **Upload route.** The body is the raw `.xlsx` (25 MiB limit; a route-scoped parser accepts only `application/octet-stream` and the xlsx MIME type). One import runs at a time. While app-entered rows exist (`origin = 'app'` in a domain table, `instruments` or `settings`; `hasAppData()`), a real import answers `409 IMPORT_APP_DATA_EXISTS` before the confirm check, with no backup and no run row; dry runs still run, and only the CLI overrides, with `--yes --replace-app-data` (D34). When data exists, a real import needs `confirmReplace=true` and takes a `VACUUM INTO` backup first. A committed import tells the price service to refresh soon.
- A crash mid-import leaves the data untouched (the transaction rolls back), and the next start marks the run `failed`.

## Price service and scheduler

```
scheduler ──(every PRICE_REFRESH_MINUTES, or "Refresh now")──► prices job
  prices job: series (AUD/USD, silver, gold) ─► instruments by provider ─► FX to AUD
              ─► one write transaction (prices, market_quotes) ─► job_runs row
```

- **Providers:** the Yahoo chart API for listed securities, futures and FX; CoinGecko for crypto; a deterministic `fake` provider for tests and demos (`MARKET_DATA_MODE=fake`). `off` never fetches. Every request has a 10-second timeout, and a run has a 90-second deadline.
- **Resilience:** a failed fetch keeps the last good price, repeated failures back off, and a rate-limited provider cools down. A manual price always wins over a fetched one.
- **Status** is computed, never stored: `fresh`, `stale`, `failed`, `manual` or `none`. Prices seeded from the workbook show as stale until the first refresh.
- **Bullion** is priced from the built-in series (silver and gold per ounce in AUD), not from holdings.
- **Scheduler:** generic and reusable (Stage 5 adds the month-end snapshot job, Stage 7 backups). There are no overlapping runs per job, a manual run joins one already in flight, and every run is logged in `job_runs` (the newest 500 per job are kept).

## Data

```
DATA_DIR/
  finance.db          the SQLite database (WAL mode; -wal and -shm files sit beside it while it is open)
  backups/            pre-import-YYYYMMDD-HHmmss.db (newest 10); Stage 7 adds nightly copies
  import-corrections.json   optional: the owner's import corrections (on the server)
  exports/            later: JSON exports
```

- **Money** is stored as integer cents. **Quantities and prices** are decimal strings, handled with decimal.js (crypto needs about 8 dp).
- Dates display as `dd/mm/yyyy`. The financial year runs from 1 July to 30 June.
- **Migrations:**
  - `drizzle-kit generate` writes SQL and a snapshot into `apps/server/migrations/`, and both are committed.
  - The server applies them at start-up.
  - Migrations are append-only: never edit one that has shipped.
  - The schema lives in `packages/schema` (Stage 1), and the migrations folder stays with the server. Later stages only add tables or nullable/defaulted columns.
- **Provenance.** Imported rows carry `origin = 'import'` and a `sheet_ref` such as `ETFs!A31`. Rows the importer finds questionable carry review flags.
- **Snapshots** (imported from History in Stage 1, recorded by the app from Stage 5) are immutable rows. Corrections are explicit edits, never silent recalculation.

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
| End to end | Playwright at 1440 px and 375 px, installed Chrome | `e2e/` |
| Importer | Vitest against an in-memory database and the generic synthetic workbook (no network, corrections off) | `packages/importer`, `apps/server/test` |
| Golden values | Vitest. Expected values are read at runtime from the local workbook, and the tests skip when it is absent. | importer (Stage 1), engine (Stage 2 on) |

Each app, package and tool is a Vitest project, and the root `vitest.config.ts` runs them all.

## Build outputs

| Command | Output |
|---|---|
| `pnpm --filter @joinr/web build` | `apps/web/dist/`: `index.html`, hashed `assets/`, `favicon.svg` |
| `pnpm --filter @joinr/server build` | `apps/server/dist/server.js` + source map (details below) |
| `docker build .` | `/app`, laid out below |

The server bundle:
- It is made by esbuild: ESM, `node24`.
- Workspace code is bundled in.
- Every third-party dependency listed in the server's `package.json` stays external and loads from `node_modules`. SheetJS (`xlsx`) is a dependency of the importer only, so it is bundled in.

The image's `/app` holds:
- `dist/server.js`
- `migrations/`
- `web/` (the SPA)
- `node_modules/`, with production dependencies only

Paths resolve relative to the server's own file, so the same bundle works from `apps/server` in the repo and from `/app` in the image.

## Privacy by design

- The owner's workbook, specs and notes stay in git-ignored folders on the development PC.
- The pre-commit guard blocks those paths and any value that looks private: IP addresses, emails, Drive links, phone numbers, ABNs and a local list of private terms. See the README's [Privacy](../README.md#privacy) section.
- Tests assemble "secret-looking" sample values at runtime, so no test file contains one.
- Demo, gallery and test data use obviously generic names and figures.
