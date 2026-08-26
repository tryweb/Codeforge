#!/usr/bin/env bash
# Trigger-only startup adapter for the shared TypeScript agent-model reconciler.
# Policy lives in /opt/admin/lib/agent-model-reconciler.ts; this script only
# waits for provider readiness and invokes its CLI without breaking startup.
set -u

MANAGED_DIR="${HOME}/.config/openchamber/managed-opencode"
PROVIDER_WAIT_SECONDS="${PROVIDER_WAIT_SECONDS:-120}"

log() { echo "[agent-models] $*" >&2; }

basic_auth() {
  printf 'opencode:%s' "${OPENCODE_SERVER_PASSWORD:-}" | base64 -w0
}

# managed_endpoint - URL of the newest managed OpenCode server instance.
managed_endpoint() {
  local file port
  file="$(ls -t "${MANAGED_DIR}"/*.json 2>/dev/null | head -n1)" || return 1
  port="$(jq -r '.port // empty' "$file" 2>/dev/null)" || return 1
  [ -n "$port" ] || return 1
  printf '%s\n' "http://127.0.0.1:${port}"
}

# wait_for_provider <timeout_seconds> - poll until /provider answers; saves
# the JSON body to a temp file and echoes the endpoint on success.
wait_for_provider() {
  local timeout="${1:-120}" waited=0 endpoint provider_json auth
  auth="$(basic_auth)"
  while [ "$waited" -le "$timeout" ]; do
    if endpoint="$(managed_endpoint)"; then
      provider_json="$(curl -fsS -m 3 -H "Authorization: Basic ${auth}" "${endpoint}/provider" 2>/dev/null || true)"
      if [ -n "$provider_json" ] \
        && printf '%s' "$provider_json" | jq -e '((.connected // []) | length) > 0' >/dev/null 2>&1; then
        printf '%s\n' "$provider_json" > "${TMPDIR:-/tmp}/agent-model-provider.$$.json"
        printf '%s\n' "$endpoint"
        return 0
      fi
    fi
    sleep 3
    waited=$((waited + 3))
  done
  return 1
}

reconcile() {
  [ -n "${OPENCODE_SERVER_PASSWORD:-}" ] || {
    log "OPENCODE_SERVER_PASSWORD is not set; skipping startup reconciliation"
    return 0
  }

  # Container restarts kill the lock owner but preserve this volume-backed path.
  rm -rf "${HOME}/.cache/openchamber/agent-model-reconcile.lock"

  wait_for_provider "$PROVIDER_WAIT_SECONDS" >/dev/null || {
    log "/provider unavailable after ${PROVIDER_WAIT_SECONDS}s; skipping startup reconciliation"
    return 0
  }

  if command -v bun >/dev/null 2>&1 \
    && [ -f /opt/admin/lib/agent-model-reconcile-cli.ts ]; then
    bun run /opt/admin/lib/agent-model-reconcile-cli.ts || {
      log "TypeScript agent-model reconciliation failed; continuing startup"
      return 0
    }
  else
    log "reconciler CLI unavailable; skipping startup reconciliation"
  fi
  return 0
}

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/agent-model-health.sh"

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  reconcile || true
fi
