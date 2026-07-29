# OpenWrt package Makefile.
#
# build/build.sh produces installable packages without the OpenWrt SDK, which
# is what you want during a hackathon. This file is for the other path: adding
# PigeonMesh to an OpenWrt feed so it can be built by the official buildroot,
# signed with the buildroot's key, and baked into a firmware image.
#
# Usage:
#   echo "src-link pigeonmesh /path/to/pigeonmesh/openwrt-package-source/openwrt-feed" >> feeds.conf
#   ./scripts/feeds update pigeonmesh && ./scripts/feeds install pigeonmesh
#   make menuconfig     # Network -> Communication -> pigeonmesh
#   make package/pigeonmesh/compile

include $(TOPDIR)/rules.mk

PKG_NAME:=pigeonmesh
PKG_VERSION:=1.1.0
PKG_RELEASE:=1

PKG_MAINTAINER:=PigeonMesh contributors
PKG_LICENSE:=GPL-2.0-only

# Pure Lua, shell and static assets: one build runs on every target.
PKG_ARCH:=all
PKG_BUILD_DEPENDS:=
PKG_BUILD_PARALLEL:=1

# feeds installs this package as a symlink, so the payload has to be found
# relative to where this Makefile really lives, not where make was handed it.
# GNU make's $(realpath) resolves the symlink; $(abspath) would not.
PM_SELF:=$(realpath $(lastword $(MAKEFILE_LIST)))
PM_ROOT:=$(realpath $(dir $(PM_SELF))../..)
PM_SRC:=$(PM_ROOT)/src
PM_SCRIPTS:=$(PM_ROOT)/build/scripts

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
	$(INSTALL_BIN) $(PM_SRC)/usr/sbin/pigeonmeshd $(1)/usr/sbin/

	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) $(PM_SRC)/usr/bin/pigeonmesh $(1)/usr/bin/

	$(INSTALL_DIR) $(1)/usr/lib/lua/pigeonmesh
	$(INSTALL_DATA) $(PM_SRC)/usr/lib/lua/pigeonmesh/*.lua $(1)/usr/lib/lua/pigeonmesh/

	# LuCI pages. Inert when LuCI is not installed, so they are not a
	# reason to pull the whole web interface onto a headless node.
	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/controller
	$(INSTALL_DATA) $(PM_SRC)/usr/lib/lua/luci/controller/pigeonmesh.lua \
		$(1)/usr/lib/lua/luci/controller/
	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/model/cbi/pigeonmesh
	$(INSTALL_DATA) $(PM_SRC)/usr/lib/lua/luci/model/cbi/pigeonmesh/*.lua \
		$(1)/usr/lib/lua/luci/model/cbi/pigeonmesh/
	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/view/pigeonmesh
	$(INSTALL_DATA) $(PM_SRC)/usr/lib/lua/luci/view/pigeonmesh/*.htm \
		$(1)/usr/lib/lua/luci/view/pigeonmesh/

	$(INSTALL_DIR) $(1)/www/pigeonmesh/icons
	$(INSTALL_DATA) $(PM_SRC)/www/pigeonmesh/index.html $(1)/www/pigeonmesh/
	$(INSTALL_DATA) $(PM_SRC)/www/pigeonmesh/*.js $(1)/www/pigeonmesh/
	$(INSTALL_DATA) $(PM_SRC)/www/pigeonmesh/*.css $(1)/www/pigeonmesh/
	$(INSTALL_DATA) $(PM_SRC)/www/pigeonmesh/*.webmanifest $(1)/www/pigeonmesh/
	$(INSTALL_DATA) $(PM_SRC)/www/pigeonmesh/icons/* $(1)/www/pigeonmesh/icons/

	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) $(PM_SRC)/etc/config/pigeonmesh $(1)/etc/config/pigeonmesh

	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) $(PM_SRC)/etc/init.d/pigeonmesh $(1)/etc/init.d/pigeonmesh

	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) $(PM_SRC)/etc/uci-defaults/99-pigeonmesh $(1)/etc/uci-defaults/99-pigeonmesh
endef

# The same two scripts build/build.sh ships, so an SDK build and a hand build
# behave identically on the router.
Package/pigeonmesh/postinst = $(file < $(PM_SCRIPTS)/post-install)
Package/pigeonmesh/prerm = $(file < $(PM_SCRIPTS)/pre-deinstall)

$(eval $(call BuildPackage,pigeonmesh))
