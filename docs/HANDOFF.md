# Handoff

_Last updated: 2026-09-26, end of Stage 4._

## Where we are
**Stage 4 (Other Assets, Super & Property) is done.** The owner approved the demo, and it is committed locally with the owner's OK. Nothing has been pushed (D10).

- The remote `origin` is `github.com/devcal1/joinr-fin` (**public**).
- The plan and its outcome are in `docs/stages/stage-4.md`. See its "Scaffold notes", "Stage close notes" and "Plan review log".
- Decisions:
  - Kickoff: D66–D73.
  - Plan review (owner questions): D74–D78.
  - Code review (owner question): D79.
  - Demo: D80 (all 25 §11 fixes accepted).
- Owner-specific golden expectations, quirks, demo figures and guard terms are in `docs/private/stage-4-private.md`.

## What exists
A pnpm workspace (Node 24, TypeScript 6). New or extended in Stage 4:

| Path | What it is |
|---|---|
| `packages/engine` | New modules: `otherAssets` (cost at the purchase-date FX rate, hand prices with the D77 stale rule, bullion from spot × oz per unit, gain, CAGR with the D73 assumed date, sales and realised gains, the cost-held line, savings flows), `super` (per-fund balance log with transfers in, the D69 SG estimate at each FY's statutory rate with statement overrides, D71 typed contributions, derived gains per period with not-updated months merged, the D79 measured end, chained Modified Dietz, the D70/D75 cap meter), `property` and `amortise` (valuations, gain and CAGR, equity and LVR net of D67 offsets, the D66 balance log with derived repayments and interest, a real schedule on the loan's payment grid with and without the offset), `assetsSnapshot` (**the Stage 5 seam**: live History Q–T, X–AE, AJ–AK). `savings` gains Δ offsets (D78) and sales as negative flows. `staticUntilStage4` is gone (always false). Goldens in `test/golden/assets*`. |
| `packages/schema` | `dto/assets.ts`, `src/assets.ts` (statutory super tables checked 2026-09-26, `paymentDatesBetween`), 8 new tables (price entries, sales, super balance entries, SG overrides, valuations, loan balance entries, offset links, `market_quote_history`), 6 app-only setting keys, three error codes (`FUND_IN_USE`, `PROPERTY_HAS_LOAN`, `SALE_OVERSELL`), fixtures for every page state. |
| `apps/server` | Migration `0004_stage4_assets` (new tables; converts imported rows to one price, balance, valuation or loan entry each and History-derived contributions; no table recreate). `src/assets/**` and the routes: `GET /api/{other-assets,super,property}` plus CRUD for assets, prices, sales, funds, balances, contributions, SG months, properties, valuations, loans, loan entries and offset links. Market data: FX for other-asset currencies, the purchase-date FX backfill (stored once), and a daily series history for spot and FX. D34: the SG-fund flag, SG statement months and the app-only settings do not block re-import; everything else does. |
| `packages/importer` | Price, balance, valuation and loan entries; super contributions from History `R`; the FX rate at purchase; the SG fund carried by name across re-imports; a migration-equivalence test. |
| `packages/ui` | `Meter` cap props (texts, projection tick, tones). |
| `apps/web` | The pages `/other-assets`, `/super`, `/property` (KPI tiles, entry-log editors with as-of dates, update-prices / balances / values modes, the sale form, contribution and SG statement forms, the SG-fund picker, the loan log, offset links, charts, phone and 768–1199 px layouts), and the Cash page's linked-loan line and Offsets part. |
| `e2e/` | `assets.spec.ts` (incl. the 800/1024/1199 px word checks and the 1440 px table checks), `assets-states.spec.ts`, `assets-mutations.spec.ts` in its own `assets-mutations` Playwright project (depends on `cashflow-mutations`). |

## How to run
Everything from Stages 1–3 still applies: `pnpm dev`, `pnpm import:workbook`, `pnpm seed:dev`, `pnpm check`, `pnpm test`, `pnpm e2e`, `pnpm build` then `pnpm start`, and `pnpm guard:all`.
- No new environment variables. `PRICE_REFRESH_MINUTES=0` keeps the price job's timer off; the FX backfill and the series history run inside that job, and `POST /api/prices/refresh` still works.
- Scoped runs:
  - `pnpm vitest run --project engine`, and `--project engine test/golden` for the goldens.
  - `pnpm vitest run --project server test/assets`, `test/market`, `test/golden`.
  - `pnpm vitest run --project importer`.
- **Run commands from the repo root** (a relative `DATA_DIR` resolves against it). Under Git Bash, set `MSYS_NO_PATHCONV=1` when passing paths such as `/super` in environment variables.
- **e2e on this PC:** a full run loses a handful of random read-only tests to `net::ERR_NETWORK_CHANGED` (VPN and Tailscale adapters). Re-run only those with `pnpm e2e --project=desktop --project=phone --last-failed --no-deps`, then run `mutations`, `cashflow-mutations` and `assets-mutations` one at a time with `--no-deps`, in that order. (`--last-failed` without the project filter also picks up the mutating tests that never ran, and they then overlap.)
- **The owner's `data/` database** is at migration 5 (0004 applied at the demo). The SG fund is marked (a flag-only edit). **`hasAppData` is false, so re-import is still allowed.**
- Backups (git-ignored): `data/backups/pre-stage4-2026-09-26/` (before the Stage 4 build) and `data/backups/pre-stage4-demo-2026-09-26/` (right before migration 0004 at the demo). The Stage 3 backups are no longer needed.

