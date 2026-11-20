#include <stdio.h>
int main(void) { FILE *f = fopen("/box/out.bin", "w"); fputs("artifact\n", f); fclose(f); return 0; }
