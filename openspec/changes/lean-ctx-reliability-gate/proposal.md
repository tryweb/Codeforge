## Why

Automatic Read, Search, and Shell routing must earn trust through measurable evidence. A bounded reliability gate is needed before automation can remain enabled, while administrators still need MCP, Admin, and persistence controls when the gate fails.

## What Changes

- Add a report-only baseline and drift evaluation across global, project, daemon, and baseline behavior.
- Require a fixed 20-scenario evaluation under two profiles, with independent measurement and an incident threshold.
- Perform a one-time, versioned migration with a backup when disabling compression, only for `lite`, `standard`, or `max`, while preserving unrelated values.
- Disable automatic Read, Search, and Shell routing when the gate fails, without disabling MCP, Admin, or persistence.
- Keep shell writes disabled, path jail intact, and apply or restart actions explicitly administrator initiated.

## Capabilities

### New Capabilities

- `lean-ctx-reliability-gate`: Defines the reliability gate, migration, drift reporting, evaluation, and fail-safe behavior.

### Modified Capabilities

- `leanctx-admin-config`: Adds requirements for explicit compression-off migration, report-only drift checks, and the reliability gate.

## Impact

The OpenSpec contract covers the Lean Context configuration and administrative workflow. This change does not modify product code, runtime configuration, Docker files, or the main specification directly.
