# PigeonMesh — Complete Disaster Tech Bundle

> যোগাযোগ যেটা শাটডাউনেও কাজ করে।

## 📦 এই বান্ডলে যা আছে

| ফাইল | সাইজ | কী |
|---|---|---|
| `pigeonmesh-1.0.0-r1.apk` | 106 KB | OpenWrt 24.10+ / 25 প্যাকেজ |
| `pigeonmesh_1.0.0-r1_all.ipk` | 106 KB | OpenWrt ≤ 23.05 প্যাকেজ |
| `pigeonmesh-1.0.0-r1.tar.gz` | 104 KB | টারবল |
| `pigeonmesh-1.0.4-release.apk` | 3.2 MB | Android APK (সাইন করা) |
| `install-on-router.sh` | 3 KB | ক্লাউড ব্রিজ URL সেটআপ (ঐচ্ছিক) |
| `cloud-bridge/` | — | Vercel এ deploy করার কোড |
| `pigeonmesh-esp32/` | — | ESP32 ফার্মওয়্যার |
| `pigeonmesh-apk/` | — | Android সোর্স |
| `pigeonmesh-disaster-kit/` | — | স্ক্রিপ্ট + ডকস |

## 🚀 .ipk / .apk ইনস্টল করলে যা হবে

```bash
# OpenWrt 25:
apk add --allow-untrusted pigeonmesh-1.0.0-r1.apk

# OpenWrt ≤ 23.05:
opkg install pigeonmesh_1.0.0-r1_all.ipk
```

ইনস্টলের সাথে সাথেই (সব অটোমেটিক, কোনো আলাদা স্ক্রিপ্ট লাগে না):

1. **pigeonmeshd** চালু হয় (port 3607)
2. **uhttpd** port 80 এ (LuCI)
3. **DNS** — `pigeon.mesh` → রাউটার IP
4. **/www/index.html** — Host-based redirect:
   - `pigeon.mesh` → `:3607` (PigeonMesh)
   - IP → `/cgi-bin/luci` (LuCI)
5. **LuCI integration** — Services → PigeonMesh (Status, Live, Cloud, Settings)
6. **Firewall** — LAN জোনে 7100/7101/3607 খোলা
7. **Init scripts** — রিবুটে সব auto-start

ফলাফল:
```
http://pigeon.mesh/      → PigeonMesh (redirects to :3607)
http://192.168.3.1/      → LuCI (admin)
http://192.168.3.1:3607/ → PigeonMesh (direct)
```

## 🌐 কীভাবে কাজ করে

- uhttpd port 80 এ LuCI সার্ভ করে
- pigeonmeshd port 3607 এ PigeonMesh সার্ভ করে
- DNS: `pigeon.mesh` → `192.168.3.1`
- যখন `http://pigeon.mesh/` লিখো:
  - DNS 192.168.3.1 দেয়
  - uhttpd `/www/index.html` সার্ভ করে
  - JavaScript Host header চেক করে — `pigeon.mesh` হলে `:3607` এ redirect
  - pigeonmeshd PigeonMesh সার্ভ করে
- যখন `http://192.168.3.1/` লিখো:
  - uhttpd `/www/index.html` সার্ভ করে
  - JavaScript IP দেখে → `/cgi-bin/luci` তে redirect
  - LuCI চালু হয়

## 🚀 দ্রুত শুরু

### ১. ক্লাউড ওয়েবসাইট (Vercel)

```bash
cd cloud-bridge
npm install -g vercel
vercel login
vercel --prod
```

### ২. রাউটারে ইনস্টল

```bash
scp pigeonmesh-1.0.0-r1.apk root@192.168.1.1:/tmp/
ssh root@192.168.1.1 'apk add --allow-untrusted /tmp/pigeonmesh-1.0.0-r1.apk'

# (ঐচ্ছিক) ক্লাউড ব্রিজ URL সেট করো
scp install-on-router.sh root@192.168.1.1:/tmp/
ssh root@192.168.1.1 'sh /tmp/install-on-router.sh https://your-app.vercel.app'
```

### ৩. ফোনে APK

```bash
adb uninstall com.pigeonmesh.app  # পুরোনো থাকলে
adb install -r pigeonmesh-1.0.4-release.apk
```

## 📋 LuCI তে PigeonMesh

`http://192.168.1.1/` → login → **Services → PigeonMesh**:

| Page | কী |
|---|---|
| Status | লাইভ নোড ইনফো, peers, store |
| Live Mesh | পুরো PWA iframe এ |
| Cloud Dashboard | ক্লাউড ব্রিজ |
| Settings | পোর্ট, bridge URL চেঞ্জ |

## 🌐 পোর্ট লেআউট

| পোর্ট | কাজ |
|---|---|
| 80 | uhttpd (LuCI + redirect index) |
| 3607 | PigeonMesh PWA + API |
| 7100 | মেশ লিঙ্ক (TCP) |
| 7101 | ডিসকভারি (UDP) |

## 🎯 মেমোরিয়াল পোর্ট ৩৬০৭

**৩৬ শে জুলাই = ৫ আগস্ট** — ২০২৪ সালের গণঅভ্যুত্থানের দিন।

## 📄 লাইসেন্স

GPL-2.0-only। **Track A — Crisis Tech**।
