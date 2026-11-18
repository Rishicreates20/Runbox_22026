#!/usr/bin/env python3
"""Generates the seed problems in this folder from reference solutions.

    python3 problems/generate.py      # rewrites problems/*.json

Each file is a ProblemUpload (see packages/shared/src/problem.ts). Expected
outputs come from the reference solutions below, and the random tests use a
fixed seed so the files are reproducible.
"""
import json, os, random
from collections import deque

HERE = os.path.dirname(os.path.abspath(__file__))
rng = random.Random(20261118)

def write(problem):
    path = os.path.join(HERE, f"{problem['slug']}.json")
    with open(path, "w") as f:
        json.dump(problem, f, separators=(",", ":"))
        f.write("\n")
    print(f"{path}: {len(problem['tests'])} tests, {os.path.getsize(path) // 1024} KB")

# ---------------------------------------------------------------- two-sum
def two_sum(nums, target):
    seen = {}
    for i, x in enumerate(nums):
        if target - x in seen:
            return seen[target - x], i
        seen[x] = i

def unique_pair_case(n, lo, hi):
    while True:
        nums = rng.sample(range(lo, hi), n)
        i, j = sorted(rng.sample(range(n), 2))
        target = nums[i] + nums[j]
        s = set(nums)
        pairs = sum(1 for x in nums if target - x in s and target - x != x) // 2
        if pairs == 1:
            return nums, target

def two_sum_test(nums, target, sample=False, explanation=None):
    i, j = two_sum(nums, target)
    t = {
        "input": f"{len(nums)}\n{' '.join(map(str, nums))}\n{target}\n",
        "displayInput": (f"nums = [{','.join(map(str, nums))}], target = {target}" if len(nums) <= 100
                         else f"nums = [{','.join(map(str, nums[:8]))},...] ({len(nums)} numbers), target = {target}"),
        "expectedOutput": f"{i} {j}\n",
        "sample": sample,
    }
    if explanation:
        t["explanation"] = explanation
    return t

two_sum_tests = [
    two_sum_test([2, 7, 11, 15], 9, True, "nums[0] + nums[1] == 9, so the answer is 0 1."),
    two_sum_test([3, 2, 4], 6, True),
    two_sum_test([3, 3], 6, True),
    two_sum_test([-1, -2, -3, -4, -5], -8),
    two_sum_test([0, 4, 3, 0], 0),
    two_sum_test([1000000000, 999999999, 7], 1999999999),
]
for n in (10, 100, 1000):
    two_sum_tests.append(two_sum_test(*unique_pair_case(n, -10**6, 10**6)))
for n in (20000, 20000):
    two_sum_tests.append(two_sum_test(*unique_pair_case(n, -10**9, 10**9)))

write({
    "slug": "two-sum",
    "title": "Two Sum",
    "difficulty": "easy",
    "tags": ["array", "hash table"],
    "problem_type": "generic",
    "statement": """Given an array of integers `nums` and an integer `target`, find the two indices `i < j` such that `nums[i] + nums[j] == target`.

Each input has **exactly one** solution, and you may not use the same element twice.

### Input
- Line 1: `n`, the length of `nums`
- Line 2: `n` integers, the elements of `nums`
- Line 3: `target`

### Output
Print `i` and `j` (0-indexed, `i < j`) separated by a space.

### Constraints
- 2 ≤ n ≤ 10⁵
- −10⁹ ≤ nums[i], target ≤ 10⁹ (sums can exceed 32 bits)
""",
    "limits": {"timeMs": {"cpp": 1000, "c": 1000, "python": 3000}, "memoryMb": 256},
    "starterCode": {
        "cpp": """#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n;
    cin >> n;
    vector<long long> nums(n);
    for (auto &x : nums) cin >> x;
    long long target;
    cin >> target;

    // TODO: print the two indices
    cout << 0 << " " << 1 << "\\n";
    return 0;
}
""",
        "c": """#include <stdio.h>
#include <stdlib.h>

int main(void) {
    int n;
    if (scanf("%d", &n) != 1) return 0;
    long long *nums = malloc(sizeof *nums * n);
    for (int i = 0; i < n; i++) scanf("%lld", &nums[i]);
    long long target;
    scanf("%lld", &target);

    /* TODO: print the two indices */
    printf("%d %d\\n", 0, 1);
    free(nums);
    return 0;
}
""",
        "python": """import sys

def main():
    data = sys.stdin.read().split()
    n = int(data[0])
    nums = list(map(int, data[1:1 + n]))
    target = int(data[1 + n])

    # TODO: print the two indices
    print(0, 1)

main()
""",
    },
    "tests": two_sum_tests,
})

