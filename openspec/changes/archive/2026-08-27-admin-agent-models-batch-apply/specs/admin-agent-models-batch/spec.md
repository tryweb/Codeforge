## Purpose

Enable batched editing of multiple agent primary models in Admin UI with a single managed OpenCode restart, reducing health-check contention and aligning UI with the startup batch reconciliation.

## ADDED Requirements

### Requirement: Batch apply agent models with single restart
The system SHALL expose PUT /api/agent-models accepting `{changes: [{agent: string, entries: Array<{model: string, variant?: string}>}]}` where each entry follows the same validation as the single-agent endpoint (0 or 1 entry, model must be provider/model in the active catalog, variant from the allowed set). The handler SHALL call lib.applyAndVerifyBatch(changes) exactly once, performing one snapshot, one `join(" && ")` write, one restartManagedOpenCode, and per-agent verifyAppliedAgent, and SHALL return `{results: Record<agent, ApplyResult>}` with per-agent status.

#### Scenario: Batch with three agents succeeds with one restart
- **WHEN** an admin submits changes for explore, librarian and metis each with one valid catalog model
- **THEN** the system writes all three to ~/.omo/omo.jsonc in one shell invocation, restarts managed OpenCode once, verifies each, and returns verified for all three

#### Scenario: Batch rejects invalid catalog model without writing
- **WHEN** a batch contains a model not in the active catalog
- **THEN** the system rejects the entire batch with 400 and does not modify ~/.omo/omo.jsonc

#### Scenario: Batch with empty changes is no-op
- **WHEN** an admin submits an empty changes array
- **THEN** the system performs no snapshot, write, or restart and returns an empty results map

### Requirement: Batch endpoint reuses existing rollback semantics
The batch write SHALL preserve the existing rollback contract: write_failed restores snapshot, restart_failed restores snapshot, probe_failed (unavailable/retired) restores snapshot and re-restarts, retryable/unreachable keeps the applied configuration as unverified, and runtime_mismatch is reported without rollback.

#### Scenario: Restart failure rolls back entire batch
- **WHEN** the batch write succeeds but restartManagedOpenCode fails
- **THEN** the system restores the snapshot, and every agent in the batch reports restart_failed

#### Scenario: Probe conclusive failure rolls back entire batch
- **WHEN** any agent in the batch probes as unavailable or retired
- **THEN** the system restores the snapshot, restarts, and every agent reports rollback_failed
