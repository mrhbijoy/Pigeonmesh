-- pigeonmesh/store.lua
-- The record store: one append-only log of signed records, plus the indexes
-- the rest of the daemon needs (by id, by local sequence, Bloom digest).
--
-- Design constraints that shaped this file:
--
--   * The secondary lab router has 6.6 MB of free flash and 116 MB of RAM.
--     Everything here is budgeted in bytes, not "number of messages".
--   * /var on OpenWrt is tmpfs, so the hot log lives in RAM and disappears
--     on reboot. Power cuts are the normal case in the scenario we are
--     building for, so the store checkpoints to flash on a timer and on
--     shutdown -- rarely enough not to wear the flash out.
--   * When the store is full, a "where is my daughter" record must outlive
--     a "hello" record. Eviction is priority-aware, not purely FIFO.

local util = require("pigeonmesh.util")
local json = require("pigeonmesh.json")

local M = {}

-- Lower number = evicted last. Chosen so that life-safety traffic survives
-- a store that is thrashing.
M.PRIORITY = {
    sos      = 0,
    checkin  = 1,
    missing  = 1,
    bulletin = 1,
    pin      = 2,
    dm       = 2,
    chat     = 3,
    profile  = 3,
    presence = 4,
}

-- Default lifetime per kind, in seconds. A chat message is noise after a
-- day; a missing-person report is not.
M.TTL = {
    sos      = 24 * 3600,
    checkin  = 7 * 24 * 3600,
    missing  = 30 * 24 * 3600,
    bulletin = 7 * 24 * 3600,
    pin      = 30 * 24 * 3600,
    dm       = 7 * 24 * 3600,
    chat     = 3 * 24 * 3600,
    profile  = 30 * 24 * 3600,
    presence = 300,
}

local Store = {}
Store.__index = Store

function M.new(cfg)
    local self = setmetatable({}, Store)
    self.cfg = cfg
    self.records = {}        -- local sequence -> record
    self.by_id = {}          -- id -> record
    self.seq = 0             -- monotonic local sequence, drives /api/records?since
    self.bytes = 0           -- approximate stored size
    self.max_bytes = cfg.max_bytes or (2 * 1024 * 1024)
    self.max_records = cfg.max_records or 4000
    self.hot_path = cfg.hot_path or "/var/lib/pigeonmesh/records.jsonl"
    self.checkpoint_path = cfg.checkpoint_path or "/etc/pigeonmesh/store/records.jsonl"
    self.dirty = 0           -- records added since the last checkpoint
    self.evicted = 0
    self.bloom_cache = nil
    self.bloom_dirty = true
    return self
end

-- ------------------------------------------------------------------
-- Validation
--
-- Everything below the transport is untrusted: it arrives from a peer
-- router, a browser on the LAN, or a phone acting as a data mule. Records
-- are normalised into a known shape here and nowhere else.
-- ------------------------------------------------------------------

local VALID_KIND = {}
for k in pairs(M.PRIORITY) do VALID_KIND[k] = true end

