# Handoff

_Last updated: 2026-09-25, end of Stage 2._

## Where we are
**Stage 2 (Investments: Stocks, ETFs, Managed Funds, Crypto) is done.** The owner approved the demo, and it is committed locally with the owner's OK. Nothing has been pushed (D10).

- The remote `origin` is `github.com/devcal1/joinr-fin` (**public**).
- The plan and its outcome are in `docs/stages/stage-2.md`. See its "Scaffold notes", "Stage close notes" and "Plan review log".
- Decisions:
  - Kickoff: D36–D43.
  - During the stage: D44–D47.
  - Demo: D48 (all 22 §11 template fixes accepted).
- Owner-specific golden expectations, quirks and guard terms are in `docs/private/stage-2-private.md`.

## What exists
A pnpm workspace (Node 24, TypeScript 6). New or extended in Stage 2:

| Path | What it is |
|---|---|
| `packages/engine` | `@joinr/engine`: a pure calculation engine with no I/O and no clock. `asOf` is injected; money is in cents and quantities are decimal strings. Modules: `lots` (FIFO by date then `seq`, pro-rata fees, oversell flags), `realised` (ATO anniversary split, FY summary), `investments` (per-kind holding metrics, the summary, allocation, the regional look-through, dividends and staking), `xirr` (Newton plus bracketing), `history` (contributions, net purchases, compression) and `timing` (the D40 budget amount, parcel optimiser, countdown including `split_off`, consider-next and the next-buy hint). Golden tests under `test/golden/` read the local workbook at runtime. A purity test and an ESLint rule ban clocks and non-root imports. |
| `packages/schema` | Adds `trading.ts` (units from an amount, fees, the order-value bound), `dto/investments.ts` (request schemas and DTOs), three error codes (`TRADE_OVERSELL`, `INSTRUMENT_EXISTS`, `INSTRUMENT_IN_USE`), and investment fixtures covering every page state. |
| `apps/server` | Migration `0002_stage2_investments` adds `instruments.default_fee_cents` and `default_fee_rate`. `src/investments/**` and `routes/investments.ts`: `GET /api/investments/:kind[/trades]`, `GET/POST/PUT/DELETE /api/instruments[/:id]`, and `POST/PUT/DELETE /api/trades[/:id]`. Mutations run in `IMMEDIATE` transactions and refuse oversells (422). The D34 rules: editing an imported row makes it app-owned, and deleting one leaves a marker, so re-import is blocked. A default-fee-only edit does not block it. The server golden is in `test/golden/`. |
| `apps/web` | The pages `/stocks`, `/etfs`, `/managed-funds` and `/crypto`, plus `/<kind>/$instrumentId` holding detail pages. Each has KPI tiles, the holdings table (with a "More columns" toggle), the trade ledger, trade and holding forms (D38 amount mode with a default-fee pre-fill, D47 per-holding mode memory), allocation donuts (current vs target), value, gain and purchase history charts, the FY realised table (D42), the next-buy and timing card (D39/D46), and staleness badges. Phone tables put status first. |
| `e2e/` | `investments.spec.ts`, `investments-states.spec.ts` (renders the fixtures in a real browser) and `trades.spec.ts`. `trades.spec.ts` runs in its own `mutations` Playwright project, which depends on `desktop` and `phone`. |

## How to run
Everything from Stage 1 still applies: `pnpm dev`, `pnpm import:workbook`, `pnpm seed:dev`, `pnpm check`, `pnpm test`, `pnpm e2e`, `pnpm build` then `pnpm start`, and `pnpm guard:all`.
- No new environment variables.
- Scoped runs:
  - `pnpm vitest run --project engine`, and `--project engine test/golden` for the goldens.
  - `pnpm vitest run --project server test/investments`.
- **The owner's `data/` database** is at migration 3 with the imported workbook and live prices. It has **no app-entered rows**, so re-import is still allowed.
- Backups (git-ignored):
  - `data/backups/pre-stage2-2026-09-25/` is the database as it was before Stage 2.
  - `data/backups/draft-0002-2026-09-25/` holds a copy that a stale dev server migrated with a draft 0002. It is no longer needed.

**State at close:**
- typecheck, lint, format:check, build and `guard:all` are green. The guard has 701 private terms, including the rounded forms of the private ratios.
- 1878 unit tests pass, with the goldens and the gated suites running.
- e2e: 163 passed, 11 skipped by design, and the `mutations` project ran.

