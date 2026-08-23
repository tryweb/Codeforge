#!/usr/bin/env bash
# Unit tests for scripts/reconcile-agent-models.sh pure functions.
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

# 2. choose_model prefers the policy candidate that exists in the connected set.
assert_eq "choose_model picks preferred connected model" \
  "opencode/big-pickle" "$(choose_model explore "$available")"

# 3. choose_model skips candidates absent from the connected set and falls back.
assert_eq "choose_model skips disconnected candidate" \
  "opencode/hy3-free" "$(choose_model librarian "opencode/hy3-free")"

# 4. needs_update: unset, empty-resolved ("/"), or disconnected current all need updates.
assert_eq "needs_update when unset"        "1" "$(needs_update ""       "$available")"
assert_eq "needs_update when empty slash"  "1" "$(needs_update "/"      "$available")"
assert_eq "needs_update when disconnected" "1" "$(needs_update 'openai/gpt-5.6-luna-fast' "$available")"
assert_eq "no update when valid+connected" "0" "$(needs_update 'opencode/big-pickle' "$available")"

# 5. Every managed agent has a non-empty policy candidate list.
missing=""
for agent in "${AGENTS[@]}"; do
  [ -n "$(policy_candidates "$agent")" ] || missing="$missing $agent"
done
assert_eq "policy candidates defined for all agents" "" "$missing"

rm -f "$FIXTURE"
echo "pass=$PASS fail=$FAIL"
[ "$FAIL" -eq 0 ]
