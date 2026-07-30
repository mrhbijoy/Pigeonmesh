-- LuCI menu entry for PigeonMesh.
--
-- The daemon serves its own UI on its own port, so nothing here proxies or
-- re-implements it. These pages exist so an admin who is already logged into
-- LuCI can see node health and change ports without an SSH session.

module("luci.controller.pigeonmesh", package.seeall)

function index()
    if not nixio.fs.access("/etc/config/pigeonmesh") then return end
    entry({"admin", "services", "pigeonmesh"}, firstchild(), "PigeonMesh", 60)
    entry({"admin", "services", "pigeonmesh", "status"}, template("pigeonmesh/status"), "Status", 10)
    entry({"admin", "services", "pigeonmesh", "live"}, template("pigeonmesh/live"), "Live Mesh", 20)
    entry({"admin", "services", "pigeonmesh", "cloud"}, template("pigeonmesh/cloud"), "Cloud Dashboard", 25)
    entry({"admin", "services", "pigeonmesh", "config"}, cbi("pigeonmesh/config"), "Settings", 30)
end
