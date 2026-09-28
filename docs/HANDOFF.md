# Handoff

_Last updated: end of Stage 8 (2026-09-27/28)._

## Where we are
**Stage 8 (weekly backup copy to the NAS) is done (D135).** Joinr Finance **1.1.0** runs on the owner's Umbrel with the owner's data, and copies every kept backup to the owner's NAS every Sunday at 03:00 Melbourne time. **The Umbrel is the source of truth (D125)**; the workbook is retired and the local `data/` is the pre-cutover archive.

- Stage 8: `docs/stages/stage-8.md` (see "Stage close notes"; the D132 banner at its top voids every heartbeat item). Decisions D126–D135. Private: `docs/private/stage-8-private.md` (smoke, release and demo records) and `docs/private/ENVIRONMENT.md` (the NAS target).
- Stage 7 (deployment and cutover) is below; its record is `docs/stages/stage-7.md`.

- The plan, its live outcome and the review log are in `docs/stages/stage-7.md` (see "Stage close notes").
- Decisions:
  - Kickoff: D111–D117.
  - Plan review: D118–D122.
  - Cutover and demo: D123–D125.
- Owner-specific facts are in `docs/private/stage-7-private.md` (smoke results, cutover figures, release record) and `docs/private/ENVIRONMENT.md` (the Umbrel, the NAS, SSH, stores, ports).
- The operator's runbook is **`docs/deploy/RUNBOOK.md`**: release, install, backups, restore, rollback, troubleshooting and the go-live checklist.

## What exists (new in Stage 8)
| Path | What it is |
|---|---|
| `apps/server/src/nascopy/**` | The weekly copy to an rsync-daemon module (D126): the `nas-url` check, the listing parser, the plan (missing names, newest first, one invocation), the runner (`shell: false`, the password only in `RSYNC_PASSWORD`, a kill grace), the copy (list, send, list again, sizes), the schedule (Sunday 03:00, a catch-up, retries at +1/+2/+4 h), the refusal lock, the status. It never throws and never fails a backup; add-only flags are pinned by a test. |
| `routes/backups.ts`, `routes/status.ts` | `nasCopy` in `GET /api/backups` and `/api/status`; `POST /api/backups/nas-copy` (202; 409 `NAS_COPY_NOT_READY` / `NAS_COPY_FIX_FIRST`). |
| `apps/web` Settings → Backups | The "Copy to the NAS" block and **Copy to NAS now**; an every-page callout when no copy has succeeded for 8 days, or the files are half-placed, unusable or locked. |
| `tools/deploy/nas-secrets.mjs` | `pnpm umbrel:nas-secrets` (`--prompt-test`, `--dry-run`, `--check`, `--remove`): places `nas-url` and `nas-password` over SSH stdin (folder 700, files 600, uid 1000). The owner runs it in a normal PowerShell window. |
| `tools/deploy/smoke.mjs nas` | A scratch rsync daemon on a private Docker network on the Umbrel: 16 probes. |
| `Dockerfile` | rsync installed in the runtime image. |
| `../tenon-umbrel-store` | `tenon-joinr-finance` 1.1.0 (`backupIgnore` for `data/secrets`). Pushed: `6459388`. |

## What exists (new in Stage 7)
| Path | What it is |
|---|---|
| `apps/server/src/backups/**`, `routes/backups.ts` | Verified backups (`VACUUM INTO` + `integrity_check`). Nightly at 02:30 server time (D115) keeps 14 daily plus 12 monthly copies. Other kinds: manual, pre-import (10), pre-restore, and pre-update (5, taken before a migrating start-up). There is a start-up catch-up, and the API offers list, "back up now" and download. |
| `apps/server/src/cli/restore.ts` | `node dist/cli/restore.js <backup> [--yes] [--force]`. It validates the copy, keeps a pre-restore copy, and refuses if the app is running, the database is newer, or the copy is damaged. Locally: `pnpm restore:backup`. |
| `apps/server/src/security.ts` | The cross-site write guard: `Sec-Fetch-Site`, then Origin vs Host / `X-Forwarded-Host` / `PUBLIC_PORT`. |
| `apps/web` Settings | The **Backups** section (list, back up now, download, schedule, retention) and the **About** block (version, database level, time zone, last restore). A stale-backup callout appears after 48 h. |
| `packages/schema` | `backups.ts`, `dto/backups.ts`, fixtures; job name `backup`; error codes `BACKUP_FAILED`, `CROSS_SITE_REQUEST`. |
| `Dockerfile`, `docker-compose.yml` | A pinned base digest, a TZ assertion, CLI checks and a build memory cap. |
| `tools/deploy/**` | `pnpm umbrel:{release,status,registry,restore,smoke}`. They run from the Windows PC over `ssh umbrel`, and every one has `--dry-run`. |
| `../tenon-umbrel-store` (sibling repo, public) | `tenon-joinr-registry` (loopback registry app, port 4930) and `tenon-joinr-finance` (port 4932, private network). Pushed: `0ca7bc3`, `052b3db`. |

## How to run
Everything from Stages 1–6 still applies (`pnpm dev`, `pnpm check`, `pnpm e2e`, `pnpm build`, `pnpm guard:all`, …). New:

