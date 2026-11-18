import sys
d = sys.stdin.buffer.read().split(); n = int(d[0]); a = list(map(int, d[1:1+n])); k = int(d[1+n])
s = sum(a[:k]); best = s
for i in range(k, n):
    s += a[i] - a[i-k]
    if s > best: best = s
print(best)
