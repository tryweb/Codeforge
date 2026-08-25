#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$ROOT_DIR/.opencode/AGENTS.md.default"
REPOSITORY="$ROOT_DIR/AGENTS.md"
TASK_7_DIR="$ROOT_DIR/.omo/evidence/lean-ctx-reliability-gate/task-7/campaign-20260825T105603Z"
TASK_8_DIR="$ROOT_DIR/.omo/evidence/lean-ctx-reliability-gate/task-8"

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

# Extract authority section from the committed template (always present in git).
template_authority="$(extract_section '<!-- ai-engkit-authority -->' '<!-- /ai-engkit-authority -->' "$TEMPLATE")"
test -n "$template_authority"

# AGENTS.md is gitignored — it is generated at runtime by the entrypoint inside
# the container.  In CI the host checkout does not contain it, so the
# comparison is skipped there.  Locally (after the entrypoint has run) the
# two must agree.
if [ -f "$REPOSITORY" ]; then
  repository_authority="$(extract_section '<!-- ai-engkit-authority -->' '<!-- /ai-engkit-authority -->' "$REPOSITORY")"
  test -n "$repository_authority"
  test "$template_authority" = "$repository_authority"
fi

# Required tokens that must appear in the authority block.
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
  grep -Fqi "$token" <<<"$template_authority"
done

# Obsolete mandatory lean-ctx routing must not be present.
if grep -Eiq 'lean-ctx[^\n]*(replace|authoritative|must use)|ctx_(read|shell)[^\n]*(authoritative|must use)' <<<"$template_authority"; then
  echo "authority block contains obsolete mandatory lean-ctx routing" >&2
  exit 1
fi

# Verdict evidence checks — local-only (.omo/ is gitignored).
if [ -f "$TASK_7_DIR/g0-classification.json" ] && [ -f "$TASK_8_DIR/verdict-consumption.json" ]; then
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
fi

# Fail-closed routing lines must be present in the authority block.
grep -Fqx -- '- Repository routing state is fail-closed: automatic Read, Search, and Shell routing is disabled after the task-7 G0 verdict `disable-routing`; no runtime routing toggle exists.' <<<"$template_authority"
grep -Fqx -- '- Re-enable requires a new isolated passing G0-G4 evaluation and an explicit repository guidance decision; it is never an automatic toggle.' <<<"$template_authority"
if grep -Eiq 'automatic (read|search|shell) routing[^.]*\b(enabled|must|mandatory|required)\b|\b(must|required|mandatory)\b[^.]*automatic (read|search|shell) routing' <<<"$template_authority"; then
  echo "authority block contains automatic mandatory routing" >&2
  exit 1
fi

printf 'authority guidance assertions passed\n'
