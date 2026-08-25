#!/usr/bin/env bash
set -euo pipefail

_trace() { echo "[auth-trace] $*" >&2; }

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_template="$ROOT_DIR/.opencode/AGENTS.md.default"
_repository="$ROOT_DIR/AGENTS.md"
TASK_7_DIR="$ROOT_DIR/.omo/evidence/lean-ctx-reliability-gate/task-7/campaign-20260825T105603Z"
TASK_8_DIR="$ROOT_DIR/.omo/evidence/lean-ctx-reliability-gate/task-8"

_trace "ROOT_DIR=$ROOT_DIR"
_trace "template exists=$(test -f "$_template" && echo yes || echo no)"
_trace "repository exists=$(test -f "$_repository" && echo yes || echo no)"

extract_section() {
  local marker="$1"
  local closing_marker="$2"
  local file="$3"
  awk -v marker="$marker" -v closing_marker="$closing_marker" '
    $0 == marker { inside = 1; print; next }
    inside && $0 == closing_marker { print; exit }
    inside { print }
  ' "$file"
}

_trace "extracting template_authority..."
template_authority="$(extract_section '<!-- ai-engkit-authority -->' '<!-- /ai-engkit-authority -->' "$_template")"
_trace "template_authority length=${#template_authority} lines=$(echo "$template_authority" | wc -l)"

_trace "extracting repository_authority..."
repository_authority="$(extract_section '<!-- ai-engkit-authority -->' '<!-- /ai-engkit-authority -->' "$_repository")"
_trace "repository_authority length=${#repository_authority} lines=$(echo "$repository_authority" | wc -l)"

_trace "checking template_authority non-empty..."
test -n "$template_authority"
_trace "checking repository_authority non-empty..."
test -n "$repository_authority"
_trace "comparing template vs repository..."
test "$template_authority" = "$repository_authority"
_trace "comparison OK"

_trace "checking required tokens..."
for token in \
  'CodeGraph' \
  'indexed source' \
  'source and flow' \
  'native anchored read/edit' \
  'LSP diagnostics' \
  'tests' \
  'git' \
  'writes' \
  'memory' \
  'knowledge' \
  'non-authoritative exploration' \
  'raw hatches' \
  'not guaranteed'; do
  _trace "  token='$token'"
  grep -Fqi "$token" <<<"$template_authority"
done
_trace "all tokens OK"

_trace "checking obsolete lean-ctx patterns..."
if grep -Eiq 'lean-ctx[^\n]*(replace|authoritative|must use)|ctx_(read|shell)[^\n]*(authoritative|must use)' <<<"$template_authority"; then
  echo "authority block contains obsolete mandatory lean-ctx routing" >&2
  exit 1
fi
_trace "obsolete check OK"

if [ -f "$TASK_7_DIR/g0-classification.json" ] && [ -f "$TASK_8_DIR/verdict-consumption.json" ]; then
  _trace "evidence files present; checking..."
  test "$(jq -er '.classification' "$TASK_7_DIR/g0-classification.json")" = "disable-routing"
  test "$(jq -er '.campaignExecuted' "$TASK_7_DIR/g0-classification.json")" = "false"
  test "$(jq -er '.campaignCommandCount' "$TASK_7_DIR/g0-classification.json")" = "0"
  test "$(<"$TASK_7_DIR/g0-classification.txt")" = "disable-routing"
  test "$(jq -er '.classification' "$TASK_8_DIR/verdict-consumption.json")" = "disable-routing"
  test "$(jq -er '.action' "$TASK_8_DIR/verdict-consumption.json")" = "disable-routing"
  test "$(jq -er '.override' "$TASK_8_DIR/verdict-consumption.json")" = "false"
  test "$(jq -er '.runtimeRoutingToggle' "$TASK_8_DIR/verdict-consumption.json")" = "false"
  test "$(jq -er '.source[] | select(.path | endswith("g0-classification.json")) | .sha256' "$TASK_8_DIR/verdict-consumption.json")" = "$(sha256sum "$TASK_7_DIR/g0-classification.json" | cut -d' ' -f1)"
  test "$(jq -er '.source[] | select(.path | endswith("g0-classification.txt")) | .sha256' "$TASK_8_DIR/verdict-consumption.json")" = "$(sha256sum "$TASK_7_DIR/g0-classification.txt" | cut -d' ' -f1)"
  (cd "$TASK_8_DIR" && sha256sum -c SHA256SUMS >/dev/null)
  _trace "evidence checks OK"
else
  _trace "evidence files not found; skipping verdict assertions"
fi

_trace "checking fail-closed routing line 1..."
grep -Fqx -- '- Repository routing state is fail-closed: automatic Read, Search, and Shell routing is disabled after the task-7 G0 verdict `disable-routing`; no runtime routing toggle exists.' <<<"$template_authority"
_trace "line 1 OK"

_trace "checking fail-closed routing line 2..."
grep -Fqx -- '- Re-enable requires a new isolated passing G0-G4 evaluation and an explicit repository guidance decision; it is never an automatic toggle.' <<<"$template_authority"
_trace "line 2 OK"

_trace "checking automatic mandatory routing..."
if grep -Eiq 'automatic (read|search|shell) routing[^.]*\b(enabled|must|mandatory|required)\b|\b(must|required|mandatory)\b[^.]*automatic (read|search|shell) routing' <<<"$template_authority"; then
  echo "authority block contains automatic mandatory routing" >&2
  exit 1
fi
_trace "mandatory routing check OK"

printf 'authority guidance assertions passed\n'
_trace "ALL PASSED"
