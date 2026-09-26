# Handoff

_Last updated: 2026-09-26, end of Stage 3._

## Where we are
**Stage 3 (Cash flow & income: Cash, Side Income, Budget, Dividends) is done.** The owner approved the demo, and it is committed locally with the owner's OK. Nothing has been pushed (D10).

- The remote `origin` is `github.com/devcal1/joinr-fin` (**public**).
- The plan and its outcome are in `docs/stages/stage-3.md`. See its "Scaffold notes", "Stage close notes" and "Plan review log".
- Decisions:
  - Kickoff: D49–D58.
  - Plan review (owner questions): D59–D62.
  - Demo: D63 (all §11 fixes except the vetoed fix 7), D64, D65.
- Owner-specific golden expectations, quirks, demo figures and guard terms are in `docs/private/stage-3-private.md`.

## What exists
A pnpm workspace (Node 24, TypeScript 6). New or extended in Stage 3:

| Path | What it is |
|---|---|
| `packages/engine` | New modules: `periods` (snapshot windows, the baseline first month, the provisional current period, `yearWindow` for FY or calendar), `cash` (totals by kind, available cash, the emergency-fund test with the D56 offsets and the D59 loan rule, `monthlyPayCents`), `savings` (the per-period savings engine, raw and D51-adjusted), `kpis` (Cash KPIs on the D52 year basis, the fixed trend, end-of-year and cash-target projections), `goals` (D55 waterfall on available cash), `sideIncome` (D57 deposits bucketed into periods, FY and 365-day averages), `budget` (the live Budget with D53/D54, the sheet's EF basis per D61, transfers, breakdowns; `budgetInvestment` keeps its Stage 2 signature), `dividends` (FY, rolling 12 months, per-holding FY table with DRP advice), `suggestions` (the D50/D62 Yahoo matcher), `charts` (`compressCashflow`). The cash-deficit wait (H12) now feeds the Stage 2 countdown. Purity rules were hardened (ESLint + `test/purity.test.ts`). Goldens in `test/golden/cashflow*.ts`. |
| `packages/schema` | `dto/cashflow.ts` (request schemas and DTOs), new tables `cash_balance_entries`, `side_income_deposits`, `savings_adjustments`, `savings_goals`, `dividend_events`, the `savings.yearBasis` setting, `EDITABLE_SETTING_KEYS` / `isWorkbookSetting`, three error codes (`ACCOUNT_IN_USE`, `STREAM_IN_USE`, `LAST_BALANCE_ENTRY`), cash-flow fixtures for every page state. |
| `apps/server` | Migration `0003_stage3_cashflow` (the new tables; converts balances and the old side-income entries). `src/cashflow/**` and the routes `cash`, `sideIncome`, `budget`, `dividends`, `settings`: `GET /api/{cash,side-income,budget,dividends}`, CRUD for accounts, balance entries, adjustments, period notes, goals, deposits, streams, budget items and automatic rows, yearly expenses and dividends, suggestion refresh/dismiss/restore, and `PATCH /api/settings`. `src/market/dividends/**`: the Yahoo dividend-events service and daily job (shared cool-down with the price job, exchange-time-zone dates, fake and off modes). D34: workbook settings block re-import; app-only settings, adjustments, goals, dismissals and a kind-only account edit do not. |
| `packages/importer` | Side income imported as dated deposits (D57); one balance entry per account; account kinds carried across re-imports by name; the settings-gap rule; the re-pointed reconciliation checks. |
| `packages/ui` | `Meter` (progress meter with `role="meter"`); additive field props (`labelHidden`, `list`). |
| `apps/web` | The pages `/cash`, `/side-income`, `/budget`, `/dividends` (KPI tiles, tables with phone status-first order, forms, charts, Adjusted/Raw switch, provisional and baseline periods, goals, update-balances mode, suggestions flow, settings forms), and the Stage 2 next-buy card on the live budget with the cash-deficit wait and D54 copy. |
| `e2e/` | `cashflow.spec.ts` (incl. the 768–1199 px account-name check), `cashflow-states.spec.ts` (every fixture state), `cashflow-mutations.spec.ts` in its own `cashflow-mutations` Playwright project (depends on `mutations`). |

## How to run
Everything from Stages 1–2 still applies: `pnpm dev`, `pnpm import:workbook`, `pnpm seed:dev`, `pnpm check`, `pnpm test`, `pnpm e2e`, `pnpm build` then `pnpm start`, and `pnpm guard:all`.
- No new environment variables. `PRICE_REFRESH_MINUTES=0` also keeps the dividends job's timer off; the refresh route still works.
- Scoped runs:
  - `pnpm vitest run --project engine`, and `--project engine test/golden` for the goldens.
  - `pnpm vitest run --project server test/cashflow`, `--project server test/market`.
  - `pnpm vitest run --project importer`.
- **Run commands from the repo root** (a relative `DATA_DIR` resolves against it). Under Git Bash, set `MSYS_NO_PATHCONV=1` when passing paths such as `/cash` in environment variables.
- **The owner's `data/` database** is at migration 4 (0003 applied at the demo). The two loans are `loan_receivable` (a kind-only edit), Yahoo dividend events are cached, and the owner may have added a savings goal (an app-only overlay). **`hasAppData` is false, so re-import is still allowed.**
- Backups (git-ignored): `data/backups/pre-stage3-2026-09-25/` (before the Stage 3 build) and `data/backups/pre-stage3-demo-2026-09-26/` (right before migration 0003 at the demo). The older Stage 2 backups are no longer needed.

**State at close:**
- typecheck, lint, format:check, build and `guard:all` are green. The guard has 1856 private terms, including Stage 3's.
- 2507 unit tests pass (141 files), with all six golden files running.
- e2e: 244 passed, 11 skipped by design; the `mutations` and `cashflow-mutations` projects ran.

## Known issues / carried forward
- **Deferred review items:** see "Deferred" in the stage-3 close notes.
  - Stage 4: the provisional period uses the imported other-asset, super and mortgage figures (`staticUntilStage4`); foreign-currency other-asset purchases are skipped until FX.
  - Stage 5: the import-origin settings row kept on re-import; recording a month.
  - Stage 6 polish: two empty states (STYLE-13, STYLE-15), the chunk-size warning, plus the Stage 2 items.
  - Stage 7: the budget rows' stale account names (D65); plus the Stage 2 items.
- **Flaky e2e:** `net::ERR_NETWORK_CHANGED` when VPN or Tailscale adapters change (re-run). The records test has 90 s; server tests have 20 s timeouts for cold starts.
- **Stale dev servers:** stop `pnpm dev` before agent work. A `tsx watch` server on `data/` would hot-reload onto in-progress code and could apply a draft migration. Under the Claude preview the server gets `PORT=5173` on 127.0.0.1 beside Vite on ::1; its cold start can take ~30 s after Vite is ready. Servers on other ports may belong to other projects on this PC; check the command line before stopping one.
- **Browser pane:** it is about 800–1024 px wide, between the phone and desktop layouts; check that range too. A custom select needs a real click after `form_input` before React sees the value.
- **Still open from Stages 0–2:** the Dockerfile is unbuilt (Stage 7; needs `cdn.sheetjs.com`); route-level code splitting (Stage 6); Yahoo is unofficial; CoinGecko ids are resolved by search; never run `pnpm deploy` in the dev checkout; pnpm 11 `allowBuilds` stays; TypeScript stays pinned to ~6.0.
- **Privacy:** anything printed from an owner import stays in git-ignored `artifacts/` or `docs/private/`. Before implementers start, the stage's coordinator pre-step adds that stage's owner amounts **and their rounded forms** to `docs/private/guard-terms.txt`.

## Next step
**Stage 4: Other Assets, Super & Property.** Follow `docs/STAGE_PROCESS.md`:
1. Ask the Stage 4 questions in `docs/private/OPEN_QUESTIONS.md`:
   - mortgage "payments paid" (track actual repayments with interest and fees; the optional offset);
   - the primary residence in Net Worth and FIRE;
   - super: SG, the concessional cap, contributions tax, gains as Δbalance − contributions, the notes log;
   - other assets: manual prices for collectibles, purchase dates for undated items, bullion as oz and metal type.
2. Build on Stage 3:
   - Replace `staticUntilStage4` in the savings engine's live inputs: the provisional period's other-asset purchases (with FX), super contributions, property value, mortgage balance and principal paid come from the Stage 4 engines.
   - Offsets already exist on the Cash page (`isOffset`, D56); link them to the mortgage.
   - Loans you have made stay `loan_receivable` cash accounts (D49, D59); they are not Other Assets.
   - Reuse the engine conventions and the Stage 3 workflow shape: Planner → critics → reviser; Scaffolder → parallel implementers → Integrator; reviewers → per-reviewer triage → Fixer → Verifier.
3. Coordinator pre-step: stop any running dev server, back up `data/`, add the Stage 4 guard terms (incl. rounded forms).

## Environment facts (generic)
- **Tooling:** Windows 11 with PowerShell and Git Bash, Node v24.20.0, pnpm 11.23. **No Docker, GitHub CLI or Python.** System Chrome and Edge are installed; Playwright uses `channel: 'chrome'`.
- **PDFs:** the Claude `Read` tool can't render them here (no poppler). Use the `.txt` of the style guide.
- **Reading the xlsx:** use SheetJS (the 0.20.3 tarball from cdn.sheetjs.com). `exceljs` fails on the sheet named "History". SheetJS cannot **write** a sheet named "History"; the synthetic workbook renames it through `XLSX.CFB`.
- **Network:** Yahoo's chart API needs a browser-like User-Agent; its dividend events and daily closes come in one request, and dates must be taken in the exchange time zone. CoinGecko's public API needs no key.
- **Private backup:** `reference/` and `docs/private/` (including `guard-terms.txt` and `stage-1/2/3-private.md`) exist only on this PC. Back them up to the NAS when it is reachable (see `docs/private/ENVIRONMENT.md`).
