import type { Language } from '../lib/types';

export interface LanguageInfo {
  id: Language;
  label: string;
  short: string;
  file: string;
  compile: string;
  starter: string;
}

export const LANGUAGES: Record<Language, LanguageInfo> = {
  cpp: {
    id: 'cpp',
    label: 'C++17 · GCC 13',
    short: 'C++17',
    file: 'main.cpp',
    compile: 'g++ -O2 -std=c++17 -o prog main.cpp',
    starter: `#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    // Read from stdin and write your answer to stdout.

    return 0;
}
`,
  },
  c: {
    id: 'c',
    label: 'C11 · GCC 13',
    short: 'C11',
    file: 'main.c',
    compile: 'gcc -O2 -std=c11 -o prog main.c',
    starter: `#include <stdio.h>

int main(void) {
    // Read from stdin and write your answer to stdout.

    return 0;
}
`,
  },
  py: {
    id: 'py',
    label: 'Python 3.12',
    short: 'Python 3.12',
    file: 'main.py',
    compile: 'python3.12 -m py_compile main.py',
    starter: `import sys


def main() -> None:
    data = sys.stdin.read().split()
    # Write your answer to stdout.


main()
`,
  },
};

export const LANGUAGE_ORDER: Language[] = ['cpp', 'c', 'py'];
