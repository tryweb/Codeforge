# Project Skill Format: Flat `.md` → Folder `SKILL.md` Migration

## Context

OpenCode 1.18.5+ discovers project-local skills via a folder format: `.opencode/skills/<name>/SKILL.md`. The older flat format (`.opencode/skills/<name>.md`) is **not** auto-discovered by the OpenChamber/OpenCode skill loader.

ai-engkit shipped two `bootstrap.sh` scripts that created project-local skills in the old flat format:
- `enable-project-knowledge/bootstrap.sh` → created `.opencode/skills/knowledge-capture.md`
- `enable-finalize-maintenance/bootstrap.sh` → created `.opencode/skills/finalize-maintenance.md`

Additionally, ai-engkit's own project skills (`release`, `vuln-scan`, `check-updates`, `knowledge-capture`) were in flat format.

## Problem

When a user enabled project features (Knowledge / Maintenance) via the admin dashboard or bootstrap script, the resulting skill files were not discoverable by OpenCode. The admin UI would show the feature as "enabled" (because it checks `docs/knowledge/README.md` markers), but the `/command` wouldn't appear in OpenChamber's slash-autocomplete.

The bootstrap script's `put` function used:

```bash
put "$ROOT/.opencode/skills/knowledge-capture.md" <<'SKILL'
```

which produced a flat file instead of a folder containing `SKILL.md`.

## Solution

### 1. Fix bootstrap.sh output paths (2 files)

Change the `put` destination from flat `.md` to `SKILL.md` inside a subdirectory:

```bash
# Before
put "$ROOT/.opencode/skills/knowledge-capture.md" <<'SKILL'

# After
put "$ROOT/.opencode/skills/knowledge-capture/SKILL.md" <<'SKILL'
```

The `put` function already calls `mkdir -p "$(dirname "$dest")"`, so the directory is auto-created.

### 2. Migrate existing flat files (4 in ai-engkit repo)

```bash
for f in release.md vuln-scan.md check-updates.md knowledge-capture.md; do
  name="${f%.md}"
  mkdir -p "$name"
  git mv "$f" "$name/SKILL.md"
done
```

### 3. Update doc references (7 occurrences across 5 files)

All documentation that referenced `.opencode/skills/*.md` as project-local paths was updated to `.opencode/skills/*/SKILL.md`.

**Files updated:**
- `.opencode/baked-skills/enable-project-knowledge/SKILL.md`
- `.opencode/baked-skills/enable-finalize-maintenance/SKILL.md`
- `docs/knowledge/patterns/enable-xxx-skill-pattern.md`
- `docs/knowledge/patterns/version-management-pipeline.md`
- `.opencode/baked-skills/enable-project-knowledge/bootstrap.sh` (comment + generated content)

## Why It Works

- The `put` function's `mkdir -p $(dirname $dest)` auto-creates the skill directory
- OpenCode's loader globs for `**/SKILL.md` — the folder format matches this pattern
- The `bootstrap.sh` heredoc content is identical regardless of output file extension — only the path changes
- Existing flat files in user projects remain as orphans but don't break anything; they're simply not discovered

## Side Effects / Tradeoffs

- Old flat `.md` files in existing user projects are **not auto-migrated**. A one-liner migration command is available:
  ```bash
  for f in .opencode/skills/*.md; do [ -f "$f" ] && { n="${f%.md}"; mkdir -p "$n"; mv "$f" "$n/SKILL.md"; }; done
  ```
- The troubleshooting doc `opencode-project-skill-discovery.md` intentionally retains a reference to the old flat format as a counter-example
- The admin `checkFeature()` function remains unchanged — it checks `docs/knowledge/README.md`, not skill format

## Evidence

- **Bootstrap test** on `192.168.11.195` (ai-engkit container):
  - `bash bootstrap.sh /tmp/test-project` → created `.opencode/skills/knowledge-capture/SKILL.md` ✅
  - `bash bootstrap.sh /tmp/test-project` → created `.opencode/skills/finalize-maintenance/SKILL.md` ✅
  - No flat `.md` files in `.opencode/skills/` ✅
- **API verification** via `GET /api/config/skills?directory=...`:
  - Both skills returned with `scope: "project"`, `source: "opencode"` ✅
  - Total skills: 24 (unchanged) ✅
- **Stale refs**: `grep -rn '\.opencode/skills/[a-z-]*\.md' .opencode/baked-skills/` → 0 matches ✅
- **Diagnostics**: `lsp_diagnostics` → 0 errors across 10 skill files ✅

## Related Files

- `.opencode/baked-skills/enable-project-knowledge/bootstrap.sh`
- `.opencode/baked-skills/enable-finalize-maintenance/bootstrap.sh`
- `.opencode/baked-skills/enable-project-knowledge/SKILL.md`
- `.opencode/baked-skills/enable-finalize-maintenance/SKILL.md`
- `docs/knowledge/patterns/enable-xxx-skill-pattern.md`
- `docs/knowledge/patterns/version-management-pipeline.md`
- `docs/knowledge/troubleshooting/opencode-project-skill-discovery.md`

## Tags

`#skills` `#opencode` `#project-config` `#bootstrap` `#migration` `#format`
