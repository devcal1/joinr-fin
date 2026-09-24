# Stage 0 — Foundations & design system: build plan

_Planner output, 2026-09-24. Inputs: PLAN.md (Architecture, Stage 0), docs/style/STYLE_GUIDE.md, docs/DECISIONS.md (D12–D15), CLAUDE.md._

> **This repo is PUBLIC.** Nothing from `reference/` (except `reference/brand/`) or `docs/private/` may be copied into any other file: no amounts, tickers or instruments the owner holds, account or business names, addresses, IPs, emails, phone numbers, Drive ids. Demo, gallery and test data use only obviously generic values: labels like "Example Co", "ABC", "XYZ", "Asset class A", and the STYLE_GUIDE example figures (`$12,480.00`, `−$1,234.00`, `7.4%`, `18/08/2026`, `Aug 2026`) or round numbers.

**Flow:** Scaffolder (alone, must pass its checks) → 4 Implementers in parallel (ui-core, brand, charts, server-infra) → Reviewers (style-ux, code-quality) → Fixer → Verifier. **Nobody commits.** The coordinator commits at stage close (D15).

**Golden values:** none in Stage 0 (no calculations). **Template bug fixes:** none in Stage 0 (§10).

---

## 1. Workspace layout

```
/                          root configs, scripts, e2e/, Dockerfile, compose, README
├─ apps/
│  ├─ web/                 @joinr/web     React 19 + Vite 8 SPA (TanStack Router code-based routes + Query)
│  └─ server/              @joinr/server  Fastify 5 API + SQLite (better-sqlite3 + Drizzle); serves the SPA in prod
├─ packages/
│  ├─ ui/                  @joinr/ui      tokens, CSS, components, brand, charts (src/core | src/brand | src/charts)
│  ├─ engine/              @joinr/engine  stub (Stage 2)
│  ├─ schema/              @joinr/schema  stub (Stage 1)
│  └─ importer/            @joinr/importer stub (Stage 1)
├─ tools/
│  └─ privacy-guard/       @joinr/privacy-guard  pre-commit guard (TS, node built-ins only)
├─ .githooks/pre-commit    runs the guard on staged content
├─ e2e/                    Playwright specs (smoke + one per UI owner)
└─ artifacts/              git-ignored scratch: screenshots, Playwright output, agent DATA_DIRs
```

- **pnpm workspaces:** `apps/*`, `packages/*`, `tools/*`. Package names `@joinr/<name>`, all `"private": true`, `"type": "module"`.
- **Internal packages are TypeScript source.** `exports` point at `./src/index.ts` (and `@joinr/ui` also exports `./styles.css`). There is no build step for libraries: Vite, Vitest, tsx and esbuild all compile the source directly.
- **Module resolution** is `Bundler` everywhere, so imports are extensionless.
- **Server dev:** `tsx watch src/index.ts`. It also watches imported workspace sources.
- **Production build:**
  - web: `vite build` → `apps/web/dist/`.
  - server: **esbuild bundle** (`apps/server/scripts/build.mjs`) → `apps/server/dist/server.js` (ESM, `platform: node`, `target: node24`, sourcemap).
    - `@joinr/*` workspace code is bundled in.
    - Every third-party package in `apps/server/package.json` `dependencies` is `external`: the script reads the package.json and excludes `workspace:` entries. Verified: better-sqlite3 loads from the bundle.
- **How the prod server finds things.** Paths are resolved relative to the server's own file (`src/` in dev and `dist/` in prod are both one level below `apps/server/`):

  | Thing | Env override | Default |
  |---|---|---|
  | Migrations | `MIGRATIONS_DIR` | `<server>/../migrations` → `apps/server/migrations` |
  | Built SPA | `WEB_DIST_DIR` | `<server>/../../web/dist` → `apps/web/dist` |

  - The Dockerfile sets `WEB_DIST_DIR=/app/web`.
  - In production, if the SPA folder has no `index.html`, the server fails fast with a clear message.

### Routes (apps/web): code-based, one per in-scope page (STYLE_GUIDE §4 groups)

| Group | Page | Path | Delivered in |
|---|---|---|---|
| Overview | Net Worth | `/` | Stage 5 (Stage 0 shows the hero band, owned by brand) |
| Overview | History | `/history` | 5 |
| Investments | Stocks · ETFs · Managed Funds · Crypto | `/stocks` `/etfs` `/managed-funds` `/crypto` | 2 |
| Cash flow | Cash · Side Income · Dividends · Budget | `/cash` `/side-income` `/dividends` `/budget` | 3 |
| Assets | Other Assets · Super · Property | `/other-assets` `/super` `/property` | 4 |
| Planning | FIRE | `/fire` | 6 |
| Settings | Settings | `/settings` | 5 |
| — (sidebar footer link) | Style guide | `/styleguide` | 0 |
| — (no shell, full viewport) | Brand screen preview | `/preview/screen/$variant` (`loading`/`empty`/`error`/`login`) | 0 |
| — (no shell) | Not found | any unmatched path | 0 |

Route tree:
- `rootRoute`, from `createRootRouteWithContext<{ queryClient: QueryClient }>()`, renders `<Outlet/>`, with `notFoundComponent: NotFoundPage`.
  - Pathless layout route `id: 'app'`, component `RootLayout`, holding every page above plus `/styleguide`.
  - `/preview/screen/$variant`, a direct child of root.
- `createRouter({ routeTree, context: { queryClient }, notFoundMode: 'root', defaultErrorComponent: ErrorPage, defaultPreload: 'intent', scrollRestoration: true })`.
- Register the router type through `declare module '@tanstack/react-router' { interface Register { router: typeof router } }`.

---

## 2. Dependencies (checked with `pnpm view` on 2026-09-24; scratch-installed together, no peer issues)

| Package | Range | Where | Notes |
|---|---|---|---|
| react, react-dom | `^19.3.0` | web deps; ui **peerDeps + devDeps** | peer in ui to avoid two Reacts; web also sets `resolve.dedupe` |
| @types/react, @types/react-dom | `^19.3.0` | web, ui dev | |
| vite | `^8.3.0` | web dev | Rolldown-based; build verified |
| @vitejs/plugin-react | `^6.1.1` | web dev | peer `vite ^8` |
| @tanstack/react-router | `^1.170.39` | web | code-based routes; no router plugin |
| @tanstack/react-query | `^5.103.2` | web | |
| @tanstack/react-table | **`^8.21.3`** | ui | **v8, not v9.** v9.0.0 shipped 2026-08-04 with a reworked API. It is wrapped behind our own `ColumnTable` API so a later upgrade touches one file. |
| echarts | `^6.1.0` | ui | tree-shaken `echarts/core` imports only |
| lucide-react | `^1.47.0` | ui, web | icon names verified (see §7) |
| decimal.js | `^10.6.0` | ui | quantities and prices formatting |
| fastify | `^5.12.5` | server | |
| @fastify/static | `^10.1.4` | server | SPA-fallback pattern verified |
| better-sqlite3 | `^13.0.3` | server | ships N-API prebuilds (win32-x64, linux-x64/arm64, glibc and musl); **must not be built** (see below) |
| @types/better-sqlite3 | `^9.6.0` | server dev | |
| drizzle-orm | `^0.45.3` | server | `drizzle-orm/better-sqlite3` + `/migrator` present |
| drizzle-kit | `^0.31.11` | server dev | `db:generate` only |
| zod | `^4.6.5` | server | config validation |
| esbuild | `^0.28.2` | server dev | server bundle |
| typescript | **`~6.0.3`** | root dev | **Not 7.x.** typescript-eslint 8.70 peer is `typescript >=4.8.4 <6.1.0`. |
| tsx | `^4.23.15` | root dev | server dev, privacy-guard CLI |
| @types/node | **`^24.13.6`** | root dev | matches Node 24, not the 26.x latest |
| vitest | `^5.0.1` | root dev | `test.projects` verified |
| jsdom | `^30.1.1` | root dev | resolved from root by Vitest (verified) |
| @testing-library/react | `^16.3.3` | ui, web dev | |
| @testing-library/dom | `^10.4.2` | ui, web dev | required peer |
| @testing-library/jest-dom | `^7.0.1` | ui, web dev | `import '@testing-library/jest-dom/vitest'` |
| @testing-library/user-event | `^14.6.7` | ui, web dev | |
| @playwright/test | `^1.63.0` | root dev | system Chrome; **never** `playwright install` |
| eslint | `^10.11.0` | root dev | flat config |
| @eslint/js | `^10.0.1` | root dev | |
| typescript-eslint | `^8.70.1` | root dev | |
| eslint-plugin-react-hooks | `^7.1.1` | root dev | `configs.flat['recommended-latest']` |
| eslint-plugin-react-refresh | `^0.5.7` | root dev | `configs.vite`, apps/web only |
| eslint-config-prettier | `^10.1.8` | root dev | |
| globals | `^17.12.0` | root dev | |
| prettier | `^3.9.9` | root dev | |
| concurrently | `^10.0.5` | root dev | `pnpm dev` |
| cross-env | `^10.1.0` | root dev | `pnpm start` (`NODE_ENV=production` on Windows) |

engine / schema / importer / privacy-guard have **no dependencies** in Stage 0.

### pnpm 11 build-script approval (verified with pnpm 11.23.0)
- pnpm 11 **fails the install** (`ERR_PNPM_IGNORED_BUILDS`) when a dependency with a build script is neither allowed nor denied.
- The setting is the **`allowBuilds` map in `pnpm-workspace.yaml`**. It is not `onlyBuiltDependencies`, and not the `pnpm` field in package.json.
- **better-sqlite3 must be `false`.**
  - It has no install script, but it ships `binding.gyp`, so allowing it runs `node-gyp rebuild`. That fails because there is no C++ toolchain on the dev PC or in the slim image.
  - Denying it installs cleanly, and the bundled prebuild loads (checked: SQLite 3.53 on Node 24.20).
- `esbuild` (a direct server devDep, and also pulled in by tsx and drizzle-kit) is the only other package that needs a decision. The full scratch install of every dependency above raised no other approval prompt.

