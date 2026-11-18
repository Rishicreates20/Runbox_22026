#include <unistd.h>
#include <sys/stat.h>
/* Tries to trick --export into copying a host file out. */
/* symlink(2) is already blocked by seccomp; the test runs with --no-seccomp
 * to exercise the openat2 resolution checks on their own. */
int main(void) {
    if (symlink("/etc/passwd", "/box/link")) return 1;
    mkdir("/box/d", 0755);
    if (symlink("/etc", "/box/d/x")) return 1;
    return 0;
}
