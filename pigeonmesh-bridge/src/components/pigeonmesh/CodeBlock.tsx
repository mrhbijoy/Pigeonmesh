"use client";
// CodeBlock — a <pre> with a copy button. Used inside SetupTabs.

import { useState } from "react";

export function CodeBlock({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked — user can still select */
    }
  };
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-md border border-slate-800 bg-slate-950/80 p-3 text-[12px] leading-relaxed text-slate-200">
        <code className="font-mono whitespace-pre">{children}</code>
      </pre>
      <button
        onClick={copy}
        className="absolute right-2 top-2 rounded border border-slate-700 bg-slate-800/80 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-300 transition hover:bg-slate-700"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
