# syntax=docker/dockerfile:1.7
# Multi-stage build for the two Codeplus services.
#   docker build --target web   -t codeplus-web   .
#   docker build --target judge -t codeplus-judge .
# docker-compose.yml wires them to Postgres and Redis.

ARG NODE_IMAGE=node:22-bookworm-slim

# ---------- dependencies (shared by both targets) ----------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY judge/package.json judge/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund

# ---------- web: build ----------
FROM deps AS web-build
COPY packages/shared packages/shared
COPY web web
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
RUN npm run build -w web

# ---------- web: runtime (unprivileged, standalone server) ----------
FROM ${NODE_IMAGE} AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=web-build --chown=node:node /app/web/.next/standalone ./
COPY --from=web-build --chown=node:node /app/web/.next/static ./web/.next/static
COPY --from=web-build --chown=node:node /app/web/public ./web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "web/server.js"]

# ---------- judge: runbox binary + sandbox images + worker ----------
# Ubuntu 24.04, the same base the bare-metal deploy targets, so the sandbox
# images carry the same gcc 13 / Python 3.12 either way.
FROM ubuntu:24.04 AS judge
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential python3 ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# Node comes from the official image rather than a third-party apt repo.
COPY --from=deps /usr/local/bin/node /usr/local/bin/node
COPY --from=deps /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json Makefile ./
COPY src src
COPY scripts scripts
COPY tests tests
RUN make \
 && scripts/make-rootfs.sh /var/lib/runbox/rootfs --python /usr/bin/python3 \
 && scripts/make-rootfs.sh /var/lib/runbox/rootfs-gcc --python /usr/bin/python3 --gcc
COPY packages/shared packages/shared
COPY judge judge
COPY db db
COPY problems problems
# runbox creates namespaces, overlay mounts and cgroups, so the container must
# run privileged (see docker-compose.yml). Submissions themselves run as an
# unmapped uid with no capabilities, no network and a seccomp allowlist.
COPY docker/judge-entrypoint.sh /usr/local/bin/judge-entrypoint
ENV RUNBOX_BIN=/app/runbox
ENTRYPOINT ["judge-entrypoint"]
CMD ["npm", "run", "judge"]
