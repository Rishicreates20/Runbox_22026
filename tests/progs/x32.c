/* SV: x32 ABI syscall number (getpid | 0x40000000) */
#include <unistd.h>
#include <sys/syscall.h>
int main(void){ syscall(39 | 0x40000000); return 0; }
