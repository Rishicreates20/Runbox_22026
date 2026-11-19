# runbox: the Codeplus execution sandbox

`runbox` is the Linux-native sandbox from the Codeplus architecture doc. It's a single C binary with no runtime dependencies. It runs one untrusted submission and prints the verdict as one JSON object.

It uses user, mount, PID, network, IPC, UTS and cgroup namespaces. The filesystem is a per-job OverlayFS root entered with `pivot_root`, after which the host root is lazily unmounted. Resource limits come from cgroups v2, with a v1 fallback. A default-deny seccomp-BPF filter pinned to x86_64 is installed right before `execve`.

```
make                                    # builds ./runbox
sudo ./scripts/make-rootfs.sh /var/lib/runbox/rootfs --python /usr/bin/python3.12
sudo python3 tests/run_tests.py         # 20 end-to-end checks
```

## Usage

```
runbox --rootfs DIR [options] -- PROGRAM [ARGS...]

  --rootfs DIR         read-only lowerdir with the language runtimes
  --stdin-b64 FILE     base64 stdin ('-' = read from runbox's stdin)
  --stdin-b64-str STR  base64 stdin given inline
  --file SRC:DST       copy host file SRC to DST inside the sandbox (repeatable)
  --time MS            CPU time limit, ms (default 1000)
  --wall MS            wall-clock limit, ms (default 3*time+1000)
  --mem SIZE           memory limit, e.g. 256M (default 256M)
  --pids N             max tasks (default 64)
  --output SIZE        max bytes per output stream (default 16M)
  --stack SIZE         stack limit (default = --mem)
  --cwd DIR            working directory inside the sandbox (default /box)
  --cgroup auto|v2|v1  cgroup mode (default auto: v2, else v1)
  --cgroup-parent DIR  v2 cgroup to create job cgroups under
  --workroot DIR       where per-job overlay dirs live (default /tmp/runbox)
```

Example: a compiled C++ submission.

```
g++ -O2 -o /srv/jobs/42/prog main.cpp           # compile step (sandbox it too in prod)
runbox --rootfs /var/lib/runbox/rootfs --time 2000 --mem 256M \
       --file /srv/jobs/42/prog:/box/prog --stdin-b64 /srv/jobs/42/input.b64 -- /box/prog
```

```json
{"verdict":"OK","detail":"","exit_code":0,"signal":null,"cpu_time_ms":1.649,
 "wall_time_ms":2,"memory_kb":512,"cgroup":"v2","stdout_b64":"NQo=",
 "stdout_truncated":false,"stderr_b64":""}
```

Stdin is base64-decoded and every `\r\n` is turned into `\n` before the program sees it. This matches the ingestion pipeline's normalisation, so it also covers test cases that skipped it.

## Verdicts

| verdict | when |
|---|---|
| `OK`  | exit code 0 |
| `TLE` | CPU time from `cpu.stat usage_usec` went over `--time`, or wall time went over `--wall` (`detail` says which), or `RLIMIT_CPU` fired |
| `MLE` | `memory.events oom_kill > 0`, or the program crashed or exited non-zero after hitting `memory.max` (e.g. `std::bad_alloc`) |
| `RE`  | non-zero exit code, or killed by a signal (`signal` field, e.g. `SIGSEGV`) |
| `SV`  | killed by seccomp (`SIGSYS`), meaning a blocked system call |
| `OLE` | output went over `--output` (`SIGXFSZ`) |
| `IE`  | internal error: bad input, sandbox setup failed, or `execve` failed |

The grader compares `stdout_b64` with the expected output. That comparison isn't runbox's job.

## How it works

```
runbox (host root)       supervisor: job dir, cgroup, uid/gid maps,
  │                      polls cpu.stat every 5 ms, verdict, cleanup
  │  unshare(NEWNS) + make-rprivate + mount overlay,/dev,/tmp   (private to runbox)
  │
  └─ init  = PID 1 in new USER|NS|PID|NET|IPC|UTS|CGROUP namespaces
       │   make-rprivate, rbind root, pivot_root, mount /proc, umount -l /.old_root
       └─ prog = PID 2   setgroups/setresuid(65534), rlimits, NO_NEW_PRIVS,
                         seccomp filter, execve(PROGRAM)
```

* **User namespace.** Sandbox uids 0–65535 map to host 100000–165535. The program runs as sandbox uid 65534 (host 165534) and has no capabilities anywhere. Host files owned by root show up as unmapped, so `/etc` and the runtimes are read-only to it.
* **Filesystem.** A read-only `lowerdir` (the rootfs) sits under a fresh per-job `upperdir`. Only `/box` (owned by the program), a 64 MB tmpfs `/tmp`, and a minimal `/dev` (`null`, `zero`, `urandom`, `random`) are writable. After `pivot_root` the old root is detached with `umount2(MNT_DETACH)`, so `/.old_root` doesn't exist inside. The upperdir is deleted after every job.
* **Mount propagation.** `MS_REC|MS_PRIVATE` is set on `/` both in runbox's own namespace and in the sandbox's.
* **PID / NET / IPC / UTS.** The program sees only itself and init in `/proc`. The only network interface is `lo`, and it's down. The hostname is `runbox`.
* **cgroups.** Each job gets its own cgroup with `memory.max`, `memory.swap.max=0`, `memory.oom.group=1` and `pids.max`. CPU time is `usage_usec` minus a baseline taken right before `execve`, so sandbox setup isn't charged to the submission. The tree is killed with `cgroup.kill`, or by killing PID 1, which takes the whole PID namespace down. On cgroup v1 hosts the same numbers come from `memory.limit_in_bytes`, `memory.max_usage_in_bytes`, `memory.oom_control`, `pids.max` and `cpuacct.usage`.
* **seccomp.** Every syscall not on the allowlist kills the process (`SECCOMP_RET_KILL_PROCESS`). Details:
  * The architecture must be `AUDIT_ARCH_X86_64`, so `int 0x80` i386 calls are killed. x32 syscall numbers (bit `0x40000000`) are killed too.
  * `clone` is allowed only without `CLONE_NEW*` flags.
  * `clone3` returns `ENOSYS`, so libc falls back to `clone`, which the filter can inspect.
  * Socket calls return `EACCES`. Python's `socket` import still works, and connecting fails cleanly.
  * The list is in `src/seccomp.c`.
