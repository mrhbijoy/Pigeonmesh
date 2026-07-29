// Catch-all API route — merges all /api/pigeonmesh/* endpoints into a
// single serverless function so they share the same in-memory state.
//
// On Vercel, each route.ts file becomes a separate serverless function
// with its own module-level state. By using a catch-all route, all
// endpoints share one function → one in-memory Map → consistent state.
//
// This is a trade-off: slightly higher latency (one function handles
// everything) vs. working in-memory state (which is essential for the
// bridge to function without an external database).

import { NextRequest, NextResponse } from "next/server";
import { stateResponse, topology, configResponse } from "@/lib/pigeonmesh/nodeInfo";
import { put, since, missingFrom, digest, recent } from "@/lib/pigeonmesh/store";
import { takeToken, gcBuckets } from "@/lib/pigeonmesh/rate";
import { touchPeer } from "@/lib/pigeonmesh/nodeInfo";
import { NODE_ID } from "@/lib/pigeonmesh/config";
import { subscribe, subscriberCount } from "@/lib/pigeonmesh/bus";
import type { Bloom } from "@/lib/pigeonmesh/bloom";
import type { PmRecord } from "@/lib/pigeonmesh/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const path = req.nextUrl.pathname.replace(/^\/api\/pigeonmesh\/?/, "");

  try {
    if (path === "health" || path === "") {
      return NextResponse.json({ ok: true, node: NODE_ID, time: Math.floor(Date.now() / 1000) });
    }

    if (path === "state") {
      return NextResponse.json(await stateResponse());
    }

    if (path === "topology") {
      return NextResponse.json(await topology());
    }

    if (path === "digest") {
      const b = await digest();
      return NextResponse.json({ digest: b, node: NODE_ID });
    }

    if (path === "config") {
      return NextResponse.json(configResponse());
    }

    if (path === "records") {
      const q = req.nextUrl.searchParams;
      const limit = Math.min(Math.max(Number(q.get("limit") || 300), 1), 1000);
      const filter: { kind?: string; chan?: string } = {};
      if (q.get("kind")) filter.kind = q.get("kind")!;
      if (q.get("chan")) filter.chan = q.get("chan")!;
      const recs = await since(0, limit, filter);
      return NextResponse.json({ records: recs, node: NODE_ID, time: Math.floor(Date.now() / 1000) });
    }

    if (path === "events") {
      return handleSSE(req);
    }

    return NextResponse.json({ error: "no such endpoint" }, { status: 404 });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message || "internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const path = req.nextUrl.pathname.replace(/^\/api\/pigeonmesh\/?/, "");
  const peer = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
  gcBuckets();

  try {
    let payload: any;
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json({ error: "bad json" }, { status: 400 });
    }

    if (path === "records") {
      const list: unknown[] = Array.isArray(payload?.records)
        ? payload.records
        : payload && payload.id ? [payload] : [];
      if (list.length === 0) return NextResponse.json({ error: "no records" }, { status: 400 });
      if (list.length > 64) return NextResponse.json({ error: "too many records" }, { status: 413 });
      if (!takeToken(peer, list.length)) return NextResponse.json({ error: "slow down" }, { status: 429 });

      if (payload?.node && typeof payload.node === "string") {
        await touchPeer({ id: payload.node, name: payload.name, kind: payload.kind, addr: peer });
      }

      const accepted: string[] = [];
      const rejected: { id?: string; why: string }[] = [];
      for (const raw of list) {
        const r = await put(raw, NODE_ID);
        if (r.accepted && r.record) accepted.push(r.record.id);
        else rejected.push({ id: (raw as any)?.id, why: r.reason || "rejected" });
      }
      return NextResponse.json({ accepted, rejected });
    }

    if (path === "sync") {
      if (!takeToken(peer, 4)) return NextResponse.json({ error: "slow down" }, { status: 429 });

      if (payload?.node && typeof payload.node === "string") {
        await touchPeer({
          id: payload.node, name: payload.name, kind: payload.kind, addr: peer,
          battery: payload.battery, records: payload.records,
          uptime: payload.uptime, hops: payload.hops, links: payload.links,
        });
      }

      let taken = 0;
      for (const raw of Array.isArray(payload?.records) ? payload.records : []) {
        const r = await put(raw, payload?.node || NODE_ID);
        if (r.accepted) taken += 1;
      }

      let give: Awaited<ReturnType<typeof missingFrom>> = [];
      if (payload?.digest) {
        give = await missingFrom(payload.digest as Bloom, Number(payload.max_count) || 128, Number(payload.max_bytes) || 131072);
      }

      return NextResponse.json({
        records: give, took: taken,
        digest: await digest(), node: NODE_ID,
        time: Math.floor(Date.now() / 1000),
      });
    }

    return NextResponse.json({ error: "no such endpoint" }, { status: 404 });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message || "internal error" }, { status: 500 });
  }
}

function handleSSE(req: NextRequest): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (ev: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        const seed = await recent(50);
        send("seed", { records: seed });
      } catch {}
      send("hello", { count: subscriberCount() });
      const unsub = subscribe((rec: PmRecord) => {
        try { send("record", rec); } catch {}
      });
      const beat = setInterval(() => {
        try { controller.enqueue(encoder.encode(`: beat ${Date.now()}\n\n`)); } catch {}
      }, 25_000);
      req.signal.addEventListener("abort", () => {
        unsub(); clearInterval(beat);
        try { controller.close(); } catch {}
      });
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
