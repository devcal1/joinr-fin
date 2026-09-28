# Joinr Finance: a two-stage image (build → slim runtime).
# The dev PC has no Docker: `pnpm umbrel:release` ships the build context to the Umbrel over SSH
# and builds it there (docs/deploy/RUNBOOK.md). A generic local build works too:
#
#   docker build -t joinr-finance .
#   docker run -d -p 127.0.0.1:3001:3001 -v /path/to/data:/data joinr-finance
#
# The runtime runs as the unprivileged `node` user (uid 1000); the /data volume must be writable
# by it. better-sqlite3 loads the prebuilt N-API binary it ships (glibc x64/arm64), so no compiler
# is needed in either stage (pnpm-workspace.yaml denies its node-gyp build on purpose).
#
# No `# syntax=` line: a moving frontend tag. The BuildKit frontend built into Docker 28 covers
# everything used here.

# The base image, pinned by tag AND multi-arch index digest (Node minor the app is developed and
# tested on). To bump it: read the tag's index digest from Docker Hub
# (https://hub.docker.com/v2/repositories/library/node/tags/<tag> → "digest"), replace both parts
# of this line, and release a new app version: a base-image bump is a release like any other.
ARG NODE_IMAGE=node:24.20-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e

# ─── Build ──────────────────────────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS build

# APP_VERSION (optional): the version baked into the server and the web build. `pnpm umbrel:release`
# passes the root package.json version, or `<version>-<id>` for a prerelease (`--prerelease rc.1`).
ARG APP_VERSION

# The build shares its host with other services: cap the V8 heap of every Node process in this
# stage (BuildKit ignores `docker build --memory`). Not carried into the runtime stage.
ENV CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NODE_OPTIONS=--max-old-space-size=1536

# pnpm via corepack, at the version pinned in package.json "packageManager".
# A newer corepack than the one bundled with Node is installed first (the bundled one may not
# know the signing keys of newer pnpm releases). It is pinned so the build is repeatable; bump it
# on purpose. (Fallback if corepack misbehaves on the host: `RUN npm install --global pnpm@11.23.0`.)
RUN npm install --global --no-fund --no-audit corepack@0.36.0 \
 && corepack enable pnpm \
 && corepack prepare pnpm@11.23.0 --activate

WORKDIR /repo

# Fetch every package from the lockfile alone (`pnpm fetch` always uses the lockfile), so this
# layer stays cached until the lockfile changes. It needs registry.npmjs.org and cdn.sheetjs.com.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN pnpm fetch

# Install from the fetched store (no network), then build the SPA and the server bundle.
# `prepare` (the git hook installer) is a no-op here: .git is not in the build context.
# A given APP_VERSION replaces the root package.json version first (inside the image only), because
# both builds read it from there (`__APP_VERSION__`).
COPY . .
RUN if [ -n "$APP_VERSION" ]; then \
      node -e "const fs=require('fs');const v=process.argv[1];if(!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(v)){console.error('Bad APP_VERSION');process.exit(1)}const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.version=v;fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')" "$APP_VERSION"; \
    fi \
 && pnpm install --frozen-lockfile --offline \
 && pnpm build

# A self-contained copy of the server: package.json "files" (dist, migrations) plus production
# dependencies only. The built SPA goes next to it. (Only ever run `pnpm deploy` here: in a dev
# checkout it rewrites the workspace state to a production-only install.)
RUN pnpm --filter @joinr/server deploy --prod --legacy /out/app \
 && cp -r apps/web/dist /out/app/web \
 && test -f /out/app/dist/server.js \
 && test -f /out/app/dist/cli/import.js \
 && test -f /out/app/dist/cli/restore.js \
 && test -f /out/app/migrations/meta/_journal.json \
 && test -f /out/app/web/index.html

# ─── Runtime ────────────────────────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runtime

ARG APP_VERSION
# The git tree id of the shipped build context (`pnpm umbrel:release`); `--reuse-existing` compares it.
ARG APP_REVISION

LABEL org.opencontainers.image.title="Joinr Finance" \
      org.opencontainers.image.description="Self-hosted personal-finance web app" \
      org.opencontainers.image.source="https://github.com/devcal1/joinr-fin" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${APP_REVISION}"

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    DATA_DIR=/data \
    WEB_DIST_DIR=/app/web \
    LOG_LEVEL=info

WORKDIR /app

# App files stay root-owned (read-only for the app); only /data is writable by `node`.
COPY --from=build /out/app ./
RUN mkdir -p /data && chown node:node /data

# Build checks: both CLIs load from the bundle and print their usage (exit 0).
RUN node dist/cli/restore.js --help \
 && node dist/cli/import.js --help

# Time-zone check (D114): the compose file sets TZ=Australia/Melbourne, and the 23:00 month-end
# record and the 02:30 backup depend on local time being right. Node's full ICU carries its own
# zone data; this fails the build if the image cannot resolve the zone (standard and daylight
# offsets, the October gap at 02:30 → 03:30). The image itself sets no TZ, so a plain
# `docker run` stays on UTC.
RUN TZ=Australia/Melbourne node -e "const ok = new Date(Date.UTC(2030,6,1)).getTimezoneOffset() === -600 && new Date(Date.UTC(2030,0,1)).getTimezoneOffset() === -660 && new Date(2026,9,4,2,30).getHours() === 3 && Intl.DateTimeFormat().resolvedOptions().timeZone === 'Australia/Melbourne'; if (!ok) { console.error('Time zone data for Australia/Melbourne is missing or wrong'); process.exit(1); }"
# Enable only if the assertion above fails on the build host:
# RUN apt-get update && apt-get install -y --no-install-recommends tzdata && rm -rf /var/lib/apt/lists/*

USER node
VOLUME ["/data"]
EXPOSE 3001

# The slim image has no curl, so the check uses Node's built-in fetch.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3001) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# Source maps make logged stack traces point at the TypeScript sources.
CMD ["node", "--enable-source-maps", "dist/server.js"]
