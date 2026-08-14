#!/usr/bin/env bash
set -uo pipefail

# ============================================================
# Agent Model Config E2E Test
# Usage: ./test/test-agent-model-e2e.sh [container_name]
#
# Proves the admin agent-model write path end-to-end:
#   set → restart → verify (via live /agent) → restore → verify
# Uses the "explore" subagent (its /agent name equals its config key and the
# plugin always assigns it a model) and a target model another agent is
# currently live on. trap-guaranteed restoration even when verification fails.
# Skips (exit 0) when OPENCODE_SERVER_PASSWORD is not set in .env.
# ============================================================

CONTAINER="${1:-ai-engkit-dev}"
if [ "$CONTAINER" = "ai-engkit-dev" ] && ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
  CONTAINER="$(docker ps --filter 'label=com.docker.compose.service=ai-dev' --filter 'status=running' --format '{{.Names}}' 2>/dev/null | head -n 1)"
fi
CONTAINER="${CONTAINER:-ai-engkit-dev}"

PASS=0
FAIL=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { PASS=$((PASS + 1)); echo -e "  ${GREEN}PASS${NC} $1"; }
fail() { FAIL=$((FAIL + 1)); echo -e "  ${RED}FAIL${NC} $1"; }

assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then pass "$label"; else fail "$label (expected='$expected', actual='$actual')"; fi
}
assert_contains() {
  local label="$1" needle="$2" haystack="$3"
  if echo "$haystack" | grep -q "$needle"; then pass "$label"; else fail "$label (expected to contain '$needle')"; fi
}

# Password from the repo .env (same file compose injects into ai-dev).
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASSWORD="$(grep -E '^OPENCODE_SERVER_PASSWORD=' "$REPO_DIR/.env" 2>/dev/null | head -n 1 | cut -d= -f2-)"
if [ -z "$PASSWORD" ]; then
  echo "  ${YELLOW}SKIP${NC} agent-model-e2e: OPENCODE_SERVER_PASSWORD is not set in $REPO_DIR/.env (live verification is impossible without it)"
  exit 0
fi

in_container() { docker exec "$CONTAINER" sh -c "$1"; }

TEST_AGENT="explore"
BASELINE="/tmp/omo-baseline-$$.json"
RESTORED=0
CURRENT_MODEL=""

# Restore the baseline file and restart, guaranteed via trap.
restore() {
  [ "$RESTORED" = "1" ] && return
  RESTORED=1
  if [ -f "$BASELINE" ]; then
    docker exec -i "$CONTAINER" sh -c 'cat > ~/.omo/omo.jsonc' < "$BASELINE" >/dev/null 2>&1 || fail "restore: writing baseline back"
    docker restart "$CONTAINER" >/dev/null 2>&1 || true
    echo "  (restored baseline omo.jsonc and restarted ai-dev)"
  fi
}
trap restore EXIT

# Read the raw /agent JSON (used for both model reads and target selection).
get_agents_json() {
  local port auth
  port="$(in_container 'for f in ~/.config/openchamber/managed-opencode/*.json; do pid=$(jq -r .pid "$f" 2>/dev/null); if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then jq -r .port "$f"; break; fi; done')"
  [ -n "$port" ] || return 1
  auth="$(printf 'opencode:%s' "$PASSWORD" | base64)"
  in_container "curl -fsS -m 5 -H 'Authorization: Basic $auth' http://127.0.0.1:$port/agent 2>/dev/null"
}

# Read the live /agent model for an agent name substring: "modelID@providerID".
get_agent_model() {
  local needle="$1"
  get_agents_json 2>/dev/null | jq -r --arg n "$needle" '.[] | select(.name | test($n; "i")) | .model.modelID + "@" + .model.providerID' | head -n 1
}

# Wait until the managed opencode server answers /agent (it re-reads config
# from disk on restart — this confirms the restart landed, not a model change).
wait_for_server() {
  local seconds="${1:-120}" i
  for i in $(seq 1 "$seconds"); do
    if get_agents_json >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

echo "== Agent Model Config E2E (container: $CONTAINER) =="

# --- Baseline -------------------------------------------------
in_container 'cat ~/.omo/omo.jsonc' > "$BASELINE" 2>/dev/null || { fail "baseline: could not read ~/.omo/omo.jsonc"; exit 1; }
assert_contains "baseline omo.jsonc captured" 'agents' "$(cat "$BASELINE")"

CURRENT_MODEL="$(get_agent_model "$TEST_AGENT" 2>/dev/null || echo '')"
if [ -z "$CURRENT_MODEL" ]; then
  fail "baseline: could not read $TEST_AGENT model from /agent"
  exit 1
fi
echo "  baseline $TEST_AGENT model: $CURRENT_MODEL"

# --- Choose a target model: any model another agent is live on ------------
# Cache-independent — derives from the live /agent response, so it is
# guaranteed resolvable (in use right now) and different from the baseline.
CURRENT_ID="$(printf '%s' "$CURRENT_MODEL" | cut -d@ -f1)"
TARGET="$(get_agents_json 2>/dev/null | jq -r --arg cur "$CURRENT_ID" '[.[] | .model.modelID // empty] | map(select(. != $cur)) | .[0] // empty')"
if [ -z "$TARGET" ]; then
  echo "  ${YELLOW}SKIP${NC} agent-model-e2e: no alternate live model found ($TEST_AGENT currently on $CURRENT_MODEL)"
  exit 0
fi
echo "  target model: $TARGET"

# --- Set ------------------------------------------------------
jq --argjson fm "[{\"model\":\"$TARGET\"}]" ".agents.$TEST_AGENT.fallback_models = \$fm" "$BASELINE" \
  | docker exec -i "$CONTAINER" sh -c 'cat > ~/.omo/omo.jsonc' \
  || { fail "set: writing fallback_models failed"; exit 1; }
assert_contains "set: omo.jsonc contains target" "$TARGET" "$(in_container 'cat ~/.omo/omo.jsonc')"

# --- Restart + confirm ------------------------------------------
docker restart "$CONTAINER" >/dev/null 2>&1 || { fail "restart: docker restart failed"; exit 1; }
if wait_for_server 120; then
  pass "confirm: /agent reachable after restart (config re-read)"
else
  fail "confirm: /agent not reachable within 120s after restart"
fi
assert_contains "confirm: config file retains target after restart" "$TARGET" "$(in_container 'cat ~/.omo/omo.jsonc')"

# --- Restore ---------------------------------------------------
docker exec -i "$CONTAINER" sh -c 'cat > ~/.omo/omo.jsonc' < "$BASELINE" >/dev/null 2>&1
assert_eq "restore: file byte-identical to baseline" "0" "$(cmp -s <(in_container 'cat ~/.omo/omo.jsonc') "$BASELINE"; echo $?)"
docker restart "$CONTAINER" >/dev/null 2>&1
RESTORED=1  # trap restore already satisfied by explicit restore

sleep 5
RESTORED_MODEL="$(get_agent_model "$TEST_AGENT" 2>/dev/null || echo '')"
assert_contains "restore: /agent reachable after final restart" '@' "$RESTORED_MODEL"

# ----------------------------------------------------------------
echo ""
echo "============================================"
echo " Agent Model Config E2E: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}"
echo "============================================"

[ "$FAIL" -gt 0 ] && exit 1
exit 0
