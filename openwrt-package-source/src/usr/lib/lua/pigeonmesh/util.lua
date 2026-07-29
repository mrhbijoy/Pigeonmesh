-- pigeonmesh/util.lua
-- Small helpers: time, ids, identity, file IO, UCI, base64, bit twiddling.
-- Lua 5.1 + nixio only. Must run on a 64 MB / 8 MB-flash router.

local M = {}
local nixio = require("nixio")
local bit = nixio.bit

-- ------------------------------------------------------------------
-- Time
--
-- A router that boots during a grid failure has no NTP and often no RTC,
-- so os.time() can be years off. Ordering messages by such a clock puts
-- new messages in 1970 and they sort below everything. PigeonMesh keeps a
-- logical clock: never emit a timestamp below the highest one we have
-- seen from the mesh. Nodes with a good clock pull everyone else forward.
-- ------------------------------------------------------------------

local logical_floor = 0

function M.wallclock()
    return os.time()
end

-- Feed an observed timestamp (from a peer or a stored record) into the clock.
function M.observe_ts(ts)
    if type(ts) == "number" and ts > logical_floor and ts < 4102444800 then
        logical_floor = ts
    end
end

-- Current time, guaranteed monotonic and never behind the mesh consensus.
function M.now()
    local t = os.time()
    if t < logical_floor then t = logical_floor end
    logical_floor = t
    return t
end

-- True when the local RTC looks unset (pre-2020) and we are relying on
-- timestamps learned from peers. Surfaced in the UI so users know why a
-- message may be dated oddly.
function M.clock_is_derived()
    return os.time() < 1577836800 and logical_floor > 0
end

function M.monotonic()
    -- Seconds since boot; immune to clock jumps. Used for timers only.
    local f = io.open("/proc/uptime", "r")
    if f then
        local l = f:read("*l")
        f:close()
        local v = l and l:match("^([%d.]+)")
        if v then return tonumber(v) end
    end
    return os.time()
end

-- ------------------------------------------------------------------
-- Randomness and identifiers
-- ------------------------------------------------------------------

local urandom = io.open("/dev/urandom", "rb")

