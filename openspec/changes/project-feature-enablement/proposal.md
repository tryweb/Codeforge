## Why

The Projects page currently has a broken "Init OpenCode" button (the `--new` flag does not exist in the opencode CLI) and no way to enable project-level features. Users creating projects via the admin dashboard must manually SSH into the container or use OpenCode/OpenChamber to set up project tooling. This change replaces the dead button with actionable feature enablement controls for three baked capabilities: project knowledge base, maintenance reports, and OpenSpec.

## What Changes

- Remove the dead "Init OpenCode" button from each project row
- Add three feature-status columns (Knowledge, Maintenance, OpenSpec) with Enable/Init buttons per project
- Add backend endpoints to check feature status and run bootstrap scripts
- Add `enable-project-knowledge` and `enable-finalize-maintenance` bootstrap execution via `execInAiDev`
- Add `openspec init --tools opencode` execution for projects that need it
- The finalize-maintenance bootstrap auto-provisions knowledge base if missing (handled by its existing bootstrap.sh logic)
- Add git init + remote URL on project creation (git clone when URL provided, git init otherwise)
- Add git remote management after creation: set/update/remove via PUT endpoint, auto-fetches content on empty repos
- Add batch overview endpoint to avoid N*2 API calls per page load (solves rate limiting)
- Add project sync with OpenChamber: detect missing/stale entries and batch fix

## Capabilities

### New Capabilities
- `project-feature-status`: API to query per-project feature enablement status (knowledge, maintenance, openspec)
- `project-feature-enable`: API to trigger feature bootstrap for a given project and feature type
- `project-git-remote`: API to get/set/update/remove git remote URL with auto-fetch on empty repositories
- `project-overview`: Batch endpoint returning all projects' features + git remote in one request
- `project-sync`: Compare workspace directories vs OpenChamber project registry, batch add missing and remove stale entries

### Modified Capabilities
- (none — no existing specs are modified)

## Impact

- `src/admin/routes/projects.ts` — new endpoints for feature status, feature enable, git remote management, batch overview
- `src/admin/views/projects.tsx` — feature columns, git remote display/set per project, git init + remote URL in create modal
- `src/admin/lib/docker.ts` — `execInAiDev` already available, no changes needed
- No new dependencies — bootstrap.sh scripts, openspec CLI, and git are already in the image
