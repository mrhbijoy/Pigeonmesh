// pigeonmesh/config.ts
// Runtime configuration for the cloud bridge node. Values come from env
// vars (set in Vercel) with sensible defaults so a fresh `vercel deploy`
// works out of the box.

export const BRIDGE_VERSION = "1.0.0-cloud";

// A stable node id for this bridge. Override with env so multiple bridges
// in the same mesh don't collide.
export const NODE_ID =
  process.env.PIGEONMESH_NODE_ID ||
  "pm-bridge-" +
    (process.env.VERCEL_URL || "local")
      .replace(/[^a-z0-9]/gi, "")
      .toLowerCase()
      .slice(0, 6)
      .padEnd(6, "0");

export const NODE_NAME = process.env.PIGEONMESH_NODE_NAME || "PigeonMesh Cloud Bridge";

// Storage ceiling. On a serverless host we don't have a flash budget, but
// keeping one keeps the API surface identical to a router and stops
// runaway growth if a malicious peer floods us.
export const MAX_BYTES = Number(process.env.PIGEONMESH_MAX_BYTES || 64 * 1024 * 1024);
export const MAX_BODY = Number(process.env.PIGEONMESH_MAX_BODY || 65536);

export const HTTP_PORT = Number(process.env.PORT || 8080);

export const DOMAIN = process.env.PIGEONMESH_DOMAIN || "pigeon.mesh";

// The channels the on-device PWA shows by default. Keep in sync with
// src/etc/config/pigeonmesh on the router side.
export const CHANNELS = ["general", "relief", "medical", "sos", "bulletin"];

// Rate limiting, mirroring the daemon's per-source token bucket.
export const POST_RATE = Number(process.env.PIGEONMESH_POST_RATE || 3); // tokens/sec
export const POST_BURST = Number(process.env.PIGEONMESH_POST_BURST || 60);

// When set, the bridge polls this upstream router URL on a schedule and
// syncs records both ways — useful when the router cannot reach the
// internet but the bridge can reach the router (e.g. via a VPN).
export const UPSTREAM_URL = process.env.PIGEONMESH_UPSTREAM_URL || "";
export const UPSTREAM_POLL_SEC = Number(process.env.PIGEONMESH_UPSTREAM_POLL_SEC || 30);

// Plausible timestamp bounds (2020-01-01 .. 2100-01-01). Anything outside
// is rejected outright, matching the daemon.
export const TS_MIN = 1577836800;
export const TS_MAX = 4102444800;
