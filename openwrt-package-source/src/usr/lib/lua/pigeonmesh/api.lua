-- pigeonmesh/api.lua
-- HTTP API handlers. The PWA and the CLI both speak only this.
--
-- The router is deliberately dumb. It does not verify signatures, cannot read
-- encrypted bodies, and has no notion of accounts. Trust lives entirely at the
-- endpoints: the PWA signs with a key that never leaves the device and
-- verifies every record it displays. Seizing a router therefore yields the
-- public bulletin board and nothing else -- no identities to forge, no private
-- messages to read.

local json = require("pigeonmesh.json")
local store = require("pigeonmesh.store")
local util = require("pigeonmesh.util")

local M = {}

local function ok(tbl)
    return { status = 200, body = json.encode(tbl) }
end

local function err(status, msg)
    return { status = status, body = json.encode({ error = msg }) }
end

-- ------------------------------------------------------------------
-- Rate limiting
--
-- Anyone on the Wi-Fi can POST. A token bucket per source address keeps one
-- misbehaving or malfunctioning client from filling a 6 MB flash chip, while
-- leaving a whole classroom of legitimate users comfortably under the limit.
-- ------------------------------------------------------------------

local buckets = {}

local function take_token(peer, cost, cfg)
    local now = util.monotonic()
    local b = buckets[peer]
    if not b then
        b = { tokens = cfg.burst, last = now }
        buckets[peer] = b
    end
    b.tokens = math.min(cfg.burst, b.tokens + (now - b.last) * cfg.rate)
    b.last = now
    if b.tokens < cost then return false end
    b.tokens = b.tokens - cost
    return true
end

function M.gc_buckets()
    local now = util.monotonic()
    for k, b in pairs(buckets) do
        if now - b.last > 300 then buckets[k] = nil end
    end
end

-- ------------------------------------------------------------------

