/* Isolation probe: prints facts about the environment as key=value */
#include <dirent.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/stat.h>
static int count_pids(void){ DIR *d=opendir("/proc"); if(!d) return -1; int n=0; struct dirent *e;
  while((e=readdir(d))) if(e->d_name[0]>='0'&&e->d_name[0]<='9') n++; closedir(d); return n; }
static int ifaces(void){ FILE *f=fopen("/proc/net/dev","r"); if(!f) return -1; char l[512]; int n=-2;
  while(fgets(l,sizeof l,f)) n++; fclose(f); return n; }
int main(void){
  char host[64]={0}; gethostname(host,sizeof host); struct stat st;
  printf("uid=%d\n", getuid()); printf("pid=%d\n", getpid());
  printf("visible_pids=%d\n", count_pids()); printf("hostname=%s\n", host);
  printf("net_ifaces=%d\n", ifaces());
  printf("old_root=%s\n", stat("/.old_root",&st)==0?"present":"absent");
  printf("host_home=%s\n", stat("/home/user",&st)==0?"visible":"hidden");
  printf("runbox_bin=%s\n", stat("/usr/local/bin/runbox",&st)==0?"visible":"hidden");
  FILE *f=fopen("/etc/pwned","w"); printf("write_etc=%s\n", f?"ok":"denied"); if(f) fclose(f);
  f=fopen("/tmp/x","w"); printf("write_tmp=%s\n", f?"ok":"denied"); if(f) fclose(f);
  f=fopen("/box/leak.txt","w"); printf("write_box=%s\n", f?"ok":"denied"); if(f) fclose(f);
  return 0; }
