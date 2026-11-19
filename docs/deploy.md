# Deploying and operating Codeplus

Codeplus has two services plus two data stores:

| component | runs as | needs |
|---|---|---|
| `web` (Next.js) | unprivileged user | Node 20+, `DATABASE_URL`, `REDIS_URL`, `ADMIN_TOKEN` |
| `judge` (worker + runbox) | **root** | Linux x86_64, kernel 5.12+ (5.19+ for `memory_kb` on cgroup v2), gcc, Python 3, the two sandbox images |
| Postgres 14+ | | durable: problems, tests, submissions, papers |
| Redis 6.2+ | | ephemeral: queue, event streams (1 h TTL), pub/sub, rate limits |

The judge must be root on a real Linux kernel because runbox creates namespaces, OverlayFS mounts and cgroups. That rules out serverless platforms and most PaaS for the judge. The web tier has no such constraint.

Three ways to run it, from quickest to most hands-on:

1. [Docker Compose](#1-docker-compose) on any Linux host
2. [One-box Ubuntu install](#2-one-box-ubuntu-vps) with systemd and nginx
3. [Split deployment](#3-split-deployment): web on a PaaS, judge on a VPS

Windows users: see [WSL 2](#windows-wsl-2).

---

## 1. Docker Compose

```sh
git clone https://github.com/Rishicreates20/Runbox_22026 /opt/codeplus && cd /opt/codeplus
cp .env.example .env
# edit .env: ADMIN_TOKEN=$(openssl rand -base64 24), POSTGRES_PASSWORD=$(openssl rand -hex 24)
# (the DB password goes into a URL, so keep it to letters and digits)
docker compose up -d --build
docker compose ps            # migrate should be "exited (0)", the rest running/healthy
```

What runs:

| service | image | notes |
|---|---|---|
| `postgres` | `postgres:16-alpine` | data in the `pgdata` volume |
| `redis` | `redis:7-alpine` | persistence off on purpose |
| `migrate` | `codeplus-judge` | one shot: applies `db/schema.sql`, seeds `problems/*.json`, exits |
| `judge` | `codeplus-judge` | `privileged`, own cgroup namespace, tmpfs for job dirs |
| `web` | `codeplus-web` | Next.js standalone server, non-root, port `WEB_PORT` (3000) |

Why the judge container is configured the way it is:

- **`privileged: true`.** runbox calls `unshare`, `mount`, `pivot_root` and writes cgroup files. These need `CAP_SYS_ADMIN` and an unconfined seccomp/AppArmor profile at the container level. Submissions are sandboxed again inside, with their own user namespace, seccomp filter and cgroup.
- **`cgroup: private`.** The container gets its own cgroup namespace, so per-job cgroups are created under the container's cgroup and never touch the host's tree. On cgroup v2 hosts `docker/judge-entrypoint.sh` moves the container's processes into a leaf cgroup first, so controllers can be delegated to job cgroups (cgroup v2's "no internal processes" rule).
- **`tmpfs: /tmp/runbox`.** Each job's OverlayFS upper layer can't sit on the container's own overlay root (the kernel refuses overlay-on-overlay upperdirs), so it goes on tmpfs.

Put a TLS-terminating reverse proxy in front of port 3000 for anything public. Use [`deploy/nginx-codeplus.conf`](../deploy/nginx-codeplus.conf) as a template: SSE needs `proxy_buffering off`.

Sanity checks after start-up:

```sh
docker compose exec judge python3 tests/run_tests.py          # 22/22 sandbox checks
docker compose exec judge npx tsx judge/test/e2e.ts           # 18/18 judge checks
```

## 2. One-box Ubuntu VPS

Recommended for a first public deployment. Ubuntu 24.04 (or 22.04), 2 vCPU / 4 GB RAM is plenty to start.

```sh
git clone https://github.com/Rishicreates20/Runbox_22026 /opt/codeplus
sudo DOMAIN=codeplus.example.com /opt/codeplus/deploy/setup-ubuntu.sh
sudo certbot --nginx -d codeplus.example.com
```

[`deploy/setup-ubuntu.sh`](../deploy/setup-ubuntu.sh) is idempotent. It:

1. installs build tools, Python, Postgres, Redis, nginx and Node 22;
2. builds runbox and both sandbox images under `/var/lib/runbox/`, then runs the sandbox tests;
3. creates the `codeplus` system user, the database, and `/etc/codeplus.env` with a random DB password and admin token (mode 640, group `codeplus`);
4. runs migrations and seeds, builds the web app;
5. installs and starts `codeplus-judge.service` (root) and `codeplus-web.service` (user `codeplus`, `ProtectSystem=strict`, `NoNewPrivileges`), and configures nginx.

### Day-2 operations

| task | command |
|---|---|
| logs | `journalctl -u codeplus-judge -f`, `journalctl -u codeplus-web -f` |
| restart | `systemctl restart codeplus-judge codeplus-web` |
| upgrade | `cd /opt/codeplus && git pull && npm ci && npm run migrate && npm run build && systemctl restart codeplus-judge codeplus-web` |
| rebuild sandbox images (after an OS upgrade changes gcc or Python) | `make && scripts/make-rootfs.sh /var/lib/runbox/rootfs --python /usr/bin/python3 && scripts/make-rootfs.sh /var/lib/runbox/rootfs-gcc --python /usr/bin/python3 --gcc` |
| backup | `sudo -u postgres pg_dump codeplus \| gzip > codeplus-$(date +%F).sql.gz` (Redis holds nothing that needs backing up) |
| add problems | `POST /api/problems` with `Authorization: Bearer $ADMIN_TOKEN`, or `npm run seed -- path/to/problem.json` |
| verify cgroup v2 | `sudo python3 tests/run_tests.py --cgroup v2` |

Migrations are plain idempotent SQL (`CREATE ... IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`), so `npm run migrate` is always safe to re-run.

The judge drains gracefully on `SIGTERM` (systemd waits up to 60 s). Jobs that are mid-run when a worker dies stay in that worker's processing list (keyed by `JUDGE_NAME`) and are put back on the queue when a worker with the same name starts again. Keep `JUDGE_NAME` stable per host; Compose pins it to `judge`.

### Scaling

- **More judge throughput:** raise `JUDGE_CONCURRENCY` (defaults to CPU count − 1), or run more judge hosts pointed at the same Postgres and Redis. Workers coordinate only through the Redis queue.
- **More web capacity:** run more web processes behind the load balancer. Each holds one Redis subscriber connection regardless of how many browsers are connected.

## 3. Split deployment

The web app runs anywhere Node runs, including Vercel, given a managed Postgres and Redis reachable from both sides:

```
Vercel / any Node host  ──▶  managed Postgres  ◀──  judge VPS (root)
        └──────────────────▶ managed Redis     ◀──────────┘
```

Set `DATABASE_URL`, `REDIS_URL` and `ADMIN_TOKEN` on the web host, and the same `DATABASE_URL`/`REDIS_URL` on the judge (via `/etc/codeplus.env` or the Compose `.env`). Run `npm run migrate && npm run seed` once from either side. SSE responses are long-lived, so pick a web host that allows streaming responses of a few minutes.

## Windows (WSL 2)

runbox needs a real Linux kernel, which WSL 2 provides.

1. Install Ubuntu 24.04 from the Microsoft Store and enable systemd: add `[boot]\nsystemd=true` to `/etc/wsl.conf`, then `wsl --shutdown` from PowerShell.
2. Clone **inside the Linux filesystem** (for example `/opt/codeplus`), not under `/mnt/c/...`. Windows-mounted drives are slow and don't support the ownership and overlay semantics the sandbox expects.
3. Either run the Ubuntu installer above (skip `DOMAIN` and certbot) or use Docker:
   - with Docker Desktop's WSL 2 backend, `docker compose up -d --build` works as on Linux;
   - or install Docker Engine inside the WSL distro.
4. Open `http://localhost:3000` from Windows. WSL forwards localhost automatically.

If the sandbox tests report `IE` with an overlay or cgroup error, check `stat -fc %T /sys/fs/cgroup` (`cgroup2fs` means v2) and run `sudo python3 tests/run_tests.py --cgroup auto` to see which path runbox picks.

## Environment variables

All are listed in [`.env.example`](../.env.example).

| variable | used by | default | purpose |
|---|---|---|---|
| `DATABASE_URL` | web, judge | `postgres://codeplus:codeplus@127.0.0.1:5432/codeplus` | Postgres connection |
| `REDIS_URL` | web, judge | `redis://127.0.0.1:6379` | Redis connection |
| `ADMIN_TOKEN` | web | unset (uploads disabled) | Bearer token for `POST /api/problems` and `/admin` |
| `POSTGRES_PASSWORD` | Compose | `codeplus` | DB password used by the Compose stack |
| `WEB_PORT` | Compose | `3000` | published web port |
| `PAPER_FETCH_ALLOW_PRIVATE` | web | `0` | `1` lets paper links point at private/LAN hosts (dev only, disables SSRF protection) |
| `JUDGE_CONCURRENCY` | judge | CPUs − 1 (Compose: 2) | parallel submissions per judge |
| `RUNBOX_BIN` | judge | `./runbox` | sandbox binary |
| `RUNBOX_ROOTFS` | judge | `/var/lib/runbox/rootfs` | image submissions run in |
| `RUNBOX_COMPILE_ROOTFS` | judge | `/var/lib/runbox/rootfs-gcc` | image compilers run in |
| `RUNBOX_CGROUP` | judge | `auto` | `auto`, `v2` or `v1` |
| `JUDGE_WORKDIR` | judge | `/var/lib/codeplus/jobs` | root-only scratch space for compiled binaries |
| `JUDGE_NAME` | judge | hostname | worker name in logs and processing-list keys |

## Hardening checklist for a public instance

- [ ] TLS in front of the web app (certbot or your load balancer), HTTP redirected to HTTPS.
- [ ] Postgres and Redis bound to localhost or a private network only. Redis has no password in the default config.
- [ ] A long random `ADMIN_TOKEN`, stored only in `/etc/codeplus.env` or `.env` (both git-ignored).
- [ ] The judge host runs nothing else sensitive. It is root by design, and the sandbox images must not contain secrets (submissions can read everything in them).
- [ ] Unattended security upgrades on, and the sandbox images rebuilt after gcc or Python updates.
- [ ] `pg_dump` on a schedule, copied off the host.
