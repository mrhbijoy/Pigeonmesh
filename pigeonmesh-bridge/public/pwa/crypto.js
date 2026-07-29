/* PigeonMesh -- client-side cryptography.
 *
 * Everything here is implemented from scratch in plain JavaScript, which
 * deserves an explanation, because "don't roll your own crypto" is good
 * advice and WebCrypto exists.
 *
 * WebCrypto is not available to us. `crypto.subtle` is gated behind a secure
 * context, and a router in a flood zone cannot obtain a TLS certificate for
 * http://pigeon.mesh -- there is no CA to reach and no DNS to validate
 * against. The choice is therefore between plain-JS primitives and no
 * end-to-end cryptography at all. `crypto.getRandomValues` is *not* gated and
 * is used for all key material.
 *
 * The primitives are the standard ones, implemented against their published
 * test vectors (see selftest.html):
 *
 *   SHA-512               FIPS 180-4
 *   Ed25519 sign/verify   RFC 8032
 *   X25519 ECDH           RFC 7748
 *   ChaCha20-Poly1305     RFC 8439
 *
 * Threat model. Signatures give every record an author that a router cannot
 * forge, so seizing a node does not let anyone put words in someone's mouth.
 * ChaCha20-Poly1305 over a static-static X25519 exchange keeps direct
 * messages unreadable to every relay. What this does NOT give you: forward
 * secrecy (there is no ratchet, so a stolen device exposes past DMs) and
 * metadata privacy (relays see who talks to whom, and when). Both are
 * documented rather than papered over.
 */

