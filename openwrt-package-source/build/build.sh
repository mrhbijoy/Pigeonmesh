#!/bin/sh
# Build installable PigeonMesh packages from src/ without the OpenWrt SDK.
#
#   ./build/build.sh            build everything it can
#   ./build/build.sh --clean    wipe dist/ first
#
# Three outputs land in dist/:
#
#   pigeonmesh-<ver>.apk     OpenWrt 24.10+ / 25.x  (apk-tools 3)
#   pigeonmesh_<ver>_all.ipk OpenWrt <= 23.05       (opkg)
#   pigeonmesh-<ver>.tar.gz  plain tree, for hand installs and inspection
#
# The tarball and the .ipk build anywhere with tar, gzip and ar. The .apk
# needs `apk mkpkg`, which ships with apk-tools 3 -- present inside the
# OpenWrt SDK and on Alpine, but not on the router itself and not on most
# desktops. Point APK_BIN at one if it is not on PATH; without it the other
# two are still produced and the .apk is skipped with a note.
#
# Nothing here compiles: the package is Lua, shell and static assets, so one
# build is valid for every target architecture.

set -e

PKG_NAME=pigeonmesh
PKG_VERSION=${PKG_VERSION:-1.1.0}
PKG_RELEASE=${PKG_RELEASE:-1}
PKG_LICENSE="GPL-2.0-only"
PKG_URL="https://github.com/pigeonmesh/pigeonmesh"
PKG_DESC="Crisis mesh: offline chat, SOS, safe check-in, missing persons and relief mapping"
PKG_DEPENDS="lua luci-lib-nixio luci-compat"

FULLVER="${PKG_VERSION}-r${PKG_RELEASE}"

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/.." && pwd)          # openwrt-package-source/
repo=$(cd "$root/.." && pwd)          # repository root
SRC="$root/src"
SCRIPTS="$here/scripts"
DIST="$repo/dist"

# Stage outside the working tree, on a real filesystem. A checkout on a
# Windows drive (or any mount without POSIX ownership) reports every file as
# 0777 and owned by the interactive user, and both the .apk and the .ipk
# record whatever the staging tree claims -- which is how earlier builds
# ended up installing files owned by "nobody".
STAGE=$(mktemp -d "${TMPDIR:-/tmp}/pigeonmesh-build.XXXXXX")
trap 'rm -rf "$STAGE"' EXIT INT TERM

APK_BIN=${APK_BIN:-$(command -v apk 2>/dev/null || true)}

# Ownership has to read as root:root inside the package. fakeroot gives us
# that without needing to actually be root; without it the build still works
# and the files land as root anyway on install, just less tidily.
if [ -z "$PM_IN_FAKEROOT" ] && command -v fakeroot >/dev/null 2>&1; then
	PM_IN_FAKEROOT=1 exec fakeroot "$0" "$@"
fi

[ "$1" = "--clean" ] && rm -rf "$DIST"
mkdir -p "$DIST"

say() { printf '  %s\n' "$*"; }

# ---------------------------------------------------------------- staging
# Copy the tree, then set modes explicitly. Whatever the checkout's umask or
# a Windows filesystem did to the permission bits, the package must ship
# executables as 0755 and data as 0644.
echo "==> staging $PKG_NAME $FULLVER"
cp -r "$SRC/." "$STAGE/"

chown -R 0:0 "$STAGE" 2>/dev/null || true
find "$STAGE" -type d -exec chmod 0755 {} +
find "$STAGE" -type f -exec chmod 0644 {} +
for x in usr/sbin/pigeonmeshd usr/bin/pigeonmesh usr/bin/pm-bridge-sync.sh etc/init.d/pigeonmesh \
         etc/init.d/pm-bridge-sync etc/uci-defaults/99-pigeonmesh; do
	[ -f "$STAGE/$x" ] && chmod 0755 "$STAGE/$x"
done

# selftest.html is a development aid; it has no business on a crisis node.
rm -f "$STAGE/www/pigeonmesh/selftest.html"

# Keep the version the daemon reports in step with the package version, so
# "which build is this router running" has one answer.
sed -i "s/^local VERSION = \".*\"/local VERSION = \"$PKG_VERSION\"/" \
	"$STAGE/usr/sbin/pigeonmeshd"

