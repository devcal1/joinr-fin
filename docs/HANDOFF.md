# Handoff

_Last updated: after the Stage 10 demo (2026-10-04)._

## Next: the owner picks Stage 11
**Stage 10 is done (D172).** No Stage 11 is planned yet (PLAN.md has none).
1. Ask the owner what Stage 11 is, then plan it with the stage process.
2. **Optional:** compare ALL with the web's totals. The owner downloads a backup; the coordinator restores it into a **scratch** `DATA_DIR` (never `data/`) and sums the four investment pages' unrealised + realised plus the Other Assets bullion rows. Not run at the demo.

**Next step:** `/clear`, then tell the coordinator what Stage 11 is (or "Plan Stage 11").

## Where we are
**Stage 10 (the phone's period selector) is done: released (D171) and the owner's phone demo passed with no fixes (D172).** Joinr Finance **1.3.0** is live on the Umbrel and the owner's phone runs the signed **APK 1.1.0**.
- Plan, review logs and close notes: `docs/stages/stage-10.md`. Decisions D160–D172. Private: `docs/private/stage-10-private.md` (owner coverage, the release and demo records, the APK digest).
- **Server 1.3.0:** migration 0007 (`instrument_closes`, `instrument_splits`, `series_closes`; caches, never app data, never dumped); a daily **`closes` job** (16:52 Melbourne, a start-up run after 120 s, up to 6 follow-ups a day; Yahoo daily history by `period1`/`period2` with split events, CoinGecko up to 365 days, the AUD bullion spot derived from futures ÷ `AUDUSD`, exact midnight values captured from 1.3.0 on; kill switch `CLOSES_REFRESH`); **`GET /api/mobile/periods`** (all seven periods in one keyed, read-only answer; `/today` byte-identical, so older APKs keep working).
- **Store:** `a711611` (pushed): the 1.3.0 image pin, version and notes.
- **The phone:** APK 1.1.0 (versionCode 4): the chip row (1D on a cold start, kept while the process lives), period figures on cards, LIST, MOVERS and the detail, the Sold holdings row and line, the Partial note, the ALL caption. Widgets and the worker are unchanged.
- **Backups with the caches:** the nightly copy is now about 1.1 MB (was about 570 KB). On the daylight-saving morning (04/10) the 02:30 nightly ran at 03:30, as designed.

## What exists (new in Stage 10)
| Path | What it is |
|---|---|
| `packages/engine/src/periodChange.ts` | `periodStartDate`, `computePeriods`: the period rules (D160–D166), ALL (D161–D162), the lines (D164, D167). Worked examples P1–P23, A1–A11, C1–C5. `dayChange.ts` is unchanged. |
| `packages/schema/src/{mobile,enums,rows}.ts`, `dto/mobile.ts`, `fixtures/mobile.ts` | Period constants, `PERIOD_STATUSES`, `CLOSE_SOURCES`, job `closes`, the periods DTOs, fixtures `mobilePeriods` (open, noHistory, soldOnly, empty) and their Android JSON copies. |
| `apps/server/migrations/0007_stage10_closes.sql`, `src/db/queries/closes.ts` | The three cache tables and their readers. |
| `apps/server/src/market/closes/**`, `providers/{yahoo,coingecko,fake}.ts` | The `closes` job: targets, history, coins, the derived spot, writes (one IMMEDIATE transaction per target), run, schedule. It pauses for the other market jobs; `prices` waits for it. |
| `apps/server/src/mobile/{inputs,periods}.ts`, `bullion.ts`, `routes/mobile.ts` | The shared input loader, the periods builder, bullion for ALL, the route. |
| `apps/android/.../model/PeriodModel.kt`, `ui/today/{PeriodChips,PeriodContent}.kt` | The period model and screens; `store/Repository.kt` `periods()` with its own cache per pairing. |
| `tools/deploy/smoke.mjs` | `check`: 8 migrations and the daily-history egress; `mobile`: a seeded `ASX:TLS` listing, a closes run with rows, the `/periods` probes (26 in all). |

## What exists (new in Stage 9)
| Path | What it is |
|---|---|
| `packages/engine/src/dayChange.ts` | `computeDayChange`, `portfolioLine`, `downsample`: the day rules (lots held before the session count from the previous close, lots bought within it from their cost; FX included; crypto and bullion from 00:00 Melbourne; funds' latest NAV move). Worked examples M1–M26. |
| `packages/schema/src/{mobile.ts,dto/mobile.ts,dto/phone.ts,fixtures/mobile.ts,fixtures/phone.ts}` | Constants, the pairing URL, DTOs, error codes, fixtures; `scripts/exportMobileFixtures.ts` writes the Android JSON copies (drift-tested). |
| `apps/server/src/market/{day.ts,dayWrites.ts,intraday/**}` | Yahoo and CoinGecko day data, the newer-session merge, the intraday job (`INTRADAY_REFRESH` is the kill switch). |
| `apps/server/src/mobile/**`, `routes/{mobile,phone}.ts` | The device store, pairing (10-character codes, 5 minutes, 5 tries), the key check, the read-only catch-all (405), the today builder, bullion. |
| `apps/web/src/pages/settings/PhoneSection.tsx` (+ `PairingQr`, `qrModel`, `phoneDisplay`) | Settings → Phone. |
| `apps/android/**` | Kotlin, Compose and Glance (application id `com.tenon.joinrfinance`): Today (CARDS / LIST / MOVERS, sort, VAL · INVESTED · GAIN), detail, pairing (scan, deep link, by hand), the app lock, settings, three widgets and the 30-minute worker. Arimo bundled (OFL). |
| `tools/deploy/android.mjs` | `pnpm android:{test,lint,debug,release,fixtures,stop}`. A release needs `JOINR_ANDROID_SIGNING` (the owner's `signing.properties`, outside the repo) and prints the APK's and the certificate's SHA-256. |
| `tools/deploy/smoke.mjs mobile` | 19 live probes against the rc container. |
| `e2e/phone.spec.ts`, `e2e/phone-states.spec.ts` | The pairing flow on the real API; every Settings → Phone state. |

## What exists (Stage 8)
| Path | What it is |
|---|---|
| `apps/server/src/nascopy/**` | The weekly copy to an rsync-daemon module (D126): the `nas-url` check, the listing parser, the plan (missing names, newest first, one invocation), the runner (`shell: false`, the password only in `RSYNC_PASSWORD`, a kill grace), the copy (list, send, list again, sizes), the schedule (Sunday 03:00, a catch-up, retries at +1/+2/+4 h), the refusal lock, the status. It never throws and never fails a backup; add-only flags are pinned by a test. |
| `routes/backups.ts`, `routes/status.ts` | `nasCopy` in `GET /api/backups` and `/api/status`; `POST /api/backups/nas-copy` (202; 409 `NAS_COPY_NOT_READY` / `NAS_COPY_FIX_FIRST`). |
| `apps/web` Settings → Backups | The "Copy to the NAS" block and **Copy to NAS now**; an every-page callout when no copy has succeeded for 8 days, or the files are half-placed, unusable or locked. |
| `tools/deploy/nas-secrets.mjs` | `pnpm umbrel:nas-secrets` (`--prompt-test`, `--dry-run`, `--check`, `--remove`): places `nas-url` and `nas-password` over SSH stdin (folder 700, files 600, uid 1000). The owner runs it in a normal PowerShell window. |
| `tools/deploy/smoke.mjs nas` | A scratch rsync daemon on a private Docker network on the Umbrel: 16 probes. |
| `Dockerfile` | rsync installed in the runtime image. |
| `../tenon-umbrel-store` | `tenon-joinr-finance` 1.1.0 (`backupIgnore` for `data/secrets`). Pushed: `6459388`. |

## What exists (Stage 7)
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
- **Android:** `pnpm android:test`, `android:lint`, `android:debug`, `android:release` (signing in Known issues). The emulator AVD and SDK paths are in the private notes §4.
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

**State at close (Stage 10):**
- `pnpm test`: 7252 passed, 4 skipped (platform-only symlink and `chmod` cases; they print their reason). Android: 212 tests.
- The full e2e suite (668 passed; 17 web specs flaky on a busy PC, passing on retry), typecheck, lint, format and build are green.
- `guard:all` is clean with 8045 terms (Stage 10 added three CoinGecko coin ids).
- Migrations: 8 (0007 added this stage).

## Live state on the Umbrel (at the Stage 10 close)
- Joinr Finance **1.3.0** (`sha256:82d0a86d…`), healthy, migrations 8; Joinr Registry 2.8.3 (tags up to 1.3.0 and 1.3.0-rc.1).
- Backups: the nightly copies, the 1.3.0 pre-migrate copy (03/10 20:39), the 1.2.0 pre-migrate copy (03/10 06:42), and earlier manual and pre-restore copies.
- The owner's phone is paired and runs APK 1.1.0.

## Known issues / carried forward
- **APK updates:** bump `versionCode` and `versionName` in `apps/android/app/build.gradle.kts`, then sign with `pnpm android:release` with `JOINR_ANDROID_SIGNING` set to the owner's `signing.properties` (its path is in the private notes §5). Every APK must show the same certificate digest (private §8). Install with `adb -s <phone> install -r --user 0 <apk>` after the owner turns on wireless debugging; the phone's port changes each time (`adb mdns services` finds it). **Never `gradlew installDebug`** while the phone is visible to adb.
- **Agents and adb:** adb can see the owner's phone; agents use only `-s emulator-NNNN`.
- **Stray folder:** a Git Bash path slip made `C:\c\Users\…\artifacts\stage9\verifier\prod\finance.db` (a generic seed only); the owner deletes `C:\c`.
- **Unverified:** whether a live 2-day Yahoo answer on a Monday morning carries the Sunday-evening futures bars (private §6). Only the bullion line could miss a few hours of points.
- **Accepted limits (Stage 10):** coins held longer than 365 days are flat under ALL (CoinGecko's keyless reach); crypto and bullion closes before 1.3.0 are approximate; a split inside a period shows "—" (no split model); ex-dividend drops show as losses; the e2e suite has 17 flaky web specs on a busy PC.
- **Not verified live (Stage 10):** the read-only count of the first `closes` run (the demo's periods show it worked); the APK 1.0.2 compatibility with 1.3.0 (the phone was upgraded at once; `/today` is byte-identical by test).
- **`smoke check --dry-run` exits 1** ("N of M checks failed"), unchanged since Stage 7; harmless, could be tidied.
- **Accepted limits (Stage 9):** crypto may read `no_base` for up to 15 minutes after midnight; with `INTRADAY_REFRESH=false` crypto has no day figure; bullion is flat at weekends; a futures roll can show a false jump; the phone uses plain HTTP inside Tailscale.
- **E2E and a running dev server:** stop `pnpm dev` before `pnpm e2e` (`reuseExistingServer: true`). A few read-only e2e tests can need one retry on a cold load when the PC is busy.
- **An interrupted first start leaves a broken DB** (from Stage 8): delete the scratch `finance.db` and start again.
- **Check with the owner:** the two loan accounts listed under Bank accounts (they count toward the emergency fund); the Stage 7 demo-day test ETF buy.
- **Deferred:** the JSON export (D121); encryption at rest (D133); HTTPS; an in-app APK updater (D145).
- **Data to correct in the app:** the mortgage payment and compounding (D76), undated other assets (D73), the budget rows' stale account names (D65).
- **Uninstall deletes the database and every backup** (D113). Download a backup before any uninstall; never change the store or app ids.
- **Still open from earlier stages:** Yahoo is unofficial, and CoinGecko ids are resolved by search; TypeScript stays pinned to ~6.0; never run `pnpm deploy` in the dev checkout.
- **Privacy:** Stage 9 added guard terms for the tailnet name, the AVD, the keystore folder and the phone model.

## Environment facts (generic)
- **Tooling:** Windows 11 with PowerShell and Git Bash, Node v24.20.0, pnpm 11.23. No local Docker, `gh` or Python. `ssh umbrel` works with key auth, and the deploy scripts resolve Windows OpenSSH or Git's ssh.
- **The Umbrel:** umbrelOS 1.7.4 with Docker 28, running on UTC while the app runs on Australia/Melbourne (D114). Its app store syncs from GitHub about every 5 minutes.
- **Reading the xlsx:** SheetJS (the tarball from cdn.sheetjs.com, also needed by the image build on the Umbrel).
- **Network:** Yahoo's chart API needs a browser-like User-Agent; CoinGecko needs no key; both are reachable from the container.
- **Private backup:** `reference/` and `docs/private/` exist only on this PC. Copy them somewhere safe (the NAS copy covers only the app's backups).
