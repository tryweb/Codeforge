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