Exact file:
```yaml
packages:
  - apps/*
  - packages/*
  - tools/*
allowBuilds:
  better-sqlite3: false   # ships N-API prebuilds; true would run node-gyp (no toolchain)
  esbuild: true
```
- pnpm 11 also applies a **minimum release age**. On install it may append a `minimumReleaseAgeExclude:` list to this file (it did for `@tanstack/react-router@1.170.39` and `prettier@3.9.9`). **Keep whatever pnpm writes.**
- Never run interactive `pnpm approve-builds`.
- Root package.json also has:
  - `"packageManager": "pnpm@11.23.0"`
  - `"engines": { "node": ">=24 <25" }`
  - `"version": "0.1.0"`, which is the app version shown in the footer and in health.

---

## 3. Scripts (cmd.exe-safe: no inline `VAR=x`, no `rm -rf`; `&&` is fine)

**Root `package.json`:**
```json
{
  "prepare": "node tools/privacy-guard/scripts/install-hook.mjs",
  "dev": "concurrently -k -n server,web -c green,cyan \"pnpm --filter @joinr/server dev\" \"pnpm --filter @joinr/web dev\"",
  "build": "pnpm --filter @joinr/web build && pnpm --filter @joinr/server build",
  "start": "cross-env NODE_ENV=production node apps/server/dist/server.js",
  "test": "vitest run",
  "test:watch": "vitest",
  "e2e": "playwright test",
  "lint": "eslint . --max-warnings=0",
  "typecheck": "tsc -p tsconfig.json && pnpm -r typecheck",
  "format": "prettier --write .",
  "format:check": "prettier --check .",
  "guard": "tsx tools/privacy-guard/src/cli.ts --staged",
  "guard:all": "tsx tools/privacy-guard/src/cli.ts --all",
  "check": "pnpm typecheck && pnpm lint && pnpm test"
}
```

**Per-package scripts:**

| Package | Scripts |
|---|---|
| web | `dev: vite` · `build: vite build` · `preview: vite preview` · `typecheck: tsc -p tsconfig.json` |
| server | `dev: tsx watch --clear-screen=false src/index.ts` · `build: node scripts/build.mjs` · `typecheck: tsc -p tsconfig.json` · `db:generate: drizzle-kit generate` |
| ui, engine, schema, importer, privacy-guard | `typecheck: tsc -p tsconfig.json` |

Tests always run from the root (Vitest projects). **Vitest project names:** `web`, `server`, `ui`, `engine`, `schema`, `importer`, `privacy-guard`.

---

## 4. Ports & environment

| Var | Read by | Default | Notes |
|---|---|---|---|
| `PORT` | server listen · Vite proxy target · Playwright | `3001` | the server fails on EADDRINUSE (strict by nature) |
| `HOST` | server | `127.0.0.1` | Docker sets `0.0.0.0` |
| `WEB_PORT` | Vite dev/preview (`strictPort: true`) · Playwright `baseURL` | `5173` | Vite host stays at the default (`localhost`) |
| `API_TARGET` | Vite `/api` proxy | `http://127.0.0.1:${PORT}` | full override when needed |
| `DATA_DIR` | server | `data` | Relative values resolve against the **repo root** (found by walking up to `pnpm-workspace.yaml`; if there is none, `process.cwd()`). Default = `<repo>/data` (git-ignored). The DB file is `finance.db`. |
| `NODE_ENV` | server | `development` | `production` turns on SPA serving |
| `LOG_LEVEL` | server | `info` | pino levels + `silent` (tests) |
| `WEB_DIST_DIR`, `MIGRATIONS_DIR`, `SERVE_WEB` | server | see §1; `SERVE_WEB` defaults to `NODE_ENV === 'production'` | |
| `PW_CHANNEL` | Playwright | `chrome` | `msedge` as the fallback; `chromium` = no channel (only if the cached build matches) |

