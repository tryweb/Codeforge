#!/usr/bin/env bash

# Ensure the OpenChamber settings file carries a defaultModel so new sessions
# default to the intended model (opencode/big-pickle).
#
# - Missing file (first boot): seed a fresh settings.json.
# - Existing file WITHOUT a defaultModel key (e.g. settings predating the seed
#   logic in 02-init-config.sh): backfill just the key, preserving everything
#   else in the file.
# - Existing file WITH a defaultModel: untouched — a user-chosen model must win.
# - Symlinked file: skipped, never replaced.
#
# Always fails soft: a settings issue must not block container startup.
ensure_openchamber_default_model() {
  local settings_file="$1"
  local default_model="$2"
  local temporary_file

  if [ ! -f "$settings_file" ]; then
    mkdir -p "$(dirname "$settings_file")"
    jq -n --arg model "$default_model" '{
      defaultModel: $model,
      showOpenCodeUpdateNotifications: false
    }' > "$settings_file"
    echo "Created default OpenChamber settings: $settings_file"
    return 0
  fi

  if [ -L "$settings_file" ]; then
    echo "Warning: OpenChamber settings backfill skipped; refusing to replace symlinked file" >&2
    return 0
  fi

  if jq -e 'has("defaultModel")' "$settings_file" >/dev/null 2>&1; then
    return 0
  fi

  temporary_file="$(mktemp "${settings_file}.tmp.XXXXXX")"
  if jq --arg model "$default_model" '.defaultModel = $model' "$settings_file" > "$temporary_file" 2>/dev/null; then
    mv "$temporary_file" "$settings_file"
    echo "Backfilled OpenChamber defaultModel ($default_model): $settings_file"
  else
    rm -f "$temporary_file"
    echo "Warning: OpenChamber settings backfill skipped; $settings_file is not valid JSON" >&2
  fi
}