function M.validate(rec, max_body)
    if type(rec) ~= "table" then return nil, "not an object" end
    local id = rec.id
    if type(id) ~= "string" or not id:match("^%x+$") or #id < 16 or #id > 64 then
        return nil, "bad id"
    end
    local kind = rec.kind
    if type(kind) ~= "string" or not VALID_KIND[kind] then return nil, "bad kind" end
    -- Bound the timestamp to a plausible range (2020 .. 2100). Beyond
    -- rejecting nonsense, this stops a record with a huge ts from poisoning
    -- the logical clock and dating every later message decades into the
    -- future, which would sort real messages below it forever.
    if type(rec.ts) ~= "number" or rec.ts ~= rec.ts then return nil, "bad ts" end
    if rec.ts < 1577836800 or rec.ts > 4102444800 then return nil, "ts out of range" end

    local out = {
        id     = id,
        kind   = kind,
        ts     = math.floor(rec.ts),
        chan   = util.sanitise(rec.chan, 32) or "public",
        nick   = util.sanitise(rec.nick, 32) or "anon",
        author = util.sanitise(rec.author, 64) or "",
        pk     = util.sanitise(rec.pk, 128),
        sig    = util.sanitise(rec.sig, 128),
        prio   = M.PRIORITY[kind],
        hops   = math.floor(tonumber(rec.hops) or 0),
        origin = util.sanitise(rec.origin, 32) or "",
    }

    -- Expiry is capped by the per-kind default so a hostile client cannot
    -- pin a record in a small router's flash forever.
    local ttl = M.TTL[kind] or 86400
    local exp = tonumber(rec.exp)
    if not exp or exp > out.ts + ttl then exp = out.ts + ttl end
    out.exp = math.floor(exp)

    -- The body is opaque to the router. For end-to-end encrypted kinds it is
    -- ciphertext the router cannot read even in principle; for the rest it is
    -- structured JSON the PWA understands. Either way the router only checks
    -- that it is well-formed and within budget.
    local body = rec.body
    if body ~= nil and type(body) ~= "table" then return nil, "bad body" end
    out.body = body or {}
    local encoded = json.encode(out.body)
    if #encoded > (max_body or 16384) then return nil, "body too large" end
    out._size = #encoded + 220  -- envelope overhead, measured

    return out
end

-- ------------------------------------------------------------------
-- Insertion
-- ------------------------------------------------------------------

function Store:has(id)
    return self.by_id[id] ~= nil
end

function Store:count()
    local n = 0
    for _ in pairs(self.by_id) do n = n + 1 end
    return n
end

-- Returns record, "new" | nil, "duplicate"/"expired"/reason
function Store:put(rec, opts)
    opts = opts or {}
    if self.by_id[rec.id] then return nil, "duplicate" end

    local now = util.now()
    if rec.exp <= now and not opts.allow_expired then return nil, "expired" end

    util.observe_ts(rec.ts)

    self.seq = self.seq + 1
    rec._seq = self.seq
    self.records[self.seq] = rec
    self.by_id[rec.id] = rec
    self.bytes = self.bytes + rec._size
    self.bloom_dirty = true

    if not opts.no_persist then
        util.append_line(self.hot_path, json.encode(self:externalise(rec)))
        self.dirty = self.dirty + 1
    end

    self:enforce_budget()
    return rec, "new"
end

-- Strip internal bookkeeping fields before the record leaves the process.
function Store:externalise(rec)
    return {
        id = rec.id, kind = rec.kind, ts = rec.ts, exp = rec.exp,
        chan = rec.chan, nick = rec.nick, author = rec.author,
        pk = rec.pk, sig = rec.sig, origin = rec.origin,
        hops = rec.hops, body = rec.body,
    }
end

-- ------------------------------------------------------------------
-- Eviction
--
-- Two passes. First drop anything past its expiry -- that is free. If the
-- store is still over budget, drop the least important records, oldest
-- first, and never touch priority 0 (SOS) unless nothing else is left.
-- ------------------------------------------------------------------

