import { getSubmissions, newId, saveDraft, setSubmissions } from '../lib/storage';
import type { Language, Submission, Verdict } from '../lib/types';

const BRACKET_SOLUTION = `#include <bits/stdc++.h>
using namespace std;

// Every opener must be closed by its partner, innermost first.
bool balanced(const string& s) {
    stack<char> st;
    for (char c : s) {
        if (c == '(' || c == '[' || c == '{') {
            st.push(c);
            continue;
        }
        if (st.empty()) return false;
        char o = st.top(); st.pop();
        if ((c == ')' && o != '(') || (c == ']' && o != '[') ||
            (c == '}' && o != '{')) return false;
    }
    return st.empty();
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int t; cin >> t;
    while (t--) {
        string s; cin >> s;
        cout << (balanced(s) ? "YES" : "NO") << '\\n';
    }
}
`;

/** Gives the demo account a believable history so the dashboard has something to show. */
export function seedDemoAccount(userId: string): void {
  if (getSubmissions(userId).length > 0) return;
  const now = Date.now();
  const H = 3_600_000;
  const D = 24 * H;

  const plan: [number, number, Language, Verdict, number, number][] = [
    // [problemId, days ago, lang, verdict, cpuMs, memoryKb]
    [88, 0.1, 'cpp', 'AC', 1.1, 512],
    [42, 1.2, 'cpp', 'AC', 1.6, 512],
    [42, 1.25, 'cpp', 'WA', 1.2, 508],
    [117, 2.1, 'py', 'TLE', 1004, 9800],
    [71, 3.3, 'cpp', 'AC', 2.4, 520],
    [57, 4.2, 'cpp', 'WA', 3.1, 1840],
    [102, 9.4, 'c', 'AC', 0.8, 504],
    [102, 9.5, 'c', 'RE', 0.4, 516],
    [88, 12.2, 'py', 'AC', 21.4, 9300],
    [71, 16.1, 'cpp', 'WA', 2.2, 516],
    [42, 23.4, 'py', 'TLE', 1003, 9600],
    [88, 30.2, 'c', 'AC', 0.9, 500],
    [102, 37.6, 'cpp', 'WA', 1.0, 508],
    [57, 44.3, 'cpp', 'RE', 0.6, 520],
    [71, 52.8, 'py', 'TLE', 1002, 9700],
    [88, 61.1, 'cpp', 'AC', 1.0, 512],
    [42, 70.5, 'c', 'CE', 0, 0],
  ];

  const subs: Submission[] = plan.map(([problemId, days, language, verdict, cpuMs, memoryKb]) => ({
    id: newId(),
    problemId,
    language,
    verdict,
    cpuMs,
    memoryKb,
    failedTest: verdict === 'AC' || verdict === 'CE' ? undefined : 3,
    createdAt: Math.round(now - days * D),
    source: problemId === 42 && language === 'cpp' ? BRACKET_SOLUTION : '',
  }));

  setSubmissions(userId, subs);
  saveDraft(userId, 42, 'cpp', BRACKET_SOLUTION);
}
