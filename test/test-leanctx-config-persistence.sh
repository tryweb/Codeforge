#!/usr/bin/env bash
set -euo pipefail

compose_file="${COMPOSE_FILE:-docker-compose.dev.yml}"
container="${LEANCTX_CONTAINER:-ai-engkit-dev}"
config_path="/home/devuser/.config/lean-ctx/config.toml"
backup_path="$(mktemp)"

wait_for_config() {
  for _ in {1..30}; do
    if docker exec "$container" test -f "$config_path"; then return 0; fi
    sleep 1
  done
  return 1
}

cleanup() {
  if wait_for_config; then
    docker exec "$container" sh -c "cat '$config_path'" > "$backup_path"
    docker exec "$container" sh -c "cat > '$config_path'" < "$backup_path"
    docker compose -p dev -f "$compose_file" restart ai-dev >/dev/null
  fi
  rm -f "$backup_path"
}
trap cleanup EXIT

docker exec "$container" lean-ctx config set compression_level max >/dev/null
docker compose -p dev -f "$compose_file" restart ai-dev >/dev/null
wait_for_config
test "$(docker exec "$container" awk '/compression_level/{print; exit}' "$config_path")" = 'compression_level = "max"'

docker compose -p dev -f "$compose_file" up -d --force-recreate ai-dev >/dev/null
wait_for_config
test "$(docker exec "$container" awk '/compression_level/{print; exit}' "$config_path")" = 'compression_level = "max"'
printf 'lean-ctx persistence: PASS\n'
