// pigeonmesh/nodeInfo.ts
// Build the /api/state, /api/topology, /api/config responses — the bits of
// the API that describe *this* node, not the records it holds.

import { db } from "@/lib/db";
import {
  BRIDGE_VERSION,
  NODE_ID,
  NODE_NAME,
  HTTP_PORT,
  DOMAIN,
  CHANNELS,
  MAX_BODY,
} from "./config";
import { stats, countByKind } from "./store";

const startedAt = Date.now();

export function nodeInfo() {
  const now = Math.floor(Date.now() / 1000);
  return {
    node: NODE_ID,
    name: NODE_NAME,
    version: BRIDGE_VERSION,
    kind: "bridge",
    lan: null,
    http_port: HTTP_PORT,
    uptime: now - Math.floor(startedAt / 1000),
    load: [0, 0, 0],
    mem_free_kb: null,
    battery: null,
    time: now,
    clock_derived: false, // we run on a real NTP-synced host
  };
}

export async function peerList() {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000); // 10 min
  const rows = await db.node.findMany({
    where: { lastSeen: { gte: cutoff }, id: { not: NODE_ID } },
    orderBy: { lastSeen: "desc" },
    take: 256,
  });
  return rows.map((r) => ({
    node: r.id,
    name: r.name,
    addr: r.addr,
    last_seen: Math.floor(r.lastSeen.getTime() / 1000),
    hops: r.hops ?? undefined,
    battery: r.battery,
    records: r.records ?? undefined,
    uptime: r.uptime ? Number(r.uptime) : undefined,
    direct: !r.remote,
    links: safeParseLinks(r.links),
  }));
}

export async function topology() {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000); // 30 min
  const rows = await db.node.findMany({
    where: { lastSeen: { gte: cutoff } },
    orderBy: { lastSeen: "desc" },
    take: 512,
  });
  const s = await stats();
  const nodes = rows.map((r) => ({
    node: r.id,
    name: r.name,
    self: r.id === NODE_ID,
    battery: r.battery,
    records: r.records ?? undefined,
    uptime: r.uptime ? Number(r.uptime) : undefined,
    hops: r.hops ?? undefined,
    last_seen: Math.floor(r.lastSeen.getTime() / 1000),
    links: safeParseLinks(r.links),
  }));
  // Make sure self is present.
  if (!nodes.find((n) => n.self)) {
    nodes.unshift({
      node: NODE_ID,
      name: NODE_NAME,
      self: true,
      battery: null,
      records: s.records,
      uptime: nodeInfo().uptime,
      // This node, so zero hops away and seen right now. Omitting them left
      // the bridge's own row in the topology with blank columns.
      hops: 0,
      last_seen: Math.floor(Date.now() / 1000),
      links: [],
    });
  }
  return { nodes, time: Math.floor(Date.now() / 1000) };
}

export async function stateResponse() {
  const [s, peers, counts] = await Promise.all([stats(), peerList(), countByKind()]);
  return {
    node: nodeInfo(),
    peers,
    store: s,
    http: { clients: 0 },
    mesh: {
      flooded: 0,
      gossip_rounds: 0,
      carried_in: 0,
      carried_out: 0,
    },
    counts,
  };
}

export function configResponse() {
  return {
    node: NODE_ID,
    name: NODE_NAME,
    max_body: MAX_BODY,
    lan: null,
    domain: DOMAIN,
    channels: CHANNELS,
  };
}

function safeParseLinks(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Record that a peer touched us, so /api/topology can show it.
 *  Tolerates payloads where `records` is an array (we count it) or where
 *  optional fields are missing — both happen with real-world peers. */
export async function touchPeer(opts: {
  id: string;
  name?: string;
  kind?: string;
  addr?: string;
  battery?: number | null;
  records?: number | unknown[];
  uptime?: number;
  hops?: number;
  links?: string[];
}) {
  if (!opts.id || opts.id === NODE_ID) return;
  const records =
    Array.isArray(opts.records) ? opts.records.length : typeof opts.records === "number" ? opts.records : undefined;
  try {
    await db.node.upsert({
      where: { id: opts.id },
      create: {
        id: opts.id,
        name: opts.name || opts.id,
        kind: opts.kind || "router",
        addr: opts.addr,
        battery: typeof opts.battery === "number" ? opts.battery : null,
        records,
        uptime: typeof opts.uptime === "number" ? BigInt(opts.uptime) : null,
        hops: opts.hops,
        links: JSON.stringify(opts.links || []),
        remote: false,
        lastSeen: new Date(),
      },
      update: {
        name: opts.name || undefined,
        kind: opts.kind || undefined,
        addr: opts.addr || undefined,
        battery: typeof opts.battery === "number" ? opts.battery : undefined,
        records: records ?? undefined,
        uptime: typeof opts.uptime === "number" ? BigInt(opts.uptime) : undefined,
        hops: opts.hops ?? undefined,
        links: opts.links ? JSON.stringify(opts.links) : undefined,
        remote: false,
        lastSeen: new Date(),
      },
    });
  } catch (e) {
    // best effort — log so it's debuggable, never crash the request.
    console.warn("[pigeonmesh] touchPeer failed:", (e as Error).message);
  }
}
