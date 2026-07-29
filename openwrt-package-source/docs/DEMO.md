# Five-minute demo

Everything below has been run end to end on the two lab routers. Timings are
what actually happened, not estimates.

**Setup:** two OpenWrt routers, a laptop, a phone. Router B joins router A's
Wi-Fi as a client — deliberately, because that is the awkward real-world case
where broadcast discovery does not work.

| | address | OpenWrt | arch | free flash |
|---|---|---|---|---|
| A | 192.168.3.1 | 25.12.4 | aarch64 | 62 MB |
| B | 192.168.2.1 | 25.12.5 | mipsel | 6.6 MB |

---

## 0. Before you start (30 s)

```bash
bash build/build.sh
bash build/deploy.sh 192.168.3.1 192.168.2.1
```

Then link B to A, since B's uplink is in the `wan` firewall zone and cannot
accept inbound connections:

```bash
pigeonmesh link 192.168.3.1
```

Confirm both sides see each other:

```bash
pigeonmesh status
```

```
PigeonMesh 1.0.0  node pm-12a626 (OpenWrt)
  web        http://192.168.3.1:8080/
  store      0 records, 0 B of 2.0 MB
  browsers   3 connected (2 live streams)
  mesh       0 flooded, 2 gossip rounds, carried in 0 / out 0
  peers      1
    pm-8294f1  OpenWrt          direct 192.168.3.141  rtt 10ms
```

---

## 1. "It installs in one command" (30 s)

Show the install output. One ~100 KB package, no dependencies to fetch, works
on both architectures from the same file.

> The `.apk` is a genuine OpenWrt apk v3 (ADB) package, not a renamed archive.
> If a judge is sceptical: `apk info pigeonmesh` on the router.

---

## 2. "No app install" (45 s)

On the phone, join the router's Wi-Fi and open:

```
http://pigeon.mesh:8080/
```

Type a name. That is the entire onboarding — and in that moment the phone
generated an Ed25519 identity locally. Show the three-word code in the
**নেটওয়ার্ক** tab: `akash-bagh-dhan`. That is how two people verify each other
face to face.

Point out the interface is in Bangla by default, with Bangla numerals.

---

## 3. "Messages cross the mesh" (30 s)

Send a message from the phone. On the laptop:

```bash
ssh root@192.168.2.1 pigeonmesh tail 5
```

```
   23s  chat     আয়েশা  PWA test: shelter at Kalibari school is open, second floor dry
```

It crossed the router-to-router link with the Bangla name and the signature
intact.

Now the reverse, to show push rather than polling:

```bash
ssh root@192.168.2.1 pigeonmesh send "Relief boats leaving at 6am"
```

It appears on the phone immediately — Server-Sent Events, not polling. **Watch
the phone while you press enter.**

---

## 4. "A sensor can raise the alarm" (30 s)

```bash
ssh root@192.168.2.1 pigeonmesh sos "Water over the embankment at Char Rajibpur"
```

Every phone on every node buzzes and shows the red banner.

The point to make: that is one shell command. A float switch on a GPIO pin runs
it. No SMS gateway, no internet, no app.

Note that the alert shows **"নোড থেকে"** (from node), not "verified" — the
router cannot prove who typed the command, and the interface says so rather
than pretending otherwise.

---

## 5. The one that wins it: carrying messages across a gap (2 min)

This is the demo. Do it slowly.

### Cut the network in half

```bash
ssh root@192.168.2.1 'pigeonmesh unlink 192.168.3.1'
```

Show both nodes now report `peers 0`. **There is no network path between them
at all.**

### Create an alert on the far node

```bash
ssh root@192.168.2.1 'pigeonmesh sos "12 people stranded at Mirpur bridge, no boat"'
```

Confirm node A cannot see it:

```bash
ssh root@192.168.3.1 'pigeonmesh tail 10'      # not there
```

### Walk the phone to the far node

Join router B's Wi-Fi, open the app. The alert appears. The phone now holds it.

### Walk back

Rejoin router A's Wi-Fi, open the app. Wait a few seconds.

```bash
ssh root@192.168.3.1 'pigeonmesh status | grep -E "peers|carried"'
```

```
  mesh       0 flooded, 0 gossip rounds, carried in 1 / out 0
  peers      0
```

```bash
ssh root@192.168.3.1 'pigeonmesh tail 5'
```

```
    2m  sos      OpenWrt (node) 12 people stranded at Mirpur bridge, no boat
```

**Router A still has zero peers.** It has never had any contact with router B.
The alert arrived because a person walked across the room with it in their
pocket, and neither the person nor the routers did anything deliberate.

That is a district-scale network built out of people who are already walking.

### Restore

```bash
ssh root@192.168.2.1 'pigeonmesh link 192.168.3.1'
```

---

## 6. If there is time (1 min)

**Priority under pressure.** Explain that on the 6.6 MB router the store is
budgeted in bytes, and eviction drops chat before it drops an SOS. A "where is
my daughter" record outliving a "hello" is a requirement, not an optimisation.

**Power cuts.** `/var` is tmpfs. The store checkpoints to flash every five
minutes and on shutdown, so a blackout costs minutes of records, not all of
them — while writing rarely enough not to wear the flash out.

**Clocks.** Routers in a blackout have no NTP and often no RTC. Nodes run a
logical clock so the mesh agrees on ordering even when a node thinks it is
1970, and the app says when a node is guessing.

**The crypto is real.** Open `selftest.html`: 27 checks against the published
RFC vectors, including tamper, impersonation and third-party-decryption
negatives.

---

## Questions you will be asked

**"Isn't this just a chat app on a router?"**
The chat is the least interesting part. The system is a replicated log with
priority-aware eviction and a delay-tolerant carry protocol; chat is one record
kind out of ten.

**"What if someone floods it?"**
Per-source token bucket on writes, capped bodies, bounded timestamps, and
priority-aware eviction so flooding evicts the flood before it evicts an SOS.

**"Can the router read my messages?"**
Not direct messages — those are ChaCha20-Poly1305 over X25519 and the keys
never leave the phone. Everything else is a public bulletin board and the
interface does not pretend otherwise. See `docs/SECURITY.md`, which also lists
what this does *not* protect against.

**"Why not LoRa / Bluetooth / Wi-Fi Direct?"**
Because the hardware people already own is a Wi-Fi router, and the software
they already have is a browser. Nothing here forecloses a LoRa transport — it
would be another peer link feeding the same record store.

**"Does it need the internet to set up?"**
No. Install the package, open the page. That is all.
