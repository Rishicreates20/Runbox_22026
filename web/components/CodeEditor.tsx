"use client";

import Editor, { loader, type OnMount } from "@monaco-editor/react";

// Monaco is self-hosted under /monaco/vs (copied by scripts/copy-monaco.mjs).
// Its AMD loader fetches the editor and its web workers from there, so the
// bundler never touches Monaco and the workers resolve from our own origin.
loader.config({ paths: { vs: "/monaco/vs" } });

export interface CodeEditorProps {
  defaultLanguage: string;
  defaultValue: string;
  onMount: OnMount;
  onChange: (value: string) => void;
}

/** Imported only through next/dynamic with ssr:false: Monaco needs window. */
export default function CodeEditor({ defaultLanguage, defaultValue, onMount, onChange }: CodeEditorProps) {
  return (
    <Editor
      theme="vs-dark"
      defaultLanguage={defaultLanguage}
      defaultValue={defaultValue}
      onMount={onMount}
      onChange={(v) => onChange(v ?? "")}
      loading={<div className="editor-loading">Loading editor…</div>}
      options={{
        fontSize: 14,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 4,
        padding: { top: 10 },
      }}
    />
  );
}
