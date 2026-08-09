#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────
# Reconcile OpenChamber project registrations against the
# workspace directory listing. Add-only and idempotent:
#   - directories present on disk but missing from settings.json
#     are re-added (restores registrations lost by an upgrade)
#   - existing and stale registrations are never removed
#   - re-running with nothing missing makes no changes
#   - directories listed in the disabled-projects state file are
#     skipped, so a project disabled from the admin UI stays hidden
#     from OpenChamber across restarts
#
# Runs INSIDE the ai-dev container (jq ships in the image), at
# /opt/ai-engkit/scripts/reconcile-openchamber-projects.sh. Both
# upgrade paths exec it there: host `upgrade.sh` via `docker exec`,
# the admin UI (`runUpgrade`) via `execInAiDev`.
#
# Mirrors src/admin/lib/openchamber-projects.ts — the same
# shape-guarded, atomic (mktemp + mv) merge is applied per entry.
# A malformed settings file fails safely: the original file is
# left untouched and the script exits non-zero with an error.
#
# Prints {"added":N} on success.
# ──────────────────────────────────────────────────────────
set -euo pipefail

SETTINGS="${SETTINGS:-/home/devuser/.config/openchamber/settings.json}"
WORKSPACE="${WORKSPACE:-/home/devuser/workspace}"
DISABLED="${DISABLED:-/home/devuser/.config/openchamber/disabled-projects.json}"

command -v jq >/dev/null 2>&1 || { echo '{"error":"jq not found in container"}' >&2; exit 1; }

if [ ! -d "$WORKSPACE" ]; then
    printf '{"added":0}\n'
    exit 0
fi

# Shape-guarded add/update for one entry — same semantics as
# mergeOpenChamberProject(action kind=add) in openchamber-projects.ts.
merge_add() {
    local path="$1"
    local id now tmp
    id="path_$(printf '%s' "$path" | base64 -w0)"
    now=$(date +%s%3N)

    mkdir -p "$(dirname "$SETTINGS")"
    if [ ! -e "$SETTINGS" ]; then
        printf '%s\n' '{}' > "$SETTINGS"
    fi

    umask 077
    tmp=$(mktemp "$SETTINGS.tmp.XXXXXX") || return 1
    if ! jq -e \
        --arg path "$path" --arg id "$id" --argjson now "$now" \
        'if type != "object" then error("settings must be an object") elif has("projects") and (.projects | type != "array") then error("projects must be an array") else (.projects // []) as $p | ([range(0; ($p | length))] | map(select($p[.] | (type == "object" and (.path == $path or .id == $id))))) as $idx | if ($idx | length) == 0 then .projects = ($p + [{id: $id, path: $path, addedAt: $now, lastOpenedAt: $now}]) else .projects = ([range(0; ($p | length)) as $i | $p[$i] | if ($idx | index($i)) == null then . elif $i == $idx[0] then . + {id: $id, path: $path, lastOpenedAt: $now} else empty end]) end end' \
        "$SETTINGS" > "$tmp" 2>/dev/null; then
        rm -f "$tmp"
        return 1
    fi
    if ! jq -e \
        --arg path "$path" --arg id "$id" \
        'type == "object" and (.projects | type == "array") and ([.projects[] | select(type == "object" and (.path == $path or .id == $id))] | length) == 1' \
        "$tmp" > /dev/null 2>&1; then
        rm -f "$tmp"
        return 1
    fi
    mv "$tmp" "$SETTINGS"
}

# Registered full paths. A missing file yields an empty list (then the first
# merge creates settings.json from '{}'). A malformed file also yields an
# empty list here, and the subsequent merge fails safely without touching it.
registered_file=$(mktemp)
jq -r 'if type == "object" then (.projects // [])[] | select(type == "object" and (.path | type == "string")) | .path else empty end' "$SETTINGS" 2>/dev/null | sort > "$registered_file" || true

# Disabled project names (from the admin UI). A missing or malformed file
# disables nothing — the safe default.
disabled_file=$(mktemp)
jq -r 'if type == "object" then (.disabled // [])[] | select(type == "string") else empty end' "$DISABLED" 2>/dev/null | sort > "$disabled_file" || true

# Same directory listing as listProjects() in src/admin/routes/projects.ts:
# top-level dirs, hidden ones excluded.
added=0
while IFS= read -r name; do
    [ -n "$name" ] || continue
    if grep -Fxq -- "$name" "$disabled_file"; then
        continue
    fi
    full="$WORKSPACE/$name"
    if ! grep -Fxq -- "$full" "$registered_file"; then
        if ! merge_add "$full"; then
            echo "{\"error\":\"failed to register ${name}\"}" >&2
            rm -f "$registered_file" "$disabled_file"
            exit 1
        fi
        added=$((added + 1))
    fi
done < <(find "$WORKSPACE" -maxdepth 1 -type d ! -path "$WORKSPACE" ! -name '.*' -exec basename {} \; | sort)

rm -f "$registered_file" "$disabled_file"
printf '{"added":%d}\n' "$added"
