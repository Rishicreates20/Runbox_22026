/*
 * runbox - Linux-native sandbox for untrusted submissions.
 *
 * Process layout:
 *
 *   runbox (host, root)                 supervisor: cgroup, uid/gid maps,
 *     |                                 CPU-time polling, verdict, cleanup
 *     +-- init  (PID 1 in new user/mnt/pid/net/ipc/uts namespaces)
 *           |   rprivate, OverlayFS, pivot_root, umount -l old root, /proc
 *           +-- prog  (PID 2)           drop to nobody, rlimits,
 *                                       NO_NEW_PRIVS, seccomp, execve()
 *
 * The verdict is printed as one JSON object on stdout.
 */
#define _GNU_SOURCE
#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <ftw.h>
#include <getopt.h>
#include <grp.h>
#include <limits.h>
#include <poll.h>
#include <sched.h>
#include <signal.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/mount.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
#include <linux/openat2.h>
#include "runbox.h"

/* Host ID range the sandbox's user namespace maps onto. In-sandbox root
 * (0) becomes host HOST_ID_BASE; the program runs as in-sandbox 65534,
 * i.e. host HOST_ID_BASE + 65534. Neither has any host privilege. */
#define HOST_ID_BASE 100000
#define ID_RANGE     65536
#define SANDBOX_UID  65534
#define SANDBOX_GID  65534

#define MAX_FILES 16
#define MAX_ARGS  64

struct opts {
    const char *rootfs;
    const char *workroot;
    const char *stdin_b64;     /* file path, "-" for runbox's stdin */
    const char *stdin_b64_str; /* inline base64 */
    const char *cg_mode;
    const char *cg_parent;
    const char *cwd;
    uint64_t time_ms;
    uint64_t wall_ms;
    uint64_t mem_bytes;
    uint64_t pids;
    uint64_t output_bytes;
    uint64_t stack_bytes;
    int no_seccomp;
    int keep;
    int nfiles;
    const char *file_src[MAX_FILES];
    const char *file_dst[MAX_FILES];
    int nexports;
    const char *export_src[MAX_FILES];
    const char *export_dst[MAX_FILES];
    char **argv;
    int argc;
};

static struct opts O = {
    .workroot = "/tmp/runbox",
    .cg_mode = "auto",
    .cwd = "/box",
    .time_ms = 1000,
    .mem_bytes = 256ULL << 20,
    .pids = 64,
    .output_bytes = 16ULL << 20,
};

/* ---- state shared between supervisor and init (pre-clone copies) ---- */
static char job_dir[PATH_MAX], upper_dir[PATH_MAX], work_dir[PATH_MAX],
            merged_dir[PATH_MAX];
static int go_pipe[2], status_pipe[2];
static int stdin_fd = -1, stdout_fd = -1, stderr_fd = -1;

/* Messages init -> supervisor over status_pipe. Fixed-size records. */
struct msg {
    char type;      /* 'R' ready-to-exec, 'S' exit status, 'E' setup error,
                       'X' exec error */
    int  value;     /* wait status or errno */
    char text[200];
};

static void die(const char *fmt, ...);

/* ------------------------------------------------------------------ */
/* small helpers                                                       */

static uint64_t now_ms(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint64_t)ts.tv_sec * 1000 + (uint64_t)ts.tv_nsec / 1000000;
}

static int write_all(int fd, const void *buf, size_t n)
{
    const char *p = buf;
    while (n) {
        ssize_t w = write(fd, p, n);
        if (w < 0) { if (errno == EINTR) continue; return -1; }
        p += w; n -= (size_t)w;
    }
    return 0;
}

static char *read_fd_all(int fd, size_t *len)
{
    size_t cap = 4096, n = 0;
    char *buf = malloc(cap);
    if (!buf) return NULL;
    for (;;) {
        if (n == cap) {
            cap *= 2;
            char *nb = realloc(buf, cap);
            if (!nb) { free(buf); return NULL; }
            buf = nb;
        }
        ssize_t r = read(fd, buf + n, cap - n);
        if (r < 0) { if (errno == EINTR) continue; free(buf); return NULL; }
        if (r == 0) break;
        n += (size_t)r;
    }
    *len = n;
    return buf;
}

static int write_proc(pid_t pid, const char *file, const char *data)
{
    char path[64];
    snprintf(path, sizeof path, "/proc/%d/%s", pid, file);
    int fd = open(path, O_WRONLY | O_CLOEXEC);
    if (fd < 0) return -1;
    int r = write_all(fd, data, strlen(data));
    close(fd);
    return r;
}

