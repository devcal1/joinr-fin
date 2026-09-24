# Joinr Finance

A self-hosted personal-finance web app. It tracks net worth, investments (shares, ETFs, managed funds and crypto), cash flow, super, property and a FIRE plan. It rebuilds a personal-wealth spreadsheet template as a web app that runs on a home server and opens in a browser on any PC or phone. It is styled to the Joinr brand in dark mode.

**Status:** Stage 0, foundations and design system. See [`PLAN.md`](PLAN.md) for the stages, and [`docs/HANDOFF.md`](docs/HANDOFF.md) for where work stopped.

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
| `pnpm --filter @joinr/server db:generate --name <name>` | Generates a SQL migration from the schema. |

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
  schema/              @joinr/schema   database tables and types (from Stage 1)
  importer/            @joinr/importer one-off workbook importer (from Stage 1)
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

Stage 0 has one endpoint:

```http
GET /api/health
```

```json
{
  "status": "ok",
  "version": "0.1.0",
  "uptimeSeconds": 42,
  "time": "2026-08-18T04:32:00.000Z",
  "db": { "ok": true, "journalMode": "wal", "migrations": 1 }
}
```

It answers `503` with `"status": "degraded"` if the database check fails. Errors always have the same shape, `{ "error": { "code": "NOT_FOUND", "message": "…" } }`. A `500` never carries internal detail; the detail goes to the server log.

## Testing

- **Unit and component tests** use Vitest. Each app, package and tool is a Vitest project, and `pnpm test` runs them all. Server tests use Fastify's `inject` against a temporary `DATA_DIR`.
- **End-to-end tests** use Playwright, at desktop and phone widths, against the installed Chrome. Screenshots go to `artifacts/screenshots/`.
- **Golden tests** start in Stage 2. They compare the engine with values read at runtime from the owner's local workbook, and they skip when the workbook is absent. Personal values never enter the repo.

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
