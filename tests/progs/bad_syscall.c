/* SV: mount(2) is not on the allowlist */
#include <sys/mount.h>
int main(void){ mount("none","/tmp","tmpfs",0,0); return 0; }
