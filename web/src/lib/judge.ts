import { LANGUAGES } from '../data/languages';
import { API_URL, api, sleep } from './config';
import type {
  CaseResult,
  JudgeReport,
  Language,
  Problem,
  RunReport,
  RunboxResult,
  Sample,
  TestResult,
  Verdict,
} from './types';

/** In demo mode the user can force an outcome to preview every verdict state. */
export type DemoOutcome = 'auto' | Verdict;

export interface RunRequest {
  problem: Problem;
  language: Language;
  source: string;
  cases: Sample[];
}

export interface SubmitRequest {
  problem: Problem;
  language: Language;
  source: string;
}

export interface JudgeOptions {
  signal?: AbortSignal;
  outcome?: DemoOutcome;
}

export interface JudgeClient {
  readonly mode: 'demo' | 'remote';
  run(req: RunRequest, opts?: JudgeOptions): Promise<RunReport>;
  submit(
    req: SubmitRequest,
    opts: JudgeOptions & { onProgress: (tests: TestResult[]) => void },
  ): Promise<JudgeReport>;
}

/* ------------------------------------------------------------------ */
/* Remote judge: talks to the Code+ API, which runs runbox server-side. */
/* ------------------------------------------------------------------ */

interface SubmissionStatus {
  status: 'queued' | 'compiling' | 'running' | 'done';
  tests: TestResult[];
  report?: JudgeReport;
}

class RemoteJudge implements JudgeClient {
  readonly mode = 'remote' as const;

  run(req: RunRequest, opts: JudgeOptions = {}): Promise<RunReport> {
    return api<RunReport>('/run', {
      method: 'POST',
      signal: opts.signal,
      body: JSON.stringify({
        problemId: req.problem.id,
        language: req.language,
        source: req.source,
        cases: req.cases.map((c) => c.input),
      }),
    });
  }

