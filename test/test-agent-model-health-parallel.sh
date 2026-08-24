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
rm -f "$AGENT_MODEL_HEALTH_FILE" "$AGENT_MODEL_HEALTH_FILE.lock"