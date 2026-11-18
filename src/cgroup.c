/*
 * cgroup handling. cgroups v2 is the primary path (memory.max, pids.max,
 * cpu.stat usage_usec, memory.events, cgroup.kill). A v1 fallback exists
 * for hosts where the memory/pids/cpu controllers are still bound to v1
 * hierarchies; it exposes the same measurements.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>
#include "runbox.h"

const char *cg_mode_name(enum cg_mode m)
{
    return m == CG_V2 ? "v2" : m == CG_V1 ? "v1" : "none";
}

static int write_file(const char *dir, const char *file, const char *fmt, ...)
{
    char path[768], buf[256];
    snprintf(path, sizeof path, "%s/%s", dir, file);
    va_list ap;
    va_start(ap, fmt);
    int n = vsnprintf(buf, sizeof buf, fmt, ap);
    va_end(ap);
    int fd = open(path, O_WRONLY | O_CLOEXEC);
    if (fd < 0) return -errno;
    ssize_t w = write(fd, buf, (size_t)n);
    int e = errno;
    close(fd);
    return w == n ? 0 : -e;
}

static ssize_t read_file(const char *dir, const char *file, char *buf, size_t len)
{
    char path[768];
    snprintf(path, sizeof path, "%s/%s", dir, file);
    int fd = open(path, O_RDONLY | O_CLOEXEC);
    if (fd < 0) return -1;
    ssize_t r = read(fd, buf, len - 1);
    close(fd);
    if (r < 0) return -1;
    buf[r] = 0;
    return r;
}

/* Reads "key value" from a flat-keyed file (cpu.stat, memory.events...). */
static int64_t read_key(const char *dir, const char *file, const char *key)
{
    char buf[4096];
    if (read_file(dir, file, buf, sizeof buf) < 0) return -1;
    size_t kl = strlen(key);
    for (char *line = buf; line && *line; ) {
        char *nl = strchr(line, '\n');
        if (strncmp(line, key, kl) == 0 && line[kl] == ' ')
            return strtoll(line + kl + 1, NULL, 10);
        line = nl ? nl + 1 : NULL;
    }
    return -1;
}

static int64_t read_int(const char *dir, const char *file)
{
    char buf[64];
    if (read_file(dir, file, buf, sizeof buf) < 0) return -1;
    return strtoll(buf, NULL, 10);
}

/* Find a mountpoint in /proc/self/mountinfo by fstype and (for v1) a
 * controller name in the super options. */
static int find_mount(const char *fstype, const char *opt, char *out, size_t outlen)
{
    FILE *f = fopen("/proc/self/mountinfo", "re");
    if (!f) return -1;
    char line[2048];
    int found = -1;
    while (fgets(line, sizeof line, f)) {
        char *sep = strstr(line, " - ");
        if (!sep) continue;
        char mnt[1024], fs[64], src[256], sopts[1024] = "";
        if (sscanf(line, "%*s %*s %*s %*s %1023s", mnt) != 1) continue;
        if (sscanf(sep + 3, "%63s %255s %1023s", fs, src, sopts) < 2) continue;
        if (strcmp(fs, fstype) != 0) continue;
        if (opt) {
            /* match whole comma-separated token */
            int ok = 0;
            char *save, *tok = strtok_r(sopts, ",", &save);
            for (; tok; tok = strtok_r(NULL, ",", &save))
                if (strcmp(tok, opt) == 0) { ok = 1; break; }
            if (!ok) continue;
        }
        snprintf(out, outlen, "%s", mnt);
        found = 0;
        break;
    }
    fclose(f);
    return found;
}

static int has_controllers(const char *dir, const char **want)
{
    char buf[1024];
    if (read_file(dir, "cgroup.controllers", buf, sizeof buf) < 0) return 0;
    for (; *want; want++) {
        int ok = 0;
        char tmp[1024];
        snprintf(tmp, sizeof tmp, "%s", buf);
        char *save, *tok = strtok_r(tmp, " \n", &save);
        for (; tok; tok = strtok_r(NULL, " \n", &save))
            if (strcmp(tok, *want) == 0) { ok = 1; break; }
        if (!ok) return 0;
    }
    return 1;
}

static int mkdir_p1(const char *p)
{
    if (mkdir(p, 0755) < 0 && errno != EEXIST) return -errno;
    return 0;
}