# ---------------------------------------------------------- max-sum-window
def max_window(a, k):
    s = sum(a[:k]); best = s
    for i in range(k, len(a)):
        s += a[i] - a[i - k]
        best = max(best, s)
    return best

def window_test(a, k, sample=False, explanation=None):
    t = {"args": {"target_array": a, "k_value": k},
         "expectedOutput": f"{max_window(a, k)}\n", "sample": sample}
    if explanation:
        t["explanation"] = explanation
    return t

win_tests = [
    window_test([1, 4, 2, 10, 23, 3, 1, 0, 20], 4, True, "The window [4, 2, 10, 23] has the largest sum, 39."),
    window_test([-3, -1, -2], 2, True),
    window_test([5], 1, True),
    window_test([2, 2, 2, 2], 4),
    window_test([-10**9] * 6, 3),
]
for n, k in ((50, 7), (1000, 1), (5000, 2500)):
    win_tests.append(window_test([rng.randint(-10**4, 10**4) for _ in range(n)], k))
for n, k in ((99999, 31337), (99999, 99999)):
    win_tests.append(window_test([rng.randint(-10**9, 10**9) for _ in range(n)], k))

write({
    "slug": "max-sum-window",
    "title": "Maximum Sum Window",
    "difficulty": "easy",
    "tags": ["array", "sliding window"],
    "problem_type": "array_manipulation",
    "statement": """Given an integer array `nums` and an integer `k`, return the largest sum of any contiguous subarray of exactly `k` elements.

### Input
- Line 1: `n`
- Line 2: `n` integers, the elements of `nums`
- Line 3: `k`

### Output
One integer, the maximum window sum.

### Constraints
- 1 ≤ k ≤ n < 10⁵
- −10⁹ ≤ nums[i] ≤ 10⁹ (the answer needs 64-bit integers)
""",
    "limits": {"timeMs": {"cpp": 1000, "c": 1000, "python": 3000}, "memoryMb": 256},
    "starterCode": {
        "cpp": """#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n;
    cin >> n;
    vector<long long> nums(n);
    for (auto &x : nums) cin >> x;
    int k;
    cin >> k;

    long long best = 0;
    // TODO
    cout << best << "\\n";
    return 0;
}
""",
        "c": """#include <stdio.h>
#include <stdlib.h>

int main(void) {
    int n, k;
    if (scanf("%d", &n) != 1) return 0;
    long long *nums = malloc(sizeof *nums * n);
    for (int i = 0; i < n; i++) scanf("%lld", &nums[i]);
    scanf("%d", &k);

    long long best = 0;
    /* TODO */
    printf("%lld\\n", best);
    free(nums);
    return 0;
}
""",
        "python": """import sys

def main():
    data = sys.stdin.buffer.read().split()
    n = int(data[0])
    nums = list(map(int, data[1:1 + n]))
    k = int(data[1 + n])

    best = 0
    # TODO
    print(best)

main()
""",
    },
    "tests": win_tests,
})

# --------------------------------------------------------- shortest-hops
def bfs(adj, s):
    d = [-1] * len(adj); d[s] = 0; q = deque([s])
    while q:
        u = q.popleft()
        for v in adj[u]:
            if d[v] < 0:
                d[v] = d[u] + 1; q.append(v)
    return d

def graph_test(adj, s, sample=False, explanation=None):
    t = {"args": {"adjacency_list": adj, "start_node": s},
         "expectedOutput": " ".join(map(str, bfs(adj, s))) + "\n", "sample": sample}
    if explanation:
        t["explanation"] = explanation
    return t

def random_graph(n, m):
    adj = [[] for _ in range(n)]
    for _ in range(m):
        u, v = rng.randrange(n), rng.randrange(n)
        if u != v:
            adj[u].append(v)
    return adj

