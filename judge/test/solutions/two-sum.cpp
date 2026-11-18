#include <bits/stdc++.h>
using namespace std;
int main() {
    ios::sync_with_stdio(false); cin.tie(nullptr);
    int n; cin >> n; vector<long long> a(n); for (auto &x : a) cin >> x;
    long long t; cin >> t;
    unordered_map<long long, int> seen;
    for (int i = 0; i < n; i++) {
        auto it = seen.find(t - a[i]);
        if (it != seen.end()) { cout << it->second << " " << i << "\n"; return 0; }
        seen[a[i]] = i;
    }
}
