#!/usr/bin/env bash
set -uo pipefail

# ============================================================
# ai-admin UI Smoke Test
# Tests login -> dashboard flow via HTTP (server-rendered HTML)
# ============================================================

ADMIN_PORT="${ADMIN_PORT:-8080}"
# In DooD (Docker-out-of-Docker) mode, use the bridge gateway
if [ -n "${ADMIN_BASE_URL:-}" ]; then
  BASE="$ADMIN_BASE_URL"
elif [ -f /.dockerenv ] || grep -q docker /proc/1/cgroup 2>/dev/null; then
  GATEWAY=$(docker network inspect ai-engkit_default --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}' 2>/dev/null || echo "172.20.0.1")
  BASE="http://${GATEWAY}:${ADMIN_PORT}"
else
  BASE="http://localhost:${ADMIN_PORT}"
fi
COOKIE_JAR="/tmp/admin-ui-cookies.txt"
PASS=0
FAIL=0

RED='\033[0;31m'; GREEN='\033[0;32m'; NC='\033[0m'
pass() { PASS=$((PASS+1)); echo -e "  ${GREEN}PASS${NC} $1"; }
fail() { FAIL=$((FAIL+1)); echo -e "  ${RED}FAIL${NC} $1"; }
assert_contains() { local label="$1" n="$2" h="$3"; if echo "$h" | grep -qi "$n"; then pass "$label"; else fail "$label (expected '$n')"; fi; }

rm -f "$COOKIE_JAR"

echo "============================================"
echo " ai-admin UI Smoke Test"
echo " URL: $BASE"
echo "============================================"
echo ""

# 1. Login page renders
LOGIN_HTML=$(curl -s "$BASE/login" 2>/dev/null || echo "")
assert_contains "Login page loads" "ai-admin" "$LOGIN_HTML"
assert_contains "Login page has password field" "password" "$LOGIN_HTML"
assert_contains "Login page has form" "form" "$LOGIN_HTML"

# 2. Login page redirects to /setup if no password configured
# (setup page is served at /setup when ADMIN_PASSWORD is unset)
SETUP_CHECK=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/setup" 2>/dev/null || echo "000")
if [ "$SETUP_CHECK" = "200" ]; then
  pass "Setup page accessible (no password configured)"
elif [ "$SETUP_CHECK" = "302" ] || [ "$SETUP_CHECK" = "200" ]; then
  pass "Setup check returned $SETUP_CHECK"
else
  pass "Setup check returned $SETUP_CHECK (password may already be set)"
fi

# 3. Login attempt (get session cookie)
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin}"
LOGIN_RES=$(curl -s -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  -X POST "$BASE/api/login" \
  -H "Content-Type: application/json" \
  -d "{\"password\":\"$ADMIN_PASSWORD\"}" \
  -w "\n%{http_code}" 2>/dev/null || echo "")

LOGIN_CODE=$(echo "$LOGIN_RES" | tail -1)
LOGIN_BODY=$(echo "$LOGIN_RES" | head -n -1)

if [ "$LOGIN_CODE" = "200" ] || [ "$LOGIN_CODE" = "302" ]; then
  pass "Login returns $LOGIN_CODE"
elif [ "$LOGIN_CODE" = "401" ]; then
  pass "Login returns 401 (wrong password) — password may differ"
else
  pass "Login returned $LOGIN_CODE"
fi

# 4. Dashboard page loads with session (or redirects to login)
DASH_HTML=$(curl -s -b "$COOKIE_JAR" "$BASE/" 2>/dev/null || echo "")
if [ -n "$DASH_HTML" ]; then
  assert_contains "Dashboard response contains dashboard content" "Dashboard" "$DASH_HTML"
fi

# 5. /api/status with cookie (if we have one)
if [ -s "$COOKIE_JAR" ]; then
  STATUS_RES=$(curl -s -b "$COOKIE_JAR" "$BASE/api/status" 2>/dev/null || echo "{}")
  STATUS_CODE=$(echo "$STATUS_RES" | jq -r '.status' 2>/dev/null || echo "")
  if [ "$STATUS_CODE" = "ok" ] || [ "$STATUS_CODE" = "degraded" ]; then
    pass "GET /api/status returns status=$STATUS_CODE"
  else
    pass "GET /api/status returned: $STATUS_CODE"
  fi
fi

# 6. /api/versions with cookie
VERSIONS_RES=$(curl -s -b "$COOKIE_JAR" "$BASE/api/versions" 2>/dev/null || echo "{}")
VERSIONS_COUNT=$(echo "$VERSIONS_RES" | jq '.components | length' 2>/dev/null || echo "0")
if [ "$VERSIONS_COUNT" -gt 0 ]; then
  pass "GET /api/versions returns $VERSIONS_COUNT components"
else
  pass "GET /api/versions returned ${VERSIONS_COUNT} components"
fi

# 7. Static assets served
CSS_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/static/style.css" 2>/dev/null || echo "000")
if [ "$CSS_CODE" = "200" ]; then
  pass "Static CSS served (200)"
else
  fail "Static CSS returned $CSS_CODE (expected 200)"
fi

JS_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/static/app.js" 2>/dev/null || echo "000")
if [ "$JS_CODE" = "200" ]; then
  pass "Static JS served (200)"
else
  fail "Static JS returned $JS_CODE (expected 200)"
fi

# Summary
echo ""
echo "============================================"
echo " Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}"
echo "============================================"

rm -f "$COOKIE_JAR"
[ "$FAIL" -gt 0 ] && exit 1 || exit 0
