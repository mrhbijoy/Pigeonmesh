"use client";
// SetupTabs — the field-deployment guide. Four tracks:
//   1. Cloud bridge (this Vercel app)
//   2. OpenWrt router
//   3. ESP32 / NodeMCU sensor node
//   4. Android APK client
//
// Each tab has copy-paste commands and a short rationale. The aim is: a
// volunteer with a laptop and a router they bought yesterday can stand up
// a working crisis mesh in under an hour.

import { useState } from "react";
import { CloudIcon, RadioIcon, ChipIcon, PhoneIcon } from "./icons";
import { CodeBlock } from "./CodeBlock";

type Tab = "bridge" | "router" | "esp32" | "apk";

export function SetupTabs({ bridgeUrl }: { bridgeUrl: string }) {
  const [tab, setTab] = useState<Tab>("bridge");
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/60">
      <header className="border-b border-slate-800 p-4">
        <h2 className="text-base font-semibold text-slate-200">All-in-one disaster-tech setup</h2>
        <p className="mt-1 text-xs text-slate-400">
          Four pieces, one mesh. Pick the track that matches the hardware in your hand.
        </p>
      </header>
      <div className="flex flex-wrap gap-1 border-b border-slate-800 p-2">
        <TabBtn active={tab === "bridge"} onClick={() => setTab("bridge")} icon={<CloudIcon />}>
          Cloud bridge
        </TabBtn>
        <TabBtn active={tab === "router"} onClick={() => setTab("router")} icon={<RadioIcon />}>
          OpenWrt router
        </TabBtn>
        <TabBtn active={tab === "esp32"} onClick={() => setTab("esp32")} icon={<ChipIcon />}>
          ESP32 / NodeMCU
        </TabBtn>
        <TabBtn active={tab === "apk"} onClick={() => setTab("apk")} icon={<PhoneIcon />}>
          Android APK
        </TabBtn>
      </div>
      <div className="p-4">
        {tab === "bridge" && <BridgeTab bridgeUrl={bridgeUrl} />}
        {tab === "router" && <RouterTab bridgeUrl={bridgeUrl} />}
        {tab === "esp32" && <Esp32Tab bridgeUrl={bridgeUrl} />}
        {tab === "apk" && <ApkTab />}
      </div>
    </section>
  );
}

