"use client";
// ConnectPanel — the box a router operator looks at first. Shows the
// exact /api/sync URL to point a router at, plus a "send a test record"
// button so the operator can verify the loop end-to-end before they leave
// for the field.

import { useState } from "react";
import { CodeBlock } from "./CodeBlock";

export function ConnectPanel({ bridgeUrl }: { bridgeUrl: string }) {
  const [testText, setTestText] = useState("Test SOS from cloud dashboard");
  const [sending, setSending] = useState(false);
  const [lastResp, setLastResp] = useState<string | null>(null);

  const sendTest = async () => {
    setSending(true);
    setLastResp(null);
    try {
      const id = cryptoRandomHex(16);
      const ts = Math.floor(Date.now() / 1000);
      const rec = {
        id,
        kind: "sos",
        ts,
        exp: ts + 24 * 3600,
        chan: "sos",
        nick: "bridge-test",
        origin: "pm-bridge-test",
        body: { text: testText || "test", source: "dashboard" },
      };
      const r = await fetch("/api/pigeonmesh/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: [rec] }),
      });
      const j = await r.json();
      setLastResp(JSON.stringify(j, null, 2));
    } catch (e: unknown) {
      setLastResp(`error: ${(e as Error).message}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
      <h2 className="text-sm font-semibold text-amber-200">Connect a router to this bridge</h2>
      <p className="mt-1 text-xs text-amber-200/80">
        Any mesh router with internet can sync with this URL. The router keeps running with zero
        internet — this only matters when the uplink is up.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-amber-300/70">Sync URL</div>
          <div className="mt-1 break-all rounded border border-slate-700 bg-slate-950/80 p-2 font-mono text-[11px] text-slate-200">
            {bridgeUrl || "https://your-app.vercel.app"}/api/pigeonmesh/sync
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-amber-300/70">Health URL</div>
          <div className="mt-1 break-all rounded border border-slate-700 bg-slate-950/80 p-2 font-mono text-[11px] text-slate-200">
            {bridgeUrl || "https://your-app.vercel.app"}/api/pigeonmesh/health
          </div>
        </div>
      </div>

      <div className="mt-3">
        <div className="text-[11px] uppercase tracking-wide text-amber-300/70">curl test</div>
        <CodeBlock>{`curl -X POST -H "Content-Type: application/json" \\
  -d '{"node":"pm-test","records":[{"id":"'$RANDOM'0000000000000000","kind":"chat","ts":'$(date +%s)',"chan":"general","nick":"cli-test","body":{"text":"hello from curl"}}]}' \\
  ${bridgeUrl || "https://your-app.vercel.app"}/api/pigeonmesh/records`}</CodeBlock>
      </div>

      <div className="mt-4 rounded-md border border-slate-700 bg-slate-950/40 p-3">
        <div className="text-[11px] uppercase tracking-wide text-slate-400">Send a test SOS from the dashboard</div>
        <div className="mt-2 flex gap-2">
          <input
            value={testText}
            onChange={(e) => setTestText(e.target.value)}
            maxLength={200}
            className="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200 outline-none focus:border-amber-500"
            placeholder="SOS message"
          />
          <button
            onClick={sendTest}
            disabled={sending}
            className="rounded bg-red-500/80 px-3 py-1 text-sm font-medium text-white transition hover:bg-red-500 disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send SOS"}
          </button>
        </div>
        {lastResp && (
          <pre className="mt-2 max-h-32 overflow-auto rounded bg-slate-950 p-2 text-[11px] text-emerald-300">
            {lastResp}
          </pre>
        )}
      </div>
    </section>
  );
}

function cryptoRandomHex(bytes: number): string {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const a = new Uint8Array(bytes);
    crypto.getRandomValues(a);
    return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // fallback
  let s = "";
  for (let i = 0; i < bytes * 2; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}
