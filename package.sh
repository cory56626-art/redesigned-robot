#!/usr/bin/env bash
# Build The_Marauder.mcaddon from the BP/ and RP/ source folders.
# Each inner .mcpack must have manifest.json at its root, so we zip from
# inside each pack folder rather than zipping the folder itself.
set -euo pipefail
cd "$(dirname "$0")"

OUT=The_Marauder.mcaddon
BP_PACK=Marauder_BP.mcpack
RP_PACK=Marauder_RP.mcpack

rm -f "$OUT" "$BP_PACK" "$RP_PACK"

(cd BP && zip -r -q "../$BP_PACK" . -x '*.DS_Store')
(cd RP && zip -r -q "../$RP_PACK" . -x '*.DS_Store')
zip -q "$OUT" "$BP_PACK" "$RP_PACK"
rm -f "$BP_PACK" "$RP_PACK"

echo "Built $OUT:"
unzip -l "$OUT"
