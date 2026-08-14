#!/usr/bin/env bash
set -uo pipefail

# ============================================================
# ai-admin Dashboard Integration Tests
# Usage: ./test/test-admin.sh [container_name]
# ============================================================

# Resolve the admin container: prefer the legacy name (matches dev setups),
# then fall back to the compose service label, which survives container_name
# overrides.
CONTAINER="${1:-ai-engkit-admin-dev}"
if [ "$CONTAINER" = "ai-engkit-admin-dev" ] && ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
  CONTAINER="$(docker ps --filter 'label=com.docker.compose.service=ai-admin' --filter 'status=running' --format '{{.Names}}' 2>/dev/null | head -n 1)"
fi
CONTAINER="${CONTAINER:-ai-engkit-admin-dev}"
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
  if [ "$expected" = "$actual" ]; then
    pass "$label"
  else
    fail "$label (expected='$expected', actual='$actual')"
  fi
}

assert_contains() {
  local label="$1" needle="$2" haystack="$3"
  if echo "$haystack" | grep -q "$needle"; then
    pass "$label"
  else
    fail "$label (expected to contain '$needle')"
  fi
}

# Get HTTP status code without -f (to capture 4xx/5xx codes)
get_code() {
  curl -s -o /dev/null -w "%{http_code}" "$1" 2>/dev/null || echo "000"
}

ADMIN_PORT="${ADMIN_PORT:-8080}"
# In DooD (Docker-out-of-Docker) mode, use the bridge gateway
if [ -n "${ADMIN_BASE_URL:-}" ]; then
  BASE="$ADMIN_BASE_URL"
elif [ -f /.dockerenv ] || grep -q docker /proc/1/cgroup 2>/dev/null; then
  GATEWAY=$(docker network inspect ai-engkit_default --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}' 2>/dev/null || echo "172.20.0.1")
  # Resolve published host port from container (DooD: gateway needs host port, not container port)
  PUBLISHED_PORT=$(docker port "$CONTAINER" 8080/tcp 2>/dev/null | head -1 | sed 's/.*://' || echo "$ADMIN_PORT")
  BASE="http://${GATEWAY}:${PUBLISHED_PORT}"
else
  BASE="http://localhost:${ADMIN_PORT}"
fi

echo "============================================"
echo " ai-admin Dashboard Test Suite"
echo " Container: $CONTAINER"
echo " URL: $BASE"
echo "============================================"
echo ""

# --------------------------------------------------
# 1. Container Status
# --------------------------------------------------
echo "--- Container Status ---"

STATUS=$(docker inspect "$CONTAINER" --format '{{.State.Status}}' 2>/dev/null || echo "not_found")
assert_eq "Admin container exists and running" "running" "$STATUS"

# --------------------------------------------------
# 2. Healthcheck (unauthenticated)
# --------------------------------------------------
echo ""
echo "--- Healthcheck ---"

HEALTH=$(curl -sf "${BASE}/healthz" 2>/dev/null || echo "{}")
HEALTH_STATUS=$(echo "$HEALTH" | jq -r '.status' 2>/dev/null || echo "")
assert_eq "GET /healthz returns 200 with status=ok" "ok" "$HEALTH_STATUS"

# --------------------------------------------------
# 3. Auth — setup flow
# --------------------------------------------------
echo ""
echo "--- Auth Setup ---"

# Verify setup page is accessible when ADMIN_PASSWORD not set
# First, check if admin container is running and serving requests
ADMIN_LOGS=$(timeout 5 docker logs "$CONTAINER" 2>/dev/null || echo "")
assert_contains "Admin container logs show server started" "development server" "$ADMIN_LOGS"

# --------------------------------------------------
# 4. OpenAPI spec
# --------------------------------------------------
echo ""
echo "--- OpenAPI Spec ---"

OPENAPI_CODE=$(get_code "${BASE}/api/openapi.json")
if [ "$OPENAPI_CODE" = "200" ] || [ "$OPENAPI_CODE" = "401" ]; then
  pass "GET /api/openapi.json returns $OPENAPI_CODE (auth-protected, endpoint exists)"
else
  fail "GET /api/openapi.json returned $OPENAPI_CODE (expected 200 or 401)"
fi

# --------------------------------------------------
# 5. Unauthenticated access returns 401
# --------------------------------------------------
echo ""
echo "--- Authentication Required ---"

for endpoint in "/api/status" "/api/env" "/api/versions" "/api/openchamber/settings"; do
  SC=$(get_code "${BASE}${endpoint}")
  if [ "$SC" = "401" ]; then
    pass "GET ${endpoint} without cookie returns 401"
  else
    fail "GET ${endpoint} returned ${SC} (expected 401)"
  fi
done

# --------------------------------------------------
# Summary
# --------------------------------------------------
echo ""
echo "============================================"
echo " Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}"
echo "============================================"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
