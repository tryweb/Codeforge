## Why

The LeanCTX Admin configuration feature currently has two conflicting sources of defaults: the Dockerfile baseline and the TypeScript schema. This causes Reset to Defaults to remove ai-engkit-required settings such as `shell_allowlist_extra`, while named-volume state can also outlive image rebuilds. The feature needs one canonical default source and explicit runtime persistence semantics before further implementation work.

## What Changes

- Treat the LeanCTX configuration written by the Dockerfile as the canonical ai-engkit default baseline.
- Store canonical defaults outside the mounted runtime configuration volume so image rebuilds do not hide or overwrite them.
- Seed the runtime configuration from canonical defaults only when no user configuration exists.
- Allow the Admin UI to read and modify the persisted runtime configuration.
- Make Reset to Defaults restore the exact Dockerfile baseline, including the full `shell_allowlist_extra` command list.
- Preserve user configuration across container restart, recreate, and image rebuild.
- Detect malformed TOML explicitly instead of silently presenting an empty configuration.
- Add unit, integration, and Playwright coverage for initialization, editing, reset, restart persistence, and malformed configuration handling.

## Capabilities

### New Capabilities

- `leanctx-admin-config`: Canonical defaults, Admin editing/reset behavior, runtime persistence, initialization, and validation of LeanCTX configuration.

### Modified Capabilities

- None; no existing OpenSpec capability currently defines LeanCTX Admin configuration behavior.

## Impact
- The Admin editor will use an explicit Save Changes step before Apply.
- Apply will be labelled as a daemon restart operation, not Hot Reload.
- Raw TOML and per-field immediate-save controls will be removed.

- Docker image default configuration and runtime initialization scripts.
- `docker-compose.dev.yml` volume-backed configuration behavior.
- Admin LeanCTX schema, read/write/reset routes, and editor UI.
- Container restart/recreate behavior and configuration error handling.
- Existing LeanCTX unit tests and new browser-level verification.
