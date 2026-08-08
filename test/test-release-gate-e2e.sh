#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK="$ROOT/.github/scripts/grype-release-check.sh"
RELEASE_BODY="$ROOT/.github/scripts/release-body.sh"
WORKFLOW="$ROOT/.github/workflows/ci.yml"
FIXTURES="$ROOT/test/fixtures/grype"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

python3 - "$WORKFLOW" <<'PY'
import sys
import yaml

with open(sys.argv[1], encoding="utf-8") as stream:
    jobs = yaml.safe_load(stream)["jobs"]

def needs(job: str) -> set[str]:
    value = jobs[job].get("needs", [])
    return {value} if isinstance(value, str) else set(value)

assert "scan" in needs("push")
assert {"push", "scan"}.issubset(needs("release"))
assert "scan" in needs("auto-tag")
PY

run_pipeline() {
  local candidate="$1" publish_dir="$2" scan_output="$3"
  GITHUB_OUTPUT="$scan_output" bash "$CHECK" "$candidate" "$FIXTURES/baseline.json" || return $?

  local critical high medium low
  critical="$(sed -n 's/^critical-count=//p' "$scan_output")"
  high="$(sed -n 's/^high-count=//p' "$scan_output")"
  medium="$(sed -n 's/^medium-count=//p' "$scan_output")"
  low="$(sed -n 's/^low-count=//p' "$scan_output")"

  mkdir -p "$publish_dir"
  cp "$candidate" "$publish_dir/ghcr-image.json"
  GITHUB_OUTPUT="$publish_dir/github-release.txt" GITHUB_REPOSITORY="tryweb/ai-engkit" \
    HIGH_COUNT="$high" MEDIUM_COUNT="$medium" LOW_COUNT="$low" \
    bash "$RELEASE_BODY" v99.0.0 "E2E release gate" "$critical"
}

run_pipeline "$FIXTURES/safe-candidate.json" "$TMP/safe-published" "$TMP/safe-scan.out"
[[ -f "$TMP/safe-published/ghcr-image.json" ]] || fail "safe GHCR artifact missing"
[[ -f "$TMP/safe-published/github-release.txt" ]] || fail "safe GitHub Release missing"
grep -q '| Critical | 1 |' "$TMP/safe-published/github-release.txt" || fail "safe release summary missing"

set +e
run_pipeline "$FIXTURES/blocked-candidate.json" "$TMP/blocked-published" "$TMP/blocked-scan.out" >"$TMP/blocked.log" 2>&1
status=$?
set -e
[[ "$status" -eq 1 ]] || fail "blocked pipeline must fail"
[[ ! -e "$TMP/blocked-published" ]] || fail "blocked pipeline produced release artifacts"
grep -q 'CVE-NEW-CRITICAL' "$TMP/blocked.log" || fail "blocked Critical finding not reported"
grep -q 'CVE-NEW-HIGH' "$TMP/blocked.log" || fail "blocked High finding not reported"

echo "PASS: release artifacts are blocked by new Critical/High findings"
