#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="$(mktemp)"
trap 'rm -f "$OUTPUT"' EXIT

GITHUB_OUTPUT="$OUTPUT" GITHUB_REPOSITORY="tryweb/ai-engkit" HIGH_COUNT=3 MEDIUM_COUNT=4 LOW_COUNT=5 \
  bash "$ROOT/.github/scripts/release-body.sh" v99.0.0 "Contract test" 2
grep -q '| Critical | 2 |' "$OUTPUT"
grep -q '| High | 3 |' "$OUTPUT"
grep -q '| Medium | 4 |' "$OUTPUT"
grep -q '| Low | 5 |' "$OUTPUT"
! grep -q '2 critical finding(s)' "$OUTPUT"
echo "PASS: release body groups vulnerability findings by severity"
