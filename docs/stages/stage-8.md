# Stage 8 — Weekly backup copy to the NAS: build plan

> **D132 (owner, plan review): there is no heartbeat.** Every mention below of `nas-heartbeat-url`, pings, `--heartbeat-only`, `--remove-heartbeat` or a heartbeat row, state or sentence is void; the NAS files are exactly `nas-url` and `nas-password`. The code and its Scaffold notes are the record of what was built.

_Planner output, 2026-09-27/28. Inputs: PLAN.md (Stage 7 and Stage 8), docs/HANDOFF.md (the state at the end of Stage 7 and its carry-overs), docs/STAGE_PROCESS.md, docs/DECISIONS.md (D10, D11, D111–D125 still bind; **D126–D129 are the Stage 8 kickoff answers**), docs/stages/stage-7.md (the format, and the backups design this builds on: §3–§7), docs/deploy/RUNBOOK.md, docs/private/ENVIRONMENT.md and docs/private/stage-7-private.md, the Stage 7 code (`apps/server/src/backups/**`, `routes/{backups,status}.ts`, `scheduler/**`, `config.ts`, `app.ts`, `index.ts`; `apps/web/src/pages/settings/**`, `layout/**`, `api/hooks.ts`; `packages/schema/src/{backups.ts,enums.ts,dto/backups.ts,dto/errors.ts,dto/status.ts,fixtures/backups.ts}`; `tools/deploy/**`; `Dockerfile`; `playwright.config.ts`), the store clone (`tenon-umbrel-store/tenon-joinr-finance/*`, `tenon-joinr-backup/*`, `.gitignore`), **the design of the owner's Joinr Backup app** (private source: its push, push-plan, heartbeat, secrets, tools and constants modules, its read-only and push tests, its README and its secrets helper; studied for behaviour only, nothing copied), and a **read-only** look at the Umbrel over `ssh umbrel`._

> **This repo is PUBLIC.** Nothing from `reference/` (except `reference/brand/`) or `docs/private/` may be copied into any other file: no amounts, holdings or account names; **no IP addresses, no host or tailnet names other than the generic SSH alias `umbrel`, no NAS model, account, module or share names**, no personal paths, emails, Drive ids or workbook file names; the capitalised name of the owner's holding company never appears (write "the owner's Joinr Backup app" or the lower-case store id `tenon`); **today's date is a guard term** (date committed text "2026-09-27/28"). The owner-specific facts for this stage are in **`docs/private/stage-8-private.md`** (git-ignored): deploy-nas, the code-quality reviewer, the Verifier and the coordinator read it; nobody copies from it. The **store repository is public too**: the same rules apply to every file written there.
>
> **No agent commits or pushes, and no agent touches the Umbrel or the NAS.** deploy-nas writes the store's app folder into the local clone **uncommitted**. Agents never run `ssh`, `scp`, `docker` or `rsync` against a remote host; the deploy scripts are tested with a fake runner and `--dry-run`. Every live step (§11) is the coordinator's, with the owner's OK. **The NAS password never passes through an agent, a chat, a tool call, a test fixture or a file on the dev PC**: the owner types it into the helper in his own terminal (§6).

**Flow:** Coordinator pre-step (guard terms, a `data/` backup, §10.0) → **server-nas step 0** alone (the contract of §3–§4: constants, the address rule, DTOs, error code, fixtures; ≈ 1 agent-step) → **3 implementers in parallel**: **server-nas** (the copy service, the rsync runner, the heartbeat, the schedule, the routes and status, config), **web-nas** (the Settings "Copy to the NAS" block, the NAS-copy callout, the hooks, CODE-8 web, the e2e specs), **deploy-nas** (Dockerfile, `tools/deploy/**` including the secrets helper and the smoke's NAS probes, the store folder in the local clone, RUNBOOK/README/ARCHITECTURE) → web-nas **phase B** (its e2e against the real API once server-nas reports done) → Reviewers in parallel (**spec-correctness**, **style-ux**, **code-quality/security**) → per-reviewer triage → **Fixer** → **Verifier** → **coordinator live smoke on the Umbrel** (§11 step S, owner question 2) → **release 1.1.0, the owner's NAS set-up, the helper, the demo** (§11). Build workflow: 4 agents (server-nas ×2 steps, web-nas, deploy-nas); review workflow: 6 (3 reviewers, triage, Fixer, Verifier).

**Golden values:** none (no calculation changes; the Stage 1–7 goldens must pass unchanged). **Template bug fixes:** none. **Behaviour changes** (vetoable at the plan review or the demo): §15.

**Verified by the Planner (2026-09-27/28; read-only over `ssh umbrel`; the Stage 7 code; Node 24 with `TZ=Australia/Melbourne`):**
- **The Umbrel host has its own rsync; the app image has none** (Debian bookworm-slim ships no rsync). The Debian mirror (`deb.debian.org`, main and security, bookworm) answers 200 from the Umbrel, so `apt-get install rsync` in the image build is reachable. Bookworm's rsync is the 3.2.x line; the daemon protocol is compatible both ways.
- **The app container can route to the tailnet**: it sits on the private `finance` bridge (not `internal`), the host's policy routing sends every destination through Tailscale's table first, and Docker masquerades bridge traffic. The owner's Joinr Backup app, on Umbrel's shared bridge, already copies to the same NAS this way. Proven for this container only at the owner's live step (§11 step 10); the smoke never contacts the NAS.
- **Tailnet names do not resolve inside the container**: the Umbrel's resolver is a public DNS service and Docker's embedded DNS forwards to it. `nas-url` therefore carries the NAS's **Tailscale IP address** (in the owner's private notes, never in a tracked file). The rsync daemon protocol is **plaintext**; over Tailscale it travels inside WireGuard.
- **`job_runs.job` is plain text with no CHECK constraint** (migration 0001; the Drizzle column has no enum), so the new job `nas-copy` needs **no migration**: `migrations` stays **6**. `job_runs.trigger` keeps its enum (`schedule | startup | manual | import`), which covers every trigger used here.
- **The scheduler** inserts the `job_runs` row as `running` before `job.run`, stores the job's `error` string as-is, keeps 500 rows per job, joins a run in flight, and `stop()` aborts `ctx.signal` of in-flight runs (Stage 7 §header). **There is no per-job abort: only `scheduler.stop()` aborts `ctx.signal`, and it runs last in `preClose`.** When a job throws, the scheduler logs `{ err }` through pino's err serializer (enumerable properties and `cause` included) and stores `err.message` in `job_runs.error` (`scheduler/index.ts`, the run and the timer paths), so a throw from the copy would be a leak path (§5.5 step 9, §5.12). `markInterruptedRuns` marks a row left `running` by a crash as `failed` with error `interrupted`.
- **The shutdown budget is 10 s, not the container's 30 s:** `index.ts` forces `process.exit(1)` after `FORCE_EXIT_MS = 10_000` from the first signal (the container's `StopTimeout` is 30 s, with an init process). `preClose` (backups, recorder, scheduler, and now the copy) must fit inside it, or the row stays `running` and the Stage 7 running marker is left behind (the restore and import CLIs then need `--force`). §5.10 budgets the copy's stop at 4 s.
- **A Stage 7 backup is atomic relative to the event loop** (`VACUUM INTO`, the verification and the prune are synchronous), so a backup never interleaves with the copy's own JavaScript; it can, however, run and prune **while the copy's rsync child runs** (the child is asynchronous). §5.10 handles it ("vanished").
- **An Umbrel Update copies only `docker-compose.yml`, `umbrel-app.yml` and a few script files; it never touches `data/`**, so a new `data/secrets/` skeleton in the store would reach fresh installs only. The helper creates the folder itself (§6).
- **The app's data folder has no `secrets/` today**; the owner's Joinr Backup app keeps its secret files in `data/secrets/` (the same Umbrel convention, and the same caveat: `app_proxy` mounts the app-data parent read-only).
- **How umbrelOS applies `backupIgnore`** (read in umbreld's own source on the Umbrel): each entry must match `^[-a-zA-Z0-9._/*]+$`, is joined to the app's data directory, made absolute from the backup root with a leading `/`, and written as a line of kopia's ignore file, which uses gitignore rules: **an entry naming a folder excludes the folder and everything under it, and `*` also matches names that start with a dot.** So `data/secrets` alone covers the files and the helper's `.nas-*.new` temporaries; the store lists `data/secrets` and `data/secrets/*` both (§6.3), belt and braces.
- **Melbourne's DST changes fall on Sundays** (the first Sunday of October and of April), i.e. on the weekly slot's day. `new Date(y, m, d, 3, 0)` gives **03:00 AEDT** on the October change (the first instant after the 02:00 → 03:00 gap) and **03:00 AEST, once**, on the April change (the repeated hour is 02:00–02:59). On the October day the Stage 7 nightly slot is 03:30 AEDT, **after** the 03:00 copy (§5.9 table). **The first Sunday after a release this week is the October 2026 change day.**
- **No rsync on the dev PC** (Windows, Git Bash without rsync): no test may need a real rsync; the real binary is exercised only in the Umbrel smoke (§9.2), where the rc image's own rsync also plays the NAS's daemon.
- **Node and pnpm are on the owner's own PATH** (not only the agent's), and `ssh umbrel` works with key auth from the owner's PowerShell, so a Node helper (`pnpm umbrel:nas-secrets`) is something the owner can run himself.

