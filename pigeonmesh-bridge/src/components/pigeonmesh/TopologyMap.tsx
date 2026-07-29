"use client";
// TopologyMap — fetches /api/pigeonmesh/topology and renders an SVG graph
// of every node the bridge has seen. The bridge node sits at the centre;
// every router that has synced with it orbits it. This is a static layout
// because real mesh maps change slowly and a coordinator needs to be able
// to find the same node in the same place twice.

import { useEffect, useState } from "react";

interface TNode {
  node: string;
  name: string;
  self?: boolean;
  battery?: number | null;
  records?: number;
  uptime?: number;
  hops?: number;
  last_seen?: number;
  links: string[];
}

export function TopologyMap() {
  const [nodes, setNodes] = useState<TNode[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch("/api/pigeonmesh/topology", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { nodes: TNode[] };
        if (alive) {
          setNodes(j.nodes || []);
          setLoading(false);
        }
      } catch {
        /* ignore */
      }
    };
    poll();
    const id = setInterval(poll, 15_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const self = nodes.find((n) => n.self) || nodes[0];
  const others = nodes.filter((n) => n !== self);

  // Simple radial layout: self in the centre, others on rings by hops.
  const placed = placeRadial(self, others);

  if (loading) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-500">
        Loading mesh topology…
      </div>
    );
  }

  if (others.length === 0) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-400">
        <div className="font-mono text-xs text-amber-400">{self?.node || "pm-bridge"}</div>
        <p className="mt-1">
          No routers have synced with this bridge yet. Once a router calls
          <code className="mx-1 font-mono text-slate-300">/api/pigeonmesh/sync</code>
          it will appear here as a connected node.
        </p>
      </div>
    );
  }

  const W = 320;
  const H = Math.max(220, 60 + Math.ceil(others.length / 8) * 80);

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">Mesh topology</h2>
        <span className="text-[11px] text-slate-500">
          {nodes.length} node{nodes.length === 1 ? "" : "s"}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
        {/* edges */}
        {placed.map((p) => (
          <line
            key={`e-${p.node.node}`}
            x1={W / 2}
            y1={H / 2}
            x2={p.x}
            y2={p.y}
            stroke="#1e293b"
            strokeWidth="1"
            strokeDasharray={p.node.hops && p.node.hops > 1 ? "3,3" : undefined}
          />
        ))}
        {/* nodes */}
        {placed.map((p) => (
          <g key={`n-${p.node.node}`} transform={`translate(${p.x},${p.y})`}>
            <circle
              r={p.node.self ? 8 : 5}
              fill={p.node.self ? "#f59e0b" : kindToColor(p.node)}
              stroke="#0b1220"
              strokeWidth="2"
            />
            <text
              y={p.node.self ? 22 : 16}
              textAnchor="middle"
              fontSize="9"
              fontFamily="ui-monospace, monospace"
              fill="#94a3b8"
            >
              {p.node.name.length > 14 ? p.node.name.slice(0, 13) + "…" : p.node.name}
            </text>
            {typeof p.node.records === "number" && p.node.records > 0 && (
              <text
                y={p.node.self ? 32 : 26}
                textAnchor="middle"
                fontSize="8"
                fill="#475569"
              >
                {p.node.records} rec
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

function kindToColor(n: TNode): string {
  if (n.battery != null && n.battery < 20) return "#ef4444";
  if (n.hops && n.hops > 1) return "#64748b";
  return "#10b981";
}

function placeRadial(self: TNode | undefined, others: TNode[]) {
  if (!self) return [];
  const W = 320;
  const H = Math.max(220, 60 + Math.ceil(others.length / 8) * 80);
  const cx = W / 2;
  const cy = H / 2;
  return others.map((n, i) => {
    const ring = n.hops && n.hops > 1 ? 2 : 1;
    const ringR = ring === 1 ? 70 : 110;
    const onRing = i % 8;
    const angle = (onRing / 8) * Math.PI * 2 + (ring === 2 ? Math.PI / 8 : 0);
    return {
      node: n,
      x: cx + Math.cos(angle) * ringR,
      y: cy + Math.sin(angle) * ringR,
    };
  });
}
