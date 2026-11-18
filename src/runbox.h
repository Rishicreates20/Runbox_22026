/*
 * runbox: Linux-native sandbox for untrusted competitive-programming
 * submissions. Shared declarations.
 */
#ifndef RUNBOX_H
#define RUNBOX_H

#include <stddef.h>
#include <stdint.h>
#include <sys/types.h>

/* ---------- base64 (b64.c) ---------- */
/* Decodes standard base64, ignoring whitespace. Returns malloc'd buffer or
 * NULL on malformed input. */
unsigned char *b64_decode(const char *in, size_t in_len, size_t *out_len);
/* Returns malloc'd NUL-terminated base64 string. */
char *b64_encode(const unsigned char *in, size_t in_len);
/* In-place CRLF -> LF normalisation (also lone trailing CR before EOF is
 * kept as-is only if not followed by LF). Returns new length. */
size_t normalize_newlines(unsigned char *buf, size_t len);

/* ---------- cgroups (cgroup.c) ---------- */
enum cg_mode { CG_NONE = 0, CG_V2, CG_V1 };

struct cgroup {
    enum cg_mode mode;
    char v2_path[512];      /* job cgroup (v2) */
    char v1_mem[512];       /* job cgroups (v1 fallback) */
    char v1_pids[512];
    char v1_cpu[512];
};

struct cg_limits {
    uint64_t memory_bytes;
    uint64_t pids;
};

/* mode_req: "auto", "v2", "v1". parent: optional cgroup parent override
 * (v2 only), NULL for "<cgroup2 mount>/runbox". */
int cg_create(struct cgroup *cg, const char *mode_req, const char *parent,
              const char *job_name, const struct cg_limits *lim,
              char *err, size_t errlen);
int cg_add_pid(struct cgroup *cg, pid_t pid);
/* CPU time used by the job in microseconds (cpu.stat usage_usec on v2). */
int64_t cg_cpu_usec(struct cgroup *cg);
/* Peak memory in bytes, or -1 if unknown. */
int64_t cg_mem_peak(struct cgroup *cg);
/* Number of OOM kills in this cgroup (memory.events oom_kill). */
int64_t cg_oom_kills(struct cgroup *cg);
/* Number of times the memory limit was hit (memory.events max / failcnt). */
int64_t cg_mem_limit_hits(struct cgroup *cg);
/* Kill every process in the cgroup (cgroup.kill on v2). */
void cg_kill(struct cgroup *cg);
void cg_destroy(struct cgroup *cg);
const char *cg_mode_name(enum cg_mode m);

/* ---------- seccomp (seccomp.c) ---------- */
/* Installs the default-deny x86_64 filter on the calling thread.
 * Requires PR_SET_NO_NEW_PRIVS already set. Returns 0 or -errno. */
int seccomp_install(void);

#endif