static int setup_v2(struct cgroup *cg, const char *parent, const char *job,
                    const struct cg_limits *lim, char *err, size_t errlen)
{
    char root[512], base[512];
    static const char *need[] = { "memory", "pids", "cpu", NULL };

    if (parent) {
        snprintf(base, sizeof base, "%s", parent);
    } else {
        if (find_mount("cgroup2", NULL, root, sizeof root) < 0) {
            snprintf(err, errlen, "no cgroup2 mount");
            return -1;
        }
        if (!has_controllers(root, need)) {
            snprintf(err, errlen, "cgroup2 at %s lacks memory/pids/cpu controllers", root);
            return -1;
        }
        /* Enable controllers for children of the root, then create base. */
        write_file(root, "cgroup.subtree_control", "+memory +pids +cpu");
        snprintf(base, sizeof base, "%s/runbox", root);
    }
    if (mkdir_p1(base) < 0) {
        snprintf(err, errlen, "mkdir %s: %s", base, strerror(errno));
        return -1;
    }
    if (!has_controllers(base, need)) {
        snprintf(err, errlen, "cgroup %s lacks memory/pids/cpu controllers", base);
        return -1;
    }
    int r = write_file(base, "cgroup.subtree_control", "+memory +pids +cpu");
    if (r < 0) {
        snprintf(err, errlen, "enable controllers in %s: %s", base, strerror(-r));
        return -1;
    }
    snprintf(cg->v2_path, sizeof cg->v2_path, "%s/%s", base, job);
    if (mkdir(cg->v2_path, 0755) < 0) {
        snprintf(err, errlen, "mkdir %s: %s", cg->v2_path, strerror(errno));
        return -1;
    }
    cg->mode = CG_V2;
    if ((r = write_file(cg->v2_path, "memory.max", "%llu",
                        (unsigned long long)lim->memory_bytes)) < 0 ||
        (r = write_file(cg->v2_path, "pids.max", "%llu",
                        (unsigned long long)lim->pids)) < 0) {
        snprintf(err, errlen, "write limits: %s", strerror(-r));
        cg_destroy(cg);
        return -1;
    }
    /* No swap: otherwise MLE turns into slow swapping. Optional files. */
    write_file(cg->v2_path, "memory.swap.max", "0");
    write_file(cg->v2_path, "memory.oom.group", "1");
    return 0;
}

static int setup_v1(struct cgroup *cg, const char *job,
                    const struct cg_limits *lim, char *err, size_t errlen)
{
    char mem[512], pids[512], cpu[512], d[600];
    if (find_mount("cgroup", "memory", mem, sizeof mem) < 0 ||
        find_mount("cgroup", "pids", pids, sizeof pids) < 0 ||
        find_mount("cgroup", "cpuacct", cpu, sizeof cpu) < 0) {
        snprintf(err, errlen, "cgroup v1 memory/pids/cpuacct hierarchies not all mounted");
        return -1;
    }
    snprintf(d, sizeof d, "%s/runbox", mem);  mkdir_p1(d);
    snprintf(cg->v1_mem, sizeof cg->v1_mem, "%s/%s", d, job);
    snprintf(d, sizeof d, "%s/runbox", pids); mkdir_p1(d);
    snprintf(cg->v1_pids, sizeof cg->v1_pids, "%s/%s", d, job);
    snprintf(d, sizeof d, "%s/runbox", cpu);  mkdir_p1(d);
    snprintf(cg->v1_cpu, sizeof cg->v1_cpu, "%s/%s", d, job);
    if (mkdir(cg->v1_mem, 0755) < 0 || mkdir(cg->v1_pids, 0755) < 0 ||
        mkdir(cg->v1_cpu, 0755) < 0) {
        snprintf(err, errlen, "mkdir v1 job cgroup: %s", strerror(errno));
        cg->mode = CG_V1;
        cg_destroy(cg);
        return -1;
    }
    cg->mode = CG_V1;
    int r;
    if ((r = write_file(cg->v1_mem, "memory.limit_in_bytes", "%llu",
                        (unsigned long long)lim->memory_bytes)) < 0 ||
        (r = write_file(cg->v1_pids, "pids.max", "%llu",
                        (unsigned long long)lim->pids)) < 0) {
        snprintf(err, errlen, "write v1 limits: %s", strerror(-r));
        cg_destroy(cg);
        return -1;
    }
    /* memsw limit == mem limit means no swap; may not exist. */
    write_file(cg->v1_mem, "memory.memsw.limit_in_bytes", "%llu",
               (unsigned long long)lim->memory_bytes);
    write_file(cg->v1_mem, "memory.swappiness", "0");
    return 0;
}

