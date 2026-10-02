# Joinr Finance — rebuild plan

This project rebuilds the owner's copy of the **CompiledSanity Personal Wealth Template v2.15.4 (AU edition)** Google Sheet as a self-hosted web app. The app runs on the owner's Umbrel NAS and is opened in a browser from any PC or phone over Tailscale or LAN. It is styled to the Joinr brand in dark mode.

> **This repo is public.** Anything owner-specific lives in git-ignored paths:
> - `reference/` holds the workbook, dumps, functional specs and the full style-guide PDF.
> - `docs/private/` holds the environment, open questions and data notes.
>
> Both exist only on the dev PC. See D11.

- Functional specs (the behavioural source of truth; local only): `reference/specs/01..04_*.md`
- Style: `docs/style/STYLE_GUIDE.md` · Decisions: `docs/DECISIONS.md` · Status: `docs/HANDOFF.md` · Process: `docs/STAGE_PROCESS.md`
- Private: `docs/private/ENVIRONMENT.md` · `docs/private/OPEN_QUESTIONS.md` · `docs/private/DATA_NOTES.md`

---

## Status

| Stage | Title | Status |
|---|---|---|
| — | Discovery: specs, feasibility, decisions | ✅ done 2026-09-24 |
| 0 | Foundations & design system | ✅ done 2026-09-24 |
| 1 | Data model, importer & market data | ✅ done 2026-09-24 |
| 2 | Investments: Stocks, ETFs, Managed Funds, Crypto | ✅ done 2026-09-25 |
| 3 | Cash flow & income: Cash, Side Income, Dividends, Budget | ✅ done 2026-09-26 |
| 4 | Other Assets, Super & Property | ✅ done 2026-09-26 |
| 5 | History, Net Worth dashboard & Settings | ✅ done 2026-09-27 |
| 6 | FIRE planner & polish | ✅ done 2026-09-27 |
| 7 | Umbrel deployment & cutover | ✅ done 2026-09-27/28 |
| 8 | Weekly backup copy to the NAS | ✅ done 2026-09-27/28 |
| 9 | Android app: holdings at a glance | 📝 planned (design D137, login D138) |