* **Rlimits.** `RLIMIT_CORE=0`, `RLIMIT_FSIZE=--output`, `RLIMIT_STACK=--mem` (deep recursion is normal in CP), `RLIMIT_NOFILE=64`, and an `RLIMIT_CPU` backstop.

## Deviations from the architecture doc, and why

1. **The seccomp filter is raw classic BPF, not libseccomp.** The behaviour is the same: default kill, x86_64 only, an allowlist, and `ERRNO(EACCES)` for networking. It also drops the build dependency (`libseccomp-dev` wasn't even installable on the build host).
2. **OverlayFS is mounted by the supervisor, as real root, inside a mount namespace only runbox can see. It is not mounted from inside the user namespace.** The test kernel refuses userns overlay mounts on ext4 (`upper fs does not support tmpfile`). Keeping overlay out of the unprivileged path also closes the CVE-2023-0386 class of bugs the doc warns about. The sandbox inherits these mounts as locked and rbinds them before `pivot_root`, the same approach runc uses. If runbox is killed, the mounts disappear with its namespace and never reach the host.
3. **seccomp is loaded in the final process just before `execve`, not "before fork".** The property the doc wants is that untrusted code never runs unfiltered, and that holds: the code only exists after `execve`, which happens after the filter is locked. Every fork the program makes inherits the filter. The supervisor never opens `/proc/<pid>/mem`.
4. **`cpu.max` is not set.** It throttles rather than kills, so it can't produce a TLE. The CPU limit comes from polling `cpu.stat` every 5 ms, so a TLE can overshoot by about 5–10 ms. `RLIMIT_CPU` is the backstop.

## Test results

All runs were on the build host: Linux 6.18, x86_64, ext4, root. `tests/run_tests.py` passed **20/20**:

| test | verdict | notes |
|---|---|---|
| C sum with `\r\n` stdin | OK | output `5\n`, no CR seen by the program |
| `for(;;)` | TLE | killed at ~1006 ms CPU |
| `sleep(100)` | TLE | wall-clock limit, ~2 ms CPU |
| touch 1 GiB at 64M | MLE | cgroup OOM kill |
| null write | RE | SIGSEGV |
| `return 3` | RE | exit code 3 |
| `mount`, `ptrace` | SV | SIGSYS |
| `int 0x80`, x32 syscall | SV | arch pin works |
| `clone(CLONE_NEWUSER)` | SV | |
| `socket()` | OK | gets `EACCES`, not killed |
| fork bomb, `pids.max=16` | OK | capped below 16 tasks |
| 64 MiB stdout at `--output 1M` | OLE | |
| isolation probe | OK | uid 65534, PID 2, 2 visible pids, hostname `runbox`, only `lo`, no `/.old_root`, host `/home` hidden, `/etc` not writable, `/box` and `/tmp` writable |
| file written by previous job | OK | gone (fresh upperdir) |
| Python sum / socket / 1 GiB | OK / OK / MLE | |
| leftovers | none | no job dirs, cgroups, mounts or processes |

The overhead is about 7–8 ms per run end to end. 16 jobs run concurrently finished in 43 ms total.

### Not verified here

* **The cgroup v2 path.** This host has memory/pids/cpu bound to v1 hierarchies, and they can't be moved without tearing down the host's own cgroups. All limit tests ran through the v1 fallback. The v2 code reads and writes the standard files (`memory.max`, `pids.max`, `cpu.stat`, `memory.events`, `memory.peak`, `cgroup.kill`) and runs by default on Ubuntu 22.04/24.04, but it should be run once on a real v2 host: `sudo python3 tests/run_tests.py --cgroup v2`. `memory.peak` needs kernel 5.19+, and `memory_kb` reports -1 without it.
* **Java and other JVM runtimes.** They need more syscalls (threads, `sched_*`, maybe `prctl`) and probably a bigger `--pids`. Only C and Python 3.12 were exercised.
* **Ubuntu 24.04 specifically.** runbox runs as root, so AppArmor's `apparmor_restrict_unprivileged_userns` shouldn't apply, but this wasn't tried.
* **ptrace fallback, egress proxy, MAC profile.** The doc mentions these as optional and they aren't built.

## Operational notes

* The rootfs must not contain secrets, because everything in it is readable by submissions. Build one rootfs per language image and keep it read-only.
* Compile submissions inside runbox too, with a larger `--time`, `--mem` and `--pids`, a rootfs that has the compiler, and `--output` on the compiler's stderr. Compilers are untrusted-input parsers as well.
* `execve` is allowed so that interpreters and wrapper scripts work. The jail, `pids.max` and the filter still apply to anything that gets exec'd.

## Web frontend

`web/` holds Code+, the React frontend that sends submissions to this sandbox. It has sign-in, the problem set, and a code workspace with live, test-by-test verdicts. Without a backend it runs in demo mode with a simulated judge. See [web/README.md](web/README.md).

```
cd web && npm install && npm run dev
```
