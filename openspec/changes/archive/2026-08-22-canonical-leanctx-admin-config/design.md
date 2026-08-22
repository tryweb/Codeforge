## Context

See `proposal.md` for the motivation and scope. The current Dockerfile writes LeanCTX defaults directly to `/home/devuser/.config/lean-ctx/config.toml`, while `docker-compose.dev.yml` mounts a persistent named volume at that path. The Admin schema separately defines defaults, so reset behavior can diverge from the image baseline.

## Goals / Non-Goals

**Goals:**

- Establish a single canonical baseline per image build.
- Keep the baseline available when the runtime configuration volume is mounted.
- Seed runtime state once, preserve user values across lifecycle events, and support adding missing keys on upgrade.
- Make Admin read, save, validate, and reset operations use the same baseline and runtime paths.
- Report malformed configuration rather than silently converting it to `{}`.

**Non-Goals:**

- Changing LeanCTX's upstream configuration semantics.
- Adding per-user or multi-tenant configuration management.
- Replacing TOML with a database or introducing a new configuration service.
- Automatically overwriting user values during image upgrades.

## Decisions

### 1. Store immutable defaults outside the runtime volume

The image SHALL write the baseline to `/etc/lean-ctx/config.default.toml`. The writable runtime path remains `/home/devuser/.config/lean-ctx/config.toml`. This prevents the compose volume from hiding the source used by Reset and migration.

**Alternative rejected:** Keep defaults only at the runtime path. A named volume can hide the image file and makes image rebuilds unable to provide a reliable reset source.

### 2. Treat the runtime file as the user-owned state

Entrypoint initialization SHALL create the runtime file only when absent. On an existing file, it SHALL preserve existing values and may add keys missing from the current baseline. It SHALL never replace an existing value merely because the image changed.

**Alternative rejected:** Regenerate the runtime file on every startup. This violates persistence and loses Admin changes.

### 3. Derive Admin defaults from the canonical baseline

The Admin backend SHALL load the baseline from the image default file and use it for schema/default presentation and Reset. The TypeScript schema SHALL describe types, validation constraints, labels, and sections; it SHALL not contain a competing copy of operational default values.

**Alternative rejected:** Maintain Dockerfile values and TypeScript `default` values independently. The current `shell_allowlist_extra` mismatch demonstrates that this drifts.

### 4. Keep source selection explicit

The read response SHALL identify the baseline, runtime, and optional project override state. The effective configuration shown to the user SHALL be the runtime configuration with baseline values filled for absent keys, while the reset operation SHALL write a complete baseline-backed runtime file.

### 5. Fail closed on malformed configuration

TOML parse errors SHALL be represented as an explicit error result. The Admin route SHALL return an error state, and startup SHALL either stop LeanCTX startup or use an explicitly documented recovery path; it SHALL not silently return an empty object.

### 6. Test through the real lifecycle

Unit tests SHALL cover baseline loading, merge/reset behavior, validation, missing-key migration, and parse errors. Integration tests SHALL exercise the runtime file and container-facing command path. Playwright SHALL cover Admin reset, edit/save, reload persistence, and reset cleanup.

## Risks / Trade-offs
- The editor deliberately separates persistence from daemon restart: Save writes the
  structured form to `config.toml`, while Apply runs `lean-ctx config apply` in
  `ai-dev` and restarts the LeanCTX daemon. The UI must make this sequence explicit.
- Raw TOML and per-field immediate-save controls are removed to avoid conflicting
  save semantics and misleading format labels.

- **Risk:** Existing volumes may contain malformed or legacy configuration. → **Mitigation:** detect parse errors, expose repair/reset, and add a one-time migration path with a backup before rewriting.
- **Risk:** A new baseline may introduce keys unsupported by an older LeanCTX binary. → **Mitigation:** pair baseline changes with the pinned binary version and validate before applying.
- **Risk:** The baseline file can become stale relative to Dockerfile edits. → **Mitigation:** generate or copy it from one build-time source and add a test that compares the packaged baseline with the expected configuration contract.
- **Risk:** Reset removes intentional user customization by design. → **Mitigation:** require confirmation and document that Reset replaces the runtime file with the current image baseline.

## Migration Plan

1. Add `/etc/lean-ctx/config.default.toml` to the image and stop treating the volume-mounted path as the image default source.
2. On startup, if the runtime file is absent, seed it from the packaged baseline.
3. If a legacy runtime file exists, parse and preserve it; back up malformed content before presenting the repair/reset path.
4. Update Admin reads, saves, per-key reset, and full reset to use the baseline/runtime distinction.
5. Rebuild the image and recreate containers without deleting the named configuration volume.
6. Verify existing user values survive restart, then verify Reset restores the new baseline.

Rollback consists of restoring the previous image and runtime entrypoint while retaining the backed-up runtime configuration; no destructive volume deletion is required.
