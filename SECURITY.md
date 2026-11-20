# Security

Code+ exists to run code written by strangers, so the sandbox is the most security-sensitive part of the project.

## Reporting a vulnerability

Please **don't open a public issue** for a sandbox escape, an RLS bypass or anything else exploitable. Use GitHub's private vulnerability reporting instead: the **Security** tab of this repository, then **Report a vulnerability**. Include what triggers it (code, language, request) and what you observed. You should get a reply within a week.

## Threat model

**Untrusted:** submission source code, its stdin and output, uploaded source files and test archives, imported PDFs, and every signed-in user.

**Trusted:** the runbox host and its operator, the sandbox images under `/var/lib/runbox/`, and accounts with the `admin` role.

**Goals, in order:**

1. A submission can't read or write anything on the host outside its own throwaway directory.
2. A submission can't affect other submissions, concurrent or later.
3. A submission can't reach the network.
4. A submission can't exhaust the host: memory, processes, CPU time, disk and output are all capped per job.
5. A user can't read or change another user's submissions or files, or read hidden tests.

## Controls

| control | where |
|---|---|
| User, mount, PID, net, IPC, UTS, cgroup namespaces; unmapped uid 65534, no capabilities | `src/runbox.c` |
| Per-job OverlayFS root, `pivot_root`, old root lazily unmounted, upper layer deleted after the job | `src/runbox.c` |
| Default-deny seccomp-BPF allowlist, x86_64 only, x32 and `int 0x80` killed, `clone` without `CLONE_NEW*`, sockets `EACCES` | `src/seccomp.c` |
| cgroup memory (swap 0, OOM group kill), pids, CPU-time accounting; whole tree killed at the end | `src/cgroup.c` |
| `NO_NEW_PRIVS`, `RLIMIT_CORE=0`, `RLIMIT_FSIZE`, `RLIMIT_NOFILE`, `RLIMIT_CPU` backstop | `src/runbox.c` |
| Compiled binaries exported with `openat2(RESOLVE_BENEATH \| RESOLVE_NO_SYMLINKS \| RESOLVE_NO_XDEV)`, regular files only, size-capped | `src/runbox.c` |
| Row-level security on every table; role changes blocked for users; admin check in a private schema | `supabase/migrations/` |
| Per-user storage folders for uploaded solutions; hidden tests readable by admins only | `supabase/migrations/` |
| PDFs parsed in the browser; uploads never reach a server-side parser | `web/src/lib/pdf.ts` |

The sandbox escape and limit tests are in `tests/run_tests.py` and run in CI on every push, on the host and inside the Docker image.

## Known limits

- runbox itself runs as root, as runc and similar runtimes do. A kernel bug reachable through the allowed syscalls could break out; keep the host patched and dedicated.
- No LSM (AppArmor/SELinux) profile is applied to submissions yet; isolation relies on namespaces, seccomp and cgroups.
- Everything in the sandbox images is readable by submissions. Never put secrets in them.
- The runbox Docker image must run `--privileged`. Treat that container's host the same as a bare-metal judge host.
- Judging in the app is simulated until a judge server is connected, so verdicts shown there are not proof of correctness.
