#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
health_file="$(mktemp)"
trap 'rm -f "$health_file"' EXIT
export AGENT_MODEL_HEALTH_FILE="$health_file"

source "${SCRIPT_DIR}/scripts/agent-model-health.sh"

health_record "provider/retired" retired "HTTP 410"
health_record "provider/unavailable" unavailable "HTTP 404"
health_record "provider/retryable" retryable "HTTP 503"
health_record "provider/healthy" healthy "verified"

[ "$(health_status "provider/retired")" = retired ] || exit 1
if ! health_quarantined "provider/retired"; then exit 1; fi
if ! health_quarantined "provider/unavailable"; then exit 1; fi
if health_quarantined "provider/retryable"; then exit 1; fi
if health_quarantined "provider/healthy"; then exit 1; fi

retry_after="$(jq -r '."provider/unavailable".retryAfter' "$health_file")"
[ "$retry_after" -gt 0 ] || exit 1
retry_after="$(jq -r '."provider/retryable".retryAfter' "$health_file")"
[ "$retry_after" -gt 0 ] || exit 1

catalog="$(catalog_from_provider_json '{"connected":["provider-a"],"all":[{"id":"provider-a","models":{"old-model":{},"good-model":{}}},{"id":"provider-b","models":{"unconnected-model":{}}}]}')"
grep -Fxq 'provider-a/good-model' <<<"$catalog"
grep -Fxq 'provider-a/old-model' <<<"$catalog"
if grep -Fq 'provider-b/unconnected-model' <<<"$catalog"; then exit 1; fi
health_record "provider-a/old-model" retired "HTTP 410"
catalog="$(catalog_from_provider_json '{"connected":["provider-a"],"all":[{"id":"provider-a","models":{"old-model":{},"good-model":{}}}]}')"
if grep -Fq 'provider-a/old-model' <<<"$catalog"; then exit 1; fi

printf '%s\n' 'PASS model health status and quarantine TTL'