## Known issues / carried forward
- **Deferred review items:** see "Deferred" in the stage-2 close notes.
  - Stage 3: engine purity hardening.
  - Stage 5: a chart gap step before the live point.
  - Stage 6 polish: finding the default-fee edit, the ETF Holdings tile, duplicated limits and helpers, a layering nit.
  - Stage 7: trades dated after the as-of date across time zones; a race between the CLI import and the server.
- **Stage 2 stubs that Stage 3 replaces** (stage-2.md §1.5):
  - The D40 amount to invest is computed from the **imported** budget rows. The UI says so.
  - Dividends are read-only on the holding pages.
  - The cash-deficit wait (`SheetOptions!H12`) is deferred.
  - "Consider next" uses the imported cash balances and other-asset values.
- **D46 (manual-split budget) is to be revisited with the live Budget in Stage 3.**
- **Flaky e2e:**
  - Runs can fail with `net::ERR_NETWORK_CHANGED` when the VPN or Tailscale adapters change; a re-run passes.
  - The records test has a 60 s timeout.
  - Server tests have 20 s timeouts for cold starts under load.
- **Stale dev servers:** after a demo, stop `pnpm dev` before starting agent work. A `tsx watch` server left running on `data/` hot-reloads onto in-progress code and can apply draft migrations; this happened once during Stage 2 and was rolled back from the backup. Under the Claude preview, the server gets `PORT=5173` and listens on 127.0.0.1:5173, beside Vite on ::1:5173.
- **Still open from Stage 1:**
  - The D34 gap for app-entered settings (decide it with the Settings page in Stage 5).
  - Yahoo is unofficial.
  - CoinGecko ids are resolved by search (check them on `/prices`).
- **Still open from Stage 0:**
  - The Dockerfile is unbuilt (Stage 7; it needs `cdn.sheetjs.com`).
  - Route-level code splitting (Stage 6).
  - Browser-pane screenshots time out while the pane is hidden.
  - Never run `pnpm deploy` in the dev checkout.
  - pnpm 11 `allowBuilds` stays as it is.
  - TypeScript stays pinned to ~6.0.
- **Privacy:** anything printed from an owner import (symbols, check ids, API bodies) stays in git-ignored `artifacts/` or `docs/private/`. Before implementers start, the stage's coordinator pre-step adds that stage's owner amounts **and their rounded forms** to `docs/private/guard-terms.txt`.

## Next step
**Stage 3: Cash flow & income (Cash, Side Income, Dividends, Budget).** Follow `docs/STAGE_PROCESS.md`:
1. Ask the Stage 3 questions in `docs/private/OPEN_QUESTIONS.md`:
   - loans held as cash accounts;
   - franking credits and a Yahoo dividend suggestion;
   - the "Include side income" setting;
   - the savings-rate definition and a one-off inflow adjustment;
   - the FY or calendar year basis;
   - the house-deposit tracker;
   - the emergency-fund offset setting.

   Also revisit D46.
2. Build on Stage 2:
   - The live Budget engine replaces the imported-rows input of `budgetInvestment` (same signature).
   - The Dividends page gains dividend CRUD, and the holding pages keep reading it by instrument id (D28).
   - The savings engine supplies the cash-deficit wait for the timing chain.
   - Reuse the engine conventions (pure, `asOf` injected, cents and decimal strings) and the Stage 2 workflow shape: Planner → critics → reviser; Scaffolder → implementers → Integrator; reviewers → triage → Fixer → Verifier.
3. Coordinator pre-step: stop any running dev server, back up `data/`, and add the Stage 3 guard terms, including rounded forms.

## Environment facts (generic)
- **Tooling:** Windows 11 with PowerShell and Git Bash, Node v24.20.0, pnpm 11.23. **No Docker, GitHub CLI or Python.** System Chrome and Edge are installed; Playwright uses `channel: 'chrome'`.
- **PDFs:** the Claude `Read` tool can't render them here (no poppler). Use the `.txt` of the style guide.
- **Reading the xlsx:** use SheetJS (the 0.20.3 tarball from cdn.sheetjs.com). `exceljs` fails on the sheet named "History". SheetJS cannot **write** a sheet named "History"; the synthetic workbook renames it through `XLSX.CFB`.
- **Network:** Yahoo's chart API needs a browser-like User-Agent. CoinGecko's public API needs no key.
- **Private backup:** `reference/` and `docs/private/` (including `guard-terms.txt`, `stage-1-private.md` and `stage-2-private.md`) exist only on this PC. Back them up to the NAS when it is reachable (see `docs/private/ENVIRONMENT.md`).
