#!/usr/bin/env bash
# Installs the ACME crossassembler for the 6502/65816 (C64 target).
#
# Two halves, because Debian ships only one of them:
#   1. the `acme` binary, from Debian trixie/main (release 0.97 "Zem")
#   2. the ACME_Lib tree, which the Debian package deliberately drops. It holds the
#      includes that sources reach for with <...> quoting -- <6502/std.a>,
#      <cbm/c64/vic.a>, <cbm/c64/kernal.a> -- and without it those !source lines fail.
#      ACME finds the tree through the ACME env var, set in devcontainer.json.
set -euo pipefail

ACME_LIB_DIR=/usr/local/share/acme
ACME_LIB_REF=master

if ! command -v acme >/dev/null 2>&1; then
	echo "install-acme: installing acme from apt"
	sudo apt-get update
	sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends acme
fi

# Pulled from upstream rather than vendored: it is ~40 files of public-domain includes
# that the apt package should have carried. A rebuild without network keeps the binary
# and only loses the <...> includes, so this is a warning, not a build failure.
if [ ! -d "$ACME_LIB_DIR/6502" ]; then
	echo "install-acme: fetching ACME_Lib from upstream"
	tmp="$(mktemp -d)"
	trap 'rm -rf "$tmp"' EXIT
	if curl -fsSL "https://codeload.github.com/meonwax/acme/tar.gz/refs/heads/$ACME_LIB_REF" \
		| tar xz -C "$tmp" --strip-components=2 "acme-$ACME_LIB_REF/ACME_Lib"; then
		sudo mkdir -p "$ACME_LIB_DIR"
		sudo cp -a "$tmp/." "$ACME_LIB_DIR/"
	else
		echo "install-acme: WARNING - could not fetch ACME_Lib; <...> includes will not resolve." >&2
	fi
fi

acme --version
echo "install-acme: ACME_Lib at $ACME_LIB_DIR (ACME=${ACME:-unset})"