Details (the addresses, the NAS's admin path for rsync accounts, its brute-force protection, the live folder state, the first slot) are in `docs/private/stage-8-private.md`.

---

## 1. Overview & flow

### 1.1 What Stage 8 delivers
1. **The copy** (server, §5): a `nas-copy` job that copies **every backup file the app keeps** (all kinds; only regular files matching the backup-name rule, so never a `.partial`, a hidden set-aside or a foreign file) to an **rsync-daemon module on the NAS** (D126, D127). It lists the far side first, sends only the names the NAS lacks (or holds at a different size), newest first, in **one** rsync invocation, then lists again and **proves** each file arrived at the right size. It only adds: no deleting, no in-place writes, no partial files (a test pins the flags). It never throws: every outcome is a `job_runs` row with one fixed sentence; a copy failure never touches a backup.
2. **The schedule** (§5.9, D128): weekly, **Sunday 03:00 server time** (Australia/Melbourne), with **one start-up catch-up** after a missed slot, bounded retries for transient failures only, and a **"Copy to NAS now"** button (Settings → Backups). **After the NAS refuses the password or module, nothing (neither the timer nor the button) tries again until the NAS files are placed again** (the refusal lock, §5.9), so the NAS's brute-force protection is never provoked by the app.
3. **The NAS files** (§5.2, §6): `DATA_DIR/secrets/nas-url`, `nas-password`, optional `nas-heartbeat-url`, read at run time. Placed over SSH by **`pnpm umbrel:nas-secrets`**, a helper the owner runs in his own terminal (hidden password prompt, files 0600 uid 1000, all-or-none, `--remove`, `--check`, `--dry-run`). **Off until they exist** (D126).
4. **An optional dead man's switch** (§5.8, D129): `nas-heartbeat-url` (https only, healthchecks.io style) is pinged on every successful copy and at `/fail` when a scheduled slot is given up.
5. **Status** (§4): `GET /api/backups` gains a `nasCopy` block (configured off / partial / invalid / ready, last attempt, last success, counts, next run, the sentence on failure, the heartbeat), `GET /api/status` a small `nasCopy` block; `POST /api/backups/nas-copy` starts a copy (202). Nothing anywhere carries the address, the account, the module or the password.
6. **Web** (§8): a dense "Copy to the NAS" block in Settings → Backups, and an `important` callout on every page when the copy is overdue (8 days without a success), half set up, unusable, or locked after a refusal.
7. **The image** (§7): rsync installed from Debian bookworm (the pinned base stays), checked at build time.
8. **Deploy** (§9): the secrets helper, the smoke's NAS probes (a scratch **rsync daemon** container, run from the rc image itself, on a private Docker network: the real rsync binary end to end before the real NAS), `umbrel:status` reporting the files' presence, the store's app folder (release notes, description, `backupIgnore` for the secret files), the RUNBOOK sections (set-up, removal, troubleshooting, restore from the NAS copy), README and ARCHITECTURE.
9. **Release 1.1.0** through the Stage 7 path (§11), no migration.
10. **CODE-8 hygiene** (§5.14, §8.8, §9.6): the Stage 7 cross-owner request (`pageCases.ts` mocks `GET /api/backups`), the "NAS copy: later" lines in the docs, the smoke's egress probe list.

### 1.2 Workspace changes (no new packages, no new npm dependencies, no migration)
```
packages/schema/     + src/nasCopy.ts (schedule, file names, states, reasons, sentences, the address rule),
                     + src/dto/nasCopy.ts (DTOs, job detail); enums.ts (JOB_NAMES + 'nas-copy');
                     dto/backups.ts (BackupsResponse.nasCopy); dto/errors.ts (+ NAS_COPY_NOT_READY, NAS_COPY_FIX_FIRST);
                     dto/status.ts (AppStatus.nasCopy, optional); index.ts exports;
                     + fixtures/nasCopy.ts; fixtures/backups.ts (every backupsPages state gains nasCopy);
                     fixtures/{index,coverage}.ts; schema tests
apps/server/         + src/nascopy/{secrets,listing,plan,sentences,runner,copy,heartbeat,schedule,service,status}.ts;
                     edits: routes/backups.ts (the nasCopy block, POST /backups/nas-copy), routes/status.ts,
                     app.ts (decorate + seams + preClose), index.ts (start), config.ts (WEEKLY_NAS_COPY),
                     backups/service.ts (additive whenIdle()); test/nascopy/** + touched suites
apps/web/            + src/pages/settings/{NasCopyBlock.tsx,nasCopyDisplay.ts} (+ tests), BackupsSection.tsx,
                     backupsDisplay.ts (the uninstall text), SettingsPage.tsx (index entry), backups.css;
                     api/hooks.ts (useNasCopyNow, the poll); layout/{RootLayout.tsx,nasCopyStale.ts} (+ tests);
                     pages/pageCases.ts (CODE-8); test/** helpers
e2e/                 + nas-copy-states.spec.ts (route-mocked); edits: backups.spec.ts, backups-mutations.spec.ts,
                     backups-support.ts, settings.spec.ts if its expectations move
playwright.config.ts webServer env + WEEKLY_NAS_COPY=false
Dockerfile           rsync from Debian (runtime stage), a build check
tools/deploy/        + nas-secrets.mjs; edits: lib.mjs (secret names, the address rule copy, prompt helpers),
                     smoke.mjs (`nas` probes, removal), status.mjs (the NAS files' presence); test/*.test.mjs
package.json         version → 1.1.0; script umbrel:nas-secrets
docs/deploy/RUNBOOK.md, README.md, docs/ARCHITECTURE.md
../tenon-umbrel-store/ (LOCAL CLONE, UNCOMMITTED) tenon-joinr-finance/{umbrel-app.yml (description, releaseNotes,
                     backupIgnore), docker-compose.yml (comments only)}; README.md (the NAS copy line)
```

### 1.3 Dependencies
**No npm package changes and no `pnpm install`** (the lockfile stays byte-identical; the image build's `pnpm install --frozen-lockfile` would fail otherwise). The server spawns the system `rsync` with Node's `child_process.spawn` (`shell: false`) and pings the heartbeat with Node's global `fetch`. The helper is plain ESM `.mjs` with Node built-ins (`readline`/raw-mode stdin, `child_process`). rsync reaches the image through `apt-get` (§7). Never `pnpm approve-builds`; never run `pnpm deploy` in the dev checkout.

### 1.4 Scripts
- `umbrel:nas-secrets` → `node tools/deploy/nas-secrets.mjs` (§6.2). Every other Stage 7 script is unchanged in name; `umbrel:smoke` gains the `nas` subcommand (§9.2).

Scoped commands used in this plan:
- `pnpm vitest run --project server test/nascopy test/config.test.ts test/backups`
- `pnpm vitest run --project schema`
- `pnpm vitest run --project web src/pages/settings src/layout src/api`
- `pnpm vitest run --project deploy`

The Stage 7 tooling note stands: `pnpm vitest …` runs pnpm 11's dependency check first; `node node_modules/vitest/vitest.mjs run …` avoids it. The lockfile must stay unchanged either way.

---

## 2. Engine
No engine change. `packages/engine` is untouched; its purity lint and goldens run unchanged in the Verifier's checks.

---

## 3. Data model and constants (`@joinr/schema`; no migration) — FROZEN

### 3.1 No migration
`migrations` stays **6**. `job_runs.job` takes `'nas-copy'` without DDL. No new `app_meta` key: everything the page shows is derived from `job_runs` and the secret files at request time.

### 3.2 Constants (`packages/schema/src/nasCopy.ts`, FROZEN; plain constants and one pure function, no imports)
```ts
/** D128: weekly, Sunday 03:00 server-local time. `weekday` is Date#getDay() (0 = Sunday). */
export const NAS_COPY_WEEKDAY = 0;
export const NAS_COPY_HOUR = 3;
export const NAS_COPY_MINUTE = 0;

/** No successful copy for this long (a missed Sunday plus a day), while ready → stale (§5.9). */
export const NAS_COPY_STALE_HOURS = 8 * 24;

/** The folder in DATA_DIR and the three one-line files (D126, D129). */
export const NAS_SECRETS_DIR = 'secrets';
export const NAS_SECRET_FILES = {
  url: 'nas-url',
  password: 'nas-password',
  heartbeat: 'nas-heartbeat-url',
} as const;
/** A secret file larger than this, or not a regular file, is not usable (§5.2). */
export const NAS_SECRET_MAX_BYTES = 4096;

export const NAS_COPY_CONFIG_STATES = ['off', 'partial', 'invalid', 'ready'] as const;
export type NasCopyConfigState = (typeof NAS_COPY_CONFIG_STATES)[number];

export const NAS_COPY_FAILURE_REASONS = [
  'url_missing', 'password_missing', 'url_invalid', 'password_invalid',   // configuration (no rsync run)
  'auth', 'unknown_module', 'refused',                                    // the NAS said no
  'unreachable', 'timeout', 'broken', 'nas_io',                           // transport and storage
  'not_verified', 'readback_failed',                                      // the proof failed
  'no_rsync', 'stopped', 'other',
] as const;
export type NasCopyFailureReason = (typeof NAS_COPY_FAILURE_REASONS)[number];

/** Configuration reasons: recorded without running rsync (`attempted: false`). */
export const NAS_COPY_CONFIG_REASONS: readonly NasCopyFailureReason[] =
  ['url_missing', 'password_missing', 'url_invalid', 'password_invalid'];
/** Retried automatically within a scheduled slot (§5.9). Everything else is not. */
export const NAS_COPY_RETRYABLE_REASONS: readonly NasCopyFailureReason[] =
  ['unreachable', 'timeout', 'broken', 'nas_io', 'not_verified', 'readback_failed', 'stopped', 'other'];

/** Appended to every failure sentence. */
export const NAS_COPY_SAFE_TAIL = 'The backups on the server are not affected.';

/** The only sentences a copy ever records or shows (§4.4). Numbers are the only variables. */
export function nasCopyFailureMessage(
  reason: NasCopyFailureReason,
  n?: { code?: number; missing?: number; total?: number },
): string;
/** The 409 message when a copy is asked for and the files are absent (§4.1). */
export const NAS_COPY_OFF_MESSAGE = 'The copy to the NAS is not set up: the NAS files are not on the server.';
/** The 409 message while the refusal lock holds (§4.1, §5.9). */
export const NAS_COPY_FIX_FIRST_MESSAGE =
  'The NAS refused the last copy\'s password or module. Place the NAS files again with the NAS set-up helper first: repeated refusals could make the NAS block this server.';
/** Reasons that engage the refusal lock (§5.9): the NAS said no to the login or the module. */
export const NAS_COPY_REFUSAL_REASONS: readonly NasCopyFailureReason[] = ['auth', 'unknown_module', 'refused'];
/** Why a non-ready configuration is not ready (§4.3), decided from the current files. */
export type NasCopyConfigReason = 'url_missing' | 'password_missing' | 'url_invalid' | 'password_invalid';

/**
 * The address rule (§5.3): `rsync://<user>@<host>[:<port>]/<module>[/<subfolder>]`, no password,
 * no query or fragment, no whitespace. Returns a canonical URL ending in `/`, or `configured`
 * (whether the text was non-empty) and nothing else, so a refusal can never quote the value.
 * NEVER THROWS for any input (a malformed percent-escape is a refusal, §5.3).
 */
export type NasUrlCheck =
  | { ok: true; url: string; hasSubfolder: boolean }
  | { ok: false; configured: boolean };
export function checkNasUrl(raw: unknown): NasUrlCheck;
/** https only, no userinfo (§5.8); same shape: the value is never echoed. NEVER THROWS. */
export function checkHeartbeatUrl(raw: unknown): { ok: true; url: string } | { ok: false; configured: boolean };
```
`NAS_COPY_RETRYABLE_REASONS` keeps `stopped` (a stop never settles a slot), but a `stopped` run is **not counted** as an attempt and never pings (§5.8, §5.9).
`NasUrlCheck` deliberately has **no field for the user, host or module**: the server needs only the canonical URL to hand to rsync, and nothing else in the app may hold the parts.

### 3.3 Server-only constants (`apps/server/src/nascopy/*.ts`, FROZEN by this plan)
```ts
/** The ONLY rsync flags the copy passes (§5.4). Test-pinned (§5.13 readonly). */
export const RSYNC_FLAGS = ['--times', '--contimeout=10', '--timeout=120'] as const;
/** Added for the two listings only. */
export const RSYNC_LIST_FLAG = '--list-only';
export const RSYNC_EXECUTABLE = 'rsync';            // resolved on PATH; no environment override
export const NAS_COPY_TIMEOUT_MS = 15 * 60_000;     // one copy, end to end (list, send, list)
export const RSYNC_KILL_GRACE_MS = 2_000;           // SIGTERM, then SIGKILL; the runner rejects by grace + 500 ms
export const NAS_COPY_STOP_BUDGET_MS = 4_000;       // nasCopy.stop() never waits longer (FORCE_EXIT_MS is 10 s)
export const RSYNC_OUTPUT_LIMIT = 8 * 1024 * 1024;  // stdout kept per invocation; stderr 64 KiB
export const NAS_COPY_STARTUP_DELAY_MS = 5 * 60_000;           // after the backup's 2-min catch-up
export const NAS_COPY_WAKE_MAX_MS = 60 * 60_000;               // the timer never sleeps longer
export const NAS_COPY_RETRY_DELAYS_MS = [60, 120, 240].map((m) => m * 60_000); // after attempts 1, 2, 3
export const NAS_COPY_MAX_ATTEMPTS = 4;                        // per slot
export const NAS_COPY_FUTURE_SLACK_MS = 10 * 60_000;           // a run dated later than now + this settles nothing
export const HEARTBEAT_TIMEOUT_MS = 10_000;
export const HEARTBEAT_RETRY_DELAY_MS = 2_000;                 // one retry
```

### 3.4 Enums and error codes
- `JOB_NAMES` = `['prices', 'dividends', 'snapshot', 'backup', 'nas-copy']` (the comment updated).
- `API_ERROR_CODES` += `'NAS_COPY_NOT_READY'` (409; the message is `NAS_COPY_OFF_MESSAGE` or the configuration sentence, never a value) and **`'NAS_COPY_FIX_FIRST'`** (409; the message is `NAS_COPY_FIX_FIRST_MESSAGE`).
- `AppStatus.nasCopy?: { configured: NasCopyConfigState; configReason: NasCopyConfigReason | null; blocked: boolean; stale: boolean; lastSuccessAt: string | null }` (optional, additive). **`lastSuccessAt` here is local ISO with the server's offset** (built with the Stage 7 `localIsoWithOffset`, exactly as `AppStatus.backups.lastBackupAt`), because the every-page callout has no time zone and takes the date as `slice(0, 10)` (the Stage 7 `backupStale.ts` pattern). `NasCopyStatusDto.lastSuccessAt` stays UTC (§4).

### 3.5 Fixtures (`packages/schema/src/fixtures/nasCopy.ts`, `satisfies`, generic, consistent)
`nasCopyStates` (each a `NasCopyStatusDto`; dates in **2030**, the Stage 7 fixtures' year, Sunday **15/09/2030** as the reference slot). **Time forms follow §4 exactly:** `lastRun.startedAt`, `lastRun.finishedAt`, `lastSuccessAt` and `heartbeat.lastPingAt` are **UTC with milliseconds and `Z`** (e.g. `2030-09-14T17:00:05.123Z`, which is 03:00:05 on Sunday 15/09/2030 in Melbourne); only `schedule.nextRunAt` and `detail.slot` carry `+10:00`/`+11:00` offsets that match Melbourne on those dates. `appStatusNasCopy.*.lastSuccessAt` is local with the offset (§3.4).
`off`, `partialPassword` (`missing: ['nas-password']`, `configReason: 'password_missing'`), `invalidUrl` (`configReason: 'url_invalid'`), `invalidPassword` (`configReason: 'password_invalid'`), `blocked` (the last run `failed`/`auth`, `blockedUntilFilesChange: true`, `nextRunAt: null`), `readyNever` (no run yet, `nextRunAt` the next Sunday 03:00), `succeeded` (5 sent, 22 already there, `onNas` 27), `succeededNoOnNas` (`onNas` null), `running`, `failedUnreachable` (attempt 2, `nextRunAt` the retry), `notVerified` (1 of 5), `stale` (last success 9 days before `now`), `scheduleOff` (`schedule.enabled` false), `heartbeatSent`, `heartbeatFailed`, `heartbeatInvalid`, `stopped` (a row marked `interrupted` by a crash, shown as the `stopped` sentence, §4.4).
`nasCopyNowResponses`: `started`, `joined` (each `nasCopy.lastRun` is the `running` row, with its `id`). `appStatusNasCopy`: `ok`, `stale` (`lastSuccessAt` `2030-09-15T03:00:05+10:00`), `partial`, `invalidPassword`, `blocked`. `apiErrors.nasCopyNotReady`, `apiErrors.nasCopyFixFirst`.
**Every existing `backupsPages` fixture gains `nasCopy: nasCopyStates.off`**; add `backupsPages.nasReady` (`typical` with `nasCopy: nasCopyStates.succeeded`). `FIXTURE_COVERAGE` gains `nasCopyConfigStates` (all four), `nasCopyConfigReasons` (all four, plus null), `nasCopyBlocked` (true and false), `nasCopyFailureReasons` (every reason that has a fixture: at least `password_missing`, `url_invalid`, `auth`, `unreachable`, `not_verified`, `stopped`), `nasHeartbeatOutcomes`. Every fixture whose `lastRun.detail` has a `reason` has `lastRun.error` equal to `nasCopyFailureMessage(detail.reason, …)` exactly; the `stopped` fixture (a crash-left row: `detail` null) carries the `stopped` sentence (a schema test checks both).

---

## 4. API contract (FROZEN)

All routes under `/api`, JSON, `cache-control: no-store`, the Stage 0 error shape. Times: `nextRunAt` and `detail.slot` are ISO **with the server's local offset** (as Stage 7); `lastRun.*At` and `lastSuccessAt` are **UTC ISO with milliseconds**, like every `job_runs` row (the web formats both in the server's zone).

### 4.1 Error codes
| Code | Status | When |
|---|---|---|
| `NAS_COPY_NOT_READY` | 409 | `POST /api/backups/nas-copy` while the configuration is not `ready`: `NAS_COPY_OFF_MESSAGE` (off) or the configuration sentence (`url_missing`, `password_missing`, `url_invalid`, `password_invalid`). No `job_runs` row is written. |
| `NAS_COPY_FIX_FIRST` | 409 | `POST /api/backups/nas-copy` while the **refusal lock** holds (§5.9: the newest attempted run was refused with `auth`, `unknown_module` or `refused`, and neither `nas-url` nor `nas-password` has changed since it started): `NAS_COPY_FIX_FIRST_MESSAGE`. No row is written, rsync is not run. Placing the files again with the helper unlocks it by itself (its `mv` gives them a new mtime). |
| `VALIDATION_ERROR` | 400 | (existing) a POST body other than none or `{}`. |
| `CROSS_SITE_REQUEST` | 403 | (existing guard, unchanged) a cross-site POST. |

There is no 500 for the copy: its failures are job results, never HTTP errors.

### 4.2 Endpoints
| Method & path | Request | 2xx | Errors |
|---|---|---|---|
| `GET /api/backups` | — | 200 `BackupsResponse` with **`nasCopy: NasCopyStatusDto`** (required, additive) | — |
| `POST /api/backups/nas-copy` | no body, or `{}` | **202** `NasCopyNowResponse` (the copy runs in the background) | 400, 403, 409 (`NAS_COPY_NOT_READY`, `NAS_COPY_FIX_FIRST`) |
| `GET /api/status` | (Stage 1) | `nasCopy` added (§3.4) | |
| `GET /api/backups/:name` | (Stage 7) | unchanged; `GET /api/backups/nas-copy` is a name that fails the rule → 400 as today | |

`POST /api/backups/nas-copy` is registered **inside the same scoped context as `POST /backups`** (its empty-JSON parser). **Why 202, not "Back up now"'s synchronous 201:** a copy waits up to 10 s for a NAS that is off, and a stalled one up to the 15-minute ceiling; holding a browser request through Umbrel's app proxy that long invites a proxy timeout that would show as an error while the copy carried on. The page polls instead (§8.1).

### 4.3 DTOs (`packages/schema/src/dto/nasCopy.ts`)
```ts
export type NasHeartbeatOutcome = 'sent' | 'failed' | 'off' | 'invalid';

/** The `nas-copy` job's `job_runs.detail` (every field an integer, a boolean or a word this app wrote). */
export interface NasCopyJobDetail {
  configured: NasCopyConfigState;   // at the start of the run
  attempted: boolean;               // rsync was run at least once
  slot?: string;                    // runs the service started with trigger schedule or startup only: the weekly slot, local ISO with offset
  attempt?: number;                 // those runs only: 1..NAS_COPY_MAX_ATTEMPTS (counts attempted, non-stopped failures, §5.9)
  localFiles: number;               // backup files eligible here at the start
  alreadyThere: number;             // of those, on the NAS at the same size before sending
  sent: number;                     // intended names proved on the NAS at the right size afterwards
  missingAfter: number | null;      // intended names still absent or wrong-sized (null: never looked again)
  vanished: number;                 // intended names removed here during the copy (a prune): not counted, not a failure
  onNas: number | null;             // backup-named files the NAS holds after the run (null: not read)
  bytes: number;                    // the sizes of the files proved sent
  durationMs: number;
  reason?: NasCopyFailureReason;    // failed runs only
  exitCode?: number;                // rsync's exit code on a failure (an integer; never its text)
  heartbeat?: NasHeartbeatOutcome;  // absent when no ping was due (§5.8)
}

export interface NasCopyScheduleDto {
  enabled: boolean;                 // config.weeklyNasCopy (§5.1)
  weekday: number;                  // NAS_COPY_WEEKDAY
  hour: number;                     // NAS_COPY_HOUR
  minute: number;                   // NAS_COPY_MINUTE
  timeZone: string;                 // the server's zone
  nextRunAt: string | null;         // §5.9; null unless enabled and configured is 'ready'
}

export interface NasCopyStatusDto {
  configured: NasCopyConfigState;
  configReason: NasCopyConfigReason | null;     // from the CURRENT files (never from lastRun); null when off or ready
  missing: Array<'nas-url' | 'nas-password'>;   // the absent file(s) when 'partial'; [] otherwise
  blockedUntilFilesChange: boolean;             // the refusal lock (§5.9); false unless configured is 'ready'
  schedule: NasCopyScheduleDto;
  running: boolean;
  lastRun: JobRunSummary | null;    // the newest nas-copy run; `error` is always a §4.4 sentence
  lastSuccessAt: string | null;     // finishedAt of the newest succeeded run
  stale: boolean;                   // §5.9
  heartbeat: {
    configured: boolean;            // nas-heartbeat-url holds something
    usable: boolean;                // …and it is an https:// address
    lastPing: 'sent' | 'failed' | null;   // the newest run whose detail.heartbeat is sent or failed
    lastPingAt: string | null;      // that run's finishedAt
  };
}

export interface NasCopyNowResponse {
  joined: boolean;                  // true when a copy was already running
  nasCopy: NasCopyStatusDto;        // the status just after starting (running: true; lastRun is the running row, with its id)
}
```
`nasCopy.lastRun` in the 202 body is **the in-flight row** (the scheduler inserts it synchronously before `copyNow()` returns, and a joined click sees the same row): the page follows that `id` (§8.1).
**There is no field anywhere in these types that an address, a host, an account, a module, a subfolder or a password could travel in.** `NasCopyStatusDto` is built by exactly one server function (`nascopy/status.ts`), which reads the password file only as a boolean.

### 4.4 The sentences (FROZEN; `nasCopyFailureMessage`, every one followed by `" " + NAS_COPY_SAFE_TAIL`)
| Reason | Sentence (before the tail) |
|---|---|
| `url_missing` | `The copy to the NAS is half set up: nas-url is missing, so nothing is copied. Run the NAS set-up helper again.` |
| `password_missing` | `The copy to the NAS is half set up: nas-password is missing, so nothing is copied. Run the NAS set-up helper again.` |
| `url_invalid` | `nas-url is not an rsync://user@host/module address, so nothing is copied. Run the NAS set-up helper again.` |
| `password_invalid` | `nas-password is not usable (it must be one line of text), so nothing is copied. Run the NAS set-up helper again.` |
| `auth` | `The NAS refused the password in nas-password. Check the rsync account on the NAS, then place the password again with the NAS set-up helper (rsync exit code {code}).` |
| `unknown_module` | `The NAS has no rsync module by the name in nas-url. Check the module on the NAS, then place the address again (rsync exit code {code}).` |
| `refused` | `The NAS refused the connection, usually because of a wrong password or module name (rsync exit code {code}).` |
| `unreachable` | `The NAS did not answer. Check it is switched on and reachable over Tailscale (rsync exit code {code}).` |
| `timeout` | `The copy to the NAS stalled and was stopped. No incomplete file is left under a backup's name on the NAS (rsync exit code {code}).` — without `code` (the 15-minute ceiling): the parenthesis is omitted |
| `broken` | `The connection to the NAS broke part way through. No incomplete file is left under a backup's name on the NAS (rsync exit code {code}).` |
| `nas_io` | `The NAS could not store or list the files: it may be full, or the rsync account may not be allowed to read and write the folder (rsync exit code {code}).` |
| `not_verified` | `rsync reported success, but {missing} of {total} files are not on the NAS at the right size.` |
| `readback_failed` | `The files were sent, but the NAS could not be read back, so the copy is not proved (rsync exit code {code}).` |
| `no_rsync` | `rsync is missing from the app image, so nothing can be copied.` |
| `stopped` | `The copy was stopped because the app was shutting down.` |
| `other` | `The copy to the NAS failed (rsync exit code {code}).` |

**`lastRun.error` is always one of these.** A row whose error is anything else (`interrupted` from `markInterruptedRuns`) is shown as the `stopped` sentence (the Stage 7 `withCategoryError` pattern). Nothing rsync printed is ever quoted: stderr is read only against the fixed patterns of §5.7.

### 4.5 The page mapping (FROZEN; web-nas reads exactly these)
`lastRun.status` `running` → pending badge **Running**; `succeeded` → go badge **Succeeded** + `"{sent} sent · {alreadyThere} already there · proved on the NAS"` (+ `" · {vanished} removed here first"` when `vanished > 0`; + `" · {onNas} on the NAS"` when `onNas` is a number); `failed` → failed badge **Failed** + `lastRun.error` in the stop tint. (`partial` is never written by this job.)

---

## 5. Server spec (server-nas)

### 5.1 Configuration
`WEEKLY_NAS_COPY` (`true|false|1|0|yes|no`) → `Config.weeklyNasCopy: boolean`; default **true**, **false under `NODE_ENV=test`** (added to `TEST_DEFAULTS`); an explicit value is honoured under test (as `NIGHTLY_BACKUPS`). Off means no timer and no start-up catch-up; "Copy to NAS now" still works. No other variable: the NAS files are the only configuration, the schedule and limits are constants, and **there is no environment override of the rsync executable** (a knob to run another binary is not wanted; tests inject the runner through `BuildAppOptions`, §5.11).

### 5.2 The NAS files (`nascopy/secrets.ts`)
- Folder `<DATA_DIR>/secrets/`; files `nas-url`, `nas-password`, `nas-heartbeat-url` (`NAS_SECRET_FILES`). **The app only reads them**; it never creates, changes, lists or deletes anything in `secrets/`.
- **Read at run time**, never cached: each copy run, each `GET /api/backups` and `GET /api/status`, and each timer wake read them afresh, so the helper's changes take effect without a restart (D126).
- **Reading one file:** `lstat` must be a regular file (a symlink, a folder or anything else → *present but unusable*), size ≤ `NAS_SECRET_MAX_BYTES`, open with `O_NOFOLLOW` where the platform has it, UTF-8; the value is the **first line** (a trailing `\r` dropped), **trimmed**; empty → *absent*. The helper refuses values with surrounding whitespace, so trimming never changes a real value.
- **The configuration state** (`nascopy/status.ts`, the only place it is decided):
  - `off`: `nas-url` and `nas-password` both absent. (The heartbeat file alone does not make it `partial`.)
  - `partial`: exactly one of the two absent → `missing` names it; reason `url_missing` / `password_missing`.
  - `invalid`: both present but `checkNasUrl` refuses the URL (`url_invalid`), or the password file is unusable (`password_invalid`: not a regular file, too large, or a control character in the line).
  - `ready`: otherwise.
- **The password never leaves `copy.ts`'s local scope**: the status reads the password file only to a boolean (`present && usable`), and only the copy run reads its value, straight into the child's environment (§5.4). No module-level variable, closure or log field holds it.
- **The heartbeat file**: `configured` (present), `usable` (`checkHeartbeatUrl` accepts it). Independent of the copy's state.
- A `secrets/` folder that cannot be read at all (permissions) counts as every file absent **and** logs a warning with the error `code` only, **once per change of that code** (the last code is kept in memory; reads happen on every status poll, every page's `/api/status` and every wake, so a warning per read would flood the log). A test: 10 reads with the same error → 1 warning; a different code → a second one; a clean read resets it.
- **Modification times.** Alongside each value, the reader returns the file's `mtimeMs` (from the same `lstat`), used only by the refusal lock (§5.9) and by the copy's own "changed during the run" check (§5.5 step 3). The mtime is a number; it is never logged or returned in a DTO.
- **`configReason`** (§4.3) is computed here from the current files: `url_missing` / `password_missing` for `partial`, `url_invalid` / `password_invalid` for `invalid` (the URL is checked first), `null` otherwise.

### 5.3 The address rule (`checkNasUrl`, in `@joinr/schema`, shared with the helper's copy)
Accept exactly `rsync://<user>@<host>[:<port>]/<module>[/<subfolder>][/]`:
- Whole-string checks: trimmed; no whitespace inside; parses with the WHATWG `URL`; protocol `rsync:`; **no password** (`user:pw@` refused: the password belongs in `nas-password`, and in the URL it would ride into rsync's argv); no query, no fragment.
- `user`, `module` and `subfolder` (percent-decoded) match `^[A-Za-z0-9][A-Za-z0-9._-]*$` (an allowlist: a leading dash, a space, a slash or a dot-dot is refused).
- **Never throws, for any input.** WHATWG `URL` accepts malformed escapes in the non-special `rsync:` scheme (`rsync://u%zz@h/m`, `/m%E0%A4%A`) on which `decodeURIComponent` throws `URIError`; every decode (and the `URL` constructor) is inside a `try`, and any throw is `{ ok: false, configured: true }`. This matters because `checkNasUrl` runs inside `status()`, i.e. on every `GET /api/backups` and `GET /api/status`: a typo in `nas-url` must show the `invalid` state, never turn every page's status call into a 500. `checkHeartbeatUrl` has the same guarantee and also **refuses userinfo** (`https://u:p@…` or `https://u@…`): Node's `fetch` refuses such URLs, so they would fail every ping while the page said "usable".
- `host`: a DNS name or IPv4 (`^[A-Za-z0-9.-]+$`) or a bracketed IPv6; optional port 1–65535.
- Path depth 1 or 2 segments (module, optional one subfolder); deeper is refused (rsync, never told to recurse, creates at most the last folder of a destination).
- Result: the canonical `rsync://<user>@<host>[:<port>]/<module>[/<subfolder>]/` **ending in `/`** (a destination without it would make rsync write a single source under the destination's name) and `hasSubfolder`.
- A refusal returns `{ ok: false, configured }` only (§3.2).

### 5.4 The rsync runner (`nascopy/runner.ts`)
`runRsync(args, { password?, signal, outputLimit }) → Promise<{ code: number; out: string; err: string; outTruncated: boolean }>` (FROZEN; `outTruncated` is true when stdout passed `outputLimit` and was cut):
- `spawn(RSYNC_EXECUTABLE, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'], env })` with **`env` built from scratch**: `{ PATH: process.env.PATH, LC_ALL: 'C', RSYNC_PASSWORD: password }` (the password key only when given) — **never `process.env` spread**, so nothing else leaks in and `RSYNC_RSH`, `RSYNC_PROXY`, `RSYNC_CONNECT_PROG` or a stray `RSYNC_PASSWORD` can never reach the child. (On `win32` only, `SystemRoot` is added so a test's Node child can start; never on Linux.)
- **`HOME` is deliberately absent.** Client-side rsync reads popt aliases from `$HOME/.popt` (and `/etc/popt`); an alias there could silently add `--delete` or `--remove-source-files` to every invocation, invisible to both pins. Without `HOME` rsync reads no per-user alias file, and the image proves `/etc/popt` and `/etc/popt.d` absent at build time (§7). The runner test's **exact-keys** assertion stops `HOME` (or anything else) being added back.
- **The password is checked before any spawn:** the copy refuses a password containing any control character (NUL included) as `password_invalid` (§5.2) before the runner is called, so `spawn`'s `ERR_INVALID_ARG_VALUE` (whose message quotes the offending env value, i.e. the password) cannot happen.
- **The password is never an argument and never a file** (`--password-file` would need a file rsync insists is private on a bind mount, and argv is visible to every process that can list processes). The destination URL in argv carries the user and host but no password; that exposure is inside the app's own container and accepted (§14).
- It **resolves on any exit code** (a refusal is information for §5.7) and **rejects only** when the child cannot start (`ENOENT` → a `RsyncMissingError`; anything else → a `RsyncStartError` carrying the `code`), or when `signal` aborts (SIGTERM, then SIGKILL after `RSYNC_KILL_GRACE_MS`; rejects with an `AbortError` carrying *why*: `'stopped'` or `'deadline'`, **at the latest `RSYNC_KILL_GRACE_MS + 500 ms` after the abort, whether or not the child has reported its exit**, so a child that ignores signals can never hold the app's shutdown).
- **The error objects are built fresh**, from `err.code` only: `new RsyncMissingError()` / `new RsyncStartError(code)` with a fixed message, **no `cause`, no spread, and no copy of `spawnargs`, `path` or the original `message`** (Node's spawn error carries `spawnargs`, i.e. the full argv with `rsync://user@host/module/`, and `path`; the scheduler's pino err serializer would log every enumerable property and `cause`). The original error object is dropped on the spot.
- stdout kept up to `RSYNC_OUTPUT_LIMIT`, stderr up to 64 KiB; beyond that, discarded and `outTruncated: true`. A truncated listing is never parsed as "the NAS is missing these": the first listing truncated → `failed`, `other` (with `exitCode`); the relist truncated → `readback_failed` (§5.5, C23).
- **The spawn is injectable for tests only** (`runRsync(args, opts, spawnImpl = spawn)`): the kill escalation is tested with a fake `ChildProcess` on a fake clock (§5.13), because on win32 `kill('SIGTERM')` ends a process outright and a Node child cannot ignore it. The read-only pin allows this one test-only parameter.

### 5.5 The copy (`nascopy/copy.ts`): `copyToNas({ dataDir, signal, runner, now }) → Promise<NasCopyOutcome>` — never throws
The outcome is `{ status: 'succeeded' | 'failed'; detail: NasCopyJobDetail (without heartbeat/slot/attempt); error?: string }`. Steps:
1. **Read the files** (§5.2), keeping the two files' `mtimeMs`. `off` → the caller never gets here (§5.9, §5.11). `partial` / `invalid` → `failed`, `attempted: false`, the configuration reason, no rsync. (The password's control-character check, NUL included, is part of this step: nothing reaches `spawn` that could make it throw with the value in its message, §5.4.)
2. **Local files:** `listBackupFiles(dataDir)` (the Stage 7 lister: regular files matching `BACKUP_FILE_NAME_RE` in the flat `backups/` folder, so never a hidden `.partial`, a `.unverified-pre-restore-*` folder, a symlink or a foreign file), with sizes. **Future-dated files are included** (they are verified files). `localFiles` = the count.
3. **List the far side:** `rsync --times --contimeout=10 --timeout=120 --list-only -- <url>`. Parse (§5.6). On a non-zero exit, classify (§5.7); the one exception: **exit 23 with a configured subfolder and stderr matching `/No such file or directory/`** means the subfolder does not exist yet → the remote is empty (the send creates it). A zero exit with `outTruncated` → `failed`, `other` (C23). **A refusal while the files changed:** when this listing (or the send) classifies as `auth`, `unknown_module` or `refused`, the copy re-`lstat`s `nas-url` and `nas-password`; if either `mtimeMs` differs from step 1, the helper replaced the pair during the run (a new URL read with the old password, say), and the reason recorded is **`other`** (retryable, no lock), never a refusal.
4. **Plan:** for each local file, the NAS holds the name at the **same byte size** → `alreadyThere`; otherwise (absent, or a different size, or an unreadable size) → **send**. Sorted **newest first** (the Stage 7 name order, reversed). Nothing to send → `succeeded`, `sent: 0`, `missingAfter: 0`, `onNas` from this listing; no second invocation.
5. **Send, in one invocation:** `rsync --times --contimeout=10 --timeout=120 -- <abs path>… <url>` — every source is `path.join(<DATA_DIR>/backups, name)` with `name` re-validated by the rule; `--` precedes the operands. (rsync may sort its file list internally, so newest-first is the order handed over, not a promise about the wire; for a few MB in one connection it does not matter, and the proof below is what counts.)
   - Exit `0`, `23` or `24` → go on to step 6 (24: a source vanished, i.e. a Stage 7 prune ran meanwhile; 23: a partial transfer, decided by the proof). `attempted` is `true` from the moment the first listing is spawned (so a missing rsync is an attempted copy, C12).
   - Any other exit → `failed` with the classified reason (§5.7), `sent: 0`, `missingAfter: null` (nothing is claimed; next week's plan repairs it).
6. **Prove:** list the far side again (same command as step 3). Non-zero, or `outTruncated` → `failed`, `readback_failed`. Otherwise, for each intended name, compare the NAS size with the **size recorded in the plan** (step 4): equal → **sent**; not equal and the name is **gone locally** (re-`lstat`: pruned by retention while rsync ran) → **vanished** (leaves the intended set; the NAS does not need it); otherwise → missing. `missingAfter` = the missing count; `bytes` = the sizes of the sent names; `onNas` = backup-named files in this listing.
7. **Decide:**
   - `missingAfter > 0` → `failed`, reason **`nas_io` if the send exited 23, else `not_verified`** (with `{ missing, total }`).
   - Else → `succeeded`.
8. **Deadline and stop:** the whole copy (including the `whenIdle()` wait before it) runs under `AbortSignal.any([ctx.signal, serviceStop.signal, AbortSignal.timeout(NAS_COPY_TIMEOUT_MS)])`, where `serviceStop` is **the service's own `AbortController`**, aborted by `nasCopy.stop()` (the scheduler has no per-job abort, §header). An abort from `ctx.signal` or `serviceStop` → `failed`, **`stopped`**; only the deadline → `timeout` without a code. `copyToNas` receives the combined signal and tells the two apart by which source aborted (the runner's `AbortError` reason).
9. **Never throws:** the body is wrapped; anything unexpected (a thrown runner, a `listBackupFiles` error, a bad listing) becomes `failed`, `other`, `attempted` as it stood, and one error log with the error's `code` or `name` only (**never `{ err }`**: pino's err serializer would print the message, the stack, `cause` and every enumerable property). The job's `run(ctx)` (§5.11) has a second wrapper of the same kind around everything else it does (the status read, the heartbeat, the `job_runs` reads), so **the scheduler's own `{ err }` log and its `err.message` → `job_runs.error` path are never reached** by this job (tested: §5.13 leak cases).

**Only adds.** No flag in §3.3 deletes, mirrors, recurses, appends, writes in place or keeps a partial file; rsync's default behaviour writes each file to a hidden temporary name in the destination and renames it into place only when complete, so an interrupted copy leaves no half file under a backup's name (a hidden temporary, if the NAS's rsync ever left one, does not match the name rule and is ignored by every listing). **A name held on the NAS at a different size is sent again** (rsync replaces it through that same temporary-and-rename, never in place): the local file is a verified, immutable copy and a wrong-sized namesake on the NAS is a damaged copy (owner question 1 offers the alternative).

### 5.6 Reading a listing (`nascopy/listing.ts`, pure)
`parseListing(text) → { name: string; bytes: number }[]` (pure; server-side, so it uses the Stage 7 `parseBackupName`):
- Split on `\n` (a trailing `\r` dropped; the last line may lack a newline). Each line must match the **anchored** pattern `^(-[rwxsStT-]{9})[.+@]?\s+([\d,]+)\s+(\d{4}/\d{2}/\d{2})\s+(\d{2}:\d{2}:\d{2})\s(.+)$`; any other line is skipped (a daemon MOTD, a directory `d…`, a symlink `l…`, a device `c…`/`b…`, a fifo `p…`, a socket): **only regular files** (mode starting `-`) are read.
- **The name is the whole remainder** after the time and one space (never "the last field": a foreign `copy of nightly-….db` must not parse as the backup `nightly-….db`), and it is kept only when `parseBackupName(name) !== null` (the same rule as the local lister: calendar-valid date and time, offset within ±14:59, ≤ 64 characters). Foreign files, hidden temporaries and anything else are ignored, never counted, never touched.
- The size is group 2 with the `,` separators removed; anything but digits and commas cannot match, so the size is always a number here.
- **A name that appears twice** (it should not in a flat listing) gets size `NaN`: unreadable, so it is sent again and proved (the safe direction); `onNas` counts it once.

### 5.7 Classifying a refusal (`nascopy/sentences.ts`, pure)
`classify(phase: 'list' | 'send' | 'relist', code: number, stderr: string, ctx) → NasCopyFailureReason`, reading `stderr` only for the fixed patterns below and **never returning or logging any part of it**.

**Patterns first** (phases `list` and `send`, any non-zero exit, in this order): `/max connections/i` → **`other`** (a transient daemon refusal, "try again later": retryable, no lock, no fail ping); `/read only|write only/i` → **`nas_io`** (the module does not allow the write, or the listing); then the table:

| Exit | `list` | `send` | `relist` |
|---|---|---|---|
| 5 | `/auth failed/i` → `auth`; `/unknown module/i` → `unknown_module`; else `refused` | same | `readback_failed` |
| 35 | `unreachable` | `unreachable` | `readback_failed` |
| 10 | `unreachable` (no connection: a refused port, a name that does not resolve) | `broken` | `readback_failed` |
| 12 | `broken` | `broken` | `readback_failed` |
| 30 | `timeout` | `timeout` | `readback_failed` |
| 11 | `other` | `nas_io` | `readback_failed` |
| 23 | the subfolder exception of §5.5 step 3, else `other` | (goes on to the proof) | `readback_failed` |
| 24 | `other` | (goes on to the proof) | `readback_failed` |
| any other | `other` | `other` | `readback_failed` |
| spawn `ENOENT` | `no_rsync` | `no_rsync` | `no_rsync` |
| abort | `stopped` / `timeout` | same | same |

`exitCode` is recorded for every failure that had one. A refusal (`auth`, `unknown_module`, `refused`) becomes `other` when the NAS files changed during the run (§5.5 step 3). *Accepted limit:* a send exit 23 caused by a **local** read error is also labelled `nas_io`; the local files are verified, immutable copies, so this is not expected, and the reason is retryable either way.

### 5.8 The heartbeat (`nascopy/heartbeat.ts`)
- `nas-heartbeat-url` is **a credential** (whoever has it can silence the alarm): never logged, returned, stored in `job_runs` or shown; only its outcome is.
- `https:` only (`checkHeartbeatUrl`); an `http:` or unparsable value → outcome `invalid`, nothing sent, one warning per run naming the **file**, never the value.
- **Success ping**: `POST <url>` (bare). **Fail ping**: `POST <url>/fail` (built through `URL`: a trailing slash never doubles; a query string survives). No body, no custom header, `redirect: 'error'`, signal **`AbortSignal.any([AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS), serviceStop.signal])`**: independent of the copy's 15-minute deadline (so a copy stopped at its ceiling can still report) but cut short by shutdown; **one retry** after `HEARTBEAT_RETRY_DELAY_MS` (the delay is abortable by `serviceStop` too). A 2xx → `sent`; anything else (a status, a thrown error of any kind, a non-response) → `failed`, logged with the status or the error's `name` only. **`fetch` is called inside a `try`** and its errors are never logged as objects: a malformed URL makes `fetch` throw a `TypeError` whose message quotes the URL, and undici's `cause` names the host.
- **When** (decided in the service, recorded as `detail.heartbeat`; no ping → the field is absent):
  - a `succeeded` copy (any trigger) → success ping;
  - a `failed` **schedule or startup** run with `attempted: true`, a reason **other than `stopped`**, and either a **non-retryable** reason or `attempt === NAS_COPY_MAX_ATTEMPTS` → fail ping (the slot is given up, or locked by a refusal);
  - **no ping for `stopped`**, ever: a stop is a shutdown (an Umbrel restart, an Update), the next start's catch-up decides, and a ping during shutdown would eat the 10 s budget (§5.10);
  - **no ping**: a failed manual copy (the owner is looking at the page), a retryable failure with attempts left (the retry may still succeed; an alarm now would be noise), a run with `attempted: false` (a half-set-up copy never pings, so the monitoring service sees silence and raises its alarm after its grace period: the dead man's switch doing its job).
- **It never throws and never changes the copy's outcome**; the ping happens inside the job, after the copy's result is known and before the job returns, so the outcome lands in the same `job_runs` row.

### 5.9 The schedule, the due rule, the catch-up and the retries (`nascopy/schedule.ts`, `nascopy/service.ts`)
**The slot.** `W(t)` = the latest **Sunday 03:00 local** ≤ `t`: with `t`'s local date `y-m-d` and weekday `w`, `s = new Date(y, m, d − w, 3, 0)`; if `t < s` (a Sunday before 03:00) then `s = new Date(y, m, d − w − 7, 3, 0)`. `nextSlotAfter(t)` = `new Date(y', m', d' + 7, 3, 0)` from `W(t)`'s date (**calendar** arithmetic, never `+ 7 × 24 h`).

**Settled.** `W` is settled at `t` when any of these holds, read from `job_runs` (so it survives restarts):
- (a) a `succeeded` `nas-copy` run (**any trigger**) with `W ≤ startedAt ≤ t + NAS_COPY_FUTURE_SLACK_MS`;
- (b) a `failed` run with `detail.slot = iso(W)` and reason **`no_rsync`** (the image cannot copy until it is rebuilt; given up for the slot);
- (c) a `failed` run with `detail.slot = iso(W)` and a **configuration reason**, **while the configuration is still not `ready`** (once the owner fixes the files, the slot is due again);
- (d) at least `NAS_COPY_MAX_ATTEMPTS` `failed` runs with `detail.slot = iso(W)`, **`detail.attempted === true` and a reason other than `stopped`** (a configuration failure from before the owner fixed the files, or a stop by an Umbrel restart or Update, is not an attempt).

Refusals (`auth`, `unknown_module`, `refused`) settle nothing by themselves: **the refusal lock** below holds everything back instead, until the files change.

**The refusal lock (decided; D126's "never retry a refusal", made to cover the button as well).** `blocked(t)` holds when **the newest `nas-copy` run with `detail.attempted === true`** (any trigger; runs dated after `t + NAS_COPY_FUTURE_SLACK_MS` ignored) failed with a reason in `NAS_COPY_REFUSAL_REASONS`, **and neither `nas-url` nor `nas-password` has an `mtimeMs` later than that run's `startedAt`**. While it holds: `copyNow()` refuses with 409 `NAS_COPY_FIX_FIRST` (no row, no rsync); the timer starts nothing (`due` is false); `nextRunAt` is `null`; the status shows `blockedUntilFilesChange: true` and `/api/status` `blocked: true`. The helper's commit (`mv` of freshly written files) gives both files a new mtime, so **running the helper again unlocks it by itself**, and the slot (not settled by a refusal) is then due again: **exactly one login attempt per placement**, whether it comes from the timer within the hour or from a click. *Why:* the NAS's brute-force protection has blocked this Umbrel's address before (private §1); a block would also stop the owner's Joinr Backup app (`tenon`) copying to the same NAS, and every click on a wrong password would otherwise be one more failed login.

**Due.** `due(t) = config.weeklyNasCopy && configured(t) ≠ 'off' && !blocked(t) && !settled(W(t))`. (`partial` / `invalid` are due so that the slot records one failed run with the configuration sentence; `off` is silence: no row, no sentence, D126 "off until they exist".)

**Which runs are slot attempts.** Only runs **the service itself starts** with trigger `schedule` or `startup` carry `slot` and `attempt`. A wake never joins a copy in flight: `wake()` checks `scheduler.isRunning('nas-copy')` first and, if a copy runs (a click), starts nothing and re-plans in that run's `finally` (the `.then(replan, replan)` `copyNow()` already attaches). A manual run never carries `slot`; its success settles `W` by rule (a) only when it **started** at or after `W`, and its refusal engages the lock like any other.

**Start-up catch-up (decision, D128).** At `start()` (enabled), `catchUpAt = start + NAS_COPY_STARTUP_DELAY_MS` (5 min: after the Stage 7 backup's 2-minute catch-up, so a copy after downtime includes the catch-up nightly file). A slot that **passed before the start** waits for `catchUpAt` (trigger `startup`); a slot that comes round **after** the start runs on time (trigger `schedule`). The rule: **at start-up, if the last successful copy is older than the last slot (i.e. `W(now)` is not settled), one copy is taken**, never more than one however many Sundays were missed. *Why:* an Umbrel reboot or an app update across Sunday 03:00 would otherwise skip a whole week; because the app keeps only the 14 newest nightly dates, **two** missed weeks can lose nightly copies the NAS never received, so one catch-up per start keeps every nightly flowing; one copy of a few MB costs nothing; and nothing is back-dated.

**Retries.** After a failed schedule/startup run with a **retryable** reason: `retryAt = now + NAS_COPY_RETRY_DELAYS_MS[attempt − 1]` (1 h, then 2 h, then 4 h: attempts at about 03:00, 04:00, 06:00, 10:00); after attempt 4 the slot is settled by rule (d). `retryAt` lives in memory; after a restart the catch-up gate applies instead, and the attempt number continues from `job_runs` (`attempt` = the count of failed runs for the slot **with `attempted === true` and a reason other than `stopped`**, + 1: the same count as rule (d), so the in-memory and persisted views never diverge). A `stopped` run sets no `retryAt` (the process is exiting; the next start's catch-up decides).

**Timer.** `planNext(now, { enabled, due, retryAt, catchUpAt }) → { runNow, wakeAt, nextRunAt }` (pure, as Stage 7's `planNext`): a due slot runs once every gate (a pending retry, the armed catch-up) has passed; `wakeAt = min(nextSlotAfter(now), now + NAS_COPY_WAKE_MAX_MS, gates…)`. The **1-hour wake cap** keeps the timer right across DST changes, clock corrections and `setTimeout`'s limit, and means **a slot that becomes due while the app runs** (the owner places the files mid-week; a restore brings back an older `job_runs`) is copied within the hour even if nobody clicks.
**`nextRunAt`** (status): `null` unless `enabled`, `configured = 'ready'` and not `blocked`; when not due: `nextSlotAfter(now)`; when due: the later of the gate and the timer's armed wake (the time the run will actually start, at most an hour away); while a copy runs: the run after it (as Stage 7). Local ISO with offset. **`status()` never starts a copy.**

**The DST cases (Australia/Melbourne; tests pin `process.env.TZ` at the top of the file):**
| Case | Slot `W` | Instant | Notes |
|---|---|---|---|
| Ordinary Sunday, 15/09/2030 | 03:00 AEST (+10:00) | 14/09/2030 17:00Z | the nightly ran at 02:30, 30 minutes earlier |
| **October change**, Sunday 06/10/2030 (also **Sunday 04/10/2026, the first slot after this release**) | **03:00 AEDT** (+11:00): the first instant after the 02:00 → 03:00 gap | 05/10/2030 16:00Z | that day's nightly slot is **03:30 AEDT** (Stage 7's gap rule): the copy runs **30 minutes before** that day's nightly, which therefore goes the following week. Nothing waits for it (decided: the order is harmless). |
| **April change**, Sunday 07/04/2030 (also Sunday 04/04/2027) | **03:00 AEST** (+10:00), once: the repeated hour is 02:00–02:59 | 06/04/2030 17:00Z | the nightly ran at the first 02:30 AEDT, 90 minutes of real time earlier |
| The week that contains a change | 7 local days = **167 h** (October) or **169 h** (April) of real time | — | calendar arithmetic; a `+ 7 × 24 h` bug would drift the slot an hour; tested |

**Worked examples (schedule; `ready`, enabled unless stated):**
| # | Situation | What happens |
|---|---|---|
| S1 | Up all week | One run at Sunday 03:00 (`schedule`, attempt 1); `W` settled by (a). |
| S2 | Down from Saturday 22:00 to Monday 10:00 | Start at 10:00; the 10:02 backup catch-up; the copy at **10:05** (`startup`); settled. The next Sunday as usual. |
| S3 | Down for three Sundays | One copy 5 minutes after the start; the missed weeks' files are all in that one copy (the plan is over every kept file). |
| S4 | Started Sunday 02:58, last Sunday's copy succeeded | Not due (last week's `W` is settled); at 03:00 the new slot runs **on time** (`schedule`, not delayed by the catch-up gate). |
| S5 | The NAS is off from Saturday to Tuesday | 03:00 `unreachable` (attempt 1) → 04:00 → 06:00 → 10:00 (attempt 4, **fail ping**) → settled by (d); **stale** from Monday 03:00 (8 days after the previous Sunday's success) until a copy succeeds: a click once the NAS is back, or the next Sunday, which copies everything missed. |
| S6 | A wrong password | 03:00 `auth` → **no retry**, **fail ping**, the **refusal lock** holds: the button is greyed out with "Place the password again with the NAS set-up helper first", a POST gets 409 `NAS_COPY_FIX_FIRST`, the timer starts nothing, the every-page callout shows. The owner re-runs the helper (new mtimes) → unlocked → the slot is due again → **one** copy within the hour, or at once if he clicks (the helper says so). Still wrong → locked again after that single login. |
| S7 | The files placed on a Wednesday (the feature was off) | `W` (last Sunday) is not settled → within the hour (the wake cap) one copy runs (`schedule`); the RUNBOOK tells the owner to click "Copy to NAS now" anyway. |
| S8 | A manual copy on Saturday | Sunday 03:00 still runs (it is a newer `W`) and sends only what is new. A manual copy on Sunday 09:00 after a failed 03:00 attempt succeeds → settled by (a); the pending retry finds nothing due. |
| S9 | The clock jumps back a day | A run recorded "in the future" (`startedAt > now + 10 min`) settles nothing; the re-lived slot runs once. |
| S10 | A restore of an older database | Its `job_runs` roll back; after the start `W` may be unsettled → one catch-up copy, which sends only what the NAS lacks. |
| S11 | `WEEKLY_NAS_COPY=false` | No timer, no catch-up, `nextRunAt: null`; "Copy to NAS now" works. |
| S12 | Half set up at the slot | One `failed` run with the configuration sentence (`attempted: false`), no ping, no retries; settled by (c) until the configuration changes. When the owner then completes the files, the next copy is **attempt 1** (the configuration failure is not an attempt, rule d). |
| S13 | A manual copy started Sunday 02:59 that finishes at 03:01 | The 03:00 wake sees `isRunning('nas-copy')`, starts nothing and re-plans when the manual run ends; the manual run started before `W`, so it settles nothing; **exactly one** `schedule` run for `W` follows at once, attempt 1 (it sends only what the manual copy did not). If the manual run was refused, the lock holds and nothing follows. |
| S14 | Three Umbrel restarts during a slot's retries (each copy `stopped`) | No `stopped` run counts (rule d) or pings; each start's catch-up tries again; the slot still gets 4 real attempts. |
| S15 | A refused manual click at 02:58 Sunday | The lock holds: the 03:00 slot starts nothing (no second failed login); the page and the callout say why. |

**Stale (D128 signal, decided).** `stale = enabled && configured = 'ready' && ref !== null && now − ref > NAS_COPY_STALE_HOURS` where `ref` = the newest succeeded run's `finishedAt`, else the `startedAt` of the oldest kept `nas-copy` run **with `detail.attempted === true`** (so a copy that has never succeeded goes stale 8 days after its first real attempt; rows written while half set up do not count), else **`stale` is false** (the within-the-hour copy decides); runs dated after `now + NAS_COPY_FUTURE_SLACK_MS` are ignored. (A test: 10 days of `partial` rows, then `ready` → not stale until an attempted failure is 8 days old.) *Why 8 days:* a single missed Sunday plus a day of grace; the app keeps 14 nightly dates, so the owner is warned about a week before the oldest nightly copy the NAS has not received could be pruned here (monthly copies stay 12 months). `/api/status` carries `{ configured, configReason, blocked, stale, lastSuccessAt }` (`lastSuccessAt` local ISO with offset, §3.4); the web adds the half-set-up, unusable and locked cases (§8.4).

### 5.10 Concurrency
- **One `nas-copy` job** through the scheduler: a click while a copy runs **joins** it (`joined: true`, 202). A timer wake during a manual copy **never joins** it: it starts nothing and re-plans when that run ends (§5.9 "Which runs are slot attempts", S13).
- **The backup job:** a copy run first awaits **`backups.whenIdle()`** (additive on `BackupService`: resolves once no tracked backup attempt is in flight; immediate in production, where a backup is synchronous) so a copy never starts in the middle of one. A backup that runs **while rsync runs** can prune a file the copy intends to send: rsync exits 24 (or the file is simply absent) and step 6 counts it as **vanished**, never a failure. A file a backup writes during the copy is not in the plan; it goes next time.
- **Imports** (and their pre-import backups): independent; a copy may run during an import (it reads only finished backup files). The `IMPORT_IN_PROGRESS` rule does **not** apply to the copy.
- **Restore:** the restore CLI runs only with the app stopped (Stage 7), so it never meets a copy. Stopping the app (Umbrel Stop, Update, `--stop`) calls `nasCopy.stop()` first in `preClose`. **The budget is `FORCE_EXIT_MS` = 10 s for the whole `preClose`** (not the container's 30 s), so `stop()`: sets `stopping` (no new run, no re-plan), clears the timer, **aborts the service's own `AbortController`** (`serviceStop`; the copy, its `whenIdle()` wait and any heartbeat ping all listen to it, §5.5 step 8, §5.8), then awaits the tracked run promise for at most `NAS_COPY_STOP_BUDGET_MS` (4 s). The runner kills rsync (SIGTERM, SIGKILL after `RSYNC_KILL_GRACE_MS` = 2 s) and rejects by 2.5 s at the latest; the copy records `failed`/`stopped` with **no ping**; the job returns; the scheduler writes the row. If the budget still runs out (it should not), `stop()` logs one warning and returns, and `scheduler.stop()` awaits the same, by then settled, promise. The next start's catch-up copies again. A restored database brings back its own `job_runs` (S10).
- **Downloads:** independent (both only read the files).
- **Two copies of the app** never share a data folder (Umbrel runs one container), so there is no cross-process lock.

### 5.11 Wiring, routes and status (`app.ts`, `index.ts`, `routes/backups.ts`, `routes/status.ts`)
- `createNasCopyService({ database, config, scheduler, backups, log, clock?, now?, runner?, fetch? })` → `NasCopyService { start(); stop(); copyNow(): { joined: boolean }; status(): NasCopyStatusDto; problem(): AppStatus['nasCopy'] }`; it registers the job `{ name: 'nas-copy', intervalMs: 0, run }` (manual-only in the scheduler; the service decides when). Decorated as `app.nasCopy`; `index.ts` starts it **after** `app.backups.start()`; `preClose` stops it **first** (before backups, the recorder and the scheduler). `BuildAppOptions` gains `nasCopyClock?`, `nasCopyRunner?`, `nasCopyFetch?` (test seams, like `backupClock`/`backupCopy`).
- **The job's `run(ctx)`**: `await backups.whenIdle()` (abortable, §5.5 step 8); read the configuration; trigger `manual` and not `ready` cannot happen (the route refuses first) but is handled (`failed` with the configuration reason); `copyToNas` with `AbortSignal.any([ctx.signal, serviceStop.signal, deadline])`; add `slot` and `attempt` for the service's own `schedule`/`startup` runs; the heartbeat (§5.8); return `{ status, detail, error }`. It catches everything (a second wrapper, §5.5 step 9); the scheduler never sees a throw.
- **`copyNow()`**: `configured ≠ 'ready'` → throws the 409 `HttpError` (`NAS_COPY_NOT_READY`, the §4.1 message); a copy in flight → `joined: true` (no new run); `blocked` (§5.9) → throws the 409 `HttpError` (`NAS_COPY_FIX_FIRST`); otherwise `void scheduler.run('nas-copy', 'manual').then(replan, replan)` (the promise is tracked so `stop()` waits for it; a `SchedulerStoppedError` during shutdown lands in `replan`, which does nothing once `stopping`); returns `{ joined }` at once.
- `GET /api/backups` adds `nasCopy: app.nasCopy.status()`; `POST /api/backups/nas-copy` (empty body or `{}` → `copyNow()` → 202 `{ joined, nasCopy: status() }`); `GET /api/status` adds `nasCopy: problem()` when the decorator exists.

### 5.12 Logging and leak discipline
- Log lines carry only: the trigger, the configuration **state word**, counts, bytes, durations, the reason, the exit code, the heartbeat outcome, an error's `code` or `name`. **Never** the URL or any part of it, the password, the heartbeat URL, rsync's stdout or stderr, a local path, or an error's `message`.
- `job_runs.detail` and `.error`, every DTO and every error body obey the same rule (§4.3, §4.4).
- A test plants distinctive values (a user, a host, a module, a subfolder, a password, a heartbeat token) and asserts none appears in: every `job_runs` row, every `GET /api/backups` and `/api/status` body, every error body, the captured pino output of the whole suite, and every outcome of `copyToNas` in every scenario (§5.13). **The specific leak objects are exercised**, not only the happy paths: (a) a fake spawn that emits an `Error` carrying `spawnargs: [planted url]`, `path`, a `cause` and a planted `message`; (b) a password file containing `\0` → `password_invalid`, the runner **never called**; (c) a heartbeat URL on which the fake `fetch` throws a `TypeError` quoting it (with a `cause` naming the planted host); (d) a copy dependency forced to throw an error whose message, `cause` and properties carry every planted value, asserting the job still returns a result (the scheduler's `'job failed'` line never appears) and neither the pino output nor `job_runs.error` contains any planted value.
- The grep list of every leak assertion (server, smoke §9.2, Verifier §12 #7): the planted user, host, module, subfolder, password, **heartbeat token**, and `rsync://`.

### 5.13 Server tests (server-nas; temp dirs, fake clocks, fake runners; never `data/`, never a network, never a real rsync)
- **Windows rules** (Stage 7): close every better-sqlite3 connection before `rmSync`; never remove a file a test holds open.
- `test/nascopy/url.test.ts` (on the schema function): ≥ 40 cases accepted/refused (§5.3): each scheme, `user:pw@`, query, fragment, spaces inside, tabs, trailing newline trimmed, empty user, a leading dash or dot in each segment, `..`, percent-encoded `/` and `..`, depth 0 and 3, a port (valid, 0, 65536), bracketed IPv6, an empty host, canonical trailing slash added, `hasSubfolder`; **malformed escapes that must refuse without throwing**: `%zz` in the user, a truncated `%E0%A4%A` in the module, `%00`, `%2F`, `%2E%2E`; a refusal object has exactly the keys `ok` and `configured`. `checkHeartbeatUrl`: `http:`, `https://u:p@…`, `https://u@…`, a malformed escape, a non-string → refused, never a throw.
- `test/nascopy/secrets.test.ts`: absent, empty, whitespace-only, CRLF, two lines (first taken), oversize, a symlink, a folder, an unreadable folder (skipped with a printed reason where the platform cannot `chmod` it) → the four states, `configReason` and `missing`; a change between two reads is picked up; the heartbeat file alone keeps `off`; `mtimeMs` returned; **10 reads of an unreadable folder → 1 warning**.
- `test/nascopy/listing.test.ts`: real-shaped `--list-only` output (commas, the `.` line, subfolders, foreign files, a hidden temporary `.nightly-….db.Ab12Cd`, a 70-character name), CRLF line ends, and: **a name with a space around a valid backup name** (`copy of nightly-….db` → ignored), **a symlink line pointing at a backup name** (ignored), **a MOTD block** before the listing, a `crw-` and a `prw-` line, **a duplicated name** (→ `NaN`), a calendar-invalid backup-looking name (ignored), a last line without a trailing newline.
- `test/nascopy/plan.test.ts`: missing, same size, different size, `NaN`, newest-first order across kinds, foreign remote names ignored.
- `test/nascopy/sentences.test.ts`: the §5.7 patterns (`max connections (4) reached -- try again later` → `other`; `module is read only`, `module is write only` → `nas_io`, in `list` and `send`) and table by phase; stderr planted with the URL, the user, the module, the password and a path → the reason is right and **no sentence contains any of them**; every §4.4 sentence byte-exact, each ending with the tail; `code` interpolation and the code-less `timeout`.
- `test/nascopy/runner.test.ts` (**the real runner, with `process.execPath` as the child** via an injectable executable used only by this test): the child sees **exactly** `PATH`, `LC_ALL=C` and `RSYNC_PASSWORD` (plus `SystemRoot` on win32), even with `RSYNC_RSH`/`RSYNC_PROXY`/`RSYNC_PASSWORD` planted in the parent's env; argv passed verbatim with `shell: false`; the exit code resolved; **stdout capped (`outTruncated === true`, `out.length === limit`)**; `ENOENT` → `RsyncMissingError` with no `cause`, `spawnargs` or `path`, on every platform. **The kill escalation** is a separate test with the injected spawn (§5.4) returning a fake `ChildProcess` (an `EventEmitter` with a `kill` spy and stdout/stderr streams) on a fake clock: an abort → `kill('SIGTERM')`, `kill('SIGKILL')` after `RSYNC_KILL_GRACE_MS`, rejection with the reason by grace + 500 ms even when the fake child never emits `close` (on win32 a real child cannot ignore SIGTERM, so a real-child version would be vacuous).
- `test/nascopy/copy.test.ts` (fake runner answering listings and exit codes; a temp `DATA_DIR` with real Stage 7 names): the §5.15 examples **C1–C24** exactly (counts, status, reason, `exitCode`, `attempted`, `onNas`, and the sentence text); the refusal-with-changed-files case (§5.5 step 3: the fake runner answers `auth` after the test rewrites `nas-password` → `other`); **argv pins**: the listing is exactly `[...RSYNC_FLAGS, '--list-only', '--', url]`, the send exactly `[...RSYNC_FLAGS, '--', ...absSources, url]` with sources newest first, each under `backups/`, the URL ending `/`; **the password appears only in the child env, never in argv**; hidden, `.partial`, symlinked and foreign local files are never sources; **never throws** (the secrets folder unreadable, the runner throwing synchronously, rejecting, resolving garbage, a file vanishing between list and stat, `listBackupFiles` throwing); every outcome free of the planted values.
- `test/nascopy/readonly.test.ts` (the pin): (1) a **source scan** of `apps/server/src/nascopy/**` and `packages/schema/src/nasCopy.ts` with comments stripped (block comments first): none of `--delete` (any form), `--del`, `--remove-source-files`, `--partial`, `--partial-dir`, `--inplace`, `--append`, `--backup`, `--recursive`, `-r`, `-a`, `--archive`, `--links`, `--copy-links`, `-L`, `--password-file`, `--rsh`, `-e`, `--daemon`, `--mkpath`, `--ignore-existing` (unless owner question 1 chooses it: then that one flag is added to the allowlist and removed from this list); `spawn`/`execFile`/`exec` appear only in `runner.ts`, with `shell: false` and `RSYNC_EXECUTABLE`; (2) a **behavioural pin**: across every scenario of `copy.test.ts` and `service.test.ts`, every argv handed to the runner, minus `--`, `--list-only`, the URL and the source paths, equals `RSYNC_FLAGS` exactly. (The runner's test-only `spawnImpl` parameter, §5.4, is the one allowed seam; production code never passes it.)
- `test/nascopy/heartbeat.test.ts`: https only; the bare and `/fail` URLs (trailing slash, query kept); POST, no body, `redirect: 'error'`; timeout and one retry (a fake delay); a hostile `fetch` (throws synchronously, rejects, 500, returns a non-response, never resolves until its timeout) → `failed` and resolved; the ping decision table of §5.8 by trigger, reason and attempt; the URL never in a log.
- `test/nascopy/schedule.test.ts` (**`process.env.TZ = 'Australia/Melbourne'` at the top**): `W(t)` and `nextSlotAfter` on an ordinary week, **both DST Sundays** of the §5.9 table (2030 and 2026/2027), Sunday 02:59 / 03:00 / 03:01, Saturday 23:59, the 167 h and 169 h weeks; `planNext` with each gate and the 1-hour cap.
- `test/nascopy/service.test.ts` (TZ pinned, fake clock, fake runner, a real temp database): S1–S15 exactly (trigger, attempt, slot, settled rule); retries at 1 h / 2 h / 4 h then settled; `no_rsync` settles; configuration failures settle only while not ready and are not attempts (a config failure, then the files fixed → attempt 1); three stops in a slot still allow 4 real attempts; **the refusal lock**: after `auth` / `unknown_module` / `refused` (manual or scheduled) `copyNow()` → 409 `NAS_COPY_FIX_FIRST`, no row, the runner not called, the timer starts nothing, `nextRunAt` null, `blockedUntilFilesChange` true; rewriting `nas-password` (a later mtime) unlocks it and the slot runs once within the hour; a future-dated refused row locks nothing; which runs of C13–C24 retry and which ping; the heartbeat decision per run (**no ping for `stopped`**); `whenIdle` awaited before the copy; **`stop()` during a copy whose fake runner ignores SIGTERM, with a hung fake `fetch`, resolves in under 4 s**, records `failed`/`stopped`, sends no ping, and the scheduler's `stop()` after it resolves too; **DST on the fake clock**: (1) Sunday 06/10/2030: the copy at 05/10/2030 16:00Z (03:00 AEDT) sends the files up to the Saturday nightly, the 03:30 AEDT nightly is written after it, and the next Sunday's copy sends it; (2) a start at 06/04/2030 **15:30Z** (02:30 AEDT, the first pass) and one at **16:30Z** (02:30 AEST, the repeated hour) both treat `W` as Sunday 31/03/2030 03:00 AEDT, and the new slot runs at 06/04/2030 17:00Z (03:00 AEST) as `schedule`, not delayed by the catch-up gate (both starts precede the slot, so "a slot that comes round after the start runs on time" applies; the point of the test is that the repeated 02:30 is never taken for the new Sunday's slot); a join returns `joined: true` and one row; a crash-left `interrupted` row → the `stopped` sentence in the status; `stale` (never, 7 d 23 h, 8 d 1 h, not ready, schedule off, a future-dated row, 10 days of `partial` rows then `ready`); `nextRunAt` in each state; **`off` writes no row at any slot**; `problem().lastSuccessAt` is local ISO with the offset.
- `test/nascopy/routes.test.ts`: `GET /api/backups` `nasCopy` for each state (built from seeded files and `job_runs`, compared with the fixtures' shapes); `POST` 202 `started`/`joined` (the body's `lastRun` is the running row); 409 for `off`/`partial`/`invalid` with the exact messages and **no** row written; 409 `NAS_COPY_FIX_FIRST` while locked; **a malformed `nas-url` (`rsync://u%zz@h/m`) → `GET /api/backups` and `GET /api/status` both 200 with `configured: 'invalid'`, `configReason: 'url_invalid'`**; 400 for a non-empty body; 403 cross-site (production mode, a foreign Origin); `GET /api/status` `nasCopy`; **the leak test** of §5.12 across all of them.
- `test/config.test.ts` (`WEEKLY_NAS_COPY`, the test default and an explicit value under test); `test/backups/service.test.ts` + `whenIdle`; every existing Stage 7 suite green; `status-routes` with and without the decorator.
- A schema test: every `nasCopyStates` fixture's `lastRun.error` equals `nasCopyFailureMessage(…)` for its detail; `backupsPages.*.nasCopy` present; the §3.5 time forms (UTC `Z` for run times and `lastSuccessAt`, offsets only for `nextRunAt` and `detail.slot`; `appStatusNasCopy.*.lastSuccessAt` with an offset); `configReason` consistent with `configured`.

### 5.14 CODE-8 (server)
None beyond this stage's code; the Stage 7 server items are closed. (`withCategoryError` is reused as a pattern, not copied: the NAS status maps unknown errors itself.)

### 5.15 The copy, worked examples (the fake-runner tests reproduce each)
Local set for C1–C3: the Stage 7 `typical` fixture's 27 files (22 nightly, 2 by hand, 2 before import, 1 before update), about 4.2 MB each.
| # | Situation | Plan / invocations | Result |
|---|---|---|---|
| C1 | The first copy; the NAS module is empty | list (empty) → send 27 (newest first) in one call → list (27 at the right sizes) | `succeeded`: sent 27, already 0, onNas 27 |
| C2 | A week later: 7 new nightly files, 7 old ones pruned here | list (27) → 20 already there, 7 to send → one call → list (34) | `succeeded`: sent 7, already 20, onNas 34 (the NAS keeps the 7 pruned ones: it only ever adds) |
| C3 | Nothing new | list → 27 already there | `succeeded`: sent 0, **one** invocation only |
| C4 | The NAS holds `nightly-20300915-023000+1000.db` at 4 100 000 bytes; the local file is 4 200 000 | it is in the send list; rsync writes a temporary and renames it over the damaged copy | `succeeded` if the proof sees 4 200 000 |
| C5 | A retention prune removes one of the 7 while rsync runs | send exits 24; the name is gone locally | `succeeded`: sent 6, vanished 1 |
| C6 | rsync exits 0 but the second listing lacks one of the 7 | proof fails | `failed`, `not_verified`: "1 of 7" |
| C7 | The NAS is off | list exits 35 after 10 s | `failed`, `unreachable`, attempted, retry in 1 h (scheduled) |
| C8 | A wrong password | list exits 5, stderr "auth failed" | `failed`, `auth`, no retry, fail ping (scheduled); the refusal lock holds until the files change |
| C9 | A subfolder configured that does not exist yet | list exits 23 "No such file or directory" → empty → send (rsync creates the one folder) → list | `succeeded` |
| C10 | The NAS holds foreign files (`notes.txt`, a folder, a hidden temporary) | ignored by the parser | never counted, never touched |
| C11 | The share is full | send exits 11 | `failed`, `nas_io`, retry in 1 h |
| C12 | The image has no rsync | spawn `ENOENT` | `failed`, `no_rsync`, not retried, fail ping on a scheduled run |
| C13 | The module does not exist | list exits 5, stderr "@ERROR: Unknown module 'x'" | `failed`, `unknown_module`, attempted, exitCode 5; the lock holds |
| C14 | Another exit-5 refusal | list exits 5, other stderr | `failed`, `refused`; the lock holds |
| C15 | Connection refused / no route | list exits 10 | `failed`, `unreachable`, retryable |
| C16 | The connection breaks during the send | send exits 10 | `failed`, `broken`, `missingAfter: null`, retryable |
| C17 | The NAS stalls | list exits 30 | `failed`, `timeout`, exitCode 30, the sentence with the parenthesis |
| C18 | The 15-minute ceiling | the deadline aborts during the send | `failed`, `timeout`, no exitCode, the sentence **without** the parenthesis |
| C19 | The app stops during the send | `serviceStop` aborts | `failed`, `stopped`, no ping, not an attempt |
| C20 | The share fills during the send | send exits 23; the proof finds 2 of 7 missing | `failed`, `nas_io`, exitCode 23, `missingAfter: 2`, `sent: 5` (the `nas_io` sentence carries the exit code; the counts are in the detail) |
| C21 | A protocol error during the send | send exits 12 | `failed`, `broken` |
| C22 | The proof's listing fails | relist exits 23 | `failed`, `readback_failed` |
| C23 | A listing over the output cap | first listing `outTruncated` → `failed`, `other`; relist `outTruncated` → `failed`, `readback_failed` | never "missing" |
| C24 | The NAS holds 600 backup names (the 27 kept here among them, 7 of them at the wrong size) plus foreign files | list parses all 600 → 20 already there, 7 to send → one call → list | `succeeded`: sent 7, already 20, `onNas` 600 (foreign files never counted) |

---

## 6. The NAS files and the helper (deploy-nas)

### 6.1 The files on the Umbrel
`<app-data>/data/secrets/` (the container's `/data/secrets/`): folder **0700**, files **0600**, all owned by **uid 1000** (the `umbrel` user, the container's user). One line each, value + `\n`:
- `nas-url`: `rsync://<account>@<NAS address>/<module>[/<subfolder>]` (the NAS's **Tailscale IP**: tailnet names do not resolve inside the container, and the rsync protocol is plaintext, which Tailscale encrypts).
- `nas-password`: the rsync account's password.
- `nas-heartbeat-url` (optional): the https ping URL.

### 6.2 `pnpm umbrel:nas-secrets` (`tools/deploy/nas-secrets.mjs`)
```
node tools/deploy/nas-secrets.mjs                     place nas-url + nas-password (+ optional nas-heartbeat-url)
node tools/deploy/nas-secrets.mjs --heartbeat-only    place only nas-heartbeat-url
node tools/deploy/nas-secrets.mjs --check             which files are there (presence, mode, owner); never contents
node tools/deploy/nas-secrets.mjs --remove [--yes]    delete all three (the copy is off again)
node tools/deploy/nas-secrets.mjs --remove-heartbeat [--yes]
node tools/deploy/nas-secrets.mjs --dry-run [mode]    print every ssh command it would run; no prompts, nothing sent
node tools/deploy/nas-secrets.mjs --prompt-test       read ONE hidden entry and print only "read N characters, nothing was echoed";
                                                      no ssh, nothing stored, nothing else printed
```
- **Who runs it:** the owner, in his own terminal, never an agent or the coordinator on the owner's behalf for placing: the password must not pass through a chat or a tool call. The coordinator may run `--dry-run`, `--check`, and `--remove --yes` with the owner's OK.
- **Supported terminals: PowerShell (its console window) or Windows Terminal.** Git Bash's default mintty window gives Node a pipe, not a console (`isTTY` false), so Node cannot hide input there. The helper's refusal when not a TTY says: "Git Bash's mintty window is not a terminal Node can hide input in: use PowerShell or Windows Terminal, or `winpty node tools/deploy/nas-secrets.mjs`." The owner runs **`--prompt-test` first** in the same window (§11 step 8a): the raw-mode reader is the riskiest owner-facing part and cannot otherwise be rehearsed before the real password is typed. (The reference helper used PowerShell's own hidden prompt; this helper is Node so the repo stays PowerShell-free, hence the rehearsal.)
- **Prompts (placing modes)** — refuses to start unless stdin and stdout are TTYs (the sentence above):
  1. The address, **visible** (it is not a credential), re-prompted until the rule accepts it (the helper's copy of §5.3, tested equal to the schema's on a shared table); a short explanation above it names the form and says to use the NAS's Tailscale IP. **The Tailscale check (helper only):** if the host is not an IPv4 address inside Tailscale's block (first octet 100, second octet 64 to 127: the CGNAT `/10`) and not an IPv6 address inside `fd7a:115c:a1e0::/48`, the helper prints "This is not a Tailscale address: the rsync protocol is not encrypted, so the files would cross the network readable." and continues only if the owner types `yes` (anything else re-prompts the address). The server rule does not check this: the smoke's scratch daemon is a Docker name (§9.2).
  2. The password, **hidden**, **typed twice**; refused when empty, over 256 characters, containing a control character, or with leading/trailing whitespace. **The raw-mode reader** (`readHidden`, `lib.mjs`): `setRawMode(true)`, `setEncoding('utf8')` (so a multibyte character split across chunks is decoded whole), no echo; it processes **each character of every data chunk** (a paste from a password manager arrives as one chunk): `\r` or `\n` ends the entry (a pasted `pw\r\n` gives `pw`, the trailing `\n` swallowed), Backspace is **both `0x08` (conhost) and `0x7f` (Windows Terminal)**, an ESC sequence (arrow keys and the like, `\x1b[…` or `\x1bO…`) is **ignored whole**, Ctrl+C aborts cleanly (exit 130), any other control character is dropped; on every exit path `setRawMode(false)` **and `stdin.pause()`** (without the pause the process hangs), then a newline is printed.
  3. The heartbeat URL, **hidden** (it is a credential), optional: **Enter leaves the current file as it is**; https only.
  The helper never prints a value back (not even the host): it prints "address accepted", "password accepted".
- **Transport:** the Stage 7 `lib.mjs` context (the resolved `ssh`, `BatchMode=yes`, the host alias `JOINR_DEPLOY_HOST` default `umbrel`, the preflight probe, the remote home resolved and validated). The data folder is `<home>/umbrel/app-data/<JOINR_APP_ID>/data`; `test -d` it first, else exit 2 "Install Joinr Finance first". **Values travel only on ssh's standard input** (`spec.input`); **no value is ever in an argument**, an environment variable, a file on the PC, or a printed line; the dry-run printer shows `<stdin: secret>` (and a test proves the real values appear in no `args` and no printed text).
- **All or none (placing):**
  1. `umask 077 && mkdir -p '<secrets>' && chmod 700 '<secrets>'`;
  2. **stage** each file: one ssh call per file, `umask 077 && rm -f -- '<secrets>/.<name>.new' && cat > '<secrets>/.<name>.new' && chmod 600 -- '<secrets>/.<name>.new'` with the value on stdin (the `rm` first, because `umask` applies only when a file is created: a stale `.new` left at 644 by an interrupted run would keep 644);
  3. if any staging call fails: `rm -f -- '<secrets>'/.nas-*.new`, exit 1 "Nothing was changed";
  4. **pre-commit check**, one call: for each staged file `stat -c '%a %u' '<f>.new' && test -s '<f>.new' && echo nonempty` → must be `600 1000` + `nonempty`; a mismatch → `rm -f` of the temporaries, exit 1 "Nothing was changed" with the file **name** and what was wrong. So nothing goes live that would fail the check;
  5. **commit** in one call, **the password first**: `cd '<secrets>' && mv -f .nas-password.new nas-password && mv -f .nas-url.new nas-url[ && mv -f .nas-heartbeat-url.new nas-heartbeat-url]` (so while the feature was off the app never sees a URL without its password; when a pair is replaced, a copy that reads between the two `mv`s and is refused records `other`, not a refusal, because the files changed during its run, §5.5 step 3);
  6. **verify**: the same `stat -c '%a %u'` + `test -s` of each placed file → `600 1000 nonempty`, the folder `700 1000`; a mismatch → exit 1 with the file **name** and what was wrong. **The remote command never prints a size** (`%s` of `nas-password` is the password's length plus one), so no length reaches the PC, a printed line, a `DeployError` detail or a dry-run reply;
  7. Print: "Placed: nas-url, nas-password[, nas-heartbeat-url]. Settings → Backups now shows the copy as ready. Click **Copy to NAS now** to copy straight away (otherwise within the hour, then every Sunday at 03:00)."
- **`--check`:** `stat -c '%a %u'` plus the `test -s` result of the folder and each file (or "missing"), never `%s`; prints `nas-url: present (600, uid 1000)` etc. and the state the app will derive (`off`/`partial`/`ready`; `invalid` cannot be told without reading, so it says "the address is checked by the app"). **It never reads a file's contents or its size.**
- **`--remove`:** confirms (`y/N`, or `--yes`), then `rm -f -- '<secrets>/nas-url' '<secrets>/nas-password' '<secrets>/nas-heartbeat-url' '<secrets>'/.nas-*.new`; the folder stays. `--remove-heartbeat` removes only that file.
- **Every path is built from validated constants** (the app id, the three names); nothing typed ever reaches a remote command line.
- Exit codes: `0` done · `1` failed (nothing changed, or the verification named the problem) · `2` usage, not a terminal, the app not installed, SSH unreachable · `130` aborted by the user.

### 6.3 Where the secrets live, and the Umbrel's own backups (decided)
- `DATA_DIR/secrets/` (next to the database, inside the app-data folder the app already owns). Uninstalling the app deletes them with everything else (D113); an Update never touches them.
- **The manifest's `backupIgnore` gains `data/secrets` and `data/secrets/*`** (the folder entry alone already excludes everything under it, dot-names included, by the kopia/gitignore rule verified in umbreld's source, §header; the second entry is belt and braces), so umbrelOS's own Backups (if the owner ever sets them up) never carry the NAS password to wherever those snapshots go; after an Umbrel-level restore the owner re-runs the helper (RUNBOOK). Vetoable (§15 item 6).
- The app's own backups never contain them (they are files, not database rows), and the download route serves only backup names.

### 6.4 Helper tests (`tools/deploy/test/nas-secrets.test.mjs`, the fake runner and an injected prompt; no TTY, no ssh)
Each mode's exact remote commands; values planted as distinctive strings appear **only** in `spec.input`, never in any `spec.args`, the dry-run output or the printed lines; the address table shared with the schema's `checkNasUrl` (the test imports `packages/schema/src/nasCopy.ts` directly, as the Stage 7 name-rule test does); the password rules (empty, 257 characters, a tab, a leading space, a mismatch on the second entry → re-prompt); Enter on the heartbeat leaves it alone; the all-or-none path (a staging failure → the `rm -f` of the temporaries, no `mv`, exit 1); **the staging command exactly** (`umask 077 && rm -f -- … && cat > … && chmod 600 -- …`); **the pre-commit check refusing `644`, uid `0` or an empty file → the temporaries removed, no `mv`, exit 1**; **the commit order pinned** (`nas-password` before `nas-url`); the post-commit verification refusing the same; **a planted size never appears in any output** (the fake runner's `stat` reply would carry none: no remote command contains `%s`); `--check` never runs `cat` and never asks for `%s`; `--remove` without `--yes` in a non-TTY → exit 2; `--remove --yes` exact command; not-a-TTY refusal for placing with the mintty sentence; the app folder missing → exit 2; **the Tailscale check** (addresses built with `ip(a, b, c, d)`, never dotted literals: `ip(100, 64, 0, 1)` and `ip(100, 127, 255, 254)` accepted silently; `ip(100, 63, 255, 255)`, `ip(100, 128, 0, 1)`, a private-LAN address `ip(192, 168, 1, 10)`, an RFC 5737 address, a DNS name and `fd7a:115c:a1e1::1` → the warning, then `yes` continues and anything else re-prompts; `fd7a:115c:a1e0::1` accepted silently); `--prompt-test` (reads one entry, prints only the count, runs no ssh); **the raw-mode reader on a fake stream**: echo off; a chunk `abc\r` in one data event → `abc`; a pasted `pw\r\n` → `pw` and the `\n` swallowed; Backspace as `0x08` and as `0x7f`; an ESC sequence (`\x1b[D`) ignored; a multibyte UTF-8 character split across two chunks decoded whole; Ctrl+C restores the mode and exits 130; **`setRawMode(false)` and `pause()` called after every prompt** (spies).

---

## 7. The image (deploy-nas; Dockerfile)
In the **runtime stage**, **before** `COPY --from=build` (so the layer stays cached across app changes):
```dockerfile
# rsync: the weekly copy to the NAS (Stage 8) runs the system rsync as a client. From Debian
# bookworm (the pinned base's release); the version follows Debian's security updates at each build.
RUN apt-get update \
 && apt-get install -y --no-install-recommends rsync \
 && rm -rf /var/lib/apt/lists/* \
 && test ! -e /etc/popt && test ! -e /etc/popt.d \
 && rsync --version | head -n 1 \
 && dpkg-query -W -f='rsync ${Version}\n' rsync
```
- **No popt alias file** (`/etc/popt`, `/etc/popt.d`): client rsync reads popt aliases, which could add a flag invisibly (§5.4, `HOME` is absent from the child's env for the same reason). The build fails if either exists.
- `rsync --version` prints only the upstream version (`3.2.7 protocol 31`); **`dpkg-query` prints the Debian revision**, which shows whether bookworm-security's fixes are in. The coordinator records it in the private §9 at step S.
- The pinned `NODE_IMAGE` digest is **unchanged** (no base bump this stage).
- The build fails if `apt-get` cannot reach the mirror (checked reachable from the Umbrel) or rsync does not run; the release retries without a version bump (a failed build pushes nothing).
- The runtime stays `USER node` (uid 1000); rsync needs no privileges as a client. `ca-certificates` is not needed (rsync:// has no TLS; the heartbeat uses Node's own CA store).
- `tools/deploy/test/dockerfile.test.mjs` asserts: the apt line in the runtime stage before `USER node` and before the app copy, `--no-install-recommends`, the lists removed, **`test ! -e /etc/popt && test ! -e /etc/popt.d`**, the `rsync --version` check, the `dpkg-query` line, the unchanged `FROM` digest, and everything Stage 7 asserted.
- `.dockerignore` and the repo `docker-compose.yml` are unchanged (the generic compose needs no NAS: the copy is off without the files).

---

## 8. Web spec (web-nas)

### 8.1 API layer (`apps/web/src/api/hooks.ts`)
- `useBackups()`: `refetchInterval` 2 s while `running` **or `nasCopy.running`**, otherwise none.
- `useNasCopyNow()` → `POST /api/backups/nas-copy`; **on settle** invalidates `['backups']` and `['status']`; errors mapped as the other mutations (the server's message).
- **Following a copy (FROZEN rule):** the page keeps **`followId` = `nasCopy.lastRun.id` from the 202 body** (the running row, §4.3). The copy is **done** when a `GET /api/backups` shows `lastRun.id === followId` with `status !== 'running'`, or a `lastRun.id` greater than `followId`. A fast copy (C3, well under 2 s) can already be finished at the first refetch after the 202; that counts as done at once (the page may never see `running: true`). On done: the result text (§8.2), and **invalidate `['status']` and `['backups']`** so the every-page callout updates without waiting for the next status poll.

### 8.2 The "Copy to the NAS" block (`pages/settings/NasCopyBlock.tsx`, `nasCopyDisplay.ts`)
Inside the Backups section, **after "Back up now" and its result, before the backups table**; a small subheading **"Copy to the NAS"** in the style guide's label style with `id="nas-copy"` (a hash target; the in-page index gains **NAS copy** after Backups). Dense per D109 (24 px rows, 12 px padding, 22 px in-table buttons from 768 px). Every time in the **server's zone** (`formatServerDateTime`), `dd/mm/yyyy HH:mm`.
1. **One KV table:**
   - **Copy** — `ready` + enabled: "Weekly, Sunday at 03:00 (Australia/Melbourne)" (built from `schedule`, never hard-coded); `ready` + disabled: "Weekly copy off (turned off in the server settings); Copy to NAS now still works"; `off`: "Not set up: the NAS files are not on the server."; `partial`/`invalid`: **built from `configReason` only** (the current files; never from `lastRun.error`, which may predate them): `url_missing` "Half set up: nas-url is missing. Nothing is copied."; `password_missing` "Half set up: nas-password is missing. Nothing is copied."; `url_invalid` "The NAS address in nas-url is not usable. Nothing is copied."; `password_invalid` "The password file nas-password is not usable. Nothing is copied."; `ready` + **`blockedUntilFilesChange`**: "Stopped: the NAS refused the password or module. Place the password again with the NAS set-up helper first." (stop tint).
   - **Next** — `dd/mm/yyyy HH:mm` (only when `nextRunAt`).
   - **Last copy** — `dd/mm/yyyy HH:mm` + the §4.5 badge and text; "No copy yet" when `lastRun` is null.
   - **Last success** — shown when the last copy did not succeed: the time, or "Never".
   - **Heartbeat** — "Off" · "On · last ping sent `dd/mm/yyyy HH:mm`" · "On · last ping failed `dd/mm/yyyy HH:mm`" · "On · no ping yet" · "Not usable: not an https:// address".
2. **"Copy to NAS now"** (secondary button, lucide `HardDriveUpload` or `CloudUpload` icon). **Unavailable** unless `configured = 'ready'` and not `blockedUntilFilesChange`: rendered with **`aria-disabled="true"`** (it stays focusable, so a screen-reader user can reach it and hear why; clicks are ignored and send no POST) plus the visual disabled style, and `aria-describedby` pointing at the Copy row's text (which says why: not set up, half set up, unusable, or "Place the password again with the NAS set-up helper first."). While the mutation or a copy runs: "Copying…", `aria-busy`, `aria-disabled`. **Result** in a `LiveRegion`: on 202 "Copy started." / "A copy was already running." (joined); when the §8.1 follow rule says done: "Copied: 5 sent, 22 already there." or "Copy failed: <sentence>"; a 409 (`NAS_COPY_NOT_READY` or `NAS_COPY_FIX_FIRST`) shows the server's message in an error callout (`do-not`). Focus returns to the button when the copy ends if it had it (the Stage 7 pattern).
3. **A muted line:** "Adds only: nothing on the NAS is ever deleted or changed. The NAS address and password are never shown here."
4. **The uninstall callout** (Stage 7 text, frozen here): "These backups are stored on the server, in this app's data folder. **Uninstalling the app deletes them.** Download the newest one before you uninstall, and keep a copy off the server: the weekly NAS copy does this once it is set up."
5. **Phone (< 768 px):** the KV table stacks (as the Stage 7 schedule table); the button full width like "Back up now"; no horizontal page scroll at 375 px.
6. **Nothing on the page ever shows or requests an address, an account, a module or a password**; there is no form for them (D126: the helper only).

### 8.3 In-page index and hash
`/settings#nas-copy` focuses the subheading (the Stage 7 `useHashTarget` pattern, after both queries settle); the index ("On this page" / "Jump to") lists **Backups**, **NAS copy**, **About**.

### 8.4 The NAS-copy callout (`layout/RootLayout.tsx`, `layout/nasCopyStale.ts`)
An `important` callout above the page content on **every page** when `status.nasCopy?.stale`, **or** `status.nasCopy?.configured` is `partial` or `invalid`, **or** `status.nasCopy?.blocked`:
- stale: title **"NAS copy overdue"**, "The weekly copy to the NAS has not succeeded since `dd/mm/yyyy`." (or "…has not succeeded yet." when `lastSuccessAt` is null). The date is `lastSuccessAt.slice(0, 10)` of the **local ISO with offset** (§3.4), formatted `dd/mm/yyyy`: the server's own date, whatever the viewer's zone (the Stage 7 `backupStale.ts` pattern);
- not working (one title, **"NAS copy not working"**, the text from `configReason` or `blocked`, never from a run's error): `url_missing`/`password_missing` "The copy to the NAS is half set up, so nothing is being copied."; `url_invalid` "The NAS address is not usable, so nothing is being copied."; `password_invalid` "The NAS password file is not usable, so nothing is being copied."; `blocked` "The NAS refused the last copy's password or module, so nothing is copied until the NAS files are placed again.";
- a link **"Open NAS copy"** → `/settings#nas-copy`.
It renders **below** the Stage 7 backup callout when both show (two different problems). Decided default (every page, like the backup callout, because it shows only when something is broken and the off-site copy has no other in-app alarm); vetoable (§15 item 3).

### 8.5 Text updates
`settingsForm.ts` / other copy: none beyond §8.2 item 4. `noStage5.test.tsx`: also no "Stage 8".

### 8.6 Web tests (web-nas; fixtures from `@joinr/schema/fixtures`)
Every `nasCopyStates` fixture renders (the Copy row words for all four states, **each `configReason`**, `blocked` and schedule off; the Copy row never taken from `lastRun.error`; Next only when present; the §4.5 badges and texts including `vanished`; Last success; each heartbeat line); the button's enabled/unavailable/busy states (**focusable while `aria-disabled`, and a click then sends no POST**; unavailable when `blockedUntilFilesChange`), `aria-describedby`, one POST per click, the 202 `started` and `joined` texts, the finished texts driven by a second fixture (running → succeeded, running → failed) **and the fast path** (the first refetch after the 202 already shows the followed id finished), the 409 callouts (both codes), the invalidations of `['status']` and `['backups']` on done, focus return; the NAS callout date: **a success at `2030-09-14T17:00:05Z` (local `2030-09-15T03:00:05+10:00`) shows 15/09/2030 with the machine's `TZ` set to UTC**; the callout for each `configReason` and for `blocked`; the poll interval switches on `nasCopy.running`; times in the fixture's server zone whatever the machine's zone; the uninstall text; the callout on two pages for `stale`, `partial`, `invalid`, its link, and its order under the backup callout; the index link and `#nas-copy`; the phone layout (`matchMedia`); §8 formats (no raw ISO strings); **no fixture value that looks like an address appears in the DOM** (a guard test rendering every state and grepping for `rsync://`, `@`).

### 8.7 e2e (web-nas; drafts in phase A, run in phase B)
- `e2e/nas-copy-states.spec.ts` (**desktop + phone, read-only, route-mocked**: `backupsPages.nasReady` and each `nasCopyStates` fixture spliced into `GET /api/backups`; `appStatusNasCopy.stale`/`partial`/`blocked` on `/api/status`): the block for each state, the callout on two pages, screenshots of each at 1440, 1024 and 375 under `artifacts/screenshots/{desktop,phone}/settings-nas-copy-*.png`.
- `e2e/backups.spec.ts` (real server, no NAS files): the block shows "Not set up", the button has `aria-disabled="true"` and a click sends no POST, `#nas-copy` focuses, the index link scrolls to it; no callout.
- `e2e/backups-mutations.spec.ts`: `POST /api/backups/nas-copy` → **409 `NAS_COPY_NOT_READY`** with `NAS_COPY_OFF_MESSAGE`, and no `nas-copy` row appears (`GET /api/backups` `nasCopy.lastRun` stays null); a cross-site POST → 403; a body `{"x":1}` → 400.
- `playwright.config.ts`: the webServer env adds `WEEKLY_NAS_COPY: process.env.WEEKLY_NAS_COPY ?? 'false'`. No new project (the mutation additions live in `backups-mutations`).

### 8.8 CODE-8 (web)
`apps/web/src/pages/pageCases.ts`: the Settings entry's `statesOf(…, extra)` mocks `'GET /api/backups': backupsPages.typical` (with `app.version` set to `__APP_VERSION__`), so the page-wide suites (`states`, `formatAudit`, `noStage5`, the router's pending test) render the real Backups section and the NAS block under the format audit (the Stage 7 cross-owner request).

---

## 9. Deploy spec (deploy-nas)

### 9.1 `lib.mjs`
Add: `NAS_SECRET_FILES` (the three names, tested equal to the schema's), `NAS_SECRETS_DIR`, `checkNasUrl` (a copy of the schema rule, tested equal on a shared table), the hidden-prompt reader (`readHidden(stream, out)`, injectable; the §6.2 character rules) and a visible prompt, `isTailscaleAddress(host)` (IPv4 with first octet 100 and second octet 64 to 127, IPv6 in `fd7a:115c:a1e0::/48`; pure, tested; **the code and tests hold the range as octet numbers and build test addresses with a small `ip(a, b, c, d)` join**, never as dotted literals, because the privacy guard flags every IPv4 literal outside loopback and the RFC 5737 documentation ranges), and the dry-run rendering of `spec.input` as `<stdin: secret>` (**never the value**; today's renderer must be checked for how it prints `input` and changed if it prints the content). `EGRESS_URLS` (smoke) gains `https://hc-ping.com/` (any status = reachable; CODE-8).

### 9.2 `smoke.mjs nas` (the coordinator's live proof of the real rsync, §11 step S)
Runs after `smoke start` / `smoke check` on the rc image, **with `WEEKLY_NAS_COPY=false`** added to the smoke container's environment (so the 5-minute catch-up cannot race the probes). Everything below is fake-runner tested and printed by `--dry-run`.
1. **The scratch NAS:** on the host, as the `umbrel` user: `mkdir -p <build root>/smoke/nas/{data,conf}`; write `conf/rsyncd.conf` (fixed text on stdin):
   ```
   use chroot = no
   [smoke]
     path = /nas
     read only = no
     list = yes
     auth users = smoke
     secrets file = /conf/rsyncd.secrets
     strict modes = yes
     refuse options = delete remove-source-files partial inplace append
   ```
   The `refuse options` line makes the scratch daemon **reject** any of those flags: a live proof that the copy never sends one (the implementer checks the option names against `rsyncd.conf(5)` of bookworm's rsync and records any change in a Scaffold note). The daemon runs as uid 1000, so the file has **no** `max connections` (it needs a lock file under `/var/run`), no `pid file` and no `uid`/`gid` lines; `use chroot = no` is required for a non-root daemon.
2. **The scratch password is generated on the host and never printed or sent back:** one fixed command, `umask 077; pw=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 20); printf 'smoke:%s\n' "$pw" > <conf>/rsyncd.secrets; mkdir -p <smoke data>/secrets; chmod 700 <smoke data>/secrets; printf '%s\n' "$pw" > <smoke data>/secrets/nas-password`.
3. `docker network create joinr-smoke-net`; `docker run -d --name joinr-smoke-nas --network joinr-smoke-net --no-healthcheck --restart no --user 1000:1000 -v <nas/data>:/nas -v <nas/conf>:/conf:ro --entrypoint rsync <the rc image> --daemon --no-detach --port=8873 --config=/conf/rsyncd.conf` (`--no-healthcheck`: the rc image's own HEALTHCHECK probes the app's port, which this container never opens, so it would turn "unhealthy" and confuse any status that reads health) — **the app image's own rsync plays the NAS**, so no third-party image is pulled; no host port is published; `docker network connect joinr-smoke-net joinr-smoke`.
4. `nas-url` for the smoke app: `rsync://smoke@joinr-smoke-nas:8873/smoke` (a Docker network name, which resolves inside the network; the real NAS uses its IP, §6.1), written with `umask 077`.
5. **Probes** (each PASS/FAIL, exit 1 on any failure; JSON parsed on the PC side as `check` does):
   - `docker exec joinr-smoke rsync --version` → exit 0;
   - `GET /api/backups` → `nasCopy.configured` `ready`;
   - `POST /api/backups` (a fresh manual backup) then `POST /api/backups/nas-copy` → 202; poll ≤ 60 s until not running → `lastRun.status` `succeeded`, `detail.sent` = `detail.localFiles`, `alreadyThere` 0;
   - **on the host**, `ls -ln <nas/data>` names and sizes equal those of `<smoke data>/backups` for every listed backup; no dot-file in `<nas/data>`;
   - a second copy → `sent` 0, `alreadyThere` = the count; the NAS folder unchanged (same names, sizes and mtimes);
   - a planted foreign file `<nas/data>/notes.txt` and a planted local `<smoke data>/backups/.x.partial`: after a copy, `notes.txt` is unchanged and `.x.partial` is not on the NAS;
   - **wrong password** (the host overwrites the smoke's `nas-password` with another generated value): copy → `failed`, `detail.reason` `auth`; `GET /api/backups`'s backup list and the `backup` job's `lastRun` are unchanged; **the lock**: `nasCopy.blockedUntilFilesChange` true and a second `POST /api/backups/nas-copy` → **409 `NAS_COPY_FIX_FIRST`** with no new row (the scratch daemon sees exactly one failed login); then the right password is restored (from `rsyncd.secrets`, on the host, a fresh write: new mtime) → `blockedUntilFilesChange` false and a copy → `succeeded`;
   - **NAS stopped** (`docker stop joinr-smoke-nas`): copy → `failed`, reason `unreachable`; `docker start joinr-smoke-nas`;
   - **a subfolder:** `nas-url` → `…/smoke/sub`: copy → `succeeded`, the files in `<nas/data>/sub/`;
   - **leaks:** on the host, with the password read into a shell variable from the smoke's own file (never printed), `docker logs joinr-smoke 2>&1 | grep -c -F -- "$pw" || true`, the same for `'rsync://'` and `'joinr-smoke-nas'` (the `|| true` because `grep -c` exits 1 on zero matches; the smoke parses the **printed count**, which must be `0`); the saved `GET /api/backups` and `/api/status` bodies contain none of the three.
6. `smoke remove` also removes `joinr-smoke-nas`, the network `joinr-smoke-net` and the `smoke/nas` folder (`rm -rf --` of the validated absolute path), whether or not `nas` ran.
7. The smoke's fake-runner test pins `--no-healthcheck` and `--restart no` on the daemon's `docker run`, and the `|| true` + count parsing of every leak probe.

### 9.3 `status.mjs`
Adds a line per NAS file (`present (600, uid 1000)` / `missing`, via `stat -c '%a %u'` and `test -s`, never contents and **never a size**, as §6.2) and the derived `off`/`partial`/`ready`; still read-only. A test: a planted size in the fake runner's reply never appears in the output (and no command asks for `%s`).

### 9.4 The store app folder (local clone, uncommitted)
- `tenon-joinr-finance/umbrel-app.yml`: the **description** gains a paragraph (the weekly copy of every backup to an rsync module on a NAS, off until its files are placed over SSH with the `pnpm umbrel:nas-secrets` helper from `joinr-fin`; it only adds, never deletes; the address and password never appear on the page); **`backupIgnore`** adds `data/secrets` and `data/secrets/*` (§6.3; with a comment: umbrelOS Backups should not carry the NAS password; re-run the helper after an Umbrel-level restore); **`releaseNotes`** drafted for **1.1.0** (the NAS copy, "Copy to NAS now", the heartbeat, rsync in the image, no data change). `version:` is written by `release.mjs` (not by hand).
- `tenon-joinr-finance/docker-compose.yml`: comments only (the private bridge keeps internet access for prices **and** reaches the NAS over the Umbrel's Tailscale; the NAS files live in `data/secrets/`). The image line is written by the release.
- Store `README.md`: one line in the Joinr Finance section about the NAS copy and the helper. No new app, no port change.
- `tools/deploy/test/store.test.mjs`: `backupIgnore` contains `data/secrets` and `data/secrets/*`, each matching umbreld's `^[-a-zA-Z0-9._/*]+$`, and still the Stage 7 entries; no `secrets` value or file in the store folder (only `.gitkeep`s under `data/`).

### 9.5 Docs (deploy-nas owns them)
- **`docs/deploy/RUNBOOK.md`**, new section **"Copy to the NAS"** (with contents entries), generic (the alias `umbrel`, "the NAS", "the NAS's admin page", `<NAS Tailscale IP>`, `<account>`, `<module>` placeholders):
  - **What it does:** weekly, Sunday 03:00 server time, plus a catch-up after downtime and "Copy to NAS now"; every kept backup; only adds; each copy proved by listing the NAS back; the NAS keeps everything it receives (about 4 MB a week at today's sizes; prune on the NAS by hand if ever needed); the files arrive as plain SQLite copies (the same as a download), so the NAS folder must be private to the owner.
  - **Set-up on the NAS:** a new shared folder, **private to you**: give **your own NAS user read access** to it (the rsync account is scoped to the module, so it is your own user that fetches a file for a restore), and nobody else; enable the rsync server; a new rsync account allowed only on a new module for that folder (write access); never reuse another app's account; use the NAS's **Tailscale IP** in the address (tailnet names do not resolve inside the app's container; the rsync protocol is unencrypted, Tailscale encrypts it; the helper warns and asks for `yes` on any other address).
  - **Placing the files:** in **PowerShell or Windows Terminal** (not Git Bash's mintty window, which cannot hide input for Node; `winpty` is the workaround there), first `node tools/deploy/nas-secrets.mjs --prompt-test` (type anything: it must say "read N characters, nothing was echoed" and show nothing you typed), then `pnpm umbrel:nas-secrets` (what it asks, what it never prints), `--check`, then Settings → Backups → **Copy to NAS now** and check the NAS folder.
  - **The heartbeat (optional):** a healthchecks.io-style check with **period 7 days, grace 1 day**; `pnpm umbrel:nas-secrets --heartbeat-only`; what pings when (§5.8).
  - **Removing it:** `--remove` (the copy is off; nothing on the NAS is touched), `--remove-heartbeat`.
  - **Troubleshooting:** one entry per §4.4 sentence (what to do); **the refusal lock**: after a refused password or module the app tries nothing (timer or button) until the NAS files are placed again with the helper, because repeated wrong passwords can trip the NAS's brute-force protection and block the Umbrel's address, which would also stop any other app copying to that NAS; re-running the helper unlocks it and allows exactly one attempt; if the NAS has already blocked the Umbrel, unblock it in the NAS's admin page (the app cannot tell a block from a switched-off NAS: both show "did not answer"); "Copy to NAS now" greyed out (the state line says why); the copy never runs (schedule off; half set up); `rsync is missing` (the image; rebuild); the callout; logs never contain the address.
  - **Restore from the NAS copy:** fetch the file from the NAS share to the PC with **your own NAS user** (the NAS's file manager or SMB), then `pnpm umbrel:restore --from-file <path>` (the Stage 7 path; the NAS file names have no `joinr-finance-` download prefix, and `--from-file` accepts a bare backup name), or on a PC restore into a dev copy (`pnpm restore:backup <path> --yes`). After a reinstall this is the way back (D113); **a reinstall also deletes `data/secrets/`, so the copy is off until you run the helper again**; the first copy after that sends only what the NAS lacks.
  - Updates elsewhere: "Backups" (the "later copy to the NAS" line replaced by a pointer), "Accepted risks" (the NAS copy's exposures: the URL in the container's process list, **the password in the rsync child's environment for the length of a copy, readable by the same uid, which already owns the file; never in argv, a log, a row or a DTO**, `app_proxy`'s read-only view of app-data, plaintext files on the NAS), the go-live checklist (NAS copy items), "Uninstall" (the NAS keeps its copies).
  - Run `pnpm prettier --check --ignore-path= docs/deploy/RUNBOOK.md` once by hand (Stage 7 note) and report it.
- **README.md:** Configuration (`WEEKLY_NAS_COPY`), API (§4 additions), a "Copy to the NAS" section (pointer to the runbook), the new script.
- **docs/ARCHITECTURE.md:** the NAS-copy service (job, schedule, catch-up, retries, stale), the transport and why (an rsync-daemon account scoped to one folder, not SSH), the password's path (file → child env only), only-adds and the pin test, the proof, the heartbeat, the leak discipline, rsync in the image.

### 9.6 CODE-8 (deploy)
The smoke's egress list (§9.1); the RUNBOOK and README "NAS copy: not built yet" lines (§9.5).

---

## 10. Roles, tasks and FILE OWNERSHIP

### 10.0 Rules (all agents; Stage 7 §8.0 carried over)
- **Ownership:** edit only files you own (§10.1). Need a change elsewhere? Report it; the coordinator routes it.
- **Frozen contracts:** §3, §4 (endpoints, DTO fields, error code, sentences, page mapping), §5.3's rule, §5.4's env and argv shape and the runner's return type, §5.6's line pattern, §5.9's slot, settled, lock and attempt rules, §8.1's follow rule, §6.2's modes and exit codes. A change needs the coordinator's approval and a Scaffold note.
- **No installs, no lockfile change** (§1.3).
- **Never touch the Umbrel or the NAS; never run rsync anywhere** (there is none on the dev PC; no test may need it).
- **Never commit or push** (either repository); the store clone gets uncommitted files only (deploy-nas).
- **Never on `data/`:** every server an agent starts uses its own `DATA_DIR` (§10.6); `AUTO_RECORD` is never set; **never create a `secrets/` folder with anything but planted test values**, and only under `artifacts/stage8/**` or an OS temp dir.
- **Test values only:** planted NAS values are obviously fake (`rsync://planted-user@planted-host/planted-module/` (a host with no dot: a dotted one trips the guard's email rule, so test files avoid it too), a password like `planted-password-not-real`); no real address, account, module or password anywhere.
- **Privacy:** no IPs other than loopback, no host or tailnet names other than `umbrel` (and the planted test names), no NAS names, no personal paths, no owner figures in any tracked or store file; `pnpm guard:all` before you finish (deploy-nas: also the store check of §12 #12). A guard hit on a value you believe generic → change your value; never edit `docs/private/guard-terms.txt`.
- **Scoped runs** while others work (§1.4); keep your files compiling at every step.
- **Coordinator pre-step** (before server-nas step 0): stop any running dev server; back up `data/finance.db*` to `data/backups/pre-stage8-<date>/`; append the terms of `docs/private/stage-8-private.md` §7 to `docs/private/guard-terms.txt`; re-run `pnpm guard:all` (clean); apply the owner's §17 answers (the Plan review log).

### 10.1 Ownership table (every new or changed Stage 8 file has exactly one owner)
| Owner | Files |
|---|---|
| **server-nas** | **Schema (step 0, then post-contract owner):** `packages/schema/src/{nasCopy.ts,enums.ts,index.ts}`, `src/dto/{nasCopy.ts,backups.ts,errors.ts,status.ts}`, `src/fixtures/{nasCopy.ts,backups.ts,index.ts,coverage.ts}` (and `sampleDtos.ts` if coverage needs it), schema tests. **Server:** `apps/server/src/nascopy/**`, `src/routes/{backups,status}.ts`, `src/app.ts`, `src/index.ts`, `src/config.ts`, `src/backups/service.ts` (the additive `whenIdle()` only), `apps/server/test/**` (new `test/nascopy/**` and every existing suite the changes touch). |
| **web-nas** | `apps/web/src/pages/settings/**` (+ `NasCopyBlock.tsx`, `nasCopyDisplay.ts`, tests, `backups.css`), `apps/web/src/api/hooks.ts` (+ tests), `apps/web/src/layout/**` (+ `nasCopyStale.ts`, tests), `apps/web/src/pages/pageCases.ts`, `apps/web/src/pages/noStage5.test.tsx`, `apps/web/test/**` helpers, **every `e2e/**` file** (new `nas-copy-states.spec.ts`; edits listed in the report), `playwright.config.ts`. |
| **deploy-nas** | `Dockerfile`, **root `package.json`** (version `1.1.0` and the script only), `tools/deploy/**` (+ `nas-secrets.mjs`, tests), `docs/deploy/RUNBOOK.md`, `README.md`, `docs/ARCHITECTURE.md`. **Outside the repo (local clone, uncommitted):** `../tenon-umbrel-store/tenon-joinr-finance/{umbrel-app.yml,docker-compose.yml}`, `../tenon-umbrel-store/README.md`. |
| coordinator | `PLAN.md` · `docs/HANDOFF.md` · `docs/DECISIONS.md` · `docs/STAGE_PROCESS.md` · `docs/stages/**` (implementers append only to "Scaffold notes") · `CLAUDE.md` · `docs/style/**` · `docs/private/**` · `reference/**` · `.claude/launch.json` · every live step on the Umbrel and the NAS · every commit and push. |

### 10.2 server-nas
**Step 0 (alone):** §3.2–§3.5 and §4.3 exactly (constants, `checkNasUrl`, `checkHeartbeatUrl`, `nasCopyFailureMessage` with the §4.4 table, enums, error code, `AppStatus.nasCopy`, DTOs, `BackupsResponse.nasCopy`, fixtures incl. every `backupsPages` state, coverage); schema tests (the URL table, the sentences byte-exact, fixture consistency); `pnpm typecheck` and `pnpm vitest run --project schema` green. **Keeping every project green in step 0:** `apps/server/src/routes/backups.ts` builds a `BackupsResponse` literal, so server-nas adds a **temporary** `nasCopy: offNasCopyStatus(config)` there (a small helper: `configured: 'off'`, `configReason: null`, `missing: []`, `blockedUntilFilesChange: false`, the schedule from the constants with `nextRunAt: null`, `running: false`, `lastRun: null`, `lastSuccessAt: null`, `stale: false`, the heartbeat off) and updates, in the same step, the server tests whose expectations deep-equal the GET body (`test/backups/routes.test.ts`'s `toEqual` of the whole body, and any other suite `pnpm vitest run --project server` shows failing). The web and e2e build only on the fixtures, which gain `nasCopy` in the same step, so they need no step-0 edits: **confirm with `pnpm typecheck` across all projects and `pnpm vitest run --project server --project web`**. The helper is replaced by the real `status()` in step 4. Scaffold note "contract landed". The workflow starts web-nas and deploy-nas after it.
**Then:**
1. `nascopy/{secrets,listing,plan,sentences}.ts` (pure parts) with tests.
2. `nascopy/runner.ts` with the real-runner test and the fake-child kill test; `nascopy/copy.ts` with the C1–C24 tests and the never-throws table.
3. `nascopy/heartbeat.ts`; `nascopy/schedule.ts`; `nascopy/service.ts` and `status.ts`; `backups/service.ts` `whenIdle()`; `config.ts`.
4. `app.ts`/`index.ts` wiring and seams; `routes/backups.ts`, `routes/status.ts`.
5. The read-only pin and the leak test.
6. `pnpm vitest run --project server` green (every existing suite); a prod smoke on **3571**: `pnpm build`, `PORT=3571 DATA_DIR=artifacts/stage8/server-nas/prod IMPORT_CORRECTIONS_FILE=none MARKET_DATA_MODE=fake PRICE_REFRESH_MINUTES=0 NIGHTLY_BACKUPS=false WEEKLY_NAS_COPY=false pnpm start`, seed; `GET /api/backups` (`off`); POST nas-copy → 409; plant the three test files under that `DATA_DIR/secrets/` → `ready`; POST → 202; poll → `failed`, **`no_rsync`** (the dev PC has no rsync: the real runner's `ENOENT` path, end to end), the backups untouched; the leak greps on the bodies, the `job_runs` rows and the server log.

### 10.3 web-nas (phase A in parallel; phase B after server-nas reports done)
**Phase A:** §8.1–§8.6, §8.8 with unit tests on the fixtures; the e2e drafts and the Playwright env (§8.7). Keep every existing web test green.
**Phase B:** the stack on **5573/3573** (a fresh `artifacts/stage8/web-nas/data`, `MARKET_DATA_MODE=fake`, the synthetic import through `import.setup.ts`); run `nas-copy-states.spec.ts`, `backups.spec.ts`, `settings.spec.ts`, `polish.spec.ts` (desktop, phone) and the `backups-mutations` project; screenshots at 1440, 1024 and 375; the Settings page height at 1440 before and after (D109: no sideways scroll; the block's inner width ≤ its container).

### 10.4 deploy-nas
1. The Dockerfile change (§7) and its static test.
2. `lib.mjs` additions, `nas-secrets.mjs` (§6.2) and its tests (§6.4), the real-runner test extended to a stdin pipe (`node -e` reading stdin), proving values go by stdin only.
3. `smoke.mjs nas` and the removal changes (§9.2), `status.mjs` (§9.3), fake-runner tests and `--dry-run` output checked by eye.
4. The store folder (§9.4) and the store test; LF endings; uncommitted.
5. Root `package.json` (`1.1.0`, the script).
6. RUNBOOK, README, ARCHITECTURE (§9.5), generic; the by-hand prettier check.
7. `pnpm guard:all`; the store privacy check (§12 #12).

### 10.5 Reviewers (report findings; do not edit)
- **spec-correctness:** §5 against D126–D129 and this plan: the settled rules (a)–(d) and the catch-up (reason about a case of your own: a restart between attempts 2 and 3; a manual success between retries), the DST suites and the 167/169 h weeks, retries only for retryable reasons, the heartbeat decision table, the refusal lock (the mtime rule, a clock jump, a refusal while the files change), the plan/proof/vanished arithmetic of C1–C24 and one example of your own (a future-dated local file; a restart during a lock), the exit-code table, the stale rule, the API field by field, the page mapping; the Stage 1–7 goldens and suites unchanged.
- **style-ux:** screenshots at 1440, 1024 and 375 of Settings with every `nasCopyStates` fixture (the e2e mocks) and the real page, and the callout on two pages; STYLE_GUIDE §1–§10, D31, D33, D109 (dense rows, no sideways scroll), status never colour-only, §8 formats, the callout tones, focus rings, the words (plain, specific, and **never suggesting the page can take a password**).
- **code-quality/security:** the password's whole path (file → one local → the child env; never argv, a log, a row, a DTO, an error, a closure, `process.env`); the child env built from scratch; `shell: false`; the address rule (try injection: `-e`, `--rsh=`, `rsync://u@h/m/--delete`, `%2F`, `%00`, unicode look-alikes, a 3-level path, `user:pw@`); the sources (only validated names under `backups/`; symlinks; a name with a leading dash cannot occur); the pin test's coverage (a flag spelled through a variable, a constant array concatenated elsewhere); stderr never repeated; the heartbeat (https only, no body, `redirect: 'error'`, never the copy's signal, never logged); the 202 route (no body, cross-site guard, 409 writes no row); `stop()` within its 4 s budget and the whole `preClose` within `FORCE_EXIT_MS` (10 s); the error objects (no `spawnargs`, `path`, `cause` or original message kept; nothing logged as `{ err }`); `HOME` absent from the child env; resource limits (output caps; 15 min ceiling; one copy at a time); **the helper** (values only on stdin; raw-mode restore and `pause()` on every exit path; `umask 077`, `rm -f` and `chmod 600` on every staged write; the pre-commit check; the commit order; no `%s` anywhere; all-or-none; `rm -f` only of fixed names; no value in the dry-run output; Windows spawn rules of Stage 7); the Dockerfile (apt line, lists removed, no extra packages, `USER node` unchanged); `backupIgnore`; every tracked and store file for IPs, host names, NAS names, personal paths (a scratch scan under `artifacts/stage8/review-code/` against `docs/private/stage-8-private.md` §7's terms and the Stage 7 ones, found / not found per file; leave it for the Verifier).

### 10.6 Fixer and Verifier; ports & environment (agents; the dev PC)
- **Fixer:** applies the verified findings across owners; contract changes only with the coordinator's approval (Scaffold note); re-runs the affected checks; never touches the Umbrel or the NAS.
- **Verifier:** runs §12 on **5586/3586** with per-item `DATA_DIR`s under `artifacts/stage8/verifier/` (never `data/`); reports pass or fail with evidence; never commits.

New variable: `WEEKLY_NAS_COPY` (§5.1). **Every agent and Verifier prod run** (`pnpm start`) sets `IMPORT_CORRECTIONS_FILE=none MARKET_DATA_MODE=fake PRICE_REFRESH_MINUTES=0 NIGHTLY_BACKUPS=false WEEKLY_NAS_COPY=false` unless the item under test needs one of them on. Playwright adds `WEEKLY_NAS_COPY=false` (§8.7).

| Agent | WEB_PORT | PORT | DATA_DIR |
|---|---|---|---|
| default / owner / `.claude/launch.json` | 5173 | 3001 | `data` (never used by agents) |
| server-nas | — | 3571 | `artifacts/stage8/server-nas/prod` |
| web-nas | 5573 | 3573 | `artifacts/stage8/web-nas/data` |
| deploy-nas | — (no server; tests only) | — | — |
| Reviewers spec / style / code | 5581 / 5582 / 5583 | 3581 / 3582 / 3583 | `artifacts/stage8/review-{spec,style,code}/data` |
| Fixer | 5584 | 3584 | `artifacts/stage8/fixer/data` |
| Verifier | 5586 | 3586 | `artifacts/stage8/verifier/{e2e,prod,leak}` |

- **Dev-server lessons (Stage 7):** stop the owner's `pnpm dev` before agent work; confirm ports are free before and after; servers on other ports may belong to other projects (check the command line before stopping one); run every command from the repo root; under Git Bash set `MSYS_NO_PATHCONV=1` when an environment value is a path; delete the `DATA_DIR` before every full e2e run.
- Unit tests use OS temp dirs or `:memory:`; never `data/`.

---

## 11. The coordinator's live runbook (the smoke, the release, the owner's set-up and the demo; D126–D129)
Every step here is the coordinator's (with the owner where marked). Owner specifics (the NAS address, its admin path, the brute-force caveat, the dates) are in the private §1–§6. **Every write on the Umbrel needs the owner's OK in chat first** (the smoke, the release, the store push); **the NAS is touched only by the owner** (creating the folder, module and account) and by the app. Remote writes: run the script with `--dry-run` first (the auto-mode permission check, Stage 7).

**Pre-flight:**
0. Stage 7 carry-overs: Settings → Backups on the Umbrel shows the first **Nightly** row with data and the last run **Succeeded**; after 30/09 23:00, History shows September recorded (HANDOFF). The Verifier's report is green; `pnpm check`, `pnpm build`, `pnpm guard:all` green locally; `ssh umbrel true` works; `pnpm umbrel:status` says the app is healthy.

**Step S — the live smoke (owner question 2; owner OK for the writes: an rc image and tag, two scratch containers, a Docker network, a scratch folder):**
1. `pnpm umbrel:release --allow-dirty --skip-store --prerelease rc.1` → `joinr-finance:1.1.0-rc.1` (the first `apt-get install rsync` on the host; the build prints `rsync --version`). **A failed build pushes nothing: fix and re-run, no bump.**
2. `pnpm umbrel:smoke start --image 127.0.0.1:4930/joinr-finance:1.1.0-rc.1` → `pnpm umbrel:smoke check` (the Stage 7 probes plus the heartbeat host's egress) → **`pnpm umbrel:smoke nas`** (§9.2: every probe PASS, including the wrong-password, NAS-stopped, subfolder and leak probes, and the daemon's `refuse options` never tripping).
3. `pnpm umbrel:smoke remove` (the containers, the network, the folders). Record the outcome (the rc digest, rsync's upstream version **and the Debian revision from `dpkg-query`**, the probe results, any fix) in the private §9.
3a. **The route to the NAS, early (owner question 2, only with the owner's OK; it opens a socket to the NAS):** a **login-free TCP connect** from the running 1.0.0 container to the NAS's rsync port: `docker exec tenon-joinr-finance_app_1 node -e "require('net').connect(873,'<NAS Tailscale IP>').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1)).setTimeout(5000,()=>process.exit(2))"` (the IP from the private §1, typed only into this command, never into a tracked file). It connects and exits: **no rsync greeting, no login**, so the NAS's brute-force counter is untouched. Exit 0 proves the private bridge reaches the NAS over Tailscale before the release (§14's first risk moves ahead of step 4); 1 or 2 → §14's routing fallback is decided **before** releasing. Record the result in the private §9.

**Release and update:**
4. **Build and push 1.1.0:** `pnpm umbrel:release --allow-dirty`; copy version, tree id, `HEAD`, dirty and digest into the private doc now (HANDOFF at the close).
5. **Store push** (owner OK): `git -C ../tenon-umbrel-store diff` (the image line, `version: '1.1.0'`, `releaseNotes`, the description paragraph, `backupIgnore`, the compose comments, the README line); the store privacy check (§12 #12); show the owner; commit `1.1.0 - Joinr Finance, weekly copy to the NAS`; push (D10: only with the owner's OK).
6. **Update (owner clicks)** after `pnpm umbrel:status` prints "Safe to click Update". Then: `/api/health` version `1.1.0`, migrations **6**; no pre-update backup (no migration); Settings → About v1.1.0 / v1.1.0; Settings → Backups: **Copy to the NAS — "Not set up"**, the button disabled; no NAS callout; the Stage 7 parts unchanged.

**The owner's NAS set-up (D127):**
7. **On the NAS (owner):** a new shared folder; the rsync server on; a new rsync account allowed only on a new module for that folder, with write access (the private §4 has the admin path). The owner keeps the names to himself; they are never typed into the chat.
7a. **Rehearse the hidden prompt (owner, the same PowerShell or Windows Terminal window he will use):** `node tools/deploy/nas-secrets.mjs --prompt-test`, typing (or pasting) anything **but the real password**: it must print only "read N characters, nothing was echoed", and nothing typed may appear on the screen; Backspace and a paste behave. If anything is echoed or the window hangs: stop, and do not type the password; the reader is fixed (a Fixer pass, no release needed: the helper runs on the PC) and the rehearsal repeated.
8. **The helper (owner, the same window):** the coordinator first runs `pnpm umbrel:nas-secrets --dry-run` and shows the output; the owner then runs `pnpm umbrel:nas-secrets`, types `rsync://<account>@<NAS Tailscale IP>/<module>`, the password twice and (owner question 3) the heartbeat URL or Enter. **The coordinator never asks for, reads or echoes any of it.**
9. `pnpm umbrel:nas-secrets --check` (coordinator): the folder `700 1000`, the files `600 1000`, state `ready`; `pnpm umbrel:status` shows the same.

**The demo (PLAN acceptance):**
10. **A copy reaches the NAS and is proved:** **right after the helper, the owner clicks Copy to NAS now** (the last Sunday's slot is unsettled, so by S7 the timer would start a copy within the hour anyway; "Next" shows that armed wake, within the hour, until the first copy succeeds, and only then **Sunday 04/10/2026 03:00**, the October DST day, §5.9). Settings → Backups: "Weekly, Sunday at 03:00 (Australia/Melbourne)"; the click → Running → **Succeeded: N sent, 0 already there · N on the NAS** (N = the backups listed). If the S7 copy had just started, the click shows "A copy was already running." (joined) and the same result; if it had already finished, the click shows 0 sent and N already there, which is also correct. The owner opens the NAS folder (its file manager): N files with the same names; the coordinator compares names and sizes with `pnpm umbrel:status`'s list. **This is the first login from the app to the NAS** (the route itself was proved at step 3a if the owner agreed; otherwise this is also the first proof of the route, and an `unreachable` here → §14's routing fallback).
11. **A second run sends nothing new:** click again → **0 sent, N already there**.
12. **The heartbeat** (owner question 3): the owner creates a check (period 7 days, grace 1 day) and runs `pnpm umbrel:nas-secrets --heartbeat-only`; Copy to NAS now → the page shows "last ping sent", the monitoring service shows the ping.
13. **A restore from the NAS copy** (no Umbrel write): the owner copies one backup file from the NAS share to the PC; the coordinator runs a local check (`artifacts/stage8/demo/check-backup.mjs`: the SQLite header, `integrity_check`, 6 migrations, data present) and a scratch restore `DATA_DIR=artifacts/stage8/demo/restore pnpm restore:backup <path> --yes` (exit 0). (The Umbrel path, `pnpm umbrel:restore --from-file`, was proven in Stage 7; the RUNBOOK documents it for the NAS file.)
14. **Failure never touches a backup** (already proven by the smoke's wrong-password and NAS-stopped probes and the unit tests; no live failure is induced on the real NAS, so its brute-force protection is never provoked).
15. **Leaks, live:** `docker logs tenon-joinr-finance_app_1 2>&1 | grep -c -e 'rsync://' -e '<NAS Tailscale IP>' || true` prints `0` (the IP from the private §1, typed into the command only); the owner may also grep for his account and module names (the coordinator does not know them). **The coordinator never greps for the password** (he must never hold it).
16. **Next session:** after Sunday 04/10/2026 03:00 (the DST day), Settings → Backups: the last copy `Succeeded` with trigger `schedule`, sent = that week's new files; that day's nightly at 03:30 AEDT arrives on the NAS the following Sunday.

**Close:** HANDOFF (the NAS copy is live; the release record; the heartbeat state; what the next session checks), PLAN status, DECISIONS (the §17 answers, the demo), the Stage close notes here; **commit locally with the owner's OK**; push only if the owner asks (D10).

---

## 12. Acceptance tests (the Verifier runs every item)
**Isolation:** never `data/`; never the Umbrel or the NAS; confirm 5586/3586 are free and delete each item's `DATA_DIR` first; stop servers between groups. Order: **1–4 → 5–7 (prod) → 8 (e2e) → 9–14.**

| # | Check | How |
|---|---|---|
| 1 | Install and static checks | `pnpm install --frozen-lockfile` and `git diff --exit-code pnpm-lock.yaml`; `pnpm typecheck`, `pnpm lint`, `pnpm format:check` exit 0; read the RUNBOOK's new section and check its internal links and anchors |
| 2 | Unit tests | `pnpm test` green: ≥ 5665 + new; the `deploy` project ran (with its real-runner tests); the Stage 1–7 gated suites and goldens **ran** (`--reporter=verbose`); any skip printed its reason |
| 3 | Targeted suites | `pnpm vitest run --project server test/nascopy --reporter=verbose` (the DST cases by name: the October and April Sundays, the 167 h and 169 h weeks; S1–S15; C1–C24; **the refusal lock**; **`stop()` under 4 s**; **the read-only pin**; **the leak test** with its four leak-object cases); `--project schema`; `--project web src/pages/settings src/layout src/api`; `--project deploy` |
| 4 | No migration, no engine change | `git diff --exit-code apps/server/migrations packages/engine/src`; `/api/health` → `migrations: 6` (in #5) |
| 5 | Prod build and the off state | `pnpm build` (no chunk warning); `PORT=3586 DATA_DIR=artifacts/stage8/verifier/prod IMPORT_CORRECTIONS_FILE=none MARKET_DATA_MODE=fake PRICE_REFRESH_MINUTES=0 NIGHTLY_BACKUPS=false WEEKLY_NAS_COPY=false pnpm start` after `pnpm seed:dev --yes` on that folder; `GET /api/backups` → `nasCopy.configured` `off`, `lastRun` null; `POST /api/backups/nas-copy` → 409 `NAS_COPY_NOT_READY` with the off message and **no** `nas-copy` row (a scratch read of `job_runs`) |
| 6 | Half set up, invalid, ready (real runner, no rsync) | plant only `nas-url` → `partial`, `missing: ['nas-password']`, 409 with the `password_missing` sentence; plant a `user:pw@` URL → `invalid`, `configReason: 'url_invalid'`, 409; plant `rsync://u%zz@h/m` → `GET /api/backups` **and** `GET /api/status` 200 with `invalid` (never a 500); plant a password file with a NUL → `invalid`, `configReason: 'password_invalid'`; plant valid test values (§10.0) → `ready`; `POST` → 202 `joined: false`; a second `POST` within the run → `joined: true` or a finished run (report which); poll → `failed`, reason **`no_rsync`**, `attempted: true` (the spawn of the first listing failed, §5.5), the §4.4 sentence; `GET /api/backups`'s `backups` list and the `backup` job's `lastRun` unchanged; `POST` with `Sec-Fetch-Site: cross-site` → 403; a `{"x":1}` body → 400 |
| 7 | Leaks (prod) | on `artifacts/stage8/verifier/leak` with the §10.0 planted values: every `GET /api/backups`, `/api/status` and error body, every `job_runs` row (a scratch SQLite read), and the server's captured stdout/stderr contain none of the planted user, host, module, password or heartbeat token, and no `rsync://` |
| 8 | e2e | `PORT=3586 WEB_PORT=5586 DATA_DIR=artifacts/stage8/verifier/e2e pnpm e2e`: setup, every Stage 0–7 spec, `nas-copy-states` on desktop and phone; every mutation project (including `backups-mutations` with the 409/403/400 additions) passed; list any read-only test that needed a retry |
| 9 | Dockerfile, static | the deploy project's Dockerfile test; by eye: the apt line in the runtime stage before the app copy and `USER node`, `--no-install-recommends`, the lists removed, the `/etc/popt` and `/etc/popt.d` checks, `rsync --version`, the `dpkg-query` line, the `FROM` digest unchanged from Stage 7 |
| 10 | Deploy scripts, dry run | `node tools/deploy/nas-secrets.mjs --dry-run` (no prompt; the mkdir/stage/commit/verify commands with `<stdin: secret>`; no value; the absolute app-data path from `/dry-run-home`); `--dry-run --check`, `--dry-run --remove --yes`, `--dry-run --heartbeat-only`; `node tools/deploy/nas-secrets.mjs` and `--prompt-test` with stdin not a TTY → exit 2 with the mintty sentence; no printed command contains `%s`; `node tools/deploy/smoke.mjs --dry-run nas` (the conf on stdin, the host-generated password command, the network, the daemon run from the rc image, the probes) and `--dry-run remove` (the NAS container, network and folder); `node tools/deploy/status.mjs --dry-run` (the `stat` lines, no `cat`) |
| 11 | Store folder (local clone) | the store test ran (not skipped); `git -C ../tenon-umbrel-store status` shows only `tenon-joinr-finance/{umbrel-app.yml,docker-compose.yml}` and `README.md` changed, **nothing committed** (`log -1` is still the commit recorded in the private §3) |
| 12 | Privacy | `pnpm guard:all` exits 0 (with the Stage 8 terms); the guard over the store clone (the Stage 7 command; the only allowed findings are the Stage 7 ones); the code reviewer's scan re-run on the final diff and the store folder: nothing found; no IP address other than loopback, no host name but `umbrel` and the planted test names, no NAS name, no personal path in `tools/deploy`, the runbook, the README and the store files |
| 13 | The pin and the flags | `git grep -n -E -- "--delete|--remove-source-files|--partial|--inplace|--password-file" -- apps/server/src packages/schema/src tools/deploy` finds only the pin test, the smoke's `refuse options` line and comments that explain the rule (list each hit); the pin test ran in #3 |
| 14 | CODE-8 | `pageCases.ts` mocks `GET /api/backups` for Settings and the page-wide suites pass; no "not built yet" NAS line left in the RUNBOOK or README; the smoke's egress list includes the heartbeat host; no page shows "Stage 8" |

**PLAN acceptance, live (the coordinator, §11):** a copy reaches the NAS and is proved by listing it back (step 10); a second run sends nothing new (step 11); a NAS that is off, refuses, or is half configured never fails a backup (the smoke's probes, step S; the unit tests); nothing on the NAS is ever deleted or overwritten in place (the pin test, #3 and #13; the smoke daemon's `refuse options`).

---

## 13. Every agent: final report checklist
- Files created or changed (all inside your ownership; Scaffold notes appended; deploy-nas lists the store-clone files separately and confirms nothing was committed there).
- Commands run with pass/fail: typecheck, lint, format:check, your scoped tests, your e2e specs on your ports, `pnpm guard:all` (deploy-nas: and the store check, and the by-hand `prettier --check` of the RUNBOOK).
- No `ssh`, `scp`, `docker` or `rsync` was run against any host; no server was started on `data/`; every prod run used the §10.6 variables; only planted test values were ever written to a `secrets/` folder.
- Screenshot paths under `artifacts/screenshots/` (web-nas, style-ux) and the STYLE_GUIDE §10 self-check.
- server-nas: the `no_rsync` end-to-end result of the prod smoke and the leak greps.
- Contract gaps or cross-owner requests (not worked around).
- Ports free, no background processes left.
- Nothing committed or pushed; no owner data, IPs, host names (other than `umbrel`), NAS names or personal paths in any tracked or store file.

---

## 14. Risks & fallbacks
| Risk | Status / fallback |
|---|---|
| **The app's private bridge cannot reach the NAS over Tailscale** (the smoke cannot prove it; the sibling app on Umbrel's shared bridge can; read-only checks agree: the app is only on its non-internal bridge with default masquerading, the host forwards, and Tailscale's table-52 rule is the sibling's route too) | Proved **before the release** by the login-free TCP connect of §11 step 3a if the owner agrees (owner question 2), else at step 10. If it fails `unreachable` while the NAS is up: check from the host (`rsync --list-only` with the owner's own session, never the app's files) and the container (`docker exec … rsync --contimeout=5 --list-only rsync://<IP>/` without credentials: a module list or an auth prompt proves the route); fallbacks in order: the NAS's LAN address if both are on one LAN (unencrypted on the LAN; accepted only with the owner's OK), else a compose-only release adding the app to Umbrel's shared bridge as well (D120's accepted risk returns; the owner decides). |
| **Tailnet names do not resolve in the container** (verified) | The address carries the NAS's Tailscale IP; the helper's prompt and the RUNBOOK say so. |
| **Repeated wrong passwords trip the NAS's brute-force protection** and block the Umbrel's address, which also stops the owner's other app copying to the NAS | `auth`, `unknown_module` and `refused` engage **the refusal lock** (§5.9): neither the timer nor the button tries again until the helper places the files again, and then exactly once per placement (409 `NAS_COPY_FIX_FIRST`, the greyed-out button, the callout); a refusal while the files change is recorded `other`, not a refusal; a wake never joins a click, so one refused click at slot time costs one login, not two (S13, S15); the smoke proves the lock against the scratch daemon; no failure is induced on the real NAS. Adding the Umbrel's address to the NAS's trusted list would remove the risk of a block but also the NAS's protection against that address; not asked for (the app's own lock is the protection). |
| **A weekly copy silently stops** (the NAS moved, a password changed, the app half set up) | The page's last-copy line, the every-page callout after 8 days or when half set up, unusable or locked, and the optional heartbeat (a success ping per copy; `/fail` when a slot is given up; silence when half set up raises the monitoring service's own alarm). |
| **Two missed Sundays lose nightly copies** (the app keeps 14 dates) | The catch-up on every start, the 1 h wake cap for a slot that becomes due, the retries, the 8-day stale callout (about six days before a loss). |
| **The rsync binary or the mirror is unavailable at build time** | The build fails before anything is pushed (no bump needed); the Debian mirror was reachable from the Umbrel; the smoke builds first. |
| **Deleting or overwriting on the NAS by a future change** | The flag allowlist, the source-scan pin, the behavioural pin, and the smoke daemon's `refuse options`. A change that needs another flag makes the pin fail, which is the conversation to have first. |
| **A replaced wrong-size file on the NAS** (§5.5) | Only a name whose NAS size differs from the verified local copy; written through a temporary and renamed; owner question 1 offers "never replace". |
| **The password in memory, argv or logs** | File → one local → the child's env; argv never; logs, rows, DTOs never; the leak test and the smoke's host-side greps. The child env is built from scratch. |
| **The address in the container's process list** (argv carries `rsync://user@host/module/`) | Inside the app's own container only; no credential in it. Accepted (the owner's other app does the same). |
| **The password in the rsync child's environment** (`/proc/<pid>/environ` while a copy runs) | Readable only by the same uid (1000), which already owns `nas-password`, and by root; no escalation. Never in argv, a log, a row or a DTO. Accepted and listed in the RUNBOOK's Accepted risks. |
| **A popt alias adding a flag** (client rsync reads `$HOME/.popt` and `/etc/popt`) | `HOME` absent from the child env (the runner's exact-keys test), and the image build fails if `/etc/popt` or `/etc/popt.d` exists (§7). |
| **A non-Tailscale address typed by mistake** (a LAN address or a public name would send the files unencrypted every week) | The helper warns and requires `yes` for any address outside Tailscale's ranges (§6.2). |
| **`app_proxy` can read `data/secrets/`** (it mounts the app-data parent read-only) | The same for every Umbrel app that keeps a credential in its data folder; accepted and documented (the owner's other app records the same). |
| **Plain SQLite on the NAS** | The files are the same plain copies the Download button gives; the NAS folder is private to the owner's accounts; Tailscale encrypts the transfer. Owner question 4. Encryption at rest is not in Stage 8. |
| **rsync's file-list sort ignores the newest-first order** | The whole batch is one invocation of a few MB; the proof decides the outcome; documented (§5.5). |
| **A prune during the copy** | `vanished`, never a failure (§5.10, C5). |
| **A long copy holds the app's shutdown** (the app force-exits 10 s after the first signal, `FORCE_EXIT_MS`) | `stop()` aborts the service's own controller first in `preClose`; rsync gets SIGTERM, SIGKILL after 2 s, and the runner rejects by 2.5 s whatever the child does; `stop()` waits at most 4 s; no heartbeat ping on `stopped`; recorded `stopped`, not counted as an attempt; the next start catches up. Tested (a hung fake runner and a hung fetch → under 4 s). |
| **The helper's hidden prompt misbehaves in a Windows console** (raw mode; Git Bash's mintty is not a console for Node) | The reader handles ``, both Backspaces, pastes, ESC sequences and split UTF-8, and pauses stdin after each prompt (tested on a fake stream, §6.4); the supported terminals are PowerShell and Windows Terminal; the owner rehearses with `--prompt-test` before typing the real password (§11 step 7a); mintty gets a clear refusal (or `winpty`). |
| **Umbrel-level backups carrying the NAS password** | `backupIgnore: data/secrets` and `data/secrets/*` (§6.3; the matching rule read in umbreld's source). |
| **The NAS fills up over years** (it only adds) | About 4 MB a week at today's sizes; the RUNBOOK says the NAS side is pruned by hand if ever needed; `nas_io` names the case. |
| **The October DST Sunday is the first scheduled slot** | Tested (§5.9 table); the next session checks it (§11 step 16). |

---

## 15. Behaviour changes in Stage 8 (owner can veto)
Numbering is stable. No template (spreadsheet) fixes this stage.
1. **A weekly copy of every kept backup to the NAS**, Sunday 03:00 server time, **one catch-up** 5 minutes after a start when the last slot was missed, and automatic retries at +1 h, +2 h, +4 h **for transient failures only** (never for a refused password or module).
2. **"Copy to NAS now"** starts a copy in the background (202) and the page follows it; it is greyed out until the NAS files are placed, **and after the NAS refuses the password or module until the files are placed again** (the refusal lock; the timer waits too; re-placing allows one attempt, automatically within the hour or at a click).
3. **An every-page callout** when no copy has succeeded for 8 days, or when the copy is half set up, its address or password file unusable, or locked after a refusal (decided default; veto to Settings only).
4. **A wrong-size file of the same name on the NAS is replaced** (via a temporary and a rename; never in place, never deleted) — owner question 1.
5. **The optional heartbeat** pings on every successful copy and at `/fail` only when a scheduled slot is given up; a failed click does not ping.
6. **umbrelOS's own Backups skip the NAS files** (`backupIgnore: data/secrets`, `data/secrets/*`).
7. **The uninstall warning** mentions the NAS copy.
8. **rsync is installed in the image** (about 1 MB larger).
9. **`WEEKLY_NAS_COPY`** (default on) can turn the schedule off; "Copy to NAS now" still works.
10. **`pnpm umbrel:status`** reports whether the NAS files are present (never their contents or sizes).
11. **The last-copy line shows how many backups the NAS holds** ("… · 34 on the NAS"), from the proof's listing.
12. **The helper warns about a non-Tailscale address** and asks for `yes` (the rsync protocol is unencrypted), and has a `--prompt-test` rehearsal mode.

Decisions applied (not changes): D126 (transport, only-adds, the proof, the password's path, the helper, off until placed), D127 (a new folder, module and account; names only at run time), D128 (Sunday 03:00, catch-up, the button), D129 (every kept file; JSON export still deferred; the optional heartbeat). Version **1.1.0** (a feature release; no migration).

---

## 16. Not in Stage 8
- **The JSON export** (D121, D129): still deferred.
- **Deleting, pruning or rotating anything on the NAS**; the NAS keeps every copy it receives.
- **Restoring from the NAS through the app** (or pulling a file from the NAS on the Umbrel): a NAS file is fetched to the PC and restored with the Stage 7 `--from-file` path (RUNBOOK).
- **Encrypting the copies** (at rest on the NAS): owner question 4.
- **A settings form for the NAS** (or any page that accepts an address or a password): the helper only (D126).
- **Copying other folders** (`reference/`, `docs/private/` from the dev PC): the owner can drag them to a NAS share by hand; not part of the app.
- **umbrelOS's built-in Backups** set-up (only `backupIgnore` is touched).
- **HTTPS**, **the Android app** (D124), **the post-cutover data fixes** (D76, D73, D65): unchanged candidates for later stages.
- **Choosing the schedule in Settings**: the D128 values are constants.

---

## 17. Questions for the owner (plan review)
Only genuine choices; everything else has a decided default (vetoable at the demo, §15). Decided without asking: the **catch-up rule** (one copy 5 minutes after a start when the last Sunday was missed; a slot that becomes due while running copies within the hour); **retries** only for transient failures (1 h, 2 h, 4 h); the **8-day** stale signal on every page (plus half set up); the **202** background copy; the files in **`data/secrets/`** with `backupIgnore`; the **Tailscale IP** in the address; the helper run **by the owner in his own terminal**; version **1.1.0**; no migration.

Also decided at the plan review (no question needed): **the refusal lock** (after `auth`/`unknown_module`/`refused`, nothing tries again until the helper places the files again, then one attempt within the hour or at a click: it only removes repeated failed logins, so it is not a trade-off); **the Umbrel's address stays off the NAS's brute-force trusted list** (the lock makes it unnecessary, and the NAS keeps its protection); **the helper runs in PowerShell or Windows Terminal, after a `--prompt-test` rehearsal** (a procedure, not a choice); **the NAS count on the page** (one short line, veto at the demo, §15 item 11).

1. **A file on the NAS with a backup's name but the wrong size** (a damaged copy): (a) **replace it** with the verified local copy (rsync writes a hidden temporary and renames it over the old one; never in place; the owner's other app does this); or (b) **never overwrite** anything on the NAS (`--ignore-existing`): the damaged file stays and every copy reports "1 of N not at the right size" until you delete it on the NAS by hand. *Default: (a).*
2. **Live checks before the release?** (a) **The smoke test on the Umbrel:** it builds a `1.1.0-rc.1` image, runs it on a loopback port with a scratch folder, and runs a **scratch rsync server** (the image's own rsync) on a private Docker network, to prove the real rsync end to end: a copy and its proof, a second copy sending nothing, a wrong password and the lock that follows, a stopped NAS, a subfolder, and no leaks — without contacting your NAS. Everything is removed afterwards except the rc image tag. (b) **A login-free connection test to the NAS:** from the running 1.0.0 app container, open and close one TCP connection to the NAS's rsync port (no rsync greeting, no login, so the NAS's brute-force protection is not involved), proving the app's private network reaches the NAS over Tailscale before anything is released. *Default: both (a) and (b).* Options: both; (a) only; neither (go straight to the release).
3. **The copy's dead man's switch now?** If you have (or create) a healthchecks.io check (period 7 days, grace 1 day), you place its ping URL with the helper at the demo and see the first ping. Or leave it for later (`--heartbeat-only` any time). *Default: set it up at the demo if you have an account; otherwise later.*
4. **The copies on the NAS are plain SQLite files** (exactly what "Download" gives you: your whole financial history, unencrypted), protected by the NAS folder's own access list; the transfer itself is encrypted by Tailscale. Accept that, or ask for encrypted copies (a later stage: a passphrase you would have to keep safe, and a restore that needs it)? *Default: accept plain files in a private NAS folder.*

---

**Owner answers (2026-09-27/28):** 1 → (a) replace a wrong-size file through a temporary file and a rename (D130); 2 → both the smoke (a) and the connection test (b) (D131); 3 → **no heartbeat at all: drop nas-heartbeat-url, its pings, the helper's heartbeat prompt and --heartbeat-only from Stage 8** (D132); 4 → accept plain files (D133). Every other behaviour change accepted (D134).

## Scaffold notes

_Implementers append here (append-only, inside this section, above the Stage close notes): where the code differs from, or adds to, the plan above. server-nas's step 0 note ("contract landed") starts it. The Fixer appends contract clarifications here too._

**server-nas, step 0: contract landed** (`packages/schema/src/{nasCopy.ts,dto/nasCopy.ts,fixtures/nasCopy.ts}` new; `enums.ts`, `index.ts`, `dto/{backups,errors,status}.ts`, `fixtures/{backups,index,coverage,sampleDtos}.ts` edited; `test/nasCopy.test.ts` new). §3.2–§3.5 and §4.3 as written, **minus every heartbeat element (D132)**:
- *Removed constants and functions:* `NAS_SECRET_FILES.heartbeat` (the object is exactly `{ url: 'nas-url', password: 'nas-password' }`; "three one-line files" reads "two", both or neither); `checkHeartbeatUrl`. Server-only, not landed and not to be written: `HEARTBEAT_TIMEOUT_MS`, `HEARTBEAT_RETRY_DELAY_MS`, `nascopy/heartbeat.ts`, the service's `fetch?` option and `BuildAppOptions.nasCopyFetch`, the §5.8 ping decision, the heartbeat token in every leak grep list (§5.12, §9.2, §12 #7).
- *Removed types and fields:* `NasHeartbeatOutcome`; `NasCopyJobDetail.heartbeat`; the whole `NasCopyStatusDto.heartbeat` block (`configured`, `usable`, `lastPing`, `lastPingAt`). `AppStatus.nasCopy` never had one.
- *Removed fixture states and coverage:* `nasCopyStates.heartbeatSent`, `.heartbeatFailed`, `.heartbeatInvalid`; `FIXTURE_COVERAGE.nasHeartbeatOutcomes`. A schema test asserts no root export and no NAS fixture contains "heartbeat".
- *Sentences:* no §4.4 sentence, 409 message or the tail mentioned the heartbeat, so all are unchanged and byte-exact. For web-nas: the §8.2 "Heartbeat" KV row and its five texts go; for deploy-nas: `--heartbeat-only`, `--remove-heartbeat`, prompt 3, `nas-heartbeat-url` in the `--remove` and commit commands, and the `hc-ping.com` egress entry go.
- *Additions (generic, additive):* fixture **`partialUrl`** (`configReason: 'url_missing'`, `missing: ['nas-url']`, `lastRun: null`), needed for "all four" config reasons in coverage; **`nasCopyFixtureNow`** (each state's `now`, local ISO) and **`NAS_COPY_FIXTURE_TIME_ZONE`** (= `BACKUPS_FIXTURE_TIME_ZONE`). `succeededNoOnNas` is a manual run with **`vanished: 1`** (covers the §4.5 vanished text). `invalidPassword`'s `lastRun` is the older 08/09 **success** (so the Copy row visibly comes from `configReason`, never `lastRun`). `blocked`'s run is `auth`/exit 5 at the slot. `stopped` is a crash-left row (`detail: null`, the `stopped` sentence). `backupsPages.nasReady` = `typical` + `nasCopyStates.succeeded`; every other page has `nasCopyStates.off`. `apiErrors.nasCopyNotReady` / `.nasCopyFixFirst` carry `NAS_COPY_OFF_MESSAGE` / `NAS_COPY_FIX_FIRST_MESSAGE`.
- *`nasCopyFailureMessage` precisions:* the "(rsync exit code N)" parenthesis appears only for the nine reasons whose sentence has it, and only for a non-negative integer `code` (otherwise omitted, as the frozen code-less `timeout`); `not_verified` takes `{ missing, total }` with `total` = intended names = `sent + missingAfter` (vanished excluded), defaulting to 0.
- *`checkNasUrl` precisions (deploy-nas's copy must match; the table is `ACCEPTED`/`REFUSED` in `packages/schema/test/nasCopy.test.ts`, 87 cases):* the shape is checked on the **raw** text (so `..` and `.` segments are refused before WHATWG `URL` would resolve them away), then `new URL` must parse it as `rsync:` with no password, query or fragment; `user:@host` (an empty password) is refused too; the host must **start with a letter or digit** (stricter than §5.3's `[A-Za-z0-9.-]+`); the scheme is case-insensitive and the canonical URL is lower-case `rsync://`, with segments percent-decoded and a port's leading zeros dropped; empty/whitespace-only/non-string → `{ ok: false, configured: false }`; everything else refused → `{ ok: false, configured: true }`; no throw for any input.
- *Step-0 bridge (server):* `apps/server/src/routes/backups.ts` exports a TEMPORARY `offNasCopyStatus()` (`off`, `schedule.enabled: false` because `config.weeklyNasCopy` lands in step 3, `nextRunAt: null`), replaced by the service's `status()` in step 4; `test/backups/routes.test.ts`'s whole-body `toEqual` includes it. Existing schema tests that located Stage 3/4/5/7 codes by negative `slice` offsets were shifted by the two new codes.
- Checks: `pnpm typecheck` (all projects), `pnpm lint`, `pnpm format:check`, `pnpm guard:all` green; `vitest --project schema` 1099 passed; `--project server --project web` 3188 passed, 1 skipped (pre-existing).

**web-nas, phase A: done** (§8.1–§8.6, §8.8, e2e drafts; D132: no heartbeat anywhere in the web). New: `apps/web/src/pages/settings/{NasCopyBlock.tsx,nasCopyDisplay.ts,NasCopyBlock.test.tsx,nasCopyDisplay.test.ts}`, `apps/web/src/layout/{nasCopyStale.ts,nasCopyStale.test.tsx}`, `e2e/nas-copy-states.spec.ts`. Edited: `settings/{BackupsSection.tsx,backupsDisplay.ts,SettingsPage.tsx,backups.css,BackupsSection.test.tsx}`, `api/{hooks.ts,hooks.backups.test.tsx}`, `layout/RootLayout.tsx`, `pages/{pageCases.ts,noStage5.test.tsx}`, `e2e/{backups-support.ts,backups.spec.ts,backups-mutations.spec.ts,settings.spec.ts}`, `playwright.config.ts`.
- *No heartbeat (D132):* the §8.2 Heartbeat KV row and its five texts are not built; the block's rows are Copy, Next (only with `nextRunAt`), Last copy, Last success (only when a last copy exists and did not succeed; shown while one runs too).
- *The address guard vs. the frozen sentence:* the §4.4 `url_invalid` sentence itself contains `rsync://user@host/module` (a form, not a value), so §8.6's "grep for `rsync://`, `@`" would fail on `invalidUrl`. The guard (unit and e2e) removes exactly the phrase "an rsync://user@host/module address" (tested to be part of `nasCopyFailureMessage('url_invalid')`), then finds no `rsync://` and no `@`.
- *Callout precedence:* one NAS callout; "NAS copy not working" (partial, invalid, blocked) is named before "NAS copy overdue" when both hold (a lock older than 8 days). It renders under the Stage 7 backup callout.
- *Follow rule (§8.1, as frozen):* done when the followed id is no longer running or a newer id shows; when the newer id is itself still running, the followed copy counts as done with no result text (the Last copy row shows the new run). The rule runs while rendering (derived state, no setState-in-effect); an effect then invalidates `['backups']` and `['status']`.
- *Words chosen (not frozen):* result callouts "Copying to the NAS" (note: "Copy started." / "A copy was already running."), "Copied to the NAS" (note: "Copied: N sent, M already there."), "Not copied" (`do-not`: "Copy failed: <sentence>", and the 409 message for both codes); the KV table and the group are named "Copy to the NAS"; the h3 uses `jf-app-subhead__title` (the card-heading style).
- *Unavailable button:* `aria-disabled="true"` (never `disabled`), `aria-describedby="nas-copy-state"` (the Copy row's text), styled like a disabled button in `backups.css`. Playwright treats `aria-disabled` as disabled for actionability, so the e2e clicks it with `force: true` and counts POSTs through an intercepting route (`countNasCopyPosts`, never reaching the server).
- *Phone:* "Back up now" and "Copy to NAS now" both take the full width below 768 px (§8.2 item 5 said "like Back up now", which was not full width before; one rule now covers both).
- *CODE-8:* `pageCases.ts` Settings mocks `GET /api/backups` = `backupsPages.typical` with `app.version = __APP_VERSION__`; states, formatAudit, noStage5 (now also "Stage 8") and the router test pass.
- Checks: `tsc` (root incl. e2e, and apps/web), eslint and prettier on every owned file, `vitest --project web` 1921 passed (baseline 1781). `guard:all`: one finding in `tools/deploy/lib.mjs` (deploy-nas's file, not web-nas's). No e2e run yet (phase B: 5573/3573, and the Settings page height at 1440 before/after).

**deploy-nas: done** (§6, §7, §9, §10.4; D132: no heartbeat). New: `tools/deploy/nas-secrets.mjs`, `tools/deploy/test/{nas-secrets,smoke-nas}.test.mjs`. Edited: `Dockerfile`, `package.json` (1.1.0, `umbrel:nas-secrets`), `tools/deploy/{lib,smoke,status}.mjs`, `tools/deploy/test/{dockerfile,store,status-smoke,release}.test.mjs`, `docs/deploy/RUNBOOK.md`, `README.md`, `docs/ARCHITECTURE.md`. Store clone (uncommitted): `tenon-joinr-finance/{umbrel-app.yml,docker-compose.yml}`, `README.md`.
- *No heartbeat (D132):* two files only; no heartbeat prompt; `--heartbeat-only` and `--remove-heartbeat` are unknown options (exit 2, tested); `--remove` deletes `nas-url`, `nas-password` and `.nas-*.new`; `EGRESS_URLS` unchanged (no `hc-ping.com`); the RUNBOOK has the one "not provided" line.
- *No `%s` in any remote command:* the Stage 7 `remoteHome` now runs `echo "$HOME"` (was `printf %s "$HOME"`), so the helper's "no remote command contains `%s`" holds literally. The NAS stat is one shell function (`c <label> <path>`) printing `<label> missing`, `<label> link` or `<label> <mode> <uid> <nonempty|empty> <file|dir|other>` (`stat -c '%a %u'`, `test -s`, `test -f/-d`); any other line (a planted size) does not parse and reads "could not be checked". The same helper backs `--check`, the pre-commit and post-commit checks, and `status.mjs` (`nas-files`).
- *`--check` states:* off, partial (a file missing **or empty**, as the app reads it), invalid (a link, a folder, not a regular file), ready ("the address itself is checked by the app"), unknown.
- *Dry-run rendering:* `renderSpec` prints any `input` as `< <stdin: secret>` unless the spec says `publicInput: true` (only the smoke's fixed `rsyncd.conf`, shown as a `<<'STDIN'` block). Secure by default.
- *The raw-mode reader:* `readLine`/`readHidden`/`readVisible` in `lib.mjs` (the visible one echoes and erases with `\b \b`); characters after the Enter in the same chunk are discarded; a `\r` that ends its chunk swallows a leading `\n` of the next chunk only. The end of input rejects like Ctrl+C (exit 130). The Tailscale confirmation needs exactly `yes`; placing prompts only after the preflight and the app-folder check (nothing is typed for an unreachable host).
- *`smoke nas` differences:* the daemon's image is read from `docker inspect joinr-smoke` (`.Config.Image`) unless `--image` is given; it refuses when `joinr-smoke` is not running (exit 1) or `joinr-smoke-nas` exists (exit 3). Host listings use `find -mindepth 1 -maxdepth 1 -printf '%y %s %T@ %f'` (names, sizes, mtimes) instead of `ls -ln`. The foreign-file and `.x.partial` probe is a third copy after the "sends nothing" one (so that probe's NAS folder is really unchanged). "The daemon sees exactly one failed login" is not observable (the daemon has no log file; syslog is absent in the container), so the lock probe checks the 409 code **and** that `lastRun.id` did not move. The leak probes count on the host in `docker logs` **and** in fresh `/api/backups` + `/api/status` bodies, each `grep -c -F -- … || true`; the PC also checks every body it saved. `--dry-run` prints `DRY` instead of PASS/FAIL. `smoke start` adds `-e WEEKLY_NAS_COPY=false`; `smoke remove` removes `joinr-smoke-nas`, `joinr-smoke`, the network (if present) and the whole smoke root (which holds `nas/`).
- *`refuse options` names* (`delete remove-source-files partial inplace append`) could not be checked against bookworm's `rsyncd.conf(5)` here (no rsync and no network on the dev PC): the coordinator confirms at step S that the daemon starts (`docker logs joinr-smoke-nas`) and records any change.
- *Stage 7 test fixed:* `release.test.mjs` "refuses a digest the registry header does not confirm" asserted the copied store compose still held the placeholder digest; since the store's 1.0.0 release the real clone pins a real digest, so it failed at HEAD independently of Stage 8. It now asserts the store files are unchanged.
- *Store:* `backupIgnore` + `data/secrets`, `data/secrets/*` (with the comment); the description's uninstall warning points at the NAS copy (the NAS keeps its copies) and a "Copy to the NAS (optional)" paragraph; `releaseNotes` drafted for 1.1.0 while `version: '1.0.0'` and the image line stay for `release.mjs`; compose comments only; the README line. LF endings; nothing committed (`log -1` still `1.0.0 - Joinr Finance, the first release`).
- *RUNBOOK:* new "Copy to the NAS" (what it does, set-up on the NAS, placing the files, removing it, troubleshooting with the refusal lock and one entry per §4.4 sentence as a list, restore from the NAS copy); Backups, Accepted risks, go-live checklist, Uninstall, Prerequisites and the prerelease smoke line updated. `prettier --check --ignore-path= docs/deploy/RUNBOOK.md` passes (README and ARCHITECTURE were not prettier-clean at HEAD either; Markdown is not format-checked).
- Checks: `vitest --project deploy` 314 passed (new: nas-secrets 113, smoke-nas 20, plus the Dockerfile and store additions); eslint and prettier on `tools/`; root `tsc`; `guard:all` OK; the store guard shows only the Stage 7 allowed findings (the `data/**/.gitkeep` paths and the store owner's name on existing lines).

**server-nas, steps 1–6: done** (new: `apps/server/src/nascopy/{constants,secrets,listing,plan,sentences,runner,copy,schedule,status,service}.ts`, `apps/server/test/nascopy/{helpers.ts,url,secrets,listing,plan,sentences,runner,copy,readonly,schedule,service,routes}.test.ts`; edited: `app.ts`, `index.ts`, `config.ts`, `routes/{backups,status}.ts`, `backups/service.ts` (`whenIdle()` only), `test/{config.test,status-routes.test,helpers}.ts`, `test/backups/{routes,service}.test.ts`). §5 as written, **minus the heartbeat (D132)**: no `heartbeat.ts`, no `fetch` seam, no ping decision, nothing heartbeat in a log, row, DTO or grep list. Where the code differs from, or adds to, the plan:
- *Files and options:* the §3.3 constants live in `nascopy/constants.ts` (plus `RSYNC_STDERR_LIMIT` = 64 KiB and `RSYNC_ABORT_SETTLE_MS` = grace + 500 ms). The step-0 `offNasCopyStatus()` is gone; `backupsRoutes` takes a required `nasCopy` option (`status`, `copyNow`), `readAppStatus` an optional fifth argument. `BuildAppOptions` gains `nasCopyClock?` and `nasCopyRunner?` as planned, plus a test-only `logStream?` (the app's pino destination, so the leak test reads every line the app wrote); `createNasCopyService` has a test-only `copy?` seam (the job's own never-throws wrapper, tested with a real pino logger).
- *Runner:* the test swaps the executable through the one `spawnImpl` seam (no second option). On win32 libuv adds its required Windows variables (`SYSTEMROOT`, `TEMP`, `USERPROFILE`, …; never `HOME` or an `RSYNC_*`) to a child whose environment lacks them, so the exact-keys test asserts the env **handed to spawn** exactly on every platform, the child's keys exactly on Linux, and on win32 only libuv's list as extras. A child ended by a signal resolves `code: -1` (its failure then shows no exit-code parenthesis). Errors: `RsyncMissingError`, `RsyncStartError(code)`, `RsyncAbortError(why)` (name `AbortError`).
- *Deadline:* the 15-minute ceiling is the service's own controller fired on the injectable clock (`NasCopyDeadline`, name `TimeoutError`) instead of `AbortSignal.timeout`, so fake clocks drive it; `abortWhy()` also recognises any `TimeoutError` reason.
- *Copy:* the abort is checked right after the files are read, so a stop during the `whenIdle()` wait records `stopped`. A truncated first listing records `other` with `exitCode` 0 (§5.4 "with exitCode"); a truncated relist `readback_failed` with its code (0). `not_verified` records no `exitCode`. `copyToNas` while `off` (never reached) records `url_missing`.
- *Service:* a pending retry is tied to its slot (a new Sunday is never held back by the previous slot's retry). `nextRunAt` while due is the later of the gate and the armed wake. The stop-budget warning logs `{ budgetMs }` only.
- *Leak greps (§5.12; also for the smoke §9.2 and the Verifier §12 #7):* the frozen `url_invalid` sentence contains the address **form** `rsync://user@host/module`, so every server leak assertion removes that exact string before grepping `rsync://`; the smoke and the Verifier need the same (or grep `rsync://planted`) whenever an `url_invalid` body or row is in scope. Leak case (c) (the heartbeat) does not apply (D132).
- *Skips with a printed reason:* the symlink secrets case (Windows without Developer Mode) and the `chmod 000` folder case (win32); the injected-`lstat` warn-once test runs everywhere.
- *Checks:* `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm guard:all` green; `--project server` 1719 passed, 3 skipped (1 pre-existing, the 2 above); `--project schema --project web` 3020 passed. Prod smoke on 3571 (§10.2 step 6, planted test values only): off → 409 with the off message, no row; planted files → `ready`; POST → 202 `joined: false` with the running row; a second POST after the first had finished → a new run (`joined: false`); poll → `failed`, **`no_rsync`**, `attempted: true`, the §4.4 sentence (the real runner's ENOENT path, end to end); the backups list and the `backup` job's `lastRun` unchanged; `rsync://u%zz@h/m` → both status calls 200 `invalid`/`url_invalid`; `user:pw@` → 409 `url_invalid`; NUL in the password → 409 `password_invalid`; no password → 409 `password_missing`; `Sec-Fetch-Site: cross-site` → 403; `{"x":1}` → 400; leak greps (the address form removed) on every body, every `job_runs` row and the server log: 0 hits each. web-nas phase B can start.

**web-nas, phase B: done** (§10.3; no file changed in phase B: every spec passed on the phase A code). Stack on 5573/3573, a fresh `artifacts/stage8/web-nas/data`, `MARKET_DATA_MODE=fake`, the §10.6 variables, the synthetic import through `import.setup.ts`.
- *e2e:* `--project=desktop --project=phone` on `nas-copy-states`, `backups`, `settings`, `polish` (with `setup` and `warmup`): 162 passed, 48 skipped (polish's keyboard walk is desktop-only and its FIRE audit phone-only, by design), 0 retries, 0 flaky. `--project=backups-mutations --no-deps` on the same data: 5 passed (incl. the 409 `NAS_COPY_NOT_READY` with no row, and the nas-copy 403/400).
- *Screenshots:* `artifacts/screenshots/desktop/settings-nas-copy-<state>-{1440,1024}.png`, `artifacts/screenshots/phone/settings-nas-copy-<state>-375.png` (every `nasCopyStates` fixture and `nasReady`), `settings-nas-copy-callout-{stale,partial,blocked}-{networth,history}.png` in both, and `settings-nas-copy-real.png`.
- *Settings height at 1440 (D109):* the real page on the e2e data (after `backups-mutations`) is 6101 px without the NAS block ("before", the block hidden) and 6288 px with it: +187 px, with the block itself 175 px (Copy and Last copy rows at 24 px each). At 1024 it is 7209 → 7396 px, and at 375 10927 → 11160 px (block 220 px). With `backupsPages.nasReady` mocked, the page is 6477 → 6689 px at 1440 (block 200 px), 7585 → 7819 px at 1024 and 11398 → 11717 px at 375. The tallest state is `failedUnreachable`/`stale` at 1440 (264 px) and `blocked` at 375 (377 px). There is no sideways page scroll at any width or state, and the KV table's inner width equals its box every time (1152/1152, 736/736, 343/343).

**Fixer: review findings applied** (all owners' files; no frozen contract changed). Where the code now differs from, or adds to, the plan:
- *Slot runs that are not attempts (service):* a slot run whose `scheduler.run()` rejects (no row), or that fails with `attempted !== true` for a reason other than `stopped`, `no_rsync` or a configuration reason (the job wrapper's `other`; a deadline during the `whenIdle()` wait), now sets an in-memory retry gate for its slot of 1 h, then 2 h, then 4 h (repeating 4 h), as Stage 7's backup does. The attempt number is unchanged (rule d still counts real attempts only). Before, such a run re-ran the slot at once, in a loop. New service tests: a rejecting scheduler, a throwing copy (ready and half set up), a `whenIdle()` that never resolves, the 15-minute deadline on the fake clock (`timeout`, no exit code, +1 h retry as attempt 2), and a restart between attempts 2 and 3 (startup = attempt 3, +4 h = attempt 4, then settled).
- *The wrapper's failure row* records `configured` as read at the start of the job (before `whenIdle()`), not always `ready`.
- *Log codes (§5.12):* a new `nascopy/errorCode.ts` allowlists what a log line may say about an unexpected error: a `code` shaped like `EACCES`/`SQLITE_FULL`, else a `name` ending in `Error`, else `unknown`. `runner.ts` (`RsyncStartError`'s code) and `secrets.ts` keep a system code only (else `UNKNOWN`). A new routes leak case (d'') plants values in `code` and `name`. The vacuous leak case "(c) heartbeat" is deleted: the leak cases are (a), (b), (d), (d') and (d'').
- *Read-only pin:* `--remove-sent` (rsync's deprecated alias of `--remove-source-files`) is forbidden, with a self-check.
- *Dockerfile (§7 differs):* `&& rsync --version > /dev/null` runs before `rsync --version | head -n 1`. RUN's `/bin/sh` has no pipefail, so only the bare run can fail the build. The Dockerfile test pins it.
- *Helper:* `isTailscaleAddress` refuses an IPv4 octet with a leading zero (the C library reads it as octal), so such a host gets the non-Tailscale warning.
- *Web (§8.2 words differ; not frozen):* the locked Copy row now says "…Place the NAS files again with the NAS set-up helper first." (the lock also follows `unknown_module` and `refused`, where "the password" was the wrong instruction). The off row adds "Place them with the NAS set-up helper (see the runbook)." A failed copy's result callout shows "Copy failed: see Last copy above." on screen, and the live region still announces the whole "Copy failed: <sentence>" (visually hidden). The KV table's caption is "NAS copy status". The `#nas-copy` subheading is also rendered while the backups list loads or has failed, with "Shown once the backups have loaded.", so the index link and the callout's link always have a target. The subheading's focus ring fits its words. The RUNBOOK's lock sentence follows the new wording.
- *Not changed:* the half-set-up and unusable Copy rows keep body text. §8.2 gives the stop tint to the lock only, the one state in which the app itself refuses to try, and the other two already raise the every-page callout.
- **Coordinator decisions (2026-09-27/28) on the items below:** (1) accepted as a known limit; (2) no change; (3) checked at step S; (4) covered by the D132 banner at the top of this plan. **Was: COORDINATOR APPROVAL NEEDED (not applied):** (1) The refusal lock compares the files' mtimes with the run's `startedAt` (the row insert). Files placed during the `whenIdle()` wait, and read by that copy, therefore do not keep the lock after a refusal, which allows a second login with the same files. The window is sub-millisecond in production, because `whenIdle()` resolves at once. Options: compare with the mtimes the copy read (kept in memory for the last attempted run), or accept it as a §14 limit. (2) `checkNasUrl` (schema and helper copies) could also refuse a dotted-numeric host with a leading-zero octet; today only the helper's Tailscale check does. (3) At step S, check `remove-sent-files` against bookworm's `rsyncd.conf(5)`, then consider adding it to the smoke daemon's `refuse options`. (4) D132 remnants in §9.1, §9.4, §11 steps 2, 8 and 12, and §12 #7, #10 and #14 (see the Fixer's report).

**Fixer round 2: the Verifier's #8** (e2e only; no app code changed).
- *`history-states.spec.ts` "settings: the tax suggestion bands and the pay form":* this test runs five full Settings loads, each with a full-page shot. With the taller Stage 8 page it ran past the default 30 s under the full suite (the Verifier measured 34–39 s; alone it takes 7.5 s). It now has `test.setTimeout(90_000)`, as `assets`, `networth`, `polish` and `prices` already do. In the full run below it took 29.5 s, so without the change it would have failed again.
- *`nas-copy-states.spec.ts`:* each per-state test and the `nasReady` test also get `test.setTimeout(90_000)`. On desktop each one loads and shots Settings at two widths, taking 14–17 s under the full suite. The Verifier's three first-attempt flakes, and the six in this run, all failed on `net::ERR_NETWORK_CHANGED` while the dev server was serving modules (read from the traces). That is the transient `READ_ONLY_RETRIES` exists for (playwright.config.ts), not a spec defect, so the waits are unchanged.
- *Checks:* a full `pnpm e2e` on 5584/3584 with a fresh `artifacts/stage8/fixer/data` exited 0: 651 passed, 78 skipped and 6 flaky, all passed on retry and all `ERR_NETWORK_CHANGED`. Every mutation project ran inside the main run and passed (3, 7, 3, 4, 1 and 5). A targeted desktop and phone run of both specs on fresh data passed 100 of 100 with no retries. `prettier`, `eslint`, `tsc -p .` and `guard:all` are green. Ports 5584 and 3584 were free afterwards.

## Stage close notes (coordinator)

_Stage close, 2026-09-27/28._ **Stage 8 is accepted (D135).** Build workflow: contract (heartbeat removed, D132) → server-nas, web-nas (A, B), deploy-nas → three reviewers → Fixer → Verifier (#8 failed: a Settings full-page e2e test ran past 30 s once the page grew) → Fixer 2 (longer timeouts) → Verifier 2: all 14 items passed. Coordinator actions: three more guard terms; PLAN's heartbeat wording; the D132 banner above; the host's rsync version generalised; the Fixer's open items decided (see its note).

**Live (§11):**
- Step S: `1.1.0-rc.1` built on the Umbrel (the first image with rsync: 3.2.7, Debian bookworm with its security revision); `smoke check` 9/9; `smoke nas` 16/16 against a scratch rsync daemon (first copy, a repeat that sends nothing, a foreign file untouched, a hidden temporary not copied, a wrong password → `auth` and the refusal lock, re-placed → unlocked, a stopped daemon → `unreachable`, a subfolder, and no leak in logs or 22 API bodies). The daemon's `refuse options` list was accepted, so the Fixer's item (3) is settled. Smoke removed.
- Step 3a: a login-free TCP connection from the running 1.0.0 container to the NAS's rsync port succeeded, so the app's private network reaches the NAS over Tailscale.
- Release `1.1.0` (digest `sha256:5f8bf817d6a7…`, a dirty tree on `9bddc49`) → store push → "Safe to click" → the owner clicked Update: healthy, migrations 6, no pre-update backup, the NAS copy `off`.
- The owner placed the two files with the helper. Its prompt rehearsal came first; Node had to be found in a packaged app's redirected folder (the RUNBOOK now says how). `--check`: 700/600, uid 1000, `ready`.
- **Copy to NAS now**: 7 sent, proved, 7 on the NAS; a second click: 0 sent, 7 already there. Leak scan of the log, the API bodies and `job_runs`: 0.
- A file fetched from the NAS is byte-identical to the Umbrel's copy (SHA-256), passes `integrity_check` (6 migrations, the data present) and restores into a scratch folder (exit 0).
- Next session: after Sunday 04/10/2026 03:00 (the October DST day), Settings → Backups shows a scheduled copy that succeeded.

## Plan review log

_Planner revision, 2026-09-27/28: 33 review findings (1 blocker, 11 major, 21 minor), each checked against the Stage 7 code, the reference design (behaviour only) and, read-only, the Umbrel (umbreld's `backupIgnore` code; the app container's `StopTimeout` of 30 s with an init process). All accepted: two with corrections (R20, R33), one in part (R25), three merged into others (R7 into R1; R22 and R26 into R2). None rejected outright._

| # | Sev. | Finding (short) | Disposition |
|---|---|---|---|
| R1 | blocker | Stop budget is `FORCE_EXIT_MS` 10 s, not 30 s; no per-job abort; heartbeat and SIGKILL grace overrun it | **Accepted.** Verified: `index.ts` `FORCE_EXIT_MS = 10_000`; `scheduler.stop()` is the only abort of `ctx.signal` and runs last. The service owns `serviceStop`; the copy runs under `AbortSignal.any([ctx.signal, serviceStop, deadline])`; `RSYNC_KILL_GRACE_MS` 2 s, the runner rejects by 2.5 s whatever the child does; `NAS_COPY_STOP_BUDGET_MS` 4 s; the heartbeat listens to `serviceStop`; no ping on `stopped`; the "30-second grace" text corrected (header, §3.3, §5.4, §5.5, §5.8, §5.10, §5.13, §10.5, §14). |
| R2 | major | No guard against repeated failed logins by clicking; a slot run joining a failed manual run re-runs at once | **Accepted, merged with R22 and R26.** The **refusal lock** (§5.9): after `auth`/`unknown_module`/`refused` (any trigger), `copyNow()` → 409 `NAS_COPY_FIX_FIRST` and the timer starts nothing until `nas-url` or `nas-password` has an mtime later than that run's start; `blockedUntilFilesChange` (DTO), `blocked` (`/api/status`), the button and the callout; the smoke's wrong-password probe covers lock and unlock. Part (2) is solved by R22's "a wake never joins" rather than by treating a joined run as the slot's attempt (S13, S15). |
| R3 | major | Leak paths: spawn error `spawnargs`/`path`, NUL in env → `ERR_INVALID_ARG_VALUE` quoting the password, fetch `TypeError`/`cause`, the scheduler's `{ err }` log | **Accepted.** Verified the scheduler logs `{ err }` and stores `err.message`. §5.4 fresh error objects from `code` only; the control-character check before any spawn; §5.5 step 9 and §5.11 double wrapper, never `{ err }`; §5.8 `fetch` in a `try`; §5.12 four leak-object cases and the heartbeat token in every grep list. |
| R4 | major | Hidden Node prompt in Windows terminals: mintty is not a TTY; raw-mode details; no rehearsal | **Accepted.** §6.2 supported terminals (PowerShell, Windows Terminal), the mintty/winpty refusal sentence, the reader's character rules (`\r`, `0x08`/`0x7f`, pastes, ESC sequences, `setEncoding`, `pause()`), `--prompt-test`; §11 step 7a rehearsal; §6.4 fake-stream cases; §14 row. |
| R5 | major | `decodeURIComponent` can throw inside `status()` → a 500 on every page | **Accepted.** WHATWG `URL` keeps malformed escapes for `rsync:`; the reference has the same latent bug. §3.2/§5.3 never-throws; url-table cases; a routes test (200, `invalid`); `checkHeartbeatUrl` refuses userinfo. |
| R6 | minor | Staging `umask` does not fix a stale 644 `.new`; mode checked only after the commit; commit-order text wrong | **Accepted.** §6.2 steps 2 (`rm -f`, `chmod 600`), 4 (pre-commit `stat`), 5 (password first), 6; pinned in §6.4. |
| R7 | minor | No per-job abort; `stop()` cannot abort; a ping during shutdown | **Accepted, merged into R1.** |
| R8 | minor | popt aliases via `$HOME/.popt` or `/etc/popt`; `rsync --version` hides the Debian revision | **Accepted.** §5.4 why `HOME` is absent (exact-keys test); §7 `test ! -e /etc/popt && test ! -e /etc/popt.d` and `dpkg-query`; the revision recorded at step S; §14 row. |
| R9 | minor | The smoke daemon inherits the rc image's HEALTHCHECK; `grep -c` exits 1 on zero | **Accepted.** `--no-healthcheck --restart no`; `grep -c -F -- … \|\| true` with the printed count parsed; both pinned in the smoke test. |
| R10 | minor | `stat %s` exposes the password's length | **Accepted.** `%a %u` + `test -s` only, in the helper (§6.2) and `status.mjs` (§9.3); a planted-size test. |
| R11 | minor | Plaintext rsync to a non-Tailscale address typed by mistake | **Accepted (helper only; the server rule must accept the smoke's Docker name).** §6.2 warning + `yes`; `isTailscaleAddress` in `lib.mjs`; §6.4 cases; §14 row. The range and test addresses are written as octet numbers (an `ip(a, b, c, d)` join), never dotted literals: the privacy guard flags every IPv4 literal outside loopback and RFC 5737 (found by `guard:all` on this revision). |
| R12 | minor | `backupIgnore` matching for `data/secrets/*` unverified | **Accepted and verified** in umbreld's source on the Umbrel (read-only): each entry is joined to the app's data folder and written to kopia's gitignore-style ignore file; a folder entry excludes its whole subtree and `*` matches dot-names. Both `data/secrets` and `data/secrets/*` are listed; the store test asserts both and umbreld's character rule (header, §6.3, §9.4). |
| R13 | minor | The unreadable-folder warning floods the log | **Accepted.** Once per change of the error code; 10 reads → 1 warning (§5.2, §5.13). |
| R14 | minor | `RSYNC_PASSWORD` readable in `/proc/<pid>/environ` | **Accepted.** §14 row; a RUNBOOK Accepted-risks line (§9.5). |
| R15 | minor | The route to the NAS is first proved only after the release; step 15 greps only `rsync://` | **Accepted as optional, behind owner question 2(b).** §11 step 3a (a login-free TCP connect from the running 1.0.0 container; the IP typed only into the command); step 15 also greps the NAS IP; the coordinator never greps for the password. |
| R16 | major | The callout date from a UTC `lastSuccessAt` shows the wrong day; the fixtures' time forms contradict §4 | **Accepted.** Verified `backupStale.ts` takes `slice(0, 10)` of a local ISO and `AppStatus` has no zone. `AppStatus.nasCopy.lastSuccessAt` is local ISO with offset (`localIsoWithOffset`); `NasCopyStatusDto` times stay UTC; §3.5 corrected; a web test under `TZ=UTC`. |
| R17 | major | Listing parser: the last field as the name, symlinks, MOTD and device lines, duplicates, a regex-only name check | **Accepted.** §5.6 anchored regular-file pattern, the whole remainder as the name, `parseBackupName`, duplicates → `NaN`; §5.13 cases. |
| R18 | major | The runner cannot signal a truncated listing | **Accepted.** The frozen return type gains `outTruncated`; first listing → `other`, relist → `readback_failed` (C23); runner test. |
| R19 | major | `invalid` cannot say which file is bad; the page reads a possibly stale `lastRun.error` | **Accepted.** `configReason` in `NasCopyStatusDto` and `AppStatus.nasCopy`, from the current files; the Copy row and the callout are built from it; fixtures `invalidUrl` and `invalidPassword`. |
| R20 | major | Many failure modes are untested through `copyToNas` | **Accepted with a correction.** C13–C24 in §5.15 and `copy.test.ts`; the service test says which retry and which ping. C20 records `nas_io` with exit 23 and `missingAfter: 2`: the frozen `nas_io` sentence has no counts, so the finding's "'2 of N'" text applies to `not_verified` only. |
| R21 | major | Rule (d) counts configuration failures and stops; a fail ping on `stopped` | **Accepted.** Rule (d) and the attempt number count only attempted, non-`stopped` failures; no ping for `stopped`; S12, S14 and service tests. |
| R22 | major | A timer wake joining a manual copy gets no slot or attempt; in-memory and persisted state diverge | **Accepted.** A wake never joins: it checks `isRunning` and re-plans after the manual run; only the service's own `schedule`/`startup` runs are slot attempts; S13. |
| R23 | minor | Step 0 cannot stay green with a required `nasCopy` | **Accepted.** A temporary `offNasCopyStatus(config)` in `routes/backups.ts`, the server tests updated in the same step, typecheck across all projects (§10.2). Verified `routes.test.ts` deep-equals the whole GET body. |
| R24 | minor | The SIGTERM → SIGKILL test is vacuous on win32 | **Accepted.** A real-child test for env, argv, exit, cap and ENOENT; the kill escalation with an injected fake `ChildProcess` on a fake clock; the test-only `spawnImpl` allowed by the pin (§5.4, §5.13). |
| R25 | minor | `max connections` treated as a non-retryable refusal; read-only and write-only modules unclassified; local read errors labelled `nas_io` | **Accepted in part.** `/max connections/i` → `other`; `/read only\|write only/i` → `nas_io` in `list` and `send` (the `nas_io` sentence reworded to "store or list"). The local-read-error point is recorded as an accepted limit in §5.7 (verified immutable local files; retryable either way), not changed. |
| R26 | minor | After a wrong password the slot stays settled after the fix; a copy between the helper's two `mv`s reads a mismatched pair | **Accepted, merged with R2.** Refusals no longer settle a slot; the lock lifts on new mtimes and the slot is due again (one attempt per placement); `copy.ts` re-stats the files on a refusal and records `other` if they changed during the run. |
| R27 | minor | The stale fallback counts half-set-up rows | **Accepted.** The oldest attempted run, else not stale; a test (§5.9, §5.13). |
| R28 | minor | Following a copy on the page is ambiguous; fast copies; `['status']` not refetched | **Accepted.** §8.1 frozen follow rule on `lastRun.id` from the 202 body (verified `JobRunSummary.id` exists and the scheduler inserts the row before `copyNow()` returns); both queries invalidated on done; a fast-path test. |
| R29 | minor | `aria-describedby` on a natively disabled button is unreachable | **Accepted.** `aria-disabled="true"`, focusable, clicks ignored; the tests and the e2e updated. |
| R30 | minor | "Nothing incomplete is left on the NAS" overclaims | **Accepted.** Reworded to "No incomplete file is left under a backup's name on the NAS." |
| R31 | minor | Step 10's "Next" expectation is wrong right after the helper | **Accepted.** Click at once after the helper; "Next" within the hour until the first success; the joined case described. |
| R32 | minor | RUNBOOK: the owner's own NAS user needs read access for restores; a reinstall removes the secrets | **Accepted.** §9.5 set-up and restore text; verified `--from-file` accepts a bare backup name. |
| R33 | minor | DST combination tests (the October copy before that day's nightly; the April repeated hour) | **Accepted with corrected instants.** The finding's April times were an hour late: 02:30 AEDT (the first pass) is **15:30Z** and 02:30 AEST (the repeated hour) is **16:30Z** on 06/04/2030 (the change is at 16:00Z); 17:30Z would be 03:30 AEST, after the slot. §5.13 uses the corrected instants. |

Owner questions after the revision (§17): four. The suggested questions on the lock, the NAS's trusted list, the terminal and the retry after re-placement are decided in the plan (safety measures or procedures, not trade-offs; §17 preamble); the TCP pre-check joined the smoke question (2b); the NAS count is decided (§15 item 11).