static void send_msg(int fd, char type, int value, const char *fmt, ...)
{
    struct msg m = { .type = type, .value = value };
    if (fmt) {
        va_list ap;
        va_start(ap, fmt);
        vsnprintf(m.text, sizeof m.text, fmt, ap);
        va_end(ap);
    }
    write_all(fd, &m, sizeof m);
}

static int rm_cb(const char *p, const struct stat *sb, int flag, struct FTW *ftw)
{
    (void)sb; (void)flag; (void)ftw;
    remove(p);
    return 0;
}

static void rm_rf(const char *p)
{
    nftw(p, rm_cb, 32, FTW_DEPTH | FTW_PHYS | FTW_MOUNT);
}

/* Drop the overlay (the upperdir holds every write the program made) and
 * the job directory. Mounts live only in our private namespace, so they
 * also disappear if runbox itself is killed. */
static void cleanup_job_dir(void)
{
    if (!job_dir[0] || O.keep) return;
    char p[PATH_MAX + 16];
    snprintf(p, sizeof p, "%s/tmp", merged_dir);  umount2(p, MNT_DETACH);
    snprintf(p, sizeof p, "%s/dev", merged_dir);  umount2(p, MNT_DETACH);
    umount2(merged_dir, MNT_DETACH);
    rm_rf(job_dir);
}

static uint64_t parse_size(const char *s)
{
    char *end;
    double v = strtod(s, &end);
    switch (toupper((unsigned char)*end)) {
    case 'K': v *= 1024; break;
    case 'M': v *= 1024 * 1024; break;
    case 'G': v *= 1024.0 * 1024 * 1024; break;
    case 0: break;
    default: die("bad size: %s", s);
    }
    return (uint64_t)v;
}

/* ------------------------------------------------------------------ */
/* JSON output                                                         */

static void json_str(FILE *f, const char *s)
{
    fputc('"', f);
    for (; *s; s++) {
        unsigned char c = (unsigned char)*s;
        if (c == '"' || c == '\\') fprintf(f, "\\%c", c);
        else if (c == '\n') fputs("\\n", f);
        else if (c < 0x20) fprintf(f, "\\u%04x", c);
        else fputc(c, f);
    }
    fputc('"', f);
}

static void die(const char *fmt, ...)
{
    char buf[512];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(buf, sizeof buf, fmt, ap);
    va_end(ap);
    printf("{\"verdict\":\"IE\",\"detail\":");
    json_str(stdout, buf);
    printf("}\n");
    fflush(stdout);
    cleanup_job_dir();
    exit(2);
}

/* ------------------------------------------------------------------ */
/* init: PID 1 inside the namespaces                                   */

static int bind_dev(const char *name)
{
    char src[64], dst[PATH_MAX];
    snprintf(src, sizeof src, "/dev/%s", name);
    snprintf(dst, sizeof dst, "%s/dev/%s", merged_dir, name);
    int fd = open(dst, O_CREAT | O_WRONLY | O_CLOEXEC, 0666);
    if (fd < 0) return -1;
    close(fd);
    return mount(src, dst, NULL, MS_BIND, NULL);
}

/* Runs in the supervisor, as real root, inside a private mount namespace
 * that only the supervisor and the sandbox see. Mounting OverlayFS here
 * (instead of from inside the user namespace) keeps the unprivileged
 * overlay code path, the CVE-2023-0386 class of bugs, out of reach of
 * sandboxed code; the sandbox inherits these mounts as locked mounts. */
static void mount_rootfs(void)
{
    char p[PATH_MAX + 64], opts[3 * PATH_MAX + 64];

    if (unshare(CLONE_NEWNS) < 0) die("unshare(CLONE_NEWNS): %s", strerror(errno));
    /* mount --make-rprivate / : nothing propagates to or from the host. */
    if (mount(NULL, "/", NULL, MS_REC | MS_PRIVATE, NULL) < 0)
        die("make-rprivate /: %s", strerror(errno));

    /* Copy-on-write root: read-only lowerdir + per-job upperdir. */
    snprintf(opts, sizeof opts, "lowerdir=%s,upperdir=%s,workdir=%s",
             O.rootfs, upper_dir, work_dir);
    if (mount("overlay", merged_dir, "overlay", MS_NOSUID | MS_NODEV, opts) < 0)
        die("mount overlay (%s): %s", opts, strerror(errno));

    /* Minimal /dev. */
    snprintf(p, sizeof p, "%s/dev", merged_dir);
    mkdir(p, 0755);
    if (mount("tmpfs", p, "tmpfs", MS_NOSUID | MS_NOEXEC, "mode=0755,size=64k") < 0)
        die("mount /dev tmpfs: %s", strerror(errno));
    const char *devs[] = { "null", "zero", "urandom", "random", NULL };
    for (int i = 0; devs[i]; i++)
        if (bind_dev(devs[i]) < 0) die("bind /dev/%s: %s", devs[i], strerror(errno));
    snprintf(p, sizeof p, "%s/dev/fd", merged_dir);     symlink("/proc/self/fd", p);
    snprintf(p, sizeof p, "%s/dev/stdin", merged_dir);  symlink("/proc/self/fd/0", p);
    snprintf(p, sizeof p, "%s/dev/stdout", merged_dir); symlink("/proc/self/fd/1", p);
    snprintf(p, sizeof p, "%s/dev/stderr", merged_dir); symlink("/proc/self/fd/2", p);

    /* Private, size-capped /tmp. */
    snprintf(p, sizeof p, "%s/tmp", merged_dir);
    mkdir(p, 01777);
    if (mount("tmpfs", p, "tmpfs", MS_NOSUID | MS_NODEV, "mode=1777,size=64m") < 0)
        die("mount /tmp tmpfs: %s", strerror(errno));

    snprintf(p, sizeof p, "%s/proc", merged_dir);
    mkdir(p, 0555);
    snprintf(p, sizeof p, "%s/.old_root", merged_dir);
    mkdir(p, 0700);
}

