#!/usr/bin/env bash
# Builds the Linux packages (Arch .pacman and an AppImage) into dist/. Run it on Linux or in WSL from
# anywhere: bash scripts/build-linux.sh
#
# One-time setup:
#   Arch:          sudo pacman -S --needed base-devel python nodejs npm libarchive rsync
#   Ubuntu / WSL:  sudo apt-get install -y build-essential python3 libarchive-tools rsync
#                  plus Node.js 20+ for Linux (e.g. https://github.com/nvm-sh/nvm), not the Windows one
set -euo pipefail

src="$(cd "$(dirname "$0")/.." && pwd)"

node_bin="$(command -v node || true)"
if [ -z "$node_bin" ] || [[ "$node_bin" == /mnt/* ]]; then
  echo "Needs Node.js for Linux on PATH (found: ${node_bin:-none}). See the setup notes at the top of this script." >&2
  exit 1
fi
for tool in make g++ python3 bsdtar rsync; do
  command -v "$tool" >/dev/null || { echo "Missing $tool. See the setup notes at the top of this script." >&2; exit 1; }
done

# Build in a Linux folder: a node_modules made on Windows holds Windows binaries (node-pty is native).
work="${BUILD_DIR:-$HOME/.cache/gremlin-desk-build}"
mkdir -p "$work"
rsync -a --delete --exclude node_modules --exclude dist --exclude .git "$src/" "$work/"
cd "$work"
npm ci
npx electron-builder --linux --publish never

mkdir -p "$src/dist"
cp dist/*.pacman dist/*.AppImage "$src/dist/"
echo "Done. Packages are in $src/dist:"
ls -1 "$src"/dist/*.pacman "$src"/dist/*.AppImage