function TabBtn({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
        active
          ? "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30"
          : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function BridgeTab({ bridgeUrl }: { bridgeUrl: string }) {
  return (
    <div className="space-y-4 text-sm text-slate-300">
      <p>
        This page <em>is</em> the cloud bridge. It is a Next.js 16 app that exposes the same HTTP
        API as the on-router daemon — <code className="font-mono text-amber-300">/api/pigeonmesh/sync</code>,
        <code className="font-mono text-amber-300"> /api/pigeonmesh/records</code>,
        <code className="font-mono text-amber-300"> /api/pigeonmesh/state</code> — so any router that can
        reach the internet can sync with it as a peer. The bridge then fans records out to every
        other bridged mesh, and to every browser watching this dashboard live.
      </p>
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
          1 · Deploy to Vercel
        </h3>
        <CodeBlock>{`# from the project root
npm i -g vercel
vercel link
vercel --prod

# or use the Vercel dashboard: Import Git repo → Deploy.
# No env vars are required for a fresh bridge to boot.`}</CodeBlock>
      </div>
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
          2 · Optional env vars
        </h3>
        <CodeBlock>{`PIGEONMESH_NODE_ID      = pm-bridge-dhaka     # stable id, defaults to pm-bridge-<vercel-hash>
PIGEONMESH_NODE_NAME    = Dhaka Cloud Bridge  # display name in topology
PIGEONMESH_MAX_BYTES    = 67108864            # store budget, default 64 MB
PIGEONMESH_POST_BURST   = 60                  # per-source write burst
PIGEONMESH_UPSTREAM_URL = http://192.168.3.1:8080  # if bridge should poll a router`}</CodeBlock>
      </div>
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
          3 · Verify
        </h3>
        <CodeBlock>{`curl ${bridgeUrl || "https://your-app.vercel.app"}/api/pigeonmesh/health
# => {"ok":true,"node":"pm-bridge-...","time":1785164281}`}</CodeBlock>
      </div>
      <p className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200/90">
        Once a router syncs with this bridge, every other router that syncs with this bridge
        converges with it. Two flood-isolated meshes that have never met each other end up
        holding the same set of records because they both meet the cloud.
      </p>
    </div>
  );
}

function RouterTab({ bridgeUrl }: { bridgeUrl: string }) {
  return (
    <div className="space-y-4 text-sm text-slate-300">
      <p>
        Install the PigeonMesh package on any OpenWrt 23.05+ router. One ~100 KB package
        opens the right firewall ports on the LAN side, points
        <code className="font-mono text-amber-300"> pigeon.mesh</code> at the router, and starts on boot.
        People join by opening <code className="font-mono text-amber-300">http://pigeon.mesh:8080/</code> —
        no app, no account, no server.
      </p>
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
          1 · Install on the router
        </h3>
        <CodeBlock>{`# OpenWrt 24.10+ (apk)
apk add --allow-untrusted pigeonmesh-1.0.0-r1.apk

# OpenWrt ≤ 23.05 (opkg)
opkg install pigeonmesh_1.0.0-r1_all.ipk

# Or from tarball on any Linux router
tar xzf pigeonmesh-1.0.0-r1.tar.gz -C /`}</CodeBlock>
      </div>
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
          2 · Link a second router
        </h3>
        <CodeBlock>{`# on router B (which joined A's Wi-Fi as a client)
pigeonmesh link 192.168.3.1
pigeonmesh status          # should show 1 peer`}</CodeBlock>
      </div>
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
          3 · Bridge this router to the cloud (when internet is up)
        </h3>
        <p className="mb-2 text-xs text-slate-400">
          Add a 30-second cron that calls the bridge's <code className="font-mono">/api/sync</code> — the
          same data-mule endpoint phones use. The bridge fans records out to every other bridged mesh.
        </p>
        <CodeBlock>{`# /etc/init.d/pigeonmesh-bridge  (chmod +x)
cat > /etc/init.d/pigeonmesh-bridge <<'EOF'
#!/bin/sh /etc/rc.common
START=99
start() {
  ( while true; do
      BODY=\$(cat /var/lib/pigeonmesh/digest.json 2>/dev/null || echo '{}')
      curl -s -m 10 -X POST \\
        -H "Content-Type: application/json" \\
        -d "\$BODY" \\
        ${bridgeUrl || "https://your-app.vercel.app"}/api/pigeonmesh/sync \\
        > /tmp/pm-bridge-sync.json
      # push any new records the bridge sent back into the local mesh
      cat /tmp/pm-bridge-sync.json | pigeonmesh ingest 2>/dev/null
      sleep 30
    done ) &
}
EOF
chmod +x /etc/init.d/pigeonmesh-bridge
/etc/init.d/pigeonmesh-bridge enable
/etc/init.d/pigeonmesh-bridge start`}</CodeBlock>
      </div>
      <p className="rounded-md border border-slate-700 bg-slate-800/40 p-3 text-xs text-slate-400">
        The router keeps working with <strong>zero</strong> internet. The bridge cron only matters
        when the uplink is up — and when it is, a coordinator on the other side of the world sees
        every SOS, missing-person report and safe check-in from this mesh in real time.
      </p>
    </div>
  );
}

function Esp32Tab({ bridgeUrl }: { bridgeUrl: string }) {
  return (
    <div className="space-y-4 text-sm text-slate-300">
      <p>
        An ESP32 or NodeMCU becomes a stationary mesh node: it joins a router's Wi-Fi, performs the
        same Bloom-filter sync a phone does, and either raises SOS records from a sensor (float
        switch, smoke detector, panic button) or triggers a GPIO when an SOS lands anywhere in the
        mesh — a village siren, a relay, a beacon. <strong>~₹400 of hardware per node.</strong>
      </p>
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
          1 · Wire the sensor node
        </h3>
        <div className="overflow-x-auto rounded-md border border-slate-800">
          <table className="w-full text-xs">
            <thead className="bg-slate-800/50 text-slate-300">
              <tr>
                <th className="p-2 text-left">Component</th>
                <th className="p-2 text-left">ESP32 pin</th>
                <th className="p-2 text-left">Purpose</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-400">
              <tr><td className="p-2">Float switch (flood)</td><td className="p-2 font-mono">GPIO 4</td><td className="p-2">active-low, internal pull-up</td></tr>
              <tr><td className="p-2">Panic button</td><td className="p-2 font-mono">GPIO 0</td><td className="p-2">BOOT button, hold 3s = SOS</td></tr>
              <tr><td className="p-2">LED / relay (alarm)</td><td className="p-2 font-mono">GPIO 2</td><td className="p-2">fires on any SOS in mesh</td></tr>
              <tr><td className="p-2">Buzzer</td><td className="p-2 font-mono">GPIO 15</td><td className="p-2">audible SOS alert</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
          2 · Flash the firmware
        </h3>
        <CodeBlock>{`# download the disaster-kit bundle (see Cloud bridge tab for URL)
cd pigeonmesh-esp32
# edit config.h: WIFI_SSID, WIFI_PASS, PM_NODE_URL
arduino-cli compile --fqbn esp32:esp32:esp32 ./
arduino-cli upload -p /dev/ttyUSB0 --fqbn esp32:esp32:esp32 ./

# Or, with PlatformIO:
pio run -t upload`}</CodeBlock>
      </div>
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
          3 · Point it at this bridge (or a local router)
        </h3>
        <CodeBlock>{`// pigeonmesh-esp32/config.h
#define WIFI_SSID       "relief-shelter"
#define WIFI_PASS       "shelter1234"
#define PM_NODE_URL     "${bridgeUrl || "https://your-app.vercel.app"}"
#define PM_NODE_URL_FALLBACK "http://pigeon.mesh:8080"

#define FLOAT_SWITCH_PIN  4
#define PANIC_BUTTON_PIN  0
#define ALARM_LED_PIN     2
#define BUZZER_PIN        15

#define PM_SYNC_INTERVAL_SEC  30
#define PM_CARRY_MODE         1     // pull and push records`}</CodeBlock>
      </div>
      <p className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-200/90">
        The firmware is in the <code className="font-mono">pigeonmesh-esp32/</code> directory of the
        disaster-kit bundle. It does Bloom-filter sync against
        <code className="mx-1 font-mono">/api/sync</code>, posts SOS records on a float-switch trigger,
        and lights the alarm LED whenever a priority-0 record arrives. About 1.2 MB of flash, runs on
        a 18650 cell for ~14 hours.
      </p>
    </div>
  );
}

function ApkTab() {
  return (
    <div className="space-y-4 text-sm text-slate-300">
      <p>
        The PWA already installs on Android via "Add to Home Screen" — open
        <code className="font-mono text-amber-300"> http://pigeon.mesh:8080/</code> in Chrome, tap the
        menu, tap "Install". For field deployment, though, a real installable APK is easier to
        distribute: sideload once on a coordinator's phone, scan a QR code on everyone else's.
      </p>
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Option A · Capacitor wrapper (recommended)
        </h3>
        <CodeBlock>{`# from the disaster-kit bundle
cd pigeonmesh-apk
npm install
npx cap sync android
cd android
./gradlew assembleRelease

# APK lands at:
# android/app/build/outputs/apk/release/app-release.apk
# Sign it:
jarsigner -verbose -sigalg SHA256withRSA -digestalg SHA-256 \\
  app-release-unsigned.apk pigeonmesh.keystore
zipalign -v 4 app-release-unsigned.apk pigeonmesh-1.0.0.apk`}</CodeBlock>
      </div>
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Option B · Bubblewrap (TWA, no native code)
        </h3>
        <CodeBlock>{`npx @bubblewrap/cli init \\
  --manifest=https://your-app.vercel.app/pwa/manifest.webmanifest \\
  --packageId=com.pigeonmesh.app \\
  --name="PigeonMesh"
npx @bubblewrap/cli build
# → app-release-signed.apk`}</CodeBlock>
      </div>
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Option C · PWA install (zero build)
        </h3>
        <CodeBlock>{`# open on any Android phone, in Chrome:
http://pigeon.mesh:8080/
# ☰ menu → Install app → done.`}</CodeBlock>
      </div>
      <p className="rounded-md border border-slate-700 bg-slate-800/40 p-3 text-xs text-slate-400">
        The Capacitor project files are in <code className="font-mono">pigeonmesh-apk/</code> in the
        disaster-kit bundle. It wraps the original PWA at
        <code className="mx-1 font-mono">/pwa/</code> on this bridge — so the same binary runs against
        any mesh node, local or cloud.
      </p>
    </div>
  );
}
