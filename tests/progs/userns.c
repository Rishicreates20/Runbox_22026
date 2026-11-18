/* SV: clone() with CLONE_NEWUSER */
#define _GNU_SOURCE
#include <sched.h>
#include <unistd.h>
#include <sys/syscall.h>
#include <signal.h>
int main(void){ syscall(SYS_clone, CLONE_NEWUSER|SIGCHLD, 0, 0, 0, 0); return 0; }
