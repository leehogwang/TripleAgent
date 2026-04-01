#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
NODE_BIN=$("$ROOT_DIR/scripts/ensure-node22.sh")
NODE_DIR=$(CDPATH= cd -- "$(dirname "$NODE_BIN")/.." && pwd)

exec "$NODE_BIN" "$NODE_DIR/lib/node_modules/npm/bin/npm-cli.js" "$@"