g_tests = [
    graph_test([[1, 2], [3], [3], []], 0, True, "Node 3 is two hops away through either 1 or 2."),
    graph_test([[1], [2], [0], []], 1, True, "Node 3 has no incoming edges, so it is unreachable."),
    graph_test([[]], 0, True),
    graph_test([[i + 1] for i in range(99)] + [[]], 0),
    graph_test([[j for j in range(30) if j != i] for i in range(30)], 17),
]
for n, m in ((200, 400), (5000, 20000), (60000, 150000)):
    g_tests.append(graph_test(random_graph(n, m), rng.randrange(n)))

write({
    "slug": "shortest-hops",
    "title": "Shortest Hops",
    "difficulty": "medium",
    "tags": ["graph", "breadth-first search"],
    "problem_type": "graph_traversal",
    "statement": """You are given a **directed** graph with `n` nodes numbered `0` to `n − 1` as an adjacency list, and a node `start_node`.

For every node, print the smallest number of edges on a path from `start_node` to it, or `-1` if it can't be reached.

### Input
- Line 1: `n`
- Next `n` lines: line `u` starts with `deg(u)`, followed by the `deg(u)` neighbours of `u`
- Last line: `start_node`

### Output
`n` integers separated by spaces: the distance to node `0`, `1`, …, `n − 1`.

### Constraints
- 1 ≤ n ≤ 10⁵, total edges ≤ 10⁶
- Edges may repeat. There are no self-loops.
""",
    "limits": {"timeMs": {"cpp": 1000, "c": 1000, "python": 4000}, "memoryMb": 256},
    "starterCode": {
        "cpp": """#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n;
    cin >> n;
    vector<vector<int>> adj(n);
    for (int u = 0; u < n; u++) {
        int d;
        cin >> d;
        adj[u].resize(d);
        for (auto &v : adj[u]) cin >> v;
    }
    int start;
    cin >> start;

    vector<int> dist(n, -1);
    // TODO: breadth-first search from start

    for (int i = 0; i < n; i++) cout << dist[i] << (i + 1 < n ? ' ' : '\\n');
    return 0;
}
""",
        "c": """#include <stdio.h>
#include <stdlib.h>

int main(void) {
    int n;
    if (scanf("%d", &n) != 1) return 0;
    int *deg = malloc(sizeof(int) * n), **adj = malloc(sizeof(int *) * n);
    for (int u = 0; u < n; u++) {
        scanf("%d", &deg[u]);
        adj[u] = malloc(sizeof(int) * (deg[u] ? deg[u] : 1));
        for (int i = 0; i < deg[u]; i++) scanf("%d", &adj[u][i]);
    }
    int start;
    scanf("%d", &start);

    int *dist = malloc(sizeof(int) * n);
    for (int i = 0; i < n; i++) dist[i] = -1;
    /* TODO: breadth-first search from start */

    for (int i = 0; i < n; i++) printf("%d%c", dist[i], i + 1 < n ? ' ' : '\\n');
    return 0;
}
""",
        "python": """import sys
from collections import deque

def main():
    data = sys.stdin.buffer.read().split()
    pos = 0
    n = int(data[pos]); pos += 1
    adj = []
    for _ in range(n):
        d = int(data[pos]); pos += 1
        adj.append(list(map(int, data[pos:pos + d]))); pos += d
    start = int(data[pos])

    dist = [-1] * n
    # TODO: breadth-first search from start

    print(" ".join(map(str, dist)))

main()
""",
    },
    "tests": g_tests,
})

# ------------------------------------------------------ valid-parentheses
def valid(s):
    st = []; pairs = {")": "(", "]": "[", "}": "{"}
    for c in s:
        if c in "([{": st.append(c)
        elif not st or st.pop() != pairs[c]: return False
    return not st

def paren_test(s, sample=False, explanation=None):
    t = {"args": {"input_string": s}, "expectedOutput": "true\n" if valid(s) else "false\n", "sample": sample}
    if explanation:
        t["explanation"] = explanation
    return t

