#!/usr/bin/env bash
# Rebuild BrawlStick.mcaddon from the pack folders.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -f BrawlStick.mcaddon
zip -r -X BrawlStick.mcaddon BrawlStick_BP BrawlStick_RP -x '*.DS_Store'
echo "built $(pwd)/BrawlStick.mcaddon"
