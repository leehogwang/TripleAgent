#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
NODE_VERSION=${TRIPLEAGENT_NODE_VERSION:-v22.14.0}

case "$(uname -s)" in
  Linux) OS_NAME="linux" ;;
  Darwin) OS_NAME="darwin" ;;
  *)
    echo "Unsupported OS for TripleAgent Node bootstrap: $(uname -s)" >&2
    exit 1
    ;;
esac

case "$(uname -m)" in
  x86_64|amd64) ARCH_NAME="x64" ;;
  aarch64|arm64) ARCH_NAME="arm64" ;;
  *)
    echo "Unsupported architecture for TripleAgent Node bootstrap: $(uname -m)" >&2
    exit 1
    ;;
esac

NODE_DIR="$ROOT_DIR/.tooling/node/$NODE_VERSION-$OS_NAME-$ARCH_NAME"
NODE_BIN="$NODE_DIR/bin/node"
ARCHIVE="node-$NODE_VERSION-$OS_NAME-$ARCH_NAME.tar.xz"
ARCHIVE_URL="https://nodejs.org/dist/$NODE_VERSION/$ARCHIVE"

if [ ! -x "$NODE_BIN" ]; then
  TMP_DIR="$ROOT_DIR/.tooling/tmp"
  TMP_ARCHIVE="$TMP_DIR/$ARCHIVE"
  mkdir -p "$TMP_DIR" "$NODE_DIR"
  if [ ! -f "$TMP_ARCHIVE" ]; then
    curl -fsSL "$ARCHIVE_URL" -o "$TMP_ARCHIVE"
  fi
  tar -xJf "$TMP_ARCHIVE" -C "$NODE_DIR" --strip-components=1
fi

printf '%s\n' "$NODE_BIN"
