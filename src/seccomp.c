/*
 * Default-deny seccomp-BPF filter, pinned to x86_64.
 *
 * Built directly as classic BPF so the runner has no libseccomp build
 * dependency. Semantics match the libseccomp design in the architecture doc:
 *   - seccomp_init(SCMP_ACT_KILL_PROCESS)     -> default action
 *   - only SCMP_ARCH_X86_64 in the filter      -> any other arch (i386 via
 *     int 0x80, x32 via the 0x40000000 bit) is killed outright
 *   - SCMP_ACT_ALLOW rules for the allowlist
 *   - SCMP_ACT_ERRNO(EACCES) for networking calls
 *
 * The filter is installed in the final process right before execve(), so
 * the untrusted program never runs a single instruction unfiltered, and it
 * is inherited by every thread/child it creates.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <sched.h>
#include <stddef.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <unistd.h>
#include "runbox.h"

#ifndef SECCOMP_RET_KILL_PROCESS
#define SECCOMP_RET_KILL_PROCESS 0x80000000U
#endif
#define X32_SYSCALL_BIT 0x40000000U

/* Syscalls a typical C/C++/Python/Java-style runtime needs. */
static const int allow_list[] = {
    /* I/O on already-open fds */
    SYS_read, SYS_write, SYS_readv, SYS_writev, SYS_pread64, SYS_pwrite64,
    SYS_lseek, SYS_close, SYS_dup, SYS_dup2, SYS_dup3, SYS_fcntl, SYS_ioctl,
    SYS_pipe, SYS_pipe2, SYS_poll, SYS_ppoll, SYS_select, SYS_pselect6,
    /* filesystem (confined to the overlay root by the mount namespace) */
    SYS_open, SYS_openat, SYS_stat, SYS_fstat, SYS_lstat, SYS_newfstatat,
    SYS_statx, SYS_access, SYS_faccessat, SYS_faccessat2, SYS_readlink,
    SYS_readlinkat, SYS_getcwd, SYS_chdir, SYS_fchdir, SYS_getdents64,
    SYS_unlink, SYS_unlinkat, SYS_mkdir, SYS_mkdirat, SYS_rename,
    SYS_renameat, SYS_ftruncate, SYS_fsync, SYS_fdatasync, SYS_statfs,
    SYS_fstatfs, SYS_umask, SYS_fadvise64,
    /* memory */
    SYS_brk, SYS_mmap, SYS_munmap, SYS_mremap, SYS_mprotect, SYS_madvise,
    SYS_membarrier,
    /* process / threads (namespace flags on clone are filtered below) */
    SYS_execve, SYS_exit, SYS_exit_group, SYS_wait4, SYS_waitid,
    SYS_vfork, SYS_fork, SYS_set_tid_address, SYS_set_robust_list,
    SYS_get_robust_list, SYS_rseq, SYS_futex, SYS_arch_prctl,
    SYS_sched_yield, SYS_sched_getaffinity, SYS_getpid, SYS_getppid,
    SYS_gettid, SYS_getpgrp, SYS_getuid, SYS_geteuid, SYS_getgid,
    SYS_getegid, SYS_getgroups, SYS_getresuid, SYS_getresgid,
    SYS_prlimit64, SYS_getrlimit, SYS_getrusage, SYS_times, SYS_tgkill,
    SYS_kill,  /* PID namespace: can only reach its own sandbox */
    /* signals */
    SYS_rt_sigaction, SYS_rt_sigprocmask, SYS_rt_sigreturn, SYS_sigaltstack,
    SYS_rt_sigsuspend, SYS_rt_sigtimedwait, SYS_pause,
    /* time / misc */
    SYS_clock_gettime, SYS_clock_getres, SYS_clock_nanosleep, SYS_nanosleep,
    SYS_gettimeofday, SYS_time, SYS_uname, SYS_sysinfo, SYS_getrandom,
    SYS_epoll_create1, SYS_epoll_ctl, SYS_epoll_wait, SYS_epoll_pwait,
    SYS_eventfd2,
};

/* Return EACCES instead of killing, so runtimes that probe networking
 * (e.g. Python's socket module at import) keep working. */
static const int errno_list[] = {
    SYS_socket, SYS_socketpair, SYS_connect, SYS_bind, SYS_listen,
    SYS_accept, SYS_accept4, SYS_sendto, SYS_recvfrom, SYS_sendmsg,
    SYS_recvmsg, SYS_shutdown, SYS_getsockopt, SYS_setsockopt,
    SYS_getsockname, SYS_getpeername,
};

/* clone3 passes flags in a struct BPF can't inspect: answer ENOSYS so glibc
 * falls back to clone(), whose flags we can check. */
static const int enosys_list[] = { SYS_clone3 };

#define NS_FLAGS (CLONE_NEWNS | CLONE_NEWUTS | CLONE_NEWIPC | CLONE_NEWUSER | \
                  CLONE_NEWPID | CLONE_NEWNET | CLONE_NEWCGROUP)

#define MAXF 1024

int seccomp_install(void)
{
    struct sock_filter f[MAXF];
    unsigned n = 0;
#define EMIT(x) do { if (n >= MAXF) return -E2BIG; f[n++] = (struct sock_filter)x; } while (0)

    /* 1. Architecture pin. */
    EMIT(BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)));
    EMIT(BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AUDIT_ARCH_X86_64, 1, 0));
    EMIT(BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS));

    /* 2. Load syscall nr; reject x32 ABI numbers. */
    EMIT(BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)));
    EMIT(BPF_JUMP(BPF_JMP | BPF_JGE | BPF_K, X32_SYSCALL_BIT, 0, 1));
    EMIT(BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS));

    /* 3. clone(): allow only without namespace-creating flags. */
    EMIT(BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_clone, 0, 4));
    EMIT(BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])));
    EMIT(BPF_JUMP(BPF_JMP | BPF_JSET | BPF_K, NS_FLAGS, 0, 1));
    EMIT(BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS));
    EMIT(BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW));

    /* 4. ERRNO / ENOSYS lists. */
    for (size_t i = 0; i < sizeof errno_list / sizeof *errno_list; i++) {
        EMIT(BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, (unsigned)errno_list[i], 0, 1));
        EMIT(BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (EACCES & SECCOMP_RET_DATA)));
    }
    for (size_t i = 0; i < sizeof enosys_list / sizeof *enosys_list; i++) {
        EMIT(BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, (unsigned)enosys_list[i], 0, 1));
        EMIT(BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (ENOSYS & SECCOMP_RET_DATA)));
    }

    /* 5. Allowlist. */
    for (size_t i = 0; i < sizeof allow_list / sizeof *allow_list; i++) {
        EMIT(BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, (unsigned)allow_list[i], 0, 1));
        EMIT(BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW));
    }

    /* 6. Default deny. */
    EMIT(BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS));
#undef EMIT

    struct sock_fprog prog = { .len = (unsigned short)n, .filter = f };
    if (syscall(SYS_seccomp, SECCOMP_SET_MODE_FILTER, 0, &prog) < 0)
        return -errno;
    return 0;
}
