#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${SCRIPT_DIR}/scripts/reconcile-agent-models.sh"

assert_eq() {
  local name="$1" expected="$2" actual="$3"
  if [[ "$expected" != "$actual" ]]; then
    printf 'FAIL %s: expected %s, got %s\n' "$name" "$expected" "$actual" >&2
    exit 1
  fi
  printf 'PASS %s\n' "$name"
}

MODEL_CATALOG_FILE="$(mktemp)"
trap 'rm -f "$MODEL_CATALOG_FILE"' EXIT
cat >"$MODEL_CATALOG_FILE" <<'JSON'
{"all":[{"id":"opencode","models":{
  "reasoning-model":{"capabilities":{"reasoning":true,"toolcall":true,"input":{"text":true}}},
  "fast-model":{"capabilities":{"reasoning":false,"toolcall":true,"attachment":true}},
  "basic-model":{"capabilities":{"reasoning":false,"toolcall":false}}
}}]}
JSON

available=$'opencode/reasoning-model\nopencode/fast-model\nopencode/basic-model'
assert_eq "reasoning policy" \
  "opencode/reasoning-model" "$(choose_model oracle "$available")"
assert_eq "exploration policy" \
  "opencode/fast-model" "$(choose_model explore "$available")"
assert_eq "general policy" \
  "opencode/fast-model" "$(choose_model general "$available")"

MODEL_CATALOG_FILE=""
assert_eq "unknown agent deterministic fallback" \
  "opencode/basic-model" "$(choose_model unknown-agent "$available")"

RECONCILE_ENFORCE_POLICY=1
assert_eq "legacy global fallback is replaced" \
  "1" "$(needs_update opencode/big-pickle "$available")"

printf 'PASS dynamic per-agent model policy\n'