-- ctx is supplied by the daemon and gives the handlers access to shared state
-- without a pile of globals.
function M.make_handler(ctx)
    local cfg = ctx.cfg

    local ratecfg = { rate = cfg.post_rate or 3, burst = cfg.post_burst or 30 }

    local function node_info()
        return {
            node    = ctx.node_id,
            name    = ctx.node_name,
            version = ctx.version,
            lan     = util.lan_address(),
            http_port = cfg.http_port,
            uptime  = util.uptime(),
            load    = util.loadavg(),
            mem_free_kb = util.mem_free_kb(),
            battery = util.battery_pct(),
            time    = util.now(),
            -- Tell the client whether to trust our clock. Without this a
            -- phone with a good clock cannot tell a genuinely old message
            -- from one stamped by a router whose RTC never got set.
            clock_derived = util.clock_is_derived(),
        }
    end

    local function peer_list()
        local out = json.arr({})
        for id, p in pairs(ctx.peers) do
            out[#out + 1] = {
                node = id, name = p.name, addr = p.addr,
                last_seen = p.last_seen, rtt_ms = p.rtt_ms,
                direct = true,
            }
        end
        -- Nodes we know about only through gossip: still worth showing, since
        -- "the shelter node is alive but two hops away" is useful information.
        for id, s in pairs(ctx.remote_nodes) do
            if not ctx.peers[id] and id ~= ctx.node_id then
                out[#out + 1] = {
                    node = id, name = s.name, hops = s.hops,
                    last_seen = s.last_seen, battery = s.battery,
                    direct = false,
                }
            end
        end
        return out
    end

    M.peer_list = peer_list
    M.node_info = node_info

    -- --------------------------------------------------------------
    return function(req)
        local path = req.path

        if path == "/api/state" then
            return ok({
                node = node_info(),
                peers = peer_list(),
                store = ctx.store:stats(),
                http = ctx.server and ctx.server:stats() or {},
                mesh = {
                    flooded = ctx.stat_flooded,
                    gossip_rounds = ctx.stat_gossip,
                    carried_in = ctx.stat_carried_in,
                    carried_out = ctx.stat_carried_out,
                },
            })
        end

        if path == "/api/health" then
            return ok({ ok = true, node = ctx.node_id, time = util.now() })
        end

        if path == "/api/records" and req.method == "GET" then
            local since = tonumber(req.query.since) or 0
            local limit = util.clamp(tonumber(req.query.limit) or 300, 1, 1000)
            local kind = req.query.kind
            local chan = req.query.chan
            local filter
            if kind or chan then
                filter = function(r)
                    if kind and r.kind ~= kind then return false end
                    if chan and r.chan ~= chan then return false end
                    return true
                end
            end
            local recs = ctx.store:since(since, limit, filter)
            return ok({
                records = json.arr(recs),
                seq = ctx.store.seq,
                node = ctx.node_id,
                time = util.now(),
            })
        end

        if path == "/api/records" and req.method == "POST" then
            local payload = json.decode(req.body or "")
            if not payload then return err(400, "bad json") end
            local list = payload.records or (payload.id and { payload }) or nil
            if type(list) ~= "table" then return err(400, "no records") end
            if #list > 64 then return err(413, "too many records") end
            if not take_token(req.peer, #list, ratecfg) then
                return err(429, "slow down")
            end

            local accepted, rejected = json.arr({}), json.arr({})
            for _, raw in ipairs(list) do
                local rec, why = store.validate(raw, cfg.max_body)
                if not rec then
                    rejected[#rejected + 1] = { id = raw and raw.id, why = why }
                else
                    rec.origin = rec.origin ~= "" and rec.origin or ctx.node_id
                    local put, status = ctx.store:put(rec)
                    if put then
                        accepted[#accepted + 1] = rec.id
                        ctx.on_new_record(put, nil)
                    else
                        rejected[#rejected + 1] = { id = rec.id, why = status }
                    end
                end
            end
            return ok({ accepted = accepted, rejected = rejected, seq = ctx.store.seq })
        end

        -- The data-mule endpoint. One round trip reconciles a carrier with
        -- this node in both directions: the caller sends a Bloom summary of
        -- what it already holds plus anything it thinks we might lack, and we
        -- reply with everything it is missing. A phone that walks from a
        -- flooded village to a shelter runs this at each end and the two
        -- disconnected halves of the mesh converge through it.
        if path == "/api/sync" and req.method == "POST" then
            local payload = json.decode(req.body or "")
            if not payload then return err(400, "bad json") end
            if not take_token(req.peer, 4, ratecfg) then return err(429, "slow down") end

            local taken = 0
            for _, raw in ipairs(payload.records or {}) do
                local rec = store.validate(raw, cfg.max_body)
                if rec then
                    local put = ctx.store:put(rec)
                    if put then
                        taken = taken + 1
                        ctx.on_new_record(put, nil)
                    end
                end
            end
            if taken > 0 then ctx.stat_carried_in = ctx.stat_carried_in + taken end

            local give = json.arr({})
            if payload.digest then
                give = json.arr(ctx.store:missing_from(payload.digest,
                    tonumber(payload.max_count) or 128,
                    tonumber(payload.max_bytes) or 131072))
            end
            ctx.stat_carried_out = ctx.stat_carried_out + #give

            return ok({
                records = give,
                took = taken,
                digest = ctx.store:digest(),
                node = ctx.node_id,
                time = util.now(),
            })
        end

        if path == "/api/digest" then
            return ok({ digest = ctx.store:digest(), node = ctx.node_id })
        end

        -- Everything the mesh knows about every node, for the map/topology
        -- view. Cheap enough to poll, but the SSE stream pushes it anyway.
        if path == "/api/topology" then
            local nodes = json.arr({})
            nodes[#nodes + 1] = {
                node = ctx.node_id, name = ctx.node_name, self = true,
                battery = util.battery_pct(), records = ctx.store:count(),
                uptime = util.uptime(), links = json.arr((function()
                    local l = {}
                    for id in pairs(ctx.peers) do l[#l + 1] = id end
                    return l
                end)()),
            }
            for id, s in pairs(ctx.remote_nodes) do
                if id ~= ctx.node_id then
                    nodes[#nodes + 1] = {
                        node = id, name = s.name, hops = s.hops,
                        battery = s.battery, records = s.records,
                        uptime = s.uptime, last_seen = s.last_seen,
                        links = json.arr(s.links or {}),
                    }
                end
            end
            return ok({ nodes = nodes, time = util.now() })
        end

        if path == "/api/config" and req.method == "GET" then
            -- Non-secret operational settings the PWA needs to behave well
            -- on this particular node.
            return ok({
                node = ctx.node_id,
                name = ctx.node_name,
                max_body = cfg.max_body,
                lan = util.lan_address(),
                domain = cfg.domain,
                channels = json.arr(ctx.channels),
            })
        end

        return err(404, "no such endpoint")
    end
end

return M