`vite.config.ts` essentials (Scaffolder):
```ts
const webPort = Number(process.env.WEB_PORT ?? 5173);
const apiTarget = process.env.API_TARGET ?? `http://127.0.0.1:${process.env.PORT ?? '3001'}`;
// server: { port: webPort, strictPort: true, proxy: { '/api': { target: apiTarget, changeOrigin: true } } }
// preview: { port: webPort, strictPort: true }
// resolve: { dedupe: ['react', 'react-dom'] }
// define: { __APP_VERSION__: JSON.stringify(<root package.json version>) }
```

**Port assignments (always set via env; always strict):**

| Agent | WEB_PORT | PORT | DATA_DIR |
|---|---|---|---|
| default / owner / `.claude/launch.json` | 5173 | 3001 | `data` |
| Scaffolder checks | 5170 | 3070 | `artifacts/scaffolder/data` |
| ui-core | 5181 | 3181 | `artifacts/ui-core/data` |
| brand | 5182 | 3182 | `artifacts/brand/data` |
| charts | 5183 | 3183 | `artifacts/charts/data` |
| server-infra | 5184 | 3104 | `artifacts/server-infra/data` (tests use OS temp dirs) |
| Reviewer style-ux | 5191 | 3191 | `artifacts/review-style/data` |
| Reviewer code-quality | 5192 | 3192 | `artifacts/review-code/data` |
| Fixer | 5194 | 3194 | `artifacts/fixer/data` |
| Verifier | 5195 | 3195 | `artifacts/verifier/data` |

- The UI owners' server ports (318x) and server-infra's web port (5184) are added here so that every `pnpm dev` pair is disjoint.
- Git Bash: `PORT=3181 WEB_PORT=5181 DATA_DIR=artifacts/ui-core/data pnpm dev`.
- PowerShell: `$env:PORT='3181'; $env:WEB_PORT='5181'; $env:DATA_DIR='artifacts/ui-core/data'; pnpm dev`.

`.claude/launch.json` (Scaffolder):
```json
{ "version": "0.0.1", "configurations": [ { "name": "joinr-dev", "runtimeExecutable": "pnpm", "runtimeArgs": ["dev"], "port": 5173 } ] }
```

---

## 5. Styling approach

- **Plain CSS + CSS custom properties.** No Tailwind, no CSS-in-JS, no CSS Modules. Classes are global and **prefixed**, BEM-style (`block__element--modifier`):

  | Owner | Class prefix |
  |---|---|
  | ui-core | `jf-<component>` (e.g. `jf-card`, `jf-section-bar`, `jf-table`, `jf-field`, `jf-shell`) |
  | brand | `jf-brand-*` only |
  | charts | `jf-chart-*` only |
  | apps/web gallery chrome | `jf-app-*` (Scaffolder) |

  - An owner never styles another owner's classes.
  - Element selectors are allowed only in `core/base.css`.
- **One stylesheet entry.** `@joinr/ui/styles.css` → `packages/ui/src/styles.css` (Scaffolder, frozen):
  ```css
  @layer base, core, brand, charts;
  @import './core/core.css';     /* ui-core: imports tokens.css + base.css + component CSS */
  @import './brand/brand.css';   /* brand */
  @import './charts/charts.css'; /* charts */
  ```
  - Each owner wraps its rules in its layer: `@layer base { … }` / `@layer core { … }` / `@layer brand { … }` / `@layer charts { … }`.
  - `apps/web/src/main.tsx` imports `@joinr/ui/styles.css` and then `./app.css`.
  - **Components never import CSS.**
- **Tokens:** the STYLE_GUIDE §1 names exactly (`--ink`, `--surface`, `--raised`, `--hairline`, `--text-bright`, `--text`, `--text-secondary`, `--text-muted`, `--teal`, `--violet`, `--fuchsia`, `--orange`, `--go`, `--stop`, `--pill-na`, `--teal-tint`, `--violet-tint`, `--orange-tint`, `--go-tint`, `--spectrum`), plus:
  - spacing `--space-1:4px --space-2:8px --space-3:12px --space-4:16px --space-6:24px --space-9:36px`
  - radii `--radius-card:6px --radius-bar:5px --radius-pill:999px`
  - fonts `--font-sans`, `--font-mono`
  - the type scale from §2 (`--fs-h1:31px` … `--fs-small:11px`)

  The same values are mirrored in `core/tokens.ts` for ECharts, and a unit test asserts that CSS and TS agree.
- **Breakpoints** (literal media queries; documented in `tokens.css`):
  - phone `≤ 767.98px` (1 column, 16 px gutters)
  - tablet `768–1199.98px` (6 columns)
  - desktop `≥ 1200px` (12 columns, 12 px gutters)
  - the sidebar becomes a drawer below `1024px`
- **No shadows or glows** except inside `jf-brand-*` brand treatments (STYLE_GUIDE §7.2).
- Respect `prefers-reduced-motion`.
- The 70ch body measure applies to prose.

---

## 6. Roles, tasks and file ownership

### 6.0 Ownership rules (all agents)
- Edit **only** files you own. Need a change elsewhere? Say so in your final report; the coordinator routes it.
- **Contracts in §7 are frozen.** Adding optional props to your own components is fine. Renaming, removing, or adding required props is not.
- **Imports inside `packages/ui`:**
  - `core` imports nothing from `brand` or `charts`.
  - `brand` and `charts` import from `core` **only via the barrel** (`../core`), never deep paths.
  - The web app imports only from `@joinr/ui`.
- **No installs.** Every dependency is in place after scaffolding. Do not edit any package.json `dependencies`/`devDependencies`, the lockfile or `pnpm-workspace.yaml`. If something is missing, stop and report.
- **Stubs** created by the Scaffolder become the named owner's files. The owner replaces them in place or deletes them.

### 6.1 Ownership table (every Stage 0 file has exactly one owner)

| Owner | Globs |
|---|---|
| **scaffolder** | `package.json` · `pnpm-workspace.yaml` · `pnpm-lock.yaml` · `.gitignore` · `.gitattributes` · `.editorconfig` · `.nvmrc` · `.prettierrc.json` · `.prettierignore` · `eslint.config.js` · `tsconfig.base.json` · `tsconfig.json` · `vitest.config.ts` · `playwright.config.ts` · `.claude/launch.json` · `e2e/smoke.spec.ts` · `e2e/support.ts` · `apps/web/{package.json,tsconfig.json,vite.config.ts,vitest.config.ts,index.html}` · `apps/web/test/**` · `apps/web/src/{main.tsx,router.tsx,pages.ts,pages.test.ts,router.test.tsx,app.css,vite-env.d.ts}` · `apps/web/src/pages/styleguide/{StyleguidePage.tsx,GalleryItem.tsx}` · `apps/server/{tsconfig.json,vitest.config.ts}` · `packages/ui/{package.json,tsconfig.json,vitest.config.ts}` · `packages/ui/test/**` · `packages/ui/src/{index.ts,styles.css,assets.d.ts}` · `packages/{engine,schema,importer}/**` · `tools/privacy-guard/{tsconfig.json,vitest.config.ts}` |
| **ui-core** | `packages/ui/src/core/**` · `apps/web/src/layout/**` · `apps/web/src/pages/PlaceholderPage{.tsx,.test.tsx}` · `apps/web/src/pages/styleguide/CoreSection.tsx` · `e2e/ui-core.spec.ts` |
| **brand** | `packages/ui/src/brand/**` · `reference/brand/joinr_wordmark.svg` · `apps/web/public/**` · `apps/web/src/pages/{NetWorthPage,NotFoundPage,ErrorPage,ScreenPreviewPage}{.tsx,.test.tsx}` · `apps/web/src/pages/styleguide/BrandSection.tsx` · `e2e/brand.spec.ts` |
| **charts** | `packages/ui/src/charts/**` · `apps/web/src/pages/styleguide/ChartsSection.tsx` · `e2e/charts.spec.ts` · **STYLE_GUIDE §6 only** (`docs/style/STYLE_GUIDE.md`, the "## 6. Charts" section) |
| **server-infra** | `apps/server/**` except its `tsconfig.json`/`vitest.config.ts` (incl. `package.json` **scripts/fields only, no deps**) · `tools/privacy-guard/**` except its `tsconfig.json`/`vitest.config.ts` (same package.json rule) · `.githooks/**` · `Dockerfile` · `.dockerignore` · `docker-compose.yml` · `README.md` · `docs/ARCHITECTURE.md` · `docs/private/guard-terms.txt` (git-ignored) |
| coordinator | `PLAN.md` · `docs/HANDOFF.md` · `docs/DECISIONS.md` · `docs/STAGE_PROCESS.md` · `docs/stages/**` · `CLAUDE.md` · the rest of `STYLE_GUIDE.md` |

### 6.2 Stubs (created by the Scaffolder, then handed over)

| Stub | Minimal content (must type-check against §7) | Handed to |
|---|---|---|
| `packages/ui/src/core/index.ts` | `export * from './stubs'` | ui-core |
| `packages/ui/src/core/stubs.tsx` | Contract-typed minimal versions of everything other owners use: `COLORS`, `SPECTRUM_GRADIENT`, `FONT_SANS`, `FONT_MONO`, the formatters (simple correct versions of `formatMoney`, `formatPercent`, `formatDate`, `formatMonth`), `PageHeader`, `SectionBar`, `Card`, `Grid`, `GridItem`, `StatTile`, `Button`, `Callout`, `ColumnTable` (plain `<table>`), `Icon`, `AppShell` (brand slot + nav list + `<main>`) and their prop types | ui-core (delete when replaced) |
| `packages/ui/src/core/core.css`, `tokens.css`, `base.css` | `tokens.css` complete from STYLE_GUIDE §1–3; `base.css` sets body ink background, text colour, font; `core.css` imports both | ui-core |
| `packages/ui/src/brand/index.ts` + `stubs.tsx` | `Wordmark` = `<img>` of the PNG (height prop, alt "joinr"); `BrandBlock` = Wordmark + "FINANCE" span; `HeroBand` = div with children; `BrandScreen` = centred title/message/actions | brand |
| `packages/ui/src/brand/assets/joinr-wordmark.png` | a copy of `reference/brand/joinr_wordmark.png` | brand |
| `packages/ui/src/brand/brand.css` | `@layer brand {}` | brand |
| `packages/ui/src/charts/index.ts`, `charts.css` | `export {}` / `@layer charts {}` | charts |
| `apps/web/src/layout/RootLayout.tsx`, `nav.ts` | stub AppShell + `<Outlet/>`; nav built from `PAGES` without icons | ui-core |
| `apps/web/src/pages/PlaceholderPage.tsx` | `PageHeader` + "Arrives in Stage N — <title>." | ui-core |
| `apps/web/src/pages/NetWorthPage.tsx` | `PageHeader` "Net worth" | brand |
| `apps/web/src/pages/NotFoundPage.tsx` | heading **"Page not found"** + link **"Back to Net Worth"** (`/`) | brand |
| `apps/web/src/pages/ErrorPage.tsx`, `ScreenPreviewPage.tsx` | heading "Something went wrong" / BrandScreen stub for `$variant` (unknown variant → `notFound()`) | brand |
| `apps/web/public/favicon.svg` | a teal circle | brand |
| `apps/web/src/pages/styleguide/{Core,Brand,Charts}Section.tsx` | `<section id="core\|brand\|charts">` + a heading | ui-core / brand / charts |
| `apps/server/package.json`, `apps/server/src/index.ts` | package.json per §2/§3 (`"files": ["dist","migrations"]`); index = Fastify on `HOST`/`PORT` with `GET /api/health` → `{ status: 'ok' }` | server-infra |
| `tools/privacy-guard/package.json`, `scripts/install-hook.mjs` | `install-hook.mjs` is **real**: if `.git` exists and `git` runs, it executes `git config core.hooksPath .githooks`; otherwise it no-ops silently (Docker has no `.git`). It never throws. | server-infra |
| `tools/privacy-guard/src/cli.ts` | prints "privacy guard not implemented yet" and exits 0 | server-infra |

### 6.3 Scaffolder: tasks and done-check
1. Root configs:
   - **`.gitignore` additions:** `artifacts/`, `*.tsbuildinfo`, `*.sqlite*`, `*.xls`, `*.xlsm`, `.claude/settings.local.json`. Keep every existing line, including the broad `data/`, so **never name a source folder `data`**.
   - `.gitattributes`: `* text=auto eol=lf` plus `*.png *.webp *.ico *.jpg binary`.
   - `.editorconfig`, and `.nvmrc` = `24`.
   - `.prettierrc.json`: `{ "singleQuote": true, "printWidth": 100, "trailingComma": "all", "endOfLine": "lf" }`.
   - `.prettierignore`: `pnpm-lock.yaml`, `**/dist`, `artifacts`, `data`, `reference`, `docs/private`, `apps/server/migrations/meta`, `**/*.md`.
2. **`tsconfig.base.json`** (verified with TS 6.0.3):
   ```json
   { "compilerOptions": { "target": "ES2023", "lib": ["ES2023"], "module": "ESNext", "moduleResolution": "Bundler",
     "moduleDetection": "force", "strict": true, "noUncheckedIndexedAccess": true, "noImplicitOverride": true,
     "noFallthroughCasesInSwitch": true, "verbatimModuleSyntax": true, "isolatedModules": true,
     "resolveJsonModule": true, "skipLibCheck": true, "noEmit": true, "jsx": "react-jsx", "types": [] } }
   ```
   Per-package tsconfigs extend it:
   - web: `lib + DOM, DOM.Iterable`, `types: ["vite/client","node"]`.
   - ui: `lib + DOM`, `types: []`, plus `src/assets.d.ts` declaring `*.png`/`*.svg`.
   - server, engine, schema, importer, privacy-guard: `types: ["node"]`.
   - Each includes `src`, `test` and `vitest.config.ts`. Web adds `vite.config.ts`; server adds `scripts` and `drizzle.config.ts`.
   - **Root `tsconfig.json`** includes `*.ts` and `e2e/**/*.ts` with `types: ["node"]` and `lib + DOM`. typescript-eslint's project service needs every linted TS file to be in some tsconfig.
3. **`eslint.config.js`** (verified shape):
   - `defineConfig` + `globalIgnores([node_modules, dist, artifacts, data, reference, docs/private, coverage, playwright-report, test-results, apps/server/migrations])`.
   - `js.configs.recommended`.
   - `tseslint.configs.recommendedTypeChecked` with `parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname }`, and `disableTypeChecked` for `**/*.{js,mjs,cjs}`.
   - For `packages/ui/**` and `apps/web/**`: `reactHooks.configs.flat['recommended-latest']` plus browser globals.
   - For `apps/web/src/**` only: `reactRefresh.configs.vite`.
   - Node globals elsewhere; `eslint-config-prettier` last.
   - Rule tweaks: `@typescript-eslint/require-await: off` (Fastify handlers); `@typescript-eslint/no-unused-vars` with `argsIgnorePattern: '^_'`.
4. **`vitest.config.ts`:** `defineConfig({ test: { projects: ['apps/*', 'packages/*', 'tools/*'] } })`. Each project uses `defineProject` with `test.name`:
   - web and ui: `environment: 'jsdom'`, setup file `test/setup.ts`. The setup file does these things: `import '@testing-library/jest-dom/vitest'`, `afterEach(cleanup)`, and stubs for `ResizeObserver`, `matchMedia` and `HTMLCanvasElement.getContext` (returns null).
   - Others use `environment: 'node'`.
5. **`playwright.config.ts`:**
   - `testDir: 'e2e'`.
   - `use: { baseURL: http://localhost:${WEB_PORT}, channel: PW_CHANNEL==='chromium' ? undefined : (PW_CHANNEL ?? 'chrome'), trace: 'retain-on-failure' }`.
   - Projects `desktop` `{ viewport: 1440×900 }` and `phone` `{ viewport: 375×812, isMobile: true, hasTouch: true }`.
   - `webServer: { command: 'pnpm dev', url: http://localhost:${WEB_PORT}/api/health, reuseExistingServer: true, timeout: 120_000, env: { PORT, WEB_PORT, DATA_DIR: process.env.DATA_DIR ?? 'artifacts/e2e/data' } }`.
   - `outputDir: 'artifacts/playwright/results'`; reporters `list` + `html` → `artifacts/playwright/report` (`open: 'never'`).
6. **`e2e/support.ts`:**
   - `expectNoHorizontalScroll(page)`: `documentElement.scrollWidth <= clientWidth`.
   - `shot(page, testInfo, role, name)`: full-page PNG to `artifacts/screenshots/<project>/<role>-<name>.png`.
   - `expectGalleryItems(page, names)`: each `[data-gallery-item="<name>"]` is attached and visible after `scrollIntoViewIfNeeded`.
   - `trackConsoleErrors(page)`.
7. **`e2e/smoke.spec.ts`** (both projects):
   - `/api/health` through the web origin returns 200 with `status: 'ok'`.
   - Every shell page in the §1 route table (the 15 pages plus `/styleguide`) renders with a `main` landmark and no console errors.
   - `/styleguide` has no horizontal scroll.
   - An unknown path shows "Page not found".
   - Screenshots of `/` and `/styleguide`.
8. **apps/web skeleton:**
   - `index.html` (`lang="en-AU"`, `theme-color #101019`, favicon link) and `vite.config.ts` (§4).
   - `main.tsx`: styles, `QueryClient` (`staleTime: 30_000`, `retry: 1`), `RouterProvider`.
   - `router.tsx` (§1).
   - **`pages.ts`**: `PageDef { id, path, title, group, stage }`, `PAGES`, `NAV_GROUPS` (order + labels per §4), `STYLEGUIDE_PAGE`, `STAGE_TITLES` (from PLAN.md), `pageForPath(pathname)`.
   - `pages.test.ts` (15 pages, unique paths, group order) and `router.test.tsx` (memory history: `/` renders, an unknown path shows "Page not found").
   - `vite-env.d.ts` (`declare const __APP_VERSION__: string`).
   - **`StyleguidePage.tsx`**: `PageHeader` "Style guide", in-page links Core · Brand · Charts, then `<CoreSection/><BrandSection/><ChartsSection/>`.
   - **`GalleryItem.tsx`**: `{ name: string; note?: string; children: ReactNode }` → `<figure className="jf-app-gallery-item" data-gallery-item={name}>` with an 11 px uppercase caption. `min-width: 0`; it must never hide overflow.
   - `app.css` holds only `jf-app-*` rules.
9. The three empty packages: `src/index.ts` exports `export const packageName = '@joinr/<name>' as const;`, plus a passing `src/index.test.ts`.
10. All package.json files per §2/§3. Run **`pnpm install`**; expect no errors. Confirm that `git config --get core.hooksPath` prints `.githooks` (the prepare script did it).
11. **Done-check:**
   - `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` and `pnpm format:check` are all green.
   - `PORT=3070 WEB_PORT=5170 DATA_DIR=artifacts/scaffolder/data pnpm e2e e2e/smoke.spec.ts` passes on both projects.
   - Ports 5170 and 3070 are free afterwards.

### 6.4 ui-core: tasks
1. **Tokens and CSS:**
   - `tokens.css` (all §1–3 tokens, breakpoints documented) and `tokens.ts` (`COLORS`, `SPECTRUM_GRADIENT`, `FONT_SANS`, `FONT_MONO`, `BREAKPOINTS`). A test reads `tokens.css?raw` and asserts parity.
   - `base.css`:
     - body on `--ink`, 14.5/1.5 Arial, `--text`
     - links teal
     - `:focus-visible` 2 px teal ring
     - `.jf-num` (mono, tabular, right)
     - dark scrollbars
     - reduced motion
2. **AppShell** (§7):
   - A 4 px spectrum rule fixed at the top of the viewport. The running header is sticky below it, with the brand slot left, and the page name right (uppercase 0.16em) over the freshness line in `--text-secondary`. A hairline sits beneath.
   - The sidebar sits on `--ink` with the §4 groups. The active item is `--text-bright` with a 4 px teal left border and `aria-current="page"`. Icons are 20 px, stroke 1.75, `--text-secondary` (teal when active).
   - `secondaryNav` sits at the sidebar bottom in muted text.
   - The footer has a hairline above: "Joinr Finance v{version}" on the left, `footer.right` on the right, and the spectrum rule at the bottom edge. **No ABN line.**
   - Below 1024 px:
     - The sidebar becomes a drawer, opened by a menu button (lucide `Menu`) with `aria-label="Open navigation"` and `aria-expanded`.
     - Esc, a click outside or navigating closes it, and focus returns to the button.
   - Below 768 px the freshness line moves out of the header row, so the header never wraps into the page.
   - Include a "Skip to content" link and header/nav/main/footer landmarks.
   - `embedded` renders a contained demo: no fixed or sticky positioning, no 100vh.
3. **Components** (§7): SectionBar, Card, Callout, KeyValueTable, ColumnTable, StatTile, StatusBadge, Pill, StepCard, ImageFrame, PageHeader, Grid/GridItem, Icon, Button, and the form inputs (TextField, MoneyField, NumberField, DateField, Select, Checkbox, Switch). Visual rules come from STYLE_GUIDE §5 verbatim.
   - **ColumnTable:**
     - The header uses `--raised` with 11 px bold uppercase labels. Numeric cells are right-aligned, mono and tabular.
     - The total row is the only row with white bold text, and its `keyColumnId` cell is the only teal cell.
     - It scrolls horizontally inside its own container (`overflow-x: auto`), with the first column `position: sticky; left: 0` on a `--surface` background.
     - Sorting (click or Enter on a header) sets `aria-sort`.
   - **DateField:** a text input showing `dd/mm/yyyy`, validated on blur with `parseDate`. The lucide `Calendar` button calls `showPicker()` on a hidden `<input type="date">` (never rely on the native field's display format).
   - **MoneyField:** a `$` adornment. It shows raw text while focused and `formatMoney` without the `$` on blur. Invalid input shows the error "Enter an amount like 1,234.56".
4. **Formatters** (§7.4), with exhaustive unit tests. Cover negatives with U+2212, rounding, grouping, the FY boundaries (30 June vs 1 July), leap days, invalid input, and 8 dp crypto quantities.
5. **apps/web wiring:**
   - `layout/nav.ts` maps page ids to lucide icons:
     - Net Worth `LayoutDashboard` · History `History`
     - Stocks `ChartCandlestick` · ETFs `Layers` · Managed Funds `Briefcase` · Crypto `Bitcoin`
     - Cash `Wallet` · Side Income `HandCoins` · Dividends `Coins` · Budget `PiggyBank`
     - Other Assets `Gem` · Super `Umbrella` · Property `House`
     - FIRE `Flame` · Settings `Settings` · Style guide `Palette`
   - `layout/RootLayout.tsx` passes `<BrandBlock/>` as `brand`, sets `linkComponent` to a TanStack `Link` adapter (a cast on `to` is acceptable), and takes `activeHref`/`pageTitle` from `useRouterState` + `pageForPath`.
     - Freshness reads "No prices yet · No snapshots yet".
     - The footer right reads "Last snapshot — · Prices —".
     - The version comes from `__APP_VERSION__`.
   - `PlaceholderPage({ page })`: `PageHeader` (title, sub-line = group label), then a `Callout kind="note"`: "{Title} arrives in Stage {n} — {stage title}."
6. **CoreSection:** one `GalleryItem` per core export, showing its states: empty/error/disabled fields, all StatusBadge statuses, all three SectionBar roles and the ColumnTable with a total row. It also includes a "Formatters" item that shows the §8 examples. Generic data only.
7. **Tests and e2e:**
   - Unit tests per component (roles, aria, classes, total-row rules, sort).
   - `e2e/ui-core.spec.ts`:
     - At 1440 the sidebar is visible and the active item has `aria-current`.
     - At 375 the drawer opens and closes, there is no page horizontal scroll, and the ColumnTable container scrolls internally.
     - All core gallery items are present.
     - Screenshots.

### 6.5 brand: tasks
1. **SVG master (D12):**
   - Study `reference/brand/joinr_wordmark.png` (228×103) and the banner (use the Read tool).
   - Hand-trace "joinr." as filled paths in `#FFFFFF`. The full stop is a circle filled with a `linearGradient` `#945CF3 → #C949EF` (STYLE_GUIDE §7.1; widened to `#6E78E2 → #E44FB5` at the demo, D16).
   - The viewBox keeps the PNG's aspect ratio, trimmed to the glyph bounds.
   - **Path data:** absolute commands, numbers separated by spaces or commas, ≤ 2 dp. Never use compact `.5.5` sequences; they trip the guard's IPv4 rule.
   - Iterate with a scratch overlay page under `artifacts/brand/` (PNG and SVG at 4× plus a 50 % overlay).
   - Save the comparison screenshot as `artifacts/brand/wordmark-compare.png` for the owner demo.
   - Save the master to `reference/brand/joinr_wordmark.svg`. The PNG stays in `reference/brand/` as the fallback.
   - Delete the stub PNG copy in `packages/ui` once it is unused.
2. **Components** (§7):
   - `Wordmark`: the paths are inlined in TSX, `role="img"` + `<title>`, and gradient ids come from `useId`.
   - `BrandBlock`: FINANCE in `--teal`, 11 px bold uppercase, 0.16em, beside the wordmark. Minimum height 24 px, clear space 0.4 × height.
   - `HeroBackground`: the shared layers.
   - `HeroBand`.
   - `BrandScreen`: all four variants.
   - **Hero recreation** (§7.1; CSS only, no raster):
     - ground gradient `#13141D → #10111A → #0C0D16`, darker bottom-left
     - a faint dot grid masked to fade at the edges
     - a node line at ~39 % height in `#1E1F28` with faint vertical guides
     - four nodes at x 25 / 50 / 69 / 87.5 % (teal, violet, fuchsia, orange) with soft glows
     - a bottom radial glow peaking around `#291636`, centre-right, with a hint of orange at the far right
     - text never sits directly on the glow: children go on `--surface` cards
   - The loading variant has `role="status"`; its animation stops under `prefers-reduced-motion`.
3. **favicon.svg:** the violet→fuchsia dot on an ink rounded square.
4. **Pages:**
   - `NetWorthPage`: `PageHeader` "Net worth" / "Overview", then `HeroBand` with four StatTiles:
     - Net worth `$12,480` (the key figure)
     - Change `+$1,240` (up)
     - Savings rate `7.4%`
     - Last snapshot `Aug 2026`
     - Then a `Callout note`: "Sample figures. The live dashboard arrives in Stage 5."
   - `NotFoundPage`: BrandScreen error, "Page not found", with the link "Back to Net Worth".
   - `ErrorPage`: BrandScreen error with "Try again" (router invalidate/reset).
   - `ScreenPreviewPage` (full viewport).
5. **BrandSection:**
   - Wordmark at 24/32/48 px.
   - BrandBlock sm/md.
   - HeroBand with KPI tiles.
   - Each BrandScreen variant with `fullViewport={false}` in a 360 px-tall frame, and a link to `/preview/screen/<variant>`.
6. **Tests and e2e:**
   - Unit tests for the SVG accessible name, BrandBlock label, variant titles and roles, and hero layers present.
   - `e2e/brand.spec.ts`:
     - The header brand block is visible at both widths.
     - `/` shows the hero band with four tiles and no horizontal scroll at 375.
     - Each `/preview/screen/<variant>` fills the viewport.
     - The not-found page renders.
     - Screenshots (these are the demo's key frames).

### 6.6 charts: tasks
1. **Palette:**
   - Invoke the **`dataviz` skill**. Validate the §6 categorical order on `--surface` and `--ink` for contrast, adjacent distinguishability and colour-vision deficiency. Adjust **within the same families** only.
   - Record the final order and a one-line validator summary in **STYLE_GUIDE §6** (edit only that section).
   - Export it as `CHART_PALETTE`.
2. **ECharts wiring:**
   - `charts/echarts.ts` registers `PieChart`, `BarChart`, `LineChart`, `GaugeChart`, `GridComponent`, `TooltipComponent`, `LegendComponent`, `AriaComponent` and `SVGRenderer` via `echarts/core` `use([...])`. Never `import 'echarts'`.
   - Theme `joinr` built from `COLORS`:
     - transparent background
     - Arial
     - axis lines and grid in `--hairline`
     - axis labels 11 px `--text-secondary`
     - tooltip on `--raised` with a hairline border
     - no shadows, no 3-D
3. **`EChart` base:**
   - Uses the SVG renderer.
   - Initialises in `useEffect` and calls `setOption(option, { notMerge: true })` on change.
   - Resizes via `ResizeObserver` (guarded when absent) and disposes on unmount.
   - Container `role="img"` + `aria-label`, with `aria.enabled`.
4. **Chart components:**
   - `DonutChart`: an outer ring for current and a thin inner ring for target, in the same palette order, with a centre label.
   - `BarChart`: plain, stacked, horizontal, plus `signColors` for gain/loss using `--go`/`--stop`.
   - `LineChart`, `AreaChart` (stacked optional) and `GaugeChart` (ratio; target marker; negative values clamp the arc but show the true figure).
   - Single-series charts use teal. Each component calls a **pure option builder** (exported, unit-tested).
5. **`ChartCard`:** a Card frame with a Chart | Table segmented toggle (two Buttons with `aria-pressed`). The table view renders the `table` prop. A chart never replaces the numbers.
6. **ChartsSection:** each chart in a ChartCard with a matching ColumnTable (from `../core` via `@joinr/ui`), a total row where it makes sense, and generic data (asset classes "Australian shares", "International shares", "Property", "Cash"; months `Jan 2026`…).
7. **Tests and e2e:**
   - Unit tests for the builders: palette order, formatter use, stacked flags, sign colours, gauge clamping, no `shadowBlur` anywhere.
   - One render test per component with ECharts mocked, or SVG with explicit width and height.
   - `e2e/charts.spec.ts`:
     - Every chart renders an `svg` at both widths.
     - The toggle shows the table.
     - No horizontal scroll.
     - Screenshots.

### 6.7 server-infra: tasks
1. **Config** (`src/config.ts`):
   - `loadConfig(env = process.env): Config` is pure, validated with zod per §4.
   - It lists every invalid variable in one error. `index.ts` prints the error and exits 1.
   - `src/paths.ts` resolves the repo root, migrations and web dist (§1).
2. **DB** (`src/db/`):
   - `openDatabase(dataDir)` runs `mkdir -p`, opens `finance.db` and sets pragmas `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`, `synchronous=NORMAL`. It returns `{ sqlite, db }` (Drizzle).
   - `runMigrations(db, dir)` uses `drizzle-orm/better-sqlite3/migrator`.
   - `schema.ts` defines `app_meta(key TEXT PK, value TEXT NOT NULL, updated_at TEXT NOT NULL)`.
   - `drizzle.config.ts`: `dialect: 'sqlite'`, `out: './migrations'`. Generate `0000_app_meta` with `pnpm --filter @joinr/server db:generate --name app_meta` and commit the SQL + `meta/`.
   - On start the server inserts `created_at` if absent and upserts `last_started_at`.
   - Stage 1 moves the schema into `packages/schema`.
3. **App** (`src/app.ts`, `buildApp({ config, db })`, no side effects at import):
   - `GET /api/health` → `200 { status: 'ok', version, uptimeSeconds, time, db: { ok, journalMode, migrations } }`, or `503 { status: 'degraded', … }` if the DB check fails.
   - Never expose paths or env values.
   - The JSON error shape is `{ error: { code, message } }` for the 404s on `/api/*` and for `setErrorHandler`. A 500 message is generic, with the detail logged.
   - `onSend` adds `X-Content-Type-Options: nosniff` and `Referrer-Policy: same-origin`.
4. **SPA serving** (when `SERVE_WEB`) — `@fastify/static` `{ root: WEB_DIST_DIR, wildcard: false }` plus `setNotFoundHandler`:
   - `/api` or `/api/*` → JSON 404.
   - A non-GET/HEAD request → JSON 404.
   - A path with a file extension → plain 404. This is **not** the SPA: a scratch test showed that without the rule, missing `/assets/x.js` returned index.html.
   - Anything else → `index.html` with `Cache-Control: no-cache`.
   - `/assets/*` → `Cache-Control: public, max-age=31536000, immutable`.
5. **`src/index.ts`:**
   - Sequence: load config → open DB → migrate → build → listen.
   - It logs `Joinr Finance listening on http://HOST:PORT`.
   - On `SIGINT`/`SIGTERM`/`SIGBREAK` it runs `app.close()`, which closes SQLite in `onClose`. A second signal or a 10 s timeout forces exit.
6. **`scripts/build.mjs`** (esbuild, §1). Define `__APP_VERSION__` from the root package.json; in dev, read it from the file.
7. **Tests** (inject; temp `DATA_DIR` via `fs.mkdtemp(os.tmpdir())`, removed after):
   - config defaults and errors, including relative `DATA_DIR` resolution
   - health
   - WAL and migrations applied (idempotent on a second run)
   - `/api/unknown` returns a JSON 404
   - SPA fallback against a temp dist (`/`, `/stocks`, `/assets/missing.js` → 404, `/api/x` → JSON)
   - close releases the DB file
8. **Docker** (written, not built; no Docker on the dev PC):
   - **`Dockerfile`** (multi-stage, `node:24-bookworm-slim`):
     - build stage:
       - `npm i -g pnpm@11.23.0` → `COPY . .` → `pnpm install --frozen-lockfile` → `pnpm build`
       - `pnpm --filter @joinr/server deploy --prod --legacy /out/app`
       - copy `apps/web/dist` → `/out/app/web`
     - runtime stage:
       - `ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 DATA_DIR=/data WEB_DIST_DIR=/app/web`
       - `/data` owned by `node`; `USER node`; `VOLUME /data`; `EXPOSE 3001`
       - `HEALTHCHECK` via `node -e "fetch(...)"` (slim has no curl)
       - `CMD ["node","dist/server.js"]`
   - **`.dockerignore`:** `.git`, `**/node_modules`, `**/dist`, `artifacts`, `data`, `reference`, `docs/private`, `.env*`, `*.xlsx`, `*.db*`, `*.sqlite*`, `coverage`, `playwright-report`, `test-results`, `.claude`.
   - **`docker-compose.yml`:** one service, `build: .`, `init: true`, `restart: unless-stopped`, port `${JOINR_PORT:-3001}:3001`, volume `${JOINR_DATA_PATH:-./data}:/data`, `TZ: ${TZ:-UTC}` (Stage 7 sets the real one).
9. **Privacy guard, hook and terms** (§8).
10. **Docs:**
    - **`README.md`**: purpose, the public-repo notice, prerequisites (Node 24, pnpm 11), setup, the scripts table, env/ports, layout, testing, Docker (built on the NAS in Stage 7), and the privacy guard.
    - **`docs/ARCHITECTURE.md`**: the package graph, request flow in dev (Vite proxy) vs prod (Fastify serves the SPA), DATA_DIR layout, migrations, the styling architecture (§5), the testing strategy, and the build outputs.
    - Both stay generic: no hosts, IPs or paths from `docs/private/`.

---

## 7. Component & helper API contracts (frozen; all exported from `@joinr/ui`)

```ts
import type { ReactNode, ComponentType, ButtonHTMLAttributes, JSX } from 'react'; // React 19: JSX comes from 'react'
import type { LucideIcon } from 'lucide-react';
import type { EChartsCoreOption } from 'echarts/core';
```

### 7.1 core: layout & shell
```ts
export type Span = 12 | 6 | 4 | 3 | 2;
export interface NavItem { id: string; label: string; href: string; icon?: LucideIcon }
export interface NavGroup { id: string; label: string; items: NavItem[] }
export interface AppLinkProps { href: string; className?: string; 'aria-current'?: 'page'; onClick?: () => void; children: ReactNode }
export interface AppShellProps {
  brand: ReactNode;                 // <BrandBlock/> (core never imports brand)
  nav: NavGroup[];
  secondaryNav?: NavItem[];         // sidebar bottom (Style guide)
  activeHref: string;
  pageTitle: string;
  freshness?: ReactNode;            // "Prices 14:32 · Snapshot Aug 2026"
  footer: { version: string; right?: ReactNode };
  linkComponent?: ComponentType<AppLinkProps>; // default <a>
  embedded?: boolean;               // gallery demo: no fixed/sticky/100vh
  children: ReactNode;
}
export function AppShell(p: AppShellProps): JSX.Element;
export interface PageHeaderProps { title: string; subtitle?: string; actions?: ReactNode }   // H1 31px + teal sub-line
export interface GridProps { children: ReactNode; className?: string }                       // 12 / 6 / 1 columns, 12px gutter
export interface GridItemProps { span?: Span; spanTablet?: 6 | 3 | 2; children: ReactNode }  // default span 12
export interface IconProps { icon: LucideIcon; size?: 16 | 20; label?: string; className?: string } // no label → aria-hidden
```

### 7.2 core: content components
```ts
export type SectionRole = 'primary' | 'supporting' | 'reference';        // orange | teal | violet
export interface SectionBarProps { title: string; role?: SectionRole; actions?: ReactNode; id?: string; level?: 2 | 3 } // default role 'primary', level 2
export interface CardProps { title?: string; subtitle?: string; actions?: ReactNode; children: ReactNode; as?: 'section' | 'div' | 'article'; padding?: 'none' | 'normal'; className?: string }
export type CalloutKind = 'note' | 'important' | 'do-not';                // teal | orange | red
export interface CalloutProps { kind: CalloutKind; title?: string; children: ReactNode } // default titles NOTE / IMPORTANT / DO NOT
export interface KeyValueItem { label: string; value: ReactNode; numeric?: boolean }
export interface KeyValueTableProps { items: KeyValueItem[]; caption?: string }
export interface ColumnTableColumn<Row> {
  id: string; header: string;
  value: (row: Row) => string | number | null;   // sort key + default render
  cell?: (row: Row) => ReactNode;
  numeric?: boolean; sortable?: boolean; minWidth?: number;
}
export interface ColumnTableTotal { label: string; cells: Record<string, ReactNode>; keyColumnId?: string } // keyColumnId → the one teal cell
export interface ColumnTableProps<Row> {
  columns: ColumnTableColumn<Row>[]; rows: readonly Row[]; getRowId: (row: Row) => string;
  caption: string; showCaption?: boolean; total?: ColumnTableTotal;
  stickyFirstColumn?: boolean;      // default true
  initialSort?: { columnId: string; desc?: boolean };
  emptyMessage?: ReactNode;         // default "Nothing here yet."
  density?: 'dense' | 'regular';    // default 'dense' (13px)
}
export function ColumnTable<Row>(p: ColumnTableProps<Row>): JSX.Element;
export interface StatTileProps {
  label: string; value: ReactNode; keyFigure?: boolean;   // teal figure; one per page
  delta?: { value: string; direction: 'up' | 'down' | 'flat'; text: string; tone?: 'go' | 'stop' | 'neutral' }; // arrow icon + sign + word
  hint?: string;
}
export type StatusKind = 'go' | 'check' | 'stop' | 'fresh' | 'stale' | 'failed' | 'recorded' | 'pending';
export interface StatusBadgeProps { status: StatusKind; label?: string } // go/fresh/recorded = green; check/stale/pending = orange; stop/failed = red; always icon + word
export interface PillProps { children: ReactNode; tone?: 'teal' | 'violet' | 'fuchsia' | 'na' }
export interface StepCardProps { step: number; title: string; subtitle?: string; children?: ReactNode }
export interface ImageFrameProps { src: string; alt: string; width?: 'full' | 'half'; caption?: string }
```

### 7.3 core: forms
```ts
export interface FieldBaseProps { label: string; id?: string; name?: string; hint?: string; error?: string; required?: boolean; disabled?: boolean; className?: string }
export interface TextFieldProps extends FieldBaseProps { value: string; onChange(v: string): void; type?: 'text' | 'search' | 'url'; placeholder?: string; autoComplete?: string; maxLength?: number }
export interface MoneyFieldProps extends FieldBaseProps { value: number | null; onChange(cents: number | null): void; allowNegative?: boolean; placeholder?: string }
export interface NumberFieldProps extends FieldBaseProps { value: string; onChange(v: string): void; maxDp?: number; allowNegative?: boolean; suffix?: string; placeholder?: string } // decimal string; '' = empty
export interface DateFieldProps extends FieldBaseProps { value: string | null; onChange(iso: string | null): void; min?: string; max?: string } // ISO 'YYYY-MM-DD'; shows dd/mm/yyyy
export interface SelectOption { value: string; label: string; disabled?: boolean }
export interface SelectProps extends FieldBaseProps { value: string; onChange(v: string): void; options: SelectOption[]; placeholder?: string }
export interface CheckboxProps { label: string; checked: boolean; onChange(c: boolean): void; id?: string; name?: string; hint?: string; disabled?: boolean }
export type SwitchProps = CheckboxProps;                                   // role="switch"
export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md';
  icon?: LucideIcon; iconPosition?: 'start' | 'end'; children?: ReactNode; // icon-only requires aria-label
}
```
Labels are uppercase and sit above the field. `error` sets `aria-invalid` and `aria-describedby`. Numeric inputs are mono and right-aligned. The primary button is a teal fill with `--ink` text, uppercase, 0.08em, and no shadow.

### 7.4 core: tokens & formatters (pure; no React)
```ts
export type ColorToken = 'ink' | 'surface' | 'raised' | 'hairline' | 'textBright' | 'text' | 'textSecondary' | 'textMuted'
  | 'teal' | 'violet' | 'fuchsia' | 'orange' | 'go' | 'stop' | 'pillNa' | 'tealTint' | 'violetTint' | 'orangeTint' | 'goTint';