- **Release a new version:**
  1. Bump `version` in `package.json`.
  2. Run `pnpm umbrel:release` (preview it with `--dry-run` first).
  3. Write `releaseNotes:` in the store clone.
  4. With the owner's OK, commit and push `tenon-umbrel-store`.
  5. `pnpm umbrel:status` must print "Safe to click Update"; the owner then clicks Update in Umbrel.
- **Restore on the Umbrel:** `pnpm umbrel:restore <backup name> --stop`, or `--from-file <path>` after a reinstall. **This needs the owner's explicit OK in chat every time** (the auto-mode permission check treats it as a production change).
- **A dev copy of the live data:**
  1. Download a backup from Settings → Backups.
  2. Stop the dev server.
  3. Run `pnpm restore:backup <path> --yes` (it restores into the local `DATA_DIR`).
- **Remote writes:** run the script with `--dry-run` first. The auto-mode permission check blocks an unpreviewed remote write.

**State at close (Stage 8):**
- `pnpm test`: 6471 passed, 3 skipped (symlink and `chmod 000` cases that Windows cannot run; they print their reason).
- The full e2e suite, typecheck, lint, format and build are green.
- `guard:all` is clean with 8036 terms, and so is the store-clone guard (only allowed findings).
- No migration this stage (still 6).

## Live state on the Umbrel (at the Stage 8 close)
- **Apps:**
  - Joinr Registry 2.8.3, loopback only (tags 1.0.0-rc.1, 1.0.0, 1.1.0-rc.1, 1.1.0).
  - Joinr Finance 1.1.0 (`sha256:5f8bf817d6a7…`), healthy, behind the Umbrel login on port 4932.
- **NAS copy:** set up and ready; the first copy put 7 files on the NAS, and the next scheduled copy is Sunday 04/10/2026 03:00 (the October DST day).
- **Data and import:**
  - The cutover import reconciled with **0 unexplained**.
  - The D98 one-off ran once.
  - August 2026 was recorded from the sheet.
- **Auto-record** is on; the next run is **30/09/2026 23:00** Melbourne time (D84, D89).
- **Backups:** the manual, pre-import, nightly and pre-restore copies from the demo. The first scheduled nightly with data runs at 02:30 on 29/09.
- **Owner test data:** the owner's step-17 test trade (an app-added ETF buy of 100 units, dated the demo day) is still in the database. The owner deletes it if it was only a test.
- **Leftovers:** the `1.0.0-rc.1` tag stays in the registry (harmless), and `~/joinr-build/` on the Umbrel holds the build contexts (the release script prunes old ones).

## Known issues / carried forward
- **Check next session:**
  - After Sunday 04/10/2026 03:00, Settings → Backups shows a scheduled NAS copy that succeeded.
  - Settings → Backups shows a `Nightly` row from 02:30 on 29/09, with the last run Succeeded (plan §9 step 20).
  - After 30/09 23:00, History shows September recorded automatically.
- **Deferred:**
  - The JSON export (D121) and encryption at rest (D133: plain files accepted).
  - **Access from a second PC and the phone** (D124): a dedicated Android app later.
  - HTTPS (the app is plain HTTP behind the Umbrel login on the tailnet and LAN).
- **Data to correct in the app** (the sheet fixes were skipped, D123):
  - the mortgage payment and compounding (D76)
  - the undated other assets (D73)
  - the budget rows' stale account names (D65; the 3 "suspect" rows in the reconciliation)
- **Uninstall deletes the database and every backup** (D113). Download a backup before any uninstall, and never change the store or app ids.
- **`reference/`:** the cutover export is in `reference/cutover/` so that the goldens still find a single `.xlsx` in `reference/`. The goldens remain tied to the 2026-09-24 export.
- **Still open from earlier stages:** Yahoo is unofficial, and CoinGecko ids are resolved by search; TypeScript stays pinned to ~6.0; never run `pnpm deploy` in the dev checkout.
- **Density rule (D109)** and **privacy:** as before. Stages 7–8 added guard terms for the Umbrel home path, the SSH key name, this PC's user paths, the NAS rsync accounts, the NAS model and vendor, and the private repo name.
- **Node outside this app:** Node was installed from inside the Claude desktop app, which is a packaged (MSIX) app, so it lives in that app's redirected `LocalCache` folder and is invisible to ordinary terminals (RUNBOOK, "Placing the files").

## Next step
No Stage 9 is defined yet. Candidates, for the owner to choose and scope:
1. **The Android app** (D124).
2. **Post-cutover data fixes** in the app (D76, D73, D65).

Start by checking the first nightly, the September auto-record and the first scheduled NAS copy (above).

## Environment facts (generic)
- **Tooling:** Windows 11 with PowerShell and Git Bash, Node v24.20.0, pnpm 11.23. No local Docker, `gh` or Python. `ssh umbrel` works with key auth, and the deploy scripts resolve Windows OpenSSH or Git's ssh.
- **The Umbrel:** umbrelOS 1.7.4 with Docker 28, running on UTC while the app runs on Australia/Melbourne (D114). Its app store syncs from GitHub about every 5 minutes.
- **Reading the xlsx:** SheetJS (the tarball from cdn.sheetjs.com, also needed by the image build on the Umbrel).
- **Network:** Yahoo's chart API needs a browser-like User-Agent; CoinGecko needs no key; both are reachable from the container.
- **Private backup:** `reference/` and `docs/private/` exist only on this PC. Copy them somewhere safe (the NAS copy covers only the app's backups).
