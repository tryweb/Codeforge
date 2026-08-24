#!/usr/bin/env bash

AGENT_MODEL_HEALTH_FILE="${AGENT_MODEL_HEALTH_FILE:-${HOME}/.cache/openchamber/agent-model-health.json}"
AGENT_MODELS_VERIFY_TIMEOUT="${AGENT_MODELS_VERIFY_TIMEOUT:-20}"
AGENT_MODELS_VERIFY_RETRIES="${AGENT_MODELS_VERIFY_RETRIES:-2}"
VERIFY_FAILED=0

catalog_from_provider_json() {
  source="${1:-}"
  if [ -f "$source" ]; then
    json="$(cat "$source")"
  else
    json="$source"
  fi
  while IFS= read -r candidate; do
    [ -n "$candidate" ] || continue
    health_quarantined "$candidate" || printf '%s\n' "$candidate"
  done < <(jq -r '
    . as $root |
    ($root.connected // []) as $connected |
    ($root.all // [])[] |
    select(.id as $id | $connected | index($id) != null) |
    .id as $provider |
    (.models // {}) | keys[] | ($provider + "/" + .)
  ' <<<"$json")
}

health_record() {
  model="${1-}"
  status="${2-}"
  reason="${3-}"
  retry_after=0
  tmp="${AGENT_MODEL_HEALTH_FILE}.tmp.${BASHPID:-$$}.$RANDOM"
  case "$status" in
    unavailable|mismatch) retry_after=$(( $(date +%s) + 900 )) ;;
    retryable) retry_after=$(( $(date +%s) + 60 )) ;;
  esac
  mkdir -p "$(dirname "$AGENT_MODEL_HEALTH_FILE")" || return 0
  (
    flock 9
    if [ -s "$AGENT_MODEL_HEALTH_FILE" ]; then
      jq --arg m "$model" --arg s "$status" --arg r "$reason" \
        --argjson ra "$retry_after" --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        '.[$m] = {status: $s, reason: $r, observedAt: $ts, retryAfter: $ra}' \
        "$AGENT_MODEL_HEALTH_FILE" 2>/dev/null >"$tmp" || \
        jq -n --arg m "$model" --arg s "$status" --arg r "$reason" \
          --argjson ra "$retry_after" --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
          '{($m): {status: $s, reason: $r, observedAt: $ts, retryAfter: $ra}}' >"$tmp"
    else
      jq -n --arg m "$model" --arg s "$status" --arg r "$reason" \
        --argjson ra "$retry_after" --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        '{($m): {status: $s, reason: $r, observedAt: $ts, retryAfter: $ra}}' >"$tmp"
    fi
    mv "$tmp" "$AGENT_MODEL_HEALTH_FILE" 2>/dev/null || rm -f "$tmp"
  ) 9>"${AGENT_MODEL_HEALTH_FILE}.lock"
}

health_status() {
  model="${1-}"
  [ -f "$AGENT_MODEL_HEALTH_FILE" ] || return 1
  jq -r --arg model "$model" '.[$model].status // empty' "$AGENT_MODEL_HEALTH_FILE" 2>/dev/null
}

health_quarantined() {
  model="${1-}"
  status="$(health_status "$model")"
  [ "$status" = retired ] && return 0
  [[ "$status" = unavailable || "$status" = mismatch ]] || return 1
  retry_after="$(jq -r --arg model "$model" '.[$model].retryAfter // 0' "$AGENT_MODEL_HEALTH_FILE" 2>/dev/null)"
  now="$(date +%s)"
  [ "$retry_after" -gt "$now" ]
}

verify_runtime() {
  endpoint="$1"
  agent="$2"
  expected="$3"
  auth="$(basic_auth)"
  session="$(jq -nc --arg agent "$agent" '{agent:$agent,title:"agent model health verification"}' \
    | curl -sS -m 10 -w $'\n%{http_code}' -H "Authorization: Basic $auth" \
      -H 'Content-Type: application/json' -X POST "$endpoint/session" -d @-)" || {
    VERIFY_FAILED=1
    health_record "$expected" retryable "session creation failed"
    return 1
  }
  http_code="${session##*$'\n'}"
  session="${session%$'\n'*}"
  if [[ "$http_code" != 2* ]]; then
    VERIFY_FAILED=1
    health_record "$expected" retryable "session creation HTTP $http_code"
    return 1
  fi
  session="$(jq -r '.id // empty' <<<"$session" 2>/dev/null)"
  [ -n "$session" ] || {
    VERIFY_FAILED=1
    health_record "$expected" retryable "session id missing"
    return 1
  }
  # First message after a managed-server restart can hit a cold-provider timeout.
  response=""
  for attempt in $(seq 1 "${AGENT_MODELS_VERIFY_RETRIES:-2}"); do
    response="$(jq -nc --arg agent "$agent" '{agent:$agent,parts:[{type:"text",text:"Reply with exactly OK."}]}' \
      | curl -sS -m "${AGENT_MODELS_VERIFY_TIMEOUT:-20}" -w $'\n%{http_code}' -H "Authorization: Basic $auth" \
        -H 'Content-Type: application/json' -X POST "$endpoint/session/$session/message" -d @- || true)"
    attempt_code="${response##*$'\n'}"
    if [ -z "$attempt_code" ] || [ "$attempt_code" = 000 ] || [[ "$attempt_code" = 2* ]]; then
      break
    fi
    sleep 2
  done
  curl -sS -m 5 -H "Authorization: Basic $auth" -X DELETE "$endpoint/session/$session" >/dev/null 2>&1 || true
  http_code="${response##*$'\n'}"
  response="${response%$'\n'*}"
  if [ "$http_code" = 410 ]; then
    VERIFY_FAILED=1
    health_record "$expected" retired "HTTP 410 model lifecycle response"
    return 1
  fi
  if [ "$http_code" = 404 ]; then
    VERIFY_FAILED=1
    health_record "$expected" unavailable "HTTP 404 model or account response"
    return 1
  fi
  if [[ "$http_code" != 2* ]]; then
    VERIFY_FAILED=1
    health_record "$expected" retryable "HTTP $http_code"
    return 1
  fi
  info="$(jq -c 'if type == "array" then ([.[] | .info | select(.role == "assistant" and (.error == null) and (.modelID | type == "string") and (.providerID | type == "string"))] | last // empty) else (.info | select(.role == "assistant" and (.error == null) and (.modelID | type == "string") and (.providerID | type == "string"))) end' <<<"$response" 2>/dev/null || true)"
  provider="$(jq -r '.providerID // empty' <<<"$info")"
  model="$(jq -r '.modelID // empty' <<<"$info")"
  actual="$provider/$model"
  if [ "$actual" != "$expected" ]; then
    VERIFY_FAILED=1
    health_record "$expected" mismatch "runtime resolved $actual"
    return 1
  fi
  health_record "$expected" healthy "verified runtime request"
  return 0
}
