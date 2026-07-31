#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck source=../entrypoint.d/lib-openchamber-settings.bash
source "$ROOT_DIR/entrypoint.d/lib-openchamber-settings.bash"

TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "PASS: $label"
  else
    fail "$label (expected='$expected', actual='$actual')"
  fi
}

DEFAULT_MODEL="opencode/big-pickle"

fresh_settings="$TEMP_DIR/fresh.json"
ensure_openchamber_default_model "$fresh_settings" "$DEFAULT_MODEL"
assert_eq "fresh file seeded with defaultModel" "$DEFAULT_MODEL" "$(jq -r '.defaultModel' "$fresh_settings")"
assert_eq "fresh file suppresses update notifications" "false" "$(jq -r '.showOpenCodeUpdateNotifications' "$fresh_settings")"

existing_settings="$TEMP_DIR/existing.json"
cat > "$existing_settings" <<'EOF'
{
  "darkThemeId": "flexoki-dark",
  "recentModels": [{"providerID": "opencode-go", "modelID": "kimi-k3"}],
  "zenModel": "minimax-m2.5-free"
}
EOF
ensure_openchamber_default_model "$existing_settings" "$DEFAULT_MODEL"
assert_eq "existing file backfilled with defaultModel" "$DEFAULT_MODEL" "$(jq -r '.defaultModel' "$existing_settings")"
assert_eq "backfill preserved unrelated keys" "flexoki-dark" "$(jq -r '.darkThemeId' "$existing_settings")"
assert_eq "backfill preserved nested arrays" "kimi-k3" "$(jq -r '.recentModels[0].modelID' "$existing_settings")"
[ "$(jq 'keys | length' "$existing_settings")" = "4" ] || fail "backfill added or removed unexpected keys"

custom_settings="$TEMP_DIR/custom.json"
printf '{"defaultModel": "anthropic/claude-opus-5", "custom": {"keep": true}}\n' > "$custom_settings"
before_custom="$(sha256sum "$custom_settings")"
ensure_openchamber_default_model "$custom_settings" "$DEFAULT_MODEL"
[ "$(sha256sum "$custom_settings")" = "$before_custom" ] || fail "overwrote a user-chosen defaultModel"
assert_eq "user-chosen defaultModel untouched" "anthropic/claude-opus-5" "$(jq -r '.defaultModel' "$custom_settings")"

symlink_target="$TEMP_DIR/symlink-target.json"
symlink_settings="$TEMP_DIR/symlink.json"
printf '{}\n' > "$symlink_target"
ln -s "$symlink_target" "$symlink_settings"
ensure_openchamber_default_model "$symlink_settings" "$DEFAULT_MODEL"
[ -L "$symlink_settings" ] || fail "replaced a symlinked settings file"
[ "$(jq 'has("defaultModel")' "$symlink_target")" = "false" ] || fail "backfilled through a symlink"

corrupt_settings="$TEMP_DIR/corrupt.json"
printf '{ not valid json\n' > "$corrupt_settings"
before_corrupt="$(sha256sum "$corrupt_settings")"
ensure_openchamber_default_model "$corrupt_settings" "$DEFAULT_MODEL"
[ "$(sha256sum "$corrupt_settings")" = "$before_corrupt" ] || fail "corrupted a non-JSON settings file"

echo "PASS: OpenChamber defaultModel seed/backfill preserves existing settings"
