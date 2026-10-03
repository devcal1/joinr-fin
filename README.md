# Joinr Finance

A self-hosted personal-finance web app. It tracks net worth, investments (shares, ETFs, managed funds and crypto), cash flow, super, property and a FIRE plan. It rebuilds a personal-wealth spreadsheet template as a web app that runs on a home server and opens in a browser on any PC or phone. It is styled to the Joinr brand in dark mode. A read-only Android app with home-screen widgets shows today's change in the holdings, and the change over a period from one week to all time (see [The phone app](#the-phone-app)).

**Status:** Stages 0–8 are done (foundations, data and importer, investments, cash flow and income, other assets, super and property, history and the net worth dashboard, the FIRE planner, backups and the deployment to an Umbrel home server, the weekly copy to a NAS, the Android phone app); Stage 10 (the phone app's period selector, on a daily price history kept by the server) is being built. See [`PLAN.md`](PLAN.md) for the stages, and [`docs/HANDOFF.md`](docs/HANDOFF.md) for where work stopped.

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
| `pnpm test` | Runs all Vitest projects: `web`, `server`, `ui`, `engine`, `schema`, `importer`, `privacy-guard`, `deploy`. |
| `pnpm e2e` | Runs the Playwright specs at 1440 px (desktop) and 375 px (phone). The config starts `pnpm dev` itself. |
| `pnpm lint` | Runs ESLint over the whole repo with zero warnings allowed. |
| `pnpm typecheck` | Runs `tsc` for the root and every package. |
| `pnpm format` / `pnpm format:check` | Writes or checks Prettier formatting. |
| `pnpm check` | Runs typecheck, lint and test. |
| `pnpm guard` | Runs the privacy guard on staged files. The pre-commit hook runs the same check. |
| `pnpm guard:all` | Runs the privacy guard on every tracked file and every untracked file that is not ignored. |
| `pnpm import:workbook [file.xlsx] [--dry-run] [--yes] [--replace-app-data] [--corrections <file> | --no-corrections] [--json]` | Imports the workbook export into `DATA_DIR` (see [Importing the workbook](#importing-the-workbook)). |
| `pnpm restore:backup <backup> [--yes] [--force] [--json]` | Restores a backup into `DATA_DIR` with the server stopped (see [Backups and restore](#backups-and-restore)). |
| `pnpm seed:dev` | Replaces the data in `DATA_DIR` with a small generic data set, for UI work without a workbook. If `DATA_DIR` already holds data it asks for `--yes` (exit 3), and with `--yes` it backs the database up first. |
| `pnpm db:generate --name <name>` | Generates a SQL migration from the schema in `packages/schema` (same as `pnpm --filter @joinr/server db:generate`). Migrations are append-only. |
| `pnpm umbrel:release` | Builds a release on the Umbrel and writes it into the app store clone (see [Deployment](#deployment)). |
| `pnpm umbrel:status` | Read-only: the app, the registry, and whether it is safe to click Update in Umbrel. |
| `pnpm umbrel:restore <backup> | --from-file <file>` | Restores a backup on the Umbrel with the app stopped. |
| `pnpm umbrel:registry ensure | status` | Checks (or, in the fallback mode, starts) the loopback image registry on the Umbrel. |
| `pnpm umbrel:smoke start --image <ref> | check | nas | mobile | remove` | A scratch run of an image on the Umbrel, on a loopback port, with checks (`start` refuses without `--image`); `nas` proves the NAS copy against a scratch rsync server on a private Docker network; `mobile` proves the phone API (pairing, the key, `today` and `periods`, read-only, the traversal corpus, revoke, and the start-up `closes` run's daily history) with the code and key kept in shell variables on the Umbrel. |
| `pnpm android:test` / `android:debug` / `android:lint` / `android:release` / `android:stop` | The Android app's Gradle build (`tools/deploy/android.mjs`): the JVM tests, a debug APK, Android lint, a signed release APK in `dist/android/` (needs `JOINR_ANDROID_SIGNING`, see [The phone app](#the-phone-app)), and stopping the Gradle daemons. |
| `pnpm android:fixtures` | Re-exports the shared JSON fixtures the Android tests read (`apps/android/app/src/test/resources/fixtures/`). |
| `pnpm umbrel:nas-secrets [--check | --remove [--yes] | --prompt-test] [--dry-run]` | Places (or checks, or removes) the two NAS copy files on the Umbrel over SSH. Run it yourself in PowerShell or Windows Terminal: it asks for the password in a hidden prompt (see [Copy to the NAS](#copy-to-the-nas)). |

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
| `AUTO_RECORD` | server | unset | `true`/`false` (also `1`/`0`, `yes`/`no`). Records each month automatically on its last day at 23:00 server time, and catches up missed months at start-up. Unset: the **Record each month automatically** setting decides (off by default); set, it overrides the setting and locks it. Leave it unset while you still re-import the workbook: a recorded month blocks a re-import. Ignored under `NODE_ENV=test`. |
| `NIGHTLY_BACKUPS` | server | on (`false` under `NODE_ENV=test`) | `true`/`false` (also `1`/`0`, `yes`/`no`). The nightly backup at 02:30 server time, with a catch-up at start-up. Off: no timer and no catch-up; **Back up now** and the backups before an import, a restore and an update still work. Playwright sets `false`. |
| `WEEKLY_NAS_COPY` | server | on (`false` under `NODE_ENV=test`) | `true`/`false` (also `1`/`0`, `yes`/`no`). The weekly copy to the NAS, Sunday 03:00 server time, with a catch-up at start-up. Off: no timer and no catch-up; **Copy to NAS now** still works. The copy does nothing either way until its files exist ([Copy to the NAS](#copy-to-the-nas)). Playwright sets `false`. |
| `INTRADAY_REFRESH` | server | on (`false` under `NODE_ENV=test`) | `true`/`false` (also `1`/`0`, `yes`/`no`). The `intraday` job: ASX holdings every 5 minutes on weekdays 10:00–16:25, crypto every 15 minutes, bullion every 15 minutes from Monday 06:00 to Saturday 10:00 (server time). Off: no timer and no start-up run; the hourly price refresh still runs. Playwright sets `false`. |
| `CLOSES_REFRESH` | server | on (`false` under `NODE_ENV=test`) | `true`/`false` (also `1`/`0`, `yes`/`no`). The `closes` job: the daily price history of every held listed instrument, fund and coin and the FX and bullion series they need (Yahoo and CoinGecko), daily at 16:52 server time and once about 2 minutes after each start. Off: no timer and no start-up run (the job stays registered); the stored history stays and the phone's periods keep working from it, while their start closes age out. Playwright sets `false`. |
| `PUBLIC_PORT` | server | unset | The port browsers use to reach the app when it sits behind a proxy (the Umbrel store compose sets `4932`). The cross-site write guard accepts a browser `Origin` on this port whose host is the one the browser used (`X-Forwarded-Host`, or `Host` when not rewritten). |
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
  android/             the phone app (Kotlin, Compose, Glance widgets; Gradle, not a pnpm package)
packages/
  ui/                  @joinr/ui       design tokens, CSS, components, brand, ECharts wrappers
  engine/              @joinr/engine   pure calculation functions (from Stage 2)
  schema/              @joinr/schema   database tables, Zod schemas, API types, registries, test helpers
  importer/            @joinr/importer workbook importer and reconciliation report (CLI and upload)
tools/
  privacy-guard/       @joinr/privacy-guard  the pre-commit privacy check
  deploy/              the Umbrel release, restore, status and smoke scripts, and the Android build script (plain Node, run from the dev PC)
.githooks/pre-commit   runs the guard on staged content
e2e/                   Playwright specs
docs/                  decisions, handoff, process, stage plans, style guide, architecture, deploy/RUNBOOK.md
Dockerfile, docker-compose.yml
```

Git-ignored and local only: `reference/` (except `reference/brand/`), `docs/private/`, `data/`, `artifacts/` (scratch output), databases and spreadsheets.

More detail is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## API

Every route is under `/api`, answers JSON and sends `cache-control: no-store`. Errors always have the same shape, `{ "error": { "code": "NOT_FOUND", "message": "…" } }`. A `500` never carries internal detail; the detail goes to the server log.

| Route | What it does |
|---|---|
| `GET /api/health` | Liveness and a database check (`503` with `"status": "degraded"` if the check fails). |
| `GET /api/status` | Header freshness: price mode and last refresh, snapshot count and latest period, last import run, `backups` (`stale`, `lastBackupAt`) for the stale-backup callout, and `nasCopy` (`configured`, `configReason`, `blocked`, `stale`, `lastSuccessAt`) for the NAS-copy callout. |
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
| `PUT /api/period-notes/:kind/:periodMonth` | A spend or side-income note on a recorded month (`kind` = `spend` or `side_income`), or a super investment-option note on any month up to this one (`super_option`). Empty text deletes it. |
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
| `GET /api/other-assets` | The Other Assets page: the items with cost, value, gain and annualised return, the price history, sales, totals, the bullion spot and FX tiles, the spot history, charts and the page's setting. |
| `POST /api/other-assets`, `PUT`/`DELETE /api/other-assets/:id`, `POST /api/other-assets/reorder` | Add, edit, delete or reorder items. |
| `PUT /api/other-assets/prices`, `DELETE /api/other-assets/price-entries/:id` | Record hand prices at a date for one or more items; delete one price from an item's history. |
| `POST /api/other-assets/:id/sales`, `PUT`/`DELETE /api/other-assets/sales/:id` | Record, edit or delete a sale (date, units, proceeds). |
| `GET /api/super` | The Super page: funds and their balance history, contributions, employer SG by month, the periods with their derived gains, the annualised return, the concessional cap per financial year, the ATO figures in use, charts and the page's settings. |
| `POST /api/super/funds`, `PUT`/`DELETE /api/super/funds/:id` | Add, edit (incl. the fund that receives SG, archiving) or delete a fund. |
| `PUT /api/super/balances`, `DELETE /api/super/balance-entries/:id` | Record fund balances at a date; delete one balance from a fund's history. |
| `POST /api/super/contributions`, `PUT`/`DELETE /api/super/contributions/:id` | Add, edit or delete a salary-sacrifice or after-tax contribution. |
| `PUT`/`DELETE /api/super/sg/:periodMonth` | Enter or remove a statement's employer SG for the month it was earned. |
| `GET /api/property` | The Property page: properties and valuations, mortgages with their balance log, repayments, interest and payoff schedule, offset accounts, totals, charts and the page's settings. |
| `POST /api/property/properties`, `PUT`/`DELETE /api/property/properties/:id`; `PUT /api/property/valuations`, `DELETE /api/property/valuation-entries/:id` | Properties and their valuations. |
| `POST /api/property/loans`, `PUT`/`DELETE /api/property/loans/:id`; `PUT /api/property/loan-balances`, `PUT`/`DELETE /api/property/loan-balance-entries/:id` | Loans and their balance log (with optional actual repayments per entry). |
| `PUT /api/property/loans/:id/offsets` | Link offset accounts to a loan (`{ "accountIds": [5] }`; the list replaces the loan's links). |
| `GET /api/net-worth` | The Net Worth dashboard: today's net worth and its breakdown, assets and liabilities, the changes since the last recorded month and this financial year, the distribution, the savings-rate gauge, the liquid allocation, the rolling net-worth table with a 12-month projection, the charts (grouped by month, quarter or year) with their trend lines, the recorder's status. `?unit=monthly|quarterly|yearly&count=1…240` changes the chart grouping for this answer only. |
| `GET /api/history` | The History page: every recorded month (newest first) with its figures, net worth, savings rate and consistency check, the live month, which months can be recorded, the consistency summary, the audit trail (newest 200) and the chart. |
| `GET /api/history/series` | The recorded months aggregated by month, quarter or year (`?unit=&count=`), with each column's rule (end of group, sum, or a ratio recomputed). |
| `POST /api/history/record` | Records months (`{ "periodMonths": ["2026-09"], "note": null }`, see below). |
| `PUT /api/history/snapshots/:periodMonth` | Corrects a recorded month's figures (`{ "values": { "cashValueCents": 2700000 }, "note": "why" }`). |
| `DELETE /api/history/snapshots/:periodMonth` | Deletes the latest month recorded in the app. |
| `GET /api/settings` | The Settings page: every setting with its group, value, where it came from, whether saving it blocks a re-import, the pages that use it, a suggested marginal tax rate for the gross salary, the allocation targets' sum and the recorder's status. |
| `PATCH /api/settings` | Changes settings (`{ "values": { "savings.yearBasis": "calendar" } }`; every setting but the server-written cap year); the answer holds the settings of every page the change named, plus the named settings themselves. |
| `GET /api/fire` | The FIRE planner: each input with where its value comes from (a what-if, your setting, the figure derived from your records, the default, or missing), the derived figures (pre-super net worth and the debts in it, the yearly spend and savings from the recorded months, the super contribution a year, the growth weights), the projection (status, FIRE year, KPIs, milestones and the year-by-year path in today's dollars) and, during a what-if, the saved plan's summary. `?spend=&withdrawalRate=&inflationRate=&marketReturn=&accessAge=&extraSavings=` is a what-if for this answer only; nothing is saved. |
| `POST /api/fire/use-workbook-contribution` | Makes the workbook's super contribution a year your setting (same value, now yours); no body. Answers like `PATCH /api/settings`. |
| `GET /api/backups` | Every backup file, newest first (name, kind, time with the server's offset, size, why retention keeps it), the total size and the free space, the schedule and its next run, the last run, `stale`, the retention numbers, the app block (version, database level, the backup a restore came from), and `nasCopy`: the copy to the NAS (`off`, `partial`, `invalid` or `ready`, and why; whether it is locked after a refusal; the schedule and next run; the last run and last success; `stale`). Nothing in it carries the address, the account, the module or the password. |
| `POST /api/backups` | **Back up now**: no body (or `{}`). `201` with the new file, or the run already in flight (`joined: true`). `409 IMPORT_IN_PROGRESS` during an upload import; `500 BACKUP_FAILED` with a reason (no space, the copy failed its check, the copy could not be written). |
| `POST /api/backups/nas-copy` | **Copy to NAS now**: no body (or `{}`). `202` at once with `{ joined, nasCopy }` (the copy runs in the background; the page follows `nasCopy.lastRun.id`). `409 NAS_COPY_NOT_READY` while the NAS files are absent, half placed or unusable; `409 NAS_COPY_FIX_FIRST` after the NAS refused the password or module, until the files are placed again. Neither 409 writes a run. |
| `GET /api/phone` | Settings → Phone: the paired phones (newest first, with their last use and app version), the removed ones (newest 20), the open pairing code, the last pairing and the last cancelled code (both within 10 minutes), and any problem saving the list. No key or key hash is ever in it. |
| `POST`/`DELETE /api/phone/pairing` | Opens a pairing code (valid 5 minutes; any open code is replaced; `409 PHONE_LIMIT_REACHED` at 10 phones) or cancels it. |
| `POST /api/phone/devices/:id/revoke` | Removes a phone: its key stops working at once (idempotent; `404` for an unknown id). |
| `GET /api/mobile/today`, `GET /api/mobile/device` | **The phone app's API** (see [The phone app](#the-phone-app)): today's holdings with their day change, totals and the portfolio line; the paired device. A paired key is required (`Authorization: Bearer` or `X-Joinr-Key`): `401 DEVICE_KEY_MISSING`, `DEVICE_KEY_INVALID` or `DEVICE_KEY_REVOKED`, `429 MOBILE_RATE_LIMITED` after too many unknown keys. |
| `GET /api/mobile/periods` | **The phone app's periods** (from 1.3.0): the change over 1W, 2W, 1M, 3M, 6M, 12M and ALL in one answer (`apiVersion` 1): each held holding's figure per period (with its status, start close and line), the totals, a portfolio line per period, the "Sold holdings" figure under ALL, and `closesThrough` (the oldest of the series' newest stored closes). The same key and errors as `/today`; `/today` is unchanged. |
| `POST /api/mobile/pair` | The pairing exchange: `{ "code", "deviceName"?, "appVersion"? }` → `201` with the device's key, shown once. `401 PAIRING_CODE_INVALID`, `429 PAIRING_RATE_LIMITED`, `409 PHONE_LIMIT_REACHED`, `503 PHONE_STORE_FAILED`. Every other method under `/api/mobile/` answers `405 MOBILE_READ_ONLY`. |
| `GET /api/backups/:name` | Downloads one backup (`application/vnd.sqlite3`, saved as `joinr-finance-<name>`). The name must match the backup name rule (`400` otherwise; never a path) and be a regular file in the backups folder (`404`). |

**Writes from another site are refused.** A `POST`, `PUT`, `PATCH` or `DELETE` under `/api` answers `403 CROSS_SITE_REQUEST` when the browser marks it as cross-site (`Sec-Fetch-Site` other than `same-origin` or `none`), or, over plain HTTP where browsers send no `Sec-Fetch-*` header, when its `Origin` names another host or another port (the request's `Host`, `X-Forwarded-Host`, or `PUBLIC_PORT` are accepted; a loopback origin also outside production, for the Vite proxy). Requests with neither header (curl, the CLIs) pass.

```http
GET /api/health
```

```json
{
  "status": "ok",
  "version": "1.0.0",
  "uptimeSeconds": 42,
  "time": "2026-08-18T04:32:00.000Z",
  "db": { "ok": true, "journalMode": "wal", "migrations": 7 }
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

### Other assets, super and property

Every figure on these pages comes from the engine too, in the same request context as the Cash page, so the provisional savings period and the other-assets value on the investment pages follow the live figures.

- **Other assets** are hand-priced with a dated price history (a price older than 90 days, a setting, shows as stale), or priced from the silver or gold spot × ounces per unit. A foreign-currency item's cost uses the exchange rate on its purchase date: typed, taken from the workbook, or fetched once from Yahoo by the price job. An item with no purchase date counts from the first recorded month, marked assumed. A sale records its date, units and proceeds, and a sale of more units than are left is refused (`422 SALE_OVERSELL`). Bullion is priced from spot, so a price save that names a bullion item is `400`.
- **Super** keeps a balance history per fund. The gain of a period is derived: the change in balance less employer SG, your contributions (after contributions tax) and money moved in from outside the tracked funds. A fund created in the app has its opening balance counted as money moved in, unless it is a rollover from a fund on the page. A fund can be archived only after a closing balance of $0, and cannot be deleted while contributions name it (`409 FUND_IN_USE`). Employer SG is estimated from the salary setting at the ATO rate of each financial year (or your employer's rate), and a statement month replaces the estimate. The concessional cap meter counts SG in the financial year the fund receives it; a cap override applies to the financial year it was set in only.
- **Property and loans.** A property keeps a valuation history. A loan keeps a balance history; each entry's repayments default to the regular repayment × the payments due on the loan's payment dates, and can be replaced by the actual figure. Interest and fees are the repayments less the principal repaid. The payoff date and interest to come come from an amortisation schedule, with and without the linked offset accounts. A property with a loan cannot be deleted (`409 PROPERTY_HAS_LOAN`). Only accounts flagged Offset on the Cash page can be linked, and turning the flag off removes the link.
- A fund, property or loan keeps at least one balance or valuation (`409 LAST_BALANCE_ENTRY`). Every change answers `409 IMPORT_IN_PROGRESS` while an upload import runs.

**What blocks a re-import here (D34).** Creating or editing items, prices, sales, funds, balances, contributions, option notes, properties, valuations, loans, loan balances and offset links counts as app data, as does changing the salary, marginal tax rate or job start date. These never count, and a re-import keeps them: choosing the fund that receives employer SG (the flag alone), SG statement months, and the settings that exist only in the app (the stale-price days, your employer's SG rate, the contributions tax, the cap override and how imported contributions are read).

### History, net worth and settings

Every figure on the Net Worth and History pages comes from the engine, in the same request context as every other page: the live month is composed from today's results of the investment, cash, super, property and other-asset engines.

- **Recording a month** freezes its figures. `POST /api/history/record` takes the months to record (only the months after the latest recorded month, up to this month; `400` otherwise) and refreshes prices first (unless the market is off). Every month recorded in one request gets today's date; the current month is stored as recorded, an earlier month as recorded late. A month is never recorded twice (`409 SNAPSHOT_EXISTS`), and one record runs at a time (`409 RECORD_IN_PROGRESS` after a 30-second wait).
- **Correcting a month** changes the named figures only, with a required reason; the gain %, cash change and equity that depend on a changed figure (and the next month's cash change) are recalculated, the others keep their stored values (the first month's typed cash change is kept, moved by a corrected cash balance), the correction count goes up and every before and after is kept in the audit trail. A month's date and identity never change (the database refuses it).
- **Deleting** is for the latest month recorded in the app only (`409 SNAPSHOT_NOT_LATEST`); imported months can be corrected but not deleted (`409 SNAPSHOT_NOT_DELETABLE`). A deleted month can be recorded again, and the audit trail keeps a copy.
- **Automatic recording** (off by default; the setting or `AUTO_RECORD`) records each month on its last day at 23:00 server time and catches up missed months later, marked recorded late. It waits instead of leaving a gap when an earlier month is missing.
- Every change answers `409 IMPORT_IN_PROGRESS` while an upload import runs.

**What blocks a re-import (D34).** A recorded month is app data, and so is a correction of an imported month: a re-import is then refused until the recorded months are deleted (latest first) or the CLI replaces them (`--yes --replace-app-data`, which keeps the audit trail). The audit trail, the auto-record switch and the display choices (the chart grouping and the page switches) never count, and a re-import keeps the display choices.

### FIRE

Every FIRE figure comes from the engine, in the same request context as the other pages. The page's inputs are the settings in the Settings page's FIRE group; the yearly spend and the super contribution are derived from your records unless you set a figure.

- **Spend and savings** average the recorded months of the last 12 (the months the Cash page averages), times 12. A month with negative spend (a sale or a deposit counted as saving) counts as $0 of spend, and its savings are capped at its income. Voluntary super contributions count in super, not in pre-super savings.
- **Super contribution a year** is the employer SG and your contributions, as the fund receives them, over the 12 whole months before this month. A figure set in the app overrides it. A figure imported from the workbook is shown beside it as the workbook's figure; `POST /api/fire/use-workbook-contribution` adopts it (a settings `PATCH` of the same value would not change where it came from).
- **What-if** (`GET /api/fire?…`) recomputes with the given values and saves nothing; "Save as my settings" on the page is a `PATCH /api/settings` of the FIRE keys. Every FIRE setting is a display preference: saving one never blocks a re-import, and a re-import keeps it.
- **The access age** defaults to 60. Once per database, an access age of 65 imported from the workbook is replaced by 60 (saved as your setting, with a note on the FIRE and Settings pages). This runs when the server starts and after every committed import (never a dry run); a marker in `app_meta` stops it from running again, and the log has one line. Set 65 in the app and it stays.

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
3. Import: `pnpm import:workbook --yes`. `--yes` confirms replacing data imported before. A verified backup is taken first (`<DATA_DIR>/backups/pre-import-YYYYMMDD-HHmmss+HHMM.db`, named in server time with its UTC offset; the newest 10 are kept). A copy that fails its check stops the import.
   If the database holds data entered in the app (any row with `origin = 'app'`, or a workbook row deleted in the app), a real import stops with exit 3 until you add `--replace-app-data` as well: `pnpm import:workbook --yes --replace-app-data`. The upload on the **Import** page refuses this case (`409 IMPORT_APP_DATA_EXISTS`); a dry run works either way.
4. Open **Import** in the app for the full report. The target is **zero unexplained** checks. Suspect rows are imported as they are and flagged for review.

CLI exit codes: `0` succeeded with nothing unexplained, `4` succeeded with unexplained checks, `1` failed, `2` usage, configuration or corrections error, `3` confirmation required (`--yes`, or `--yes --replace-app-data` over data entered in the app), `6` the app looks running. **Stop the server before a CLI import:** the CLI refuses while the server's running marker is set (exit 6; `--force` overrides the marker after a crash). An upload on the **Import** page needs no stop (it runs inside the server).

An import **replaces** the imported investments, cash, budget, income, assets and history. Instruments are matched by kind and symbol, so price-source edits and manual prices entered in the app are kept. The fund chosen to receive employer SG is carried over by fund name, and SG statement months are kept. Re-importing the same file gives identical data.

**Corrections.** Known data fixes to the sheet (for example a mistyped trade date) live in a corrections file, never in the repo: `reference/import-corrections.json` on the development PC, `<DATA_DIR>/import-corrections.json` on the server. `IMPORT_CORRECTIONS_FILE` picks another file or `none`; the CLI takes `--corrections <file>` or `--no-corrections`. Each applied correction is listed in the report.

**Prices.** After an import the price service refreshes the instruments in the background (mode `live` or `fake`). Listed securities and FX use the Yahoo chart API, crypto uses CoinGecko, and anything else takes a manual price. A price that cannot be fetched keeps its last good value and shows as stale or failed.

## Backups and restore

The server keeps verified copies of its database in `<DATA_DIR>/backups/`, one flat folder of self-contained SQLite files.

- **Nightly** at 02:30 server time (`NIGHTLY_BACKUPS`, on by default; the server's `TZ` decides the zone). If the server was off across 02:30, one copy is taken about two minutes after it starts. A run that fails is retried after 15 minutes, up to three times.
- **Kept:** the newest nightly copy of each of the last 14 dates it ran and of each of the last 12 calendar months, plus the newest 10 taken by hand (**Back up now**), 10 before an import, 5 before a restore and 5 before an update (a start-up that migrates the database).
- **Names** are `<kind>-YYYYMMDD-HHmmss±HHMM.db` in server time with its offset (`nightly`, `manual`, `pre-import`, `pre-restore`, `pre-migrate`). A copy is written to a hidden `.…partial` file, checked (`PRAGMA integrity_check`, the migration count), then renamed, so a listed file is always complete; anything else in the folder is never listed or deleted.
- **Settings → Backups** lists them with a download button, shows the last and next run, and warns when no backup has succeeded for 48 hours (also on every page).
- **Start-up safety:** before a new version migrates the database, the server takes a `pre-migrate` copy; an older version refuses to start on a database a newer one migrated.

**Restore** is a command-line step with the server stopped:

```sh
pnpm restore:backup nightly-20300315-023000+1100.db          # prints what it would do (exit 3)
pnpm restore:backup nightly-20300315-023000+1100.db --yes    # restores
```

In the Docker image the same CLI is `node dist/cli/restore.js <backup> [--yes] [--force] [--json]`. `<backup>` is a name in `backups/` (a downloaded `joinr-finance-…` name works too) or a path to a SQLite file. The CLI checks the file (integrity, that it is a Joinr database of the same lineage, and not from a newer version), takes a `pre-restore` copy of the current database, swaps the file in atomically and marks it, so Settings → About shows where it came from. The next start applies any pending migrations.

| Exit | Meaning |
|---|---|
| `0` | Restored. |
| `1` | Failed; nothing changed, or the message names the pre-restore copy to go back to. |
| `2` | Usage or configuration. |
| `3` | Confirmation required: add `--yes`. |
| `5` | The backup is not valid: damaged, not a Joinr database, a different database, made by a newer version, or a live database with its `-wal` beside it. |
| `6` | The app looks running. Stop it; after a crash, `--force` skips the running marker (never the lock check). `--force` also sets a damaged current database aside unverified instead of refusing. |

On the Umbrel, `pnpm umbrel:restore` wraps this (see [`docs/deploy/RUNBOOK.md`](docs/deploy/RUNBOOK.md#restore)).

## Copy to the NAS

Optional, and off until it is set up: once a week the server copies every backup it keeps to an **rsync module on a NAS** (an rsync daemon account that can reach only that folder).

- **When:** Sunday at 03:00 server time (`WEEKLY_NAS_COPY`, on by default), one catch-up copy about five minutes after a start when that Sunday's copy was missed, and **Copy to NAS now** in Settings → Backups. A copy that fails for a passing reason (the NAS did not answer, the connection broke) is retried after 1, 2 and 4 hours.
- **What:** every backup file the server keeps, in one `rsync` run that sends only what the NAS lacks (or holds at a different size). Each copy is then **proved** by listing the NAS back. It **only adds**: no flag that deletes, writes in place or keeps a partial file is ever passed (a test pins the flags), so the NAS keeps every copy it receives. A copy that fails never touches a backup on the server.
- **The files:** `<DATA_DIR>/secrets/nas-url` (`rsync://<account>@<host>/<module>[/<subfolder>]`) and `<DATA_DIR>/secrets/nas-password`, both or neither, read at every run (no restart needed). On the Umbrel they are placed with `pnpm umbrel:nas-secrets`, which asks for the password in a hidden prompt and sends it only on SSH's standard input. The page never shows or asks for either; the password reaches `rsync` only through its environment, never its arguments, a log, a run record or an API body.
- **A refused password or module** locks the copy (the button and the timer) until the files are placed again, so a wrong password costs one failed login, not one a week or one per click.
- **Settings → Backups** shows the copy's state, the last copy and its proof ("5 sent · 22 already there · proved on the NAS"), and every page shows a callout when no copy has succeeded for 8 days, or the copy is half set up, unusable or locked.

The set-up on the NAS and the Umbrel, troubleshooting and a restore from the NAS copy are in [`docs/deploy/RUNBOOK.md`](docs/deploy/RUNBOOK.md#copy-to-the-nas).

## The phone app

A read-only Android app (`apps/android`) shows today's change in the holdings: each stock, ETF, managed fund and crypto holding, and bullion as one holding per metal, in AUD including the currency move, with totals that are exact sums and a portfolio line through the day. Three home-screen widgets refresh every 30 minutes. It never changes anything on the server.

- **Pairing:** Settings → Phone → **Pair a phone** shows a QR code (the server address and a one-time code, valid 5 minutes) for the app's own Scan button, and the code as text for pairing by hand. The server keeps only a SHA-256 of each phone's key, in `<DATA_DIR>/devices/devices.json`, **outside the database**, so a restore never brings back a removed phone. Settings → Phone lists the phones with their last use and removes one.
- **The `/api/mobile` boundary:** on the Umbrel, `/api/mobile/` is the one path the app proxy lets through without the Umbrel login. Every route there checks the key, and only `GET /api/mobile/today`, `GET /api/mobile/periods`, `GET /api/mobile/device` and the pairing exchange exist; a route under `/api/mobile` that the phone plugin did not declare stops the server at start-up. Pair with the Umbrel's full Tailscale name (`*.ts.net`): the key travels in plain HTTP.
- **Day prices:** Yahoo prices come from a one-day, five-minute chart (the previous close and today's bars in one call; managed funds keep the daily chart and take their day from the last two prices), CoinGecko adds a per-coin day chart, and the `intraday` job refreshes them often during the day (`INTRADAY_REFRESH`). Each instrument's latest session is cached in `day_quotes` (bullion's in `series_day_quotes`); the day-change rules are one pure engine function.
- **The period selector (from 1.3.0, app 1.1.0):** a row of chips, **1D · 1W · 2W · 1M · 3M · 6M · 12M · ALL**, under the header. 1D is today's change, as before. 1W and 2W are 7 and 14 days, 1M to 12M calendar months; each figure is the change in today's holdings since the start date's close: units held at the start count from that close, units bought within the period from their purchase price, and units sold within it count nothing. **ALL** is the lifetime gain as the web's holdings pages compute it (unrealised plus realised, sold holdings included as one "Sold holdings" row, dividends not counted). A holding with no price history for the start shows "—" and the total says it is partial. The widgets stay daily. The figures come from `GET /api/mobile/periods`; the rules are one pure engine function (`computePeriods`).
- **Daily price history:** the server keeps the daily closes of every held listed instrument, fund and coin, the FX series they need, `AUDUSD`, the gold and silver futures and the derived AUD bullion spot, in three cache tables (`instrument_closes`, `instrument_splits`, `series_closes`; migration 0007; never app data, never deleted). The **`closes` job** fills them once a day at 16:52 and once about 2 minutes after each start (one Yahoo request per series and one CoinGecko request per coin a day, spaced, off the intraday job's 15-minute grid); `CLOSES_REFRESH=false` turns it off. The runbook covers the job, its kill switch and its troubleshooting ([The daily price history](docs/deploy/RUNBOOK.md#the-daily-price-history-and-the-closes-kill-switch)).
- **Building and installing:** `pnpm android:test`, `pnpm android:debug`; a release APK is signed with the owner's own keystore, kept outside the repo (`JOINR_ANDROID_SIGNING` names its properties file), and sideloaded. The steps are in [`docs/deploy/RUNBOOK.md`](docs/deploy/RUNBOOK.md#the-android-app).

## Testing

- **Unit and component tests** use Vitest. Each app, package and tool is a Vitest project, and `pnpm test` runs them all. Server tests use Fastify's `inject` against a temporary `DATA_DIR`.
- **End-to-end tests** use Playwright, at desktop and phone widths, against the installed Chrome. Screenshots go to `artifacts/screenshots/`.
- **Golden tests** compare the importer (Stage 1), the engine and the APIs (Stage 2 on: import → database → API; the investment pages, then the cash-flow pages in Stage 3, the other assets, super and property pages in Stage 4, History and Net Worth in Stage 5, where a month is also recorded, and FIRE in Stage 6, where the template's formulas are reproduced and the imported access age is upgraded) with values read at runtime from the owner's local workbook, and they skip when the workbook is absent. Personal values never enter the repo.
- **Synthetic workbook.** `buildSyntheticWorkbook()` (`@joinr/importer/testing`) builds a generic workbook in the template's layout, so the importer, the upload route and the e2e specs are tested without the private file. Synthetic imports always run with corrections off.
- **No network in unit tests.** A setup file makes `fetch` fail; price providers are tested with mocked responses.
- **Deploy scripts** (`tools/deploy`, Vitest project `deploy`) are tested with a fake command runner: every ssh, git and docker command is asserted as an argument list and nothing reaches the Umbrel. One test spawns `node` and the privacy guard for real, to cover Windows process spawning.

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

The app runs on an [Umbrel](https://umbrel.com) home server as **Joinr Finance** in a community app store (`tenon-umbrel-store`, a separate public repository holding only the manifest, the compose file and the icon). The operator's step-by-step guide is [`docs/deploy/RUNBOOK.md`](docs/deploy/RUNBOOK.md).

- **The image** (`Dockerfile`) is a two-stage build on `node:24-bookworm-slim`, pinned by tag and digest. pnpm comes from corepack with the frozen lockfile; the runtime has production dependencies only, runs as the non-root `node` user (uid 1000) with a root-owned `/app` and a `/data` volume, and checks `/api/health` with Node's `fetch`. The runtime installs `rsync` from Debian bookworm for the copy to the NAS (the build prints its version and Debian revision, and fails if a popt alias file exists). The build fails unless both CLIs (`dist/cli/import.js`, `dist/cli/restore.js`) run and the `Australia/Melbourne` zone resolves correctly. The image sets no `TZ`; the compose file does.
- **Where it is built:** the development PC has no Docker. `pnpm umbrel:release` ships the committed tree (or, with `--allow-dirty`, the working copy: exactly the files `pnpm guard:all` scans, after the guard passes) to the Umbrel over SSH, builds it there, and pushes it to a registry on the Umbrel's loopback (`127.0.0.1:4930`, the **Joinr Registry** store app). umbrelOS pulls every image at install and update, so the image must come from a registry; nothing leaves the Umbrel. No GitHub Actions, no ghcr.
- **Versions:** `version` in the root `package.json` is the app version everywhere: the footer, Settings → About, `/api/health`, the image tag and label, and the store manifest's `version:`. Every release that changes the image bumps it; the scripts refuse to overwrite a tag or to pin a new image under an old version.
- **The store compose** puts Umbrel's app proxy (and its login) in front of every path except the phone API (`PROXY_AUTH_WHITELIST: "/api/mobile/*"`, from 1.2.0; the app checks a paired key there), publishes no port, runs the app as uid 1000 on a private Docker network that only the proxy joins, and sets `TZ=Australia/Melbourne` and `PUBLIC_PORT=4932`. `DATA_DIR` is the app's Umbrel data folder: **uninstalling the app deletes the database and every backup**, so download a backup first.
- **Scripts** (`tools/deploy`, plain Node, run from the dev PC over the `umbrel` SSH alias with key auth; every one takes `--dry-run`): `pnpm umbrel:release`, `umbrel:status` (prints "Safe to click Update in Umbrel" only when the registry holds the pinned image), `umbrel:restore`, `umbrel:registry`, `umbrel:smoke` and `umbrel:nas-secrets` (the NAS copy's files; run by the owner). Environment: `JOINR_DEPLOY_HOST` (default `umbrel`), `JOINR_STORE_DIR` (default `../tenon-umbrel-store`), `JOINR_REGISTRY_MODE` (`app`, or `container` for a plain registry container), `JOINR_REGISTRY_PORT`, `JOINR_APP_ID`, `JOINR_SSH` and `JOINR_GIT` (the binaries to use).
- **`docker-compose.yml`** in this repo is a generic local run (`docker compose up -d --build`): loopback-only port (`JOINR_PORT`, default `3001`), `JOINR_DATA_PATH` (default `./data`, writable by uid 1000) and `TZ`. Never publish the port on all interfaces: the app has no login of its own.

Don't run `pnpm deploy` in a development checkout; it belongs inside the image build only. It rewrites pnpm's workspace state for a production-only install, and the next `pnpm <script>` then tries to prune the dev dependencies.

## Documentation

- [`PLAN.md`](PLAN.md): scope, architecture, stages and status.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): how the pieces fit together.
- [`docs/DECISIONS.md`](docs/DECISIONS.md): the decision log.
- [`docs/STAGE_PROCESS.md`](docs/STAGE_PROCESS.md): how each stage runs.
- [`docs/style/STYLE_GUIDE.md`](docs/style/STYLE_GUIDE.md): the visual rules.
- [`docs/stages/`](docs/stages/): the detailed plan for each stage.
- [`docs/deploy/RUNBOOK.md`](docs/deploy/RUNBOOK.md): install, release, backups, restore and troubleshooting on the Umbrel.
