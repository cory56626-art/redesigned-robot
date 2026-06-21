#!/usr/bin/env bash
# Rebuild HarderSurvival.mcaddon from the source pack folder.
set -euo pipefail
cd "$(dirname "$0")"
rm -f HarderSurvival.mcaddon
( cd src && zip -r -X ../HarderSurvival.mcaddon HarderSurvival_BP -x '*.DS_Store' )
echo "Built HarderSurvival.mcaddon"
