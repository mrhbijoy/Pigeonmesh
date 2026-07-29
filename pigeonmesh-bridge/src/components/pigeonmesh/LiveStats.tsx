"use client";
// LiveStats — polls /api/pigeonmesh/state every 10s and renders the
// overview cards: total records, active SOS, missing persons, peers,
// bytes stored. Also shows per-kind breakdown bars.

import { useEffect, useState } from "react";
import { BoltIcon, UsersIcon, DatabaseIcon, MapPinIcon, ShieldIcon } from "./icons";

interface StateData {
  node: { node: string; name: string; version: string; uptime: number };
  peers: { node: string; name: string; direct: boolean; last_seen?: number }[];
  store: { records: number; bytes: number; max_bytes: number; seq: number };
  counts: Record<string, number>;
}

export function LiveStats() {
  const [data, setData] = useState<StateData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch("/api/pigeonmesh/state", { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as StateData;
        if (alive) {
          setData(j);
          setErr(null);
        }
      } catch (e: unknown) {
        if (alive) setErr((e as Error).message);
      }
    };
    poll();
    const id = setInterval(poll, 10_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (err && !data) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-300">
        Could not reach bridge: <code className="font-mono">{err}</code>
      </div>
    );
  }

  const c = data?.counts || {};
  const total = data?.store.records ?? 0;
  const bytes = data?.store.bytes ?? 0;
  const peers = data?.peers.length ?? 0;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Stat
        icon={<DatabaseIcon className="text-amber-400" />}
        label="Records"
        value={total.toLocaleString()}
        sub={`${(bytes / 1024).toFixed(0)} KB stored`}
      />
      <Stat
        icon={<BoltIcon className="text-red-400" />}
        label="Active SOS"
        value={(c.sos || 0).toLocaleString()}
        sub="priority 0 · 24h ttl"
        tone="sos"
      />
      <Stat
        icon={<UsersIcon className="text-sky-400" />}
        label="Missing"
        value={(c.missing || 0).toLocaleString()}
        sub="replicated mesh-wide"
      />
      <Stat
        icon={<ShieldIcon className="text-emerald-400" />}
        label="Safe check-ins"
        value={(c.checkin || 0).toLocaleString()}
        sub="searchable"
      />
      <Stat
        icon={<MapPinIcon className="text-fuchsia-400" />}
        label="Peers"
        value={peers.toLocaleString()}
        sub="linked routers"
      />

      {/* kind breakdown bar */}
      <div className="col-span-2 mt-1 sm:col-span-3 lg:col-span-5">
        <KindBar counts={c} total={total} />
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: "sos";
}) {
  return (
    <div
      className={`rounded-lg border bg-slate-900/60 p-3 backdrop-blur ${
        tone === "sos" ? "border-red-500/40 bg-red-500/5" : "border-slate-800"
      }`}
    >
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-slate-400">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

const KIND_COLORS: Record<string, string> = {
  sos: "#ef4444",
  checkin: "#10b981",
  missing: "#0ea5e9",
  pin: "#a855f7",
  bulletin: "#f59e0b",
  chat: "#64748b",
  dm: "#ec4899",
  ack: "#14b8a6",
  profile: "#6366f1",
  presence: "#475569",
};

function KindBar({ counts, total }: { counts: Record<string, number>; total: number }) {
  const entries = Object.entries(counts).filter(([, n]) => n > 0);
  if (total === 0 || entries.length === 0) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-xs text-slate-500">
        No records yet. The first SOS, check-in or chat posted by any bridged router will appear here.
      </div>
    );
  }
  entries.sort((a, b) => b[1] - a[1]);
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <div className="flex h-2 overflow-hidden rounded-full bg-slate-800">
        {entries.map(([k, n]) => (
          <div
            key={k}
            style={{ width: `${(n / total) * 100}%`, background: KIND_COLORS[k] || "#475569" }}
            title={`${k}: ${n}`}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
        {entries.map(([k, n]) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: KIND_COLORS[k] || "#475569" }}
            />
            <span className="font-mono">{k}</span>
            <span className="tabular-nums text-slate-500">{n}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
