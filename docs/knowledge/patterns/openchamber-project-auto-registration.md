# OpenChamber Project Auto-Registration

## Context

The ai-admin dashboard has a Projects page that creates project directories inside `~/workspace/` in the ai-dev container via `mkdir -p`. OpenChamber, the web UI, maintains its own independent project registry in `~/.config/openchamber/settings.json` under the `projects` array.

## Problem

When a project was created via the admin dashboard, it only created a directory. OpenChamber did not discover it automatically — users had to manually click "Add project" in OpenChamber, navigate the directory tree, and confirm. This two-step flow created friction: admins expected projects created in the admin UI to immediately appear in OpenChamber.

## Solution

After `mkdir -p` creates the project directory, the admin backend uses `execInAiDev` to directly append a project entry to OpenChamber's `settings.json` using `jq`:

```typescript
await execInAiDev(
  `SETTINGS=/home/devuser/.config/openchamber/settings.json && ` +
  `FULLPATH=/home/devuser/workspace/${JSON.stringify(name)} && ` +
  `ID=path_$(printf '%s' "$FULLPATH" | base64 -w0) && ` +
  `NOW=$(date +%s%3N) && ` +
  `jq --arg path "$FULLPATH" --arg id "$ID" --arg now "$NOW" ` +
  `'.projects += [{"id": $id, "path": $path, "addedAt": $now | tonumber, "lastOpenedAt": $now | tonumber}]' ` +
  `$SETTINGS > /tmp/settings.json && mv /tmp/settings.json $SETTINGS`,
  10_000,
);
```

### Key details

- **ID format**: `path_` + base64-encoded absolute path (e.g. `path_L2hvbWUvZGV2dXNlci93b3Jrc3BhY2UvZm9v` for `/home/devuser/workspace/foo`)
- **Label**: Omitted from the JSON entry — OpenChamber auto-generates a label from the directory name (replacing hyphens with spaces and capitalizing words)
- **Timestamp**: `date +%s%3N` produces milliseconds since epoch, matching OpenChamber's format
- **Safety**: Uses `jq` to manipulate JSON rather than raw text manipulation, ensuring the file remains valid even if it has existing content

## Why It Works

OpenChamber reads `settings.json` at startup and watches it for changes. Adding an entry to the `projects` array is sufficient — no restart or API call is needed. The UI picks up the new project on the next render cycle.

`execInAiDev` runs inside the ai-dev container via `docker exec`, so it has direct filesystem access to OpenChamber's config directory (`~/.config/openchamber/`), which lives in a persistent Docker volume.

## Side Effects / Tradeoffs

- **`opencode --new` was removed**: The old code called `opencode --new` after directory creation, but this flag does not exist in the OpenCode CLI. It was dead code that always failed silently due to `|| true`.
- **"Initialize with OpenCode" checkbox ignored**: The UI checkbox still renders but the backend no longer acts on it. A future improvement could run `opencode` in the project directory to generate OpenCode metadata.
- **Direct `settings.json` manipulation**: This bypasses OpenChamber's own APIs (if any). The `jq` write pattern is safe because it writes to a temp file first, then atomically replaces the original.
- **Project name sanitization**: `JSON.stringify(name)` in a template literal produces `"name"` (with double quotes), which is shell-safe. The `jq --arg` mechanism handles special characters in paths.

## Evidence

- Tested end-to-end: admin creates `auto-test-project` → `settings.json` gains an entry → OpenChamber UI shows **"Auto Test Project"** in the sidebar without manual "Add project"
- `jq` one-liner verified on actual `settings.json` content
- OpenChamber project list query via Playwright confirmed the new project appears

## Related Files

- `src/admin/routes/projects.ts` — project creation endpoint with OpenChamber registration
- `src/admin/lib/docker.ts` — `execInAiDev` for running commands inside ai-dev container
- `docs/knowledge/architecture/admin-env-editor-dataflow.md` — related dataflow for env editor

## Tags

`openchamber` `projects` `registration` `settings-json` `jq` `auto-discovery`
