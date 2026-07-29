# OpenWrt package Makefile.
#
# build/build.sh produces installable packages without the OpenWrt SDK, which
# is what you want during a hackathon. This file is for the other path: adding
# PigeonMesh to an OpenWrt feed so it can be built by the official buildroot,
# signed with the buildroot's key, and baked into a firmware image.
#
# Usage:
#   echo "src-link pigeonmesh /path/to/pigeonmesh/openwrt-feed" >> feeds.conf
#   ./scripts/feeds update pigeonmesh && ./scripts/feeds install pigeonmesh
#   make menuconfig     # Network -> pigeonmesh
#   make package/pigeonmesh/compile

include $(TOPDIR)/rules.mk

PKG_NAME:=pigeonmesh
PKG_VERSION:=1.0.0
PKG_RELEASE:=1

PKG_MAINTAINER:=PigeonMesh contributors
PKG_LICENSE:=GPL-2.0-only

# Pure Lua, shell and static assets: one build runs on every target.
PKG_ARCH:=all
PKG_BUILD_DEPENDS:=
PKG_BUILD_PARALLEL:=1

include $(INCLUDE_DIR)/package.mk

define Package/pigeonmesh
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=Communication
  TITLE:=Crisis mesh: chat, SOS and relief coordination without internet
  URL:=https://github.com/pigeonmesh/pigeonmesh
  DEPENDS:=+lua +luci-lib-nixio
  PKGARCH:=all
endef

define Package/pigeonmesh/description
  PigeonMesh turns ordinary OpenWrt routers into a communication network that
  keeps working when the internet does not.

  Routers find each other over the LAN and replicate a log of signed records:
  chat, emergency alerts, "I am safe" check-ins, missing-person reports and
  relief map pins. Phones join by opening a web page -- no app install -- and
  any phone that moves between two disconnected parts of the mesh carries
  records across, so islands converge without a link between them.

  Messages are signed on the device with Ed25519 and direct messages are
  encrypted end to end, so a seized router yields no identities to forge and
  no private messages to read.
endef

define Package/pigeonmesh/conffiles
/etc/config/pigeonmesh
/etc/pigeonmesh/store/records.jsonl
endef

# Nothing to compile.
define Build/Compile
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
endef

define Package/pigeonmesh/install
	$(INSTALL_DIR) $(1)/usr/sbin
	$(INSTALL_BIN) ./files/usr/sbin/pigeonmeshd $(1)/usr/sbin/

	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) ./files/usr/bin/pigeonmesh $(1)/usr/bin/

	$(INSTALL_DIR) $(1)/usr/lib/lua/pigeonmesh
	$(INSTALL_DATA) ./files/usr/lib/lua/pigeonmesh/*.lua $(1)/usr/lib/lua/pigeonmesh/

	$(INSTALL_DIR) $(1)/www/pigeonmesh/icons
	$(INSTALL_DATA) ./files/www/pigeonmesh/*.html $(1)/www/pigeonmesh/
	$(INSTALL_DATA) ./files/www/pigeonmesh/*.js $(1)/www/pigeonmesh/
	$(INSTALL_DATA) ./files/www/pigeonmesh/*.css $(1)/www/pigeonmesh/
	$(INSTALL_DATA) ./files/www/pigeonmesh/*.webmanifest $(1)/www/pigeonmesh/
	$(INSTALL_DATA) ./files/www/pigeonmesh/icons/* $(1)/www/pigeonmesh/icons/

	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/etc/config/pigeonmesh $(1)/etc/config/pigeonmesh

	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/etc/init.d/pigeonmesh $(1)/etc/init.d/pigeonmesh

	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./files/etc/uci-defaults/99-pigeonmesh $(1)/etc/uci-defaults/99-pigeonmesh
endef

define Package/pigeonmesh/postinst
#!/bin/sh
[ -n "$$IPKG_INSTROOT" ] && exit 0
mkdir -p /var/lib/pigeonmesh /etc/pigeonmesh/store
[ -x /etc/uci-defaults/99-pigeonmesh ] && sh /etc/uci-defaults/99-pigeonmesh
/etc/init.d/pigeonmesh enable
/etc/init.d/pigeonmesh restart
exit 0
endef

define Package/pigeonmesh/prerm
#!/bin/sh
[ -n "$$IPKG_INSTROOT" ] && exit 0
/etc/init.d/pigeonmesh stop
/etc/init.d/pigeonmesh disable
uci -q delete firewall.pigeonmesh_peer
uci -q delete firewall.pigeonmesh_disc
uci -q delete firewall.pigeonmesh_http
uci -q commit firewall
uci -q delete dhcp.pigeonmesh
uci -q commit dhcp
exit 0
endef

$(eval $(call BuildPackage,pigeonmesh))
