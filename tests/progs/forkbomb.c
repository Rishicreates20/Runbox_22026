/* fork until the pids cgroup refuses; report how many we got */
#include <stdio.h>
#include <unistd.h>
#include <sys/wait.h>
int main(void){ int n=0; for(int i=0;i<10000;i++){ pid_t p=fork(); if(p<0) break; if(p==0){ pause(); _exit(0);} n++; }
  printf("%d\n", n); fflush(stdout); return 0; }
