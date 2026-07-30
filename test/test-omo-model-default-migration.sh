#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PERMISSION_DEFAULTS_FILE="$ROOT_DIR/.opencode/omo.jsonc.default"
MODEL_DEFAULTS_FILE="$ROOT_DIR/.opencode/omo-model-defaults.json"

# shellcheck source=../entrypoint.d/lib-omo-model-defaults.bash
source "$ROOT_DIR/entrypoint.d/lib-omo-model-defaults.bash"

TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

assert_model() {
  local config_file="$1"
  local scope="$2"
  local name="$3"
  local expected="opencode/deepseek-v4-flash"
  local actual
  actual="$(jq -r --arg scope "$scope" --arg name "$name" '.["[opencode]"][$scope][$name].model' "$config_file")"
  [ "$actual" = "$expected" ] || fail "expected $scope.$name to receive the low-cost model"
}

empty_config="$TEMP_DIR/empty.json"
empty_marker="$TEMP_DIR/empty.marker"
printf '{}\n' > "$empty_config"
initialize_omo_permissions "$empty_config" "$PERMISSION_DEFAULTS_FILE"
[ "$(jq 'has("[opencode]")' "$empty_config")" = "false" ] || fail "permission bootstrap added model defaults without opt-in"
apply_omo_model_defaults "$empty_config" "$MODEL_DEFAULTS_FILE" "$empty_marker"
assert_model "$empty_config" agents sisyphus
assert_model "$empty_config" categories quick
[ -f "$empty_marker" ] || fail "expected a one-time migration marker"

missing_marker="$TEMP_DIR/missing.marker"
apply_omo_model_defaults "$TEMP_DIR/missing.json" "$MODEL_DEFAULTS_FILE" "$missing_marker"
[ ! -e "$missing_marker" ] || fail "marked a skipped missing configuration migration complete"

custom_config="$TEMP_DIR/custom.json"
custom_marker="$TEMP_DIR/custom.marker"
cat > "$custom_config" <<'EOF'
{
  "custom": { "keep": true },
  "[opencode]": {
    "agents": { "sisyphus": { "model": "custom/sisyphus", "temperature": 0.4 } },
    "categories": { "quick": { "model": "custom/quick" } }
  }
}
EOF
apply_omo_model_defaults "$custom_config" "$MODEL_DEFAULTS_FILE" "$custom_marker"
[ "$(jq -r '.["[opencode]"].agents.sisyphus.model' "$custom_config")" = "custom/sisyphus" ] || fail "replaced a customized agent model"
[ "$(jq -r '.["[opencode]"].agents.sisyphus.temperature' "$custom_config")" = "0.4" ] || fail "changed a customized agent setting"
[ "$(jq -r '.["[opencode]"].categories.quick.model' "$custom_config")" = "custom/quick" ] || fail "replaced a customized category model"
[ "$(jq -r '.custom.keep' "$custom_config")" = "true" ] || fail "changed an unrelated custom setting"
assert_model "$custom_config" agents atlas
assert_model "$custom_config" categories deep

before_second_run="$(sha256sum "$custom_config")"
apply_omo_model_defaults "$custom_config" "$MODEL_DEFAULTS_FILE" "$custom_marker"
[ "$(sha256sum "$custom_config")" = "$before_second_run" ] || fail "one-time migration changed config after its marker existed"

jsonc_config="$TEMP_DIR/commented.jsonc"
jsonc_marker="$TEMP_DIR/commented.marker"
printf '{ // preserve this user comment\n}\n' > "$jsonc_config"
before_jsonc="$(sha256sum "$jsonc_config")"
apply_omo_model_defaults "$jsonc_config" "$MODEL_DEFAULTS_FILE" "$jsonc_marker"
[ "$(sha256sum "$jsonc_config")" = "$before_jsonc" ] || fail "changed a JSONC configuration that jq cannot preserve"
[ ! -e "$jsonc_marker" ] || fail "marked a skipped JSONC migration complete"

symlink_target="$TEMP_DIR/symlink-target.json"
symlink_config="$TEMP_DIR/symlink.json"
symlink_marker="$TEMP_DIR/symlink.marker"
printf '{}\n' > "$symlink_target"
ln -s "$symlink_target" "$symlink_config"
apply_omo_model_defaults "$symlink_config" "$MODEL_DEFAULTS_FILE" "$symlink_marker"
[ -L "$symlink_config" ] || fail "replaced a symlinked configuration"
[ ! -e "$symlink_marker" ] || fail "marked a skipped symlink migration complete"

echo "PASS: OMO model-default migration preserves existing settings"
