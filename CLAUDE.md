# Joinr Finance (joinr-fin)

A self-hosted personal-finance web app. It rebuilds a CompiledSanity Personal Wealth Template (AU) Google Sheet, styled to the Joinr brand in dark mode, and is deployed to an Umbrel NAS.

## Start here (especially after `/clear`)
1. `PLAN.md`: scope, architecture, stages, status table.
2. `docs/HANDOFF.md`: where the last session stopped and the exact next step.
3. `docs/STAGE_PROCESS.md`: how every stage runs (kickoff questions → Opus subagent workflow → demo → handoff → commit → `/clear`).
4. `docs/DECISIONS.md` and `docs/private/OPEN_QUESTIONS.md`.
5. `reference/specs/01..04_*.md`: the behavioural source of truth for every calculation (local only).
6. `docs/style/STYLE_GUIDE.md`: the visual rules for all UI work.

## Rules
- **This repo is PUBLIC.** Never commit owner data or contact details.
  - `reference/` (except `reference/brand/`), `docs/private/`, `data/`, DB files, xlsx files and xlsx-derived fixtures are git-ignored. Keep it that way.
  - Code, tests, seeds and committed docs must be generic: no tickers the owner holds, no amounts, account names, addresses, IPs, emails or Drive ids.
  - Golden tests read expected values from the local xlsx at runtime, and skip when it is absent.
- **Git:** commit locally at stage close, and only with the owner's OK. **Push only when the owner explicitly asks** (minimise pushes). No GitHub Actions triggered on push.
- **Subagents:** Opus 5.5 (`model: "opus"`). Implementers keep to the file ownership in `docs/stages/stage-N.md`. Tell every subagent the repo is public.
- **Style:** `docs/style/STYLE_GUIDE.md`. Source A (document guide, dark) governs components and data; source B (Joinr banner) governs brand moments. Owner overrides: icons OK, donuts and a full chart palette OK, Joinr wordmark, no ABN footer.
- **Formats:** money as integer cents; quantities and prices as decimal strings (decimal.js). Dates display as `dd/mm/yyyy`. The financial year runs 1 July – 30 June.
- **Environment:** Windows, Node 24, pnpm; no Docker, `gh` or Python. Read the xlsx with SheetJS (`xlsx`), not exceljs.
