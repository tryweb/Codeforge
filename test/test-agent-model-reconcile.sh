#!/usr/bin/env bash
# Run: bash test/test-agent-model-reconcile.sh
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/reconcile-agent-models.sh
source "${SCRIPT_DIR}/scripts/reconcile-agent-models.sh"

PASS=0
FAIL=0
ok()   { PASS=$((PASS + 1)); echo "PASS $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "FAIL $1"; }
assert_eq() { # assert_eq <name> <expected> <actual>
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected [$2] got [$3])"; fi
}

# Fixture: openai is in the catalog but NOT connected; opencode is connected.
FIXTURE="$(mktemp)"
cat >"$FIXTURE" <<'JSON'
{
  "all": [
    {"id": "openai", "models": {"gpt-5.6-luna-fast": {}, "gpt-5.6-sol": {}}},
    {"id": "opencode", "models": {"big-pickle": {}, "x-preview-f-free": {}, "hy3-free": {}}}
  ],
  "connected": ["opencode"]
}
JSON

# 1. Catalog must contain ONLY models from connected providers.
catalog_out="$(catalog_from_provider_json "$FIXTURE" | sort)"
expected_catalog="$(printf '%s\n' 'opencode/big-pickle' 'opencode/hy3-free' 'opencode/x-preview-f-free')"
assert_eq "connected-only catalog" "$expected_catalog" "$catalog_out"

available="$catalog_out"

for function_name in choose_model write_omo_model verify_runtime restart_managed_server; do
  if grep -q "^${function_name}()" "${SCRIPT_DIR}/scripts/reconcile-agent-models.sh"; then
    bad "removed ${function_name} definition"
  else
    ok "removed ${function_name} definition"
  fi
done

unset OPENCODE_SERVER_PASSWORD
skip_log="$(reconcile 2>&1)"
assert_eq "unset password skips reconciliation" \
  "0" "$?"
if [[ "$skip_log" == *"OPENCODE_SERVER_PASSWORD is not set; skipping startup reconciliation"* ]]; then
  ok "unset password logs skip"
else
  bad "unset password logs skip"
fi

if grep -q 'bun run /opt/admin/lib/agent-model-reconcile-cli.ts' \
  "${SCRIPT_DIR}/scripts/reconcile-agent-models.sh"; then
  ok "adapter references reconciler CLI"
else
  bad "adapter references reconciler CLI"
fi

rm -f "$FIXTURE"
echo "pass=$PASS fail=$FAIL"
[ "$FAIL" -eq 0 ]
