# PigeonMesh architecture

## The shape of the system

```
        phone                    router A                    router B
    ┌──────────┐            ┌──────────────┐            ┌──────────────┐
    │   PWA    │  HTTP/SSE  │ pigeonmeshd  │    TCP     │ pigeonmeshd  │
    │ IndexedDB│◄──────────►│  record store│◄──────────►│  record store│
    │  Ed25519 │  :8080     │  :7100 :7101 │   :7100    │              │
    └──────────┘            └──────────────┘            └──────────────┘
         │                                                      ▲
         │            walk to the other neighbourhood           │
         └──────────────────────────────────────────────────────┘
                     the same HTTP reconciliation
```

Three moving parts: a record log, a way to replicate it between routers, and
a way to replicate it through people.

---

## 1. Records

Everything in the system is a record. There are no accounts, no rooms, no
mutable objects — only an append-only log that every participant holds a
partial copy of.

```json
{
  "id":     "a3f1…",            128-bit random, generated at the source
  "kind":   "sos",              chat | sos | checkin | missing | pin |
                                bulletin | dm | ack | profile | presence
  "ts":     1785164281,
  "exp":    1785250681,         capped by a per-kind maximum
  "chan":   "sos",
  "nick":   "আয়েশা",
  "author": "a001e3694819a3aa", fingerprint of the signing key
  "pk":     "KiMzHxGq…",        Ed25519 public key
  "sig":    "NyPPse+8…",        signature over a canonical encoding
  "origin": "pm-8294f1",        node that first accepted it
  "hops":   1,
  "body":   { … }               kind-specific, opaque to routers
}
```

**Nothing is ever edited.** Responding to an SOS, marking a missing person
found, or resolving an alert all append an `ack` record referencing the
original by id. This is what makes replication trivial: two nodes that hold
the same set of ids hold the same state, and merge is set union. There is no
conflict resolution because there are no conflicts.

### Priority and expiry

| kind | priority | default lifetime |
|---|---|---|
| `sos` | 0 | 24 h |
| `checkin`, `missing`, `bulletin` | 1 | 7–30 d |
| `pin`, `dm` | 2 | 7–30 d |
| `chat`, `profile` | 3 | 3–30 d |
| `presence` | 4 | 5 min |

Priority is not about ordering, it is about **what survives scarcity**. The
secondary lab router has 6.6 MB of free flash. When the store hits its byte
budget it first drops anything expired, then sheds the least important records
oldest-first, and refuses to drop priority 0 while anything else remains.

A "where is my daughter" record outliving a "hello" record is a design
requirement, not an optimisation.

---

## 2. Replication between routers

Two mechanisms, deliberately, because they solve different problems.

### Flood — for latency

A record that is new to a node is immediately pushed to every neighbour except
the one it came from, with a hop counter. This is what makes chat feel instant
and an SOS arrive in under a second.

Flooding alone is not enough: a dropped packet is lost permanently, and on a
weak Wi-Fi link between two buildings that happens constantly.

### Gossip — for completeness

Every `gossip_interval` seconds (default 5), a node picks **one** random
neighbour and sends a Bloom summary of everything it holds. The neighbour
computes which of its own records are not in that filter and pushes them back,
priority-ordered and capped per round.

One peer per round rather than all of them: gossiping to everyone every tick
turns a dense mesh into a broadcast storm, while one peer per round still
converges in O(log n) rounds.

The Bloom filter is sized from the current record count — a node holding 40
records sends 128 bytes, not a fixed kilobyte — targeting ~2% false positives
at 10 bits per element with k=6. A false positive costs one redundant record
transfer, never a lost one.

The filter is a **byte array serialised as hex**, not a word array. Lua 5.1 has
no unsigned 32-bit integer, so bit 31 of a word comes back negative and
`string.format("%x")` throws. Bytes sidestep that and any endianness
disagreement with the JavaScript implementation, which has to produce
bit-identical filters — see below.

### Topology

Nodes gossip a small status record (battery, record count, uptime, its own
link list) with a hop limit. This is what draws the mesh map in the app, and
what lets a coordinator see that the shelter node is alive but two hops away.

---

## 3. Replication through people — the carry protocol

