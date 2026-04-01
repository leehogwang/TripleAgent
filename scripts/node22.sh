#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
NODE_BIN=$("$ROOT_DIR/scripts/ensure-node22.sh")

exec "$NODE_BIN" "$@"
