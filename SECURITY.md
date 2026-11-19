# Security

Codeplus exists to run code written by strangers, so the sandbox is the most security-sensitive part of the project.

## Reporting a vulnerability

Please **don't open a public issue** for a sandbox escape or anything else exploitable. Use GitHub's private vulnerability reporting instead: the **Security** tab of this repository, then **Report a vulnerability**. Include the submission (code + language) or request that triggers it and what you observed. You should get a reply within a week.

## Threat model

**Untrusted:** submission source code, its stdin, its output, uploaded problem JSON (validated by Zod), imported mock papers and the links they're fetched from.

**Trusted:** the host, the operator, the sandbox images under `/var/lib/runbox/`, and anyone holding `ADMIN_TOKEN`.

**Goals, in order:**

1. A submission can't read or write anything on the host outside its own throwaway directory.
2. A submission can't affect other submissions (concurrent or later).
3. A submission can't reach the network.
4. A submission can't exhaust the host: memory, processes, CPU time, disk and output are all capped per job.

## Controls

| control | where |
|---|---|
| User, mount, PID, net, IPC, UTS, cgroup namespaces; unmapped uid 65534, no capabilities | `src/runbox.c` |
| Per-job OverlayFS root, `pivot_root`, old root lazily unmounted, upper layer deleted after the job | `src/runbox.c` |
| Default-deny seccomp-BPF allowlist, x86_64 only, x32 and `int 0x80` killed, `clone` without `CLONE_NEW*`, sockets `EACCES` | `src/seccomp.c` |
| cgroup memory (swap 0, OOM group kill), pids, CPU-time accounting; whole tree killed at the end | `src/cgroup.c` |
| `NO_NEW_PRIVS`, `RLIMIT_CORE=0`, `RLIMIT_FSIZE`, `RLIMIT_NOFILE`, `RLIMIT_CPU` backstop | `src/runbox.c` |
| Compilers run inside the sandbox too; binaries exported with `openat2(RESOLVE_BENEATH \| RESOLVE_NO_SYMLINKS \| RESOLVE_NO_XDEV)` | `src/runbox.c`, `judge/src/judge.ts` |
| SSRF guard on mock-paper links: DNS checked against private, loopback and link-local ranges on every redirect hop, 20 s timeout, 15 MB cap | `web/lib/extract.ts` |
| Constant-time admin token comparison; rate limits on submissions | `web/app/api/problems/route.ts`, `web/lib/rate-limit.ts` |

The automated escape and limit tests are in `tests/run_tests.py` and run in CI on every push.

## Known limits

- The judge process itself runs as root, as runc and similar runtimes do. A kernel bug reachable through the allowed syscalls could break out; keep the judge host patched and dedicated.
- No LSM (AppArmor/SELinux) profile is applied to submissions yet; isolation relies on namespaces, seccomp and cgroups.
- Everything in the sandbox images is readable by submissions. Never put secrets in them.
- In Docker, the judge container is `privileged`. Treat the container host the same as a bare-metal judge host.
