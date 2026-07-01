#!/usr/bin/env bash
# Rebuild Oathbreaker_Titan.mcaddon from the pack folders.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -f Oathbreaker_Titan.mcaddon
zip -r -X Oathbreaker_Titan.mcaddon OathbreakerTitan_BP OathbreakerTitan_RP -x '*.DS_Store'
echo "built $(pwd)/Oathbreaker_Titan.mcaddon"
