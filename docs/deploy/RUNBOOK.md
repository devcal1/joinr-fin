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
- **Shells:** the scripts are plain Node (`node tools/deploy/*.mjs`, wrapped by the `pnpm umbrel:*` scripts) and are meant for both PowerShell and Git Bash on Windows. Every script prints the `ssh` and `git` binaries it resolved. The first live run records here which shells were validated. **Git Bash rewrites absolute POSIX paths in arguments** (MSYS path conversion: `--data-dir /srv/x` arrives as `C:/Program Files/Git/srv/x` and is refused): pass remote folders relative to the remote home (`--data-dir joinr-build/smoke/data`), or prefix the command with `MSYS_NO_PATHCONV=1` for an absolute one.

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

A **prerelease** for testing (`--prerelease rc.1 --skip-store`) is tagged `<version>-rc.1`, never goes into the store, and can be run with `pnpm umbrel:smoke start --image 127.0.0.1:4930/joinr-finance:<version>-rc.1`, then `check` and `remove`.

## Install (the first time)

1. Joinr Registry is installed and running ([One-time setup](#one-time-setup)).
2. A release has been written into the store and pushed ([Release](#release)); until then the compose pins a placeholder digest of zeros and an install fails loudly.
3. `pnpm umbrel:status` says "Safe to click Update in Umbrel (or Install, the first time)".
4. Umbrel → App Store → **Joinr Finance** → Install.

## First start checks

- `pnpm umbrel:status`: the app is `running` and `healthy`; its image digest is the release's.
- On the Umbrel: `ls -ln <app-data>/data` shows `backups/` owned by uid 1000; `docker logs tenon-joinr-finance_app_1` shows the database ready with 6 migrations.
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
- **A later copy to the NAS** (not built yet) is one command over the flat folder, copying no partial files and deleting nothing: `rsync -a --exclude '.*' <app-data>/data/backups/ <nas target>/`.
- **umbrelOS Backups:** if Umbrel's own Backups are set up, they snapshot `<app-data>` while the app runs; the manifest's `backupIgnore` skips the live database's shared-memory file and every hidden temporary. A snapshot of the live `finance.db` and its `-wal` taken mid-write may be inconsistent: **after an Umbrel-level restore, restore from one of the app's own verified files in `data/backups/`** with the steps below.

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
- [ ] A live smoke of a prerelease (`pnpm umbrel:smoke start | check | remove`): healthy, the time zone, market-data egress, back up now, a download, a planted symlink refused, a foreign Origin refused, and a restore round trip on the host (by name, `--from-file`, and with the container removed).
- [ ] Release written into the store and pushed; `pnpm umbrel:status` says safe; Joinr Finance installed.
- [ ] First open through the app proxy (no 502); About shows the versions, level and zone; **Back up now** works.
- [ ] Import and reconciliation (zero unexplained); a backup straight after; auto-record on; missing months recorded or skipped.
- [ ] Data persists across Umbrel → Restart and `docker restart`.
- [ ] A live restore and its undo.
- [ ] Opened from two PCs and a phone; no sideways scroll on the phone.
- [ ] The first nightly backup succeeded (Settings → Backups the next morning).

## Accepted risks

- **The app has no login of its own.** It relies on Umbrel's login, which the app proxy puts in front of every path. With the private network, only the app proxy can reach the app. **If the private-network fallback was taken** (see [502 from the app proxy](#502-from-the-app-proxy)), any container on `umbrel_main_network`, i.e. any other installed app, can call the API directly without a session, including the backup downloads.
- **Plain HTTP.** Browsers send no `Sec-Fetch-*` headers over HTTP, so the cross-site write guard relies on the `Origin` header (and `PUBLIC_PORT`). If the app proxy rewrites `Host` and sends no `X-Forwarded-Host`, an `Origin` on port 4932 passes whatever its host (the server logs "the public port alone decides" once, with the `Host` it saw): a page on another host served from port 4932 could then post to the app, if the browser sends it the Umbrel login cookie.
- **Backups live on the server** until the NAS copy exists: uninstalling the app deletes them. Download one regularly.

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

1. **Download the newest backup first** (Settings → Backups), and keep it off the server. Uninstalling Joinr Finance deletes `<app-data>`: the database and every backup.
2. Umbrel → Joinr Finance → Uninstall.
3. **Uninstalling Joinr Registry** deletes the stored images: Joinr Finance keeps running, but its next Update or a reinstall fails until a new version is released.
