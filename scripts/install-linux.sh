#!/usr/bin/env bash
# Installs Claude Widget from the GitHub Releases on Linux. Needs only curl.
#   Arch-based (pacman):  installs the .pacman package (asks for your sudo password)
#   other distros:        puts the AppImage in ~/.local/bin and adds a menu entry
#
#   curl -fsSL https://raw.githubusercontent.com/jdonajkowski/claude-widget/main/scripts/install-linux.sh | bash
#   ... | bash -s v0.3.0     a specific release instead of the latest
set -euo pipefail

REPO="${CLAUDE_WIDGET_REPO:-jdonajkowski/claude-widget}"
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
