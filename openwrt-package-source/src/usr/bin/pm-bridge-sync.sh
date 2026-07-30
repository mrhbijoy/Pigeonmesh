#!/bin/sh
# Background daemon that syncs records between this router and the Cloud Bridge.

BRIDGE_URL=$(uci -q get pigeonmesh.bridge.url | sed 's|/api/pigeonmesh.*||; s|/*$||')
INTERVAL=$(uci -q get pigeonmesh.bridge.interval || echo '30')
[ -z "$BRIDGE_URL" ] && exit 0

while true; do
    BRIDGE_URL=$(uci -q get pigeonmesh.bridge.url | sed 's|/api/pigeonmesh.*||; s|/*$||')
    INTERVAL=$(uci -q get pigeonmesh.bridge.interval || echo '30')
    HTTP_PORT=$(uci -q get pigeonmesh.main.http_port || echo '3607')
    LOCAL="http://127.0.0.1:${HTTP_PORT}"
    
    if [ -n "$BRIDGE_URL" ]; then
        LOCAL_DATA=$(uclient-fetch -q -O - $LOCAL/api/digest 2>/dev/null || curl -s -m 5 $LOCAL/api/digest 2>/dev/null)
        if [ -z "$LOCAL_DATA" ]; then
            LOCAL="http://127.0.0.1:3607"
            LOCAL_DATA=$(uclient-fetch -q -O - $LOCAL/api/digest 2>/dev/null || curl -s -m 5 $LOCAL/api/digest 2>/dev/null)
        fi
        if [ -z "$LOCAL_DATA" ]; then
            LOCAL="http://127.0.0.1:8080"
            LOCAL_DATA=$(uclient-fetch -q -O - $LOCAL/api/digest 2>/dev/null || curl -s -m 5 $LOCAL/api/digest 2>/dev/null)
        fi
        
        NODE_ID=$(echo "$LOCAL_DATA" | jsonfilter -e '@.node' 2>/dev/null)
        DIGEST=$(echo "$LOCAL_DATA" | jsonfilter -e '@.digest' 2>/dev/null)
        
        if [ -n "$NODE_ID" ] && [ -n "$DIGEST" ]; then
            LOCAL_RECORDS=$(uclient-fetch -q -O - "$LOCAL/api/records?limit=200" 2>/dev/null || curl -s -m 10 "$LOCAL/api/records?limit=200" 2>/dev/null)
            REC_ARRAY=$(echo "$LOCAL_RECORDS" | jsonfilter -e '@.records' 2>/dev/null)
            [ -z "$REC_ARRAY" ] && REC_ARRAY="[]"
            SYNC_BODY="{\"node\":\"$NODE_ID\",\"name\":\"OpenWrt\",\"kind\":\"router\",\"addr\":\"$(uci -q get network.lan.ipaddr)\",\"digest\":$DIGEST,\"records\":$REC_ARRAY}"
            RESP=$(curl -s -m 15 -X POST -H "Content-Type: application/json" -d "$SYNC_BODY" "$BRIDGE_URL/api/pigeonmesh/sync" 2>/dev/null)
            if [ -n "$RESP" ]; then
                REC_RESP=$(echo "$RESP" | jsonfilter -e '@.records' 2>/dev/null)
                if [ -n "$REC_RESP" ] && [ "$REC_RESP" != "[]" ]; then
                    echo "$RESP" | curl -s -m 10 -X POST -H "Content-Type: application/json" -d @- $LOCAL/api/records >/dev/null 2>&1
                fi
            fi
        fi
    fi
    sleep ${INTERVAL:-30}
done
