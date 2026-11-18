import { z } from "zod";

/** Languages the judge can run. Java is not offered yet: runbox's seccomp
 * allowlist has not been tuned for the JVM. */
export const LANGUAGES = ["cpp", "c", "python"] as const;
export const Language = z.enum(LANGUAGES);
export type Language = z.infer<typeof Language>;

export interface LanguageInfo {
  id: Language;
  label: string;
  /** Monaco language id, used with monaco.editor.setModelLanguage. */
  monaco: string;
  /** Source file name inside the sandbox. */
  source: string;
}

export const LANGUAGE_INFO: Record<Language, LanguageInfo> = {
  cpp: { id: "cpp", label: "C++17", monaco: "cpp", source: "main.cpp" },
  c: { id: "c", label: "C11", monaco: "c", source: "main.c" },
  python: { id: "python", label: "Python 3", monaco: "python", source: "main.py" },
};

/** Max source size accepted at the API boundary. */
export const MAX_SOURCE_BYTES = 64 * 1024;
