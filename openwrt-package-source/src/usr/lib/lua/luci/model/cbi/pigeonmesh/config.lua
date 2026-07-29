-- Settings form for PigeonMesh, under Services -> PigeonMesh -> Settings.

local m = Map("pigeonmesh", "PigeonMesh Settings",
    "After changing settings, click Save & Apply — the daemon restarts automatically.")

local s = m:section(NamedSection, "main", "pigeonmesh", "Daemon")
s.addremove = false

s:option(Value, "http_port", "App port",
    "Where the app answers on every LAN address. Default 3607.")
s:option(Value, "http_addr", "Bind address",
    "Address for the port above. Default 0.0.0.0 (all).")
s:option(Value, "peer_port", "Mesh peer port", "Router-to-router link. Default 7100.")
s:option(Value, "domain", "Domain", "Name people type to reach the app. Default pigeon.mesh.")

local a = m:section(NamedSection, "main", "pigeonmesh", "Friendly URL")
a.addremove = false

local ip = a:option(Value, "alias_ip", "PigeonMesh address",
    "A second LAN address reserved for PigeonMesh. The app owns port 80 here, " ..
    "so http://" .. (m.uci:get("pigeonmesh", "main", "domain") or "pigeon.mesh") ..
    "/ opens with no port number, while the router's own address still opens LuCI. " ..
    "Set on install; clear it to turn the friendly URL off.")
ip.datatype = "or(ip4addr,'')"

local ap = a:option(Value, "alias_port", "Port on that address", "Default 80.")
ap.datatype = "port"
ap.placeholder = "80"

local b = m:section(NamedSection, "bridge", "pigeonmesh", "Cloud Bridge",
    "Optional. Forwards records to a bridge so coordinators outside the mesh " ..
    "can see them. An empty URL disables it.")
b.addremove = false
b:option(Value, "url", "Bridge URL").placeholder = "https://example.vercel.app"
b:option(Value, "interval", "Sync interval (s)").placeholder = "30"

m.on_after_apply = function(self)
    os.execute("/etc/init.d/pigeonmesh restart >/dev/null 2>&1 &")
end

return m