This is the part that makes PigeonMesh a district-scale system rather than a
building-scale one.

The PWA is not a thin client. It keeps every record it has ever seen in
IndexedDB. Whenever it is attached to *any* node, every 20 seconds and on every
return from background, it runs one request:

```
POST /api/sync
  { "digest": <Bloom of everything the phone holds>,
    "records": [ … records this node's last digest said it lacks … ] }

→ { "records": [ … everything the phone is missing … ],
    "took": 12,
    "digest": <Bloom of everything this node holds> }
```

One round trip, both directions, no coordination.

The consequence: a person who opens the app in a flooded village, walks to a
shelter three kilometres away, and opens their phone again has moved every
message between two networks that have never been connected. Neither node
knows the other exists.

This works because the browser implements the *same* Bloom construction as the
router: FNV-1a with two seeds, k probes by the Kirsch-Mitzenmacher method, hex
byte array. The Lua side computes the FNV multiply in exact double arithmetic
via a 16-bit split (Lua 5.1 has no integer type and its bit library is only
defined below 2^32); the JavaScript side uses `Math.imul`. They agree exactly.

Carry mode is on by default and can be switched off — someone who does not
want to physically transport other people's data should not have to.

---

## 4. Storage and power loss

`/var` on OpenWrt is tmpfs. A naive design keeps the log there and loses
everything on reboot — and in the scenario this is built for, power cuts are
the normal case, not the exception.

So the store is two-tier:

- **hot log** — append-only JSONL in `/var/lib/pigeonmesh/` (RAM, fast, free)
- **checkpoint** — compacted JSONL in `/etc/pigeonmesh/store/` (flash)

Checkpointing runs every 5 minutes and on clean shutdown, dropping expired
records on the way. A power cut costs at most 5 minutes of records instead of
all of them, while writing to flash rarely enough not to wear it out.

Both files are plain JSONL, so an operator with nothing but `cat` can read the
state of the mesh.

## 5. Clocks

A router that boots during a grid failure has no NTP and usually no RTC. Its
clock reads 1970, and every message it stamps sorts below everything real.

Each node keeps a logical clock: it never emits a timestamp lower than the
highest one it has seen from the mesh. Nodes with a good clock pull the others
forward. Records outside a plausible range (2020–2100) are rejected outright,
so one hostile record cannot drag every future message decades ahead.

The API reports `clock_derived`, and the app shows a banner when the node it is
talking to is guessing.

---

## 6. Why the daemon serves HTTP itself

mesh-chat used uhttpd with a CGI script. CGI forks a Lua interpreter per
request — about 90 ms and 3 MB of RAM on the mipsel router — so the UI could
not refresh faster than once a second without the router falling over.

`pigeonmeshd` runs its own non-blocking HTTP server on port 8080 inside the
same poll loop that drives the mesh. That buys:

- **Server-Sent Events.** A record landing anywhere in the mesh is pushed to
  every open browser within a poll tick. No polling at all.
- One socket instead of a process per request.
- The app still works if LuCI is removed.

uhttpd is left completely alone on port 80, so LuCI keeps working. As a side
effect the static assets are also reachable at `http://<router>/pigeonmesh/`.

### Hardening

The HTTP server is deliberately paranoid, because anyone within Wi-Fi range can
reach it:

- Path traversal is rejected after percent-decoding, not before.
- Request bodies and headers are capped; oversize requests are refused.
- A browser that stops reading gets its connection dropped at 512 KB of
  backlog rather than being allowed to consume the router's RAM.
- POSTs are rate-limited per source with a token bucket.
- Every request handler runs inside `pcall`. A malformed request logs and drops
  one connection; it never takes the node down. In a disaster, a daemon that
  stays up matters more than any single response being correct.

---

## Ports

| Port | Protocol | Purpose | Exposure |
|---|---|---|---|
| 7100 | TCP | router-to-router mesh link | LAN only |
| 7101 | UDP | discovery beacons | LAN only |
| 8080 | TCP | app + API + SSE | LAN only |

Nothing is opened to the WAN. A crisis node reachable from the internet is a
node an adversary can enumerate.

mesh-chat's ports (7000/7001) are untouched, so both can run side by side.
