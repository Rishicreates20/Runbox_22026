import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function env(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  repoRoot,
  databaseUrl: env("DATABASE_URL", "postgres://codeplus:codeplus@127.0.0.1:5432/codeplus"),
  redisUrl: env("REDIS_URL", "redis://127.0.0.1:6379"),
  runbox: env("RUNBOX_BIN", path.join(repoRoot, "runbox")),
  /** Minimal runtime image: libc/libstdc++ and python3. Submissions run here. */
  runRootfs: env("RUNBOX_ROOTFS", "/var/lib/runbox/rootfs"),
  /** Same plus gcc/g++ (make-rootfs.sh --gcc). Compilers run here. */
  compileRootfs: env("RUNBOX_COMPILE_ROOTFS", "/var/lib/runbox/rootfs-gcc"),
  /** Host scratch space for compiled binaries; root-only. */
  workDir: env("JUDGE_WORKDIR", "/var/lib/codeplus/jobs"),
  concurrency: Number(env("JUDGE_CONCURRENCY", String(Math.max(1, os.availableParallelism() - 1)))),
  workerName: env("JUDGE_NAME", os.hostname()),
  cgroup: env("RUNBOX_CGROUP", "auto"),
};
