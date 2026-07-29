-- pigeonmesh/httpd.lua
-- A small non-blocking HTTP/1.1 server with Server-Sent Events, built on
-- nixio and driven by the daemon's single poll loop.
--
-- Why not just use uhttpd + CGI, the way mesh-chat did? Because CGI forks a
-- Lua interpreter per request. On the mipsel router that is ~90 ms and about
-- 3 MB of RAM per poll, so the old UI could not refresh faster than once a
-- second without the router falling over. Serving from inside the daemon
-- means an SOS reaches every open browser in one push, with no polling at
-- all, and costs one socket.
--
-- uhttpd keeps running on port 80 and is untouched: LuCI still works.

local nixio = require("nixio")
local util = require("pigeonmesh.util")

local bit = nixio.bit
local CS = nixio.const_sock
local EAGAIN = CS.EAGAIN or 11
local EWOULDBLOCK = CS.EWOULDBLOCK or 11

local M = {}

local MIME = {
    html = "text/html; charset=utf-8",
    js   = "application/javascript; charset=utf-8",
    css  = "text/css; charset=utf-8",
    json = "application/json; charset=utf-8",
    webmanifest = "application/manifest+json; charset=utf-8",
    svg  = "image/svg+xml",
    png  = "image/png",
    ico  = "image/x-icon",
    txt  = "text/plain; charset=utf-8",
    woff2 = "font/woff2",
}

local STATUS = {
    [200] = "OK", [204] = "No Content", [206] = "Partial Content",
    [301] = "Moved Permanently", [302] = "Found", [304] = "Not Modified",
    [400] = "Bad Request", [403] = "Forbidden", [404] = "Not Found",
    [405] = "Method Not Allowed", [408] = "Request Timeout",
    [413] = "Payload Too Large", [429] = "Too Many Requests",
    [500] = "Internal Server Error", [503] = "Service Unavailable",
}

local Server = {}
Server.__index = Server

function M.new(cfg)
    local self = setmetatable({}, Server)
    self.docroot = cfg.docroot
    self.handler = cfg.handler
    self.max_conns = cfg.max_conns or 48
    self.max_body = cfg.max_body or 262144
    self.conns = {}       -- fd -> connection record
    self.nconns = 0
    self.sse = {}         -- fd -> connection record (subset of conns)
    self.filecache = {}   -- path -> {body, mime, mtime, etag}
    self.log = cfg.log or function() end
    self.hits = 0

    local srv = nixio.bind(cfg.addr or "0.0.0.0", cfg.port, "inet", "stream")
    if not srv then return nil, "bind failed" end
    srv:setsockopt("socket", "reuseaddr", 1)
    srv:setblocking(false)
    srv:listen(32)
    self.srv = srv
    self.port = cfg.port
    return self
end

-- ------------------------------------------------------------------
-- Connection bookkeeping
-- ------------------------------------------------------------------

local function close_conn(self, fd, why)
    local c = self.conns[fd]
    if not c then return end
    self.conns[fd] = nil
    if self.sse[fd] then self.sse[fd] = nil end
    self.nconns = self.nconns - 1
    pcall(function() fd:close() end)
end

