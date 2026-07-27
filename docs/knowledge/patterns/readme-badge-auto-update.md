# README Badge Auto-Update Pattern (Retired)

> Historical reference only. AI-EngKit no longer publishes component-version
> badges in `README.md`, and the active CI/release workflows do not update them.

## Why this document exists

Older releases displayed shields.io badges for pinned Dockerfile dependencies
such as Docker, Playwright, lean-ctx, OpenCode, and OpenChamber. The dependency
update workflow and release skill once synchronized those badges from
Dockerfile `ARG` values.

That design was intentionally retired when the README was reorganized around
product positioning and onboarding. Dockerfile `ARG` values remain the single
source of truth for builds, dependency checks, runtime version reporting, and
CHANGELOG generation.

## If version badges are restored

Restoring badges is a deliberate workflow change, not a README-only edit. The
following must be updated together:

1. The badge definitions in `README.md`.
2. The extraction and replacement steps in
   `.github/workflows/dependency-update.yml`.
3. The corresponding release instructions and this historical note.

Until then, do not add badge-specific `sed` commands back to automation.

## Related files

- `.github/workflows/dependency-update.yml` — dependency checks and releases
- `.opencode/skills/release/SKILL.md` — manual release workflow
- `docs/knowledge/patterns/version-management-pipeline.md` — active version flow

## Tags

`badge` `readme` `ci` `dependency-update` `shields.io` `automation` `retired`
