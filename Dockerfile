# syntax=docker/dockerfile:1
#
# Joinr Finance: a two-stage image (build → slim runtime).
# The dev PC has no Docker; this is built on the NAS from a copy of the build context in Stage 7.
#
#   docker build -t joinr-finance .
#   docker run -d -p 3001:3001 -v /path/to/data:/data joinr-finance
#
# The runtime runs as the unprivileged `node` user (uid 1000); the /data volume must be writable
# by it. better-sqlite3 loads the prebuilt N-API binary it ships (glibc x64/arm64), so no compiler
# is needed in either stage (pnpm-workspace.yaml denies its node-gyp build on purpose).

# Pinned to the Node minor the app is developed and tested on (Stage 7 may pin a digest too).
ARG NODE_VERSION=24.20

# ─── Build ──────────────────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS build

ENV CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# pnpm via corepack, at the version pinned in package.json "packageManager".
# A newer corepack than the one bundled with Node is installed first (the bundled one may not
# know the signing keys of newer pnpm releases). It is pinned so the build is repeatable; bump it
# on purpose. (Fallback if corepack misbehaves on the NAS: `RUN npm install --global pnpm@11.23.0`.)
RUN npm install --global --no-fund --no-audit corepack@0.36.0 \
 && corepack enable pnpm \
 && corepack prepare pnpm@11.23.0 --activate

WORKDIR /repo

# Fetch every package from the lockfile alone (`pnpm fetch` always uses the lockfile), so this
# layer stays cached until the lockfile changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN pnpm fetch

# Install from the fetched store (no network), then build the SPA and the server bundle.
# `prepare` (the git hook installer) is a no-op here: .git is not in the build context.
COPY . .
RUN pnpm install --frozen-lockfile --offline \
 && pnpm build

# A self-contained copy of the server: package.json "files" (dist, migrations) plus production
# dependencies only. The built SPA goes next to it. (Only ever run `pnpm deploy` here: in a dev
# checkout it rewrites the workspace state to a production-only install.)
RUN pnpm --filter @joinr/server deploy --prod --legacy /out/app \
 && cp -r apps/web/dist /out/app/web \
 && test -f /out/app/dist/server.js \
 && test -f /out/app/migrations/meta/_journal.json \
 && test -f /out/app/web/index.html

# ─── Runtime ────────────────────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

LABEL org.opencontainers.image.title="Joinr Finance" \
      org.opencontainers.image.description="Self-hosted personal-finance web app"

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

USER node
VOLUME ["/data"]
EXPOSE 3001

# The slim image has no curl, so the check uses Node's built-in fetch.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3001) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# Source maps make logged stack traces point at the TypeScript sources.
CMD ["node", "--enable-source-maps", "dist/server.js"]
