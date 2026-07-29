#!/bin/sh
# The bridge serves the same PWA the router does, from public/pwa/, because a
# coordinator with internet and a volunteer on a mesh node should be looking at
# the same interface. There is one source of truth for it -- the router package
# -- and this copies it across.
#
# Run after changing anything under openwrt-package-source/src/www/pigeonmesh/.
# CI-friendly: --check exits non-zero if the copies have drifted apart.

set -e

here=$(cd "$(dirname "$0")" && pwd)
src=$(cd "$here/../openwrt-package-source/src/www/pigeonmesh" && pwd)
dst="$here/public/pwa"

if [ "$1" = "--check" ]; then
	if diff -r -q "$src" "$dst" >/dev/null 2>&1; then
		echo "pwa: in sync"
		exit 0
	fi
	echo "pwa: OUT OF SYNC with $src" >&2
	diff -r -q "$src" "$dst" >&2 || true
	echo "run ./sync-pwa.sh to fix" >&2
	exit 1
fi

mkdir -p "$dst"
rm -rf "$dst"
cp -r "$src" "$dst"
echo "pwa: copied $(find "$dst" -type f | wc -l) files from $src"
