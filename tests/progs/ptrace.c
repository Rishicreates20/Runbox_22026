/* SV: ptrace(2) */
#include <sys/ptrace.h>
int main(void){ ptrace(PTRACE_TRACEME,0,0,0); return 0; }
