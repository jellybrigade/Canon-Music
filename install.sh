#!/bin/sh
set -e

REPO="jellybrigade/Canon-Music"
APP_NAME="canon"

# Detect OS
OS="$(uname -s)"
case "$OS" in
  Linux*)  PLATFORM="linux" ;;
  Darwin*) PLATFORM="macos" ;;
  *)
    echo "Error: unsupported OS: $OS"
    echo "Download manually: https://github.com/$REPO/releases/latest"
    exit 1
    ;;
esac

# Detect arch (Linux only — macOS build is universal)
ARCH="$(uname -m)"
if [ "$PLATFORM" = "linux" ] && [ "$ARCH" != "x86_64" ]; then
  echo "Error: Linux builds are x86_64 only (your arch: $ARCH)"
  echo "Download manually: https://github.com/$REPO/releases/latest"
  exit 1
fi

# Fetch latest release version
LATEST_JSON="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest")"
VERSION="$(printf '%s' "$LATEST_JSON" | grep '"tag_name"' | head -1 | sed 's/.*"v\([^"]*\)".*/\1/')"

if [ -z "$VERSION" ]; then
  echo "Error: could not determine latest version"
  exit 1
fi

echo "Installing Canon v$VERSION..."

install_linux() {
  if command -v dpkg >/dev/null 2>&1; then
    # Debian/Ubuntu — install .deb
    ASSET="Canon_${VERSION}_amd64.deb"
    URL="https://github.com/$REPO/releases/download/v$VERSION/$ASSET"
    TMP="$(mktemp -d)"
    curl -fsSL --progress-bar "$URL" -o "$TMP/canon.deb"
    sudo dpkg -i "$TMP/canon.deb"
    rm -rf "$TMP"
    echo "Installed via .deb"
  elif command -v rpm >/dev/null 2>&1 && command -v dnf >/dev/null 2>&1; then
    # Fedora/RHEL — install .rpm
    ASSET="Canon-${VERSION}-1.x86_64.rpm"
    URL="https://github.com/$REPO/releases/download/v$VERSION/$ASSET"
    sudo dnf install -y "$URL"
    echo "Installed via .rpm"
  else
    # Fallback — AppImage
    ASSET="Canon_${VERSION}_amd64.AppImage"
    URL="https://github.com/$REPO/releases/download/v$VERSION/$ASSET"
    INSTALL_DIR="$HOME/.local/bin"

    mkdir -p "$INSTALL_DIR"
    curl -fsSL --progress-bar "$URL" -o "$INSTALL_DIR/$APP_NAME"
    chmod +x "$INSTALL_DIR/$APP_NAME"
    echo "Installed to $INSTALL_DIR/$APP_NAME"

    case ":$PATH:" in
      *":$INSTALL_DIR:"*) ;;
      *)
        echo ""
        echo "  $INSTALL_DIR is not in your PATH. Add this to your shell profile:"
        echo "    export PATH=\"\$HOME/.local/bin:\$PATH\""
        ;;
    esac
  fi
}

install_macos() {
  ASSET="Canon_${VERSION}_universal.dmg"
  URL="https://github.com/$REPO/releases/download/v$VERSION/$ASSET"
  TMP="$(mktemp -d)"
  DMG="$TMP/Canon.dmg"

  curl -fsSL --progress-bar "$URL" -o "$DMG"

  MOUNT="$(hdiutil attach "$DMG" -nobrowse -quiet | tail -1 | awk '{print $NF}')"
  cp -r "$MOUNT/Canon.app" /Applications/
  hdiutil detach "$MOUNT" -quiet
  rm -rf "$TMP"

  echo "Installed to /Applications/Canon.app"
}

case "$PLATFORM" in
  linux)  install_linux ;;
  macos)  install_macos ;;
esac

echo "Done. Run: $APP_NAME"
