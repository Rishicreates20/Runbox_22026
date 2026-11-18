import "server-only";
import postgres from "postgres";

const g = globalThis as unknown as { __codeplusSql?: postgres.Sql };

/** One pool per server process (survives dev hot reloads). */
export const sql =
  g.__codeplusSql ??
  (g.__codeplusSql = postgres(process.env.DATABASE_URL ?? "postgres://codeplus:codeplus@127.0.0.1:5432/codeplus", {
    max: 10,
    onnotice: () => {},
  }));
