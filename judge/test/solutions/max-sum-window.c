#include <stdio.h>
#include <stdlib.h>
int main(void) {
    int n, k; scanf("%d", &n); long long *a = malloc(sizeof *a * n);
    for (int i = 0; i < n; i++) scanf("%lld", &a[i]);
    scanf("%d", &k);
    long long s = 0; for (int i = 0; i < k; i++) s += a[i];
    long long best = s;
    for (int i = k; i < n; i++) { s += a[i] - a[i-k]; if (s > best) best = s; }
    printf("%lld\n", best);
}
