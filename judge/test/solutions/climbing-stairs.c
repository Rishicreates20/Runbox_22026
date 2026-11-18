#include <stdio.h>
int main(void) { int n; scanf("%d", &n); long long a = 1, b = 1; for (int i = 0; i < n; i++) { long long c = a + b; a = b; b = c; } printf("%lld\n", a); }
