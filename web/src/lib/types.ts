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
  /** Null for problems created on this site, which have no history yet. */
  acceptance: number | null;
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
  /** Created by an admin through the Create problem page, or imported from a PDF. */
  custom?: boolean;
  /** Name of the question paper this was imported from. Imported problems are private to their owner. */
  paper?: string;
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
  /** Storage path of the uploaded file, when the solution came from a file upload. */
  filePath?: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
  provider: 'password' | 'email' | 'github' | 'google' | 'demo';
  role: 'user' | 'admin';
  createdAt: number;
}
