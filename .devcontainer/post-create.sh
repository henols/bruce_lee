#!/usr/bin/env bash
# Prepares the Claude Code state volume so login and chat history survive a rebuild.
#
# devcontainer.json mounts a named volume at ~/.claude and sets CLAUDE_CONFIG_DIR to
# it, so everything Claude Code persists -- .credentials.json, .claude.json, history,
# transcripts under projects/ -- lands in the volume. This script only has to fix the
# ownership Docker gives a fresh volume and do a one-time import of pre-volume state.
set -euo pipefail

CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
SEED_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.claude-seed"

if [ -z "${CLAUDE_CONFIG_DIR:-}" ]; then
	echo "post-create: WARNING - CLAUDE_CONFIG_DIR is unset, so .claude.json will not persist." >&2
fi

# A freshly created named volume mounts empty and root-owned, so every mount target
# needs its ownership handed to the remote user before anything writes to it.
take_ownership() {
	mkdir -p "$1" 2>/dev/null || sudo mkdir -p "$1"
	[ -w "$1" ] || sudo chown "$(id -u):$(id -g)" "$1"
	chmod "$2" "$1"
}

take_ownership "$CLAUDE_DIR" 700
take_ownership "$HOME/.local/share/claude" 755
take_ownership "$HOME/.config/gh" 700
take_ownership /commandhistory 700

# Bash reads HISTFILE at startup; the file itself still has to exist on a fresh volume.
touch "${HISTFILE:-/commandhistory/.bash_history}"

# One-time import of state that existed before the volume did.
if [ -d "$SEED_DIR" ]; then
	if [ ! -e "$CLAUDE_DIR/.credentials.json" ] && [ ! -d "$CLAUDE_DIR/projects" ]; then
		echo "post-create: seeding $CLAUDE_DIR from .claude-seed"
		cp -a "$SEED_DIR/." "$CLAUDE_DIR/"
		# An earlier layout kept the config as claude.json, symlinked to ~/.claude.json.
		if [ -f "$CLAUDE_DIR/claude.json" ] && [ ! -f "$CLAUDE_DIR/.claude.json" ]; then
			mv "$CLAUDE_DIR/claude.json" "$CLAUDE_DIR/.claude.json"
		fi
	fi
	rm -rf "$SEED_DIR"
fi

# Adopt a config the CLI wrote to $HOME before CLAUDE_CONFIG_DIR was in play, and clear
# the stale leftover either way. The volume's copy always wins.
if [ "$HOME/.claude.json" != "$CLAUDE_DIR/.claude.json" ] && [ -e "$HOME/.claude.json" ]; then
	if [ -e "$CLAUDE_DIR/.claude.json" ]; then
		rm -f "$HOME/.claude.json"
	else
		mv "$HOME/.claude.json" "$CLAUDE_DIR/.claude.json"
	fi
fi
# Harden last, not earlier: `cp -a seed/. dir/` stamps the seed's own mode onto dir,
# and preserves the seed's mode on every file it copies.
chmod 700 "$CLAUDE_DIR"
for secret in "$CLAUDE_DIR/.claude.json" "$CLAUDE_DIR/.credentials.json"; do
	[ -f "$secret" ] && chmod 600 "$secret"
done

echo "post-create: Claude Code state persisted in $CLAUDE_DIR (claude-state volume)"