export const COLORS: Readonly<Record<ColorToken, string>>; // hex values exactly as STYLE_GUIDE §1 (declared `as const`)
export const SPECTRUM_GRADIENT: string; export const FONT_SANS: string; export const FONT_MONO: string;
export const BREAKPOINTS: { readonly tablet: 768; readonly sidebar: 1024; readonly desktop: 1200 };
export type IsoDate = string;  // 'YYYY-MM-DD'
export type IsoMonth = string; // 'YYYY-MM'
export const MINUS = '−';
export function formatMoney(cents: number, o?: { wholeDollars?: boolean; signDisplay?: 'auto' | 'always' | 'never' }): string;
//   12480_00 → "$12,480.00" · -1234_00 → "−$1,234.00" · wholeDollars → "$12,480" (half away from zero) · 'always' → "+$12.00"
//   throws TypeError on non-integer / non-finite cents
export function formatPercent(ratio: number, o?: { dp?: number; signDisplay?: 'auto' | 'always' }): string; // 0.074 → "7.4%", -0.021 → "−2.1%"
export function formatQuantity(v: string | number, o?: { maxDp?: number; minDp?: number }): string;        // default maxDp 4 (crypto 8); trims zeros; grouped
export function formatPrice(v: string | number, o?: { minDp?: number; maxDp?: number }): string;          // default 2..4 → "$1.2345"
export function formatDate(v: IsoDate | Date): string;              // "18/08/2026"
export function formatDateLong(v: IsoDate | Date): string;          // "18 August 2026"
export function formatMonth(v: IsoMonth | IsoDate | Date): string;  // "Aug 2026"
export function formatTime(v: Date): string;                        // "14:32" (24 h)
export function financialYearOf(v: IsoDate | Date): number;         // start year: 2026-07-01 → 2026; 2026-06-30 → 2025
export function formatFinancialYear(startYear: number): string;     // 2026 → "FY2026–27" (U+2013)
export function financialYearBounds(startYear: number): { start: IsoDate; end: IsoDate }; // 2026-07-01 .. 2027-06-30
export function parseMoney(input: string): number | null;           // "$1,234.50" | "1234.5" | "-12" | "−12" → cents; >2 dp → null
export function parseDate(input: string): IsoDate | null;           // "18/08/2026" | "18/8/2026" → "2026-08-18"; invalid dates → null
export function parseDecimal(input: string, maxDp?: number): string | null; // normalised decimal string (decimal.js)
```
- An `IsoDate` string is parsed as a calendar date, never through `new Date(string)`. A `Date` uses local components.
- Grouping follows `en-AU`.
- Every negative number uses U+2212.

### 7.5 brand
```ts
export interface WordmarkProps { height?: number; title?: string; className?: string } // default 32, clamped ≥ 24; title default "joinr"
export interface BrandBlockProps { size?: 'sm' | 'md'; label?: string; className?: string } // sm = 24px, md = 32px wordmark; label default "FINANCE"
export interface HeroBackgroundProps { children?: ReactNode; className?: string }
export interface HeroBandProps { children?: ReactNode; height?: 'compact' | 'regular'; showWordmark?: boolean; ariaLabel?: string; className?: string } // min-height 140 | 180 px; grows on phone
export type BrandScreenVariant = 'loading' | 'empty' | 'error' | 'login';
export interface BrandScreenProps { variant: BrandScreenVariant; title?: string; message?: ReactNode; actions?: ReactNode; children?: ReactNode; fullViewport?: boolean } // default true (100dvh)
// default titles: Loading · Nothing here yet · Something went wrong · Sign in
```

### 7.6 charts
```ts
export const CHART_PALETTE: readonly string[];            // validated order (STYLE_GUIDE §6)
export const JOINR_CHART_THEME: Record<string, unknown>;  // registered as 'joinr'
export type ValueFormatter = (v: number) => string;       // callers convert cents → dollars and pass formatMoney-based formatters
export interface Datum { label: string; value: number }
export interface Series { name: string; data: (number | null)[]; color?: string }
export interface EChartProps { option: EChartsCoreOption; ariaLabel: string; height?: number; className?: string } // default height 280
export interface DonutChartProps { ariaLabel: string; data: Datum[]; target?: Datum[]; valueFormatter?: ValueFormatter; centerLabel?: string; centerValue?: string; height?: number }
export interface BarChartProps { ariaLabel: string; categories: string[]; series: Series[]; stacked?: boolean; horizontal?: boolean; signColors?: boolean; valueFormatter?: ValueFormatter; height?: number }
export interface LineChartProps { ariaLabel: string; categories: string[]; series: Series[]; valueFormatter?: ValueFormatter; height?: number }
export interface AreaChartProps extends LineChartProps { stacked?: boolean }
export interface GaugeChartProps { ariaLabel: string; value: number; target?: number; label?: string; valueFormatter?: ValueFormatter; height?: number } // ratio; default formatter formatPercent
export interface ChartCardProps { title: string; subtitle?: string; chart: ReactNode; table: ReactNode; defaultView?: 'chart' | 'table'; actions?: ReactNode }
export function EChart(p: EChartProps): JSX.Element;  // + DonutChart, BarChart, LineChart, AreaChart, GaugeChart, ChartCard
export function donutOption(p: DonutChartProps): EChartsCoreOption; // + barOption, lineOption, areaOption, gaugeOption (pure)
```

### 7.7 apps/web internal
```ts
// apps/web/src/pages.ts (Scaffolder)
export type NavGroupId = 'overview' | 'investments' | 'cashflow' | 'assets' | 'planning' | 'settings';
export interface PageDef { id: string; path: string; title: string; group: NavGroupId; stage: number }
export const NAV_GROUPS: readonly { id: NavGroupId; label: string }[];
export const PAGES: readonly PageDef[]; export const STYLEGUIDE_PAGE: { id: 'styleguide'; path: '/styleguide'; title: 'Style guide' };
export const STAGE_TITLES: Record<number, string>; export function pageForPath(pathname: string): PageDef | undefined;
// PlaceholderPage (ui-core): (p: { page: PageDef }) => JSX.Element
// GalleryItem (Scaffolder): (p: { name: string; note?: string; children: ReactNode }) => JSX.Element
```

**Gallery inventory** (the `data-gallery-item` names that the e2e specs assert):
- **core:** AppShell, PageHeader, SectionBar, Card, Grid, Callout, KeyValueTable, ColumnTable, StatTile, StatusBadge, Pill, StepCard, ImageFrame, Icon, Button, TextField, MoneyField, NumberField, DateField, Select, Checkbox, Switch, Formatters
- **brand:** Wordmark, BrandBlock, HeroBand, BrandScreen/loading, BrandScreen/empty, BrandScreen/error, BrandScreen/login
- **charts:** DonutChart, BarChart, BarChart/stacked, BarChart/gain-loss, LineChart, AreaChart, GaugeChart, ChartCard

ImageFrame uses an inline SVG data URI; no new binaries.

---

## 8. Privacy guard spec (server-infra)

**Location:** `tools/privacy-guard/`, with TS source and node built-ins only. The files are:

| File | Contents |
|---|---|
| `src/rules.ts` | path and content matchers, pure |
| `src/allowlist.ts` | the allowed values below |
| `src/git.ts` | reads from git |
| `src/scan.ts` | runs the scan |
| `src/cli.ts` | the entry point |
| `scripts/install-hook.mjs` | sets the hooks path |

**Hook:** `.githooks/pre-commit` has LF endings (`.gitattributes`), and **fails closed**:
```sh
#!/bin/sh
# Joinr Finance privacy guard: this repo is PUBLIC.
ROOT="$(git rev-parse --show-toplevel)" || exit 1
TSX="$ROOT/node_modules/tsx/dist/cli.mjs"
if [ ! -f "$TSX" ]; then echo "privacy-guard: run 'pnpm install' first (commit blocked)" >&2; exit 1; fi
exec node "$TSX" "$ROOT/tools/privacy-guard/src/cli.ts" --staged
```
The coordinator stages it with `git add --chmod=+x .githooks/pre-commit`. `prepare` wires `core.hooksPath` (§6.2).

**Modes:**

| Mode | Scans |
|---|---|
| `--staged` | `git diff --cached --name-only -z --diff-filter=ACMRT`. Content is read **from the index** through a single `git cat-file --batch` process (`:<path>`). |
| `--all` | `git ls-files -z --cached --others --exclude-standard`. Working-tree content is used; tracked files that match blocked paths are still flagged. |

**Path rules** (case-insensitive; `/`-normalised). **Block:**
- `reference/**` except `reference/brand/**`
- `docs/private/**`
- any path segment `data` (mirrors `.gitignore`)
- `**/fixtures/private/**`
- `*.xlsx`, `*.xlsm`, `*.xls`
- `*.db`, `*.db-*`, `*.sqlite`, `*.sqlite3`, `*.sqlite-*`
- `.env` and `.env.*` at any depth

**Content rules.** Skipped for binary files (a NUL byte in the first 8 KB, or an image/font extension), for `pnpm-lock.yaml`, and for files over 2 MB. Paths are still checked for all of these.

| Rule | Match | Allowed (documented in `allowlist.ts`) |
|---|---|---|
| `ipv4` | four dotted octets 0–255 with word boundaries | `0.0.0.0`, `127.0.0.0/8`, `255.255.255.255`, `255.255.255.0`, RFC 5737 `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24` |
| `email` | `<local>@<domain>.<tld>` addresses | `*@example.com/.org/.net`, `*.example`, `noreply@anthropic.com`, `*@users.noreply.github.com`, `git@github.com` |
| `google-drive` | Full URLs only (scheme + host + path): `https?://(drive\|docs\|sheets\|script)\.google\.com/…` and `https?://…googleusercontent\.com/…`. Also Drive-style ids in context: `/d/<id>`, `/folders/<id>`, `[?&]id=<id>`, where `<id>` is `[A-Za-z0-9_-]{20,}`. A bare host name in prose is not a finding. The guard's own sources write these patterns regex-escaped, so they don't match themselves. | — |
| `au-phone` | `04dd ddd ddd`, `+61 4dd ddd ddd`, `(0[2378]) dddd dddd`, `0[2378] dddd dddd` (optional spaces) | `0400 000 000` |
| `abn` | `dd ddd ddd ddd` (spaced ABN format) | `00 000 000 000` |
| `private-term` | each line of the git-ignored **`docs/private/guard-terms.txt`** (if present; `#` comments and blank lines ignored). The match is **exact and case-sensitive** with custom word boundaries `(?<![A-Za-z0-9_])term(?![A-Za-z0-9_])`, and the term is regex-escaped. | — |

**Output and exit codes:**
- Each finding prints one line, `file:line:col  rule  masked`.
  - The mask is the first two characters, `…`, then `(N chars)`.
  - A private term prints only `private-term #<line-no>` and never its text.
- A summary follows, with the hint "Unstage with: git restore --staged <file>".
- Exit `0` = clean, `1` = findings, `2` = internal error. The hook blocks on anything other than 0.

**Tests** (Vitest project `privacy-guard`):
- **Matcher unit tests:** every rule's positive and negative cases, the allowlist, masking, binary skipping, the lockfile skip, and path case-insensitivity.
  - Values that should be blocked are **assembled at runtime** (e.g. `['10','1','2','3'].join('.')`), so that no test source contains a real-looking secret.
  - Safe literals use only RFC 5737 IPs and example.com.
- **Integration (real hook, temp repo):**
  1. `mkdtemp` → `git init` → local `user.name`/`user.email` (an example.com address).
  2. Copy `.githooks/` and `tools/privacy-guard/` in, and link `node_modules` to the repo's (`fs.symlink(..., 'junction')` on Windows).
  3. `git config core.hooksPath .githooks`.
  4. `git add -f docs/private/notes.md` + `git commit` must **fail**, with the rule in stderr.
  5. After a reset, a clean `README.md` commit must **succeed**.
  6. Also test `--all` on a tracked `.env`.

**`docs/private/guard-terms.txt`** (server-infra, git-ignored, never echoed):
- **Sources:** `docs/private/*`, `reference/specs/*`, `reference/dumps/*`, and the business-record section of `reference/joinr_style_guide.txt`.
- **Terms to extract:** the owner's name, account and institution names, the tickers and instrument codes the owner holds, addresses, host names, emails, Drive ids, business identifiers and phone numbers.
- **Exclude:**
  - generic finance words and codes (e.g. `ETF`, `AUD`, `ASX`)
  - anything already public in committed owner-authored docs (`PLAN.md`, `DECISIONS.md`, `STYLE_GUIDE.md`, `CLAUDE.md`, e.g. the Joinr brand names)
- The guard's own sources, its tests and this plan must also pass `guard:all`. Write patterns regex-escaped in code, and build blocked sample values at runtime in tests.
- **Tune until `pnpm guard:all` reports zero findings.**
  - Fix a committed file only when it really leaks.
  - Drop a term only when it is too generic to be private, and record why in a `#` comment in the same private file.

---

## 9. Acceptance tests

| PLAN Stage 0 acceptance | Proven by | Owner |
|---|---|---|
| `pnpm dev` starts the server and the web app | `e2e/smoke.spec.ts` (`webServer: pnpm dev`): `/api/health` via the Vite proxy returns 200; `/` renders the shell | Scaffolder, run by the Verifier on 5195/3195 |
| `pnpm test`, `pnpm lint` and `pnpm typecheck` are green | the three commands, plus `pnpm format:check` and `pnpm build` | all |
| The gallery renders every component at 1440 and 375 px | `e2e/{ui-core,brand,charts}.spec.ts` assert every §7 inventory item on both projects; smoke asserts no horizontal page scroll on `/styleguide` and `/`; screenshots under `artifacts/screenshots/{desktop,phone}/` | ui-core, brand, charts |
| The privacy guard blocks a test commit of a file in `docs/private/` | The integration test in `tools/privacy-guard` (a real hook in a temp repo). The Verifier also does a staged-only check in the real repo: it creates a dummy `docs/private/guard-check.md` containing the word "test", runs `git add -f` on it and then `pnpm guard` (expects exit 1). It then **immediately** runs `git restore --staged` and deletes the dummy. It never stages real private files and never commits. | server-infra |
| Extra: the prod build serves the SPA | server static tests, plus the Verifier running `pnpm build` then `PORT=3195 pnpm start`: `/`, `/stocks` → HTML; `/api/health` → 200; `/api/nope` → JSON 404 | server-infra |
| Extra: the repo is clean for its first commit | `pnpm guard:all` exits 0 | server-infra |
| Extra: style rules | the style-ux reviewer checks screenshots against STYLE_GUIDE §10: one accent, letter-spaced uppercase, mono right-aligned numbers, no glows outside brand, 375 px with no page scroll, status readable in greyscale | reviewers |

**Demo frames** for the owner:
- `/` (the shell and hero band) at 1440 and 375, with the drawer open
- `/styleguide` sections
- `/preview/screen/loading`
- `artifacts/brand/wordmark-compare.png`

---

## 10. Template bug fixes applied
**None in Stage 0.** No calculations are built, and no golden values are extracted.

---

## 11. Risks & fallbacks

| Risk | Status / fallback |
|---|---|
| better-sqlite3 native binary on Node 24 / Windows | **Verified OK:** v13.0.3 bundles N-API prebuilds and loads on Node 24.20, provided `allowBuilds: better-sqlite3: false`. If a later version drops prebuilds, fall back to `node:sqlite` behind a thin `src/db/driver.ts` adapter. Drizzle support there is not guaranteed, so **flag it to the coordinator; do not switch silently.** |
| pnpm 11 build approvals | `allowBuilds` (§2); an ignored build is a hard error. Never use interactive `approve-builds`. Keep the `minimumReleaseAgeExclude` entries pnpm writes. |
| TypeScript 7 | typescript-eslint caps TS at `<6.1`, so it is pinned to `~6.0.3`. Revisit when typescript-eslint supports 7. |
| TanStack Table v9 | Too new, so v8.21.3 is used behind the `ColumnTable` API. |
| ECharts in jsdom (no layout/canvas) | Test the pure option builders; component tests mock ECharts or use SVG with explicit size; the setup stubs `ResizeObserver`/`matchMedia`/`getContext`. The real rendering is proven in the Playwright specs. |
| Implementers needing a package | Everything is installed by the Scaffolder. **Stop and report**; never `pnpm add` (it causes lockfile collisions between parallel agents). |
| Parallel agents running the same test suite | Scope your runs: `pnpm vitest run --project ui packages/ui/src/brand`, `pnpm exec eslint packages/ui/src/charts --max-warnings=0`, `pnpm --filter @joinr/ui typecheck`. Keep your files compiling at every step; the stubs keep cross-imports resolvable. |
| Windows orphan processes / busy ports | Start dev servers in the background on **your** ports only, and stop them when done. PowerShell: `Get-NetTCPConnection -LocalPort 5181,3181 -State Listen -EA SilentlyContinue \| % { Stop-Process -Id $_.OwningProcess -Force }`. Bash: `netstat -ano \| grep -E ':(5181\|3181) .*LISTENING'` then `taskkill //PID <pid> //T //F`. Confirm the ports are free before finishing. |
| Playwright Chrome channel mismatch | `PW_CHANNEL=msedge`; last resort `PW_CHANNEL=chromium` (the cached build). Never download browsers. |
| Guard false positives (SVG path data, version strings) | Path-data style rule (§6.5), the allowlist, and tuning to `guard:all` = 0. Tests assemble "secrets" at runtime. |
| Hook line endings / exec bit | `.gitattributes` `eol=lf`; the coordinator stages it with `--chmod=+x`. |
| Docker file unverified (no local Docker) | Written against the verified local build. `pnpm deploy --legacy`, the prebuild selection on Linux and the healthcheck are checked in Stage 7 on the NAS. |
| Vite chunk-size warning (ECharts) | Acceptable in Stage 0 (a warning, not a failure). Route-level code splitting comes in the Stage 6 polish. |

---

## 12. Every agent: final report checklist
- Files created or changed (all inside your ownership).
- Commands run, with pass/fail: typecheck, lint, tests for your scope, your e2e spec on your ports.
- Screenshot paths under `artifacts/screenshots/`.
- STYLE_GUIDE §10 self-check (UI roles).
- Any contract gaps or cross-owner requests. Do not work around them by editing others' files.
- Confirmation that your ports are free and no background processes remain.
- Nothing was committed, pushed or added to `docs/`/`reference/` outside your ownership, and no owner data appears in any tracked file.

---

## Scaffold notes

_Scaffolder, 2026-09-24. Append-only. Read this before you start: it records where the skeleton differs from, or adds to, the plan above._

**Status:** the skeleton is green. `pnpm typecheck`, `pnpm lint`, `pnpm test` (6 files, 18 tests), `pnpm build` and `pnpm format:check` all pass. `pnpm dev` on 5170/3070 serves the web root, and `/api/health` returns `{"status":"ok"}` through the Vite proxy. `e2e/smoke.spec.ts` passes 40/40 (desktop + phone) with system Chrome. Ports are free afterwards and no node processes are left over; Playwright's `webServer` teardown is clean on Windows.

**Environment checks**
- **better-sqlite3 13.0.3 loads** from `apps/server` on Node 24.20 (SQLite 3.53.4, in-memory DB OK) with `allowBuilds: better-sqlite3: false`. No fallback was needed.
- `pnpm install` added `minimumReleaseAgeExclude` entries for `@tanstack/react-router@1.170.39` and `prettier@3.9.9` to `pnpm-workspace.yaml`. They are kept, and the file passes Prettier as pnpm writes it.
- `esbuild: true` also covers the old `esbuild@0.18.20` pulled in by drizzle-kit (via `@esbuild-kit/*`, which prints a harmless "deprecated subdependencies" warning).
- pnpm 11 checks the lockfile before `pnpm <script>` runs, and re-runs `prepare`. This is harmless and quick.
- `git config --get core.hooksPath` prints `.githooks`. `.githooks/pre-commit` does not exist yet (server-infra).

**Deviations and additions (all implementers)**
1. **Hex case in CSS.** Prettier 3.9 lowercases hex colours in CSS, so `tokens.css` holds `#191a24` while `COLORS` in TS keeps the STYLE_GUIDE case (`#191A24`). **ui-core: the CSS↔TS parity test must compare case-insensitively.**
2. **Router factory.** `router.tsx` exports `createAppRouter({ queryClient, history? })` and `type AppRouter` instead of a module-level `router`, so tests can pass a memory history. `main.tsx` creates the instance. `Register` uses `AppRouter`. The root route's component is `Outlet`.
3. **Screen preview contract (brand).** The router validates `$variant` in `beforeLoad` (unknown → `throw notFound()`) and passes it in as a prop: `ScreenPreviewPage({ variant }: { variant: BrandScreenVariant })`. Keep that signature. `pages.ts` also exports `SCREEN_VARIANTS`, `ScreenVariant` and `isScreenVariant`, a dependency-free copy of the union. If brand ever adds a variant, tell the coordinator.
4. **ErrorPage** is the router's `defaultErrorComponent` and receives TanStack `ErrorComponentProps` (`{ error, reset, info }`). **NotFoundPage** takes no props.
5. **ESLint.**
   - `@typescript-eslint/only-throw-error` allows TanStack's `NotFoundError` and `Redirect` in TS files, so `throw notFound()` / `throw redirect()` lint clean.
   - One `react-refresh/only-export-components` line-disable in `router.tsx`, for its route adapter.
   - `IsoDate` and `IsoMonth` are both `string`, so writing `IsoMonth | IsoDate | Date` trips `no-duplicate-type-constituents`. The core stub writes `formatMonth(v: IsoMonth | Date)` with a doc comment; the type is the same. **ui-core: do likewise.**
6. **`app.css`** rules sit in `@layer app`. It is not in the frozen `@layer base, core, brand, charts;` statement, so it lands after `charts` in the cascade order.
7. **Web test setup** also stubs `window.scrollTo`: the router's scroll restoration calls it, and jsdom doesn't implement it. Both setup files stub `ResizeObserver`, `matchMedia` and `HTMLCanvasElement.getContext` (→ `null`), as planned.
8. **`apps/web/vitest.config.ts`** merges `vite.config.ts`, so the React plugin and the `__APP_VERSION__` define apply in tests. It imports `./vite.config.ts` with the extension (Vite 8 warns about extensionless config imports), so `apps/web/tsconfig.json` sets `allowImportingTsExtensions: true`. Source code stays extensionless.
9. **Extra stub: `apps/server/scripts/build.mjs`** (not in §6.2). `pnpm build` needs it. It is already the real esbuild bundle from §1 (externals read from package.json, `workspace:` entries bundled, `__APP_VERSION__` defined) and is **server-infra's** now.
10. **Extra scaffolder test: `packages/ui/test/environment.test.tsx`.** It checks the ui jsdom setup and the public barrel, and relies on these §7 behaviours. Owners' real implementations must keep them:
    - `PageHeader` renders an `h1`.
    - `BrandBlock` exposes an `img` named "joinr" and the text "FINANCE".
    - `COLORS.teal === '#17C8A0'`.
    - `formatMoney(1_248_000) === '$12,480.00'`.
11. **Smoke spec expectations.** `e2e/smoke.spec.ts` imports `PAGES` / `STYLEGUIDE_PAGE` from `apps/web/src/pages.ts`, and on every shell page asserts a `main` landmark plus an **`h1` matching the page title (case-insensitive)**. So:
    - `NetWorthPage` keeps an h1 "Net worth".
    - `PlaceholderPage` keeps an h1 with the page title.
    - The style guide keeps an h1 "Style guide".
    - The not-found page needs a heading "Page not found" and a link "Back to Net Worth".
12. **Stub landmarks.** The AppShell stub renders `<main id="main">`. The BrandScreen stub is a plain `div` with an `h1` title (`role="status"` for loading), so the not-found/error/preview screens have no `main` yet. That is brand's call.
13. **Extra tokens.** `tokens.css` defines `--fs-subline`, `--fs-h2`, `--fs-h3`, `--fs-body`, `--fs-dense`, `--fs-header` and `--fs-badge` in addition to `--fs-h1`/`--fs-small`. ui-core owns them and may rename.
14. `@joinr/ui` package.json also declares `"sideEffects": ["**/*.css"]`.
15. **Empty projects.** Vitest passes with the `server` and `privacy-guard` projects still empty.
16. **Dev start-up noise.** In dev, the Vite proxy logs `ECONNREFUSED` for a few seconds until the server has booted (about 4 s via tsx). Playwright waits for `/api/health` = 200, so tests are unaffected.

