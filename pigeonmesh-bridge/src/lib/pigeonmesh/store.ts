// pigeonmesh/store.ts
// Prisma-backed record store. Mirrors the surface the on-router Lua store
// exposes: put, since, recent, digest, missing_from, stats. Reads are
// cheap; writes are append-only and never mutate.

import { db } from "@/lib/db";
import { Bloom, bloomBuild, bloomContains } from "./bloom";
import { PmRecord, RecordKind } from "./types";
import { validate, priorityOf, recordSize } from "./validate";
import { MAX_BYTES, NODE_ID } from "./config";
import { emitRecord } from "./bus";

let digestCache: Bloom | null = null;
let digestDirty = true;
let cachedSeq = 0;
let cachedBytes = 0;

async function loadSeq(): Promise<number> {
  if (cachedSeq) return cachedSeq;
  // Prisma can't give us a rowid sequence, so we approximate with row count.
  // The exact value is not load-bearing; it just primes /api/state.
  const c = await db.record.count();
  cachedSeq = c;
  return c;
}

async function loadBytes(): Promise<number> {
  if (cachedBytes) return cachedBytes;
  const r = await db.record.aggregate({ _sum: { size: true } });
  // _sum is null when there are no rows at all, not just when the sum is zero.
  cachedBytes = r._sum?.size ?? 0;
  return cachedBytes;
}

export interface PutResult {
  accepted: boolean;
  reason?: string;
  record?: PmRecord;
}

/** Insert a record. Returns {accepted:false, reason} on duplicate or
 *  validation failure — never throws. */
export async function put(raw: unknown, origin?: string): Promise<PutResult> {
  const v = validate(raw);
  if (!v.ok) return { accepted: false, reason: v.error };

  const rec = v.rec;
  rec.origin = rec.origin || origin || NODE_ID;

  // Reject already-expired records so a peer can't drain us by handing
  // over a backlog of stale entries.
  const now = Math.floor(Date.now() / 1000);
  if (rec.exp <= now) return { accepted: false, reason: "expired" };

  const size = recordSize(rec);
  const prio = priorityOf(rec.kind);

  try {
    await db.record.create({
      data: {
        id: rec.id,
        kind: rec.kind,
        ts: BigInt(rec.ts),
        exp: BigInt(rec.exp),
        chan: rec.chan!,
        nick: rec.nick!,
        author: rec.author || "",
        pk: rec.pk,
        sig: rec.sig,
        origin: rec.origin,
        hops: rec.hops || 0,
        body: typeof rec.body === "string" ? rec.body : JSON.stringify(rec.body || {}),
        prio,
        size,
      },
    });
  } catch (e: unknown) {
    const msg = (e as Error).message || "";
    if (msg.includes("Unique constraint")) return { accepted: false, reason: "duplicate" };
    return { accepted: false, reason: "db error" };
  }

  cachedSeq += 1;
  cachedBytes += size;
  digestDirty = true;

  // Drop expired records in the background. Cheap, bounded, and keeps the
  // store from leaking under sustained write load.
  void evictExpired();

  // Push to any open SSE listeners.
  emitRecord(rec);

  return { accepted: true, record: rec };
}

export async function evictExpired(): Promise<number> {
  const now = BigInt(Math.floor(Date.now() / 1000));
  try {
    const r = await db.record.deleteMany({ where: { exp: { lte: now } } });
    if (r.count > 0) {
      digestDirty = true;
      cachedBytes = 0; // force recompute
    }
    return r.count;
  } catch {
    return 0;
  }
}

export async function since(
  sinceSeq: number,
  limit: number,
  filter?: { kind?: string; chan?: string }
): Promise<PmRecord[]> {
  const cap = Math.min(Math.max(limit, 1), 1000);
  // We don't have a true seq column, so use createdAt as a proxy.
  const rows = await db.record.findMany({
    where: {
      ...(filter?.kind ? { kind: filter.kind } : {}),
      ...(filter?.chan ? { chan: filter.chan } : {}),
    },
    orderBy: { ts: "desc" },
    take: cap,
  });
  // Oldest first to match the daemon's behaviour.
  return rows.reverse().map(rowToRecord);
}

export async function recent(limit: number, filter?: { kind?: string; chan?: string }): Promise<PmRecord[]> {
  const cap = Math.min(Math.max(limit, 1), 1000);
  const rows = await db.record.findMany({
    where: {
      ...(filter?.kind ? { kind: filter.kind } : {}),
      ...(filter?.chan ? { chan: filter.chan } : {}),
    },
    orderBy: { ts: "desc" },
    take: cap,
  });
  return rows.map(rowToRecord);
}

export async function digest(): Promise<Bloom> {
  if (digestCache && !digestDirty) return digestCache;
  const rows = await db.record.findMany({ select: { id: true } });
  const ids = rows.map((r) => r.id);
  const b = bloomBuild(ids);
  digestCache = b;
  digestDirty = false;
  return b;
}

/** Records we hold that the peer's Bloom says it lacks, priority-ordered. */
export async function missingFrom(
  bloom: Bloom,
  maxCount: number,
  maxBytes: number
): Promise<PmRecord[]> {
  const cap = Math.min(Math.max(maxCount, 1), 256);
  const byteCap = Math.min(Math.max(maxBytes, 1024), 1024 * 1024);
  // We can't push the whole table through bloomContains in SQL, so page.
  // For a cloud bridge with up to ~100k records this is still cheap.
  const out: PmRecord[] = [];
  let bytes = 0;
  let skip = 0;
  const pageSize = 500;
  while (out.length < cap) {
    const rows = await db.record.findMany({
      orderBy: [{ prio: "asc" }, { ts: "desc" }],
      skip,
      take: pageSize,
    });
    if (rows.length === 0) break;
    skip += rows.length;
    for (const row of rows) {
      if (out.length >= cap) break;
      if (bloomContains(bloom, row.id)) continue;
      const rec = rowToRecord(row);
      const sz = recordSize(rec);
      if (bytes + sz > byteCap) return out;
      out.push(rec);
      bytes += sz;
    }
  }
  return out;
}

export async function stats() {
  const [count, bytes] = await Promise.all([db.record.count(), loadBytes()]);
  return {
    records: count,
    bytes,
    max_bytes: MAX_BYTES,
    seq: await loadSeq(),
  };
}

export async function countByKind(): Promise<Record<string, number>> {
  const rows = await db.record.groupBy({ by: ["kind"], _count: { _all: true } });
  const out: Record<string, number> = {};
  for (const r of rows) {
    // Prisma types _count as a union of a bare number and a per-field object
    // depending on how it was asked for; accept either rather than assert.
    const c: unknown = r._count;
    out[r.kind] = typeof c === "number"
      ? c
      : (c && typeof c === "object" && typeof (c as { _all?: unknown })._all === "number")
        ? (c as { _all: number })._all
        : 0;
  }
  return out;
}

function rowToRecord(row: any): PmRecord {
  return {
    id: row.id,
    kind: row.kind as RecordKind,
    ts: Number(row.ts),
    exp: Number(row.exp),
    chan: row.chan,
    nick: row.nick,
    author: row.author || undefined,
    pk: row.pk || undefined,
    sig: row.sig || undefined,
    origin: row.origin || undefined,
    hops: row.hops,
    body: row.body,
  };
}
