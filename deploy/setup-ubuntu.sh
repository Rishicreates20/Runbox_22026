#!/usr/bin/env bash
# One-box install of Codeplus on a fresh Ubuntu 24.04 (or 22.04) VPS, as root.
#   git clone https://github.com/Rishicreates20/Runbox_22026 /opt/codeplus
#   sudo DOMAIN=codeplus.example.com /opt/codeplus/deploy/setup-ubuntu.sh
# Then point DNS at the server and run: certbot --nginx -d $DOMAIN
set -euo pipefail
cd "$(dirname "$0")/.."
APP=$(pwd)
DOMAIN=${DOMAIN:-_}

[[ $(id -u) == 0 ]] || { echo "run as root"; exit 1; }
[[ $APP == /opt/codeplus ]] || echo "note: the systemd units expect /opt/codeplus (this is $APP)"

apt-get update
apt-get install -y build-essential python3 postgresql redis-server nginx curl ca-certificates
if ! command -v node >/dev/null || [[ $(node -p 'process.versions.node.split(".")[0]') -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# Sandbox: binary, run image (C/C++ runtime + python), compile image (+ gcc).
make -C "$APP"
PY=$(command -v python3.12 || command -v python3)
"$APP/scripts/make-rootfs.sh" /var/lib/runbox/rootfs --python "$PY"
"$APP/scripts/make-rootfs.sh" /var/lib/runbox/rootfs-gcc --python "$PY" --gcc
python3 "$APP/tests/run_tests.py" --rootfs /var/lib/runbox/rootfs

# Database and config.
id codeplus >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin codeplus
if [[ ! -f /etc/codeplus.env ]]; then
  DBPASS=$(head -c 18 /dev/urandom | base64 | tr -d '/+=')
  ADMIN=$(head -c 24 /dev/urandom | base64 | tr -d '/+=')
  su postgres -c "psql -v ON_ERROR_STOP=1 -c \"CREATE USER codeplus PASSWORD '$DBPASS'\" -c 'CREATE DATABASE codeplus OWNER codeplus'"
  cat > /etc/codeplus.env <<ENV
DATABASE_URL=postgres://codeplus:$DBPASS@127.0.0.1:5432/codeplus
REDIS_URL=redis://127.0.0.1:6379
ADMIN_TOKEN=$ADMIN
ENV
  chmod 640 /etc/codeplus.env
  chgrp codeplus /etc/codeplus.env
  echo "admin token for /admin: $ADMIN (also in /etc/codeplus.env)"
fi
set -a; . /etc/codeplus.env; set +a

# App.
npm ci
npm run migrate
npm run seed
npm run build
chown -R codeplus:codeplus "$APP/web/.next"

install -m 644 deploy/codeplus-judge.service deploy/codeplus-web.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now redis-server postgresql codeplus-judge codeplus-web

sed "s/codeplus.example.com/$DOMAIN/" deploy/nginx-codeplus.conf > /etc/nginx/sites-available/codeplus
ln -sf /etc/nginx/sites-available/codeplus /etc/nginx/sites-enabled/codeplus
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
echo "Codeplus is up on http://$DOMAIN/"
