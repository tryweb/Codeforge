#!/usr/bin/env bash
# Summarize a candidate Grype report and block new Critical/High findings.
# Usage: grype-release-check.sh <candidate.json> <baseline.json>
set -euo pipefail

CANDIDATE="${1:-}"
BASELINE="${2:-}"

if [[ -z "$CANDIDATE" || -z "$BASELINE" ]]; then
  echo "usage: $0 <candidate.json> <baseline.json>" >&2
  exit 2
fi

for report in "$CANDIDATE" "$BASELINE"; do
  if [[ ! -f "$report" ]] || ! jq -e '.matches | type == "array"' "$report" >/dev/null 2>&1; then
    echo "::error::Missing or invalid Grype report: $report" >&2
    exit 1
  fi
done

count_severity() {
  jq --arg severity "$1" '[.matches[]? | select((.vulnerability.severity // "unknown" | ascii_downcase) == $severity)] | length' "$CANDIDATE"
}

critical_count="$(count_severity critical)"
high_count="$(count_severity high)"
medium_count="$(count_severity medium)"
low_count="$(count_severity low)"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

jq -r '
  [.matches[]? |
    select((.vulnerability.severity // "unknown" | ascii_downcase) == "critical" or
           (.vulnerability.severity // "unknown" | ascii_downcase) == "high") |
    {id: (.vulnerability.id // "unknown"), package: (.artifact.name // "unknown"),
     version: (.artifact.version // "unknown"), severity: (.vulnerability.severity // "Unknown")}] |
  unique_by(.id, .package)[] | [.id, .package, .version, .severity] | @tsv
' "$CANDIDATE" | sort -u > "$tmp_dir/candidate.tsv"

jq -r '
  [.matches[]? |
    select((.vulnerability.severity // "unknown" | ascii_downcase) == "critical" or
           (.vulnerability.severity // "unknown" | ascii_downcase) == "high") |
    [(.vulnerability.id // "unknown"), (.artifact.name // "unknown")]] |
  unique[] | @tsv
' "$BASELINE" | sort -u > "$tmp_dir/baseline.tsv"

: > "$tmp_dir/new.tsv"
while IFS=$'\t' read -r id package version severity; do
  [[ -n "$id" ]] || continue
  if ! grep -Fqx -- "$id"$'\t'"$package" "$tmp_dir/baseline.tsv"; then
    printf '%s\t%s\t%s\t%s\n' "$id" "$package" "$version" "$severity" >> "$tmp_dir/new.tsv"
  fi
done < "$tmp_dir/candidate.tsv"

new_count="$(wc -l < "$tmp_dir/new.tsv" | tr -d ' ')"
{
  echo "critical-count=$critical_count"
  echo "high-count=$high_count"
  echo "medium-count=$medium_count"
  echo "low-count=$low_count"
  echo "new-critical-high-count=$new_count"
} >> "${GITHUB_OUTPUT:-/dev/null}"

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo '## Vulnerability scan'
    echo ''
    echo '| Severity | Candidate findings |'
    echo '|----------|-------------------:|'
    echo "| Critical | $critical_count |"
    echo "| High | $high_count |"
    echo "| Medium | $medium_count |"
    echo "| Low | $low_count |"
    echo ''
    echo "New Critical/High findings: **$new_count**"
  } >> "$GITHUB_STEP_SUMMARY"
fi

if [[ "$new_count" -gt 0 ]]; then
  echo "::error::Candidate image introduces $new_count new Critical/High finding(s):" >&2
  while IFS=$'\t' read -r id package version severity; do
    echo "::error::${severity}: ${id} (${package}@${version})" >&2
  done < "$tmp_dir/new.tsv"
  exit 1
fi

echo "::notice::No new Critical/High findings relative to the published image."
