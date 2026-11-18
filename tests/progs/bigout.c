/* OLE: writes 64 MiB */
#include <stdio.h>
#include <string.h>
int main(void){ static char b[1<<20]; memset(b,'a',sizeof b); for(int i=0;i<64;i++) fwrite(b,1,sizeof b,stdout); return 0; }
