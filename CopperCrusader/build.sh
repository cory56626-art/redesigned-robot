#!/usr/bin/env bash
# Build CopperCrusader.mcaddon from the two pack folders.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

python3 CopperCrusader/tools/gen_textures.py

rm -rf build && mkdir -p build/pkg
cp -r CopperCrusader/behavior_pack "build/pkg/Copper Crusader BP"
cp -r CopperCrusader/resource_pack "build/pkg/Copper Crusader RP"

( cd build/pkg && zip -rq -X "../CopperCrusader.mcaddon" "Copper Crusader BP" "Copper Crusader RP" )
rm -rf build/pkg
echo "Built build/CopperCrusader.mcaddon"