  async submit(
    req: SubmitRequest,
    opts: JudgeOptions & { onProgress: (tests: TestResult[]) => void },
  ): Promise<JudgeReport> {
    const { id } = await api<{ id: string }>('/submissions', {
      method: 'POST',
      signal: opts.signal,
      body: JSON.stringify({ problemId: req.problem.id, language: req.language, source: req.source }),
    });
    for (;;) {
      const s = await api<SubmissionStatus>(`/submissions/${encodeURIComponent(id)}`, { signal: opts.signal });
      opts.onProgress(s.tests);
      if (s.status === 'done' && s.report) return s.report;
      await sleep(400, opts.signal);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Demo judge: no server. It simulates runbox so the UI can be explored. */
/* ------------------------------------------------------------------ */

function rng(seed: number) {
  let s = seed % 2147483647 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const COMPILE_ERRORS: Record<Language, string> = {
  cpp: "main.cpp:9:5: error: expected ';' before 'return'\n    9 |     return 0;\n      |     ^~~~~~",
  c: "main.c:5:5: error: expected ';' before 'return'\n    5 |     return 0;\n      |     ^~~~~~",
  py: '  File "main.py", line 6\n    data = sys.stdin.read().split(\n                                  ^\nSyntaxError: \'(\' was never closed',
};

const STDERR: Partial<Record<Verdict, string>> = {
  TLE: 'Killed: CPU time limit exceeded',
  MLE: 'Killed: out of memory (cgroup memory.max)',
  RE: 'Segmentation fault (SIGSEGV)',
  SV: 'Bad system call (SIGSYS): blocked by seccomp',
  OLE: 'File size limit exceeded (SIGXFSZ)',
  IE: 'runbox: sandbox setup failed',
};

function isUntouched(source: string, language: Language): boolean {
  const s = source.trim();
  return s === '' || s === LANGUAGES[language].starter.trim();
}

function wrongOutput(expected: string): string {
  const [first, ...rest] = expected.split('\n');
  let changed = '';
  if (/^-?\d+/.test(first)) changed = first.replace(/^-?\d+/, (n) => String(Number(n) + 1));
  else if (first.startsWith('YES')) changed = first.replace('YES', 'NO');
  else if (first.startsWith('NO')) changed = first.replace('NO', 'YES');
  return [changed, ...rest].join('\n');
}

function metrics(language: Language, rand: () => number) {
  if (language === 'py') return { cpuMs: 17 + rand() * 14, memoryKb: 9100 + Math.round(rand() * 700) };
  return { cpuMs: 0.7 + rand() * 1.4, memoryKb: 500 + Math.round(rand() * 40) };
}

class DemoJudge implements JudgeClient {
  readonly mode = 'demo' as const;

  private resolve(outcome: DemoOutcome | undefined, source: string, language: Language): { verdict: Verdict; untouched: boolean } {
    const untouched = isUntouched(source, language);
    if (outcome && outcome !== 'auto') return { verdict: outcome, untouched };
    return { verdict: untouched ? 'WA' : 'AC', untouched };
  }

  async run(req: RunRequest, opts: JudgeOptions = {}): Promise<RunReport> {
    const { verdict, untouched } = this.resolve(opts.outcome, req.source, req.language);
    const rand = rng(hash(req.source) + req.problem.id);
    await sleep(700 + rand() * 500, opts.signal);

    if (verdict === 'CE') {
      return { verdict: 'CE', compileOutput: COMPILE_ERRORS[req.language], cases: [] };
    }

    const cases: CaseResult[] = req.cases.map((c, index) => {
      const m = metrics(req.language, rand);
      const failsHere = verdict !== 'AC' && (index === 0 || (verdict === 'WA' && untouched));
      if (!failsHere) {
        return { index, passed: true, verdict: 'AC', stdout: c.output, expected: c.output, ...m };
      }
      if (verdict === 'WA') {
        return { index, passed: false, verdict: 'WA', stdout: untouched ? '' : wrongOutput(c.output), expected: c.output, ...m };
      }
      return {
        index,
        passed: false,
        verdict,
        stdout: '',
        expected: c.output,
        stderr: STDERR[verdict],
        cpuMs: verdict === 'TLE' ? req.problem.timeLimitMs + 4 : m.cpuMs,
        memoryKb: verdict === 'MLE' ? req.problem.memoryMb * 1024 : m.memoryKb,
      };
    });

    const firstFail = cases.find((c) => !c.passed);
    return { verdict: firstFail ? firstFail.verdict : 'AC', cases };
  }

  async submit(
    req: SubmitRequest,
    opts: JudgeOptions & { onProgress: (tests: TestResult[]) => void },
  ): Promise<JudgeReport> {
    const { verdict, untouched } = this.resolve(opts.outcome, req.source, req.language);
    const total = req.problem.hiddenTests;
    const rand = rng(hash(req.source) + req.problem.id * 31);
    const tests: TestResult[] = Array.from({ length: total }, (_, i) => ({ index: i + 1, state: 'pending' }));
    const push = () => opts.onProgress(tests.map((t) => ({ ...t })));

    push();
    await sleep(550, opts.signal);

    if (verdict === 'CE') {
      tests.forEach((t) => (t.state = 'skipped'));
      push();
      return {
        verdict: 'CE',
        detail: 'Compilation failed, so no tests were run.',
        passed: 0,
        total,
        cpuMs: 0,
        wallMs: 0,
        memoryKb: 0,
        tests,
        raw: null,
        compileOutput: COMPILE_ERRORS[req.language],
      };
    }

    const failAt: Record<Verdict, number> = {
      AC: 0,
      WA: untouched ? 1 : Math.min(3, total),
      TLE: Math.ceil(total * 0.55),
      MLE: Math.ceil(total * 0.7),
      RE: Math.min(4, total),
      SV: 1,
      OLE: Math.min(2, total),
      CE: 0,
      IE: 1,
    };
    const stopAt = failAt[verdict];

    let peakCpu = 0;
    let peakMem = 0;
    for (let i = 0; i < total; i++) {
      tests[i].state = 'running';
      push();
      await sleep(170 + rand() * 170, opts.signal);
      const m = metrics(req.language, rand);
      peakCpu = Math.max(peakCpu, m.cpuMs);
      peakMem = Math.max(peakMem, m.memoryKb);

      if (stopAt === i + 1) {
        const failCpu = verdict === 'TLE' ? req.problem.timeLimitMs + 4.2 : m.cpuMs;
        const failMem = verdict === 'MLE' ? req.problem.memoryMb * 1024 : m.memoryKb;
        tests[i] = { index: i + 1, state: 'failed', verdict, cpuMs: failCpu, memoryKb: failMem };
        for (let j = i + 1; j < total; j++) tests[j].state = 'skipped';
        push();
        return {
          verdict,
          detail: failureDetail(verdict, i + 1, req.problem, untouched),
          passed: i,
          total,
          failedTest: i + 1,
          cpuMs: failCpu,
          wallMs: verdict === 'TLE' ? Math.round(failCpu * 1.4) : Math.max(1, Math.ceil(failCpu + 0.4)),
          memoryKb: failMem,
          tests,
          raw: runboxJSON(verdict, failCpu, failMem, req.problem),
        };
      }

      tests[i] = { index: i + 1, state: 'passed', verdict: 'AC', cpuMs: m.cpuMs, memoryKb: m.memoryKb };
      push();
    }

    return {
      verdict: 'AC',
      detail: `All ${total} tests passed in the sandbox.`,
      passed: total,
      total,
      cpuMs: peakCpu,
      wallMs: Math.max(1, Math.ceil(peakCpu + 0.4)),
      memoryKb: peakMem,
      tests,
      raw: runboxJSON('AC', peakCpu, peakMem, req.problem),
    };
  }
}

function failureDetail(verdict: Verdict, test: number, problem: Problem, untouched: boolean): string {
  switch (verdict) {
    case 'WA':
      return untouched
        ? `Test ${test}: your program printed nothing. The starter code still needs a solution.`
        : `Test ${test}: the output differs from the expected answer. The sandbox run itself was clean.`;
    case 'TLE':
      return `Test ${test}: CPU time went over the ${problem.timeLimitMs} ms limit.`;
    case 'MLE':
      return `Test ${test}: the cgroup reported an OOM kill at ${problem.memoryMb} MB.`;
    case 'RE':
      return `Test ${test}: killed by SIGSEGV (invalid memory access).`;
    case 'SV':
      return `Test ${test}: a blocked system call was made, and seccomp stopped the process.`;
    case 'OLE':
      return `Test ${test}: stdout went over the ${problem.outputMb} MB output limit.`;
    case 'IE':
      return `Test ${test}: the sandbox could not be set up. This was not caused by your code. Try again.`;
    default:
      return '';
  }
}

function runboxJSON(verdict: Verdict, cpuMs: number, memoryKb: number, problem: Problem): RunboxResult {
  const cpu = Number(cpuMs.toFixed(3));
  const make = (
    v: RunboxResult['verdict'],
    detail: string,
    exit_code: number | null,
    signal: string | null,
    wall_time_ms: number,
    memory_kb = memoryKb,
  ): RunboxResult => ({ verdict: v, detail, exit_code, signal, cpu_time_ms: cpu, wall_time_ms, memory_kb, cgroup: 'v2' });
  switch (verdict) {
    case 'AC':
    case 'WA':
      return make('OK', '', 0, null, Math.ceil(cpuMs + 0.4));
    case 'TLE':
      return make('TLE', 'cpu', null, 'SIGKILL', Math.round(cpuMs * 1.4));
    case 'MLE':
      return make('MLE', 'oom_kill', null, 'SIGKILL', Math.ceil(cpuMs + 1), problem.memoryMb * 1024);
    case 'RE':
      return make('RE', '', null, 'SIGSEGV', Math.ceil(cpuMs + 0.4));
    case 'SV':
      return make('SV', 'seccomp', null, 'SIGSYS', 1);
    case 'OLE':
      return make('OLE', 'stdout', null, 'SIGXFSZ', Math.ceil(cpuMs + 2));
    default:
      return make('IE', 'sandbox setup failed', null, null, 0);
  }
}

export const judge: JudgeClient = API_URL ? new RemoteJudge() : new DemoJudge();
