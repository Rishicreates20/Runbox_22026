/** Loads problems/*.json (or the files given) through the Zod ingest schema. */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { ProblemIngest, upsertProblem } from "@codeplus/shared";
import { config } from "./config.ts";

const sql = postgres(config.databaseUrl, { onnotice: () => {} });
const dir = path.join(config.repoRoot, "problems");
const files = process.argv.length > 2
  ? process.argv.slice(2)
  : (await readdir(dir)).filter((f) => f.endsWith(".json")).map((f) => path.join(dir, f));

let failed = 0;
for (const file of files) {
  const parsed = ProblemIngest.safeParse(JSON.parse(await readFile(file, "utf8")));
  if (!parsed.success) {
    failed++;
    console.error(`${file}: invalid`);
    for (const i of parsed.error.issues.slice(0, 10)) console.error(`  ${i.path.join(".")}: ${i.message}`);
    continue;
  }
  const id = await upsertProblem(sql, parsed.data);
  console.log(`${parsed.data.slug}: id ${id}, ${parsed.data.tests.length} tests`);
}
await sql.end();
process.exit(failed ? 1 : 0);