const PM = (() => {
  'use strict';

  // ---------------------------------------------------------------- bytes

  const te = new TextEncoder();
  const td = new TextDecoder();

  const utf8 = (s) => te.encode(s);
  const fromUtf8 = (b) => td.decode(b);

  function randomBytes(n) {
    const b = new Uint8Array(n);
    crypto.getRandomValues(b);
    return b;
  }

  function toHex(b) {
    let s = '';
    for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
    return s;
  }

  function fromHex(h) {
    const b = new Uint8Array(h.length >> 1);
    for (let i = 0; i < b.length; i++) b[i] = parseInt(h.substr(i * 2, 2), 16);
    return b;
  }

  function toB64(b) {
    let s = '';
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  }

  function fromB64(s) {
    const raw = atob(s);
    const b = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) b[i] = raw.charCodeAt(i);
    return b;
  }

  function concat(...arrs) {
    let n = 0;
    for (const a of arrs) n += a.length;
    const out = new Uint8Array(n);
    let o = 0;
    for (const a of arrs) { out.set(a, o); o += a.length; }
    return out;
  }

  // Constant-time comparison, so a tag check cannot be turned into an oracle
  // by timing it.
  function equalCT(a, b) {
    if (a.length !== b.length) return false;
    let d = 0;
    for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
    return d === 0;
  }

  // ---------------------------------------------------------------- SHA-512

  const M64 = (1n << 64n) - 1n;

  const K512 = [
    '428a2f98d728ae22', '7137449123ef65cd', 'b5c0fbcfec4d3b2f', 'e9b5dba58189dbbc',
    '3956c25bf348b538', '59f111f1b605d019', '923f82a4af194f9b', 'ab1c5ed5da6d8118',
    'd807aa98a3030242', '12835b0145706fbe', '243185be4ee4b28c', '550c7dc3d5ffb4e2',
    '72be5d74f27b896f', '80deb1fe3b1696b1', '9bdc06a725c71235', 'c19bf174cf692694',
    'e49b69c19ef14ad2', 'efbe4786384f25e3', '0fc19dc68b8cd5b5', '240ca1cc77ac9c65',
    '2de92c6f592b0275', '4a7484aa6ea6e483', '5cb0a9dcbd41fbd4', '76f988da831153b5',
    '983e5152ee66dfab', 'a831c66d2db43210', 'b00327c898fb213f', 'bf597fc7beef0ee4',
    'c6e00bf33da88fc2', 'd5a79147930aa725', '06ca6351e003826f', '142929670a0e6e70',
    '27b70a8546d22ffc', '2e1b21385c26c926', '4d2c6dfc5ac42aed', '53380d139d95b3df',
    '650a73548baf63de', '766a0abb3c77b2a8', '81c2c92e47edaee6', '92722c851482353b',
    'a2bfe8a14cf10364', 'a81a664bbc423001', 'c24b8b70d0f89791', 'c76c51a30654be30',
    'd192e819d6ef5218', 'd69906245565a910', 'f40e35855771202a', '106aa07032bbd1b8',
    '19a4c116b8d2d0c8', '1e376c085141ab53', '2748774cdf8eeb99', '34b0bcb5e19b48a8',
    '391c0cb3c5c95a63', '4ed8aa4ae3418acb', '5b9cca4f7763e373', '682e6ff3d6b2b8a3',
    '748f82ee5defb2fc', '78a5636f43172f60', '84c87814a1f0ab72', '8cc702081a6439ec',
    '90befffa23631e28', 'a4506cebde82bde9', 'bef9a3f7b2c67915', 'c67178f2e372532b',
    'ca273eceea26619c', 'd186b8c721c0c207', 'eada7dd6cde0eb1e', 'f57d4f7fee6ed178',
    '06f067aa72176fba', '0a637dc5a2c898a6', '113f9804bef90dae', '1b710b35131c471b',
    '28db77f523047d84', '32caab7b40c72493', '3c9ebe0a15c9bebc', '431d67c49c100d4c',
    '4cc5d4becb3e42b6', '597f299cfc657e2a', '5fcb6fab3ad6faec', '6c44198c4a475817',
  ].map((h) => BigInt('0x' + h));

  const rotr64 = (x, n) => ((x >> n) | (x << (64n - n))) & M64;

  function sha512(msg) {
    const H = [
      0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn,
      0xa54ff53a5f1d36f1n, 0x510e527fade682d1n, 0x9b05688c2b3e6c1fn,
      0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n,
    ];

    // Pad: message, 0x80, zeros, then a 128-bit big-endian bit length. The
    // high 64 bits are always zero here -- a browser cannot hold a 2^64-bit
    // message.
    const bitLen = BigInt(msg.length) * 8n;
    const padLen = ((msg.length + 17 + 127) & ~127) - msg.length;
    const padded = new Uint8Array(msg.length + padLen);
    padded.set(msg);
    padded[msg.length] = 0x80;
    for (let i = 0; i < 8; i++) {
      padded[padded.length - 1 - i] = Number((bitLen >> BigInt(8 * i)) & 0xffn);
    }

    const W = new Array(80);
    for (let off = 0; off < padded.length; off += 128) {
      for (let i = 0; i < 16; i++) {
        let v = 0n;
        for (let j = 0; j < 8; j++) v = (v << 8n) | BigInt(padded[off + i * 8 + j]);
        W[i] = v;
      }
      for (let i = 16; i < 80; i++) {
        const s0 = rotr64(W[i - 15], 1n) ^ rotr64(W[i - 15], 8n) ^ (W[i - 15] >> 7n);
        const s1 = rotr64(W[i - 2], 19n) ^ rotr64(W[i - 2], 61n) ^ (W[i - 2] >> 6n);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) & M64;
      }

      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 80; i++) {
        const S1 = rotr64(e, 14n) ^ rotr64(e, 18n) ^ rotr64(e, 41n);
        const ch = (e & f) ^ (~e & M64 & g);
        const t1 = (h + S1 + ch + K512[i] + W[i]) & M64;
        const S0 = rotr64(a, 28n) ^ rotr64(a, 34n) ^ rotr64(a, 39n);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) & M64;
        h = g; g = f; f = e;
        e = (d + t1) & M64;
        d = c; c = b; b = a;
        a = (t1 + t2) & M64;
      }
      const v = [a, b, c, d, e, f, g, h];
      for (let i = 0; i < 8; i++) H[i] = (H[i] + v[i]) & M64;
    }

    const out = new Uint8Array(64);
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        out[i * 8 + j] = Number((H[i] >> BigInt(56 - 8 * j)) & 0xffn);
      }
    }
    return out;
  }

  // --------------------------------------------------------- curve25519 field

  const P = (1n << 255n) - 19n;
  const L = 2n ** 252n + 27742317777372353535851937790883648493n;

  const mod = (a, m = P) => { const r = a % m; return r >= 0n ? r : r + m; };

  // Fermat inversion. Slower than a dedicated addition chain but short
  // enough to audit by eye, and it runs a handful of times per operation.
  const invMod = (a, m = P) => powMod(mod(a, m), m - 2n, m);

  function powMod(b, e, m) {
    let r = 1n;
    b = mod(b, m);
    while (e > 0n) {
      if (e & 1n) r = (r * b) % m;
      b = (b * b) % m;
      e >>= 1n;
    }
    return r;
  }

  const D = mod(-121665n * invMod(121666n));
  const I = powMod(2n, (P - 1n) / 4n, P);   // sqrt(-1)

  function bytesToNumLE(b) {
    let v = 0n;
    for (let i = b.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[i]);
    return v;
  }

  function numToBytesLE(n, len) {
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) { out[i] = Number(n & 0xffn); n >>= 8n; }
    return out;
  }

  // --------------------------------------------------------------- Ed25519
  // Extended twisted-Edwards coordinates (X:Y:Z:T), as in RFC 8032 §5.1.4.

  const Bx = 15112221349535400772501151409588531511454012693041857206046113283949847762202n;
  const By = 46316835694926478169428394003475163141307993866256225615783033603165251855960n;
  const BASE = [Bx, By, 1n, mod(Bx * By)];
  const ZERO = [0n, 1n, 1n, 0n];

  function edAdd(p, q) {
    const [X1, Y1, Z1, T1] = p, [X2, Y2, Z2, T2] = q;
    const A = mod((Y1 - X1) * (Y2 - X2));
    const B = mod((Y1 + X1) * (Y2 + X2));
    const C = mod(T1 * 2n * D * T2);
    const Dd = mod(Z1 * 2n * Z2);
    const E = B - A, F = Dd - C, G = Dd + C, H = B + A;
    return [mod(E * F), mod(G * H), mod(F * G), mod(E * H)];
  }

  function edMul(p, n) {
    let q = ZERO;
    // Fixed 256 iterations with an unconditional add keeps the loop's shape
    // independent of the secret scalar's bits.
    for (let i = 0; i < 256; i++) {
      if (n & 1n) q = edAdd(q, p);
      p = edAdd(p, p);
      n >>= 1n;
    }
    return q;
  }

  function edEncode(p) {
    const [X, Y, Z] = p;
    const zi = invMod(Z);
    const x = mod(X * zi), y = mod(Y * zi);
    const out = numToBytesLE(y, 32);
    out[31] |= Number(x & 1n) << 7;
    return out;
  }

  function edDecode(b) {
    const y = bytesToNumLE(b) & ((1n << 255n) - 1n);
    if (y >= P) return null;
    const sign = BigInt(b[31] >> 7);
    const y2 = mod(y * y);
    const u = mod(y2 - 1n);
    const v = mod(D * y2 + 1n);

    // RFC 8032 section 5.1.3: recover x from x^2 = u/v as
    //   x = u * v^3 * (u * v^7)^((p-5)/8)
    const v3 = mod(v * v * v);
    const v7 = mod(v3 * v3 * v);
    let x = mod(u * v3 * powMod(mod(u * v7), (P - 5n) / 8n, P));

    // The candidate is correct, off by sqrt(-1), or the point is not on
    // the curve at all.
    const check = mod(v * x * x);
    if (check !== mod(u)) {
      if (check === mod(-u)) x = mod(x * I);
      else return null;
    }
    if (x === 0n && sign === 1n) return null;
    if ((x & 1n) !== sign) x = mod(-x);
    return [x, y, 1n, mod(x * y)];
  }

  function ed25519KeyPair(seed) {
    const sk = seed || randomBytes(32);
    const h = sha512(sk);
    const a = clampScalar(h.slice(0, 32));
    const pk = edEncode(edMul(BASE, a));
    return { secret: sk, public: pk, prefix: h.slice(32, 64), scalar: a };
  }

  function clampScalar(h32) {
    const b = new Uint8Array(h32);
    b[0] &= 248;
    b[31] &= 127;
    b[31] |= 64;
    return bytesToNumLE(b);
  }

  function ed25519Sign(msg, keypair) {
    const { prefix, scalar, public: pk } = keypair;
    const r = mod(bytesToNumLE(sha512(concat(prefix, msg))), L);
    const R = edEncode(edMul(BASE, r));
    const k = mod(bytesToNumLE(sha512(concat(R, pk, msg))), L);
    const S = mod(r + k * scalar, L);
    return concat(R, numToBytesLE(S, 32));
  }

  function ed25519Verify(msg, sig, pk) {
    try {
      if (sig.length !== 64 || pk.length !== 32) return false;
      const R = sig.slice(0, 32);
      const S = bytesToNumLE(sig.slice(32, 64));
      // Reject non-canonical S; without this, a signature can be mauled into
      // a second valid signature for the same message.
      if (S >= L) return false;
      const A = edDecode(pk);
      if (!A) return false;
      const Rp = edDecode(R);
      if (!Rp) return false;
      const k = mod(bytesToNumLE(sha512(concat(R, pk, msg))), L);
      const lhs = edEncode(edMul(BASE, S));
      const rhs = edEncode(edAdd(Rp, edMul(A, k)));
      return equalCT(lhs, rhs);
    } catch (e) {
      return false;
    }
  }

  // ----------------------------------------------------------------- X25519
  // Montgomery ladder over curve25519, RFC 7748 §5.

  const A24 = 121665n;

  function x25519(scalarBytes, uBytes) {
    const k = new Uint8Array(scalarBytes);
    k[0] &= 248; k[31] &= 127; k[31] |= 64;
    const kn = bytesToNumLE(k);
    const u = bytesToNumLE(uBytes) & ((1n << 255n) - 1n);

    let x1 = u, x2 = 1n, z2 = 0n, x3 = u, z3 = 1n, swap = 0n;
    for (let t = 254; t >= 0; t--) {
      const kt = (kn >> BigInt(t)) & 1n;
      swap ^= kt;
      if (swap) { [x2, x3] = [x3, x2]; [z2, z3] = [z3, z2]; }
      swap = kt;

      const a = mod(x2 + z2), aa = mod(a * a);
      const b = mod(x2 - z2), bb = mod(b * b);
      const e = mod(aa - bb);
      const c = mod(x3 + z3), d = mod(x3 - z3);
      const da = mod(d * a), cb = mod(c * b);
      x3 = mod((da + cb) * (da + cb));
      z3 = mod(x1 * mod((da - cb) * (da - cb)));
      x2 = mod(aa * bb);
      z2 = mod(e * (aa + A24 * e));
    }
    if (swap) { [x2, x3] = [x3, x2]; [z2, z3] = [z3, z2]; }
    return numToBytesLE(mod(x2 * invMod(z2)), 32);
  }

  const X25519_BASE = numToBytesLE(9n, 32);

  function x25519KeyPair(seed) {
    const sk = seed || randomBytes(32);
    return { secret: sk, public: x25519(sk, X25519_BASE) };
  }

  // ------------------------------------------------------ ChaCha20-Poly1305

  function rotl32(x, n) { return ((x << n) | (x >>> (32 - n))) >>> 0; }

  function chachaBlock(key32, counter, nonce12) {
    const s = new Uint32Array(16);
    s[0] = 0x61707865; s[1] = 0x3320646e; s[2] = 0x79622d32; s[3] = 0x6b206574;
    const kv = new DataView(key32.buffer, key32.byteOffset, 32);
    for (let i = 0; i < 8; i++) s[4 + i] = kv.getUint32(i * 4, true);
    s[12] = counter >>> 0;
    const nv = new DataView(nonce12.buffer, nonce12.byteOffset, 12);
    s[13] = nv.getUint32(0, true);
    s[14] = nv.getUint32(4, true);
    s[15] = nv.getUint32(8, true);

    const x = s.slice();
    const QR = (a, b, c, d) => {
      x[a] = (x[a] + x[b]) >>> 0; x[d] = rotl32(x[d] ^ x[a], 16);
      x[c] = (x[c] + x[d]) >>> 0; x[b] = rotl32(x[b] ^ x[c], 12);
      x[a] = (x[a] + x[b]) >>> 0; x[d] = rotl32(x[d] ^ x[a], 8);
      x[c] = (x[c] + x[d]) >>> 0; x[b] = rotl32(x[b] ^ x[c], 7);
    };
    for (let i = 0; i < 10; i++) {
      QR(0, 4, 8, 12); QR(1, 5, 9, 13); QR(2, 6, 10, 14); QR(3, 7, 11, 15);
      QR(0, 5, 10, 15); QR(1, 6, 11, 12); QR(2, 7, 8, 13); QR(3, 4, 9, 14);
    }
    const out = new Uint8Array(64);
    const ov = new DataView(out.buffer);
    for (let i = 0; i < 16; i++) ov.setUint32(i * 4, (x[i] + s[i]) >>> 0, true);
    return out;
  }

  function chacha20(key, nonce, data, counter = 1) {
    const out = new Uint8Array(data.length);
    for (let off = 0; off < data.length; off += 64) {
      const ks = chachaBlock(key, counter + (off >> 6), nonce);
      const n = Math.min(64, data.length - off);
      for (let i = 0; i < n; i++) out[off + i] = data[off + i] ^ ks[i];
    }
    return out;
  }

  // Poly1305, RFC 8439 section 2.5, written directly against the spec with
  // BigInt arithmetic. The usual 26-bit-limb version is perhaps ten times
  // faster, but it is also the kind of code where a single misplaced shift
  // produces tags that are wrong only sometimes. Direct messages here are a
  // few hundred bytes, so the readable version is fast enough and can be
  // checked against the RFC by eye.
  const POLY_P = (1n << 130n) - 5n;
  const CLAMP = 0x0ffffffc0ffffffc0ffffffc0fffffffn;

  function poly1305(key32, msg) {
    const r = bytesToNumLE(key32.slice(0, 16)) & CLAMP;
    const s = bytesToNumLE(key32.slice(16, 32));
    let acc = 0n;

    for (let i = 0; i < msg.length; i += 16) {
      const chunk = msg.subarray(i, Math.min(i + 16, msg.length));
      const block = new Uint8Array(17);
      block.set(chunk);
      block[chunk.length] = 1;          // the "1" bit appended to each block
      acc = ((acc + bytesToNumLE(block)) * r) % POLY_P;
    }

    return numToBytesLE((acc + s) & ((1n << 128n) - 1n), 16);
  }

  function pad16(n) { return n % 16 === 0 ? new Uint8Array(0) : new Uint8Array(16 - (n % 16)); }

  function le64(n) {
    const b = new Uint8Array(8);
    let v = BigInt(n);
    for (let i = 0; i < 8; i++) { b[i] = Number(v & 0xffn); v >>= 8n; }
    return b;
  }

  function aeadSeal(key, nonce, plaintext, aad = new Uint8Array(0)) {
    const polyKey = chachaBlock(key, 0, nonce).slice(0, 32);
    const ct = chacha20(key, nonce, plaintext, 1);
    const mac = poly1305(polyKey,
      concat(aad, pad16(aad.length), ct, pad16(ct.length),
        le64(aad.length), le64(ct.length)));
    return concat(ct, mac);
  }

  function aeadOpen(key, nonce, sealed, aad = new Uint8Array(0)) {
    if (sealed.length < 16) return null;
    const ct = sealed.slice(0, sealed.length - 16);
    const tag = sealed.slice(sealed.length - 16);
    const polyKey = chachaBlock(key, 0, nonce).slice(0, 32);
    const mac = poly1305(polyKey,
      concat(aad, pad16(aad.length), ct, pad16(ct.length),
        le64(aad.length), le64(ct.length)));
    if (!equalCT(mac, tag)) return null;
    return chacha20(key, nonce, ct, 1);
  }

  // ------------------------------------------------------------- identity

  // A record is signed over a canonical string rather than over its JSON.
  // Two JSON encoders order keys differently and a signature that depends on
  // key order is a signature that randomly fails.
  function canonical(rec) {
    return [
      rec.id, rec.kind, rec.ts, rec.exp || '', rec.chan || '',
      rec.nick || '', rec.author || '', stableJson(rec.body || {}),
    ].join('');
  }

  function stableJson(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(stableJson).join(',') + ']';
    const keys = Object.keys(v).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableJson(v[k])).join(',') + '}';
  }

  // Short, human-comparable fingerprint. People verify each other by reading
  // six characters aloud, not by comparing 64 hex digits.
  function fingerprint(pubBytes) {
    return toHex(sha512(pubBytes).slice(0, 8));
  }

  // Same digits, rendered as words so they survive being shouted across a
  // room or written on a hand.
  const WORDLIST = [
    'akash', 'bagh', 'chand', 'dhan', 'eid', 'fol', 'ghar', 'hati',
    'ilish', 'jol', 'kalo', 'lal', 'mach', 'nodi', 'okhi', 'pakhi',
    'rong', 'shapla', 'taka', 'ullash', 'boi', 'chaya', 'dola', 'gach',
    'hawa', 'jhor', 'kash', 'megh', 'noka', 'pata', 'rupa', 'sagor',
  ];

  function fingerprintWords(pubBytes) {
    const h = sha512(pubBytes);
    return [h[0] & 31, h[1] & 31, h[2] & 31].map((i) => WORDLIST[i]).join('-');
  }

  function newIdentity(nick) {
    const ed = ed25519KeyPair();
    const dh = x25519KeyPair();
    return {
      nick: nick || '',
      created: Math.floor(Date.now() / 1000),
      ed_secret: toB64(ed.secret),
      ed_public: toB64(ed.public),
      dh_secret: toB64(dh.secret),
      dh_public: toB64(dh.public),
      fp: fingerprint(ed.public),
      words: fingerprintWords(ed.public),
    };
  }

  function loadKeypair(identity) {
    return ed25519KeyPair(fromB64(identity.ed_secret));
  }

  function signRecord(rec, identity) {
    const kp = loadKeypair(identity);
    rec.author = identity.fp;
    rec.pk = identity.ed_public;
    rec.sig = toB64(ed25519Sign(utf8(canonical(rec)), kp));
    return rec;
  }

  function verifyRecord(rec) {
    if (!rec.sig || !rec.pk) return false;
    try {
      const pk = fromB64(rec.pk);
      // The claimed author must actually be this key's fingerprint,
      // otherwise a valid signature could be attached to someone else's name.
      if (rec.author && rec.author !== fingerprint(pk)) return false;
      return ed25519Verify(utf8(canonical(rec)), fromB64(rec.sig), pk);
    } catch (e) {
      return false;
    }
  }

  // Static-static ECDH. Both sides derive the same key from their own secret
  // and the other's published X25519 public key, so a message can be sent to
  // someone who is offline and will only reach a node hours later.
  function dmKey(mySecretB64, theirPublicB64) {
    const shared = x25519(fromB64(mySecretB64), fromB64(theirPublicB64));
    // Bind the key to both parties so a shared secret can never be replayed
    // into a conversation with a third person.
    const pair = [theirPublicB64, toB64(x25519(fromB64(mySecretB64), X25519_BASE))].sort().join('|');
    return sha512(concat(shared, utf8('pigeonmesh-dm-v1'), utf8(pair))).slice(0, 32);
  }

  function sealDM(plaintextStr, mySecretB64, theirPublicB64) {
    const key = dmKey(mySecretB64, theirPublicB64);
    const nonce = randomBytes(12);
    const ct = aeadSeal(key, nonce, utf8(plaintextStr));
    return { n: toB64(nonce), c: toB64(ct) };
  }

  function openDM(envelope, mySecretB64, theirPublicB64) {
    try {
      const key = dmKey(mySecretB64, theirPublicB64);
      const pt = aeadOpen(key, fromB64(envelope.n), fromB64(envelope.c));
      return pt ? fromUtf8(pt) : null;
    } catch (e) {
      return null;
    }
  }

  function newRecordId() {
    return toHex(randomBytes(16));
  }

  return {
    utf8, fromUtf8, randomBytes, toHex, fromHex, toB64, fromB64, concat, equalCT,
    sha512, ed25519KeyPair, ed25519Sign, ed25519Verify,
    x25519, x25519KeyPair, X25519_BASE,
    chacha20, poly1305, aeadSeal, aeadOpen,
    canonical, stableJson, fingerprint, fingerprintWords,
    newIdentity, signRecord, verifyRecord, loadKeypair,
    dmKey, sealDM, openDM, newRecordId,
  };
})();

if (typeof module !== 'undefined') module.exports = PM;
