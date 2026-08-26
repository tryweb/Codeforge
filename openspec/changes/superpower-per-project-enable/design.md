## Context

Current state (see proposal.md for motivation):
- SuperPower is baked into Docker image at `/opt/opencode/baked-plugins/superpowers/`
- Global `opencode.json.default` declares SuperPower as a plugin
- Entrypoint script symlinks SuperPower skills to `~/.config/opencode/skills/` for all projects
- Admin UI already supports per-project feature toggles for `knowledge`, `maintenance`, `openspec`
- OpenCode natively supports per-project `.opencode/opencode.json` that merges with global config

## Goals / Non-Goals

**Goals:**
- Remove SuperPower from global plugin list (but KEEP baked image for per-project symlinks)
- Add `superpowers` as a per-project feature toggle following existing `openspec` pattern
- Reuse existing admin API endpoints (`POST /api/projects/:name/features/:feature`)
- Reuse existing project overview detection mechanism
- Reuse existing UI capabilities array in `projects-page.js`

**Non-Goals:**
- Migrate existing projects automatically (admins must explicitly enable)
- Support SuperPower version pinning per-project (uses baked image version)
- Change SuperPower skill set or behavior
- Modify OpenCode plugin loading mechanism

## Decisions

### 1. Use project-level `.opencode/opencode.json` for plugin declaration

**Rationale:** OpenCode natively merges project-level config with global config. This is the idiomatic way to enable plugins per-project.

**Alternative considered:** Symlink skills directly to project's `.opencode/skills/` without plugin declaration.
**Rejected:** OpenCode may not discover skills without the plugin declaration; plugin system handles versioning and dependency resolution.

**Pre-implementation verification REQUIRED:** Before starting implementation, verify OpenCode actually scans `.opencode/opencode.json` in project directory for plugins. Create test project with `.opencode/opencode.json` containing a plugin, run `opencode` in that directory, check if plugin loads. If NOT supported: redesign to use alternative approach (e.g., global plugin + per-project skill filtering).

### 2. Symlink skills from baked image to project's `.opencode/skills/`

**Rationale:** The baked image at `/opt/opencode/baked-plugins/superpowers/skills/` already contains all 14 skills in the correct directory format (each skill has `SKILL.md` with frontmatter). Symlinking avoids re-downloading and matches the existing global symlink pattern.

**Alternative considered:** Run `opencode plugin install` in each project.
**Rejected:** Requires network access, slower, adds runtime dependency on npm registry.

**Pre-implementation verification REQUIRED:** Verify OpenCode discovers project-level skills via the standard directory format. Test: create `.opencode/skills/test-skill/SKILL.md` with frontmatter, call `GET /api/config/skills?directory=<project>` (requires OpenChamber auth), or check OpenChamber UI autocomplete for `/test-skill`. If NOT supported: redesign (see Decision 3 fallback).

### 3. Keep baked image copy but remove from global config

**Rationale:** The baked copy at `/opt/opencode/baked-plugins/superpowers/` is the source for per-project symlinks. Removing it entirely would require downloading on first enable.

**Alternative considered:** Remove baked copy entirely, download on-demand.
**Rejected:** Adds latency and network dependency to first enable; baked copy is small (~2MB).

### 4. Reuse existing `enableProjectFeature` pattern from `openspec`

**Rationale:** The `openspec` enable logic in `projects.ts` (lines 300-315) is the canonical pattern: run a command in the project directory via `execInAiDev`. SuperPower enable follows the same shape.

### 5. Detection via filesystem marker (like openspec), not JSON inspection

**Rationale:** Unlike my original design (JSON inspection), matching the existing pattern is simpler and more robust. The existing `openspec` detection is via directory existence (`test -d openspec/`). For SuperPower, we create a marker directory `.opencode/superpowers/` alongside the skills symlinks.

**Implementation:** `test -d "${projectPath}/.opencode/superpowers"`

## Risks / Trade-offs

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Per-project plugin not supported** | Entire design fails if OpenCode doesn't scan `.opencode/opencode.json` | Pre-implementation verification (Decision 1); if fails, redesign before coding |
| **Per-project skills need OpenChamber API to verify** | CLI `skill list` may not show project skills; must use `GET /api/config/skills?directory=<project>` or OpenChamber autocomplete | Verification uses API/UI; if API auth blocks, trust knowledge base evidence (OpenCode 1.18.5 supports project skill discovery) |
| **Session restart required** | After enabling, existing OpenCode sessions won't see new skills until restart | Match existing pattern: no restart notification in initial implementation; user discovers on next session |
| **Global vs project config conflict** | If global config somehow still has SuperPower, duplicate skills may appear | Ensure Dockerfile and entrypoint fully remove global references; test with `opencode plugin list` |
| **Symlink target validity** | Baked skills path must exist; image rebuild updates version | Baked path is fixed (KEPT per Decision 3); version bump updates image; symlink recreates on enable |
| **Admin enables on project with existing `.opencode/opencode.json`** | Must merge, not overwrite, to preserve other project plugins | Use `jq` to merge plugin array; test with existing config |

## Migration Plan

### Deploy Steps:
1. Build new Docker image with SuperPower removed from global config (but baked image KEPT)
2. Deploy container (existing projects lose global SuperPower)
3. Admin enables SuperPower per-project via UI as needed

### Rollback:
- Revert Dockerfile changes, rebuild image, redeploy
- Or manually add SuperPower back to `OPENCODE_PLUGINS` env var at runtime

### Data Migration:
- No data migration needed (no persistent SuperPower state)
- Project-level configs created fresh on enable
- **Existing volumes note**: containers with an existing `opencode-config-dev` volume retain stale superpowers symlinks in `~/.config/opencode/skills/` from the old startup. These are harmless (baked path still exists) but should be cleaned by admins or a one-time cleanup in the entrypoint if a clean global skills dir is desired.

## Open Questions

1. Should the enable API also run `opencode plugin install` to ensure plugin is in OpenCode's cache, or is symlink sufficient?
   - *Deferrable: symlink should work; can add plugin install later if discovery fails*

2. Should we support disabling by removing only the SuperPower plugin entry (keeping other plugins) vs removing entire `.opencode/opencode.json`?
   - *Deferrable: implement merge logic; if complex, start with remove-all and iterate*