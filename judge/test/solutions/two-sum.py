import sys
d = sys.stdin.read().split(); n = int(d[0]); a = list(map(int, d[1:1+n])); t = int(d[1+n])
seen = {}
for i, x in enumerate(a):
    if t - x in seen:
        print(seen[t - x], i); break
    seen[x] = i
