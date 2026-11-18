/* MLE: touches 1 GiB */
#include <stdlib.h>
#include <string.h>
int main(void){ for(int i=0;i<1024;i++){ char *p=malloc(1<<20); if(!p) return 1; memset(p,1,1<<20);} return 0; }
