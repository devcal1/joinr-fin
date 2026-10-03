# Joinr Finance on the Umbrel: runbook

How to install, release, back up, restore and troubleshoot Joinr Finance on an [Umbrel](https://umbrel.com) home server. It is generic: the host is the SSH alias **`umbrel`**, and nothing here is specific to one owner. The design is in [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md#deployment); the scripts are in [`tools/deploy`](../../tools/deploy).

**`<app-data>`** in this runbook means **`~/umbrel/app-data/tenon-joinr-finance`** on the Umbrel (the standard umbrelOS layout; run the commands as the `umbrel` user over SSH, where `~` is that user's home). The app's data folder is `<app-data>/data`: `finance.db`, `backups/` and, after the first import, `import-corrections.json`.

## Contents

- [Prerequisites](#prerequisites)
- [Umbrel behaviours that matter](#umbrel-behaviours-that-matter)
- [One-time setup](#one-time-setup)
- [Release](#release)
- [Install (the first time)](#install-the-first-time)
- [First start checks](#first-start-checks)
- [Cutover from the workbook](#cutover-from-the-workbook)
- [Backups](#backups)
- [Copy to the NAS](#copy-to-the-nas)
  - [What it does](#what-it-does)
  - [Set-up on the NAS](#set-up-on-the-nas)
  - [Placing the files](#placing-the-files)
  - [Removing it](#removing-it)
  - [Troubleshooting the copy](#troubleshooting-the-copy)
  - [Restore from the NAS copy](#restore-from-the-nas-copy)
- [Phone](#phone)
  - [What the whitelist opens](#what-the-whitelist-opens)
  - [The address to pair with](#the-address-to-pair-with)
  - [Pairing](#pairing)
  - [Removing a phone](#removing-a-phone)
  - [After a restore, and after a rebuilt Umbrel](#after-a-restore-and-after-a-rebuilt-umbrel)
  - [The live proxy probes and the rollback](#the-live-proxy-probes-and-the-rollback)
  - [Faster prices and the intraday kill switch](#faster-prices-and-the-intraday-kill-switch)
  - [The daily price history and the closes kill switch](#the-daily-price-history-and-the-closes-kill-switch)
  - [Troubleshooting the phone](#troubleshooting-the-phone)
- [The Android app](#the-android-app)
  - [The signing keystore](#the-signing-keystore)
  - [Check and sideload the APK](#check-and-sideload-the-apk)
  - [The app 1.1.0 (the period selector)](#the-app-110-the-period-selector)
- [Restore](#restore)
- [Restore after a reinstall](#restore-after-a-reinstall)
- [Rollback](#rollback)
- [The import override](#the-import-override)
- [After an Umbrel reboot](#after-an-umbrel-reboot)
- [Go-live checklist](#go-live-checklist)
- [Accepted risks](#accepted-risks)
- [Troubleshooting](#troubleshooting)
- [Uninstall](#uninstall)

## Prerequisites

- **Tailscale** (or the LAN) between the dev PC and the Umbrel.
- **An SSH alias `umbrel` with key auth** in the dev PC's `~/.ssh/config` (user `umbrel`). The scripts run `ssh -o BatchMode=yes`, so a password prompt is never an option: `ssh umbrel true` must succeed without one. Windows OpenSSH refuses a private key whose file permissions are too open; Git's own `ssh` does not. Set `JOINR_SSH` to pick one.
- **The `umbrel` user is in the `docker` group** on the Umbrel (the default).
- **On the dev PC:** Node 24, pnpm and git, a checkout of `joinr-fin`, and the store clone `tenon-umbrel-store` beside it (or `JOINR_STORE_DIR` pointing at it). No Docker is needed on the PC.
- **Shells:** the scripts are plain Node (`node tools/deploy/*.mjs`, wrapped by the `pnpm umbrel:*` scripts) and are meant for both PowerShell and Git Bash on Windows. Every script prints the `ssh` and `git` binaries it resolved. The one exception is `pnpm umbrel:nas-secrets`, which asks for a password in a hidden prompt: run it in PowerShell or Windows Terminal ([Placing the files](#placing-the-files)). The first live run records here which shells were validated. **Git Bash rewrites absolute POSIX paths in arguments** (MSYS path conversion: `--data-dir /srv/x` arrives as `C:/Program Files/Git/srv/x` and is refused): pass remote folders relative to the remote home (`--data-dir joinr-build/smoke/data`), or prefix the command with `MSYS_NO_PATHCONV=1` for an absolute one.

Every script takes `--dry-run`: it prints every command it would run on the Umbrel and every file it would change, and runs nothing remote.

## Umbrel behaviours that matter

- **Install and Update pull every image.** The image must be in a registry the Umbrel can reach: the **Joinr Registry** app, on the Umbrel's loopback (`127.0.0.1:4930`).
- **An Update stops the app and bumps its manifest before it pulls.** If the pull then fails (the registry is stopped, or the image was never pushed), the app stays stopped and Umbrel offers no Update to retry. Hence `pnpm umbrel:status` before every click.
- **Stop and Restart re-create the container.** After Stop in the Umbrel UI, `docker inspect tenon-joinr-finance_app_1` finds nothing. The scripts never rely on the container existing.
- **At every boot umbreld removes every container that is not an app's** (and re-creates the apps' from local images). A plain registry container would be gone; the Joinr Registry app comes back on its own.
- **Uninstall deletes `<app-data>` without asking**: the database and every backup. An Update never touches `<app-data>/data`.

## One-time setup

1. In the Umbrel dashboard: App Store → `⋯` → **Community App Stores** → add `https://github.com/devcal1/tenon-umbrel-store`.
2. **Install Joinr Registry first** (from that store). It has no web page; the Open button leads nowhere.
3. Check it from the dev PC: `pnpm umbrel:registry status` shows mode `app`, state `running`, bindings `127.0.0.1:4930` only, and `/v2/: 200`.

**Fallback (a), a plain registry container:** `JOINR_REGISTRY_MODE=container pnpm umbrel:registry ensure` creates `joinr-registry` (loopback only, uid 1000, storage in `~/joinr-registry`). umbreld removes it at every boot, so run `ensure` again before every Install or Update (see [After an Umbrel reboot](#after-an-umbrel-reboot)).

## Release

Every release that changes the image gets a new version (patch for fixes, minor for features, major for a data change that needs a restore to go back).

1. Bump `version` in the root `package.json`.
2. `pnpm check && pnpm build && pnpm guard:all` on the dev PC.
3. `pnpm umbrel:release`. It:
   - refuses a dirty working tree unless `--allow-dirty` (then it ships exactly the files `pnpm guard:all` scans, built in a temporary git index; nothing is committed);
   - runs the privacy guard, probes SSH, checks the registry;
   - refuses a version already in the registry (exit 4: bump it); a failed build pushes nothing, so the version stays free and you just re-run;
   - refuses to build with less than 2.5 GiB of free memory on the Umbrel (exit 5; `--force-build` overrides);
   - ships the tree (`git archive | ssh … tar -x`) into `~/joinr-build/<version>-<tree12>`, builds and pushes `127.0.0.1:4930/joinr-finance:<version>`, and reads the digest;
   - appends version, tree id, `HEAD`, clean or dirty, and digest to `artifacts/releases.log` (git-ignored);
   - checks the registry holds the digest and that ports 4930 and 4932 are still free on the device, then writes the image line and `version:` into the store clone. **It never commits.**
4. Write `releaseNotes:` for the new version in `tenon-umbrel-store/tenon-joinr-finance/umbrel-app.yml`; review `git -C ../tenon-umbrel-store diff`.
5. Commit and push the store. Umbrel polls the store every few minutes.
6. `pnpm umbrel:status` must end with **"Safe to click Update in Umbrel"**.
7. Umbrel → Joinr Finance → **Update**. Then check `/api/health`'s version and Settings → About.

If the push succeeded but a later step failed (the store write, say), re-run with **`--reuse-existing`**: when the registry's image was built from the same tree it skips the build and only writes the store.

A **prerelease** for testing (`--prerelease rc.1 --skip-store`) is tagged `<version>-rc.1`, never goes into the store, and can be run with `pnpm umbrel:smoke start --image 127.0.0.1:4930/joinr-finance:<version>-rc.1`, then `check`, `nas` (the copy to the NAS against a scratch rsync server on a private Docker network, run from the same image; the app runs with `WEEKLY_NAS_COPY=false` so the schedule cannot race it), `mobile` (the phone API; see [Phone](#phone)) and `remove` (both containers, the network and the scratch folders).

**From 1.3.0** `check` expects 8 migrations and also probes the daily-history paths from inside the container: Yahoo's daily chart (`AUDUSD=X`, `period1`/`period2`/`interval=1d`, the server's User-Agent) must answer 200; CoinGecko's 365-day chart may answer anything (a 429 from the Umbrel's shared IP still proves the path). `mobile` also seeds a listed holding beside the coin, waits (up to 240 s after its restart) for the restarted container's start-up `closes` run to finish (it judges that run only, never an earlier one), and checks `GET /api/mobile/periods` (200, `apiVersion=1`, seven periods), `POST` there (405) and the revoked key there (401). A coin with no closes because CoinGecko skipped it in that run (the run's `coingecko.skipped` count; a failed coin stays a FAIL) prints a non-fatal **NOTE** ("closes: CoinGecko rate-limited; re-run `smoke mobile` after 2 min"); the live app shares the Umbrel's IP with CoinGecko's keyless limit. A re-run restarts the container, so its start-up run tops up the coin.

## Install (the first time)

1. Joinr Registry is installed and running ([One-time setup](#one-time-setup)).
2. A release has been written into the store and pushed ([Release](#release)); until then the compose pins a placeholder digest of zeros and an install fails loudly.
3. `pnpm umbrel:status` says "Safe to click Update in Umbrel (or Install, the first time)".
4. Umbrel → App Store → **Joinr Finance** → Install.

## First start checks

- `pnpm umbrel:status`: the app is `running` and `healthy`; its image digest is the release's.
- On the Umbrel: `ls -ln <app-data>/data` shows `backups/` owned by uid 1000; `docker logs tenon-joinr-finance_app_1` shows the database ready with 8 migrations (1.3.0; 7 before it).
- Open `http://umbrel:4932` from the dev PC: the Umbrel login, then the app (not a 502).
- Settings → About: the app and server versions match, the database level, the time zone `Australia/Melbourne`.
- Settings → Backups: "No backups yet" and the next run. Click **Back up now**: a "By hand" row appears (this also proves the write guard lets the app's own pages through the proxy; a 403 here is [troubleshooting](#troubleshooting)).

## Cutover from the workbook

1. Export the workbook as `.xlsx`. Optionally dry-run it on the dev PC first, on a scratch `DATA_DIR`, to see the reconciliation.
2. Copy the corrections file to `<app-data>/data/import-corrections.json` on the Umbrel (as the `umbrel` user, so it is owned by uid 1000), e.g. `scp <corrections file> umbrel:umbrel/app-data/tenon-joinr-finance/data/import-corrections.json`.
3. In the app: **Import** → upload the export → dry run → review (zero unexplained) → **Import**.
4. **Back up now** straight away: the clean "just imported" point.
5. Settings → History → **Record each month automatically** on. On History, record (or skip) any month missing before the switch. Once a month is recorded the data counts as app data and a re-import is blocked, as intended.

## Backups

- **Where:** `<app-data>/data/backups/`, one flat folder of verified SQLite files named `<kind>-YYYYMMDD-HHmmss±HHMM.db` in server time.
- **When:** nightly at 02:30 (`TZ` in the compose file), plus one catch-up about two minutes after a start if the server was down across 02:30. Also by hand (**Back up now**), before an import, before a restore and before an update that migrates the database.
- **Kept:** the newest nightly copy of each of the last 14 days it ran and of each of the last 12 months; 10 by hand, 10 before an import, 5 before a restore, 5 before an update.
- **Download:** Settings → Backups → Download (saved as `joinr-finance-<name>`). **Keep a copy off the server**: uninstalling the app deletes every backup.
- **Stale:** when no nightly or manual backup has succeeded for 48 hours, every page shows a callout linking to Settings → Backups.
- **Off the server:** the weekly [copy to the NAS](#copy-to-the-nas) sends every kept backup to a NAS once it is set up; until then, download one regularly.
- **umbrelOS Backups:** if Umbrel's own Backups are set up, they snapshot `<app-data>` while the app runs; the manifest's `backupIgnore` skips the live database's shared-memory file and every hidden temporary. A snapshot of the live `finance.db` and its `-wal` taken mid-write may be inconsistent: **after an Umbrel-level restore, restore from one of the app's own verified files in `data/backups/`** with the steps below. The manifest's `backupIgnore` also skips `data/secrets` (the NAS copy's password): after an Umbrel-level restore, [place the NAS files again](#placing-the-files).

## Copy to the NAS

### What it does

- **When:** weekly, **Sunday at 03:00 server time**, plus one catch-up copy about five minutes after a start when that Sunday's copy was missed (an Umbrel reboot or an app update across it), and **Copy to NAS now** in Settings → Backups. A copy that fails for a passing reason (the NAS did not answer, the connection broke, the NAS could not store) is retried after 1, 2 and 4 hours; a refused password or module is never retried (see [the refusal lock](#the-refusal-lock)). `WEEKLY_NAS_COPY=false` turns the schedule off; the button still works.
- **What:** every backup file the app keeps (every kind), in one `rsync` run that sends only the names the NAS lacks, or holds at a different size, newest first. Each copy is then **proved** by listing the NAS back: every file sent must be there at the right size.
- **Only adds.** Nothing on the NAS is ever deleted or changed in place: rsync writes each file to a hidden temporary name and renames it when complete, so an interrupted copy leaves no half file under a backup's name. A file of the same name at the wrong size (a damaged copy) is replaced the same way. The NAS keeps everything it receives, about 4 MB a week at today's sizes; prune the NAS folder by hand if it is ever needed.
- **A copy that fails never touches a backup** on the server, and never stops the nightly backups.
- **The files arrive as plain SQLite copies**, exactly what **Download** gives you: the whole financial history, unencrypted. The NAS folder must be private to you. The transfer itself is encrypted by Tailscale.
- **Off until it is set up:** the app reads two files in `<app-data>/data/secrets/`, `nas-url` and `nas-password`, both or neither. The page never shows or asks for the address or the password; they are placed from the dev PC with `pnpm umbrel:nas-secrets`.
- **No heartbeat:** a ping to a dead man's switch after each copy is not provided (D132); the page and the every-page callout are the alarm.

### Set-up on the NAS

Once, in the NAS's admin page:

1. **A new shared folder, private to you.** Give **your own NAS user read access** to it (the rsync account below is scoped to the module, so it is your own user that fetches a file for a restore) and nobody else.
2. **Enable the rsync server** (the rsync daemon, port 873).
3. **A new rsync account, allowed only on a new module for that folder, with write access.** Never reuse another app's rsync account.
4. Note the address: `rsync://<account>@<NAS Tailscale IP>/<module>` (optionally `/<module>/<subfolder>`; the subfolder is created by the first copy). Use the NAS's **Tailscale IP**: tailnet names do not resolve inside the app's container, and the rsync protocol is not encrypted (Tailscale encrypts it). Keep the account and module names to yourself.

### Placing the files

Run the helper **yourself**, in **PowerShell or Windows Terminal** (not Git Bash's mintty window: Node cannot hide input there, and the helper refuses; `winpty node tools/deploy/nas-secrets.mjs` is the workaround in Git Bash). The password never passes through a chat, a file on the PC or a command line.

Open an ordinary PowerShell window from the Start menu, not a terminal panel inside another app: an app's embedded terminal may not see your normal environment. **If `node` is "not recognized" there**, Node was probably installed from inside a packaged Windows app (such as a desktop coding assistant), and Windows redirected it into that app's private folder. Find it with `Get-ChildItem $env:LOCALAPPDATA\Packages\*\LocalCache\Local\nodejs -Directory`, then add the version folder it lists to the window's path, e.g. `$env:Path += ";$env:LOCALAPPDATA\Packages\<app folder>\LocalCache\Local\nodejs\<node version folder>"`. `pnpm` may be missing for the same reason: `node tools/deploy/nas-secrets.mjs` is the same helper as `pnpm umbrel:nas-secrets`.

1. **Rehearse the hidden prompt** in the same window: `node tools/deploy/nas-secrets.mjs --prompt-test`. Type or paste anything **except the real password**, then Enter. It must print only "read N characters, nothing was echoed", and nothing you typed may appear on the screen; Backspace and a paste must behave. If anything is echoed or the window hangs, stop and do not type the password.
2. `pnpm umbrel:nas-secrets --dry-run` shows every SSH command it will run (the values show as `<stdin: secret>`).
3. `pnpm umbrel:nas-secrets`. It asks for:
   - **the address**, shown as you type (it is not a secret), until it has the form above. An address that is not a Tailscale IP gets a warning ("the files would cross the network readable") and is used only if you type `yes`;
   - **the password**, hidden, **twice**. It must be one line of 1 to 256 characters with no leading or trailing space.

   It never prints a value back ("address accepted", "password accepted"). It writes both files to hidden temporaries (mode 600, uid 1000), checks them, then puts them in place, the password first, and checks again: all or none. The values travel only on SSH's standard input.

4. `pnpm umbrel:nas-secrets --check`: the folder `700, uid 1000`, both files `600, uid 1000`, and "The app will see: ready". It never reads a file's contents or size. `pnpm umbrel:status` shows the same lines.
5. **Settings → Backups → Copy to NAS now** (the timer would otherwise start one within the hour, since the last Sunday's slot is not settled yet). The last copy shows **Succeeded: N sent · 0 already there · proved on the NAS · N on the NAS**. Open the NAS folder: the same N backup names.
6. A second click sends nothing: **0 sent · N already there**. From then on it runs every Sunday at 03:00.

To change the password or the address, run `pnpm umbrel:nas-secrets` again: it replaces both files. Placing the files again is also what [unlocks the copy after a refusal](#the-refusal-lock).

### Removing it

`pnpm umbrel:nas-secrets --remove` (it asks `y/N`; `--yes` skips the question) deletes both files: the copy is off again, and the page says "Not set up". Nothing on the NAS is touched: remove the NAS folder, module and account there by hand if you want them gone.

### Troubleshooting the copy

Settings → Backups → **Copy to the NAS** shows the state and the last copy's sentence. Every failure sentence ends "The backups on the server are not affected." The logs never contain the address, the account, the module or the password (only the state, counts, the reason and rsync's exit code).

#### The refusal lock

After the NAS refuses the password or the module (the "refused the password", "no rsync module" and "refused the connection" sentences below), **the app tries nothing again**, neither the timer nor the button, until the NAS files are placed again: repeated wrong passwords can trip the NAS's brute-force protection and block the Umbrel's address, which would also stop any other app copying to that NAS. The button is greyed out with "Place the NAS files again with the NAS set-up helper first", a request gets `409 NAS_COPY_FIX_FIRST`, and every page shows "NAS copy not working". Fix the account or module on the NAS, then run `pnpm umbrel:nas-secrets` again: that unlocks it and allows **exactly one** attempt (at the next click, or within the hour). If the NAS has already blocked the Umbrel, unblock its address in the NAS's admin page first: the app cannot tell a block from a switched-off NAS (both say "did not answer").

#### The sentences

- **"…half set up: nas-url is missing…" or "…nas-password is missing…"** One file is missing: run `pnpm umbrel:nas-secrets` again (it places both).
- **"nas-url is not an rsync://user@host/module address…"** The address file is not usable (a password inside it, a space, a deeper path, a typo): run the helper again.
- **"nas-password is not usable (it must be one line of text)…"** The password file is not a plain one-line file: run the helper again.
- **"The NAS refused the password in nas-password…"** Check the rsync account and its password on the NAS; run the helper again ([the refusal lock](#the-refusal-lock)).
- **"The NAS has no rsync module by the name in nas-url…"** Check the module name on the NAS; run the helper again with the right address.
- **"The NAS refused the connection…"** Usually a wrong password or module: check both, then run the helper again.
- **"The NAS did not answer…"** The NAS is off, asleep, off Tailscale, its rsync server is off, or it has blocked the Umbrel's address. Retried after 1, 2 and 4 hours; or click **Copy to NAS now** once it is back.
- **"The copy to the NAS stalled and was stopped…"** The NAS stopped answering mid-copy (or the copy hit its 15-minute ceiling). Retried automatically.
- **"The connection to the NAS broke part way through…"** Retried automatically; nothing incomplete is left under a backup's name.
- **"The NAS could not store or list the files…"** The NAS folder is full, or the rsync account may not read and write it (a read-only or write-only module). Free space, or fix the module's rights.
- **"rsync reported success, but N of M files are not on the NAS at the right size."** Retried automatically. If it repeats, check the NAS folder (a quota, or a tool that changes files there).
- **"The files were sent, but the NAS could not be read back…"** The module must allow the account to list and read it. Retried automatically.
- **"rsync is missing from the app image…"** The image was built without rsync: release a new version (the build installs it).
- **"The copy was stopped because the app was shutting down."** Normal during an Umbrel restart or an update; the next start catches up.
- **"The copy to the NAS failed (rsync exit code N)."** Anything else (the NAS's "max connections" refusal included). Retried automatically; if it repeats, test the route from the host: `rsync --list-only rsync://<NAS Tailscale IP>/` lists the modules without logging in.

#### Other symptoms

- **"Copy to NAS now" is greyed out:** the Copy line above it says why: not set up, half set up, a file not usable, or locked after a refusal.
- **The copy never runs on Sunday:** `WEEKLY_NAS_COPY` is off (the Copy line says "Weekly copy off"), or the copy is half set up (one failed run per Sunday, no retries, until the files are fixed).
- **The "NAS copy overdue" callout:** no copy has succeeded for 8 days (a missed Sunday and a day's grace; the app keeps 14 nightly dates, so this comes about a week before a nightly copy the NAS never received could be pruned here). Settings → Backups → Copy to the NAS shows the last sentence.
- **"NAS copy not working":** half set up, a file not usable, or locked after a refusal: see above.

### Restore from the NAS copy

The NAS files are ordinary backup files, with the same names as in Settings → Backups (no `joinr-finance-` download prefix).

1. Fetch the file from the NAS folder to the PC with **your own NAS user** (the NAS's file manager, or its SMB share).
2. Umbrel → Joinr Finance → **Stop**; `pnpm umbrel:restore --from-file <path to the file>` (as in [Restore after a reinstall](#restore-after-a-reinstall); `--from-file` accepts a bare backup name); Umbrel → **Start**. Or restore it into a development copy on the PC: `pnpm restore:backup <path> --yes` with a scratch `DATA_DIR`.
3. **After a reinstall** this is the way back (D113). A reinstall also deletes `data/secrets/`, so the copy is off until you [place the files again](#placing-the-files); the first copy after that sends only what the NAS lacks.

## Phone

From 1.2.0 a read-only Android app shows today's change in the holdings and bullion, with three home-screen widgets ([The Android app](#the-android-app)). From 1.3.0 (the app 1.1.0) it also shows the change over 1W, 2W, 1M, 3M, 6M, 12M and ALL, measured from a daily price history the server keeps ([below](#the-daily-price-history-and-the-closes-kill-switch)). This section is the server side.

### What the whitelist opens

The store compose carries one line in the app proxy's environment: `PROXY_AUTH_WHITELIST: "/api/mobile/*"`. Rules match paths, not methods, and a `/*` glob matches below the path.

- **`/api/mobile/` answers anyone on the home network or the tailnet without the Umbrel login.** It returns data only for a paired phone's key (`GET /api/mobile/today`, `GET /api/mobile/device`, and from 1.3.0 `GET /api/mobile/periods`; the store compose did not change for it, since the `/*` glob already covers it); every other method there answers 405 and changes nothing. The one write is the pairing exchange (`POST /api/mobile/pair`), which needs a code the owner opened in Settings → Phone in the last 5 minutes (5 wrong codes cancel it; 20 attempts per 10 minutes at most).
- **Everything else keeps the Umbrel login:** the web app, the rest of the API, the backup downloads and Settings → Phone itself.
- The server keeps only a SHA-256 of each key, in `<app-data>/data/devices/devices.json` (folder 0700, file 0600, owned by uid 1000), **outside the database**: a database restore never brings back a removed phone, and the key hashes never travel to the NAS. umbrelOS Backups skip the folder (`backupIgnore`).
- **Never widen the whitelist.** A new path under `/api/mobile/` that the phone plugin did not declare stops the server at start-up.

### The address to pair with

Pair with **the Umbrel's full Tailscale name, `http://<host>.<tailnet>.ts.net:4932`**, never the short name (`http://umbrel:4932`) or a LAN address. The key travels in plain HTTP on every request; inside Tailscale that is encrypted, but a short name or a LAN address can also be answered by the home network's DNS when Tailscale is off on the phone, and the widget worker would then send the key unencrypted over Wi-Fi. A full `.ts.net` name resolves only through Tailscale, so it fails closed. Settings → Phone prefills the address from the browser's address bar and shows an important callout for a short name, a LAN or a loopback address until it is changed; the app warns the same way before it pairs.

### Pairing

1. On the PC: Settings → Phone → **Pair a phone**. A QR code, the code as text (`XXXXX-XXXXX`) and a 5-minute countdown appear. Set **Address the phone will use** to the full Tailscale name ([above](#the-address-to-pair-with)).
2. On the phone: open Joinr Finance, pass the lock, tap **Scan** in its pairing screen and scan the QR, then confirm. **Use the app's own Scan button, never the phone's camera app**: a camera app hands the pairing link to whichever app claims `joinrfinance://`.
3. **If the first scan fails**, wait a minute (Google Play services installs the scanner on first use) and scan again, or pair by hand: the address and the code typed into the app.
4. The page shows **"Paired: <name>."** and the phone in the list, with "Last used" from its first refresh. A pairing you did not make shows the same way: remove that phone.

**New code** replaces the open code; **Cancel** closes it. After 5 wrong codes from anywhere the code is cancelled and the page says so ("cancelled after 5 wrong attempts from another device"): open a new one, and if it keeps happening, look for what is guessing.

### Removing a phone

Settings → Phone → **Remove** (it asks first). The key stops working at once; the app shows "removed" at its next refresh and the widgets show "Open Joinr Finance to pair." at theirs. Unpairing inside the app only forgets the key on the phone (the phone cannot write): remove it here too. **A lost phone:** remove it here. Removed phones stay listed (the newest 20) with the date.

If the server cannot save the list (disk full, a permission problem after a restore), a removal still takes effect at once and the page says the removal is not saved yet: a restart of the app before the next successful save would bring the phone back. Fix the folder (owner uid 1000, `devices/` 0700, `devices.json` 0600) and the next write saves it; pairing refuses until then.

### After a restore, and after a rebuilt Umbrel

- **A database restore** (Settings, the CLI or `pnpm umbrel:restore`) does not touch `data/devices/`: phones stay paired and removed phones stay removed.
- **A rebuilt Umbrel or a reinstall** deletes `<app-data>`, the device list with it: pair the phone again (it shows "removed" or "not known" until then).
- **An unreadable device list** is set aside as `data/devices/devices.unreadable-<time>.json` (never deleted) and the page asks you to pair again.

### The live proxy probes and the rollback

Before the first pairing on a new release, prove the proxy from the dev PC with no Umbrel session (read-only):

- `curl -s -i http://umbrel:4932/api/mobile/today` → **401 JSON** `DEVICE_KEY_MISSING` (from the app, not the login page);
- `curl -s -i http://umbrel:4932/api/status` → the Umbrel login page or its redirect, **not** JSON;
- `curl -s -i -X POST http://umbrel:4932/api/mobile/today` → 405 JSON;
- from 1.3.0: `curl -s -i http://umbrel:4932/api/mobile/periods` → **401 JSON** `DEVICE_KEY_MISSING`, and `-X POST` there → 405 JSON;
- the traversal corpus of `pnpm umbrel:smoke mobile` (`/api/mobile/../backups`, the `%2e%2e` and `%2F` forms, `;`, a backslash, a trailing `..`, upper case, and from 1.3.0 `/api/mobile/periods/../backups`, `/api/mobile/periods%2f..%2fbackups` and `/api/mobile/periods/..;/status`), each with GET, HEAD, POST and DELETE, sent with **`curl --path-as-is -s -i`** (plain curl normalises `..` and proves nothing). Every answer must be the login page or its redirect, or an app 401/404/405 JSON: **never** status, backup or page data.

**Any data → roll back at once:** release a compose-only version (a patch) with the `PROXY_AUTH_WHITELIST` line removed. The phone stops working; nothing else changes. Then revisit the design before pairing again.

### Faster prices and the intraday kill switch

From 1.2.0 the `intraday` job refreshes ASX holdings every 5 minutes on weekdays from 10:00 to 16:25, crypto every 15 minutes around the clock, and bullion every 15 minutes from Monday 06:00 to Saturday 10:00 (server time). Runs appear in the job history (about 150 a weekday). If Yahoo starts refusing (prices go stale with "rate limited"), turn the job off without a new image: add `INTRADAY_REFRESH: "false"` to the app service's `environment` in the store compose and release it as a compose-only patch. The hourly `prices` job keeps running. With the switch off, crypto shows no day change on the phone (its day chart is fetched only by the intraday job). ASX and US listings, funds and bullion keep their day figures from the `prices` job, refreshed at its interval (hourly by default) instead of every 5 or 15 minutes.

**A downgrade below 1.2.0 means restoring the pre-update backup:** 1.2.0 migrates the database (migration 0006, with the automatic pre-update backup), and 1.1.1 refuses a database a newer version migrated ([Rollback](#rollback)).

### The daily price history and the closes kill switch

From 1.3.0 the `closes` job keeps the daily closes the phone's periods are measured from, in three cache tables (`instrument_closes`, `instrument_splits`, `series_closes`; migration 0007). Nothing is ever deleted from them, except that changing an instrument's price source deletes that instrument's closes (the next run fetches the new symbol's).

- **What it fetches:** the daily closes of every held instrument priced by Yahoo (stocks, ETFs, funds) and their split events, every held coin from CoinGecko (in AUD), the FX series of held foreign listings, `AUDUSD` and the gold or silver futures in use. From those it derives the AUD bullion spot per day, and from 1.3.0 on it also keeps the exact 00:00 Melbourne value. Hand-priced instruments have no history (their periods show "—").
- **When:** daily at **16:52** server time, and once about **2 minutes after every start**. A run that ends with work left (its 10-minute deadline, or a provider cooling down) schedules a follow-up at least 30 minutes later, at xx:07, xx:22, xx:37 or xx:52 (at most 6 a day). It pauses while the `prices`, `intraday` or `dividends` job runs, and never calls CoinGecko within 45 s of an intraday crypto slot.
- **The call budget:** one Yahoo request per series a day, 1.5 s apart, and one CoinGecko request per coin (two in a coin's first backfill), 15 s apart. About (holdings + FX series + 3) × 1.5 s plus coins × 15 s a run, against the thousands of intraday requests a day.
- **The first start of 1.3.0 is the backfill:** about 2 minutes after the update the start-up run fetches each series from about 10 days before its first trade (coins: at most a year back; CoinGecko's keyless API refuses older days, and stored history grows from then on). Until it finishes, the periods show "—" and the partial note; refresh in the app afterwards.
- **A restart re-runs the job.** There is no button or route for it: Umbrel → Joinr Finance → **Restart** (or `docker restart tenon-joinr-finance_app_1`) runs the start-up run about 2 minutes later, a top-up when the history is already there.
- **Its runs** are rows in `job_runs` (`job = 'closes'`); no page lists them. Check with the read-only count query under [Troubleshooting the phone](#troubleshooting-the-phone).

**The kill switch:** if Yahoo or CoinGecko starts refusing the history requests, turn the job off without a new image: add `CLOSES_REFRESH: "false"` to the app service's `environment` in the store compose and release it as a compose-only patch (the same way as `INTRADAY_REFRESH`). The stored closes stay and the periods keep working from them, but their start closes age out: a period turns "—" for a holding once its start date is more than 10 days after the newest stored close (1W first), and the app shows "Price history to dd/mm" under the chips. 1D, the widgets, the web and the `prices` and `intraday` jobs are not affected.

**A downgrade below 1.3.0 means restoring the pre-update backup:** 1.3.0 migrates the database (migration 0007, with the automatic pre-update backup), and 1.2.0 refuses a database a newer version migrated ([Rollback](#rollback)).

### Troubleshooting the phone

- **"Unreachable" in the app:** Tailscale is off on the phone, or the address is wrong. Turn Tailscale on; check the address in the app's Settings against [the address to pair with](#the-address-to-pair-with).
- **The app shows the Umbrel login page, or "not the Joinr Finance API":** the whitelist line is missing from the running compose (an older release, or a rolled-back one). `pnpm umbrel:status` shows the installed version.
- **"This phone was removed":** it was removed in Settings → Phone. Pair it again.
- **"This server does not know this phone's key":** the device list was set aside or the Umbrel was rebuilt. Pair again.
- **Stale prices on the phone:** the same as on the web ([Prices stale after install](#prices-stale-after-install)); the app shows each holding's price age.
- **Widgets not updating:** Android may delay background work for apps under battery optimisation. Settings → Apps → Joinr Finance → Battery → **Unrestricted**. Opening the app refreshes them.
- **Widgets show "Open Joinr Finance to update":** no fetch has succeeded for 24 hours (the phone was off Tailscale, or Doze held the worker). Open the app.
- **"Periods need Joinr Finance 1.3.0 or later on the Umbrel."** The app 1.1.0 is talking to a 1.2.0 server (`/api/mobile/periods` answered 404). 1D keeps working; update the server.
- **"—" on a holding under a period, marked `NO HISTORY`, and "Partial: N holding(s) have no figure for <period>."** The server has no stored close for that holding near the period's start: a hand-priced holding (it has no history), a coin held longer than CoinGecko's one-year reach (12M only, until stored history covers it), the first minutes after an update (the backfill), or a series that stopped updating (next entry). Units bought within the period still count from their purchase price. A `NO PRICE` holding has no current price at all ([Prices stale after install](#prices-stale-after-install)).
- **`SPLIT` on a holding:** a stock split or consolidation falls inside the period, so the units held across it have no figure (the app has no split model). Units bought after the split still count. ALL keeps the web's figure.
- **"Price history to dd/mm." under the chips:** `closesThrough`, the oldest of the series' newest stored closes, is more than 6 days old: some series has stopped updating (a renamed or delisted symbol, Yahoo blocking the history path, CoinGecko throttling, or the kill switch). Find it with this read-only query (counts and the newest date per series, and the last runs' counts; no close values), then fix the cause (for a renamed symbol, its price source on the web's Prices page, which also clears its old closes) and **restart the app** to run the job again:
  ```sh
  docker exec tenon-joinr-finance_app_1 node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync('/data/finance.db', { readOnly: true }); console.table(db.prepare('SELECT i.symbol AS series, count(*) AS n, max(c.date) AS newest FROM instrument_closes c JOIN instruments i ON i.id = c.instrument_id GROUP BY c.instrument_id ORDER BY newest').all()); console.table(db.prepare('SELECT series_id AS series, count(*) AS n, max(date) AS newest FROM series_closes GROUP BY series_id ORDER BY newest').all()); console.table(db.prepare(\"SELECT started_at, status, detail_json FROM job_runs WHERE job = 'closes' ORDER BY id DESC LIMIT 3\").all())"
  ```
  A series whose `newest` lags the others is the one. A `detail_json` with `failed` or `skipped` counts, or `left` above 0, says the last run did not finish its targets (a cool-down schedules a follow-up by itself).

## The Android app

The app (`apps/android`, Kotlin and Compose, package `com.tenon.joinrfinance`) is built on the dev PC with Gradle (no Android Studio needed: JDK 17 and the Android SDK) and **sideloaded**: there is no store listing and no in-app updater.

| Script | What it runs |
|---|---|
| `pnpm android:test` | `gradlew testDebugUnitTest` (the JVM tests) |
| `pnpm android:debug` | `gradlew assembleDebug` |
| `pnpm android:lint` | `gradlew lint` |
| `pnpm android:release` | `gradlew assembleRelease`, then the APK copied to `dist/android/joinr-finance-<version>.apk` with its SHA-256 and the signing certificate's SHA-256 printed, then `gradlew --stop` |
| `pnpm android:stop` | `gradlew --stop` (Windows keeps lint caches locked until the daemons stop) |
| `pnpm android:fixtures` | re-exports the JSON fixtures the app's tests read |

The script writes `apps/android/local.properties` (git-ignored) when it is missing, from `ANDROID_HOME`, `ANDROID_SDK_ROOT` or `%LOCALAPPDATA%\Android\Sdk`.

### The signing keystore

A release APK is signed with your own keystore. **Create it once and keep it**: Android installs an update only when it is signed with the same key, so **a lost keystore means uninstalling the app to update it, then pairing again**.

1. In your own PowerShell (type the passwords yourself; never paste them into a chat, a file in the repo or a ticket), in a folder **outside the repo**:
   ```powershell
   & "<JDK 17>\bin\keytool.exe" -genkeypair -v -keystore joinr-release.jks -alias joinr -keyalg RSA -keysize 4096 -validity 10000
   ```
2. Beside it, a properties file (any name, e.g. `joinr-signing.properties`), also outside the repo:
   ```properties
   storeFile=<absolute path to>/joinr-release.jks
   storePassword=<the store password>
   keyAlias=joinr
   keyPassword=<the key password>
   ```
3. **Back up both files and the passwords** somewhere safe and off this PC (a password manager and an offline copy).
4. Build: `$env:JOINR_ANDROID_SIGNING = "<absolute path to the properties file>"; pnpm android:release`. Without the variable, or with a path that is not an existing absolute file, the script refuses and nothing is built; the build never produces an unsigned APK. The script never reads or prints the file.

`.gitignore` ignores `*.jks`, `*.keystore`, `keystore.properties`, `signing.properties`, `*.apk` and `*.aab` anywhere as a backstop; keep the real files outside the repo anyway.

### Check and sideload the APK

1. Note the two digests `pnpm android:release` prints. The certificate digest must be the same for every release (it is your keystore's); a different one means a different key.
2. Copy `dist/android/joinr-finance-<version>.apk` to the phone (USB, or a file share).
3. On the phone, open it with a file manager; when Android asks, allow **Install unknown apps** for that file manager, install, then **turn that permission off again**.
4. If Play Protect warns about an unknown developer, choose to scan the app, or **Install anyway**.
5. An update installs over the old version (same key): the pairing and the widgets stay.

**Or install over adb** (wireless debugging on the phone, paired from the PC): `adb devices` to find the phone's serial, then `adb -s <serial> install -r --user 0 dist/android/joinr-finance-<version>.apk`. `-r` replaces the installed app and keeps its data (the pairing and the widgets); `--user 0` installs for the phone's main user only (without it adb installs for every user on the phone, a work profile included). Always name the device with `-s`, and never use `gradlew installDebug` for the phone: that installs the debug build, signed with a different key.

### The app 1.1.0 (the period selector)

The app 1.1.0 goes with server 1.3.0. Build it with `pnpm android:release` as above; **its certificate digest must equal the one noted for 1.0.x** (a different digest means a different keystore, and Android refuses it as an update). Install it over 1.0.x by either way above.

- The app 1.0.2 keeps working against 1.3.0 (`/api/mobile/today` is unchanged), so the server can go first. The app 1.1.0 against 1.2.0 shows "Periods need Joinr Finance 1.3.0 or later on the Umbrel." under any chip but 1D.
- The chips (**1D · 1W · 2W · 1M · 3M · 6M · 12M · ALL**) sit under the header. The chosen period holds while the app's process lives (backing out keeps it); a cold start opens on 1D. A holding detail opened from a widget shows 1D. The widgets stay daily.
- The app fetches the period figures (about 200 KB) only while a chip other than 1D is selected, or on opening when its saved copy is over 30 minutes old, and keeps the last answer for offline use (dimmed).

## Restore

A restore replaces the database with a backup while the app is stopped. The current database is copied first (a `pre-restore` backup), so a restore can always be undone.

1. **Choose a backup** in Settings → Backups (or `pnpm umbrel:status`, which lists the files).
2. **Restore it:**
   - `pnpm umbrel:restore <name> --stop`: stops the container, runs the restore, starts it again and waits for `healthy`; or
   - **the Umbrel way:** Umbrel → Joinr Finance → **Stop**; `pnpm umbrel:restore <name>` (the container is gone, so the script reads the image from `<app-data>/docker-compose.yml` and ends with "Start the app in Umbrel"); Umbrel → **Start**.
3. **Check** the page, and Settings → About: "Restored from `<name>`". Settings → Backups lists the `pre-restore` copy, and the last run is not "Failed".
4. **To undo**, restore that `pre-restore` copy the same way.

By hand on the Umbrel (what the script runs; the app stopped):

```sh
docker image inspect -f '{{.Id}}' "$(yq '.services.app.image' ~/umbrel/app-data/tenon-joinr-finance/docker-compose.yml)"
docker run --rm --network none --user 1000:1000 -e TZ=Australia/Melbourne \
  -v ~/umbrel/app-data/tenon-joinr-finance/data:/data <image ID> \
  node dist/cli/restore.js <name> --yes
```

Without `--yes` the CLI prints what it would do and exits 3. Exit codes: `0` restored, `1` failed (the message names the copy to go back to), `2` usage, `5` the backup is not valid (damaged, another database, or from a newer version), `6` the app looks running. **A damaged live database** (the pre-restore copy cannot be made) exits 1; re-run with `--force` to set the damaged files aside unverified in `data/backups/.unverified-pre-restore-<time>/` and restore. `pnpm umbrel:restore` always passes `--force`, which also covers an unclean previous exit; the lock check still refuses a database another process holds.

## Restore after a reinstall

After an uninstall the only copies are the ones downloaded to a PC.

1. Install Joinr Finance again and let its first start create an empty database.
2. Umbrel → Joinr Finance → **Stop**.
3. `pnpm umbrel:restore --from-file <path to the downloaded joinr-finance-….db>`. The script checks the file is a SQLite database, uploads it (before stopping anything) into a hidden per-run folder in `<app-data>/data` under the backup's own name, so About shows "Restored from <that name>", restores it, and deletes the upload whatever the result.
4. Umbrel → **Start**, then check the pages and Settings → About.

## Rollback

Tags are never overwritten, so an older image stays in the registry.

1. Release a **new** version whose compose pins the **older image's digest** (edit the image line and `version:` in the store by hand, with the old tag and digest, and a new version number; `pnpm umbrel:registry status` lists the tags).
2. `pnpm umbrel:status` → Update in Umbrel.
3. If the newer version had migrated the database, **expect a crash loop**: the older image refuses a database a newer version migrated (exit 1, and `restart: on-failure` restarts it).
4. `pnpm umbrel:restore <the pre-migrate backup the update took> --stop`. The script treats `restarting` as running, so `--stop` is needed. The older image's CLI accepts a pre-migrate copy (its level is not newer than the app's).
5. The app comes up healthy: check `/api/health` and Settings → About.

**Below 1.2.0:** 1.2.0 migrated the database (0006) and took a pre-update backup; going back to 1.1.1 is step 4 with that backup. Remove the `PROXY_AUTH_WHITELIST` line in the same compose: 1.1.1 has no phone API, so nothing needs it. Phones stay paired (the device list is not in the database) and work again once 1.2.0 or later and the line are back.

**Below 1.3.0:** 1.3.0 migrated the database (0007, the price-history caches) and took a pre-update backup; going back to 1.2.0 is step 4 with that backup. The compose needs no change (the whitelist line stays). The stored daily history is lost with the restore and is fetched again (coins: one year back at most) after the next update to 1.3.0 or later. The app 1.1.0 keeps working for 1D and says "Periods need Joinr Finance 1.3.0 or later on the Umbrel." under the other chips.

## The import override

A real import over data entered in the app is refused on the Import page (D34); only the CLI can replace it, and only with the app stopped:

1. Umbrel → Joinr Finance → **Stop**.
2. On the Umbrel, with the image ID as in [Restore](#restore) and the export copied into `<app-data>/data/`:
   ```sh
   docker run --rm --network none --user 1000:1000 -e TZ=Australia/Melbourne \
     -v ~/umbrel/app-data/tenon-joinr-finance/data:/data <image ID> \
     node dist/cli/import.js /data/<export>.xlsx --yes --replace-app-data
   ```
   The import CLI refuses while the app runs (exit 6). It takes a verified pre-import backup first.
3. Umbrel → **Start**.

## After an Umbrel reboot

- Joinr Finance and Joinr Registry come back on their own. The nightly backup's start-up catch-up takes one copy if the reboot spanned 02:30.
- **Fallback (a) only:** the plain registry container is gone. Run `pnpm umbrel:registry ensure` before the next Install or Update. If an Update already failed, run `ensure`, then Umbrel → Joinr Finance → **Restart** (never a reboot, which removes the registry again).

## Go-live checklist

- [ ] `pnpm check`, `pnpm build`, `pnpm guard:all` green; `ssh umbrel true` works.
- [ ] Joinr Registry installed; `pnpm umbrel:registry status` answers `/v2/: 200`, loopback only.
- [ ] A live smoke of a prerelease (`pnpm umbrel:smoke start --image <ref> | check | remove`): healthy, the time zone, market-data egress, back up now, a download, a planted symlink refused, a foreign Origin refused, and a restore round trip on the host (by name, `--from-file`, and with the container removed).
- [ ] Release written into the store and pushed; `pnpm umbrel:status` says safe; Joinr Finance installed.
- [ ] First open through the app proxy (no 502); About shows the versions, level and zone; **Back up now** works.
- [ ] Import and reconciliation (zero unexplained); a backup straight after; auto-record on; missing months recorded or skipped.
- [ ] Data persists across Umbrel → Restart and `docker restart`.
- [ ] A live restore and its undo.
- [ ] Opened from two PCs and a phone; no sideways scroll on the phone.
- [ ] The first nightly backup succeeded (Settings → Backups the next morning).
- [ ] The NAS copy: a live smoke of a prerelease with `pnpm umbrel:smoke nas` (every probe passes); the NAS folder, module and account created; `--prompt-test` rehearsed; `pnpm umbrel:nas-secrets` placed the files and `--check` says ready; **Copy to NAS now** succeeded and the NAS folder holds the same names; a second click sent nothing; a file fetched from the NAS restores.
- [ ] The first Sunday copy succeeded (Settings → Backups → Copy to the NAS, trigger "schedule").
- [ ] The phone (1.2.0): a live smoke of a prerelease with `pnpm umbrel:smoke mobile` (every probe passes); after the update, [the live proxy probes](#the-live-proxy-probes-and-the-rollback) pass with no session; the keystore made and backed up; the APK built, its certificate digest noted, sideloaded; paired by QR with the full Tailscale name; a removal stops the app and the widgets; paired again.
- [ ] The period selector (1.3.0, app 1.1.0): a live smoke of a prerelease with `pnpm umbrel:smoke check` (8 migrations, the daily-history egress) and `mobile` (the periods probes and a `closes` run with closes rows; a CoinGecko NOTE is not a failure); after the update, 8 migrations, a pre-update backup listed, the app 1.0.2 still shows Today and its widgets update; about 3 minutes later the start-up `closes` run has succeeded; the periods [proxy probes](#the-live-proxy-probes-and-the-rollback) pass; the APK 1.1.0's certificate digest equals the noted one; each chip shows figures, and ALL matches the web's unrealised plus realised totals.

## Accepted risks

- **The app has no login of its own.** It relies on Umbrel's login, which the app proxy puts in front of every path. With the private network, only the app proxy can reach the app. **If the private-network fallback was taken** (see [502 from the app proxy](#502-from-the-app-proxy)), any container on `umbrel_main_network`, i.e. any other installed app, can call the API directly without a session, including the backup downloads.
- **Plain HTTP.** Browsers send no `Sec-Fetch-*` headers over HTTP, so the cross-site write guard relies on the `Origin` header (and `PUBLIC_PORT`). If the app proxy rewrites `Host` and sends no `X-Forwarded-Host`, an `Origin` on port 4932 passes whatever its host (the server logs "the public port alone decides" once, with the `Host` it saw): a page on another host served from port 4932 could then post to the app, if the browser sends it the Umbrel login cookie.
- **The phone API skips the Umbrel login** (from 1.2.0): anyone on the home network or the tailnet can reach `/api/mobile/`. It is read-only, returns data only for a paired key (256-bit, stored on the server as a SHA-256 only, removable in Settings → Phone), and pairing needs a 5-minute code the owner opens. Keys travel in plain HTTP: pair with the full Tailscale name ([Phone](#the-address-to-pair-with)).
- **Backups live on the server** until the NAS copy is set up: uninstalling the app deletes them. Download one regularly until then.
- **The NAS copy's exposures:** the address (`rsync://<account>@<host>/<module>/`, no password) is in the rsync process's arguments, inside the app's own container, while a copy runs. **The password is in the rsync child's environment for the length of a copy**, readable by the same uid (1000), which already owns `nas-password`, and by root; it is never in its arguments, a log, a run record or an API body. `app_proxy` mounts the app-data parent read-only, so it can read `data/secrets/` (as for every Umbrel app that keeps a credential in its data folder). The copies on the NAS are plain SQLite files, protected by the NAS folder's access list; the rsync protocol is unencrypted and relies on Tailscale.

## Troubleshooting

### Install or Update stuck or failed at "downloading"

The registry is stopped, or the image was never pushed. Run `pnpm umbrel:status`: it names the reason ("the registry is not answering", "pins a digest the registry does not hold", "placeholder digest").

- `manifest unknown` in the Umbrel logs: the pinned digest is not in the registry. Re-run the release (`--reuse-existing` if the tag exists from the same tree).
- A placeholder digest (64 zeros): no release has been written into the store yet.

### The app is stopped after a failed Update

Start the registry (the Joinr Registry app, or `ensure` in fallback (a)), check `pnpm umbrel:status`, then Umbrel → Joinr Finance → **Restart**: the compose now pulls the missing image.

### The data folder is owned by root

Docker created a missing bind source as root (the `data/` skeleton was not rsynced). Fix it on the Umbrel as the owner: `sudo chown -R 1000:1000 ~/umbrel/app-data/tenon-joinr-finance/data`, then Restart the app.

### The wrong time

The month-end record or the backups run at the wrong hour: `TZ` in `<app-data>/docker-compose.yml` must be `Australia/Melbourne`; Settings → About shows the zone the server uses.

### The app refuses to start on a newer database

The log says the database was updated by a newer version. Install that version or newer, or restore a backup made before the update ([Rollback](#rollback)).

### 502 from the app proxy

The proxy cannot reach the app over the private `finance` network. Check `docker logs tenon-joinr-finance_app_proxy_1` and that the app is healthy. If the private network is the cause, release a compose-only version without the two `networks` blocks (the app then sits on `umbrel_main_network` like other apps) and record the accepted risk ([Accepted risks](#accepted-risks)).

### Prices stale after install

Market data leaves the container through Docker's DNS to `query1.finance.yahoo.com` and `api.coingecko.com`. Check from inside the container:

```sh
docker exec tenon-joinr-finance_app_1 node -e "fetch('https://query1.finance.yahoo.com/').then(r => console.log(r.status), e => console.log('error', e.cause?.code))"
```

Any HTTP status means reachable. (`pnpm umbrel:smoke check` runs the same probe in a scratch container.)

### 403 on "Back up now" (or any save)

The cross-site write guard refused the request. The page must be opened on the app's own address and port (`http://umbrel:4932`); `PUBLIC_PORT` in the compose must equal the manifest port. The server log names the `sec-fetch-site`, `origin` and `host` it saw.

### Logs

`docker logs tenon-joinr-finance_app_1` (and `…_app_proxy_1`). Logs never contain paths or figures.

### A stale-backup callout

No nightly or manual backup has succeeded for 48 hours. Settings → Backups shows the last run and its reason (no space, the copy failed its check, the copy could not be written). Free space in `<app-data>` is in `pnpm umbrel:status`.

## Uninstall

1. **Download the newest backup first** (Settings → Backups), and keep it off the server. Uninstalling Joinr Finance deletes `<app-data>`: the database, every backup and the NAS copy's files. **The NAS keeps its copies**: nothing on the NAS is touched ([Restore from the NAS copy](#restore-from-the-nas-copy)).
2. Umbrel → Joinr Finance → Uninstall.
3. **Uninstalling Joinr Registry** deletes the stored images: Joinr Finance keeps running, but its next Update or a reinstall fails until a new version is released.