function M.random_bytes(n)
    if urandom then
        local raw = urandom:read(n)
        if raw and #raw == n then return raw end
    end
    local out = {}
    for _ = 1, n do out[#out + 1] = string.char(math.random(0, 255)) end
    return table.concat(out)
end

function M.hex(s)
    return (s:gsub(".", function(c) return string.format("%02x", c:byte()) end))
end

-- 128-bit random id, hex encoded. Short enough to keep the store index
-- cheap, long enough that independent nodes never collide.
function M.newid()
    return M.hex(M.random_bytes(16))
end

-- ------------------------------------------------------------------
-- Base64 (used for keys and signatures on the wire)
-- ------------------------------------------------------------------

local B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

function M.b64encode(data)
    local out = {}
    for i = 1, #data, 3 do
        local a, b, c = data:byte(i, i + 2)
        local n = a * 65536 + (b or 0) * 256 + (c or 0)
        local c1 = math.floor(n / 262144) % 64
        local c2 = math.floor(n / 4096) % 64
        local c3 = math.floor(n / 64) % 64
        local c4 = n % 64
        out[#out + 1] = B64:sub(c1 + 1, c1 + 1) .. B64:sub(c2 + 1, c2 + 1)
            .. (b and B64:sub(c3 + 1, c3 + 1) or "=")
            .. (c and B64:sub(c4 + 1, c4 + 1) or "=")
    end
    return table.concat(out)
end

-- ------------------------------------------------------------------
-- FNV-1a: the hash behind the gossip Bloom filter.
--
-- This has to produce bit-identical output to the JavaScript implementation
-- in the PWA, because a phone acting as a data mule builds a filter that a
-- router then queries. Lua 5.1 has no integer type and no bitwise operators,
-- and nixio's bit library is only defined for values that already fit in 32
-- bits -- a 16777619x multiply overflows that immediately. So the multiply
-- is done in exact double arithmetic via a 16-bit split: every intermediate
-- below stays under 2^53 and is therefore exact.
-- ------------------------------------------------------------------

local TWO32 = 4294967296

local function mul32(a, b)
    local ah = math.floor(a / 65536)
    local al = a % 65536
    local bh = math.floor(b / 65536)
    local bl = b % 65536
    -- (ah*2^16 + al)(bh*2^16 + bl) mod 2^32; the ah*bh term is a multiple
    -- of 2^32 and drops out entirely.
    local lo = al * bl
    local mid = (al * bh + ah * bl) % 65536
    return (lo + mid * 65536) % TWO32
end

M.mul32 = mul32

function M.fnv1a(str, seed)
    local h = seed or 2166136261
    for i = 1, #str do
        h = bit.bxor(h, str:byte(i)) % TWO32
        h = mul32(h, 16777619)
    end
    return h
end

-- ------------------------------------------------------------------
-- Identity of this node
-- ------------------------------------------------------------------

function M.mac()
    local ifaces = { "br-lan", "eth0", "eth1", "lan1", "wlan0", "wlan1" }
    for _, iface in ipairs(ifaces) do
        local f = io.open("/sys/class/net/" .. iface .. "/address")
        if f then
            local mac = f:read("*l")
            f:close()
            if mac and #mac == 17 and mac ~= "00:00:00:00:00:00" then
                return mac
            end
        end
    end
    return "00:00:00:00:00:00"
end

-- Stable short node id derived from the MAC: "pm-a1b2c3".
function M.node_id()
    local mac = M.mac():gsub(":", ""):lower()
    return "pm-" .. mac:sub(-6)
end

function M.hostname()
    local f = io.popen("uci -q get system.@system[0].hostname 2>/dev/null")
    if f then
        local h = f:read("*l")
        f:close()
        if h and #h > 0 then return h end
    end
    local f2 = io.popen("hostname 2>/dev/null")
    if f2 then
        local h = f2:read("*l") or "OpenWrt"
        f2:close()
        return h
    end
    return "OpenWrt"
end

-- LAN address and broadcast addresses, for beacons and for telling the
-- client which URL to show on screen.
function M.interfaces()
    local out = {}
    local f = io.popen("ip -o -4 addr show 2>/dev/null")
    if not f then return out end
    for line in f:lines() do
        local dev = line:match("^%d+:%s+(%S+)")
        local addr = line:match("inet%s+([%d.]+)")
        local bcast = line:match("brd%s+([%d.]+)")
        if dev and addr and dev ~= "lo" then
            out[#out + 1] = { dev = dev, addr = addr, bcast = bcast }
        end
    end
    f:close()
    return out
end

function M.lan_address()
    for _, i in ipairs(M.interfaces()) do
        if i.dev:match("^br%-lan") then return i.addr end
    end
    for _, i in ipairs(M.interfaces()) do
        if not i.dev:match("^tailscale") and not i.dev:match("^pppoe") then
            return i.addr
        end
    end
    return "127.0.0.1"
end

-- ------------------------------------------------------------------
-- Power / health, so the mesh can route around a node that is about to die
-- ------------------------------------------------------------------

function M.uptime()
    return math.floor(M.monotonic())
end

function M.loadavg()
    local f = io.open("/proc/loadavg", "r")
    if not f then return 0 end
    local l = f:read("*l") or ""
    f:close()
    return tonumber(l:match("^([%d.]+)")) or 0
end

function M.mem_free_kb()
    local f = io.open("/proc/meminfo", "r")
    if not f then return 0 end
    local free, avail = 0, nil
    for line in f:lines() do
        local v = line:match("^MemAvailable:%s+(%d+)")
        if v then avail = tonumber(v) end
        local v2 = line:match("^MemFree:%s+(%d+)")
        if v2 then free = tonumber(v2) end
    end
    f:close()
    return avail or free
end

-- Battery percentage if the node runs on a UPS/solar pack that exposes a
-- standard power_supply node. Returns nil on mains-powered routers.
function M.battery_pct()
    local base = "/sys/class/power_supply"
    local f = io.popen("ls " .. base .. " 2>/dev/null")
    if not f then return nil end
    for name in f:lines() do
        local cf = io.open(base .. "/" .. name .. "/capacity", "r")
        if cf then
            local v = tonumber(cf:read("*l") or "")
            cf:close()
            if v then f:close() return v end
        end
    end
    f:close()
    return nil
end

-- ------------------------------------------------------------------
-- File IO
-- ------------------------------------------------------------------

function M.read_file(path)
    local f = io.open(path, "r")
    if not f then return nil end
    local s = f:read("*a")
    f:close()
    return s
end

function M.write_file(path, content)
    local dir = path:match("^(.*)/[^/]+$")
    if dir and dir ~= "" then os.execute("mkdir -p '" .. dir .. "' 2>/dev/null") end
    local tmp = path .. ".tmp"
    local f = io.open(tmp, "w")
    if not f then return false end
    f:write(content)
    f:close()
    return os.rename(tmp, path) ~= nil
end

function M.append_line(path, line)
    local f = io.open(path, "a")
    if not f then
        local dir = path:match("^(.*)/[^/]+$")
        if dir and dir ~= "" then os.execute("mkdir -p '" .. dir .. "' 2>/dev/null") end
        f = io.open(path, "a")
        if not f then return false end
    end
    f:write(line, "\n")
    f:close()
    return true
end

function M.file_size(path)
    local f = io.open(path, "r")
    if not f then return 0 end
    local sz = f:seek("end") or 0
    f:close()
    return sz
end

function M.mkdir_p(path)
    os.execute("mkdir -p '" .. path .. "' 2>/dev/null")
end

-- ------------------------------------------------------------------
-- UCI
-- ------------------------------------------------------------------

function M.uci_load(config, section)
    local out = {}
    local f = io.popen("uci -q show " .. config .. "." .. section .. " 2>/dev/null")
    if not f then return out end
    for line in f:lines() do
        local key, rest = line:match("^%S+%.%S+%.(.-)=(.*)$")
        if key and rest then
            local vals = {}
            for v in rest:gmatch("'([^']*)'") do vals[#vals + 1] = v end
            if #vals == 0 then vals[1] = rest:match("^([^%s].-)%s*$") end
            if #vals == 1 then out[key] = vals[1]
            elseif #vals > 1 then out[key] = vals end
        end
    end
    f:close()
    return out
end

-- ------------------------------------------------------------------
-- Misc
-- ------------------------------------------------------------------

function M.clamp(v, lo, hi)
    if v < lo then return lo end
    if v > hi then return hi end
    return v
end

-- Strip control characters and cap length. Every string that arrives from
-- the network passes through this before it is stored or logged.
function M.sanitise(s, maxlen)
    if type(s) ~= "string" then return nil end
    s = s:gsub("[%z\1-\8\11\12\14-\31\127]", "")
    if maxlen and #s > maxlen then s = s:sub(1, maxlen) end
    return s
end

function M.shuffle(t)
    for i = #t, 2, -1 do
        local j = math.random(i)
        t[i], t[j] = t[j], t[i]
    end
    return t
end

return M