Every stage ends with a **demo**, a **handoff update**, a **local commit** (with the owner's OK) and a **`/clear`**. Pushes happen only when the owner asks (D10). See `docs/STAGE_PROCESS.md`.

---

## Scope

**Rebuilt (12 pages + core):** Net Worth (dashboard), History (snapshots), Settings (replaces SheetOptions + First Time Setup toggles), Stocks, ETFs, Managed Funds, Crypto, Cash, Side Income, Budget, Dividends, Other Assets, Super, Property, FIRE.

**Not rebuilt:**
- Capital Gains (the per-FY tax estimate) and LiabilitiesDebts.
- Welcome, First Time Setup and Migrate Data.
- WorkingSheet, which becomes server-side aggregation.
- The version check and the email/calendar reminders.

What that means:
- Holdings pages still show realised and unrealised gains per parcel, using FIFO with brokerage in the cost base (spec 03 §5.3).
- Net Worth liabilities = property mortgages + negative-balance cash accounts.

**Template bugs:** fixed (D5). Each stage brief lists its fixes so they can be vetoed at kickoff.

---

## Architecture (confirmed at Stage 0 kickoff, D14)

```
 Browser (any PC / phone, over Tailscale or LAN)
        │  via Umbrel app proxy (Umbrel login)
        ▼
 ┌──────────────── Docker container on Umbrel ────────────────┐
 │  Node 24 server (Fastify)                                   │
 │   ├─ REST/JSON API  ──►  engine (pure TS calc functions)     │
 │   ├─ SQLite (better-sqlite3 + Drizzle)  ◄─ DATA_DIR volume   │
 │   ├─ price service (Yahoo Finance, CoinGecko, FX) + cache    │
 │   ├─ scheduler: price refresh, month-end snapshot, backups   │
 │   └─ serves the built React SPA                              │
 └─────────────────────────────────────────────────────────────┘
 DATA_DIR → a folder on the NAS storage share: finance.db, backups/, exports/
```

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript end to end | One language across engine, server and UI; shared types. |
| Repo | pnpm workspaces: `apps/web`, `apps/server`, `packages/engine`, `packages/schema`, `packages/importer`, `packages/ui` | Disjoint folders let subagents work in parallel without collisions. |
| UI | React + Vite, TanStack Router + Query + Table | Mature, fast dev loop, strong tables for ledger-heavy pages. |
| Charts | Apache ECharts | Donut, area, bar, line and gauge in one lib; solid dark theming. |
| Icons | lucide-react | Owner override (D7). |
| Storage | SQLite file in `DATA_DIR` on the Umbrel (D111, D113), Drizzle migrations, verified nightly backups (D115); the JSON export is deferred (D121) | The server runs on the NAS, so there are no network-filesystem locking issues. Single file, easy to back up. |
| Money | Integer cents for amounts; decimal strings with decimal.js for quantities and prices | No float drift; crypto needs about 8 dp. |
| Market data | Provider interface: Yahoo Finance chart API (ASX `XXX.AX`, futures `SI=F`/`GC=F`, FX `AUDUSD=X`), CoinGecko for crypto (AUD). Per-instrument manual override. Cache with timestamps and staleness badges. | Replaces GOOGLEFINANCE, Apps Script `fetchPrice` and CoinMarketCap. Yahoo is unofficial, so the cache and override are mandatory. |
| Snapshots | Immutable `snapshots` table. The server auto-records on the configured day. Manual "record now", look-back and correction edits are also available. | Replaces the "record month" button; months are no longer missed. |
| Auth | Umbrel app proxy (Umbrel login) when deployed; none in local dev | Avoids building an auth system for personal data. |
| Tests | Vitest engine tests with **golden values** read at runtime from the local (git-ignored) xlsx, skipped when it is absent. Playwright smoke tests plus per-page screenshots. | The sheet is the oracle; no personal values get committed. |
| Privacy guard | A pre-commit hook blocks staged files under `reference/` or `docs/private/`, xlsx/db files, and patterns such as IP addresses, emails and Google Drive ids | The repo is public (D11). |
| Dev and demo | `pnpm dev` on the dev PC with a local `DATA_DIR`; demo in the Claude Browser pane via `.claude/launch.json` | The NAS isn't needed until Stage 7. |
| Deploy | Multi-stage Dockerfile + compose, installed as an Umbrel app. The **build context is copied to the NAS over SMB and built there**; no CI. | No Docker on the dev PC; minimises pushes and Actions usage (D10). |

### Style
See **`docs/style/STYLE_GUIDE.md`**. In short:
- **Source A**, the document style guide in dark mode, governs components and data. Ink/surface/raised neutrals, teal as the single working accent, Arial with letter-spaced uppercase, monospaced figures, the spectrum rule at top and bottom.
- **Source B**, the Joinr brand banner, governs brand moments. The "joinr." wordmark, a hero band recreated in CSS on the Net Worth page, and login/empty/loading screens.
- **Owner overrides:** icons OK; donuts and a full chart palette OK; Joinr wordmark instead of "TH CABINETS"; no ABN footer.

---

## Stages

Each stage lists its scope, acceptance criteria and demo. The stage Planner agent writes detailed task breakdowns at kickoff into `docs/stages/stage-N.md`, keeping them generic because they are committed.

### Stage 0 — Foundations & design system
**Scope**
- Setup:
  - pnpm workspace, TypeScript config, ESLint + Prettier, Vitest, Playwright.
  - `.claude/launch.json` for the dev server.
  - The **pre-commit privacy guard**.
- `packages/ui`:
  - Theme tokens (CSS variables) from STYLE_GUIDE §1–3.
  - AppShell: sidebar nav, running header with the brand block, footer, spectrum rules.
  - **Brand components**: Wordmark, HeroBand (CSS banner recreation), BrandScreen (login/empty/loading).
  - UI components: SectionBar, Card, Callout, KeyValueTable, ColumnTable, StatTile, StatusBadge, Pill, StepCard, form inputs.
  - ECharts wrappers (Donut/Bar/Line/Area/Gauge) with a palette validated via the `dataviz` skill.
- `apps/server` skeleton: Fastify, health endpoint, config (`DATA_DIR`, `PORT`), SQLite connection, migration runner; serves the SPA in production.
- `apps/web` skeleton: routes for every in-scope page (placeholders) plus a **/styleguide** gallery page.
- Dockerfile + compose file, written but not built (no local Docker).
- README and architecture notes.

**Acceptance**
- `pnpm dev` starts the server and the web app.
- `pnpm test`, `pnpm lint` and `pnpm typecheck` are green.
- The gallery renders every component at 1440 px and 375 px wide.
- The privacy guard blocks a test commit of a file in `docs/private/`.

**Demo:** the app shell with the brand block, the hero band, and the component gallery at desktop and phone width.

### Stage 1 — Data model, importer & market data
**Scope**
- `packages/schema`: Drizzle tables and Zod types for settings, cash accounts, instruments/holdings (stock/ETF/MF/crypto with targets and regions), trades, dividends, side income, budget items, other assets, super funds and contributions, properties and loans, snapshots, prices and spend notes.
- `packages/importer`: reads the local xlsx export (or a fresh Drive export at cutover) into the DB. It is idempotent and re-runnable, and produces a **reconciliation report** comparing row counts and totals against the sheet's cached values. The report is displayed only and never committed.
- Price service: Yahoo and CoinGecko providers, cache, manual overrides, scheduled refresh. It fixes the instruments whose prices failed in the sheet.
- Minimal "data browser" pages: read-only tables per entity, plus the reconciliation report page.

**Acceptance**
- The import reconciles with zero unexplained differences.
- Every held instrument gets a price, or is visibly flagged as stale or failed.

**Demo:** run the import, view the reconciliation report, browse the data, watch prices refresh.

### Stage 2 — Investments: Stocks, ETFs, Managed Funds, Crypto
**Scope**
- `packages/engine` holdings engine (spec 03 §1–4):
  - FIFO parcels and cost base including brokerage.
  - Unrealised and realised gains.
  - Per-holding XIRR.
  - Allocation vs target (sector and regional look-through).
  - "Next buy" timing.
  - MF fee estimate.
  - Crypto fee % and staking yield.
- Four pages with holdings tables, trade ledger CRUD, and charts:
  - Allocation donuts, current vs target.
  - Value history.
  - Gain history in $ and %.
  - Purchase history.
- Golden tests against the sheet.

**Acceptance**
- Engine outputs match the sheet's cached values (within rounding) for every holding.
- Adding, editing or deleting a trade updates the totals.

**Demo:** each investment page with live prices, then add and remove a test trade.

### Stage 3 — Cash flow & income: Cash, Side Income, Dividends, Budget
**Scope** (spec 02)
- **Cash:** accounts, with the offset flag.
- **Monthly savings engine:** savings, savings rate and residual spend per snapshot interval.
  - A one-off inflow adjustment fixes savings rates above 100%.
  - The 3-month trend is fixed.
- **Side income:** ledger with FY and 365-day averages.
- **Dividends:** linked to holdings by instrument id. Optional: suggest dividends from Yahoo. Franking is decided at kickoff.
- **Budget:** pay-cycle transfers, emergency fund and yearly-expense fund.

**Acceptance:** golden tests for the savings engine on the imported snapshots pass; the listed bug fixes are applied and documented.

**Demo:** cash and savings-rate history, the budget, dividends linked to holdings.

### Stage 4 — Other Assets, Super & Property
**Scope** (spec 04 §1–3)
- Other assets: manual valuations, with bullion priced from futures × FX (oz units and metal type).
- Super: funds and contributions, with gains derived as Δbalance − contributions. SG and caps are decided at kickoff.
- Property: value, equity, LVR, mortgage amortisation, actual repayments, and an optional offset.

**Acceptance:** golden tests pass; the mortgage "payments paid" fix is applied.

**Demo:** each page with its history charts.

### Stage 5 — History, Net Worth dashboard & Settings
**Scope** (spec 01)
- **Current snapshot:** composed live from all calculators.
- **Record month:** scheduled auto-record, plus manual, look-back and correction.
- **Snapshots page:** replaces the History tab. A monthly/quarterly/yearly aggregation API replaces WorkingSheet and `compressTable`.
- **Net Worth dashboard:**
  - Hero band with the KPIs.
  - Asset distribution donut.
  - Historical net worth bar chart.
  - Investments and cash-rate chart.
  - Rolling net worth table.
  - Savings-rate gauge.
- **Settings page:** replaces SheetOptions and the feature toggles.

**Acceptance**
- Recomputing the migrated snapshots reproduces the stored values.
- Recorded snapshots are immutable.
- The scheduled record works (simulated clock in tests).

**Demo:** the dashboard end to end, and recording a test month on a scratch DB.

### Stage 6 — FIRE planner & polish
**Scope** (spec 04 §5)
- **FIRE projection:** includes the super bridge.
  - The spend model is fixed.
  - Preservation age and super top-up are corrected.
  - Progression chart, which may use the node-line motif.
- **Polish pass:** phone-width audit, empty and error states, loading skeletons, keyboard access, and a number-format audit against STYLE_GUIDE §8.

**Acceptance:** the FIRE outputs are sane on real data; the tests include a hand-worked example.

**Demo:** FIRE scenarios; the app at phone width.

### Stage 7 — Umbrel deployment & cutover
**Scope**
- Copy the build context to the NAS and build the image there.
- Umbrel app packaging (`umbrel-app.yml` + compose) with app proxy auth and `DATA_DIR` bind-mounted to NAS storage.
- Nightly backups with retention, and a restore procedure.
- A fresh Drive export, then import and reconciliation.
- Go-live checklist and runbook.
- One batched push to GitHub, if the owner wants it.

**Acceptance**
- The app is reachable from two PCs and a phone.
- Data persists across container restarts.
- Restoring from a backup is tested.
- Reconciliation is clean.

**Demo:** open the app from another PC.

**Prerequisites:**
- Tailscale is healthy and the NAS is reachable from the dev PC.
- Umbrel version and SSH or Portainer access are known.
- The target storage path is chosen.

### Stage 8 — Weekly backup copy to the NAS
**Scope** (D126–D134)
- A weekly job (Sunday 03:00 server time) and a "Copy to NAS now" button copy every kept backup to an rsync-daemon module on the NAS. It only adds, and it proves each copy by listing it back.
- The two NAS files (address and password) are placed in the app data folder over SSH by a helper the owner runs; the copy is off until they are there.
- Copy status in Settings → Backups (never the address) with an every-page callout after 8 days without a copy (no heartbeat, D132), and a release (1.1.0) through the Stage 7 path.

**Acceptance**
- A copy reaches the NAS and is proved by listing it back; a second run sends nothing new.
- A NAS that is off, full or misconfigured never fails a backup; it shows as a copy problem.
- Nothing on the NAS is ever deleted or overwritten (a test pins the rsync flags).

**Demo:** "Copy to NAS now" on the Umbrel, the files listed on the NAS, and the status in Settings.

### Stage 9 — Android app: holdings at a glance
A read-only Android app that shows today's change in the owner's holdings (cash excluded) at a glance, plus home-screen widgets. It talks to the Umbrel over Tailscale. The approved design is **D: Console + cards** (D137); the mock-ups use made-up holdings and live on a private canvas (link in `docs/private/`).

**Scope — server** (a 1.2.0 release through the Stage 7 path)
- **Day change per holding:** store each instrument's previous close (Yahoo `regularMarketPreviousClose`; CoinGecko's 24-hour change for crypto), with a migration. Day $ = units × (price − previous close) in AUD, in integer cents.
- **Intraday series:** today's 5-minute prices per listed holding (Yahoo chart data) and the last 24 hours for crypto, fetched by the server and cached for the day. The portfolio's intraday line is built from them.
- **`GET /api/mobile/today`:** totals (day $, day %, value excluding cash), up/down counts, market status and price freshness, and per holding: symbol, name, class, price, change per unit, day $, day %, value, weight and its intraday series.
- **Phone pairing (D138):** Settings → Phone shows a QR code (server address plus a one-time pairing code, valid for minutes). The app exchanges it for a long-lived, read-only device key. Keys are stored hashed, listed with their last use, and revocable. Only `/api/mobile/*` skips the Umbrel login (`PROXY_AUTH_WHITELIST` in the store compose), and there the app checks the key; every other path keeps the Umbrel login.

