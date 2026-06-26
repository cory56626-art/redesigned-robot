#!/usr/bin/env bash
# Build RealisticDeferred.mcpack from the pack source.
# The archive must contain manifest.json at its ROOT (not inside a subfolder).
set -euo pipefail
cd "$(dirname "$0")"
SRC="RealisticDeferred"
OUT="dist/RealisticDeferred.mcpack"
mkdir -p dist
rm -f "$OUT"
( cd "$SRC" && zip -r -X "../$OUT" . -x '.*' )
echo "Built $OUT"