**Smoke screenshots:** `artifacts/screenshots/{desktop,phone}/smoke-{net-worth,styleguide}.png`.

## Stage close notes (coordinator)

**Outcome.** The Verifier passed all 8 acceptance checks:
- install, typecheck, lint, format:check, build;
- 670 unit tests;
- e2e: 84 passed, 8 skipped by design;
- dev proxy and prod serving (SPA deep links, JSON 404 under `/api`);
- 38/38 gallery items present at 1440 and 375 with no page-level horizontal scroll;
- the privacy guard blocks a force-added `docs/private` file;
- `guard:all` is clean.

The reviewers raised 34 findings. The Fixer applied 32; the rest were owner decisions, settled at the demo.

**Demo decisions (see `docs/DECISIONS.md`):**
- D16: wordmark dot `#6E78E2 → #E44FB5`.
- D17: validated chart palette.
- D18: hero grows below 1200 px.
- D19: `--text-muted` `#838494`.
- D20: `--stop-tint` `#F87171`.
- D21: CLAUDE.md heading.

**Superseded in this plan.** §8's skip rules (binary by extension, the 2 MB cap, the narrower `.db`/`.env` patterns) were hardened by the Fixer. The guard now:
- sniffs content (SQLite, OOXML/ODF and legacy Office files are blocked whatever their name);
- detects binary files by magic bytes;
- decodes UTF-16;
- reports text over 16 MB as `too-large` instead of skipping it;
- blocks `*.db.*`, `*.sqlite*.*` and `*.bak`;
- allows `.env.example`.

`README.md` describes the current behaviour.

**Known limits carried forward:**
- The Dockerfile has not been built yet; it is verified in Stage 7.
- The web bundle is about 1.07 MB (ECharts); route-level code splitting is planned for Stage 6.
- At 375 px the `/styleguide` page is taller than Chrome's 16,384 px capture limit, so phone screenshots are taken per section.
