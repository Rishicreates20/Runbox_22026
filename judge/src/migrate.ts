import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { config } from "./config.ts";

const sql = postgres(config.databaseUrl, { onnotice: () => {} });
await sql.unsafe(await readFile(path.join(config.repoRoot, "db/schema.sql"), "utf8"));
console.log("schema applied");
await sql.end();
