-- pigeonmesh/json.lua
-- Minimal JSON encoder/decoder for Lua 5.1. No external dependencies.
--
-- Derived from the mesh-chat encoder, with one addition that matters here:
-- an explicit array marker. Lua cannot tell an empty list from an empty
-- object, and a response that says {"records":{}} instead of
-- {"records":[]} breaks every client that does `for (const r of ...)`.
-- Anything the API returns as a list is wrapped with json.arr().

local M = {}

local ARRAY_MT = { __jsontype = "array" }
M.ARRAY_MT = ARRAY_MT

-- Mark a table as a JSON array, even when empty.
function M.arr(t)
    return setmetatable(t or {}, ARRAY_MT)
end

local function encode_string(s)
    s = s:gsub('\\', '\\\\')
    s = s:gsub('"', '\\"')
    s = s:gsub('\n', '\\n')
    s = s:gsub('\r', '\\r')
    s = s:gsub('\t', '\\t')
    s = s:gsub('[%z\1-\31\127]', function(c)
        return string.format('\\u%04x', string.byte(c))
    end)
    return '"' .. s .. '"'
end

local function encode_value(v)
    local t = type(v)
    if v == nil then return "null" end
    if t == "boolean" then return v and "true" or "false" end
    if t == "number" then
        if v ~= v or v == math.huge or v == -math.huge then return "null" end
        -- "%.0f" rather than "%d": OpenWrt builds Lua 5.1 with 32-bit
        -- integers, and "%d" throws on any value at or above 2^31. A peer
        -- could otherwise crash this node by sending a record with an
        -- absurd timestamp.
        if v == math.floor(v) and math.abs(v) < 1e15 then
            return string.format("%.0f", v)
        end
        return string.format("%.14g", v)
    end
    if t == "string" then return encode_string(v) end
    if t == "table" then
        if getmetatable(v) == ARRAY_MT then
            local parts = {}
            for i = 1, #v do parts[i] = encode_value(v[i]) end
            return "[" .. table.concat(parts, ",") .. "]"
        end
        local n, is_array = 0, true
        for k in pairs(v) do
            n = n + 1
            if type(k) ~= "number" or k ~= math.floor(k) or k < 1 then
                is_array = false
                break
            end
        end
        if is_array and n > 0 and n == #v then
            local parts = {}
            for i = 1, #v do parts[i] = encode_value(v[i]) end
            return "[" .. table.concat(parts, ",") .. "]"
        end
        local parts = {}
        for k, val in pairs(v) do
            if type(k) == "string" and val ~= nil then
                parts[#parts + 1] = encode_string(k) .. ":" .. encode_value(val)
            end
        end
        return "{" .. table.concat(parts, ",") .. "}"
    end
    return "null"
end

M.encode = encode_value

local function skip_ws(s, i)
    while true do
        local c = s:sub(i, i)
        if c == " " or c == "\t" or c == "\n" or c == "\r" then
            i = i + 1
        else
            break
        end
    end
    return i
end

local decode_value

local function decode_string(s, i)
    local j = i + 1
    local buf = {}
    while true do
        local ch = s:sub(j, j)
        if ch == "" then error("unterminated string") end
        if ch == '"' then
            return table.concat(buf), j + 1
        elseif ch == "\\" then
            local esc = s:sub(j + 1, j + 1)
            if esc == "n" then buf[#buf + 1] = "\n"
            elseif esc == "r" then buf[#buf + 1] = "\r"
            elseif esc == "t" then buf[#buf + 1] = "\t"
            elseif esc == "b" then buf[#buf + 1] = "\b"
            elseif esc == "f" then buf[#buf + 1] = "\f"
            elseif esc == '"' then buf[#buf + 1] = '"'
            elseif esc == "\\" then buf[#buf + 1] = "\\"
            elseif esc == "/" then buf[#buf + 1] = "/"
            elseif esc == "u" then
                local code = tonumber(s:sub(j + 2, j + 5), 16)
                if not code then error("bad \\u escape") end
                if code >= 0xD800 and code <= 0xDBFF then
                    local m = s:sub(j + 6, j + 11):match('^\\u(%x%x%x%x)$')
                    if m then
                        local cp = 0x10000 + ((code - 0xD800) * 0x400)
                            + (tonumber(m, 16) - 0xDC00)
                        buf[#buf + 1] = string.char(
                            0xF0 + math.floor(cp / 0x40000),
                            0x80 + math.floor(cp / 0x1000) % 0x40,
                            0x80 + math.floor(cp / 0x40) % 0x40,
                            0x80 + cp % 0x40)
                        j = j + 10
                    else
                        buf[#buf + 1] = "?"
                        j = j + 4
                    end
                elseif code < 0x80 then
                    buf[#buf + 1] = string.char(code)
                    j = j + 4
                elseif code < 0x800 then
                    buf[#buf + 1] = string.char(0xC0 + math.floor(code / 0x40),
                        0x80 + code % 0x40)
                    j = j + 4
                else
                    buf[#buf + 1] = string.char(0xE0 + math.floor(code / 0x1000),
                        0x80 + math.floor(code / 0x40) % 0x40,
                        0x80 + code % 0x40)
                    j = j + 4
                end
            else
                buf[#buf + 1] = esc
            end
            j = j + 2
        else
            buf[#buf + 1] = ch
            j = j + 1
        end
    end
end

decode_value = function(s, i, depth)
    depth = (depth or 0) + 1
    -- A deeply nested payload from a hostile peer must not blow the Lua
    -- C stack and take the daemon down with it.
    if depth > 32 then error("nesting too deep") end
    i = skip_ws(s, i)
    local c = s:sub(i, i)
    if c == '"' then
        return decode_string(s, i)
    elseif c == "{" then
        local obj = {}
        i = skip_ws(s, i + 1)
        if s:sub(i, i) == "}" then return obj, i + 1 end
        while true do
            i = skip_ws(s, i)
            if s:sub(i, i) ~= '"' then error("expected key at " .. i) end
            local key
            key, i = decode_string(s, i)
            i = skip_ws(s, i)
            if s:sub(i, i) ~= ":" then error("expected ':' at " .. i) end
            local val
            val, i = decode_value(s, i + 1, depth)
            obj[key] = val
            i = skip_ws(s, i)
            local sep = s:sub(i, i)
            if sep == "," then i = i + 1
            elseif sep == "}" then return obj, i + 1
            else error("expected ',' or '}' at " .. i) end
        end
    elseif c == "[" then
        local arr = M.arr({})
        i = skip_ws(s, i + 1)
        if s:sub(i, i) == "]" then return arr, i + 1 end
        while true do
            local val
            val, i = decode_value(s, i, depth)
            arr[#arr + 1] = val
            i = skip_ws(s, i)
            local sep = s:sub(i, i)
            if sep == "," then i = i + 1
            elseif sep == "]" then return arr, i + 1
            else error("expected ',' or ']' at " .. i) end
        end
    elseif c:match("[-%d]") then
        local m = s:match("^%-?%d+%.?%d*[eE]?[+-]?%d*", i) or s:match("^%-?%d+", i)
        if not m then error("bad number at " .. i) end
        return tonumber(m), i + #m
    elseif s:sub(i, i + 3) == "true" then
        return true, i + 4
    elseif s:sub(i, i + 4) == "false" then
        return false, i + 5
    elseif s:sub(i, i + 3) == "null" then
        return nil, i + 4
    end
    error("unexpected char at " .. i)
end

function M.decode(s)
    if type(s) ~= "string" then return nil, "not a string" end
    if #s == 0 or #s > 1024 * 1024 then return nil, "bad length" end
    local ok, val = pcall(decode_value, s, 1, 0)
    if not ok then return nil, val end
    return val
end

return M
