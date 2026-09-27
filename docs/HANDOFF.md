# Handoff

_Last updated: 2026-09-27, end of Stage 6._

## Where we are
**Stage 6 (FIRE planner & polish) is done.** The owner approved the demo, accepted all 23 §11 fixes (D110), asked for an information-dense layout (D109, applied before the close) and gave the OK to commit locally. Nothing has been pushed (D10).

- The remote `origin` is `github.com/devcal1/joinr-fin` (**public**).
- The plan and its outcome are in `docs/stages/stage-6.md`. See its "Scaffold notes", "Stage close notes" and "Plan review log" (with "Owner answers").
- Decisions:
  - Kickoff: D97–D104.
  - Plan review (owner questions): D105–D108.
  - Demo: D109 (density) and D110.
- Owner-specific expectations, quirks, demo figures and guard terms are in `docs/private/stage-6-private.md`.

## What exists
A pnpm workspace (Node 24, TypeScript 6). New or extended in Stage 6:

| Path | What it is |
|---|---|
| `packages/engine` | `fire.ts`: `deriveFireInputs` (spend and savings from the corrected savings engine, D97/D108; the super contribution from the super engine, D99; the growth blend over every FIRE asset with super, D102/D107; debts fixed in dollars, D106) and `projectFire` (the year-by-year path, milestones, needed vs projected, status, input guards incl. overflow → `needs_input`). `fireSheet.ts`: the template's formulas in "sheet mode", reproducing every populated FIRE output cell. Goldens in `test/golden/fire.*`; the hand-worked example in `test/fire.handworked.test.ts`. |
| `packages/schema` | `src/fire.ts`, `dto/fire.ts` (the what-if query schema, DTOs), two new FIRE keys, FIRE keys as preference keys (D103), `SettingDto.notice`, FIRE fixtures (26 page states). |
| `apps/server` | `src/fire/**` and `routes/fire.ts`: `GET /api/fire` (with what-if query), `POST /api/fire/use-workbook-contribution`; the D98 one-off upgrade (`applySettingUpgrades`, at start-up and after an import; idempotent, re-import-safe). `src/lib/**` shared date and sum helpers (CODE-9). No migration (still 6). |
| `packages/ui` | `MilestoneLine` (node-line motif, colour by position), line-chart milestone markers, `Skeleton`, `StatTile` footer, KV and chart-table fixes (STYLE-5/6/7/11), the focus ring, and the **dense** spacing (D109: 24 px table rows, 12 px cards, 240 px charts, the shorter compact hero). |
| `apps/web` | `/fire` (tiles, notes, milestone line, progression chart with two views, the what-if panel with Save/Reset, how it is worked out, year by year); route-level code splitting (lazy routes, chunk-load recovery); `PageSkeleton` on every data page; the refresh-error callout; empty states (Dividends, Side Income); the dense Net Worth layout (assets beside allocation, donut and gauge; the charts 2 × 2). |
| `tools/privacy-guard` | Numbers written with `,` or `_` separators are matched too. |
| `e2e/` | `fire.spec.ts`, `fire-states.spec.ts`, `fire-mutations.spec.ts` (own project after `history-mutations`), `polish.spec.ts` (phone audit, keyboard walk, formats), `warmup.setup.ts` (opens every lazy route once). The read-only projects retry twice. |

## How to run
Everything from Stages 1–5 still applies: `pnpm dev`, `pnpm import:workbook`, `pnpm seed:dev`, `pnpm check`, `pnpm test`, `pnpm e2e`, `pnpm build` then `pnpm start`, and `pnpm guard:all`.
- Scoped runs:
  - `pnpm vitest run --project engine test/golden`
  - `pnpm vitest run --project server test/fire test/golden/fire.golden.test.ts`
  - `pnpm vitest run --project ui --project web`
- **Run commands from the repo root.** Under Git Bash, set `MSYS_NO_PATHCONV=1` when passing paths in environment variables.
- **e2e on this PC:** read-only projects now retry twice, so a full run normally exits 0 with a handful of flaky tests (cold lazy-route loads and `net::ERR_NETWORK_CHANGED`). The mutating projects run in chain order: `mutations`, `cashflow-mutations`, `assets-mutations`, `history-mutations`, `fire-mutations`.
- **`AUTO_RECORD`**: leave it unset and the setting off until the Stage 7 cutover (D84).
- **The owner's `data/` database** is at migration 6. The D98 one-off ran at the demo (access age 60, origin `app`, marker written). Nothing was recorded or saved from FIRE. **`hasAppData` is false, so re-import is still allowed.**
- Backups (git-ignored): `data/backups/pre-stage6-2026-09-27/` (before the build and the demo). The Stage 5 backups are no longer needed.

**State at close:**
- typecheck, lint, format:check, build (no chunk warning) and `guard:all` are green. The guard has 8023 private terms.
- 5063 unit tests pass, with every gated suite and golden running.
- e2e: the full suite passed with retries; the layout-sensitive specs passed again after the density change.

