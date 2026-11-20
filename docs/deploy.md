# Deploying and operating Code+

Code+ has three parts. They deploy separately, and only the first is required.

| part | what it is | runs on | required? |
|---|---|---|---|
| **App** (`web/`) | a static React build (`dist/`) | Vercel, nginx, any static host or CDN | yes |
| **Supabase** (`supabase/`) | Auth, Postgres with RLS, Storage | a Supabase project | for real accounts |
| **runbox** (`src/`) | the C sandbox | a Linux x86_64 host as **root** | for real judging |

Without Supabase the app runs in demo mode (everything in `localStorage`). Without a judge server, verdicts come from the in-browser simulator.

---

## 1. The app

All configuration is read **at build time** (Vite inlines `VITE_*` variables), so set them before building, not at runtime.

| variable | default | purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | empty | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | empty | Supabase publishable (anon) key. It is public by design; RLS is what protects data. |
| `VITE_API_URL` | empty | base URL of a judge/auth server implementing [the API contract](../web/README.md#custom-api) |
| `VITE_ROUTER` | browser | `hash` for hosts that can't rewrite unknown paths to `index.html` (set by `npm run build:static`) |

Both Supabase variables empty and `VITE_API_URL` empty means demo mode.

### Vercel

1. Import the repository and set **Root Directory** to `web`. Vercel detects Vite (`npm run build`, output `dist`).
2. Add the `VITE_*` variables under **Settings → Environment Variables** for Production and Preview.
3. Deploy. [`web/vercel.json`](../web/vercel.json) already rewrites every path to `index.html` for client-side routing and caches `/assets/*` for a year.

### Docker (nginx)

```sh
docker build --target web -t codeplus-web \
  --build-arg VITE_SUPABASE_URL=https://xyz.supabase.co \
  --build-arg VITE_SUPABASE_ANON_KEY=sb_publishable_... .
docker run -d -p 8080:8080 --name codeplus-web codeplus-web
```

The image is `nginx-unprivileged` (uid 101, port 8080) serving `dist/` with an `index.html` fallback, immutable caching for hashed assets, `no-cache` for the HTML, and `nosniff` / `X-Frame-Options` / `Referrer-Policy` headers. Config: [`docker/nginx.conf`](../docker/nginx.conf). Put TLS in front of it (a load balancer, Caddy, or certbot on the host).

### Any static host or a sub-path

`npm run build:static` writes `dist-static/` with hash routing and relative asset paths, so it works from a sub-folder (GitHub Pages, S3, a shared host) without rewrite rules.

---

## 2. Supabase (real accounts)

1. Create a project, then apply the migrations in [`supabase/migrations`](../supabase/migrations) in filename order, either with the CLI:

   ```sh
   supabase link --project-ref <ref>
   supabase db push
   ```

   or by pasting each file into the SQL editor. They create `profiles`, `problems`, `problem_tests` and `submissions` with row-level security, the private `solutions` and `testcases` buckets with their storage policies, and the sign-up trigger that creates a profile.
2. **Authentication → URL Configuration:** set **Site URL** to the production address, and add `http://localhost:5173/**` and your preview domains (for example `https://*-<team>.vercel.app/**`) under **Redirect URLs**. Confirmation and password-reset emails link back to these.
3. **Authentication → Emails:** the built-in mailer only reaches members of your Supabase team. Configure custom SMTP for public sign-ups, or switch off **Confirm email**.
4. Optional: enable GitHub and Google under **Sign In / Providers**.
5. Make yourself an admin after signing up:

   ```sql
   update public.profiles set role = 'admin' where username = 'your_username';
   ```

Backups: Supabase takes daily backups on paid plans. On the free plan, schedule `supabase db dump` (or `pg_dump` against the connection string) and copy the output off-site.

---

## 3. runbox (the sandbox)

runbox must run as root on a real Linux kernel, because it creates namespaces, OverlayFS mounts and cgroups. That rules out serverless platforms and most PaaS. Requirements: x86_64, kernel 5.12+ (5.19+ for `memory_kb` on cgroup v2), gcc and Python 3 on the host to build the images.

### On a host (Ubuntu 22.04 / 24.04)

```sh
sudo apt-get install -y build-essential python3
make
sudo scripts/make-rootfs.sh /var/lib/runbox/rootfs     --python /usr/bin/python3
sudo scripts/make-rootfs.sh /var/lib/runbox/rootfs-gcc --python /usr/bin/python3 --gcc
sudo python3 tests/run_tests.py            # expect 22/22
sudo python3 tests/run_tests.py --cgroup v2   # force the v2 path
```

Rebuild both images after an OS upgrade changes gcc or Python. Use `/usr/bin/python3`, not a Python under `/usr/local` or a virtualenv: the image builder copies the interpreter and its standard library from their standard paths.

### In Docker

```sh
docker build --target runbox -t codeplus-runbox .
docker run --rm --privileged --cgroupns private --tmpfs /tmp/runbox codeplus-runbox
```

Why each flag is needed:

- **`--privileged`.** runbox calls `unshare`, `mount` and `pivot_root` and writes cgroup files, which need `CAP_SYS_ADMIN` and no container-level seccomp/AppArmor profile. Submissions are sandboxed again inside, with their own user namespace, seccomp filter and cgroup.
- **`--cgroupns private`.** Job cgroups are created under the container's own cgroup, never in the host's tree. On cgroup v2, [`docker/runbox-entrypoint.sh`](../docker/runbox-entrypoint.sh) first moves the container's processes into a leaf cgroup so controllers can be delegated (cgroup v2's "no internal processes" rule).
- **`--tmpfs /tmp/runbox`.** The kernel refuses an OverlayFS upper layer on the container's own overlay root, so job directories go on tmpfs.

The default command runs the test suite. A judge server built on this image would run `runbox` per test, as shown in [docs/runbox.md](runbox.md#usage).

### Windows

runbox needs a real Linux kernel, which WSL 2 provides. Clone inside the Linux filesystem (for example `~/codeplus`), not under `/mnt/c`, then follow the host steps above, or use Docker Desktop with the WSL 2 backend. If the tests report `IE` with an overlay or cgroup error, check `stat -fc %T /sys/fs/cgroup` (`cgroup2fs` means v2) and try `--cgroup auto`.

---

## CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on every push to `main` and every pull request:

| job | what it does |
|---|---|
| Web app | `npm ci`, typecheck, production build, static build |
| runbox sandbox tests | builds with `-Werror`, builds both images, runs all 22 checks with `--cgroup v2` on Ubuntu 24.04 |
| Docker images | builds the `web` image and smoke-tests its routing; builds the `runbox` image and runs the suite inside it |

## Hardening checklist for a public instance

- [ ] TLS in front of the app; HTTP redirected to HTTPS.
- [ ] Supabase **Site URL** and **Redirect URLs** limited to your own domains.
- [ ] Custom SMTP configured, or email confirmation deliberately off.
- [ ] Never ship the Supabase **service-role** key to the browser or put it in a `VITE_*` variable. Only the publishable key belongs there.
- [ ] Admin role granted only by SQL, to named accounts.
- [ ] The runbox host runs nothing else sensitive. It is root by design, and the sandbox images must not contain secrets (submissions can read everything in them).
- [ ] Unattended security upgrades on the runbox host, and the sandbox images rebuilt after gcc or Python updates.