/* Runs as PID 1 inside the new namespaces. */
static int setup_fs(int sfd)
{
#define FAIL(...) do { send_msg(sfd, 'E', errno, __VA_ARGS__); return -1; } while (0)
    char p[PATH_MAX + 64];

    /* The new mount namespace is a copy; re-assert private propagation. */
    if (mount(NULL, "/", NULL, MS_REC | MS_PRIVATE, NULL) < 0)
        FAIL("make-rprivate /: %s", strerror(errno));

    /* Mounts inherited from the supervisor's namespace are MNT_LOCKED in
     * ours and pivot_root refuses a locked new root, so rbind the rootfs
     * onto itself to get a mount owned by this namespace. */
    if (mount(merged_dir, merged_dir, NULL, MS_BIND | MS_REC, NULL) < 0)
        FAIL("rbind rootfs: %s", strerror(errno));

    /* pivot_root into the overlay, then detach the host root entirely. */
    snprintf(p, sizeof p, "%s/.old_root", merged_dir);
    if (syscall(SYS_pivot_root, merged_dir, p) < 0)
        FAIL("pivot_root: %s", strerror(errno));
    if (chdir("/") < 0) FAIL("chdir /: %s", strerror(errno));

    /* /proc for the new PID namespace: shows only sandbox processes.
     * Mounted while the old root is still attached, because the kernel
     * only allows a fresh procfs in a user namespace if a fully visible
     * procfs exists in this mount namespace. */
    if (mount("proc", "/proc", "proc", MS_NOSUID | MS_NODEV | MS_NOEXEC, NULL) < 0)
        FAIL("mount /proc: %s", strerror(errno));

    /* umount -l /old_root */
    if (umount2("/.old_root", MNT_DETACH) < 0)
        FAIL("umount -l old root: %s", strerror(errno));
    rmdir("/.old_root");
    return 0;
#undef FAIL
}

static void exec_prog(int sfd)
{
    /* stdio */
    if (dup2(stdin_fd, 0) < 0 || dup2(stdout_fd, 1) < 0 || dup2(stderr_fd, 2) < 0) {
        send_msg(sfd, 'X', errno, "dup2: %s", strerror(errno));
        _exit(127);
    }
    /* close everything except stdio and the CLOEXEC status pipe */
    if (sfd > 3) syscall(SYS_close_range, 3, sfd - 1, 0);
    syscall(SYS_close_range, sfd + 1, ~0U, 0);
    fcntl(sfd, F_SETFD, FD_CLOEXEC);

    if (chdir(O.cwd) < 0) {
        send_msg(sfd, 'X', errno, "chdir %s: %s", O.cwd, strerror(errno));
        _exit(127);
    }

    /* Drop to nobody inside the user namespace. */
    if (setgroups(0, NULL) < 0 || setresgid(SANDBOX_GID, SANDBOX_GID, SANDBOX_GID) < 0 ||
        setresuid(SANDBOX_UID, SANDBOX_UID, SANDBOX_UID) < 0) {
        send_msg(sfd, 'X', errno, "drop privileges: %s", strerror(errno));
        _exit(127);
    }

    struct rlimit rl;
    rl.rlim_cur = rl.rlim_max = 0;
    setrlimit(RLIMIT_CORE, &rl);
    rl.rlim_cur = rl.rlim_max = O.output_bytes;
    setrlimit(RLIMIT_FSIZE, &rl);
    rl.rlim_cur = rl.rlim_max = O.stack_bytes ? O.stack_bytes : O.mem_bytes;
    setrlimit(RLIMIT_STACK, &rl);
    rl.rlim_cur = rl.rlim_max = 64;
    setrlimit(RLIMIT_NOFILE, &rl);
    /* Backstop only; the supervisor enforces the real CPU limit. */
    rl.rlim_cur = O.time_ms / 1000 + 2;
    rl.rlim_max = rl.rlim_cur + 1;
    setrlimit(RLIMIT_CPU, &rl);

    signal(SIGPIPE, SIG_DFL);
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) < 0) {
        send_msg(sfd, 'X', errno, "no_new_privs: %s", strerror(errno));
        _exit(127);
    }
    if (!O.no_seccomp) {
        int r = seccomp_install();
        if (r < 0) {
            send_msg(sfd, 'X', -r, "seccomp: %s", strerror(-r));
            _exit(127);
        }
    }
    char *envp[] = { "PATH=/usr/local/bin:/usr/bin:/bin", "HOME=/tmp",
                     "LANG=C.UTF-8", "PYTHONDONTWRITEBYTECODE=1", NULL };
    execve(O.argv[0], O.argv, envp);
    /* write() and exit_group() are allowed by the filter. */
    send_msg(sfd, 'X', errno, "execve %s: %s", O.argv[0], strerror(errno));
    _exit(127);
}

