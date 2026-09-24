# Handoff

_Last updated: 2026-09-24, end of Stage 0._

## Where we are
**Stage 0 (Foundations & design system) is done.** It was demoed to the owner and committed locally as the repo's first commit. Nothing has been pushed (D10).

- The remote `origin` is `github.com/devcal1/joinr-fin` (**public**).
- The detailed plan and outcome are in `docs/stages/stage-0.md`; see its "Stage close notes".
- The owner's demo decisions are D16–D21 in `docs/DECISIONS.md`.

## What exists
A pnpm workspace (Node 24, TypeScript 6):

| Path | What it is |
|---|---|
| `apps/web` | React + Vite SPA with TanStack Router (code-based routes). There is a route for every in-scope page; all except Net Worth are placeholders naming the stage that delivers them. It also has `/styleguide` (the component gallery) and `/preview/screen/:variant` (brand screens). |
| `apps/server` | Fastify with `GET /api/health`, env config validated with Zod, SQLite (better-sqlite3 13, WAL) in `DATA_DIR`, and a Drizzle migration runner with one app-meta migration. In production it serves the built SPA with an SPA fallback; unknown `/api` routes return a JSON 404. Production builds are bundled with esbuild into `dist/server.js`. |
| `packages/ui` | `@joinr/ui`, in three parts:<br>- `core/`: tokens, AppShell, the components, forms and formatters.<br>- `brand/`: Wordmark (the traced SVG), BrandBlock, HeroBand and BrandScreen.<br>- `charts/`: ECharts wrappers (donut, bar, line, area, gauge), a ChartCard with a table toggle, and the validated palette. |
| `packages/engine`, `schema`, `importer` | Empty stubs, filled in Stages 1–2. |
| `tools/privacy-guard` | The pre-commit guard. `.githooks/pre-commit` runs it, and `prepare` sets `core.hooksPath`. Its private term list is `docs/private/guard-terms.txt` (git-ignored, 119 terms). |
| `e2e/` | Playwright smoke tests plus the UI owners' specs. They use the **system Chrome**, so no browser download. |
| `Dockerfile`, `docker-compose.yml`, `.dockerignore` | Written, not built; there is no local Docker. They are verified in Stage 7. |
| `README.md`, `docs/ARCHITECTURE.md` | Quick start, scripts, environment, layout, privacy rules and architecture. |

## How to run
- `pnpm install`: also sets the git hooks path.
- `pnpm dev`: web on 5173, server on 3001; Vite proxies `/api`. In the Claude app, use `preview_start` with `joinr-dev` from `.claude/launch.json`.
- `pnpm check`: runs typecheck, lint, format:check and tests. Individual commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm e2e`.
- `pnpm build` then `pnpm start`: production mode.
- `pnpm guard:all`: scans every committable file for private data. `pnpm guard` checks the staged set, which the hook does automatically.
- Ports and the data folder come from env: `PORT`, `WEB_PORT`, `DATA_DIR`. Parallel agents use distinct ports; see `docs/stages/stage-0.md` §4.

**State at close:**
- typecheck, lint, format:check, build and `guard:all` are all green.
- 670 unit tests pass.
- e2e: 84 passed, 8 skipped by design.

## Known issues / carried forward
- **Dockerfile:** unbuilt. Stage 7 on the NAS must confirm corepack with pnpm 11.23, `pnpm fetch`/deploy, and the Linux better-sqlite3 prebuilt binary.
- **Web bundle:** about 1.07 MB, mostly ECharts. Route-level code splitting is planned for Stage 6.
- **Phone screenshots of `/styleguide`:** at 375 px the page is taller than Chrome's 16,384 px capture limit, so take them per section.
- **Browser pane:** screenshots time out while the pane is hidden. For visual checks use a Playwright script (e.g. `artifacts/zoom-wordmark.mjs`) or the saved captures under `artifacts/stage0/`.
- **Never run `pnpm deploy` in the dev checkout.** It rewrites `node_modules` state and breaks pnpm scripts; the README explains.
- **pnpm 11:**
  - `allowBuilds` in `pnpm-workspace.yaml` must keep `better-sqlite3: false` (use the prebuilt binary; allowing the build runs node-gyp, which fails with no compiler) and `esbuild: true`.
  - pnpm may add `minimumReleaseAgeExclude` entries to that file on install; keep them.
- **TypeScript is pinned to ~6.0**, because typescript-eslint 8.70 only accepts TypeScript below 6.1.
- **Style guide:** it still names the owner's business in its source-A description. That was left as written in Discovery; the owner can ask to remove it.

## Next step
**Stage 1: Data model, importer & market data.** Follow `docs/STAGE_PROCESS.md`:
1. Ask the Stage 1 questions in `docs/private/OPEN_QUESTIONS.md`: instrument classification, commodity feed rows, crypto price source, data corrections, dividend re-keying, snapshot dates, multi-currency.
2. Run the build workflow. Reuse the Stage 0 pattern: Planner → Scaffold (if needed) → parallel implementers with disjoint ownership and distinct ports → 2 reviewers → Fixer → Verifier. That is at most 10 Opus agents.
3. Demo: run the import, the reconciliation report, the data browser, and a price refresh.

## Environment facts (generic)
- **Tooling:** Windows 11 with PowerShell and Git Bash, Node v24.20.0, pnpm 11.23. **No Docker, GitHub CLI or Python.** System Chrome and Edge are installed; Playwright uses `channel: 'chrome'`.
- **PDFs:** the Claude `Read` tool can't render them here (no poppler). Use the `.txt` of the style guide.
- **Reading the xlsx:** use the `xlsx` (SheetJS) package; `exceljs` fails on the sheet named "History".
- **Private backup:** `reference/` and `docs/private/` (now including `guard-terms.txt`) exist only on this PC. Back them up to the NAS when it is reachable (see `docs/private/ENVIRONMENT.md`).
