# Parallelize Slow Per-Item Verification Loops in Shell

## Context

`scripts/reconcile-agent-models.sh` verified each of 9 subagents sequentially by
sending a live OpenCode message (45s curl timeout each). Worst case ~405s; even
successful runs took minutes. The host has `nproc`=16 and `flock` is available
(`/usr/bin/flock` on the image).

## Problem

Sequential per-item curl loops are the dominant reconcile cost. Naively backgrounding
the work breaks two things:

1. `verify_runtime` sets the global `VERIFY_FAILED=1` on failure — a subshell
   assignment never propagates to the parent, so the rollback decision would be lost.
2. Each `health_record` does a read-modify-write on a **shared** health JSON file —
   parallel writers race and overwrite each other's records.

## Solution

Run each item in a background subshell writing its result to a per-item file, wait
for all PIDs, then aggregate in the parent:

```bash
verify_tmp="$(mktemp -d "${TMPDIR:-/tmp}/agent-model-verify.XXXXXX")" || verify_tmp="${TMPDIR:-/tmp}/agent-model-verify.$$"
verify_pids=()
for agent in "${AGENTS[@]}"; do
  ( if verify_runtime "$endpoint" "$agent" "${targets[$agent]}"; then
      printf 'ok\n' > "$verify_tmp/$agent"
    else
      printf 'fail\n' > "$verify_tmp/$agent"
    fi ) &
  verify_pids+=("$!")
done
for pid in "${verify_pids[@]}"; do wait "$pid" 2>/dev/null || true; done
for agent in "${AGENTS[@]}"; do
  [ -f "$verify_tmp/$agent" ] || continue
  if [ "$(cat "$verify_tmp/$agent")" = ok ]; then
    log "${agent}: runtime verified (${targets[$agent]})"
  else
    VERIFY_FAILED=1
    log "WARNING: ${agent} /agent does not report ${targets[$agent]} yet"
  fi
done
rm -rf "$verify_tmp"
```

Protect the shared file with flock and unique temp names (`$$` is identical across
subshells — use `$BASHPID` + `$RANDOM`):

```bash
tmp="${AGENT_MODEL_HEALTH_FILE}.tmp.${BASHPID:-$$}.$RANDOM"
(
  flock 9
  # read-modify-write via jq into "$tmp"
  mv "$tmp" "$AGENT_MODEL_HEALTH_FILE" 2>/dev/null || rm -f "$tmp"
) 9>"${AGENT_MODEL_HEALTH_FILE}.lock"
```

Bound each attempt (`AGENT_MODELS_VERIFY_TIMEOUT`, default 20s) and retry
(`AGENT_MODELS_VERIFY_RETRIES`, default 2) — the first message after a
managed-server restart can hit a cold-provider timeout.

## Why It Works

- Background jobs run concurrently; total wall time ≈ slowest item, not the sum.
- Result files carry state out of the subshells, so `VERIFY_FAILED` is set in the
  parent where the rollback decision is made.
- `flock` serializes the read-modify-write on the health file; `${BASHPID}.$RANDOM`
  guarantees unique temp files per concurrent writer.

## Side Effects / Tradeoffs

- Parallel workers share the endpoint and health file — any shared mutable state
  needs the same flock treatment.
- Retries add bounded latency per failing item (2 × 20s worst case), but that is
  far below the old sequential 9 × 45s.
- Post-restart verification still races config propagation: an agent may not report
  the newly-written model yet, causing a truthful failure → rollback (pre-existing
  behavior, not introduced by parallelization).

## Evidence

- Reconcile elapsed dropped from ~405s+ (sequential 9 × 45s) to 142-173s (parallel
  with 20s timeout + 2 retries) on staging.
- `test/test-agent-model-health-parallel.sh`: 10 concurrent `health_record` writers →
  all 10 records survive (`RECORD_COUNT=10`).
- `test/test-agent-model-health.sh`, `test/test-agent-model-reconcile.sh`: pass.

## Related Files

- `scripts/reconcile-agent-models.sh`
- `scripts/agent-model-health.sh`
- `test/test-agent-model-health-parallel.sh`

## Tags

parallel, flock, bash, shell, health-record, reconcile, timeout, retry