## Why

SuperPower is currently installed globally via Dockerfile and enabled for all projects by default. This creates two problems: (1) Projects that don't need SuperPower still load its 14 skills, adding cognitive overhead and potential conflicts with OMO's overlapping skills (brainstorming, TDD, systematic-debugging, etc.); (2) Teams cannot opt-in selectively — SuperPower is forced on every workspace. Moving to a per-project opt-in model (like OpenSpec) gives admins control and reduces global noise.

## What Changes

- **Remove SuperPower from global plugin list** in Dockerfile (`opencode.json.default`) and `.env.example` (`OPENCODE_PLUGINS`)
- **Remove build-time bake** of SuperPower plugin (`/opt/opencode/baked-plugins/superpowers/`)
- **Remove runtime symlink logic** in `entrypoint.d/02-init-config.sh` that links SuperPower skills globally
- **Add `superpowers` to `PROJECT_FEATURES`** in admin backend (`src/admin/lib/projects.ts`)
- **Implement per-project enable API** (`POST /api/projects/:name/features/superpowers`) that:
  - Creates project-level `.opencode/opencode.json` with SuperPower plugin
  - Symlinks SuperPower skills from baked image to project's `.opencode/skills/`
- **Add detection logic** in `projects-overview.ts` to check for `.opencode/opencode.json` with SuperPower plugin
- **Add UI support** in `static/projects-page.js` capabilities array
- **BREAKING**: Existing containers with global SuperPower will lose it on rebuild; projects must explicitly enable via admin UI

## Capabilities

### New Capabilities
- `project-features/superpowers`: Per-project SuperPower skill enablement via admin UI, with filesystem-based detection and project-scoped OpenCode plugin configuration

### Modified Capabilities
- `project-features/openspec`: No requirement change (reference implementation remains same pattern)
- `project-features/knowledge`: No requirement change
- `project-features/maintenance`: No requirement change

## Impact

**Affected files:**
- `Dockerfile` (lines 231, 235, 273-280) — remove global plugin declaration and bake
- `.env.example` — remove `superpowers@...` from `OPENCODE_PLUGINS`
- `entrypoint.d/02-init-config.sh` — remove SuperPower symlink logic
- `src/admin/lib/projects.ts` — add `superpowers` to `PROJECT_FEATURES`, implement enable command
- `src/admin/lib/projects-overview.ts` — add detection for project-level SuperPower config
- `src/admin/static/projects-page.js` — add UI toggle for SuperPower
- `src/admin/routes/projects.ts` — no change (generic feature endpoint handles it)