# Handoff

_Last updated: 2026-09-27, end of Stage 5._

## Where we are
**Stage 5 (History, Net Worth dashboard & Settings) is done.** The owner approved the demo, accepted all 20 §11 fixes (D96), and it is committed locally with the owner's OK. Nothing has been pushed (D10).

- The remote `origin` is `github.com/devcal1/joinr-fin` (**public**).
- The plan and its outcome are in `docs/stages/stage-5.md`. See its "Scaffold notes", "Stage close notes" and "Plan review log" (with "Owner answers").
- Decisions:
  - Kickoff: D81–D88.
  - Plan review (owner questions): D89–D95.
  - Demo: D96.
- Owner-specific golden expectations, quirks, demo figures and guard terms are in `docs/private/stage-5-private.md`.

## What exists
A pnpm workspace (Node 24, TypeScript 6). New or extended in Stage 5:

| Path | What it is |
|---|---|
| `packages/engine` | New modules: `snapshot` (composes a live History row from every calculator; `deriveSnapshotColumns`, `checkSnapshots`), `netWorth` (`netWorthOf`; the dashboard's classes, liabilities with offsets and accounts in debit, distribution, allocation and KPIs; `rollingNetWorth` with the 12-month projection), `aggregate` (monthly, quarterly and FY-yearly groups, replacing `compressTable`), `trend` (linear trendlines), `recording` (`nextRecordMonth`, `recordableMonths`, `recordingsDue` with the D94 blocked state), `tax` (ATO resident brackets, Medicare levy, LITO; the D85/D90 suggestion). `super` gains the D88a measured-through dates; `periods` and `kpis` key years on the period month. Goldens in `test/golden/history.*`. |
| `packages/schema` | `src/history.ts`, `src/tax.ts`, `dto/{history,settings,fields}.ts`, the `snapshot_audit` table and six snapshot columns (provenance, revision, stored offsets, the D88 extras), `history.autoRecord`, `SETTING_GROUPS`, 60 `EDITABLE_SETTING_KEYS` (every key but `super.concessionalCapFy`), `PREFERENCE_SETTING_KEYS` (D95), `SETTING_WRITE_BOUNDS`, `NET_WORTH_CLASS_SLOTS`, four error codes, and fixtures for every page state. |
| `apps/server` | Migration `0005_stage5_history` (append-only, plus a trigger that keeps a snapshot's month, run date and source fixed). `src/history/**`: the pages, `writeRecordedMonths`, audited corrections and the latest-month delete (D92), and `recorder.ts` (the month-end scheduler at 23:00 local time with an injectable clock, start-up catch-up, one record at a time, fresh prices first; it never holds the import lock). `src/settings/**` (the Settings page, `SETTING_READERS`). Routes: `GET /api/net-worth`, `GET /api/history`, `GET /api/history/series`, `POST /api/history/record`, snapshot correct and delete, `GET /api/settings`; `/api/status` gains `features` and `history`. `hasAppData` counts recorded months and ignores preference keys (D95). |
| `packages/importer` | D87 (an import-origin setting the workbook no longer provides resets to its default) and D95 (an app-set preference key is kept on re-import), with report info lines. |
| `packages/ui` | `BarChart` line overlays (right axis, trendlines, dashed legend key, total labels, per-datum colour); `DonutChart maxSegments`. |
| `apps/web` | The pages `/` (Net Worth: hero band, assets and liabilities with per-loan mortgage lines, the distribution donut with every class (D93), the savings-rate gauge, the liquid allocation, four charts with the view switch, the rolling table with the projection), `/history` (status, live row, the record / look-back / correct / delete flows, the audit trail, consistency, charts) and `/settings` (every group, the tax suggestion, the auto-record switch, links back from each page, D86). Feature switches hide pages from the navigation. |
| `e2e/` | `networth.spec.ts`, `history.spec.ts`, `settings.spec.ts`, `history-states.spec.ts`, and `history-mutations.spec.ts` in its own `history-mutations` project (depends on `assets-mutations`). |

## How to run
Everything from Stages 1–4 still applies: `pnpm dev`, `pnpm import:workbook`, `pnpm seed:dev`, `pnpm check`, `pnpm test`, `pnpm e2e`, `pnpm build` then `pnpm start`, and `pnpm guard:all`.
- **New environment variable `AUTO_RECORD`** (`true`/`false`, unset by default). It overrides and locks the `history.autoRecord` setting.
  - **Leave it unset, and the setting off, until the Stage 7 cutover (D84).** A recorded month is app data and blocks re-import (D34).
  - Never set it on `data/`.
- Scoped runs:
  - `pnpm vitest run --project engine test/golden`
  - `pnpm vitest run --project server test/history test/recorder test/settings`
  - `pnpm vitest run --project importer`
- **Run commands from the repo root.** Under Git Bash, set `MSYS_NO_PATHCONV=1` when passing paths in environment variables.
- **e2e on this PC:** a full run loses 9–31 read-only tests to `net::ERR_NETWORK_CHANGED` (VPN and Tailscale adapters).
  1. Re-run only those with `pnpm e2e --project=desktop --project=phone --last-failed --no-deps`.
  2. Then run the mutating projects one at a time with `--no-deps`, in this order: `mutations`, `cashflow-mutations`, `assets-mutations`, `history-mutations`.
- **The owner's `data/` database** is at migration 6 (0005 was applied at the demo). Nothing was recorded on it. **`hasAppData` is false, so re-import is still allowed**, and auto-record is off.
- Backups (git-ignored): `data/backups/pre-stage5-2026-09-26/` (before the build) and `data/backups/pre-stage5-demo-2026-09-27/` (right before migration 0005 at the demo). The Stage 4 backups are no longer needed.

**State at close:**
- typecheck, lint, format:check, build and `guard:all` are green. The guard has 4596 private terms.
- 3834 unit tests pass (209 files), with every gated suite and golden running.
- e2e: every test passes after the allowed network re-run; the four mutating projects ran in chain order.

## Known issues / carried forward
- **Deferred items:** see "Deferred" in the stage-5 close notes.
  - **Stage 6 polish:**
    - from Stage 4: STYLE-5, 6, 7, 11 and CODE-9, and the guard hardening for numbers written with `_` or thousands separators;
    - from Stage 3: STYLE-13, STYLE-15 and the chunk-size warning;
    - the heavier e2e network flakes.
  - **Stage 7:**
    - Set `TZ` in the compose file: the 23:00 record time is server-local (D89).
    - After the fresh import, switch auto-record on (D84), and record or skip any missing month (D94).
    - Fix the mortgage payment and compounding in the sheet before the export (D76).
    - Optionally date the undated items (D73).
    - Fix the budget rows' stale account names (D65).
- **Stale dev servers:** stop `pnpm dev` before agent work. A `tsx watch` server on `data/` would hot-reload onto in-progress code and could apply a draft migration.
  - Under the Claude preview, the server gets the preview port on 127.0.0.1 beside Vite on ::1. Its cold start can take ~30 s.
  - Servers on other ports may belong to other projects on this PC; check the command line before stopping one.
- **Browsers:**
  - The Claude Browser pane is about 800–1024 px wide, and sometimes won't render screenshots while hidden.
  - Claude in Chrome works for demos; restore a minimised window first.
  - A custom select needs `form_input` (and sometimes a real click) before React sees the value.
- **Still open from Stages 0–4:**
  - The Dockerfile is unbuilt (Stage 7; it needs `cdn.sheetjs.com`).
  - Route-level code splitting (Stage 6).
  - Yahoo is unofficial, and CoinGecko ids are resolved by search.
  - Never run `pnpm deploy` in the dev checkout.
  - pnpm 11 `allowBuilds` stays, and TypeScript stays pinned to ~6.0.
- **Privacy:** anything printed from an owner import stays in git-ignored `artifacts/` or `docs/private/`. Before implementers start, the stage's coordinator pre-step adds that stage's owner amounts **and their rounded forms** to `docs/private/guard-terms.txt`.

## Next step
**Stage 6: FIRE planner & polish.** Follow `docs/STAGE_PROCESS.md`:
1. Ask the Stage 6 questions in `docs/private/OPEN_QUESTIONS.md`:
   - FIRE spend: a manual yearly figure, or derived from the corrected savings engine (04 Q3);
   - preservation age: 60 (statutory), editable (04 Q4);
   - the super top-up bug: use actual contributions instead of the whole salary (proposed: fix).

   Also decide at kickoff which deferred polish items to take (the list above), and whether the progression chart uses the node-line motif.
2. Build on Stage 5:
   - FIRE excludes the primary residence (D68). It reads the Stage 5 net-worth classes, the savings engine and the super engine. The `features.fire` switch already hides the page.
   - The polish pass: a phone-width audit, empty and error states, loading skeletons, keyboard access, number formats (STYLE_GUIDE §8) and route-level code splitting.
   - Reuse the workflow shape:
     - Planner → critics → reviser;
     - Scaffolder → parallel implementers → Integrator;
     - reviewers → per-reviewer triage → Fixer → Verifier.
3. Coordinator pre-step: stop any running dev server, back up `data/`, and add the Stage 6 guard terms (incl. rounded forms).

## Environment facts (generic)
- **Tooling:** Windows 11 with PowerShell and Git Bash, Node v24.20.0, pnpm 11.23. **No Docker, GitHub CLI or Python.** System Chrome and Edge are installed; Playwright uses `channel: 'chrome'`.
- **PDFs:** the Claude `Read` tool can't render them here (no poppler). Use the `.txt` of the style guide.
- **Reading the xlsx:** use SheetJS (the 0.20.3 tarball from cdn.sheetjs.com).
  - `exceljs` fails on the sheet named "History".
  - SheetJS cannot **write** a sheet named "History"; the synthetic workbook renames it through `XLSX.CFB`.
- **Network:**
  - Yahoo's chart API needs a browser-like User-Agent. Dividend events, daily closes and FX closes come from the same chart endpoint, and dates must be taken in the exchange time zone.
  - CoinGecko's public API needs no key.
  - The ATO site refuses automated fetches (HTTP 403). The statutory super figures and the Stage 5 tax brackets were taken from search-result summaries.
- **Private backup:** `reference/` and `docs/private/` (including `guard-terms.txt` and `stage-1/2/3/4/5-private.md`) exist only on this PC. Back them up to the NAS when it is reachable (see `docs/private/ENVIRONMENT.md`).
