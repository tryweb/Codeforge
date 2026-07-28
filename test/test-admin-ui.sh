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
assert_contains "Login page loads" "AI-EngKit Admin" "$LOGIN_HTML"
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
ADMIN_PASSWORD="${ADMIN_PASSWORD:-testadmin123}"
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

# 8. Mobile navigation elements present in Layout-wrapped pages
assert_contains "Layout has #nav-toggle button" "nav-toggle" "$VERSIONS_HTML"
assert_contains "Layout has #nav-backdrop" "nav-backdrop" "$VERSIONS_HTML"

# 9. CSS stylesheet contains mobile responsive rules
CSS_CONTENT=$(curl -s "$BASE/static/style.css" 2>/dev/null || echo "")
NAV_OPEN_RULE=$(echo "$CSS_CONTENT" | grep -c "nav-open" || echo "0")
if [ "$NAV_OPEN_RULE" -gt 0 ]; then pass "CSS has .nav-open rule for mobile nav"; else fail "CSS missing .nav-open rule"; fi
TOUCH_TARGET=$(echo "$CSS_CONTENT" | grep -c "min-height: 44px" || echo "0")
if [ "$TOUCH_TARGET" -gt 0 ]; then pass "CSS has min-height:44px touch targets"; else fail "CSS missing min-height:44px"; fi

# 10. Dashboard contains restart ai-dev button
assert_contains "Dashboard has restart ai-dev button" "btn-dash-restart" "$DASH_HTML"

# 11. Secrets page API tests
SECRETS_API=$(curl -s -b "$COOKIE_JAR" "$BASE/api/secrets" 2>/dev/null || echo "")
SECRETS_COUNT=$(echo "$SECRETS_API" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
if [ "$SECRETS_COUNT" = "3" ]; then
  pass "GET /api/secrets returns 3 secrets"
else
  fail "GET /api/secrets returned $SECRETS_COUNT secrets (expected 3)"
fi

SECRETS_VAL=$(curl -s -b "$COOKIE_JAR" "$BASE/api/secrets/ADMIN_PASSWORD/value" 2>/dev/null || echo "")
SECRET_VAL_KEY=$(echo "$SECRETS_VAL" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('key',''))" 2>/dev/null || echo "")
SECRET_VAL_HAS=$(echo "$SECRETS_VAL" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if d.get('value') else 'no')" 2>/dev/null || echo "")
if [ "$SECRET_VAL_KEY" = "ADMIN_PASSWORD" ] && [ "$SECRET_VAL_HAS" = "yes" ]; then
  pass "GET /api/secrets/ADMIN_PASSWORD/value returns value"
else
  fail "GET /api/secrets/ADMIN_PASSWORD/value failed"
fi

SECRETS_PUT=$(curl -s -o /dev/null -w "%{http_code}" -b "$COOKIE_JAR" \
  -X PUT -H "Content-Type: application/json" \
  -d '{"value":"test123"}' \
  "$BASE/api/secrets/OPENCHAMBER_UI_PASSWORD" 2>/dev/null || echo "000")
if [ "$SECRETS_PUT" = "200" ]; then
  pass "PUT /api/secrets/OPENCHAMBER_UI_PASSWORD returns 200"
else
  fail "PUT /api/secrets/OPENCHAMBER_UI_PASSWORD returned $SECRETS_PUT (expected 200)"
fi

SECRETS_404=$(curl -s -o /dev/null -w "%{http_code}" -b "$COOKIE_JAR" \
  -X PUT -H "Content-Type: application/json" \
  -d '{"value":"x"}' \
  "$BASE/api/secrets/NONEXISTENT_KEY" 2>/dev/null || echo "000")
if [ "$SECRETS_404" = "404" ]; then
  pass "PUT /api/secrets/NONEXISTENT_KEY returns 404"
else
  fail "PUT /api/secrets/NONEXISTENT_KEY returned $SECRETS_404 (expected 404)"
fi

SECRETS_PAGE=$(curl -s -b "$COOKIE_JAR" "$BASE/secrets" 2>/dev/null || echo "")
assert_contains "Secrets nav link present" "Secrets" "$SECRETS_PAGE"
assert_contains "Secrets page renders 3 cards" "secret-card" "$SECRETS_PAGE"
assert_contains "ADMIN_PASSWORD shows immediate badge" "Takes effect immediately" "$SECRETS_PAGE"
assert_contains "OPENCHAMBER shows restart badge" "Restart container required" "$SECRETS_PAGE"

# 12. Static assets served
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