function Server:pollfds(list)
    list[#list + 1] = { fd = self.srv, events = nixio.poll_flags("in"), _http = "listen" }
    for fd, c in pairs(self.conns) do
        local ev = nixio.poll_flags("in")
        if #c.out > 0 then ev = bit.bor(ev, nixio.poll_flags("out")) end
        list[#list + 1] = { fd = fd, events = ev, _http = "conn" }
    end
end

function Server:owns(fd)
    return fd == self.srv or self.conns[fd] ~= nil
end

-- ------------------------------------------------------------------
-- Writing
-- ------------------------------------------------------------------

local function flush(self, fd)
    local c = self.conns[fd]
    if not c then return end
    while #c.out > 0 do
        local n, err = fd:write(c.out)
        if not n then
            if err == EAGAIN or err == EWOULDBLOCK then return end
            close_conn(self, fd, "write error")
            return
        end
        if n == 0 then
            close_conn(self, fd, "zero write")
            return
        end
        c.out = c.out:sub(n + 1)
    end
    if c.close_after and #c.out == 0 then close_conn(self, fd, "done") end
end

local function queue(self, fd, data)
    local c = self.conns[fd]
    if not c then return end
    -- A browser tab that has been suspended stops reading. Rather than let
    -- its backlog eat the router's RAM, drop the connection; the PWA
    -- reconnects and catches up with a since= query.
    if #c.out > 512 * 1024 then
        close_conn(self, fd, "backpressure")
        return
    end
    c.out = c.out .. data
    flush(self, fd)
end

local function respond(self, fd, status, headers, body, opts)
    opts = opts or {}
    local c = self.conns[fd]
    if not c then return end
    body = body or ""
    local h = {
        string.format("HTTP/1.1 %d %s", status, STATUS[status] or "OK"),
        "Server: pigeonmesh",
        "Content-Length: " .. #body,
    }
    for k, v in pairs(headers or {}) do h[#h + 1] = k .. ": " .. v end
    if opts.keepalive == false or c.want_close then
        h[#h + 1] = "Connection: close"
        c.close_after = true
    else
        h[#h + 1] = "Connection: keep-alive"
    end
    queue(self, fd, table.concat(h, "\r\n") .. "\r\n\r\n" .. body)
end

-- ------------------------------------------------------------------
-- Server-Sent Events
--
-- The PWA opens one of these and never polls again. Everything the mesh
-- learns -- a new record, a peer appearing, a node running low on battery --
-- arrives here within a poll tick.
-- ------------------------------------------------------------------

local function start_sse(self, fd)
    local c = self.conns[fd]
    if not c then return end
    local head = table.concat({
        "HTTP/1.1 200 OK",
        "Content-Type: text/event-stream; charset=utf-8",
        "Cache-Control: no-store",
        "Connection: keep-alive",
        -- Nothing between the browser and the daemon should buffer this.
        "X-Accel-Buffering: no",
        "Access-Control-Allow-Origin: *",
    }, "\r\n") .. "\r\n\r\n"
    c.is_sse = true
    c.close_after = false
    self.sse[fd] = c
    queue(self, fd, head .. "retry: 2000\n\n")
end

function Server:sse_send(fd, event, data)
    local c = self.conns[fd]
    if not c or not c.is_sse then return end
    local payload = "event: " .. event .. "\n"
    for line in tostring(data):gmatch("[^\n]+") do
        payload = payload .. "data: " .. line .. "\n"
    end
    queue(self, fd, payload .. "\n")
end

function Server:sse_broadcast(event, data)
    for fd in pairs(self.sse) do
        self:sse_send(fd, event, data)
    end
end

function Server:sse_count()
    local n = 0
    for _ in pairs(self.sse) do n = n + 1 end
    return n
end

-- ------------------------------------------------------------------
-- Static files
-- ------------------------------------------------------------------

local function safe_path(docroot, path)
    -- Reject anything that could escape the document root. Percent-decoding
    -- happens first so "%2e%2e%2f" is caught too.
    path = path:gsub("%%(%x%x)", function(h) return string.char(tonumber(h, 16)) end)
    if path:find("%z") or path:find("%.%.") then return nil end
    if path == "/" then path = "/index.html" end
    if not path:match("^/[%w%._%-/]*$") then return nil end
    return docroot .. path
end

local function serve_static(self, fd, req)
    if not self.docroot then return false end
    local full = safe_path(self.docroot, req.path)
    if not full then
        respond(self, fd, 403, {}, "forbidden")
        return true
    end

    local ext = full:match("%.(%w+)$") or "txt"
    local cached = self.filecache[full]
    if not cached then
        local body = util.read_file(full)
        if not body then return false end
        cached = {
            body = body,
            mime = MIME[ext] or "application/octet-stream",
            -- Content hash rather than mtime: the package installer resets
            -- mtimes, and a stale service worker is worse than a cache miss.
            -- Split the 32-bit hash into two 16-bit halves before
            -- formatting. OpenWrt builds Lua 5.1 with 32-bit signed
            -- integers, so string.format("%x") throws on anything at or
            -- above 2^31 -- which is half of all possible hashes.
            etag = (function()
                local h = util.fnv1a(body)
                return string.format('W/"%d-%04x%04x"', #body,
                    math.floor(h / 65536), h % 65536)
            end)(),
        }
        -- Only cache what is small enough to be worth it on an 8 MB router.
        if #body <= 96 * 1024 then self.filecache[full] = cached end
    end

    if req.headers["if-none-match"] == cached.etag then
        respond(self, fd, 304, { ETag = cached.etag }, "")
        return true
    end

    respond(self, fd, 200, {
        ["Content-Type"] = cached.mime,
        ["ETag"] = cached.etag,
        -- The service worker is the update mechanism, so it must never be
        -- served from cache; everything else may be.
        ["Cache-Control"] = full:match("sw%.js$") and "no-cache"
            or "public, max-age=300",
    }, cached.body)
    return true
end

function Server:invalidate_cache()
    self.filecache = {}
end

-- ------------------------------------------------------------------
-- Request parsing and dispatch
-- ------------------------------------------------------------------

local function parse_query(qs)
    local out = {}
    for k, v in (qs or ""):gmatch("([^&=?]+)=?([^&]*)") do
        k = k:gsub("%+", " "):gsub("%%(%x%x)", function(h) return string.char(tonumber(h, 16)) end)
        v = v:gsub("%+", " "):gsub("%%(%x%x)", function(h) return string.char(tonumber(h, 16)) end)
        out[k] = v
    end
    return out
end

local function dispatch(self, fd, req)
    self.hits = self.hits + 1

    if req.method == "OPTIONS" then
        respond(self, fd, 204, {
            ["Access-Control-Allow-Origin"] = "*",
            ["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS",
            ["Access-Control-Allow-Headers"] = "Content-Type",
            ["Access-Control-Max-Age"] = "86400",
        }, "")
        return
    end

    if req.path == "/api/stream" then
        start_sse(self, fd)
        if self.handler then
            self.handler({ method = "SSE_OPEN", path = req.path, query = req.query,
                headers = req.headers, fd = fd, server = self })
        end
        return
    end

    if req.path:sub(1, 5) == "/api/" then
        local res = { status = 500, body = "no handler" }
        if self.handler then
            local conn = self.conns[fd]
            local ok, r = pcall(self.handler, {
                method = req.method, path = req.path, query = req.query,
                headers = req.headers, body = req.body, fd = fd, server = self,
                peer = conn and conn.peer or "?",
            })
            if ok and type(r) == "table" then
                res = r
            elseif not ok then
                self.log("api error on %s: %s", req.path, tostring(r))
                res = { status = 500, body = '{"error":"internal"}' }
            end
        end
        local h = res.headers or {}
        h["Content-Type"] = h["Content-Type"] or "application/json; charset=utf-8"
        h["Access-Control-Allow-Origin"] = "*"
        h["Cache-Control"] = "no-store"
        respond(self, fd, res.status or 200, h, res.body or "")
        return
    end

    if req.method ~= "GET" and req.method ~= "HEAD" then
        respond(self, fd, 405, {}, "method not allowed")
        return
    end

    if serve_static(self, fd, req) then return end

    -- Unknown path under a single-page app: hand back the shell so deep
    -- links like /#sos work after a cold start.
    local shell = self.docroot and util.read_file(self.docroot .. "/index.html")
    if shell then
        respond(self, fd, 200, { ["Content-Type"] = MIME.html }, shell)
    else
        respond(self, fd, 404, {}, "not found")
    end
end

local function try_parse(self, fd)
    local c = self.conns[fd]
    while c and not c.is_sse do
        local head_end = c.inbuf:find("\r\n\r\n", 1, true)
        if not head_end then
            if #c.inbuf > 16384 then close_conn(self, fd, "header too large") end
            return
        end
        local head = c.inbuf:sub(1, head_end - 1)
        local first, rest = head:match("^([^\r\n]*)\r?\n?(.*)$")
        local method, target, version = (first or ""):match("^(%u+)%s+(%S+)%s+(HTTP/[%d.]+)$")
        if not method then
            respond(self, fd, 400, {}, "bad request", { keepalive = false })
            return
        end

        local headers = {}
        for line in (rest or ""):gmatch("[^\r\n]+") do
            local k, v = line:match("^([%w%-]+):%s*(.*)$")
            if k then headers[k:lower()] = v end
        end
        if version == "HTTP/1.0" and (headers["connection"] or ""):lower() ~= "keep-alive" then
            c.want_close = true
        end
        if (headers["connection"] or ""):lower() == "close" then c.want_close = true end

        local clen = tonumber(headers["content-length"] or "0") or 0
        if clen > self.max_body then
            respond(self, fd, 413, {}, "payload too large", { keepalive = false })
            return
        end
        local body_start = head_end + 4
        if #c.inbuf - body_start + 1 < clen then
            return  -- wait for the rest of the body
        end

        local body = c.inbuf:sub(body_start, body_start + clen - 1)
        c.inbuf = c.inbuf:sub(body_start + clen)

        local path, qs = target:match("^([^?]*)%??(.*)$")
        dispatch(self, fd, {
            method = method,
            path = path,
            query = parse_query(qs),
            headers = headers,
            body = body,
        })
        c = self.conns[fd]
    end
end

function Server:handle(fd, revents)
    local has_in = bit.band(revents, nixio.poll_flags("in")) ~= 0
    local has_out = bit.band(revents, nixio.poll_flags("out")) ~= 0
    local has_err = bit.band(revents, bit.bor(nixio.poll_flags("err"),
        nixio.poll_flags("hup"))) ~= 0

    if fd == self.srv then
        if has_in then
            local newfd, host = self.srv:accept()
            if newfd then
                if self.nconns >= self.max_conns then
                    -- Shed the oldest non-SSE connection rather than refuse
                    -- the newest: a fresh request is usually a real user.
                    local oldest, oldest_t
                    for cfd, c in pairs(self.conns) do
                        if not c.is_sse and (not oldest_t or c.started < oldest_t) then
                            oldest, oldest_t = cfd, c.started
                        end
                    end
                    if oldest then close_conn(self, oldest, "conn limit")
                    else newfd:close() return true end
                end
                newfd:setblocking(false)
                self.conns[newfd] = {
                    inbuf = "", out = "", started = util.monotonic(),
                    peer = tostring(host), last = util.monotonic(),
                }
                self.nconns = self.nconns + 1
            end
        end
        return true
    end

    local c = self.conns[fd]
    if not c then return false end
    c.last = util.monotonic()

    if has_in then
        local data, err = fd:read(16384)
        if not data then
            if err ~= EAGAIN and err ~= EWOULDBLOCK then
                close_conn(self, fd, "read error")
                return true
            end
        elseif #data == 0 then
            close_conn(self, fd, "eof")
            return true
        else
            c.inbuf = c.inbuf .. data
            try_parse(self, fd)
        end
    end
    if has_out and self.conns[fd] then flush(self, fd) end
    if has_err and self.conns[fd] then close_conn(self, fd, "poll error") end
    return true
end

-- Called once per second by the daemon.
function Server:tick(now)
    for fd, c in pairs(self.conns) do
        if c.is_sse then
            -- A comment frame keeps NAT table entries and phone radios alive.
            if now - (c.last_ping or 0) > 20 then
                c.last_ping = now
                queue(self, fd, ": keepalive\n\n")
            end
        elseif now - c.last > 30 then
            close_conn(self, fd, "idle")
        end
    end
end

function Server:stats()
    return { conns = self.nconns, sse = self:sse_count(), hits = self.hits }
end

function Server:close()
    for fd in pairs(self.conns) do close_conn(self, fd, "shutdown") end
    if self.srv then self.srv:close() end
end

return M
