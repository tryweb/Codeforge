#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENTRYPOINT_FILE="$SCRIPT_DIR/02-init-config.sh"

run_sync() {
  local root="$1"
  local sync_source="$root/sync.sh"
  sed -n '/^sync_ai_engkit_agents_md()/,/^sync_ai_engkit_agents_md "\$AI_ENGKIT_AGENTS_DEFAULT" "\$USER_AGENTS_MD"$/p' "$ENTRYPOINT_FILE" | sed '$d' > "$sync_source"
  source "$sync_source"
  sync_ai_engkit_agents_md "$root/default.md" "$root/AGENTS.md"
}

run_migration() {
  local root="$1"
  local migration_source="$root/migrate.sh"
  sed -n '/^migrate_leanctx_compression_level()/,/^migrate_leanctx_compression_level$/p' "$ENTRYPOINT_FILE" | sed '$d' > "$migration_source"
  printf '%s\n' 'migrate_leanctx_compression_level' >> "$migration_source"
  LEANCTX_RUNTIME_CONFIG="$root/config.toml" bash "$migration_source"
}

run_ensure() {
  local root="$1"
  local ensure_source="$root/ensure.sh"
  sed -n '/^leanctx_runtime_config_is_malformed()/,/^ensure_leanctx_config$/p' "$ENTRYPOINT_FILE" | sed '$d' > "$ensure_source"
  printf '%s\n' 'ensure_leanctx_config' >> "$ensure_source"
  LEANCTX_BASELINE_CONFIG="$root/default.toml" LEANCTX_RUNTIME_CONFIG="$root/config.toml" bash "$ensure_source"
}

assert_migration_backup_and_marker_boundary() {
  local root
  root="$(mktemp -d)"
  printf '%s\n' 'compression_level = "lite"' 'shell_write_policy = "disabled"' > "$root/config.toml"
  cp "$root/config.toml" "$root/before.toml"
  run_migration "$root"
  grep -Fxq 'compression_level = "off"' "$root/config.toml"
  grep -Fxq 'shell_write_policy = "disabled"' "$root/config.toml"
  cmp -s "$root/before.toml" "$root/config.toml.pre-migration-v1"
  test -f "$root/config.toml.migration-v1"
  cp "$root/config.toml.pre-migration-v1" "$root/config.toml"
  run_migration "$root"
  grep -Fxq 'compression_level = "lite"' "$root/config.toml"
  test -f "$root/config.toml.migration-v1"
  rm -rf "$root"
}

assert_off_config_still_recovers_malformed_toml() {
  local root backups
  root="$(mktemp -d)"
  printf '%s\n' 'compression_level = "off"' > "$root/default.toml"
  printf '%s\n' 'compression_level = "off"' 'broken = [' > "$root/config.toml"
  cp "$root/config.toml" "$root/before.toml"
  run_ensure "$root"
  cmp -s "$root/default.toml" "$root/config.toml"
  backups=("$root"/config.toml.malformed.*)
  test -f "${backups[0]}"
  cmp -s "$root/before.toml" "${backups[0]}"
  rm -rf "$root"
}

assert_malformed() {
  local name="$1"
  local content="$2"
  local root
  root="$(mktemp -d)"
  printf '%s\n' '<!-- @ai-engkit -->' default '<!-- /@ai-engkit -->' > "$root/default.md"
  printf '%s\n' "$content" > "$root/AGENTS.md"
  cp "$root/AGENTS.md" "$root/before.md"
  run_sync "$root" > "$root/stdout" 2> "$root/stderr"
  cmp -s "$root/before.md" "$root/AGENTS.md"
  grep -Fq 'Warning: malformed @ai-engkit marker order' "$root/stderr"
  rm -rf "$root"
}

assert_normal_sync_is_atomic_and_idempotent() {
  local root
  root="$(mktemp -d)"
  printf '%s\n' '<!-- @ai-engkit -->' managed '<!-- /@ai-engkit -->' > "$root/default.md"
  printf '%s\n' prefix '<!-- @ai-engkit -->' stale '<!-- /@ai-engkit -->' suffix > "$root/AGENTS.md"
  run_sync "$root" > "$root/first.out" 2> "$root/first.err"
  grep -Fxq prefix "$root/AGENTS.md"
  grep -Fxq managed "$root/AGENTS.md"
  grep -Fxq suffix "$root/AGENTS.md"
  sha256sum "$root/AGENTS.md" > "$root/first.sha"
  run_sync "$root" > "$root/second.out" 2> "$root/second.err"
  sha256sum "$root/AGENTS.md" > "$root/second.sha"
  cmp -s "$root/first.sha" "$root/second.sha"
  test ! -s "$root/second.out"
  test ! -s "$root/second.err"
  rm -rf "$root"
}

assert_normal_sync_is_atomic_and_idempotent
assert_migration_backup_and_marker_boundary
assert_off_config_still_recovers_malformed_toml
assert_malformed closing-before-opening $'prefix\n<!-- /@ai-engkit -->\nbody\n<!-- @ai-engkit -->\nmanaged\n<!-- /@ai-engkit -->\nsuffix'
assert_malformed duplicate-opening $'prefix\n<!-- @ai-engkit -->\nfirst\n<!-- @ai-engkit -->\nsecond\n<!-- /@ai-engkit -->\nsuffix'
assert_malformed opening-without-close $'prefix\n<!-- @ai-engkit -->\nmanaged\nsuffix'
assert_malformed closing-without-open $'prefix\nmanaged\n<!-- /@ai-engkit -->\nsuffix'
printf '%s\n' 'AGENTS sync tests passed'
