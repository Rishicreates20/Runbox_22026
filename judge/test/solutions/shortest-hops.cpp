#include <bits/stdc++.h>
using namespace std;
int main() {
    ios::sync_with_stdio(false); cin.tie(nullptr);
    int n; cin >> n; vector<vector<int>> g(n);
    for (int u = 0; u < n; u++) { int d; cin >> d; g[u].resize(d); for (auto &v : g[u]) cin >> v; }
    int s; cin >> s; vector<int> dist(n, -1); dist[s] = 0; queue<int> q; q.push(s);
    while (!q.empty()) { int u = q.front(); q.pop(); for (int v : g[u]) if (dist[v] < 0) { dist[v] = dist[u] + 1; q.push(v); } }
    for (int i = 0; i < n; i++) cout << dist[i] << (i + 1 < n ? ' ' : '\n');
}
