#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Full Integration Test: Build -> Start -> Test -> Cleanup
# Usage: ./test/test-full.sh
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CONTAINER="${CONTAINER_NAME:-ai-engkit-dev}"
if [ "$CONTAINER" = "ai-engkit-dev" ] && ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
  CONTAINER="$(docker ps --filter 'label=com.docker.compose.project=dev' --filter 'label=com.docker.compose.service=ai-dev' --filter 'status=running' --format '{{.Names}}' 2>/dev/null | head -n 1)"
fi
CONTAINER="${CONTAINER:-ai-engkit-dev}"
CHAMBER_DEV_PORT="${CHAMBER_DEV_PORT:-8001}"
export CHAMBER_DEV_PORT

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=== Step 1: Cleanup ===${NC}"
cd "$PROJECT_DIR"
docker compose -p dev -f docker-compose.dev.yml down --remove-orphans 2>/dev/null || true
docker compose -p dev -f docker-compose.dev.yml down -v --remove-orphans 2>/dev/null || true
sleep 2

echo -e "${GREEN}=== Step 2: Build ===${NC}"
docker compose -p dev -f docker-compose.dev.yml build --no-cache
echo -e "${GREEN}Build complete${NC}"

echo -e "${GREEN}=== Step 3: Start ===${NC}"
docker compose -p dev -f docker-compose.dev.yml up -d
echo "Waiting for services to stabilize..."
sleep 20

echo -e "${GREEN}=== Step 4: Run Tests ===${NC}"
bash "$SCRIPT_DIR/run-tests.sh" "$CONTAINER"
TEST_EXIT=$?

echo ""
if [ $TEST_EXIT -eq 0 ]; then
  echo -e "${GREEN}All tests passed!${NC}"
else
  echo -e "${RED}Some tests failed!${NC}"
fi

echo ""
echo -e "${YELLOW}=== Step 5: Cleanup ===${NC}"
docker compose -p dev -f docker-compose.dev.yml down --remove-orphans 2>/dev/null || true
echo -e "${YELLOW}Services stopped${NC}"

exit $TEST_EXIT
