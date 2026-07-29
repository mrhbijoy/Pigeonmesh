// pigeonmesh/types.ts
// Shared record and node types — wire-compatible with the on-router daemon.

export type RecordKind =
  | "chat"
  | "sos"
  | "checkin"
  | "missing"
  | "pin"
  | "bulletin"
  | "dm"
  | "ack"
  | "profile"
  | "presence";

export const VALID_KINDS: RecordKind[] = [
  "chat",
  "sos",
  "checkin",
  "missing",
  "pin",
  "bulletin",
  "dm",
  "ack",
  "profile",
  "presence",
];

// Lower priority number = more important; 0 is SOS, never evicted under
// storage pressure.
//
// These two tables must agree with store.lua on the router. "ack" was absent
// from both here and there, which gave every "responding" / "resolved" /
// "found" marker an undefined priority and an undefined lifetime. Keep the
// Record<RecordKind, ...> annotations: they are what makes adding a kind
// without filling these in a compile error rather than a NaN in the field.
export const PRIORITY: Record<RecordKind, number> = {
  sos: 0,
  checkin: 1,
  missing: 1,
  bulletin: 1,
  ack: 1,
  pin: 2,
  dm: 2,
  chat: 3,
  profile: 3,
  presence: 4,
};

export const DEFAULT_TTL: Record<RecordKind, number> = {
  sos: 24 * 3600,
  checkin: 7 * 24 * 3600,
  missing: 30 * 24 * 3600,
  bulletin: 7 * 24 * 3600,
  // Outlives the longest thing it can annotate, so a found person does not
  // become missing again when the marker expires before the report.
  ack: 30 * 24 * 3600,
  pin: 30 * 24 * 3600,
  dm: 30 * 24 * 3600,
  chat: 3 * 24 * 3600,
  profile: 30 * 24 * 3600,
  presence: 5 * 60,
};

export interface PmRecord {
  id: string;
  kind: RecordKind;
  ts: number;
  exp?: number;
  chan?: string;
  nick?: string;
  author?: string;
  pk?: string;
  sig?: string;
  origin?: string;
  hops?: number;
  body?: Record<string, unknown> | string;
}

export interface PmNodeInfo {
  node: string;
  name: string;
  version: string;
  kind: string;
  lan: string | null;
  http_port: number;
  uptime: number;
  load: number[];
  mem_free_kb: number | null;
  battery: number | null;
  time: number;
  clock_derived: boolean;
}

export interface PmPeer {
  node: string;
  name: string;
  addr?: string;
  last_seen?: number;
  rtt_ms?: number;
  hops?: number;
  battery?: number | null;
  records?: number;
  uptime?: number;
  direct: boolean;
  links?: string[];
  self?: boolean;
}

export interface PmStoreStats {
  records: number;
  bytes: number;
  max_bytes: number;
  seq: number;
}

export interface PmTopologyNode {
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

export interface PmConfig {
  node: string;
  name: string;
  max_body: number;
  lan: string | null;
  domain: string;
  channels: string[];
}