static int init_main(void *arg)
{
    (void)arg;
    int sfd = status_pipe[1];
    close(go_pipe[1]);
    close(status_pipe[0]);

    /* Die with the supervisor. */
    prctl(PR_SET_PDEATHSIG, SIGKILL);

    char c;
    if (read(go_pipe[0], &c, 1) != 1) _exit(1); /* maps + cgroup not ready */
    close(go_pipe[0]);

    if (setup_fs(sfd) < 0) _exit(1);
    sethostname("runbox", 6);
    setdomainname("runbox", 6);

    send_msg(sfd, 'R', 0, NULL);
    pid_t pid = fork();
    if (pid < 0) {
        send_msg(sfd, 'E', errno, "fork: %s", strerror(errno));
        _exit(1);
    }
    if (pid == 0) exec_prog(sfd);

    close(stdin_fd); close(stdout_fd); close(stderr_fd);
    /* Reap everything; report the program's own status. */
    int status = 0;
    for (;;) {
        int st;
        pid_t w = wait(&st);
        if (w < 0) { if (errno == EINTR) continue; break; }
        if (w == pid) { status = st; break; }
    }
    send_msg(sfd, 'S', status, NULL);
    _exit(0);
}

/* ------------------------------------------------------------------ */
/* supervisor                                                          */

static void usage(void)
{
    fprintf(stderr,
"usage: runbox --rootfs DIR [options] -- PROGRAM [ARGS...]\n"
"\n"
"  --rootfs DIR         read-only lowerdir with the language runtimes\n"
"  --stdin-b64 FILE     base64 stdin ('-' = read from runbox's stdin)\n"
"  --stdin-b64-str STR  base64 stdin given inline\n"
"  --file SRC:DST       copy host file SRC to DST inside the sandbox (repeatable)\n"
"  --export SRC:DST     after a clean exit, copy sandbox file SRC (under /box)\n"
"                       to host path DST (repeatable; regular files only)\n"
"  --time MS            CPU time limit, ms (default 1000)\n"
"  --wall MS            wall-clock limit, ms (default 3*time+1000)\n"
"  --mem SIZE           memory limit, e.g. 256M (default 256M)\n"
"  --pids N             max tasks (default 64)\n"
"  --output SIZE        max bytes per output stream (default 16M)\n"
"  --stack SIZE         stack limit (default = --mem)\n"
"  --cwd DIR            working directory inside the sandbox (default /box)\n"
"  --cgroup auto|v2|v1  cgroup mode (default auto: v2, else v1)\n"
"  --cgroup-parent DIR  v2 cgroup to create job cgroups under\n"
"  --workroot DIR       where per-job overlay dirs live (default /tmp/runbox)\n"
"  --no-seccomp         disable the syscall filter (debug only)\n"
"  --keep               keep the job directory (debug only)\n");
    exit(2);
}

