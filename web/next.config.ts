import type { NextConfig } from "next";

const config: NextConfig = {
  // The shared package ships TypeScript source.
  transpilePackages: ["@codeplus/shared"],
  // Postgres and Redis clients stay as Node modules on the server.
  serverExternalPackages: ["ioredis", "postgres"],
  poweredByHeader: false,
};

export default config;
