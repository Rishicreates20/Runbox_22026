import type { NextConfig } from "next";

const config: NextConfig = {
  // The shared package ships TypeScript source.
  transpilePackages: ["@codeplus/shared"],
  // Postgres and Redis clients stay as Node modules on the server.
  // So are the document parsers used to import mock papers.
  serverExternalPackages: ["ioredis", "postgres", "mammoth", "turndown", "turndown-plugin-gfm", "jszip", "unpdf"],
  poweredByHeader: false,
  // The Docker image ships the self-contained server (Dockerfile sets this).
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
};

export default config;
