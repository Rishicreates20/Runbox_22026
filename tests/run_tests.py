#!/usr/bin/env python3
"""End-to-end verdict tests for runbox. Must run as root.

usage: run_tests.py [--runbox ./runbox] [--rootfs DIR] [--cgroup auto|v2|v1]
"""
import argparse, base64, json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument("--runbox", default=os.path.join(HERE, "..", "runbox"))
ap.add_argument("--rootfs", default="/var/lib/runbox/rootfs")
ap.add_argument("--cgroup", default="auto")
args = ap.parse_args()

build = os.path.join(HERE, "build")
os.makedirs(build, exist_ok=True)
progs = os.path.join(HERE, "progs")
for f in sorted(os.listdir(progs)):
    if f.endswith(".c"):
        out = os.path.join(build, f[:-2])
        subprocess.run(["cc", "-O2", "-o", out, os.path.join(progs, f)], check=True)

def b64(s):
    return base64.b64encode(s.encode()).decode()

def run(prog, *, py=False, stdin="", extra=(), time_ms=1000):
    src = os.path.join(progs, prog) if py else os.path.join(build, prog)
    dst = "/box/main.py" if py else "/box/prog"
    cmd = [args.runbox, "--rootfs", args.rootfs, "--cgroup", args.cgroup,
           "--time", str(time_ms), "--mem", "64M", "--pids", "16",
           "--file", f"{src}:{dst}", "--stdin-b64-str", b64(stdin), *extra, "--"]
    cmd += ["/usr/bin/python3", dst] if py else [dst]
    t = time.monotonic()
    p = subprocess.run(cmd, capture_output=True, text=True)
    host_ms = (time.monotonic() - t) * 1000
    try:
        r = json.loads(p.stdout)
    except json.JSONDecodeError:
        r = {"verdict": "BAD-JSON", "detail": p.stdout + p.stderr}
    r["stdout"] = base64.b64decode(r.get("stdout_b64", "")).decode(errors="replace")
    r["stderr"] = base64.b64decode(r.get("stderr_b64", "")).decode(errors="replace")
    r["host_ms"] = host_ms
    return r

results = []
def check(name, r, verdict, pred=None, why=""):
    ok = r["verdict"] == verdict and (pred is None or pred(r))
    results.append(ok)
    mark = "PASS" if ok else "FAIL"
    print(f"[{mark}] {name:<38} verdict={r['verdict']:<4} want={verdict:<4} "
          f"cpu={r.get('cpu_time_ms', 0):>8.1f}ms wall={r.get('wall_time_ms', 0):>5}ms "
          f"mem={r.get('memory_kb', -1):>7}KB total={r['host_ms']:.0f}ms "
          f"{r.get('detail', '')}")
    if not ok:
        print("       stdout:", r["stdout"][:300].replace("\n", "\\n"))
        print("       stderr:", r["stderr"][:300].replace("\n", "\\n"))
        if why: print("       expected:", why)

check("C sum, CRLF stdin normalised", run("sum", stdin="2 3\r\n"), "OK",
      lambda r: r["stdout"] == "5\n", "stdout '5\\n' and no CR seen")
check("CPU-bound infinite loop", run("cpu_loop"), "TLE",
      lambda r: 1000 <= r["cpu_time_ms"] < 1300)
check("sleep (wall clock, no CPU)", run("sleeper", extra=["--wall", "1500"]), "TLE",
      lambda r: "wall" in r["detail"])
check("allocate 1 GiB with 64M limit", run("mem_hog"), "MLE")
check("null pointer write", run("segv"), "RE", lambda r: r["signal"] == "SIGSEGV")
check("exit code 3", run("exit3"), "RE", lambda r: r["exit_code"] == 3)
check("mount(2) blocked", run("bad_syscall"), "SV", lambda r: r["signal"] == "SIGSYS")
check("ptrace(2) blocked", run("ptrace"), "SV")
check("32-bit int 0x80 syscall", run("int80"), "SV")
check("x32 ABI syscall", run("x32"), "SV")
check("clone(CLONE_NEWUSER)", run("userns"), "SV")
check("socket() -> EACCES, not a kill", run("net"), "OK",
      lambda r: r["stdout"].strip() == "EACCES")
check("fork bomb capped by pids.max=16", run("forkbomb"), "OK",
      lambda r: 0 < int(r["stdout"].strip() or 0) < 16)
check("64 MiB output with --output 1M", run("bigout", extra=["--output", "1M"]), "OLE")

exp = os.path.join(build, "exported.bin")
for n in ("exported.bin", "evil1", "evil2"):
    try: os.unlink(os.path.join(build, n))
    except FileNotFoundError: pass
r = run("export_ok", extra=["--export", f"/box/out.bin:{exp}"])
check("--export copies a produced file out", r, "OK",
      lambda r: r.get("exported") and open(exp).read() == "artifact\n")
r = run("export_symlink", extra=["--no-seccomp", "--export", f"/box/link:{build}/evil1",
                                 "--export", f"/box/d/x/passwd:{build}/evil2"])
check("--export refuses symlinks (seccomp off)", r, "OK",
      lambda r: not r.get("exported") and not os.path.exists(f"{build}/evil1")
      and not os.path.exists(f"{build}/evil2"))

r = run("probe")
facts = dict(l.split("=", 1) for l in r["stdout"].splitlines() if "=" in l)
want = {"uid": "65534", "pid": "2", "hostname": "runbox", "net_ifaces": "1",
        "old_root": "absent", "host_home": "hidden", "runbox_bin": "hidden",
        "write_etc": "denied", "write_tmp": "ok", "write_box": "ok"}
bad = {k: (facts.get(k), v) for k, v in want.items() if facts.get(k) != v}
if int(facts.get("visible_pids", 99)) > 2:
    bad["visible_pids"] = (facts.get("visible_pids"), "<=2")
check("isolation probe", r, "OK", lambda r: not bad, f"mismatches: {bad}")
check("overlay upperdir discarded between jobs", run("persist_check"), "OK",
      lambda r: r["stdout"].strip() == "clean")

check("Python sum, CRLF stdin", run("sum.py", py=True, stdin="40 2\r\n"), "OK",
      lambda r: r["stdout"] == "42\n")
check("Python socket() -> PermissionError", run("py_net.py", py=True), "OK",
      lambda r: r["stdout"].strip() == "EACCES")
check("Python 1 GiB bytes with 64M limit", run("py_mle.py", py=True), "MLE")

leftover = os.listdir("/tmp/runbox") if os.path.isdir("/tmp/runbox") else []
results.append(not leftover)
print(f"[{'PASS' if not leftover else 'FAIL'}] no job directories left behind ({leftover})")

print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
