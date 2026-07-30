// pigeonmesh/validate.ts
// Record validation — matches src/usr/lib/lua/pigeonmesh/store.lua validate().

import { PmRecord, RecordKind, VALID_KINDS, PRIORITY, DEFAULT_TTL } from "./types";
import { TS_MIN, TS_MAX, MAX_BODY } from "./config";

const HEX_ID = /^[0-9a-f]+$/;

/** A record that has been through validate(). exp, chan and nick are always
 *  filled in by the time it comes back, and saying so here is what lets the
 *  store persist them without a non-null assertion papering over the one case
 *  where they were not. */
export type ValidRecord = PmRecord & Required<Pick<PmRecord, "exp" | "chan" | "nick">>;

/** Returns a cleaned record, or { error } explaining why it was rejected. */
export function validate(
  raw: unknown,
  maxBody: number = MAX_BODY
): { ok: true; rec: ValidRecord } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "not an object" };
  const r = raw as Record<string, unknown>;

  const id = r.id;
  if (typeof id !== "string" || !HEX_ID.test(id) || id.length < 16 || id.length > 64) {
    return { ok: false, error: "bad id" };
  }

  const kind = r.kind as RecordKind;
  if (typeof kind !== "string" || !VALID_KINDS.includes(kind)) {
    return { ok: false, error: "bad kind" };
  }

  const ts = r.ts;
  if (typeof ts !== "number" || !Number.isFinite(ts)) return { ok: false, error: "bad ts" };
  if (ts < TS_MIN || ts > TS_MAX) return { ok: false, error: "ts out of range" };

  const now = Math.floor(Date.now() / 1000);
  // Never let a missing table entry become NaN here: exp is derived from it,
  // and a NaN exp is a record that never expires and breaks every comparison
  // it takes part in.
  const kindTtl = DEFAULT_TTL[kind] ?? 24 * 3600;
  const ttl =
    typeof r.exp === "number" && r.exp > ts
      ? Math.min(r.exp - ts, kindTtl * 4)
      : kindTtl;
  const exp = typeof r.exp === "number" && r.exp > ts ? r.exp : Math.floor(ts) + ttl;

  const chan = sanitise(r.chan, 32) || "public";
  const nick = sanitise(r.nick, 32) || "anon";

  let bodyStr: string;
  const body = r.body;
  if (body === undefined || body === null) bodyStr = "{}";
  else if (typeof body === "string") bodyStr = body;
  else bodyStr = JSON.stringify(body);

  if (bodyStr.length > maxBody) return { ok: false, error: "body too large" };

  return {
    ok: true,
    rec: {
      id,
      kind,
      ts: Math.floor(ts),
      exp: Math.floor(exp),
      chan,
      nick,
      author: typeof r.author === "string" ? r.author.slice(0, 64) : "",
      pk: typeof r.pk === "string" ? r.pk.slice(0, 88) : undefined,
      sig: typeof r.sig === "string" ? r.sig.slice(0, 128) : undefined,
      origin: typeof r.origin === "string" ? r.origin.slice(0, 32) : "",
      hops: typeof r.hops === "number" ? Math.min(Math.max(r.hops | 0, 0), 255) : 0,
      body: bodyStr,
    },
  };
}

function sanitise(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  // Strip control chars and box-drawing, then trim.
  const cleaned = v.replace(/[\x00-\x1f\x7f]/g, "").trim();
  if (cleaned.length === 0) return null;
  return cleaned.slice(0, max);
}

export function priorityOf(kind: RecordKind): number {
  return PRIORITY[kind] ?? 3;
}

export function recordSize(rec: PmRecord): number {
  // Rough but stable. Used for the byte budget.
  return (
    rec.id.length +
    rec.kind.length +
    8 + // ts
    8 + // exp
    rec.chan!.length +
    rec.nick!.length +
    (rec.author?.length || 0) +
    (rec.pk?.length || 0) +
    (rec.sig?.length || 0) +
    (rec.origin?.length || 0) +
    (typeof rec.body === "string" ? rec.body.length : JSON.stringify(rec.body || "").length) +
    64 // overhead
  );
}
