# Handoff

_Last updated: 2026-09-24, end of Stage 1._

## Where we are
**Stage 1 (Data model, importer & market data) is done.** It was demoed to the owner and committed locally. Nothing has been pushed (D10).

- The remote `origin` is `github.com/devcal1/joinr-fin` (**public**).
- The plan and outcome are in `docs/stages/stage-1.md`; see its "Scaffold notes" and "Stage close notes".
- Kickoff decisions are D22–D29 and demo decisions D30–D35 in `docs/DECISIONS.md`.
- Owner-specific import facts (expected checks, suspects, the correction) are in `docs/private/stage-1-private.md`. The owner corrections file is `reference/import-corrections.json` (git-ignored, D27).

## What exists
A pnpm workspace (Node 24, TypeScript 6). New or extended in Stage 1:

| Path | What it is |
|---|---|
| `packages/schema` | `@joinr/schema`: 22 Drizzle tables (`src/db/tables`), enums, Zod row and DTO schemas, the settings registry (SheetOptions IDs 1–44), the record-browser registry, pricing helpers, decimal/date helpers. `./testing` has `createTestDb`, `seedGenericData` and `dumpDomainTables`; `./fixtures` has typed sample DTOs for UI tests. The web imports only the root entry (no drizzle). |
| `packages/importer` | `@joinr/importer`: SheetJS reader behind a zip pre-scan (size and entry limits), one extractor per tab, corrections (D27), exclusions (D22/D23), suspect flags (D26), dividend re-keying (D28), a replace-all writer in one transaction, and the reconciliation report (match / explained / unexplained / suspect / info). `./testing` has `buildSyntheticWorkbook()` (generic data) and the local-workbook helpers for golden tests. |
| `apps/server` | Migration `0001_stage1_core`. Routes: `/api/records[/:entity]`, `POST /api/import` (raw xlsx body, dry run, confirm, 409 when app data exists), `/api/import/runs[/:id]`, `/api/status`, `/api/prices` (+ refresh, manual price, source), `/api/market/series`. The price service (`src/market`): Yahoo chart, CoinGecko and a fake provider, FX and silver/gold series, cache with status, backoff and cool-downs. A generic scheduler (`src/scheduler`) with a `job_runs` log. The CLI `src/cli/import.ts`. Pre-import backups (`VACUUM INTO`, newest 10). |
| `apps/web` | A **Records** nav group: `/records` (read-only data browser for 16 tables), `/import` (upload, preview, runs) and `/import/runs/$runId` (the report, opening on "Needs attention"), `/prices` (status badges, refresh, manual price and source forms, market series). The header freshness line reads `/api/status`. |
| `e2e/` | Adds a `setup` project that imports the synthetic workbook once, plus `records`, `import` and `prices` specs. Steps that change data run on desktop only. |

## How to run
- `pnpm dev`: web on 5173, server on 3001 (live prices, hourly refresh). In the Claude app, use `preview_start` with `joinr-dev`.
- `pnpm import:workbook [file.xlsx] [--dry-run] [--yes] [--replace-app-data] [--corrections <file> | --no-corrections] [--json]`. With no file, it uses the single `*.xlsx` in `reference/`. **Never `pnpm import`**: that is a pnpm built-in.
- `pnpm seed:dev`: generic demo data (asks for `--yes` when `DATA_DIR` holds data, and takes a backup first).
- `pnpm check`, `pnpm test`, `pnpm e2e`, `pnpm build` then `pnpm start`, `pnpm guard:all`: as before.
- **New env vars:**
  - `MARKET_DATA_MODE`: `live`, `fake` or `off`. Playwright uses `fake`.
  - `PRICE_REFRESH_MINUTES`: default 60, 0 in tests.
  - `IMPORT_CORRECTIONS_FILE`: unset means auto; `none` turns corrections off, and Playwright uses `none`.
- **The owner's `data/` database** now holds the imported workbook (run #1, 0 unexplained) and live prices.

**State at close:**
- typecheck, lint, format:check, build and `guard:all` are green (191 private terms).
- 1271 unit tests pass.
- e2e: 109 passed, 10 skipped by design.

## Known issues / carried forward
- **Yahoo is unofficial.** One ASX ETF returns a degraded summary. The provider now falls back to the daily close, but watch for new failure modes; the Prices page shows a Failed badge with the error.
- **CoinGecko ids** other than BTC/ETH are resolved by search (highest market cap). Check them on `/prices`; the Source form overrides them.
- **D34 gap (Stage 5):** an app-entered setting for a key the workbook doesn't supply keeps the import blocked even after `--replace-app-data`. Decide this with the Settings page.
- **Deferred review items:** see "Deferred" in the stage-1 close notes (Stage 4 row-30 semantics; Stage 5 settings checks; Stage 6 polish items; Stage 7 backup timing).
- Carried from Stage 0, still open:
  - The Dockerfile is unbuilt (Stage 7). It must also reach `cdn.sheetjs.com` for the SheetJS tarball; the fallback is to vendor it.
  - The web bundle is about 1 MB; route-level code splitting is planned for Stage 6.
  - Browser-pane screenshots time out while the pane is hidden; use `get_page_text` or a Playwright script.
  - Never run `pnpm deploy` in the dev checkout.
  - pnpm 11 `allowBuilds` must stay as it is.
  - TypeScript stays pinned to ~6.0.
- **Privacy:** check ids embed instrument symbols, so reports and CLI output from the owner's workbook are private. Never paste them into committed docs. The guard's term list now includes the Stage 1 owner amounts.

## Next step
**Stage 2: Investments (Stocks, ETFs, Managed Funds, Crypto).** Follow `docs/STAGE_PROCESS.md`:
1. Ask the Stage 2 questions in `docs/private/OPEN_QUESTIONS.md`: parcel matching (FIFO only?), the "Retirement" tag, $0-brokerage auto-invest buys, investment-timing features, and the auto-invest amount bug.
2. Build on Stage 1:
   - Trades carry `seq` (the FIFO tie-break) and follow the fee-authority rule in stage-1 §2.4.
   - Prices come from the `prices` table (manual wins).
   - Golden tests use `@joinr/importer/testing` (`describeWithLocalWorkbook`, `readWorkbook`). The Stage 1 report already lists the tab gain cells as `derived_later_stage` info lines, which become Stage 2 goldens.
3. Run the workflow: Planner → Scaffold → parallel implementers → reviewers → triage → Fixer → Verifier.
4. Demo: each investment page with live prices, then add and remove a test trade. Adding trades in the app creates `origin='app'` rows, which blocks re-import (D34).

## Environment facts (generic)
- **Tooling:** Windows 11 with PowerShell and Git Bash, Node v24.20.0, pnpm 11.23. **No Docker, GitHub CLI or Python.** System Chrome and Edge are installed; Playwright uses `channel: 'chrome'`.
- **PDFs:** the Claude `Read` tool can't render them here (no poppler). Use the `.txt` of the style guide.
- **Reading the xlsx:** use SheetJS (the workspace depends on the 0.20.3 tarball from cdn.sheetjs.com). `exceljs` fails on the sheet named "History". SheetJS cannot **write** a sheet named "History"; the synthetic workbook renames it through `XLSX.CFB`.
- **Network:** Yahoo's chart API needs a browser-like User-Agent. CoinGecko's public API needs no key.
- **Private backup:** `reference/` and `docs/private/` (including `guard-terms.txt` and `stage-1-private.md`) exist only on this PC. Back them up to the NAS when it is reachable (see `docs/private/ENVIRONMENT.md`).
