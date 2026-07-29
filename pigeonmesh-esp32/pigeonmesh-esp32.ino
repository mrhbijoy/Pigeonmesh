/*
  PigeonMesh ESP32 / NodeMCU — single-file firmware
  ==================================================
  Turns a ₹400 ESP32 into a stationary PigeonMesh node. It joins the
  same mesh a phone does — over HTTP /api/sync, using the same Bloom
  filter — and adds two things a phone can't do:

    1. Sensor input  : a float switch on a GPIO raises an SOS record the
                       instant water crosses it. No app, no SMS, no human
                       in the loop. The record reaches every phone on
                       every node in the mesh.
    2. Actuator output: when any SOS record arrives from anywhere in the
                       mesh, the alarm LED + buzzer fire. A village siren
                       that runs off a 18650 cell.

  It also keeps the Bloom-filter carry protocol running, so an ESP32
  mounted in a vehicle that drives between two disconnected meshes
  reconciles them in one round trip — exactly the way a phone does.

  BUILD:
    Arduino IDE  : install ESP32 board package + ArduinoJson library.
                   Open this file, edit WIFI_SSID/WIFI_PASS/PM_NODE_URL
                   below, select board, press Upload.
    PlatformIO   : put this file in src/ as main.cpp, `pio run -t upload`.

  WIRING (default, edit pins below to match your board):
    GPIO 4  → float switch (NC to 3V3, common to GPIO4, active LOW = water)
    GPIO 0  → panic button (BOOT button, hold 3s = manual SOS)
    GPIO 2  → LED + 220Ω (onboard LED on DevKit v1)
    GPIO 15 → active buzzer (3.3V)
    GPIO 34 → 18650 voltage divider (100k/100k, optional)

  POWER:
    ~80 mA idle, ~240 mA during sync. A 2200 mAh 18650 lasts ~14h with
    30s sync interval. Add a 5W solar + TP4056 for indefinite outdoor use.

  Licence: GPL-2.0-only, same as the rest of PigeonMesh.
*/

// ============================== USER CONFIG ==============================
// Edit these for your network. The ESP32 joins this Wi-Fi as a station.
// PM_NODE_URL is where to sync — http://pigeon.mesh works on any
// PigeonMesh router. For cloud bridge, use https://your-app.vercel.app.
#define WIFI_SSID           "relief-shelter"
#define WIFI_PASS           "shelter1234"
#define PM_NODE_URL         "http://pigeon.mesh:3607"
#define PM_NODE_URL_FALLBACK "http://pigeon.mesh:8080"
#define PM_NODE_NAME        "esp32-sensor-1"
#define PM_SYNC_INTERVAL_SEC 30
#define PM_CARRY_MODE       1
#define PM_MAX_RECORDS      200

// Pin map (edit for your board)
#define FLOAT_SWITCH_PIN    4
#define PANIC_BUTTON_PIN    0
#define ALARM_LED_PIN       2
#define BUZZER_PIN          15
#define BATTERY_ADC_PIN     34
// ==========================================================================

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <vector>

// ============================== BLOOM FILTER ==============================
// Bit-identical to src/lib/pigeonmesh/bloom.ts and the Lua store:
// FNV-1a with two seeds (2166136261, 40389), Kirsch-Mitzenmacher k=6.

static inline uint32_t pm_fnv1a(const String &s, uint32_t seed = 2166136261u) {
  uint32_t h = seed;
  for (size_t i = 0; i < s.length(); i++) {
    h ^= (uint8_t)s.charAt(i);
    h *= 16777619u;
  }
  return h;
}

static inline void pm_bloom_params(size_t n, uint16_t &bits, uint8_t &k) {
  bits = 1024;
  while (bits < (uint16_t)(n * 10) && bits < 65536) bits <<= 1;
  k = 6;
}

static inline void pm_positions(const String &id, uint16_t bits, uint8_t k, uint16_t *out) {
  uint32_t h1 = pm_fnv1a(id, 2166136261u);
  uint32_t h2 = pm_fnv1a(id, 40389u);
  if ((h2 & 1) == 0) h2 |= 1;
  if (h2 == 0) h2 = 1;
  for (uint8_t i = 0; i < k; i++) {
    out[i] = (uint16_t)(((h1 + i * h2) % bits));
  }
}

