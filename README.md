# Codeplus

A competitive-programming platform: problem pages with a Monaco editor, Run and Submit, live per-test progress, and a judge that runs every submission in `runbox`, a Linux-native sandbox built on namespaces, OverlayFS, cgroups and seccomp-BPF. Languages are C++17, C11 and Python 3.

```
browser ──POST /api/submissions──▶ Next.js ──INSERT──▶ Postgres
   ▲                                  │  └──LPUSH job──▶ Redis queue
   │ SSE /api/execution/{id}          │                     │ BLMOVE
   │ (Last-Event-ID replay)           │                     ▼
   └──────── Next.js ◀── PSUBSCRIBE ──┴── Redis ◀── XADD+PUBLISH ── judge worker (root)
                                                                     │  compile: runbox + gcc image
                                                                     │  each test: runbox + run image
                                                                     └─ UPDATE submissions ─▶ Postgres
```

## Layout

| path | what |
|---|---|
| `src/`, `scripts/`, `tests/`, `Makefile` | **runbox**, the sandbox (C, no dependencies). Docs: [docs/runbox.md](docs/runbox.md) |
| `packages/shared/` | Zod schemas (problem upload, submission, queue job, events), branded ids, output checker, DB/Redis helpers |
| `judge/` | Worker: pops jobs, compiles and runs them in runbox, streams events, stores results |
| `web/` | Next.js 16 app: problem list, problem workspace, upload page, API routes, SSE |
| `db/schema.sql` | Postgres tables: `problems`, `test_cases`, `submissions` |
| `problems/` | Seed problems (JSON) and `generate.py`, which builds them from reference solutions |
| `docs/asyncapi.yaml` | AsyncAPI 3.0 contract for the SSE stream |
| `deploy/` | Ubuntu setup script, systemd units, nginx config |

## How the pieces follow the architecture doc

**Monaco in Next.js.** The editor component is loaded with `next/dynamic(..., { ssr: false })`, so the statement, examples and limits are server-rendered and the editor mounts only in the browser. The editor and Monaco instances live in `useRef`s, and switching language calls `monaco.editor.setModelLanguage` on the existing model instead of re-creating the editor. Monaco is self-hosted: `web/scripts/copy-monaco.mjs` copies monaco-editor's prebuilt bundle to `public/monaco/vs` before `dev`/`build`, and the loader is pointed there. The editor and its web workers therefore load from our own origin and never pass through webpack or Turbopack. That sidesteps the worker-routing, CSS-import and Turbopack problems in the doc without patching Monaco. The app doesn't use Tailwind, so there's no purge step to strip Monaco's classes.

**Problem ingestion (Zod).** `ProblemUpload` is a discriminated union on `problem_type`:

| `problem_type` | test data | refinements |
|---|---|---|
| `generic` | raw `input` + `displayInput` | — |
| `array_manipulation` | `args.target_array`, `args.k_value` | length < 10⁵, ints within ±10⁹, k ≥ 0 |
| `graph_traversal` | `args.adjacency_list`, `args.start_node` | every neighbour and the start node within `0..n-1`, ≤ 10⁶ edges |
| `string_parsing` | `args.input_string`, plus problem-level `input_pattern` | pattern is a valid ECMAScript regex, every string < 10⁴ chars, single line, fully matches the pattern |

All objects are strict, so unknown fields are rejected. A refinement requires Python's time limit to be at least the C/C++ one. Problem slugs and submission ids are branded types. Every test is stored twice: `input` (raw stdin, CRLF → LF, ending in a newline) and `display_input` (what the page shows). For the typed kinds both are produced from `args` by one canonical encoder, so authors never hand-write stdin. On the queue, code and test data are base64.

Upload at `/admin` (or `POST /api/problems`). `?dryRun=1` validates and previews without saving and needs no token. Saving needs `Authorization: Bearer $ADMIN_TOKEN`.

**SSE + Redis.** The judge appends each event to a per-submission Redis stream and publishes it, in one Lua script. The stream entry id is the SSE `id`. `GET /api/execution/{id}`:

