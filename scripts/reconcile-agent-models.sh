#!/usr/bin/env bash
# Startup reconciliation for subagent model assignments.
#
# Ensures General / Plan (native) and the OMO-provided subagents
# (explore, librarian, metis, momus, multimodal-looker, oracle,
# sisyphus-junior) resolve to models offered by a CONNECTED provider.
#
# Why this exists: on a fresh boot the managed OpenCode server starts with
# OMO's built-in fallback chain, which may reference providers that are in
# the catalog but not connected (e.g. openai/gpt-5.6-luna-fast). Any subtask
# then dies instantly with "Model not found". This script waits for the
# server, reads GET /provider, rewrites omo.jsonc (+ mirrors general/plan
# into opencode.json), restarts the managed server, verifies, and always
# exits 0 so the container CMD chain never breaks.
set -u

OMO_CONFIG="${HOME}/.omo/omo.jsonc"
OPENCODE_CONFIG="${HOME}/.config/opencode/opencode.json"
MANAGED_DIR="${HOME}/.config/openchamber/managed-opencode"
AGENTS=(plan explore oracle librarian multimodal-looker metis momus sisyphus-junior general)
NATIVE_AGENTS=(general plan)
PROVIDER_WAIT_SECONDS="${PROVIDER_WAIT_SECONDS:-120}"

log() { echo "[agent-models] $*" >&2; }

basic_auth() {
  printf 'opencode:%s' "${OPENCODE_SERVER_PASSWORD:-}" | base64 -w0
}

declare -A AGENT_CATEGORY=(
  [plan]=reasoning
  [oracle]=reasoning
  [metis]=reasoning
  [momus]=reasoning
  [explore]=exploration
  [librarian]=exploration
  [general]=general
  [sisyphus-junior]=general
  [multimodal-looker]=general
)

policy_candidates() {
  local category="${AGENT_CATEGORY[$1]:-general}"
  printf '%s\n' "$category"
}

MODEL_CATALOG_FILE=""

