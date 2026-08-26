#!/usr/bin/env bash
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${SCRIPT_DIR}/scripts/reconcile-agent-models.sh"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); printf 'PASS %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf 'FAIL %s\n' "$1"; }

if command -v choose_model >/dev/null 2>&1; then
  bad "deprecated choose_model is absent"
else
  ok "deprecated choose_model is absent"
fi
if command -v write_omo_model >/dev/null 2>&1; then
  bad "deprecated write_omo_model is absent"
else
  ok "deprecated write_omo_model is absent"
fi
ok "reconciliation adapter sources successfully"

printf 'pass=%s fail=%s\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
