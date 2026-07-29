"use client";
// RecordFeed — subscribes to /api/pigeonmesh/events (SSE) and renders an
// auto-updating record stream. Mirrors the on-device PWA's chat view but
// shows every kind, so a coordinator sees SOS, missing, check-in, chat
// and bulletin traffic in one timeline.

import { useEffect, useMemo, useRef, useState } from "react";
import type { PmRecord, RecordKind } from "@/lib/pigeonmesh/types";

type Filter = "all" | RecordKind;
const FILTERS: Filter[] = ["all", "sos", "missing", "checkin", "bulletin", "chat"];

const KIND_LABEL: Record<string, string> = {
  sos: "SOS",
  missing: "MISSING",
  checkin: "SAFE",
  bulletin: "BULLETIN",
  chat: "CHAT",
  pin: "PIN",
  dm: "DM",
  ack: "ACK",
  profile: "PROFILE",
  presence: "PRESENCE",
};

const KIND_COLOR: Record<string, string> = {
  sos: "border-red-500/40 bg-red-500/10 text-red-300",
  missing: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  checkin: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  bulletin: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  chat: "border-slate-600/40 bg-slate-700/30 text-slate-300",
  pin: "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300",
  dm: "border-pink-500/40 bg-pink-500/10 text-pink-300",
  ack: "border-teal-500/40 bg-teal-500/10 text-teal-300",
  profile: "border-indigo-500/40 bg-indigo-500/10 text-indigo-300",
  presence: "border-slate-500/40 bg-slate-500/10 text-slate-300",
};

export function RecordFeed() {
  const [records, setRecords] = useState<PmRecord[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    const es = new EventSource("/api/pigeonmesh/events");
    es.addEventListener("hello", () => setConnected(true));
    es.addEventListener("seed", (e: MessageEvent) => {
      try {
        const j = JSON.parse(e.data);
        if (Array.isArray(j.records)) {
          setRecords((prev) => dedupe([...j.records, ...prev]).slice(0, 200));
        }
      } catch {
        /* ignore */
      }
    });
    es.addEventListener("record", (e: MessageEvent) => {
      if (pausedRef.current) return;
      try {
        const rec = JSON.parse(e.data) as PmRecord;
        setRecords((prev) => dedupe([rec, ...prev]).slice(0, 200));
      } catch {
        /* ignore */
      }
    });
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, []);

  const filtered = useMemo(
    () => (filter === "all" ? records : records.filter((r) => r.kind === filter)),
    [records, filter]
  );

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/60 backdrop-blur">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 p-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-200">Live feed</h2>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] uppercase ${
              connected
                ? "bg-emerald-500/10 text-emerald-300"
                : "bg-slate-700/50 text-slate-400"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                connected ? "animate-pulse bg-emerald-400" : "bg-slate-500"
              }`}
            />
            {connected ? "SSE live" : "connecting…"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPaused((p) => !p)}
            className="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800"
          >
            {paused ? "Resume" : "Pause"}
          </button>
        </div>
      </header>

      <div className="flex flex-wrap gap-1 border-b border-slate-800 p-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
              filter === f
                ? "bg-amber-500/20 text-amber-300"
                : "text-slate-400 hover:bg-slate-800"
            }`}
          >
            {f === "all" ? "all" : KIND_LABEL[f] || f}
          </button>
        ))}
      </div>

      <div className="max-h-[28rem] overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            Waiting for the first record from a bridged mesh…
            <div className="mt-2 text-xs text-slate-600">
              POST a record to <code className="font-mono text-slate-400">/api/pigeonmesh/records</code> to see it here.
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-slate-800/70">
            {filtered.map((r) => (
              <RecordRow key={r.id} r={r} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function RecordRow({ r }: { r: PmRecord }) {
  const body = parseBody(r.body);
  const text =
    (typeof body?.text === "string" && body.text) ||
    (typeof body?.msg === "string" && body.msg) ||
    (typeof body?.name === "string" && body.name) ||
    JSON.stringify(body);
  const geo = body?.lat != null && body?.lon != null ? `${body.lat}, ${body.lon}` : null;
  return (
    <li className="flex gap-3 p-3 text-sm">
      <div className="w-20 shrink-0">
        <span
          className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
            KIND_COLOR[r.kind] || "border-slate-600 text-slate-300"
          }`}
        >
          {KIND_LABEL[r.kind] || r.kind}
        </span>
        <div className="mt-1 text-[10px] text-slate-500">{timeAgo(r.ts)}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate font-medium text-slate-200">{r.nick || "anon"}</span>
          <span className="font-mono text-[10px] text-slate-600">#{r.chan || "public"}</span>
          {r.origin && (
            <span className="font-mono text-[10px] text-slate-700">{r.origin}</span>
          )}
        </div>
        <p className="mt-0.5 break-words text-slate-300">{text}</p>
        {geo && (
          <p className="mt-0.5 font-mono text-[10px] text-slate-500">📍 {geo}</p>
        )}
      </div>
    </li>
  );
}

function parseBody(b: PmRecord["body"]): Record<string, unknown> | null {
  if (!b) return null;
  if (typeof b === "string") {
    try {
      return JSON.parse(b);
    } catch {
      return { text: b };
    }
  }
  return b as Record<string, unknown>;
}

function dedupe(recs: PmRecord[]): PmRecord[] {
  const seen = new Set<string>();
  const out: PmRecord[] = [];
  for (const r of recs) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

function timeAgo(ts: number): string {
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 5) return "now";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
