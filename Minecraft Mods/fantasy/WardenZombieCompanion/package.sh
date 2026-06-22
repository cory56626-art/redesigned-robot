#!/usr/bin/env bash
# Build an importable .mcaddon (a zip of the behavior + resource packs).
# Usage:  ./package.sh
set -euo pipefail

cd "$(dirname "$0")"
OUT="WardenZombieCompanion.mcaddon"

rm -f "$OUT"

# A .mcaddon is just a zip containing the pack folders (each with its manifest).
zip -r -q "$OUT" behavior_pack resource_pack \
  -x '*.DS_Store' -x '__MACOSX*'

echo "Built $OUT"
unzip -l "$OUT" | tail -n +2 | head -n 40
