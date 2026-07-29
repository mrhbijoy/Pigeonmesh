// In-memory database that mirrors the Prisma interface used by the
// pigeonmesh store. Used on Vercel (and other serverless hosts) where
// SQLite-on-disk doesn't persist between invocations.

interface RecordRow {
  id: string; kind: string; ts: bigint; exp: bigint; chan: string;
  nick: string; author: string; pk: string | null; sig: string | null;
  origin: string; hops: number; body: string; prio: number; size: number;
  createdAt: Date;
}

interface NodeRow {
  id: string; name: string; kind: string; lastSeen: Date;
  battery: number | null; hops: number | null; records: number | null;
  uptime: bigint | null; links: string; remote: boolean; addr: string | null;
}

const records = new Map<string, RecordRow>();
const nodes = new Map<string, NodeRow>();

export const db = {
  record: {
    async create({ data }: { data: any }) {
      const row = { ...data, createdAt: data.createdAt || new Date() };
      records.set(row.id, row);
      return row;
    },
    async count() { return records.size; },
    async findMany(opts?: any) {
      let rows = Array.from(records.values());
      const w = opts?.where;
      if (w?.kind) rows = rows.filter((r) => r.kind === w.kind);
      if (w?.chan) rows = rows.filter((r) => r.chan === w.chan);
      const orderBy = opts?.orderBy;
      if (Array.isArray(orderBy)) {
        for (const ob of orderBy) {
          if (ob.prio === "asc") rows.sort((a, b) => a.prio - b.prio);
          if (ob.prio === "desc") rows.sort((a, b) => b.prio - a.prio);
          if (ob.ts === "asc") rows.sort((a, b) => Number(a.ts - b.ts));
          if (ob.ts === "desc") rows.sort((a, b) => Number(b.ts - a.ts));
        }
      } else if (orderBy?.ts === "desc") rows.sort((a, b) => Number(b.ts - a.ts));
      else if (orderBy?.ts === "asc") rows.sort((a, b) => Number(a.ts - b.ts));
      if (opts?.skip) rows = rows.slice(opts.skip);
      if (opts?.take) rows = rows.slice(0, opts.take);
      if (opts?.select?.id) return rows.map((r) => ({ id: r.id }));
      return rows;
    },
    async deleteMany({ where }: any) {
      if (where?.exp?.lte != null) {
        let n = 0;
        for (const [id, r] of records) {
          if (r.exp <= where.exp.lte) { records.delete(id); n++; }
        }
        return { count: n };
      }
      const n = records.size; records.clear();
      return { count: n };
    },
    async aggregate({ _sum }: any) {
      if (_sum?.size) {
        let s = 0;
        for (const r of records.values()) s += r.size;
        return { _sum: { size: s } };
      }
      return { _sum: null };
    },
    async groupBy({ by }: any) {
      const counts = new Map<string, number>();
      for (const r of records.values()) counts.set(r.kind, (counts.get(r.kind) || 0) + 1);
      return Array.from(counts.entries()).map(([kind, _count]) => ({ kind, _count }));
    },
  },
  node: {
    async upsert(opts: any) {
      const existing = nodes.get(opts.where.id);
      const row = existing
        ? { ...existing, ...stripUndefined(opts.update), lastSeen: new Date() }
        : {
            id: opts.where.id,
            name: opts.create.name || opts.where.id,
            kind: opts.create.kind || "router",
            lastSeen: new Date(),
            battery: opts.create.battery ?? null,
            hops: opts.create.hops ?? null,
            records: opts.create.records ?? null,
            uptime: opts.create.uptime ?? null,
            links: opts.create.links || "[]",
            remote: opts.create.remote ?? false,
            addr: opts.create.addr ?? null,
          };
      nodes.set(opts.where.id, row);
      return row;
    },
    async findMany(opts?: any) {
      let rows = Array.from(nodes.values());
      const w = opts?.where;
      if (w?.lastSeen?.gte) rows = rows.filter((n) => n.lastSeen >= w.lastSeen.gte);
      if (w?.id?.not) rows = rows.filter((n) => n.id !== w.id.not);
      if (opts?.orderBy?.lastSeen === "desc") rows.sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());
      if (opts?.take) rows = rows.slice(0, opts.take);
      return rows;
    },
  },
};

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k in obj) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

(db as any).__inMemory = true;
