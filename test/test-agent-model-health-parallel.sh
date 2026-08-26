#!/usr/bin/env bash
# Concurrent health_record write test: 10 parallel writers, all records must
# survive. Guards the flock protection in health_record (reconcile verifies
# agents in parallel subshells, each writing to the shared health file).
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${SCRIPT_DIR}/scripts/agent-model-health.sh"
export AGENT_MODEL_HEALTH_FILE="$(mktemp)"
rm -f "${AGENT_MODEL_HEALTH_FILE}.lock"

pids=()
for i in $(seq 1 10); do
  (
    health_record "provider/model-$i" healthy "verified parallel"
  ) &
  pids+=("$!")
done
for pid in "${pids[@]}"; do
  wait "$pid" 2>/dev/null
done

count="$(jq 'length' "$AGENT_MODEL_HEALTH_FILE" 2>/dev/null || echo 0)"
echo "RECORD_COUNT=$count"
[ "$count" -eq 10 ] && echo "PARALLEL_HEALTH_OK" || echo "PARALLEL_HEALTH_FAIL"

rotation_auth_file="$(mktemp)"
trap 'rm -f "$AGENT_MODEL_HEALTH_FILE" "$AGENT_MODEL_HEALTH_FILE.lock" "$rotation_auth_file"' EXIT
jq -n '{"provider-a":{"key":"initial-a"},"provider-b":{"key":"initial-b"}}' > "$rotation_auth_file"
export AGENT_MODEL_AUTH_FILE="$rotation_auth_file"
health_record "provider-a/model-a" healthy "provider-a baseline"
health_record "provider-b/model-b" healthy "provider-b baseline"
jq '."provider-a".key = "changed-a"' "$rotation_auth_file" > "${rotation_auth_file}.tmp"
mv "${rotation_auth_file}.tmp" "$rotation_auth_file"

rotation_fail=0
if [ -n "$(health_status "provider-a/model-a")" ]; then
  echo "ROTATION_PROVIDER_A_FAIL"
  rotation_fail=1
else
  echo "ROTATION_PROVIDER_A_MISS_OK"
fi
if [ "$(health_status "provider-b/model-b")" = healthy ]; then
  echo "ROTATION_PROVIDER_B_HIT_OK"
else
  echo "ROTATION_PROVIDER_B_FAIL"
  rotation_fail=1
fi
if [ "$rotation_fail" -eq 0 ]; then
  echo "ROTATION_HEALTH_OK"
else
  echo "ROTATION_HEALTH_FAIL"
  exit 1
fi
