# Threat model

The people this is built for may be in a flood, or they may be in a shutdown
where someone is actively looking for them. Those are different threats and
this document separates what PigeonMesh actually defends against from what it
does not. The second list is the more important one.

## The core decision: routers are untrusted relays

A router carries records. It does not verify them, cannot read encrypted ones,
and has no notion of accounts or identity. All trust is at the endpoints.

The reason is concrete: in a protest or shutdown, a router is the thing that
gets seized. Whoever takes it should gain as little as possible.

Because signing and encryption happen in the browser with keys that never
leave the device, seizing a node yields:

- the public bulletin board — chat, SOS alerts, check-ins, map pins, all of
  which were broadcast to everyone anyway
- ciphertext of direct messages it cannot decrypt
- **no private keys**, so no ability to forge a message from anyone
- **no ability to alter history** without detection: the app verifies every
  signature it displays and marks a failure in red

A compromised router can still **drop** records, **delay** them, or **inject**
its own unsigned ones. Dropping is bounded by gossip and by carry: any other
node or any passing phone re-supplies what was dropped. Injection is visible —
records from a router carry `author: "node:<id>"` and no signature, and the app
labels them "from node" rather than "verified", because the router genuinely
cannot prove who typed the command.

## Cryptography

| | |
|---|---|
| Signing | Ed25519 (RFC 8032) over a canonical encoding of the record |
| Direct messages | X25519 (RFC 7748) → ChaCha20-Poly1305 (RFC 8439) |
| Hash | SHA-512 (FIPS 180-4) |
| Randomness | `crypto.getRandomValues` |

All implemented in plain JavaScript and validated against the official test
vectors in `selftest.html`, including negative tests: a tampered body, a
swapped author, a mauled ciphertext and a third party attempting to decrypt.

### Why not WebCrypto

`crypto.subtle` is unavailable outside a secure context, and a router in a
flood zone cannot obtain a TLS certificate for `http://pigeon.mesh` — there is
no CA to reach and no DNS to validate against. The realistic choice was plain
JavaScript primitives or no end-to-end cryptography at all.

`crypto.getRandomValues` is *not* gated behind a secure context, so key
material is properly random regardless.

Measured cost on a mid-range phone: keygen 0.7 ms, sign 0.9 ms, verify 1.3 ms.

### Signing over a canonical encoding

Signatures cover a fixed concatenation of the record's fields with a
key-sorted encoding of the body, not its JSON text. Two JSON encoders order
keys differently, and a signature that depends on key order is a signature
that fails at random after crossing a hop.

The claimed `author` must equal the fingerprint of the attached public key, so
a valid signature cannot be re-attached under someone else's name.

## Identity

There is no registration. On first run the app generates an Ed25519 signing
key and an X25519 key-agreement key, and derives a fingerprint. Two people who
need certainty compare a three-word code (`akash-bagh-dhan`) — designed to be
read aloud across a room, not compared as 64 hex digits.

This is trust-on-first-use. A name is not proof; the words are.

## Availability

- POSTs are rate-limited per source address with a token bucket, so one
  malfunctioning or hostile client on the Wi-Fi cannot fill a 6 MB flash chip.
- Record bodies are capped, timestamps bounded, JSON nesting depth limited.
- Storage eviction is priority-aware, so flooding a node with chat cannot push
  out an SOS.
- Every request handler is wrapped so a malformed request cannot crash the node.
- Ports are LAN-only.

## What this does NOT protect against

Stated plainly, because a crisis tool that oversells itself gets people hurt.

**No forward secrecy.** Direct messages use a static-static X25519 exchange
with no ratchet. Someone who obtains your device's key can decrypt every past
message it holds. This was a deliberate trade: a ratchet needs both parties
online in sequence, and the entire point of the carry protocol is that they are
not.

**No metadata privacy.** Relays see who is talking to whom and when. A phone
that carries records reveals, to the next node, roughly what it has been near.
Traffic analysis is entirely feasible for anyone who controls several nodes.

**No protection against a hostile node operator dropping traffic.** Gossip and
carry make it hard to suppress something permanently, but a node can quietly
fail to forward. There is no proof-of-delivery.

**No Sybil resistance.** Anyone can generate unlimited identities. Nothing
stops fake check-ins or fabricated missing-person reports beyond signature
verification proving they came from *some* consistent key. Verified means
"this is the same person who sent the earlier message", not "this person is
who they claim to be".

**No protection against a physically seized unlocked phone.** Keys and records
sit in browser storage. `Erase everything` wipes them, but it must be pressed.

**Wiping a node does not unpublish anything.** This surprised us during
testing and is worth stating loudly: we wiped both lab routers to zero records,
and within seconds they were back — carried in by browsers that still held
them. Replication and deniability are directly opposed, and this system chose
replication. `pigeonmesh wipe` removes what *this node* holds; it does not and
cannot remove a record from the mesh. Anything you post should be treated as
unrecallable the moment a second device has seen it. The CLI now says so before
it will run.

**The service worker usually does not run.** It requires a secure context, and
mesh nodes serve plain HTTP. The app works fully while in range of a node; it
generally cannot launch from scratch while out of range of every node. On a
deployment where a self-signed certificate is installed on volunteers' phones,
it does.

**Radio is radio.** PigeonMesh does nothing to hide that a Wi-Fi network is
present, or that a phone is associated with it. Anyone with a direction finder
can locate a node.

## Reasonable deployment advice

- Run nodes on hardware you can afford to lose.
- Do not put PigeonMesh on a router that also carries a WAN uplink you care about.
- For sensitive coordination, treat every channel except direct messages as
  public, because it is.
- Tell people what the verification badge means, and what it does not.
