/* OK: socket() must fail with EACCES (ERRNO action, not kill) */
#include <stdio.h>
#include <errno.h>
#include <sys/socket.h>
int main(void){ int s=socket(AF_INET,SOCK_STREAM,0); printf("%s\n", s<0&&errno==EACCES?"EACCES":"SOCKET-ALLOWED"); return 0; }
