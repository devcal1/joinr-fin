# Per-stage process

Every stage follows the same loop. The main Claude session is the **coordinator**. All heavy lifting is done by **Opus 5.5 subagents** (`model: "opus"`), orchestrated with the Workflow tool (planning → parallel implementation → review → fix → verify). The user has opted into this multi-agent orchestration.

## 1. Kickoff (fresh session, after `/clear`)
1. The user says: **"Start Stage N"**.
2. The coordinator reads `CLAUDE.md` → `PLAN.md` (stage N section) → `docs/HANDOFF.md` → `docs/DECISIONS.md` → stage N items in `docs/private/OPEN_QUESTIONS.md`.
3. The coordinator asks the user that stage's open questions (AskUserQuestion, at most 4 per round). It records the answers in `docs/DECISIONS.md` and marks them resolved in `docs/private/OPEN_QUESTIONS.md`.

## 2. Build (Workflow, all agents `model: "opus"`, ≤10 agents per workflow)

| Role | Count | Job |
|---|---|---|
| **Planner** | 1 | Turns the PLAN stage section, the relevant spec sections and the decisions into `docs/stages/stage-N.md`. That file holds tasks, **disjoint file ownership** per implementer, acceptance tests, the golden values to extract, and the bug fixes applied. |
| **Implementers** | 2–4, parallel | Each owns a disjoint area (e.g. engine / server API / UI pages / importer). Writes code and tests. Does not touch other implementers' files. |
| **Reviewers** | 2–3, parallel | (a) *Spec correctness*: behaviour vs `reference/specs`, golden tests, edge cases. (b) *Style-guide & UX*: screenshots at desktop and phone width vs the Joinr rules and the user overrides. (c) *Code quality/security* when the stage touches server, data or deploy. Reviewers report findings; they don't edit. |
| **Fixer** | 1 | Applies the verified findings. |
| **Verifier** | 1 | `pnpm typecheck && pnpm lint && pnpm test && pnpm build` plus Playwright smoke and screenshots. Reports pass or fail with evidence. |

Rules for agents:
- The specs in `reference/specs/` are the behavioural source of truth. `reference/dumps/` and the xlsx are the evidence.
- **The repo is PUBLIC.** Never copy owner data (amounts, the tickers the owner holds, account names, addresses, IPs, emails, Drive ids) into code, tests, seeds or committed docs. Golden tests read expected values from the local git-ignored xlsx at test time, or from a git-ignored fixtures file generated from it, and skip if it is absent.
- Stage plans in `docs/stages/` are committed, so keep them generic. Put owner-specific notes in `docs/private/`.
- Keep to the file ownership given in the stage plan.

## 3. Demo
The coordinator starts the app via `.claude/launch.json` (`preview_start`) and walks the user through the stage's demo script in the Browser pane. Feedback is either fixed immediately (small) or logged in `HANDOFF.md` for the next stage.

## 4. Close and prepare for `/clear`
1. Update `docs/HANDOFF.md`: what was built, how to run it, known issues, and exact next steps.
2. Update the status table in `PLAN.md`.
3. Update `docs/DECISIONS.md` with anything decided during the stage.
4. Commit the stage locally (**only with the owner's OK**) after the privacy guard passes. **Don't push** unless the owner asks; pushes are batched to save allowance.
5. Tell the user it's safe to `/clear`, then say "Start Stage N+1".
