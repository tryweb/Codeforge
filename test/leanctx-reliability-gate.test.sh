#!/usr/bin/env bash
set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
DRIVER="$ROOT/test/leanctx-reliability-gate.sh"
output=$($DRIVER --campaign 2>&1)
test "$?" -eq 0
test "$output" = 'campaign deferred: pass --execute-campaign to run the isolated 40-record campaign'

if $DRIVER --unknown >/dev/null 2>&1; then exit 1; fi
if $DRIVER --campaign --execute-campaign --out-dir relative >/dev/null 2>&1; then exit 1; fi

grep -q -- '--read-only' "$DRIVER"
grep -q -- '--network none' "$DRIVER"
grep -q -- '--cap-drop ALL' "$DRIVER"
grep -q -- '--security-opt no-new-privileges' "$DRIVER"
grep -q -- '-e HOME=/home/devuser' "$DRIVER"
grep -q 'lean-ctx config validate && lean-ctx config show' "$DRIVER"
grep -q 'run-meta.json' "$DRIVER"
grep -q 'losslessBefore' "$DRIVER"
grep -q 'losslessAfter' "$DRIVER"
grep -q 'comparisonBefore' "$DRIVER"
grep -q 'comparisonAfter' "$DRIVER"

$DRIVER --selfcheck >/dev/null 2>&1
grep -q 'containers_absent=true volumes_absent=true' "$ROOT/.omo/evidence/lean-ctx-reliability-gate/task-6/driver/selfcheck-cleanup-receipt.txt"

printf '%s\n' 'reliability-gate CLI mode tests passed'
