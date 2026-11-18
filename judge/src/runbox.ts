import { spawn } from "node:child_process";
import { config } from "./config.ts";

/** One runbox verdict, as printed on its stdout. */
export interface RunboxResult {
  verdict: "OK" | "TLE" | "MLE" | "RE" | "SV" | "OLE" | "IE";
  detail: string;
  exit_code: number;
  signal: string | null;
  cpu_time_ms: number;
  wall_time_ms: number;
  memory_kb: number;
  stdout: Buffer;
  stdout_truncated: boolean;
  stderr: string;
  exported: boolean;
}

export interface RunboxOptions {
  rootfs: string;
  timeMs: number;
  wallMs?: number;
  memMb: number;
  pids?: number;
  output?: string;
  files: [hostPath: string, sandboxPath: string][];
  exports?: [sandboxPath: string, hostPath: string][];
  /** Raw stdin bytes; sent base64-encoded on runbox's own stdin. */
  stdin?: Buffer;
  argv: string[];
}

/** Runs one program in the sandbox and parses the verdict line. */
export function runbox(o: RunboxOptions): Promise<RunboxResult> {
  const args = [
    "--rootfs", o.rootfs,
    "--cgroup", config.cgroup,
    "--time", String(o.timeMs),
    "--wall", String(o.wallMs ?? o.timeMs * 2 + 1000),
    "--mem", `${o.memMb}M`,
    "--pids", String(o.pids ?? 16),
    "--output", o.output ?? "16M",
    "--stdin-b64", "-",
  ];
  for (const [src, dst] of o.files) args.push("--file", `${src}:${dst}`);
  for (const [src, dst] of o.exports ?? []) args.push("--export", `${src}:${dst}`);
  args.push("--", ...o.argv);

  return new Promise((resolve) => {
    const child = spawn(config.runbox, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (b: Buffer) => out.push(b));
    child.stderr.on("data", (b: Buffer) => err.push(b));
    child.stdin.on("error", () => {}); // runbox may exit before reading all of stdin
    child.stdin.end((o.stdin ?? Buffer.alloc(0)).toString("base64"));
    const fail = (detail: string): RunboxResult => ({
      verdict: "IE", detail, exit_code: -1, signal: null, cpu_time_ms: 0, wall_time_ms: 0,
      memory_kb: 0, stdout: Buffer.alloc(0), stdout_truncated: false, stderr: "", exported: false,
    });
    child.on("error", (e) => resolve(fail(`could not start runbox: ${e.message}`)));
    child.on("close", () => {
      const text = Buffer.concat(out).toString("utf8").trim();
      try {
        const r = JSON.parse(text);
        resolve({
          ...r,
          stdout: Buffer.from(r.stdout_b64 ?? "", "base64"),
          stderr: Buffer.from(r.stderr_b64 ?? "", "base64").toString("utf8"),
          exported: Boolean(r.exported),
        });
      } catch {
        resolve(fail(`runbox printed no verdict: ${Buffer.concat(err).toString("utf8").slice(0, 500)}`));
      }
    });
  });
}
