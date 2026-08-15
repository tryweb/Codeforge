## Why

Admin can persist `agents.librarian.model`, but an invalid agent `permission` field and a stale `[opencode].agents` migration layer can prevent that top-level override from becoming effective. OMO then silently resolves librarian through its fallback requirements, causing the live child session to use `opencode-go/qwen3.7-plus` instead of the configured Nemotron model.

## What Changes

- Make top-level `agents.<name>.model` the sole persisted source for Admin-managed primary OMO agent models.
- Remove stale `[opencode].agents` model entries so they cannot outrank Admin-managed values.
- Migrate unsupported agent `permission` entries to schema-valid `tools` entries where restrictions must be preserved, and omit redundant allow-all permissions.
- Treat schema validity, live `/agent` resolution, and a completed child-session assistant message as distinct verification stages.
- Add a real librarian child-session regression test that does not pass an explicit model and verifies `opencode/nemotron-3.5-lightning-free` at execution time.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `admin-agent-model-config`: Correct primary model override semantics and require execution-level confirmation for Admin-managed agent models.
- `omo-unified-config`: Normalize persisted OMO agent settings by removing stale migration model layers and unsupported permission fields while preserving required tool restrictions.

## Impact

- Affected configuration: `.opencode/omo.jsonc.default` and persisted `~/.omo/omo.jsonc` normalization.
- Affected initialization: `entrypoint.d/02-init-config.sh` and related config helpers/tests.
- Affected Admin behavior: agent model status and apply verification semantics.
- Affected verification: OMO config migration tests and real managed-server child-session E2E coverage.
- No public API route shape or external dependency changes are intended.