# du -sk, not -sb: -b is GNU-only and this has to run on a BSD userland too.
# The exact figure the .ipk records is computed further down, the way OpenWrt
# computes it.
say "$(find "$STAGE" -type f | wc -l) files, $(du -sk "$STAGE" | cut -f1) KiB"

# ---------------------------------------------------------------- tarball
echo "==> tar.gz"
tar czf "$DIST/${PKG_NAME}-${FULLVER}.tar.gz" -C "$STAGE" .
say "dist/${PKG_NAME}-${FULLVER}.tar.gz"

# -------------------------------------------------------------------- ipk
# An .ipk is an ar archive of three members, in this order.
echo "==> ipk"
if command -v ar >/dev/null 2>&1; then
	ipktmp="$STAGE.ipk"
	rm -rf "$ipktmp"; mkdir -p "$ipktmp/control"

	# Payload first, because Installed-Size is derived from it.
	tar czf "$ipktmp/data.tar.gz" -C "$STAGE" .

	# Installed-Size is in BYTES here, not KiB. That is Debian's convention but
	# not OpenWrt's: scripts/ipkg-build in the OpenWrt tree sets it from
	# `zcat data.tar.gz | wc -c`, and opkg reads it back the same way. Matching
	# upstream exactly -- including the tar headers and padding that a `du` of
	# the staging tree would miss -- keeps this package consistent with every
	# other package on the router. Writing KiB here would understate it 1024x.
	INSTALLED_SIZE=$(gzip -dc "$ipktmp/data.tar.gz" | wc -c | tr -d ' ')

	cat > "$ipktmp/control/control" <<EOF
Package: $PKG_NAME
Version: $FULLVER
Depends: $(echo "$PKG_DEPENDS" | tr ' ' ',' | sed 's/,/, /g')
Section: net
Architecture: all
Installed-Size: $INSTALLED_SIZE
Maintainer: PigeonMesh contributors
License: $PKG_LICENSE
Description: $PKG_DESC
EOF
	cat > "$ipktmp/control/conffiles" <<'EOF'
/etc/config/pigeonmesh
EOF
	cp "$SCRIPTS/post-install" "$ipktmp/control/postinst"
	cp "$SCRIPTS/pre-deinstall" "$ipktmp/control/prerm"
	chmod 0755 "$ipktmp/control/postinst" "$ipktmp/control/prerm"
	chown -R 0:0 "$ipktmp" 2>/dev/null || true

	echo "2.0" > "$ipktmp/debian-binary"
	tar czf "$ipktmp/control.tar.gz" -C "$ipktmp/control" .
	( cd "$ipktmp" && ar r "$DIST/${PKG_NAME}_${FULLVER}_all.ipk" \
		debian-binary control.tar.gz data.tar.gz 2>/dev/null )
	rm -rf "$ipktmp"
	say "dist/${PKG_NAME}_${FULLVER}_all.ipk"
else
	say "SKIPPED: no 'ar' on PATH"
fi

# -------------------------------------------------------------------- apk
echo "==> apk"
apk_out="$DIST/${PKG_NAME}-${FULLVER}.apk"
rm -f "$apk_out"
if [ -n "$APK_BIN" ] && "$APK_BIN" mkpkg \
		--files "$STAGE" \
		--info "name:$PKG_NAME" \
		--info "version:$FULLVER" \
		--info "description:$PKG_DESC" \
		--info "arch:noarch" \
		--info "license:$PKG_LICENSE" \
		--info "origin:$PKG_NAME" \
		--info "url:$PKG_URL" \
		--info "depends:$PKG_DEPENDS" \
		--script "post-install:$SCRIPTS/post-install" \
		--script "pre-deinstall:$SCRIPTS/pre-deinstall" \
		--output "$apk_out" 2>&1 && [ -s "$apk_out" ]; then
	say "dist/${PKG_NAME}-${FULLVER}.apk"
else
	rm -f "$apk_out"
	say "SKIPPED: no working 'apk mkpkg' (set APK_BIN=/path/to/apk)"
	say "         apk-tools 3 lives in the OpenWrt SDK and on Alpine."
fi

rm -rf "$STAGE"
echo "==> done"
ls -la "$DIST"
