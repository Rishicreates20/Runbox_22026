/**
 * Output checker used by the judge. Trailing spaces on a line and trailing
 * blank lines are ignored (the usual online-judge rule); everything else,
 * including token order and inner whitespace, must match.
 */
export function canonicalOutput(s: string): string {
  const lines = s.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/[ \t]+$/, ""));
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

export function outputsMatch(actual: string, expected: string): boolean {
  return canonicalOutput(actual) === canonicalOutput(expected);
}

/** Shortens long text for display, keeping the start. */
export function clip(s: string, max = 2000): string {
  return s.length <= max ? s : `${s.slice(0, max)}\n… (${s.length - max} more characters)`;
}