static void parse_args(int argc, char **argv)
{
    static struct option lo[] = {
        { "rootfs", 1, 0, 'r' }, { "stdin-b64", 1, 0, 'i' },
        { "stdin-b64-str", 1, 0, 'I' }, { "file", 1, 0, 'f' },
        { "export", 1, 0, 'x' },
        { "time", 1, 0, 't' }, { "wall", 1, 0, 'w' }, { "mem", 1, 0, 'm' },
        { "pids", 1, 0, 'p' }, { "output", 1, 0, 'o' }, { "stack", 1, 0, 's' },
        { "cwd", 1, 0, 'c' }, { "cgroup", 1, 0, 'g' },
        { "cgroup-parent", 1, 0, 'G' }, { "workroot", 1, 0, 'W' },
        { "no-seccomp", 0, 0, 'N' }, { "keep", 0, 0, 'k' },
        { "help", 0, 0, 'h' }, { 0 }
    };
    int c;
    while ((c = getopt_long(argc, argv, "+", lo, NULL)) != -1) {
        switch (c) {
        case 'r': O.rootfs = optarg; break;
        case 'i': O.stdin_b64 = optarg; break;
        case 'I': O.stdin_b64_str = optarg; break;
        case 'f': {
            char *colon = strchr(optarg, ':');
            if (!colon || O.nfiles >= MAX_FILES) usage();
            *colon = 0;
            O.file_src[O.nfiles] = optarg;
            O.file_dst[O.nfiles++] = colon + 1;
            break;
        }
        case 'x': {
            char *colon = strchr(optarg, ':');
            if (!colon || O.nexports >= MAX_FILES) usage();
            *colon = 0;
            O.export_src[O.nexports] = optarg;
            O.export_dst[O.nexports++] = colon + 1;
            break;
        }
        case 't': O.time_ms = strtoull(optarg, NULL, 10); break;
        case 'w': O.wall_ms = strtoull(optarg, NULL, 10); break;
        case 'm': O.mem_bytes = parse_size(optarg); break;
        case 'p': O.pids = strtoull(optarg, NULL, 10); break;
        case 'o': O.output_bytes = parse_size(optarg); break;
        case 's': O.stack_bytes = parse_size(optarg); break;
        case 'c': O.cwd = optarg; break;
        case 'g': O.cg_mode = optarg; break;
        case 'G': O.cg_parent = optarg; break;
        case 'W': O.workroot = optarg; break;
        case 'N': O.no_seccomp = 1; break;
        case 'k': O.keep = 1; break;
        default: usage();
        }
    }
    if (!O.rootfs || optind >= argc) usage();
    O.argc = argc - optind;
    O.argv = argv + optind;
    if (!O.wall_ms) O.wall_ms = O.time_ms * 3 + 1000;
}

/* Builds the normalised stdin as an unlinked memfd. */
static int make_stdin(void)
{
    int fd = memfd_create("runbox-stdin", MFD_CLOEXEC);
    if (fd < 0) die("memfd_create: %s", strerror(errno));
    char *b64 = NULL;
    size_t blen = 0;
    if (O.stdin_b64_str) {
        b64 = strdup(O.stdin_b64_str);
        blen = strlen(b64);
    } else if (O.stdin_b64) {
        int in = strcmp(O.stdin_b64, "-") == 0 ? 0 : open(O.stdin_b64, O_RDONLY | O_CLOEXEC);
        if (in < 0) die("open %s: %s", O.stdin_b64, strerror(errno));
        b64 = read_fd_all(in, &blen);
        if (in) close(in);
    }
    if (b64) {
        size_t n;
        unsigned char *raw = b64_decode(b64, blen, &n);
        free(b64);
        if (!raw) die("stdin is not valid base64");
        n = normalize_newlines(raw, n);
        if (write_all(fd, raw, n) < 0) die("write stdin: %s", strerror(errno));
        free(raw);
    }
    lseek(fd, 0, SEEK_SET);
    return fd;
}

