#!/bin/sh
# PigeonMesh post-install setup (optional — for cloud bridge URL only).
#
# The .ipk/.apk package's postinst already does everything:
#   - pigeonmeshd on port 3607
#   - uhttpd on port 80 (LuCI)
#   - DNS: pigeon.mesh → router IP
#   - /www/index.html: Host-based redirect (pigeon.mesh → :3607, IP → LuCI)
#   - LuCI integration (Status, Live, Cloud, Settings)
#
# This script just sets the cloud bridge URL (if provided).
#
# Usage:
#   sh install-on-router.sh [BRIDGE_URL]
#
# Example:
#   sh install-on-router.sh https://your-app.vercel.app

BRIDGE_URL="${1:-}"

echo "=============================================="
echo " PigeonMesh post-install setup"
echo "=============================================="

if [ -n "$BRIDGE_URL" ]; then
    echo "[1] Setting cloud bridge: $BRIDGE_URL"
    uci set pigeonmesh.bridge=section
    uci set pigeonmesh.bridge.url="$BRIDGE_URL"
    uci set pigeonmesh.bridge.interval='30'
    uci commit pigeonmesh

    cat > /usr/bin/pm-bridge-sync.sh <<'BRIDGESCRIPT'
#!/bin/sh
BRIDGE_URL=$(uci -q get pigeonmesh.bridge.url | sed 's|/api/pigeonmesh.*||; s|/*$||')
INTERVAL=$(uci -q get pigeonmesh.bridge.interval || echo '30')
LOCAL="http://127.0.0.1:3607"
[ -z "$BRIDGE_URL" ] && exit 0
while true; do
    LOCAL_DATA=$(curl -s -m 5 $LOCAL/api/digest 2>/dev/null)
    NODE_ID=$(echo "$LOCAL_DATA" | jsonfilter -e '@.node' 2>/dev/null)
    DIGEST=$(echo "$LOCAL_DATA" | jsonfilter -e '@.digest' 2>/dev/null)
    if [ -n "$NODE_ID" ]; then
        LOCAL_RECORDS=$(curl -s -m 10 "$LOCAL/api/records?limit=200" 2>/dev/null)
        REC_ARRAY=$(echo "$LOCAL_RECORDS" | jsonfilter -e '@.records' 2>/dev/null)
        [ -z "$REC_ARRAY" ] && REC_ARRAY="[]"
        SYNC_BODY="{\"node\":\"$NODE_ID\",\"name\":\"OpenWrt\",\"kind\":\"router\",\"addr\":\"$(uci -q get network.lan.ipaddr)\",\"digest\":$DIGEST,\"records\":$REC_ARRAY}"
        RESP=$(curl -s -m 15 -X POST -H "Content-Type: application/json" -d "$SYNC_BODY" "$BRIDGE_URL/api/pigeonmesh/sync" 2>/dev/null)
        if [ -n "$RESP" ]; then
            echo "$RESP" | curl -s -m 10 -X POST -H "Content-Type: application/json" -d @- $LOCAL/api/records >/dev/null 2>&1
        fi
    fi
    sleep $INTERVAL
done
BRIDGESCRIPT
    chmod +x /usr/bin/pm-bridge-sync.sh

    cat > /etc/init.d/pm-bridge-sync <<'INITEOF'
#!/bin/sh /etc/rc.common
START=99
USE_PROCD=1
start_service() {
    procd_open_instance
    procd_set_param command /bin/sh /usr/bin/pm-bridge-sync.sh
    procd_set_param stdout 1
    procd_set_param stderr 1
    procd_set_param respawn
    procd_close_instance
}
INITEOF
    chmod +x /etc/init.d/pm-bridge-sync
    /etc/init.d/pm-bridge-sync enable
    /etc/init.d/pm-bridge-sync start
    echo "  ✓ Cloud bridge sync enabled"
else
    echo "[1] No bridge URL — skipping cloud sync"
fi

echo ""
echo "=============================================="
echo " ✅ SETUP COMPLETE"
echo "=============================================="
LAN_IP=$(uci -q get network.lan.ipaddr || echo "192.168.1.1")
echo ""
echo "  http://pigeon.mesh/      → PigeonMesh"
echo "  http://$LAN_IP/      → LuCI (admin)"
echo "  http://$LAN_IP:3607/ → PigeonMesh (direct)"
echo ""
echo "  LuCI → Services → PigeonMesh"
echo ""
pigeonmesh status 2>/dev/null || true
