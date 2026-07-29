# PigeonMesh ESP32 / NodeMCU firmware

> A ₹400 ESP32 becomes a stationary PigeonMesh peer. Sensor-driven SOS +
> mesh-driven alarm + Bloom carry sync — all in a single `.ino` file.

## What it does

| Pin | Component | What it does |
|---|---|---|
| GPIO 4 | Float switch (flood) | Active-low. Steady low for 2 s → posts an SOS record to the mesh. |
| GPIO 0 | Panic button (BOOT) | Hold 3 s → manual SOS. |
| GPIO 2 | LED / relay | Onboard LED + external siren. Fires 3× 1-second bursts on any SOS record from anywhere in the mesh. |
| GPIO 15 | Active buzzer | Same as LED. |
| GPIO 34 | Battery divider (optional) | 100k/100k divider from a 18650 cell. Reported as `battery` to `/api/sync`. |

Power draw on a 18650 cell (2200 mAh): ~14 h with Wi-Fi on and 30 s sync
interval, ~38 h with `PM_SYNC_INTERVAL_SEC=120`.

## Hardware

- **ESP32 DevKit v1** (38-pin) — recommended, cheapest, what the firmware
  is tested on. ~₹350
- **NodeMCU-32S** — identical firmware, different pinout sticker.
- **ESP32-C3 SuperMini** — works with the `esp32-c3` PlatformIO env.
- **Float switch** — any marine-grade normally-closed reed switch. ~₹120
- **Active buzzer** — 3.3 V piezo. ~₹25
- **18650 + holder** — any 2200 mAh cell. ~₹80

Total bill of materials: roughly ₹450–770 per node, including solar.

## Wiring

```
 ESP32                  float switch           buzzer          LED
 ───────                ──────────────         ───────         ────
 3V3  ──────────────────┤●                    │               │
                            │                  │               │
 GPIO4 (pull-up) ──────────┤●                  │               │
                                              │               │
 GPIO15 ───────────────────────────────────●──┤>├───  GND      │
                                                              │
 GPIO2  ─────────────────────────────────────────────────●────┤
                                                                 │
 GND   ─────────────────────────────────────────────────────────┴──
```

## Flash

### Arduino IDE

1. Install the [ESP32 board package](https://docs.espressif.com/projects/arduino-esp32/en/latest/installing.html).
2. Install **ArduinoJson** by Benoit Blanchon from the Library Manager.
3. Open `pigeonmesh-esp32.ino`.
4. Edit the `USER CONFIG` block at the top of the file:
   ```cpp
   #define WIFI_SSID           "relief-shelter"
   #define WIFI_PASS           "shelter1234"
   #define PM_NODE_URL         "http://pigeon.mesh"
   #define PM_NODE_URL_FALLBACK "http://pigeon.mesh:8080"
   ```
5. Select **Tools → Board → ESP32 Arduino → ESP32 Dev Module**.
6. Select the port. Press Upload.
7. Open Serial Monitor at 115200 baud.

### PlatformIO

```bash
cd pigeonmesh-esp32
pio run -t upload
pio run -t monitor
```

## Default URL

The firmware defaults to `http://pigeon.mesh` — the address every
PigeonMesh router now serves on port 80 (no `:8080` needed). To use a
cloud bridge instead, change `PM_NODE_URL` to your Vercel URL:

```cpp
#define PM_NODE_URL         "https://your-app.vercel.app"
```

## Verify

After boot, the serial console prints:

```
[wifi] connecting to relief-shelter.....
[wifi] connected, ip=192.168.3.142
[pm] node id = esp32-a1b2c3d4
[pm] upstream = http://pigeon.mesh
[pm] ready. SOS from anywhere in the mesh will fire the alarm.
```

Trigger the float switch (or hold the BOOT button for 3 s). You should
see:

```
[sos] Panic button held 3s — manual SOS
[pm] carried in 0 records (store now 1)
[alarm] SOS from mesh: esp32-a1b2c3d4…
```

And the LED + buzzer fire. The SOS appears on the PWA and (if the router
is bridged) on the cloud dashboard.

## Troubleshooting

**`[wifi] FAILED`** — wrong SSID or password, or the router is 5 GHz
only. ESP32 is 2.4 GHz only.

**`[pm] sync HTTP -1`** — the URL is wrong, or HTTPS is being blocked
by a captive portal. Try the http:// fallback URL.

**Float switch triggers constantly** — water is sloshing. The firmware
already debounces 2 s — raise it in `handleSensors()` to 5 s if needed.
Use a PVC stilling tube to keep wave action off the float.

## Licence

GPL-2.0-only, same as the rest of PigeonMesh.