model_capability_score() {
  local agent="$1" model="$2" category capabilities
  category="${AGENT_CATEGORY[$agent]:-general}"
  [ -n "$MODEL_CATALOG_FILE" ] && [ -f "$MODEL_CATALOG_FILE" ] || {
    printf '0\n'
    return 0
  }
  capabilities="$(jq -r --arg ref "$model" '
    [.all[]? as $provider
      | ($provider.models // {})
      | to_entries[]
      | select((($provider.id // "") + "/" + .key) == $ref)
      | (.value.capabilities // {})]
    | .[0] // {}
  ' "$MODEL_CATALOG_FILE")"
  case "$category" in
    reasoning)
      jq -r '((if .reasoning == true then 100 else 0 end) + (if .toolcall == true then 20 else 0 end) + ((.input // {}) | length))' <<<"$capabilities"
      ;;
    exploration)
      jq -r '((if .toolcall == true then 100 else 0 end) + (if .reasoning == false then 20 else 0 end) + (if .attachment == true then 10 else 0 end))' <<<"$capabilities"
      ;;
    *)
      jq -r '((if .toolcall == true then 100 else 0 end) + (if .attachment == true then 20 else 0 end) + (if .reasoning == true then 10 else 0 end))' <<<"$capabilities"
      ;;
  esac
}

# choose_model <agent> <available> - first policy candidate present in the
# connected catalog; otherwise the first available entry (deterministic).
choose_model() {
  local agent="$1" available="$2" candidate score best_score=-1 best_model=""
  while IFS= read -r candidate; do
    [ -n "$candidate" ] || continue
    score="$(model_capability_score "$agent" "$candidate")"
    if [ "$score" -gt "$best_score" ] || { [ "$score" -eq "$best_score" ] && [[ "$candidate" < "$best_model" ]]; }; then
      best_score="$score"
      best_model="$candidate"
    fi
  done < <(printf '%s\n' "$available" | sort -u)
  [ -n "$best_model" ] && printf '%s\n' "$best_model"
}

# needs_update <current> <available> - prints 1 and exits 0 when current is
# unset, an empty OpenCode resolution ("/"), or disconnected; else prints 0.
needs_update() {
  local current="$1" available="$2" verdict=0
  if [ -z "$current" ] || [ "$current" = "/" ]; then
    verdict=1
  elif ! grep -Fqx "$current" <<<"$available"; then
    verdict=1
  fi
  printf '%s\n' "$verdict"
  return "$verdict"
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

# catalog_from_provider_json <file> - one "provider/model" per line for
# CONNECTED providers only. The catalog lists every known provider; only
# .connected ones can actually serve requests.
catalog_from_provider_json() {
  jq -r '
    .connected as $connected
    | [ .all[]
        | select(.id as $id | $connected | index($id))
        | .id as $provider
        | (.models // {}) | keys[] | ($provider + "/" + .)
      ][]?
  ' "$1"
}

omo_agent_model() {
  jq -r --arg agent "$1" '(.agents[$agent].model // "") | strings' "$OMO_CONFIG" 2>/dev/null
}

native_agent_model() {
  jq -r --arg agent "$1" '(.agent[$agent].model // "") | strings' "$OPENCODE_CONFIG" 2>/dev/null
}

write_omo_model() {
  local agent="$1" model="$2" tmp="${OMO_CONFIG}.tmp.$$"
  [ -f "$OMO_CONFIG" ] || return 1
  # OMO 4.x agent-def schema is .strict(): any undeclared key (e.g.
  # fallback_models) invalidates the WHOLE config and every override is
  # silently dropped, so write the primary only and strip stale poison keys.
  jq --arg agent "$agent" --arg model "$model" '
    .agents[$agent].model = $model
    | del(.agents[$agent].fallback_models)
  ' "$OMO_CONFIG" > "$tmp" || { rm -f "$tmp"; return 1; }
  mv "$tmp" "$OMO_CONFIG"
}

# general/plan resolve natively from opencode.json; mirror so the entrypoint
# bridge and the plugin agree on a connected model.
write_native_model() {
  local agent="$1" model="$2" tmp="${OPENCODE_CONFIG}.tmp.$$"
  [ -f "$OPENCODE_CONFIG" ] || {
    log "${OPENCODE_CONFIG} is unavailable; skipping native mirror for ${agent}"
    return 0
  }
  jq --arg agent "$agent" --arg model "$model" '
    .agent = ((.agent // {}) + {($agent): ((.agent[$agent] // {}) + {model: $model})})
  ' "$OPENCODE_CONFIG" > "$tmp" || { rm -f "$tmp"; return 1; }
  mv "$tmp" "$OPENCODE_CONFIG"
}

verify_runtime() {
  local endpoint="$1" agent="$2" target="$3" agents_json actual auth
  auth="$(basic_auth)"
  agents_json="$(curl -fsS -m 10 -H "Authorization: Basic ${auth}" "${endpoint}/agent")" || return 1
  actual="$(jq -r --arg agent "$agent" '
    def agent_key: ascii_downcase | split(" - ")[0] | gsub(" "; "-");
    .[] | select((.name | agent_key) == ($agent | agent_key))
    | ((.model.providerID // "") + "/" + (.model.modelID // ""))
  ' <<<"$agents_json" 2>/dev/null)"
  [ "$actual" = "$target" ]
}

# Kill the managed process so OpenChamber relaunches it with the reconciled
# config, then wait for the replacement instance to answer.
restart_managed_server() {
  local pid_file pid endpoint waited=0
  pid_file="$(ls -t "${MANAGED_DIR}"/*.json 2>/dev/null | head -n1)" || return 1
  pid="$(jq -r '.pid // empty' "$pid_file" 2>/dev/null)"
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null || true
  fi
  while [ "$waited" -le 60 ]; do
    sleep 3
    waited=$((waited + 3))
    if endpoint="$(managed_endpoint)"; then
      if curl -fsS -m 3 -H "Authorization: Basic $(basic_auth)" \
        "${endpoint}/global/health" >/dev/null 2>&1; then
        printf '%s\n' "$endpoint"
        return 0
      fi
    fi
  done
  return 1
}

reconcile() {
  [ -n "${OPENCODE_SERVER_PASSWORD:-}" ] || {
    log "OPENCODE_SERVER_PASSWORD is not set; skipping startup reconciliation"
    return 0
  }

  local endpoint available post_available provider_file backup_file native_backup_file="" agent current selected changed=0
  provider_file="${TMPDIR:-/tmp}/agent-model-provider-copy.$$.json"
  backup_file="${OMO_CONFIG}.agent-models-backup.$$"

  endpoint="$(wait_for_provider "$PROVIDER_WAIT_SECONDS")" || {
    log "/provider unavailable after ${PROVIDER_WAIT_SECONDS}s; skipping startup reconciliation"
    return 0
  }
  cp "${TMPDIR:-/tmp}/agent-model-provider.$$.json" "$provider_file"

  available="$(catalog_from_provider_json "$provider_file")"
  [ -n "$available" ] || {
    log "no connected-provider models found; skipping startup reconciliation"
    rm -f "$provider_file" "${TMPDIR:-/tmp}/agent-model-provider.$$.json"
    return 0
  }

  declare -A targets=()
  MODEL_CATALOG_FILE="$provider_file"
  for agent in "${AGENTS[@]}"; do
    current="$(omo_agent_model "$agent")"
    selected="$(choose_model "$agent" "$available")"
    if [ "$current" != "$selected" ] || [ "$(needs_update "$current" "$available")" = "1" ]; then
      targets[$agent]="$selected"
      changed=1
      log "${agent}: ${current:-<unset>} -> ${selected}"
    else
      targets[$agent]="$current"
    fi
  done

  for agent in "${NATIVE_AGENTS[@]}"; do
    if [ "$(native_agent_model "$agent")" != "${targets[$agent]}" ]; then
      changed=1
    fi
  done

  if [ "$changed" -eq 1 ]; then
    cp "$OMO_CONFIG" "$backup_file"
    if [ -f "$OPENCODE_CONFIG" ]; then
      native_backup_file="${OPENCODE_CONFIG}.agent-models-backup.$$"
      cp "$OPENCODE_CONFIG" "$native_backup_file" || {
        log "could not snapshot ${OPENCODE_CONFIG}; leaving configuration unchanged"
        rm -f "$backup_file" "$native_backup_file" "$provider_file"
        return 0
      }
    fi
    for agent in "${AGENTS[@]}"; do
      write_omo_model "$agent" "${targets[$agent]}" || {
        log "omo.jsonc update failed for ${agent}; restoring backup"
        cp "$backup_file" "$OMO_CONFIG"
        [ -z "$native_backup_file" ] || cp "$native_backup_file" "$OPENCODE_CONFIG"
        rm -f "$backup_file" "$native_backup_file" "$provider_file"
        return 0
      }
    done
    for agent in "${NATIVE_AGENTS[@]}"; do
      write_native_model "$agent" "${targets[$agent]}" || {
        log "opencode.json update failed for ${agent}; restoring backup"
        cp "$backup_file" "$OMO_CONFIG"
        [ -z "$native_backup_file" ] || cp "$native_backup_file" "$OPENCODE_CONFIG"
        rm -f "$backup_file" "$native_backup_file" "$provider_file"
        return 0
      }
    done

    if endpoint="$(restart_managed_server)" \
      && endpoint="$(wait_for_provider 60)"; then
      cp "${TMPDIR:-/tmp}/agent-model-provider.$$.json" "$provider_file"
      post_available="$(catalog_from_provider_json "$provider_file")"
      verify_tmp="$(mktemp -d "${TMPDIR:-/tmp}/agent-model-verify.XXXXXX")" || verify_tmp="${TMPDIR:-/tmp}/agent-model-verify.$$"
      verify_pids=()
      for agent in "${AGENTS[@]}"; do
        if ! grep -Fqx "${targets[$agent]}" <<<"$post_available"; then
          log "WARNING: ${agent} target ${targets[$agent]} is no longer connected after restart"
          continue
        fi
        (
          if verify_runtime "$endpoint" "$agent" "${targets[$agent]}"; then
            printf 'ok\n' > "$verify_tmp/$agent"
          else
            printf 'fail\n' > "$verify_tmp/$agent"
          fi
        ) &
        verify_pids+=("$!")
      done
      for pid in "${verify_pids[@]}"; do
        wait "$pid" 2>/dev/null || true
      done
      for agent in "${AGENTS[@]}"; do
        [ -f "$verify_tmp/$agent" ] || continue
        if [ "$(cat "$verify_tmp/$agent")" = ok ]; then
          log "${agent}: runtime verified (${targets[$agent]})"
        else
          log "WARNING: ${agent} /agent does not report ${targets[$agent]} yet"
          VERIFY_FAILED=1
        fi
      done
      rm -rf "$verify_tmp"
    else
      log "WARNING: managed server did not come back within 60s; skipping verification"
    fi
  fi

  if [ "${VERIFY_FAILED:-0}" -eq 1 ] && [ -f "$backup_file" ]; then
    log "runtime model verification failed; restoring the pre-reconcile configuration"
    cp "$backup_file" "$OMO_CONFIG"
    if [ -n "${native_backup_file:-}" ] && [ -f "$native_backup_file" ]; then
      cp "$native_backup_file" "$OPENCODE_CONFIG"
    fi
    restart_managed_server || log "WARNING: managed server restart after rollback failed"
  fi

  rm -f "$provider_file" "$backup_file" "$native_backup_file" "${TMPDIR:-/tmp}/agent-model-provider.$$.json"
}

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/agent-model-health.sh"

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  reconcile || true
fi
