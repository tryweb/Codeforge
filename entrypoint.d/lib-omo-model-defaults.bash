#!/usr/bin/env bash

initialize_omo_permissions() {
  local config_file="$1"
  local defaults_file="$2"

  [ -f "$defaults_file" ] || return 0

  if [ -f "$config_file" ]; then
    if ! grep -q '"agents"' "$config_file"; then
      echo "Merging default OMO agent permissions into omo.jsonc"
      jq -s '.[0] * .[1]' "$defaults_file" "$config_file" > "${config_file}.tmp" \
        && mv "${config_file}.tmp" "$config_file"
    fi
  else
    echo "Creating omo.jsonc with default agent permissions"
    cp "$defaults_file" "$config_file"
  fi
}

apply_omo_model_defaults() {
  local config_file="$1"
  local defaults_file="$2"
  local marker_file="$3"
  local temporary_file

  [ -e "$marker_file" ] && return 0

  if [ -L "$config_file" ]; then
    echo "Warning: OMO model-default migration skipped; refusing to replace symlinked configuration" >&2
    return 0
  fi

  if [ ! -f "$config_file" ] || [ ! -f "$defaults_file" ]; then
    echo "Warning: OMO model-default migration skipped; configuration or defaults are missing" >&2
    return 0
  fi

  temporary_file="$(mktemp "${config_file}.tmp.XXXXXX")"
  if ! jq --slurpfile defaults "$defaults_file" '
    def add_missing_models($scope):
      reduce ($defaults[0]["[opencode]"][$scope] // {} | to_entries[]) as $entry (
        .;
        if .["[opencode]"]?[$scope]?[$entry.key]? | has("model") then
          .
        else
          .["[opencode]"][$scope][$entry.key].model = $entry.value.model
        end
      );

    add_missing_models("agents") | add_missing_models("categories")
  ' "$config_file" > "$temporary_file"; then
    rm -f "$temporary_file"
    echo "Warning: OMO model-default migration skipped; $config_file must be strict JSON to preserve JSONC comments" >&2
    return 0
  fi

  if ! cmp -s "$config_file" "$temporary_file"; then
    mv "$temporary_file" "$config_file"
    echo "Applied opt-in OMO model defaults without replacing existing model settings"
  else
    rm -f "$temporary_file"
    echo "OMO model defaults already present; no configuration changes needed"
  fi

  : > "$marker_file"
}
