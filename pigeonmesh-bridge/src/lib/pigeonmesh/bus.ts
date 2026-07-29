// pigeonmesh/bus.ts
// A tiny in-process pub/sub so SSE clients are pushed a record the moment
// it lands, mirroring the on-router daemon's push behaviour. Works in a
// single Node/Vercel serverless instance; for multi-instance fan-out you
// would swap this for Redis pub/sub or Vercel KV.

import type { PmRecord } from "./types";

type Listener = (rec: PmRecord) => void;

const listeners = new Set<Listener>();

export function emitRecord(rec: PmRecord): void {
  for (const l of listeners) {
    try {
      l(rec);
    } catch {
      /* one bad subscriber shouldn't take the rest down */
    }
  }
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function subscriberCount(): number {
  return listeners.size;
}
