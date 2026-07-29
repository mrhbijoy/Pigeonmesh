// pigeonmesh/bloom.ts
//
// Bit-identical port of the Lua store's Bloom filter so that records
// reconciled against a Vercel peer converge exactly the same way they do
// against another router. The on-device JavaScript already uses Math.imul
// (see ARCHITECTURE.md §3), so this side does too.
//
//   - FNV-1a with two seeds (2166136261, 40389)
//   - Kirsch-Mitzenmacher k=6 probes from those two hashes
//   - bit size grows with element count, targeting ~2% FP at 10 bits/elem
//   - serialised as a hex byte array, NOT a word array, so endianness
//     never has a chance to disagree with the Lua side
//
// A false positive costs one redundant record transfer, never a lost one.

export interface Bloom {
  bits: number;
  k: number;
  data: string; // hex bytes, two chars per byte
  count?: number;
}

/** FNV-1a 32-bit. Math.imul gives us the exact 32-bit multiply Lua's
 *  mul32 split simulates. */
export function fnv1a(str: string, seed: number = 2166136261): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h = (h ^ str.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function bloomParams(n: number): [number, number] {
  let bits = 1024;
  while (bits < n * 10 && bits < 65536) bits *= 2;
  return [bits, 6];
}

function positions(id: string, bits: number, k: number): number[] {
  let h1 = fnv1a(id, 2166136261);
  let h2 = fnv1a(id, 40389);
  // h2 must be odd and non-zero, or all k probes collapse onto one bit.
  if (h2 % 2 === 0) h2 = (h2 + 1) >>> 0;
  if (h2 === 0) h2 = 1;
  const out: number[] = [];
  for (let i = 0; i < k; i++) {
    out.push(((h1 + i * h2) >>> 0) % bits);
  }
  return out;
}

export function bloomBuild(ids: string[]): Bloom {
  const [bits, k] = bloomParams(ids.length);
  const nbytes = bits / 8;
  const filter = new Uint8Array(nbytes);
  for (const id of ids) {
    const pos = positions(id, bits, k);
    for (const p of pos) {
      const byteI = Math.floor(p / 8);
      const mask = 1 << (p % 8);
      filter[byteI] |= mask;
    }
  }
  let hex = "";
  for (let i = 0; i < nbytes; i++) {
    hex += filter[i].toString(16).padStart(2, "0");
  }
  return { bits, k, data: hex, count: ids.length };
}

export function bloomContains(bloom: Bloom | null | undefined, id: string): boolean {
  if (!bloom || typeof bloom.data !== "string") return false;
  const bits = bloom.bits || 1024;
  const k = bloom.k || 6;
  // A malformed or truncated filter from a peer must fail closed: treating
  // it as "contains everything" would silently stop replication.
  if (bloom.data.length !== bits / 4) return false;
  if (k < 1 || k > 16) return false;
  const pos = positions(id, bits, k);
  for (const p of pos) {
    const byteI = Math.floor(p / 8);
    const hexoff = byteI * 2;
    const v = parseInt(bloom.data.substr(hexoff, 2), 16);
    if (Number.isNaN(v)) return false;
    const mask = 1 << (p % 8);
    if ((v & mask) === 0) return false;
  }
  return true;
}
