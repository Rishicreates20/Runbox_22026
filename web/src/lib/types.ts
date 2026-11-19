export type Difficulty = 'Easy' | 'Medium' | 'Hard';

export type Language = 'cpp' | 'c' | 'py';

/** Final verdicts shown to users. AC/WA come from the checker, the rest map 1:1 to runbox. */
export type Verdict = 'AC' | 'WA' | 'TLE' | 'MLE' | 'RE' | 'SV' | 'OLE' | 'CE' | 'IE';

export type TestState = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

/** The JSON object runbox prints for one sandboxed run (see the repo README). */
export interface RunboxResult {
  verdict: 'OK' | 'TLE' | 'MLE' | 'RE' | 'SV' | 'OLE' | 'IE';
  detail: string;
  exit_code: number | null;
  signal: string | null;
  cpu_time_ms: number;
  wall_time_ms: number;
  memory_kb: number;
  cgroup: 'v1' | 'v2';
  stdout_b64?: string;
  stdout_truncated?: boolean;
  stderr_b64?: string;
}

export interface Sample {
  input: string;
  output: string;
  explanation?: string;
}

export interface Problem {
  id: number;
  title: string;
  difficulty: Difficulty;
  tags: string[];
  acceptance: number;
  timeLimitMs: number;
  memoryMb: number;
  outputMb: number;
  hiddenTests: number;
  summary: string;
  statement: string[];
  input: string;
  output: string;
  samples: Sample[];
  constraints: string[];
  hint?: string;
}

export interface TestResult {
  index: number;
  state: TestState;
  verdict?: Verdict;
  cpuMs?: number;
  memoryKb?: number;
}

export interface CaseResult {
  index: number;
  passed: boolean;
  verdict: Verdict;
  stdout: string;
  expected: string;
  stderr?: string;
  cpuMs: number;
  memoryKb: number;
}

export interface RunReport {
  verdict: Verdict;
  compileOutput?: string;
  cases: CaseResult[];
}

export interface JudgeReport {
  verdict: Verdict;
  detail: string;
  passed: number;
  total: number;
  failedTest?: number;
  cpuMs: number;
  wallMs: number;
  memoryKb: number;
  tests: TestResult[];
  raw: RunboxResult | null;
  compileOutput?: string;
}

export interface Submission {
  id: string;
  problemId: number;
  language: Language;
  verdict: Verdict;
  cpuMs: number;
  memoryKb: number;
  failedTest?: number;
  createdAt: number;
  source: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
  provider: 'password' | 'github' | 'google' | 'demo';
  createdAt: number;
}
