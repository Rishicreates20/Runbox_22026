# Two images, one Dockerfile:
#
#   docker build --target web    -t codeplus-web .     # the React app, served by nginx
#   docker build --target runbox -t codeplus-runbox .  # the sandbox + both language images
#
# The web image is a static site (no server code), so it runs unprivileged.
# The runbox image must run with --privileged --cgroupns private --tmpfs /tmp/runbox
# because the sandbox creates namespaces, OverlayFS mounts and cgroups.

# ---------- web: build ----------
FROM node:22-bookworm-slim AS web-build
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
# Vite inlines VITE_* at build time. Leave them empty for demo mode.
ARG VITE_SUPABASE_URL=
ARG VITE_SUPABASE_ANON_KEY=
ARG VITE_API_URL=
RUN npm run build

# ---------- web: runtime ----------
FROM nginxinc/nginx-unprivileged:1.27-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1

# ---------- runbox: sandbox binary + language images ----------
# Ubuntu 24.04 gives gcc 13 and Python 3.12, the versions the app advertises.
FROM ubuntu:24.04 AS runbox
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential python3 ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY Makefile ./
COPY src src
COPY scripts scripts
COPY tests tests
RUN CFLAGS="-O2 -g -Werror" make \
 && scripts/make-rootfs.sh /var/lib/runbox/rootfs --python /usr/bin/python3 \
 && scripts/make-rootfs.sh /var/lib/runbox/rootfs-gcc --python /usr/bin/python3 --gcc
COPY docker/runbox-entrypoint.sh /usr/local/bin/runbox-entrypoint
ENV PATH=/app:$PATH
ENTRYPOINT ["runbox-entrypoint"]
CMD ["python3", "tests/run_tests.py"]
