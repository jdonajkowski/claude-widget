#!/usr/bin/env bash
# Installs Gremlin from the GitHub Releases on Linux. Needs only curl.
#   Arch-based (pacman):  installs the .pacman package (asks for your sudo password)
#   other distros:        puts the AppImage in ~/.local/bin and adds a menu entry
# Replaces Claude Widget, the app's old name, if it is installed (your settings carry over).
#
#   curl -fsSL https://raw.githubusercontent.com/jdonajkowski/gremlin-desk/main/scripts/install-linux.sh | bash
#   ... | bash -s v0.7.0     a specific release instead of the latest
set -euo pipefail

REPO="${GREMLIN_REPO:-jdonajkowski/gremlin-desk}"
TAG="${1:-}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

if command -v pacman >/dev/null; then ext='.pacman'; else ext='.AppImage'; fi

if [ -n "$TAG" ]; then api="https://api.github.com/repos/$REPO/releases/tags/$TAG"; else api="https://api.github.com/repos/$REPO/releases/latest"; fi
url="$(curl -fsSL "$api" | grep -o "\"browser_download_url\": *\"[^\"]*${ext//./\\.}\"" | head -n 1 | sed 's/.*"\(https[^"]*\)"/\1/')"
[ -n "$url" ] || { echo "No $ext file found in ${TAG:-the latest release} of $REPO." >&2; exit 1; }

file="$tmp/${url##*/}"
echo "Downloading ${url##*/}…"
curl -fL --progress-bar -o "$file" "$url"

if [ "$ext" = '.pacman' ]; then
  sudo pacman -U "$file"
  if pacman -Q claude-desktop-widget >/dev/null 2>&1; then
    echo "Removing Claude Widget (the old name of this app)…"
    sudo pacman -R --noconfirm claude-desktop-widget
  fi
  echo "Installed. Start Gremlin from your app menu."
else
  mkdir -p "$HOME/.local/bin" "$HOME/.local/share/applications"
  install -m 755 "$file" "$HOME/.local/bin/gremlin-desk.AppImage"
  cat > "$HOME/.local/share/applications/gremlin-desk.desktop" <<DESKTOP
[Desktop Entry]
Name=Gremlin
Comment=Desktop workspace for Claude Code sessions
Exec=$HOME/.local/bin/gremlin-desk.AppImage
Terminal=false
Type=Application
Categories=Development;
StartupWMClass=Gremlin
DESKTOP
  rm -f "$HOME/.local/bin/claude-widget.AppImage" "$HOME/.local/share/applications/claude-widget.desktop"
  echo "Installed ~/.local/bin/gremlin-desk.AppImage with a menu entry. AppImages need FUSE 2 (libfuse2 / fuse2)."
fi