static int make_out(const char *name)
{
    char path[PATH_MAX];
    snprintf(path, sizeof path, "%s/%s", job_dir, name);
    int fd = open(path, O_RDWR | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
    if (fd < 0) die("create %s: %s", path, strerror(errno));
    unlink(path);
    return fd;
}

static void copy_in(const char *src, const char *dst)
{
    if (dst[0] != '/' || strstr(dst, "..")) die("--file destination must be absolute: %s", dst);
    char path[PATH_MAX];
    snprintf(path, sizeof path, "%s%s", upper_dir, dst);
    /* create parent directories in the upperdir */
    for (char *s = path + strlen(upper_dir) + 1; (s = strchr(s, '/')); s++) {
        *s = 0;
        if (mkdir(path, 0755) == 0)
            chown(path, HOST_ID_BASE + SANDBOX_UID, HOST_ID_BASE + SANDBOX_GID);
        *s = '/';
    }
    int in = open(src, O_RDONLY | O_CLOEXEC);
    if (in < 0) die("open %s: %s", src, strerror(errno));
    struct stat st;
    fstat(in, &st);
    int out = open(path, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, st.st_mode & 0755);
    if (out < 0) die("create %s: %s", path, strerror(errno));
    char buf[65536];
    ssize_t r;
    while ((r = read(in, buf, sizeof buf)) > 0)
        if (write_all(out, buf, (size_t)r) < 0) die("copy %s: %s", src, strerror(errno));
    fchown(out, HOST_ID_BASE + SANDBOX_UID, HOST_ID_BASE + SANDBOX_GID);
    close(in);
    close(out);
}

/* Copy a file the program produced (e.g. a compiled binary) out of the
 * per-job upperdir. The upperdir is attacker-controlled, so resolution is
 * done with openat2(RESOLVE_BENEATH|RESOLVE_NO_SYMLINKS|RESOLVE_NO_XDEV)
 * from the upperdir: no symlink, ".." or mount crossing can point the copy
 * at a host file. Only regular files, capped at --output bytes. */
static int copy_out(const char *src, const char *dst, char *err, size_t errlen)
{
    if (src[0] != '/' || strstr(src, "..")) {
        snprintf(err, errlen, "export source must be absolute: %s", src);
        return -1;
    }
    int root = open(upper_dir, O_PATH | O_DIRECTORY | O_CLOEXEC);
    if (root < 0) { snprintf(err, errlen, "open upperdir: %s", strerror(errno)); return -1; }
    struct open_how how = {
        .flags = O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK,
        .resolve = RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_XDEV |
                   RESOLVE_NO_MAGICLINKS,
    };
    int in = (int)syscall(SYS_openat2, root, src + 1, &how, sizeof how);
    close(root);
    if (in < 0) { snprintf(err, errlen, "export %s: %s", src, strerror(errno)); return -1; }
    struct stat st;
    if (fstat(in, &st) < 0 || !S_ISREG(st.st_mode) || (uint64_t)st.st_size > O.output_bytes) {
        snprintf(err, errlen, "export %s: not a regular file or too large", src);
        close(in);
        return -1;
    }
    int out = open(dst, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC | O_NOFOLLOW, 0755);
    if (out < 0) { snprintf(err, errlen, "create %s: %s", dst, strerror(errno)); close(in); return -1; }
    char buf[65536];
    ssize_t r;
    int rc = 0;
    while ((r = read(in, buf, sizeof buf)) > 0)
        if (write_all(out, buf, (size_t)r) < 0) { rc = -1; break; }
    if (r < 0) rc = -1;
    if (rc) snprintf(err, errlen, "export %s: %s", src, strerror(errno));
    fchmod(out, 0755);
    close(in);
    close(out);
    return rc;
}

static void prepare_job_dir(void)
{
    mkdir(O.workroot, 0711);
    snprintf(job_dir, sizeof job_dir, "%s/job-XXXXXX", O.workroot);
    if (!mkdtemp(job_dir)) die("mkdtemp in %s: %s", O.workroot, strerror(errno));
    chmod(job_dir, 0711);
    snprintf(upper_dir, sizeof upper_dir, "%s/upper", job_dir);
    snprintf(work_dir, sizeof work_dir, "%s/work", job_dir);
    snprintf(merged_dir, sizeof merged_dir, "%s/merged", job_dir);
    /* Owned by sandbox root so the overlay can be mounted from inside the
     * user namespace. */
    const char *dirs[] = { upper_dir, work_dir, merged_dir };
    for (int i = 0; i < 3; i++) {
        if (mkdir(dirs[i], 0755) < 0) die("mkdir %s: %s", dirs[i], strerror(errno));
        chown(dirs[i], HOST_ID_BASE, HOST_ID_BASE);
    }
    /* /box: the program's writable working directory, owned by nobody. */
    char box[PATH_MAX + 8];
    snprintf(box, sizeof box, "%s/box", upper_dir);
    mkdir(box, 0755);
    chown(box, HOST_ID_BASE + SANDBOX_UID, HOST_ID_BASE + SANDBOX_GID);
}

static char *read_output(int fd, size_t limit, size_t *len, int *truncated)
{
    off_t size = lseek(fd, 0, SEEK_END);
    if (size < 0) size = 0;
    *truncated = (size_t)size > limit;
    size_t n = *truncated ? limit : (size_t)size;
    char *buf = malloc(n + 1);
    if (!buf) die("oom");
    ssize_t r = pread(fd, buf, n, 0);
    *len = r > 0 ? (size_t)r : 0;
    return buf;
}

static const char *signame(int sig)
{
    static char buf[16];
    const char *s = sigabbrev_np(sig);
    if (s) { snprintf(buf, sizeof buf, "SIG%s", s); return buf; }
    snprintf(buf, sizeof buf, "%d", sig);
    return buf;
}

int main(int argc, char **argv)
{
    parse_args(argc, argv);
    if (geteuid() != 0) die("runbox must run as root (it creates namespaces and cgroups)");

    struct stat st;
    if (stat(O.rootfs, &st) < 0 || !S_ISDIR(st.st_mode))
        die("rootfs %s is not a directory", O.rootfs);

    prepare_job_dir();
    for (int i = 0; i < O.nfiles; i++) copy_in(O.file_src[i], O.file_dst[i]);
    mount_rootfs();

    stdin_fd = make_stdin();
    stdout_fd = make_out("stdout");
    stderr_fd = make_out("stderr");

    struct cgroup cg;
    struct cg_limits lim = { .memory_bytes = O.mem_bytes, .pids = O.pids };
    char err[512];
    const char *job = strrchr(job_dir, '/') + 1;
    if (cg_create(&cg, O.cg_mode, O.cg_parent, job, &lim, err, sizeof err) < 0)
        die("%s", err);

    if (pipe2(go_pipe, O_CLOEXEC) < 0 || pipe2(status_pipe, O_CLOEXEC) < 0)
        die("pipe: %s", strerror(errno));

    /* The init process needs only a small stack. */
    size_t stack_sz = 1 << 20;
    char *stack = mmap(NULL, stack_sz, PROT_READ | PROT_WRITE,
                       MAP_PRIVATE | MAP_ANONYMOUS | MAP_STACK, -1, 0);
    if (stack == MAP_FAILED) die("mmap: %s", strerror(errno));

    int flags = CLONE_NEWUSER | CLONE_NEWNS | CLONE_NEWPID | CLONE_NEWNET |
                CLONE_NEWIPC | CLONE_NEWUTS | CLONE_NEWCGROUP | SIGCHLD;
    uint64_t t_start = now_ms();
    pid_t init = clone(init_main, stack + stack_sz, flags, NULL);
    if (init < 0) {
        int e = errno;
        cg_destroy(&cg);
        die("clone(namespaces): %s", strerror(e));
    }
    close(go_pipe[0]);
    close(status_pipe[1]);

    /* uid/gid maps: sandbox 0..65535 -> host 100000..165535. */
    char map[64];
    snprintf(map, sizeof map, "0 %d %d\n", HOST_ID_BASE, ID_RANGE);
    if (write_proc(init, "uid_map", map) < 0 || write_proc(init, "gid_map", map) < 0) {
        int e = errno;
        kill(init, SIGKILL); waitpid(init, NULL, 0); cg_destroy(&cg);
        die("write uid/gid map: %s", strerror(e));
    }
    int r = cg_add_pid(&cg, init);
    if (r < 0) {
        kill(init, SIGKILL); waitpid(init, NULL, 0); cg_destroy(&cg);
        die("add to cgroup: %s", strerror(-r));
    }
    if (write(go_pipe[1], "g", 1) != 1) die("sync: %s", strerror(errno));
    close(go_pipe[1]);

    /* ---- monitor ---- */
    int64_t cpu_base = 0, cpu_used = 0;
    int got_status = 0, wstatus = 0, killed_tle = 0, tle_wall = 0;
    int setup_err = 0, exec_err = 0;
    char err_text[256] = "";
    uint64_t t_exec = 0;
    int init_done = 0, init_status = 0;
    int pipe_open = 1;
    uint64_t limit_us = O.time_ms * 1000;

    while (!init_done || pipe_open) {
        struct pollfd pfd = { .fd = status_pipe[0], .events = POLLIN };
        int pr = pipe_open ? poll(&pfd, 1, 5) : (usleep(5000), 0);
        if (pr > 0) {
            struct msg m;
            ssize_t n = read(status_pipe[0], &m, sizeof m);
            if (n == (ssize_t)sizeof m) {
                switch (m.type) {
                case 'R':
                    cpu_base = cg_cpu_usec(&cg);
                    if (cpu_base < 0) cpu_base = 0;
                    t_exec = now_ms();
                    break;
                case 'S': got_status = 1; wstatus = m.value; break;
                case 'E': setup_err = 1; snprintf(err_text, sizeof err_text, "%s", m.text); break;
                case 'X': exec_err = 1; snprintf(err_text, sizeof err_text, "%s", m.text); break;
                }
            } else if (n <= 0) {
                pipe_open = 0;
            }
        }
        if (!init_done) {
            int st;
            pid_t w = waitpid(init, &st, WNOHANG);
            if (w == init) { init_done = 1; init_status = st; }
        }
        if (t_exec && !killed_tle && !init_done) {
            int64_t u = cg_cpu_usec(&cg);
            if (u >= 0) cpu_used = u - cpu_base;
            int over_cpu = cpu_used > (int64_t)limit_us;
            int over_wall = now_ms() - t_exec > O.wall_ms;
            if (over_cpu || over_wall) {
                killed_tle = 1;
                tle_wall = !over_cpu;
                kill(init, SIGKILL);  /* PID 1 dies -> whole PID ns dies */
                cg_kill(&cg);
            }
        }
        if (!t_exec && !init_done && now_ms() - t_start > 10000) {
            setup_err = 1;
            snprintf(err_text, sizeof err_text, "sandbox setup timed out");
            kill(init, SIGKILL);
        }
    }
    uint64_t wall = t_exec ? now_ms() - t_exec : 0;
    {
        int64_t u = cg_cpu_usec(&cg);
        if (u >= 0 && t_exec) cpu_used = u - cpu_base;
    }
    int64_t mem_peak = cg_mem_peak(&cg);
    int64_t oom = cg_oom_kills(&cg);
    int64_t mem_hits = cg_mem_limit_hits(&cg);
    enum cg_mode cg_used = cg.mode;
    cg_destroy(&cg);

    /* ---- verdict ---- */
    const char *verdict;
    char detail[300] = "";
    int exit_code = -1, sig = 0;
    if (got_status) {
        if (WIFEXITED(wstatus)) exit_code = WEXITSTATUS(wstatus);
        if (WIFSIGNALED(wstatus)) sig = WTERMSIG(wstatus);
    }

    if (setup_err) {
        verdict = "IE";
        snprintf(detail, sizeof detail, "sandbox setup failed: %s", err_text);
    } else if (exec_err) {
        verdict = "IE";
        snprintf(detail, sizeof detail, "%s", err_text);
    } else if (killed_tle) {
        verdict = "TLE";
        snprintf(detail, sizeof detail, "%s limit exceeded",
                 tle_wall ? "wall-clock" : "CPU time");
    } else if (oom > 0) {
        verdict = "MLE";
        snprintf(detail, sizeof detail, "killed by cgroup OOM killer");
    } else if (!got_status) {
        verdict = "IE";
        snprintf(detail, sizeof detail, "sandbox init exited without status (0x%x)", init_status);
    } else if (sig == SIGSYS) {
        verdict = "SV";
        snprintf(detail, sizeof detail, "blocked system call (seccomp)");
    } else if (sig == SIGXCPU) {
        verdict = "TLE";
        snprintf(detail, sizeof detail, "CPU time limit exceeded (RLIMIT_CPU)");
    } else if (sig == SIGXFSZ) {
        verdict = "OLE";
        snprintf(detail, sizeof detail, "output limit exceeded");
    } else if (sig) {
        /* A crash while the memory limit was being hit (e.g. abort from
         * std::bad_alloc, or SIGSEGV on stack growth) is reported as MLE. */
        if (mem_hits > 0) {
            verdict = "MLE";
            snprintf(detail, sizeof detail, "%s after hitting memory limit", signame(sig));
        } else {
            verdict = "RE";
            snprintf(detail, sizeof detail, "killed by %s", signame(sig));
        }
    } else if (exit_code != 0) {
        if (mem_hits > 0) {
            verdict = "MLE";
            snprintf(detail, sizeof detail, "exit code %d after hitting memory limit", exit_code);
        } else {
            verdict = "RE";
            snprintf(detail, sizeof detail, "exit code %d", exit_code);
        }
    } else {
        verdict = "OK";
    }

    int exported = 0;
    if (!strcmp(verdict, "OK") && O.nexports > 0) {
        exported = 1;
        for (int i = 0; i < O.nexports && exported; i++)
            if (copy_out(O.export_src[i], O.export_dst[i], detail, sizeof detail) < 0)
                exported = 0;
    }

    size_t out_len, err_len;
    int out_trunc, err_trunc;
    char *out = read_output(stdout_fd, O.output_bytes, &out_len, &out_trunc);
    char *errb = read_output(stderr_fd, 64 * 1024, &err_len, &err_trunc);
    char *out64 = b64_encode((unsigned char *)out, out_len);
    char *err64 = b64_encode((unsigned char *)errb, err_len);

    printf("{\"verdict\":\"%s\",\"detail\":", verdict);
    json_str(stdout, detail);
    printf(",\"exit_code\":%d,\"signal\":", exit_code);
    if (sig) json_str(stdout, signame(sig)); else printf("null");
    printf(",\"cpu_time_ms\":%.3f,\"wall_time_ms\":%llu,\"memory_kb\":%lld,"
           "\"cgroup\":\"%s\",\"stdout_b64\":\"%s\",\"stdout_truncated\":%s,"
           "\"stderr_b64\":\"%s\",\"exported\":%s}\n",
           cpu_used / 1000.0, (unsigned long long)wall,
           mem_peak >= 0 ? (long long)(mem_peak / 1024) : -1LL,
           cg_mode_name(cg_used),
           out64, out_trunc ? "true" : "false", err64,
           exported ? "true" : "false");
    fflush(stdout);

    cleanup_job_dir();
    return 0;
}