int cg_create(struct cgroup *cg, const char *mode_req, const char *parent,
              const char *job, const struct cg_limits *lim,
              char *err, size_t errlen)
{
    memset(cg, 0, sizeof *cg);
    char e2[256] = "", e1[256] = "";
    if (strcmp(mode_req, "v1") != 0) {
        if (setup_v2(cg, parent, job, lim, e2, sizeof e2) == 0) return 0;
        if (strcmp(mode_req, "v2") == 0) {
            snprintf(err, errlen, "cgroup v2: %s", e2);
            return -1;
        }
    }
    if (setup_v1(cg, job, lim, e1, sizeof e1) == 0) return 0;
    snprintf(err, errlen, "cgroup v2: %s; cgroup v1: %s", e2[0] ? e2 : "skipped", e1);
    return -1;
}

int cg_add_pid(struct cgroup *cg, pid_t pid)
{
    int r = 0;
    if (cg->mode == CG_V2)
        return write_file(cg->v2_path, "cgroup.procs", "%d", pid);
    if (cg->mode == CG_V1) {
        if ((r = write_file(cg->v1_mem, "cgroup.procs", "%d", pid)) < 0) return r;
        if ((r = write_file(cg->v1_pids, "cgroup.procs", "%d", pid)) < 0) return r;
        return write_file(cg->v1_cpu, "cgroup.procs", "%d", pid);
    }
    return -EINVAL;
}

int64_t cg_cpu_usec(struct cgroup *cg)
{
    if (cg->mode == CG_V2) return read_key(cg->v2_path, "cpu.stat", "usage_usec");
    if (cg->mode == CG_V1) {
        int64_t ns = read_int(cg->v1_cpu, "cpuacct.usage");
        return ns < 0 ? -1 : ns / 1000;
    }
    return -1;
}

int64_t cg_mem_peak(struct cgroup *cg)
{
    if (cg->mode == CG_V2) return read_int(cg->v2_path, "memory.peak"); /* >= 5.19 */
    if (cg->mode == CG_V1) return read_int(cg->v1_mem, "memory.max_usage_in_bytes");
    return -1;
}

int64_t cg_oom_kills(struct cgroup *cg)
{
    if (cg->mode == CG_V2) return read_key(cg->v2_path, "memory.events", "oom_kill");
    if (cg->mode == CG_V1) return read_key(cg->v1_mem, "memory.oom_control", "oom_kill");
    return -1;
}

int64_t cg_mem_limit_hits(struct cgroup *cg)
{
    if (cg->mode == CG_V2) return read_key(cg->v2_path, "memory.events", "max");
    if (cg->mode == CG_V1) return read_int(cg->v1_mem, "memory.failcnt");
    return -1;
}

static void kill_procs_in(const char *dir)
{
    char buf[65536];
    if (read_file(dir, "cgroup.procs", buf, sizeof buf) < 0) return;
    for (char *p = buf; *p; ) {
        long pid = strtol(p, &p, 10);
        if (pid > 0) kill((pid_t)pid, SIGKILL);
        while (*p == '\n') p++;
    }
}

void cg_kill(struct cgroup *cg)
{
    if (cg->mode == CG_V2) {
        if (write_file(cg->v2_path, "cgroup.kill", "1") < 0) /* >= 5.14 */
            kill_procs_in(cg->v2_path);
    } else if (cg->mode == CG_V1) {
        kill_procs_in(cg->v1_pids);
    }
}

static void rmdir_retry(const char *p)
{
    if (!p[0]) return;
    for (int i = 0; i < 100; i++) {
        if (rmdir(p) == 0 || errno == ENOENT) return;
        if (errno != EBUSY) return;
        struct timespec ts = { 0, 2 * 1000 * 1000 };
        nanosleep(&ts, NULL);
    }
}

void cg_destroy(struct cgroup *cg)
{
    if (cg->mode == CG_V2) {
        cg_kill(cg);
        rmdir_retry(cg->v2_path);
    } else if (cg->mode == CG_V1) {
        kill_procs_in(cg->v1_pids);
        rmdir_retry(cg->v1_mem);
        rmdir_retry(cg->v1_pids);
        rmdir_retry(cg->v1_cpu);
    }
    cg->mode = CG_NONE;
}