def balanced(n):
    out, st = [], []
    for _ in range(n):
        if st and (rng.random() < 0.5 or len(st) > n // 2):
            out.append({"(": ")", "[": "]", "{": "}"}[st.pop()])
        else:
            c = rng.choice("([{"); st.append(c); out.append(c)
    while st:
        out.append({"(": ")", "[": "]", "{": "}"}[st.pop()])
    return "".join(out)

p_tests = [
    paren_test("()", True),
    paren_test("()[]{}", True),
    paren_test("(]", True, "The ']' closes a bracket that was opened with '('."),
    paren_test("([{}])", True),
    paren_test(""),
    paren_test("("),
    paren_test(")("),
    paren_test("{[]}()[{()}]"),
    paren_test("((((((((((((((((((((((((((((((((((((((((((((((((("),
]
for n in (50, 500, 4000, 9000):
    s = balanced(n)
    p_tests.append(paren_test(s[:9999]))
    broken = list(s[:9999]); i = rng.randrange(len(broken)); broken[i] = rng.choice("()[]{}")
    p_tests.append(paren_test("".join(broken)))

write({
    "slug": "valid-parentheses",
    "title": "Valid Parentheses",
    "difficulty": "easy",
    "tags": ["string", "stack"],
    "problem_type": "string_parsing",
    "input_pattern": "[()\\[\\]{}]*",
    "statement": """Given a string `s` made only of the characters `(`, `)`, `[`, `]`, `{` and `}`, decide whether it is valid.

A string is valid when every opening bracket is closed by the same kind of bracket, and brackets close in the right order. The empty string is valid.

### Input
One line containing `s` (it may be empty).

### Output
`true` or `false`.

### Constraints
- 0 ≤ |s| < 10⁴
""",
    "limits": {"timeMs": {"cpp": 1000, "c": 1000, "python": 2000}, "memoryMb": 128},
    "starterCode": {
        "cpp": """#include <bits/stdc++.h>
using namespace std;

int main() {
    string s;
    getline(cin, s);

    bool ok = true;
    // TODO
    cout << (ok ? "true" : "false") << "\\n";
    return 0;
}
""",
        "c": """#include <stdio.h>
#include <string.h>

static char s[10005];

int main(void) {
    if (!fgets(s, sizeof s, stdin)) s[0] = 0;
    s[strcspn(s, "\\n")] = 0;

    int ok = 1;
    /* TODO */
    puts(ok ? "true" : "false");
    return 0;
}
""",
        "python": """import sys

def main():
    s = sys.stdin.readline().rstrip("\\n")

    ok = True
    # TODO
    print("true" if ok else "false")

main()
""",
    },
    "tests": p_tests,
})

# --------------------------------------------------------- climbing-stairs
def stairs(n):
    a, b = 1, 1
    for _ in range(n): a, b = b, a + b
    return a

def stairs_test(n, sample=False, explanation=None):
    t = {"input": f"{n}\n", "displayInput": f"n = {n}", "expectedOutput": f"{stairs(n)}\n", "sample": sample}
    if explanation:
        t["explanation"] = explanation
    return t

write({
    "slug": "climbing-stairs",
    "title": "Climbing Stairs",
    "difficulty": "easy",
    "tags": ["dynamic programming", "math"],
    "problem_type": "generic",
    "statement": """You are climbing a staircase with `n` steps. Each move climbs either 1 or 2 steps.

How many distinct ways are there to reach the top?

### Input
One integer `n`.

### Output
The number of ways.

### Constraints
- 1 ≤ n ≤ 90 (the answer needs 64-bit integers)
""",
    "limits": {"timeMs": {"cpp": 1000, "c": 1000, "python": 2000}, "memoryMb": 64},
    "starterCode": {
        "cpp": """#include <bits/stdc++.h>
using namespace std;

int main() {
    int n;
    cin >> n;
    long long ways = 0;
    // TODO
    cout << ways << "\\n";
    return 0;
}
""",
        "c": """#include <stdio.h>

int main(void) {
    int n;
    if (scanf("%d", &n) != 1) return 0;
    long long ways = 0;
    /* TODO */
    printf("%lld\\n", ways);
    return 0;
}
""",
        "python": """n = int(input())
ways = 0
# TODO
print(ways)
""",
    },
    "tests": [
        stairs_test(2, True, "1 + 1 or 2."),
        stairs_test(3, True, "1 + 1 + 1, 1 + 2, or 2 + 1."),
        stairs_test(1),
        stairs_test(10),
        stairs_test(45),
        stairs_test(46),
        stairs_test(70),
        stairs_test(90),
    ],
})