## Known issues / carried forward
- **Stage 7:**
  - Set `TZ` in the compose file: the 23:00 record time is server-local (D89).
  - After the fresh import (the D98 one-off then runs on the new database), switch auto-record on (D84), and record or skip any missing month (D94).
  - Fix the mortgage payment and compounding in the sheet before the export (D76).
  - Optionally date the undated items (D73).
  - Fix the budget rows' stale account names (D65).
  - Cleanup: CODE-7 (adopt or drop `sumCents`/`sumDecimalStrings`; drop `STAGE_TITLES`/`PAGES.stage` if unused).
- **Optional:** narrower what-if input ranges, only if the owner wants them.
- **Known behaviour:** saving a FIRE setting records it with origin `app` (D103). A saved super contribution then reads "Your setting" instead of the derived figure until it is cleared (D105).
- **Stale dev servers:** stop `pnpm dev` before agent work. A `tsx watch` server on `data/` would hot-reload onto in-progress code.
  - Under the Claude preview, the server gets the preview port on 127.0.0.1 beside Vite on ::1. Its cold start can take ~30 s.
  - Servers on other ports may belong to other projects on this PC; check the command line before stopping one.
- **Browsers:**
  - The Claude Browser pane's emulated viewports crop screenshots. For a page-wide look, take Playwright full-page shots against the dev server (`artifacts/stage6/density/shots.mjs` is a template).
  - A custom select needs `form_input` (and sometimes a real click) before React sees the value.
- **Still open from Stages 0–5:**
  - The Dockerfile is unbuilt (Stage 7; it needs `cdn.sheetjs.com`).
  - Yahoo is unofficial, and CoinGecko ids are resolved by search.
  - Never run `pnpm deploy` in the dev checkout.
  - pnpm 11 `allowBuilds` stays, and TypeScript stays pinned to ~6.0.
- **Density rule (D109):** any new table or page must keep the dense spacing (STYLE_GUIDE §3). Check both the page and every table's inner scroll width at 1440 px.
- **Privacy:** anything printed from an owner import stays in git-ignored `artifacts/` or `docs/private/`. Before implementers start, the stage's coordinator pre-step adds that stage's owner figures **and their rounded and separator forms** to `docs/private/guard-terms.txt`.

## Next step
**Stage 7: Umbrel deployment & cutover.** Follow `docs/STAGE_PROCESS.md`:
1. Ask the Stage 7 questions in `docs/private/OPEN_QUESTIONS.md`: the Umbrel version; SSH or Portainer access; the storage path for `DATA_DIR`; how the build context gets to the NAS (SMB copy, per the plan) and whether the GitHub remote stays public; backup retention. Check the prerequisites in PLAN.md (Tailscale healthy, NAS reachable from the dev PC).
2. Build on Stage 6:
   - The Dockerfile and compose file (written in Stage 0, never built) need `cdn.sheetjs.com` at build time and `TZ` set (D89).
   - Umbrel packaging (`umbrel-app.yml`, app proxy auth, `DATA_DIR` bind-mounted to NAS storage), nightly backups with retention and a tested restore.
   - The owner fixes the sheet items (D76, optionally D73 and D65), makes a fresh Drive export, then import and reconciliation on the NAS; switch auto-record on (D84, D94).
   - The Stage 7 cleanup item (CODE-7).
   - One batched push to GitHub, only if the owner wants it (D10).
3. Coordinator pre-step: stop any running dev server, back up `data/`, and add any Stage 7 guard terms (NAS paths, hostnames and addresses are private: keep them in `docs/private/`).

## Environment facts (generic)
- **Tooling:** Windows 11 with PowerShell and Git Bash, Node v24.20.0, pnpm 11.23. **No Docker, GitHub CLI or Python.** System Chrome and Edge are installed; Playwright uses `channel: 'chrome'`.
- **PDFs:** the Claude `Read` tool can't render them here (no poppler). Use the `.txt` of the style guide.
- **Reading the xlsx:** use SheetJS (the 0.20.3 tarball from cdn.sheetjs.com).
  - `exceljs` fails on the sheet named "History".
  - SheetJS cannot **write** a sheet named "History"; the synthetic workbook renames it through `XLSX.CFB`.
- **Network:**
  - Yahoo's chart API needs a browser-like User-Agent. Dividend events, daily closes and FX closes come from the same chart endpoint, and dates must be taken in the exchange time zone.
  - CoinGecko's public API needs no key.
  - The ATO site refuses automated fetches (HTTP 403).
- **Private backup:** `reference/` and `docs/private/` (including `guard-terms.txt` and `stage-1…6-private.md`) exist only on this PC. Back them up to the NAS when it is reachable (see `docs/private/ENVIRONMENT.md`).
