// Self-hosts Monaco: copies monaco-editor's prebuilt AMD bundle (editor,
// language services and their web workers) to public/monaco/vs. The editor
// loads from there at runtime, so neither webpack nor Turbopack ever bundles
// Monaco or has to route its workers, and nothing loads from a third-party CDN.
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const pkg = require.resolve("monaco-editor/package.json");
const { version } = JSON.parse(readFileSync(pkg, "utf8"));
const src = path.join(path.dirname(pkg), "min", "vs");
const dst = path.resolve("public", "monaco", "vs");
const stamp = path.resolve("public", "monaco", "VERSION");

if (existsSync(stamp) && readFileSync(stamp, "utf8") === version) process.exit(0);
rmSync(path.dirname(dst), { recursive: true, force: true });
cpSync(src, dst, { recursive: true });
writeFileSync(stamp, version);
console.log(`monaco-editor ${version} copied to public/monaco/vs`);
