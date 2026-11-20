import type { SplitQuestion } from './paper';
import type { Difficulty, Sample } from './types';

/** One question from an uploaded paper, as the review step edits it. */
export interface QuestionDraft {
  key: string;
  include: boolean;
  title: string;
  difficulty: Difficulty;
  statement: string;
  input: string;
  output: string;
  constraints: string;
  samples: Sample[];
}

const SECTION = /^\s*(?:\*\*)?\s*(input(?:\s*format)?|output(?:\s*format)?|constraints?|sample|examples?|explanation)\b\s*(?:\*\*)?\s*(?:format)?\s*[:.\-–]?\s*(.*)$/i;
const SAMPLE_HEAD = /^\s*(?:sample|example|test\s*case)/i;

/**
 * Splits a question's text into the parts a problem page shows: the task,
 * the input and output formats, and constraints. Everything from the first
 * sample onwards is dropped from the text, since the samples are shown
 * (and judged) separately.
 */
export function toDraft(q: SplitQuestion, index: number): QuestionDraft {
  const parts: Record<'statement' | 'input' | 'output' | 'constraints', string[]> = { statement: [], input: [], output: [], constraints: [] };
  let into: keyof typeof parts = 'statement';
  const firstIn = q.examples[0]?.input.trim().split('\n')[0]?.trim();
  const lines = q.statement.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (SAMPLE_HEAD.test(line)) break;
    const m = SECTION.exec(line);
    if (m) {
      const word = m[1].toLowerCase();
      // A bare "Input" followed by the first sample's data is a sample, not the input format.
      const next = (m[2] || lines[i + 1] || '').trim();
      if (/^(input|output)$/.test(word) && firstIn && next === firstIn) break;
      if (word.startsWith('input')) into = 'input';
      else if (word.startsWith('output')) into = 'output';
      else if (word.startsWith('constraint')) into = 'constraints';
      else break; // explanation / examples
      if (m[2]) parts[into].push(m[2]);
      continue;
    }
    parts[into].push(line);
  }
  const join = (xs: string[]) => xs.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const title = q.title.trim() || `Question ${index + 1}`;
  return {
    key: `${index}-${title}`,
    include: true,
    title: (title.length < 3 ? `Question ${title}` : title).slice(0, 80),
    difficulty: q.difficulty ? ((q.difficulty[0].toUpperCase() + q.difficulty.slice(1)) as Difficulty) : 'Medium',
    statement: join(parts.statement) || q.statement.trim(),
    input: join(parts.input),
    output: join(parts.output),
    constraints: join(parts.constraints),
    samples: q.examples.slice(0, 10).map((e) => ({ input: e.input, output: e.output })),
  };
}

/** Problem pages render one paragraph per entry: keep the PDF's line breaks. */
export function statementParagraphs(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/** First sentence of the task, for the problem list. */
export function summaryOf(statement: string): string {
  const flat = statement.replace(/\s+/g, ' ').trim();
  const sentence = /^(.{20,}?[.!?])(\s|$)/.exec(flat)?.[1] ?? flat;
  return sentence.length > 200 ? `${sentence.slice(0, 197)}…` : sentence;
}
