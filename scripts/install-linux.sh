#!/usr/bin/env bash
# Installs Claude Widget from the GitHub Releases on Linux.
#   Arch-based (pacman):  installs the .pacman package (asks for your sudo password)
#   other distros:        puts the AppImage in ~/.local/bin and adds a menu entry
#
#   bash install-linux.sh           the latest release
#   bash install-linux.sh v0.3.0    a specific one
#
# The repo is private, so downloads need the GitHub CLI signed in (gh auth login), or a token with
# read access in GITHUB_TOKEN (then python3 or jq is used to read the release list).
set -euo pipefail

REPO="${CLAUDE_WIDGET_REPO:-jdonajkowski/claude-widget}"
TAG="${1:-}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

if command -v pacman >/dev/null; then ext='.pacman'; else ext='.AppImage'; fi

if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  gh release download ${TAG:+"$TAG"} --repo "$REPO" --pattern "*$ext" --dir "$tmp"
elif [ -n "${GITHUB_TOKEN:-}" ]; then
  if [ -n "$TAG" ]; then url="https://api.github.com/repos/$REPO/releases/tags/$TAG"; else url="https://api.github.com/repos/$REPO/releases/latest"; fi
  json="$(curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" "$url")"
  if command -v python3 >/dev/null; then
    asset="$(printf '%s' "$json" | python3 -c 'import json,sys; a=[x for x in json.load(sys.stdin)["assets"] if x["name"].endswith(sys.argv[1])]; print(a[0]["id"], a[0]["name"]) if a else None' "$ext")"
  elif command -v jq >/dev/null; then
    asset="$(printf '%s' "$json" | jq -r --arg e "$ext" '[.assets[] | select(.name | endswith($e))][0] | "\(.id) \(.name)"')"
  else
    echo "Needs python3 or jq to read the release list." >&2; exit 1
  fi
  [ -n "$asset" ] && [ "$asset" != "null null" ] || { echo "No $ext file in that release." >&2; exit 1; }
  read -r id name <<<"$asset"
  curl -fL -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/octet-stream" \
    -o "$tmp/$name" "https://api.github.com/repos/$REPO/releases/assets/$id"
else
  echo "$REPO is private: sign in with the GitHub CLI (gh auth login) or set GITHUB_TOKEN first." >&2
  exit 1
fi

file="$(ls "$tmp"/*"$ext" | head -n 1)"
if [ "$ext" = '.pacman' ]; then
  sudo pacman -U "$file"
  echo "Installed. Start Claude Widget from your app menu."
else
  mkdir -p "$HOME/.local/bin" "$HOME/.local/share/applications"
  install -m 755 "$file" "$HOME/.local/bin/claude-widget.AppImage"
  cat > "$HOME/.local/share/applications/claude-widget.desktop" <<DESKTOP
[Desktop Entry]
Name=Claude Widget
Comment=Desktop widget that hosts Claude Code sessions
Exec=$HOME/.local/bin/claude-widget.AppImage
Terminal=false
Type=Application
Categories=Development;
StartupWMClass=Claude Widget
DESKTOP
  echo "Installed ~/.local/bin/claude-widget.AppImage with a menu entry. AppImages need FUSE 2 (libfuse2 / fuse2)."
fi
