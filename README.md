# Joinr Finance

A self-hosted personal-finance web app. It tracks net worth, investments (shares, ETFs, managed funds and crypto), cash flow, super, property and a FIRE plan. It rebuilds a personal-wealth spreadsheet template as a web app that runs on a home server and opens in a browser on any PC or phone. It is styled to the Joinr brand in dark mode.

**Status:** Stage 1, data model, workbook importer and market data. See [`PLAN.md`](PLAN.md) for the stages, and [`docs/HANDOFF.md`](docs/HANDOFF.md) for where work stopped.

> [!IMPORTANT]
> **This repository is public.** It holds code and generic documentation only. The owner's workbook, specs, notes and data live in git-ignored folders, and a pre-commit **privacy guard** blocks them (see [Privacy](#privacy)). Code, tests, seeds and docs use obviously generic values such as "Example Co", `$12,480.00` and `user@example.com`.

---

## Quick start

**You need:** Node 24, pnpm 11 and git. Use `corepack enable`, or `npm install --global pnpm@11.23.0`.

```sh
pnpm install   # installs everything and points git at .githooks (the privacy guard)
pnpm dev       # API on http://127.0.0.1:3001, web app on http://localhost:5173
```

Open <http://localhost:5173>. The web dev server proxies `/api` to the API server. The database is created on first start at `data/finance.db`, which is git-ignored.

To run the production build locally, where one process serves the API and the built web app:

```sh
pnpm build
pnpm start     # http://127.0.0.1:3001
```

## Scripts

Run these from the repo root.