**State at close:**
- typecheck, lint, format:check, build and `guard:all` are green. The guard has 3149 private terms, including Stage 4's.
- 3207 unit tests pass (170 files), with every golden file running.
- e2e: every test passes after the one allowed network re-run; the three mutating projects ran in chain order.

## Known issues / carried forward
- **Deferred review items:** see "Deferred" in the stage-4 close notes.
  - Stage 5: carry the super flows after the measured balance date into the next recorded month (D79); store the offset figure in recorded months (D78); compose the live snapshot from `assetsSnapshotColumns`; D79's one-date rule when funds are updated on different dates; plus the Stage 3 items (the import-origin settings row kept on re-import; recording a month).
  - Stage 6 polish: STYLE-5, 6, 7, 11 and CODE-9 (Stage 4), guard hardening for numbers written with `_` or thousands separators, plus STYLE-13, STYLE-15 and the chunk-size warning (Stage 3).
  - Stage 7: fix the mortgage payment and compounding in the sheet before the fresh export (D76); optionally date the undated items in the sheet (D73); the budget rows' stale account names (D65).
- **Stale dev servers:** stop `pnpm dev` before agent work. A `tsx watch` server on `data/` would hot-reload onto in-progress code and could apply a draft migration. Under the Claude preview the server gets `PORT=5173` on 127.0.0.1 beside Vite on ::1; its cold start can take ~30 s after Vite is ready. Servers on other ports may belong to other projects on this PC; check the command line before stopping one.
- **Browser pane:** it is about 800–1024 px wide, between the phone and desktop layouts; check that range too. A custom select needs `form_input` (and sometimes a real click) before React sees the value.
- **Still open from Stages 0–3:** the Dockerfile is unbuilt (Stage 7; needs `cdn.sheetjs.com`); route-level code splitting (Stage 6); Yahoo is unofficial; CoinGecko ids are resolved by search; never run `pnpm deploy` in the dev checkout; pnpm 11 `allowBuilds` stays; TypeScript stays pinned to ~6.0.
- **Privacy:** anything printed from an owner import stays in git-ignored `artifacts/` or `docs/private/`. Before implementers start, the stage's coordinator pre-step adds that stage's owner amounts **and their rounded forms** to `docs/private/guard-terms.txt`.

## Next step
**Stage 5: History, Net Worth dashboard & Settings.** Follow `docs/STAGE_PROCESS.md`:
1. Ask the Stage 5 questions in `docs/private/OPEN_QUESTIONS.md`:
   - missed months (auto-record on the configured day, plus manual and look-back);
   - the Net Worth chart set (the charts the sheet exported only as images);
   - ATO tax brackets (proposed: no).
   Also decide at kickoff: the import-origin settings row on re-import (Stage 3 deferral), and how recorded months store the Stage 4 figures (the super flows after the measured balance date, D79; the offset figure, D78).
2. Build on Stage 4:
   - `assetsSnapshotColumns` plus the Stage 2–3 engines compose the live snapshot; recorded snapshots are immutable.
   - Net Worth: liabilities = property mortgages net of linked offsets (D67) + negative-balance cash accounts; the primary residence is included (D68).
   - The Settings page replaces the per-page settings forms of Stages 3–4 (`EDITABLE_SETTING_KEYS`).
   - Reuse the Stage 4 workflow shape: Planner → critics → reviser; Scaffolder → parallel implementers → Integrator; reviewers → per-reviewer triage → Fixer → Verifier.
3. Coordinator pre-step: stop any running dev server, back up `data/`, add the Stage 5 guard terms (incl. rounded forms).

## Environment facts (generic)
- **Tooling:** Windows 11 with PowerShell and Git Bash, Node v24.20.0, pnpm 11.23. **No Docker, GitHub CLI or Python.** System Chrome and Edge are installed; Playwright uses `channel: 'chrome'`.
- **PDFs:** the Claude `Read` tool can't render them here (no poppler). Use the `.txt` of the style guide.
- **Reading the xlsx:** use SheetJS (the 0.20.3 tarball from cdn.sheetjs.com). `exceljs` fails on the sheet named "History". SheetJS cannot **write** a sheet named "History"; the synthetic workbook renames it through `XLSX.CFB`.
- **Network:** Yahoo's chart API needs a browser-like User-Agent; dividend events, daily closes and FX closes come from the same chart endpoint, and dates must be taken in the exchange time zone. CoinGecko's public API needs no key. The ATO site refuses automated fetches (HTTP 403); the statutory super figures were taken from search-result summaries.
- **Private backup:** `reference/` and `docs/private/` (including `guard-terms.txt` and `stage-1/2/3/4-private.md`) exist only on this PC. Back them up to the NAS when it is reachable (see `docs/private/ENVIRONMENT.md`).