function Store:enforce_budget()
    local now = util.now()
    local n = self:count()
    if self.bytes <= self.max_bytes and n <= self.max_records then
        -- Cheap opportunistic expiry sweep even when under budget.
        if (self.seq % 64) ~= 0 then return end
    end

    local victims = {}
    for id, rec in pairs(self.by_id) do
        if rec.exp <= now then victims[#victims + 1] = rec end
    end
    for _, rec in ipairs(victims) do self:drop(rec) end

    if self.bytes <= self.max_bytes and self:count() <= self.max_records then
        return
    end

    -- Still over. Sort what is left by (priority desc, age asc) and shed.
    local all = {}
    for _, rec in pairs(self.by_id) do all[#all + 1] = rec end
    table.sort(all, function(a, b)
        if a.prio ~= b.prio then return a.prio > b.prio end
        return a.ts < b.ts
    end)

    local i = 1
    while (self.bytes > self.max_bytes * 0.9 or self:count() > self.max_records * 0.9)
        and i <= #all do
        local rec = all[i]
        i = i + 1
        if rec.prio == 0 and i < #all then
            -- Skip SOS while anything else remains to shed.
        else
            self:drop(rec)
        end
    end
end

function Store:drop(rec)
    if not self.by_id[rec.id] then return end
    self.by_id[rec.id] = nil
    self.records[rec._seq] = nil
    self.bytes = self.bytes - (rec._size or 0)
    if self.bytes < 0 then self.bytes = 0 end
    self.evicted = self.evicted + 1
    self.bloom_dirty = true
end

-- ------------------------------------------------------------------
-- Queries
-- ------------------------------------------------------------------

-- Records with local sequence greater than `since`, newest last.
-- `since` is per-node and meaningless to other nodes; it exists so a browser
-- can long-poll cheaply.
function Store:since(since, limit, filter)
    local out = {}
    limit = limit or 500
    for s = (since or 0) + 1, self.seq do
        local rec = self.records[s]
        if rec and (not filter or filter(rec)) then
            out[#out + 1] = self:externalise(rec)
            if #out >= limit then break end
        end
    end
    return out
end

-- The most recent `n` records, oldest first. Used to prime a fresh client.
function Store:recent(n, filter)
    local out = {}
    for s = self.seq, 1, -1 do
        local rec = self.records[s]
        if rec and (not filter or filter(rec)) then
            table.insert(out, 1, self:externalise(rec))
            if #out >= n then break end
        end
    end
    return out
end

function Store:get(id)
    local rec = self.by_id[id]
    return rec and self:externalise(rec) or nil
end

-- ------------------------------------------------------------------
-- Bloom digest
--
-- The gossip layer needs to tell a peer "here is roughly what I hold" in a
-- packet small enough to send every few seconds over a weak link. The filter
-- is sized from the current record count so a node holding 40 records sends
-- 128 bytes, not 1 KB. The same construction is implemented in the PWA so a
-- phone acting as a data mule can take part in the same exchange.
-- ------------------------------------------------------------------

-- The filter is a byte array serialised as hex, not a word array. Bytes keep
-- every value under 256, which sidesteps both Lua 5.1's lack of unsigned
-- 32-bit integers (bit 31 would come back negative and break string.format)
-- and any endianness disagreement with the JavaScript side.
local function bloom_params(n)
    -- Target ~2% false positives: about 10 bits per element with k = 6.
    local bits = 1024
    while bits < n * 10 and bits < 65536 do bits = bits * 2 end
    return bits, 6
end

-- Two hashes generate k positions (Kirsch-Mitzenmacher), which costs two
-- passes over the id instead of six.
local function positions(id, bits, k, out)
    local h1 = util.fnv1a(id, 2166136261)
    local h2 = util.fnv1a(id, 40389)
    -- h2 must be odd and non-zero, or all k probes collapse onto one bit.
    if h2 % 2 == 0 then h2 = h2 + 1 end
    for i = 0, k - 1 do
        out[i + 1] = (h1 + i * h2) % bits
    end
    return out
end

function M.bloom_build(ids)
    local bits, k = bloom_params(#ids)
    local nbytes = bits / 8
    local filter = {}
    for i = 1, nbytes do filter[i] = 0 end

    local pos = {}
    for _, id in ipairs(ids) do
        positions(id, bits, k, pos)
        for i = 1, k do
            local byte_i = math.floor(pos[i] / 8) + 1
            local mask = 2 ^ (pos[i] % 8)
            local v = filter[byte_i]
            if math.floor(v / mask) % 2 == 0 then filter[byte_i] = v + mask end
        end
    end

    local parts = {}
    for i = 1, nbytes do parts[i] = string.format("%02x", filter[i]) end
    return { bits = bits, k = k, data = table.concat(parts) }
end

function M.bloom_contains(bloom, id)
    if not bloom or type(bloom.data) ~= "string" then return false end
    local bits = tonumber(bloom.bits) or 1024
    local k = tonumber(bloom.k) or 6
    -- A malformed or truncated filter from a peer must fail closed: treating
    -- it as "contains everything" would silently stop replication.
    if #bloom.data ~= bits / 4 then return false end
    if k < 1 or k > 16 then return false end

    local pos = positions(id, bits, k, {})
    for i = 1, k do
        local byte_i = math.floor(pos[i] / 8)
        local hexoff = byte_i * 2 + 1
        local v = tonumber(bloom.data:sub(hexoff, hexoff + 1), 16)
        if not v then return false end
        local mask = 2 ^ (pos[i] % 8)
        if math.floor(v / mask) % 2 == 0 then return false end
    end
    return true
end

function Store:digest()
    if self.bloom_cache and not self.bloom_dirty then return self.bloom_cache end
    local ids = {}
    for id in pairs(self.by_id) do ids[#ids + 1] = id end
    local b = M.bloom_build(ids)
    b.count = #ids
    self.bloom_cache = b
    self.bloom_dirty = false
    return b
end

-- Records this node holds that the peer's digest says it is missing.
-- Priority order, so an SOS crosses the mesh before a chat backlog does.
function Store:missing_from(bloom, max_count, max_bytes)
    local cand = {}
    for _, rec in pairs(self.by_id) do
        if not M.bloom_contains(bloom, rec.id) then cand[#cand + 1] = rec end
    end
    table.sort(cand, function(a, b)
        if a.prio ~= b.prio then return a.prio < b.prio end
        return a.ts > b.ts
    end)
    local out, bytes = {}, 0
    for _, rec in ipairs(cand) do
        if #out >= (max_count or 32) then break end
        if bytes + rec._size > (max_bytes or 32768) then break end
        out[#out + 1] = self:externalise(rec)
        bytes = bytes + rec._size
    end
    return out
end

-- ------------------------------------------------------------------
-- Persistence
--
-- The hot log is append-only in tmpfs. Checkpointing rewrites a compacted
-- copy onto flash, dropping expired records on the way. Both are plain
-- JSONL so an operator with nothing but `cat` can read the mesh state.
-- ------------------------------------------------------------------

function Store:load()
    local loaded = 0
    for _, path in ipairs({ self.checkpoint_path, self.hot_path }) do
        local data = util.read_file(path)
        if data then
            for line in data:gmatch("[^\n]+") do
                local obj = json.decode(line)
                if obj then
                    local rec = M.validate(obj)
                    if rec and not self.by_id[rec.id] then
                        -- allow_expired keeps the sweep in one place; the
                        -- budget pass below drops anything stale.
                        if self:put(rec, { no_persist = true, allow_expired = true }) then
                            loaded = loaded + 1
                        end
                    end
                end
            end
        end
    end
    -- Now that the logical clock has seen every stored timestamp, expire.
    local now = util.now()
    for _, rec in pairs(self.by_id) do
        if rec.exp <= now then self:drop(rec) end
    end
    return loaded
end

function Store:checkpoint()
    if self.dirty == 0 then return false end
    local parts = {}
    for s = 1, self.seq do
        local rec = self.records[s]
        if rec then parts[#parts + 1] = json.encode(self:externalise(rec)) end
    end
    local blob = table.concat(parts, "\n")
    if #blob > 0 then blob = blob .. "\n" end
    local ok = util.write_file(self.checkpoint_path, blob)
    if ok then
        -- The hot log is now redundant; truncating it keeps tmpfs small.
        util.write_file(self.hot_path, "")
        self.dirty = 0
    end
    return ok
end

function Store:stats()
    return {
        records = self:count(),
        bytes = self.bytes,
        max_bytes = self.max_bytes,
        seq = self.seq,
        evicted = self.evicted,
        dirty = self.dirty,
    }
end

return M
