/* Run after probe: files written by a previous job (/box/leak.txt) must not
 * survive, because each job gets a fresh overlay upperdir. */
#include <stdio.h>
#include <sys/stat.h>
int main(void){ struct stat st; puts(stat("/box/leak.txt",&st)==0?"LEAKED":"clean"); return 0; }
