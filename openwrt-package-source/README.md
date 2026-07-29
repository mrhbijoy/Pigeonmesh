# PigeonMesh

**Communication that survives the shutdown.**

PigeonMesh turns ordinary home routers into a communication network that keeps
working when the internet does not — during a flood, after an earthquake, or
during a deliberate shutdown.

It installs as a single ~100 KB package on any OpenWrt router. People join by
opening a web page. There is no app to install, no account to create, no server
anywhere, and no internet.

Built for **July Hackathon 2026, Track A — Crisis Tech**, in the spirit of
Jogajog, which kept people connected during the internet shutdowns of the
July Revolution.

---

## What it does

| | |
|---|---|
| **Chat** | Channels for general, relief and medical traffic. Every message signed on the device. |
| **SOS** | Hold-to-send emergency alert with location and need type. Priority-routed ahead of everything else, and it survives storage pressure that evicts chat. |
| **Safe check-in** | "I am safe", searchable, so families stop guessing. |
| **Missing persons** | Report with a photo, replicated across the whole mesh. |
| **Relief map** | Shelters, clean water, medical posts, food, danger zones, blocked roads, boats — with distances, no map tiles, no internet. |
| **Encrypted DMs** | X25519 + ChaCha20-Poly1305. Relays carry ciphertext they cannot read. |
| **Carry mode** | Every phone that walks between two disconnected parts of the mesh delivers messages across the gap, automatically. |
| **Bangla first** | Full Bangla and English, Bangla numerals, Bangla by default. |

---

## The part that makes it different

Most mesh projects connect routers to each other. That fails the moment two
groups of routers are out of radio range — which is exactly what a flood does.

**PigeonMesh treats people as part of the network.**

When you open the app, your phone keeps its own copy of everything it has
seen. When it later meets any node — a different router, in a different
neighbourhood, with no link to the first — it reconciles with that node in one
round trip: it hands over what that node is missing and takes what it lacks.

You do not press anything. You just walk.

That is the pigeon. It is also, formally, delay-tolerant networking, and it is
the difference between a mesh that covers one building and a mesh that covers
a district.

**This is verified working, not aspirational.** See
[docs/DEMO.md](docs/DEMO.md) for the exact commands that prove it: two routers
cut apart with zero network path between them, an alert created on one, and a
browser walked between them delivering it to the other.

---

## Install

On any OpenWrt router (24.10+ uses `apk`, older uses `opkg`):

```bash
apk add --allow-untrusted pigeonmesh-1.0.0-r1.apk
```

```bash
opkg install pigeonmesh_1.0.0-r1_all.ipk
```

That is the whole installation. The package opens the right firewall ports on
the LAN side only, points `pigeon.mesh` at the router, starts on boot, and
prints the URL to hand out.

Then, from any phone on that router's Wi-Fi:

```
http://pigeon.mesh:8080/
```

To join a second router to the mesh, if it cannot be discovered automatically
(for example because it connects as a Wi-Fi client, so its uplink sits in the
`wan` firewall zone):

```bash
pigeonmesh link 192.168.3.1
```

---

## Requirements

Lua 5.1 and nixio, both already present on any OpenWrt image that ships LuCI.
Nothing is compiled, so one architecture-independent package runs on ath79,
ramips, mediatek, x86 and everything else.

Verified on:

| Router | OpenWrt | Architecture | Free flash |
|---|---|---|---|
| MediaTek Filogic | 25.12.4 | aarch64_cortex-a53 | 62 MB |
| Ramips MT7621 | 25.12.5 | mipsel_24kc | **6.6 MB** |

The 6.6 MB router is the design target. The storage budget is expressed in
bytes, not message counts, and the default cap is 2 MB.

---

## Running it from the console

The daemon is scriptable, which means a sensor can raise the alarm:

```bash
pigeonmesh sos "Water over the embankment at Char Rajibpur"
```

A float switch on a GPIO running that line reaches every phone on every node
in the mesh, with no internet, no SMS gateway and no app.

```
pigeonmesh status              node health, peers, storage
pigeonmesh peers               every node the mesh knows about
pigeonmesh tail [n]            recent records
pigeonmesh watch               follow the mesh live
pigeonmesh send <text>         post a message from this node
pigeonmesh sos <text>          post a priority alert
pigeonmesh bulletin <text>     post an announcement
pigeonmesh link <ip>           link to a router discovery cannot reach
pigeonmesh domain [name]       point pigeon.mesh at this router
pigeonmesh wipe CONFIRM        erase everything this node holds
```

---

## Building

```bash
bash build/build.sh
```

Produces all three formats in `dist/`:

| File | For |
|---|---|
| `pigeonmesh-1.0.0-r1.apk` | OpenWrt 24.10+ (apk-tools, ADB v3 format) |
| `pigeonmesh_1.0.0-r1_all.ipk` | OpenWrt ≤ 23.05 (opkg) |
| `pigeonmesh-1.0.0-r1.tar.gz` | anything else, or no package manager |

The `.ipk` and `.tar.gz` are built by `build/pack.py` with nothing but Python 3.

The `.apk` is different. OpenWrt 24.10 replaced opkg with apk, and an OpenWrt
`.apk` is **not** an Alpine v2 archive — it is an ADB v3 binary container, and
the `apk` binary shipped on routers is a runtime-only build with no `mkpkg`.
So the build needs a real apk-tools once:

```bash
bash build/get-apk-tools.sh      # builds apk-tools 3.0.5 locally
```

Pin it to the version your routers run (`apk --version`) so packages are
produced by exactly the code that will read them.

To deploy to routers directly during development:

```bash
bash build/deploy.sh 192.168.3.1 192.168.2.1
```

To build inside the OpenWrt buildroot instead, see
[`openwrt-feed/Makefile`](openwrt-feed/Makefile).

---

## Verifying the cryptography

`src/www/pigeonmesh/selftest.html` runs the primitives against their official
published test vectors — FIPS 180-4, RFC 8032, RFC 7748 and RFC 8439 — plus
negative tests for tampering, impersonation and third-party decryption.

Serve the directory and open it. All 27 checks must pass. It is excluded from
the shipped package.

---

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how replication, storage and the carry protocol work
- [docs/SECURITY.md](docs/SECURITY.md) — threat model, and an honest list of what this does *not* protect against
- [docs/DEMO.md](docs/DEMO.md) — a five-minute demo script with exact commands
- [docs/COMPARISON.md](docs/COMPARISON.md) — what changed from the mesh-chat prototype and why

---

## Relationship to mesh-chat

`../mesh-chat-source/` is the earlier prototype and is left untouched and
working. PigeonMesh is a separate package on different ports, so both can run
on the same router at the same time. See
[docs/COMPARISON.md](docs/COMPARISON.md).

---

## Licence

GPL-2.0-only.
