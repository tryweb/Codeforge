#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK="$ROOT/.github/scripts/grype-release-check.sh"
FIXTURES="$ROOT/test/fixtures/grype"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

GITHUB_OUTPUT="$TMP/safe.out" GITHUB_STEP_SUMMARY="$TMP/safe.md" \
  bash "$CHECK" "$FIXTURES/safe-candidate.json" "$FIXTURES/baseline.json"
grep -qx 'critical-count=1' "$TMP/safe.out" || fail "critical count"
grep -qx 'high-count=1' "$TMP/safe.out" || fail "high count"
grep -qx 'medium-count=1' "$TMP/safe.out" || fail "medium count"
grep -qx 'low-count=1' "$TMP/safe.out" || fail "low count"
grep -qx 'new-critical-high-count=0' "$TMP/safe.out" || fail "safe delta"
grep -q '| Critical | 1 |' "$TMP/safe.md" || fail "severity summary"

set +e
GITHUB_OUTPUT="$TMP/blocked.out" bash "$CHECK" "$FIXTURES/blocked-candidate.json" "$FIXTURES/baseline.json" >"$TMP/blocked.log" 2>&1
status=$?
set -e
[[ "$status" -eq 1 ]] || fail "new Critical/High must block"
grep -qx 'new-critical-high-count=2' "$TMP/blocked.out" || fail "blocked delta count"
grep -q 'CVE-NEW-CRITICAL' "$TMP/blocked.log" || fail "critical detail"
grep -q 'CVE-NEW-HIGH' "$TMP/blocked.log" || fail "high detail"

set +e
bash "$CHECK" "$FIXTURES/safe-candidate.json" "$TMP/missing.json" >/dev/null 2>&1
status=$?
set -e
[[ "$status" -eq 1 ]] || fail "missing baseline must fail closed"
echo "PASS: Grype severity summary and release delta gate"