- replays from the stream after `Last-Event-ID`, then switches to live pub/sub without gaps or duplicates (it subscribes first and buffers);
- shares one Redis connection per web process: a single `PSUBSCRIBE codeplus:exec:*` fanned out from an in-memory map, not a connection per browser;
- sends `retry: 2000`, a `: heartbeat` every 15 s, and `X-Accel-Buffering: no`;
- drops clients whose socket hasn't drained for 5 s;
- closes after the `completed` event. After the one-hour log TTL it serves the stored result from Postgres.

The contract is in [docs/asyncapi.yaml](docs/asyncapi.yaml). The Zod source of truth is `packages/shared/src/events.ts`.

**Judge.** The worker takes jobs with `BLMOVE` into a per-slot processing list, so a crash puts them back on the queue at the next start. C/C++ is compiled **inside runbox** with a separate image that contains gcc (`make-rootfs.sh --gcc`). The binary comes out through `runbox --export`, which can't be tricked by symlinks, and is then run in the minimal image. Python gets a sandboxed syntax check, so syntax errors are reported as CE rather than RE. Submit stops at the first failing test. Run executes the sample cases, or the custom stdin typed in the console, and only checks inputs that match a sample. The checker ignores trailing spaces and trailing blank lines.

## Run it locally

You need Linux, root (for runbox), Node 20+, gcc, Python 3, Postgres and Redis (`docker compose -f docker-compose.dev.yml up -d` works for the last two).

```sh
make                                                         # runbox
sudo scripts/make-rootfs.sh /var/lib/runbox/rootfs --python "$(command -v python3)"
sudo scripts/make-rootfs.sh /var/lib/runbox/rootfs-gcc --python "$(command -v python3)" --gcc
npm install
npm run migrate && npm run seed                              # schema + 5 problems
sudo -E npm run judge                                        # terminal 1 (root)
ADMIN_TOKEN=dev npm run dev                                  # terminal 2, http://localhost:3000
```

Environment (defaults shown in `web/.env.example` and `judge/src/config.ts`): `DATABASE_URL`, `REDIS_URL`, `ADMIN_TOKEN`, `RUNBOX_ROOTFS`, `RUNBOX_COMPILE_ROOTFS`, `JUDGE_CONCURRENCY`.

## Tests

```sh
sudo python3 tests/run_tests.py     # runbox: 22 sandbox checks
npm test                            # Zod schema and checker tests
sudo -E npx tsx judge/test/e2e.ts   # 18 judge checks through the real queue (worker must be running)
npm run typecheck
```

`judge/test/e2e.ts` submits reference solutions in all three languages (AC) plus wrong answers, int overflow, compile errors, a Python syntax error, an infinite loop, a 1 GiB allocation, a segfault, a blocked `mount(2)`, and a custom CRLF input. It checks each verdict and the stored row.

## Deploy

runbox needs a Linux host where it can run as root, so the judge can't run on Vercel or other serverless hosts. The simplest setup is one Ubuntu 24.04 VPS (2 vCPU / 4 GB is plenty to start) running everything:

```sh
git clone https://github.com/Rishicreates20/Runbox_22026 /opt/codeplus
sudo DOMAIN=codeplus.example.com /opt/codeplus/deploy/setup-ubuntu.sh
sudo certbot --nginx -d codeplus.example.com
```

The script installs Postgres, Redis, nginx and Node. It builds runbox and both images, runs the sandbox tests, creates the database and an admin token in `/etc/codeplus.env`, seeds the problems, and starts `codeplus-judge` (root) and `codeplus-web` (an unprivileged user) behind nginx with SSE buffering off.

To split the system later, the web app runs anywhere that has Node (Vercel included) given `DATABASE_URL` and `REDIS_URL` for a managed Postgres and Redis. Only the judge has to stay on a VPS.

## Known gaps

- No user accounts yet. Submissions are tied to an anonymous browser cookie.
- runbox's cgroup v2 path hasn't been exercised on a real v2 host. The dev machine only had v1, and all limit tests ran through the v1 fallback. Ubuntu 22.04/24.04 use v2, so run `sudo python3 tests/run_tests.py --cgroup v2` once on the server (the setup script runs the tests in `auto` mode, which picks v2 there).
- Java isn't offered: the seccomp allowlist hasn't been tuned for the JVM.
