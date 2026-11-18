/* OK: reads two ints, prints sum; also fails if any CR reached stdin */
#include <stdio.h>
int main(void){ int c, a=0, b=0; char buf[256]; size_t n=fread(buf,1,sizeof buf-1,stdin); buf[n]=0;
  for(size_t i=0;i<n;i++) if(buf[i]=='\r'){ puts("CR-FOUND"); return 0; }
  if (sscanf(buf,"%d %d",&a,&b)!=2) return 3; (void)c; printf("%d\n",a+b); return 0; }