struct PmBloom {
  uint16_t bits;
  uint8_t  k;
  std::vector<uint8_t> bytes;

  void reset(uint16_t bits_, uint8_t k_) {
    bits = bits_; k = k_;
    bytes.assign(bits / 8, 0);
  }
  void add(const String &id) {
    uint16_t pos[16];
    pm_positions(id, bits, k, pos);
    for (uint8_t i = 0; i < k; i++) {
      bytes[pos[i] / 8] |= (1 << (pos[i] % 8));
    }
  }
  String toHex() const {
    String s; s.reserve(bytes.size() * 2);
    char buf[3];
    for (uint8_t b : bytes) { snprintf(buf, 3, "%02x", b); s += buf; }
    return s;
  }
  String toJson(size_t count) const {
    return "{\"bits\":" + String(bits) + ",\"k\":" + String(k) +
           ",\"data\":\"" + toHex() + "\",\"count\":" + String(count) + "}";
  }
};

// ============================== RECORD STORE ==============================
struct PmRecord {
  String id, kind, chan, nick, author, origin, body;
  uint32_t ts = 0, exp = 0;
};

static std::vector<PmRecord> g_store;
static std::vector<PmRecord> g_outbox;
static PmBloom g_bloom;
static bool g_bloom_dirty = true;
static String g_nodeId;
static void (*g_onRecord)(const PmRecord &) = nullptr;

static String pm_randomId() {
  char buf[33];
  for (int i = 0; i < 32; i++) {
    uint8_t v = (uint8_t)(esp_random() & 0xf);
    buf[i] = v < 10 ? '0' + v : 'a' + (v - 10);
  }
  buf[32] = 0;
  return String(buf);
}

static uint32_t pm_nowSec() {
  return (uint32_t)(time(nullptr) > 0 ? time(nullptr) : (millis() / 1000 + 1700000000u));
}

static int pm_batteryPct() {
#if SOC_ADC_SUPPORTED
  uint32_t raw = analogRead(BATTERY_ADC_PIN);
  float v = (raw / 4095.0) * 2 * 3.3;
  if (v < 3.0) return 0;
  if (v > 4.2) return 100;
  return (int)((v - 3.0) / 1.2 * 100);
#else
  return -1;
#endif
}

static void pm_rebuildBloom() {
  uint16_t bits; uint8_t k;
  pm_bloom_params(g_store.size(), bits, k);
  g_bloom.reset(bits, k);
  for (const auto &r : g_store) g_bloom.add(r.id);
  g_bloom_dirty = false;
}

static bool pm_ingest(const PmRecord &r) {
  for (const auto &s : g_store) if (s.id == r.id) return false;
  g_store.push_back(r);
  if (g_store.size() > PM_MAX_RECORDS) g_store.erase(g_store.begin());
  g_bloom_dirty = true;
  if (g_onRecord) g_onRecord(r);
  return true;
}

static String pm_outboxToJson() {
  String s = "[";
  for (size_t i = 0; i < g_outbox.size(); i++) {
    if (i) s += ",";
    const PmRecord &r = g_outbox[i];
    s += "{\"id\":\"" + r.id + "\",\"kind\":\"" + r.kind + "\"";
    s += ",\"ts\":" + String(r.ts) + ",\"exp\":" + String(r.exp);
    s += ",\"chan\":\"" + r.chan + "\",\"nick\":\"" + r.nick + "\"";
    s += ",\"origin\":\"" + r.origin + "\",\"body\":" + r.body + "}";
  }
  s += "]";
  return s;
}

// ============================== SYNC ==============================
static String pm_pickUrl() {
  return String(PM_NODE_URL).length() > 0 ? PM_NODE_URL : PM_NODE_URL_FALLBACK;
}