**Scope — Android app** (`apps/android`, Kotlin, Jetpack Compose, Glance widgets)
- **Today screen:** the day figure, up/down count and value; the portfolio's intraday line; tabs **CARDS** (two-column cards with price, change, intraday line against a dashed previous-close line, day $ and weight), **LIST** (the dense table with a total row) and **MOVERS** (contribution bars either side of zero); sort by day $, day % or value.
- **Holding detail** (tap a card): a larger intraday chart and the position figures.
- **Widgets:** Today (day total plus the six largest holdings as mini cards), a single holding, and best/worst. They refresh in the background with WorkManager and show their age.
- **App lock (D139):** a fingerprint or device PIN to open the app; widgets show dollar figures.
- **States:** "Can't reach the Umbrel — is Tailscale on?", stale prices with their age, a revoked key (re-pair), and an empty portfolio.
- The Joinr dark style in native form: the colour tokens, monospaced tabular figures, gain/loss shown with a sign and arrow as well as colour, and no wordmark rebuilt in another font.
- A signed release APK, sideloaded. The signing keystore stays outside the repo.

**Acceptance**
- The app's day figures match the web app's holdings for the same prices, and cash is never counted.
- Pairing works by QR; a revoked key stops the app and widgets at the next refresh; with the key, the mobile path is read-only (every write is refused).
- Every other path still needs the Umbrel login.
- Widgets update in the background and show how old their figures are.
- No owner data in the repo; the APK keystore and pairing details are git-ignored.

**Demo:** on the owner's phone over Tailscale: pair by QR, the Today tabs, a holding's detail, the three widgets, and revoking the phone in Settings.