| Script | What it does |
|---|---|
| `pnpm dev` | Runs the API (`tsx watch`) and the web app (Vite) together. |
| `pnpm build` | Builds the web app (`apps/web/dist`), then bundles the server (`apps/server/dist/server.js`). |
| `pnpm start` | Starts the bundled server in production mode. It serves the API and the built SPA. |
| `pnpm test` | Runs all Vitest projects: `web`, `server`, `ui`, `engine`, `schema`, `importer`, `privacy-guard`. |
| `pnpm e2e` | Runs the Playwright specs at 1440 px (desktop) and 375 px (phone). The config starts `pnpm dev` itself. |
| `pnpm lint` | Runs ESLint over the whole repo with zero warnings allowed. |
| `pnpm typecheck` | Runs `tsc` for the root and every package. |
| `pnpm format` / `pnpm format:check` | Writes or checks Prettier formatting. |
| `pnpm check` | Runs typecheck, lint and test. |
| `pnpm guard` | Runs the privacy guard on staged files. The pre-commit hook runs the same check. |
| `pnpm guard:all` | Runs the privacy guard on every tracked file and every untracked file that is not ignored. |
| `pnpm import:workbook [file.xlsx] [--dry-run] [--yes] [--replace-app-data] [--corrections <file> | --no-corrections] [--json]` | Imports the workbook export into `DATA_DIR` (see [Importing the workbook](#importing-the-workbook)). |
| `pnpm seed:dev` | Replaces the data in `DATA_DIR` with a small generic data set, for UI work without a workbook. If `DATA_DIR` already holds data it asks for `--yes` (exit 3), and with `--yes` it backs the database up first. |
| `pnpm db:generate --name <name>` | Generates a SQL migration from the schema in `packages/schema` (same as `pnpm --filter @joinr/server db:generate`). Migrations are append-only. |

To scope a run while working: `pnpm exec vitest run --project server`, or `pnpm exec eslint apps/server`.

## Configuration

Everything is set through environment variables. The server validates them at start-up and lists every invalid one before it exits.

| Variable | Used by | Default | Notes |
|---|---|---|---|
| `PORT` | server, Vite proxy, Playwright | `3001` | The API port. The server exits if the port is taken. |
| `HOST` | server | `127.0.0.1` | The Docker image sets `0.0.0.0`. |
| `WEB_PORT` | Vite, Playwright | `5173` | The dev web port (strict). |
| `API_TARGET` | Vite proxy | `http://127.0.0.1:$PORT` | Overrides the whole `/api` proxy target. |
| `DATA_DIR` | server | `data` | Holds `finance.db`. A relative path resolves against the repo root. |
| `NODE_ENV` | server | `development` | `development`, `production` or `test`. |
| `LOG_LEVEL` | server | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`. |
| `SERVE_WEB` | server | on in production | `true`/`false` (also `1`/`0`, `yes`/`no`). Serves the built SPA. |
| `WEB_DIST_DIR` | server | `apps/web/dist` | The folder of the built SPA. The image uses `/app/web`. |
| `MIGRATIONS_DIR` | server | `apps/server/migrations` | The SQL migrations folder. |
| `MARKET_DATA_MODE` | server | `live` (`off` under `NODE_ENV=test`) | `live` fetches prices (Yahoo chart, CoinGecko), `fake` gives deterministic offline prices (e2e, demos), `off` never fetches (refresh answers `503`). Playwright defaults to `fake`. |
| `PRICE_REFRESH_MINUTES` | server | `60` (`0` under `NODE_ENV=test`) | The scheduled price refresh interval, `0`–`1440`. `0` switches the timer off; **Refresh now** still works. |
| `IMPORT_CORRECTIONS_FILE` | server, import CLI | unset (auto) | The corrections file for the workbook import. A path (relative to the repo root), or `none` to switch corrections off. Unset: `<DATA_DIR>/import-corrections.json`, else `reference/import-corrections.json` in a dev checkout, else none. Playwright defaults to `none`. |
| `PW_CHANNEL` | Playwright | `chrome` | Uses an installed browser: `chrome`, `msedge`, or `chromium` (the cached build). Browsers are never downloaded. |

To use different ports (for example, a second copy running side by side):

```sh
# Git Bash / macOS / Linux
PORT=3101 WEB_PORT=5101 DATA_DIR=artifacts/my-data pnpm dev
```

```powershell
# PowerShell
$env:PORT='3101'; $env:WEB_PORT='5101'; $env:DATA_DIR='artifacts/my-data'; pnpm dev
```

## Repository layout

```
apps/
  web/                 @joinr/web      React + Vite SPA (TanStack Router + Query)
  server/              @joinr/server   Fastify API, SQLite (better-sqlite3 + Drizzle), serves the SPA in production
    migrations/        generated SQL migrations (applied at start-up)
packages/
  ui/                  @joinr/ui       design tokens, CSS, components, brand, ECharts wrappers
  engine/              @joinr/engine   pure calculation functions (from Stage 2)
  schema/              @joinr/schema   database tables, Zod schemas, API types, registries, test helpers
  importer/            @joinr/importer workbook importer and reconciliation report (CLI and upload)
tools/
  privacy-guard/       @joinr/privacy-guard  the pre-commit privacy check
.githooks/pre-commit   runs the guard on staged content
e2e/                   Playwright specs
docs/                  decisions, handoff, process, stage plans, style guide, architecture
Dockerfile, docker-compose.yml
```

Git-ignored and local only: `reference/` (except `reference/brand/`), `docs/private/`, `data/`, `artifacts/` (scratch output), databases and spreadsheets.

More detail is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## API

Every route is under `/api`, answers JSON and sends `cache-control: no-store`. Errors always have the same shape, `{ "error": { "code": "NOT_FOUND", "message": "…" } }`. A `500` never carries internal detail; the detail goes to the server log.

| Route | What it does |
|---|---|
| `GET /api/health` | Liveness and a database check (`503` with `"status": "degraded"` if the check fails). |
| `GET /api/status` | Header freshness: price mode and last refresh, snapshot count and latest period, last import run. |
| `GET /api/records` | The read-only record browser: every entity with its row count. |
| `GET /api/records/:entity` | One entity's columns and rows (money in integer cents, quantities and prices as decimal strings; at most 5,000 rows). |
| `POST /api/import` | Uploads a workbook (raw bytes, see below). |
| `GET /api/import/runs` | The newest 50 import runs, plus `hasImportedData`, `hasAppData` and `inProgress`. |
| `GET /api/import/runs/:id` | One run with its reconciliation report. |
| `GET /api/prices`, `POST /api/prices/refresh` | Prices per instrument with their status; refresh now. |
| `PUT`/`DELETE /api/prices/:instrumentId/manual`, `PUT /api/prices/:instrumentId/source` | Manual price overrides and the price source per instrument. |
| `GET /api/market/series` | FX and bullion series (AUD/USD, silver and gold per ounce). |
| `GET /api/investments/:kind` | One investment page (`stock`, `etf`, `managed_fund` or `crypto`): summary, holdings, allocation, realised gains by financial year, the next-buy timing, chart data and the fee settings. An unknown kind is `404`. |
| `GET /api/investments/:kind/trades` | The kind's trade ledger, newest first, with each trade's FIFO result. |
| `GET /api/instruments/:id` | One holding: the instrument, its row, parcels (lots), disposals, trades and dividends. |
| `POST /api/instruments`, `PUT`/`DELETE /api/instruments/:id` | Add, edit or delete a holding (see below). |
| `POST /api/trades`, `PUT`/`DELETE /api/trades/:id` | Add, edit or delete a trade (see below). |
| `GET /api/cash` | The Cash page: accounts by kind with their balance history, Total Cash, available cash and the emergency-fund test, the savings periods (raw and adjusted), the KPIs, savings goals, charts and the page's settings. |
| `POST /api/cash/accounts`, `PUT`/`DELETE /api/cash/accounts/:id` | Add, edit or delete a cash account (see below). |
| `PUT /api/cash/balances`, `DELETE /api/cash/balance-entries/:id` | Record balances at a date for one or more accounts; delete one balance from an account's history. |
| `PUT`/`DELETE /api/cash/adjustments/:periodMonth` | A one-off adjustment taken out of a recorded month's savings. |
| `PUT /api/period-notes/:kind/:periodMonth` | A spend or side-income note on a recorded month (`kind` = `spend` or `side_income`; empty text deletes it). |
| `POST /api/savings-goals`, `PUT`/`DELETE /api/savings-goals/:id`, `POST /api/savings-goals/reorder` | Savings goals, filled in list order. |
| `GET /api/side-income` | The Side Income page: streams, dated deposits, deposits bucketed into the recorded months, FY and 365-day averages, chart data. |
| `POST /api/side-income/deposits`, `PUT`/`DELETE …/deposits/:id`; `POST /api/side-income/streams`, `PUT`/`DELETE …/streams/:id` | Side-income deposits and streams. |
| `GET /api/budget` | The live Budget: income, items, the yearly fund, the emergency fund, the investment/cash split, payday transfers, breakdowns and the actual spend. |
| `POST /api/budget/items`, `PUT`/`DELETE /api/budget/items/:id`, `POST /api/budget/items/reorder` | Budget items (the automatic rows are edited through the next route). |
| `PUT /api/budget/auto/:kind` | An automatic row (`auto_yearly`, `auto_invest`, `auto_cash`): category and account, and a typed investment amount for `auto_invest`. |
| `POST /api/budget/yearly-expenses`, `PUT`/`DELETE …/yearly-expenses/:id` | Yearly expenses. |
| `GET /api/dividends` | The Dividends page: the ledger, FY and last-12-months summaries, the per-holding FY table with DRP advice, Yahoo suggestions and their status. |
| `POST /api/dividends`, `PUT`/`DELETE /api/dividends/:id` | Add, edit or delete a dividend. |
| `POST /api/dividends/suggestions/refresh` | Checks Yahoo for dividend events now (`503 MARKET_DATA_DISABLED` in mode `off`). |
| `POST /api/dividends/suggestions/dismiss`, `…/restore` | Hide or show one suggestion (`{ "instrumentId": …, "exDate": "YYYY-MM-DD" }`). |
| `PATCH /api/settings` | Changes the settings the Cash and Budget pages edit (`{ "values": { "savings.yearBasis": "calendar" } }`). |

```http
GET /api/health
```

```json
{
  "status": "ok",
  "version": "0.1.0",
  "uptimeSeconds": 42,
  "time": "2026-08-18T04:32:00.000Z",
  "db": { "ok": true, "journalMode": "wal", "migrations": 4 }
}
```

### Investments

Every figure on the investment pages comes from the pure engine (`@joinr/engine`): FIFO parcels by trade date (buys before sells on the same day), realised gains split at the 12-month anniversary, total return (unrealised + dividends) and XIRR. The server loads the rows in one read transaction, takes each holding's effective price from the price service (a manual price wins) and maps the results. A held holding without a price is flagged and left out of every total.

**Trades.** `POST /api/trades` and `PUT /api/trades/:id` take:

```json
{
  "instrumentId": 4,
  "side": "buy",
  "tradeDate": "2026-09-01",
  "quantity": { "mode": "amount", "amountCents": 50000 },
  "price": "50",
  "fee": { "kind": "flat", "cents": 0 },
  "note": "optional"
}
```

- `quantity` is `{ "mode": "units", "units": "10" }` or, in amount mode, `{ "mode": "amount", "amountCents": … }`. Amount mode buys or sells `amount ÷ price` units, rounded down to 4 decimal places (stocks and ETFs), 6 (managed funds) or 8 (crypto); the fee is on top. An amount below one unit step is `400`.
- `fee` is a flat `{ "kind": "flat", "cents": … }` or, for crypto only, a rate `{ "kind": "rate", "rate": "0.005" }` (a ratio of the order value).
- Units and prices are decimal strings (up to 18 decimal places and 15 significant digits). The date may be up to tomorrow.
- In units mode the order value (units × price) is limited to the amount-mode ceiling of $100,000,000,000 (`ORDER_VALUE_CENTS_MAX`); beyond it the answer is `400 quantity.units: the order value is too large`.
- A change that would sell more units than are held at that date (more than before the change) is refused with `422 TRADE_OVERSELL`, and nothing is written. Deleting a buy that a later sell needs is refused the same way.
- The answer is the trade's recomputed ledger row: `201` for a create, `200` for an update. A delete answers `{ "id": … }`.
- The instrument of a trade cannot change. An update keeps the row's workbook reference and position (`seq`) and clears its review flags.

**Holdings.** `POST /api/instruments` creates one (`kind`, `symbol` and every editable field; `409 INSTRUMENT_EXISTS` for the same kind and symbol). `PUT /api/instruments/:id` replaces the editable fields (name, currency, watched, target, sector, location, management fee, regions, dividend frequency, DRP, default fee, note); the kind and symbol cannot change, and the per-kind rules use the stored kind (for example regions only for ETFs and managed funds, a percentage fee only for crypto). `DELETE /api/instruments/:id` is refused with `409 INSTRUMENT_IN_USE` while trades or dividends reference the holding.

**Default fees.** Each holding may have its own default trade fee; the trade form pre-fills it. Without one, stocks and ETFs use the default brokerage setting, crypto uses the crypto fee rate and managed funds use $0. The importer never writes these columns, so a re-import keeps them.

**What blocks a re-import (D34).** An upload import is refused while the database holds data entered in the app, so a re-import can never silently undo an edit:
- a trade or holding created in the app, or an imported one edited in the app (it becomes `origin = 'app'`);
- a deleted row that came from the workbook (the app records the deletion in `app_meta`).

Setting only a holding's default fee, or deleting a row that was created in the app, does not count. The command line can still replace everything: `pnpm import:workbook --yes --replace-app-data`, which also clears the deletion record. Every trade and holding change answers `409 IMPORT_IN_PROGRESS` while an upload import runs.

### Cash flow and income

Every figure on the Cash, Side Income, Budget and Dividends pages comes from the engine too; the server loads every row the pages need in one read transaction and computes each engine result once per request. The investment pages' next-buy timing reads the same live data: the live budget, the live cash balances and the months cash needs to reach its target share.

- **Cash accounts** have a kind: bank account, credit card, loan you've made or other; an offset account is never in Total Cash. Loans you've made count in Total Cash, net worth and the savings figures, but not in *available cash*, which the emergency-fund test, the savings goals, the cash savings target and the end-of-year cash goal use.
- **Balances** are a history: `PUT /api/cash/balances` takes `{ "asOf": "2026-09-20", "entries": [{ "accountId": 1, "balanceCents": 520000, "note": "optional" }] }` and writes or replaces each account's balance at that date; the account shows its latest one. An account keeps at least one balance (`409 LAST_BALANCE_ENTRY`), and an account used by budget rows cannot be deleted (`409 ACCOUNT_IN_USE`).
- **Savings periods** run between recorded months; the current month is provisional until it is recorded. An adjustment (a one-off inflow such as an asset sale) or a note can only be saved on a recorded month (`400 periodMonth: not a recorded period`).
- **Side income** is a list of dated deposits (negative for a reversal); a stream with deposits cannot be deleted (`409 STREAM_IN_USE`).
- **Dividends:** an omitted price at the ex-date is filled from the cached Yahoo close before that date; a typed price is kept as typed. Suggestions from Yahoo are only suggestions: confirming one is a normal `POST /api/dividends`.
- Every change answers `409 IMPORT_IN_PROGRESS` while an upload import runs (the suggestion check excepted).

**Dividend events job.** In mode `live` or `fake` a `dividends` job fetches dividend events (ex-date and amount per unit) and the close before each ex-date for the stocks, ETFs and managed funds with trades, once a day when `PRICE_REFRESH_MINUTES` is above 0 (it shares Yahoo's rate-limit pause with the price job). `POST /api/dividends/suggestions/refresh` runs it at any time. Crypto is never fetched.

**What else blocks a re-import (D34).** Creating or editing cash accounts, balances, deposits, streams, notes, budget rows, yearly expenses and dividends counts as app data, as does changing a setting that comes from the workbook. These never count, and a re-import keeps them: changing only an account's kind, savings adjustments, savings goals, dismissed suggestions and the year basis for the cash figures.

### Upload import

**`POST /api/import`** takes the `.xlsx` file as the raw request body with `Content-Type: application/octet-stream` (or the xlsx MIME type) and an optional `X-File-Name` header (URI-encoded; only the base name is kept). The body limit is 25 MiB (26,214,400 bytes). Query: `dryRun=true` imports inside a transaction that is rolled back (the report is still recorded); `confirmReplace=true` is required when data has been imported before. A real import is refused while the database holds data entered in the app (any row with `origin = 'app'`, or a deleted workbook row; see [Investments](#investments)); a dry run is still allowed, and only the CLI can override (see below).

| Answer | When |
|---|---|
| `201` | Imported. The body is the run with its report. |
| `200` | Dry run. |
| `400` | Empty body or a bad query. |
| `409 IMPORT_IN_PROGRESS` | Another import is running. |
| `409 IMPORT_APP_DATA_EXISTS` | Not a dry run, and data entered in the app exists. Checked before the confirm; no backup is taken and no run is recorded. Import from the command line with `--yes --replace-app-data` instead. |
| `409 IMPORT_CONFIRM_REQUIRED` | Data exists and `confirmReplace=true` was not sent. |
| `413` / `415` | The body is too large / not a workbook content type. |
| `422 INVALID_WORKBOOK` / `INVALID_CORRECTIONS` | The workbook or the corrections file could not be used. The run is recorded as failed. |

```sh
curl -X POST "http://127.0.0.1:3001/api/import?dryRun=true"   -H "Content-Type: application/octet-stream" -H "X-File-Name: workbook.xlsx"   --data-binary @path/to/workbook.xlsx
```

## Importing the workbook

The app's data comes from the spreadsheet template's `.xlsx` export. The same importer runs from the command line and from the **Import** page, and both produce the same reconciliation report.

1. Export the Google Sheet as `.xlsx` and put it in `reference/` (git-ignored). The CLI picks the single `.xlsx` there, or takes a path.
2. Preview: `pnpm import:workbook --dry-run`. Nothing is written except the run record.
3. Import: `pnpm import:workbook --yes`. `--yes` confirms replacing data imported before. A backup is taken first (`<DATA_DIR>/backups/pre-import-YYYYMMDD-HHmmss.db`; the newest 10 are kept).
   If the database holds data entered in the app (any row with `origin = 'app'`, or a workbook row deleted in the app), a real import stops with exit 3 until you add `--replace-app-data` as well: `pnpm import:workbook --yes --replace-app-data`. The upload on the **Import** page refuses this case (`409 IMPORT_APP_DATA_EXISTS`); a dry run works either way.
4. Open **Import** in the app for the full report. The target is **zero unexplained** checks. Suspect rows are imported as they are and flagged for review.

CLI exit codes: `0` succeeded with nothing unexplained, `4` succeeded with unexplained checks, `1` failed, `2` usage, configuration or corrections error, `3` confirmation required (`--yes`, or `--yes --replace-app-data` over data entered in the app). The CLI is safe to run while the server runs; the server sees the new data on its next request.

An import **replaces** the imported investments, cash, budget, income, assets and history. Instruments are matched by kind and symbol, so price-source edits and manual prices entered in the app are kept. Re-importing the same file gives identical data.

**Corrections.** Known data fixes to the sheet (for example a mistyped trade date) live in a corrections file, never in the repo: `reference/import-corrections.json` on the development PC, `<DATA_DIR>/import-corrections.json` on the server. `IMPORT_CORRECTIONS_FILE` picks another file or `none`; the CLI takes `--corrections <file>` or `--no-corrections`. Each applied correction is listed in the report.

**Prices.** After an import the price service refreshes the instruments in the background (mode `live` or `fake`). Listed securities and FX use the Yahoo chart API, crypto uses CoinGecko, and anything else takes a manual price. A price that cannot be fetched keeps its last good value and shows as stale or failed.

## Testing

- **Unit and component tests** use Vitest. Each app, package and tool is a Vitest project, and `pnpm test` runs them all. Server tests use Fastify's `inject` against a temporary `DATA_DIR`.
- **End-to-end tests** use Playwright, at desktop and phone widths, against the installed Chrome. Screenshots go to `artifacts/screenshots/`.
- **Golden tests** compare the importer (Stage 1), the engine and the investments API (Stage 2 on: import → database → API) with values read at runtime from the owner's local workbook, and they skip when the workbook is absent. Personal values never enter the repo.
- **Synthetic workbook.** `buildSyntheticWorkbook()` (`@joinr/importer/testing`) builds a generic workbook in the template's layout, so the importer, the upload route and the e2e specs are tested without the private file. Synthetic imports always run with corrections off.
- **No network in unit tests.** A setup file makes `fetch` fail; price providers are tested with mocked responses.

## Privacy

The repo is public, so private material stays out of git in two ways.

1. **Git-ignored folders.** `reference/` (except `reference/brand/`), `docs/private/`, `data/`, databases, spreadsheets and `.env` files.
2. **The privacy guard** (`tools/privacy-guard`). `pnpm install` sets `core.hooksPath` to `.githooks`, so the guard runs before every commit.

The guard checks three things.

- **Paths.** It blocks `reference/**` (except `reference/brand/**`), `docs/private/**`, any `data/` folder, `**/fixtures/private/**`, spreadsheets (`*.xls*`), databases and their copies (`*.db`, `*.db-*`, `*.db.*`, `*.sqlite*`, `*.bak`) and `.env` files (a `.env.example`, `.env.sample` or `.env.template` is allowed, and its content is scanned). This holds even for files added with `git add -f`.
- **File types, by their bytes.** A SQLite database, an Excel or OpenDocument workbook or an Office binary document is blocked whatever it is called (`finance.old`, `export.txt`).
- **Content** of every text file, whatever its extension, including UTF-16 text with a byte-order mark. Images and fonts (recognised by their bytes, not their names), other binary files and the lockfile are skipped. Text over 16 MB is not skipped: it is reported as `too-large` and blocks the commit.

  | Rule | Catches | Allowed |
  |---|---|---|
  | `ipv4` | IPv4 addresses | loopback, `0.0.0.0`, broadcast/netmask, the RFC 5737 documentation ranges |
  | `email` | email addresses | `example.com/.org/.net`, `.example`, GitHub no-reply addresses, commit trailers |
  | `google-drive` | Google Drive / Docs URLs and Drive-style ids | none |
  | `au-phone` | Australian mobile and landline numbers | `0400 000 000` |
  | `abn` | spaced ABNs (`dd ddd ddd ddd`) | `00 000 000 000` |
  | `private-term` | each line of the git-ignored `docs/private/guard-terms.txt` (exact, case-sensitive, whole words) | none |

Each finding prints `file:line:col  rule  masked-value`. The value is masked to its first two characters, and a private term prints only its line number in the terms file, never the term. The exit code is `0` when clean, `1` for findings and `2` for an internal error. The hook blocks the commit on anything but `0`.

**When the guard blocks a commit:**
- remove the value, or replace it with a generic one; or
- unstage the file and move it to a git-ignored folder. The unstage command is `git restore --staged <file>`, or `git rm --cached <file>` before the repo's first commit. The guard prints the right one.

**Never** bypass the hook with `--no-verify`. Before a push, run `pnpm guard:all` to check the whole tree.

The terms file is optional. Without it, the `private-term` rule is off, and every other rule still runs.

## Deployment

The app ships as one Docker container that serves the API and the web app on port `3001`, with the database in a `/data` volume.

- **`Dockerfile`**, a multi-stage build on `node:24-bookworm-slim`:
  - pnpm comes from corepack, and the install uses the frozen lockfile.
  - The final image has production dependencies only.
  - It runs as the non-root `node` user (uid 1000), with `VOLUME /data`.
  - The healthcheck calls `/api/health` with Node's `fetch`.
- **`docker-compose.yml`** runs one service. Set `JOINR_PORT` (default `3001`), `JOINR_DATA_PATH` (default `./data`) and `TZ`. The data folder must be writable by uid 1000.
  - The port is published on **loopback only** (`127.0.0.1`). The app has no login of its own, so it must never be reachable directly on the LAN or the tailnet. On the NAS, the Umbrel app proxy (with the Umbrel login in front) is the only way in, and the Stage 7 packaging publishes no port at all.

Don't run `pnpm deploy` in a development checkout; it belongs inside the image build only. It rewrites pnpm's workspace state for a production-only install, and the next `pnpm <script>` then tries to prune the dev dependencies.

The development PC has no Docker. The image is built on the home server from a copy of the build context in **Stage 7**. Stage 7 also adds:
- the Umbrel app packaging (with the Umbrel login in front);
- backups and restore;
- the go-live runbook.

## Documentation

- [`PLAN.md`](PLAN.md): scope, architecture, stages and status.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): how the pieces fit together.
- [`docs/DECISIONS.md`](docs/DECISIONS.md): the decision log.
- [`docs/STAGE_PROCESS.md`](docs/STAGE_PROCESS.md): how each stage runs.
- [`docs/style/STYLE_GUIDE.md`](docs/style/STYLE_GUIDE.md): the visual rules.
- [`docs/stages/`](docs/stages/): the detailed plan for each stage.
