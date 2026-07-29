# Design: adopt-omo-jsonc-unified-config

## Context

oh-my-openagent v4.19.3 (commit `16fe53a`) made `~/.omo/omo.jsonc` the only user-level config root — XDG/APPDATA/`~/.config/omo` branches were removed outright. Project-level layers live at `<project>/.omo/omo.jsonc`. Legacy files (`~/.config/opencode/oh-my-openagent.json(c)` and 3 sibling names, plus the Codex-era `~/.omo/config.jsonc`) are consumed once by a non-interactive startup migration (`2026-07-opencode-config-unification`) that writes omo.jsonc, records a `_migrations` marker, and creates a timestamped backup only when migration actually runs. The migration lock (`~/.omo/.migration.lock`) auto-reclaims stale leases.

AI-EngKit today: floats `OH_MY_OPENAGENT_VERSION=latest`; bakes `.opencode/oh-my-openagent.json.default` (11 agent permission presets, `$schema` pointing at OMO's floating `dev` branch) into `/etc/opencode/`; entrypoint `02-init-config.sh` shallow-merges it into `~/.config/opencode/oh-my-openagent.json` on every start. Compose files persist `~/.config/opencode` but **not** `~/.omo`.

Constraints: DooD environment; entrypoint scripts run before CMD (`openchamber serve`); existing users have named volumes with legacy files inside.

Remote validation against OMO v4.19.3 established that its archival step uses `rename()`: with the legacy file in `opencode-config` and the backup in a new `omo-config` volume, migration fails with `EXDEV`, after creating a partial target and `.migration-journal.json`. The current version is therefore unsafe for the proposed two-volume topology. It also established that Dockerfile's build ARG does not pin runtime OMO because `02-init-config.sh` regenerates `opencode.json` from an unversioned `OPENCODE_PLUGINS` default.

## Goals / Non-Goals

**Goals:**
- Adopt omo.jsonc as AI-EngKit's OMO config surface (defaults, entrypoint merge, schema pin).
- Persist `~/.omo` so migrated config, user edits, and migration markers survive container recreation.
- Keep existing users' legacy files migrating cleanly via OMO's own mechanism across two Docker volumes.
- Pin and enforce the runtime OMO version to stop config-surface drift.

**Non-Goals:**
- Project-level `<project>/.omo/omo.jsonc` seeding (user-level only for now).
- Migrating AI-EngKit-specific OMO tuning beyond the 11 agent presets (categories, model chains stay upstream-default).
- Reimplementing OMO's migration transform in the entrypoint.
- Importing arbitrary legacy OMO settings into unified config.

## Decisions

### D1: Entrypoint writes omo.jsonc directly, not via OMO migration
Write `~/.omo/omo.jsonc` from the baked default in the entrypoint, instead of continuing to write the legacy file and letting OMO migrate it.

*Alternative considered:* keep writing `oh-my-openagent.json` and rely on OMO startup migration. Rejected: once the `_migrations` marker is set, OMO never re-reads the legacy file — AI-EngKit's default-update channel silently dies, and every start does useless merge work on a dead file.

### D2: Preserve today's merge policy
Apply the same policy the entrypoint uses now: merge the default under the user file **only when the user file is missing or lacks `.agents`**; otherwise leave it alone. Shallow merge (`jq -s '.[0] * .[1]'`).

*Alternative considered:* deep-merge on every start. Rejected: users can never remove a shipped key; surprising. Also considered: always overwrite. Rejected: destroys user customization.

### D3: Place `agents` at the harness-neutral top level of omo.jsonc
Ship the 11 presets under top-level `agents` (not under `[opencode]`). The pinned release schema must treat top-level keys as harness-neutral and this matches the migration transform's own mapping (`agents → agents`).

*Alternative considered:* `[opencode]` namespace. Rejected as default choice: harness-neutral keeps the file portable if a Codex harness is added later. *Verify at implementation time against the pinned schema that top-level `agents` is honored by the opencode harness; fall back to `[opencode]` if not.*

### D4: Dedicated `~/.omo` volume plus same-volume legacy archive
Add `omo-config:/home/devuser/.omo` to both compose files. Before OMO starts, the entrypoint archives every recognized legacy OMO config filename inside the existing `opencode-config` volume with an AI-EngKit backup suffix. This same-filesystem rename prevents OMO from discovering a migration source and therefore avoids its cross-volume `rename()` path.

*Alternative considered:* upstream EXDEV-safe archival. Rejected for this change because it blocks users on an upstream release. AI-EngKit does not import arbitrary legacy settings; it preserves them as a manual recovery reference and generates only the supported permission presets in unified config.

### D5: Pin and enforce the runtime OMO version
Replace `latest` with `4.19.3`. Persist that build ARG as a runtime environment value and normalize the plugin list in `02-init-config.sh`: a bare `oh-my-openagent` token becomes `oh-my-openagent@${OH_MY_OPENAGENT_VERSION}`, while an explicitly versioned user token remains an opt-out. `check-versions.sh` tracks the pin, so future bumps remain explicit and reviewable.

*Alternative considered:* keep `latest`. Rejected for the reason above; this change is precisely about stabilizing the config surface.

### D6: Entrypoint archives legacy files without importing them
The entrypoint stops generating the legacy file. On first start, it renames recognized legacy filenames to an AI-EngKit backup suffix inside `~/.config/opencode`, before OMO starts. This preserves user content without copying it into unified config, and avoids OMO's cross-volume migration. Users who added non-permission legacy settings can manually recover them from the backup.

### D7: Ordering guarantee — entrypoint before opencode
The entrypoint always completes before the CMD launches opencode/openchamber, so omo.jsonc exists before OMO's startup migration evaluates it. If both an entrypoint-created omo.jsonc (no marker) and a legacy file exist, OMO migration may merge legacy content into the target. This behavior is enabled only after D4's separate-volume migration test passes; existing user target values must win where they conflict.

## Risks / Trade-offs

- [Cross-volume migration fails on v4.19.3] → Archive recognized legacy source files in `opencode-config` before OMO starts, then test that no OMO migration journal or migration backup is created in `omo-config`.
- [Legacy custom settings are not imported] → Preserve a same-volume backup, emit a clear startup message, and document manual recovery.
- [Top-level `agents` may not be honored for the opencode harness] → Verify against the pinned release schema; fall back to `[opencode]` namespace if required.
- [Users mid-customization of the legacy file get their edits migrated once, then future edits to that file do nothing] → Document the unified config path and the upstream backup/rollback procedure.
- [Shallow merge replaces nested objects wholesale] → Same semantics as today; presets are flat permission maps, so impact is nil.
- [Backup directories accumulate in the volume] → OMO only creates backups when migration actually runs (once per environment); acceptable.

## Migration Plan

1. Land Dockerfile/runtime plugin pin + new template + entrypoint archive changes + compose volume in one commit.
3. Existing containers: user recreates → entrypoint creates omo.jsonc → opencode starts → OMO migrates legacy file once (backup under `~/.omo/`).
4. Verify: restart twice — no re-migration, omo.jsonc stable, agents listed correctly.
4. Rollback: restore the AI-EngKit legacy backup filename in `opencode-config`, then revert and recreate.

## Open Questions

- Q1: Is top-level `agents` honored for opencode, or must presets live under `[opencode]`? (Verify against the pinned release schema.)
- Q2: Should `ai-admin` or other services in compose files also get the `omo-config` volume? (Default: no — only `ai-dev` runs opencode interactively; revisit if ai-admin spawns opencode.)
