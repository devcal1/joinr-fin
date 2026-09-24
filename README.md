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

```http
GET /api/health
```

```json
{
  "status": "ok",
  "version": "0.1.0",
  "uptimeSeconds": 42,
  "time": "2026-08-18T04:32:00.000Z",
  "db": { "ok": true, "journalMode": "wal", "migrations": 2 }
}
```

**`POST /api/import`** takes the `.xlsx` file as the raw request body with `Content-Type: application/octet-stream` (or the xlsx MIME type) and an optional `X-File-Name` header (URI-encoded; only the base name is kept). The body limit is 25 MiB (26,214,400 bytes). Query: `dryRun=true` imports inside a transaction that is rolled back (the report is still recorded); `confirmReplace=true` is required when data has been imported before. A real import is refused while the database holds data entered in the app (any row with `origin = 'app'`); a dry run is still allowed, and only the CLI can override (see below).

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
   If the database holds data entered in the app (any row with `origin = 'app'`), a real import stops with exit 3 until you add `--replace-app-data` as well: `pnpm import:workbook --yes --replace-app-data`. The upload on the **Import** page refuses this case (`409 IMPORT_APP_DATA_EXISTS`); a dry run works either way.
4. Open **Import** in the app for the full report. The target is **zero unexplained** checks. Suspect rows are imported as they are and flagged for review.

CLI exit codes: `0` succeeded with nothing unexplained, `4` succeeded with unexplained checks, `1` failed, `2` usage, configuration or corrections error, `3` confirmation required (`--yes`, or `--yes --replace-app-data` over data entered in the app). The CLI is safe to run while the server runs; the server sees the new data on its next request.

An import **replaces** the imported investments, cash, budget, income, assets and history. Instruments are matched by kind and symbol, so price-source edits and manual prices entered in the app are kept. Re-importing the same file gives identical data.

**Corrections.** Known data fixes to the sheet (for example a mistyped trade date) live in a corrections file, never in the repo: `reference/import-corrections.json` on the development PC, `<DATA_DIR>/import-corrections.json` on the server. `IMPORT_CORRECTIONS_FILE` picks another file or `none`; the CLI takes `--corrections <file>` or `--no-corrections`. Each applied correction is listed in the report.

**Prices.** After an import the price service refreshes the instruments in the background (mode `live` or `fake`). Listed securities and FX use the Yahoo chart API, crypto uses CoinGecko, and anything else takes a manual price. A price that cannot be fetched keeps its last good value and shows as stale or failed.

## Testing

- **Unit and component tests** use Vitest. Each app, package and tool is a Vitest project, and `pnpm test` runs them all. Server tests use Fastify's `inject` against a temporary `DATA_DIR`.
- **End-to-end tests** use Playwright, at desktop and phone widths, against the installed Chrome. Screenshots go to `artifacts/screenshots/`.
- **Golden tests** compare the importer (Stage 1) and the engine (Stage 2 on) with values read at runtime from the owner's local workbook, and they skip when the workbook is absent. Personal values never enter the repo.
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
