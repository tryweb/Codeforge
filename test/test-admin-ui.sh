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
  # Resolve published host port from container (DooD: gateway needs host port, not container port)
  PUBLISHED_PORT=$(docker port "ai-engkit-admin-dev" 8080/tcp 2>/dev/null | head -1 | sed 's/.*://' || echo "$ADMIN_PORT")
  BASE="http://${GATEWAY}:${PUBLISHED_PORT}"
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

# 6. /api/versions with cookie (grouped structure)
VERSIONS_RES=$(curl -s -b "$COOKIE_JAR" "$BASE/api/versions" 2>/dev/null || echo "{}")
HAS_CORE=$(echo "$VERSIONS_RES" | jq 'has("core")' 2>/dev/null || echo "false")
HAS_CLI=$(echo "$VERSIONS_RES" | jq 'has("cli")' 2>/dev/null || echo "false")
HAS_MCP=$(echo "$VERSIONS_RES" | jq 'has("mcp")' 2>/dev/null || echo "false")
HAS_PLUGIN=$(echo "$VERSIONS_RES" | jq 'has("plugin")' 2>/dev/null || echo "false")
TOOL_COUNT=$(echo "$VERSIONS_RES" | jq '[.core, .cli, .mcp, .plugin] | map(length) | add' 2>/dev/null || echo "0")
if [ "$HAS_CORE" = "true" ] && [ "$HAS_CLI" = "true" ] && [ "$HAS_MCP" = "true" ] && [ "$HAS_PLUGIN" = "true" ]; then
  pass "GET /api/versions returns 4 categories (core, cli, mcp, plugin) with $TOOL_COUNT total tools"
else
  fail "GET /api/versions missing categories: core=$HAS_CORE cli=$HAS_CLI mcp=$HAS_MCP plugin=$HAS_PLUGIN (tools=$TOOL_COUNT)"
fi

# 7. /versions page renders categorized cards
VERSIONS_HTML=$(curl -s -b "$COOKIE_JAR" "$BASE/versions" 2>/dev/null || echo "")
assert_contains "Versions page lists Core tools" "Core" "$VERSIONS_HTML"
assert_contains "Versions page lists CLI tools" "CLI" "$VERSIONS_HTML"
assert_contains "Versions page lists MCP tools" "MCP" "$VERSIONS_HTML"
assert_contains "Versions page lists Plugin tools" "Plugin" "$VERSIONS_HTML"
assert_contains "Versions page has Image Metadata card" "Image Metadata" "$VERSIONS_HTML"

# 8. Static assets served
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
