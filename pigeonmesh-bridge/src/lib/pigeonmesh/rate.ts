// pigeonmesh/rate.ts
// Per-source token bucket. Identical policy to the on-router daemon: a
// whole classroom of legitimate users stays comfortably under the limit
// while one misbehaving client cannot fill the database.

import { POST_RATE, POST_BURST } from "./config";

interface Bucket {
  tokens: number;
  last: number;
}
const buckets = new Map<string, Bucket>();

const monotonic = () => Date.now() / 1000;

export function takeToken(peer: string, cost: number): boolean {
  const now = monotonic();
  let b = buckets.get(peer);
  if (!b) {
    b = { tokens: POST_BURST, last: now };
    buckets.set(peer, b);
  }
  b.tokens = Math.min(POST_BURST, b.tokens + (now - b.last) * POST_RATE);
  b.last = now;
  if (b.tokens < cost) return false;
  b.tokens -= cost;
  return true;
}

// GC old buckets so a flood of unique IPs doesn't leak forever.
const lastGc = { v: 0 };
export function gcBuckets() {
  const now = monotonic();
  if (now - lastGc.v < 60) return;
  lastGc.v = now;
  for (const [k, b] of buckets) {
    if (now - b.last > 300) buckets.delete(k);
  }
}