static void pm_handleSyncResponse(const String &body) {
  JsonDocument doc;
  if (deserializeJson(doc, body) != DeserializationError::Ok) return;
  JsonArray recs = doc["records"].as<JsonArray>();
  if (recs.isNull()) return;
  int taken = 0;
  for (JsonValue v : recs) {
    JsonObject r = v.as<JsonObject>();
    PmRecord rec;
    rec.id     = r["id"]     | "";
    rec.kind   = r["kind"]   | "";
    rec.ts     = r["ts"]     | 0u;
    rec.exp    = r["exp"]    | 0u;
    rec.chan   = r["chan"]   | "public";
    rec.nick   = r["nick"]   | "anon";
    rec.author = r["author"] | "";
    rec.origin = r["origin"] | "";
    JsonVariant b = r["body"];
    String bs;
    if (b.is<String>()) bs = b.as<String>();
    else serializeJson(b, bs);
    rec.body = bs;
    if (rec.id.length() < 16) continue;
    if (pm_ingest(rec)) taken++;
  }
  if (taken > 0) {
    Serial.printf("[pm] carried in %d records (store now %d)\n", taken, g_store.size());
  }
}

static void pm_syncOnce() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (g_bloom_dirty) pm_rebuildBloom();

  String nodeUrl = pm_pickUrl();
  String body = "{\"node\":\"" + g_nodeId + "\",\"name\":\"" PM_NODE_NAME "\"";
  body += ",\"kind\":\"esp32\",\"battery\":" + String(pm_batteryPct());
  body += ",\"uptime\":" + String(millis() / 1000);
  body += ",\"digest\":" + g_bloom.toJson(g_store.size());
  body += ",\"records\":" + pm_outboxToJson() + "}";

  // Try primary URL, then fallback.
  for (int attempt = 0; attempt < 2; attempt++) {
    String url = (attempt == 0) ? nodeUrl : String(PM_NODE_URL_FALLBACK);
    if (url.length() == 0) continue;

    HTTPClient http;
    bool secure = url.startsWith("https://");
    std::unique_ptr<WiFiClient> client;
    std::unique_ptr<WiFiClientSecure> sclient;
    bool ok = false;
    if (secure) {
      sclient = std::make_unique<WiFiClientSecure>();
      sclient->setInsecure();
      ok = http.begin(*sclient, url + "/api/pigeonmesh/sync");
    } else {
      client = std::make_unique<WiFiClient>();
      ok = http.begin(*client, url + "/api/pigeonmesh/sync");
    }
    if (!ok) continue;
    http.addHeader("Content-Type", "application/json");
    http.setTimeout(8000);
    int code = http.POST(body);
    if (code == HTTP_CODE_OK) {
      pm_handleSyncResponse(http.getString());
      g_outbox.clear();
      http.end();
      return;
    }
    http.end();
    Serial.printf("[pm] sync %s → HTTP %d\n", url.c_str(), code);
  }
}

// ============================== PUBLIC API ==============================
static void pm_begin() {
  uint64_t mac = ESP.getEfuseMac();
  char buf[24];
  snprintf(buf, sizeof(buf), "esp32-%04x%04x", (uint16_t)(mac >> 32), (uint16_t)mac);
  g_nodeId = String(buf);
}

static void pm_loop(uint32_t now) {
  static uint32_t lastSync = 0;
  static uint32_t interval = PM_SYNC_INTERVAL_SEC * 1000UL;
  if (interval > 0 && now - lastSync >= interval) {
    lastSync = now;
    pm_syncOnce();
  }
}

static void pm_post(PmRecord &r) {
  if (r.id.length() == 0) r.id = pm_randomId();
  if (r.ts == 0) r.ts = pm_nowSec();
  if (r.exp == 0) r.exp = r.ts + 24 * 3600;
  if (r.origin.length() == 0) r.origin = g_nodeId;
  if (r.body.length() == 0) r.body = "{}";
  pm_ingest(r);
  g_outbox.push_back(r);
  if (g_outbox.size() > 32) g_outbox.erase(g_outbox.begin());
}

static void pm_onRecord(void (*cb)(const PmRecord &)) { g_onRecord = cb; }
static String pm_nodeId() { return g_nodeId; }

