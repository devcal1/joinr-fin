# Decision log

Owner-specific details (addresses, ids, holdings) live in `docs/private/`, which is git-ignored.

| # | Date | Decision | Notes |
|---|---|---|---|
| D1 | 2026-09-24 | **Pages rebuilt:** Stocks, ETFs, Managed Funds, Crypto, Cash, Side Income, Budget, Dividends, Other Assets, Super, Property, FIRE, plus the core (Net Worth, History, Settings). | Chosen by the owner per tab. |
| D2 | 2026-09-24 | **Not rebuilt:** Capital Gains, LiabilitiesDebts, Welcome, First Time Setup, Migrate Data. | Holdings pages still show realised/unrealised gains with FIFO parcels. The FY CGT tax estimate and the auto "future CGT" liability are dropped. A one-off xlsx importer replaces Migrate. |
| D3 | 2026-09-24 | **Deployment:** the app is hosted on the owner's Umbrel NAS as a Docker container. PCs and phone use a browser over Tailscale/LAN. | Data (SQLite + backups) lives on the NAS. Addresses are in `docs/private/ENVIRONMENT.md`. |
| D4 | 2026-09-24 (rev.) | **Branding:** the Joinr **"joinr." wordmark** (source B) plus a teal **FINANCE** label; **no** ABN / company footer. | This replaces the earlier typed "JOINR FINANCE" idea. Confirm at the Stage 0 demo. |
| D5 | 2026-09-24 | **Template bugs: fix them.** | Each stage brief lists its fixes; the owner can veto at kickoff. |
| D6 | 2026-09-24 | **Charts:** donut charts allowed; full categorical palette allowed. | Overrides style guide A p.6 and p.10. |
| D7 | 2026-09-24 | **Icons allowed.** | Overrides style guide A p.10. |
| D8 | 2026-09-24 | **Theme:** dark-mode Joinr document style guide (source A). | Distilled for the app in `docs/style/STYLE_GUIDE.md`. |
| D9 | 2026-09-24 | **Second style guide:** the Joinr brand banner (source B) governs brand moments: wordmark, header brand block, hero band on Net Worth, login/empty/loading screens. | Glows are allowed only there. Assets are in `reference/brand/`. |
| D10 | 2026-09-24 | **Git:** remote `origin` = `github.com/devcal1/joinr-fin`. **Minimise pushes:** commit locally at stage close (with OK); push only when the owner asks, batching several stages. **No GitHub Actions** triggered on push. | Stage 7 deploys by copying the build context to the NAS and building there, so deploys need no push. |
| D11 | 2026-09-24 | **The repo stays PUBLIC; private material is git-ignored.** | Git-ignored: `reference/` (except `reference/brand/`), `docs/private/`, data, DB files and xlsx-derived fixtures. Committed code must be generic: no tickers, amounts, account names or addresses in code, tests or seeds. A pre-commit privacy guard is added in Stage 0. |
| D12 | 2026-09-24 | **Wordmark:** hand-trace an SVG master of "joinr." from `reference/brand/joinr_wordmark.png`. | Stage 0 kickoff. Saved as `reference/brand/joinr_wordmark.svg`; the owner reviews it at the demo. The PNG stays as the fallback. |
| D13 | 2026-09-24 | **Brand block confirmed:** the wordmark with a teal **FINANCE** label in the header; a CSS recreation of the banner as the Net Worth hero and as the login/empty/loading background. | Stage 0 kickoff; confirms D4 and D9. |
| D14 | 2026-09-24 | **Stack confirmed** as in PLAN.md: TypeScript, pnpm workspaces, React + Vite + TanStack Router/Query/Table, Fastify, SQLite (better-sqlite3 + Drizzle), ECharts, lucide-react, Vitest, Playwright. | Stage 0 kickoff. |
| D15 | 2026-09-24 | **First commit:** OK to commit locally at Stage 0 close once the privacy guard passes. No push. | Stage 0 kickoff. |
| D16 | 2026-09-24 | **Wordmark full stop:** gradient `#6E78E2 → #E44FB5` (the banner's reading), top-left to bottom-right. | Stage 0 demo. The guide's calmer `#945CF3 → #C949EF` read as a flat purple dot at header size. Changed in the SVG master, `wordmarkGeometry.ts`, the favicon and STYLE_GUIDE §7.1. |
| D17 | 2026-09-24 | **Chart palette:** the validated, re-stepped categorical palette in STYLE_GUIDE §6.1 (chart teal `#07AE8B`, …). It is allowed inside chart marks, legend keys and tooltip keys only; the UI keeps the §1 brand colours. | Stage 0 demo. The raw brand hexes failed colour-blind separation (violet next to fuchsia ΔE 1.3); the validated set has a worst adjacent CVD ΔE of 16.0. |
| D18 | 2026-09-24 | **Hero height:** 140–200 px on desktop; below 1200 px the Net Worth hero grows to fit its stacked KPI tiles. | Stage 0 demo. Keeps the one-column phone rule (STYLE_GUIDE §3); §7.2 amended. |
| D19 | 2026-09-24 | **`--text-muted` lightened** from `#6F7080` to `#838494`. | Stage 0 demo. It now meets WCAG AA: 5.1:1 on ink, 4.7:1 on surface. The chart "Other" grey follows the token. |
| D20 | 2026-09-24 | **`--stop-tint` `#F87171`** for small red text: negatives, field errors, stop/failed badge text, "Do not" callout titles. | Stage 0 review fix, added to the §1 tints row. Borders, bars and chart marks keep `--stop`. |
| D21 | 2026-09-24 | **CLAUDE.md heading** is `# Joinr Finance (joinr-fin)`. | Stage 0 demo. It dropped the local folder name, which matched a private domain. The local folder keeps its name. |