// ============================== SENSOR HANDLING ==============================
static volatile bool g_floatTriggered = false;
static volatile bool g_panicHeld = false;
static volatile uint32_t g_panicPressStart = 0;
static uint32_t g_lastFloatEdge = 0;
static bool g_floatState = false;

static void IRAM_ATTR onFloatEdge() { g_floatTriggered = true; }
static void IRAM_ATTR onPanicEdge() {
  bool down = (digitalRead(PANIC_BUTTON_PIN) == LOW);
  if (down) g_panicPressStart = millis();
  else {
    uint32_t held = millis() - g_panicPressStart;
    if (held >= 3000) g_panicHeld = true;
    g_panicPressStart = 0;
  }
}

static void handleSensors() {
  uint32_t now = millis();
  if (g_floatTriggered) {
    bool cur = (digitalRead(FLOAT_SWITCH_PIN) == LOW);
    if (cur && !g_floatState) {
      if (now - g_lastFloatEdge > 2000) {
        g_floatState = true;
        g_lastFloatEdge = now;
        g_floatTriggered = false;
        sendSos("Flood sensor triggered — water level above threshold");
      } else {
        g_lastFloatEdge = now;
      }
    } else if (!cur) {
      g_floatTriggered = false;
      g_floatState = false;
    }
  }
  if (g_panicHeld) {
    g_panicHeld = false;
    sendSos("Panic button held 3s — manual SOS");
  }
}

static void sendSos(const String &text) {
  Serial.printf("[sos] %s\n", text.c_str());
  for (int i = 0; i < 5; i++) {
    digitalWrite(ALARM_LED_PIN, HIGH); digitalWrite(BUZZER_PIN, HIGH);
    delay(150);
    digitalWrite(ALARM_LED_PIN, LOW);  digitalWrite(BUZZER_PIN, LOW);
    delay(150);
  }
  PmRecord r;
  r.kind = "sos"; r.chan = "sos"; r.nick = PM_NODE_NAME;
  r.body = "{\"text\":\"" + text + "\",\"source\":\"esp32\"}";
  pm_post(r);
}

static void handleAlarm(const PmRecord &r) {
  if (r.kind != "sos") return;
  Serial.printf("[alarm] SOS from mesh: %s\n", r.id.c_str());
  for (int i = 0; i < 3; i++) {
    digitalWrite(ALARM_LED_PIN, HIGH); digitalWrite(BUZZER_PIN, HIGH);
    delay(1000);
    digitalWrite(ALARM_LED_PIN, LOW);  digitalWrite(BUZZER_PIN, LOW);
    delay(200);
  }
}

// ============================== SETUP + LOOP ==============================
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println(F("\n[PigeonMesh ESP32] booting…"));

  pinMode(FLOAT_SWITCH_PIN,  INPUT_PULLUP);
  pinMode(PANIC_BUTTON_PIN,  INPUT_PULLUP);
  pinMode(ALARM_LED_PIN,     OUTPUT);
  pinMode(BUZZER_PIN,        OUTPUT);
  digitalWrite(ALARM_LED_PIN, LOW);
  digitalWrite(BUZZER_PIN,    LOW);

  attachInterrupt(digitalPinToInterrupt(FLOAT_SWITCH_PIN), onFloatEdge, CHANGE);
  attachInterrupt(digitalPinToInterrupt(PANIC_BUTTON_PIN), onPanicEdge, CHANGE);

  Serial.printf("[wifi] connecting to %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.setHostname("pigeonmesh-esp32");
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 30 * 1000) {
    delay(400); Serial.print(".");
  }
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println(F("\n[wifi] FAILED — running offline."));
  } else {
    Serial.printf("\n[wifi] connected, ip=%s\n", WiFi.localIP().toString().c_str());
  }

  pm_begin();
  pm_onRecord(handleAlarm);
  Serial.printf("[pm] node id = %s\n", pm_nodeId().c_str());
  Serial.printf("[pm] upstream = %s\n", pm_pickUrl().c_str());
  Serial.println(F("[pm] ready. SOS from anywhere in the mesh will fire the alarm."));
}

void loop() {
  pm_loop(millis());
  handleSensors();
}
